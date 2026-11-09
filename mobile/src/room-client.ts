import { Worklet } from 'react-native-bare-kit'
import { LineReader, utf8Encode } from './lines'

// Runs worklet/room.mjs (Babel Room's Hyperswarm room, in Bare) and talks to it
// over IPC as newline-delimited JSON. See that file for the messages.

export type FromRoom =
  | { t: 'code', code: string }
  | { t: 'joined', code: string }
  | { t: 'left' }
  | { t: 'peer' | 'left-peer' | 'lang', id: string, name: string, lang: string }
  | { t: 'caption', id: string, name: string, lang: string, text: string }
  | { t: 'error', message: string, for?: string }

// Built by `npm run worklet` (bare-pack); a string module like QVAC's worker bundle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundle: string = require('../worklet/room.bundle.js')

export class RoomClient {
  private worklet = new Worklet()
  private reader = new LineReader()
  private listeners = new Set<(m: FromRoom) => void>()

  constructor () {
    this.worklet.start('/room.bundle', bundle)
    this.worklet.IPC.on('data', (data) => {
      const chunk = data as Uint8Array
      for (const m of this.reader.push(new Uint8Array(chunk))) for (const l of this.listeners) l(m as FromRoom)
    })
  }

  on (fn: (m: FromRoom) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  send (msg: object) {
    this.worklet.IPC.write(utf8Encode(JSON.stringify(msg) + '\n'))
  }

  /** Send and wait for the reply of type `expect` (or the error for this request). */
  request<T extends FromRoom['t']> (msg: { t: string } & Record<string, unknown>, expect: T, timeoutMs = 30000): Promise<Extract<FromRoom, { t: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('The room network did not answer. Check your connection and try again.')) }, timeoutMs)
      const off = this.on((m) => {
        if (m.t === expect) { clearTimeout(timer); off(); resolve(m as Extract<FromRoom, { t: T }>) }
        if (m.t === 'error' && m.for === msg.t) { clearTimeout(timer); off(); reject(new Error(m.message)) }
      })
      this.send(msg)
    })
  }
}
