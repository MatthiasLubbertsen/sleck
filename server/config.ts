import { mkdirSync } from 'node:fs'

function need(name: string): string {
  const v = process.env[name]?.trim()
  if (!v) {
    console.error(`Missing required env var ${name}. See .env.example.`)
    process.exit(1)
  }
  return v
}

function parseKey(raw: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    console.error('ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64). Generate: openssl rand -hex 32')
    process.exit(1)
  }
  return key
}

const appUrl = need('APP_URL').replace(/\/+$/, '')
const sessionSecret = need('SESSION_SECRET')
if (sessionSecret.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.')
  process.exit(1)
}

export const config = {
  clientId: need('SLACK_CLIENT_ID'),
  clientSecret: need('SLACK_CLIENT_SECRET'),
  signingSecret: need('SLACK_SIGNING_SECRET'),
  appUrl,
  origin: new URL(appUrl).origin,
  secure: appUrl.startsWith('https://'),
  sessionSecret,
  encryptionKey: parseKey(need('ENCRYPTION_KEY')),
  port: Number(process.env.PORT ?? 3000),
  dataDir: process.env.DATA_DIR ?? './data',
  /** auto: poll until a verified Events API delivery is seen. */
  events: (process.env.SLACK_EVENTS ?? 'auto') as 'auto' | 'on' | 'off',
  // Overridable so the app can be tested against scripts/mock-slack.ts
  slackApi: (process.env.SLACK_API_BASE ?? 'https://slack.com/api').replace(/\/+$/, ''),
  slackOauth: (process.env.SLACK_OAUTH_BASE ?? 'https://slack.com').replace(/\/+$/, ''),
  isProd: process.env.NODE_ENV === 'production',
}

mkdirSync(config.dataDir, { recursive: true })

export const USER_SCOPES = [
  'channels:read', 'groups:read', 'im:read', 'mpim:read',
  'channels:history', 'groups:history', 'im:history', 'mpim:history',
  'chat:write', 'reactions:read', 'reactions:write',
  'users:read', 'emoji:read', 'search:read',
  'files:read', 'files:write',
  'pins:read', 'pins:write',
  'channels:write', 'groups:write', 'im:write', 'mpim:write',
  'team:read',
]
