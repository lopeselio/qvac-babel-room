// The room, running in a Bare worklet inside the app: the same Room class the
// CLI and the web UI use (Hyperswarm, end-to-end encrypted, no server). It
// talks to the React Native side over BareKit's IPC as newline-delimited JSON:
//
//   app → worklet  { t: 'new' | 'join' | 'say' | 'leave', rid?, ... }
//   worklet → app  { t: 'code' | 'joined' | 'left', rid } replies, { t: 'error', rid, message },
//                  and events: { t: 'peer' | 'left-peer' | 'lang', id, name, lang }, { t: 'caption', id, name, lang, text }
//
// Requests carry an id (rid) that the reply echoes, so a late reply can never
// settle a newer request. Messages are handled strictly one at a time.
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
      return send({ t: 'code', rid: msg.rid, code: newRoomCode() })
    case 'join': {
      await leave()
      const code = normalizeRoomCode(msg.code)
      const r = new Room({ code, name: String(msg.name).slice(0, 40), lang: msg.lang })
      r.on('peer', (p) => { if (room === r) send({ t: 'peer', ...p }) })
      r.on('leave', (p) => { if (room === r) send({ t: 'left-peer', ...p }) })
      r.on('lang', (p) => { if (room === r) send({ t: 'lang', ...p }) })
      r.on('caption', (c) => { if (room === r) send({ t: 'caption', id: c.id, name: c.name, lang: c.lang, text: c.text }) })
      try {
        await r.join()
      } catch (err) {
        // Never keep a half-joined swarm announcing you on the topic.
        await r.leave().catch(() => {})
        throw err
      }
      room = r
      return send({ t: 'joined', rid: msg.rid, code })
    }
    case 'say':
      return room?.say(String(msg.text))
    case 'lang':
      return room?.setLang(msg.lang)
    case 'leave':
      await leave()
      return send({ t: 'left', rid: msg.rid })
  }
}

// One message at a time: a 'leave' can't run in the middle of a 'join'.
let queue = Promise.resolve()

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
    queue = queue.then(() => handle(msg)).catch((err) => send({ t: 'error', rid: msg.rid, message: err.message }))
  }
})
