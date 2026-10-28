import { Hono } from 'hono'
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { streamSSE } from 'hono/streaming'
import { config } from './config'
import { csrf, handleError, requireSession, type Env } from './auth'
import { getPrefs, setPrefs } from './db'
import { cached, invalidate, slack, slackAll, SlackError } from './slack'
import { hydrate, listConversations, markRead, refresh, snapshotUnread } from './convs'
import { hub } from './hub'
import type { Bootstrap, Prefs, TeamLite, UserLite } from '../shared/types'

export const api = new Hono<Env>()
api.use('*', requireSession, csrf)
const reChannel = /^[A-Z][A-Z0-9]{2,20}$/
const reTs = /^\d{9,11}\.\d{1,6}$/
const reEmoji = /^[\w+\-':]{1,100}$/

class BadRequest extends Error {}
api.onError(async (err, c) => (err instanceof BadRequest ? c.json({ error: 'bad_request', detail: err.message }, 400) : handleError(err, c)))

function pick(v: unknown, re: RegExp, what: string): string {
  if (typeof v !== 'string' || !re.test(v)) throw new BadRequest(what)
  return v
}
const channelOf = (v: unknown) => pick(v, reChannel, 'channel')
const tsOf = (v: unknown) => pick(v, reTs, 'ts')
const optTs = (v: unknown) => (v === undefined || v === '' ? undefined : tsOf(v))
function textOf(v: unknown): string {
  if (typeof v !== 'string' || v.length > 40_000) throw new BadRequest('text')
  return v
}

async function body(c: Context): Promise<any> {
  const b = await c.req.json().catch(() => null)
  if (!b || typeof b !== 'object') throw new BadRequest('json body')
  return b
}

// ---- directory data (cached) ---------------------------------------------------------------------

const toUser = (u: any): UserLite => ({
  id: u.id,
  name: u.name ?? '',
  display: u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id,
  real: u.profile?.real_name || u.real_name || '',
  avatar: u.profile?.image_72 || u.profile?.image_48 || '',
  isBot: !!u.is_bot || u.id === 'USLACKBOT',
  deleted: !!u.deleted,
  teamId: u.team_id,
  tz: u.tz,
  title: u.profile?.title || undefined,
})

api.get('/users', compress(), async (c) => {
  const ctx = c.get('ctx')
  const users = await cached(`${ctx.key}:users`, 15 * 60_000, async () => (await slackAll(ctx, 'users.list', 'members', {}, {}, 60)).map(toUser))
  return c.json({ users })
})

api.get('/users/lookup', async (c) => {
  const ctx = c.get('ctx')
  const ids = (c.req.query('ids') ?? '').split(',').filter((i) => /^[UWB][A-Z0-9]{2,20}$/.test(i)).slice(0, 30)
  const out: UserLite[] = []
  await Promise.all(ids.map(async (id) => {
    try {
      out.push(await cached(`${ctx.key}:user:${id}`, 3600_000, async () => toUser((await slack(ctx, 'users.info', { user: id })).user)))
    } catch (e) {
      if (e instanceof SlackError && e.code !== 'user_not_found') throw e
    }
  }))
  return c.json({ users: out })
})

const toTeam = (t: any): TeamLite => ({ id: t.id, name: t.name, domain: t.domain, icon: t.icon?.image_44 || t.icon?.image_68 })

api.get('/teams', async (c) => {
  const ctx = c.get('ctx')
  const ids = (c.req.query('ids') ?? '').split(',').filter((i) => /^T[A-Z0-9]{2,20}$/.test(i)).slice(0, 20)
  const teams: TeamLite[] = []
  await Promise.all(ids.map(async (id) => {
    try {
      teams.push(await cached(`${ctx.key}:team:${id}`, 3600_000, async () => toTeam((await slack(ctx, 'team.info', id === ctx.teamId ? {} : { team: id })).team)))
    } catch (e) {
      if (e instanceof SlackError && (e.code === 'rate_limited' || e.code === 'session_expired')) throw e
      teams.push({ id, name: id }) // Connect teams may be unreadable; fall back to the id
    }
  }))
  return c.json({ teams })
})

api.get('/emoji', compress(), async (c) => {
  const ctx = c.get('ctx')
  const emoji = await cached(`${ctx.key}:emoji`, 30 * 60_000, async () => {
    const raw: Record<string, string> = (await slack(ctx, 'emoji.list')).emoji ?? {}
    const resolve = (v: string, depth = 0): string | null => {
      if (!v.startsWith('alias:')) return v
      const next = raw[v.slice(6)]
      return next && depth < 5 ? resolve(next, depth + 1) : null
    }
    const out: Record<string, string> = {}
    const aliases: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (v.startsWith('alias:')) aliases[k] = v.slice(6)
      const url = resolve(v)
      if (url) out[k] = url
    }
    return { emoji: out, aliases }
  })
  return c.json(emoji)
})

// ---- bootstrap -----------------------------------------------------------------------------------

