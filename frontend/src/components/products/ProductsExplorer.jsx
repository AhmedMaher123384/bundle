import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js'
import { requestAuthedJson, HttpError } from '../../lib/http.js'
import { extractProductId, extractVariants, formatMoney, normalizeProductsResponse } from '../../lib/salla.js'
import { Loading } from '../ui/Loading.jsx'
import { Pagination } from '../ui/Pagination.jsx'
import { Badge } from '../ui/Badge.jsx'

function normalizeProductDetailsResponse(payload) {
  const p = payload?.data ?? payload?.product ?? payload?.data?.data ?? null
  if (p && typeof p === 'object') return p
  return null
}

function VariantStatusBadges({ variant }) {
  const inactive = !variant?.isActive
  const outOfStock = variant?.stock != null && Number(variant.stock) <= 0
  const deleted = String(variant?.status || '') === 'deleted'
  const unresolved = variant?.needsResolution

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {unresolved ? <Badge tone="amber">Needs Resolve</Badge> : null}
      {deleted ? <Badge tone="red">Deleted</Badge> : null}
      {outOfStock ? <Badge tone="amber">Out of Stock</Badge> : null}
      {inactive && !deleted && !outOfStock ? <Badge tone="red">Inactive</Badge> : null}
      {!inactive ? <Badge tone="green">Active</Badge> : null}
    </div>
  )
}

