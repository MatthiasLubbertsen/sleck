import { create } from 'zustand'
import type { Conversation, LiveState, Me, Prefs, Section, StreamEvent, TeamLite, UnreadState, UserLite } from '../../../shared/types'
import { api, ApiError, hooks, refreshUnread, setCsrf } from './api'
import { cmpTs, uid } from './utils'
import { loadEmoji } from './emoji'
import { socket } from './socket'

export interface Reaction { name: string; count: number; users: string[] }
export interface Msg {
  ts: string
  user?: string
  text?: string
  thread_ts?: string
  reply_count?: number
  reply_users?: string[]
  latest_reply?: string
  reactions?: Reaction[]
  files?: any[]
  attachments?: any[]
  blocks?: any[]
  subtype?: string
  edited?: { user: string; ts: string }
  bot_id?: string
  bot_profile?: any
  username?: string
  icons?: any
  pinned_to?: string[]
  [k: string]: any
}
export interface Pending extends Msg {
  clientId: string
  state: 'sending' | 'failed'
  error?: string
  broadcast?: boolean
  fileList?: File[]
}
export interface ChanState {
  msgs: Msg[]
  pending: Pending[]
  hasOlder: boolean
  /** true when showing a window around an old message rather than the live tail */
  detached: boolean
  status: 'loading' | 'ready' | 'error'
  loadingOlder: boolean
  error?: string
}
export interface ThreadRef { channel: string; ts: string; focus?: string }
export interface Toast { id: string; text: string; kind: 'info' | 'error' }
export interface SearchState { query: string; loading: boolean; error?: string; matches: any[]; total: number; page: number; pages: number }

const blank = (): ChanState => ({ msgs: [], pending: [], hasOlder: false, detached: false, status: 'loading', loadingOlder: false })
export const threadKey = (channel: string, ts: string) => `${channel}:${ts}`

export function upsert(list: Msg[], m: Msg): Msg[] {
  const i = list.findIndex((x) => x.ts === m.ts)
  if (i >= 0) {
    const next = list.slice()
    next[i] = { ...list[i], ...m }
    return next
  }
  const next = [...list, m]
  next.sort((a, b) => cmpTs(a.ts, b.ts))
  return next
}
const mapMsg = (list: Msg[], ts: string, fn: (m: Msg) => Msg) => (list.some((m) => m.ts === ts) ? list.map((m) => (m.ts === ts ? fn(m) : m)) : list)

function react(m: Msg, name: string, user: string, add: boolean): Msg {
  const rs = m.reactions ?? []
  const r = rs.find((x) => x.name === name)
  if (add) {
    if (r?.users.includes(user)) return m
    return { ...m, reactions: r ? rs.map((x) => (x === r ? { ...r, count: r.count + 1, users: [...r.users, user] } : x)) : [...rs, { name, count: 1, users: [user] }] }
  }
  if (!r || !r.users.includes(user)) return m
  const left = { ...r, count: r.count - 1, users: r.users.filter((u) => u !== user) }
  return { ...m, reactions: left.count > 0 ? rs.map((x) => (x === r ? left : x)) : rs.filter((x) => x !== r) }
}

interface State {
  status: 'loading' | 'anon' | 'ready' | 'expired' | 'error'
  authError?: string
  me?: Me
  convs: Conversation[]
  unread: Record<string, UnreadState>
  prefs: Prefs
  users: Record<string, UserLite>
  teams: Record<string, TeamLite>
  customEmoji: Record<string, string>
  emojiVersion: number
  /** what feeds us live updates server-side (Events API / RTM), as the server reports it */
  live: LiveState
  /** is our own WebSocket to the server up */
  socketUp: boolean
  rateLimitedUntil: number
  sections?: Section[]
  slackMuted: string[]
  sidebarView: 'home' | 'dms' | 'activity'

