// End-to-end check against scripts/mock-slack.ts.
// Start the stack first:  npm run build && scripts/test-stack.sh events && node scripts/e2e.mjs
// Playwright is not a project dependency; it is resolved from the global install.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const { chromium } = createRequire(import.meta.url)('playwright')

const APP = process.env.APP_URL ?? 'http://localhost:3000'
const MOCK = process.env.MOCK_URL ?? 'http://localhost:4010'
const SHOTS = process.env.SHOTS ?? '/tmp/sleck-shots'
const POLLING = process.env.MODE === 'polling'
mkdirSync(SHOTS, { recursive: true })

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

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()))
const api = (path, init) => page.evaluate(async ([p, i]) => (await fetch('/api' + p, i)).json(), [path, init])
const nav = page.getByRole('navigation', { name: 'Conversations' })

await check('login screen shows without a session', async () => {
  await page.goto(APP)
  await page.getByRole('button', { name: 'Sign in with Slack' }).waitFor()
  await page.screenshot({ path: `${SHOTS}/01-login.png` })
})
await check('OAuth round trip lands in the app', async () => {
  await page.getByRole('button', { name: 'Sign in with Slack' }).click()
  await nav.waitFor({ timeout: 10000 })
})
await check('session cookie is httpOnly; token not reachable from JS or DOM', async () => {
  const s = (await ctx.cookies()).find((c) => c.name.startsWith('sleck_session'))
  expect(s?.httpOnly, 'cookie not httpOnly')
  const html = await page.content()
  expect(!html.includes('xoxp-'), 'token in DOM')
  const leaked = await page.evaluate(() => JSON.stringify(localStorage) + document.cookie)
  expect(!leaked.includes('xoxp-') && !leaked.includes('sleck_session'), 'token/cookie reachable from JS')
})
await check('sidebar lists every conversation type', async () => {
  for (const n of [/Public channel general/, /Private channel secret-plans/, /Direct message Alice Wonder/, /Group message Alice Wonder, Bob Builder/]) {
    await nav.getByRole('button', { name: n }).first().waitFor({ timeout: 8000 })
  }
})
await check('unread + mention indicators appear (background hydration)', async () => {
  await nav.getByRole('button', { name: /Direct message Alice Wonder @2 mentions, 2 unread/ }).waitFor({ timeout: 20000 })
  await nav.getByRole('button', { name: /Public channel random 1 unread/ }).waitFor({ timeout: 20000 })
})
await check('#general: day separators + mrkdwn rendering', async () => {
  await page.getByRole('heading', { name: 'general' }).waitFor()
  await page.getByText('Thread starter').waitFor()
  expect((await page.locator('strong', { hasText: 'bold' }).count()) > 0, 'bold not rendered')
  expect((await page.locator('code', { hasText: 'code' }).count()) > 0, 'inline code not rendered')
  expect((await page.locator('pre', { hasText: 'const x = 1' }).count()) === 1, 'code block not rendered')
  expect((await page.locator('blockquote', { hasText: 'quoted line' }).count()) === 1, 'quote not rendered')
  expect((await page.locator('a[href="https://example.com"]').count()) === 1, 'link not rendered')
  expect((await page.getByText('@matthias').count()) > 0, 'mention not rendered')
  expect((await page.getByRole('separator').count()) >= 2, 'no day separators')
  await page.screenshot({ path: `${SHOTS}/02-general.png` })
})
await check('custom + unicode emoji render', async () => {
  expect((await page.locator('img.emoji-img').count()) > 0, 'custom emoji img missing')
  expect((await page.locator('[role=img][title=":tada:"]').count()) > 0, 'unicode :tada: not rendered')
})
await check('unread divider shown at first unread message', async () => {
  await page.locator('[data-new-divider]').waitFor({ timeout: 5000 })
})
await check('infinite scroll loads older history', async () => {
  const sc = page.getByTestId('message-scroller')
  const before = await page.locator('[data-msg]').count()
  for (let i = 0; i < 4; i++) {
    await sc.evaluate((e) => (e.scrollTop = 0))
    await page.waitForTimeout(600)
  }
  const after = await page.locator('[data-msg]').count()
  expect(after > before, `no more messages loaded (${before} -> ${after})`)
})
await check('send with Enter: pending -> delivered, stored once', async () => {
  const box = page.locator('#composer-main')
  await box.click()
  await box.fill('hello from e2e *bold* :wave:')
  await box.press('Enter')
  await page.locator('article[aria-label^="Your message"]', { hasText: 'hello from e2e' }).waitFor()
  await page.waitForTimeout(1000)
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
await check(POLLING ? 'polling: incoming message appears within ~5s' : 'real-time: Events API -> SSE shows incoming message', async () => {
  await post('/__inject', { channel: 'C0000001', text: 'realtime ping from alice' })
  await page.getByTestId('message-scroller').getByText('realtime ping from alice').waitFor({ timeout: 9000 })
  await nav.getByText(POLLING ? 'polling every 5s' : 'live · Events API').waitFor({ timeout: 6000 })
})
if (!POLLING) {
  await check('real-time: unread badge increments in another channel', async () => {
    await post('/__inject', { channel: 'C0000002', text: 'second random msg' })
    await nav.getByRole('button', { name: /Public channel random 2 unread/ }).waitFor({ timeout: 6000 })
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
  const h = await api('/history?channel=C0000001&limit=4')
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
  let h = await api('/history?channel=C0000001&limit=15')
  let starter = h.messages.find((m) => m.text.startsWith('Thread starter'))
  expect(starter.reactions.find((r) => r.name === '+1').users.length === 1, 'server still has my +1')
  await group.getByRole('button').first().click()
  await page.waitForTimeout(900)
  h = await api('/history?channel=C0000001&limit=15')
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
  const h = await api('/history?channel=C0000001&limit=15')
  expect(h.messages.find((m) => m.text === 'realtime ping from alice').reactions.some((r) => r.name === 'rocket'), 'server missing rocket')
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
  await panel.getByLabel(/Also send to/).check()
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
  let h = await api('/history?channel=C0000001&limit=20')
  expect(h.messages.some((m) => m.text === 'hello from e2e (edited)'), 'edit not stored')
  await msg.hover()
  await msg.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: /Delete message/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await page.waitForTimeout(800)
  h = await api('/history?channel=C0000001&limit=20')
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
await check('search: highlighted results, opens in context', async () => {
  await page.keyboard.press('/')
  await page.getByRole('textbox', { name: 'Search messages' }).fill('seed message 7')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /seed message 7 from/ }).first().waitFor()
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
  const h = await api('/history?channel=C0000001&limit=8')
  expect(h.messages.filter((m) => m.text === 'after rate limit').length === 1, 'message not delivered exactly once')
})
await check('phone layout: sidebar is a drawer, no horizontal scroll', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 800 }, storageState: await ctx.storageState() })
  const p = await m.newPage()
  await p.goto(APP + '/#/C0000001')
  await p.getByRole('heading', { name: 'general' }).waitFor()
  expect(((await p.getByRole('navigation', { name: 'Conversations' }).boundingBox())?.x ?? 0) < 0, 'drawer should be off-canvas on phones')
  await p.getByRole('button', { name: 'Open conversations' }).click()
  await p.waitForTimeout(400)
  expect(((await p.getByRole('navigation', { name: 'Conversations' }).boundingBox())?.x ?? -999) >= 0, 'drawer did not open')
  await p.screenshot({ path: `${SHOTS}/06-mobile-drawer.png` })
  await p.keyboard.press('Escape')
  await p.screenshot({ path: `${SHOTS}/06b-mobile.png` })
  expect(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'horizontal page scroll on mobile')
  await m.close()
})
await check('CSRF: POST without token is rejected (403)', async () => {
  const r = await page.evaluate(async () => (await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'C0000001', text: 'x' }) })).status)
  expect(r === 403, 'expected 403, got ' + r)
})
await check('token revoked upstream: session ends gracefully', async () => {
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
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
