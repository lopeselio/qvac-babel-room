import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LineReader, normalizeCode, routeLabel, sortLangs, utf8Decode, utf8Encode, type Line } from '../src/lines.ts'

test('UTF-8 round-trips accents, CJK and emoji like TextEncoder', () => {
  for (const s of ['Hola, ¿qué tal?', 'Grüße', 'こんにちは', 'ok 👋🏽']) {
    assert.deepEqual(utf8Encode(s), new TextEncoder().encode(s))
    assert.equal(utf8Decode(utf8Encode(s)), s)
  }
})

test('IPC lines are split on the newline byte, even mid-character', () => {
  const r = new LineReader()
  const bytes = utf8Encode(JSON.stringify({ t: 'caption', text: 'reunión' }) + '\n' + JSON.stringify({ t: 'left' }) + '\n')
  const cut = bytes.indexOf(0xc3) + 1 // split inside the "ó"
  assert.deepEqual(r.push(bytes.subarray(0, cut)), [])
  assert.deepEqual(r.push(bytes.subarray(cut)), [{ t: 'caption', text: 'reunión' }, { t: 'left' }])
  assert.deepEqual(r.push(utf8Encode('not json\n\n')), [])
})

test('room codes follow the desktop rule', () => {
  assert.equal(normalizeCode('  Petal Hollow Tern Bloom 23 '), 'petal-hollow-tern-bloom-23')
  assert.equal(normalizeCode('abc'), null)
})

test('route badges say how a line reached your language', () => {
  const base: Line = { id: 1, self: false, name: 'Ana', lang: 'es', original: 'Hola', text: 'Ciao', route: 'pivot', at: 0 }
  assert.equal(routeLabel(base, 'it'), 'es → en → it')
  assert.equal(routeLabel({ ...base, route: 'direct' }, 'en'), 'es → en')
  assert.equal(routeLabel({ ...base, route: 'untranslated' }, 'it'), 'es · not translated')
  assert.equal(routeLabel({ ...base, self: true }, 'es'), null)
  // By name: English, German, Italian.
  assert.deepEqual(sortLangs(['it', 'de', 'en']), ['en', 'de', 'it'])
})
