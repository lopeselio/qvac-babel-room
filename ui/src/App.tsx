import { useCallback, useRef, useState } from 'react'
import { useRoom } from './useRoom'
import { Lobby } from './components/Lobby'
import { RoomView } from './components/RoomView'

export function App () {
  const { state, offline } = useRoom()
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toast = useCallback((m: string) => {
    setToastMsg(m)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToastMsg(null), 3500)
  }, [])

  const pill = offline
    ? { tone: 'bad', text: "Babel Room isn't running" }
    : !state
        ? { tone: 'idle', text: 'Connecting…' }
        : state.room
          ? { tone: 'ok', text: `${state.room.peers.length + 1} in the room · peer-to-peer` }
          : state.qvac ? { tone: 'ok', text: 'QVAC ready · on-device' } : { tone: 'bad', text: 'QVAC off' }

  return (
    <div className='wrap'>
      <header className='top'>
        <div className='brand'>
          <img src='/favicon.svg' alt='' width='34' height='34' />
          <div><h1>Babel Room</h1><p>Live captions across languages. No server, nothing leaves your devices but text.</p></div>
        </div>
        <span className='pill'><span className={`dot ${pill.tone}`} />{pill.text}</span>
      </header>

      {offline && <p className='warn-note'>Can&apos;t reach the local server. Start it with <code>babel-room ui</code>, then reload.</p>}
      {state && !state.room && <Lobby state={state} />}
      {state?.room && <RoomView state={state} toast={toast} />}

      <footer>
        <span><b>Speech recognition and translation run on this device</b> with Tether QVAC.</span>
        <span><b>Peers connect directly</b> over Hyperswarm, end-to-end encrypted.</span>
        <span><a href='https://github.com/lopeselio/qvac-babel-room' rel='noopener noreferrer' target='_blank'>Source on GitHub</a></span>
      </footer>
      <div className={`toast ${toastMsg ? 'show' : ''}`} role='status'>{toastMsg}</div>
    </div>
  )
}
