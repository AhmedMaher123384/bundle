import { API_BASE_URL } from '../lib/http.js'

export function AdminMediaPlatformPage() {
  const adminUrl = new URL('/api/admin/media', API_BASE_URL).toString()

  return (
    <div className="min-h-full bg-slate-50 p-4 lg:p-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <div className="text-lg font-semibold text-slate-900">لوحة الميديا (أدمن)</div>
            <div className="mt-1 text-sm font-semibold text-slate-600">تعرض كل رفع العملاء — بدون توكين العملاء</div>
          </div>
          <a
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            href={adminUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            فتح في تبويب جديد
          </a>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <iframe title="Admin Media Dashboard" src={adminUrl} className="h-[80vh] w-full" />
        </div>
      </div>
    </div>
  )
}
