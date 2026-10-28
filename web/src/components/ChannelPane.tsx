import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu, Pin, Search, Users } from '@/components/icons'
import { StatusDot } from './ui/geist'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { ChannelIcon, useConvLabel } from './ChannelIcon'
import { TeamBadge } from './Avatar'
import { Composer, type ComposerHandle } from './Composer'
import { MessageList } from './MessageList'
import { Mrkdwn } from './Mrkdwn'
import { Button } from './ui/button'
import { Pop, Tip } from './ui/overlays'
import { Upload } from '@/components/icons'

function Presence({ userId }: { userId: string }) {
  const [p, setP] = useState<'active' | 'away' | null>(null)
  useEffect(() => {
    let live = true
    setP(null)
    const load = () => void api.presence(userId).then((r) => live && setP(r.presence)).catch(() => undefined)
    load()
    const t = setInterval(load, 60_000)
    return () => { live = false; clearInterval(t) }
  }, [userId])
  if (!p) return null
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-2">
      <StatusDot active={p === 'active'} />
      {p === 'active' ? 'active' : 'away'}
    </span>
  )
}

function Pins({ channel }: { channel: string }) {
  const [items, setItems] = useState<any[] | null>(null)
  return (
    <Pop
      side="bottom"
      className="max-h-96 w-[min(92vw,420px)] overflow-y-auto"
      trigger={<Tip label="Pinned messages"><Button variant="ghost" size="touch" aria-label="Pinned messages" onClick={() => { setItems(null); void api.pins(channel).then((r) => setItems(r.items)).catch(() => setItems([])) }}><Pin className="size-4" aria-hidden /></Button></Tip>}
    >
      <div className="p-3">
        <h3 className="mb-2 text-sm font-semibold">Pinned</h3>
        {items === null ? <p className="text-sm text-ink-3">Loading…</p> : !items.length ? <p className="text-sm text-ink-3">Nothing pinned here.</p> : items.map((it, i) => it.message && (
          <button key={i} className="focus-inset mb-1 block w-full rounded-md border border-line p-2 text-left text-[13px] hover:bg-hover" onClick={() => void useStore.getState().selectChannel(channel, { anchor: it.message.ts })}>
            <Mrkdwn text={it.message.text ?? ''} />
          </button>
        ))}
      </div>
    </Pop>
  )
}

export function ChannelPane({ channelId }: { channelId: string }) {
  const conv = useStore((s) => s.convs.find((c) => c.id === channelId))
  const state = useStore((s) => s.chans[channelId])
  const anchor = useStore((s) => s.anchor)
  const lastRead = useStore((s) => s.openedLastRead[channelId])
  const noAutoMark = useStore((s) => !!s.noAutoMark[channelId])
  const loadOlder = useStore((s) => s.loadOlder)
  const jump = useStore((s) => s.jumpToLatest)
  const markRead = useStore((s) => s.markRead)
  const set = useStore((s) => s.set)
  const label = useConvLabel()
  const composer = useRef<ComposerHandle>(null)
  const [drag, setDrag] = useState(false)
  const dragDepth = useRef(0)

  const onNearBottom = useCallback((ts: string) => { if (!noAutoMark) markRead(channelId, ts) }, [markRead, channelId, noAutoMark])
  const onOlder = useCallback(() => void loadOlder(channelId), [loadOlder, channelId])
  const onJump = useCallback(() => void jump(channelId), [jump, channelId])

  if (!conv) return <div className="flex flex-1 items-center justify-center text-ink-3">Conversation not found</div>
  const isPlace = conv.type === 'public' || conv.type === 'private'
  const name = label(conv)

  return (
    <main
      className="relative flex min-w-0 flex-1 flex-col"
      onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth.current++; setDrag(true) } }}
      onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDrag(false) } }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); dragDepth.current = 0; setDrag(false); composer.current?.addFiles([...e.dataTransfer.files]) }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 pt-[env(safe-area-inset-top)] md:px-4 md:pt-0">
        <Button variant="ghost" size="touch" className="-ml-1 md:hidden" aria-label="Open conversations" onClick={() => set({ drawer: true })}><Menu className="size-5" aria-hidden /></Button>
        <ChannelIcon conv={conv} className="size-[18px]" />
        <h1 className={`min-w-0 truncate text-[16px] font-semibold ${isPlace ? 'font-mono text-[15px]' : ''}`}>{name}</h1>
        {conv.isExtShared && conv.sharedTeamIds.filter((t) => t !== conv.contextTeamId).slice(0, 3).map((t) => <TeamBadge key={t} teamId={t} size={16} />)}
        {conv.type === 'dm' && conv.user && <Presence userId={conv.user} />}
        {conv.isArchived && <span className="rounded-sm border border-line-strong px-1 font-mono text-[10px] uppercase text-ink-2">archived</span>}
        {conv.topic && <p className="ml-2 hidden min-w-0 flex-1 truncate text-[13px] text-ink-3 lg:block" title={conv.topic}>{conv.topic}</p>}
        <div className="ml-auto flex items-center gap-0.5">
          {conv.numMembers !== undefined && isPlace && <span className="mr-1 hidden h-8 items-center gap-1.5 rounded-md border border-line-strong px-2.5 font-mono text-[13px] text-ink-2 sm:flex" role="img" aria-label={`${conv.numMembers} members`}><Users className="size-4" aria-hidden />{conv.numMembers}</span>}
          <Pins channel={channelId} />
          <Tip label="Search (/)"><Button variant="ghost" size="touch" className="md:hidden" aria-label="Search" onClick={() => set({ searchOpen: true })}><Search className="size-4" aria-hidden /></Button></Tip>
        </div>
      </header>

      <MessageList
        key={channelId}
        channelId={channelId}
        state={state}
        focusTs={anchor}
        lastRead={lastRead}
        onNearBottom={onNearBottom}
        onLoadOlder={onOlder}
        onJumpLatest={onJump}
      />
      <Composer ref={composer} id="composer-main" channelId={channelId} placeholder={`Message ${isPlace ? '#' : ''}${name}`} />

      {drag && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-focus bg-black/80" role="status">
          <div className="flex items-center gap-2 text-sm font-medium"><Upload className="size-5" aria-hidden />Drop files to attach</div>
        </div>
      )}
    </main>
  )
}
