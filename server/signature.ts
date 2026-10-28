import { createHmac, timingSafeEqual } from 'node:crypto'

/** Slack request signing: v0=HMAC_SHA256(secret, "v0:{timestamp}:{raw body}"), 5 minute replay window. */
export function verifySlackSignature(secret: string, timestamp: string | undefined, signature: string | undefined, raw: string, nowMs = Date.now()): boolean {
  if (!timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false
  const expected = Buffer.from('v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex'))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
