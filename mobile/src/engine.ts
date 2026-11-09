import * as qvac from '@qvac/sdk'
// The same, Node-free modules the CLI and the web UI use (bundled from ../src by Metro).
import { Translator, bergamotLanguages } from '../../src/translator.js'
import { pickAsrModel, cleanTranscript } from '../../src/asr.js'

// QVAC on the phone: Whisper turns your recording into text, Bergamot
// translates everyone else's captions into your language. Both run here.

const sdk = qvac as unknown as Record<string, any>

export const languages = (): string[] => bergamotLanguages(sdk)

export interface ModelStatus { key: string, state: 'loading' | 'downloading' | 'ready', kind: string | null, download: number | null }

export type TranslatorStatus = { type: string, from: string, to: string, route?: { kind: string }, percentage?: number }

export function makeTranslator (target: string, onStatus: (s: TranslatorStatus) => void) {
  // translator.js is untyped JS: its status objects have the shape above.
  return new Translator({ sdk, target, onStatus: onStatus as (s: object) => void })
}

/** QVAC's worker takes plain POSIX paths; expo gives file:// URIs. */
function toPosix (uri: string) {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''))
}

let asr: { lang: string, model: string, modelId: string } | null = null
let asrQueue: Promise<unknown> = Promise.resolve()

/** Unload Whisper (e.g. when you switch language or leave). */
export async function releaseSpeech () {
  const a = asr
  asr = null
  if (a) await sdk.unloadModel({ modelId: a.modelId, clearStorage: false }).catch(() => {})
}

/**
 * Transcribe a recording (m4a) in `lang`. QVAC decodes the file with its own
 * FFmpeg, so it goes in as it is. Whisper stays loaded for the next one.
 */
export function transcribe (uri: string, lang: string, onStatus: (s: { state: 'loading' | 'downloading' | 'ready', model: string, download?: number }) => void): Promise<string> {
  const work = asrQueue.then(async () => {
    if (asr?.lang !== lang) {
      await releaseSpeech()
      const model = pickAsrModel(lang, 'base', sdk)
      onStatus({ state: 'loading', model })
      const modelId: string = await sdk.loadModel({
        modelSrc: sdk[model],
        // The multilingual model hears English unless told the language.
        modelConfig: { language: lang },
        onProgress: (p: { percentage?: number }) => onStatus({ state: 'downloading', model, download: Math.floor(p.percentage ?? 0) })
      })
      asr = { lang, model, modelId }
      onStatus({ state: 'ready', model })
    }
    const raw = await sdk.transcribe({ modelId: asr!.modelId, audioChunk: toPosix(uri) })
    return cleanTranscript(typeof raw === 'string' ? raw : String(raw ?? ''))
  })
  asrQueue = work.catch(() => {})
  return work
}
