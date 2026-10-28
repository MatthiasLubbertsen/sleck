import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Search } from '@/components/icons'
import { useStore } from '@/lib/store'
import { ChannelIcon } from './ChannelIcon'
import { Mrkdwn } from './Mrkdwn'
import { Time } from './Time'
import { UserAvatar } from './Avatar'
import { Button } from './ui/button'

export function SearchView() {
  const search = useStore((s) => s.search)
  const run = useStore((s) => s.runSearch)
  const set = useStore((s) => s.set)
  const select = useStore((s) => s.selectChannel)
  const users = useStore((s) => s.users)
  const convs = useStore((s) => s.convs)
  const [q, setQ] = useState(search.query)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ searchOpen: false }) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [set])

  const open = (m: any) => {
    const id = m.channel?.id as string
    if (!id) return
    // a reply opens its thread next to the channel, focused on the reply
    void select(id, { anchor: m.thread_ts ? m.thread_ts : m.ts, thread: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : undefined })
    if (m.thread_ts && m.thread_ts !== m.ts) void useStore.getState().openThread(id, m.thread_ts, m.ts)
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col" aria-label="Search">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 md:px-4">
        <Button variant="ghost" size="iconLg" aria-label="Back to conversation" onClick={() => set({ searchOpen: false })}><ArrowLeft className="size-4" aria-hidden /></Button>
        <form className="flex flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void run(q.trim()) }} role="search">
          <Search className="size-4 text-ink-3" aria-hidden />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search messages" placeholder="Search messages — try in:#channel from:@person" className="h-9 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans placeholder:text-ink-3" />
          <Button type="submit" variant="default" size="md" disabled={!q.trim() || search.loading}>Search</Button>
        </form>
      </header>
      <div className="flex-1 overflow-y-auto" aria-live="polite">
        {search.error && <p role="alert" className="p-4 text-sm text-danger">{search.error}</p>}
        {search.loading && !search.matches.length && <p className="flex items-center gap-2 p-4 text-sm text-ink-3"><Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />Searching…</p>}
        {!search.loading && search.query && !search.error && !search.matches.length && <p className="p-4 text-sm text-ink-3">No results for <span className="font-mono">{search.query}</span></p>}
        {search.matches.length > 0 && <p className="border-b border-line px-4 py-2 font-mono text-xs text-ink-3">{search.total} results</p>}
        <ul>
          {search.matches.map((m: any) => {
            const conv = convs.find((c) => c.id === m.channel?.id)
            const user = users[m.user]
            return (
              <li key={`${m.channel?.id}-${m.ts}`} className="border-b border-line">
                <button onClick={() => open(m)} className="focus-inset block w-full px-4 py-3 text-left hover:bg-hover">
                  <div className="mb-1 flex items-center gap-2 text-xs text-ink-2">
                    {conv ? <ChannelIcon conv={conv} className="size-3.5" /> : null}
                    <span className="font-mono">{conv ? (conv.type === 'public' || conv.type === 'private' ? conv.name : m.channel?.name) : (m.channel?.name ?? m.channel?.id)}</span>
                    {m.thread_ts && m.thread_ts !== m.ts && <span className="rounded-sm border border-line-strong px-1 font-mono text-[10px] uppercase">in thread</span>}
                    <Time ts={m.ts} className="ml-auto" />
                  </div>
                  <div className="flex gap-2">
                    <UserAvatar id={m.user} size={24} fallbackName={m.username} />
                    <div className="min-w-0 flex-1">
                      <span className="text-[13px] font-semibold">{user?.display ?? m.username ?? m.user}</span>
                      <Mrkdwn text={m.text ?? ''} className="text-[13px]" />
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
        {search.page < search.pages && (
          <div className="p-4 text-center"><Button disabled={search.loading} onClick={() => void run(search.query, search.page + 1)}>{search.loading ? 'Loading…' : 'Load more'}</Button></div>
        )}
      </div>
    </main>
  )
}
