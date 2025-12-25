import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { requestJson, HttpError } from '../lib/http.js'
import { useToasts } from '../components/useToasts.js'
import { Badge } from '../components/ui/Badge.jsx'
import { Loading } from '../components/ui/Loading.jsx'

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-sm font-medium text-slate-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  )
}

export function DashboardPage() {
  const { token, logout } = useAuth()
  const toasts = useToasts()
  const [loading, setLoading] = useState(true)
  const [bundles, setBundles] = useState([])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const res = await requestJson('/api/bundles', { token })
        if (!cancelled) setBundles(res?.bundles || [])
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
        toasts.error('Failed to load bundles overview.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [logout, toasts, token])

  const stats = useMemo(() => {
    const byStatus = { active: 0, paused: 0, draft: 0 }
    for (const b of bundles) {
      const s = String(b?.status || '').toLowerCase()
      if (byStatus[s] != null) byStatus[s] += 1
    }
    return {
      total: bundles.length,
      ...byStatus,
    }
  }, [bundles])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-900">Overview</div>
          <div className="mt-1 text-sm text-slate-600">
            Uses only live Salla data for any pricing/stock decisions.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="sky">Live</Badge>
          <Badge tone="slate">Bearer Auth</Badge>
        </div>
      </div>

      {loading ? <Loading label="Loading dashboard…" /> : null}

      {!loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Bundles" value={stats.total} />
          <StatCard label="Active" value={stats.active} />
          <StatCard label="Paused" value={stats.paused} />
          <StatCard label="Draft" value={stats.draft} />
        </div>
      ) : null}

      {!loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-sm font-semibold text-slate-900">Pro Insights (lightweight)</div>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-600">Most used status</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">
                {stats.active >= stats.paused && stats.active >= stats.draft ? 'Active' : stats.paused >= stats.draft ? 'Paused' : 'Draft'}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-600">Tip</div>
              <div className="mt-1 text-sm text-slate-800">Validate variants before activating to avoid checkout issues.</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-600">Rate limits</div>
              <div className="mt-1 text-sm text-slate-800">Handles 429 gracefully with clear toasts.</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
