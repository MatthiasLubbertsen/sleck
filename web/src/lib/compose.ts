export interface Token { label: string; raw: string }

// Angle-bracket markup that is already valid Slack syntax and must survive escaping.
const MARKUP = /<(?:[@#!][^<>\s|]+(?:\|[^<>]*)?|(?:https?:\/\/|mailto:)[^<>\s|]+(?:\|[^<>]*)?)>/g

/**
 * Turn composer text into Slack mrkdwn: `@Name` / `#chan` tokens the user picked become real
 * mentions, and the characters Slack treats as control (& and <) are escaped.
 * `>` stays raw so a leading `>` still produces a blockquote.
 */
export function toSlackText(text: string, tokens: Token[]): string {
  const stash: string[] = []
  const hold = (s: string) => `${stash.push(s) - 1}`
  let t = text
  for (const tok of [...tokens].sort((a, b) => b.label.length - a.label.length)) {
    t = t.split(tok.label).join(hold(tok.raw))
  }
  t = t.replace(MARKUP, (m) => hold(m))
  t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return t.replace(/(\d+)/g, (_, i) => stash[Number(i)]).trim()
}

/** Slack text -> what to show in an edit box. */
export const fromSlackText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
