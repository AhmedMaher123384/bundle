function toAmount(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const amount = value?.amount ?? value?.value ?? null
  if (amount == null) return null
  const n = Number(amount)
  return Number.isFinite(n) ? n : null
}

function toInt(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

export function normalizeProductsResponse(payload) {
  const products = payload?.data || payload?.products || []
  const pagination = payload?.pagination || payload?.meta?.pagination || null

  return {
    products: Array.isArray(products) ? products : [],
    pagination: pagination || null,
  }
}

export function extractProductCategoryName(product) {
  return (
    product?.category?.name ||
    product?.category?.title ||
    product?.category_name ||
    (Array.isArray(product?.categories) ? product.categories[0]?.name : null) ||
    null
  )
}

export function extractProductId(product) {
  return String(product?.id ?? product?.product_id ?? product?.productId ?? '').trim() || null
}

function extractFirstImageUrl(obj) {
  const candidates = []
    .concat(obj?.image)
    .concat(obj?.images)
    .concat(obj?.photos)
    .concat(obj?.media)
    .filter(Boolean)

  for (const c of candidates) {
    if (typeof c === 'string') {
      const s = c.trim()
      if (s) return s
      continue
    }
    if (c && typeof c === 'object') {
      const url =
        c?.url ||
        c?.src ||
        c?.original ||
        c?.full ||
        c?.medium ||
        c?.small ||
        c?.path ||
        (c?.data && typeof c.data === 'object' ? c.data?.url : null)
      if (url) return String(url).trim() || null
    }
  }
  return null
}

function extractSku(variant, product) {
  const sku =
    variant?.sku ||
    variant?.sku_code ||
    variant?.skuCode ||
    variant?.code ||
    variant?.barcode ||
    variant?.identifier ||
    product?.sku ||
    product?.sku_code ||
    product?.skuCode ||
    null
  return sku ? String(sku).trim() || null : null
}

function normalizeAttributes(attrs) {
  const out = {}
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      const key = String(a?.name ?? a?.key ?? '').trim().toLowerCase()
      const val = String(a?.value ?? a?.title ?? a?.label ?? '').trim()
      if (!key || !val) continue
      out[key] = val
    }
  } else if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) {
      const key = String(k || '').trim().toLowerCase()
      const val = String(v || '').trim()
      if (!key || !val) continue
      out[key] = val
    }
  }
  return out
}

function pickAttribute(attributes, keys) {
  const entries = Object.entries(attributes || {})
  for (const [k, v] of entries) {
    const kk = String(k || '').toLowerCase()
    if (keys.some((x) => kk === x || kk.includes(x))) return String(v || '').trim() || null
  }
  return null
}

