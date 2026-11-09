import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import createTestnet from 'hyperdht/testnet.js'
import { createUiServer } from '../src/ui-server.js'
import { newRoomCode } from '../src/protocol.js'

function call (url, { method = 'GET', body, headers = {} } = {}) {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, json: () => JSON.parse(data) }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
const post = (url, obj) => call(url, { method: 'POST', body: JSON.stringify(obj), headers: { 'content-type': 'application/json' } })
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** A stream session like QVAC's transcribeStream: write() audio in, iterate text out. */
function fakeStream () {
  const queue = []
  let wake = null
  let ended = false
  const s = {
    written: 0,
    write (buf) { s.written += buf.length },
    end () { ended = true; wake?.() },
    emit (text) { queue.push(text); wake?.() },
    async * [Symbol.asyncIterator] () {
      for (;;) {
        while (queue.length) yield queue.shift()
        if (ended) return
        await new Promise((resolve) => { wake = resolve })
        wake = null
      }
    }
  }
  return s
}

function fakeSdk () {
  const streams = []
  return {
    streams,
    BERGAMOT_ES_EN: { name: 'es-en' },
    BERGAMOT_EN_ES: { name: 'en-es' },
    WHISPER_BASE_Q8_0: { name: 'whisper' },
    WHISPER_EN_BASE_Q8_0: { name: 'whisper-en' },
    VAD_SILERO_5_1_2: { name: 'vad' },
    loadModel: async ({ modelConfig }) => `m-${modelConfig?.from ?? 'asr'}-${modelConfig?.to ?? ''}`,
    unloadModel: async () => {},
    translate: ({ text, to }) => ({ text: Promise.resolve(`[${to}] ${text}`) }),
    transcribeStream: async () => { const s = fakeStream(); streams.push(s); return s }
  }
}

async function withServer (t, opts, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'br-ui-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const uiDir = join(dir, 'dist')
  await mkdir(join(uiDir, 'assets'), { recursive: true })
  await writeFile(join(uiDir, 'index.html'), '<!doctype html><title>Babel Room</title><script type="module" src="/assets/app.js"></script>')
  await writeFile(join(uiDir, 'assets', 'app.js'), 'console.log(1)')
  await writeFile(join(dir, 'secret.txt'), 'not for the browser')
  const ui = createUiServer({ uiDir, ...opts })
  const url = await ui.listen(0)
  try { await fn(url, ui) } finally { await ui.close() }
}

