import type { StreamEvent } from '../../../shared/types'

export interface SocketHooks {
  onEvent: (e: StreamEvent) => void
  onOpen: (reconnected: boolean) => void
  onClose: () => void
  /** the server refused us (session gone) */
  onUnauthorized: () => void
}

interface Pending { resolve: (e: Extract<StreamEvent, { type: 'ack' }>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

/**
 * The one realtime channel to the server: Slack events come down it, messages go up it.
 * Reconnects with backoff; a missed heartbeat (dead link on a phone, sleeping laptop) forces a reconnect.
 */
class Sock {
  private ws?: WebSocket
  private hooks?: SocketHooks
  private attempts = 0
  private stopped = false
  private everOpened = false
  private pending = new Map<string, Pending>()
  private beat?: ReturnType<typeof setInterval>
  private reconnect?: ReturnType<typeof setTimeout>
  private seq = 0

  get open() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  start(hooks: SocketHooks) {
    this.hooks = hooks
    this.stopped = false
    this.connect()
    // coming back to the tab or the network: do not wait for the backoff timer
    const wake = () => {
      if (!this.stopped && !this.open && document.visibilityState === 'visible') {
        clearTimeout(this.reconnect)
        this.connect()
      }
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
  }

  stop() {
    this.stopped = true
    clearInterval(this.beat)
    clearTimeout(this.reconnect)
    this.ws?.close()
  }

  private connect() {
    if (this.stopped || this.ws?.readyState === WebSocket.CONNECTING || this.open) return
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/api/ws`)
    this.ws = ws
    ws.onopen = () => {
      const reconnected = this.everOpened
      this.everOpened = true
      this.attempts = 0
      this.hooks?.onOpen(reconnected)
      clearInterval(this.beat)
      this.beat = setInterval(() => {
        this.request({ op: 'ping' }, 8000).catch(() => ws.close())
      }, 20_000)
    }
    ws.onmessage = (m) => {
      let e: StreamEvent
      try {
        e = JSON.parse(m.data)
      } catch {
        return
      }
      if (e.type === 'ack') {
        const p = this.pending.get(e.id)
        if (p) {
          clearTimeout(p.timer)
          this.pending.delete(e.id)
          p.resolve(e)
        }
        return
      }
      this.hooks?.onEvent(e)
    }
    ws.onclose = (ev) => {
      clearInterval(this.beat)
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new Error('disconnected'))
        this.pending.delete(id)
      }
      this.hooks?.onClose()
      if (this.stopped) return
      if (ev.code === 4401 || (!this.everOpened && this.attempts >= 2)) {
        // either told the session ended, or never got in: find out whether we are still signed in
        void fetch('/api/prefs').then((r) => r.status === 401 && this.hooks?.onUnauthorized()).catch(() => undefined)
        if (ev.code === 4401) return
      }
      const delay = Math.min(15_000, 500 * 2 ** this.attempts++) + Math.random() * 300
      this.reconnect = setTimeout(() => this.connect(), delay)
    }
  }

  /** Send a command and wait for its ack. Rejects if the socket is down or the ack is late. */
  request(payload: Record<string, unknown>, timeoutMs = 20_000): Promise<Extract<StreamEvent, { type: 'ack' }>> {
    return new Promise((resolve, reject) => {
      if (!this.open) return reject(new Error('not_connected'))
      const id = `${Date.now().toString(36)}-${++this.seq}`
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('timeout'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws!.send(JSON.stringify({ ...payload, id }))
    })
  }
}

export const socket = new Sock()
