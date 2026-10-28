import { ArrowLeft, ArrowRight, Question, Search } from '@/components/icons'
import { useStore } from '@/lib/store'
import { Button, Kbd } from './ui/button'
import { Tip } from './ui/overlays'

/** Desktop top bar like Slack's: history arrows and a wide search field. Search goes to Slack's search. */
export function TopBar() {
  const team = useStore((s) => s.me?.team.name)
  const set = useStore((s) => s.set)
  return (
    <header className="hidden h-11 shrink-0 items-center gap-2 border-b border-line px-3 md:flex">
      <div className="flex w-[200px] items-center gap-0.5">
        <Tip label="Back"><Button variant="ghost" size="iconLg" aria-label="Back" onClick={() => history.back()}><ArrowLeft className="size-4" aria-hidden /></Button></Tip>
        <Tip label="Forward"><Button variant="ghost" size="iconLg" aria-label="Forward" onClick={() => history.forward()}><ArrowRight className="size-4" aria-hidden /></Button></Tip>
      </div>
      <button
        onClick={() => set({ searchOpen: true })}
        className="focus-inset mx-auto flex h-8 w-full max-w-xl items-center gap-2 rounded-md border border-line-strong bg-[var(--ds-gray-alpha-100)] px-3 text-left text-[13px] text-ink-3 hover:bg-hover"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 truncate">Search {team ?? 'Slack'}</span>
        <Kbd>/</Kbd>
      </button>
      <div className="flex w-[200px] justify-end">
        <Tip label="Keyboard shortcuts (?)"><Button variant="ghost" size="iconLg" aria-label="Keyboard shortcuts" onClick={() => set({ shortcuts: true })}><Question className="size-4" aria-hidden /></Button></Tip>
      </div>
    </header>
  )
}
