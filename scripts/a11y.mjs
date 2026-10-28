// Automated accessibility pass with axe-core (WCAG 2.x A/AA rules) over the main views.
// Requires the test stack: scripts/test-stack.sh events
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const APP = process.env.APP_URL ?? 'http://localhost:3000'
const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined })
const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, bypassCSP: true })).newPage()
await page.goto(APP)
let total = 0
const run = async (name) => {
  await page.evaluate(axeSource)
  const r = await page.evaluate(() => globalThis.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }))
  console.log(`\n[${name}] ${r.violations.length} violation(s), ${r.passes.length} rules passed`)
  for (const v of r.violations) {
    total += v.nodes.length
    console.log(` - ${v.id} (${v.impact}): ${v.help}`)
    for (const n of v.nodes.slice(0, 3)) console.log('     ', n.target.join(' '), '|', (n.any[0]?.message ?? n.failureSummary ?? '').split('\n')[0].slice(0, 140))
  }
}
await run('login')
await page.getByRole('button', { name: 'Sign in with Slack' }).click()
await page.getByRole('navigation', { name: 'Conversations' }).waitFor()
await page.getByText('Thread starter').waitFor()
await page.waitForTimeout(1500)
await run('channel view')
await page.locator('article', { hasText: 'Thread starter' }).getByRole('button', { name: /replies/ }).click()
await page.getByText('reply one').waitFor()
await run('thread panel')
await page.keyboard.press('Control+k')
await page.getByRole('dialog').waitFor()
await run('quick switcher')
await page.keyboard.press('Escape')
await page.locator('#composer-main').click()
await page.getByRole('main').getByRole('button', { name: 'Insert emoji' }).click()
await page.getByRole('textbox', { name: 'Search emoji' }).waitFor()
await run('emoji picker')
await page.keyboard.press('Escape')
await page.locator('body').click({ position: { x: 600, y: 400 } })
await page.keyboard.press('?')
await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor()
await run('shortcut sheet')
await browser.close()
console.log(`\n${total} total violating node(s)`)
process.exit(total ? 1 : 0)
