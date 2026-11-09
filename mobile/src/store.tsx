import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { languages, makeTranslator, releaseSpeech, type ModelStatus, type TranslatorStatus } from './engine'
import { normalizeCode, type Line, type RouteKind } from './lines'
import { RoomClient } from './room-client'

export interface Peer { id: string, name: string, lang: string }
interface Room { code: string, name: string, lang: string }

interface RoomState {
  langs: string[]
  room: Room | null
  peers: Peer[]
  lines: Line[]
  models: ModelStatus[]
  newCode: () => Promise<string>
  join: (code: string, name: string, lang: string) => Promise<void>
  say: (text: string) => void
  setLang: (lang: string) => void
  leave: () => Promise<void>
}

const Ctx = createContext<RoomState | null>(null)
let nextId = 1
const MAX_LINES = 300

export function RoomProvider ({ children }: { children: ReactNode }) {
  const client = useRef<RoomClient | null>(null)
  const translator = useRef<ReturnType<typeof makeTranslator> | null>(null)
  const chains = useRef(new Map<string, Promise<void>>())
  const roomRef = useRef<Room | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [models, setModels] = useState<ModelStatus[]>([])
  const langs = useMemo(() => { try { return languages() } catch { return ['en'] } }, [])

  const addLine = useCallback((l: Omit<Line, 'id' | 'at'>) => {
    setLines((ls) => [...ls, { ...l, id: nextId++, at: Date.now() }].slice(-MAX_LINES))
  }, [])

  const onModel = useCallback((s: TranslatorStatus) => {
    const key = `${s.from}>${s.to}`
    setModels((ms) => {
      const prev = ms.find((m) => m.key === key) ?? { key, state: 'loading', kind: s.route?.kind ?? null, download: null }
      const next: ModelStatus = s.type === 'download'
        ? { ...prev, state: 'downloading', download: Math.floor(s.percentage ?? 0) }
        : s.type === 'ready' ? { ...prev, state: 'ready', kind: s.route?.kind ?? prev.kind, download: null } : { ...prev, state: 'loading', kind: s.route?.kind ?? prev.kind }
      return [...ms.filter((m) => m.key !== key), next]
    })
  }, [])

  // One worklet for the app's lifetime; messages from it update the room.
  useEffect(() => {
    const c = new RoomClient()
    client.current = c
    return c.on((m) => {
      const r = roomRef.current
      if (!r) return
      if (m.t === 'peer') {
        setPeers((ps) => [...ps.filter((p) => p.id !== m.id), { id: m.id, name: m.name, lang: m.lang }])
        addLine({ system: true, self: false, name: m.name, lang: m.lang, original: '', text: `${m.name} joined (${m.lang})`, route: 'same' })
        void translator.current?.prepare([m.lang])
      } else if (m.t === 'left-peer') {
        setPeers((ps) => ps.filter((p) => p.id !== m.id))
        addLine({ system: true, self: false, name: m.name, lang: '', original: '', text: `${m.name} left`, route: 'same' })
      } else if (m.t === 'lang') {
        setPeers((ps) => ps.map((p) => (p.id === m.id ? { ...p, lang: m.lang } : p)))
        void translator.current?.prepare([m.lang])
      } else if (m.t === 'caption') {
        // Translate on this phone, keeping each speaker's lines in order.
        const prev = chains.current.get(m.id) ?? Promise.resolve()
        const next = prev.then(async () => {
          const t = translator.current
          if (!t || roomRef.current !== r) return
          try {
            const { text, route } = await t.translate(m.text, m.lang)
            addLine({ self: false, name: m.name, lang: m.lang, original: m.text, text, route: (route as { kind: RouteKind }).kind })
          } catch {
            addLine({ self: false, name: m.name, lang: m.lang, original: m.text, text: m.text, route: 'untranslated' })
          }
        })
        chains.current.set(m.id, next)
      }
    })
  }, [addLine])

  const newCode = useCallback(async () => (await client.current!.request({ t: 'new' }, 'code')).code, [])

  const join = useCallback(async (code: string, name: string, lang: string) => {
    const c = normalizeCode(code)
    if (!c) throw new Error('Room codes are at least 6 characters. Tap New for a fresh one.')
    if (!name.trim()) throw new Error('Add your name.')
    await translator.current?.close()
    translator.current = makeTranslator(lang, onModel)
    const r = { code: c, name: name.trim().slice(0, 40), lang }
    roomRef.current = r
    setPeers([])
    setLines([])
    setModels([])
    chains.current.clear()
    try {
      await client.current!.request({ t: 'join', code: c, name: r.name, lang }, 'joined', 45000)
      setRoom(r)
    } catch (err) {
      roomRef.current = null
      throw err
    }
  }, [onModel])

  const say = useCallback((text: string) => {
    const r = roomRef.current
    const t = text.trim()
    if (!r || !t) return
    client.current!.send({ t: 'say', text: t })
    addLine({ self: true, name: r.name, lang: r.lang, original: t, text: t, route: 'same' })
  }, [addLine])

  const setLang = useCallback((lang: string) => {
    const r = roomRef.current
    if (!r || r.lang === lang) return
    const next = { ...r, lang }
    roomRef.current = next
    setRoom(next)
    client.current!.send({ t: 'lang', lang })
    translator.current?.setTarget(lang)
    setModels([])
    void translator.current?.prepare(peers.map((p) => p.lang))
    void releaseSpeech() // Whisper reloads for the new language on the next talk
  }, [peers])

  const leave = useCallback(async () => {
    roomRef.current = null
    setRoom(null)
    setPeers([])
    await client.current?.request({ t: 'leave' }, 'left', 10000).catch(() => {})
    await translator.current?.close()
    translator.current = null
    await releaseSpeech()
  }, [])

  const value = useMemo(() => ({ langs, room, peers, lines, models, newCode, join, say, setLang, leave }), [langs, room, peers, lines, models, newCode, join, say, setLang, leave])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRoom () {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRoom must be used inside RoomProvider')
  return v
}
