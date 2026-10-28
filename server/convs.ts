import { cached, invalidate, peek, slack, slackAll, SlackError, AUTH_ERRORS, type Ctx } from './slack'
import { hub } from './hub'
import type { Conversation, UnreadState } from '../shared/types'

const TYPES = 'public_channel,private_channel,mpim,im'

function shape(c: any): Conversation {
  const type: Conversation['type'] = c.is_im ? 'dm' : c.is_mpim ? 'group_dm' : c.is_private || c.is_group ? 'private' : 'public'
  return {
    id: c.id,
    type,
    name: c.name ?? c.name_normalized ?? '',
    user: c.user,
    isArchived: !!c.is_archived,
    isMember: c.is_member !== false,
    isExtShared: !!(c.is_ext_shared || c.is_org_shared),
    sharedTeamIds: c.shared_team_ids ?? [],
    contextTeamId: c.context_team_id,
    topic: c.topic?.value ?? '',
    purpose: c.purpose?.value ?? '',
    numMembers: c.num_members,
    created: c.created ?? 0,
  }
}

export async function listConversations(ctx: Ctx, force = false): Promise<Conversation[]> {
  const key = `${ctx.key}:convs`
  if (force) invalidate(key)
  return cached(key, 60_000, async () => {
    const raw = await slackAll(ctx, 'users.conversations', 'channels', { types: TYPES, exclude_archived: true })
    return raw.map(shape)
  })
}

// ---- unread tracking --------------------------------------------------------------------------
// Slack has no "unread counts" endpoint for user tokens, so we derive them: last_read from
// conversations.info, newest message from conversations.history, then count what is newer.

const cmp = (a: string, b: string) => Number(a) - Number(b)
const empty = (): UnreadState => ({ lastRead: '0', latestTs: '0', unread: 0, mentions: 0, known: false })

const states = new Map<string, Map<string, UnreadState>>()
const hydrating = new Set<string>()

const stateMap = (key: string) => {
  let m = states.get(key)
  if (!m) states.set(key, (m = new Map()))
  return m
}

export const snapshotUnread = (key: string): Record<string, UnreadState> => Object.fromEntries(stateMap(key))
export const forgetUnread = (key: string) => void states.delete(key)

function counts(msg: any): boolean {
  if (msg.subtype && /^(channel|group)_/.test(msg.subtype)) return false
  return !(msg.thread_ts && msg.thread_ts !== msg.ts && msg.subtype !== 'thread_broadcast')
}

export function isMention(text: string, me: string, type: Conversation['type']): boolean {
  if (type === 'dm') return true
  return text.includes(`<@${me}>`) || /<!(channel|here|everyone)\b/.test(text)
}

function publish(ctx: Ctx, channel: string, state: UnreadState) {
  hub.publish(ctx.teamId, ctx.userId, { type: 'unread', channel, state })
}

async function fetchState(ctx: Ctx, conv: Conversation, priority: 'high' | 'low'): Promise<UnreadState> {
  const info = await slack(ctx, 'conversations.info', { channel: conv.id }, { priority })
  const lastRead: string = info.channel?.last_read ?? '0'
  const hist = await slack(ctx, 'conversations.history', { channel: conv.id, limit: 1 }, { priority })
  const latestTs: string = hist.messages?.[0]?.ts ?? '0'
  let unread = 0
  let mentions = 0
  if (cmp(latestTs, lastRead) > 0) {
    const h = await slack(ctx, 'conversations.history', { channel: conv.id, oldest: lastRead, limit: 100 }, { priority })
    for (const m of h.messages ?? []) {
      if (m.user === ctx.userId || !counts(m)) continue
      unread++
      if (isMention(m.text ?? '', ctx.userId, conv.type)) mentions++
    }
  }
  return { lastRead, latestTs, unread, mentions, known: true }
}

export async function refresh(ctx: Ctx, channel: string, priority: 'high' | 'low' = 'high') {
  const conv = (await listConversations(ctx)).find((c) => c.id === channel)
  if (!conv) return
  const s = await fetchState(ctx, conv, priority)
  stateMap(ctx.key).set(channel, s)
  publish(ctx, channel, s)
  return s
}

