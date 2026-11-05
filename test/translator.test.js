import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planRoute, bergamotLanguages, Translator } from '../src/translator.js'

const C = (n) => ({ name: n, src: `registry://x/${n}` })
const SDK_CONSTANTS = {
  BERGAMOT_ES_EN: C('BERGAMOT_ES_EN'),
  BERGAMOT_EN_ES: C('BERGAMOT_EN_ES'),
  BERGAMOT_EN_DE: C('BERGAMOT_EN_DE'),
  BERGAMOT_DE_EN: C('BERGAMOT_DE_EN'),
  BERGAMOT_EN_JA: C('BERGAMOT_EN_JA'),
  SALAMANDRATA_2B_INST_Q4: C('SALAMANDRATA_2B_INST_Q4')
}

test('planRoute: same, direct, pivot via English, LLM fallback, none', () => {
  assert.deepEqual(planRoute('es', 'es', SDK_CONSTANTS), { kind: 'same' })
  assert.deepEqual(planRoute('es', 'en', SDK_CONSTANTS), { kind: 'direct', model: 'BERGAMOT_ES_EN' })
  assert.deepEqual(planRoute('es', 'de', SDK_CONSTANTS), { kind: 'pivot', model: 'BERGAMOT_ES_EN', pivot: 'BERGAMOT_EN_DE' })
  assert.deepEqual(planRoute('ja', 'es', SDK_CONSTANTS), { kind: 'llm', model: 'SALAMANDRATA_2B_INST_Q4' }) // no JA→EN
  assert.deepEqual(planRoute('ja', 'es', SDK_CONSTANTS, { llmFallback: null }), { kind: 'none' })
})

test('bergamotLanguages lists reachable languages', () => {
  assert.deepEqual(bergamotLanguages(SDK_CONSTANTS), ['de', 'en', 'es', 'ja'])
})

function fakeSdk () {
  const calls = { load: [], translate: [], unload: [] }
  let n = 0
  let active = 0
  let maxActive = 0
  const sdk = {
    ...SDK_CONSTANTS,
    async loadModel (o) { calls.load.push(o); await new Promise((r) => setTimeout(r, 5)); return `m${++n}` },
    async unloadModel (o) { calls.unload.push(o.modelId) },
    translate (o) {
      calls.translate.push(o)
      active++
      maxActive = Math.max(maxActive, active)
      const text = new Promise((r) => setTimeout(() => { active--; r(` [${o.from}>${o.to}] ${o.text} `) }, 5))
      return { text }
    }
  }
  return { sdk, calls, maxActive: () => maxActive }
}

test('Translator loads each pair once, configures pivots, and serialises per model', async () => {
  const { sdk, calls, maxActive } = fakeSdk()
  const tr = new Translator({ sdk, target: 'de' })
  const results = await Promise.all([
    tr.translate('hola', 'es'),
    tr.translate('adiós', 'es'),
    tr.translate('hello', 'en'),
    tr.translate('hallo', 'de')
  ])
  assert.deepEqual(results.map((r) => r.text), ['[es>de] hola', '[es>de] adiós', '[en>de] hello', 'hallo'])
  assert.equal(calls.load.length, 2)
  const pivotLoad = calls.load.find((l) => l.modelConfig.from === 'es')
  assert.equal(pivotLoad.modelSrc.name, 'BERGAMOT_ES_EN')
  assert.deepEqual(pivotLoad.modelConfig, { engine: 'Bergamot', from: 'es', to: 'de', pivotModel: { modelSrc: SDK_CONSTANTS.BERGAMOT_EN_DE } })
  assert.equal(calls.translate[0].modelType, 'nmtcpp-translation')
  assert.equal(calls.translate[0].stream, false)
  assert.equal(maxActive() <= 2, true) // one in-flight job per model (two models)
  await tr.close()
  assert.deepEqual(calls.unload.sort(), ['m1', 'm2'])
})

test('LLM routes are opt-in and share one model', async () => {
  const { sdk, calls } = fakeSdk()
  const off = new Translator({ sdk, target: 'es' })
  await assert.rejects(off.translate('こんにちは', 'ja'), /No on-device translation route/)

  const on = new Translator({ sdk, target: 'es', allowLlm: true })
  const r = await on.translate('こんにちは', 'ja')
  assert.equal(r.route.kind, 'llm')
  assert.equal(calls.translate.at(-1).modelType, 'llamacpp-completion')
  await on.translate('ありがとう', 'ja', 'de') // ja→de also via the same LLM
  assert.equal(calls.load.filter((l) => l.modelSrc.name === 'SALAMANDRATA_2B_INST_Q4').length, 1)
})

test('a failed load is not cached', async () => {
  const { sdk } = fakeSdk()
  let fail = true
  const orig = sdk.loadModel
  sdk.loadModel = async (o) => { if (fail) throw new Error('offline'); return orig(o) }
  const tr = new Translator({ sdk, target: 'en' })
  await assert.rejects(tr.translate('hola', 'es'), /offline/)
  fail = false
  assert.equal((await tr.translate('hola', 'es')).text, '[es>en] hola')
})
