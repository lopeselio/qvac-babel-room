// Local web UI for Babel Room.
//
// A small node:http server (no dependencies) that serves one page and a JSON
// API over the same classes the CLI uses: Room (Hyperswarm), Translator
// (Bergamot), Captioner (Whisper + VAD) and BabelSession. The browser only
// captures the microphone and shows captions; speech recognition and
// translation run here, on this device. Each person runs their own server.
//
// Like the other QVAC UIs it only listens on 127.0.0.1, rejects foreign Host
// headers (DNS rebinding), serves a strict CSP and only accepts JSON or raw
// audio POSTs, which a cross-site form can't send without a CORS preflight
// we never answer. Live updates go out as Server-Sent Events.

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { Room } from './room.js'
import { Translator, bergamotLanguages } from './translator.js'
import { Captioner } from './captioner.js'
import { BabelSession } from './session.js'
import { newRoomCode, normalizeRoomCode } from './protocol.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_BODY = 64 * 1024
/** One POST of microphone audio: the page sends ~250 ms (16 KB) at a time. */
const MAX_AUDIO = 256 * 1024
const MAX_LINES = 500
const MAX_TEXT = 1000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8'
}
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const NOT_BUILT = '<!doctype html><meta charset="utf-8"><title>Babel Room</title><p>The web UI isn\'t built yet. Run <code>npm run build:ui</code>, then reload.</p>'

function fail (status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined)
const LANG = /^[a-z]{2,3}$/

/**
 * @param {object} [opts]
 * @param {() => Promise<any>} [opts.loadSdk] returns @qvac/sdk (tests pass a fake)
 * @param {string} [opts.uiDir] the React build (ui/dist)
 * @param {any[]} [opts.bootstrap] DHT bootstrap nodes (tests use a local testnet)
 * @param {string} [opts.asrSize] Whisper size: tiny | base | small
 * @param {(m: string) => void} [opts.log]
 */
