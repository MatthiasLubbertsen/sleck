import { Bell, Home, MessageSquare, Plus } from '@/components/icons'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { ProfileMenu } from './ProfileMenu'
import { Badge, StatusDot } from './ui/geist'
import { Tip } from './ui/overlays'

type View = 'home' | 'dms' | 'activity'

/** Far-left rail, as in Slack's desktop app: workspace, views, then "+" and your profile at the bottom. */
export function Rail() {
  const team = useStore((s) => s.me?.team)
  const view = useStore((s) => s.sidebarView)
  const set = useStore((s) => s.set)
  const unread = useStore((s) => s.unread)
  const convs = useStore((s) => s.convs)
  const muted = useStore((s) => s.prefs.muted)
  const slackMuted = useStore((s) => s.slackMuted)
  const mentions = convs.reduce((n, c) => n + (muted.includes(c.id) || slackMuted.includes(c.id) ? 0 : (unread[c.id]?.mentions ?? 0)), 0)
  const dmUnread = convs.filter((c) => (c.type === 'dm' || c.type === 'group_dm') && (unread[c.id]?.unread ?? 0) > 0).length

  const item = (id: View, label: string, Icon: typeof Home, badge?: number) => (
    <Tip label={label} side="right" key={id}>
      <button
        onClick={() => set({ sidebarView: id })}
        aria-pressed={view === id}
        className={cn('focus-inset relative flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-hover hover:text-ink', view === id && 'bg-active text-ink')}
      >
        <Icon className="size-[18px]" aria-hidden />
        <span className="sr-only">{label}</span>
        {!!badge && <Badge tone="inverted" className="absolute -right-0.5 -top-0.5 h-4 min-w-4 text-[10px]">{badge > 99 ? '99+' : badge}</Badge>}
      </button>
    </Tip>
  )

  return (
    <nav aria-label="Workspace" className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-background py-2 md:flex">
      <Tip label={team?.name ?? 'Workspace'} side="right">
        <div className="mb-2"><Avatar src={team?.icon} name={team?.name ?? 'S'} size={32} /></div>
      </Tip>
      {item('home', 'Home', Home)}
      {item('dms', 'Direct messages', MessageSquare, dmUnread)}
      {item('activity', 'Activity: mentions and unread', Bell, mentions)}
      <div className="flex-1" />
      <Tip label="New message (Ctrl K)" side="right">
        <button onClick={() => set({ switcher: true })} aria-label="New message" className="focus-inset mb-1 flex size-9 items-center justify-center rounded-md border border-line-strong text-ink-2 hover:bg-hover hover:text-ink">
          <Plus className="size-4" aria-hidden />
        </button>
      </Tip>
      <ProfileMenu
        trigger={({ name, avatar, active }) => (
          <button aria-label={`Profile and account, ${name}`} className="focus-inset relative rounded-md">
            <Avatar src={avatar} name={name} size={36} />
            <StatusDot active={active} label={active ? 'connected' : 'not connected'} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background" />
          </button>
        )}
      />
    </nav>
  )
}
