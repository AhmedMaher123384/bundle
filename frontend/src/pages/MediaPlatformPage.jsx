import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { useToasts } from '../components/useToasts.js'
import { Loading } from '../components/ui/Loading.jsx'
import { requestJson, HttpError } from '../lib/http.js'

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
              <div className="font-semibold text-slate-600">متجر سلة</div>
              <div className="font-mono text-xs font-semibold text-slate-900">{item?.storeId || '—'}</div>
            </div>
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

        {item?.context ? (
          <details className="rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">تفاصيل (Context)</summary>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-800">
              {JSON.stringify(item.context, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  )
}

export function MediaPlatformPage() {
  const { token, logout } = useAuth()
  const toasts = useToasts()

  const [resourceType, setResourceType] = useState('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(18)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [data, setData] = useState({ total: 0, items: [], storeId: null })

  const typeParam = resourceType === 'all' ? '' : resourceType

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const res = await requestJson('/api/media/assets', { token, query: { resourceType: typeParam, q: query, page, limit } })
        if (!cancelled) setData({ total: res?.total || 0, items: res?.items || [], storeId: res?.storeId || null })
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
        toasts.error('فشل تحميل منصة الرفع.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [limit, logout, page, query, token, toasts, typeParam])

  const totalPages = useMemo(() => {
    const t = Number(data?.total || 0)
    const l = Number(limit || 1)
    return Math.max(1, Math.ceil(t / l))
  }, [data?.total, limit])

  const headerSubtitle = useMemo(() => {
    const storeId = data?.storeId || '—'
    const t = Number(data?.total || 0)
    return `Store: ${storeId} • Total: ${t}`
  }, [data?.storeId, data?.total])

  async function syncFromCloudinary() {
    setSyncing(true)
    try {
      const res = await requestJson('/api/media/sync', { token, method: 'POST', body: { resourceType: resourceType === 'all' ? 'all' : resourceType, maxResults: 120 } })
      if (Array.isArray(res?.errors) && res.errors.length) {
        toasts.error('Sync تم مع أخطاء. افتح الكونسل للتفاصيل.')
        try {
          console.error('Cloudinary sync errors', res.errors)
        } catch {
          undefined
        }
      } else {
        toasts.success('Sync تم بنجاح.')
      }
      setPage(1)
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      toasts.error('فشل Sync من Cloudinary.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">منصة الرفع</div>
          <div className="mt-1 text-sm text-slate-600">{headerSubtitle}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={syncing}
            onClick={syncFromCloudinary}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {syncing ? 'Sync جاري…' : 'Sync من Cloudinary'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <div>
            <label className="text-xs font-semibold text-slate-600">النوع</label>
            <select
              value={resourceType}
              onChange={(e) => {
                setResourceType(e.target.value)
                setPage(1)
              }}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none ring-slate-900/10 focus:ring-4"
            >
              <option value="all">الكل</option>
              <option value="image">صور</option>
              <option value="video">فيديو</option>
              <option value="raw">ملفات</option>
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="text-xs font-semibold text-slate-600">بحث (Public ID)</label>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(1)
              }}
              placeholder="مثال: bundle_app/123456/…"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none ring-slate-900/10 focus:ring-4"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Page size</label>
            <select
              value={String(limit)}
              onChange={(e) => {
                setLimit(Number(e.target.value))
                setPage(1)
              }}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none ring-slate-900/10 focus:ring-4"
            >
              <option value="12">12</option>
              <option value="18">18</option>
              <option value="24">24</option>
              <option value="36">36</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? <Loading label="Loading media…" /> : null}

      {!loading ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-900">
            Page {page} / {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {!loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.isArray(data?.items) && data.items.length ? (
            data.items.map((it) => <MediaCard key={it.id} item={it} />)
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">مفيش نتائج.</div>
          )}
        </div>
      ) : null}
    </div>
  )
}

