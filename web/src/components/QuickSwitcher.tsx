import { Command } from 'cmdk'
import { useStore } from '@/lib/store'
import { Modal } from './ui/overlays'
import { Avatar } from './Avatar'
import { ChannelIcon, useConvLabel } from './ChannelIcon'
import { useState } from 'react'

export function QuickSwitcher() {
  const open = useStore((s) => s.switcher)
  const set = useStore((s) => s.set)
  const convs = useStore((s) => s.convs)
  const users = useStore((s) => s.users)
  const unread = useStore((s) => s.unread)
  const select = useStore((s) => s.selectChannel)
  const openDm = useStore((s) => s.openDm)
  const label = useConvLabel()
  const [q, setQ] = useState('')

  const close = () => { set({ switcher: false }); setQ('') }
  const dmUsers = new Set(convs.filter((c) => c.type === 'dm').map((c) => c.user))
  const people = q.trim()
    ? Object.values(users).filter((u) => !u.deleted && !u.isBot && !dmUsers.has(u.id) && `${u.display} ${u.name} ${u.real}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12)
    : []

  return (
    <Modal open={open} onOpenChange={(o) => (o ? set({ switcher: true }) : close())} title="Jump to conversation" description="Type to filter channels and people, Enter to open.">
      <Command label="Jump to conversation" loop>
        <Command.Input value={q} onValueChange={setQ} placeholder="Jump to a channel, DM or person…" className="h-12 w-full border-b border-line bg-transparent px-4 text-sm outline-none placeholder:text-ink-3" />
        <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
          <Command.Empty className="p-4 text-center text-sm text-ink-3">No matches</Command.Empty>
          <Command.Group heading="Conversations" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-ink-3">
            {[...convs].sort((a, b) => (unread[b.id]?.unread ?? 0) - (unread[a.id]?.unread ?? 0)).map((c) => {
              const u = unread[c.id]
              const place = c.type === 'public' || c.type === 'private'
              return (
                <Command.Item key={c.id} value={`${label(c)} ${c.name} ${c.id}`} onSelect={() => { close(); void select(c.id) }} className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] data-[selected=true]:bg-active">
                  <ChannelIcon conv={c} />
                  <span className={place ? 'font-mono' : ''}>{label(c)}</span>
                  {u && u.unread > 0 && <span className="ml-auto rounded-sm border border-ink-3 px-1 font-mono text-[10px]">{u.mentions ? `@${u.mentions}` : u.unread} unread</span>}
                </Command.Item>
              )
            })}
          </Command.Group>
          {people.length > 0 && (
            <Command.Group heading="People" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-ink-3">
              {people.map((u) => (
                <Command.Item key={u.id} value={`${u.display} ${u.name} ${u.real} ${u.id}`} onSelect={() => { close(); void openDm(u.id) }} className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] data-[selected=true]:bg-active">
                  <Avatar src={u.avatar} name={u.display} size={20} />
                  <span>{u.display}</span>
                  <span className="font-mono text-xs text-ink-3">{u.name}</span>
                  <span className="ml-auto text-xs text-ink-3">Start a direct message</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Modal>
  )
}
