import { describe, expect, it } from 'vitest'
import { parseInline, parseMrkdwn } from './mrkdwn'

describe('parseInline', () => {
  it('parses bold, italic, strike and code', () => {
    expect(parseInline('*b* _i_ ~s~ `c`')).toEqual([
      { t: 'bold', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' ' },
      { t: 'italic', c: [{ t: 'text', v: 'i' }] }, { t: 'text', v: ' ' },
      { t: 'strike', c: [{ t: 'text', v: 's' }] }, { t: 'text', v: ' ' },
      { t: 'code', v: 'c' },
    ])
  })
  it('does not format inside words or code', () => {
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }])
    expect(parseInline('`*not bold*`')).toEqual([{ t: 'code', v: '*not bold*' }])
    expect(parseInline('2 * 3 * 4')).toEqual([{ t: 'text', v: '2 * 3 * 4' }])
  })
  it('nests', () => {
    const [n] = parseInline('*bold _both_*')
    expect(n).toMatchObject({ t: 'bold' })
    expect((n as any).c[1]).toMatchObject({ t: 'italic' })
  })
  it('parses mentions, channels, links and specials', () => {
    expect(parseInline('<@U1> <#C1|gen> <!here> <https://a.b|a link> <mailto:x@y.z>')).toMatchObject([
      { t: 'user', id: 'U1' }, { t: 'text' }, { t: 'channel', id: 'C1', label: 'gen' }, { t: 'text' },
      { t: 'special', v: 'here' }, { t: 'text' }, { t: 'link', href: 'https://a.b' }, { t: 'text' }, { t: 'link', href: 'mailto:x@y.z' },
    ])
  })
  it('refuses unsafe link schemes', () => {
    expect(parseInline('<javascript:alert(1)|x>').some((n) => n.t === 'link')).toBe(false)
  })
  it('decodes entities', () => {
    expect(parseInline('a &lt;b&gt; &amp; c')).toEqual([{ t: 'text', v: 'a <b> & c' }])
  })
})

describe('parseMrkdwn', () => {
  it('handles code blocks, quotes and lists', () => {
    const b = parseMrkdwn('hi\n```\nlet x = 1 &lt; 2\n```\n&gt; q1\n&gt; q2\n• one\n• two')
    expect(b.map((x) => x.t)).toEqual(['p', 'pre', 'quote', 'list'])
    expect(b[1]).toEqual({ t: 'pre', v: 'let x = 1 < 2' })
    expect((b[3] as any).items).toHaveLength(2)
  })
  it('treats an unterminated fence as text', () => {
    expect(parseMrkdwn('``` oops').map((x) => x.t)).toEqual(['p'])
  })
})
