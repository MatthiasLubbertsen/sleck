import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { config } from './config'
import { deleteSessionsFor } from './db'
import { hub } from './hub'
import { dispatchSlackEvent } from './dispatch'
import { forgetUnread } from './convs'
import { verifySlackSignature } from './signature'
import { forgetContext } from './slack'

const recent = new Map<string, number>()
function duplicate(id: string | undefined): boolean {
  if (!id) return false
  const now = Date.now()
  for (const [k, t] of recent) if (now - t > 10 * 60_000) recent.delete(k)
  if (recent.has(id)) return true
  recent.set(id, now)
  return false
}

/** Slack Events API receiver (OAuth installs). Web sessions get the same events over RTM instead. */
export const events = new Hono()

events.post('/events', bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
  if (!config.signingSecret) return c.text('events api not configured', 404)
  const raw = await c.req.text()
  if (!verifySlackSignature(config.signingSecret, c.req.header('x-slack-request-timestamp'), c.req.header('x-slack-signature'), raw)) {
    return c.text('invalid signature', 401)
  }
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return c.text('bad request', 400)
  }
  if (body.type === 'url_verification') return c.json({ challenge: body.challenge })
  if (body.type !== 'event_callback') return c.body(null, 200)
  if (duplicate(body.event_id)) return c.body(null, 200)

  const ev = body.event ?? {}
  const team: string = body.team_id ?? ev.team ?? ''
  const users: string[] = [...new Set<string>((body.authorizations ?? []).map((a: any) => a.user_id).concat(body.authed_users ?? []))]

  if (ev.type === 'tokens_revoked') {
    for (const u of ev.tokens?.oauth ?? []) {
      hub.close(team, u)
      forgetContext(`${team}:${u}`)
      forgetUnread(`${team}:${u}`)
      deleteSessionsFor(team, u)
    }
    return c.body(null, 200)
  }
  if (ev.type === 'app_uninstalled') {
    for (const u of users) hub.close(team, u)
    deleteSessionsFor(team)
    return c.body(null, 200)
  }

  dispatchSlackEvent(team, users, ev, 'events')
  return c.body(null, 200)
})
