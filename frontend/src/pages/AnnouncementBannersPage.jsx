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

function emptyForm() {
  return {
    name: '',
    status: 'draft',
    priority: 100,
    content: { title: '', message: '', linkUrl: '', linkText: '' },
    presentation: {
      backgroundColor: '#0f172a',
      textColor: '#ffffff',
      linkColor: '#38bdf8',
      accentColor: '',
      sticky: true,
      motion: { enabled: false, durationSec: 18 },
    },
    behavior: { dismissible: true, selectable: true, dismissTtlHours: 72 },
    targeting: { showOn: 'all' },
    scheduling: { startAt: null, endAt: null },
  }
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
      message: String(f.content?.message || '').trim() || null,
      linkUrl: String(f.content?.linkUrl || '').trim() || null,
      linkText: String(f.content?.linkText || '').trim() || null,
    },
    presentation: {
      backgroundColor: String(f.presentation?.backgroundColor || '').trim() || null,
      textColor: String(f.presentation?.textColor || '').trim() || null,
      linkColor: String(f.presentation?.linkColor || '').trim() || null,
      accentColor: String(f.presentation?.accentColor || '').trim() || null,
      sticky: f.presentation?.sticky !== false,
      motion: {
        enabled: f.presentation?.motion?.enabled === true,
        durationSec: Math.max(6, Math.min(60, Number(f.presentation?.motion?.durationSec ?? 18))),
      },
    },
    behavior: {
      dismissible: f.behavior?.dismissible !== false,
      selectable: f.behavior?.selectable !== false,
      dismissTtlHours: Math.max(0, Math.min(24 * 365, Number(f.behavior?.dismissTtlHours ?? 72))),
    },
    targeting: { showOn: String(f.targeting?.showOn || 'all') },
    scheduling: {
      startAt: f.scheduling?.startAt ? String(f.scheduling.startAt) : null,
      endAt: f.scheduling?.endAt ? String(f.scheduling.endAt) : null,
    },
  }
}

