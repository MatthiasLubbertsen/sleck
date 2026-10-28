// Backend-only smoke test of web-session mode: import blob -> bootstrap -> browser WebSocket -> RTM relay.
// Needs: scripts/test-stack.sh web
import WebSocket from 'ws'

const APP = 'http://localhost:3000'
const MOCK = 'http://localhost:4010'
const blob = Buffer.from(JSON.stringify({ token: 'xoxc-1234567890-mock-web-token-abcdef', cookie: 'xoxd-mockcookievalue0123456789abcdef%2Bxyz', host: 'mock.slack.com' })).toString('base64url')

const bad = await fetch(`${APP}/auth/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blob: 'nope' }) })
console.log('invalid blob ->', bad.status)
const cross = await fetch(`${APP}/auth/import`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://evil.example' }, body: JSON.stringify({ blob }) })
console.log('cross-origin import ->', cross.status)
const res = await fetch(`${APP}/auth/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blob }) })
console.log('import ->', res.status, await res.clone().text())
const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
console.log('cookie httpOnly:', /httponly/i.test(res.headers.getSetCookie().join(';')))

const boot = await (await fetch(`${APP}/api/bootstrap`, { headers: { cookie } })).json()
console.log('kind:', boot.me.kind, '| convs:', boot.conversations.length, '| sections:', boot.sections?.map((s) => s.name).join(','), '| slackMuted:', boot.slackMuted, '| live:', boot.live)
console.log('unread:', Object.entries(boot.unread).filter(([, u]) => u.unread).map(([k, u]) => `${k}:${u.unread}${u.mentions ? '@' + u.mentions : ''}${u.approx ? '~' : ''}`).join(' '))

const noOrigin = new WebSocket('ws://localhost:3000/api/ws', { headers: { cookie } })
noOrigin.on('error', (e) => console.log('ws without Origin rejected:', e.message))
const evil = new WebSocket('ws://localhost:3000/api/ws', { headers: { cookie, origin: 'http://evil.example' } })
evil.on('error', (e) => console.log('ws bad Origin rejected:', e.message))
const anon = new WebSocket('ws://localhost:3000/api/ws', { headers: { origin: APP } })
anon.on('error', (e) => console.log('ws without session rejected:', e.message))

const ws = new WebSocket('ws://localhost:3000/api/ws', { headers: { cookie, origin: APP } })
const got = []
ws.on('message', (d) => got.push(JSON.parse(d.toString())))
await new Promise((r) => ws.on('open', r))
await new Promise((r) => setTimeout(r, 1500))
console.log('hello:', got.find((e) => e.type === 'hello')?.live, '| live events:', got.filter((e) => e.type === 'live').map((e) => e.live))

await fetch(`${MOCK}/__inject`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'C0000002', text: 'hello over rtm' }) })
await new Promise((r) => setTimeout(r, 800))
console.log('relayed message over WS:', got.some((e) => e.type === 'slack' && e.event.text === 'hello over rtm'), '| unread bumped:', got.filter((e) => e.type === 'unread').map((e) => `${e.channel}:${e.state.unread}`).join(' '))

const ackP = new Promise((r) => ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'ack' && m.id === 'a1') r(m) }))
ws.send(JSON.stringify({ op: 'send', id: 'a1', channel: 'C0000002', text: 'sent over websocket' }))
const ack = await ackP
console.log('send over WS acked:', ack.ok, ack.ts)

await fetch(`${MOCK}/__rtm-drop`, { method: 'POST' })
await new Promise((r) => setTimeout(r, 3500))
console.log('after upstream drop, events:', got.filter((e) => e.type === 'live' || e.type === 'resync').map((e) => e.type === 'live' ? e.live : 'resync').join(' > '))
ws.close()
process.exit(0)
