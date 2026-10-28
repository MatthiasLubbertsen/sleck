import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { allEmoji, GROUPS, loadEmoji, searchEmoji, type EmojiHit } from '@/lib/emoji'
import { useStore } from '@/lib/store'
import { Pop } from './ui/overlays'
import { Emoji } from './Emoji'

const RECENT_KEY = 'sleck.recentEmoji'
const COLS = 8

function recent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}
function remember(name: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...recent().filter((n) => n !== name)].slice(0, 24)))
  } catch { /* storage unavailable; recents are a convenience */ }
}

function Panel({ onPick }: { onPick: (name: string) => void }) {
  const custom = useStore((s) => s.customEmoji)
  useStore((s) => s.emojiVersion)
  const [q, setQ] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<string>('')
  const recents = useMemo(recent, [])

  const sections = useMemo(() => {
    const secs: { title: string; items: EmojiHit[] }[] = []
    if (q.trim()) {
      secs.push({ title: `Results for “${q.trim()}”`, items: searchEmoji(q.trim(), custom, 160) })
      return secs
    }
    if (recents.length) secs.push({ title: 'Recent', items: recents.map((name) => ({ name })) })
    const customItems = Object.keys(custom).sort().map((name) => ({ name, url: custom[name] }))
    if (customItems.length) secs.push({ title: 'Workspace', items: customItems })
    const byGroup = GROUPS.map((title) => ({ title, items: [] as EmojiHit[] }))
    for (const e of allEmoji()) byGroup[e.group]?.items.push({ name: e.name, char: e.char })
    return secs.concat(byGroup.filter((g) => g.items.length))
  }, [q, custom, recents])

  const flat = sections.flatMap((s) => s.items)
  const hovered = flat.find((e) => e.name === active) ?? flat[0]

  const onKeyDown = (e: React.KeyboardEvent) => {
    const btns = [...(gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-emoji]') ?? [])]
    const i = btns.findIndex((b) => b === document.activeElement)
    const go = (j: number) => btns[Math.max(0, Math.min(btns.length - 1, j))]?.focus()
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i < 0 ? 0 : i + COLS) }
    else if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); if (i < COLS) (e.currentTarget.querySelector('input') as HTMLInputElement)?.focus(); else go(i - COLS) }
    else if (e.key === 'ArrowRight' && i >= 0) { e.preventDefault(); go(i + 1) }
    else if (e.key === 'ArrowLeft' && i >= 0) { e.preventDefault(); go(i - 1) }
    else if (e.key === 'Enter' && i < 0 && flat[0]) { e.preventDefault(); onPick(flat[0].name) }
  }

  return (
    <div className="flex h-[380px] w-[min(92vw,336px)] flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 text-ink-3" aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji" aria-label="Search emoji" className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" />
      </div>
      <div ref={gridRef} className="flex-1 overflow-y-auto px-2 pb-2" role="group" aria-label="Emoji">
        {sections.map((s) => (
          <section key={s.title}>
            <h3 className="sticky top-0 z-10 bg-surface px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">{s.title}</h3>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}>
              {s.items.map((e) => (
                <button
                  key={s.title + e.name}
                  data-emoji
                  aria-label={e.name.replace(/_/g, ' ')}
                  onMouseEnter={() => setActive(e.name)}
                  onFocus={() => setActive(e.name)}
                  onClick={() => onPick(e.name)}
                  className="focus-inset flex h-9 items-center justify-center rounded-md text-xl hover:bg-active"
                >
                  <Emoji name={e.name} />
                </button>
              ))}
            </div>
          </section>
        ))}
        {!flat.length && <p className="p-4 text-center text-sm text-ink-3">No emoji found</p>}
      </div>
      <div className="flex h-9 items-center gap-2 border-t border-line px-3 text-xs text-ink-2">
        {hovered ? (<><Emoji name={hovered.name} className="text-base" /><span className="truncate font-mono">:{hovered.name}:</span></>) : <span>Pick an emoji</span>}
      </div>
    </div>
  )
}

export function EmojiPicker({ trigger, onPick, side = 'top', align = 'end' }: { trigger: ReactNode; onPick: (name: string) => void; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end' }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (open) void loadEmoji()
  }, [open])
  return (
    <Pop open={open} onOpenChange={setOpen} trigger={trigger} side={side} align={align}>
      <Panel onPick={(name) => { remember(name); setOpen(false); onPick(name) }} />
    </Pop>
  )
}