  channelId?: string
  anchor?: string
  thread: ThreadRef | null
  chans: Record<string, ChanState>
  threads: Record<string, ChanState>
  openedLastRead: Record<string, string>
  noAutoMark: Record<string, true>
  drafts: Record<string, string>
  /** touch devices: the message whose action bar is open (tap to open) */
  touchActive: string | null
  /** ts of the own message being edited inline */
  editTs: string | null

  drawer: boolean
  switcher: boolean
  searchOpen: boolean
  shortcuts: boolean
  search: SearchState
  toasts: Toast[]
  /** text for the screen-reader live region */
  announce: string

  init: () => Promise<void>
  refreshConvs: () => Promise<void>
  selectChannel: (id: string, o?: { anchor?: string; thread?: string; history?: 'push' | 'none' }) => Promise<void>
  loadOlder: (channel: string) => Promise<void>
  jumpToLatest: (channel: string) => Promise<void>
  syncChannel: (channel: string) => Promise<void>
  openThread: (channel: string, ts: string, focus?: string) => Promise<void>
  closeThread: () => void
  syncThread: () => Promise<void>
  send: (o: { channel: string; text: string; thread_ts?: string; broadcast?: boolean; files?: File[] }) => Promise<void>
  retry: (channel: string, clientId: string, thread_ts?: string) => void
  discard: (channel: string, clientId: string, thread_ts?: string) => void
  edit: (channel: string, ts: string, text: string) => Promise<void>
  remove: (channel: string, ts: string) => Promise<void>
  toggleReaction: (channel: string, ts: string, name: string) => Promise<void>
  togglePin: (channel: string, ts: string) => Promise<void>
  markUnreadAt: (channel: string, ts: string) => Promise<void>
  markRead: (channel: string, ts: string) => void
  setPrefs: (fn: (p: Prefs) => Prefs) => void
  setDraft: (key: string, text: string) => void
  ensureUsers: (ids: string[]) => void
  ensureTeams: (ids: string[]) => void
  toast: (text: string, kind?: Toast['kind']) => void
  runSearch: (query: string, page?: number) => Promise<void>
  openDm: (userId: string) => Promise<void>
  set: (p: Partial<State>) => void
  logout: (revoke: boolean) => Promise<void>
}

const errText = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'rate_limited') return `Slack is rate limiting requests. Try again in ${e.retryAfter ?? 5}s.`
    if (e.code === 'missing_scope') return 'This needs a Slack permission the app does not have. Reinstall the app from the manifest.'
    return `Slack said: ${e.code.replace(/_/g, ' ')}`
  }
  return 'Network error'
}

const seenReplies = new Set<string>()
const wantUsers = new Set<string>()
let userTimer: ReturnType<typeof setTimeout> | undefined
const wantTeams = new Set<string>()
let teamTimer: ReturnType<typeof setTimeout> | undefined
let convTimer: ReturnType<typeof setTimeout> | undefined
const markTimers: Record<string, ReturnType<typeof setTimeout>> = {}

