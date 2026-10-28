import { memo, useEffect, useRef, useState } from 'react'
import { AlertCircle, Clock, Copy, EyeOff, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, SmilePlus, Trash2 } from '@/components/icons'
import { useStore, type Msg, type Pending } from '@/lib/store'
import { api } from '@/lib/api'
import { fromSlackText, toSlackText } from '@/lib/compose'
import { cn } from '@/lib/utils'
import { UserAvatar, TeamBadge, Avatar } from './Avatar'
import { Mrkdwn } from './Mrkdwn'
import { Attachments, blocksToText } from './Attachments'
import { Time } from './Time'
import { Emoji } from './Emoji'
import { EmojiPicker } from './EmojiPicker'
import { Button } from './ui/button'
import { Dropdown, MenuIconItem, MenuItem, MenuSep, Modal, Tip } from './ui/overlays'

const SYSTEM = /^(channel|group)_(join|leave|topic|purpose|name|archive|unarchive)$|^pinned_item$/

function useAuthor(m: Msg) {
  const u = useStore((s) => (m.user ? s.users[m.user] : undefined))
  return {
    user: u,
    name: u?.display ?? m.username ?? m.bot_profile?.name ?? m.user ?? 'Unknown user',
    avatar: u?.avatar || m.bot_profile?.icons?.image_72 || m.icons?.image_64 || m.icons?.image_72,
    isBot: !!(m.bot_id || u?.isBot),
  }
}

function ReactionChip({ r, channel, ts }: { r: NonNullable<Msg['reactions']>[number]; channel: string; ts: string }) {
  const me = useStore((s) => s.me?.userId)
  const users = useStore((s) => s.users)
  const toggle = useStore((s) => s.toggleReaction)
  const mine = !!me && r.users.includes(me)
  const names = r.users.slice(0, 8).map((u) => (u === me ? 'you' : users[u]?.display ?? u))
  const more = r.count - names.length
  const who = names.length ? `${names.slice(0, -1).join(', ')}${names.length > 1 ? ' and ' : ''}${names.at(-1)}${more > 0 ? ` and ${more} more` : ''}` : `${r.count} people`
  return (
    <Tip label={<span>{who} reacted with <span className="font-mono">:{r.name.split('::')[0]}:</span></span>}>
      <button
        onClick={() => void toggle(channel, ts, r.name)}
        aria-pressed={mine}
        aria-label={`${r.name.split('::')[0].replace(/_/g, ' ')}, ${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}${mine ? ', including yours' : ''}`}
        className={cn(
          'flex h-6 items-center gap-1 rounded-md border px-1.5 text-[13px] transition-colors',
          mine ? 'border-ink bg-active font-semibold text-ink' : 'border-line-strong text-ink-2 hover:bg-hover',
        )}
      >
        <Emoji name={r.name} />
        <span className="font-mono text-xs tabular-nums">{r.count}</span>
        {mine && <span aria-hidden className="text-[10px]">✓</span>}
      </button>
    </Tip>
  )
}

interface Props {
  m: Msg | Pending
  grouped: boolean
  channelId: string
  inThread?: boolean
  focused?: boolean
}

