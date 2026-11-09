import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retryLocked, transcriptLine } from '../src/util.js'

test('retryLocked retries the cache lock error and nothing else', async () => {
  let calls = 0
  const sleep = async () => {}
  const out = await retryLocked(async () => {
    if (++calls < 3) throw new Error('Could not download x (File descriptor could not be locked)')
    return 'ok'
  }, { sleep })
  assert.equal(out, 'ok')
  assert.equal(calls, 3)

  let other = 0
  await assert.rejects(retryLocked(async () => { other++; throw new Error('offline') }, { sleep }), /offline/)
  assert.equal(other, 1)

  let always = 0
  await assert.rejects(retryLocked(async () => { always++; throw new Error('could not be locked') }, { sleep, attempts: 4 }), /locked/)
  assert.equal(always, 4)
})

test('transcript lines are the same for the CLI and the web UI', () => {
  const at = new Date(2026, 10, 9, 14, 3, 5)
  assert.equal(transcriptLine({ name: 'Ana', lang: 'es', original: 'Hola', text: 'Hello' }, at), '- `14:03:05` **Ana**: Hello _(es: Hola)_')
  assert.equal(transcriptLine({ name: 'Ben', lang: 'en', original: 'Hi', text: 'Hi' }, at), '- `14:03:05` **Ben**: Hi')
  assert.equal(transcriptLine({ system: true, text: 'Ana joined (es)' }, at), '- `14:03:05` _Ana joined (es)_')
})
