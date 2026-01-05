import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Loading } from '../components/ui/Loading.jsx'
import { requestJson } from '../lib/http.js'

function formatBytes(n) {
  const b = Number(n)
  if (!Number.isFinite(b) || b < 0) return '—'
  if (b < 1024) return `${b} B`
  const kb = b / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(2)} GB`
}

function formatDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function mediaLabel(rt) {
  const t = String(rt || '')
  if (t === 'video') return 'فيديو'
  if (t === 'image') return 'صورة'
  if (t === 'raw') return 'ملف'
  return '—'
}

function MediaCard({ item }) {
  const isVideo = String(item?.resourceType) === 'video'
  const src = item?.secureUrl || item?.url || null

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="aspect-video w-full bg-slate-100">
        {src ? (
          isVideo ? (
            <video className="h-full w-full object-cover" controls preload="metadata" playsInline src={src} />
          ) : (
            <img className="h-full w-full object-cover" alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" src={src} />
          )
        ) : null}
      </div>

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{item?.originalFilename || item?.publicId || '—'}</div>
            <div className="mt-1 truncate font-mono text-xs text-slate-500">{item?.publicId || '—'}</div>
          </div>
          <div className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">
            {mediaLabel(item?.resourceType)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="font-semibold text-slate-600">الحجم</div>
            <div className="mt-1 font-semibold text-slate-900">{formatBytes(item?.bytes)}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="font-semibold text-slate-600">الأبعاد</div>
            <div className="mt-1 font-semibold text-slate-900">
              {item?.width && item?.height ? `${item.width}×${item.height}` : '—'}
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="font-semibold text-slate-600">المدة</div>
            <div className="mt-1 font-semibold text-slate-900">{item?.duration != null ? `${Number(item.duration).toFixed(2)}s` : '—'}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="font-semibold text-slate-600">تاريخ الرفع</div>
            <div className="mt-1 font-semibold text-slate-900">{formatDate(item?.cloudinaryCreatedAt || item?.createdAt)}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-600">مجلد Cloudinary</div>
              <div className="truncate font-mono text-xs font-semibold text-slate-900">{item?.folder || '—'}</div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-600">الرابط</div>
              {src ? (
                <a className="truncate text-xs font-semibold text-sky-700 underline" href={src} target="_blank" rel="noopener noreferrer">
                  فتح
                </a>
              ) : (
                <div className="text-xs font-semibold text-slate-900">—</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PublicMediaStorePage() {
  const { storeId: rawStoreId } = useParams()
  const storeId = String(rawStoreId || '').trim()

  const [searchParams, setSearchParams] = useSearchParams()
  const rtParam = String(searchParams.get('type') || '')
  const qParam = String(searchParams.get('q') || '')
  const pageParam = Math.max(1, Number(searchParams.get('page') || 1) || 1)

  const [resourceType, setResourceType] = useState(rtParam)
  const [q, setQ] = useState(qParam)
  const [page, setPage] = useState(pageParam)
  const [limit, setLimit] = useState(24)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ total: 0, items: [], store: null, summary: null })
  const [error, setError] = useState('')

  useEffect(() => setResourceType(rtParam), [rtParam])
  useEffect(() => setQ(qParam), [qParam])
  useEffect(() => setPage(pageParam), [pageParam])

  useEffect(() => {
    const t = globalThis.setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        const nType = String(resourceType || '').trim()
        const nq = String(q || '').trim()

        if (nType) next.set('type', nType)
        else next.delete('type')

        if (nq) next.set('q', nq)
        else next.delete('q')

        next.set('page', String(page))
        return next
      })
    }, 150)
    return () => globalThis.clearTimeout(t)
  }, [page, q, resourceType, setSearchParams])

  useEffect(() => {
    const controller = new AbortController()
    async function run() {
      if (!storeId) return
      setLoading(true)
      setError('')
      try {
        const res = await requestJson(`/api/public/media/stores/${encodeURIComponent(storeId)}/assets`, {
          query: { resourceType, q, page, limit },
          signal: controller.signal,
        })
        setData({
          total: Number(res?.total || 0) || 0,
          items: Array.isArray(res?.items) ? res.items : [],
          store: res?.store || null,
          summary: res?.summary || null,
        })
      } catch (e) {
        if (e?.code === 'REQUEST_ABORTED') return
        setError(String(e?.message || 'Failed to load assets.'))
        setData({ total: 0, items: [], store: null, summary: null })
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    run()
    return () => controller.abort()
  }, [limit, page, q, resourceType, storeId])

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(data.total || 0) || 0) / limit)), [data.total, limit])
  const items = Array.isArray(data.items) ? data.items : []
  const storeName = String(data?.store?.name || '').trim() || storeId || '—'
  const storeDomain = String(data?.store?.domain || '').trim()
  const storeUrl = String(data?.store?.url || '').trim()
  const summaryTotal = Number(data?.summary?.total || 0) || 0
  const summaryImages = Number(data?.summary?.images || 0) || 0
  const summaryVideos = Number(data?.summary?.videos || 0) || 0
  const summaryRaws = Number(data?.summary?.raws || 0) || 0
  const summaryLastAt = data?.summary?.lastAt || null

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Link to="/public-media" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
                رجوع
              </Link>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-slate-900">{storeName}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{storeId || '—'}</div>
                  {storeDomain ? <div className="text-xs font-semibold text-slate-700">{storeDomain}</div> : null}
                  {!storeDomain && storeUrl ? <div className="truncate text-xs font-semibold text-slate-700">{storeUrl}</div> : null}
                </div>
              </div>
            </div>
            <div className="mt-2 text-sm text-slate-600">آخر نشاط: {formatDate(summaryLastAt)}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={resourceType}
              onChange={(e) => {
                setResourceType(e.target.value)
                setPage(1)
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none ring-slate-900/10 focus:ring-4"
            >
              <option value="">الكل</option>
              <option value="image">صور</option>
              <option value="video">فيديو</option>
              <option value="raw">ملفات</option>
            </select>

            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              placeholder="ابحث بـ publicId أو اسم الملف…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none ring-slate-900/10 focus:ring-4 sm:w-96"
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

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold text-slate-600">الإجمالي</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{summaryTotal.toLocaleString()}</div>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-white p-4">
            <div className="text-xs font-semibold text-emerald-700">صور</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{summaryImages.toLocaleString()}</div>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white p-4">
            <div className="text-xs font-semibold text-sky-700">فيديو</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{summaryVideos.toLocaleString()}</div>
          </div>
          <div className="rounded-2xl border border-violet-200 bg-white p-4">
            <div className="text-xs font-semibold text-violet-700">ملفات</div>
            <div className="mt-2 text-lg font-semibold text-slate-900">{summaryRaws.toLocaleString()}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">
            Total: {Number(data.total || 0).toLocaleString()} • Page {page} / {totalPages}
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
          {loading ? <Loading label="Loading media…" /> : null}
          {!loading && error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-900">{error}</div>
          ) : null}

          {!loading && !error ? (
            items.length ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((it) => (
                  <MediaCard key={String(it?.id)} item={it} />
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-700">
                مفيش ملفات.
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  )
}
