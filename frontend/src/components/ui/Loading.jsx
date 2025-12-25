export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-700" />
      <div>{label}</div>
    </div>
  )
}

