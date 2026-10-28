import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors duration-100 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-ink text-black hover:bg-[#d4d4d4]',
        secondary: 'border border-line-strong bg-background text-ink hover:bg-hover',
        ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
        destructive: 'bg-danger-fill text-white hover:bg-[#cf3a3f]',
        outlineDanger: 'border border-danger-fill text-danger hover:bg-danger-fill/10',
      },
      size: { sm: 'h-7 px-2.5', md: 'h-8 px-3', lg: 'h-10 px-4 text-sm', icon: 'h-7 w-7', iconLg: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = 'button', ...p }, ref) => (
  <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...p} />
))
Button.displayName = 'Button'

export const Kbd = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-line-strong bg-surface-2 px-1 font-mono text-[11px] text-ink-2', className)}>{children}</kbd>
)