export function createUiServer ({ loadSdk, uiDir = join(ROOT, 'ui', 'dist'), bootstrap, asrSize = 'base', log = () => {} } = {}) {
  const uiRoot = resolve(uiDir)
  let sdkPromise = null
  /** The room you're in: { code, name, lang, allowLlm, room, translator, session } */
  let current = null
  let captioner = null
  let mic = { on: false, state: 'off', model: null, download: null, error: null }
  const models = new Map() // `${from}>${to}` → { state, kind, download }
  let lines = []
  let closing = false
  const clients = new Set()
  let work = Promise.resolve() // joins, leaves and language changes run one at a time

  const serial = (fn) => {
    const p = work.then(fn)
    work = p.catch(() => {})
    return p
  }

  function sdk () {
    if (!loadSdk) throw fail(503, "QVAC isn't available in this session (started without the SDK).")
    sdkPromise ??= loadSdk().catch((err) => { sdkPromise = null; throw fail(503, `Could not load @qvac/sdk: ${err.message}`) })
    return sdkPromise
  }

  // ---------- live events ----------

  function emit (event) {
    const data = `data: ${JSON.stringify(event)}\n\n`
    for (const res of clients) res.write(data)
  }

  function roomView () {
    if (!current) return null
    return { code: current.code, name: current.name, lang: current.lang, allowLlm: current.allowLlm, peers: current.room.peerList }
  }

  function modelsView () {
    return [...models.entries()].map(([key, m]) => ({ key, ...m }))
  }

  function snapshot () {
    return { type: 'state', room: roomView(), mic, models: modelsView(), lines }
  }

  function pushLine (line) {
    lines.push(line)
    if (lines.length > MAX_LINES) lines = lines.slice(-MAX_LINES)
    emit({ type: 'line', line })
  }

  function onTranslatorStatus (s) {
    const key = `${s.from}>${s.to}`
    const m = models.get(key) ?? { state: 'loading', kind: s.route?.kind ?? null, download: null }
    if (s.type === 'loading') Object.assign(m, { state: 'loading', kind: s.route?.kind ?? m.kind })
    if (s.type === 'download') Object.assign(m, { state: 'downloading', download: Math.floor(s.percentage ?? 0) })
    if (s.type === 'ready') Object.assign(m, { state: 'ready', kind: s.route?.kind ?? m.kind, download: null })
    models.set(key, m)
    emit({ type: 'models', models: modelsView() })
  }

  function setMic (patch) {
    mic = { ...mic, ...patch }
    emit({ type: 'mic', mic })
  }

  // ---------- room ----------

  async function join (body) {
    notClosing()
    const code = str(body.code, 200)?.trim()
    let normalized
    try { normalized = normalizeRoomCode(code ?? '') } catch (err) { throw fail(400, err.message) }
    const name = str(body.name, 40)?.trim()
    if (!name) throw fail(400, 'Add your name (up to 40 characters).')
    const lang = str(body.lang, 3)?.toLowerCase()
    if (!lang || !LANG.test(lang)) throw fail(400, 'Pick the language you speak.')
    const s = await sdk()
    if (!bergamotLanguages(s).includes(lang)) throw fail(400, `${lang} isn't a language this QVAC build can translate.`)
    return serial(async () => {
      await leaveNow()
      const translator = new Translator({ sdk: s, target: lang, allowLlm: body.allowLlm === true, onStatus: onTranslatorStatus })
      const room = new Room({ code: normalized, name, lang, bootstrap })
      const session = new BabelSession({ room, translator })
      session.on('line', pushLine)
      session.on('system', (m) => { pushLine({ system: true, text: m.message, at: new Date().toISOString() }); emit({ type: 'room', room: roomView() }) })
      session.on('error', (err) => log(`session error: ${err.message}`))
      current = { code: normalized, name, lang, allowLlm: body.allowLlm === true, room, translator, session }
      lines = []
      models.clear()
      await room.join()
      emit(snapshot())
      return roomView()
    })
  }

  async function leaveNow () {
    const c = current
    current = null
    await stopMic()
    if (c) await c.session.close().catch((err) => log(`leave: ${err.message}`))
    models.clear()
  }

  function requireRoom () {
    if (!current) throw fail(409, 'Join a room first.')
    return current
  }

  async function setLang (body) {
    const lang = str(body.lang, 3)?.toLowerCase()
    if (!lang || !LANG.test(lang)) throw fail(400, 'Pick a language.')
    const s = await sdk()
    if (!bergamotLanguages(s).includes(lang)) throw fail(400, `${lang} isn't a language this QVAC build can translate.`)
    return serial(async () => {
      const c = requireRoom()
      if (c.lang === lang) return roomView()
      const wasOn = mic.on
      await stopMic() // Whisper is loaded for one language
      c.lang = lang
      c.session.setLang(lang)
      emit({ type: 'room', room: roomView() })
      if (wasOn) void startMic().catch(() => {})
      return roomView()
    })
  }

  // ---------- microphone ----------

  async function startMic () {
    const c = requireRoom()
    const s = await sdk()
    if (!captioner) {
      captioner = new Captioner({ sdk: s, lang: c.lang, size: asrSize })
      captioner.on('text', (text) => current?.session.say(text))
      captioner.on('error', (err) => setMic({ state: 'error', error: err.message }))
      captioner.on('status', (st) => {
        if (st.type === 'loading') setMic({ state: 'loading', model: st.model })
        if (st.type === 'download') setMic({ state: 'downloading', model: st.model, download: Math.floor(st.percentage ?? 0) })
        if (st.type === 'ready') setMic({ state: 'listening', model: st.model, download: null })
      })
    }
    setMic({ on: true, error: null, state: captioner.modelId ? 'listening' : 'loading' })
    try {
      await captioner.startPush()
      captioner.mute(false)
      setMic({ state: 'listening' })
    } catch (err) {
      setMic({ on: false, state: 'error', error: err.message })
      throw fail(503, `Couldn't start speech recognition: ${err.message}`)
    }
  }

  async function stopMic () {
    const cap = captioner
    captioner = null
    setMic({ on: false, state: 'off', download: null })
    if (cap) await cap.stop().catch(() => {})
  }

  /** Mute keeps Whisper loaded so turning the mic back on is instant. */
  function muteMic () {
    captioner?.mute(true)
    setMic({ on: false, state: captioner ? 'muted' : 'off' })
  }

  // ---------- transcript ----------

  function transcript () {
    const c = current
    const head = c ? `# Babel Room ${c.code}\n\nYou: ${c.name} (${c.lang})\n\n` : '# Babel Room\n\n'
    return head + lines.map((l) => {
      const t = new Date(l.at).toTimeString().slice(0, 8)
      if (l.system) return `- \`${t}\` _${l.text}_`
      const extra = l.original !== l.text ? ` _(${l.lang}: ${l.original})_` : ''
      return `- \`${t}\` **${l.name}**: ${l.text}${extra}`
    }).join('\n') + '\n'
  }

  // ---------- http ----------

  function notClosing () { if (closing) throw fail(503, 'Babel Room is shutting down.') }

  function send (res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    res.writeHead(status, {
      'content-type': type,
      'cache-control': extra.cache ?? 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...(type.startsWith('text/html') ? { 'content-security-policy': CSP } : {}),
      ...(extra.headers ?? {})
    })
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
  }

  /** Files from the React build. Anything that resolves outside it is a 404. */
  async function staticFile (res, pathname) {
    let rel
    try { rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname) } catch { return send(res, 400, { error: 'bad path' }) }
    const file = resolve(uiRoot, '.' + rel)
    if (!file.startsWith(uiRoot + sep) || rel.includes('\0')) return send(res, 404, { error: 'not found' })
    try {
      const body = await readFile(file)
      const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store'
      return send(res, 200, body, MIME[extname(file)] ?? 'application/octet-stream', { cache })
    } catch {
      if (rel === '/index.html') return send(res, 503, NOT_BUILT, 'text/html; charset=utf-8')
      return send(res, 404, { error: 'not found' })
    }
  }

  async function readBody (req, type, limit) {
    if (!String(req.headers['content-type'] ?? '').startsWith(type)) throw fail(415, `expected ${type}`)
    let size = 0
    const chunks = []
    for await (const c of req) {
      size += c.length
      if (size > limit * 4) { req.destroy(); throw fail(413, 'request too large') }
      if (size <= limit) chunks.push(c)
    }
    if (size > limit) throw fail(413, 'request too large')
    return Buffer.concat(chunks)
  }

  async function readJson (req) {
    const body = await readBody(req, 'application/json', MAX_BODY)
    try { return JSON.parse(body.toString('utf8')) ?? {} } catch { throw fail(400, 'invalid JSON') }
  }

  function events (req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      connection: 'keep-alive'
    })
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`)
    clients.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 20000)
    req.on('close', () => { clearInterval(ping); clients.delete(res) })
  }

  const server = createServer(async (req, res) => {
    try {
      const { port } = server.address()
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(res, 421, { error: 'unexpected Host header' })
      const url = new URL(req.url, `http://127.0.0.1:${port}`)
      const p = url.pathname
      if (req.method === 'GET') {
        if (p === '/api/state') {
          const s = loadSdk ? await sdk().catch(() => null) : null
          return send(res, 200, { qvac: !!s, languages: s ? bergamotLanguages(s) : [], ...snapshot() })
        }
        if (p === '/api/events') return events(req, res)
        if (p === '/api/transcript') {
          return send(res, 200, transcript(), 'text/markdown; charset=utf-8', {
            headers: { 'content-disposition': `attachment; filename="babel-room-${current?.code ?? 'transcript'}.md"` }
          })
        }
        if (!p.startsWith('/api/')) return await staticFile(res, p)
      }
      if (req.method === 'POST') {
        if (p === '/api/audio') {
          const buf = await readBody(req, 'application/octet-stream', MAX_AUDIO)
          if (buf.length % 4) throw fail(400, 'audio must be 32-bit float samples')
          if (mic.on) captioner?.push(buf)
          return send(res, 204, '')
        }
        const body = await readJson(req)
        if (p === '/api/room/new') return send(res, 200, { code: newRoomCode() })
        if (p === '/api/room/join') return send(res, 200, await join(body))
        if (p === '/api/room/leave') { await serial(leaveNow); emit(snapshot()); return send(res, 200, { ok: true }) }
        if (p === '/api/say') {
          const text = str(body.text, MAX_TEXT)?.trim()
          if (!text) throw fail(400, `Type something (up to ${MAX_TEXT} characters).`)
          requireRoom().session.say(text)
          return send(res, 200, { ok: true })
        }
        if (p === '/api/lang') return send(res, 200, await setLang(body))
        if (p === '/api/mic') {
          notClosing()
          requireRoom()
          if (body.on === true) await startMic(); else muteMic()
          return send(res, 200, mic)
        }
      }
      return send(res, 404, { error: 'not found' })
    } catch (err) {
      if (res.headersSent) return res.end()
      if (!err.status) log(`error: ${err.stack ?? err.message}`)
      return send(res, err.status ?? 500, { error: err.status ? err.message : 'internal error' })
    }
  })

  return {
    server,
    /** Listen on 127.0.0.1 only. Resolves to the URL. */
    listen (port = 4400) {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`))
      })
    },
    async close () {
      closing = true
      await serial(leaveNow)
      for (const res of clients) res.end()
      clients.clear()
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
