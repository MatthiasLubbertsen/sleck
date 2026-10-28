import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { Login } from './components/Login'
import { Sidebar } from './components/Sidebar'
import { ChannelPane } from './components/ChannelPane'
import { ThreadPanel } from './components/ThreadPanel'
import { SearchView } from './components/SearchView'
import { QuickSwitcher } from './components/QuickSwitcher'
import { ShortcutSheet, useShortcuts } from './components/Shortcuts'
import { Toaster } from './components/Toaster'

function Shell() {
  const channelId = useStore((s) => s.channelId)
  const thread = useStore((s) => s.thread)
  const searchOpen = useStore((s) => s.searchOpen)
  const drawer = useStore((s) => s.drawer)
  const set = useStore((s) => s.set)
  const live = useStore((s) => s.live)
  const realtime = useStore((s) => s.realtime)
  const unread = useStore((s) => s.unread)
  const prefs = useStore((s) => s.prefs)
  useShortcuts()

  // polling fallback: only while the Events API is not feeding us, and the tab is visible
  useEffect(() => {
    if (realtime) return
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const s = useStore.getState()
      if (s.channelId) void s.syncChannel(s.channelId)
      if (s.thread) void s.syncThread()
    }, 5000)
    return () => clearInterval(t)
  }, [realtime])

  // tab title shows what needs attention
  useEffect(() => {
    const mentions = Object.entries(unread).filter(([id]) => !prefs.muted.includes(id)).reduce((n, [, u]) => n + u.mentions, 0)
    const unreadChans = Object.entries(unread).filter(([id, u]) => u.unread > 0 && !prefs.muted.includes(id)).length
    document.title = mentions ? `(@${mentions}) Sleck` : unreadChans ? `(${unreadChans}) Sleck` : 'Sleck'
  }, [unread, prefs.muted])

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a href="#composer-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-ink focus:px-3 focus:py-1.5 focus:text-black" onClick={(e) => { e.preventDefault(); document.getElementById('composer-main')?.focus() }}>Skip to composer</a>
      {/* sidebar: fixed column on md+, drawer on phones */}
      {drawer && <div className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={() => set({ drawer: false })} aria-hidden />}
      <div className={`fixed inset-y-0 left-0 z-50 w-[min(86vw,300px)] border-r border-line transition-transform duration-150 md:static md:z-auto md:w-[260px] md:shrink-0 md:translate-x-0 ${drawer ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar />
      </div>
      {searchOpen ? <SearchView /> : channelId ? <ChannelPane key={channelId} channelId={channelId} /> : <div className="flex flex-1 items-center justify-center text-ink-3">Select a conversation</div>}
      {thread && !searchOpen && <ThreadPanel key={`${thread.channel}:${thread.ts}`} />}
      <QuickSwitcher />
      <ShortcutSheet />
      <Toaster />
      <div className="sr-only" role="log" aria-live="polite" aria-atomic="true">{live}</div>
    </div>
  )
}

export function App() {
  const status = useStore((s) => s.status)
  const authError = useStore((s) => s.authError)
  const init = useStore((s) => s.init)
  useEffect(() => void init(), [init])

  if (status === 'loading') return <div className="flex h-full items-center justify-center text-ink-3" role="status"><Loader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden />Loading…</div>
  if (status === 'anon') return <Login error={authError} />
  if (status === 'expired') return <Login reason="expired" />
  if (status === 'error') return <Login reason="error" />
  return <Shell />
}
