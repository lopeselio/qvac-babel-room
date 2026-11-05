import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BabelSession } from '../src/session.js'

function fakeRoom () {
  const r = new EventEmitter()
  r.name = 'Ben'
  r.lang = 'en'
  r.sent = []
  r.peerList = [{ id: 'a', name: 'Ana', lang: 'es' }]
  r.say = (t) => r.sent.push(t)
  r.setLang = (l) => { r.lang = l }
  r.leave = async () => {}
  return r
}

function fakeTranslator ({ delays = {}, fail = [] } = {}) {
  const t = { target: 'en', prepared: [] }
  t.setTarget = (l) => { t.target = l }
  t.prepare = async (langs) => { t.prepared.push(...langs) }
  t.translate = async (text, from) => {
    await new Promise((r) => setTimeout(r, delays[text] ?? 0))
    if (fail.includes(from)) throw new Error(`no route ${from}`)
    return { text: `${text} (in ${t.target})`, route: { kind: 'direct' } }
  }
  t.close = async () => {}
  return t
}

test('incoming captions are translated and stay in order per speaker', async () => {
  const room = fakeRoom()
  const s = new BabelSession({ room, translator: fakeTranslator({ delays: { uno: 30, dos: 0 } }) })
  const lines = []
  s.on('line', (l) => lines.push(l.text))
  room.emit('caption', { id: 'a', name: 'Ana', lang: 'es', text: 'uno', seq: 0 })
  await s._incoming({ id: 'a', name: 'Ana', lang: 'es', text: 'dos', seq: 1 })
  assert.deepEqual(lines, ['uno (in en)', 'dos (in en)'])
})

test('untranslatable lines still show the original', async () => {
  const room = fakeRoom()
  const s = new BabelSession({ room, translator: fakeTranslator({ fail: ['xx'] }) })
  const lines = []
  s.on('line', (l) => lines.push(l))
  await s._incoming({ id: 'z', name: 'Zed', lang: 'xx', text: 'blorp', seq: 0 })
  assert.equal(lines[0].text, 'blorp')
  assert.equal(lines[0].route.kind, 'untranslated')
})

test('captioner text is broadcast and echoed locally; peers trigger model warm-up', async () => {
  const room = fakeRoom()
  const tr = fakeTranslator()
  const cap = new EventEmitter()
  cap.stop = async () => {}
  const s = new BabelSession({ room, translator: tr, captioner: cap })
  const lines = []
  s.on('line', (l) => lines.push(l))
  cap.emit('text', 'Good morning')
  assert.deepEqual(room.sent, ['Good morning'])
  assert.equal(lines[0].self, true)
  room.emit('peer', { id: 'c', name: 'Chi', lang: 'de' })
  s.setLang('fr')
  assert.equal(tr.target, 'fr')
  assert.deepEqual(tr.prepared, ['de', 'es'])
})

test('writes a markdown transcript with originals', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'br-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'meeting.md')
  const when = new Date('2026-11-05T10:15:00Z')
  const s = new BabelSession({ room: fakeRoom(), translator: fakeTranslator(), transcriptPath: file, now: () => when })
  await s._incoming({ id: 'a', name: 'Ana', lang: 'es', text: 'hola', seq: 0 })
  await new Promise((r) => setTimeout(r, 20))
  // Local wall-clock time, matching what the terminal shows.
  assert.equal(await readFile(file, 'utf8'), `- \`${when.toTimeString().slice(0, 8)}\` **Ana**: hola (in en) _(es: hola)_\n`)
})
