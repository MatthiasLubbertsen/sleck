// End-to-end check against scripts/mock-slack.ts, in either sign-in mode.
//   npm run build && scripts/test-stack.sh oauth && MODE=oauth node scripts/e2e.mjs
//   npm run build && scripts/test-stack.sh web   && MODE=web   node scripts/e2e.mjs
// Playwright is not a project dependency; it is resolved from the global install.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const { chromium } = createRequire(import.meta.url)('playwright')

const APP = process.env.APP_URL ?? 'http://localhost:3000'
const MOCK = process.env.MOCK_URL ?? 'http://localhost:4010'
const SHOTS = process.env.SHOTS ?? '/tmp/sleck-shots'
const WEB = process.env.MODE === 'web'
mkdirSync(SHOTS, { recursive: true })
const BLOB = Buffer.from(JSON.stringify({ token: 'xoxc-1234567890-mock-web-token-abcdef', cookie: 'xoxd-mockcookievalue0123456789abcdef%2Bxyz', host: 'mock.slack.com' })).toString('base64url')

const results = []
const check = async (name, fn) => {
  try {
    await fn()
    results.push([true, name])
    console.log('  ok  ', name)
  } catch (e) {
    results.push([false, name, e.message.split('\n')[0]])
    console.log('  FAIL', name, '-', e.message.split('\n')[0])
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const post = (path, body) => fetch(`${MOCK}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined })
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } })
const page = await ctx.newPage()
const errors = []
const wsFrames = { sent: [], received: [] }
const apiCalls = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()))
page.on('request', (r) => r.url().includes('/api/') && apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`))
page.on('websocket', (ws) => {
  ws.on('framesent', (f) => wsFrames.sent.push(String(f.payload)))
  ws.on('framereceived', (f) => wsFrames.received.push(String(f.payload)))
})
const api = (path, init) => page.evaluate(async ([p, i]) => (await fetch('/api' + p, i)).json(), [path, init])
const nav = page.getByRole('navigation', { name: 'Conversations' })
const scroller = page.getByTestId('message-scroller')

await check('login screen shows without a session', async () => {
  await page.goto(APP)
  await page.getByRole('button', { name: 'Sign in with Slack' }).waitFor()
  await page.getByText('Use a browser session').waitFor()
  await page.screenshot({ path: `${SHOTS}/01-login.png` })
})
if (WEB) {
  await check('importing garbage is refused with a clear message', async () => {
    await page.getByText('Use a browser session').click()
    await page.getByLabel('Session blob').fill('not-a-blob')
    await page.getByRole('button', { name: 'Sign in with this session' }).click()
    await page.getByText(/does not look like a session blob/).waitFor()
  })
  await check('browser-session import signs in (cookie from the grab script)', async () => {
    await page.getByLabel('Session blob').fill(BLOB)
    await page.getByRole('button', { name: 'Sign in with this session' }).click()
    await nav.waitFor({ timeout: 10000 })
  })
} else {
  await check('OAuth round trip lands in the app', async () => {
    await page.getByRole('button', { name: 'Sign in with Slack' }).click()
    await nav.waitFor({ timeout: 10000 })
  })
}
await check('session cookie is httpOnly; credentials not reachable from JS or DOM', async () => {
  const s = (await ctx.cookies()).find((c) => c.name.startsWith('sleck_session'))
  expect(s?.httpOnly, 'cookie not httpOnly')
  const html = await page.content()
  expect(!html.includes('xoxp-') && !html.includes('xoxc-') && !html.includes('xoxd-'), 'credential in DOM')
  const leaked = await page.evaluate(() => JSON.stringify(localStorage) + document.cookie)
  expect(!/xox[pcd]-/.test(leaked) && !leaked.includes('sleck_session'), 'credential/cookie reachable from JS')
})
await check('browser <-> server realtime is a WebSocket (no EventSource)', async () => {
  await page.waitForTimeout(800)
  expect(wsFrames.received.some((f) => f.includes('"type":"hello"')), 'no hello frame on the websocket')
})
await check('shell: rail with profile bottom-left, top bar with search, Slack-style sidebar', async () => {
  const profile = page.getByRole('button', { name: /Profile and account/ }).first()
  const box = await profile.boundingBox()
  expect(box && box.x < 80 && box.y > 700, `profile avatar not bottom-left: ${JSON.stringify(box)}`)
  await page.getByRole('button', { name: /Search Mock Workspace/ }).waitFor()
  await page.getByRole('button', { name: 'Home', exact: true }).waitFor()
})
await check('sidebar lists every conversation type', async () => {
  for (const n of [/Public channel general/, /Private channel secret-plans/, /Direct message Alice Wonder/, /Group message Alice Wonder, Bob Builder/]) {
    await nav.getByRole('button', { name: n }).first().waitFor({ timeout: 8000 })
  }
})
if (WEB) {
  await check('web session: Slack sections (Starred/Projects) and Slack mute state are used', async () => {
    await nav.getByRole('button', { name: /Starred/ }).waitFor()
    await nav.getByRole('button', { name: /Projects/ }).waitFor()
    await nav.getByRole('button', { name: /shared-with-acme muted/ }).waitFor()
  })
}
await check('unread + mention indicators appear', async () => {
  await nav.getByRole('button', { name: /Direct message Alice Wonder @2 mentions/ }).waitFor({ timeout: 20000 })
  await nav.getByRole('button', { name: /Public channel random (1|new) unread/ }).waitFor({ timeout: 20000 })
})
await check('#general: day separators + mrkdwn rendering', async () => {
  await page.getByRole('heading', { name: 'general' }).waitFor()
  await page.getByText('Thread starter').waitFor()
  expect((await page.locator('strong', { hasText: 'bold' }).count()) > 0, 'bold not rendered')
  expect((await page.locator('code', { hasText: 'code' }).count()) > 0, 'inline code not rendered')
  expect((await page.locator('pre', { hasText: 'const x = 1' }).count()) === 1, 'code block not rendered')
  expect((await page.locator('blockquote', { hasText: 'quoted line' }).count()) === 1, 'quote not rendered')
  expect((await page.locator('a[href="https://example.com"]').count()) === 1, 'link not rendered')
  expect((await page.getByRole('separator').count()) >= 2, 'no day separators')
  await page.screenshot({ path: `${SHOTS}/02-general.png` })
})
await check('mentions: only the @mention chip is yellow; no label, no row glow', async () => {
  const row = page.locator('article', { hasText: 'Thread starter' })
  const bg = await row.evaluate((e) => getComputedStyle(e).backgroundColor)
  const border = await row.evaluate((e) => getComputedStyle(e).borderLeftColor)
  expect(bg === 'rgba(0, 0, 0, 0)', `row has a background: ${bg}`)
  expect(border === 'rgba(0, 0, 0, 0)', `row has a coloured border: ${border}`)
  const labels = await row.getByText('mentions you').evaluateAll((els) => els.map((e) => e.classList.contains('sr-only')))
  expect(labels.every(Boolean), 'visible "mentions you" label (only a screen-reader-only one is allowed)')
  const chip = row.locator('span', { hasText: '@matthias' }).first()
  const color = await chip.evaluate((e) => getComputedStyle(e).color)
  expect(/255, 178, 36/.test(color), `mention chip is not amber: ${color}`)
})
await check('custom + unicode emoji render', async () => {
  expect((await page.locator('img.emoji-img').count()) > 0, 'custom emoji img missing')
  expect((await page.locator('[role=img][title=":tada:"]').count()) > 0, 'unicode :tada: not rendered')
})
await check('unread divider is shown at the first unread message', async () => {
  await page.locator('[data-new-divider]').waitFor({ timeout: 5000 })
})
await check('infinite scroll loads older history', async () => {
  const before = await page.locator('[data-msg]').count()
  for (let i = 0; i < 4; i++) {
    await scroller.evaluate((e) => (e.scrollTop = 0))
    await page.waitForTimeout(600)
  }
  expect((await page.locator('[data-msg]').count()) > before, 'no more messages loaded')
})
await check('send with Enter goes over the WebSocket: pending -> delivered, stored once', async () => {
  const sentBefore = wsFrames.sent.length
  const box = page.locator('#composer-main')
  await box.click()
  await box.fill('hello from e2e *bold* :wave:')
  await box.press('Enter')
  await page.locator('article[aria-label^="Your message"]', { hasText: 'hello from e2e' }).waitFor()
  await page.waitForTimeout(1000)
  expect(wsFrames.sent.slice(sentBefore).some((f) => f.includes('"op":"send"') && f.includes('hello from e2e')), 'send frame not seen on the websocket')
  expect(!apiCalls.includes('POST /api/send'), 'message was sent over HTTP instead of the websocket')
  expect((await page.locator('article[aria-label*="failed"]').count()) === 0, 'failed message present')
  const h = await api('/history?channel=C0000001&limit=5')
  expect(h.messages.some((m) => m.text === 'hello from e2e *bold* :wave:'), 'server did not receive message')
  expect((await page.locator('article', { hasText: 'hello from e2e' }).count()) === 1, 'duplicate message rendered')
})
await check('Shift+Enter inserts a newline instead of sending', async () => {
  const box = page.locator('#composer-main')
  await box.fill('line1')
  await box.press('Shift+Enter')
  await box.type('line2')
  expect((await box.inputValue()) === 'line1\nline2', 'newline not inserted')
  await box.fill('')
})
await check('real-time: incoming message arrives over the socket (no reload)', async () => {
  await post('/__inject', { channel: 'C0000001', text: 'realtime ping from alice' })
  await scroller.getByText('realtime ping from alice').waitFor({ timeout: 6000 })
})
await check('real-time: unread badge increments in another channel', async () => {
  await post('/__inject', { channel: 'C0000002', text: 'second random msg' })
  await nav.getByRole('button', { name: /Public channel random (2|new) unread/ }).waitFor({ timeout: 6000 })
})
await check('no HTTP polling: idle for 8s makes no history/replies/counts requests', async () => {
  await page.waitForTimeout(500)
  const mark = apiCalls.length
  await page.waitForTimeout(8000)
  const polled = apiCalls.slice(mark).filter((c) => /\/api\/(history|replies|bootstrap|users)/.test(c))
  expect(polled.length === 0, `polling detected: ${polled.join(', ')}`)
  expect((await page.getByText(/polling every/i).count()) === 0, 'polling label still in the UI')
})
if (WEB) {
  await check('RTM upstream drop: reconnects and catches up on missed messages', async () => {
    await post('/__rtm-drop')
    await page.waitForTimeout(600)
    await post('/__inject', { channel: 'C0000001', text: 'sent while the upstream socket was down' })
    await scroller.getByText('sent while the upstream socket was down').waitFor({ timeout: 12000 })
  })
}
await check('emoji :shortcode autocomplete', async () => {
  const box = page.locator('#composer-main')
  await box.click()
  await box.fill('')
  await box.type(':tad')
  await page.getByRole('option', { name: /tada/ }).first().waitFor()
  await box.press('Enter')
  expect((await box.inputValue()).startsWith(':tada: '), 'emoji not inserted: ' + (await box.inputValue()))
  await box.fill('')
})
await check('@mention autocomplete sends a real <@U…> mention', async () => {
  const box = page.locator('#composer-main')
  await box.click()
  await box.type('hi @ali')
  await page.getByRole('option', { name: /Alice Wonder/ }).waitFor()
  await box.press('Tab')
  await box.press('Enter')
  await page.waitForTimeout(800)
  const h = await api('/history?channel=C0000001&limit=6')
  expect(h.messages.some((m) => m.text === 'hi <@U0000002>'), 'mention not converted: ' + JSON.stringify(h.messages.map((m) => m.text)))
})
await check('#channel autocomplete', async () => {
  const box = page.locator('#composer-main')
  await box.click()
  await box.type('see #rand')
  await page.getByRole('option', { name: /random/ }).waitFor()
  await box.press('Enter')
  expect((await box.inputValue()).startsWith('see #random'), 'channel not inserted')
  await box.fill('')
})
await check('reactions: toggle off and on via chip, server agrees', async () => {
  const msg = page.locator('article', { hasText: 'Thread starter' })
  const group = msg.getByRole('group', { name: 'Reactions' })
  await group.getByRole('button', { pressed: true }).first().click()
  await page.waitForTimeout(900)
  let h = await api('/history?channel=C0000001&limit=20')
  let starter = h.messages.find((m) => m.text.startsWith('Thread starter'))
  expect(starter.reactions.find((r) => r.name === '+1').users.length === 1, 'server still has my +1')
  await group.getByRole('button').first().click()
  await page.waitForTimeout(900)
  h = await api('/history?channel=C0000001&limit=20')
  starter = h.messages.find((m) => m.text.startsWith('Thread starter'))
  expect(starter.reactions.find((r) => r.name === '+1').users.includes('U0000001'), 'server did not get +1 back')
})
await check('reactions: add via picker search', async () => {
  const msg = page.locator('article', { hasText: 'realtime ping from alice' })
  await msg.hover()
  await msg.getByRole('button', { name: 'Add reaction' }).first().click()
  await page.getByRole('textbox', { name: 'Search emoji' }).fill('rocket')
  await page.getByRole('button', { name: 'rocket', exact: true }).first().click()
  await msg.getByRole('button', { name: /rocket, 1 reaction, including yours/ }).waitFor()
  await page.waitForTimeout(600)
  const h = await api('/history?channel=C0000001&limit=20')
  expect(h.messages.find((m) => m.text === 'realtime ping from alice').reactions.some((r) => r.name === 'rocket'), 'server missing rocket')
})
await check('reactions: quick reaction from the actions menu', async () => {
  const msg = page.locator('article', { hasText: 'realtime ping from alice' })
  await msg.hover()
  await msg.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'heart' }).click()
  await msg.getByRole('button', { name: /heart, 1 reaction, including yours/ }).waitFor()
})
await check('reactions: tooltip shows who reacted', async () => {
  const msg = page.locator('article', { hasText: 'Thread starter' })
  await msg.getByRole('group', { name: 'Reactions' }).getByRole('button').first().hover()
  await page.getByRole('tooltip').getByText(/reacted with/).first().waitFor()
})
await check('thread: read replies, reply + also send to channel', async () => {
  await page.mouse.move(5, 5)
  await page.locator('article', { hasText: 'Thread starter' }).getByRole('button', { name: /2 replies/ }).click()
  const panel = page.getByRole('complementary', { name: 'Thread' })
  await panel.getByText('reply one').waitFor()
  await panel.getByText('reply two').waitFor()
  const box = panel.locator('#composer-thread')
  await box.fill('thread reply from e2e')
  await panel.getByRole('switch', { name: /Also send to/ }).click()
  await box.press('Enter')
  await panel.getByText('thread reply from e2e').waitFor()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${SHOTS}/03-thread.png` })
  const ts = (await api('/history?channel=C0000001&limit=60')).messages.find((m) => m.text.startsWith('Thread starter')).ts
  const r = await api('/replies?channel=C0000001&ts=' + ts)
  expect(r.messages.some((m) => m.text === 'thread reply from e2e'), 'reply not stored')
})
await check('Esc closes the thread panel', async () => {
  await page.locator('body').click({ position: { x: 600, y: 120 } })
  await page.keyboard.press('Escape')
  await page.getByRole('complementary', { name: 'Thread' }).waitFor({ state: 'detached' })
})
await check('edit own message inline, then delete with confirmation', async () => {
  const msg = page.locator('article[aria-label^="Your message"]', { hasText: 'hello from e2e' })
  await msg.hover()
  await msg.getByRole('button', { name: 'Edit message' }).click()
  const ed = msg.getByRole('textbox', { name: 'Edit message' })
  await ed.fill('hello from e2e (edited)')
  await ed.press('Enter')
  await msg.getByText('(edited)').first().waitFor()
  await page.waitForTimeout(600)
  let h = await api('/history?channel=C0000001&limit=30')
  expect(h.messages.some((m) => m.text === 'hello from e2e (edited)'), 'edit not stored')
  await msg.hover()
  await msg.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: /Delete message/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await page.waitForTimeout(800)
  h = await api('/history?channel=C0000001&limit=30')
  expect(!h.messages.some((m) => m.text.includes('hello from e2e')), 'message not deleted')
})
await check('Ctrl+K quick switcher opens a DM', async () => {
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog').getByPlaceholder(/Jump to/).fill('alice')
  await page.getByRole('option', { name: /Alice Wonder/ }).first().click()
  await page.getByRole('heading', { name: 'Alice Wonder' }).waitFor()
  await page.getByText('hey, got a minute?').waitFor()
  await page.screenshot({ path: `${SHOTS}/04-dm.png` })
})
await check('opening a conversation marks it read (badge clears)', async () => {
  await nav.getByRole('button', { name: /Direct message Alice Wonder$/ }).waitFor({ timeout: 8000 })
})
await check('rail views: DMs and Activity filter the sidebar', async () => {
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Direct messages/ }).click()
  await nav.getByRole('button', { name: /Direct message Bob Builder/ }).waitFor()
  expect((await nav.getByRole('button', { name: /Public channel general/ }).count()) === 0, 'channels visible in the DM view')
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /Activity/ }).click()
  await nav.getByRole('button', { name: /random/ }).waitFor()
  await page.getByRole('button', { name: 'Home', exact: true }).click()
})
await check('search goes through Slack search: highlighted results, opens in context', async () => {
  const mark = apiCalls.length
  await page.keyboard.press('/')
  await page.getByRole('textbox', { name: 'Search messages' }).fill('seed message 7')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /seed message 7 from/ }).first().waitFor()
  expect(apiCalls.slice(mark).some((c) => c.startsWith('GET /api/search')), 'search did not hit the search endpoint')
  expect((await page.locator('mark').count()) > 0, 'no highlight')
  await page.screenshot({ path: `${SHOTS}/05-search.png` })
  await page.getByRole('button', { name: /seed message 7 from/ }).first().click()
  await page.getByRole('heading', { name: 'general' }).waitFor()
  await page.locator('article[aria-current="location"]').waitFor()
  await page.getByRole('button', { name: /Jump to latest messages/ }).waitFor()
})
await check('file upload (getUploadURLExternal flow) shows the image', async () => {
  await page.getByRole('button', { name: /Jump to latest messages/ }).click()
  await page.locator('input[type=file]').first().setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') })
  await page.getByText('pic.png').first().waitFor()
  await page.locator('#composer-main').press('Enter')
  await page.locator('article img[alt="pic.png"]').waitFor({ timeout: 9000 })
})
await check('? opens the shortcut sheet, Esc closes it', async () => {
  await page.locator('body').click({ position: { x: 600, y: 300 } })
  await page.keyboard.press('?')
  await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
})
await check('rate limit: 429 + Retry-After is retried transparently, delivered once', async () => {
  await post('/__rate-limit', { method: 'chat.postMessage' })
  const box = page.locator('#composer-main')
  await box.click()
  await box.fill('after rate limit')
  await box.press('Enter')
  await page.locator('article[aria-label^="Your message"]', { hasText: 'after rate limit' }).waitFor({ timeout: 8000 })
  await page.waitForTimeout(2500)
  expect((await page.locator('article[aria-label*="failed"]').count()) === 0, 'send failed instead of retrying')
  const h = await api('/history?channel=C0000001&limit=10')
  expect(h.messages.filter((m) => m.text === 'after rate limit').length === 1, 'message not delivered exactly once')
})
await check('phone: sidebar drawer + tabs, profile in the drawer, no horizontal scroll', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 800 }, storageState: await ctx.storageState(), isMobile: true, hasTouch: true })
  const p = await m.newPage()
  await p.goto(APP + '/#/C0000001')
  await p.getByRole('heading', { name: 'general' }).waitFor()
  expect(((await p.getByRole('navigation', { name: 'Conversations' }).boundingBox())?.x ?? 0) < 0, 'drawer should be off-canvas on phones')
  await p.getByRole('button', { name: 'Open conversations' }).tap()
  await p.waitForTimeout(400)
  expect(((await p.getByRole('navigation', { name: 'Conversations' }).boundingBox())?.x ?? -999) >= 0, 'drawer did not open')
  await p.getByRole('tab', { name: /Activity/ }).tap()
  await p.getByRole('button', { name: /Profile and account/ }).waitFor()
  await p.screenshot({ path: `${SHOTS}/06-mobile-drawer.png` })
  await p.getByRole('tab', { name: 'Home' }).tap()
  await p.getByRole('button', { name: /Public channel general/ }).tap()
  await p.waitForTimeout(400)
  expect(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'horizontal page scroll on mobile')
  await m.close()
})
await check('phone: message actions are reachable by touch (no hover needed) incl. quick reactions', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 800 }, storageState: await ctx.storageState(), isMobile: true, hasTouch: true })
  const p = await m.newPage()
  await p.goto(APP + '/#/C0000001')
  await p.getByRole('heading', { name: 'general' }).waitFor()
  const msg = p.locator('article', { hasText: 'realtime ping from alice' })
  await msg.scrollIntoViewIfNeeded()
  expect(!(await msg.getByRole('button', { name: 'More actions' }).isVisible()), 'action bar should be hidden until the message is tapped')
  await msg.getByText('realtime ping from alice').tap()
  await msg.getByRole('button', { name: 'More actions' }).tap()
  await p.getByRole('menuitem', { name: 'eyes' }).tap()
  await msg.getByRole('button', { name: /eyes, 1 reaction, including yours/ }).waitFor()
  await p.screenshot({ path: `${SHOTS}/06c-mobile-actions.png` })
  await m.close()
})
await check('CSRF: POST without token is rejected (403)', async () => {
  const r = await page.evaluate(async () => (await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'C0000001', text: 'x' }) })).status)
  expect(r === 403, 'expected 403, got ' + r)
})
await check('WebSocket handshake: same-origin opens, anonymous is refused', async () => {
  const same = await page.evaluate(async () => new Promise((res) => { const w = new WebSocket(`ws://${location.host}/api/ws`); w.onopen = () => { w.close(); res('open') }; w.onerror = () => res('refused') }))
  expect(same === 'open', 'same-origin websocket should open')
  const anon = await browser.newContext()
  const ap = await anon.newPage()
  await ap.goto(APP)
  const res = await ap.evaluate(async () => new Promise((r) => { const w = new WebSocket(`ws://${location.host}/api/ws`); w.onopen = () => r('open'); w.onerror = () => r('refused') }))
  expect(res === 'refused', 'anonymous websocket must be refused')
  await anon.close()
})
await check('credentials revoked upstream: session ends gracefully', async () => {
  await post('/__revoke')
  const box = page.locator('#composer-main')
  await box.click()
  await box.fill('post revoke')
  await box.press('Enter')
  await page.getByText(/session ended or Slack revoked access/).waitFor({ timeout: 8000 })
  await page.screenshot({ path: `${SHOTS}/07-expired.png` })
})

await browser.close()
const failed = results.filter((r) => !r[0])
if (errors.length) console.log('\nBrowser errors:\n' + [...new Set(errors)].join('\n'))
console.log(`\n${WEB ? 'web' : 'oauth'} mode: ${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
