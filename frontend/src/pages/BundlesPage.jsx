import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { useToasts } from '../components/useToasts.js'
import { BundlesTable } from '../components/bundles/BundlesTable.jsx'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { Loading } from '../components/ui/Loading.jsx'
import { requestJson, HttpError } from '../lib/http.js'
import { downloadJson } from '../lib/download.js'

function compare(a, b) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export function BundlesPage() {
  const { token, logout } = useAuth()
  const toasts = useToasts()
  const navigate = useNavigate()

  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [bundles, setBundles] = useState([])
  const [sort, setSort] = useState({ key: 'updatedAt', dir: 'desc' })
  const [lastValidatedAtById, setLastValidatedAtById] = useState({})

  const [confirmDelete, setConfirmDelete] = useState({ open: false, bundle: null })

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const res = await requestJson('/api/bundles', { token, query: status === 'all' ? {} : { status } })
        if (!cancelled) setBundles(res?.bundles || [])
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
        else toasts.error('Failed to load bundles.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [logout, status, toasts, token])

  const sorted = useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    const arr = q
      ? bundles.filter((b) => {
          const name = String(b?.name || '').toLowerCase()
          const id = String(b?._id || '').toLowerCase()
          return name.includes(q) || id.includes(q)
        })
      : [...bundles]
    arr.sort((x, y) => {
      const mult = sort.dir === 'asc' ? 1 : -1
      return mult * compare(x?.[sort.key], y?.[sort.key])
    })
    return arr
  }, [bundles, search, sort.dir, sort.key])

  async function duplicateBundle(bundle) {
    try {
      const payload = {
        version: 1,
        name: `${bundle.name} (Copy)`,
        status: 'draft',
        components: bundle.components || [],
        rules: bundle.rules || { type: 'fixed', value: 0 },
        presentation: bundle.presentation || {},
      }
      await requestJson('/api/bundles', { token, method: 'POST', body: payload })
      toasts.success('Bundle duplicated.')
      const res = await requestJson('/api/bundles', { token, query: status === 'all' ? {} : { status } })
      setBundles(res?.bundles || [])
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to duplicate bundle.')
    }
  }

  async function activate(bundle) {
    try {
      await requestJson(`/api/bundles/${encodeURIComponent(bundle._id)}`, { token, method: 'PATCH', body: { status: 'active' } })
      setLastValidatedAtById((prev) => ({ ...prev, [bundle._id]: Date.now() }))
      toasts.success('Bundle activated.')
      const res = await requestJson('/api/bundles', { token, query: status === 'all' ? {} : { status } })
      setBundles(res?.bundles || [])
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else if (err instanceof HttpError && err.code === 'BUNDLE_VARIANTS_INVALID') {
        const invalid = err.details?.invalid || err.details?.meta?.invalid || []
        toasts.error(`Cannot activate: invalid variants (${invalid.length}).`)
      } else toasts.error('Failed to activate bundle.')
    }
  }

  async function pause(bundle) {
    try {
      await requestJson(`/api/bundles/${encodeURIComponent(bundle._id)}`, { token, method: 'PATCH', body: { status: 'paused' } })
      toasts.success('Bundle paused.')
      const res = await requestJson('/api/bundles', { token, query: status === 'all' ? {} : { status } })
      setBundles(res?.bundles || [])
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to pause bundle.')
    }
  }

  async function remove(bundle) {
    try {
      await requestJson(`/api/bundles/${encodeURIComponent(bundle._id)}`, { token, method: 'DELETE' })
      toasts.success('Bundle deleted.')
      setConfirmDelete({ open: false, bundle: null })
      const res = await requestJson('/api/bundles', { token, query: status === 'all' ? {} : { status } })
      setBundles(res?.bundles || [])
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to delete bundle.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Bundles</div>
          <div className="mt-1 text-sm text-slate-600">Create, edit, activate, pause, delete. Activation validates live variants.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bundles…"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4 sm:w-64"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
          <button
            type="button"
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={() => navigate('/products')}
          >
            Create From Product
          </button>
        </div>
      </div>

      {loading ? <Loading label="Loading bundles…" /> : null}

      {!loading ? (
        <BundlesTable
          bundles={sorted}
          sortKey={sort.key}
          sortDir={sort.dir}
          onSortChange={({ key, dir }) => setSort({ key, dir })}
          lastValidatedAtById={lastValidatedAtById}
          onEdit={(b) => navigate(`/bundles/${b._id}/edit`)}
          onDuplicate={duplicateBundle}
          onExport={(b) => downloadJson(`bundle-${b._id}.json`, b)}
          onActivate={activate}
          onPause={pause}
          onDelete={(b) => setConfirmDelete({ open: true, bundle: b })}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete.open}
        title="Delete bundle?"
        message="This will soft-delete the bundle and pause it."
        confirmText="Delete"
        onCancel={() => setConfirmDelete({ open: false, bundle: null })}
        onConfirm={() => remove(confirmDelete.bundle)}
      />
    </div>
  )
}
