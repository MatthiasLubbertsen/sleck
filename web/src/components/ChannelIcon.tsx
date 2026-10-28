import { Archive, Hash, Link2, Lock, User, Users } from 'lucide-react'
import type { Conversation } from '../../../shared/types'
import { useStore } from '@/lib/store'

/** One glyph per conversation type; the shapes differ so type never depends on color. */
export function ChannelIcon({ conv, className = 'size-4' }: { conv: Pick<Conversation, 'type' | 'isExtShared' | 'isArchived'>; className?: string }) {
  const label = { public: 'Public channel', private: 'Private channel', dm: 'Direct message', group_dm: 'Group message' }[conv.type]
  const Icon = conv.isArchived ? Archive : conv.type === 'public' ? Hash : conv.type === 'private' ? Lock : conv.type === 'dm' ? User : Users
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-ink-2" role="img" aria-label={label + (conv.isExtShared ? ', shared with another organization' : '')}>
      <Icon className={className} aria-hidden strokeWidth={2} />
      {conv.isExtShared && <Link2 className="size-3 text-ink-3" aria-hidden />}
    </span>
  )
}

/** Human label for a conversation: places in mono elsewhere, people in sans here. */
export function useConvLabel() {
  const users = useStore((s) => s.users)
  const me = useStore((s) => s.me?.userId)
  return (c: Pick<Conversation, 'type' | 'name' | 'user'>): string => {
    if (c.type === 'dm') {
      const u = c.user ? users[c.user] : undefined
      return u ? u.display : (c.user ?? 'Direct message')
    }
    if (c.type === 'group_dm') {
      const handles = c.name.replace(/^mpdm-/, '').replace(/-\d+$/, '').split('--')
      const myHandle = me ? users[me]?.name : undefined
      const byName = new Map(Object.values(users).map((u) => [u.name, u]))
      return handles.filter((h) => h !== myHandle).map((h) => byName.get(h)?.display ?? h).join(', ') || c.name
    }
    return c.name
  }
}
