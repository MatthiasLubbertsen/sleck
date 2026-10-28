import { AlertCircle, Info } from 'lucide-react'
import { useStore } from '@/lib/store'

export function Toaster() {
  const toasts = useStore((s) => s.toasts)
  const until = useStore((s) => s.rateLimitedUntil)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pop pointer-events-auto flex items-start gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px]">
          {t.kind === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />}
          <span className={t.kind === 'error' ? 'text-danger' : ''}>{t.text}</span>
        </div>
      ))}
      {until > Date.now() && <div className="pointer-events-auto rounded-md border border-warn/60 bg-surface px-3 py-2 text-[13px] text-warn">Slack is rate limiting requests; some actions may be slower.</div>}
    </div>
  )
}
