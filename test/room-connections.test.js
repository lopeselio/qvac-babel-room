// Room's connection handling, with a fake swarm and fake connections so each
// case (a replaced connection, a peer that stops reading, lost captions) can
// be driven exactly. test/room.test.js covers the real network path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Room } from '../src/room.js'
import { encode, PROTOCOL } from '../src/protocol.js'

class FakeSwarm extends EventEmitter {
  join () { return { flushed: async () => {} } }
  async destroy () {}
}

class FakeConn extends EventEmitter {
  constructor () {
    super()
    this.written = []
    this.full = false
    this.destroyed = false
  }

  write (line) { this.written.push(JSON.parse(line)); return !this.full }
  end () {}
  destroy () {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('close')
  }

  receive (msg) { this.emit('data', Buffer.from(encode(msg))) }
  get captions () { return this.written.filter((m) => m.type === 'caption').map((m) => m.text) }
}

const key = (n) => ({ publicKey: Buffer.alloc(32, n) })
const hello = (name, lang) => ({ type: 'hello', protocol: PROTOCOL, name, lang })

function setup (opts = {}) {
  const swarm = new FakeSwarm()
  const room = new Room({ code: 'amber-anchor-apple-07', name: 'Ben', lang: 'en', swarm, ...opts })
  const events = []
  for (const e of ['peer', 'leave', 'lang', 'caption', 'gap']) room.on(e, (p) => events.push([e, p]))
  const connect = (n) => { const c = new FakeConn(); swarm.emit('connection', c, key(n)); return c }
  return { room, events, connect, names: () => events.map(([e]) => e) }
}

test('a second connection to the same peer replaces the first without a false leave', () => {
  const { room, connect, names } = setup()
  const first = connect(1)
  first.receive(hello('Ana', 'es'))
  const second = connect(1)
  assert.equal(first.destroyed, true, 'the replaced connection is closed')
  assert.deepEqual(names(), ['peer'], 'no leave for the replaced connection')
  assert.deepEqual(room.peerList.map((p) => p.name), ['Ana'], 'still listed while the new connection says hello')

  second.receive({ type: 'caption', seq: 0, lang: 'es', text: 'hola', final: true })
  assert.deepEqual(names(), ['peer'], 'hello comes first on every connection')
  second.receive(hello('Ana', 'es'))
  assert.deepEqual(names(), ['peer'], 'not announced twice')
  second.receive({ type: 'caption', seq: 1, lang: 'es', text: 'hola', final: true })
  room.say('hi')
  assert.deepEqual(second.captions, ['hi'])
  assert.deepEqual(first.captions, [])

  second.destroy()
  assert.deepEqual(names(), ['peer', 'caption', 'leave'])
  assert.equal(room.peers.size, 0)
})

test('a replacement that says hello in another language reports the change', () => {
  const { connect, events } = setup()
  connect(1).receive(hello('Ana', 'es'))
  connect(1).receive(hello('Ana', 'pt'))
  assert.deepEqual(events.map(([e, p]) => [e, p.lang]), [['peer', 'es'], ['lang', 'pt']])
})

test('a peer that stops reading gets a bounded queue; others are unaffected', () => {
  const { room, connect } = setup()
  const slow = connect(1); slow.receive(hello('Ana', 'es'))
  const fine = connect(2); fine.receive(hello('Chi', 'de'))
  slow.full = true
  const text = 'x'.repeat(2000)
  for (let i = 0; i < 300; i++) room.say(text) // about 600 KiB
  assert.equal(fine.captions.length, 300)
  const queuedBytes = slow.captions.length * 2000
  assert.ok(slow.captions.length > 20, 'a short burst is still queued')
  assert.ok(queuedBytes <= 300 * 1024, `queue is bounded (${queuedBytes} bytes)`)
  const before = slow.captions.length
  room.say('dropped')
  assert.equal(slow.captions.length, before, 'nothing more is written once the queue is full')
  slow.full = false
  slow.emit('drain')
  room.say('after')
  assert.equal(slow.captions.at(-1), 'after')
  assert.equal(slow.destroyed, false)
  slow.destroy(); fine.destroy()
})

test('a peer that stays stalled is disconnected', async () => {
  const { room, connect, names } = setup({ slowPeerMs: 20 })
  const slow = connect(1); slow.receive(hello('Ana', 'es'))
  slow.full = true
  room.say('one')
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(slow.destroyed, true)
  assert.deepEqual(names(), ['peer', 'leave'])

  // Draining in time cancels the disconnect.
  const ok = connect(2); ok.receive(hello('Chi', 'de'))
  ok.full = true
  room.say('two')
  ok.full = false
  ok.emit('drain')
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(ok.destroyed, false)
  ok.destroy()
})
