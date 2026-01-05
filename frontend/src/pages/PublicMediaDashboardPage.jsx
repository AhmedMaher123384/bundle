import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loading } from '../components/ui/Loading.jsx'
import { requestJson } from '../lib/http.js'

function formatDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function StatPill({ label, value, tone = 'slate' }) {
  const classes =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-600/20'
      : tone === 'sky'
        ? 'bg-sky-50 text-sky-800 ring-sky-600/20'
        : tone === 'violet'
          ? 'bg-violet-50 text-violet-800 ring-violet-600/20'
          : 'bg-slate-50 text-slate-800 ring-slate-600/20'

  return (
    <div className={['inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1', classes].join(' ')}>
      <span className="text-slate-600">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}

function clamp01(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function ratio(a, b) {
  const x = Number(a)
  const y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y) || y <= 0) return 0
  return clamp01(x / y)
}

function timeTone(iso) {
  if (!iso) return 'slate'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'slate'
  const diff = Date.now() - t
  if (diff <= 6 * 60 * 60 * 1000) return 'emerald'
  if (diff <= 24 * 60 * 60 * 1000) return 'sky'
  return 'slate'
}

function initialsFromName(name) {
  const s = String(name || '').trim()
  if (!s) return '—'
  const parts = s.split(/\s+/g).filter(Boolean)
  const first = parts[0]?.[0] || ''
  const second = parts.length > 1 ? parts[1]?.[0] || '' : parts[0]?.[1] || ''
  const out = `${first}${second}`.trim().toUpperCase()
  return out || '—'
}

function StoreLogo({ name, logoUrl, tone }) {
  const src = String(logoUrl || '').trim()
  return (
    <div
      className={[
        'relative grid h-12 w-12 place-items-center overflow-hidden rounded-2xl ring-1',
        tone === 'emerald' ? 'bg-emerald-50 ring-emerald-600/15' : tone === 'sky' ? 'bg-sky-50 ring-sky-600/15' : 'bg-slate-100 ring-slate-900/10',
      ].join(' ')}
    >
      {src ? (
        <img className="h-full w-full object-cover" alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" src={src} />
      ) : (
        <div className="text-sm font-extrabold tracking-wide text-slate-700">{initialsFromName(name)}</div>
      )}
      <div
        className={[
          'absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white',
          tone === 'emerald' ? 'bg-emerald-500' : tone === 'sky' ? 'bg-sky-500' : 'bg-slate-300',
        ].join(' ')}
      />
    </div>
  )
}

function StoreCard({ store }) {
  const storeId = String(store?.storeId || '')
  const total = Number(store?.total || 0)
  const images = Number(store?.images || 0)
  const videos = Number(store?.videos || 0)
  const raws = Number(store?.raws || 0)
  const storeName = String(store?.store?.name || '').trim() || storeId || '—'
  const storeDomain = String(store?.store?.domain || '').trim()
  const storeUrl = String(store?.store?.url || '').trim()
  const storeLogoUrl = String(store?.store?.logoUrl || '').trim()
  const freshness = timeTone(store?.lastAt)
  const pImages = ratio(images, total)
  const pVideos = ratio(videos, total)
  const pRaws = ratio(raws, total)

  return (
    <Link
      to={`/public-media/${encodeURIComponent(storeId)}`}
      className="group block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-slate-900/10"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <StoreLogo name={storeName} logoUrl={storeLogoUrl} tone={freshness} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{storeName}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <div className="truncate font-mono text-[11px] font-semibold text-slate-500">{storeId || '—'}</div>
              {storeDomain ? <div className="text-[11px] font-semibold text-slate-600">{storeDomain}</div> : null}
              {!storeDomain && storeUrl ? <div className="truncate text-[11px] font-semibold text-slate-600">{storeUrl}</div> : null}
            </div>
            <div className="mt-2 text-xs text-slate-600">آخر رفع: {formatDate(store?.lastAt)}</div>
          </div>
        </div>

        <div className="shrink-0 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
          {total.toLocaleString()}
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-full bg-slate-100">
        <div className="flex h-2 w-full">
          <div className="bg-emerald-500/80" style={{ width: `${(pImages * 100).toFixed(2)}%` }} />
          <div className="bg-sky-500/80" style={{ width: `${(pVideos * 100).toFixed(2)}%` }} />
          <div className="bg-violet-500/80" style={{ width: `${(pRaws * 100).toFixed(2)}%` }} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatPill tone="emerald" label="صور" value={images.toLocaleString()} />
        <StatPill tone="sky" label="فيديو" value={videos.toLocaleString()} />
        <StatPill tone="violet" label="ملفات" value={raws.toLocaleString()} />
      </div>
    </Link>
  )
}

export function PublicMediaDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const qParam = String(searchParams.get('q') || '')
  const pageParam = Math.max(1, Number(searchParams.get('page') || 1) || 1)

  const [q, setQ] = useState(qParam)
  const [page, setPage] = useState(pageParam)
  const [limit, setLimit] = useState(24)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ total: 0, stores: [] })
  const [error, setError] = useState('')

  useEffect(() => {
    setQ(qParam)
  }, [qParam])

  useEffect(() => {
    setPage(pageParam)
  }, [pageParam])

  useEffect(() => {
    const t = globalThis.setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        const nq = String(q || '').trim()
        if (nq) next.set('q', nq)
        else next.delete('q')
        next.set('page', String(page))
        return next
      })
    }, 150)
    return () => globalThis.clearTimeout(t)
  }, [page, q, setSearchParams])

  useEffect(() => {
    const controller = new AbortController()
    async function run() {
      setLoading(true)
      setError('')
      try {
        const res = await requestJson('/api/public/media/stores', { query: { q, page, limit }, signal: controller.signal })
        setData({ total: Number(res?.total || 0) || 0, stores: Array.isArray(res?.stores) ? res.stores : [] })
      } catch (e) {
        if (e?.code === 'REQUEST_ABORTED') return
        setError(String(e?.message || 'Failed to load stores.'))
        setData({ total: 0, stores: [] })
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    run()
    return () => controller.abort()
  }, [limit, page, q])

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(data.total || 0) || 0) / limit)), [data.total, limit])
  const stores = Array.isArray(data.stores) ? data.stores : []

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-lg font-semibold text-slate-900">Media Dashboard</div>
            <div className="mt-1 text-sm text-slate-600">تقسيم الميديا حسب المتجر</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="ابحث بـ Store ID…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none ring-slate-900/10 focus:ring-4 sm:w-80"
              spellCheck={false}
            />
            <select
              value={String(limit)}
              onChange={(e) => {
                setLimit(Number(e.target.value))
                setPage(1)
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none ring-slate-900/10 focus:ring-4"
            >
              <option value="12">12</option>
              <option value="24">24</option>
              <option value="36">36</option>
              <option value="60">60</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">
            Stores: {Number(data.total || 0).toLocaleString()} • Page {page} / {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-4">
          {loading ? <Loading label="Loading stores…" /> : null}
          {!loading && error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">{error}</div>
          ) : null}

          {!loading && !error ? (
            stores.length ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {stores.map((s) => (
                  <StoreCard key={String(s?.storeId)} store={s} />
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-700">
                مفيش بيانات.
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
