import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...v: ClassValue[]) => twMerge(clsx(v))
export const cmpTs = (a: string, b: string) => Number(a) - Number(b)
export const uid = () => crypto.randomUUID()
