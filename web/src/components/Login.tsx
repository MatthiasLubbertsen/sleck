import { useEffect, useState } from 'react'
import { LogIn } from '@/components/icons'
import { api } from '@/lib/api'
import { Button } from './ui/button'
import { Note, Textarea } from './ui/geist'

const ERRORS: Record<string, string> = {
  state_mismatch: 'The sign-in could not be verified (state mismatch). Start again from this page.',
  access_denied: 'You cancelled the Slack authorization.',
  missing_code: 'Slack did not return an authorization code.',
  no_user_token: 'Slack did not return a user token. Check that the app requests user scopes.',
  invalid_code: 'The authorization code was rejected or already used.',
  bad_client_secret: 'The Slack client secret is wrong.',
  invalid_client_id: 'The Slack client ID is wrong.',
  redirect_uri_mismatch: 'The redirect URL does not match the one configured in the Slack app.',
  not_allowed: 'This Slack account is not on this deployment’s allow-list.',
  oauth_disabled: 'OAuth is not configured on this server. Use a browser session instead.',
  invalid_blob: 'That does not look like a session blob from the grab script.',
  invalid_auth: 'Slack rejected those credentials. Grab a fresh session (the cookie may have expired).',
  token_revoked: 'That session was signed out in Slack. Grab a fresh one.',
}

export function Login({ reason, error }: { reason?: 'expired' | 'error'; error?: string }) {
  const [modes, setModes] = useState<{ oauth: boolean; web: boolean } | null>(null)
  const [blob, setBlob] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(error)

  useEffect(() => void api.authModes().then(setModes).catch(() => setModes({ oauth: true, web: true })), [])

  const submit = async () => {
    setBusy(true)
    setErr(undefined)
    const r = await api.importSession(blob.trim())
    if (r.ok) location.href = '/'
    else {
      setErr(r.error ?? 'import_failed')
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <svg viewBox="0 0 32 32" className="size-8" aria-hidden><rect width="32" height="32" fill="#000" stroke="#333" /><path d="M9 21l7-14 7 14z" fill="none" stroke="#ededed" strokeWidth="2.5" /></svg>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">sleck</h1>
        </div>
        <p className="mb-6 text-ink-2">A keyboard-first client for your own Slack account.</p>
        <div className="mb-4 space-y-2">
          {reason === 'expired' && <Note tone="amber">Your session ended or Slack revoked access. Sign in again to continue.</Note>}
          {reason === 'error' && <Note tone="red">The server could not be reached. Try again in a moment.</Note>}
          {err && <Note tone="red">{ERRORS[err] ?? `Sign-in failed: ${err.replace(/_/g, ' ')}`}</Note>}
        </div>

        {(modes?.oauth ?? true) && (
          <Button variant="default" size="lg" className="w-full" onClick={() => (location.href = '/auth/login')}>
            <LogIn className="size-4" aria-hidden />Sign in with Slack
          </Button>
        )}

        <details className="mt-6 rounded-md border border-line-strong" open={modes ? !modes.oauth : false}>
          <summary className="focus-inset cursor-pointer select-none rounded-md px-3 py-2.5 text-[14px] font-medium">Use a browser session (realtime socket)</summary>
          <div className="space-y-3 border-t border-line p-3">
            <p className="text-[13px] leading-5 text-ink-2">
              On <b>your own computer</b> (Node 22+), run this. It opens a browser, you sign in to Slack, and it prints a blob. Paste it below.
            </p>
            <pre className="select-all overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line-strong bg-[var(--ds-gray-alpha-100)] p-2 font-mono text-[11.5px] leading-5">{`curl -fsSL ${location.origin}/grab-slack-session.mjs -o grab.mjs && node grab.mjs`}</pre>
            <Textarea rows={4} value={blob} onChange={(e) => setBlob(e.target.value)} placeholder="Paste the session blob (or JSON)" aria-label="Session blob" className="font-mono text-[12px]" spellCheck={false} autoComplete="off" />
            <Button variant="secondary" className="w-full" loading={busy} disabled={!blob.trim() || busy} onClick={() => void submit()}>Sign in with this session</Button>
          </div>
        </details>

        <p className="mt-6 text-xs leading-relaxed text-ink-3">
          Sleck acts as you. Your Slack credentials stay on the server, encrypted, and are never sent to the browser.
        </p>
      </div>
    </main>
  )
}