api.get('/bootstrap', async (c) => {
  const ctx = c.get('ctx')
  const s = c.get('session')
  const [teamInfo, conversations] = await Promise.all([
    cached(`${ctx.key}:teaminfo`, 3600_000, async () => {
      const t = await slack(ctx, 'team.info').catch(() => null)
      if (t?.team) return toTeam(t.team)
      const a = await slack(ctx, 'auth.test')
      return { id: a.team_id, name: a.team } as TeamLite
    }),
    listConversations(ctx, c.req.query('refresh') === '1'),
  ])
  const prefs = getPrefs(ctx.teamId, ctx.userId)
  void hydrate(ctx, conversations, prefs.pinned)
  const out: Bootstrap = {
    me: { userId: ctx.userId, team: teamInfo, csrf: s.csrf, scopes: s.scopes },
    conversations,
    unread: snapshotUnread(ctx.key),
    prefs,
    realtime: hub.realtime(ctx.teamId, ctx.userId),
  }
  return c.json(out)
})

api.get('/prefs', (c) => c.json(getPrefs(c.get('ctx').teamId, c.get('ctx').userId)))
api.put('/prefs', async (c) => {
  const ctx = c.get('ctx')
  return c.json(setPrefs(ctx.teamId, ctx.userId, (await body(c)) as Prefs))
})

// ---- reading --------------------------------------------------------------------------------------

api.get('/history', async (c) => {
  const q = c.req.query()
  const r = await slack(c.get('ctx'), 'conversations.history', {
    channel: channelOf(q.channel),
    cursor: q.cursor || undefined,
    latest: optTs(q.latest),
    oldest: optTs(q.oldest),
    inclusive: q.inclusive === '1' ? 'true' : undefined,
    limit: Math.min(100, Math.max(1, Number(q.limit) || 50)),
  })
  return c.json({ messages: r.messages ?? [], hasMore: !!r.has_more, next: r.response_metadata?.next_cursor || null })
})

api.get('/replies', async (c) => {
  const q = c.req.query()
  const r = await slack(c.get('ctx'), 'conversations.replies', {
    channel: channelOf(q.channel),
    ts: tsOf(q.ts),
    cursor: q.cursor || undefined,
    oldest: optTs(q.oldest),
    limit: 100,
  })
  return c.json({ messages: r.messages ?? [], hasMore: !!r.has_more, next: r.response_metadata?.next_cursor || null })
})

api.get('/conversation', async (c) => {
  const ctx = c.get('ctx')
  const id = channelOf(c.req.query('channel'))
  const info = await cached(`${ctx.key}:info:${id}`, 60_000, () => slack(ctx, 'conversations.info', { channel: id, include_num_members: true }))
  return c.json({ channel: info.channel })
})

api.get('/presence', async (c) => {
  const user = pick(c.req.query('user'), /^[UW][A-Z0-9]{2,20}$/, 'user')
  const r = await slack(c.get('ctx'), 'users.getPresence', { user })
  return c.json({ presence: r.presence as 'active' | 'away' })
})

api.get('/pins', async (c) => {
  const r = await slack(c.get('ctx'), 'pins.list', { channel: channelOf(c.req.query('channel')) })
  return c.json({ items: r.items ?? [] })
})

api.get('/permalink', async (c) => {
  const q = c.req.query()
  const r = await slack(c.get('ctx'), 'chat.getPermalink', { channel: channelOf(q.channel), message_ts: tsOf(q.ts) })
  return c.json({ permalink: r.permalink as string })
})

api.get('/search', async (c) => {
  const q = c.req.query()
  const query = (q.query ?? '').trim()
  if (!query || query.length > 500) throw new BadRequest('query')
  const r = await slack(c.get('ctx'), 'search.messages', {
    query,
    count: 20,
    page: Math.max(1, Number(q.page) || 1),
    sort: 'timestamp',
    sort_dir: 'desc',
    highlight: true,
  })
  return c.json({ messages: r.messages ?? { matches: [], paging: { page: 1, pages: 1, total: 0 } } })
})

// ---- writing --------------------------------------------------------------------------------------

api.post('/send', async (c) => {
  const b = await body(c)
  const ctx = c.get('ctx')
  const channel = channelOf(b.channel)
  const r = await slack(ctx, 'chat.postMessage', {
    channel,
    text: textOf(b.text),
    thread_ts: optTs(b.thread_ts),
    reply_broadcast: b.thread_ts && b.reply_broadcast ? 'true' : undefined,
  })
  return c.json({ ts: r.ts as string, message: r.message })
})

api.post('/update', async (c) => {
  const b = await body(c)
  const r = await slack(c.get('ctx'), 'chat.update', { channel: channelOf(b.channel), ts: tsOf(b.ts), text: textOf(b.text) })
  return c.json({ message: r.message, text: r.text })
})

api.post('/delete', async (c) => {
  const b = await body(c)
  await slack(c.get('ctx'), 'chat.delete', { channel: channelOf(b.channel), ts: tsOf(b.ts) })
  return c.json({ ok: true })
})

api.post('/react', async (c) => {
  const b = await body(c)
  const name = pick(b.name, reEmoji, 'name')
  await slack(c.get('ctx'), b.remove ? 'reactions.remove' : 'reactions.add', { channel: channelOf(b.channel), timestamp: tsOf(b.ts), name })
  return c.json({ ok: true })
})

