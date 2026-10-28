import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from './geist'

// Geist Button: primary / secondary / tertiary / error, sizes tiny (24) small (32) medium (40) large (48),
// icon-only squares, a `loading` state that keeps the button focusable.
const button = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[14px] font-medium leading-none transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        default: 'bg-ink text-black hover:bg-[#cfcfcf] active:bg-[#b8b8b8]', // Geist "primary"
        secondary: 'border border-line-strong bg-background text-ink hover:bg-hover active:bg-active',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink active:bg-active', // Geist "tertiary"
        destructive: 'bg-danger-fill text-white hover:bg-[#cf3a3f]', // Geist "error"
        outlineDanger: 'border border-danger-fill/70 text-danger hover:bg-danger-fill/10',
      },
      size: {
        tiny: 'h-6 px-2 text-[12px]',
        sm: 'h-8 px-3',
        md: 'h-8 px-3',
        lg: 'h-10 px-4',
        icon: 'h-7 w-7',
        iconLg: 'h-8 w-8',
        /** comfortable touch target on phones, regular on desktop */
        touch: 'h-10 w-10 md:h-8 md:w-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', loading, children, disabled, ...p }, ref) => (
  <button ref={ref} type={type} aria-busy={loading || undefined} disabled={disabled} className={cn(button({ variant, size }), className)} {...p}>
    {loading ? <Spinner /> : null}
    {children}
  </button>
))
Button.displayName = 'Button'

export const Kbd = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-[var(--ds-gray-alpha-100)] px-1 font-mono text-[11px] text-ink-2', className)}>{children}</kbd>
)
