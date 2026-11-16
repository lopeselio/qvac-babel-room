import { EventEmitter } from '#events' // node:events, or bare-events in Bare
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import { Decoder, encode, roomTopic, PROTOCOL } from './protocol.js'

const MAX_PEERS = 32
const RATE_PER_SEC = 20 // captions per second per peer before we drop them
const SLOW_PEER_MS = 15000 // a peer that can't take writes for this long is disconnected
const MAX_QUEUED_BYTES = 256 * 1024 // what we let pile up for a peer whose buffer is full

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
   * @param {{ code: string, name: string, lang: string, bootstrap?: any[], swarm?: Hyperswarm, slowPeerMs?: number }} opts
   */
  constructor ({ code, name, lang, bootstrap, swarm, slowPeerMs = SLOW_PEER_MS }) {
    super()
    this.code = code
    this.name = name
    this.lang = lang
    this.topic = roomTopic(code)
    this.swarm = swarm ?? new Hyperswarm(bootstrap ? { bootstrap, maxPeers: MAX_PEERS } : { maxPeers: MAX_PEERS })
    this.peers = new Map() // id → { conn, name, lang }
    this.seq = 0
    this.slowPeerMs = slowPeerMs
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
    for (const peer of this.peers.values()) { this._resume(peer); peer.conn.end() }
    await this.swarm.destroy()
  }

  _broadcast (msg) {
    const line = encode(msg)
    for (const peer of this.peers.values()) this._send(peer, line)
  }

  // Backpressure: a connection whose buffer is full is "stalled" until it
  // drains. A short burst is still queued for it, up to MAX_QUEUED_BYTES;
  // past that its captions are dropped (they are live, not a log), so one
  // stalled listener can't make us buffer without limit. A peer that stays
  // stalled for slowPeerMs is disconnected.
  _send (peer, line) {
    if (peer.stalled) {
      peer.queued += b4a.byteLength(line)
      if (peer.queued > MAX_QUEUED_BYTES) return false
      peer.conn.write(line)
      return true
    }
    if (peer.conn.write(line) === false) {
      peer.queued = 0
      peer.stalled = setTimeout(() => peer.conn.destroy(), this.slowPeerMs)
    }
    return true
  }

  _onConnection (conn, info) {
    const id = info.publicKey.toString('hex')
    // A second connection to someone already here replaces the first one.
    const prev = this.peers.get(id)
    if (!prev && this.peers.size >= MAX_PEERS) return conn.destroy()
    const peer = { conn, name: prev?.name ?? null, lang: prev?.lang ?? null, hello: false, stalled: null, queued: 0, window: 0, count: 0 }
    this.peers.set(id, peer)
    if (prev) prev.conn.destroy()
    conn.on('error', () => {})
    conn.write(encode({ type: 'hello', protocol: PROTOCOL, name: this.name, lang: this.lang }))

    const decoder = new Decoder({ onAbuse: () => conn.destroy() })
    conn.on('data', (chunk) => {
      for (const msg of decoder.push(chunk)) this._onMessage(id, peer, msg)
    })
    conn.on('drain', () => this._resume(peer))
    conn.on('close', () => {
      this._resume(peer)
      // The close of a replaced connection must not remove its replacement.
      if (this.peers.get(id) !== peer) return
      this.peers.delete(id)
      if (peer.name) this.emit('leave', { id, name: peer.name })
    })
  }

  _resume (peer) {
    clearTimeout(peer.stalled)
    peer.stalled = null
  }

  _onMessage (id, peer, msg) {
    if (msg.type === 'hello') {
      const known = peer.name !== null // already announced, on this connection or the one it replaced
      const langChanged = known && peer.lang !== msg.lang
      peer.hello = true
      peer.name = msg.name
      peer.lang = msg.lang
      if (!known) this.emit('peer', { id, name: peer.name, lang: peer.lang })
      else if (langChanged) this.emit('lang', { id, name: peer.name, lang: peer.lang })
      return
    }
    if (!peer.hello) return // must say hello first, on every connection
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
