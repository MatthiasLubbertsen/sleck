# Sleck

An alternative Slack client for **your own** Slack account. Sign in with Slack, see every conversation you're in, read and send messages, react, thread, search, upload files, all keyboard-first, in a dark, high-contrast Geist-style UI.

- **Frontend:** React + Vite + TypeScript, Tailwind v4, shadcn/ui-style components (Radix), Geist Sans / Geist Mono.
- **Backend:** Node 22 + Hono. Handles OAuth, keeps the Slack token server-side (AES-256-GCM in SQLite), proxies the Slack Web API, receives Events API deliveries and fans them out to the browser over SSE.
- **Single user, workspace-aware:** the data model is keyed by `(team_id, user_id)` everywhere (sessions, prefs, caches, queues), so multi-workspace can be added later.

```
server/    Hono backend
  index.ts       app wiring, CSP/security headers, static files
  config.ts      env parsing, user scopes
  auth.ts        /auth/login /auth/callback /auth/logout, session + CSRF middleware
  api.ts         /api/* routes (allow-listed Slack calls, uploads, file proxy, SSE)
  slack.ts       Slack client: queue, 429/Retry-After handling, TTL cache
  convs.ts       conversation list + unread/mention tracking
  events.ts      /slack/events (signature-verified), hub.ts SSE fan-out
  db.ts crypto.ts signature.ts
web/src/   React app (components/, lib/store.ts is the client state)
shared/    types shared by both
scripts/   mock Slack + e2e + a11y checks
```

## 1. Create the Slack app

