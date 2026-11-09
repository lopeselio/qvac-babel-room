// Wire protocol: newline-delimited JSON over each (Noise-encrypted)
// Hyperswarm connection. Peers are untrusted, so everything is size-capped and
// validated before it reaches the UI or a translation model.
//
// Only *source-language text* goes over the wire. Each listener translates
// into their own language locally, so nobody needs models for languages they
// don't read, and no audio ever leaves the speaker's device.

// '#crypto' is node:crypto in Node and bare-crypto in Bare (see package.json
// "imports"), so the room code also runs inside the mobile app's Bare worklet.
import { createHash, randomBytes } from '#crypto'
import b4a from 'b4a'

export const PROTOCOL = 'babel-room/1'
export const MAX_LINE_BYTES = 16 * 1024
export const MAX_TEXT = 2000
export const MAX_NAME = 40

const LANG_RE = /^[a-z]{2,3}$/

/** Room topics are derived from the room code, so the code itself never hits the DHT. */
export function roomTopic (code) {
  const norm = normalizeRoomCode(code)
  return createHash('sha256').update(`${PROTOCOL}:topic:${norm}`).digest()
}

export function normalizeRoomCode (code) {
  const c = String(code ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  if (c.length < 6) throw new Error('Room code must be at least 6 characters; use `babel-room new` for a strong one')
  return c
}

// Short, speakable codes: 4 words from a 256-word list (one byte each) + 2 digits → ~38 bits.
// Enough for an ad-hoc meeting (an attacker must guess it while it's live);
// use a longer code for anything sensitive.
const WORDS = ('amber anchor apple arrow aspen atlas aurora autumn badger bamboo banjo basil beacon berry birch ' +
  'bison blaze bloom bluff bolt bonsai breeze brook cabin cactus cairn camel candle canyon cedar chalk ' +
  'cherry cider cinder citrus clover cobalt comet coral cosmos cotton coyote crane crater cricket ' +
  'crystal cypress dahlia daisy delta denim desert dingo dolphin dove dragon drift dune eagle ember ' +
  'emerald falcon fern fiddle fig finch fjord flint flute forest fossil fox frost galaxy garnet gecko ' +
  'geyser ginger glacier glade granite grape gravel grove gull harbor hazel heron hickory honey ' +
  'horizon husky iceberg indigo iris island ivory jade jasmine jelly juniper kayak kelp kestrel kiwi ' +
  'koala lagoon lantern larch lava lemon lilac lily linen lotus lynx magnet mango maple marble marsh ' +
  'meadow melon mesa meteor mint mist moss moth nebula nectar nimbus nutmeg oasis ocean olive onyx ' +
  'opal orbit orchid otter owl oyster panda papaya parrot pebble pepper petal pine pixel plum polar ' +
  'poppy prairie prism puffin quartz quill rabbit radar raven reef ridge river robin rocket rose ruby ' +
  'saffron sage salmon sand sapphire satin savanna sequoia shadow shell sierra silver sky slate snow ' +
  'sparrow spruce squid star stone storm summit sun swan tango tea thistle thunder tide tiger timber ' +
  'topaz tulip tundra turtle umber valley velvet violet volcano walnut wasabi wave willow wind wolf ' +
  'wren yak yarrow yew zebra zenith zephyr acorn alder almond badge bramble cove echo fable glow ' +
  'hollow lark moon nova pond rain reed sail tern vale bayou brass canoe dew elm ferry gorge haze ' +
  'inlet jet knoll lime mural nest oak').split(' ')

export function newRoomCode (rand = randomBytes) {
  const b = rand(6)
  const w = [0, 1, 2, 3].map((i) => WORDS[b[i]]) // 256 words: no modulo bias
  return `${w.join('-')}-${String(b[4] % 100).padStart(2, '0')}`
}

export const ROOM_WORDS = WORDS

// ---------- messages ----------

function str (v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max
}

/** @returns {object|null} a clean copy of a valid message, or null */
export function validate (msg) {
  if (!msg || typeof msg !== 'object') return null
  switch (msg.type) {
    case 'hello':
      if (msg.protocol !== PROTOCOL || !str(msg.name, MAX_NAME) || !LANG_RE.test(msg.lang)) return null
      return { type: 'hello', protocol: PROTOCOL, name: sanitize(msg.name), lang: msg.lang }
    case 'caption':
      if (!str(msg.text, MAX_TEXT) || !LANG_RE.test(msg.lang)) return null
      if (!Number.isSafeInteger(msg.seq) || msg.seq < 0) return null
      return { type: 'caption', seq: msg.seq, lang: msg.lang, text: sanitize(msg.text), final: msg.final !== false }
    case 'lang':
      if (!LANG_RE.test(msg.lang)) return null
      return { type: 'lang', lang: msg.lang }
    default:
      return null
  }
}

/** Strip control characters (incl. ANSI escapes) so a peer can't mess with your terminal. */
export function sanitize (s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮]/g, '').trim()
}

export function encode (msg) {
  const line = JSON.stringify(msg) + '\n'
  if (b4a.byteLength(line) > MAX_LINE_BYTES) throw new Error('message too large')
  return line
}

/**
 * Incremental line decoder. Returns valid messages; drops garbage. Calls
 * onAbuse when a peer exceeds the line limit (caller should disconnect).
 */
export class Decoder {
  constructor ({ onAbuse = () => {} } = {}) {
    this.buf = ''
    this.onAbuse = onAbuse
  }

  push (chunk) {
    this.buf += chunk.toString('utf8')
    const out = []
    let i
    while ((i = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      if (!line.trim()) continue
      try {
        const m = validate(JSON.parse(line))
        if (m) out.push(m)
      } catch {}
    }
    if (b4a.byteLength(this.buf) > MAX_LINE_BYTES) {
      this.buf = ''
      this.onAbuse('line too long')
    }
    return out
  }
}
