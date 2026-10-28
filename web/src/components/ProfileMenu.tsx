import type { ReactElement } from 'react'
import { Keyboard, LogOut, RefreshCw, ShieldOff } from '@/components/icons'
import { useStore } from '@/lib/store'
import { Avatar } from './Avatar'
import { Dropdown, MenuItem, MenuSep } from './ui/overlays'
import { StatusDot } from './ui/geist'

export function useLiveLabel() {
  const live = useStore((s) => s.live)
  const socketUp = useStore((s) => s.socketUp)
  const kind = useStore((s) => s.me?.kind)
  if (!socketUp) return { ok: false, text: 'Reconnecting…' }
  if (live === 'connected') return { ok: true, text: kind === 'web' ? 'Live · realtime socket' : 'Live · Events API' }
  if (live === 'down') return { ok: false, text: 'Slack connection lost, retrying' }
  if (live === 'connecting') return { ok: false, text: 'Connecting to Slack…' }
  return { ok: false, text: 'No live updates (Events API not set up)' }
}

/** Profile avatar with presence dot, bottom-left like Slack. The trigger is passed in so the rail and the phone drawer can style it differently. */
export function ProfileMenu({ trigger }: { trigger: (p: { name: string; avatar?: string; active: boolean }) => ReactElement }) {
  const me = useStore((s) => s.me)
  const user = useStore((s) => (me ? s.users[me.userId] : undefined))
  const setStore = useStore((s) => s.set)
  const logout = useStore((s) => s.logout)
  const refresh = useStore((s) => s.refreshConvs)
  const live = useLiveLabel()
  const name = user?.display ?? 'You'
  return (
    <Dropdown align="start" side="top" trigger={trigger({ name, avatar: user?.avatar, active: live.ok })}>
      <div className="flex items-center gap-2.5 px-2 py-2">
        <Avatar src={user?.avatar} name={name} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold">{name}</div>
          <div className="truncate font-mono text-[11px] text-ink-3">{user ? `@${user.name}` : me?.userId}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-2 pb-2 text-[12px] text-ink-2" role="status">
        <StatusDot active={live.ok} label={live.ok ? 'connected' : 'not connected'} />
        {live.text}
      </div>
      <MenuSep />
      <MenuItem icon={<RefreshCw className="size-4" />} onSelect={() => void refresh()}>Refresh conversations</MenuItem>
      <MenuItem icon={<Keyboard className="size-4" />} onSelect={() => setStore({ shortcuts: true })} hint="?">Keyboard shortcuts</MenuItem>
      <MenuSep />
      <MenuItem icon={<LogOut className="size-4" />} onSelect={() => void logout(false)}>Sign out</MenuItem>
      {me?.kind === 'oauth' && <MenuItem danger icon={<ShieldOff className="size-4" />} onSelect={() => void logout(true)}>Sign out and revoke token</MenuItem>}
    </Dropdown>
  )
}
