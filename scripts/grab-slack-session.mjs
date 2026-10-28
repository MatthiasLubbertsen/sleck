#!/usr/bin/env node
// Opens a real browser so you can sign in to Slack normally, then reads the two things Slack's own web
// client uses to talk to the server: the `d` cookie and the workspace's xoxc token. Prints one blob to
// paste into Sleck's "Use a browser session" box. Nothing is sent anywhere by this script.
//
//   scripts/grab-slack-session.sh                 (installs Playwright + Chromium on first run)
//   node scripts/grab-slack-session.mjs --team T0123ABCD    pick a workspace if you are in several
//   --browser chrome|chromium|msedge|firefox-free   which browser to drive (default: your installed Chrome, else bundled Chromium)
//   --executable <path>  use this browser binary (or env SLECK_BROWSER_PATH)
//   --no-clipboard   --headless (tests only)   --start-url / --cookie-url (tests only)

import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('Playwright is not installed. Run scripts/grab-slack-session.sh (it installs it), or: npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}
const flag = (name) => process.argv.includes(name)
const START = arg('--start-url') ?? 'https://app.slack.com/client'
const COOKIE_URL = arg('--cookie-url') ?? 'https://slack.com'
const WANT_TEAM = arg('--team')
const TIMEOUT_MS = 10 * 60_000

const profile = mkdtempSync(join(tmpdir(), 'sleck-grab-'))
const cleanup = () => rmSync(profile, { recursive: true, force: true })
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(130))

const launch = async () => {
  const opts = { headless: flag('--headless'), viewport: { width: 1200, height: 860 }, executablePath: arg('--executable') ?? process.env.SLECK_BROWSER_PATH }
  if (opts.executablePath) return chromium.launchPersistentContext(profile, opts)
  const want = arg('--browser')
  if (want && want !== 'chromium') return chromium.launchPersistentContext(profile, { ...opts, channel: want })
  try {
    // prefer the browser you already have: no download, and it looks like your normal login
    return await chromium.launchPersistentContext(profile, { ...opts, channel: 'chrome' })
  } catch {
    return chromium.launchPersistentContext(profile, opts)
  }
}

console.log('Opening a browser. Sign in to your Slack workspace there; this window will finish by itself.')
const ctx = await launch()
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(START).catch(() => undefined)

const started = Date.now()
let found
while (Date.now() - started < TIMEOUT_MS) {
  await new Promise((r) => setTimeout(r, 1000))
  if (page.isClosed()) {
    console.error('The browser was closed before sign-in finished.')
    process.exit(1)
  }
  const cookies = await ctx.cookies(COOKIE_URL).catch(() => [])
  const d = cookies.find((c) => c.name === 'd')?.value
  if (!d) continue
  const cfg = await page.evaluate(() => localStorage.getItem('localConfig_v2')).catch(() => null)
  if (!cfg) continue
  let teams
  try {
    teams = JSON.parse(cfg).teams ?? {}
  } catch {
    continue
  }
  const fromUrl = page.url().match(/\/client\/([A-Z0-9]+)/)?.[1]
  const id = WANT_TEAM ?? (fromUrl && teams[fromUrl] ? fromUrl : Object.keys(teams).length === 1 ? Object.keys(teams)[0] : undefined)
  const t = id ? teams[id] : undefined
  if (!t?.token?.startsWith('xoxc-')) {
    if (Object.keys(teams).length > 1 && !id) console.log(`You are in several workspaces (${Object.keys(teams).join(', ')}). Open the one you want in the browser, or pass --team <id>.`)
    continue
  }
  const host = t.url ? new URL(t.url).host : t.domain ? `${t.domain}.slack.com` : undefined
  if (!host) continue
  found = { team: id, name: t.name, token: t.token, cookie: d, host }
  break
}
await ctx.close()
if (!found) {
  console.error('Timed out waiting for a signed-in Slack session.')
  process.exit(1)
}

const blob = Buffer.from(JSON.stringify({ v: 1, token: found.token, cookie: found.cookie, host: found.host })).toString('base64url')
let copied = false
if (!flag('--no-clipboard')) {
  const tools = process.platform === 'darwin' ? [['pbcopy']] : process.platform === 'win32' ? [['clip']] : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']]
  for (const [cmd, ...args] of tools) {
    try {
      if (spawnSync(cmd, args, { input: blob }).status === 0) {
        copied = true
        break
      }
    } catch { /* try the next one */ }
  }
}
console.log(`\nSigned in to "${found.name ?? found.team}" (${found.host}).\n`)
console.log('Paste this into Sleck → "Use a browser session":\n')
console.log(blob)
console.log(`\n${copied ? '(Also copied to your clipboard.)\n' : ''}Treat it like a password: it is your live Slack login. The temporary browser profile has been deleted.`)