1. Edit `SLACK_APP_MANIFEST.yml`: replace `sleck.example.com` with your host (3 places: redirect URL, events URL).
2. <https://api.slack.com/apps> → **Create New App → From a manifest** → pick your workspace → paste the manifest → Create.
3. On **Basic Information** copy the **Client ID**, **Client Secret** and **Signing Secret** into your env (below).
4. **Event Subscriptions**: the request URL is verified when Sleck is reachable at `APP_URL` (it answers Slack's `url_verification`). Until then, saving the manifest may show the URL as unverified; click *Retry* once the app is running.
5. Keep the app **un-distributed** (don't submit it to the Marketplace or enable public distribution). Slack applies much stricter rate limits to *distributed* non-Marketplace apps (e.g. `conversations.history` at 1 request/minute); internal apps for your own workspace are not affected.
6. Open `APP_URL`, click **Sign in with Slack**, approve.

### Scopes (user scopes only, no bot)

The manifest requests everything you listed, plus four additions that Slack requires for features you asked for:

| Added | Why |
|---|---|
| `pins:write` | pinning / unpinning needs it (`pins:read` only lists pins) |
| `groups:write`, `im:write`, `mpim:write` | `conversations.mark` (mark as read) needs the `:write` scope matching the conversation type, not just `channels:write`; `im:write` also starts new DMs from the quick switcher |
| `team:read` | workspace name/icon and the small icon of the other workspace for Slack Connect |

## 2. Environment variables

| Var | Meaning |
|---|---|
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | from the Slack app |
| `SLACK_SIGNING_SECRET` | verifies `/slack/events` requests |
| `APP_URL` | public URL, no trailing slash, e.g. `https://sleck.example.com`. Must match the manifest. `https` ⇒ `Secure` cookies + HSTS |
| `SESSION_SECRET` | ≥ 32 chars, signs the session cookie. `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | 32 bytes (64 hex chars or base64), encrypts tokens at rest. `openssl rand -hex 32` |
| `PORT` (3000), `DATA_DIR` (`./data`) | optional |
| `SLACK_EVENTS` | `auto` (default): poll the open conversation every 5s until a verified Events API delivery arrives; `on`: never poll; `off`: always poll |

Copy `.env.example` to `.env` and fill it in. Losing `ENCRYPTION_KEY` just means everyone must sign in again.

## 3. Local development

```bash
npm install
cp .env.example .env        # APP_URL=http://localhost:5173 for dev, then fill the rest
npm run dev                 # API on :3000, Vite on :5173 (proxies /api and /auth)
```

For local dev set `APP_URL=http://localhost:5173` and add `http://localhost:5173/auth/callback` as an extra redirect URL in the Slack app (Slack allows `http://localhost` redirects). The browser talks only to Vite, which proxies to the API, so cookies stay same-origin.

**Events API locally.** Slack must reach `/slack/events` over public HTTPS, so tunnel the API port:

```bash
cloudflared tunnel --url http://localhost:3000      # or: ngrok http 3000
```

Put `https://<tunnel-host>/slack/events` as the Event Subscriptions request URL (keep `APP_URL` on localhost for the browser). Without events, Sleck simply polls.

## 4. Deploy with Docker (behind Traefik)

```bash
cp .env.example .env     # fill in; set APP_URL and SLECK_HOST
docker compose up -d --build
```

`docker-compose.yml` expects an external Docker network named `traefik`, an entrypoint `websecure` and a cert resolver `letsencrypt`; edit the labels to match your Traefik. The container is non-root, read-only, drops all capabilities, and keeps SQLite in the `sleck-data` volume. **Don't attach Traefik's compression middleware** to this router: it buffers Server-Sent Events.

## 5. Features and keyboard

Sidebar (pinned / channels / private / group DMs / DMs, unread + mention badges, per-conversation pin & mute, "unread only"), message history with infinite scroll, day separators and a "New" divider, mrkdwn / mentions / custom emoji / link unfurls / files / image lightbox, composer with `:emoji:`, `@mention`, `#channel` autocomplete, emoji picker, paste & drag-drop uploads, threads (with "also send to channel"), reactions (with who-reacted tooltips), edit / delete / copy link / mark unread / pin, search with "open in context", real time via Events API → SSE with polling fallback, responsive layout with a drawer on phones. Press `?` in the app for all shortcuts; the main ones: `Ctrl/⌘ K` switcher, `Alt ↑/↓` prev/next conversation (`Alt Shift ↑/↓` for unread), `u` next unread, `i` composer, `/` search, `Shift Esc` mark read, `↑` in an empty composer edits your last message.

Design notes: Geist tokens as CSS variables (`web/src/index.css`). Mono is used for **places and identifiers** (channel names, handles, timestamps, counts, code); people's names are sans, so a `#channel` and a person never look alike. Unread = bold name + count box; mention = inverted `@N` box; selected = bar + fill + `aria-current`; muted = italic + bell-off icon; own messages = left rule + `YOU` tag; pending = dimmed + "sending…"; failed = red rule + alert icon + Retry/Discard text; edited = "(edited)". The tertiary text colour is `#8f8f8f` rather than `#707070`, which measures only 4.2:1 on black (and less on hover fills), below WCAG AA. Slack's tokens are not exposed on Geist's colour page (only variable names), so the scale mirrors the Geist dark values from memory plus your palette.

## 6. Testing

```bash
npm run lint && npm run typecheck && npm test      # unit tests: mrkdwn parser, composer escaping, signature check
npm run build
scripts/test-stack.sh events      # mock Slack on :4010 + the app on :3000 (`polling` = Events API off)
node scripts/e2e.mjs              # Playwright (global install); 31 checks, set MODE=polling for the polling run
node scripts/a11y.mjs             # axe-core WCAG 2 A/AA over the main views
```

`scripts/mock-slack.ts` fakes OAuth, the Web API calls Sleck uses and signed Events API deliveries. It is not Slack; see "Not tested" below.

## 7. Security notes

- **Token never reaches the browser.** It is encrypted with AES-256-GCM (key from env, ciphertext bound to the session row via AAD) and decrypted only per request. The cookie holds an opaque random session id, signed with `SESSION_SECRET`, `HttpOnly`, `Secure` (https), `SameSite=Lax`; the DB stores only its SHA-256. One live session per (team, user); 30-day sliding expiry.
- **OAuth:** random single-use `state`, additionally bound to the browser by a signed `HttpOnly` cookie (login-CSRF protection). Slack's OAuth v2 does not support PKCE, so the state binding is the equivalent check. `/auth/logout` can also call `auth.revoke` ("Sign out and revoke token").
- **CSRF:** every state-changing route requires a same-origin `Origin`/`Referer` **and** a per-session `X-CSRF-Token` header (plus `SameSite=Lax`).
- **Events:** `/slack/events` verifies `X-Slack-Signature` (HMAC-SHA256, timing-safe) and rejects timestamps older than 5 minutes; deliveries are de-duplicated by `event_id`.
- **CSP:** `default-src 'none'`; scripts and styles self-only (styles via per-response nonce); `frame-ancestors 'none'`; `form-action 'self'`; `object-src 'none'`. One deliberate looseness: `img-src … https:` so link-unfurl images (arbitrary hosts) render; they load with `referrerpolicy=no-referrer`. Slack-hosted files go through `/api/file`, an authenticated proxy restricted to Slack file hosts that re-validates every redirect hop, forces non-media types to download, and serves with `nosniff` and a sandboxing CSP. Plus HSTS, `X-Frame-Options`, `Referrer-Policy`.
- **Least data:** only `team_id`, `user_id`, the encrypted token, granted scopes, a CSRF secret and UI prefs (pins/mutes/collapsed sections) are stored. Messages are never persisted; caches (users, emoji, conversations) are in memory. Tokens and cookies are never logged or put in URLs.
- **Input validation:** channel ids, timestamps, emoji names and text length are validated server-side; only an allow-list of Slack methods is reachable.
- Pins, mutes and "unread only" are **Sleck-only** preferences. Slack has no API for sidebar sections or mute state.

## 8. Known limitations

- **Unread counts are derived**, because Slack gives user tokens no unread endpoint: Sleck reads `last_read` (`conversations.info`) and the newest message (`conversations.history`) per conversation in a low-priority background queue, then keeps counts live from Events API messages. With hundreds of conversations the initial fill takes a few minutes (it respects rate limits). In polling mode, badges for *other* conversations refresh only when you open them or reload.
- Closed DMs may still appear (Slack's API doesn't say which DMs are open); the DM list shows the 20 most recently active first.
- Rendering uses the message `text` (mrkdwn); `rich_text`/Block Kit is only rendered as a fallback when `text` is empty, so complex bot layouts are simplified.
- Emoji skin-tone picking, drafts persistence across reloads, huddles/calls, canvases, workflows and multi-workspace switching are not implemented.
- The Events API request URL and `user_events` in the manifest could not be validated against a live Slack workspace from the build environment.