api.post('/pin', async (c) => {
  const b = await body(c)
  await slack(c.get('ctx'), b.remove ? 'pins.remove' : 'pins.add', { channel: channelOf(b.channel), timestamp: tsOf(b.ts) })
  return c.json({ ok: true })
})

api.post('/mark', async (c) => {
  const b = await body(c)
  await markRead(c.get('ctx'), channelOf(b.channel), tsOf(b.ts))
  return c.json({ ok: true })
})

api.post('/refresh-unread', async (c) => {
  const s = await refresh(c.get('ctx'), channelOf((await body(c)).channel))
  return c.json({ state: s ?? null })
})

api.post('/open-dm', async (c) => {
  const b = await body(c)
  const ctx = c.get('ctx')
  const users = Array.isArray(b.users) ? b.users.filter((u: unknown) => typeof u === 'string' && /^[UW][A-Z0-9]{2,20}$/.test(u)).slice(0, 8) : []
  if (!users.length) throw new BadRequest('users')
  const r = await slack(ctx, 'conversations.open', { users: users.join(','), return_im: true })
  invalidate(`${ctx.key}:convs`)
  return c.json({ channel: r.channel?.id as string })
})

api.post('/upload', bodyLimit({ maxSize: 100 * 1024 * 1024 }), async (c) => {
  const ctx = c.get('ctx')
  const form = await c.req.parseBody({ all: true })
  const channel = channelOf(form.channel)
  const raw = form.files
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => typeof f !== 'string')
  if (!files.length || files.length > 10) throw new BadRequest('files')
  const done: { id: string; title: string }[] = []
  for (const f of files) {
    const name = (f.name || 'file').slice(0, 200)
    const up = await slack(ctx, 'files.getUploadURLExternal', { filename: name, length: f.size })
    const put = await fetch(up.upload_url, { method: 'POST', body: f, signal: AbortSignal.timeout(120_000) })
    if (!put.ok) throw new SlackError('upload_failed', 502)
    done.push({ id: up.file_id, title: name })
  }
  const comment = typeof form.comment === 'string' && form.comment ? textOf(form.comment) : undefined
  const r = await slack(ctx, 'files.completeUploadExternal', {
    files: done,
    channel_id: channel,
    thread_ts: typeof form.thread_ts === 'string' ? optTs(form.thread_ts) : undefined,
    initial_comment: comment,
  })
  return c.json({ files: r.files ?? [] })
})

// ---- authenticated file proxy (so the token never leaves the server) --------------------------------

const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav))$/

function allowedFileHost(u: URL): boolean {
  if (u.protocol !== 'https:' && u.origin !== new URL(config.slackApi).origin) return false
  const h = u.hostname
  return h === 'files.slack.com' || h === 'files-edge.slack.com' || h.endsWith('.slack-files.com') || u.origin === new URL(config.slackApi).origin
}

api.get('/file', async (c) => {
  let url: URL
  try {
    url = new URL(c.req.query('url') ?? '')
  } catch {
    throw new BadRequest('url')
  }
  const token = c.get('session').token
  let upstream: Response | null = null
  for (let hop = 0; hop < 3; hop++) {
    if (!allowedFileHost(url)) throw new BadRequest('host not allowed')
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
    const range = c.req.header('range')
    if (range) headers.Range = range
    upstream = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) })
    const loc = upstream.headers.get('location')
    if (upstream.status >= 300 && upstream.status < 400 && loc) {
      url = new URL(loc, url) // re-validated on the next hop; token is only ever sent to allowed hosts
      continue
    }
    break
  }
  if (!upstream || !upstream.ok && upstream.status !== 206) return c.json({ error: 'file_unavailable' }, 404)
  const type = (upstream.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase()
  const inline = INLINE_TYPES.test(type) && c.req.query('download') !== '1'
  const name = (c.req.query('name') ?? 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
  const headers = new Headers({
    'Content-Type': inline ? type : 'application/octet-stream',
    'Content-Disposition': inline ? 'inline' : `attachment; filename="${name}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=3600',
  })
  for (const h of ['content-length', 'content-range', 'accept-ranges']) {
    const v = upstream.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers })
})

// ---- realtime ---------------------------------------------------------------------------------------

api.get('/stream', (c) => {
  const { teamId, userId } = c.get('ctx')
  c.header('X-Accel-Buffering', 'no')
  c.header('Cache-Control', 'no-cache, no-transform')
  return streamSSE(c, async (stream) => {
    const unsub = hub.subscribe(teamId, userId, (e) => {
      void stream.writeSSE({ event: 'm', data: JSON.stringify(e) }).catch(() => undefined)
    })
    stream.onAbort(unsub)
    await stream.writeSSE({ event: 'm', data: JSON.stringify({ type: 'hello', realtime: hub.realtime(teamId, userId), unread: snapshotUnread(c.get('ctx').key) }) })
    while (!stream.aborted && !stream.closed) {
      await stream.sleep(20_000)
      await stream.writeSSE({ event: 'ping', data: '' }).catch(() => undefined)
    }
    unsub()
  })
})
