import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { useToasts } from '../components/useToasts.js'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx'
import { Loading } from '../components/ui/Loading.jsx'
import { requestJson, HttpError } from '../lib/http.js'

function isoInputValue(dateLike) {
  if (!dateLike) return ''
  const d = new Date(dateLike)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function parseDateInput(value) {
  const s = String(value || '').trim()
  if (!s) return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function clampNum(n, min, max, fallback) {
  const x = Number(n)
  if (!Number.isFinite(x)) return fallback
  return Math.max(min, Math.min(max, x))
}

function emptyForm() {
  return {
    name: '',
    status: 'draft',
    priority: 100,
    content: { title: '', subtitle: '', imageUrl: '', highlights: ['', '', '', ''] },
    presentation: {
      backgroundColor: '#0b1220',
      textColor: '#ffffff',
      accentColor: '#38bdf8',
      overlayColor: '',
      overlayOpacity: 0.55,
      fontFamily: '',
      shape: { radiusPx: 18, widthPx: 420 },
      layout: 'center',
      glass: true,
      enterAnimation: 'pop',
    },
    form: {
      enabled: true,
      fields: { name: true, email: true, phone: false },
      consentText: '',
      submitText: '',
      successTitle: '',
      successMessage: '',
      couponCode: '',
      redirectUrl: '',
    },
    behavior: { dismissible: true, closeOnOverlay: true, dismissTtlHours: 72, showDelayMs: 800, frequency: 'once_per_ttl' },
    targeting: { showOn: 'all' },
    scheduling: { startAt: null, endAt: null },
  }
}

function normalizeHighlights(highlights) {
  const arr = Array.isArray(highlights) ? highlights : []
  const out = []
  for (const raw of arr) {
    const s = String(raw || '').trim()
    if (!s) continue
    out.push(s.slice(0, 120))
    if (out.length >= 4) break
  }
  return out
}

function normalizePayload(form) {
  const f = form && typeof form === 'object' ? form : emptyForm()
  return {
    version: 1,
    name: String(f.name || '').trim(),
    status: String(f.status || 'draft'),
    priority: Math.max(0, Math.min(9999, Math.floor(Number(f.priority || 100)))),
    content: {
      title: String(f.content?.title || '').trim() || null,
      subtitle: String(f.content?.subtitle || '').trim() || null,
      imageUrl: String(f.content?.imageUrl || '').trim() || null,
      highlights: normalizeHighlights(f.content?.highlights),
    },
    presentation: {
      backgroundColor: String(f.presentation?.backgroundColor || '').trim() || null,
      textColor: String(f.presentation?.textColor || '').trim() || null,
      accentColor: String(f.presentation?.accentColor || '').trim() || null,
      overlayColor: String(f.presentation?.overlayColor || '').trim() || null,
      overlayOpacity: clampNum(f.presentation?.overlayOpacity, 0, 0.9, 0.55),
      fontFamily: String(f.presentation?.fontFamily || '').trim() || null,
      shape: {
        radiusPx: clampNum(f.presentation?.shape?.radiusPx, 0, 40, 18),
        widthPx: clampNum(f.presentation?.shape?.widthPx, 280, 560, 420),
      },
      layout: String(f.presentation?.layout || 'center'),
      glass: f.presentation?.glass !== false,
      enterAnimation: String(f.presentation?.enterAnimation || 'pop'),
    },
    form: {
      enabled: f.form?.enabled !== false,
      fields: {
        name: f.form?.fields?.name !== false,
        email: f.form?.fields?.email !== false,
        phone: f.form?.fields?.phone === true,
      },
      consentText: String(f.form?.consentText || '').trim() || null,
      submitText: String(f.form?.submitText || '').trim() || null,
      successTitle: String(f.form?.successTitle || '').trim() || null,
      successMessage: String(f.form?.successMessage || '').trim() || null,
      couponCode: String(f.form?.couponCode || '').trim() || null,
      redirectUrl: String(f.form?.redirectUrl || '').trim() || null,
    },
    behavior: {
      dismissible: f.behavior?.dismissible !== false,
      closeOnOverlay: f.behavior?.closeOnOverlay !== false,
      dismissTtlHours: Math.max(0, Math.min(24 * 365, Number(f.behavior?.dismissTtlHours ?? 72))),
      showDelayMs: Math.max(0, Math.min(20000, Number(f.behavior?.showDelayMs ?? 800))),
      frequency: String(f.behavior?.frequency || 'once_per_ttl'),
    },
    targeting: { showOn: String(f.targeting?.showOn || 'all') },
    scheduling: {
      startAt: f.scheduling?.startAt ? String(f.scheduling.startAt) : null,
      endAt: f.scheduling?.endAt ? String(f.scheduling.endAt) : null,
    },
  }
}

export function StorefrontPopupsPage() {
  const { token, logout } = useAuth()
  const toasts = useToasts()

  const [loading, setLoading] = useState(true)
  const [popups, setPopups] = useState([])
  const [editing, setEditing] = useState({ open: false, mode: 'create', popupId: null })
  const [form, setForm] = useState(() => emptyForm())
  const [confirmDelete, setConfirmDelete] = useState({ open: false, popup: null })
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leads, setLeads] = useState([])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await requestJson('/api/storefront-popups', { token })
      setPopups(res?.popups || [])
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to load popups.')
      setPopups([])
    } finally {
      setLoading(false)
    }
  }, [logout, toasts, token])

  useEffect(() => {
    void reload()
  }, [reload])

  const sorted = useMemo(() => {
    const arr = Array.isArray(popups) ? [...popups] : []
    arr.sort((a, b) => {
      const ap = Number(a?.priority ?? 100)
      const bp = Number(b?.priority ?? 100)
      if (ap !== bp) return ap - bp
      const at = a?.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bt = b?.updatedAt ? new Date(b.updatedAt).getTime() : 0
      if (bt !== at) return bt - at
      return String(b?._id || '').localeCompare(String(a?._id || ''))
    })
    return arr
  }, [popups])

  const loadLeads = useCallback(
    async (popupId) => {
      if (!popupId) return
      setLeadsLoading(true)
      try {
        const res = await requestJson(`/api/storefront-popups/${encodeURIComponent(popupId)}/leads`, { token, query: { limit: 50 } })
        setLeads(res?.leads || [])
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
        else toasts.error('Failed to load leads.')
        setLeads([])
      } finally {
        setLeadsLoading(false)
      }
    },
    [logout, toasts, token]
  )

  useEffect(() => {
    if (!editing.open || editing.mode !== 'edit' || !editing.popupId) return
    void loadLeads(editing.popupId)
  }, [editing.open, editing.mode, editing.popupId, loadLeads])

  function openCreate() {
    setLeads([])
    setForm(emptyForm())
    setEditing({ open: true, mode: 'create', popupId: null })
  }

  function openEdit(popup) {
    const p = popup || {}
    const highlights = Array.isArray(p?.content?.highlights) ? p.content.highlights : []
    const four = [highlights[0] || '', highlights[1] || '', highlights[2] || '', highlights[3] || '']
    setForm({
      name: String(p?.name || ''),
      status: String(p?.status || 'draft'),
      priority: Number(p?.priority ?? 100),
      content: {
        title: String(p?.content?.title || p?.title || ''),
        subtitle: String(p?.content?.subtitle || p?.subtitle || ''),
        imageUrl: String(p?.content?.imageUrl || p?.imageUrl || ''),
        highlights: four,
      },
      presentation: {
        backgroundColor: String(p?.presentation?.backgroundColor || p?.backgroundColor || '#0b1220'),
        textColor: String(p?.presentation?.textColor || p?.textColor || '#ffffff'),
        accentColor: String(p?.presentation?.accentColor || p?.accentColor || '#38bdf8'),
        overlayColor: String(p?.presentation?.overlayColor || p?.overlayColor || ''),
        overlayOpacity: clampNum(p?.presentation?.overlayOpacity ?? p?.overlayOpacity, 0, 0.9, 0.55),
        fontFamily: String(p?.presentation?.fontFamily || ''),
        shape: {
          radiusPx: clampNum(p?.presentation?.shape?.radiusPx ?? p?.shapeRadiusPx, 0, 40, 18),
          widthPx: clampNum(p?.presentation?.shape?.widthPx ?? p?.shapeWidthPx, 280, 560, 420),
        },
        layout: String(p?.presentation?.layout ?? p?.layout ?? 'center'),
        glass: p?.presentation?.glass !== false,
        enterAnimation: String(p?.presentation?.enterAnimation ?? p?.enterAnimation ?? 'pop'),
      },
      form: {
        enabled: p?.form?.enabled !== false,
        fields: {
          name: p?.form?.fields?.name !== false,
          email: p?.form?.fields?.email !== false,
          phone: p?.form?.fields?.phone === true,
        },
        consentText: String(p?.form?.consentText || p?.consentText || ''),
        submitText: String(p?.form?.submitText || p?.submitText || ''),
        successTitle: String(p?.form?.successTitle || p?.successTitle || ''),
        successMessage: String(p?.form?.successMessage || p?.successMessage || ''),
        couponCode: String(p?.form?.couponCode || p?.couponCode || ''),
        redirectUrl: String(p?.form?.redirectUrl || p?.redirectUrl || ''),
      },
      behavior: {
        dismissible: p?.behavior?.dismissible !== false,
        closeOnOverlay: p?.behavior?.closeOnOverlay !== false,
        dismissTtlHours: Number(p?.behavior?.dismissTtlHours ?? p?.dismissTtlHours ?? 72),
        showDelayMs: Number(p?.behavior?.showDelayMs ?? p?.showDelayMs ?? 800),
        frequency: String(p?.behavior?.frequency || p?.frequency || 'once_per_ttl'),
      },
      targeting: { showOn: String(p?.targeting?.showOn || p?.showOn || 'all') },
      scheduling: {
        startAt: p?.scheduling?.startAt ? new Date(p.scheduling.startAt).toISOString() : null,
        endAt: p?.scheduling?.endAt ? new Date(p.scheduling.endAt).toISOString() : null,
      },
    })
    setEditing({ open: true, mode: 'edit', popupId: String(p?._id || '') })
  }

  async function save() {
    const payload = normalizePayload(form)
    if (!payload.name) {
      toasts.warn('Name is required.')
      return
    }
    try {
      if (editing.mode === 'create') {
        await requestJson('/api/storefront-popups', { token, method: 'POST', body: payload })
        toasts.success('Popup created.')
      } else {
        await requestJson(`/api/storefront-popups/${encodeURIComponent(editing.popupId)}`, { token, method: 'PATCH', body: payload })
        toasts.success('Popup saved.')
      }
      setEditing({ open: false, mode: 'create', popupId: null })
      await reload()
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to save popup.')
    }
  }

  async function setStatus(popup, status) {
    try {
      await requestJson(`/api/storefront-popups/${encodeURIComponent(popup._id)}`, { token, method: 'PATCH', body: { status } })
      toasts.success(status === 'active' ? 'Popup activated.' : 'Popup paused.')
      await reload()
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to update popup status.')
    }
  }

  async function remove(popup) {
    try {
      await requestJson(`/api/storefront-popups/${encodeURIComponent(popup._id)}`, { token, method: 'DELETE' })
      toasts.success('Popup deleted.')
      setConfirmDelete({ open: false, popup: null })
      await reload()
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to delete popup.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Storefront Popup</div>
          <div className="mt-1 text-sm text-slate-600">A modal that appears on first visit with a smart form.</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800" onClick={openCreate}>
            New Popup
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            onClick={() => reload()}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? <Loading label="Loading popups…" /> : null}

      {!loading ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
            <div className="col-span-5">Name</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Show On</div>
            <div className="col-span-1">Priority</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {sorted.length ? (
            sorted.map((p) => (
              <div key={p._id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                <div className="col-span-5 min-w-0">
                  <div className="truncate font-semibold text-slate-900">{String(p?.name || '')}</div>
                  <div className="mt-1 truncate text-xs text-slate-600">{String(p?.content?.title || p?.title || '').trim() || '—'}</div>
                </div>
                <div className="col-span-2 text-slate-700">{String(p?.status || 'draft')}</div>
                <div className="col-span-2 text-slate-700">{String(p?.targeting?.showOn || 'all')}</div>
                <div className="col-span-1 text-slate-700">{Number(p?.priority ?? 100)}</div>
                <div className="col-span-2 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50"
                    onClick={() => openEdit(p)}
                  >
                    Edit
                  </button>
                  {String(p?.status) !== 'active' ? (
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      onClick={() => setStatus(p, 'active')}
                    >
                      Activate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                      onClick={() => setStatus(p, 'paused')}
                    >
                      Pause
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    onClick={() => setConfirmDelete({ open: true, popup: p })}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-600">No popups yet.</div>
          )}
        </div>
      ) : null}

      {editing.open ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{editing.mode === 'create' ? 'Create Popup' : 'Edit Popup'}</div>
              <div className="mt-1 text-xs text-slate-600">Keep it short, clean, and readable.</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                onClick={() => setEditing({ open: false, mode: 'create', popupId: null })}
              >
                Cancel
              </button>
              <button type="button" className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800" onClick={save}>
                Save
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-600">Name</div>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  placeholder="e.g. Welcome Offer Popup"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold text-slate-600">Status</div>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                    <option value="paused">paused</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Show On</div>
                  <select
                    value={form.targeting.showOn}
                    onChange={(e) => setForm((prev) => ({ ...prev, targeting: { ...prev.targeting, showOn: e.target.value } }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  >
                    <option value="all">all pages</option>
                    <option value="home">home only</option>
                    <option value="cart">cart/checkout only</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Priority</div>
                  <input
                    value={String(form.priority)}
                    onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold text-slate-700">Behavior</div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Frequency</div>
                    <select
                      value={form.behavior.frequency}
                      onChange={(e) => setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, frequency: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    >
                      <option value="once_per_ttl">once per TTL</option>
                      <option value="once_per_session">once per session</option>
                      <option value="every_pageview">every pageview</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Dismiss TTL (hours)</div>
                    <input
                      value={String(form.behavior.dismissTtlHours)}
                      onChange={(e) => setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, dismissTtlHours: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Show delay</div>
                    <input
                      type="range"
                      min="0"
                      max="20000"
                      step="100"
                      value={String(form.behavior.showDelayMs)}
                      onChange={(e) => setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, showDelayMs: Number(e.target.value) } }))}
                      className="mt-2 w-full"
                    />
                    <div className="mt-1 text-xs text-slate-500">{Math.max(0, Math.min(20000, Number(form.behavior.showDelayMs || 0)))}ms</div>
                  </div>
                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.behavior.dismissible}
                        onChange={(e) => setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, dismissible: e.target.checked } }))}
                      />
                      Dismissible
                    </label>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.behavior.closeOnOverlay}
                        onChange={(e) => setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, closeOnOverlay: e.target.checked } }))}
                      />
                      Close on overlay click
                    </label>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold text-slate-700">Popup Shape</div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Corner radius</div>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      step="1"
                      value={String(form.presentation.shape.radiusPx)}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          presentation: { ...prev.presentation, shape: { ...prev.presentation.shape, radiusPx: Number(e.target.value) } },
                        }))
                      }
                      className="mt-2 w-full"
                    />
                    <div className="mt-1 text-xs text-slate-500">{clampNum(form.presentation.shape.radiusPx, 0, 40, 18)}px</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Width</div>
                    <input
                      type="range"
                      min="280"
                      max="560"
                      step="10"
                      value={String(form.presentation.shape.widthPx)}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          presentation: { ...prev.presentation, shape: { ...prev.presentation.shape, widthPx: Number(e.target.value) } },
                        }))
                      }
                      className="mt-2 w-full"
                    />
                    <div className="mt-1 text-xs text-slate-500">{clampNum(form.presentation.shape.widthPx, 280, 560, 420)}px</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold text-slate-700">Layout</div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Position</div>
                    <select
                      value={form.presentation.layout}
                      onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, layout: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    >
                      <option value="center">center</option>
                      <option value="bottom_left">bottom left</option>
                      <option value="bottom_right">bottom right</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Entrance Animation</div>
                    <select
                      value={form.presentation.enterAnimation}
                      onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, enterAnimation: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    >
                      <option value="none">none</option>
                      <option value="slide">slide</option>
                      <option value="fade">fade</option>
                      <option value="pop">pop</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={form.presentation.glass}
                      onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, glass: e.target.checked } }))}
                    />
                    Glass effect
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-slate-600">Start At</div>
                  <input
                    type="datetime-local"
                    value={isoInputValue(form.scheduling.startAt)}
                    onChange={(e) => setForm((prev) => ({ ...prev, scheduling: { ...prev.scheduling, startAt: parseDateInput(e.target.value) } }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">End At</div>
                  <input
                    type="datetime-local"
                    value={isoInputValue(form.scheduling.endAt)}
                    onChange={(e) => setForm((prev) => ({ ...prev, scheduling: { ...prev.scheduling, endAt: parseDateInput(e.target.value) } }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-slate-600">Title</div>
                <input
                  value={form.content.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, content: { ...prev.content, title: e.target.value } }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  placeholder="e.g. خصم ترحيبي 🎁"
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-600">Subtitle</div>
                <input
                  value={form.content.subtitle}
                  onChange={(e) => setForm((prev) => ({ ...prev, content: { ...prev.content, subtitle: e.target.value } }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  placeholder="Short supportive text"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold text-slate-700">Highlights</div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {form.content.highlights.map((h, idx) => (
                    <input
                      key={idx}
                      value={h}
                      onChange={(e) =>
                        setForm((prev) => {
                          const next = [...prev.content.highlights]
                          next[idx] = e.target.value
                          return { ...prev, content: { ...prev.content, highlights: next } }
                        })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      placeholder={`Bullet ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600">Image URL</div>
                <input
                  value={form.content.imageUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, content: { ...prev.content, imageUrl: e.target.value } }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  placeholder="https://…"
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-slate-600">Font</div>
                <select
                  value={form.presentation.fontFamily}
                  onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, fontFamily: e.target.value } }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                >
                  <option value="">Default</option>
                  <option value="system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">System</option>
                  <option value="Tajawal,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">Tajawal</option>
                  <option value="Cairo,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">Cairo</option>
                  <option value="Almarai,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">Almarai</option>
                  <option value="Noto Kufi Arabic,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">Noto Kufi Arabic</option>
                </select>
                <input
                  value={form.presentation.fontFamily}
                  onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, fontFamily: e.target.value } }))}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  placeholder="Custom font-family (optional)"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-slate-600">Background</div>
                  <input
                    type="color"
                    value={String(form.presentation.backgroundColor || '#0b1220')}
                    onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, backgroundColor: e.target.value } }))}
                    className="mt-1 h-10 w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Text</div>
                  <input
                    type="color"
                    value={String(form.presentation.textColor || '#ffffff')}
                    onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, textColor: e.target.value } }))}
                    className="mt-1 h-10 w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Accent</div>
                  <input
                    type="color"
                    value={String(form.presentation.accentColor || '#38bdf8')}
                    onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, accentColor: e.target.value } }))}
                    className="mt-1 h-10 w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Overlay Color (optional)</div>
                  <input
                    value={form.presentation.overlayColor}
                    onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, overlayColor: e.target.value } }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    placeholder="e.g. rgba(2,6,23,0.6) or #020617"
                  />
                  <div className="mt-2">
                    <div className="text-xs font-semibold text-slate-600">Overlay Opacity</div>
                    <input
                      type="range"
                      min="0"
                      max="0.9"
                      step="0.05"
                      value={String(form.presentation.overlayOpacity)}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, overlayOpacity: Number(e.target.value) } }))
                      }
                      className="mt-2 w-full"
                    />
                    <div className="mt-1 text-xs text-slate-500">{clampNum(form.presentation.overlayOpacity, 0, 0.9, 0.55)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">Form</div>
                    <div className="mt-1 text-xs text-slate-500">Smart form fields + thank you state.</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.form.enabled}
                      onChange={(e) => setForm((prev) => ({ ...prev, form: { ...prev.form, enabled: e.target.checked } }))}
                    />
                    Enabled
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.form.fields.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, form: { ...prev.form, fields: { ...prev.form.fields, name: e.target.checked } } }))}
                      disabled={!form.form.enabled}
                    />
                    Name
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.form.fields.email}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, form: { ...prev.form, fields: { ...prev.form.fields, email: e.target.checked } } }))
                      }
                      disabled={!form.form.enabled}
                    />
                    Email
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={form.form.fields.phone}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, form: { ...prev.form, fields: { ...prev.form.fields, phone: e.target.checked } } }))
                      }
                      disabled={!form.form.enabled}
                    />
                    Phone
                  </label>

                  <div className="sm:col-span-2">
                    <div className="text-xs font-semibold text-slate-600">Consent text (optional)</div>
                    <input
                      value={form.form.consentText}
                      onChange={(e) => setForm((prev) => ({ ...prev, form: { ...prev.form, consentText: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      placeholder="e.g. I agree to receive offers"
                      disabled={!form.form.enabled}
                    />
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-slate-600">Submit text</div>
                    <input
                      value={form.form.submitText}
                      onChange={(e) => setForm((prev) => ({ ...prev, form: { ...prev.form, submitText: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      placeholder="Get offer"
                      disabled={!form.form.enabled}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Coupon code (optional)</div>
                    <input
                      value={form.form.couponCode}
                      onChange={(e) => setForm((prev) => ({ ...prev, form: { ...prev.form, couponCode: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      placeholder="WELCOME10"
                      disabled={!form.form.enabled}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Success title</div>
                    <input
                      value={form.form.successTitle}
                      onChange={(e) => setForm((prev) => ({ ...prev, form: { ...prev.form, successTitle: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      placeholder="Done!"
                      disabled={!form.form.enabled}
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-600">Success message</div>
                    <input
                      value={form.form.successMessage}
                      onChange={(e) => setForm((prev) => ({ ...prev, form: { ...prev.form, successMessage: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      placeholder="Thanks! Your info was saved."
                      disabled={!form.form.enabled}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-xs font-semibold text-slate-600">Redirect URL (optional)</div>
                    <input
                      value={form.form.redirectUrl}
                      onChange={(e) => setForm((prev) => ({ ...prev, form: { ...prev.form, redirectUrl: e.target.value } }))}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      placeholder="https://…"
                      disabled={!form.form.enabled}
                    />
                  </div>
                </div>
              </div>

              {editing.mode === 'edit' && editing.popupId ? (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-700">Leads</div>
                      <div className="mt-1 text-xs text-slate-500">Last 50 submissions.</div>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50"
                      onClick={() => loadLeads(editing.popupId)}
                      disabled={leadsLoading}
                    >
                      {leadsLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                    <div className="grid grid-cols-12 gap-2 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                      <div className="col-span-4">Name</div>
                      <div className="col-span-4">Email</div>
                      <div className="col-span-3">Phone</div>
                      <div className="col-span-1 text-right">At</div>
                    </div>
                    {Array.isArray(leads) && leads.length ? (
                      leads.map((l) => (
                        <div key={l._id} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-slate-700">
                          <div className="col-span-4 truncate">{String(l?.customer?.name || '—')}</div>
                          <div className="col-span-4 truncate">{String(l?.customer?.email || '—')}</div>
                          <div className="col-span-3 truncate">{String(l?.customer?.phone || '—')}</div>
                          <div className="col-span-1 text-right text-[11px] text-slate-500">
                            {l?.createdAt ? new Date(l.createdAt).toLocaleDateString() : '—'}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-center text-xs text-slate-500">{leadsLoading ? 'Loading…' : 'No leads yet.'}</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete.open}
        title="Delete popup?"
        description={`This will remove “${String(confirmDelete.popup?.name || '')}”.`}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete({ open: false, popup: null })}
        onConfirm={() => remove(confirmDelete.popup)}
      />
    </div>
  )
}

