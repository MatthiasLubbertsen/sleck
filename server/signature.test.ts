import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifySlackSignature } from './signature'

const secret = 'shh'
const sign = (ts: string, body: string) => 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')

describe('verifySlackSignature', () => {
  const now = 1_700_000_000_000
  const ts = String(now / 1000)
  const body = '{"type":"event_callback"}'
  it('accepts a valid signature', () => expect(verifySlackSignature(secret, ts, sign(ts, body), body, now)).toBe(true))
  it('rejects a tampered body', () => expect(verifySlackSignature(secret, ts, sign(ts, body), body + ' ', now)).toBe(false))
  it('rejects the wrong secret', () => expect(verifySlackSignature('other', ts, sign(ts, body), body, now)).toBe(false))
  it('rejects replays older than 5 minutes', () => {
    const old = String(now / 1000 - 301)
    expect(verifySlackSignature(secret, old, sign(old, body), body, now)).toBe(false)
  })
  it('rejects missing headers and garbage', () => {
    expect(verifySlackSignature(secret, undefined, sign(ts, body), body, now)).toBe(false)
    expect(verifySlackSignature(secret, ts, undefined, body, now)).toBe(false)
    expect(verifySlackSignature(secret, 'abc', 'v0=00', body, now)).toBe(false)
    expect(verifySlackSignature(secret, ts, 'v0=short', body, now)).toBe(false)
  })
})