export function extractVariants(product, options = {}) {
  const raw =
    product?.variants?.data ||
    product?.variants ||
    product?.skus?.data ||
    product?.skus ||
    product?.options?.variants ||
    []

  const arr = Array.isArray(raw) ? raw : []
  const productId = extractProductId(product)
  const productImageUrl = extractFirstImageUrl(product)
  const mapped = arr
    .map((v) => {
      const variantId = String(v?.id ?? v?.variant_id ?? v?.variantId ?? '').trim()
      if (!variantId) return null

      const stock =
        toInt(v?.stock_quantity ?? v?.quantity ?? v?.stock ?? v?.inventory_quantity ?? null, null)
      const unlimited = v?.unlimited_quantity === true
      const outOfStock = unlimited ? false : stock != null ? stock <= 0 : false

      const status = String(v?.status ?? v?.state ?? v?.product_status ?? product?.status ?? '').trim().toLowerCase()
      const isAvailable = v?.is_available === false ? false : true
      const visible = !['draft', 'hidden', 'deleted', 'unavailable'].includes(status)
      const isActive = Boolean(isAvailable && visible && !outOfStock)

      const name =
        v?.name ||
        v?.title ||
        product?.name ||
        product?.title ||
        ''

      const price =
        toAmount(v?.price) ??
        toAmount(v?.sale_price) ??
        toAmount(v?.regular_price) ??
        toAmount(v?.base_price) ??
        toAmount(product?.price) ??
        null

      const attrs =
        v?.attributes ||
        v?.options ||
        v?.values ||
        product?.options ||
        []
      const attributes = normalizeAttributes(attrs)
      const color = pickAttribute(attributes, ['color', 'colour', 'لون'])
      const size = pickAttribute(attributes, ['size', 'مقاس'])

      const imageUrl = extractFirstImageUrl(v) || productImageUrl

      return {
        productId,
        productName: String(product?.name ?? product?.title ?? '').trim() || '—',
        categoryName: extractProductCategoryName(product),
        variantId,
        name: String(name).trim() || '—',
        sku: extractSku(v, product),
        color,
        size,
        price,
        stock,
        status: status || null,
        isActive,
        attributes,
        imageUrl,
        productImageUrl,
        isDefaultVariant: false,
        refType: 'variant',
        needsResolution: false,
        raw: v,
      }
    })
    .filter(Boolean)

  if (mapped.length) return mapped
  if (!options?.includeDefault) return []

  const fallbackVariantId =
    String(product?.default_variant_id ?? product?.defaultVariantId ?? product?.variant_id ?? product?.variantId ?? '').trim() ||
    ''

  const variantId = productId ? `product:${productId}` : fallbackVariantId || `product:${Date.now()}`
  const status = String(product?.status ?? '').trim().toLowerCase() || null
  const price = toAmount(product?.price) ?? toAmount(product?.sale_price) ?? toAmount(product?.regular_price) ?? null
  const stock = toInt(product?.stock_quantity ?? product?.quantity ?? product?.stock ?? null, null)
  const unlimited = product?.unlimited_quantity === true
  const outOfStock = unlimited ? false : stock != null ? stock <= 0 : false
  const isAvailable = product?.is_available === false ? false : true
  const visible = !['draft', 'hidden', 'deleted', 'unavailable'].includes(status || '')
  const isActive = Boolean(isAvailable && visible && !outOfStock)
  const refType = variantId.startsWith('product:') ? 'product' : 'variant'
  const needsResolution = refType === 'product' ? !productId : !fallbackVariantId

  return [
    {
      productId,
      productName: String(product?.name ?? product?.title ?? '').trim() || '—',
      categoryName: extractProductCategoryName(product),
      variantId,
      name: String(product?.name ?? product?.title ?? '').trim() || '—',
      sku: extractSku(null, product),
      color: null,
      size: null,
      price,
      stock,
      status,
      isActive,
      attributes: {},
      imageUrl: productImageUrl,
      productImageUrl,
      isDefaultVariant: true,
      refType,
      needsResolution,
      raw: product,
    },
  ]
}

export function formatMoney(amount) {
  if (!Number.isFinite(Number(amount))) return '—'
  return Number(amount).toFixed(2)
}

export function normalizeVariantFromVariantPayload(payload) {
  const v = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  if (!v || typeof v !== 'object') return null
  const variantId = String(v?.id ?? v?.variant_id ?? v?.variantId ?? '').trim()
  if (!variantId) return null

  const stock = toInt(v?.stock_quantity ?? v?.quantity ?? v?.stock ?? v?.inventory_quantity ?? null, null)
  const unlimited = v?.unlimited_quantity === true
  const outOfStock = unlimited ? false : stock != null ? stock <= 0 : false

  const status = String(v?.status ?? v?.state ?? v?.product_status ?? '').trim().toLowerCase()
  const isAvailable = v?.is_available === false ? false : true
  const visible = !['draft', 'hidden', 'deleted', 'unavailable'].includes(status)
  const isActive = Boolean(isAvailable && visible && !outOfStock)

  const price =
    toAmount(v?.price) ??
    toAmount(v?.sale_price) ??
    toAmount(v?.regular_price) ??
    toAmount(v?.base_price) ??
    null

  const attributes = normalizeAttributes(v?.attributes || v?.options || v?.values || [])
  const color = pickAttribute(attributes, ['color', 'colour', 'لون'])
  const size = pickAttribute(attributes, ['size', 'مقاس'])
  const productId = String(v?.product_id ?? v?.productId ?? '').trim() || null

  const productName = String(v?.product_name ?? v?.productName ?? '').trim() || '—'
  const name = String(v?.name ?? v?.title ?? '').trim() || '—'
  const imageUrl = extractFirstImageUrl(v)

  return {
    productId,
    productName,
    categoryName: null,
    variantId,
    name,
    sku: extractSku(v, null),
    color,
    size,
    price,
    stock,
    status: status || null,
    isActive,
    attributes,
    imageUrl,
    productImageUrl: null,
    isDefaultVariant: false,
    needsResolution: false,
    raw: v,
  }
}
