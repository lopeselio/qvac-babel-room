// The room, running in a Bare worklet inside the app: the same Room class the
// CLI and the web UI use (Hyperswarm, end-to-end encrypted, no server). It
// talks to the React Native side over BareKit's IPC as newline-delimited JSON:
//
//   app → worklet  { t: 'new' } | { t: 'join', code, name, lang } | { t: 'say', text } | { t: 'lang', lang } | { t: 'leave' }
//   worklet → app  { t: 'code', code } | { t: 'joined', code } | { t: 'peer' | 'left-peer' | 'lang', id, name, lang }
//                  { t: 'caption', id, name, lang, text } | { t: 'left' } | { t: 'error', message }
//
// Only caption text crosses the network; speech recognition and translation
// run in QVAC on the React Native side.

/* global BareKit */
import { Room } from '../../src/room.js'
import { newRoomCode, normalizeRoomCode } from '../../src/protocol.js'
import b4a from 'b4a'

const { IPC } = BareKit
let room = null

const send = (msg) => IPC.write(b4a.from(JSON.stringify(msg) + '\n'))

async function leave () {
  const r = room
  room = null
  if (r) await r.leave()
}

async function handle (msg) {
  switch (msg.t) {
    case 'new':
      return send({ t: 'code', code: newRoomCode() })
    case 'join': {
      await leave()
      const code = normalizeRoomCode(msg.code)
      const r = new Room({ code, name: String(msg.name).slice(0, 40), lang: msg.lang })
      r.on('peer', (p) => send({ t: 'peer', ...p }))
      r.on('leave', (p) => send({ t: 'left-peer', ...p }))
      r.on('lang', (p) => send({ t: 'lang', ...p }))
      r.on('caption', (c) => send({ t: 'caption', id: c.id, name: c.name, lang: c.lang, text: c.text }))
      room = r
      await r.join()
      return send({ t: 'joined', code })
    }
    case 'say':
      return room?.say(String(msg.text))
    case 'lang':
      return room?.setLang(msg.lang)
    case 'leave':
      await leave()
      return send({ t: 'left' })
  }
}

// Split on the newline byte before decoding, so a character split across two
// chunks is never decoded in halves.
let pending = b4a.alloc(0)
IPC.on('data', (chunk) => {
  pending = b4a.concat([pending, chunk])
  let i
  while ((i = pending.indexOf(0x0a)) !== -1) {
    const line = b4a.toString(pending.subarray(0, i))
    pending = pending.subarray(i + 1)
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    handle(msg).catch((err) => send({ t: 'error', message: err.message, for: msg.t }))
  }
})
