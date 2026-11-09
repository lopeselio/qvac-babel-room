import { useState, type FormEvent } from 'react'
import { api, type ServerState } from '../api'
import { defaultLang, langName, sortedLangs } from '../langs'

const remember = (k: string, v?: string) => {
  try {
    if (v === undefined) return localStorage.getItem(k) ?? ''
    localStorage.setItem(k, v)
  } catch {}
  return v ?? ''
}

export function Lobby ({ state }: { state: ServerState }) {
  const [name, setName] = useState(() => remember('br.name'))
  const [lang, setLang] = useState(() => remember('br.lang') || defaultLang(state.languages))
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room') ?? '')
  const [allowLlm, setAllowLlm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fresh () {
    setError(null)
    try { setCode((await api.newRoom()).code) } catch (err) { setError((err as Error).message) }
  }

  async function join (e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    remember('br.name', name.trim())
    remember('br.lang', lang)
    try {
      await api.join({ code: code.trim(), name: name.trim(), lang, allowLlm })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='lobby'>
      <form className='card join' onSubmit={(e) => { void join(e) }}>
        <h2>Join a room</h2>
        <label className='field'>
          <span className='label'>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder='Ana' maxLength={40} required />
        </label>
        <label className='field'>
          <span className='label'>I speak and read</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {sortedLangs(state.languages).map((l) => <option key={l} value={l}>{langName(l)} ({l})</option>)}
          </select>
        </label>
        <div className='field'>
          <span className='label'>Room code</span>
          <div className='row'>
            <input className='grow mono' value={code} onChange={(e) => setCode(e.target.value)} placeholder='petal-hollow-tern-bloom-23' required />
            <button type='button' className='btn' onClick={() => { void fresh() }}>New room</button>
          </div>
          <span className='hint'>Make a new code, or paste one someone shared with you.</span>
        </div>
        <label className='check'>
          <input type='checkbox' checked={allowLlm} onChange={(e) => setAllowLlm(e.target.checked)} />
          Use a 2B multilingual LLM for pairs Bergamot can&apos;t translate (bigger download)
        </label>
        {error && <p className='err' role='alert'>{error}</p>}
        <button className='btn primary wide' disabled={busy || !state.qvac || !name.trim() || !code.trim()}>{busy ? 'Finding the room…' : 'Join'}</button>
        {!state.qvac && <p className='err'>QVAC isn&apos;t available in this session, so speech and translation can&apos;t run.</p>}
      </form>

      <section className='how'>
        <h2>How it works</h2>
        <ol>
          <li><b>Everyone speaks their own language.</b> Whisper turns your voice into text on this computer. Your audio never leaves it.</li>
          <li><b>Only caption text is sent</b>, straight to the other people in the room over Hyperswarm: end-to-end encrypted, no server.</li>
          <li><b>Each listener translates on their own device</b> with Bergamot (through English when needed), so everyone reads everyone in their language.</li>
        </ol>
        <p className='hint'>To try it alone, run a second Babel Room with <span className='mono'>babel-room ui --port 4401</span>, join the same code in another language, and talk in one window.</p>
      </section>
    </div>
  )
}
