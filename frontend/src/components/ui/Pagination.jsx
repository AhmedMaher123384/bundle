export function Pagination({ page, totalPages, onPageChange }) {
  const p = Math.max(1, Number(page || 1))
  const tp = Math.max(1, Number(totalPages || 1))

  const pages = []
  const start = Math.max(1, p - 2)
  const end = Math.min(tp, p + 2)
  for (let i = start; i <= end; i += 1) pages.push(i)

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-slate-600">
        Page <span className="font-semibold text-slate-900">{p}</span> of{' '}
        <span className="font-semibold text-slate-900">{tp}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          onClick={() => onPageChange(Math.max(1, p - 1))}
          disabled={p <= 1}
        >
          Prev
        </button>
        {pages.map((n) => (
          <button
            key={n}
            type="button"
            className={[
              'hidden rounded-lg border px-3 py-2 text-sm font-medium sm:inline-flex',
              n === p ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:bg-slate-50',
            ].join(' ')}
            onClick={() => onPageChange(n)}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          onClick={() => onPageChange(Math.min(tp, p + 1))}
          disabled={p >= tp}
        >
          Next
        </button>
      </div>
    </div>
  )
}