export function AnnouncementBannersPage() {
  const { token, logout } = useAuth()
  const toasts = useToasts()

  const [loading, setLoading] = useState(true)
  const [banners, setBanners] = useState([])

  const [editing, setEditing] = useState({ open: false, mode: 'create', bannerId: null })
  const [form, setForm] = useState(() => emptyForm())

  const [confirmDelete, setConfirmDelete] = useState({ open: false, banner: null })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await requestJson('/api/announcement-banners', { token })
      setBanners(res?.banners || [])
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to load banners.')
      setBanners([])
    } finally {
      setLoading(false)
    }
  }, [logout, toasts, token])

  useEffect(() => {
    void reload()
  }, [reload])

  const sorted = useMemo(() => {
    const arr = Array.isArray(banners) ? [...banners] : []
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
  }, [banners])

  function openCreate() {
    setForm(emptyForm())
    setEditing({ open: true, mode: 'create', bannerId: null })
  }

  function openEdit(banner) {
    const b = banner || {}
    setForm({
      name: String(b?.name || ''),
      status: String(b?.status || 'draft'),
      priority: Number(b?.priority ?? 100),
      content: {
        title: String(b?.content?.title || b?.title || ''),
        message: String(b?.content?.message || b?.message || ''),
        linkUrl: String(b?.content?.linkUrl || b?.linkUrl || ''),
        linkText: String(b?.content?.linkText || b?.linkText || ''),
      },
      presentation: {
        backgroundColor: String(b?.presentation?.backgroundColor || b?.backgroundColor || '#0f172a'),
        textColor: String(b?.presentation?.textColor || b?.textColor || '#ffffff'),
        linkColor: String(b?.presentation?.linkColor || b?.linkColor || '#38bdf8'),
        accentColor: String(b?.presentation?.accentColor || b?.accentColor || ''),
        sticky: b?.presentation?.sticky !== false,
        motion: {
          enabled: b?.presentation?.motion?.enabled === true,
          durationSec: Number(b?.presentation?.motion?.durationSec ?? 18),
        },
      },
      behavior: {
        dismissible: b?.behavior?.dismissible !== false,
        selectable: b?.behavior?.selectable !== false,
        dismissTtlHours: Number(b?.behavior?.dismissTtlHours ?? 72),
      },
      targeting: { showOn: String(b?.targeting?.showOn || b?.showOn || 'all') },
      scheduling: {
        startAt: b?.scheduling?.startAt ? new Date(b.scheduling.startAt).toISOString() : null,
        endAt: b?.scheduling?.endAt ? new Date(b.scheduling.endAt).toISOString() : null,
      },
    })
    setEditing({ open: true, mode: 'edit', bannerId: String(b?._id || '') })
  }

  async function save() {
    const payload = normalizePayload(form)
    if (!payload.name) {
      toasts.warn('Name is required.')
      return
    }
    try {
      if (editing.mode === 'create') {
        await requestJson('/api/announcement-banners', { token, method: 'POST', body: payload })
        toasts.success('Banner created.')
      } else {
        await requestJson(`/api/announcement-banners/${encodeURIComponent(editing.bannerId)}`, {
          token,
          method: 'PATCH',
          body: payload,
        })
        toasts.success('Banner saved.')
      }
      setEditing({ open: false, mode: 'create', bannerId: null })
      await reload()
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to save banner.')
    }
  }

  async function setStatus(banner, status) {
    try {
      await requestJson(`/api/announcement-banners/${encodeURIComponent(banner._id)}`, { token, method: 'PATCH', body: { status } })
      toasts.success(status === 'active' ? 'Banner activated.' : 'Banner paused.')
      await reload()
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to update banner status.')
    }
  }

  async function remove(banner) {
    try {
      await requestJson(`/api/announcement-banners/${encodeURIComponent(banner._id)}`, { token, method: 'DELETE' })
      toasts.success('Banner deleted.')
      setConfirmDelete({ open: false, banner: null })
      await reload()
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else toasts.error('Failed to delete banner.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-900">Top Announcement Banner</div>
          <div className="mt-1 text-sm text-slate-600">Manage the top bar that appears on the storefront (and cart).</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800" onClick={openCreate}>
            New Banner
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

      {loading ? <Loading label="Loading banners…" /> : null}

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
            sorted.map((b) => (
              <div key={b._id} className="grid grid-cols-12 gap-2 px-4 py-3 text-sm">
                <div className="col-span-5 min-w-0">
                  <div className="truncate font-semibold text-slate-900">{String(b?.name || '')}</div>
                  <div className="mt-1 truncate text-xs text-slate-600">
                    {String(b?.content?.title || b?.content?.message || '').trim() || '—'}
                  </div>
                </div>
                <div className="col-span-2 text-slate-700">{String(b?.status || 'draft')}</div>
                <div className="col-span-2 text-slate-700">{String(b?.targeting?.showOn || 'all')}</div>
                <div className="col-span-1 text-slate-700">{Number(b?.priority ?? 100)}</div>
                <div className="col-span-2 flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-50"
                    onClick={() => openEdit(b)}
                  >
                    Edit
                  </button>
                  {String(b?.status) !== 'active' ? (
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                      onClick={() => setStatus(b, 'active')}
                    >
                      Activate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                      onClick={() => setStatus(b, 'paused')}
                    >
                      Pause
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    onClick={() => setConfirmDelete({ open: true, banner: b })}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-sm text-slate-600">No banners yet.</div>
          )}
        </div>
      ) : null}

      {editing.open ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{editing.mode === 'create' ? 'Create Banner' : 'Edit Banner'}</div>
              <div className="mt-1 text-xs text-slate-600">Use short text. Keep colors readable.</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                onClick={() => setEditing({ open: false, mode: 'create', bannerId: null })}
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
                  placeholder="e.g. New Year Sale"
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
                    <option value="cart">cart/checkout only</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-slate-600">Priority</div>
                  <input
                    value={String(form.priority)}
                    onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    inputMode="numeric"
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    checked={form.presentation.sticky}
                    onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, sticky: e.target.checked } }))}
                  />
                  <div className="text-sm font-semibold text-slate-700">Sticky top</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    checked={form.presentation.motion.enabled}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        presentation: { ...prev.presentation, motion: { ...prev.presentation.motion, enabled: e.target.checked } },
                      }))
                    }
                  />
                  <div className="text-sm font-semibold text-slate-700">Marquee</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Motion speed</div>
                  <input
                    value={String(form.presentation.motion.durationSec)}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        presentation: { ...prev.presentation, motion: { ...prev.presentation.motion, durationSec: e.target.value } },
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    inputMode="numeric"
                    disabled={!form.presentation.motion.enabled}
                  />
                  <div className="mt-1 text-xs text-slate-500">Seconds per loop (6–60). Lower = faster.</div>
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
                  placeholder="e.g. خصم 20% لفترة محدودة"
                />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-600">Message</div>
                <input
                  value={form.content.message}
                  onChange={(e) => setForm((prev) => ({ ...prev, content: { ...prev.content, message: e.target.value } }))}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  placeholder="Short supportive text"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-slate-600">Link URL</div>
                  <input
                    value={form.content.linkUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, content: { ...prev.content, linkUrl: e.target.value } }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    placeholder="https://…"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Link Text</div>
                  <input
                    value={form.content.linkText}
                    onChange={(e) => setForm((prev) => ({ ...prev, content: { ...prev.content, linkText: e.target.value } }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    placeholder="اعرف أكثر"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-slate-600">Background</div>
                  <input
                    type="color"
                    value={String(form.presentation.backgroundColor || '#0f172a')}
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
                  <div className="text-xs font-semibold text-slate-600">Link</div>
                  <input
                    type="color"
                    value={String(form.presentation.linkColor || '#38bdf8')}
                    onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, linkColor: e.target.value } }))}
                    className="mt-1 h-10 w-full cursor-pointer rounded-xl border border-slate-200 bg-white p-1"
                  />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600">Accent (optional)</div>
                  <input
                    value={form.presentation.accentColor}
                    onChange={(e) => setForm((prev) => ({ ...prev, presentation: { ...prev.presentation, accentColor: e.target.value } }))}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    placeholder="#f59e0b"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    checked={form.behavior.dismissible}
                    onChange={(e) => setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, dismissible: e.target.checked } }))}
                  />
                  <div className="text-sm font-semibold text-slate-700">Dismissible</div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    checked={form.behavior.selectable}
                    onChange={(e) => setForm((prev) => ({ ...prev, behavior: { ...prev.behavior, selectable: e.target.checked } }))}
                  />
                  <div className="text-sm font-semibold text-slate-700">Selectable text</div>
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
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-600">Preview</div>
                <div
                  className="mt-2 rounded-lg px-3 py-2 text-center text-sm font-semibold"
                  style={{
                    background: form.presentation.backgroundColor || '#0f172a',
                    color: form.presentation.textColor || '#ffffff',
                  }}
                >
                  <span className="font-extrabold">{String(form.content.title || '').trim() ? `${form.content.title} ` : ''}</span>
                  <span className="opacity-95">{String(form.content.message || '').trim() ? `${form.content.message} ` : ''}</span>
                  {String(form.content.linkUrl || '').trim() && String(form.content.linkText || '').trim() ? (
                    <span style={{ color: form.presentation.linkColor || '#38bdf8', textDecoration: 'underline' }}>{form.content.linkText}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmDelete.open}
        title="Delete banner?"
        message="This will soft-delete the banner and pause it."
        confirmText="Delete"
        onCancel={() => setConfirmDelete({ open: false, banner: null })}
        onConfirm={() => remove(confirmDelete.banner)}
      />
    </div>
  )
}
