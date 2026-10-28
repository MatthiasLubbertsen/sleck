import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Paperclip, SendHorizontal, Smile, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { toSlackText, type Token } from '@/lib/compose'
import { searchEmoji } from '@/lib/emoji'
import { ChannelIcon } from './ChannelIcon'
import { Avatar } from './Avatar'
import { Emoji } from './Emoji'
import { EmojiPicker } from './EmojiPicker'
import { Button } from './ui/button'
import { Tip } from './ui/overlays'
import { cn } from '@/lib/utils'
import { fmtBytes } from '@/lib/time'

export interface ComposerHandle {
  addFiles: (files: File[]) => void
  focus: () => void
}

type Suggest =
  | { kind: 'emoji'; from: number; items: { key: string; name: string; label: string }[] }
  | { kind: 'user'; from: number; items: { key: string; label: string; raw: string; sub?: string; avatar?: string }[] }
  | { kind: 'channel'; from: number; items: { key: string; label: string; raw: string; conv: any }[] }

interface Props {
  channelId: string
  threadTs?: string
  placeholder: string
  id: string
  autoFocus?: boolean
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ channelId, threadTs, placeholder, id, autoFocus }, ref) {
  const draftKey = threadTs ? `${channelId}:${threadTs}` : channelId
  const send = useStore((s) => s.send)
  const setDraft = useStore((s) => s.setDraft)
  const users = useStore((s) => s.users)
  const convs = useStore((s) => s.convs)
  const custom = useStore((s) => s.customEmoji)
  const emojiReady = useStore((s) => s.emojiVersion)
  const conv = useStore((s) => s.convs.find((c) => c.id === channelId))
  const me = useStore((s) => s.me?.userId)
  const msgs = useStore((s) => (threadTs ? s.threads[draftKey]?.msgs : s.chans[channelId]?.msgs))

  const [text, setText] = useState(() => useStore.getState().drafts[draftKey] ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [suggest, setSuggest] = useState<Suggest | null>(null)
  const [index, setIndex] = useState(0)
  const [broadcast, setBroadcast] = useState(false)
  const tokens = useRef<Token[]>([])
  const ta = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // switching channel/thread: load that draft
  useEffect(() => {
    setText(useStore.getState().drafts[draftKey] ?? '')
    setFiles([])
    setSuggest(null)
    tokens.current = []
    setBroadcast(false)
  }, [draftKey])

  const resize = useCallback(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.4) + 'px'
  }, [])
  useEffect(resize, [text, resize])
  useEffect(() => {
    if (autoFocus) ta.current?.focus()
  }, [autoFocus, draftKey])

  const addFiles = useCallback((list: File[]) => setFiles((f) => [...f, ...list].slice(0, 10)), [])
  useImperativeHandle(ref, () => ({ addFiles, focus: () => ta.current?.focus() }), [addFiles])

  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')), [files])
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews])

  const update = (value: string, caret: number) => {
    setText(value)
    setDraft(draftKey, value)
    const before = value.slice(0, caret)
    let m: RegExpExecArray | null
    if ((m = /(?:^|\s):([a-z0-9_+-]{2,})$/i.exec(before))) {
      const items = searchEmoji(m[1], custom, 8).map((h) => ({ key: h.name, name: h.name, label: h.name }))
      setSuggest(items.length ? { kind: 'emoji', from: caret - m[1].length - 1, items } : null)
    } else if ((m = /(?:^|\s)@([\w.-]*)$/.exec(before))) {
      const q = m[1].toLowerCase()
      const people = Object.values(users)
        .filter((u) => !u.deleted && u.id !== 'USLACKBOT' && (u.name.toLowerCase().includes(q) || u.display.toLowerCase().includes(q) || u.real.toLowerCase().includes(q)))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(q) || b.display.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q) || a.display.toLowerCase().startsWith(q)) || a.display.localeCompare(b.display))
        .slice(0, 7)
        .map((u) => ({ key: u.id, label: `@${u.display}`, raw: `<@${u.id}>`, sub: u.name, avatar: u.avatar }))
      const special = conv?.type === 'dm' ? [] : [{ key: 'here', label: '@here', raw: '<!here>', sub: 'Notify active members' }, { key: 'channel', label: '@channel', raw: '<!channel>', sub: 'Notify everyone in this channel' }].filter((s) => s.label.slice(1).startsWith(q))
      const items = [...special, ...people].slice(0, 8)
      setSuggest(items.length ? { kind: 'user', from: caret - m[1].length - 1, items } : null)
    } else if ((m = /(?:^|\s)#([\w-]*)$/.exec(before))) {
      const q = m[1].toLowerCase()
      const items = convs
        .filter((c) => (c.type === 'public' || c.type === 'private') && c.name.toLowerCase().includes(q))
        .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || a.name.localeCompare(b.name))
        .slice(0, 8)
        .map((c) => ({ key: c.id, label: `#${c.name}`, raw: `<#${c.id}>`, conv: c }))
      setSuggest(items.length ? { kind: 'channel', from: caret - m[1].length - 1, items } : null)
    } else setSuggest(null)
    setIndex(0)
  }

  const insertAt = (from: number, to: number, insert: string) => {
    const next = text.slice(0, from) + insert + text.slice(to)
    const caret = from + insert.length
    setText(next)
    setDraft(draftKey, next)
    setSuggest(null)
    requestAnimationFrame(() => {
      ta.current?.focus()
      ta.current?.setSelectionRange(caret, caret)
    })
  }

  const accept = (i: number) => {
    if (!suggest) return
    const caret = ta.current?.selectionStart ?? text.length
    const item = suggest.items[i]
    if (!item) return
    if (suggest.kind === 'emoji') insertAt(suggest.from, caret, `:${(item as any).name}: `)
    else {
      const it = item as { label: string; raw: string }
      tokens.current.push({ label: it.label, raw: it.raw })
      insertAt(suggest.from, caret, it.label + ' ')
    }
  }

  const submit = () => {
    const body = toSlackText(text, tokens.current)
    if (!body && !files.length) return
    void send({ channel: channelId, text: body, thread_ts: threadTs, broadcast: threadTs ? broadcast : undefined, files: files.length ? files : undefined })
    setText('')
    setDraft(draftKey, '')
    setFiles([])
    setSuggest(null)
    tokens.current = []
    setBroadcast(false)
    requestAnimationFrame(() => ta.current?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggest) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => (i + 1) % suggest.items.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => (i - 1 + suggest.items.length) % suggest.items.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(index); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSuggest(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
      return
    }
    if (e.key === 'ArrowUp' && !text && !files.length) {
      const mine = [...(msgs ?? [])].reverse().find((m) => m.user === me && !m.subtype)
      if (mine) { e.preventDefault(); useStore.getState().set({ editTs: mine.ts }) }
    }
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = [...e.clipboardData.files]
    if (pasted.length) {
      e.preventDefault()
      addFiles(pasted.map((f, i) => (f.name === 'image.png' ? new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }) : f)))
    }
  }

  void emojiReady
  const insertEmoji = (name: string) => {
    const el = ta.current
    const a = el?.selectionStart ?? text.length
    const b = el?.selectionEnd ?? text.length
    insertAt(a, b, `:${name}: `)
  }

  return (
    <div className="relative px-4 pb-4 pt-1 max-md:px-3">
      {suggest && (
        <ul role="listbox" aria-label="Suggestions" className="pop absolute inset-x-4 bottom-full z-30 mb-1 max-h-64 overflow-y-auto rounded-md border border-line-strong bg-surface p-1 max-md:inset-x-3">
          {suggest.items.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === index}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => { e.preventDefault(); accept(i) }}
                onMouseEnter={() => setIndex(i)}
                className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px]', i === index && 'bg-active')}
              >
                {suggest.kind === 'emoji' && <><Emoji name={(it as any).name} className="text-base" /><span className="font-mono">:{(it as any).name}:</span></>}
                {suggest.kind === 'user' && (
                  <>
                    <Avatar src={(it as any).avatar} name={it.label} size={20} />
                    <span className="font-medium">{it.label}</span>
                    {(it as any).sub && <span className="font-mono text-xs text-ink-3">{(it as any).sub}</span>}
                  </>
                )}
                {suggest.kind === 'channel' && <><ChannelIcon conv={(it as any).conv} /><span className="font-mono">{it.label.slice(1)}</span></>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-md border border-line-strong bg-surface focus-within:border-ink-3">
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-b border-line p-2" aria-label="Files to upload">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md border border-line-strong bg-surface-2 py-1 pl-1 pr-2">
                {previews[i] ? <img src={previews[i]} alt="" className="size-8 rounded-sm object-cover" /> : <Paperclip className="mx-1.5 size-4 text-ink-2" aria-hidden />}
                <span className="max-w-40 truncate font-mono text-xs">{f.name}</span>
                <span className="font-mono text-[11px] text-ink-3">{fmtBytes(f.size)}</span>
                <button className="focus-inset rounded-sm p-0.5 text-ink-2 hover:bg-active hover:text-ink" aria-label={`Remove ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ta}
          id={id}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-autocomplete="list"
          onChange={(e) => update(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setTimeout(() => setSuggest(null), 100)}
          className="block max-h-[40vh] w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm leading-relaxed outline-none placeholder:text-ink-3"
        />
        <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1.5">
          <Tip label="Attach files"><Button variant="ghost" size="icon" aria-label="Attach files" onClick={() => fileInput.current?.click()}><Paperclip className="size-4" aria-hidden /></Button></Tip>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
          <EmojiPicker onPick={insertEmoji} trigger={<Button variant="ghost" size="icon" aria-label="Insert emoji"><Smile className="size-4" aria-hidden /></Button>} />
          {threadTs && conv && (
            <label className="ml-1 flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-ink-2">
              <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} className="size-3.5 accent-white" />
              Also send to <span className="font-mono">{conv.type === 'public' || conv.type === 'private' ? `#${conv.name}` : 'conversation'}</span>
            </label>
          )}
          {!threadTs && <span className="ml-auto mr-1 hidden font-mono text-[11px] text-ink-3 sm:inline">Enter send · Shift+Enter newline</span>}
          <Tip label="Send (Enter)">
            <Button variant="default" size="icon" className="ml-auto" aria-label="Send message" disabled={!text.trim() && !files.length} onClick={submit}><SendHorizontal className="size-4" aria-hidden /></Button>
          </Tip>
        </div>
      </div>
    </div>
  )
})
