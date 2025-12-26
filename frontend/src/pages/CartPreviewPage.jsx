import { useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { useToasts } from '../components/useToasts.js'
import { VariantPicker } from '../components/bundles/VariantPicker.jsx'
import { Badge } from '../components/ui/Badge.jsx'
import { Loading } from '../components/ui/Loading.jsx'
import { requestJson, HttpError } from '../lib/http.js'
import { extractVariants, formatMoney } from '../lib/salla.js'

export function CartPreviewPage() {
  const { token, logout } = useAuth()
  const toasts = useToasts()

  const [productLines, setProductLines] = useState([])
  const [variantsByProductId, setVariantsByProductId] = useState({})
  const [loadingVariantsByProductId, setLoadingVariantsByProductId] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [banner, setBanner] = useState(null)

  async function loadProductVariants(productId) {
    const pid = String(productId || '').trim()
    if (!pid) return
    if (Array.isArray(variantsByProductId[pid]) && variantsByProductId[pid].length) return
    if (loadingVariantsByProductId[pid]) return
    setLoadingVariantsByProductId((prev) => ({ ...prev, [pid]: true }))
    try {
      const res = await requestJson(`/api/products/${encodeURIComponent(pid)}`, {
        token,
        headers: { 'Cache-Control': 'no-cache' },
      })
      const product = res?.data ?? res?.product ?? res?.data?.data ?? null
      const variants = extractVariants(product || {}, { includeDefault: true })
      setVariantsByProductId((prev) => ({ ...prev, [pid]: variants }))
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else if (err instanceof HttpError && err.status === 429) toasts.warn('Rate limited (429). Please retry shortly.')
      else toasts.error('Failed to load product variants.')
      setVariantsByProductId((prev) => ({ ...prev, [pid]: [] }))
    } finally {
      setLoadingVariantsByProductId((prev) => ({ ...prev, [pid]: false }))
    }
  }

  function addProduct(product) {
    const pid = String(product?.productId || '').trim()
    if (!pid) return
    void loadProductVariants(pid)
    setProductLines((prev) => {
      const current = Array.isArray(prev) ? prev : []
      const existing = current.find((l) => String(l.productId) === pid) || null
      if (!existing) return [...current, { productId: pid, name: String(product?.name || '').trim() || pid, slots: [null] }]
      return current.map((l) => (String(l.productId) === pid ? { ...l, slots: [...(Array.isArray(l.slots) ? l.slots : []), null] } : l))
    })
  }

  function removeProduct(productId) {
    const pid = String(productId || '').trim()
    if (!pid) return
    setProductLines((prev) => (Array.isArray(prev) ? prev.filter((l) => String(l.productId) !== pid) : []))
  }

  function setProductQty(productId, nextQty) {
    const pid = String(productId || '').trim()
    const qty = Math.max(1, Math.min(999, Math.floor(Number(nextQty || 1))))
    if (!pid) return
    setProductLines((prev) => {
      const current = Array.isArray(prev) ? prev : []
      return current.map((l) => {
        if (String(l.productId) !== pid) return l
        const slots = Array.isArray(l.slots) ? l.slots : []
        if (slots.length === qty) return l
        if (slots.length < qty) return { ...l, slots: [...slots, ...Array.from({ length: qty - slots.length }).map(() => null)] }
        return { ...l, slots: slots.slice(0, qty) }
      })
    })
  }

  function setSlotVariant(productId, index, variantId) {
    const pid = String(productId || '').trim()
    const idx = Math.max(0, Math.floor(Number(index || 0)))
    const vid = String(variantId || '').trim() || null
    if (!pid) return
    setProductLines((prev) => {
      const current = Array.isArray(prev) ? prev : []
      return current.map((l) => {
        if (String(l.productId) !== pid) return l
        const slots = Array.isArray(l.slots) ? [...l.slots] : []
        if (idx < 0 || idx >= slots.length) return l
        slots[idx] = vid
        return { ...l, slots }
      })
    })
  }

  const selectedItems = useMemo(() => {
    const counts = new Map()
    for (const line of Array.isArray(productLines) ? productLines : []) {
      for (const slot of Array.isArray(line?.slots) ? line.slots : []) {
        const vid = String(slot || '').trim()
        if (!vid) continue
        counts.set(vid, (counts.get(vid) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .map(([variantId, quantity]) => ({ variantId, quantity }))
      .sort((a, b) => String(a.variantId).localeCompare(String(b.variantId)))
  }, [productLines])

  const missingSelections = useMemo(() => {
    for (const line of Array.isArray(productLines) ? productLines : []) {
      const slots = Array.isArray(line?.slots) ? line.slots : []
      if (slots.some((s) => !String(s || '').trim())) return true
    }
    return false
  }, [productLines])

  const variantMetaById = useMemo(() => {
    const map = new Map()
    for (const variants of Object.values(variantsByProductId || {})) {
      for (const v of Array.isArray(variants) ? variants : []) {
        const id = String(v?.variantId || '').trim()
        if (!id) continue
        if (!map.has(id)) map.set(id, v)
      }
    }
    return map
  }, [variantsByProductId])

  const subtotal = useMemo(() => {
    let sum = 0
    for (const it of selectedItems) {
      const meta = variantMetaById.get(String(it.variantId))
      const unit = Number(meta?.price)
      const qty = Number(it.quantity || 0)
      if (!Number.isFinite(unit) || unit < 0) continue
      if (!Number.isFinite(qty) || qty <= 0) continue
      sum += unit * qty
    }
    return sum
  }, [selectedItems, variantMetaById])

  const totalQty = useMemo(() => selectedItems.reduce((acc, i) => acc + Number(i.quantity || 0), 0), [selectedItems])

  async function evaluate(createCoupon) {
    setLoading(true)
    try {
      const res = await requestJson('/api/bundles/evaluate', {
        token,
        method: 'POST',
        query: { createCoupon: createCoupon ? 'true' : 'false' },
        body: { items: selectedItems },
      })
      setResult(res)
      const bannerRes = await requestJson('/api/bundles/cart-banner', { token, method: 'POST', body: { items: selectedItems } })
      setBanner(bannerRes)
      toasts.success('Cart evaluated.')
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else if (err instanceof HttpError && err.status === 429) toasts.warn('Rate limited (429). Please retry shortly.')
      else toasts.error('Failed to evaluate cart.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-4">
        <VariantPicker token={token} onUnauthorized={logout} mode="product" onPickProduct={addProduct} />
      </div>

      <div className="space-y-4 lg:col-span-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-slate-900">Cart Preview</div>
              <div className="mt-1 text-sm text-slate-600">Evaluate bundles against a mock cart using live variant snapshots.</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="slate">{selectedItems.length} items</Badge>
              <Badge tone="sky">{totalQty} qty</Badge>
              <Badge tone="slate">{formatMoney(subtotal)}</Badge>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {(Array.isArray(productLines) ? productLines : []).map((line) => {
              const pid = String(line?.productId || '').trim()
              const name = String(line?.name || '').trim() || pid
              const slots = Array.isArray(line?.slots) ? line.slots : []
              const variants = Array.isArray(variantsByProductId[pid]) ? variantsByProductId[pid] : []
              const isLoading = Boolean(loadingVariantsByProductId[pid])

              const lineTotal = slots.reduce((acc, s) => {
                const vid = String(s || '').trim()
                if (!vid) return acc
                const meta = variantMetaById.get(vid)
                const unit = Number(meta?.price)
                if (!Number.isFinite(unit) || unit < 0) return acc
                return acc + unit
              }, 0)

              return (
                <div key={pid} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
                      <div className="mt-1 font-mono text-xs text-slate-600">{pid}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="slate">{slots.length} qty</Badge>
                      <Badge tone="slate">{formatMoney(lineTotal)}</Badge>
                      <button
                        type="button"
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        onClick={() => removeProduct(pid)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-900">Variants per qty</div>
                    <div className="flex items-center gap-2">
                      <input
                        value={slots.length}
                        onChange={(e) => setProductQty(pid, e.target.value)}
                        className="w-20 rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4"
                        inputMode="numeric"
                      />
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-60"
                        onClick={() => loadProductVariants(pid)}
                        disabled={isLoading}
                      >
                        {isLoading ? 'Loading…' : 'Reload'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {slots.map((slot, idx) => {
                      const vid = String(slot || '').trim()
                      const meta = vid ? variantMetaById.get(vid) : null
                      const unit = Number(meta?.price)
                      return (
                        <div key={`${pid}-${idx}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-slate-600">Qty #{idx + 1}</div>
                            <select
                              value={vid || ''}
                              onChange={(e) => setSlotVariant(pid, idx, e.target.value)}
                              disabled={isLoading || !variants.length}
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4 disabled:opacity-60"
                            >
                              <option value="">{isLoading ? 'Loading…' : !variants.length ? 'No variants' : 'Select variant'}</option>
                              {variants.map((v) => (
                                <option key={String(v.variantId)} value={String(v.variantId)}>
                                  {String(v?.name || '—')} - {formatMoney(v?.price)}
                                </option>
                              ))}
                            </select>
                            {vid ? <div className="mt-1 font-mono text-[11px] text-slate-500">{vid}</div> : null}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-xs font-semibold text-slate-600">Price</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{Number.isFinite(unit) ? formatMoney(unit) : '—'}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {!productLines.length ? <div className="text-sm text-slate-600">Add products from the picker to start.</div> : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              onClick={() => {
                setProductLines([])
                setResult(null)
                setBanner(null)
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={() => evaluate(false)}
              disabled={loading || !productLines.length || missingSelections || !selectedItems.length}
            >
              Evaluate
            </button>
            <button
              type="button"
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              onClick={() => evaluate(true)}
              disabled={loading || !productLines.length || missingSelections || !selectedItems.length}
            >
              Evaluate + Coupon
            </button>
            {missingSelections ? <div className="text-sm font-semibold text-rose-700">Select all variants first.</div> : null}
          </div>
        </div>

        {loading ? <Loading label="Evaluating cart…" /> : null}

        {banner ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-900">Live Banner</div>
            <div className="mt-2 text-sm text-slate-700">{banner?.banner?.title || '—'}</div>
            {banner?.hasDiscount ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge tone="green">{banner.discountAmount}</Badge>
                <Badge tone="sky">{banner.couponCode}</Badge>
              </div>
            ) : (
              <div className="mt-2 text-sm text-slate-600">No discount currently.</div>
            )}
          </div>
        ) : null}

        {result ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">Evaluation Result</div>
              <div className="flex items-center gap-2">
                <Badge tone="slate">Subtotal: {formatMoney(subtotal)}</Badge>
                <Badge tone="slate">Applied: {result?.applied?.bundles?.length || 0}</Badge>
                <Badge tone="green">Total: {result?.applied?.totalDiscount || 0}</Badge>
                <Badge tone="green">After: {formatMoney(Math.max(0, subtotal - Number(result?.applied?.totalDiscount || 0)))}</Badge>
                {result?.coupon?.code ? <Badge tone="sky">{result.coupon.code}</Badge> : null}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {(result?.bundles || []).map((b) => (
                <div key={b.bundle?._id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{b.bundle?.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{b.bundle?._id}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.applied ? <Badge tone="green">Applied</Badge> : b.matched ? <Badge tone="amber">Matched</Badge> : <Badge tone="slate">No Match</Badge>}
                      <Badge tone="slate">Uses {b.uses}</Badge>
                      <Badge tone="green">{b.discountAmount}</Badge>
                    </div>
                  </div>
                </div>
              ))}
              {!result?.bundles?.length ? <div className="text-sm text-slate-600">No active bundles evaluated.</div> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
