import { config } from './config'
import type { LiveState, StreamEvent } from '../shared/types'

type Sink = (e: StreamEvent) => void

/** Fan-out of server events to the open browser tabs of a (team,user), over WebSocket. */
class Hub {
  private sinks = new Map<string, Set<Sink>>()
  private seen = new Set<string>()
  private upstream = new Map<string, LiveState>()

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
    this.upstream.delete(this.k(team, user))
  }

  markEventsSeen(team: string, user: string) {
    this.seen.add(this.k(team, user))
  }

  /** Web sessions report their RTM socket state here. */
  setUpstream(team: string, user: string, state: LiveState) {
    if (this.upstream.get(this.k(team, user)) === state) return
    this.upstream.set(this.k(team, user), state)
    this.publish(team, user, { type: 'live', live: state })
  }

  /** Is something feeding us live updates for this user? */
  live(team: string, user: string, kind: 'oauth' | 'web'): LiveState {
    if (kind === 'web') return this.upstream.get(this.k(team, user)) ?? 'connecting'
    if (config.events === 'on' || this.seen.has(this.k(team, user))) return 'connected'
    return 'none'
  }
}

export const hub = new Hub()
