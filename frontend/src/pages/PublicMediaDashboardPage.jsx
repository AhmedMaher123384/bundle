import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loading } from '../components/ui/Loading.jsx'
import { requestJson } from '../lib/http.js'

function formatDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ar-EG', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function StatPill({ label, value, tone = 'slate' }) {
  const classes =
    tone === 'emerald'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : tone === 'sky'
        ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
        : tone === 'violet'
          ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
          : 'bg-white/5 text-white/70 border-white/10'

  return (
    <div className={['inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold', classes].join(' ')}>
      <span className="opacity-80">{label}</span>
      <span className="font-mono text-sm">{value}</span>
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
  const bgColor = tone === 'emerald' 
    ? 'bg-emerald-500/20' 
    : tone === 'sky' 
      ? 'bg-sky-500/20' 
      : 'bg-white/10'
  
  const dotColor = tone === 'emerald'
    ? 'bg-emerald-400'
    : tone === 'sky'
      ? 'bg-sky-400'
      : 'bg-white/30'

  return (
    <div className="relative">
      <div className={['relative grid h-16 w-16 place-items-center overflow-hidden rounded-xl border border-white/10', bgColor].join(' ')}>
        {src ? (
          <img 
            className="h-full w-full object-cover" 
            alt="" 
            loading="lazy" 
            decoding="async" 
            referrerPolicy="no-referrer" 
            src={src} 
          />
        ) : (
          <div className="text-lg font-bold tracking-wide text-white">{initialsFromName(name)}</div>
        )}
      </div>
      <div className={['absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full border-2 border-[#292929]', dotColor].join(' ')} />
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
      className="group block rounded-xl border border-white/10 bg-[#1a1a1a] p-5 hover:border-[#18b5d5]/50 hover:bg-[#1f1f1f] focus:outline-none focus:ring-2 focus:ring-[#18b5d5]/50"
    >
      <div className="flex items-start gap-4">
        <StoreLogo name={storeName} logoUrl={storeLogoUrl} tone={freshness} />
        
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-bold text-[#18b5d5]">{storeName}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                <div className="truncate font-mono text-xs text-white/50">{storeId || '—'}</div>
                {storeDomain && (
                  <div className="text-xs text-white/60">• {storeDomain}</div>
                )}
                {!storeDomain && storeUrl && (
                  <div className="truncate text-xs text-white/60">• {storeUrl}</div>
                )}
              </div>
            </div>
            
            <div className="shrink-0 rounded-lg bg-[#18b5d5] px-3 py-1.5 text-sm font-bold text-white">
              {total.toLocaleString()}
            </div>
          </div>

          <div className="mt-3 text-xs text-white/50">
            آخر رفع: {formatDate(store?.lastAt)}
          </div>

          <div className="mt-4 overflow-hidden rounded-lg bg-white/5">
            <div className="flex h-1.5 w-full">
              <div className="bg-emerald-500" style={{ width: `${(pImages * 100).toFixed(2)}%` }} />
              <div className="bg-sky-500" style={{ width: `${(pVideos * 100).toFixed(2)}%` }} />
              <div className="bg-violet-500" style={{ width: `${(pRaws * 100).toFixed(2)}%` }} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatPill tone="emerald" label="صور" value={images.toLocaleString()} />
            <StatPill tone="sky" label="فيديو" value={videos.toLocaleString()} />
            <StatPill tone="violet" label="ملفات" value={raws.toLocaleString()} />
          </div>
        </div>
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
    <div className="min-h-screen bg-[#292929]">
      <div className="mx-auto w-full max-w-7xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-1 w-12 bg-[#18b5d5] rounded-full" />
            <h1 className="text-3xl font-bold text-white">Media Dashboard</h1>
          </div>
          <p className="text-white/60 text-sm mr-14">تقسيم الميديا حسب المتجر - إدارة احترافية لجميع ملفاتك</p>
        </div>

        {/* Search & Filter Bar */}
        <div className="mb-6 rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-3">
              <svg className="h-5 w-5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setPage(1)
                }}
                placeholder="ابحث بـ Store ID أو اسم المتجر..."
                className="flex-1 bg-transparent text-sm text-white placeholder-white/40 outline-none"
                spellCheck={false}
              />
            </div>
            
            <div className="flex items-center gap-3">
              <select
                value={String(limit)}
                onChange={(e) => {
                  setLimit(Number(e.target.value))
                  setPage(1)
                }}
                className="rounded-lg border border-white/10 bg-[#1f1f1f] px-3 py-2 text-sm text-white outline-none hover:border-white/20 focus:border-[#18b5d5]/50"
              >
                <option value="12">12 متجر</option>
                <option value="24">24 متجر</option>
                <option value="36">36 متجر</option>
                <option value="60">60 متجر</option>
              </select>
            </div>
          </div>
        </div>

        {/* Stats & Pagination Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs text-white/50">إجمالي المتاجر</div>
              <div className="text-xl font-bold text-[#18b5d5]">{Number(data.total || 0).toLocaleString()}</div>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div>
              <div className="text-xs text-white/50">الصفحة الحالية</div>
              <div className="text-xl font-bold text-white">{page} / {totalPages}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-white/10 bg-[#1f1f1f] px-4 py-2 text-sm font-semibold text-white hover:border-white/20 hover:bg-[#252525] disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-[#1f1f1f]"
            >
              السابق
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg bg-[#18b5d5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16a3c1] disabled:opacity-40 disabled:hover:bg-[#18b5d5]"
            >
              التالي
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loading label="جاري تحميل المتاجر..." />
            </div>
          ) : null}
          
          {!loading && error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center">
              <div className="text-sm font-semibold text-red-400">{error}</div>
            </div>
          ) : null}

          {!loading && !error ? (
            stores.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {stores.map((s) => (
                  <StoreCard key={String(s?.storeId)} store={s} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-[#1a1a1a] p-12 text-center">
                <svg className="mx-auto h-12 w-12 text-white/20 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <div className="text-sm font-semibold text-white/60">لا توجد متاجر لعرضها</div>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}