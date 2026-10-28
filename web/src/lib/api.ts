import type { Bootstrap, Prefs, TeamLite, UserLite } from '../../../shared/types'

export class ApiError extends Error {
  constructor(public status: number, public code: string, public retryAfter?: number) {
    super(code)
  }
}

/** Wired up by the store so this module has no dependency on it. */
export const hooks: { unauthorized: () => void; rateLimited: (seconds: number) => void } = {
  unauthorized: () => {},
  rateLimited: () => {},
}

let csrf = ''
export const setCsrf = (t: string) => (csrf = t)

async function req<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.json !== undefined || init.body ? 'POST' : 'GET')
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  if (method !== 'GET') headers['x-csrf-token'] = csrf
  let body = init.body
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const res = await fetch(`/api${path}`, { ...init, method, headers, body, credentials: 'same-origin' })
  if (res.ok) return (await res.json()) as T
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) hooks.unauthorized()
  if (res.status === 429) hooks.rateLimited(data.retryAfter ?? 5)
  throw new ApiError(res.status, data.error ?? `http_${res.status}`, data.retryAfter)
}

const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export interface Page { messages: any[]; hasMore: boolean; next: string | null }

export const api = {
  bootstrap: (refresh = false) => req<Bootstrap>(`/bootstrap${refresh ? '?refresh=1' : ''}`),
  users: () => req<{ users: UserLite[] }>('/users'),
  lookupUsers: (ids: string[]) => req<{ users: UserLite[] }>(`/users/lookup${qs({ ids: ids.join(',') })}`),
  teams: (ids: string[]) => req<{ teams: TeamLite[] }>(`/teams${qs({ ids: ids.join(',') })}`),
  emoji: () => req<{ emoji: Record<string, string>; aliases: Record<string, string> }>('/emoji'),
  history: (channel: string, o: { latest?: string; oldest?: string; inclusive?: boolean; limit?: number } = {}) =>
    req<Page>(`/history${qs({ channel, latest: o.latest, oldest: o.oldest, inclusive: o.inclusive ? 1 : undefined, limit: o.limit })}`),
  replies: (channel: string, ts: string) => req<Page>(`/replies${qs({ channel, ts })}`),
  conversation: (channel: string) => req<{ channel: any }>(`/conversation${qs({ channel })}`),
  members: (channel: string) => req<{ members: string[] }>(`/members${qs({ channel })}`),
  presence: (user: string) => req<{ presence: 'active' | 'away' }>(`/presence${qs({ user })}`),
  pins: (channel: string) => req<{ items: any[] }>(`/pins${qs({ channel })}`),
  permalink: (channel: string, ts: string) => req<{ permalink: string }>(`/permalink${qs({ channel, ts })}`),
  search: (query: string, page = 1) => req<{ messages: any }>(`/search${qs({ query, page })}`),
  send: (b: { channel: string; text: string; thread_ts?: string; reply_broadcast?: boolean }) => req<{ ts: string; message: any }>('/send', { json: b }),
  update: (channel: string, ts: string, text: string) => req<{ message: any }>('/update', { json: { channel, ts, text } }),
  del: (channel: string, ts: string) => req<{ ok: true }>('/delete', { json: { channel, ts } }),
  react: (channel: string, ts: string, name: string, remove: boolean) => req<{ ok: true }>('/react', { json: { channel, ts, name, remove } }),
  pin: (channel: string, ts: string, remove: boolean) => req<{ ok: true }>('/pin', { json: { channel, ts, remove } }),
  mark: (channel: string, ts: string) => req<{ ok: true }>('/mark', { json: { channel, ts } }),
  openDm: (users: string[]) => req<{ channel: string }>('/open-dm', { json: { users } }),
  upload: (form: FormData) => req<{ files: any[] }>('/upload', { method: 'POST', body: form }),
  savePrefs: (p: Prefs) => req<Prefs>('/prefs', { method: 'PUT', json: p }),
  logout: (revoke: boolean) => req<{ ok: true }>('/../auth/logout', { json: { revoke } }),
  authModes: () => fetch('/auth/modes').then((r) => r.json() as Promise<{ oauth: boolean; web: boolean; allowlist: boolean }>),
  importSession: (blob: string) => fetch('/auth/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blob }) }).then(async (r) => ({ ok: r.ok, ...(await r.json().catch(() => ({}))) }) as { ok: boolean; error?: string }),
  fileUrl: (url: string, o: { download?: boolean; name?: string } = {}) => `/api/file${qs({ url, download: o.download ? 1 : undefined, name: o.name })}`,
}

export const refreshUnread = (channel: string) =>
  req<{ state: import('../../../shared/types').UnreadState | null }>('/refresh-unread', { json: { channel } })
