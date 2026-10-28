import { Hono } from 'hono'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'
import { config, oauthEnabled, USER_SCOPES } from './config'
import { createSession, deleteSession, getSession, type Session } from './db'
import { randomId, safeEqual } from './crypto'
import { AUTH_ERRORS, forgetContext, slack, SlackError, type Ctx } from './slack'
import { hub } from './hub'
import { rtm } from './rtm'

export type Env = { Variables: { session: Session; ctx: Ctx } }

const secure = config.secure
export const SESSION_COOKIE = secure ? 'sleck_session' : 'sleck_session_dev'
const STATE_COOKIE = secure ? 'sleck_oauth' : 'sleck_oauth_dev'
const cookieBase = { httpOnly: true, secure, sameSite: 'Lax' as const, path: '/' }

export const ctxFor = (s: Session): Ctx => ({ key: `${s.teamId}:${s.userId}`, token: s.token, teamId: s.teamId, userId: s.userId, kind: s.kind, cookie: s.cookie, host: s.host })

/** states we issued and have not yet consumed; single-use, 10 minute lifetime */
const pendingStates = new Map<string, number>()
function gcStates() {
  const now = Date.now()
  for (const [k, exp] of pendingStates) if (exp < now) pendingStates.delete(k)
}

export async function readSessionCookie(c: Context): Promise<string | null> {
  const v = await getSignedCookie(c, config.sessionSecret, SESSION_COOKIE)
  return typeof v === 'string' ? v : null
}

export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  const sid = await readSessionCookie(c)
  const session = sid ? getSession(sid) : null
  if (!session) {
    if (sid) deleteCookie(c, SESSION_COOKIE, { path: '/', secure })
    return c.json({ error: 'not_authenticated' }, 401)
  }
  c.set('session', session)
  c.set('ctx', ctxFor(session))
  await next()
}

/**
 * CSRF for state-changing routes. Three independent checks: same-origin Origin/Referer,
 * a per-session secret in a custom header (which cross-site forms cannot set), and the
 * SameSite=Lax cookie itself.
 */
export const csrf: MiddlewareHandler<Env> = async (c, next) => {
  const m = c.req.method
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next()
  const origin = c.req.header('origin') ?? (c.req.header('referer') ? new URL(c.req.header('referer')!).origin : null)
  if (origin !== config.origin) return c.json({ error: 'bad_origin' }, 403)
  const token = c.req.header('x-csrf-token') ?? ''
  if (!safeEqual(token, c.get('session').csrf)) return c.json({ error: 'bad_csrf' }, 403)
  return next()
}

/** End a session server-side (tabs are told, upstream sockets and caches dropped). */
export function endSession(session: Session) {
  hub.close(session.teamId, session.userId)
  rtm.stop(`${session.teamId}:${session.userId}`)
  forgetContext(`${session.teamId}:${session.userId}`)
  deleteSession(session.sid)
}

export function dropSession(c: Context, session: Session) {
  endSession(session)
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure })
}

export const auth = new Hono<Env>()

/** Which sign-in methods this deployment offers. */
auth.get('/modes', (c) => c.json({ oauth: oauthEnabled, web: true, allowlist: config.allowedUsers.length > 0 }))

auth.get('/login', async (c) => {
  if (!oauthEnabled) return c.redirect('/?auth_error=oauth_disabled', 302)
  gcStates()
  if (pendingStates.size > 200) return c.text('Too many pending logins', 429)
  const state = randomId(24)
  pendingStates.set(state, Date.now() + 10 * 60_000)
  // The state is also bound to this browser via a signed httpOnly cookie, so a state
  // minted for someone else's browser (login CSRF) is rejected at the callback.
  await setSignedCookie(c, STATE_COOKIE, state, config.sessionSecret, { ...cookieBase, maxAge: 600, path: '/auth' })
  const url = new URL(`${config.slackOauth}/oauth/v2/authorize`)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('user_scope', USER_SCOPES.join(','))
  url.searchParams.set('redirect_uri', `${config.appUrl}/auth/callback`)
  url.searchParams.set('state', state)
  return c.redirect(url.toString(), 302)
})

