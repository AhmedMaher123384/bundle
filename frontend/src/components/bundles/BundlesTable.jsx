import { Badge } from '../ui/Badge.jsx'

function formatDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
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

function componentsCount(bundle) {
  return Array.isArray(bundle?.components) ? bundle.components.length : 0
}

function componentsTotalQty(bundle) {
  const tiers = Array.isArray(bundle?.rules?.tiers) ? bundle.rules.tiers : []
  if (tiers.length) {
    const mins = tiers.map((t) => Math.max(1, Math.floor(Number(t?.minQty || 0)))).filter((n) => Number.isFinite(n) && n >= 1)
    if (mins.length) return Math.min(...mins)
  }
  return (Array.isArray(bundle?.components) ? bundle.components : []).reduce((acc, c) => acc + Math.max(0, Math.floor(Number(c?.quantity || 0))), 0)
}

function bundleTypeLabel(bundle) {
  if (Array.isArray(bundle?.rules?.tiers) && bundle.rules.tiers.length) return 'Quantity'
  const unique = new Set((Array.isArray(bundle?.components) ? bundle.components : []).map((c) => String(c?.variantId || '').trim()).filter(Boolean))
  if (unique.size >= 2) return 'Bundle products'
  const qty = componentsTotalQty(bundle)
  if (qty >= 2) return 'Quantity'
  return '—'
}

function offerLabel(bundle) {
  const tiers = Array.isArray(bundle?.rules?.tiers) ? bundle.rules.tiers : []
  if (tiers.length) {
    const mins = tiers.map((t) => Math.max(1, Math.floor(Number(t?.minQty || 0)))).filter((n) => Number.isFinite(n) && n >= 1)
    const minQty = mins.length ? Math.min(...mins) : 1
    return { title: `Tiers (${tiers.length})`, sub: `Min Qty ${minQty}` }
  }
  const type = String(bundle?.rules?.type || '').toLowerCase()
  const value = bundle?.rules?.value
  if (!type) return { title: '—', sub: '—' }
  if (type === 'percentage') return { title: 'Percentage', sub: `${Number(value || 0)}%` }
  if (type === 'fixed') return { title: 'Fixed', sub: String(value ?? '0') }
  if (type === 'bundle_price') return { title: 'Bundle Price', sub: String(value ?? '0') }
  return { title: type, sub: String(value ?? '—') }
}

export function BundlesTable({
  bundles,
  sortKey,
  sortDir,
  onSortChange,
  lastValidatedAtById,
  onEdit,
  onDuplicate,
  onExport,
  onActivate,
  onPause,
  onDelete,
}) {
  function header(label, key) {
    const active = sortKey === key
    const dir = active ? sortDir : null
    return (
      <button
        type="button"
        className="inline-flex items-center gap-2 text-left text-xs font-semibold text-slate-600 hover:text-slate-900"
        onClick={() => {
          const nextDir = active ? (dir === 'asc' ? 'desc' : 'asc') : 'asc'
          onSortChange({ key, dir: nextDir })
        }}
      >
        <span>{label}</span>
        {active ? <span className="text-[10px] text-slate-400">{dir === 'asc' ? '▲' : '▼'}</span> : null}
      </button>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-600">
            <tr>
              <th className="px-4 py-3">{header('Name', 'name')}</th>
              <th className="px-4 py-3">{header('Status', 'status')}</th>
              <th className="px-4 py-3">{header('Trigger Product', 'triggerProductId')}</th>
              <th className="px-4 py-3">{header('Items', 'componentsCount')}</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">{header('Updated', 'updatedAt')}</th>
              <th className="px-4 py-3">{header('Created', 'createdAt')}</th>
              <th className="px-4 py-3">Last Toggle</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {bundles.map((b) => (
              <tr key={b._id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900">{b.name}</div>
                  <div className="mt-1 font-mono text-xs text-slate-500">{b._id}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(b.status)}>{statusLabel(b.status)}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-slate-700">{b.triggerProductId || '—'}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">{componentsCount(b)}</div>
                  <div className="mt-1 text-xs text-slate-500">Qty {componentsTotalQty(b)}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">{bundleTypeLabel(b)}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-900">{offerLabel(b).title}</div>
                  <div className="mt-1 text-xs text-slate-500">{offerLabel(b).sub}</div>
                </td>
                <td className="px-4 py-3">{formatDate(b.updatedAt)}</td>
                <td className="px-4 py-3">{formatDate(b.createdAt)}</td>
                <td className="px-4 py-3">{formatDate(lastValidatedAtById?.[b._id] || null)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                      onClick={() => onEdit(b)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                      onClick={() => onDuplicate(b)}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                      onClick={() => onExport(b)}
                    >
                      Export
                    </button>
                    {String(b.status || '').toLowerCase() === 'active' ? (
                      <button
                        type="button"
                        className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
                        onClick={() => onPause(b)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                        onClick={() => onActivate(b)}
                      >
                        Activate
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
                      onClick={() => onDelete(b)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {!bundles.length ? (
              <tr>
                <td className="px-4 py-10 text-center text-sm text-slate-600" colSpan={10}>
                  No bundles found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