test('serves the build with a strict CSP, and only to local, JSON or audio requests', async (t) => {
  await withServer(t, {}, async (url) => {
    const page = await call(url)
    assert.equal(page.status, 200)
    assert.match(page.headers['content-security-policy'], /script-src 'self';/)
    assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-inline/)
    for (const p of ['../secret.txt', '..%2Fsecret.txt', '%2e%2e/secret.txt']) {
      const r = await call(url + p)
      assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`)
      assert.doesNotMatch(r.body, /not for the browser/)
    }
    const evil = await call(url + 'api/state', { headers: { host: 'evil.example:80' } })
    assert.equal(evil.status, 421)
    const form = await call(url + 'api/room/new', { method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    assert.equal(form.status, 415)
    assert.match((await post(url + 'api/room/new', {})).json().code, /^[a-z]+-[a-z]+-[a-z]+-[a-z]+-\d\d$/)
  })
})

test('join checks its input, and room actions need a room', async (t) => {
  await withServer(t, { loadSdk: async () => fakeSdk(), bootstrap: [] }, async (url) => {
    const state = (await call(url + 'api/state')).json()
    assert.equal(state.qvac, true)
    assert.deepEqual(state.languages, ['en', 'es'])
    assert.equal((await post(url + 'api/room/join', { code: 'abc', name: 'Ana', lang: 'es' })).status, 400)
    assert.equal((await post(url + 'api/room/join', { code: newRoomCode(), name: '', lang: 'es' })).status, 400)
    const bad = await post(url + 'api/room/join', { code: newRoomCode(), name: 'Ana', lang: 'xx' })
    assert.equal(bad.status, 400)
    assert.match(bad.json().error, /can translate/)
    assert.equal((await post(url + 'api/say', { text: 'hola' })).status, 409)
    assert.equal((await post(url + 'api/mic', { on: true })).status, 409)
  })
})

test('two people in one room: captions arrive translated, and the mic feeds Whisper', async (t) => {
  const testnet = await createTestnet(3)
  t.after(() => testnet.destroy())
  const sdkA = fakeSdk()
  const sdkB = fakeSdk()
  const code = newRoomCode()
  await withServer(t, { loadSdk: async () => sdkA, bootstrap: testnet.bootstrap }, async (a) => {
    await withServer(t, { loadSdk: async () => sdkB, bootstrap: testnet.bootstrap }, async (b) => {
      assert.equal((await post(a + 'api/room/join', { code, name: 'Ana', lang: 'es' })).status, 200)
      assert.equal((await post(b + 'api/room/join', { code, name: 'Ben', lang: 'en' })).status, 200)
      await until(async () => (await call(b + 'api/state')).json().room.peers.length === 1)
      const peers = (await call(b + 'api/state')).json().room.peers
      assert.deepEqual(peers.map((p) => [p.name, p.lang]), [['Ana', 'es']])

      // Typed line: shown to Ana as-is, to Ben translated on Ben's side.
      assert.equal((await post(a + 'api/say', { text: 'Hola a todos' })).status, 200)
      const got = await until(async () => (await call(b + 'api/state')).json().lines.find((l) => !l.system && !l.self))
      assert.equal(got.text, '[en] Hola a todos')
      assert.equal(got.original, 'Hola a todos')
      assert.equal(got.route.kind, 'direct')
      const mine = (await call(a + 'api/state')).json().lines.find((l) => l.self)
      assert.equal(mine.text, 'Hola a todos')

      // Microphone: audio goes into Whisper's stream; what it hears is said in the room.
      const on = await post(a + 'api/mic', { on: true })
      assert.equal(on.status, 200)
      assert.equal(on.json().state, 'listening')
      const audio = Buffer.alloc(16000)
      assert.equal((await call(a + 'api/audio', { method: 'POST', body: audio, headers: { 'content-type': 'application/octet-stream' } })).status, 204)
      assert.equal(sdkA.streams[0].written, 16000)
      assert.equal((await call(a + 'api/audio', { method: 'POST', body: Buffer.alloc(7), headers: { 'content-type': 'application/octet-stream' } })).status, 400)
      sdkA.streams[0].emit('¿Me escucháis?')
      await until(async () => (await call(b + 'api/state')).json().lines.some((l) => l.text === '[en] ¿Me escucháis?'))

      // Muted: audio is accepted but not fed to Whisper.
      await post(a + 'api/mic', { on: false })
      await call(a + 'api/audio', { method: 'POST', body: audio, headers: { 'content-type': 'application/octet-stream' } })
      assert.equal(sdkA.streams[0].written, 16000)

      // Transcript has originals next to translations.
      const md = (await call(b + 'api/transcript')).body
      assert.match(md, /\*\*Ana\*\*: \[en\] Hola a todos _\(es: Hola a todos\)_/)

      // Leaving is seen by the other side.
      assert.equal((await post(a + 'api/room/leave', {})).status, 200)
      await until(async () => (await call(b + 'api/state')).json().room.peers.length === 0)
    })
  })
})

test('leaving while Whisper is still loading unloads it and tells the client', async (t) => {
  const sdk = fakeSdk()
  let release
  const unloaded = []
  sdk.loadModel = async ({ modelConfig }) => {
    if (modelConfig?.vadModelSrc) await new Promise((resolve) => { release = resolve })
    return modelConfig?.vadModelSrc ? 'whisper-1' : 'm'
  }
  sdk.unloadModel = async ({ modelId }) => { unloaded.push(modelId) }
  await withServer(t, { loadSdk: async () => sdk, bootstrap: [] }, async (url) => {
    assert.equal((await post(url + 'api/room/join', { code: newRoomCode(), name: 'Ana', lang: 'es' })).status, 200)
    const starting = post(url + 'api/mic', { on: true })
    await until(async () => typeof release === 'function', 5000)
    assert.equal((await post(url + 'api/room/leave', {})).status, 200)
    release()
    const res = await starting
    assert.equal(res.status, 409)
    assert.match(res.json().error, /room changed/)
    await until(async () => unloaded.includes('whisper-1'), 5000)
    assert.equal((await call(url + 'api/state')).json().room, null)
  })
})
