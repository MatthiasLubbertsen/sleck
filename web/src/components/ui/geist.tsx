// Geist-style primitives: Badge, Spinner, Skeleton, Note, StatusDot, Switch, Input, Tabs.
// Conventions follow vercel.com/geist: 6px radius, alpha-gray borders, 14px text, no shadows,
// colour only for meaning (blue/red/amber/green), always paired with an icon or text.
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { AlertCircle, Info, Loader2 } from '@/components/icons'

type Tone = 'gray' | 'blue' | 'red' | 'amber' | 'green' | 'inverted'

const tones: Record<Tone, string> = {
  gray: 'bg-[var(--ds-gray-alpha-200)] text-ink-2',
  blue: 'bg-[#0070f3]/20 text-[#79b8ff]',
  red: 'bg-danger-fill/20 text-danger',
  amber: 'bg-warn/20 text-warn',
  green: 'bg-[#46a758]/20 text-ok',
  inverted: 'bg-ink text-black',
}

/** Geist Badge. Counts use the mono face so digits stay unambiguous. */
export function Badge({ tone = 'gray', children, className, mono = true }: { tone?: Tone; children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <span className={cn('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm px-1 text-[11px] font-semibold leading-none', mono && 'font-mono', tones[tone], className)}>
      {children}
    </span>
  )
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 aria-hidden className={cn('size-4 motion-safe:animate-spin', className)} />

export const Skeleton = ({ className }: { className?: string }) => (
  <div aria-hidden className={cn('rounded-md bg-[var(--ds-gray-alpha-200)] motion-safe:animate-pulse', className)} />
)

/** Geist Note: a bordered callout with an icon, so state never relies on colour alone. */
export function Note({ tone = 'gray', children, className, action }: { tone?: 'gray' | 'red' | 'amber' | 'blue'; children: ReactNode; className?: string; action?: ReactNode }) {
  const border = { gray: 'border-line-strong', red: 'border-danger-fill/60', amber: 'border-warn/50', blue: 'border-[#0070f3]/60' }[tone]
  const text = { gray: 'text-ink-2', red: 'text-danger', amber: 'text-warn', blue: 'text-[#79b8ff]' }[tone]
  const Icon = tone === 'gray' || tone === 'blue' ? Info : AlertCircle
  return (
    <div role={tone === 'red' || tone === 'amber' ? 'alert' : 'status'} className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] leading-5', border, text, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

/** Presence: filled green = active, hollow = away/unknown. The text label is always present for AT. */
export function StatusDot({ active, className, label }: { active: boolean; className?: string; label?: string }) {
  return (
    <span className={cn('inline-block size-2.5 shrink-0 rounded-full', active ? 'bg-ok' : 'border-2 border-ink-3 bg-background', className)}>
      <span className="sr-only">{label ?? (active ? 'active' : 'away')}</span>
    </span>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-md border transition-colors', checked ? 'border-ink bg-ink' : 'border-line-strong bg-background')}
    >
      <span className={cn('inline-block size-3.5 rounded-sm transition-transform duration-100', checked ? 'translate-x-[18px] bg-black' : 'translate-x-0.5 bg-ink-2')} />
    </button>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn('h-8 w-full rounded-md border border-line-strong bg-background px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3', className)}
    {...p}
  />
))
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn('w-full rounded-md border border-line-strong bg-background px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3', className)}
    {...p}
  />
))
Textarea.displayName = 'Textarea'

/** Geist Tabs (underline style). */
export function Tabs<T extends string>({ value, onChange, items, label, className }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; badge?: number }[]; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('flex border-b border-line', className)}>
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'focus-inset -mb-px flex h-9 flex-1 items-center justify-center gap-1.5 border-b-2 text-[13px] font-medium transition-colors',
            value === t.id ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
          )}
        >
          {t.label}
          {!!t.badge && <Badge tone={value === t.id ? 'inverted' : 'gray'}>{t.badge > 99 ? '99+' : t.badge}</Badge>}
        </button>
      ))}
    </div>
  )
}
