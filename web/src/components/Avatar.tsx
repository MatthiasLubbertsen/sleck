import { useState } from 'react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function Avatar({ src, name, size = 36, className }: { src?: string; name: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  const initial = (name.replace(/^[@#]/, '')[0] ?? '?').toUpperCase()
  const style = { width: size, height: size }
  if (!src || broken) {
    return (
      <span aria-hidden style={style} className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-md border border-line-strong bg-surface-2 font-mono text-[0.8em] text-ink-2', className)}>
        {initial}
      </span>
    )
  }
  return <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" style={style} className={cn('shrink-0 rounded-md bg-surface-2 object-cover', className)} onError={() => setBroken(true)} />
}

export function UserAvatar({ id, size = 36, fallbackName, fallbackSrc }: { id?: string; size?: number; fallbackName?: string; fallbackSrc?: string }) {
  const u = useStore((s) => (id ? s.users[id] : undefined))
  return <Avatar src={u?.avatar || fallbackSrc} name={u?.display ?? fallbackName ?? id ?? '?'} size={size} />
}

/** Small icon of the other workspace, for Slack Connect people and channels. */
export function TeamBadge({ teamId, size = 14 }: { teamId?: string; size?: number }) {
  const team = useStore((s) => (teamId ? s.teams[teamId] : undefined))
  if (!teamId) return null
  return (
    <span title={`External workspace: ${team?.name ?? teamId}`} className="inline-flex shrink-0 items-center">
      <Avatar src={team?.icon} name={team?.name ?? 'W'} size={size} className="rounded-sm" />
      <span className="sr-only">External workspace {team?.name ?? teamId}</span>
    </span>
  )
}
