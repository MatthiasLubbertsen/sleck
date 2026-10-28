import { useEffect } from 'react'
import { useStore } from '@/lib/store'
import { Kbd } from './ui/button'
import { Modal } from './ui/overlays'
import { modKey } from './Sidebar'

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Global keyboard shortcuts. Single-key ones only fire outside text fields. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (s.status !== 'ready') return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); s.set({ switcher: !s.switcher }); return }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); s.set({ searchOpen: true }); return }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const order = document.querySelectorAll<HTMLElement>('nav[aria-label="Conversations"] li button[aria-current], nav[aria-label="Conversations"] li > button')
        const btns = [...order]
        const i = btns.findIndex((b) => b.getAttribute('aria-current') === 'page')
        const only = e.shiftKey
        const step = e.key === 'ArrowUp' ? -1 : 1
        for (let k = 1; k <= btns.length; k++) {
          const b = btns[(i + step * k + btns.length * 2) % btns.length]
          if (!b) continue
          if (only && !/\d+ unread|\d+ mentions?/.test(b.textContent ?? '')) continue
          b.click()
          break
        }
        return
      }
      if (e.key === 'Escape' && e.shiftKey && s.channelId) {
        e.preventDefault()
        const last = s.chans[s.channelId]?.msgs.at(-1)?.ts
        if (last) s.markRead(s.channelId, last)
        return
      }
      if (mod || e.altKey || typing(e.target)) return
      if (e.key === '?') { e.preventDefault(); s.set({ shortcuts: true }) }
      else if (e.key === '/') { e.preventDefault(); s.set({ searchOpen: true }) }
      else if (e.key === 'i' || e.key === 'c') { e.preventDefault(); document.getElementById('composer-main')?.focus() }
      else if (e.key === 'u') {
        const target = s.convs.find((c) => (s.unread[c.id]?.mentions ?? 0) > 0 && c.id !== s.channelId) ?? s.convs.find((c) => (s.unread[c.id]?.unread ?? 0) > 0 && c.id !== s.channelId)
        if (target) { e.preventDefault(); void s.selectChannel(target.id) }
      } else if (e.key === 'Escape') {
        if (s.thread) s.closeThread()
        else if (s.searchOpen) s.set({ searchOpen: false })
        else if (s.drawer) s.set({ drawer: false })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

const rows: [string, string[]][] = [
  ['Jump to a conversation', [modKey, 'K']],
  ['Previous / next conversation', ['Alt', '↑ ↓']],
  ['Previous / next unread conversation', ['Alt', 'Shift', '↑ ↓']],
  ['Go to the next unread (mentions first)', ['U']],
  ['Focus the composer', ['I']],
  ['Search messages', ['/']],
  ['Mark conversation as read', ['Shift', 'Esc']],
  ['Close thread, search or drawer', ['Esc']],
  ['Edit your last message', ['↑ in empty composer']],
  ['Move between messages', ['↑ ↓']],
  ['Focused message: edit (yours)', ['E']],
  ['Focused message: reply in thread', ['T']],
  ['Send / newline', ['Enter', 'Shift+Enter']],
  ['This sheet', ['?']],
]

export function ShortcutSheet() {
  const open = useStore((s) => s.shortcuts)
  const set = useStore((s) => s.set)
  return (
    <Modal open={open} onOpenChange={(o) => set({ shortcuts: o })} title="Keyboard shortcuts" description="All keyboard shortcuts in Sleck">
      <div className="p-5">
        <h2 className="mb-3 text-base font-semibold">Keyboard shortcuts</h2>
        <dl className="divide-y divide-line">
          {rows.map(([label, keys]) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2 text-[13px]">
              <dt className="text-ink-2">{label}</dt>
              <dd className="flex shrink-0 gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-3">Single-key shortcuts work when no text field is focused.</p>
      </div>
    </Modal>
  )
}
