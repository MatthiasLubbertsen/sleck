import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { config } from './config'
import { decrypt, encrypt, randomId, sha256 } from './crypto'
import type { Prefs } from '../shared/types'

const db = new DatabaseSync(join(config.dataDir, 'sleck.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,         -- sha256 of the cookie value, never the value itself
    team_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    token_enc   TEXT NOT NULL,            -- AES-GCM, bound to id
    scopes      TEXT NOT NULL DEFAULT '',
    csrf        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(team_id, user_id);
  CREATE TABLE IF NOT EXISTS prefs (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    json    TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );
`)

// additive migrations for web-session support
for (const col of ["kind TEXT NOT NULL DEFAULT 'oauth'", 'cookie_enc TEXT', 'host TEXT']) {
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`)
  } catch { /* already there */ }
}

const MAX_AGE_MS = 30 * 24 * 3600 * 1000

export interface Session {
  /** cookie value (raw), only used to re-sign; not persisted */
  sid: string
  teamId: string
  userId: string
  token: string
  scopes: string[]
  csrf: string
  /** oauth: official user token. web: xoxc token + `d` cookie from a browser session. */
  kind: 'oauth' | 'web'
  cookie?: string
  host?: string
}

export function createSession(teamId: string, userId: string, token: string, scopes: string, web?: { cookie: string; host: string }): { sid: string; csrf: string } {
  const sid = randomId(32)
  const id = sha256(sid)
  const csrf = randomId(24)
  const now = Date.now()
  db.prepare('INSERT INTO sessions (id, team_id, user_id, token_enc, scopes, csrf, created_at, last_seen, kind, cookie_enc, host) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, teamId, userId, encrypt(token, id), scopes, csrf, now, now, web ? 'web' : 'oauth', web ? encrypt(web.cookie, id + ':cookie') : null, web?.host ?? null)
  // One live session per (team,user) keeps "minimal data stored" honest for a single-user app.
  db.prepare('DELETE FROM sessions WHERE team_id = ? AND user_id = ? AND id != ?').run(teamId, userId, id)
  return { sid, csrf }
}

export function getSession(sid: string): Session | null {
  const id = sha256(sid)
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any
  if (!row) return null
  const now = Date.now()
  if (now - row.last_seen > MAX_AGE_MS) {
    deleteSession(sid)
    return null
  }
  let token: string
  let cookie: string | undefined
  try {
    token = decrypt(row.token_enc, id)
    if (row.cookie_enc) cookie = decrypt(row.cookie_enc, id + ':cookie')
  } catch {
    deleteSession(sid)
    return null
  }
  if (now - row.last_seen > 3600_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, id)
  return { sid, teamId: row.team_id, userId: row.user_id, token, scopes: String(row.scopes).split(',').filter(Boolean), csrf: row.csrf, kind: row.kind === 'web' ? 'web' : 'oauth', cookie, host: row.host ?? undefined }
}

export const deleteSession = (sid: string) => void db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(sid))
export const deleteSessionsFor = (teamId: string, userId?: string) =>
  void (userId
    ? db.prepare('DELETE FROM sessions WHERE team_id = ? AND user_id = ?').run(teamId, userId)
    : db.prepare('DELETE FROM sessions WHERE team_id = ?').run(teamId))

export function purgeExpired() {
  db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(Date.now() - MAX_AGE_MS)
}

const emptyPrefs = (): Prefs => ({ pinned: [], muted: [], collapsed: [] })

export function getPrefs(teamId: string, userId: string): Prefs {
  const row = db.prepare('SELECT json FROM prefs WHERE team_id = ? AND user_id = ?').get(teamId, userId) as any
  if (!row) return emptyPrefs()
  try {
    return { ...emptyPrefs(), ...JSON.parse(row.json) }
  } catch {
    return emptyPrefs()
  }
}

export function setPrefs(teamId: string, userId: string, p: Prefs) {
  const clean = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.length < 40).slice(0, 500) : [])
  const value: Prefs = { pinned: clean(p.pinned), muted: clean(p.muted), collapsed: clean(p.collapsed) }
  db.prepare('INSERT INTO prefs (team_id, user_id, json) VALUES (?,?,?) ON CONFLICT(team_id,user_id) DO UPDATE SET json = excluded.json')
    .run(teamId, userId, JSON.stringify(value))
  return value
}
