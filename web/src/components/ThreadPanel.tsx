import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { threadKey, useStore } from '@/lib/store'
import { ChannelIcon, useConvLabel } from './ChannelIcon'
import { Composer, type ComposerHandle } from './Composer'
import { MessageList } from './MessageList'
import { Button } from './ui/button'

export function ThreadPanel() {
  const thread = useStore((s) => s.thread)!
  const close = useStore((s) => s.closeThread)
  const conv = useStore((s) => s.convs.find((c) => c.id === thread.channel))
  const state = useStore((s) => s.threads[threadKey(thread.channel, thread.ts)])
  const label = useConvLabel()
  const composer = useRef<ComposerHandle>(null)
  const noop = useCallback(() => undefined, [])

  useEffect(() => {
    // ESC closes the panel (the composer/dialogs stop propagation for their own Escape)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"],[role="listbox"]')) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const count = Math.max(0, (state?.msgs.length ?? 1) - 1)

  return (
    <aside
      aria-label="Thread"
      className="fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:w-[400px] lg:shrink-0 lg:border-l lg:border-line"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); composer.current?.addFiles([...e.dataTransfer.files]) }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-4">Thread</h2>
          {conv && (
            <p className="flex items-center gap-1 truncate text-xs text-ink-2">
              <ChannelIcon conv={conv} className="size-3" />
              <span className={conv.type === 'public' || conv.type === 'private' ? 'font-mono' : ''}>{label(conv)}</span>
              <span className="text-ink-3">· {count} {count === 1 ? 'reply' : 'replies'}</span>
            </p>
          )}
        </div>
        <Button variant="ghost" size="iconLg" aria-label="Close thread (Esc)" onClick={close}><X className="size-4" aria-hidden /></Button>
      </header>
      <MessageList channelId={thread.channel} state={state} inThread focusTs={thread.focus} onNearBottom={noop} />
      <Composer ref={composer} id="composer-thread" channelId={thread.channel} threadTs={thread.ts} placeholder="Reply…" autoFocus />
    </aside>
  )
}
