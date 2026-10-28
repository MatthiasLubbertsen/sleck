import { LogIn } from 'lucide-react'
import { Button } from './ui/button'

const ERRORS: Record<string, string> = {
  state_mismatch: 'The sign-in could not be verified (state mismatch). Start again from this page.',
  access_denied: 'You cancelled the Slack authorization.',
  missing_code: 'Slack did not return an authorization code.',
  no_user_token: 'Slack did not return a user token. Check that the app requests user scopes.',
  invalid_code: 'The authorization code was rejected or already used.',
  bad_client_secret: 'The Slack client secret is wrong.',
  invalid_client_id: 'The Slack client ID is wrong.',
  redirect_uri_mismatch: 'The redirect URL does not match the one configured in the Slack app.',
}

export function Login({ reason, error }: { reason?: 'expired' | 'error'; error?: string }) {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <svg viewBox="0 0 32 32" className="size-8" aria-hidden><rect width="32" height="32" fill="#000" stroke="#333" /><path d="M9 21l7-14 7 14z" fill="none" stroke="#ededed" strokeWidth="2.5" /></svg>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">sleck</h1>
        </div>
        <p className="mb-6 text-ink-2">A keyboard-first client for your own Slack account.</p>
        {reason === 'expired' && <p role="alert" className="mb-4 rounded-md border border-warn/60 px-3 py-2 text-sm text-warn">Your session ended or Slack revoked access. Sign in again to continue.</p>}
        {reason === 'error' && <p role="alert" className="mb-4 rounded-md border border-danger-fill px-3 py-2 text-sm text-danger">The server could not be reached. Try again in a moment.</p>}
        {error && <p role="alert" className="mb-4 rounded-md border border-danger-fill px-3 py-2 text-sm text-danger">{ERRORS[error] ?? `Sign-in failed: ${error.replace(/_/g, ' ')}`}</p>}
        <Button variant="default" size="lg" className="w-full" onClick={() => (location.href = '/auth/login')}>
          <LogIn className="size-4" aria-hidden />Sign in with Slack
        </Button>
        <p className="mt-6 text-xs leading-relaxed text-ink-3">
          Sleck acts as you, with the permissions you approve in Slack. Your token stays on the server and is never sent to the browser.
        </p>
      </div>
    </main>
  )
}
