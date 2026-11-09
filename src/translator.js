import { ensureFits } from './fit.js'

// Picks and caches on-device translation models for each language pair.
//
// Bergamot (fast, small, ~15-40 MB per direction) ships pairs to and from
// English. For X→Y with neither side English, QVAC chains two models with
// `pivotModel` (X→en→Y) inside one loaded model. If no Bergamot route exists
// we can fall back to a multilingual LLM (SalamandraTA) when allowed.

const constName = (from, to) => `BERGAMOT_${from.toUpperCase()}_${to.toUpperCase()}`

/**
 * @param {string} from ISO 639-1
 * @param {string} to ISO 639-1
 * @param {Record<string, any>} sdk the @qvac/sdk module (only constants are read)
 * @returns {{ kind: 'same' } | { kind: 'direct', model: string } | { kind: 'pivot', model: string, pivot: string } | { kind: 'llm', model: string } | { kind: 'none' }}
 */
export function planRoute (from, to, sdk, { llmFallback = 'SALAMANDRATA_2B_INST_Q4' } = {}) {
  if (from === to) return { kind: 'same' }
  const direct = constName(from, to)
  if (sdk[direct]) return { kind: 'direct', model: direct }
  const a = constName(from, 'en')
  const b = constName('en', to)
  if (from !== 'en' && to !== 'en' && sdk[a] && sdk[b]) return { kind: 'pivot', model: a, pivot: b }
  if (llmFallback && sdk[llmFallback]) return { kind: 'llm', model: llmFallback }
  return { kind: 'none' }
}

/** Languages reachable from/to English with Bergamot in this SDK build. */
export function bergamotLanguages (sdk) {
  const langs = new Set(['en'])
  for (const k of Object.keys(sdk)) {
    const m = k.match(/^BERGAMOT_([A-Z]{2})_([A-Z]{2})$/)
    if (m) { langs.add(m[1].toLowerCase()); langs.add(m[2].toLowerCase()) }
  }
  return [...langs].sort()
}

/** Tiny promise queue: QVAC models process one request at a time. */
class Serial {
  constructor () { this.tail = Promise.resolve() }
  run (fn) {
    const p = this.tail.then(fn, fn)
    this.tail = p.catch(() => {})
    return p
  }
}

export class Translator {
  /**
   * @param {{ sdk: any, target: string, allowLlm?: boolean, onStatus?: (s: object) => void }} opts
   */
  constructor ({ sdk, target, allowLlm = false, onStatus = () => {}, force = false }) {
    this.force = force
    this.sdk = sdk
    this.target = target
    this.allowLlm = allowLlm
    this.onStatus = onStatus
    this.models = new Map() // `${from}>${to}` → Promise<{ modelId, route, queue }>
    this.llm = null // one shared LLM for all pairs
    // Load models one at a time. Routes share files (es→it pivots through the
    // same en→it model a direct en→it route uses), and two parallel downloads
    // of one file fail in QVAC's cache with "File descriptor could not be locked".
    this.loads = new Serial()
  }

  setTarget (lang) {
    this.target = lang
  }

  route (from, to = this.target) {
    return planRoute(from, to, this.sdk, { llmFallback: this.allowLlm ? 'SALAMANDRATA_2B_INST_Q4' : null })
  }

  /** Load (once) whatever model serves from→to. */
  async _model (from, to) {
    const key = `${from}>${to}`
    if (!this.models.has(key)) {
      const route = this.route(from, to)
      const p = (async () => {
        if (route.kind === 'none') throw new Error(`No on-device translation route for ${from}→${to}`)
        if (route.kind === 'llm') {
          if (!this.llm) {
            this.onStatus({ type: 'loading', from, to, route })
            const load = { modelSrc: this.sdk[route.model], modelConfig: { ctx_size: 2048 } }
            this.llm = ensureFits(this.sdk, [{ ...load, modelType: 'llamacpp-completion' }], { force: this.force })
              .then(() => this.loads.run(() => this.sdk.loadModel(load)))
              .then((modelId) => ({ modelId, queue: new Serial() }))
            this.llm.catch(() => { this.llm = null })
          }
          const { modelId, queue } = await this.llm
          return { modelId, route, queue }
        }
        this.onStatus({ type: 'loading', from, to, route })
        const modelConfig = { engine: 'Bergamot', from, to }
        if (route.kind === 'pivot') modelConfig.pivotModel = { modelSrc: this.sdk[route.pivot] }
        const modelId = await this.loads.run(() => this.sdk.loadModel({
          modelSrc: this.sdk[route.model],
          modelConfig,
          onProgress: (pr) => this.onStatus({ type: 'download', from, to, percentage: pr.percentage })
        }))
        this.onStatus({ type: 'ready', from, to, route })
        return { modelId, route, queue: new Serial() }
      })()
      // Don't cache failures: a later attempt (e.g. once online) may succeed.
      p.catch(() => this.models.delete(key))
      this.models.set(key, p)
    }
    return this.models.get(key)
  }

  /** Warm up the models for a set of source languages (e.g. when peers join). */
  async prepare (fromLangs) {
    await Promise.allSettled([...new Set(fromLangs)].filter((l) => l !== this.target).map((l) => this._model(l, this.target)))
  }

  /**
   * @returns {Promise<{ text: string, route: object }>}
   */
  async translate (text, from, to = this.target) {
    if (from === to) return { text, route: { kind: 'same' } }
    const { modelId, route, queue } = await this._model(from, to)
    const out = await queue.run(async () => {
      const r = this.sdk.translate({
        modelId,
        text,
        from,
        to,
        modelType: route.kind === 'llm' ? 'llamacpp-completion' : 'nmtcpp-translation',
        stream: false
      })
      return r.text
    })
    return { text: out.trim(), route }
  }

  async close () {
    const loaded = await Promise.allSettled([...this.models.values()])
    const ids = new Set(loaded.filter((r) => r.status === 'fulfilled').map((r) => r.value.modelId))
    await Promise.allSettled([...ids].map((modelId) => this.sdk.unloadModel({ modelId, clearStorage: false })))
    this.models.clear()
    this.llm = null
  }
}
