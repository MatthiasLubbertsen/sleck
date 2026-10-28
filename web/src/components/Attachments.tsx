import { useState } from 'react'
import { Download, File as FileIcon, FileText, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { fmtBytes } from '@/lib/time'
import { Mrkdwn } from './Mrkdwn'
import { Modal } from './ui/overlays'
import { cn } from '@/lib/utils'

/** Only Slack-hosted file URLs need our authenticated proxy; others are public. */
const imgSrc = (url: string) => {
  try {
    const u = new URL(url, location.href)
    return u.hostname === 'files.slack.com' || u.hostname.endsWith('.slack-files.com') || u.protocol === 'http:' ? api.fileUrl(u.toString()) : u.toString()
  } catch {
    return ''
  }
}

function SlackFile({ f }: { f: any }) {
  const [open, setOpen] = useState(false)
  if (f.pendingFile) {
    return (
      <div className="flex w-fit items-center gap-2 rounded-md border border-line-strong px-3 py-2 text-ink-2" role="status">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
        <span className="font-mono text-xs">Uploading {f.name}…</span>
      </div>
    )
  }
  const name = f.title || f.name || 'file'
  const priv = f.url_private as string | undefined
  const isImage = typeof f.mimetype === 'string' && f.mimetype.startsWith('image/') && f.filetype !== 'svg'
  if (isImage && priv) {
    const thumb = f.thumb_720 || f.thumb_480 || f.thumb_360 || priv
    return (
      <>
        <button onClick={() => setOpen(true)} className="focus-inset block w-fit overflow-hidden rounded-md border border-line-strong" aria-label={`Open image ${name}`}>
          <img src={imgSrc(thumb)} alt={f.alt_txt || name} loading="lazy" className="max-h-80 max-w-[min(100%,420px)] object-contain" width={f.thumb_720_w} height={f.thumb_720_h} />
        </button>
        <Modal open={open} onOpenChange={setOpen} title={name} className="top-[4vh] w-[min(96vw,1100px)] border-0 bg-transparent">
          <div className="flex flex-col items-center gap-2">
            <img src={imgSrc(f.thumb_1024 || priv)} alt={name} className="max-h-[84vh] max-w-full rounded-md border border-line-strong bg-black object-contain" />
            <a className="font-mono text-xs text-link underline" href={api.fileUrl(priv, { download: true, name })}>Download {name}</a>
          </div>
        </Modal>
      </>
    )
  }
  if (typeof f.mimetype === 'string' && f.mimetype.startsWith('video/') && (f.mp4 || priv)) {
    return <video controls preload="metadata" className="max-h-80 max-w-[min(100%,480px)] rounded-md border border-line-strong" src={api.fileUrl(f.mp4 || priv)} aria-label={name} />
  }
  const Icon = /text|pdf|doc/.test(f.mimetype ?? '') ? FileText : FileIcon
  return (
    <div className="flex w-fit max-w-full items-center gap-3 rounded-md border border-line-strong px-3 py-2">
      <Icon className="size-5 shrink-0 text-ink-2" aria-hidden />
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px]">{name}</div>
        <div className="font-mono text-[11px] text-ink-3">{[f.filetype?.toUpperCase(), fmtBytes(f.size)].filter(Boolean).join(' · ')}</div>
      </div>
      {priv && (
        <a className="focus-inset rounded-md p-1.5 text-ink-2 hover:bg-hover hover:text-ink" href={api.fileUrl(priv, { download: true, name })} aria-label={`Download ${name}`}>
          <Download className="size-4" aria-hidden />
        </a>
      )}
    </div>
  )
}

function LegacyAttachment({ a }: { a: any }) {
  const color = typeof a.color === 'string' && /^[0-9a-f]{6}$/i.test(a.color) ? `#${a.color}` : 'var(--line-strong)'
  const text: string | undefined = a.text || a.fallback
  const img = a.image_url || a.thumb_url
  return (
    <div className="max-w-[560px] border-l-[3px] py-1 pl-3" style={{ borderColor: color }}>
      {a.pretext && <Mrkdwn text={a.pretext} className="mb-1" />}
      {(a.author_name || a.service_name) && <div className="text-xs text-ink-2">{a.author_name || a.service_name}</div>}
      {a.title && (a.title_link ? <a className="font-semibold text-link underline underline-offset-2" href={a.title_link} target="_blank" rel="noopener noreferrer nofollow">{a.title}</a> : <div className="font-semibold">{a.title}</div>)}
      {text && <Mrkdwn text={text} className="text-ink-2" />}
      {Array.isArray(a.fields) && a.fields.length > 0 && (
        <dl className="mt-1 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-4 gap-y-1">
          {a.fields.map((fl: any, i: number) => (
            <div key={i} className={cn(!fl.short && 'col-span-full')}>
              <dt className="text-xs font-semibold text-ink-2">{fl.title}</dt>
              <dd><Mrkdwn text={String(fl.value ?? '')} /></dd>
            </div>
          ))}
        </dl>
      )}
      {img && <img src={imgSrc(img)} alt="" referrerPolicy="no-referrer" loading="lazy" className="mt-2 max-h-72 max-w-full rounded-md border border-line-strong object-contain" />}
      {(a.footer || a.ts) && <div className="mt-1 font-mono text-[11px] text-ink-3">{a.footer}</div>}
    </div>
  )
}

export function Attachments({ m }: { m: any }) {
  const files: any[] = m.files ?? []
  const atts: any[] = m.attachments ?? []
  if (!files.length && !atts.length) return null
  return (
    <div className="mt-1 flex flex-col gap-2">
      {files.map((f, i) => <SlackFile key={f.id ?? i} f={f} />)}
      {atts.map((a, i) => <LegacyAttachment key={a.id ?? i} a={a} />)}
    </div>
  )
}

/** Block Kit / rich_text -> mrkdwn, used only when a message has no `text`. */
export function blocksToText(blocks?: any[]): string {
  if (!blocks) return ''
  const rich = (el: any): string => {
    switch (el.type) {
      case 'text': {
        let t: string = (el.text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        if (el.style?.code) t = `\`${t}\``
        if (el.style?.bold) t = `*${t}*`
        if (el.style?.italic) t = `_${t}_`
        if (el.style?.strike) t = `~${t}~`
        return t
      }
      case 'link': return `<${el.url}${el.text ? '|' + el.text : ''}>`
      case 'user': return `<@${el.user_id}>`
      case 'channel': return `<#${el.channel_id}>`
      case 'emoji': return `:${el.name}:`
      case 'broadcast': return `<!${el.range}>`
      case 'rich_text_section': case 'rich_text_quote': return (el.elements ?? []).map(rich).join('')
      case 'rich_text_preformatted': return '```' + (el.elements ?? []).map(rich).join('') + '```'
      case 'rich_text_list': return (el.elements ?? []).map((e: any) => `• ${rich(e)}`).join('\n')
      default: return ''
    }
  }
  return blocks
    .map((b) => {
      if (b.type === 'rich_text') return (b.elements ?? []).map(rich).join('\n')
      if (b.type === 'header') return `*${b.text?.text ?? ''}*`
      if (b.type === 'section') return [b.text?.text, ...(b.fields ?? []).map((f: any) => f.text)].filter(Boolean).join('\n')
      if (b.type === 'context') return (b.elements ?? []).map((e: any) => e.text ?? '').join(' ')
      return ''
    })
    .filter(Boolean)
    .join('\n')
}
