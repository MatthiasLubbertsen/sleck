import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Menu from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>{children}</Tooltip.Provider>
)

/** Hover AND keyboard-focus tooltip. */
export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} className="pop z-[100] max-w-xs rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-xs text-ink shadow-none">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export const Modal = ({ open, onOpenChange, title, description, children, className }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; className?: string }) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
      <Dialog.Content
        className={cn('pop fixed left-1/2 top-[12vh] z-50 w-[min(92vw,560px)] -translate-x-1/2 rounded-md border border-line-strong bg-surface text-ink', className)}
      >
        <Dialog.Title className="sr-only">{title}</Dialog.Title>
        <Dialog.Description className="sr-only">{description ?? title}</Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
)

export const Pop = ({ trigger, children, open, onOpenChange, side = 'top', align = 'end', className }: { trigger: ReactNode; children: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end'; className?: string }) => (
  <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={cn('pop z-[60] rounded-md border border-line-strong bg-surface text-ink outline-none', className)}>
        {children}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
)

export const Dropdown = ({ trigger, children, align = 'end', side = 'bottom' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'bottom' | 'left' | 'right' }) => (
  <Menu.Root>
    <Menu.Trigger asChild>{trigger}</Menu.Trigger>
    <Menu.Portal>
      <Menu.Content side={side} align={align} sideOffset={4} collisionPadding={8} className="pop z-[70] min-w-48 rounded-md border border-line-strong bg-surface p-1 text-[13px] text-ink">
        {children}
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>
)

export const MenuItem = ({ children, onSelect, danger, icon, hint }: { children: ReactNode; onSelect: () => void; danger?: boolean; icon?: ReactNode; hint?: string }) => (
  <Menu.Item
    onSelect={onSelect}
    className={cn('flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-active', danger && 'text-danger')}
  >
    <span className="flex w-4 justify-center" aria-hidden>{icon}</span>
    <span className="flex-1">{children}</span>
    {hint && <span className="font-mono text-[11px] text-ink-3">{hint}</span>}
  </Menu.Item>
)
export const MenuSep = () => <Menu.Separator className="my-1 h-px bg-line" />
