import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, isSystem, type CaptionLine, type Line, type ServerState } from '../api'
import { langName, sortedLangs } from '../langs'
import { Mic } from '../mic'

const HUES = [252, 200, 160, 30, 340, 280, 120, 10]
function hue (name: string) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return HUES[h % HUES.length]
}

function Avatar ({ name }: { name: string }) {
  return <span className='avatar' style={{ ['--h' as string]: hue(name) }} aria-hidden='true'>{name.slice(0, 1).toUpperCase()}</span>
}

function routeLabel (l: CaptionLine, me: string) {
  const r = l.route
  if (l.self) return null
  if (r.kind === 'same') return `${l.lang}`
  if (r.kind === 'pivot') return `${l.lang} → en → ${me}`
  if (r.kind === 'llm') return `${l.lang} → ${me} · LLM`
  if (r.kind === 'untranslated') return `${l.lang} · not translated`
  return `${l.lang} → ${me}`
}

export function RoomView ({ state, toast }: { state: ServerState, toast: (m: string) => void }) {
  const room = state.room!
  const [draft, setDraft] = useState('')
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const mic = useRef<Mic | null>(null)
  const feed = useRef<HTMLDivElement>(null)
  const listening = state.mic.on

  // Keep the newest caption in view.
  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }) }, [state.lines.length])
  useEffect(() => () => { void mic.current?.stop() }, [])

  async function toggleMic () {
    setError(null)
    try {
      if (listening) {
        await mic.current?.stop()
        mic.current = null
        await api.mic(false)
        return
      }
      const m = new Mic(setLevel, (err) => setError(err.message))
      await m.start()
      mic.current = m
      await api.mic(true)
    } catch (err) {
      await mic.current?.stop()
      mic.current = null
      setError((err as Error).message)
    }
  }

  async function send (e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    try { await api.say(text) } catch (err) { setError((err as Error).message); setDraft(text) }
  }

  async function copyCode () {
    try { await navigator.clipboard.writeText(room.code); toast('Room code copied. Share it with the others.') } catch { toast('Copy failed: select the code and copy it.') }
  }

  async function leave () {
    await mic.current?.stop()
    mic.current = null
    await api.leave().catch(() => {})
  }

  const micLabel = state.mic.state === 'downloading'
    ? `Downloading Whisper ${state.mic.download ?? 0}%…`
    : state.mic.state === 'loading'
      ? 'Loading Whisper…'
      : listening ? 'Listening · tap to mute' : 'Tap to talk'

  return (
    <div className='room'>
      <header className='room-bar'>
        <div className='code'>
          <span className='label'>Room</span>
          <button type='button' className='mono code-btn' onClick={() => { void copyCode() }} title='Copy the room code'>{room.code}</button>
        </div>
        <label className='inline'>
          <span className='label'>I speak and read</span>
          <select value={room.lang} onChange={(e) => { void api.setLang(e.target.value).catch((err) => setError((err as Error).message)) }}>
            {sortedLangs(state.languages).map((l) => <option key={l} value={l}>{langName(l)}</option>)}
          </select>
        </label>
        <div className='bar-actions'>
          <a className='btn' href='/api/transcript' download>Transcript</a>
          <button type='button' className='btn' onClick={() => { void leave() }}>Leave</button>
        </div>
      </header>

      <div className='room-grid'>
        <section className='feed-card card'>
          <div className='feed' ref={feed} aria-live='polite'>
            {state.lines.length === 0 && (
              <div className='empty'>
                <p><b>You&apos;re in.</b> Share the room code, then talk or type.</p>
                <p className='hint'>Captions from others appear here in {langName(room.lang)}.</p>
              </div>
            )}
            {state.lines.map((l, i) => <Bubble key={i} line={l} me={room.lang} />)}
          </div>
          <form className='composer' onSubmit={(e) => { void send(e) }}>
            <button
              type='button'
              className={`mic ${listening ? 'on' : ''}`}
              onClick={() => { void toggleMic() }}
              aria-pressed={listening}
              disabled={state.mic.state === 'loading' || state.mic.state === 'downloading'}
            >
              <span className='mic-dot' aria-hidden='true' />
              <span className='mic-text'>{micLabel}</span>
              <span className='meter' aria-hidden='true'><i style={{ width: `${Math.round(level * 100)}%` }} /></span>
            </button>
            <input className='grow' value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Type in ${langName(room.lang)}…`} maxLength={1000} aria-label='Type a message' />
            <button className='btn primary' disabled={!draft.trim()}>Send</button>
          </form>
          {(error || state.mic.error) && <p className='err' role='alert'>{error ?? state.mic.error}</p>}
        </section>

        <aside className='side'>
          <section className='card'>
            <h3>In the room · {room.peers.length + 1}</h3>
            <ul className='people'>
              <li><Avatar name={room.name} /><span><b>{room.name}</b> <span className='muted'>(you)</span><br /><span className='muted small'>{langName(room.lang)}</span></span></li>
              {room.peers.map((p) => (
                <li key={p.id}><Avatar name={p.name} /><span><b>{p.name}</b><br /><span className='muted small'>{langName(p.lang)}</span></span></li>
              ))}
            </ul>
            {room.peers.length === 0 && <p className='hint'>Waiting for others. They join with the same room code.</p>}
          </section>
          <section className='card'>
            <h3>On this device</h3>
            <ul className='models'>
              <li>
                <span className={`dot ${state.mic.state === 'listening' ? 'ok' : state.mic.state === 'off' || state.mic.state === 'muted' ? 'idle' : 'live'}`} />
                <span>Speech · Whisper {state.mic.model ? <span className='muted small'>{state.mic.model.replace(/^WHISPER_/, '').toLowerCase()}</span> : null}<br />
                  <span className='muted small'>{state.mic.state === 'listening' ? 'listening' : state.mic.state === 'downloading' ? `downloading ${state.mic.download ?? 0}%` : state.mic.state === 'loading' ? 'loading' : state.mic.state === 'muted' ? 'muted (loaded)' : 'off until you talk'}</span>
                </span>
              </li>
              {state.models.map((m) => {
                const [from, to] = m.key.split('>')
                return (
                  <li key={m.key}>
                    <span className={`dot ${m.state === 'ready' ? 'ok' : 'live'}`} />
                    <span>Translate · {langName(from)} → {langName(to)}<br />
                      <span className='muted small'>Bergamot{m.kind === 'pivot' ? ' via English' : m.kind === 'llm' ? ' (LLM)' : ''} · {m.state === 'downloading' ? `downloading ${m.download ?? 0}%` : m.state}</span>
                    </span>
                  </li>
                )
              })}
              {state.models.length === 0 && <li className='muted small'>Translation models load when someone who speaks another language joins.</li>}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Bubble ({ line, me }: { line: Line, me: string }) {
  if (isSystem(line)) return <div className='sys'>{line.text} · {new Date(line.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
  const route = routeLabel(line, me)
  return (
    <div className={`bubble ${line.self ? 'self' : ''}`}>
      {!line.self && <Avatar name={line.name} />}
      <div className='bubble-body'>
        <div className='bubble-head'>
          <b>{line.self ? 'You' : line.name}</b>
          {route && <span className={`route ${line.route.kind}`}>{route}</span>}
          <span className='muted small'>{new Date(line.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
        <p className='said'>{line.text}</p>
        {line.original !== line.text && <p className='orig'>{line.original}</p>}
      </div>
    </div>
  )
}
