/**
 * Minimal fake Slack for local testing: OAuth v2, the Web API methods Sleck uses, and signed
 * Events API deliveries to the app. NOT a faithful Slack — it exists so the whole stack can be
 * exercised offline. Run: npm run mock-slack
 */
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createHmac } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'

const PORT = Number(process.env.MOCK_PORT ?? 4010)
const APP = process.env.APP_URL ?? 'http://localhost:3000'
const SIGNING = process.env.SLACK_SIGNING_SECRET ?? 'mock-signing-secret'
// where live events go: the Events API (OAuth install), the RTM socket (web session), or nowhere
const PUSH = (process.env.MOCK_PUSH ?? (process.env.MOCK_EVENTS === '0' ? 'none' : 'events')) as 'events' | 'rtm' | 'none'
const ME = 'U0000001'
const TEAM = 'T0000001'
const TOKEN = 'xoxp-mock-token'
const WEB_TOKEN = 'xoxc-1234567890-mock-web-token-abcdef'
const WEB_COOKIE = 'xoxd-mockcookievalue0123456789abcdef%2Bxyz'
const rtmClients = new Set<WebSocket>()

const svg = (c: string, t: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="${c}"/><text x="36" y="48" font-size="34" text-anchor="middle" fill="#fff" font-family="sans-serif">${t}</text></svg>`)}`
const user = (id: string, name: string, real: string, c: string, extra: any = {}) => ({
  id, name, real_name: real, team_id: TEAM, tz: 'Europe/Berlin',
  profile: { display_name: real, real_name: real, image_72: svg(c, real[0]), image_48: svg(c, real[0]), title: 'Tester' }, ...extra,
})
const users = [
  user(ME, 'matthias', 'Matthias Lubbertsen', '#3b82f6'),
  user('U0000002', 'alice', 'Alice Wonder', '#ef4444'),
  user('U0000003', 'bob', 'Bob Builder', '#22c55e'),
  user('U0000004', 'carol0', 'Carol Zero', '#a855f7'),
]
const channels: any[] = [
  { id: 'C0000001', name: 'general', is_channel: true, is_member: true, topic: { value: 'Company-wide announcements' }, purpose: { value: '' }, num_members: 4, created: 1700000000 },
  { id: 'C0000002', name: 'random', is_channel: true, is_member: true, topic: { value: '' }, purpose: { value: 'Anything goes' }, num_members: 3, created: 1700000000 },
  { id: 'C0000003', name: 'shared-with-acme', is_channel: true, is_member: true, is_ext_shared: true, shared_team_ids: [TEAM, 'T0000002'], topic: { value: '' }, purpose: { value: '' }, num_members: 6, created: 1700000000 },
  { id: 'G0000001', name: 'secret-plans', is_group: true, is_private: true, is_channel: false, is_member: true, topic: { value: '' }, purpose: { value: '' }, num_members: 2, created: 1700000000 },
  { id: 'D0000001', is_im: true, user: 'U0000002', created: 1700000000 },
  { id: 'D0000002', is_im: true, user: 'U0000003', created: 1700000000 },
  { id: 'M0000001', name: 'mpdm-matthias--alice--bob-1', is_mpim: true, is_private: true, is_member: true, created: 1700000000 },
]
const lastRead: Record<string, string> = {}
const msgs: Record<string, any[]> = {}
let seq = 0
const nowTs = () => `${Math.floor(Date.now() / 1000)}.${String(++seq).padStart(6, '0')}`
const addMsg = (channel: string, m: any) => ((msgs[channel] ??= []).push(m), m)

// seed: 120 messages in #general over several days, plus a thread, reactions, formatting
const base = Math.floor(Date.now() / 1000) - 5 * 86400
for (let i = 0; i < 120; i++) {
  const u = users[1 + (Math.floor(i / 2) % 3)]
  addMsg('C0000001', { type: 'message', user: u.id, ts: `${base + i * 3300}.${String(i + 1).padStart(6, '0')}`, text: i === 119 ? 'last seeded message for *bold* and _italic_ and `code`' : `seed message ${i} from ${u.name}` })
}
const mk = (channel: string, user: string, text: string, extra: any = {}) => addMsg(channel, { type: 'message', user, ts: nowTs(), text, ...extra })
const th = mk('C0000001', 'U0000002', 'Thread starter :tada: with <https://example.com|a link> and <@' + ME + '> mention and <#C0000002|random>', {
  reply_count: 2, reply_users: ['U0000003'], latest_reply: '0', reactions: [{ name: '+1', count: 2, users: [ME, 'U0000003'] }, { name: 'partyparrot', count: 1, users: ['U0000002'] }],
})
mk('C0000001', 'U0000003', '```\nconst x = 1\n```\n&gt; quoted line\n• bullet one\n• bullet two\n~struck~ and *bold _both_*', {})
for (const t of ['reply one', 'reply two']) mk('C0000001', 'U0000003', t, { thread_ts: th.ts })
th.latest_reply = msgs['C0000001'].at(-1).ts
mk('D0000001', 'U0000002', 'hey, got a minute?')
mk('D0000001', 'U0000002', 'also <@' + ME + '> look at this')
mk('C0000002', 'U0000003', 'random chatter')
mk('G0000001', ME, 'my own secret message')
lastRead['C0000001'] = msgs['C0000001'][100].ts
lastRead['C0000002'] = '0'
lastRead['D0000001'] = '0'
for (const c of ['C0000003', 'G0000001', 'D0000002', 'M0000001']) lastRead[c] = msgs[c]?.at(-1)?.ts ?? '0'

async function fire(event: any) {
  if (PUSH === 'rtm') {
    for (const ws of rtmClients) ws.send(JSON.stringify(event))
    return
  }
  if (PUSH !== 'events') return
  const body = JSON.stringify({ type: 'event_callback', team_id: TEAM, event_id: 'Ev' + Math.random().toString(36).slice(2), event, authorizations: [{ team_id: TEAM, user_id: ME, is_bot: false }] })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = 'v0=' + createHmac('sha256', SIGNING).update(`v0:${ts}:${body}`).digest('hex')
  await fetch(`${APP}/slack/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': ts, 'x-slack-signature': sig }, body }).catch((e) => console.log('event delivery failed', e.message))
}

const rateLimited = new Map<string, number>()
const app = new Hono()
const uploads = new Map<string, { name: string; size: number }>()

app.get('/oauth/v2/authorize', (c) => {
  const q = c.req.query()
  const u = new URL(q.redirect_uri)
  u.searchParams.set('code', 'mock-code')
  u.searchParams.set('state', q.state)
  return c.redirect(u.toString())
})
// stand-in for app.slack.com/client/<team>: sets the d cookie and the web client's localConfig_v2
app.get('/client/:team', (c) =>
  c.html(`<!doctype html><title>Mock Slack</title><script>localStorage.setItem('localConfig_v2', JSON.stringify({ teams: { ${TEAM}: { token: '${WEB_TOKEN}', url: 'https://mock.slack.com/', name: 'Mock Workspace', domain: 'mock' } } }))</script><p>signed in</p>`, 200, {
    'set-cookie': `d=${WEB_COOKIE}; Path=/; HttpOnly`,
  }))
app.get('/files/:name', (c) => c.body(new Uint8Array([137, 80, 78, 71]), 200, { 'content-type': 'image/png' }))
app.post('/upload/:id', async (c) => (c.req.param('id') && (await c.req.arrayBuffer()), c.text('OK')))

// test controls
app.post('/__inject', async (c) => {
  const { channel, user: u = 'U0000002', text, thread_ts } = await c.req.json()
  const m = mk(channel, u, text, thread_ts ? { thread_ts } : {})
  await fire({ type: 'message', channel, user: u, text, ts: m.ts, ...(thread_ts ? { thread_ts } : {}), channel_type: channel[0] === 'D' ? 'im' : 'channel' })
  return c.json({ ts: m.ts })
})
app.post('/__rtm-drop', (c) => {
  for (const ws of rtmClients) ws.terminate()
  return c.json({ dropped: rtmClients.size })
})
app.post('/__rate-limit', async (c) => (rateLimited.set((await c.req.json()).method, 1), c.json({ ok: true })))
app.post('/__revoke', (c) => ((revoked = true), c.json({ ok: true })))
let revoked = false

app.post('/api/:method', async (c) => {
  const method = c.req.param('method')
  const p: Record<string, string> = Object.fromEntries(new URLSearchParams(await c.req.text()))
  if (method === 'oauth.v2.access') {
    revoked = false
    return p.code === 'mock-code' && p.client_secret ? c.json({ ok: true, authed_user: { id: ME, access_token: TOKEN, scope: 'channels:read', token_type: 'user' }, team: { id: TEAM, name: 'Mock Workspace' } }) : c.json({ ok: false, error: 'invalid_code' })
  }
  const bearer = c.req.header('authorization') === `Bearer ${TOKEN}`
  const web = p.token === WEB_TOKEN && (c.req.header('cookie') ?? '').includes(`d=${WEB_COOKIE}`)
  if (revoked || !(bearer || web)) return c.json({ ok: false, error: revoked ? 'token_revoked' : 'invalid_auth' })
  if (rateLimited.has(method)) {
    rateLimited.delete(method)
    return c.json({ ok: false, error: 'ratelimited' }, 429, { 'Retry-After': '1' })
  }
  const ok = (x: any = {}) => c.json({ ok: true, ...x })
  const err = (e: string) => c.json({ ok: false, error: e })
  const chan = p.channel
  switch (method) {
    case 'rtm.connect': return ok({ url: `ws://localhost:${PORT}/rtm`, self: { id: ME }, team: { id: TEAM } })
    case 'client.counts': {
      const entry = (ch: any) => {
        const last = lastRead[ch.id] ?? '0'
        const newer = (msgs[ch.id] ?? []).filter((m) => Number(m.ts) > Number(last) && m.user !== ME && !m.thread_ts)
        return { id: ch.id, last_read: last, latest: msgs[ch.id]?.at(-1)?.ts ?? '0', has_unreads: newer.length > 0, mention_count: newer.filter((m) => ch.is_im || (m.text ?? '').includes(`<@${ME}>`)).length }
      }
      return ok({ channels: channels.filter((x) => x.is_channel || x.is_group).map(entry), mpims: channels.filter((x) => x.is_mpim).map(entry), ims: channels.filter((x) => x.is_im).map(entry) })
    }
    case 'users.channelSections.list': return ok({ channel_sections: [
      { channel_section_id: 'L2', name: 'Channels', type: 'channels', next_channel_section_id: 'L3', channel_ids_page: { channel_ids: ['C0000001', 'C0000002', 'C0000003'] } },
      { channel_section_id: 'L1', name: 'Starred', type: 'stars', next_channel_section_id: 'L2', channel_ids_page: { channel_ids: ['D0000001'] } },
      { channel_section_id: 'L3', name: 'Projects', type: 'standard', next_channel_section_id: 'L4', channel_ids_page: { channel_ids: ['G0000001'] } },
      { channel_section_id: 'L4', name: 'Direct messages', type: 'direct_messages', next_channel_section_id: null, channel_ids_page: { channel_ids: ['D0000002', 'M0000001'] } },
    ] })
    case 'users.prefs.get': return ok({ prefs: { muted_channels: 'C0000003' } })
    case 'conversations.members': return ok({ members: users.map((u) => u.id) })
    case 'auth.test': return ok({ team_id: TEAM, team: 'Mock Workspace', user_id: ME })
    case 'auth.revoke': revoked = true; return ok({ revoked: true })
    case 'team.info': return ok({ team: { id: p.team ?? TEAM, name: p.team ? 'Acme Corp' : 'Mock Workspace', domain: 'mock', icon: { image_44: svg(p.team ? '#f59e0b' : '#111', 'M') } } })
    case 'users.list': return ok({ members: users })
    case 'users.info': { const u = users.find((x) => x.id === p.user); return u ? ok({ user: u }) : err('user_not_found') }
    case 'users.getPresence': return ok({ presence: 'active' })
    case 'emoji.list': return ok({ emoji: { partyparrot: svg('#f0f', 'P'), parrot: 'alias:partyparrot' } })
    case 'users.conversations': return ok({ channels })
    case 'conversations.info': { const ch = channels.find((x) => x.id === chan); return ch ? ok({ channel: { ...ch, last_read: lastRead[chan] ?? '0' } }) : err('channel_not_found') }
    case 'conversations.open': return ok({ channel: { id: 'D0000002' } })
    case 'conversations.mark': lastRead[chan] = p.ts; void fire({ type: chan[0] === 'D' ? 'im_marked' : 'channel_marked', channel: chan, ts: p.ts, unread_count_display: 0, mention_count_display: 0 }); return ok()
    case 'conversations.history': case 'conversations.replies': {
      const all = (msgs[chan] ?? [])
      let list = method === 'conversations.replies' ? all.filter((m) => m.ts === p.ts || m.thread_ts === p.ts) : all.filter((m) => !m.thread_ts || m.thread_ts === m.ts || m.subtype === 'thread_broadcast')
      list = [...list].sort((a, b) => Number(a.ts) - Number(b.ts))
      const incl = p.inclusive === 'true'
      const latest = p.cursor ? p.cursor : p.latest
      if (method === 'conversations.history') {
        if (latest) list = list.filter((m) => (incl ? Number(m.ts) <= Number(latest) : Number(m.ts) < Number(latest)))
        if (p.oldest && p.oldest !== '0') list = list.filter((m) => (incl ? Number(m.ts) >= Number(p.oldest) : Number(m.ts) > Number(p.oldest)))
        const limit = Number(p.limit ?? 100)
        const hasMore = list.length > limit
        const page = list.slice(-limit).reverse()
        return ok({ messages: page, has_more: hasMore, response_metadata: { next_cursor: hasMore ? page.at(-1).ts : '' } })
      }
      return ok({ messages: list, has_more: false })
    }
    case 'chat.postMessage': {
      const m: any = mk(chan, ME, p.text, p.thread_ts ? { thread_ts: p.thread_ts } : {})
      if (p.thread_ts) {
        const parent = msgs[chan].find((x) => x.ts === p.thread_ts)
        if (parent) Object.assign(parent, { reply_count: (parent.reply_count ?? 0) + 1, latest_reply: m.ts, reply_users: [...new Set([...(parent.reply_users ?? []), ME])] })
        if (p.reply_broadcast === 'true') m.subtype = 'thread_broadcast'
      }
      void fire({ type: 'message', channel: chan, user: ME, text: p.text, ts: m.ts, ...(p.thread_ts ? { thread_ts: p.thread_ts } : {}), channel_type: chan[0] === 'D' ? 'im' : 'channel' })
      return ok({ ts: m.ts, channel: chan, message: m })
    }
    case 'chat.update': { const m = msgs[chan]?.find((x) => x.ts === p.ts); if (!m) return err('message_not_found'); m.text = p.text; m.edited = { user: ME, ts: nowTs() }; void fire({ type: 'message', subtype: 'message_changed', channel: chan, message: m, ts: nowTs() }); return ok({ ts: p.ts, text: p.text, message: m }) }
    case 'chat.delete': { const i = msgs[chan]?.findIndex((x) => x.ts === p.ts) ?? -1; if (i < 0) return err('message_not_found'); msgs[chan].splice(i, 1); void fire({ type: 'message', subtype: 'message_deleted', channel: chan, deleted_ts: p.ts, ts: nowTs() }); return ok() }
    case 'chat.getPermalink': return ok({ permalink: `https://mock.slack.com/archives/${chan}/p${p.message_ts.replace('.', '')}` })
    case 'reactions.add': case 'reactions.remove': {
      const m = msgs[chan]?.find((x) => x.ts === p.timestamp); if (!m) return err('message_not_found')
      m.reactions ??= []
      let r = m.reactions.find((x: any) => x.name === p.name)
      if (method === 'reactions.add') {
        if (r?.users.includes(ME)) return err('already_reacted')
        if (!r) m.reactions.push((r = { name: p.name, count: 0, users: [] }))
        r.users.push(ME); r.count++
      } else if (r) {
        r.users = r.users.filter((u: string) => u !== ME); r.count--
        if (!r.count) m.reactions = m.reactions.filter((x: any) => x !== r)
      } else return err('no_reaction')
      void fire({ type: method === 'reactions.add' ? 'reaction_added' : 'reaction_removed', user: ME, reaction: p.name, item: { type: 'message', channel: chan, ts: p.timestamp }, event_ts: nowTs() })
      return ok()
    }
    case 'pins.add': case 'pins.remove': return ok()
    case 'pins.list': return ok({ items: [] })
    case 'search.messages': {
      const q = p.query.toLowerCase()
      const matches = Object.entries(msgs).flatMap(([ch, ms]) => ms.filter((m) => m.text?.toLowerCase().includes(q)).map((m) => ({ type: 'message', user: m.user, username: users.find((u) => u.id === m.user)?.name, ts: m.ts, text: m.text.replace(new RegExp(q, 'ig'), (s: string) => `${s}`), channel: { id: ch, name: channels.find((x) => x.id === ch)?.name }, permalink: '#', ...(m.thread_ts ? { thread_ts: m.thread_ts } : {}) })))
      return ok({ messages: { matches: matches.slice(0, 20), paging: { page: 1, pages: 1, total: matches.length } } })
    }
    case 'files.getUploadURLExternal': { const id = 'F' + Math.random().toString(36).slice(2, 9).toUpperCase(); uploads.set(id, { name: p.filename, size: Number(p.length) }); return ok({ upload_url: `http://localhost:${PORT}/upload/${id}`, file_id: id }) }
    case 'files.completeUploadExternal': {
      const files = JSON.parse(p.files) as { id: string; title: string }[]
      const m = mk(p.channel_id, ME, p.initial_comment ?? '', { files: files.map((f) => ({ id: f.id, name: f.title, title: f.title, mimetype: 'image/png', filetype: 'png', size: uploads.get(f.id)?.size, url_private: `http://localhost:${PORT}/files/${f.title}`, thumb_720: `http://localhost:${PORT}/files/${f.title}`, thumb_720_w: 64, thumb_720_h: 64 })), ...(p.thread_ts ? { thread_ts: p.thread_ts } : {}) })
      void fire({ type: 'message', subtype: 'file_share', channel: p.channel_id, user: ME, text: m.text, ts: m.ts, files: m.files })
      return ok({ files })
    }
    default: return err('unknown_method')
  }
})

const server = serve({ fetch: app.fetch, port: PORT }, () => console.log(`mock slack on :${PORT} (push: ${PUSH})`))
const wss = new WebSocketServer({ noServer: true })
;(server as import('node:http').Server).on('upgrade', (req, socket, head) => {
  const authed = (req.headers.cookie ?? '').includes(`d=${WEB_COOKIE}`)
  if (!req.url?.startsWith('/rtm') || !authed) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => {
    rtmClients.add(ws)
    ws.on('close', () => rtmClients.delete(ws))
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', reply_to: m.id }))
    })
    ws.send(JSON.stringify({ type: 'hello' }))
  })
})
