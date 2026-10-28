const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const exact = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const dayFmtYear = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const shortDateYear = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

export const toDate = (ts: string | number) => new Date(Number(ts) * 1000)
export const fmtClock = (ts: string | number) => clock.format(toDate(ts))
export const fmtExact = (ts: string | number) => exact.format(toDate(ts))
export const dayKey = (ts: string | number) => {
  const d = toDate(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function dayLabel(ts: string | number, now = new Date()): string {
  const d = toDate(ts)
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return (d.getFullYear() === now.getFullYear() ? dayFmt : dayFmtYear).format(d)
}

/** Relative for recent things, absolute afterwards. The exact time is always one hover away. */
export function fmtRelative(ts: string | number, now = Date.now()): string {
  const d = toDate(ts)
  const s = Math.round((now - d.getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  const nd = new Date(now)
  const days = Math.round((startOfDay(nd) - startOfDay(d)) / 86400000)
  if (days === 0) return `${Math.round(s / 3600)}h ago`
  if (days === 1) return `Yesterday ${clock.format(d)}`
  return `${(d.getFullYear() === nd.getFullYear() ? shortDate : shortDateYear).format(d)} ${clock.format(d)}`
}

export const fmtBytes = (n?: number) => {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
