import { useEffect } from 'react'
import { useStore } from '@/lib/store'
import { Login } from './components/Login'
import { Sidebar } from './components/Sidebar'
import { Rail } from './components/Rail'
import { TopBar } from './components/TopBar'
import { ChannelPane } from './components/ChannelPane'
import { ThreadPanel } from './components/ThreadPanel'
import { SearchView } from './components/SearchView'
import { QuickSwitcher } from './components/QuickSwitcher'
import { ShortcutSheet, useShortcuts } from './components/Shortcuts'
import { Toaster } from './components/Toaster'
import { Note, Spinner } from './components/ui/geist'

/** Honest status strip: shown only when something is wrong. No polling happens; this is the realtime socket's state. */
function ConnectionBanner() {
  const socketUp = useStore((s) => s.socketUp)
  const live = useStore((s) => s.live)
  if (!socketUp) return <Note tone="amber" className="rounded-none border-x-0 border-t-0">Reconnecting to the Sleck server… messages will catch up when the connection is back.</Note>
  if (live === 'down') return <Note tone="amber" className="rounded-none border-x-0 border-t-0">The realtime connection to Slack dropped. Reconnecting…</Note>
  if (live === 'none') return <Note tone="gray" className="rounded-none border-x-0 border-t-0">Live updates are off for this sign-in: Slack only pushes events to apps with the Events API configured. Sign in with a browser session to get a realtime socket.</Note>
  return null
}

function Shell() {
  const channelId = useStore((s) => s.channelId)
  const thread = useStore((s) => s.thread)
  const searchOpen = useStore((s) => s.searchOpen)
  const drawer = useStore((s) => s.drawer)
  const set = useStore((s) => s.set)
  const announce = useStore((s) => s.announce)
  const unread = useStore((s) => s.unread)
  const prefs = useStore((s) => s.prefs)
  const slackMuted = useStore((s) => s.slackMuted)
  useShortcuts()

  // tab title shows what needs attention
  useEffect(() => {
    const live = Object.entries(unread).filter(([id]) => !prefs.muted.includes(id) && !slackMuted.includes(id))
    const mentions = live.reduce((n, [, u]) => n + u.mentions, 0)
    const unreadChans = live.filter(([, u]) => u.unread > 0).length
    document.title = mentions ? `(@${mentions}) Sleck` : unreadChans ? `(${unreadChans}) Sleck` : 'Sleck'
  }, [unread, prefs.muted, slackMuted])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <a href="#composer-main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-ink focus:px-3 focus:py-1.5 focus:text-black" onClick={(e) => { e.preventDefault(); document.getElementById('composer-main')?.focus() }}>Skip to composer</a>
      <TopBar />
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        <Rail />
        {/* sidebar: fixed column on md+, drawer on phones */}
        {drawer && <div className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={() => set({ drawer: false })} aria-hidden />}
        <div className={`fixed inset-y-0 left-0 z-50 w-[min(88vw,320px)] border-r border-line pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] transition-transform duration-150 md:static md:z-auto md:w-[260px] md:shrink-0 md:translate-x-0 md:p-0 ${drawer ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar />
        </div>
        {searchOpen ? <SearchView /> : channelId ? <ChannelPane key={channelId} channelId={channelId} /> : <div className="flex flex-1 items-center justify-center text-ink-3">Select a conversation</div>}
        {thread && !searchOpen && <ThreadPanel key={`${thread.channel}:${thread.ts}`} />}
      </div>
      <QuickSwitcher />
      <ShortcutSheet />
      <Toaster />
      <div className="sr-only" role="log" aria-live="polite" aria-atomic="true">{announce}</div>
    </div>
  )
}

export function App() {
  const status = useStore((s) => s.status)
  const authError = useStore((s) => s.authError)
  const init = useStore((s) => s.init)
  useEffect(() => void init(), [init])

  if (status === 'loading') return <div className="flex h-full items-center justify-center text-ink-3" role="status"><Spinner className="mr-2" />Loading…</div>
  if (status === 'anon') return <Login error={authError} />
  if (status === 'expired') return <Login reason="expired" />
  if (status === 'error') return <Login reason="error" />
  return <Shell />
}
