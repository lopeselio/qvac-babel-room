#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline'
import { hostname, userInfo } from 'node:os'
import { resolve } from 'node:path'
import {
  Room, Translator, Captioner, BabelSession, newRoomCode, normalizeRoomCode, bergamotLanguages, describeFit
} from '../src/index.js'

const HELP = `babel-room — live captions across languages, peer-to-peer, fully on-device

Usage:
  babel-room new                                  print a fresh room code
  babel-room join <code> --lang <xx> [options]    join a room
  babel-room languages                            list supported languages

Join options:
  --name <you>        display name (default: your user name)
  --lang <xx>         the language you speak and want to read (ISO 639-1, e.g. en, es, de)
  --mic               caption your microphone (needs ffmpeg)
  --device <id>       microphone device for ffmpeg (macOS ":0", Linux pulse source)
  --file <audio>      caption an audio file instead of the mic (demo/testing)
  --asr <size>        whisper size: tiny | base (default) | small
  --llm               allow a 2B multilingual LLM for pairs Bergamot can't do
  --transcript <md>   append everything to a Markdown transcript
  --original          also show the original text under each translation
  --force             load models even if the memory check says they won't fit

While in a room: type to send a line, or use /lang <xx>, /peers, /mute, /unmute, /quit.
Audio never leaves your device; only your caption text is sent, end-to-end encrypted, to peers.
`

const c = process.stdout.isTTY
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m` }
  : { dim: (s) => s, bold: (s) => s, cyan: (s) => s, yellow: (s) => s, green: (s) => s }

const COLORS = [31, 32, 33, 34, 35, 36, 91, 92, 93, 94, 95, 96]
const colorFor = (name) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0
  const code = COLORS[h % COLORS.length]
  return process.stdout.isTTY ? (s) => `\x1b[${code}m${s}\x1b[0m` : (s) => s
}

async function loadSdk () {
  try {
    return await import('@qvac/sdk')
  } catch (err) {
    throw new Error(`Could not load @qvac/sdk (${err.message}). Run \`npm install\`.`)
  }
}

async function main (argv) {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      lang: { type: 'string', short: 'l' },
      mic: { type: 'boolean' },
      device: { type: 'string' },
      file: { type: 'string' },
      asr: { type: 'string' },
      llm: { type: 'boolean' },
      transcript: { type: 'string' },
      original: { type: 'boolean' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })
  const [cmd, code] = positionals
  if (v.help || !cmd) return process.stdout.write(HELP)

  if (cmd === 'new') {
    const fresh = newRoomCode()
    console.log(fresh)
    console.error(c.dim(`Share it, then: babel-room join ${fresh} --lang <xx> --mic`))
    return
  }

  if (cmd === 'languages') {
    const sdk = await loadSdk()
    const langs = bergamotLanguages(sdk)
    console.log(`${langs.length} languages via Bergamot (any pair, pivoting through English):\n${langs.join(' ')}`)
    console.log(c.dim('More pairs with --llm (SalamandraTA 2B).'))
    process.exit(0)
  }

  if (cmd !== 'join') throw new Error(`Unknown command "${cmd}". Run babel-room --help.`)
  if (!code) throw new Error('usage: babel-room join <code> --lang <xx>')
  normalizeRoomCode(code)
  const lang = (v.lang ?? '').toLowerCase()
  if (!/^[a-z]{2,3}$/.test(lang)) throw new Error('Pass --lang with an ISO 639-1 code, e.g. --lang en')
  const name = (v.name ?? userInfo().username ?? hostname()).slice(0, 40)
  const asrSize = v.asr ?? 'base'
  if (!['tiny', 'base', 'small'].includes(asrSize)) throw new Error('--asr must be tiny, base or small')

  const sdk = await loadSdk()
  const status = (s) => {
    if (s.type === 'fit') for (const l of describeFit(s.fit)) console.error(c.dim(`▸ memory check: ${l}`))
    if (s.type === 'loading') console.error(c.dim(`▸ loading ${s.model ?? `${s.from}→${s.to} (${s.route?.kind})`}`))
    if (s.type === 'ready' && s.model) console.error(c.dim(`▸ ${s.model} ready`))
  }
  const translator = new Translator({ sdk, target: lang, allowLlm: v.llm, onStatus: status, force: v.force })
  const room = new Room({ code, name, lang })
  let captioner = null
  if (v.mic || v.file) {
    captioner = new Captioner({ sdk, lang, size: asrSize, force: v.force })
    captioner.on('status', status)
  }
  const session = new BabelSession({ room, translator, captioner, transcriptPath: v.transcript ? resolve(v.transcript) : null })

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '' })
  const print = (s) => {
    // Print above the input line without clobbering what the user is typing.
    process.stdout.write('\r\x1b[K' + s + '\n')
    rl.prompt(true)
  }

  session.on('line', (l) => {
    const who = colorFor(l.name)(l.self ? `${l.name} (you)` : l.name)
    const tag = l.route.kind === 'untranslated' ? c.yellow(` [${l.lang}, untranslated]`) : l.lang !== lang ? c.dim(` [${l.lang}→${lang}]`) : ''
    print(`${c.dim(new Date(l.at).toLocaleTimeString())} ${c.bold(who)}${tag}: ${l.text}`)
    if (v.original && l.original !== l.text) print(c.dim(`           ${l.original}`))
  })
  session.on('system', ({ message }) => print(c.cyan(`• ${message}`)))
  session.on('error', (err) => print(c.yellow(`⚠ ${err.message}`)))

  console.error(c.dim(`▸ joining ${code} as ${name} (${lang})…`))
  await room.join()
  print(c.green(`✔ in room — ${room.peerList.length} other(s) here. Type to talk${captioner ? ', or just speak' : ''}. /quit to leave.`))

  if (captioner) {
    await captioner.start(v.file ? { source: resolve(v.file) } : { device: v.device })
    print(c.dim(`▸ captioning ${v.file ? v.file : 'microphone'} with whisper-${asrSize}`))
  }

  let closing = false
  const quit = async () => {
    if (closing) return
    closing = true
    print(c.dim('▸ leaving…'))
    rl.close()
    await session.close().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', quit)

  rl.on('line', (line) => {
    const t = line.trim()
    process.stdout.write('\x1b[1A\r\x1b[K') // replace the echoed input with the formatted line
    if (!t) return
    if (t === '/quit' || t === '/exit') return quit()
    if (t === '/peers') {
      const list = room.peerList.map((p) => `${p.name} (${p.lang})`).join(', ') || 'nobody yet'
      return print(c.cyan(`• peers: ${list}`))
    }
    if (t === '/mute' || t === '/unmute') {
      if (!captioner) return print(c.yellow('⚠ not captioning; start with --mic'))
      captioner.mute(t === '/mute')
      return print(c.cyan(`• microphone ${t === '/mute' ? 'muted' : 'live'}`))
    }
    const m = t.match(/^\/lang\s+([a-z]{2,3})$/i)
    if (m) {
      session.setLang(m[1].toLowerCase())
      return print(c.cyan(`• you now read and write ${m[1].toLowerCase()}${captioner ? ' (restart to switch speech recognition language)' : ''}`))
    }
    if (t.startsWith('/')) return print(c.yellow('⚠ commands: /lang <xx>, /peers, /mute, /unmute, /quit'))
    session.say(t)
  })
  rl.on('close', quit)
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`✖ ${err.message}`)
  process.exit(1)
})