/** Background fill of unread state; low priority so it never starves user actions. */
export async function hydrate(ctx: Ctx, convs: Conversation[], pinned: string[]) {
  if (hydrating.has(ctx.key)) return
  hydrating.add(ctx.key)
  const rank = (c: Conversation) => (pinned.includes(c.id) ? 0 : c.type === 'public' || c.type === 'private' ? 1 : c.type === 'group_dm' ? 2 : 3)
  const todo = convs.filter((c) => !stateMap(ctx.key).get(c.id)?.known).sort((a, b) => rank(a) - rank(b)).slice(0, 400)
  try {
    for (const c of todo) {
      if (!states.has(ctx.key)) return // session ended
      try {
        await refresh(ctx, c.id, 'low')
      } catch (e) {
        if (e instanceof SlackError && (AUTH_ERRORS.has(e.code) || e.code === 'rate_limited')) throw e
        // not_in_channel, channel_not_found, ...: skip this one
      }
    }
  } catch (e) {
    if (e instanceof SlackError && e.code === 'rate_limited') {
      setTimeout(() => void listConversations(ctx).then((cs) => hydrate(ctx, cs, pinned)).catch(() => undefined), (e.retryAfter ?? 30) * 1000)
    }
  } finally {
    hydrating.delete(ctx.key)
  }
}

/** Apply a live message event (Events API) to unread state. */
export function applyMessageEvent(team: string, me: string, ev: any, convs: Conversation[] | undefined) {
  const key = `${team}:${me}`
  const map = states.get(key)
  if (!map || !ev.channel || ev.type !== 'message') return
  if (ev.subtype === 'message_changed' || ev.subtype === 'message_deleted') return
  if (!counts(ev)) return
  const conv = convs?.find((c) => c.id === ev.channel)
  if (!conv) {
    invalidate(`${key}:convs`)
    hub.publish(team, me, { type: 'conversations' })
    return
  }
  const prev = map.get(ev.channel) ?? empty()
  const next: UnreadState = { ...prev, latestTs: ev.ts, known: prev.known }
  if (ev.user === me) {
    next.lastRead = ev.ts
    next.unread = 0
    next.mentions = 0
  } else {
    next.unread = prev.unread + 1
    next.mentions = prev.mentions + (isMention(ev.text ?? '', me, conv.type) ? 1 : 0)
  }
  map.set(ev.channel, next)
  hub.publish(team, me, { type: 'unread', channel: ev.channel, state: next })
}

export async function markRead(ctx: Ctx, channel: string, ts: string) {
  await slack(ctx, 'conversations.mark', { channel, ts })
  const map = stateMap(ctx.key)
  const prev = map.get(channel)
  if (prev && cmp(ts, prev.latestTs) >= 0) {
    const next = { ...prev, lastRead: ts, unread: 0, mentions: 0 }
    map.set(channel, next)
    publish(ctx, channel, next)
  } else {
    await refresh(ctx, channel, 'high')
  }
}

// ---- web sessions: Slack's own counters ---------------------------------------------------------------

/**
 * `client.counts` (what the web client uses) returns last_read / latest / mention counts for every
 * conversation in one call. When it only says `has_unreads`, the count is approximate.
 */
export async function loadCounts(ctx: Ctx): Promise<boolean> {
  const r = await slack(ctx, 'client.counts', { thread_counts_by_channel: true, org_wide_aware: true, include_file_channels: false })
  const map = stateMap(ctx.key)
  const per: Record<string, unknown> = r.unread_count_by_channel ?? {}
  const mentionBy: Record<string, unknown> = r.mention_count_by_channel ?? {}
  let n = 0
  for (const e of [...(r.channels ?? []), ...(r.mpims ?? []), ...(r.ims ?? [])]) {
    if (!e?.id) continue
    const exact = typeof per[e.id] === 'number'
    const count = exact ? (per[e.id] as number) : e.has_unreads ? 1 : 0
    const mentions = Number(e.mention_count ?? mentionBy[e.id] ?? 0) || 0
    const st: UnreadState = {
      lastRead: String(e.last_read ?? '0'),
      latestTs: String(e.latest ?? '0'),
      unread: Math.max(count, mentions),
      mentions,
      known: true,
      approx: !exact && count > 0,
    }
    map.set(e.id, st)
    n++
  }
  return n > 0
}

/** RTM `channel_marked` / `im_marked` / `group_marked`: read state changed (maybe on another device). */
export function applyMarked(team: string, me: string, ev: any) {
  const map = states.get(`${team}:${me}`)
  if (!map || !ev.channel) return
  const prev = map.get(ev.channel) ?? empty()
  const next: UnreadState = {
    ...prev,
    lastRead: ev.ts ?? prev.lastRead,
    unread: Number(ev.unread_count_display ?? ev.unread_count ?? 0) || 0,
    mentions: Number(ev.mention_count_display ?? ev.mention_count ?? 0) || 0,
    known: true,
    approx: false,
  }
  map.set(ev.channel, next)
  hub.publish(team, me, { type: 'unread', channel: ev.channel, state: next })
}

export const cachedConversations = (key: string) => peek<Conversation[]>(`${key}:convs`)
