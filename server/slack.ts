import { config } from './config'

export class SlackError extends Error {
  constructor(public code: string, public status = 200, public retryAfter?: number, public data?: any) {
    super(code)
  }
}

/** Slack errors that mean the token is dead and the user must sign in again. */
export const AUTH_ERRORS = new Set(['invalid_auth', 'token_revoked', 'account_inactive', 'token_expired', 'not_authed', 'no_permission_token'])

export interface Ctx {
  /** `${team}:${user}` — queue + cache scope; makes multi-workspace a data-model non-event later */
  key: string
  token: string
  teamId: string
  userId: string
  /** 'web' = browser-session credentials (xoxc token + `d` cookie) against the workspace host */
  kind?: 'oauth' | 'web'
  cookie?: string
  host?: string
}

const WEB_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export const webBase = (ctx: Ctx) => config.slackWebBase || `https://${ctx.host}`

/** Slack's own client talks to `<workspace>.slack.com/api/*` with token in the body and the d cookie. */
function request(ctx: Ctx, method: string, params: Record<string, unknown>, noAuth?: boolean): { url: string; init: RequestInit } {
  const body = encodeParams(params)
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (ctx.kind === 'web') {
    body.set('token', ctx.token)
    body.set('_x_mode', 'online')
    body.set('_x_app_name', 'client')
    headers.Cookie = `d=${ctx.cookie}`
    headers.Origin = 'https://app.slack.com'
    headers['User-Agent'] = WEB_UA
    return { url: `${webBase(ctx)}/api/${method}`, init: { method: 'POST', headers, body } }
  }
  if (!noAuth) headers.Authorization = `Bearer ${ctx.token}`
  return { url: `${config.slackApi}/${method}`, init: { method: 'POST', headers, body } }
}

type Priority = 'high' | 'low'
interface Job { run: () => void; priority: Priority }

/**
 * Tiny scheduler: bounded concurrency, two lanes (user-initiated beats background hydration),
 * and per-(key,method) pauses after a 429 so we honour Retry-After without hammering Slack.
 */
class Scheduler {
  private active = 0
  private high: Job[] = []
  private low: Job[] = []
  private pausedUntil = new Map<string, number>()
  constructor(private concurrency = 4) {}

  pauseRemaining(k: string) {
    return Math.max(0, (this.pausedUntil.get(k) ?? 0) - Date.now())
  }
  pause(k: string, ms: number) {
    this.pausedUntil.set(k, Date.now() + ms)
  }
  submit<T>(priority: Priority, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        priority,
        run: () => {
          this.active++
          fn().then(resolve, reject).finally(() => {
            this.active--
            this.pump()
          })
        },
      }
      ;(priority === 'high' ? this.high : this.low).push(job)
      this.pump()
    })
  }
  private pump() {
    while (this.active < this.concurrency) {
      const job = this.high.shift() ?? this.low.shift()
      if (!job) return
      job.run()
    }
  }
}

const scheduler = new Scheduler(4)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_INLINE_WAIT_MS = 30_000

function encodeParams(params: Record<string, unknown>): URLSearchParams {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  }
  return body
}

export interface CallOpts {
  priority?: Priority
  /** token override, e.g. oauth.v2.access has none */
  noAuth?: boolean
}

export async function slack<T = any>(ctx: Ctx, method: string, params: Record<string, unknown> = {}, opts: CallOpts = {}): Promise<T> {
  const pauseKey = `${ctx.key}:${method}`
  for (let attempt = 0; ; attempt++) {
    const wait = scheduler.pauseRemaining(pauseKey)
    if (wait > MAX_INLINE_WAIT_MS) throw new SlackError('rate_limited', 429, Math.ceil(wait / 1000))
    if (wait) await sleep(wait)

    const res = await scheduler.submit(opts.priority ?? 'high', async () => {
      const req = request(ctx, method, params, opts.noAuth)
      const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(25_000) })
      if (r.status === 429) return { kind: 'rl', after: Number(r.headers.get('retry-after') ?? 5) } as const
      if (!r.ok) throw new SlackError(`http_${r.status}`, 502)
      return { kind: 'ok', data: (await r.json()) as any } as const
    })

    if (res.kind === 'rl') {
      scheduler.pause(pauseKey, res.after * 1000)
      if (attempt >= 3 || res.after * 1000 > MAX_INLINE_WAIT_MS) throw new SlackError('rate_limited', 429, res.after)
      continue
    }
    if (!res.data.ok) throw new SlackError(res.data.error ?? 'unknown_error', 200, undefined, res.data)
    return res.data as T
  }
}

/** Walk a cursor-paginated method. */
export async function slackAll<T = any>(ctx: Ctx, method: string, key: string, params: Record<string, unknown> = {}, opts: CallOpts = {}, maxPages = 50): Promise<T[]> {
  const out: T[] = []
  let cursor = ''
  for (let i = 0; i < maxPages; i++) {
    const r = await slack(ctx, method, { limit: 200, ...params, cursor: cursor || undefined }, opts)
    out.push(...(r[key] ?? []))
    cursor = r.response_metadata?.next_cursor ?? ''
    if (!cursor) break
  }
  return out
}

// ---- cache ---------------------------------------------------------------------------------

interface Entry<T> { at: number; value?: T; inflight?: Promise<T> }
const store = new Map<string, Entry<any>>()

/** TTL cache with in-flight de-dup and stale-while-error. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const e = store.get(key) as Entry<T> | undefined
  if (e?.value !== undefined && Date.now() - e.at < ttlMs) return e.value
  if (e?.inflight) return e.inflight
  const inflight = load().then(
    (value) => {
      store.set(key, { at: Date.now(), value })
      return value
    },
    (err) => {
      if (e?.value !== undefined) {
        store.set(key, { at: Date.now() - ttlMs + 15_000, value: e.value }) // serve stale, retry soon
        return e.value as T
      }
      store.delete(key)
      throw err
    },
  )
  store.set(key, { at: e?.at ?? 0, value: e?.value, inflight })
  return inflight
}

/** Last known value regardless of age. */
export const peek = <T>(key: string): T | undefined => (store.get(key) as Entry<T> | undefined)?.value

export const invalidate = (prefix: string) => {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
}

export const forgetContext = (key: string) => invalidate(key)
