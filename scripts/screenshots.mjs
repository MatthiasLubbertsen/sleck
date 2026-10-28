// Captures the README screenshots from the running test stack (scripts/test-stack.sh web).
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const { chromium } = createRequire(import.meta.url)('playwright')

const APP = process.env.APP_URL ?? 'http://localhost:3000'
const OUT = process.env.OUT ?? 'docs/screenshots'
mkdirSync(OUT, { recursive: true })
const blob = Buffer.from(JSON.stringify({ token: 'xoxc-1234567890-mock-web-token-abcdef', cookie: 'xoxd-mockcookievalue0123456789abcdef%2Bxyz', host: 'mock.slack.com' })).toString('base64url')
const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts })
  console.log('  shot', name)
}

const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined })

// ---------- desktop ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.goto(APP)
await page.getByText('Use a browser session').click()
await shot(page, '01-login-desktop')
await page.getByLabel('Session blob').fill(blob)
await page.getByRole('button', { name: 'Sign in with this session' }).click()
const nav = page.getByRole('navigation', { name: 'Conversations' })
await nav.waitFor({ timeout: 10000 })
await page.getByText('Thread starter').waitFor()
await page.waitForTimeout(1500)
await shot(page, '02-channel-desktop')

await page.locator('article', { hasText: 'Thread starter' }).getByRole('button', { name: /replies/ }).click()
await page.getByText('reply one').waitFor()
await shot(page, '03-thread-desktop')
await page.keyboard.press('Escape')

const msg = page.locator('article', { hasText: 'last seeded message' })
await msg.hover()
await msg.getByRole('button', { name: 'More actions' }).click()
await shot(page, '04-message-actions-desktop')
await page.keyboard.press('Escape')

await page.locator('#composer-main').click()
await page.getByRole('main').getByRole('button', { name: 'Insert emoji' }).click()
await page.getByRole('textbox', { name: 'Search emoji' }).fill('par')
await shot(page, '05-emoji-picker-desktop')
await page.keyboard.press('Escape')

await page.locator('#composer-main').click()
await page.locator('#composer-main').type('hey @ali')
await page.getByRole('option', { name: /Alice/ }).waitFor()
await shot(page, '06-mention-autocomplete-desktop')
await page.locator('#composer-main').fill('')

await page.keyboard.press('Control+k')
await page.getByRole('dialog').getByPlaceholder(/Jump to/).fill('a')
await shot(page, '07-quick-switcher-desktop')
await page.keyboard.press('Escape')

await page.getByRole('button', { name: /Profile and account/ }).first().click()
await shot(page, '08-profile-menu-desktop')
await page.keyboard.press('Escape')

await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /^Direct messages/ }).click()
await shot(page, '09-dms-view-desktop')
await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: /Activity/ }).click()
await shot(page, '10-activity-view-desktop')
await page.getByRole('button', { name: 'Home', exact: true }).click()

await page.keyboard.press('/')
await page.getByRole('textbox', { name: 'Search messages' }).fill('seed message 7')
await page.keyboard.press('Enter')
await page.getByRole('button', { name: /seed message 7 from/ }).first().waitFor()
await shot(page, '11-search-desktop')
await page.keyboard.press('Escape')

await page.locator('body').click({ position: { x: 800, y: 300 } })
await page.keyboard.press('?')
await shot(page, '12-shortcuts-desktop')
await page.keyboard.press('Escape')

// ---------- tablet ----------
const tab = await browser.newContext({ viewport: { width: 820, height: 1100 }, storageState: await ctx.storageState() })
const tp = await tab.newPage()
await tp.goto(`${APP}/#/C0000001`)
await tp.getByRole('heading', { name: 'general' }).waitFor()
await tp.waitForTimeout(1200)
await shot(tp, '13-channel-tablet')
await tab.close()

// ---------- phone (touch) ----------
const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() })
const mp = await ph.newPage()
await mp.goto(`${APP}/#/C0000001`)
await mp.getByRole('heading', { name: 'general' }).waitFor()
await mp.waitForTimeout(1200)
await shot(mp, '14-channel-phone')
await mp.getByRole('button', { name: 'Open conversations' }).tap()
await mp.waitForTimeout(300)
await shot(mp, '15-drawer-phone')
await mp.getByRole('tab', { name: /Activity/ }).tap()
await shot(mp, '16-drawer-activity-phone')
await mp.getByRole('tab', { name: 'Home' }).tap()
await mp.getByRole('button', { name: /Public channel general/ }).tap()
await mp.waitForTimeout(500)
await mp.locator('article', { hasText: 'Thread starter' }).getByRole('button', { name: /replies/ }).tap()
await mp.getByText('reply one').waitFor()
await shot(mp, '17-thread-phone')
await mp.getByRole('button', { name: 'Back to conversation' }).tap()
await mp.locator('article', { hasText: 'last seeded' }).getByText('last seeded message').tap()
await shot(mp, '18a-message-tapped-phone')
await mp.locator('article', { hasText: 'last seeded' }).getByRole('button', { name: 'More actions' }).tap()
await shot(mp, '18-message-actions-phone')
await mp.keyboard.press('Escape')
await mp.getByRole('button', { name: 'Search' }).tap()
await mp.getByRole('textbox', { name: 'Search messages' }).fill('seed message 7')
await mp.keyboard.press('Enter')
await mp.getByRole('button', { name: /seed message 7 from/ }).first().waitFor()
await shot(mp, '19-search-phone')
await ph.close()

// ---------- phone login ----------
const lp = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const lpp = await lp.newPage()
await lpp.goto(APP)
await lpp.getByText('Use a browser session').click()
await shot(lpp, '20-login-phone')

await browser.close()
