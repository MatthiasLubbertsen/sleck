import { Fragment, memo, type ReactNode } from 'react'
import { useStore } from '@/lib/store'
import { HL_CLOSE, HL_OPEN, parseMrkdwn, type Inline } from '@/lib/mrkdwn'
import { SHORTCODE } from '@/lib/emoji'
import { Emoji } from './Emoji'
import { cn } from '@/lib/utils'

function UserMention({ id, label }: { id: string; label?: string }) {
  const u = useStore((s) => s.users[id])
  const isMe = useStore((s) => s.me?.userId === id)
  const name = u?.name ?? label ?? id
  return (
    <span className={cn('rounded-sm px-1 font-mono text-[0.92em]', isMe ? 'bg-warn/20 font-semibold text-warn' : 'bg-active text-ink')} title={u ? `${u.display}` : undefined}>
      @{name}
      {isMe && <span className="sr-only"> (you)</span>}
    </span>
  )
}

function ChannelMention({ id, label }: { id: string; label?: string }) {
  const conv = useStore((s) => s.convs.find((c) => c.id === id))
  const select = useStore((s) => s.selectChannel)
  const name = conv?.name ?? label ?? id
  const cls = 'rounded-sm bg-active px-1 font-mono text-[0.92em] text-ink'
  return conv ? (
    <button className={cn(cls, 'hover:underline')} onClick={() => void select(id)}>#{name}</button>
  ) : (
    <span className={cls}>#{name}</span>
  )
}

interface HlState { on: boolean }

function Text({ v, hl }: { v: string; hl: HlState }) {
  // Split on search-highlight markers first, then turn :shortcodes: into emoji.
  const parts: ReactNode[] = []
  let buf = ''
  const emit = (s: string, on: boolean, key: number) => {
    if (!s) return
    const nodes: ReactNode[] = []
    let last = 0
    for (const m of s.matchAll(SHORTCODE)) {
      nodes.push(s.slice(last, m.index))
      nodes.push(<Emoji key={`${key}-${m.index}`} name={m[1]} />)
      last = m.index + m[0].length
    }
    nodes.push(s.slice(last))
    parts.push(on ? <mark key={key} className="rounded-sm bg-warn/30 px-0.5 text-ink">{nodes}</mark> : <Fragment key={key}>{nodes}</Fragment>)
  }
  let k = 0
  for (const ch of v) {
    if (ch === HL_OPEN || ch === HL_CLOSE) {
      emit(buf, hl.on, k++)
      buf = ''
      hl.on = ch === HL_OPEN
    } else buf += ch
  }
  emit(buf, hl.on, k)
  return <>{parts}</>
}

function Inlines({ nodes, hl }: { nodes: Inline[]; hl: HlState }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return <Text key={i} v={n.v} hl={hl} />
          case 'bold': return <strong key={i} className="font-semibold"><Inlines nodes={n.c} hl={hl} /></strong>
          case 'italic': return <em key={i}><Inlines nodes={n.c} hl={hl} /></em>
          case 'strike': return <s key={i} className="text-ink-2"><Inlines nodes={n.c} hl={hl} /></s>
          case 'code': return <code key={i} className="rounded-sm border border-line-strong bg-surface-2 px-1 py-px font-mono text-[0.88em]">{n.v}</code>
          case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow"><Inlines nodes={n.c} hl={hl} /></a>
          case 'user': return <UserMention key={i} id={n.id} label={n.label} />
          case 'channel': return <ChannelMention key={i} id={n.id} label={n.label} />
          case 'group': return <span key={i} className="rounded-sm bg-active px-1 font-mono text-[0.92em]">{n.label ?? '@group'}</span>
          case 'special': return <span key={i} className="rounded-sm bg-warn/20 px-1 font-mono text-[0.92em] font-semibold text-warn">@{n.v}</span>
          case 'date': return <span key={i} title={new Date(n.ts * 1000).toString()}>{n.fallback || new Date(n.ts * 1000).toLocaleString()}</span>
        }
      })}
    </>
  )
}

const EMOJI_ONLY = /^(?:\s|:[a-z0-9_+\-']+(?:::skin-tone-[2-6])?:|\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*|[\u{1F3FB}-\u{1F3FF}])+$/iu

export const Mrkdwn = memo(function Mrkdwn({ text, className }: { text: string; className?: string }) {
  const blocks = parseMrkdwn(text)
  const hl: HlState = { on: false }
  const jumbo = EMOJI_ONLY.test(text.trim()) && (text.match(/:[a-z0-9_+\-']+:|\p{Extended_Pictographic}/giu) ?? []).length <= 23
  return (
    <div className={cn('msg-body break-words [overflow-wrap:anywhere]', jumbo && 'emoji-jumbo', className)}>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'pre':
            return <pre key={i} className="my-1 overflow-x-auto rounded-md border border-line-strong bg-surface-2 p-3 font-mono text-[13px] leading-[1.45] whitespace-pre">{b.v}</pre>
          case 'quote':
            return (
              <blockquote key={i} className="my-1 border-l-2 border-line-strong pl-3 text-ink-2">
                {b.lines.map((l, j) => <div key={j}><Inlines nodes={l} hl={hl} />{l.length === 0 && <br />}</div>)}
              </blockquote>
            )
          case 'list':
            return (
              <ul key={i} className="my-1 space-y-0.5">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2" style={{ paddingLeft: it.indent * 20 }}>
                    <span className="w-4 shrink-0 text-right font-mono text-ink-2" aria-hidden>{it.mark}</span>
                    <span className="min-w-0"><Inlines nodes={it.c} hl={hl} /></span>
                  </li>
                ))}
              </ul>
            )
          case 'p':
            return (
              <p key={i} className="my-0.5">
                {b.lines.map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    <Inlines nodes={l} hl={hl} />
                  </Fragment>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
})
