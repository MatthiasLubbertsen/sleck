// Types shared by server and web. Slack payloads are kept loose on purpose:
// we pass through what Slack sends and only model the fields the UI reads.

export type ConvType = 'public' | 'private' | 'dm' | 'group_dm'

export interface Conversation {
  id: string
  type: ConvType
  name: string
  /** other party for 1:1 DMs */
  user?: string
  isArchived: boolean
  isMember: boolean
  isExtShared: boolean
  sharedTeamIds: string[]
  contextTeamId?: string
  topic: string
  purpose: string
  numMembers?: number
  created: number
}

export interface UnreadState {
  lastRead: string
  latestTs: string
  unread: number
  mentions: number
  /** true once we have actually asked Slack */
  known: boolean
  /** Slack only said "has unreads" without a count (client.counts) */
  approx?: boolean
}

export interface UserLite {
  id: string
  name: string
  display: string
  real: string
  avatar: string
  isBot: boolean
  deleted: boolean
  teamId?: string
  tz?: string
  title?: string
}

export interface TeamLite {
  id: string
  name: string
  domain?: string
  icon?: string
}

export interface Prefs {
  pinned: string[]
  muted: string[]
  collapsed: string[]
}

export interface Me {
  userId: string
  team: TeamLite
  csrf: string
  scopes: string[]
  kind: 'oauth' | 'web'
}

/** Slack's own sidebar sections (web sessions only). */
export interface Section {
  id: string
  name: string
  type: string
  channelIds: string[]
}

export type LiveState = 'connected' | 'connecting' | 'down' | 'none'

export interface Bootstrap {
  me: Me
  conversations: Conversation[]
  unread: Record<string, UnreadState>
  prefs: Prefs
  sections?: Section[]
  /** mute state as Slack has it (read only) */
  slackMuted?: string[]
  live: LiveState
}

export type StreamEvent =
  /** sent on every (re)connect; `unread` is a full snapshot so nothing emitted before we connected is lost */
  | { type: 'hello'; live: LiveState; unread: Record<string, UnreadState> }
  | { type: 'live'; live: LiveState }
  | { type: 'slack'; event: any }
  | { type: 'unread'; channel: string; state: UnreadState }
  | { type: 'conversations' }
  /** upstream reconnected: refetch what you are looking at */
  | { type: 'resync' }
  | { type: 'revoked' }
  | { type: 'ack'; id: string; ok: boolean; error?: string; ts?: string; message?: any }
