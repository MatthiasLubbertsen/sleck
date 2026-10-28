import { useMemo, useState } from 'react'
import { BellOff, ChevronDown, ChevronRight, CheckCheck, Keyboard, LogOut, MoreHorizontal, Pin, PinOff, Radio, RefreshCw, Search, ShieldOff } from 'lucide-react'
import type { Conversation, UnreadState } from '../../../shared/types'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { ChannelIcon, useConvLabel } from './ChannelIcon'
import { Button, Kbd } from './ui/button'
import { Dropdown, MenuItem, MenuSep, Tip } from './ui/overlays'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'

function Row({ c, label, selected }: { c: Conversation; label: string; selected: boolean }) {
  const u = useStore((s) => s.unread[c.id]) as UnreadState | undefined
  const pinned = useStore((s) => s.prefs.pinned.includes(c.id))
  const muted = useStore((s) => s.prefs.muted.includes(c.id))
  const select = useStore((s) => s.selectChannel)
  const setPrefs = useStore((s) => s.setPrefs)
  const markRead = useStore((s) => s.markRead)
  const hasUnread = !!u && u.unread > 0
  const mentions = u?.mentions ?? 0
  const bold = (hasUnread && !muted) || mentions > 0
  const isPlace = c.type === 'public' || c.type === 'private'

  return (
    <li className="group/row relative">
      <button
        onClick={() => void select(c.id)}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'focus-inset relative flex h-7 w-full items-center gap-2 rounded-md py-0 pl-3 pr-2 text-left text-[13px] hover:bg-hover',
          selected && 'bg-active text-ink before:absolute before:inset-y-1 before:left-0.5 before:w-0.5 before:bg-ink',
          !selected && (bold ? 'text-ink' : muted ? 'text-ink-3' : 'text-ink-2'),
        )}
      >
        <ChannelIcon conv={c} />
        <span className={cn('min-w-0 flex-1 truncate', isPlace && 'font-mono text-[12.5px]', bold && 'font-semibold', muted && 'italic')}>{label}</span>
        {muted && <><BellOff className="size-3 shrink-0 text-ink-3" aria-hidden /><span className="sr-only">muted</span></>}
        {pinned && !muted && <Pin className="size-3 shrink-0 text-ink-3 group-hover/row:hidden" aria-hidden />}
        {mentions > 0 ? (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-sm bg-ink px-1 font-mono text-[10px] font-bold text-black group-hover/row:hidden group-focus-within/row:hidden">@{mentions > 99 ? '99+' : mentions}<span className="sr-only"> {mentions === 1 ? 'mention' : 'mentions'}, {u!.unread} unread</span></span>
        ) : hasUnread && !muted ? (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-sm border border-ink-3 px-1 font-mono text-[10px] text-ink group-hover/row:hidden group-focus-within/row:hidden">{u!.unread >= 100 ? '99+' : u!.unread}<span className="sr-only"> unread</span></span>
        ) : null}
      </button>
      <div className="absolute right-1 top-0.5 hidden group-focus-within/row:block group-hover/row:block">
        <Dropdown trigger={<Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Options for ${label}`}><MoreHorizontal className="size-3.5" aria-hidden /></Button>}>
          <MenuItem icon={pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} onSelect={() => setPrefs((p) => ({ ...p, pinned: pinned ? p.pinned.filter((x) => x !== c.id) : [...p.pinned, c.id] }))}>{pinned ? 'Unpin from top' : 'Pin to top'}</MenuItem>
          <MenuItem icon={<BellOff className="size-4" />} onSelect={() => setPrefs((p) => ({ ...p, muted: muted ? p.muted.filter((x) => x !== c.id) : [...p.muted, c.id] }))}>{muted ? 'Unmute' : 'Mute (in Sleck only)'}</MenuItem>
          {hasUnread && u && <MenuItem icon={<CheckCheck className="size-4" />} onSelect={() => markRead(c.id, u.latestTs)}>Mark as read</MenuItem>}
        </Dropdown>
      </div>
    </li>
  )
}

function Section({ id, title, count, children, unread }: { id: string; title: string; count: number; children: React.ReactNode; unread: number }) {
  const collapsed = useStore((s) => s.prefs.collapsed.includes(id))
  const setPrefs = useStore((s) => s.setPrefs)
  if (!count) return null
  return (
    <section className="mb-2">
      <h2>
        <button
          onClick={() => setPrefs((p) => ({ ...p, collapsed: collapsed ? p.collapsed.filter((x) => x !== id) : [...p.collapsed, id] }))}
          aria-expanded={!collapsed}
          className="focus-inset flex h-6 w-full items-center gap-1 rounded-md px-2 text-[11px] font-medium uppercase tracking-wide text-ink-3 hover:text-ink-2"
        >
          {collapsed ? <ChevronRight className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
          {title}
          <span className="font-mono normal-case">{count}</span>
          {collapsed && unread > 0 && <span className="ml-auto rounded-sm border border-ink-3 px-1 font-mono text-[10px] text-ink-2">{unread} unread</span>}
        </button>
      </h2>
      {!collapsed && <ul>{children}</ul>}
    </section>
  )
}

export function Sidebar() {
  const convs = useStore((s) => s.convs)
  const unread = useStore((s) => s.unread)
  const prefs = useStore((s) => s.prefs)
  const channelId = useStore((s) => s.channelId)
  const team = useStore((s) => s.me?.team)
  const realtime = useStore((s) => s.realtime)
  const connected = useStore((s) => s.connected)
  const setStore = useStore((s) => s.set)
  const logout = useStore((s) => s.logout)
  const refresh = useStore((s) => s.refreshConvs)
  const label = useConvLabel()
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [showAllDms, setShowAllDms] = useState(false)

  const groups = useMemo(() => {
    const has = (c: Conversation) => (unread[c.id]?.unread ?? 0) > 0
    const visible = convs.filter((c) => !onlyUnread || has(c) || c.id === channelId)
    const byName = (a: Conversation, b: Conversation) => label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
    const byRecent = (a: Conversation, b: Conversation) => Number(unread[b.id]?.latestTs ?? 0) - Number(unread[a.id]?.latestTs ?? 0) || byName(a, b)
    const pinned = prefs.pinned.map((id) => visible.find((c) => c.id === id)).filter((c): c is Conversation => !!c)
    const rest = visible.filter((c) => !prefs.pinned.includes(c.id))
    return {
      pinned,
      channels: rest.filter((c) => c.type === 'public').sort(byName),
      private: rest.filter((c) => c.type === 'private').sort(byName),
      groups: rest.filter((c) => c.type === 'group_dm').sort(byRecent),
      dms: rest.filter((c) => c.type === 'dm').sort(byRecent),
    }
  }, [convs, unread, prefs.pinned, onlyUnread, channelId, label])

  const sum = (cs: Conversation[]) => cs.reduce((n, c) => n + (unread[c.id]?.unread ?? 0), 0)
  const dmLimit = 20
  const dms = showAllDms || onlyUnread ? groups.dms : groups.dms.slice(0, dmLimit)
  const render = (cs: Conversation[]) => cs.map((c) => <Row key={c.id} c={c} label={label(c)} selected={c.id === channelId} />)

  return (
    <nav aria-label="Conversations" className="flex h-full w-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Dropdown align="start" trigger={
          <button className="focus-inset flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-hover" aria-label={`Workspace menu, ${team?.name ?? ''}`}>
            <Avatar src={team?.icon} name={team?.name ?? 'S'} size={24} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{team?.name ?? 'Sleck'}</span>
            <ChevronDown className="size-3.5 text-ink-3" aria-hidden />
          </button>
        }>
          <MenuItem icon={<RefreshCw className="size-4" />} onSelect={() => void refresh()}>Refresh conversations</MenuItem>
          <MenuItem icon={<Keyboard className="size-4" />} onSelect={() => setStore({ shortcuts: true })} hint="?">Keyboard shortcuts</MenuItem>
          <MenuSep />
          <MenuItem icon={<LogOut className="size-4" />} onSelect={() => void logout(false)}>Sign out</MenuItem>
          <MenuItem danger icon={<ShieldOff className="size-4" />} onSelect={() => void logout(true)}>Sign out and revoke token</MenuItem>
        </Dropdown>
      </div>

      <div className="flex gap-1.5 p-2">
        <button onClick={() => setStore({ switcher: true })} className="focus-inset flex h-8 flex-1 items-center gap-2 rounded-md border border-line-strong px-2 text-[13px] text-ink-3 hover:bg-hover hover:text-ink-2">
          <Search className="size-3.5" aria-hidden />
          <span className="flex-1 text-left">Jump to…</span>
          <Kbd>{modKey}{isMac ? '' : '+'}K</Kbd>
        </button>
        <Tip label={onlyUnread ? 'Showing unread only' : 'Show unread only'}>
          <Button variant={onlyUnread ? 'default' : 'secondary'} size="iconLg" aria-pressed={onlyUnread} aria-label="Unread only" onClick={() => setOnlyUnread((v) => !v)}>
            <CheckCheck className="size-4" aria-hidden />
          </Button>
        </Tip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-1">
        <Section id="pinned" title="Pinned" count={groups.pinned.length} unread={sum(groups.pinned)}>{render(groups.pinned)}</Section>
        <Section id="channels" title="Channels" count={groups.channels.length} unread={sum(groups.channels)}>{render(groups.channels)}</Section>
        <Section id="private" title="Private" count={groups.private.length} unread={sum(groups.private)}>{render(groups.private)}</Section>
        <Section id="groups" title="Group messages" count={groups.groups.length} unread={sum(groups.groups)}>{render(groups.groups)}</Section>
        <Section id="dms" title="Direct messages" count={groups.dms.length} unread={sum(groups.dms)}>
          {render(dms)}
          {!showAllDms && !onlyUnread && groups.dms.length > dmLimit && (
            <li><button className="focus-inset h-7 w-full rounded-md px-3 text-left text-xs text-ink-2 hover:bg-hover" onClick={() => setShowAllDms(true)}>Show {groups.dms.length - dmLimit} more…</button></li>
          )}
        </Section>
        {!convs.length && <p className="p-3 text-sm text-ink-3">No conversations yet.</p>}
        {onlyUnread && !sum(convs) && <p className="p-3 text-sm text-ink-3">Nothing unread. Nice.</p>}
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 font-mono text-[11px]" role="status">
        {realtime && connected ? (
          <span className="flex items-center gap-1.5 text-ok"><Radio className="size-3.5" aria-hidden />live · Events API</span>
        ) : realtime ? (
          <span className="flex items-center gap-1.5 text-warn"><RefreshCw className="size-3.5" aria-hidden />reconnecting…</span>
        ) : (
          <span className="flex items-center gap-1.5 text-ink-2"><RefreshCw className="size-3.5" aria-hidden />polling every 5s</span>
        )}
      </div>
    </nav>
  )
}
