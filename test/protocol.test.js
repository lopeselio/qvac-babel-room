import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  Decoder, encode, validate, sanitize, roomTopic, newRoomCode, normalizeRoomCode, ROOM_WORDS, PROTOCOL, MAX_LINE_BYTES
} from '../src/protocol.js'

test('room topic is a 32-byte hash, stable across spacing/case, distinct per code', () => {
  const a = roomTopic('Amber-Anchor-Apple-07')
  assert.equal(a.length, 32)
  assert.deepEqual(a, roomTopic('  amber anchor apple 07 '))
  assert.notDeepEqual(a, roomTopic('amber-anchor-apple-08'))
  assert.throws(() => normalizeRoomCode('abc'), /at least 6/)
})

test('newRoomCode makes 4 words + 2 digits from the list', () => {
  const code = newRoomCode()
  const parts = code.split('-')
  assert.equal(parts.length, 5)
  for (const w of parts.slice(0, 4)) assert.ok(ROOM_WORDS.includes(w))
  assert.match(parts[4], /^\d\d$/)
  assert.equal(ROOM_WORDS.length, new Set(ROOM_WORDS).size, 'word list has no duplicates')
  assert.equal(ROOM_WORDS.length, 256)
})

test('validate accepts good messages and rejects bad ones', () => {
  assert.deepEqual(validate({ type: 'hello', protocol: PROTOCOL, name: 'Ana', lang: 'es', extra: 1 }), { type: 'hello', protocol: PROTOCOL, name: 'Ana', lang: 'es' })
  assert.equal(validate({ type: 'hello', protocol: 'other/9', name: 'Ana', lang: 'es' }), null)
  assert.equal(validate({ type: 'caption', seq: 1, lang: 'EN', text: 'hi' }), null)
  assert.equal(validate({ type: 'caption', seq: -1, lang: 'en', text: 'hi' }), null)
  assert.equal(validate({ type: 'caption', seq: 1, lang: 'en', text: 'x'.repeat(5000) }), null)
  assert.equal(validate({ type: 'caption', seq: 1, lang: 'en', text: 'hi' }).final, true)
  assert.equal(validate({ type: 'nope' }), null)
})

test('sanitize removes terminal escapes and bidi tricks', () => {
  assert.equal(sanitize('\u001b[2J\u001b[31mhi‮ there\u0007'), 'hi there')
})

test('Decoder handles split chunks, garbage and oversized lines', () => {
  let abused = 0
  const d = new Decoder({ onAbuse: () => abused++ })
  const line = encode({ type: 'caption', seq: 3, lang: 'de', text: 'Hallo', final: true })
  assert.deepEqual(d.push(line.slice(0, 10)), [])
  const got = d.push(line.slice(10) + 'not json\n' + encode({ type: 'lang', lang: 'fr' }))
  assert.deepEqual(got.map((m) => m.type), ['caption', 'lang'])
  d.push('x'.repeat(MAX_LINE_BYTES + 1))
  assert.equal(abused, 1)
})

test('Decoder keeps a multi-byte character that is split across chunks', () => {
  const d = new Decoder()
  const text = 'José dice: ¿empezamos? 你好 👋'
  const bytes = Buffer.from(encode({ type: 'caption', seq: 0, lang: 'es', text, final: true }))
  // Every possible split point, including inside é (2 bytes), 你 (3) and 👋 (4).
  for (let cut = 1; cut < bytes.length; cut++) {
    assert.deepEqual(d.push(bytes.subarray(0, cut)), [])
    const [m] = d.push(bytes.subarray(cut))
    assert.equal(m.text, text, `split at byte ${cut}`)
  }
  // One byte at a time.
  let got = []
  for (const b of bytes) got = got.concat(d.push(Buffer.from([b])))
  assert.equal(got.length, 1)
  assert.equal(got[0].text, text)
})
