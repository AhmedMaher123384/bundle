import { useMemo, useState } from 'react'
import { useAuth } from '../auth/useAuth.js'
import { useToasts } from '../components/useToasts.js'
import { VariantPicker } from '../components/bundles/VariantPicker.jsx'
import { Badge } from '../components/ui/Badge.jsx'
import { Loading } from '../components/ui/Loading.jsx'
import { requestJson, HttpError } from '../lib/http.js'

export function CartPreviewPage() {
  const { token, logout } = useAuth()
  const toasts = useToasts()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [banner, setBanner] = useState(null)

  function addItem(variant) {
    setItems((prev) => {
      const existing = prev.find((i) => i.variantId === variant.variantId)
      if (existing) return prev.map((i) => (i.variantId === variant.variantId ? { ...i, quantity: i.quantity + 1 } : i))
      return [...prev, { variantId: variant.variantId, quantity: 1 }]
    })
  }

  const totalQty = useMemo(() => items.reduce((acc, i) => acc + Number(i.quantity || 0), 0), [items])

  async function evaluate(createCoupon) {
    setLoading(true)
    try {
      const res = await requestJson('/api/bundles/evaluate', {
        token,
        method: 'POST',
        query: { createCoupon: createCoupon ? 'true' : 'false' },
        body: { items },
      })
      setResult(res)
      const bannerRes = await requestJson('/api/bundles/cart-banner', { token, method: 'POST', body: { items } })
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
        <VariantPicker token={token} onUnauthorized={logout} onPickVariant={addItem} />
      </div>

      <div className="space-y-4 lg:col-span-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-slate-900">Cart Preview</div>
              <div className="mt-1 text-sm text-slate-600">Evaluate bundles against a mock cart using live variant snapshots.</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="slate">{items.length} items</Badge>
              <Badge tone="sky">{totalQty} qty</Badge>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {items.map((it) => (
              <div key={it.variantId} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-slate-700">{it.variantId}</div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={it.quantity}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) => (x.variantId === it.variantId ? { ...x, quantity: Math.max(1, Math.floor(Number(e.target.value || 1))) } : x))
                      )
                    }
                    className="w-20 rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    inputMode="numeric"
                  />
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    onClick={() => setItems((prev) => prev.filter((x) => x.variantId !== it.variantId))}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {!items.length ? <div className="text-sm text-slate-600">Add variants from the picker to start.</div> : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              onClick={() => {
                setItems([])
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
              disabled={loading || !items.length}
            >
              Evaluate
            </button>
            <button
              type="button"
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              onClick={() => evaluate(true)}
              disabled={loading || !items.length}
            >
              Evaluate + Coupon
            </button>
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
                <Badge tone="slate">Applied: {result?.applied?.bundles?.length || 0}</Badge>
                <Badge tone="green">Total: {result?.applied?.totalDiscount || 0}</Badge>
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
