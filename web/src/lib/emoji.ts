// Unicode emoji via emojibase-data (Slack-compatible iamcal shortcodes), loaded lazily because
// the dataset is large. Custom workspace emoji come from the server and are passed in.

export interface EmojiItem {
  name: string
  char: string
  group: number
  keywords: string
  skins?: string[]
}

export const GROUPS = ['Smileys & emotion', 'People & body', 'Animals & nature', 'Food & drink', 'Travel & places', 'Activities', 'Objects', 'Symbols', 'Flags']

// emojibase group ids: 0 smileys, 1 people, 2 components (skipped), 3 animals, 4 food, 5 travel, 6 activities, 7 objects, 8 symbols, 9 flags
const groupIndex = (g: number | undefined) => (g === undefined || g === 2 ? -1 : g > 2 ? g - 1 : g)

let items: EmojiItem[] = []
const byName = new Map<string, EmojiItem>()
let loading: Promise<void> | null = null

export function loadEmoji(): Promise<void> {
  loading ??= (async () => {
    const [data, codes] = await Promise.all([
      import('emojibase-data/en/data.json').then((m: any) => m.default as any[]),
      import('emojibase-data/en/shortcodes/iamcal.json').then((m: any) => m.default as Record<string, string | string[]>),
    ])
    for (const e of data) {
      const raw = codes[e.hexcode]
      const names = Array.isArray(raw) ? raw : raw ? [raw] : []
      const g = groupIndex(e.group)
      if (!names.length || g < 0) {
        for (const n of names) byName.set(n, { name: n, char: e.emoji, group: g, keywords: '' })
        continue
      }
      const item: EmojiItem = {
        name: names[0],
        char: e.emoji,
        group: g,
        keywords: [e.label, ...(e.tags ?? [])].join(' ').toLowerCase(),
        skins: e.skins ? [...e.skins].sort((a, b) => a.tone - b.tone).map((s: any) => s.emoji) : undefined,
      }
      items.push(item)
      for (const n of names) byName.set(n, item)
    }
    items = items.filter((i) => i.group >= 0)
  })()
  return loading
}

export const allEmoji = () => items

export type ResolvedEmoji = { kind: 'char'; char: string } | { kind: 'img'; url: string }

/** `name` may carry a skin tone suffix as Slack writes it: `+1::skin-tone-3`. */
export function resolveEmoji(raw: string, custom: Record<string, string>): ResolvedEmoji | null {
  const [name, tone] = raw.split('::skin-tone-')
  if (custom[name]) return { kind: 'img', url: custom[name] }
  const e = byName.get(name)
  if (!e) return null
  if (tone && e.skins) {
    const s = e.skins[Number(tone) - 2]
    if (s) return { kind: 'char', char: s }
  }
  return { kind: 'char', char: e.char }
}

export interface EmojiHit { name: string; char?: string; url?: string }

export function searchEmoji(q: string, custom: Record<string, string>, limit = 8): EmojiHit[] {
  const needle = q.toLowerCase().replace(/^:/, '')
  if (!needle) return []
  const starts: EmojiHit[] = []
  const contains: EmojiHit[] = []
  for (const [name, url] of Object.entries(custom)) {
    if (name.startsWith(needle)) starts.push({ name, url })
    else if (name.includes(needle)) contains.push({ name, url })
  }
  for (const [name, e] of byName) {
    if (e.name !== name && !name.startsWith(needle)) continue // aliases only match by prefix
    if (name.startsWith(needle)) starts.push({ name, char: e.char })
    else if (name.includes(needle) || e.keywords.includes(needle)) contains.push({ name: e.name, char: e.char })
  }
  const seen = new Set<string>()
  return [...starts.sort((a, b) => a.name.length - b.name.length), ...contains]
    .filter((h) => (seen.has(h.name) ? false : (seen.add(h.name), true)))
    .slice(0, limit)
}

export const SHORTCODE = /:([a-z0-9_+\-']+(?:::skin-tone-[2-6])?):/gi
