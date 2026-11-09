// Browser microphone → 16 kHz mono float32 → the local server, which feeds
// QVAC Whisper (with voice activity detection) on this device. Audio goes no
// further than 127.0.0.1; only the caption text is sent to peers.

import { api } from './api'

const RATE = 16000
const BATCH = RATE / 4 // send ~250 ms at a time

/** Linear-interpolation resampler that keeps its position across blocks. */
class Resampler {
  private pos = 0
  private last = 0
  constructor (private readonly ratio: number) {}
  push (input: Float32Array): Float32Array {
    const out: number[] = []
    // `pos` is where the next output sample falls, relative to input[0] (-1 = the previous block's last sample).
    while (this.pos < input.length - 1) {
      const i = Math.floor(this.pos)
      const frac = this.pos - i
      const a = i < 0 ? this.last : input[i]
      const b = input[i + 1]
      out.push(a + (b - a) * frac)
      this.pos += this.ratio
    }
    this.pos -= input.length
    this.last = input[input.length - 1] ?? 0
    return Float32Array.from(out)
  }
}

export class Mic {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private pending: Float32Array[] = []
  private pendingLength = 0
  private sending = Promise.resolve()

  constructor (private readonly onLevel: (level: number) => void, private readonly onError: (err: Error) => void) {}

  async start () {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone access here.')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch {
      throw new Error('Microphone permission was denied. Allow it in the address bar, then try again.')
    }
    this.ctx = new AudioContext()
    await this.ctx.audioWorklet.addModule('/pcm-worklet.js')
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture')
    const resampler = new Resampler(this.ctx.sampleRate / RATE)
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const block = e.data
      let sum = 0
      for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
      this.onLevel(Math.min(1, Math.sqrt(sum / block.length) * 6))
      this.queue(resampler.push(block))
    }
    // A silent sink keeps the graph pulling samples through the worklet.
    const sink = this.ctx.createGain()
    sink.gain.value = 0
    source.connect(this.node).connect(sink).connect(this.ctx.destination)
  }

  private queue (samples: Float32Array) {
    if (!samples.length) return
    this.pending.push(samples)
    this.pendingLength += samples.length
    if (this.pendingLength < BATCH) return
    const batch = new Float32Array(this.pendingLength)
    let at = 0
    for (const p of this.pending) { batch.set(p, at); at += p.length }
    this.pending = []
    this.pendingLength = 0
    // One request at a time, in order.
    this.sending = this.sending.then(() => api.audio(batch)).catch((err) => this.onError(err as Error))
  }

  async stop () {
    this.node?.port.close()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close().catch(() => {})
    this.ctx = null
    this.stream = null
    this.node = null
    this.pending = []
    this.pendingLength = 0
    this.onLevel(0)
  }
}