export const useStore = create<State>((set, get) => {
  const patchChan = (id: string, fn: (c: ChanState) => ChanState) =>
    set((s) => ({ chans: { ...s.chans, [id]: fn(s.chans[id] ?? blank()) } }))
  const patchThread = (key: string, fn: (c: ChanState) => ChanState) =>
    set((s) => ({ threads: { ...s.threads, [key]: fn(s.threads[key] ?? blank()) } }))
  /** apply to the channel list and every loaded thread of that channel */
  const everywhere = (channel: string, fn: (list: Msg[]) => Msg[]) =>
    set((s) => {
      const chans = s.chans[channel] ? { ...s.chans, [channel]: { ...s.chans[channel], msgs: fn(s.chans[channel].msgs) } } : s.chans
      const threads = { ...s.threads }
      for (const k of Object.keys(threads)) if (k.startsWith(channel + ':')) threads[k] = { ...threads[k], msgs: fn(threads[k].msgs) }
      return { chans, threads }
    })
  const noteUsers = (msgs: Msg[]) => {
    const ids = new Set<string>()
    for (const m of msgs) {
      if (m.user) ids.add(m.user)
      for (const r of m.reactions ?? []) r.users.forEach((u) => ids.add(u))
      for (const u of m.reply_users ?? []) ids.add(u)
      for (const x of (m.text ?? '').matchAll(/<@([UW][A-Z0-9]+)/g)) ids.add(x[1])
    }
    get().ensureUsers([...ids])
  }

  return {
    status: 'loading',
    convs: [],
    unread: {},
    prefs: { pinned: [], muted: [], collapsed: [] },
    users: {},
    teams: {},
    customEmoji: {},
    emojiVersion: 0,
    live: 'none',
    socketUp: false,
    rateLimitedUntil: 0,
    slackMuted: [],
    sidebarView: 'home',
    thread: null,
    chans: {},
    threads: {},
    openedLastRead: {},
    noAutoMark: {},
    drafts: {},
    editTs: null,
    touchActive: null,
    drawer: false,
    switcher: false,
    searchOpen: false,
    shortcuts: false,
    search: { query: '', loading: false, matches: [], total: 0, page: 1, pages: 1 },
    toasts: [],
    announce: '',

    set: (p) => set(p),

    toast: (text, kind = 'info') => {
      const id = uid()
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }))
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 8000 : 4000)
    },

    init: async () => {
      hooks.unauthorized = () => {
        if (get().status === 'ready') set({ status: 'expired' })
        socket.stop()
      }
      hooks.rateLimited = (s) => set({ rateLimitedUntil: Date.now() + s * 1000 })
      const q = new URLSearchParams(location.search)
      try {
        const b = await api.bootstrap()
        setCsrf(b.me.csrf)
        set({ status: 'ready', me: b.me, convs: b.conversations, unread: b.unread, prefs: b.prefs, live: b.live, sections: b.sections, slackMuted: b.slackMuted ?? [] })
        // Web sessions do not preload the (possibly huge) user directory: resolve DM partners on demand.
        get().ensureUsers([b.me.userId, ...b.conversations.filter((c) => c.type === 'dm' && c.user).map((c) => c.user!)])
        void api.users().then((r) => set((s) => ({ users: { ...s.users, ...Object.fromEntries(r.users.map((u) => [u.id, u])) } }))).catch(() => undefined)
        void api.emoji().then((r) => set((s) => ({ customEmoji: r.emoji, emojiVersion: s.emojiVersion + 1 }))).catch(() => undefined)
        void loadEmoji().then(() => set((s) => ({ emojiVersion: s.emojiVersion + 1 })))
        get().ensureTeams([b.me.team.id, ...new Set(b.conversations.flatMap((c) => c.sharedTeamIds))])

        socket.start({
          onEvent: handle,
          onOpen: (reconnected) => {
            set({ socketUp: true })
            if (reconnected) resync()
          },
          onClose: () => set({ socketUp: false }),
          onUnauthorized: () => hooks.unauthorized(),
        })
        // a tab that was asleep may have missed events even though the socket looks fine
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resync())

        const fromHash = () => {
          const [, id, ts] = location.hash.match(/^#\/([A-Z0-9]+)(?:\/([\d.]+))?/) ?? []
          if (id && get().convs.some((c) => c.id === id)) void get().selectChannel(id, { anchor: ts, history: 'none' })
        }
        window.addEventListener('popstate', fromHash) // browser back/forward (and the top bar arrows)
        fromHash()
        if (!get().channelId) {
          const first = b.conversations.find((c) => c.name === 'general') ?? b.conversations.find((c) => c.type === 'public') ?? b.conversations[0]
          if (first) void get().selectChannel(first.id)
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) set({ status: 'anon', authError: q.get('auth_error') ?? undefined })
        else set({ status: 'error' })
      }
    },

    refreshConvs: async () => {
      clearTimeout(convTimer)
      convTimer = setTimeout(async () => {
        try {
          const b = await api.bootstrap(true)
          set((s) => ({ convs: b.conversations, unread: { ...b.unread, ...s.unread } }))
        } catch { /* keep what we have */ }
      }, 300)
    },

    selectChannel: async (id, o = {}) => {
      const s = get()
      if (s.channelId === id && !o.anchor && s.chans[id]?.status === 'ready') {
        set({ drawer: false, searchOpen: false })
        return
      }
      const known = s.unread[id]
      set({ channelId: id, anchor: o.anchor, drawer: false, searchOpen: false, thread: s.channelId === id ? s.thread : null, openedLastRead: { ...s.openedLastRead, [id]: known?.lastRead ?? '0' }, noAutoMark: Object.fromEntries(Object.entries(s.noAutoMark).filter(([k]) => k === id)) as Record<string, true> })
      const hash = `#/${id}${o.anchor ? '/' + o.anchor : ''}`
      if (location.hash !== hash && o.history !== 'none') history.pushState(null, '', hash)
      // who is in here: feeds @mention autocomplete and name resolution without a full directory
      void api.members(id).then((r) => get().ensureUsers(r.members)).catch(() => undefined)
      // First visit before background hydration reached this conversation: ask now, so the
      // "new messages" divider is placed correctly before we render.
      const stateP = known?.known ? Promise.resolve(null) : refreshUnread(id).then((r) => r.state).catch(() => null)
      const applyState = (st: UnreadState | null) => st && set((cur) => ({ openedLastRead: { ...cur.openedLastRead, [id]: st.lastRead } }))

      patchChan(id, (c) => ({ ...c, status: c.msgs.length && !o.anchor ? 'ready' : 'loading', error: undefined }))
      try {
        if (o.anchor) {
          void stateP.then(applyState)
          const [older, newer] = await Promise.all([
            api.history(id, { latest: o.anchor, inclusive: true, limit: 40 }),
            api.history(id, { oldest: o.anchor, limit: 100 }),
          ])
          const gap = newer.hasMore
          const msgs = [...older.messages, ...(gap ? [] : newer.messages)].sort((a, b) => cmpTs(a.ts, b.ts))
          patchChan(id, (c) => ({ ...c, msgs: dedupe(msgs), hasOlder: older.hasMore, detached: gap, status: 'ready' }))
          noteUsers(msgs)
        } else {
          const [page, st] = await Promise.all([api.history(id, { limit: 50 }), stateP])
          applyState(st)
          const fresh = [...page.messages].sort((a, b) => cmpTs(a.ts, b.ts))
          patchChan(id, (c) => {
            const newestCached = c.msgs.at(-1)?.ts
            const overlaps = !c.detached && newestCached && fresh.length && (cmpTs(fresh[0].ts, newestCached) <= 0 || !page.hasMore)
            const msgs = overlaps ? dedupe([...c.msgs, ...fresh]) : fresh
            return { ...c, msgs, hasOlder: overlaps ? c.hasOlder : page.hasMore, detached: false, status: 'ready' }
          })
          noteUsers(fresh)
        }
      } catch (e) {
        patchChan(id, (c) => ({ ...c, status: 'error', error: errText(e) }))
      }
      if (o.thread) void get().openThread(id, o.thread, o.anchor)
    },

    loadOlder: async (channel) => {
      const c = get().chans[channel]
      if (!c || c.loadingOlder || !c.hasOlder || !c.msgs.length) return
      patchChan(channel, (x) => ({ ...x, loadingOlder: true }))
      try {
        const page = await api.history(channel, { latest: c.msgs[0].ts, limit: 50 })
        patchChan(channel, (x) => ({ ...x, msgs: dedupe([...page.messages, ...x.msgs].sort((a, b) => cmpTs(a.ts, b.ts))), hasOlder: page.hasMore, loadingOlder: false }))
        noteUsers(page.messages)
      } catch (e) {
        patchChan(channel, (x) => ({ ...x, loadingOlder: false }))
        get().toast(errText(e), 'error')
      }
    },

    jumpToLatest: async (channel) => {
      patchChan(channel, () => blank())
      set({ anchor: undefined })
      history.replaceState(null, '', `#/${channel}`)
      const page = await api.history(channel, { limit: 50 }).catch((e) => (get().toast(errText(e), 'error'), null))
      if (!page) return
      patchChan(channel, () => ({ ...blank(), msgs: [...page.messages].sort((a, b) => cmpTs(a.ts, b.ts)), hasOlder: page.hasMore, status: 'ready' }))
      noteUsers(page.messages)
    },

    syncChannel: async (channel) => {
      const c = get().chans[channel]
      if (!c || c.detached || c.status !== 'ready') return
      const newest = c.msgs.at(-1)?.ts
      try {
        const page = await api.history(channel, newest ? { oldest: newest, limit: 100 } : { limit: 50 })
        if (!page.messages.length) return
        const fresh = [...page.messages].sort((a, b) => cmpTs(a.ts, b.ts))
        patchChan(channel, (x) => ({ ...x, msgs: dedupe([...x.msgs, ...fresh].sort((a, b) => cmpTs(a.ts, b.ts))) }))
        noteUsers(fresh)
      } catch { /* next tick */ }
    },

    openThread: async (channel, ts, focus) => {
      set({ thread: { channel, ts, focus } })
      const key = threadKey(channel, ts)
      patchThread(key, (c) => ({ ...c, status: c.msgs.length ? 'ready' : 'loading' }))
      try {
        const page = await api.replies(channel, ts)
        for (const m of page.messages) if (m.ts !== ts) seenReplies.add(m.ts)
        patchThread(key, (c) => ({ ...c, msgs: dedupe(page.messages), status: 'ready' }))
        noteUsers(page.messages)
      } catch (e) {
        patchThread(key, (c) => ({ ...c, status: 'error', error: errText(e) }))
      }
    },
    closeThread: () => set({ thread: null }),
    syncThread: async () => {
      const t = get().thread
      if (t) await get().openThread(t.channel, t.ts, t.focus).catch(() => undefined)
    },

    send: async ({ channel, text, thread_ts, broadcast, files }) => {
      const me = get().me!.userId
      const clientId = uid()
      const p: Pending = { clientId, ts: `pending-${clientId}`, user: me, text, thread_ts, state: 'sending', broadcast, fileList: files, files: files?.map((f) => ({ name: f.name, pendingFile: true })) }
      const key = thread_ts ? threadKey(channel, thread_ts) : null
      const addPending = (x: Pending) =>
        key ? patchThread(key, (c) => ({ ...c, pending: [...c.pending.filter((q) => q.clientId !== clientId), x] })) : patchChan(channel, (c) => ({ ...c, pending: [...c.pending.filter((q) => q.clientId !== clientId), x] }))
      const dropPending = () =>
        key ? patchThread(key, (c) => ({ ...c, pending: c.pending.filter((q) => q.clientId !== clientId) })) : patchChan(channel, (c) => ({ ...c, pending: c.pending.filter((q) => q.clientId !== clientId) }))
      addPending(p)
      try {
        if (files?.length) {
          const form = new FormData()
          form.set('channel', channel)
          if (text) form.set('comment', text)
          if (thread_ts) form.set('thread_ts', thread_ts)
          files.forEach((f) => form.append('files', f))
          await api.upload(form)
          dropPending()
          setTimeout(() => (thread_ts ? void get().syncThread() : void get().syncChannel(channel)), 1200)
        } else {
          // Over the WebSocket when it is up (acked), plain HTTP otherwise.
          let r: { ts: string; message: any }
          if (socket.open) {
            const ack = await socket.request({ op: 'send', channel, text, thread_ts, reply_broadcast: broadcast })
            if (!ack.ok) throw new ApiError(400, ack.error ?? 'send_failed')
            r = { ts: ack.ts!, message: ack.message }
          } else {
            r = await api.send({ channel, text, thread_ts, reply_broadcast: broadcast })
          }
          dropPending()
          const real: Msg = { ...r.message, ts: r.ts, user: r.message?.user ?? me, text: r.message?.text ?? text, thread_ts }
          if (thread_ts) {
            patchThread(key!, (c) => ({ ...c, msgs: upsert(c.msgs, real) }))
            if (!seenReplies.has(r.ts)) {
              seenReplies.add(r.ts)
              patchChan(channel, (c) => ({ ...c, msgs: mapMsg(c.msgs, thread_ts, (m) => ({ ...m, reply_count: (m.reply_count ?? 0) + 1, latest_reply: r.ts, reply_users: [...new Set([...(m.reply_users ?? []), me])] })) }))
            }
            if (broadcast) patchChan(channel, (c) => ({ ...c, msgs: upsert(c.msgs, { ...real, subtype: 'thread_broadcast' }) }))
          } else {
            patchChan(channel, (c) => ({ ...c, msgs: upsert(c.msgs, real) }))
          }
          get().markRead(channel, r.ts)
        }
      } catch (e) {
        addPending({ ...p, state: 'failed', error: errText(e) })
      }
    },
    retry: (channel, clientId, thread_ts) => {
      const list = (thread_ts ? get().threads[threadKey(channel, thread_ts)] : get().chans[channel])?.pending ?? []
      const p = list.find((x) => x.clientId === clientId)
      if (!p) return
      get().discard(channel, clientId, thread_ts)
      void get().send({ channel, text: p.text ?? '', thread_ts, broadcast: p.broadcast, files: p.fileList })
    },
    discard: (channel, clientId, thread_ts) => {
      const fn = (c: ChanState) => ({ ...c, pending: c.pending.filter((q) => q.clientId !== clientId) })
      if (thread_ts) patchThread(threadKey(channel, thread_ts), fn)
      else patchChan(channel, fn)
    },

    edit: async (channel, ts, text) => {
      let before: Msg | undefined
      everywhere(channel, (l) => mapMsg(l, ts, (m) => ((before ??= m), { ...m, text, edited: { user: get().me!.userId, ts: String(Date.now() / 1000) } })))
      try {
        await api.update(channel, ts, text)
      } catch (e) {
        if (before) everywhere(channel, (l) => mapMsg(l, ts, () => before!))
        get().toast(errText(e), 'error')
      }
    },

    remove: async (channel, ts) => {
      const snap = { chans: get().chans, threads: get().threads }
      everywhere(channel, (l) => l.filter((m) => m.ts !== ts))
      try {
        await api.del(channel, ts)
      } catch (e) {
        set(snap)
        get().toast(errText(e), 'error')
      }
    },

    toggleReaction: async (channel, ts, name) => {
      const me = get().me!.userId
      const msg = [...(get().chans[channel]?.msgs ?? []), ...Object.values(get().threads).flatMap((t) => t.msgs)].find((m) => m.ts === ts)
      const mine = !!msg?.reactions?.find((r) => r.name === name)?.users.includes(me)
      everywhere(channel, (l) => mapMsg(l, ts, (m) => react(m, name, me, !mine)))
      try {
        await api.react(channel, ts, name, mine)
      } catch (e) {
        if (!(e instanceof ApiError && (e.code === 'already_reacted' || e.code === 'no_reaction'))) {
          everywhere(channel, (l) => mapMsg(l, ts, (m) => react(m, name, me, mine)))
          get().toast(errText(e), 'error')
        }
      }
    },

    togglePin: async (channel, ts) => {
      const msg = get().chans[channel]?.msgs.find((m) => m.ts === ts) ?? Object.values(get().threads).flatMap((t) => t.msgs).find((m) => m.ts === ts)
      const pinned = !!msg?.pinned_to?.length
      everywhere(channel, (l) => mapMsg(l, ts, (m) => ({ ...m, pinned_to: pinned ? [] : [channel] })))
      try {
        await api.pin(channel, ts, pinned)
        get().toast(pinned ? 'Unpinned' : 'Pinned to channel')
      } catch (e) {
        everywhere(channel, (l) => mapMsg(l, ts, (m) => ({ ...m, pinned_to: pinned ? [channel] : [] })))
        get().toast(errText(e), 'error')
      }
    },

    markUnreadAt: async (channel, ts) => {
      const list = get().chans[channel]?.msgs ?? []
      const i = list.findIndex((m) => m.ts === ts)
      const prev = i > 0 ? list[i - 1].ts : (Number(ts) - 0.000001).toFixed(6)
      try {
        await api.mark(channel, prev)
        set((s) => ({ noAutoMark: { ...s.noAutoMark, [channel]: true }, openedLastRead: { ...s.openedLastRead, [channel]: prev } }))
        get().toast('Marked as unread from here')
      } catch (e) {
        get().toast(errText(e), 'error')
      }
    },

    markRead: (channel, ts) => {
      const u = get().unread[channel]
      if (u && u.unread === 0 && cmpTs(u.lastRead, ts) >= 0) return
      clearTimeout(markTimers[channel])
      markTimers[channel] = setTimeout(() => {
        void api.mark(channel, ts).catch(() => undefined)
      }, 700)
    },

    setPrefs: (fn) => {
      const next = fn(get().prefs)
      set({ prefs: next })
      void api.savePrefs(next).catch((e) => get().toast(errText(e), 'error'))
    },
    setDraft: (key, text) => set((s) => ({ drafts: { ...s.drafts, [key]: text } })),

    ensureUsers: (ids) => {
      const known = get().users
      for (const id of ids) if (!known[id] && /^[UWB][A-Z0-9]+$/.test(id)) wantUsers.add(id)
      if (!wantUsers.size) return
      clearTimeout(userTimer)
      userTimer = setTimeout(async () => {
        const batch = [...wantUsers].filter((id) => !get().users[id])
        wantUsers.clear()
        for (let i = 0; i < batch.length; i += 30) {
          try {
            const r = await api.lookupUsers(batch.slice(i, i + 30))
            set((s) => ({ users: { ...s.users, ...Object.fromEntries(r.users.map((u) => [u.id, u])) } }))
          } catch { /* names fall back to ids */ }
        }
      }, 80)
    },
    ensureTeams: (ids) => {
      for (const id of ids) if (!get().teams[id] && /^T[A-Z0-9]+$/.test(id)) wantTeams.add(id)
      if (!wantTeams.size) return
      clearTimeout(teamTimer)
      teamTimer = setTimeout(async () => {
        const batch = [...wantTeams].filter((id) => !get().teams[id])
        wantTeams.clear()
        if (!batch.length) return
        try {
          const r = await api.teams(batch)
          set((s) => ({ teams: { ...s.teams, ...Object.fromEntries(r.teams.map((t) => [t.id, t])) } }))
        } catch { /* icons are decoration */ }
      }, 80)
    },

    runSearch: async (query, page = 1) => {
      set((s) => ({ search: { ...s.search, query, loading: true, error: undefined, ...(page === 1 ? { matches: [] } : {}) } }))
      try {
        const r = await api.search(query, page)
        const m = r.messages
        set((s) => ({ search: { ...s.search, loading: false, matches: page === 1 ? m.matches : [...s.search.matches, ...m.matches], total: m.paging?.total ?? m.matches.length, page, pages: m.paging?.pages ?? 1 } }))
        get().ensureUsers(m.matches.map((x: any) => x.user).filter(Boolean))
      } catch (e) {
        set((s) => ({ search: { ...s.search, loading: false, error: errText(e) } }))
      }
    },

    openDm: async (userId) => {
      const existing = get().convs.find((c) => c.type === 'dm' && c.user === userId)
      if (existing) return get().selectChannel(existing.id)
      try {
        const r = await api.openDm([userId])
        await api.bootstrap(true).then((b) => set({ convs: b.conversations }))
        await get().selectChannel(r.channel)
      } catch (e) {
        get().toast(errText(e), 'error')
      }
    },

    logout: async (revoke) => {
      try {
        await api.logout(revoke)
      } finally {
        socket.stop()
        location.href = '/'
      }
    },
  }

  function handle(e: StreamEvent) {
    switch (e.type) {
      case 'hello': set((s) => ({ live: e.live, unread: { ...s.unread, ...e.unread } })); break
      case 'live': set({ live: e.live }); break
      case 'resync': resync(); break
      case 'unread': set((s) => ({ unread: { ...s.unread, [e.channel]: e.state } })); break
      case 'conversations': void get().refreshConvs(); break
      case 'revoked': set({ status: 'expired' }); socket.stop(); break
      case 'slack': applyEvent(e.event); break
    }
  }

  /** Catch up on what we are looking at; used after any gap (reconnect, upstream drop, tab wake). */
  function resync() {
    const { channelId, thread, status } = get()
    if (status !== 'ready') return
    if (channelId) void get().syncChannel(channelId)
    if (thread) void get().syncThread()
    void get().refreshConvs()
  }

  function applyEvent(ev: any) {
    const me = get().me?.userId
    if (ev.type === 'emoji_changed') {
      void api.emoji().then((r) => set((s) => ({ customEmoji: r.emoji, emojiVersion: s.emojiVersion + 1 })))
      return
    }
    if (ev.type === 'reaction_added' || ev.type === 'reaction_removed') {
      if (ev.item?.type !== 'message') return
      everywhere(ev.item.channel, (l) => mapMsg(l, ev.item.ts, (m) => react(m, ev.reaction, ev.user, ev.type === 'reaction_added')))
      return
    }
    if (ev.type !== 'message' || !ev.channel) return
    if (ev.subtype === 'message_changed' && ev.message) {
      everywhere(ev.channel, (l) => mapMsg(l, ev.message.ts, (m) => ({ ...m, ...ev.message })))
      return
    }
    if (ev.subtype === 'message_deleted') {
      everywhere(ev.channel, (l) => l.filter((m) => m.ts !== ev.deleted_ts))
      return
    }
    if (ev.subtype === 'message_replied' || ev.hidden) return
    const m: Msg = { ...ev }
    delete m.channel
    delete m.channel_type
    delete m.event_ts
    delete m.team
    const isReply = ev.thread_ts && ev.thread_ts !== ev.ts
    const chan = get().chans[ev.channel]
    if (isReply) {
      if (!seenReplies.has(ev.ts)) {
        seenReplies.add(ev.ts)
        if (chan) patchChan(ev.channel, (c) => ({ ...c, msgs: mapMsg(c.msgs, ev.thread_ts, (p) => ({ ...p, reply_count: (p.reply_count ?? 0) + 1, latest_reply: ev.ts, reply_users: [...new Set([...(p.reply_users ?? []), ev.user])] })) }))
      }
      const key = threadKey(ev.channel, ev.thread_ts)
      if (get().threads[key]) patchThread(key, (c) => ({ ...c, msgs: upsert(c.msgs, m) }))
    }
    if ((!isReply || ev.subtype === 'thread_broadcast') && chan && !chan.detached && chan.status === 'ready') {
      patchChan(ev.channel, (c) => ({ ...c, msgs: upsert(c.msgs, m) }))
    }
    noteUsers([m])
    if (ev.user !== me && ev.channel === get().channelId) {
      const who = get().users[ev.user]?.display ?? 'Someone'
      set({ announce: `New message from ${who}: ${(ev.text ?? '').slice(0, 140)}` })
    }
  }
})

function dedupe(list: Msg[]): Msg[] {
  const seen = new Map<string, Msg>()
  for (const m of list) seen.set(m.ts, seen.has(m.ts) ? { ...seen.get(m.ts)!, ...m } : m)
  return [...seen.values()].sort((a, b) => cmpTs(a.ts, b.ts))
}

export const selectConv = (id?: string) => (s: State) => (id ? s.convs.find((c) => c.id === id) : undefined)
export type { State }
