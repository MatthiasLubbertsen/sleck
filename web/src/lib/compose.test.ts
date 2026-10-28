import { describe, expect, it } from 'vitest'
import { fromSlackText, toSlackText } from './compose'

describe('toSlackText', () => {
  it('converts picked mentions and escapes control characters', () => {
    expect(toSlackText('hi @Alice Wonder, 1 < 2 & 3 > 2', [{ label: '@Alice Wonder', raw: '<@U2>' }])).toBe('hi <@U2>, 1 &lt; 2 &amp; 3 > 2')
  })
  it('keeps pasted valid markup', () => {
    expect(toSlackText('<https://a.b|x> <#C1> <!here>', [])).toBe('<https://a.b|x> <#C1> <!here>')
  })
  it('round-trips edit text', () => {
    expect(toSlackText(fromSlackText('a &lt;b&gt; &amp; <@U1>'), [])).toBe('a &lt;b> &amp; <@U1>')
  })
})
