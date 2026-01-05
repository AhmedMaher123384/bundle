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

function formatDay(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
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

function StoreCard({ store, compact = false }) {
  const storeId = String(store?.storeId || '')
  const total = Number(store?.total || 0)
  const images = Number(store?.images || 0)
  const videos = Number(store?.videos || 0)
  const raws = Number(store?.raws || 0)
  const storeName = String(store?.store?.name || '').trim() || storeId || '—'
  const storeDomain = String(store?.store?.domain || '').trim()
  const storeUrl = String(store?.store?.url || '').trim()
  const storeLogoUrl = String(store?.store?.logoUrl || '').trim()
  const firstAt = store?.firstAt || null
  const lastAt = store?.lastAt || null
  const freshness = timeTone(lastAt)
  const pImages = ratio(images, total)
  const pVideos = ratio(videos, total)
  const pRaws = ratio(raws, total)

  return (
    <Link
      to={`/public-media/${encodeURIComponent(storeId)}`}
      className={[
        'group block rounded-2xl border border-white/10 bg-[#121212] transition',
        'hover:border-[#18b5d5]/50 hover:bg-[#161616] focus:outline-none focus:ring-2 focus:ring-[#18b5d5]/50',
        compact ? 'p-4' : 'p-5'
      ].join(' ')}
    >
      <div className="flex items-start gap-4">
        <StoreLogo name={storeName} logoUrl={storeLogoUrl} tone={freshness} />
        
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-extrabold text-white">{storeName}</h3>
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
            
            <div className="shrink-0 text-right">
              <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-extrabold text-white">
                <span className="text-white/60">الملفات</span>
                <span className="font-mono">{total.toLocaleString()}</span>
              </div>
              {!compact ? (
                <div className="mt-2 text-[11px] text-white/50">
                  <span className="text-white/40">آخر رفع:</span> {formatDate(lastAt)}
                </div>
              ) : null}
            </div>
          </div>

          {compact ? (
            <div className="mt-2 text-[11px] text-white/50">
              <span className="text-white/40">آخر رفع:</span> {formatDate(lastAt)}
              <span className="mx-2 text-white/20">•</span>
              <span className="text-white/40">أول رفع:</span> {formatDay(firstAt)}
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/50">
              <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">
                <span className="text-white/40">أول رفع:</span> {formatDay(firstAt)}
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1">
                <span className="text-white/40">آخر رفع:</span> {formatDate(lastAt)}
              </div>
            </div>
          )}

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

function MetricCard({ label, value, hint, tone = 'sky', to }) {
  const ring =
    tone === 'emerald'
      ? 'ring-emerald-500/20'
      : tone === 'violet'
        ? 'ring-violet-500/20'
        : tone === 'amber'
          ? 'ring-amber-400/20'
          : 'ring-[#18b5d5]/20'

  const top =
    tone === 'emerald'
      ? 'from-emerald-500/25 via-emerald-500/0'
      : tone === 'violet'
        ? 'from-violet-500/25 via-violet-500/0'
        : tone === 'amber'
          ? 'from-amber-400/25 via-amber-400/0'
          : 'from-[#18b5d5]/25 via-[#18b5d5]/0'

  const inner = (
    <div className={['relative overflow-hidden rounded-2xl border border-white/10 bg-[#121212] p-5 ring-1', ring].join(' ')}>
      <div className={['pointer-events-none absolute inset-0 bg-gradient-to-br', top, 'to-transparent'].join(' ')} />
      <div className="relative">
        <div className="text-xs font-semibold tracking-wide text-white/50">{label}</div>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <div className="text-3xl font-extrabold text-white">{value}</div>
        </div>
        {hint ? <div className="mt-2 text-xs text-white/50">{hint}</div> : null}
      </div>
    </div>
  )

  if (to) {
    return (
      <Link to={to} className="block focus:outline-none focus:ring-2 focus:ring-[#18b5d5]/40 rounded-2xl">
        {inner}
      </Link>
    )
  }
  return inner
}

function SectionHeader({ title, subtitle, to, actionLabel }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-lg font-extrabold text-white">{title}</div>
        {subtitle ? <div className="mt-1 text-sm text-white/50">{subtitle}</div> : null}
      </div>
      {to ? (
        <Link
          to={to}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white hover:border-white/20 hover:bg-white/10"
        >
          {actionLabel || 'عرض الكل'}
          <span className="text-white/40">↗</span>
        </Link>
      ) : null}
    </div>
  )
}

export function PublicMediaDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = String(searchParams.get('view') || '').trim()
  const view = viewParam === 'stores' ? 'stores' : 'overview'

  const qParam = String(searchParams.get('q') || '')
  const sortParam = String(searchParams.get('sort') || '').trim() || 'lastAt_desc'
  const pageParam = Math.max(1, Number(searchParams.get('page') || 1) || 1)

  const [q, setQ] = useState(qParam)
  const [page, setPage] = useState(pageParam)
  const [limit, setLimit] = useState(24)
  const [sort, setSort] = useState(sortParam)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ total: 0, stores: [] })
  const [error, setError] = useState('')

  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState('')
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    setQ(qParam)
  }, [qParam])

  useEffect(() => {
    setPage(pageParam)
  }, [pageParam])

  useEffect(() => {
    setSort(sortParam)
  }, [sortParam])

  useEffect(() => {
    const t = globalThis.setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('view', view)
        const nq = String(q || '').trim()
        if (nq) next.set('q', nq)
        else next.delete('q')
        const ns = String(sort || '').trim() || 'lastAt_desc'
        if (ns && ns !== 'lastAt_desc') next.set('sort', ns)
        else next.delete('sort')
        if (view === 'stores') next.set('page', String(page))
        else next.delete('page')
        return next
      })
    }, 150)
    return () => globalThis.clearTimeout(t)
  }, [page, q, setSearchParams, sort, view])

  useEffect(() => {
    if (view !== 'stores') return undefined
    const controller = new AbortController()
    async function run() {
      setLoading(true)
      setError('')
      try {
        const res = await requestJson('/api/public/media/stores', { query: { q, sort, page, limit }, signal: controller.signal })
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
  }, [limit, page, q, sort, view])

  useEffect(() => {
    if (view !== 'overview') return undefined
    const controller = new AbortController()
    async function run() {
      setOverviewLoading(true)
      setOverviewError('')
      try {
        const res = await requestJson('/api/public/media/overview', { query: { top: 6 }, signal: controller.signal })
        setOverview(res || null)
      } catch (e) {
        if (e?.code === 'REQUEST_ABORTED') return
        setOverviewError(String(e?.message || 'Failed to load overview.'))
        setOverview(null)
      } finally {
        if (!controller.signal.aborted) setOverviewLoading(false)
      }
    }
    run()
    return () => controller.abort()
  }, [view])

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(data.total || 0) || 0) / limit)), [data.total, limit])
  const stores = Array.isArray(data.stores) ? data.stores : []

  const overviewStats = overview?.stats || null
  const lastUploader = overview?.highlights?.lastUploader || null
  const overviewLists = overview?.lists || null

  return (
    <div className="min-h-screen bg-[#0b0b0b]">
      <div className="mx-auto w-full max-w-7xl px-4 py-10">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0f0f0f] p-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(24,181,213,0.22),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(139,92,246,0.15),transparent_40%),radial-gradient(circle_at_60%_90%,rgba(16,185,129,0.10),transparent_45%)]" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-white/70">
                Public
                <span className="text-white/30">•</span>
                Media
              </div>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">منصة الرفع</h1>
              <p className="mt-2 text-sm text-white/55">إدارة الميديا حسب المتجر — لوحة ذكية، سريعة، ومنظمة.</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('view', 'overview')
                    next.delete('page')
                    return next
                  })
                }}
                className={[
                  'rounded-xl px-4 py-2 text-sm font-extrabold transition',
                  view === 'overview'
                    ? 'bg-[#18b5d5] text-white'
                    : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                ].join(' ')}
              >
                نظرة عامة
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev)
                    next.set('view', 'stores')
                    if (!next.get('page')) next.set('page', '1')
                    return next
                  })
                }}
                className={[
                  'rounded-xl px-4 py-2 text-sm font-extrabold transition',
                  view === 'stores'
                    ? 'bg-[#18b5d5] text-white'
                    : 'border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                ].join(' ')}
              >
                المتاجر
              </button>
            </div>
          </div>
        </div>

        {view === 'overview' ? (
          <div className="mt-8 space-y-8">
            {overviewLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loading label="جاري تجهيز النظرة العامة..." />
              </div>
            ) : null}

            {!overviewLoading && overviewError ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center">
                <div className="text-sm font-semibold text-red-300">{overviewError}</div>
              </div>
            ) : null}

            {!overviewLoading && !overviewError ? (
              <div className="space-y-8">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard
                    label="إجمالي المتاجر"
                    value={(Number(overviewStats?.totalStores || 0) || 0).toLocaleString()}
                    hint="متاجر لديها ملفات مرفوعة"
                    tone="sky"
                    to={lastUploader?.storeId ? `/public-media/${encodeURIComponent(String(lastUploader.storeId))}` : undefined}
                  />
                  <MetricCard
                    label="إجمالي الملفات"
                    value={(Number(overviewStats?.totalAssets || 0) || 0).toLocaleString()}
                    hint="كل الصور/الفيديو/الملفات"
                    tone="emerald"
                  />
                  <MetricCard
                    label="آخر رفع"
                    value={formatDate(overviewStats?.lastAt || null)}
                    hint={lastUploader?.store?.name ? `آخر متجر رفع: ${String(lastUploader.store.name)}` : lastUploader?.storeId ? `آخر متجر رفع: ${String(lastUploader.storeId)}` : ''}
                    tone="amber"
                    to={lastUploader?.storeId ? `/public-media/${encodeURIComponent(String(lastUploader.storeId))}` : undefined}
                  />
                  <MetricCard
                    label="أول رفع"
                    value={formatDay(overviewStats?.firstAt || null)}
                    hint="بداية نشاط المنصة"
                    tone="violet"
                  />
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <SectionHeader title="الأحدث نشاطًا" subtitle="آخر متجر قام برفع ملفات" to="/public-media?view=stores&sort=lastAt_desc&page=1" actionLabel="كل المتاجر" />
                    <div className="grid grid-cols-1 gap-3">
                      {(Array.isArray(overviewLists?.newest) ? overviewLists.newest : []).slice(0, 6).map((s) => (
                        <StoreCard key={`new-${String(s?.storeId)}`} store={s} compact />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <SectionHeader title="الأكبر حجمًا" subtitle="أكثر المتاجر رفعًا للملفات" to="/public-media?view=stores&sort=total_desc&page=1" actionLabel="كل المتاجر" />
                    <div className="grid grid-cols-1 gap-3">
                      {(Array.isArray(overviewLists?.biggest) ? overviewLists.biggest : []).slice(0, 6).map((s) => (
                        <StoreCard key={`big-${String(s?.storeId)}`} store={s} compact />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <SectionHeader title="الأقدم انضمامًا" subtitle="أول من بدأ رفع ملفات" to="/public-media?view=stores&sort=firstAt_asc&page=1" actionLabel="كل المتاجر" />
                    <div className="grid grid-cols-1 gap-3">
                      {(Array.isArray(overviewLists?.oldest) ? overviewLists.oldest : []).slice(0, 6).map((s) => (
                        <StoreCard key={`old-${String(s?.storeId)}`} store={s} compact />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-4">
                    <SectionHeader title="الأقل نشاطًا" subtitle="أقدم آخر رفع (بحسب البيانات الحالية)" to="/public-media?view=stores&sort=lastAt_asc&page=1" actionLabel="كل المتاجر" />
                    <div className="grid grid-cols-1 gap-3">
                      {(Array.isArray(overviewLists?.stalest) ? overviewLists.stalest : []).slice(0, 6).map((s) => (
                        <StoreCard key={`stale-${String(s?.storeId)}`} store={s} compact />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {view === 'stores' ? (
          <div className="mt-8 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-[#0f0f0f] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 hover:border-white/20 focus-within:border-[#18b5d5]/50">
                  <svg className="h-5 w-5 text-white/35" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setPage(1)
                    }}
                    placeholder="ابحث بـ Store ID..."
                    className="flex-1 bg-transparent text-sm text-white placeholder-white/35 outline-none"
                    spellCheck={false}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value)
                      setPage(1)
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-semibold text-white outline-none hover:border-white/20 focus:border-[#18b5d5]/50"
                  >
                    <option value="lastAt_desc">الأحدث نشاطًا</option>
                    <option value="lastAt_asc">الأقل نشاطًا</option>
                    <option value="firstAt_asc">الأقدم انضمامًا</option>
                    <option value="firstAt_desc">الأحدث انضمامًا</option>
                    <option value="total_desc">الأكثر ملفات</option>
                    <option value="total_asc">الأقل ملفات</option>
                  </select>

                  <select
                    value={String(limit)}
                    onChange={(e) => {
                      setLimit(Number(e.target.value))
                      setPage(1)
                    }}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-semibold text-white outline-none hover:border-white/20 focus:border-[#18b5d5]/50"
                  >
                    <option value="12">12 متجر</option>
                    <option value="24">24 متجر</option>
                    <option value="36">36 متجر</option>
                    <option value="60">60 متجر</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-center gap-6">
                  <div>
                    <div className="text-xs text-white/45">إجمالي المتاجر</div>
                    <div className="mt-1 text-xl font-extrabold text-white">{Number(data.total || 0).toLocaleString()}</div>
                  </div>
                  <div className="h-10 w-px bg-white/10" />
                  <div>
                    <div className="text-xs text-white/45">الصفحة</div>
                    <div className="mt-1 text-xl font-extrabold text-[#18b5d5]">
                      {page} <span className="text-white/25">/</span> {totalPages}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-extrabold text-white hover:border-white/20 hover:bg-white/10 disabled:opacity-40"
                  >
                    السابق
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-xl bg-[#18b5d5] px-4 py-2 text-sm font-extrabold text-white hover:bg-[#16a3c1] disabled:opacity-40"
                  >
                    التالي
                  </button>
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loading label="جاري تحميل المتاجر..." />
              </div>
            ) : null}

            {!loading && error ? (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6 text-center">
                <div className="text-sm font-semibold text-red-300">{error}</div>
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
                <div className="rounded-2xl border border-white/10 bg-[#0f0f0f] p-12 text-center">
                  <div className="text-sm font-semibold text-white/60">لا توجد متاجر مطابقة</div>
                  <div className="mt-2 text-xs text-white/40">جرب تغيير البحث أو الفرز</div>
                </div>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
