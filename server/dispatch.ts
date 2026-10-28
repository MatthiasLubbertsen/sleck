import { hub } from './hub'
import { applyMarked, applyMessageEvent, cachedConversations } from './convs'
import { invalidate } from './slack'

const CONV_EVENTS = /^(channel|group|im|mpim)_(created|rename|archive|unarchive|left|deleted|close|open)$|^member_(joined|left)_channel$/
const MARKED = /^(channel|group|im|mpim)_marked$/

/** One pipeline for Slack events, whether they came from the Events API or a web-session RTM socket. */
export function dispatchSlackEvent(team: string, users: string[], ev: any, source: 'events' | 'rtm') {
  for (const user of users) {
    if (source === 'events') hub.markEventsSeen(team, user)
    const key = `${team}:${user}`
    applyMessageEvent(team, user, ev, cachedConversations(key))
    if (MARKED.test(ev.type ?? '')) applyMarked(team, user, ev)
    if (CONV_EVENTS.test(ev.type ?? '')) {
      invalidate(`${key}:convs`)
      hub.publish(team, user, { type: 'conversations' })
    }
    hub.publish(team, user, { type: 'slack', event: ev })
  }
}
