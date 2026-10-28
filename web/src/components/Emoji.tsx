import { memo } from 'react'
import { useStore } from '@/lib/store'
import { resolveEmoji } from '@/lib/emoji'

export const Emoji = memo(function Emoji({ name, className }: { name: string; className?: string }) {
  const custom = useStore((s) => s.customEmoji)
  useStore((s) => s.emojiVersion) // re-render once the unicode table has loaded
  const r = resolveEmoji(name, custom)
  if (!r) return <span className={className}>:{name}:</span>
  if (r.kind === 'img') return <img src={r.url} alt={`:${name}:`} title={`:${name}:`} className={`emoji-img ${className ?? ''}`} referrerPolicy="no-referrer" loading="lazy" />
  return <span role="img" aria-label={name.replace(/_/g, ' ')} title={`:${name}:`} className={className}>{r.char}</span>
})
