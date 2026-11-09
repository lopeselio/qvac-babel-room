// Speech-recognition helpers with no Node-only imports: shared by the CLI,
// the web UI server (through captioner.js) and the mobile app.

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
