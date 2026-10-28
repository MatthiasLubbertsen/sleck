import { Hono, type Context } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { secureHeaders, NONCE } from 'hono/secure-headers'
import { readFileSync, existsSync } from 'node:fs'
import { config } from './config'
import { auth } from './auth'
import { api } from './api'
import { events } from './events'
import { purgeExpired } from './db'

const app = new Hono()

// Strict CSP. Images from https: are needed for unfurl previews (their hosts are arbitrary);
// avatars/emoji/files are Slack-hosted or proxied. Everything else is same-origin only.
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", NONCE],
    styleSrcAttr: ["'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    mediaSrc: ["'self'"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    manifestSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    ...(config.secure ? { upgradeInsecureRequests: [] } : {}),
  },
  strictTransportSecurity: config.secure ? 'max-age=63072000; includeSubDomains' : false,
  referrerPolicy: 'same-origin',
  xFrameOptions: 'DENY',
  crossOriginOpenerPolicy: 'same-origin',
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
}))

app.get('/healthz', (c) => c.text('ok'))
app.route('/auth', auth)
app.route('/slack', events)
app.route('/api', api)

const webRoot = existsSync('dist/web') ? 'dist/web' : null
if (webRoot) {
  const index = readFileSync(`${webRoot}/index.html`, 'utf8')
  app.use('/assets/*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
  })
  const page = (c: Context) => {
    c.header('Cache-Control', 'no-store') // the nonce is per response
    return c.html(index.replace('__CSP_NONCE__', c.get('secureHeadersNonce') ?? ''))
  }
  app.get('/', page)
  app.get('/index.html', page)
  app.use('*', serveStatic({ root: webRoot }))
  app.get('*', page) // SPA fallback
} else {
  app.get('/', (c) => c.text('Web bundle not built. Use `npm run dev` (Vite on :5173) or `npm run build`.'))
}

setInterval(purgeExpired, 3600_000).unref()
serve({ fetch: app.fetch, port: config.port }, (i) => console.log(`sleck listening on :${i.port} (${config.appUrl})`))
