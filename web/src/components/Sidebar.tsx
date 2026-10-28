import { useMemo, useState } from 'react'
import { BellOff, ChevronDown, ChevronRight, CheckCheck, MoreHorizontal, Pin, Plus } from '@/components/icons'
import type { Conversation, UnreadState } from '../../../shared/types'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { ChannelIcon, useConvLabel } from './ChannelIcon'
import { ProfileMenu } from './ProfileMenu'
import { Button, Kbd } from './ui/button'
import { Badge, Skeleton, StatusDot, Tabs } from './ui/geist'
import { Dropdown, MenuItem, Tip } from './ui/overlays'
import { Search } from '@/components/icons'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'

function Row({ c, label, selected }: { c: Conversation; label: string; selected: boolean }) {
  const u = useStore((s) => s.unread[c.id]) as UnreadState | undefined
  const pinned = useStore((s) => s.prefs.pinned.includes(c.id))
  const muted = useStore((s) => s.prefs.muted.includes(c.id) || s.slackMuted.includes(c.id))
  const select = useStore((s) => s.selectChannel)
  const setPrefs = useStore((s) => s.setPrefs)
  const markRead = useStore((s) => s.markRead)
  const hasUnread = !!u && u.unread > 0
  const mentions = u?.mentions ?? 0
  const bold = (hasUnread && !muted) || mentions > 0
  const isPlace = c.type === 'public' || c.type === 'private'
  const hideOnHover = 'group-hover/row:hidden group-focus-within/row:hidden'

  return (
    <li className="group/row relative">
      <button
        onClick={() => void select(c.id)}
        aria-current={selected ? 'page' : undefined}
        className={cn(
          'focus-inset relative flex h-8 w-full items-center gap-2 rounded-md py-0 pl-3 pr-2 text-left text-[14px] hover:bg-hover max-md:h-11',
          selected && 'bg-active text-ink before:absolute before:inset-y-1.5 before:left-0.5 before:w-0.5 before:rounded-sm before:bg-ink',
          !selected && (bold ? 'text-ink' : muted ? 'text-ink-3' : 'text-ink-2'),
        )}
      >
        <ChannelIcon conv={c} />
        <span className={cn('min-w-0 flex-1 truncate', isPlace && 'font-mono text-[13px]', bold && 'font-semibold', muted && 'italic')}>{label}</span>
        {muted && <><BellOff className="size-3 shrink-0 text-ink-3" aria-hidden /><span className="sr-only">muted</span></>}
        {pinned && !muted && <Pin className="size-3 shrink-0 text-ink-3 group-hover/row:hidden" aria-hidden />}
        {mentions > 0 ? (
          <Badge tone="inverted" className={hideOnHover}>@{mentions > 99 ? '99+' : mentions}<span className="sr-only"> {mentions === 1 ? 'mention' : 'mentions'}{u!.unread > mentions ? `, ${u!.unread} unread` : ''}</span></Badge>
        ) : hasUnread && !muted ? (
          <Badge tone="gray" className={cn(hideOnHover, 'border border-ink-3 bg-transparent text-ink')}>{u!.approx ? 'new' : u!.unread >= 100 ? '99+' : u!.unread}<span className="sr-only"> unread</span></Badge>
        ) : null}
      </button>
      <div className="absolute right-1 top-1 hidden group-focus-within/row:block group-hover/row:block max-md:top-2">
        <Dropdown trigger={<Button variant="ghost" size="icon" className="h-6 w-6" aria-label={`Options for ${label}`}><MoreHorizontal className="size-3.5" aria-hidden /></Button>}>
          <MenuItem icon={<Pin className="size-4" />} onSelect={() => setPrefs((p) => ({ ...p, pinned: pinned ? p.pinned.filter((x) => x !== c.id) : [...p.pinned, c.id] }))}>{pinned ? 'Unpin from top' : 'Pin to top'}</MenuItem>
          <MenuItem icon={<BellOff className="size-4" />} onSelect={() => setPrefs((p) => ({ ...p, muted: muted ? p.muted.filter((x) => x !== c.id) : [...p.muted, c.id] }))}>{muted ? 'Unmute (Sleck only)' : 'Mute (Sleck only)'}</MenuItem>
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
          className="focus-inset flex h-7 w-full items-center gap-1 rounded-md px-2 text-[12px] font-medium text-ink-3 hover:text-ink-2"
        >
          {collapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
          {title}
          <span className="font-mono text-[11px]">{count}</span>
          {collapsed && unread > 0 && <Badge tone="gray" className="ml-auto border border-ink-3 bg-transparent">{unread}<span className="sr-only"> unread</span></Badge>}
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
  const sections = useStore((s) => s.sections)
  const view = useStore((s) => s.sidebarView)
  const status = useStore((s) => s.status)
  const set = useStore((s) => s.set)
  const label = useConvLabel()
  const [onlyUnread, setOnlyUnread] = useState(false)
  const [showAllDms, setShowAllDms] = useState(false)
  const slackMuted = useStore((s) => s.slackMuted)
  const isMuted = (id: string) => prefs.muted.includes(id) || slackMuted.includes(id)

  const sum = (cs: Conversation[]) => cs.reduce((n, c) => n + (unread[c.id]?.unread ?? 0), 0)
  const mentionCount = convs.reduce((n, c) => n + (isMuted(c.id) ? 0 : (unread[c.id]?.mentions ?? 0)), 0)
  const render = (cs: Conversation[]) => cs.map((c) => <Row key={c.id} c={c} label={label(c)} selected={c.id === channelId} />)

  const groups = useMemo(() => {
    const has = (c: Conversation) => (unread[c.id]?.unread ?? 0) > 0
    const visible = convs.filter((c) => !onlyUnread || has(c) || c.id === channelId)
    const byName = (a: Conversation, b: Conversation) => label(a).localeCompare(label(b), undefined, { sensitivity: 'base' })
    const byRecent = (a: Conversation, b: Conversation) => Number(unread[b.id]?.latestTs ?? 0) - Number(unread[a.id]?.latestTs ?? 0) || byName(a, b)
    const pinned = prefs.pinned.map((id) => visible.find((c) => c.id === id)).filter((c): c is Conversation => !!c)
    const rest = visible.filter((c) => !prefs.pinned.includes(c.id))
    const byId = new Map(rest.map((c) => [c.id, c]))
    // Slack's own sections when we have them (web sessions), our grouping by type otherwise
    const slackSections = sections?.map((s) => ({ id: `slack:${s.id}`, name: s.name || s.type, items: s.channelIds.map((id) => byId.get(id)).filter((c): c is Conversation => !!c) })).filter((s) => s.items.length)
    const placed = new Set(slackSections?.flatMap((s) => s.items.map((c) => c.id)))
    const leftovers = slackSections ? rest.filter((c) => !placed.has(c.id)).sort(byName) : []
    return {
      pinned,
      slackSections,
      leftovers,
      channels: rest.filter((c) => c.type === 'public').sort(byName),
      private: rest.filter((c) => c.type === 'private').sort(byName),
      groups: rest.filter((c) => c.type === 'group_dm').sort(byRecent),
      dms: rest.filter((c) => c.type === 'dm').sort(byRecent),
      allDms: visible.filter((c) => c.type === 'dm' || c.type === 'group_dm').sort(byRecent),
      activity: visible
        .filter((c) => (unread[c.id]?.unread ?? 0) > 0 && !isMuted(c.id))
        .sort((a, b) => (unread[b.id]?.mentions ?? 0) - (unread[a.id]?.mentions ?? 0) || byRecent(a, b)),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convs, unread, prefs.pinned, prefs.muted, slackMuted, onlyUnread, channelId, label, sections])

  const dmLimit = 20
  const dms = showAllDms || onlyUnread ? groups.dms : groups.dms.slice(0, dmLimit)

  return (
    <nav aria-label="Conversations" className="flex h-full w-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Avatar src={team?.icon} name={team?.name ?? 'S'} size={22} className="md:hidden" />
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{view === 'home' ? (team?.name ?? 'Sleck') : view === 'dms' ? 'Direct messages' : 'Activity'}</h1>
        <Tip label={onlyUnread ? 'Showing unread only' : 'Show unread only'}>
          <Button variant={onlyUnread ? 'default' : 'ghost'} size="iconLg" aria-pressed={onlyUnread} aria-label="Unread only" onClick={() => setOnlyUnread((v) => !v)}>
            <CheckCheck className="size-4" aria-hidden />
          </Button>
        </Tip>
        <Tip label="New message"><Button variant="ghost" size="iconLg" aria-label="New message" onClick={() => set({ switcher: true })}><Plus className="size-4" aria-hidden /></Button></Tip>
      </div>

      <div className="p-2">
        <button onClick={() => set({ switcher: true })} className="focus-inset flex h-8 w-full items-center gap-2 rounded-md border border-line-strong px-2 text-[13px] text-ink-3 hover:bg-hover hover:text-ink-2 max-md:h-10">
          <Search className="size-3.5" aria-hidden />
          <span className="flex-1 text-left">Jump to…</span>
          <Kbd className="max-md:hidden">{modKey}{isMac ? '' : '+'}K</Kbd>
        </button>
      </div>
      <Tabs
        className="px-1 md:hidden"
        label="Sidebar view"
        value={view}
        onChange={(v) => set({ sidebarView: v })}
        items={[{ id: 'home', label: 'Home' }, { id: 'dms', label: 'DMs' }, { id: 'activity', label: 'Activity', badge: mentionCount }]}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-1">
        {status === 'ready' && !convs.length && (
          <div className="space-y-2 p-2" aria-hidden>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-6" />)}</div>
        )}
        {view === 'home' && (
          <>
            <Section id="pinned" title="Pinned" count={groups.pinned.length} unread={sum(groups.pinned)}>{render(groups.pinned)}</Section>
            {groups.slackSections ? (
              <>
                {groups.slackSections.map((s) => <Section key={s.id} id={s.id} title={s.name} count={s.items.length} unread={sum(s.items)}>{render(s.items)}</Section>)}
                <Section id="other" title="Other" count={groups.leftovers.length} unread={sum(groups.leftovers)}>{render(groups.leftovers)}</Section>
              </>
            ) : (
              <>
                <Section id="channels" title="Channels" count={groups.channels.length} unread={sum(groups.channels)}>{render(groups.channels)}</Section>
                <Section id="private" title="Private" count={groups.private.length} unread={sum(groups.private)}>{render(groups.private)}</Section>
                <Section id="groups" title="Group messages" count={groups.groups.length} unread={sum(groups.groups)}>{render(groups.groups)}</Section>
                <Section id="dms" title="Direct messages" count={groups.dms.length} unread={sum(groups.dms)}>
                  {render(dms)}
                  {!showAllDms && !onlyUnread && groups.dms.length > dmLimit && (
                    <li><button className="focus-inset h-8 w-full rounded-md px-3 text-left text-xs text-ink-2 hover:bg-hover" onClick={() => setShowAllDms(true)}>Show {groups.dms.length - dmLimit} more…</button></li>
                  )}
                </Section>
              </>
            )}
          </>
        )}
        {view === 'dms' && <ul>{render(groups.allDms)}</ul>}
        {view === 'activity' && (groups.activity.length ? <ul>{render(groups.activity)}</ul> : <p className="p-3 text-sm text-ink-3">You're all caught up.</p>)}
        {view === 'home' && onlyUnread && !sum(convs) && <p className="p-3 text-sm text-ink-3">Nothing unread. Nice.</p>}
      </div>

      {/* phones: the profile lives here, because the rail is hidden */}
      <div className="border-t border-line p-2 md:hidden">
        <ProfileMenu
          trigger={({ name, avatar, active }) => (
            <button aria-label={`Profile and account, ${name}`} className="focus-inset flex h-12 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-hover">
              <span className="relative"><Avatar src={avatar} name={name} size={32} /><StatusDot active={active} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background" /></span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{name}</span>
              <MoreHorizontal className="size-4 text-ink-3" aria-hidden />
            </button>
          )}
        />
      </div>
    </nav>
  )
}
