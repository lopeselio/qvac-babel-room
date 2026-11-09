// Typed client for the local Babel Room server (src/ui-server.js).

export interface Peer { id: string, name: string, lang: string }
export interface RoomInfo { code: string, name: string, lang: string, allowLlm: boolean, peers: Peer[] }

export type RouteKind = 'same' | 'direct' | 'pivot' | 'llm' | 'untranslated'
export interface CaptionLine {
  self: boolean
  name: string
  lang: string
  original: string
  text: string
  route: { kind: RouteKind, model?: string, pivot?: string, reason?: string }
  at: string
}
export interface SystemLine { system: true, text: string, at: string }
export type Line = CaptionLine | SystemLine

export interface MicState { on: boolean, state: 'off' | 'loading' | 'downloading' | 'listening' | 'muted' | 'error', model: string | null, download: number | null, error: string | null }
export interface ModelState { key: string, state: 'loading' | 'downloading' | 'ready', kind: string | null, download: number | null }

export interface Snapshot { room: RoomInfo | null, mic: MicState, models: ModelState[], lines: Line[] }
export interface ServerState extends Snapshot { qvac: boolean, languages: string[] }

export type ServerEvent =
  | ({ type: 'state' } & Snapshot)
  | { type: 'line', line: Line }
  | { type: 'room', room: RoomInfo | null }
  | { type: 'mic', mic: MicState }
  | { type: 'models', models: ModelState[] }

async function request<T> (path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`)
  return body as T
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  state: () => request<ServerState>('/api/state'),
  newRoom: () => post<{ code: string }>('/api/room/new', {}),
  join: (body: { code: string, name: string, lang: string, allowLlm: boolean }) => post<RoomInfo>('/api/room/join', body),
  leave: () => post<{ ok: true }>('/api/room/leave', {}),
  say: (text: string) => post<{ ok: true }>('/api/say', { text }),
  setLang: (lang: string) => post<RoomInfo>('/api/lang', { lang }),
  mic: (on: boolean) => post<MicState>('/api/mic', { on }),
  /** Mono f32le @16 kHz. */
  audio: (samples: Float32Array) => request<void>('/api/audio', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: samples as BlobPart })
}

export const isSystem = (l: Line): l is SystemLine => 'system' in l
