import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { parseSigned } from 'hono/utils/cookie'
import { config } from './config'
import { ctxFor, endSession, SESSION_COOKIE } from './auth'
import { getSession, type Session } from './db'
import { hub } from './hub'
import { rtm } from './rtm'
import { snapshotUnread } from './convs'
import { AUTH_ERRORS, slack, SlackError } from './slack'
import type { StreamEvent } from '../shared/types'

const reChannel = /^[A-Z][A-Z0-9]{2,20}$/
const reTs = /^\d{9,11}\.\d{1,6}$/

/**
 * Browser <-> server WebSocket at /api/ws. Server -> browser: every Slack event and unread change.
 * Browser -> server: `send` (post a message, acked), `ping`. Auth is the session cookie; the Origin
 * header must match APP_URL, which is what stops cross-site WebSocket hijacking.
 */
export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const reject = (code: number, why: string) => {
        socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`)
        socket.destroy()
      }
      if (new URL(req.url ?? '/', 'http://x').pathname !== '/api/ws') return reject(404, 'Not Found')
      if (req.headers.origin !== config.origin) return reject(403, 'Forbidden')
      const parsed = await parseSigned(req.headers.cookie ?? '', config.sessionSecret, SESSION_COOKIE).catch(() => ({}) as Record<string, string | false>)
      const sid = parsed[SESSION_COOKIE]
      const session = typeof sid === 'string' ? getSession(sid) : null
      if (!session) return reject(401, 'Unauthorized')
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, session))
    })()
  })
}

function onConnection(ws: WebSocket, session: Session) {
  const ctx = ctxFor(session)
  const out = (e: StreamEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e))
  }
  const unsub = hub.subscribe(ctx.teamId, ctx.userId, (e) => {
    out(e)
    if (e.type === 'revoked') ws.close(4401, 'session ended')
  })
  rtm.ensure(ctx)
  out({ type: 'hello', live: hub.live(ctx.teamId, ctx.userId, session.kind), unread: snapshotUnread(ctx.key) })

  let alive = true
  ws.on('pong', () => (alive = true))
  const beat = setInterval(() => {
    if (!alive) return ws.terminate()
    alive = false
    ws.ping()
  }, 25_000)

  ws.on('message', (raw) => {
    void (async () => {
      let m: any
      try {
        m = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (m.op === 'ping') return out({ type: 'ack', id: String(m.id ?? ''), ok: true })
      if (m.op !== 'send') return
      const id = String(m.id ?? '')
      try {
        if (!reChannel.test(m.channel) || typeof m.text !== 'string' || m.text.length > 40_000 || (m.thread_ts && !reTs.test(m.thread_ts))) throw new SlackError('bad_request')
        const r = await slack<any>(ctx, 'chat.postMessage', {
          channel: m.channel,
          text: m.text,
          thread_ts: m.thread_ts || undefined,
          reply_broadcast: m.thread_ts && m.reply_broadcast ? 'true' : undefined,
        })
        out({ type: 'ack', id, ok: true, ts: r.ts, message: r.message })
      } catch (e) {
        const code = e instanceof SlackError ? e.code : 'internal_error'
        if (AUTH_ERRORS.has(code)) {
          endSession(session)
          return
        }
        out({ type: 'ack', id, ok: false, error: code })
      }
    })()
  })

  ws.on('close', () => {
    clearInterval(beat)
    unsub()
  })
}
