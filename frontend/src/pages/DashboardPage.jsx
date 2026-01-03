import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { requestJson, HttpError } from '../lib/http.js'
import { useToasts } from '../components/useToasts.js'
import { Badge } from '../components/ui/Badge.jsx'
import { Loading } from '../components/ui/Loading.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-sm font-medium text-slate-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  )
}

function statusTone(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'active') return 'green'
  if (s === 'paused') return 'amber'
  if (s === 'draft') return 'slate'
  return 'slate'
}

function statusLabel(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'active') return 'ACTIVE'
  if (s === 'paused') return 'PAUSED'
  if (s === 'draft') return 'DRAFT'
  return '—'
}

function kindLabel(kind) {
  const k = String(kind || '').trim()
  if (k === 'quantity_discount') return 'خصم كميات'
  if (k === 'products_discount') return 'خصم منتجات'
  if (k === 'products_no_discount') return 'منتجات بدون خصم'
  if (k === 'post_add_upsell') return 'Upsell بعد الإضافة'
  if (k === 'popup') return 'Popup ذكي'
  if (k === 'also_bought') return 'منتجات اشترها عملاؤنا ايضا'
  return '—'
}

function formatDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export function DashboardPage() {
  const { token, logout } = useAuth()
  const toasts = useToasts()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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

  const sortedBundles = useMemo(() => {
    const arr = [...(Array.isArray(bundles) ? bundles : [])]
    arr.sort((a, b) => new Date(b?.updatedAt || 0).getTime() - new Date(a?.updatedAt || 0).getTime())
    return arr
  }, [bundles])

  const newBundles = useMemo(() => {
    return sortedBundles.filter((b) => {
      const k = String(b?.kind || '').trim()
      return k === 'popup' || k === 'also_bought'
    })
  }, [sortedBundles])

  const bundlesTab = String(searchParams.get('tab') || '').trim() === 'all' ? 'all' : 'new'
  const visibleBundles = bundlesTab === 'all' ? sortedBundles : newBundles

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

      {!loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Bundles</div>
              <div className="mt-1 text-xs text-slate-600">
                {bundlesTab === 'all' ? 'كل الباندلز (آخر تحديث أولاً).' : 'popup و also_bought (آخر تحديث أولاً).'}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={() => navigate('/bundles')}
              >
                فتح صفحة الباندلز
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {visibleBundles.slice(0, 20).map((b) => (
                  <tr key={b._id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{b.name || '—'}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{b._id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-900">{kindLabel(b.kind)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(b.status)}>{statusLabel(b.status)}</Badge>
                    </td>
                    <td className="px-4 py-3">{formatDate(b.updatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                        onClick={() => navigate(`/bundles/${encodeURIComponent(b._id)}/edit`)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {!visibleBundles.length ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-slate-600" colSpan={5}>
                      مفيش باندلز في التاب ده.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
