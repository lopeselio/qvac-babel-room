# Babel Room

**Live captions across languages, with no server.** Everyone in the room speaks their own language, and everyone reads everyone else in theirs. Speech recognition and translation run on each person's own device with [Tether QVAC](https://docs.qvac.tether.io/). Peers connect directly over [Hyperswarm](https://github.com/holepunchto/hyperswarm).

```console
$ babel-room new
petal-hollow-tern-bloom-23

# Ana, in Madrid                                    # Ben, in Berlin
$ babel-room join petal-hollow-tern-bloom-23 \      $ babel-room join petal-hollow-tern-bloom-23 \
    --name Ana --lang es --mic                          --name Ben --lang de --mic

                                                    • Ana joined (es)
  (Ana says) "Hola a todos, empezamos la reunión."  12:43:56 Ana [es→de]: Hallo zusammen, wir haben das Treffen begonnen.
                                                    12:43:58 Ana [es→de]: Hörst du mir gut zu?
```

## How it works

```
 Ana's laptop                                         Ben's laptop
 ┌───────────────────────────┐                        ┌────────────────────────────┐
 │ mic ─▶ Whisper + VAD (es) │   "Hola a todos…"      │ Bergamot es→en→de (pivot)  │
 │        │                  │ ─────────────────────▶ │        │                   │
 │        ▼                  │  text only, Noise-     │        ▼                   │
 │   your captions           │  encrypted, P2P        │ "Hallo zusammen…"          │
 └───────────────────────────┘                        └────────────────────────────┘
```

- **Audio never leaves your device.** Only caption *text* goes to peers.
- **Each listener translates on their own device into their own language.** Ana doesn't need German models, and a room of five languages doesn't need one person who can run them all.
- **No server.** The room code is hashed into a Hyperswarm topic. Peers find each other on the DHT, hole-punch NATs and talk over end-to-end encrypted streams.
- **Any pair, small models.** Bergamot models are about 15–40 MB per direction. Pairs that don't involve English go through English with QVAC's built-in `pivotModel`. For pairs Bergamot can't do, add `--llm` to fall back to a 2B multilingual LLM (SalamandraTA).
- **Speech recognition** uses Whisper with Silero VAD. Where QVAC ships a dedicated model for your language (es, fr, de, it, pt, ru, ja, nb) it uses that, otherwise the multilingual model. Known Whisper hallucinations ("Thank you.", "[No speech detected]") are filtered out.

## Install

```bash
git clone https://github.com/lopeselio/qvac-babel-room && cd qvac-babel-room
npm install
npm link        # optional: puts `babel-room` on your PATH
```

Requirements: Node.js 22+, and [ffmpeg](https://ffmpeg.org/) for microphone or file input. Models download on first use and are cached.

## Usage

```
babel-room new                                  print a fresh room code
babel-room join <code> --lang <xx> [options]    join a room
babel-room languages                            list supported languages
```

| Option | |
|---|---|
| `--lang xx` | The language you speak and want to read (ISO 639-1) |
| `--name` | Display name |
| `--mic` | Caption your microphone. On macOS, grant your terminal microphone access. `--device ":1"` picks another input (`ffmpeg -f avfoundation -list_devices true -i ""`) |
| `--file audio.wav` | Caption an audio file at real-time speed (demos, testing) |
| `--asr tiny\|base\|small` | Whisper size (default `base`, 82 MB) |
| `--llm` | Allow the LLM fallback for pairs without a Bergamot route |
| `--transcript notes.md` | Append a Markdown transcript, with originals next to translations |
| `--original` | Also show the original text under each translated line |

You can always type instead of speaking. In-room commands: `/lang <xx>`, `/peers`, `/mute`, `/unmute`, `/quit`.

## Library

```js
import * as sdk from '@qvac/sdk'
import { Room, Translator, Captioner, BabelSession } from 'qvac-babel-room'

const room = new Room({ code: 'petal-hollow-tern-bloom-23', name: 'Ben', lang: 'de' })
const session = new BabelSession({
  room,
  translator: new Translator({ sdk, target: 'de' }),
  captioner: new Captioner({ sdk, lang: 'de' })
})
session.on('line', (l) => console.log(`${l.name}: ${l.text}`))
await room.join()
await session.captioner.start()
```

Each piece is usable alone. `Translator` is a small, cached, any-to-any on-device translation service. `Captioner` turns a mic or file into an event stream of utterances.

## Security & privacy

- The room code is the only key, and anyone who has it can join. `babel-room new` generates about 38 bits (4 words + 2 digits), which is fine for a live meeting. Use a longer code for anything sensitive.
- The DHT only sees a SHA-256 of the code, never the code itself.
- Peers are untrusted. Every message is size-capped, schema-validated and rate-limited, and terminal control characters and bidi overrides are stripped before display.
- The peers you connect to can see your IP address.

## Development

```bash
npm test   # protocol, translator routing, captioner, session, plus a 4-peer room test on a local DHT testnet
```

Tested end to end on macOS (Apple Silicon). Spanish speech was captioned by Whisper-base, then translated es→en→de on the receiving peer over the public Hyperswarm DHT. After the first model download, translations take about 100 ms per sentence.

## License

Apache-2.0
