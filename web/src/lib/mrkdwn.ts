// Slack "mrkdwn" -> small AST. Pure and DOM-free so it can be unit tested.
// Slack escapes literal & < > as entities, so a raw `<` in the text always opens a token
// (link, mention, ...) and a quote marker is `&gt;`.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold' | 'italic' | 'strike'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'user'; id: string; label?: string }
  | { t: 'channel'; id: string; label?: string }
  | { t: 'special'; v: string }
  | { t: 'group'; id: string; label?: string }
  | { t: 'date'; ts: number; fmt: string; fallback: string }

export type Block =
  | { t: 'p'; lines: Inline[][] }
  | { t: 'pre'; v: string }
  | { t: 'quote'; lines: Inline[][] }
  | { t: 'list'; items: { indent: number; mark: string; c: Inline[] }[] }

export const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const alnum = /[\p{L}\p{N}]/u
const ws = /\s/
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:)/i

function parseAngle(tok: string): Inline | null {
  const [head, ...rest] = tok.split('|')
  const label = rest.length ? rest.join('|') : undefined
  if (head.startsWith('@')) return { t: 'user', id: head.slice(1), label }
  if (head.startsWith('#')) return { t: 'channel', id: head.slice(1), label }
  if (head.startsWith('!')) {
    const name = head.slice(1)
    if (name.startsWith('subteam^')) return { t: 'group', id: name.slice(8), label }
    if (name.startsWith('date^')) {
      const [, ts, fmt] = name.split('^')
      return { t: 'date', ts: Number(ts), fmt: fmt ?? '', fallback: label ?? '' }
    }
    if (['here', 'channel', 'everyone'].includes(name)) return { t: 'special', v: name }
    return { t: 'text', v: label ?? `@${name}` }
  }
  if (SAFE_HREF.test(head)) {
    const href = decode(head)
    return { t: 'link', href, c: [{ t: 'text', v: label ? decode(label) : href.replace(/^mailto:/i, '') }] }
  }
  return null
}

export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', v: decode(buf) })
    buf = ''
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '`') {
      const j = s.indexOf('`', i + 1)
      if (j > i + 1) {
        flush()
        out.push({ t: 'code', v: decode(s.slice(i + 1, j)) })
        i = j + 1
        continue
      }
    } else if (ch === '<') {
      const j = s.indexOf('>', i)
      if (j > i) {
        const node = parseAngle(s.slice(i + 1, j))
        if (node) {
          flush()
          out.push(node)
          i = j + 1
          continue
        }
      }
    } else if ((ch === '*' || ch === '_' || ch === '~') && depth < 4) {
      const prev = i > 0 ? s[i - 1] : ''
      const next = s[i + 1] ?? ''
      if (next && !ws.test(next) && next !== ch && !(prev && alnum.test(prev))) {
        let k = i + 2
        let found = -1
        for (; k < s.length; k++) {
          if (s[k] === '`') { // don't close inside inline code
            const e = s.indexOf('`', k + 1)
            if (e > 0) k = e
            continue
          }
          if (s[k] === ch && !ws.test(s[k - 1]) && !(s[k + 1] && alnum.test(s[k + 1]))) {
            found = k
            break
          }
        }
        if (found > 0) {
          flush()
          out.push({ t: ch === '*' ? 'bold' : ch === '_' ? 'italic' : 'strike', c: parseInline(s.slice(i + 1, found), depth + 1) })
          i = found + 1
          continue
        }
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}

const LIST = /^(\s*)([•◦▪▫‣]|[-*]|\d+\.)\s+(.*)$/

export function parseMrkdwn(text: string): Block[] {
  const blocks: Block[] = []
  const parts = text.split(/```/)
  parts.forEach((part, idx) => {
    // odd segments sit inside fences, unless the last fence was never closed
    const unterminated = idx % 2 === 1 && idx === parts.length - 1
    if (idx % 2 === 1 && !unterminated) {
      blocks.push({ t: 'pre', v: decode(part.replace(/^\n/, '').replace(/\n$/, '')) })
      return
    }
    const segment = unterminated ? '```' + part : part
    const lines = segment.split('\n')
    let para: Inline[][] = []
    const endPara = () => {
      if (para.length) blocks.push({ t: 'p', lines: para })
      para = []
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('&gt;&gt;&gt;')) {
        endPara()
        const rest = [line.slice(12), ...lines.slice(i + 1)]
        blocks.push({ t: 'quote', lines: rest.map((l) => parseInline(l)) })
        break
      }
      if (line.startsWith('&gt;')) {
        endPara()
        const q: Inline[][] = []
        while (i < lines.length && lines[i].startsWith('&gt;')) q.push(parseInline(lines[i++].replace(/^&gt;\s?/, '')))
        i--
        blocks.push({ t: 'quote', lines: q })
        continue
      }
      const m = LIST.exec(line)
      if (m) {
        endPara()
        const items: { indent: number; mark: string; c: Inline[] }[] = []
        while (i < lines.length) {
          const mm = LIST.exec(lines[i])
          if (!mm) break
          items.push({ indent: Math.floor(mm[1].length / 2), mark: /\d/.test(mm[2]) ? mm[2] : mm[2] === '•' || mm[2] === '-' || mm[2] === '*' ? '•' : '◦', c: parseInline(mm[3]) })
          i++
        }
        i--
        blocks.push({ t: 'list', items })
        continue
      }
      if (line.trim() === '') {
        endPara()
        continue
      }
      para.push(parseInline(line))
    }
    endPara()
  })
  return blocks
}

/** Slack search wraps matches in private-use markers. */
export const HL_OPEN = ''
export const HL_CLOSE = ''