export const Message = memo(function Message({ m, grouped, channelId, inThread, focused }: Props) {
  const me = useStore((s) => s.me?.userId)
  const { user, name, avatar, isBot } = useAuthor(m)
  const edit = useStore((s) => s.edit)
  const remove = useStore((s) => s.remove)
  const toggleReaction = useStore((s) => s.toggleReaction)
  const togglePin = useStore((s) => s.togglePin)
  const markUnreadAt = useStore((s) => s.markUnreadAt)
  const openThread = useStore((s) => s.openThread)
  const toast = useStore((s) => s.toast)
  const retry = useStore((s) => s.retry)
  const discard = useStore((s) => s.discard)
  const editing = useStore((s) => s.editTs === m.ts)
  const touchOpen = useStore((s) => s.touchActive === m.ts)
  const setStore = useStore((s) => s.set)
  const [confirm, setConfirm] = useState(false)
  const pending = (m as Pending).clientId ? (m as Pending) : null
  const mine = !!me && m.user === me
  const raw = m.text || blocksToText(m.blocks)
  const mentionsMe = !!me && !mine && (raw.includes(`<@${me}>`) || /<!(channel|here|everyone)/.test(raw))
  const pinned = !!m.pinned_to?.length
  const ref = useRef<HTMLElement>(null)
  const threadTs = m.thread_ts ?? m.ts

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' })
  }, [focused])

  if (m.subtype && SYSTEM.test(m.subtype)) {
    return (
      <div data-msg data-ts={m.ts} tabIndex={0} className="flex items-center gap-3 px-4 py-1 text-[13px] text-ink-3 focus-inset">
        <span className="w-9 text-right font-mono text-[11px]"><Time ts={m.ts} mode="clock" /></span>
        <span><span className="font-medium text-ink-2">{name}</span> <Mrkdwn text={raw.replace(/^<@[UW][A-Z0-9]+>\s*/, '')} className="inline" /></span>
      </div>
    )
  }

  const copyLink = async () => {
    try {
      const { permalink } = await api.permalink(channelId, m.ts)
      await navigator.clipboard.writeText(permalink)
      toast('Link copied')
    } catch {
      toast('Could not copy the link', 'error')
    }
  }

  const QUICK = ['+1', 'heart', 'joy', 'white_check_mark', 'eyes']
  const toolbar = !pending && (
    <div data-touch-open={touchOpen} className="absolute -top-3 right-3 z-10 hidden items-center rounded-md border border-line-strong bg-background p-0.5 group-focus-within/msg:flex group-hover/msg:flex data-[touch-open=true]:flex [@media(hover:none)]:group-hover/msg:hidden [@media(hover:none)]:data-[touch-open=true]:flex [@media(hover:none)]:-top-2" role="toolbar" aria-label="Message actions">
      <EmojiPicker side="bottom" onPick={(n) => void toggleReaction(channelId, m.ts, n)} trigger={<Button variant="ghost" size="touch" aria-label="Add reaction"><SmilePlus className="size-4" aria-hidden /></Button>} />
      {!inThread && <Tip label="Reply in thread"><Button variant="ghost" size="touch" className="[@media(hover:none)]:hidden" aria-label="Reply in thread" onClick={() => void openThread(channelId, threadTs)}><MessageSquare className="size-4" aria-hidden /></Button></Tip>}
      {mine && <Tip label="Edit message"><Button variant="ghost" size="touch" className="[@media(hover:none)]:hidden" aria-label="Edit message" onClick={() => setStore({ editTs: m.ts })}><Pencil className="size-4" aria-hidden /></Button></Tip>}
      <Dropdown trigger={<Button variant="ghost" size="touch" aria-label="More actions"><MoreHorizontal className="size-4" aria-hidden /></Button>}>
        <div className="flex gap-0.5 px-0.5 pb-1" role="group" aria-label="Quick reactions">
          {QUICK.map((n) => <MenuIconItem key={n} label={n.replace(/_/g, ' ')} onSelect={() => void toggleReaction(channelId, m.ts, n)}><Emoji name={n} /></MenuIconItem>)}
        </div>
        <MenuSep />
        {!inThread && <MenuItem icon={<MessageSquare className="size-4" />} hint="T" onSelect={() => void openThread(channelId, threadTs)}>Reply in thread</MenuItem>}
        {mine && <MenuItem icon={<Pencil className="size-4" />} hint="E" onSelect={() => setStore({ editTs: m.ts })}>Edit message</MenuItem>}
        <MenuItem icon={<Copy className="size-4" />} onSelect={() => void copyLink()}>Copy link</MenuItem>
        <MenuItem icon={<Copy className="size-4" />} onSelect={() => void navigator.clipboard?.writeText(fromSlackText(raw)).then(() => toast('Text copied'))}>Copy text</MenuItem>
        <MenuItem icon={<EyeOff className="size-4" />} onSelect={() => void markUnreadAt(channelId, m.ts)}>Mark unread from here</MenuItem>
        <MenuItem icon={pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} onSelect={() => void togglePin(channelId, m.ts)}>{pinned ? 'Unpin from channel' : 'Pin to channel'}</MenuItem>
        {mine && <MenuSep />}
        {mine && <MenuItem danger icon={<Trash2 className="size-4" />} onSelect={() => setConfirm(true)}>Delete message…</MenuItem>}
      </Dropdown>
    </div>
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || pending) return
    if (e.key === 'e' && mine) { e.preventDefault(); setStore({ editTs: m.ts }) }
    else if ((e.key === 't' || e.key === 'r') && !inThread) { e.preventDefault(); void openThread(channelId, threadTs) }
  }

  return (
    <article
      ref={ref}
      data-msg
      data-ts={m.ts}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // phones have no hover: a tap on the message body toggles its action bar
        if (!window.matchMedia('(hover: none)').matches || (e.target as HTMLElement).closest('a,button,input,textarea,[role=menuitem]')) return
        setStore({ touchActive: touchOpen ? null : m.ts })
      }}
      aria-label={`${mine ? 'Your message' : `Message from ${name}`}${pending ? (pending.state === 'failed' ? ', failed to send' : ', sending') : ''}`}
      aria-current={focused ? 'location' : undefined}
      className={cn(
        'group/msg focus-inset relative flex gap-3 border-l-2 px-4 py-[3px] hover:bg-hover focus-within:bg-hover',
        grouped ? 'pt-0' : 'mt-2.5 pt-1',
        mine ? 'border-l-ink-3' : 'border-l-transparent',
        pending?.state === 'failed' && 'border-l-danger-fill bg-danger-fill/[0.07]',
        pending?.state === 'sending' && 'opacity-60',
        focused && 'flash',
      )}
    >
      <div className="w-9 shrink-0">
        {grouped ? (
          <span className="block pt-1 text-right opacity-0 group-focus-within/msg:opacity-100 group-hover/msg:opacity-100">{!pending && <Time ts={m.ts} mode="clock" />}</span>
        ) : avatar && !user ? (
          <Avatar src={avatar} name={name} size={36} />
        ) : (
          <UserAvatar id={m.user} size={36} fallbackName={name} fallbackSrc={avatar} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-2 leading-5">
            <span className="font-semibold">{name}</span>
            {mine && <span className="rounded-sm border border-line-strong px-1 font-mono text-[10px] uppercase leading-4 text-ink-2">you</span>}
            {isBot && <span className="rounded-sm border border-line-strong px-1 font-mono text-[10px] uppercase leading-4 text-ink-2">app</span>}
            {user?.teamId && user.teamId !== useStore.getState().me?.team.id && <TeamBadge teamId={user.teamId} />}
            {pending ? <span className="font-mono text-[11px] text-ink-3">{pending.state === 'sending' ? 'sending…' : 'not sent'}</span> : <Time ts={m.ts} />}
            {m.edited && <Tip label={<span className="font-mono">Edited</span>}><span className="font-mono text-[11px] text-ink-3">(edited)</span></Tip>}
            {pinned && <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-2"><Pin className="size-3" aria-hidden />pinned</span>}
            {mentionsMe && <span className="sr-only">mentions you</span>}
          </div>
        )}
        {grouped && (m.edited || pinned) && (
          <span className="font-mono text-[11px] text-ink-3">{m.edited && '(edited) '}{pinned && 'pinned'}</span>
        )}

        {editing ? (
          <Editor initial={fromSlackText(m.text ?? '')} onCancel={() => setStore({ editTs: null })} onSave={(t) => { setStore({ editTs: null }); if (t !== (m.text ?? '')) void edit(channelId, m.ts, t) }} />
        ) : (
          raw && <Mrkdwn text={raw} />
        )}
        {!editing && <Attachments m={m} />}

        {!!m.reactions?.length && (
          <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label="Reactions">
            {m.reactions.map((r) => <ReactionChip key={r.name} r={r} channel={channelId} ts={m.ts} />)}
            <EmojiPicker side="bottom" align="start" onPick={(n) => void toggleReaction(channelId, m.ts, n)} trigger={<Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Add reaction"><SmilePlus className="size-3.5" aria-hidden /></Button>} />
          </div>
        )}

        {!inThread && !!m.reply_count && (
          <button onClick={() => void openThread(channelId, m.thread_ts ?? m.ts)} className="focus-inset mt-1 flex items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-[13px] text-link hover:border-line-strong hover:bg-hover">
            <span className="flex -space-x-1">{(m.reply_users ?? []).slice(0, 3).map((u) => <UserAvatar key={u} id={u} size={18} />)}</span>
            <span className="font-medium">{m.reply_count} {m.reply_count === 1 ? 'reply' : 'replies'}</span>
            {m.latest_reply && <Time ts={m.latest_reply} />}
          </button>
        )}

        {pending?.state === 'failed' && (
          <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-danger">
            <AlertCircle className="size-4" aria-hidden />
            <span>Failed to send{pending.error ? `: ${pending.error}` : ''}</span>
            <Button size="sm" variant="outlineDanger" onClick={() => retry(channelId, pending.clientId, pending.thread_ts)}>Retry</Button>
            <Button size="sm" variant="ghost" onClick={() => discard(channelId, pending.clientId, pending.thread_ts)}>Discard</Button>
          </div>
        )}
        {pending?.state === 'sending' && <span className="sr-only"><Clock /> Sending</span>}
      </div>
      {toolbar}

      <Modal open={confirm} onOpenChange={setConfirm} title="Delete message" description="This permanently deletes the message for everyone.">
        <div className="p-5">
          <h2 className="text-base font-semibold">Delete this message?</h2>
          <p className="mt-1 text-sm text-ink-2">It will be removed for everyone in the conversation. This can’t be undone.</p>
          <div className="mt-3 max-h-32 overflow-y-auto rounded-md border border-line-strong p-2 text-[13px] text-ink-2"><Mrkdwn text={raw} /></div>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setConfirm(false); void remove(channelId, m.ts) }}>Delete</Button>
          </div>
        </div>
      </Modal>
    </article>
  )
})

function Editor({ initial, onSave, onCancel }: { initial: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px' }
  }, [v])
  const save = () => { const t = toSlackText(v, []); if (t) onSave(t) }
  return (
    <div className="my-1 rounded-md border border-ink-3 bg-surface">
      <textarea
        ref={ref}
        value={v}
        aria-label="Edit message"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
          else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save() }
        }}
        className="block w-full resize-none bg-transparent px-3 py-2 text-sm outline-none"
      />
      <div className="flex items-center justify-end gap-2 border-t border-line p-1.5">
        <span className="mr-auto pl-1.5 font-mono text-[11px] text-ink-3">Esc cancel · Enter save</span>
        <Button size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="default" onClick={save}>Save</Button>
      </div>
    </div>
  )
}
