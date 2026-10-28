import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from './config'

/** AES-256-GCM. `aad` binds the ciphertext to its row so it can't be swapped between sessions. */
export function encrypt(plain: string, aad: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', config.encryptionKey, iv)
  c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.')
}

export function decrypt(blob: string, aad: string): string {
  const [v, iv, tag, ct] = blob.split('.')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad ciphertext')
  const d = createDecipheriv('aes-256-gcm', config.encryptionKey, Buffer.from(iv, 'base64url'))
  d.setAAD(Buffer.from(aad))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

export const randomId = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}
