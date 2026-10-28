import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, RefreshCw } from '@/components/icons'
import { Skeleton, Spinner } from './ui/geist'
import { useStore, type ChanState, type Msg } from '@/lib/store'
import { dayKey, dayLabel } from '@/lib/time'
import { cmpTs } from '@/lib/utils'
import { Message } from './Message'
import { Button } from './ui/button'

const GROUP_WINDOW = 5 * 60

type Row =
  | { k: 'day'; key: string; label: string }
  | { k: 'new'; key: string }
  | { k: 'msg'; key: string; m: Msg; grouped: boolean }

export function buildRows(msgs: Msg[], lastRead: string | undefined, me: string | undefined, hideDivider: boolean): Row[] {
  const rows: Row[] = []
  let prev: Msg | undefined
  let dividerDone = hideDivider || !lastRead || lastRead === '0'
  for (const m of msgs) {
    const newDay = !prev || dayKey(prev.ts) !== dayKey(m.ts)
    if (newDay) rows.push({ k: 'day', key: `d${dayKey(m.ts)}`, label: dayLabel(m.ts) })
    if (!dividerDone && cmpTs(m.ts, lastRead!) > 0 && m.user !== me) {
      rows.push({ k: 'new', key: 'new' })
      dividerDone = true
    }
    const sameAuthor = prev && !newDay && (prev.user ?? prev.bot_id) === (m.user ?? m.bot_id) && !m.subtype && !prev.subtype && cmpTs(m.ts, prev.ts) < GROUP_WINDOW && !prev.reply_count
    rows.push({ k: 'msg', key: m.ts, m, grouped: !!sameAuthor && rows.at(-1)?.k === 'msg' })
    prev = m
  }
  return rows
}

/** Sticky day labels must be bounded by their own day, or they stack on top of each other. */
function groupByDay(rows: Row[]) {
  const groups: { key: string; label: string; rows: Row[] }[] = []
  for (const r of rows) {
    if (r.k === 'day') groups.push({ key: r.key, label: r.label, rows: [] })
    else groups.at(-1)?.rows.push(r)
  }
  return groups
}

interface Props {
  channelId: string
  state: ChanState | undefined
  /** thread mode: no history paging, messages passed through as-is */
  inThread?: boolean
  focusTs?: string
  lastRead?: string
  onNearBottom?: (latestTs: string) => void
  onLoadOlder?: () => void
  onJumpLatest?: () => void
}

