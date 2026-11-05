import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import { pickAsrModel, cleanTranscript, micArgs, Captioner } from '../src/captioner.js'

const has = (...names) => Object.fromEntries(names.map((n) => [n, { name: n }]))

test('pickAsrModel prefers English-only, then language-specific, then multilingual', () => {
  const sdk = has('WHISPER_EN_TINY_Q8_0', 'WHISPER_SPANISH_TINY_Q8_0', 'WHISPER_TINY_Q8_0', 'WHISPER_BASE_Q8_0', 'WHISPER_NORWEGIAN_TINY')
  assert.equal(pickAsrModel('en', 'tiny', sdk), 'WHISPER_EN_TINY_Q8_0')
  assert.equal(pickAsrModel('es', 'tiny', sdk), 'WHISPER_SPANISH_TINY_Q8_0')
  assert.equal(pickAsrModel('nb', 'tiny', sdk), 'WHISPER_NORWEGIAN_TINY')
  assert.equal(pickAsrModel('ko', 'tiny', sdk), 'WHISPER_TINY_Q8_0')
  assert.equal(pickAsrModel('es', 'base', sdk), 'WHISPER_BASE_Q8_0') // no Spanish base → multilingual
  assert.throws(() => pickAsrModel('en', 'tiny', {}), /No Whisper/)
})

test('cleanTranscript drops Whisper phantoms and markers', () => {
  assert.equal(cleanTranscript('  [No speech detected] '), '')
  assert.equal(cleanTranscript('Thank you.'), '')
  assert.equal(cleanTranscript('¡Gracias!'), '')
  assert.equal(cleanTranscript('(music) So, shall we   start?'), 'So, shall we start?')
})

test('micArgs per platform', () => {
  assert.deepEqual(micArgs('darwin').slice(0, 4), ['-f', 'avfoundation', '-i', ':0'])
  assert.deepEqual(micArgs('linux', 'alsa_input.usb').slice(0, 4), ['-f', 'pulse', '-i', 'alsa_input.usb'])
  assert.ok(micArgs('win32').includes('audio=default'))
  assert.deepEqual(micArgs('linux').slice(-3), ['-f', 'f32le', 'pipe:1'])
})

test('Captioner wires ffmpeg → transcribeStream session → text events, and mute gates audio', async () => {
  const written = []
  const outputs = ['Hola a todos', '[No speech detected]', 'Empezamos ya']
  let endSession
  const session = {
    write: (c) => written.push(c),
    end: () => endSession?.(),
    async * [Symbol.asyncIterator] () {
      for (const o of outputs) { await new Promise((r) => setTimeout(r, 5)); yield o }
      await new Promise((r) => { endSession = r })
    }
  }
  const loads = []
  const sdk = {
    ...has('WHISPER_SPANISH_TINY_Q8_0', 'WHISPER_TINY_Q8_0', 'VAD_SILERO_5_1_2'),
    async loadModel (o) { loads.push(o); return 'asr1' },
    async transcribeStream () { return session },
    async unloadModel () {}
  }
  const proc = new EventEmitter()
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.kill = () => proc.emit('close', null)
  let spawned
  const cap = new Captioner({ sdk, lang: 'es', size: 'tiny', spawnFn: (cmd, args) => { spawned = [cmd, args]; return proc } })

  const texts = []
  cap.on('text', (t) => texts.push(t))
  await cap.start()
  assert.equal(spawned[0], 'ffmpeg')
  assert.equal(loads[0].modelSrc.name, 'WHISPER_SPANISH_TINY_Q8_0')
  assert.equal(loads[0].modelConfig.language, 'es')
  assert.equal(loads[0].modelConfig.vadModelSrc.name, 'VAD_SILERO_5_1_2')

  proc.stdout.write(Buffer.from([1, 2, 3, 4]))
  cap.mute(true)
  proc.stdout.write(Buffer.from([5, 6, 7, 8]))
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(written.length, 1)
  assert.deepEqual(texts, ['Hola a todos', 'Empezamos ya'])

  const ended = once(cap, 'end')
  await cap.stop()
  await ended
})

test('Captioner refuses to download a model that likely will not fit, unless forced', async () => {
  const tooBig = { verdict: 'likely-too-large', models: [{ name: 'WHISPER_BASE_Q8_0', verdict: 'likely-too-large', reasons: ['needs 900 MiB against a 100 MiB budget'] }] }
  let loads = 0
  const sdk = {
    ...has('WHISPER_BASE_Q8_0', 'VAD_SILERO_5_1_2'),
    async assessModelFit (p) { assert.equal(p.models[0].modelType, 'whispercpp-transcription'); return tooBig },
    async loadModel () { loads++; return 'asr' }
  }
  await assert.rejects(new Captioner({ sdk, lang: 'ko' }).load(), /likely can't hold/)
  assert.equal(loads, 0)
  await new Captioner({ sdk, lang: 'ko', force: true }).load()
  assert.equal(loads, 1)
})
