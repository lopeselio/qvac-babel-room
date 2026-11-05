import { EventEmitter } from 'node:events'
import { appendFile } from 'node:fs/promises'

/**
 * Connects a Room (network), an optional Captioner (your voice → text) and a
 * Translator (their text → your language). Emits UI-ready events:
 *
 *   'line'   { self, name, lang, original, text, route, at }
 *   'system' { message }
 *   'error'  Error
 */
export class BabelSession extends EventEmitter {
  constructor ({ room, translator, captioner = null, transcriptPath = null, now = () => new Date() }) {
    super()
    this.room = room
    this.translator = translator
    this.captioner = captioner
    this.transcriptPath = transcriptPath
    this.now = now
    // Keep each speaker's lines in order even if translations finish out of order.
    this.chains = new Map()

    room.on('peer', (p) => {
      this.emit('system', { message: `${p.name} joined (${p.lang})` })
      translator.prepare([p.lang]).catch(() => {})
    })
    room.on('leave', (p) => this.emit('system', { message: `${p.name} left` }))
    room.on('lang', (p) => {
      this.emit('system', { message: `${p.name} now speaks ${p.lang}` })
      translator.prepare([p.lang]).catch(() => {})
    })
    room.on('caption', (c) => this._incoming(c))

    if (captioner) {
      captioner.on('text', (text) => this.say(text))
      captioner.on('error', (err) => this.emit('error', err))
    }
  }

  /** Send your own line (from the mic or typed) and show it locally. */
  say (text) {
    const t = text.trim()
    if (!t) return
    this.room.say(t)
    this._emitLine({ self: true, name: this.room.name, lang: this.room.lang, original: t, text: t, route: { kind: 'same' } })
  }

  setLang (lang) {
    this.room.setLang(lang)
    this.translator.setTarget(lang)
    this.translator.prepare(this.room.peerList.map((p) => p.lang)).catch(() => {})
  }

  _incoming (c) {
    const prev = this.chains.get(c.id) ?? Promise.resolve()
    const next = prev.then(async () => {
      try {
        const { text, route } = await this.translator.translate(c.text, c.lang)
        this._emitLine({ self: false, name: c.name, lang: c.lang, original: c.text, text, route })
      } catch (err) {
        // Still show the original so nobody misses what was said.
        this._emitLine({ self: false, name: c.name, lang: c.lang, original: c.text, text: c.text, route: { kind: 'untranslated', reason: err.message } })
      }
    })
    this.chains.set(c.id, next)
    return next
  }

  _emitLine (line) {
    const when = this.now()
    const full = { ...line, at: when.toISOString() }
    this.emit('line', full)
    if (this.transcriptPath) {
      const extra = full.original !== full.text ? ` _(${full.lang}: ${full.original})_` : ''
      appendFile(this.transcriptPath, `- \`${when.toTimeString().slice(0, 8)}\` **${full.name}**: ${full.text}${extra}\n`).catch((e) => this.emit('error', e))
    }
  }

  async close () {
    await this.captioner?.stop()
    await this.room.leave()
    await this.translator.close()
  }
}
