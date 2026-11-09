import { EventEmitter } from '#events' // node:events, or bare-events in Bare
import Hyperswarm from 'hyperswarm'
import { Decoder, encode, roomTopic, PROTOCOL } from './protocol.js'

const MAX_PEERS = 32
const RATE_PER_SEC = 20 // captions per second per peer before we drop them

/**
 * A room is everyone who joined the same topic. There is no server and no
 * host: each peer keeps a direct, end-to-end encrypted connection to every
 * other peer and broadcasts its own captions.
 *
 * Events:
 *   'peer'    ({ id, name, lang })           a peer said hello
 *   'leave'   ({ id, name })                 a peer disconnected
 *   'caption' ({ id, name, lang, text, seq, final })
 *   'lang'    ({ id, name, lang })           a peer changed language
 */
export class Room extends EventEmitter {
  /**
   * @param {{ code: string, name: string, lang: string, bootstrap?: any[], swarm?: Hyperswarm }} opts
   */
  constructor ({ code, name, lang, bootstrap, swarm }) {
    super()
    this.code = code
    this.name = name
    this.lang = lang
    this.topic = roomTopic(code)
    this.swarm = swarm ?? new Hyperswarm(bootstrap ? { bootstrap, maxPeers: MAX_PEERS } : { maxPeers: MAX_PEERS })
    this.peers = new Map() // id → { conn, name, lang }
    this.seq = 0
    this._onConnection = this._onConnection.bind(this)
    this.swarm.on('connection', this._onConnection)
  }

  async join () {
    const discovery = this.swarm.join(this.topic, { server: true, client: true })
    await discovery.flushed()
    return this
  }

  get peerList () {
    return [...this.peers.entries()].filter(([, p]) => p.name).map(([id, p]) => ({ id, name: p.name, lang: p.lang }))
  }

  /** Send one of *your* captions to everyone. */
  say (text, { final = true } = {}) {
    const msg = { type: 'caption', seq: this.seq++, lang: this.lang, text, final }
    this._broadcast(msg)
    return msg
  }

  setLang (lang) {
    this.lang = lang
    this._broadcast({ type: 'lang', lang })
  }

  async leave () {
    this.swarm.off('connection', this._onConnection)
    for (const { conn } of this.peers.values()) conn.end()
    await this.swarm.destroy()
  }

  _broadcast (msg) {
    const line = encode(msg)
    for (const { conn } of this.peers.values()) conn.write(line)
  }

  _onConnection (conn, info) {
    const id = info.publicKey.toString('hex')
    if (this.peers.size >= MAX_PEERS) return conn.destroy()
    const peer = { conn, name: null, lang: null, window: 0, count: 0 }
    this.peers.set(id, peer)
    conn.on('error', () => {})
    conn.write(encode({ type: 'hello', protocol: PROTOCOL, name: this.name, lang: this.lang }))

    const decoder = new Decoder({ onAbuse: () => conn.destroy() })
    conn.on('data', (chunk) => {
      for (const msg of decoder.push(chunk)) this._onMessage(id, peer, msg)
    })
    conn.on('close', () => {
      this.peers.delete(id)
      if (peer.name) this.emit('leave', { id, name: peer.name })
    })
  }

  _onMessage (id, peer, msg) {
    if (msg.type === 'hello') {
      const first = !peer.name
      peer.name = msg.name
      peer.lang = msg.lang
      if (first) this.emit('peer', { id, name: peer.name, lang: peer.lang })
      return
    }
    if (!peer.name) return // must say hello first
    if (msg.type === 'lang') {
      peer.lang = msg.lang
      this.emit('lang', { id, name: peer.name, lang: msg.lang })
      return
    }
    if (msg.type === 'caption') {
      const now = Math.floor(Date.now() / 1000)
      if (peer.window !== now) { peer.window = now; peer.count = 0 }
      if (++peer.count > RATE_PER_SEC) return
      this.emit('caption', { id, name: peer.name, lang: msg.lang, text: msg.text, seq: msg.seq, final: msg.final })
    }
  }
}
