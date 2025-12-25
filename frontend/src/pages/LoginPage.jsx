import { useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'

export function LoginPage() {
  const { login } = useAuth()
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const oauthInstallUrl = useMemo(() => '/api/oauth/salla/install', [])

  async function onSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await login(token)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-lg font-semibold text-slate-900">Merchant Login</div>
        <div className="mt-1 text-sm text-slate-600">
          Use your merchant access token. All requests are sent with <span className="font-mono">Authorization: Bearer</span>.
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="text-sm font-medium text-slate-700">Merchant Access Token</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste token here…"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none ring-slate-900/10 focus:ring-4"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="mt-2 text-xs text-slate-500">
              If you’re still installing the app, run OAuth install first then use the stored token for API access.
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="text-sm font-semibold text-slate-900">OAuth Install</div>
          <div className="mt-1 text-sm text-slate-600">
            For first-time installation, start OAuth flow on backend:
          </div>
          <a
            href={oauthInstallUrl}
            className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
          >
            Start OAuth Install
          </a>
        </div>
      </div>
    </div>
  )
}