auth.get('/callback', async (c) => {
  const fail = (code: string) => {
    deleteCookie(c, STATE_COOKIE, { path: '/auth', secure })
    return c.redirect(`/?auth_error=${encodeURIComponent(code)}`, 302)
  }
  const { code, state, error } = c.req.query()
  const bound = await getSignedCookie(c, config.sessionSecret, STATE_COOKIE)
  if (!state || typeof bound !== 'string' || !safeEqual(state, bound) || !pendingStates.delete(state)) return fail('state_mismatch')
  if (error) return fail(error)
  if (!code) return fail('missing_code')

  try {
    const ctx: Ctx = { key: 'oauth', token: '', teamId: '', userId: '' }
    const r = await slack<any>(ctx, 'oauth.v2.access', {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: `${config.appUrl}/auth/callback`,
    }, { noAuth: true })
    const user = r.authed_user
    if (!user?.access_token || !user.id || !r.team?.id) return fail('no_user_token')
    if (config.allowedUsers.length && !config.allowedUsers.includes(user.id)) return fail('not_allowed')
    const { sid } = createSession(r.team.id, user.id, user.access_token, user.scope ?? '')
    deleteCookie(c, STATE_COOKIE, { path: '/auth', secure })
    await setSignedCookie(c, SESSION_COOKIE, sid, config.sessionSecret, { ...cookieBase, maxAge: 30 * 24 * 3600 })
    return c.redirect('/', 302)
  } catch (e) {
    console.error('oauth callback failed:', e instanceof SlackError ? e.code : 'unexpected')
    return fail(e instanceof SlackError ? e.code : 'oauth_failed')
  }
})

// ---- web-session import ---------------------------------------------------------------------------
// The browser session of a real Slack login (xoxc token + `d` cookie), packaged by
// scripts/grab-slack-session.mjs as base64url JSON. Validated against Slack before anything is stored.

const importHits: number[] = []
const reToken = /^xoxc-[A-Za-z0-9-]{20,200}$/
const reCookie = /^xoxd-[A-Za-z0-9%+/=._~-]{20,2000}$/
const reHost = /^[a-z0-9][a-z0-9.-]*\.slack\.com$/i

auth.post('/import', async (c) => {
  // Browsers must be same-origin; a non-browser client (the grab script) sends neither header.
  const origin = c.req.header('origin')
  if (origin ? origin !== config.origin : c.req.header('sec-fetch-site')) return c.json({ error: 'bad_origin' }, 403)
  const now = Date.now()
  while (importHits.length && now - importHits[0] > 60_000) importHits.shift()
  if (importHits.length >= 10) return c.json({ error: 'rate_limited' }, 429)
  importHits.push(now)

  const body = await c.req.json().catch(() => null)
  let creds: { token?: string; cookie?: string; host?: string } | null = null
  try {
    // either the grab script's base64url blob, or plain JSON pasted by hand
    const raw = String(body?.blob ?? '').trim()
    creds = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64url').toString('utf8'))
  } catch { /* handled below */ }
  const token = (creds?.token ?? '').trim()
  const cookie = (creds?.cookie ?? '').trim().replace(/^d=/, '')
  const host = (creds?.host ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!reToken.test(token) || !reCookie.test(cookie) || !reHost.test(host)) return c.json({ error: 'invalid_blob' }, 400)

  try {
    const ctx: Ctx = { key: 'import', token, cookie, host, teamId: '', userId: '', kind: 'web' }
    const r = await slack<any>(ctx, 'auth.test')
    if (config.allowedUsers.length && !config.allowedUsers.includes(r.user_id)) return c.json({ error: 'not_allowed' }, 403)
    const { sid } = createSession(r.team_id, r.user_id, token, 'web-session', { cookie, host })
    await setSignedCookie(c, SESSION_COOKIE, sid, config.sessionSecret, { ...cookieBase, maxAge: 30 * 24 * 3600 })
    return c.json({ ok: true, team: r.team, user: r.user })
  } catch (e) {
    return c.json({ error: e instanceof SlackError ? e.code : 'import_failed' }, 400)
  }
})

auth.post('/logout', requireSession, csrf, async (c) => {
  const session = c.get('session')
  const revoke = (await c.req.json().catch(() => ({})))?.revoke === true
  // Never revoke an imported browser session: that token is the user's real Slack login.
  if (revoke && session.kind === 'oauth') await slack(c.get('ctx'), 'auth.revoke').catch(() => undefined)
  dropSession(c, session)
  return c.json({ ok: true })
})

/** Map a thrown error to a response; a dead token ends the session. */
export async function handleError(err: unknown, c: Context): Promise<Response> {
  if (err instanceof SlackError) {
    if (AUTH_ERRORS.has(err.code)) {
      const sid = await readSessionCookie(c)
      const s = sid ? getSession(sid) : null
      if (s) dropSession(c, s)
      return c.json({ error: 'session_expired' }, 401)
    }
    if (err.code === 'rate_limited') {
      c.header('Retry-After', String(err.retryAfter ?? 5))
      return c.json({ error: 'rate_limited', retryAfter: err.retryAfter ?? 5 }, 429)
    }
    if (err.code === 'missing_scope') return c.json({ error: 'missing_scope', needed: err.data?.needed }, 403)
    if (err.code.startsWith('http_')) return c.json({ error: 'slack_unavailable' }, 502)
    return c.json({ error: err.code }, 400)
  }
  console.error('unhandled error:', err instanceof Error ? err.message : 'unknown')
  return c.json({ error: 'internal_error' }, 500)
}
