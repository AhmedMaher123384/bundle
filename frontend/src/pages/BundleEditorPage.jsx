import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth.js'
import { useToasts } from '../components/useToasts.js'
import { Loading } from '../components/ui/Loading.jsx'
import { VariantPicker } from '../components/bundles/VariantPicker.jsx'
import { requestAuthedJson, HttpError } from '../lib/http.js'
import { extractProductId, extractVariants } from '../lib/salla.js'

function toInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

function normalizeVariantId(value) {
  const s = String(value || '').trim()
  return s ? s : null
}

function isProductRef(value) {
  return String(value || '').trim().startsWith('product:')
}

function toProductRef(productId) {
  const pid = String(productId || '').trim()
  return pid ? `product:${pid}` : null
}

function groupFromVariantId(variantId) {
  return String(`v:${String(variantId || '').trim()}`).slice(0, 50)
}

function sumQty(components) {
  return (Array.isArray(components) ? components : []).reduce((acc, c) => acc + Math.max(0, toInt(c?.quantity, 0) || 0), 0)
}

function normalizeQtyTiers(input) {
  const arr = Array.isArray(input) ? input : []
  const mapped = arr
    .map((t) => {
      const minQty = Math.max(1, Math.min(999, toInt(t?.minQty, 1)))
      const type = String(t?.type || 'percentage').trim()
      const value = Number(t?.value ?? 0)
      if (!Number.isFinite(value) || value < 0) return null
      if (type !== 'percentage' && type !== 'fixed') return null
      return { minQty, type, value: Number(value) }
    })
    .filter(Boolean)

  mapped.sort((a, b) => a.minQty - b.minQty)
  const byMinQty = new Map()
  for (const t of mapped) byMinQty.set(t.minQty, t)
  const unique = Array.from(byMinQty.values())
  unique.sort((a, b) => a.minQty - b.minQty)
  return unique
}