export function MessageList({ channelId, state, inThread, focusTs, lastRead, onNearBottom, onLoadOlder, onJumpLatest }: Props) {
  const me = useStore((s) => s.me?.userId)
  const scroller = useRef<HTMLDivElement>(null)
  const topSentinel = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const prev = useRef({ first: '', last: '', height: 0, key: '' })
  const [unseen, setUnseen] = useState(0)

  const msgs = state?.msgs
  const pending = state?.pending
  const rows = useMemo(() => buildRows(msgs ?? [], lastRead, me, !!inThread), [msgs, lastRead, me, inThread])
  const key = `${channelId}:${focusTs ?? ''}`

  const scrollToBottom = useCallback(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
    atBottom.current = true
    setUnseen(0)
  }, [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !state || state.status !== 'ready') return
    const p = prev.current
    const list = state.msgs
    const first = list[0]?.ts ?? ''
    const last = list.at(-1)?.ts ?? ''
    if (p.key !== key) {
      // fresh open: go to the anchor, else the first unread, else the bottom
      p.key = key
      const target = (focusTs && el.querySelector(`[data-ts="${CSS.escape(focusTs)}"]`)) || (lastRead && lastRead !== '0' && !inThread ? el.querySelector('[data-new-divider]') : null)
      if (target) { (target as HTMLElement).scrollIntoView({ block: focusTs ? 'center' : 'start' }); atBottom.current = false }
      else scrollToBottom()
    } else if (first !== p.first && p.first && cmpTs(first, p.first) < 0 && last === p.last) {
      el.scrollTop += el.scrollHeight - p.height // older page prepended: keep the viewport still
    } else if (last !== p.last && p.last && cmpTs(last, p.last) > 0) {
      if (atBottom.current) scrollToBottom()
      else setUnseen((n) => n + 1)
    }
    p.first = first
    p.last = last
    p.height = el.scrollHeight
  }, [state, key, focusTs, lastRead, inThread, scrollToBottom])

  // pending (own) messages always pull to the bottom
  useLayoutEffect(() => {
    if (pending?.length) scrollToBottom()
  }, [pending?.length, scrollToBottom])

  // infinite scroll upwards
  useEffect(() => {
    const el = topSentinel.current
    if (!el || inThread || !onLoadOlder) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && onLoadOlder(), { root: scroller.current, rootMargin: '300px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [onLoadOlder, inThread, state?.status, state?.msgs.length])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    atBottom.current = near
    if (near) {
      setUnseen(0)
      const last = state?.msgs.at(-1)?.ts
      if (last && onNearBottom && !state?.detached) onNearBottom(last)
    }
  }

  // reading while the tab is visible and we are at the bottom => mark read
  useEffect(() => {
    const last = state?.msgs.at(-1)?.ts
    if (!last || !onNearBottom || state?.detached) return
    const check = () => atBottom.current && document.visibilityState === 'visible' && onNearBottom(last)
    check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [state?.msgs, state?.detached, onNearBottom])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !(e.target as HTMLElement).hasAttribute('data-msg')) return
    const all = [...(scroller.current?.querySelectorAll<HTMLElement>('[data-msg]') ?? [])]
    const i = all.indexOf(e.target as HTMLElement)
    const next = all[i + (e.key === 'ArrowUp' ? -1 : 1)]
    if (next) { e.preventDefault(); next.focus() }
  }

  if (!state || state.status === 'loading') {
    return (
      <div className="flex-1 space-y-5 overflow-hidden px-4 py-6" role="status" aria-label="Loading messages">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-9 shrink-0" />
            <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-32" /><Skeleton className={`h-3.5 ${['w-3/4', 'w-1/2', 'w-5/6', 'w-2/3'][i % 4]}`} /></div>
          </div>
        ))}
      </div>
    )
  }
  if (state.status === 'error' && !state.msgs.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm" role="alert">
        <p className="text-danger">{state.error ?? 'Could not load messages'}</p>
        <Button onClick={() => void useStore.getState().selectChannel(channelId, { anchor: focusTs })}><RefreshCw className="size-4" aria-hidden />Try again</Button>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} onKeyDown={onKeyDown} className="flex-1 overflow-y-auto overflow-x-hidden pb-2" data-testid={inThread ? 'thread-scroller' : 'message-scroller'}>
        <div ref={topSentinel} className="h-px" />
        {!inThread && (
          <div className="flex min-h-10 items-center justify-center px-4 py-2 text-xs text-ink-3" role="status">
            {state.loadingOlder ? <><Spinner className="mr-2 size-3.5" />Loading older messages…</> : !state.hasOlder ? <span className="font-mono">— beginning of conversation —</span> : null}
          </div>
        )}
        {groupByDay(rows).map((g) => (
          <section key={g.key} aria-label={g.label}>
            <div className="sticky top-0 z-[5] flex items-center gap-3 bg-background px-4 pb-1 pt-3" role="separator" aria-label={g.label}>
              <div className="h-px flex-1 bg-line" />
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink-2">{g.label}</span>
              <div className="h-px flex-1 bg-line" />
            </div>
            {g.rows.map((r) =>
              r.k === 'new' ? (
                <div key={r.key} data-new-divider className="flex items-center gap-3 px-4 py-1" role="separator" aria-label="New messages">
                  <div className="h-px flex-1 bg-danger-fill" />
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-danger">▼ New</span>
                  <div className="h-px flex-1 bg-danger-fill" />
                </div>
              ) : r.k === 'msg' ? (
                <Fragment key={r.key}>
                  <Message m={r.m} grouped={r.grouped} channelId={channelId} inThread={inThread} focused={focusTs === r.m.ts} />
                </Fragment>
              ) : null,
            )}
          </section>
        ))}
        {pending?.map((p, i) => (
          <Message key={p.clientId} m={p} grouped={i > 0 || (state.msgs.at(-1)?.user === p.user && !!state.msgs.at(-1) && cmpTs(String(Date.now() / 1000), state.msgs.at(-1)!.ts) < GROUP_WINDOW)} channelId={channelId} inThread={inThread} />
        ))}
        {!rows.length && !pending?.length && <p className="px-4 py-8 text-center text-sm text-ink-3">No messages yet. Say something.</p>}
      </div>
      {state.detached && onJumpLatest && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <Button variant="default" onClick={onJumpLatest}><ArrowDown className="size-4" aria-hidden />Jump to latest messages</Button>
        </div>
      )}
      {!state.detached && unseen > 0 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <Button variant="default" onClick={scrollToBottom}><ArrowDown className="size-4" aria-hidden />{unseen} new {unseen === 1 ? 'message' : 'messages'}</Button>
        </div>
      )}
    </div>
  )
}
