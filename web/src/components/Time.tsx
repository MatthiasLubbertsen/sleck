import { useSyncExternalStore } from 'react'
import { fmtClock, fmtExact, fmtRelative, toDate } from '@/lib/time'
import { Tip } from './ui/overlays'

let now = Date.now()
const listeners = new Set<() => void>()
setInterval(() => {
  now = Date.now()
  listeners.forEach((l) => l())
}, 30_000)
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l))
const useNow = () => useSyncExternalStore(subscribe, () => now)

/** Relative label (mono, so digits stay unambiguous); exact timestamp on hover and focus. */
export function Time({ ts, mode = 'relative', className }: { ts: string; mode?: 'relative' | 'clock'; className?: string }) {
  const n = useNow()
  const label = mode === 'clock' ? fmtClock(ts) : fmtRelative(ts, n)
  return (
    <Tip label={<span className="font-mono">{fmtExact(ts)}</span>}>
      <time dateTime={toDate(ts).toISOString()} tabIndex={0} className={`font-mono text-[11px] tabular-nums text-ink-3 ${className ?? ''}`}>
        {label}
      </time>
    </Tip>
  )
}