function ProductCardHeader({ product, expanded, onToggle, action }) {
  const productId = extractProductId(product) || '—'
  const name = String(product?.name ?? product?.title ?? '').trim() || '—'
  const status = String(product?.status ?? '').trim().toLowerCase() || '—'
  const imageUrl =
    product?.image?.url ||
    product?.image ||
    (Array.isArray(product?.images) ? product.images[0]?.url || product.images[0] : null) ||
    null

  const statusTone =
    status === 'sale' ? 'green' : status === 'out' ? 'amber' : status === 'draft' || status === 'hidden' ? 'slate' : status === 'deleted' ? 'red' : 'slate'

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl px-4 py-4 hover:bg-slate-50">
      <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-600">{productId}</span>
            <Badge tone={statusTone}>{status}</Badge>
          </div>
        </div>
      </button>

      <div className="shrink-0">
        <div className="flex items-center gap-2">
          {action ? (
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
              onClick={() => action.onClick?.(product)}
              disabled={action.disabled?.(product) || false}
            >
              {action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
            onClick={onToggle}
          >
            {expanded ? 'Hide' : 'Variants'}
          </button>
        </div>
      </div>
    </div>
  )
}

function VariantRow({ variant, enableDrag, action }) {
  const draggable = Boolean(enableDrag && !variant?.needsResolution && String(variant?.variantId || '').trim())
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable) return
        const payload = JSON.stringify({ type: 'variant', variant })
        e.dataTransfer.setData('application/json', payload)
        e.dataTransfer.setData('text/plain', String(variant?.variantId || ''))
      }}
      className={[
        'grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-12 sm:items-center',
        draggable ? 'cursor-grab hover:bg-slate-50' : 'cursor-not-allowed opacity-80',
      ].join(' ')}
    >
      <div className="sm:col-span-5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {variant?.imageUrl ? <img src={variant.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{variant?.name || '—'}</div>
            <div className="mt-0.5 truncate font-mono text-xs text-slate-600">{variant?.variantId || '—'}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {variant?.refType === 'product' ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">منتج بدون خيارات</span>
              ) : null}
              {variant?.sku ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">SKU: {variant.sku}</span> : null}
              {variant?.color ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">Color: {variant.color}</span> : null}
              {variant?.size ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">Size: {variant.size}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="sm:col-span-2">
        <div className="text-xs font-semibold text-slate-600">Price</div>
        <div className="mt-1 text-sm font-semibold text-slate-900">{formatMoney(variant?.price)}</div>
      </div>

      <div className="sm:col-span-2">
        <div className="text-xs font-semibold text-slate-600">Stock</div>
        <div className="mt-1 text-sm font-semibold text-slate-900">{variant?.stock == null ? '—' : variant.stock}</div>
      </div>

      <div className="sm:col-span-2">
        <div className="text-xs font-semibold text-slate-600">Status</div>
        <div className="mt-1">
          <VariantStatusBadges variant={variant} />
        </div>
      </div>

      <div className="sm:col-span-1 sm:flex sm:justify-end">
        {action ? (
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold hover:bg-slate-50 sm:w-auto"
            onClick={() => action.onClick?.(variant)}
            disabled={action.disabled?.(variant)}
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function ProductsExplorer({
  token,
  onUnauthorized,
  title,
  subtitle,
  initialStatus = 'all',
  initialPerPage = 50,
  action,
  productAction,
  enableDrag = true,
  showFilters = true,
  refreshKey = 0,
}) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(initialPerPage)
  const [status, setStatus] = useState(initialStatus)
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [productsPayload, setProductsPayload] = useState(null)

  const [expanded, setExpanded] = useState({})
  const [detailsById, setDetailsById] = useState({})
  const [visibleCountById, setVisibleCountById] = useState({})

  const normalized = useMemo(() => normalizeProductsResponse(productsPayload || {}), [productsPayload])

  const totalPages = useMemo(() => {
    const pg = normalized.pagination
    const tp =
      Number(pg?.total_pages ?? pg?.totalPages ?? null) ||
      (Number(pg?.total ?? null) && perPage ? Math.ceil(Number(pg.total) / perPage) : null) ||
      null
    return tp || 1
  }, [normalized.pagination, perPage])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function run() {
      setLoading(true)
      setError('')
      try {
        const query = {
          page,
          per_page: perPage,
          status: status === 'all' ? undefined : status,
          category: category ? Number(category) : undefined,
          search: debouncedSearch || undefined,
          keyword: debouncedSearch || undefined,
        }
        const res = await requestAuthedJson('/api/products', {
          token,
          query,
          signal: controller.signal,
          onUnauthorized,
          headers: { 'Cache-Control': 'no-cache' },
        })
        if (!cancelled) setProductsPayload(res)
      } catch (err) {
        if (err instanceof HttpError && err.code === 'REQUEST_ABORTED') return
        if (!cancelled) {
          setProductsPayload(null)
          if (err instanceof HttpError && err.status === 429) setError('Salla rate limit reached (429). Please retry shortly.')
          else setError(err instanceof HttpError ? err.message : 'Failed to fetch live products from Salla.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [category, debouncedSearch, onUnauthorized, page, perPage, refreshKey, status, token])

  const loadProductDetails = useCallback(
    async (productId) => {
      const pid = String(productId || '').trim()
      if (!pid) return null
      if (detailsById[pid]?.product) return detailsById[pid].product

      setDetailsById((prev) => ({ ...prev, [pid]: { loading: true, product: prev[pid]?.product || null, error: '' } }))
      try {
        const res = await requestAuthedJson(`/api/products/${encodeURIComponent(pid)}`, {
          token,
          onUnauthorized,
          headers: { 'Cache-Control': 'no-cache' },
        })
        const product = normalizeProductDetailsResponse(res)
        setDetailsById((prev) => ({ ...prev, [pid]: { loading: false, product, error: product ? '' : 'Empty product payload' } }))
        return product
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : 'Failed to load product variants.'
        setDetailsById((prev) => ({ ...prev, [pid]: { loading: false, product: prev[pid]?.product || null, error: msg } }))
        return null
      }
    },
    [detailsById, onUnauthorized, token]
  )

  const resolveVariantIfNeeded = useCallback(
    async (variant) => {
      if (!variant?.needsResolution) return variant
      const productId = String(variant?.productId || '').trim()
      if (!productId) return variant
      const product = await loadProductDetails(productId)
      if (!product) return variant
      const full = extractVariants(product, { includeDefault: true })
      const best = full.find((x) => !x?.needsResolution) || full[0] || null
      return best || variant
    },
    [loadProductDetails]
  )

  function toggleExpand(product) {
    const productId = extractProductId(product)
    if (!productId) return
    setExpanded((prev) => {
      const next = { ...prev, [productId]: !prev[productId] }
      return next
    })
    if (!expanded[productId]) {
      setVisibleCountById((prev) => (prev[productId] ? prev : { ...prev, [productId]: 20 }))
      loadProductDetails(productId)
    }
  }

  return (
    <div className="space-y-4">
      {title || subtitle ? (
        <div>
          {title ? <div className="text-lg font-semibold text-slate-900">{title}</div> : null}
          {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
        </div>
      ) : null}

      {showFilters ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
            <div className="lg:col-span-2">
              <label className="text-sm font-medium text-slate-700">Search</label>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Product name, SKU, keyword…"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Status</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setPage(1)
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
              >
                <option value="all">All</option>
                <option value="sale">Sale</option>
                <option value="out">Out</option>
                <option value="draft">Draft</option>
                <option value="hidden">Hidden</option>
                <option value="deleted">Deleted</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Category (ID)</label>
              <input
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value.replace(/[^\d]/g, ''))
                  setPage(1)
                }}
                placeholder="e.g. 123"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Min Price</label>
              <input
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Max Price</label>
              <input
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="999"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700">Per Page</label>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value))
                  setPage(1)
                }}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? <Loading label="Fetching live products…" /> : null}
      {!loading && error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}

      {!loading && !error ? (
        <div className="space-y-3">
          {normalized.products.map((p) => {
            const productId = extractProductId(p)
            const isExpanded = Boolean(productId && expanded[productId])
            const detailState = productId ? detailsById[productId] : null
            const detailProduct = detailState?.product || null
            const variantsRaw = extractVariants(detailProduct || p, { includeDefault: true })
            const min = minPrice ? Number(minPrice) : null
            const max = maxPrice ? Number(maxPrice) : null
            const variants =
              min == null && max == null
                ? variantsRaw
                : variantsRaw.filter((v) => {
                    const price = v?.price
                    if (!Number.isFinite(Number(price))) return false
                    if (min != null && Number(price) < min) return false
                    if (max != null && Number(price) > max) return false
                    return true
                  })
            const visibleCount = productId ? Number(visibleCountById[productId] || 20) : 20
            const showMore = variants.length > visibleCount
            const shown = showMore ? variants.slice(0, visibleCount) : variants

            return (
              <div key={productId || String(p?.name || '')} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <ProductCardHeader product={p} expanded={isExpanded} onToggle={() => toggleExpand(p)} action={productAction} />
                {isExpanded ? (
                  <div className="border-t border-slate-200 px-4 py-4">
                    {detailState?.loading ? <Loading label="Loading variants…" /> : null}
                    {!detailState?.loading && detailState?.error ? (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{detailState.error}</div>
                    ) : null}

                    <div className="space-y-2">
                      {shown.map((v) => (
                        <VariantRow
                          key={v.variantId}
                          variant={v}
                          enableDrag={enableDrag}
                          action={
                            action
                              ? {
                                  ...action,
                                  onClick: async (variant) => {
                                    const resolved = await resolveVariantIfNeeded(variant)
                                    action.onClick?.(resolved)
                                  },
                                  disabled: (variant) => {
                                    return action.disabled?.(variant) || false
                                  },
                                }
                              : null
                          }
                        />
                      ))}
                    </div>
                    {!shown.length ? <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">No variants match current filters.</div> : null}

                    {showMore ? (
                      <div className="mt-3 flex items-center justify-between">
                        <div className="text-xs text-slate-600">
                          Showing <span className="font-semibold text-slate-900">{shown.length}</span> of{' '}
                          <span className="font-semibold text-slate-900">{variants.length}</span> variants
                        </div>
                        <button
                          type="button"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50"
                          onClick={() => setVisibleCountById((prev) => ({ ...prev, [productId]: variants.length }))}
                        >
                          Show all
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}

          {!normalized.products.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No products found for current filters.</div>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
