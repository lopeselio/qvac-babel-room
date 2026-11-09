import { useEffect, useState } from 'react'
import { api, type ServerEvent, type ServerState } from './api'

/**
 * Live server state: one GET for the languages, then Server-Sent Events for
 * everything that changes (captions, peers, mic and model status).
 */
export function useRoom () {
  const [state, setState] = useState<ServerState | null>(null)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let live = true
    let es: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      api.state().then((s) => {
        if (!live) return
        setState(s)
        setOffline(false)
        es = new EventSource('/api/events')
        es.onmessage = (m) => {
          const e = JSON.parse(m.data) as ServerEvent
          setState((prev) => (prev ? apply(prev, e) : prev))
        }
        es.onerror = () => {
          es?.close()
          setOffline(true)
          retry = setTimeout(connect, 2000)
        }
      }).catch(() => {
        if (!live) return
        setOffline(true)
        retry = setTimeout(connect, 2000)
      })
    }
    connect()
    return () => { live = false; es?.close(); clearTimeout(retry) }
  }, [])

  return { state, offline }
}

function apply (s: ServerState, e: ServerEvent): ServerState {
  switch (e.type) {
    case 'state': return { ...s, room: e.room, mic: e.mic, models: e.models, lines: e.lines }
    case 'line': return { ...s, lines: [...s.lines, e.line].slice(-500) }
    case 'room': return { ...s, room: e.room }
    case 'mic': return { ...s, mic: e.mic }
    case 'models': return { ...s, models: e.models }
  }
}