export function BundleEditorPage({ mode }) {
  const { token, logout } = useAuth()
  const toasts = useToasts()
  const navigate = useNavigate()
  const params = useParams()

  const routeProductId = String(params.productId || '').trim() || null
  const bundleId = String(params.id || '').trim() || null

  const [loading, setLoading] = useState(mode === 'edit')
  const [saving, setSaving] = useState(false)
  const [activating, setActivating] = useState(false)

  const [bundle, setBundle] = useState(null)
  const [product, setProduct] = useState(null)

  const [name, setName] = useState('')
  const [offerType, setOfferType] = useState('quantity')
  const [discountType, setDiscountType] = useState('percentage')
  const [discountValue, setDiscountValue] = useState(10)

  const [baseVariantId, setBaseVariantId] = useState(null)
  const [baseRefMode, setBaseRefMode] = useState('product')
  const [baseQty, setBaseQty] = useState(1)
  const [qtyTiers, setQtyTiers] = useState([{ minQty: 2, type: 'percentage', value: 10 }])

  const [presentationTitle, setPresentationTitle] = useState('')
  const [presentationCta, setPresentationCta] = useState('')
  const [presentationBannerColor, setPresentationBannerColor] = useState('')
  const [presentationBadgeColor, setPresentationBadgeColor] = useState('')

  const [addons, setAddons] = useState([])
  const [variantMetaById, setVariantMetaById] = useState({})
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    if (mode !== 'edit') return
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const res = await requestAuthedJson('/api/bundles', { token, onUnauthorized: logout })
        const all = res?.bundles || []
        const found = all.find((b) => String(b._id) === String(bundleId))
        if (!found) {
          toasts.error('الباندل مش موجود.')
          navigate('/products', { replace: true })
          return
        }

        if (cancelled) return
        setBundle(found)

        const cover = normalizeVariantId(found?.presentation?.coverVariantId) || normalizeVariantId(found?.components?.[0]?.variantId)
        const comps = Array.isArray(found?.components) ? found.components : []
        const coverQty = comps.find((c) => String(c?.variantId) === String(cover))?.quantity ?? 1
        const rest = cover ? comps.filter((c) => String(c?.variantId) !== String(cover)) : comps.slice(1)

        setName(String(found?.name || '').trim())
        setDiscountType(String(found?.rules?.type || 'percentage'))
        setDiscountValue(Number(found?.rules?.value || 0))
        setBaseVariantId(cover)
        setBaseRefMode(isProductRef(cover) ? 'product' : 'variant')
        setPresentationTitle(String(found?.presentation?.title || '').trim())
        setPresentationCta(String(found?.presentation?.cta || '').trim())
        setPresentationBannerColor(String(found?.presentation?.bannerColor || '').trim())
        setPresentationBadgeColor(String(found?.presentation?.badgeColor || '').trim())

        if (rest.length) {
          setOfferType('bundle')
          setBaseQty(Math.max(1, Math.min(999, toInt(coverQty, 1))))
          setAddons(
            rest.map((c) => ({
              variantId: normalizeVariantId(c?.variantId),
              quantity: Math.max(1, Math.min(999, toInt(c?.quantity, 1))),
            }))
          )
        } else {
          setOfferType('quantity')
          const tiers = normalizeQtyTiers(found?.rules?.tiers || [])
          if (tiers.length) {
            setQtyTiers(tiers)
          } else {
            setQtyTiers([
              {
                minQty: Math.max(1, Math.min(999, toInt(coverQty, 1))),
                type: String(found?.rules?.type || 'percentage'),
                value: Number(found?.rules?.value || 0),
              },
            ])
          }
        }
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
        else toasts.error('فشل تحميل الباندل.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [bundleId, logout, mode, navigate, toasts, token])

  const effectiveProductId = useMemo(() => {
    if (routeProductId) return routeProductId
    const b = bundle
    const pid = extractProductId({ id: b?.triggerProductId })
    return pid || null
  }, [bundle, routeProductId])

  useEffect(() => {
    if (!effectiveProductId) return
    let cancelled = false
    async function run() {
      try {
        const res = await requestAuthedJson(`/api/products/${encodeURIComponent(effectiveProductId)}`, {
          token,
          onUnauthorized: logout,
          headers: { 'Cache-Control': 'no-cache' },
        })
        const p = res?.data ?? res?.product ?? res?.data?.data ?? null
        if (!cancelled) setProduct(p)
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
        else if (!cancelled) setProduct(null)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [effectiveProductId, logout, token])

  const productVariants = useMemo(() => {
    return extractVariants(product || {}, { includeDefault: true })
  }, [product])

  const pickDefaultVariantId = useCallback(() => {
    if (!productVariants.length) return null
    const active = productVariants.find((v) => v?.isActive && !v?.needsResolution) || productVariants.find((v) => !v?.needsResolution) || productVariants[0]
    return normalizeVariantId(active?.variantId)
  }, [productVariants])

  useEffect(() => {
    if (baseVariantId) return
    if (effectiveProductId) {
      setBaseVariantId(toProductRef(effectiveProductId))
      setBaseRefMode('product')
      return
    }
    const fallback = pickDefaultVariantId()
    if (fallback) {
      setBaseVariantId(fallback)
      setBaseRefMode(isProductRef(fallback) ? 'product' : 'variant')
    }
  }, [baseVariantId, effectiveProductId, pickDefaultVariantId])

  useEffect(() => {
    if (mode !== 'create') return
    if (!effectiveProductId) return
    setBaseRefMode('product')
    setBaseVariantId(toProductRef(effectiveProductId))
  }, [effectiveProductId, mode])

  useEffect(() => {
    if (name.trim()) return
    const productName = String(product?.name ?? product?.title ?? '').trim()
    if (!productName) return
    setName(`باقة - ${productName}`)
  }, [name, product])

  const baseVariantLabel = useMemo(() => {
    const id = normalizeVariantId(baseVariantId)
    if (!id) return '—'
    if (isProductRef(id)) {
      const productName = String(product?.name ?? product?.title ?? '').trim() || '—'
      return `${productName} (${id})`
    }
    const v = productVariants.find((x) => String(x?.variantId) === String(id)) || null
    return v?.name ? `${v.name} (${id})` : id
  }, [baseVariantId, product, productVariants])

  const addonsWithMeta = useMemo(() => {
    return (Array.isArray(addons) ? addons : []).map((a) => {
      const id = normalizeVariantId(a?.variantId)
      const meta = id ? variantMetaById[id] : null
      const label = meta?.name ? `${meta.name} (${id})` : id || '—'
      return { ...a, variantId: id, label }
    })
  }, [addons, variantMetaById])

  const qtyTiersNormalized = useMemo(() => {
    const normalized = normalizeQtyTiers(qtyTiers)
    return normalized.length ? normalized : [{ minQty: 1, type: 'percentage', value: 0 }]
  }, [qtyTiers])

  const draft = useMemo(() => {
    const baseId = normalizeVariantId(baseVariantId)
    const safeAddons = addonsWithMeta
      .map((a) => ({
        variantId: normalizeVariantId(a.variantId),
        quantity: Math.max(1, Math.min(999, toInt(a.quantity, 1))),
      }))
      .filter((a) => a.variantId)

    const components = []
    if (baseId) {
      const qty = offerType === 'quantity' ? 1 : Math.max(1, Math.min(999, toInt(baseQty, 1)))
      components.push({ variantId: baseId, quantity: qty, group: groupFromVariantId(baseId) })
    }
    if (offerType === 'bundle') {
      for (const a of safeAddons) {
        components.push({ variantId: a.variantId, quantity: a.quantity, group: groupFromVariantId(a.variantId) })
      }
    }

    const requiredQty = offerType === 'quantity' ? Math.max(1, Math.floor(Number(qtyTiersNormalized[0]?.minQty || 1))) : Math.max(1, sumQty(components))
    const primaryTier = offerType === 'quantity' ? qtyTiersNormalized[0] : null

    const presentation = {}
    if (baseId) presentation.coverVariantId = baseId
    if (String(presentationTitle || '').trim()) presentation.title = String(presentationTitle || '').trim()
    if (String(presentationCta || '').trim()) presentation.cta = String(presentationCta || '').trim()
    if (String(presentationBannerColor || '').trim()) presentation.bannerColor = String(presentationBannerColor || '').trim()
    if (String(presentationBadgeColor || '').trim()) presentation.badgeColor = String(presentationBadgeColor || '').trim()

    return {
      version: 1,
      name: String(name || '').trim(),
      status: 'draft',
      components,
      rules: {
        type: offerType === 'quantity' ? (primaryTier?.type === 'fixed' ? 'fixed' : 'percentage') : discountType === 'fixed' ? 'fixed' : discountType === 'bundle_price' ? 'bundle_price' : 'percentage',
        value: offerType === 'quantity' ? Number(primaryTier?.value || 0) : Number(discountValue || 0),
        ...(offerType === 'quantity' ? { tiers: qtyTiersNormalized } : {}),
        eligibility: { mustIncludeAllGroups: true, minCartQty: requiredQty },
        limits: { maxUsesPerOrder: 50 },
      },
      presentation,
    }
  }, [
    addonsWithMeta,
    baseQty,
    baseVariantId,
    discountType,
    discountValue,
    name,
    offerType,
    presentationBadgeColor,
    presentationBannerColor,
    presentationCta,
    presentationTitle,
    qtyTiersNormalized,
  ])

  const canSubmit = useMemo(() => {
    if (!effectiveProductId) return false
    if (!draft.name.trim()) return false
    if (!draft.components.length) return false
    if (offerType === 'bundle' && draft.components.length < 2) return false
    if (offerType === 'quantity') {
      if (!qtyTiersNormalized.length) return false
      if (qtyTiersNormalized.some((t) => !Number.isFinite(Number(t?.minQty)) || Number(t.minQty) < 1)) return false
      if (qtyTiersNormalized.some((t) => (t.type !== 'percentage' && t.type !== 'fixed') || !Number.isFinite(Number(t?.value)) || Number(t.value) < 0))
        return false
    }
    return true
  }, [draft.components.length, draft.name, effectiveProductId, offerType, qtyTiersNormalized])

  const addAddon = useCallback(
    (item) => {
      const id = normalizeVariantId(item?.variantId)
      if (!id) return
      setVariantMetaById((prev) => ({ ...prev, [id]: item }))
      setAddons((prev) => {
        const exists = (Array.isArray(prev) ? prev : []).some((x) => String(x?.variantId) === String(id))
        if (exists) return prev
        return [...(Array.isArray(prev) ? prev : []), { variantId: id, quantity: 1 }]
      })
    },
    [setAddons]
  )

  async function save(status) {
    if (!canSubmit) {
      toasts.error('كمّل البيانات الأول.')
      return
    }
    if (offerType === 'bundle' && draft.components.length < 2) {
      toasts.error('اختار منتج/منتجات تانية مع المنتج الأساسي.')
      return
    }

    const body = { ...draft, status }
    try {
      if (mode === 'create') {
        await requestAuthedJson('/api/bundles', { token, onUnauthorized: logout, method: 'POST', body })
        toasts.success(status === 'active' ? 'تم تفعيل الباندل.' : 'تم حفظ الباندل.')
        navigate('/products', { replace: true })
        return
      }
      await requestAuthedJson(`/api/bundles/${encodeURIComponent(bundleId)}`, {
        token,
        onUnauthorized: logout,
        method: 'PATCH',
        body: { name: body.name, components: body.components, rules: body.rules, presentation: body.presentation, status },
      })
      toasts.success(status === 'active' ? 'تم تفعيل الباندل.' : 'تم تحديث الباندل.')
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) logout()
      else if (err instanceof HttpError && err.code === 'BUNDLE_VARIANTS_INVALID') toasts.error('في منتجات/variants غير صالحة.')
      else toasts.error('حصل خطأ أثناء الحفظ.')
    }
  }

  if (mode === 'create' && !routeProductId) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">لازم تختار منتج الأول.</div>
  }

  if (loading) return <Loading label="Loading…" />

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold text-slate-900">{mode === 'create' ? 'إنشاء باندل' : 'تعديل باندل'}</div>
            <div className="mt-1 text-sm text-slate-600">
              {effectiveProductId ? (
                <span>
                  المنتج: <span className="font-mono text-xs">{effectiveProductId}</span>
                </span>
              ) : (
                'مش قادر أحدد المنتج المرتبط بالباندل.'
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
              onClick={() => {
                setPickerOpen(false)
                setOfferType('quantity')
                setAddons([])
              }}
              disabled={saving || activating}
            >
              خصم كمية
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
              onClick={() => setOfferType('bundle')}
              disabled={saving || activating}
            >
              باندل منتجات
            </button>
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              onClick={async () => {
                setSaving(true)
                try {
                  await save('draft')
                } finally {
                  setSaving(false)
                }
              }}
              disabled={!canSubmit || saving || activating}
            >
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button
              type="button"
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              onClick={async () => {
                setActivating(true)
                try {
                  await save('active')
                } finally {
                  setActivating(false)
                }
              }}
              disabled={!canSubmit || saving || activating}
            >
              {activating ? 'جارٍ التفعيل…' : 'تفعيل'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-sm font-medium text-slate-700">اسم الباندل</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
            />
          </div>

          <div className="md:col-span-2">
            <div className="text-sm font-medium text-slate-700">شكل البانر في صفحة المنتج</div>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-600">عنوان البانر (اختياري)</label>
                <input
                  value={presentationTitle}
                  onChange={(e) => setPresentationTitle(e.target.value)}
                  placeholder="لو فاضي هيكون العنوان تلقائي حسب الخصم"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-600">نص زر الإضافة (اختياري)</label>
                <input
                  value={presentationCta}
                  onChange={(e) => setPresentationCta(e.target.value)}
                  placeholder="مثال: أضف الباقة"
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">لون البانر (اختياري)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#([0-9a-fA-F]{6})$/.test(presentationBannerColor) ? presentationBannerColor : '#0ea5e9'}
                    onChange={(e) => setPresentationBannerColor(e.target.value)}
                    className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1"
                  />
                  <input
                    value={presentationBannerColor}
                    onChange={(e) => setPresentationBannerColor(e.target.value)}
                    placeholder="#0ea5e9"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-600">لون الشارة (اختياري)</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    value={/^#([0-9a-fA-F]{6})$/.test(presentationBadgeColor) ? presentationBadgeColor : '#0ea5e9'}
                    onChange={(e) => setPresentationBadgeColor(e.target.value)}
                    className="h-10 w-12 rounded-lg border border-slate-200 bg-white p-1"
                  />
                  <input
                    value={presentationBadgeColor}
                    onChange={(e) => setPresentationBadgeColor(e.target.value)}
                    placeholder="#0ea5e9"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium text-slate-700">المنتج الأساسي</label>
            {mode !== 'create' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={[
                    'rounded-xl border px-3 py-2 text-sm font-semibold',
                    baseRefMode === 'product'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  ].join(' ')}
                  onClick={() => {
                    setBaseRefMode('product')
                    if (effectiveProductId) setBaseVariantId(toProductRef(effectiveProductId))
                  }}
                  disabled={!effectiveProductId}
                >
                  أي Variant
                </button>
                <button
                  type="button"
                  className={[
                    'rounded-xl border px-3 py-2 text-sm font-semibold',
                    baseRefMode === 'variant'
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white hover:bg-slate-50',
                  ].join(' ')}
                  onClick={() => {
                    setBaseRefMode('variant')
                    const next = pickDefaultVariantId()
                    if (next) setBaseVariantId(next)
                  }}
                  disabled={!productVariants.length}
                >
                  Variant محدد
                </button>
              </div>
            ) : null}

            {mode !== 'create' && baseRefMode === 'variant' ? (
              <select
                value={normalizeVariantId(baseVariantId) || ''}
                onChange={(e) => setBaseVariantId(normalizeVariantId(e.target.value))}
                disabled={!productVariants.length}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4 disabled:opacity-60"
              >
                <option value="">اختار Variant</option>
                {productVariants.map((v) => (
                  <option key={v.variantId} value={v.variantId}>
                    {v.name} ({v.variantId})
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800">{baseVariantLabel}</div>
            )}
            <div className="mt-1 text-xs text-slate-600">المختار: {baseVariantLabel}</div>
          </div>

          {offerType === 'quantity' ? (
            <div className="md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">شرائح الخصم حسب الكمية</div>
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                  onClick={() => {
                    setQtyTiers((prev) => {
                      const current = Array.isArray(prev) ? prev : []
                      const maxMin = current.reduce((acc, t) => Math.max(acc, Math.max(1, Math.min(999, toInt(t?.minQty, 1)))), 1)
                      const nextMinQty = Math.max(1, Math.min(999, maxMin + 1))
                      return [...current, { minQty: nextMinQty, type: 'percentage', value: 10 }]
                    })
                  }}
                >
                  إضافة شريحة
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {(Array.isArray(qtyTiers) ? qtyTiers : []).map((t, idx) => (
                  <div key={`${idx}-${String(t?.minQty || '')}`} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-12 sm:items-end">
                    <div className="sm:col-span-3">
                      <label className="text-xs font-semibold text-slate-600">Min Qty</label>
                      <input
                        value={t?.minQty ?? 1}
                        onChange={(e) => {
                          const nextMin = Math.max(1, Math.min(999, toInt(e.target.value, 1)))
                          setQtyTiers((prev) => (Array.isArray(prev) ? prev.map((x, i) => (i === idx ? { ...x, minQty: nextMin } : x)) : prev))
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4"
                        inputMode="numeric"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      <label className="text-xs font-semibold text-slate-600">Type</label>
                      <select
                        value={t?.type || 'percentage'}
                        onChange={(e) => {
                          const nextType = e.target.value
                          setQtyTiers((prev) => (Array.isArray(prev) ? prev.map((x, i) => (i === idx ? { ...x, type: nextType } : x)) : prev))
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      >
                        <option value="percentage">خصم %</option>
                        <option value="fixed">خصم ثابت</option>
                      </select>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="text-xs font-semibold text-slate-600">Value</label>
                      <input
                        value={t?.value ?? 0}
                        onChange={(e) => {
                          const nextVal = Number(e.target.value || 0)
                          setQtyTiers((prev) => (Array.isArray(prev) ? prev.map((x, i) => (i === idx ? { ...x, value: nextVal } : x)) : prev))
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="sm:col-span-2 sm:flex sm:justify-end">
                      <button
                        type="button"
                        className="w-full rounded-lg px-2 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 sm:w-auto"
                        disabled={(Array.isArray(qtyTiers) ? qtyTiers : []).length <= 1}
                        onClick={() => {
                          setQtyTiers((prev) => (Array.isArray(prev) ? prev.filter((_, i) => i !== idx) : prev))
                        }}
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-slate-700">كمية المنتج الأساسي</label>
                <input
                  value={baseQty}
                  onChange={(e) => setBaseQty(Math.max(1, Math.min(999, toInt(e.target.value, 1))))}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  inputMode="numeric"
                />
              </div>

              <div className="md:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">منتجات الباندل</div>
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                    onClick={() => setPickerOpen((v) => !v)}
                  >
                    {pickerOpen ? 'إخفاء الاختيار' : mode === 'create' || baseRefMode === 'product' ? 'إضافة منتج' : 'إضافة Variant'}
                  </button>
                </div>

                <div className="mt-3 space-y-2">
                  {addonsWithMeta.map((a) => (
                    <div key={a.variantId} className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{a.label}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          value={a.quantity}
                          onChange={(e) => {
                            const nextQty = Math.max(1, Math.min(999, toInt(e.target.value, 1)))
                            setAddons((prev) => (Array.isArray(prev) ? prev.map((x) => (x.variantId === a.variantId ? { ...x, quantity: nextQty } : x)) : prev))
                          }}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4"
                          inputMode="numeric"
                        />
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                          onClick={() => setAddons((prev) => (Array.isArray(prev) ? prev.filter((x) => x.variantId !== a.variantId) : prev))}
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  ))}
                  {!addonsWithMeta.length ? <div className="text-sm text-slate-600">مفيش منتجات مضافة.</div> : null}
                </div>
              </div>

              {pickerOpen ? (
                <div className="md:col-span-2">
                  <VariantPicker
                    token={token}
                    onUnauthorized={logout}
                    mode={mode === 'create' ? 'product' : baseRefMode}
                    {...(mode === 'create' || baseRefMode === 'product'
                      ? {
                          onPickProduct: (p) => {
                            addAddon(p)
                            setPickerOpen(false)
                          },
                        }
                      : {
                          onPickVariant: (v) => {
                            addAddon(v)
                            setPickerOpen(false)
                          },
                        })}
                  />
                </div>
              ) : null}
            </>
          )}

          {offerType === 'bundle' ? (
            <>
              <div>
                <label className="text-sm font-medium text-slate-700">نوع الخصم</label>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                >
                  <option value="percentage">خصم %</option>
                  <option value="fixed">خصم ثابت</option>
                  <option value="bundle_price">سعر ثابت للباندل</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700">{discountType === 'bundle_price' ? 'السعر النهائي للباندل' : 'قيمة الخصم'}</label>
                <input
                  value={discountValue}
                  onChange={(e) => setDiscountValue(Number(e.target.value || 0))}
                  className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                  inputMode="decimal"
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
