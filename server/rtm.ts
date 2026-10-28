import WebSocket from 'ws'
import { config } from './config'
import { dispatchSlackEvent } from './dispatch'
import { hub } from './hub'
import { AUTH_ERRORS, slack, SlackError, type Ctx } from './slack'

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const IGNORED = new Set(['hello', 'pong', 'reconnect_url', 'presence_change', 'manual_presence_change', 'user_typing', 'user_status_changed', 'dnd_updated', 'dnd_updated_user'])

/**
 * Realtime socket for a web session. Connects to the URL from `rtm.connect` (live-tested with a team
 * xoxc token + `d` cookie per the ReDocumented catalog), falling back to the web client's gateway URL.
 * Events go through the same pipeline as Events API deliveries. Credentials never appear in logs.
 */
class Conn {
  private ws?: WebSocket
  private stopped = false
  private attempt = 0
  private timer?: ReturnType<typeof setTimeout>
  private pinger?: ReturnType<typeof setInterval>
  private lastSeen = 0
  private nextUrl?: string

  constructor(private ctx: Ctx, private onDead: () => void) {}

  start() {
    void this.connect()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    clearInterval(this.pinger)
    this.ws?.removeAllListeners()
    this.ws?.close()
  }

  private async url(): Promise<string> {
    if (config.slackRtmUrl) return config.slackRtmUrl
    if (this.nextUrl) {
      const u = this.nextUrl
      this.nextUrl = undefined
      return u
    }
    try {
      return (await slack<any>(this.ctx, 'rtm.connect', { batch_presence_aware: 1 })).url
    } catch (e) {
      if (e instanceof SlackError && AUTH_ERRORS.has(e.code)) throw e
      // e.g. enterprise tokens: use the gateway the web client itself connects to
      const team = this.ctx.teamId
      return `wss://wss-primary.slack.com/?token=${encodeURIComponent(this.ctx.token)}&flannel=3&lazy_channels=1&batch_presence_aware=1&gateway_server=${team.slice(1)}-1`
    }
  }

  private async connect() {
    if (this.stopped) return
    hub.setUpstream(this.ctx.teamId, this.ctx.userId, this.attempt ? 'down' : 'connecting')
    try {
      const url = await this.url()
      const ws = new WebSocket(url, {
        headers: { Cookie: `d=${this.ctx.cookie}`, Origin: 'https://app.slack.com', 'User-Agent': UA },
        handshakeTimeout: 15_000,
      })
      this.ws = ws
      ws.on('message', (data) => this.onMessage(data.toString()))
      ws.on('close', () => this.lost())
      ws.on('error', () => undefined) // 'close' follows; never log: the error text can contain the URL
      clearInterval(this.pinger)
      this.pinger = setInterval(() => {
        if (Date.now() - this.lastSeen > 60_000) return ws.terminate()
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', id: Date.now() }))
      }, 15_000)
    } catch (e) {
      if (e instanceof SlackError && AUTH_ERRORS.has(e.code)) {
        this.stopped = true
        this.onDead()
        return
      }
      this.lost()
    }
  }

  private lost() {
    if (this.stopped) return
    clearInterval(this.pinger)
    hub.setUpstream(this.ctx.teamId, this.ctx.userId, 'down')
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) + Math.random() * 500
    this.timer = setTimeout(() => void this.connect(), delay)
  }

  private onMessage(raw: string) {
    this.lastSeen = Date.now()
    let ev: any
    try {
      ev = JSON.parse(raw)
    } catch {
      return
    }
    const { teamId, userId } = this.ctx
    switch (ev.type) {
      case 'hello':
        this.attempt = 0
        hub.setUpstream(teamId, userId, 'connected')
        hub.publish(teamId, userId, { type: 'resync' }) // catch up on anything missed while down
        return
      case 'reconnect_url':
        this.nextUrl = ev.url
        return
      case 'goodbye':
        this.ws?.close()
        return
      case 'error':
        if (typeof ev.error?.msg === 'string' && /invalid_auth|token/i.test(ev.error.msg)) this.ws?.close()
        return
    }
    if (IGNORED.has(ev.type) || ev.reply_to !== undefined) return
    dispatchSlackEvent(teamId, [userId], ev, 'rtm')
  }
}

class RtmManager {
  private conns = new Map<string, Conn>()

  ensure(ctx: Ctx) {
    if (ctx.kind !== 'web' || this.conns.has(ctx.key)) return
    const conn = new Conn(ctx, () => {
      this.conns.delete(ctx.key)
      hub.publish(ctx.teamId, ctx.userId, { type: 'revoked' })
    })
    this.conns.set(ctx.key, conn)
    conn.start()
  }

  stop(key: string) {
    this.conns.get(key)?.stop()
    this.conns.delete(key)
  }
}

export const rtm = new RtmManager()
