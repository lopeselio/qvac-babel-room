import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { ensureFits } from './fit.js'
import { retryLocked } from './util.js'

export const SAMPLE_RATE = 16000

// QVAC ships language-specialised Whisper fine-tunes for some languages;
// they beat the multilingual model at the same size.
const LANG_MODEL_NAME = {
  fr: 'FRENCH', de: 'GERMAN', it: 'ITALIAN', ja: 'JAPANESE', pt: 'PORTUGUESE',
  ru: 'RUSSIAN', es: 'SPANISH', nb: 'NORWEGIAN', no: 'NORWEGIAN'
}

/**
 * @param {string} lang
 * @param {'tiny'|'base'|'small'} size
 * @param {Record<string, any>} sdk
 * @returns {string} SDK constant name
 */
export function pickAsrModel (lang, size, sdk) {
  const S = size.toUpperCase()
  const candidates = []
  if (lang === 'en') candidates.push(`WHISPER_EN_${S}_Q8_0`)
  if (LANG_MODEL_NAME[lang]) candidates.push(`WHISPER_${LANG_MODEL_NAME[lang]}_${S}_Q8_0`, `WHISPER_${LANG_MODEL_NAME[lang]}_${S}`)
  candidates.push(`WHISPER_${S}_Q8_0`, 'WHISPER_BASE_Q8_0', 'WHISPER_TINY_Q8_0')
  const hit = candidates.find((c) => sdk[c])
  if (!hit) throw new Error(`No Whisper model available for ${lang}/${size}`)
  return hit
}

// Whisper hallucinates stock phrases from silence and noise. Drop those.
const PHANTOMS = new Set([
  'you', 'thank you', 'thanks for watching', 'thank you for watching', 'bye', '.', 'gracias',
  'merci', 'danke', 'grazie', 'obrigado', 'subtitles by the amara.org community', 'untertitel im auftrag des zdf'
])

export function cleanTranscript (raw) {
  const t = String(raw ?? '')
    .replace(/\[(?:no speech detected|blank_audio|music|silence|inaudible)\]/gi, '')
    .replace(/\((?:music|silence|applause|laughter)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length < 2) return ''
  if (PHANTOMS.has(t.toLowerCase().replace(/[.!?¡¿,]+/g, '').trim())) return ''
  return t
}

/** ffmpeg args that read the default microphone as mono f32le @16 kHz. */
export function micArgs (platform = process.platform, device) {
  const out = ['-hide_banner', '-loglevel', 'error', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1']
  if (platform === 'darwin') return ['-f', 'avfoundation', '-i', device ?? ':0', ...out]
  if (platform === 'win32') return ['-f', 'dshow', '-i', `audio=${device ?? 'default'}`, ...out]
  return ['-f', 'pulse', '-i', device ?? 'default', ...out]
}

/** ffmpeg args that decode any audio file to the same format, at real-time speed. */
export function fileArgs (file) {
  return ['-hide_banner', '-loglevel', 'error', '-re', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1']
}

/**
 * Speech → text for one speaker, fully on-device.
 * Emits 'text' (string) for each finished utterance and 'status' for model loading.
 */
export class Captioner extends EventEmitter {
  constructor ({ sdk, lang, size = 'base', spawnFn = spawn, force = false }) {
    super()
    this.force = force
    this.sdk = sdk
    this.lang = lang
    this.size = size
    this.spawn = spawnFn
    this.modelId = null
    this.session = null
    this.proc = null
    this.muted = false
  }

  async load () {
    const name = pickAsrModel(this.lang, this.size, this.sdk)
    const modelConfig = {
      vadModelSrc: this.sdk.VAD_SILERO_5_1_2,
      audio_format: 'f32le',
      strategy: 'greedy',
      language: this.lang,
      no_timestamps: true,
      suppress_blank: true,
      suppress_nst: true,
      temperature: 0,
      // Conservative VAD: fewer phantom captions from room noise.
      vad_params: { threshold: 0.6, min_speech_duration_ms: 300, min_silence_duration_ms: 600, max_speech_duration_s: 12, speech_pad_ms: 200 }
    }
    const fit = await ensureFits(this.sdk, [{ modelSrc: this.sdk[name], modelType: 'whispercpp-transcription', modelConfig }], { force: this.force })
    this.emit('status', { type: 'fit', model: name, fit })
    this.emit('status', { type: 'loading', model: name })
    this.modelId = await retryLocked(() => this.sdk.loadModel({
      modelSrc: this.sdk[name],
      modelConfig,
      onProgress: (p) => this.emit('status', { type: 'download', model: name, percentage: p.percentage })
    }))
    this.emit('status', { type: 'ready', model: name })
    return this
  }

  /**
   * Start listening. `source` is 'mic' (default) or a path to an audio file.
   */
  async start ({ source = 'mic', device } = {}) {
    if (!this.modelId) await this.load()
    this.session = await this.sdk.transcribeStream({ modelId: this.modelId })
    const args = source === 'mic' ? micArgs(process.platform, device) : fileArgs(source)
    this.proc = this.spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc.on('error', (err) => this.emit('error', new Error(`Could not start ffmpeg (${err.message}). Install ffmpeg and allow microphone access.`)))
    let stderr = ''
    this.proc.stderr?.on('data', (d) => { stderr += d })
    this.proc.stdout.on('data', (chunk) => {
      if (!this.muted) this.session.write(chunk)
    })
    this.proc.on('close', (code) => {
      if (code && code !== 255) this.emit('error', new Error(`ffmpeg exited with ${code}: ${stderr.trim().slice(0, 300)}`))
      try { this.session?.end() } catch {}
    })
    this._pump()
    return this
  }

  /**
   * Start a streaming session fed by push() instead of ffmpeg: the web UI
   * sends the browser's microphone as mono f32le @16 kHz.
   */
  startPush () {
    // Concurrent callers share one start, so Whisper is loaded once.
    this._starting ??= (async () => {
      if (!this.modelId) await this.load()
      if (!this.session) {
        this.session = await this.sdk.transcribeStream({ modelId: this.modelId })
        this._pump()
      }
      return this
    })().finally(() => { this._starting = null })
    return this._starting
  }

  /** Feed raw mono f32le @16 kHz audio to a session started with startPush(). */
  push (chunk) {
    if (this.session && !this.muted) this.session.write(chunk)
  }

  async _pump () {
    try {
      for await (const raw of this.session) {
        const text = cleanTranscript(typeof raw === 'string' ? raw : raw?.text)
        if (text) this.emit('text', text)
      }
      this.emit('end')
    } catch (err) {
      this.emit('error', err)
    }
  }

  mute (on = true) { this.muted = on }

  async stop () {
    this.proc?.kill()
    try { this.session?.end() } catch {}
    this.session = null
    if (this.modelId) await this.sdk.unloadModel({ modelId: this.modelId, clearStorage: false }).catch(() => {})
    this.modelId = null
  }
}
