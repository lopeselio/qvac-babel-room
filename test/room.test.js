import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import createTestnet from 'hyperdht/testnet.js'
import { Room } from '../src/room.js'

test('three peers in a room exchange hellos and captions; others are isolated', { timeout: 60_000 }, async (t) => {
  const testnet = await createTestnet(3)
  const { bootstrap } = testnet
  const ana = new Room({ code: 'amber-anchor-apple-07', name: 'Ana', lang: 'es', bootstrap })
  const ben = new Room({ code: 'amber-anchor-apple-07', name: 'Ben', lang: 'en', bootstrap })
  const chi = new Room({ code: 'amber-anchor-apple-07', name: 'Chi', lang: 'de', bootstrap })
  const eve = new Room({ code: 'some-other-room-99', name: 'Eve', lang: 'en', bootstrap })
  t.after(async () => {
    await Promise.all([ana, ben, chi, eve].map((r) => r.leave()))
    await testnet.destroy()
  })

  const seen = (room, n) => new Promise((resolve) => {
    const check = () => room.peerList.length >= n && resolve()
    room.on('peer', check)
    check()
  })
  await Promise.all([ana.join(), ben.join(), chi.join(), eve.join()])
  await Promise.all([seen(ana, 2), seen(ben, 2), seen(chi, 2)])

  assert.deepEqual(ana.peerList.map((p) => `${p.name}:${p.lang}`).sort(), ['Ben:en', 'Chi:de'])
  assert.equal(eve.peerList.length, 0)

  const atBen = once(ben, 'caption')
  const atChi = once(chi, 'caption')
  ana.say('Hola a todos')
  const [[b], [c]] = await Promise.all([atBen, atChi])
  assert.equal(b.name, 'Ana')
  assert.equal(b.lang, 'es')
  assert.equal(b.text, 'Hola a todos')
  assert.equal(c.seq, 0)

  const langChange = once(ana, 'lang')
  ben.setLang('fr')
  const [l] = await langChange
  assert.equal(l.lang, 'fr')
  assert.equal(ana.peerList.find((p) => p.name === 'Ben').lang, 'fr')

  const left = once(ana, 'leave')
  await chi.leave()
  const [gone] = await left
  assert.equal(gone.name, 'Chi')
})
