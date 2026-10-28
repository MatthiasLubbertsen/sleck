import { config } from './config'
import type { StreamEvent } from '../shared/types'

type Sink = (e: StreamEvent) => void

/** Fan-out of server events to the open browser tabs of a (team,user), via SSE. */
class Hub {
  private sinks = new Map<string, Set<Sink>>()
  private seen = new Set<string>()

  private k = (team: string, user: string) => `${team}:${user}`

  subscribe(team: string, user: string, sink: Sink): () => void {
    const key = this.k(team, user)
    let set = this.sinks.get(key)
    if (!set) this.sinks.set(key, (set = new Set()))
    set.add(sink)
    return () => {
      set.delete(sink)
      if (!set.size) this.sinks.delete(key)
    }
  }

  publish(team: string, user: string, e: StreamEvent) {
    for (const s of this.sinks.get(this.k(team, user)) ?? []) s(e)
  }

  /** Tell tabs the session is gone, then forget them. */
  close(team: string, user: string) {
    this.publish(team, user, { type: 'revoked' })
    this.sinks.delete(this.k(team, user))
    this.seen.delete(this.k(team, user))
  }

  markEventsSeen(team: string, user: string) {
    this.seen.add(this.k(team, user))
  }

  /** Is the Events API feeding us, i.e. can the client skip polling? */
  realtime(team: string, user: string): boolean {
    if (config.events === 'on') return true
    if (config.events === 'off') return false
    return this.seen.has(this.k(team, user))
  }
}

export const hub = new Hub()
