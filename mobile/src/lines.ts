// Pure helpers (no React Native imports) so they run under plain Node in tests.

/** UTF-8 for the worklet's IPC bytes, without relying on TextDecoder in Hermes. */
export function utf8Decode (bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++]
    let cp: number
    if (b < 0x80) cp = b
    else if (b >= 0xf0) cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
    else if (b >= 0xe0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
    else cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f)
    out += String.fromCodePoint(cp)
  }
  return out
}

export function utf8Encode (s: string): Uint8Array {
  const out: number[] = []
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
  }
  return Uint8Array.from(out)
}

/**
 * Splits a byte stream into newline-terminated JSON messages. Splitting on the
 * byte 0x0a is safe for UTF-8: it never appears inside a multi-byte sequence.
 */
export class LineReader {
  private pending: number[] = []
  push (chunk: Uint8Array): unknown[] {
    const out: unknown[] = []
    for (const b of chunk) {
      if (b !== 0x0a) { this.pending.push(b); continue }
      const line = utf8Decode(Uint8Array.from(this.pending))
      this.pending = []
      if (!line.trim()) continue
      try { out.push(JSON.parse(line)) } catch {}
    }
    return out
  }
}

/** Room codes: the same rule as src/protocol.js normalizeRoomCode. */
export function normalizeCode (code: string): string | null {
  const c = code.trim().toLowerCase().replace(/\s+/g, '-')
  return c.length >= 6 ? c : null
}

/** Display names for the languages Bergamot covers (Hermes has no Intl.DisplayNames). */
const NAMES: Record<string, string> = {
  ar: 'Arabic', bg: 'Bulgarian', ca: 'Catalan', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English',
  es: 'Spanish', et: 'Estonian', fa: 'Persian', fi: 'Finnish', fr: 'French', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian',
  hu: 'Hungarian', id: 'Indonesian', is: 'Icelandic', it: 'Italian', ja: 'Japanese', ko: 'Korean', lt: 'Lithuanian',
  lv: 'Latvian', ms: 'Malay', mt: 'Maltese', nb: 'Norwegian', nl: 'Dutch', nn: 'Norwegian Nynorsk', pl: 'Polish',
  pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak', sl: 'Slovenian', sq: 'Albanian', sr: 'Serbian',
  sv: 'Swedish', sw: 'Swahili', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese', zh: 'Chinese'
}
export const langName = (code: string) => NAMES[code] ?? code

export function sortLangs (codes: string[]): string[] {
  return [...codes].sort((a, b) => langName(a).localeCompare(langName(b)))
}

export type RouteKind = 'same' | 'direct' | 'pivot' | 'llm' | 'untranslated'
export interface Line { id: number, self: boolean, name: string, lang: string, original: string, text: string, route: RouteKind, at: number, system?: boolean }

/** How a line got into your language, for the little badge. */
export function routeLabel (l: Line, me: string): string | null {
  if (l.self || l.system) return null
  if (l.route === 'pivot') return `${l.lang} → en → ${me}`
  if (l.route === 'untranslated') return `${l.lang} · not translated`
  if (l.route === 'same') return l.lang
  return `${l.lang} → ${me}`
}
