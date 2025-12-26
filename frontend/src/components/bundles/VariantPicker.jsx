import { ProductsExplorer } from '../products/ProductsExplorer.jsx'
import { extractProductId, extractVariants } from '../../lib/salla.js'

function toProductRef(productId) {
  const pid = String(productId || '').trim()
  return pid ? `product:${pid}` : null
}

export function VariantPicker({ token, onUnauthorized, onPickVariant, onPickProduct, mode = 'variant' }) {
  const isProductMode = String(mode) === 'product'
  return (
    <ProductsExplorer
      token={token}
      onUnauthorized={onUnauthorized}
      title={isProductMode ? 'Product Picker' : 'Variant Picker'}
      subtitle={isProductMode ? 'اختار منتج واضغط Add.' : 'اختار Variant واضغط Add.'}
      initialStatus="all"
      initialPerPage={50}
      productAction={
        isProductMode && onPickProduct
          ? {
              label: 'Add',
              onClick: (product) => {
                const pid = extractProductId(product)
                if (!pid) return
                const variants = extractVariants(product || {}, { includeDefault: true })
                const fallbackName = String(product?.name ?? product?.title ?? '').trim() || '—'
                onPickProduct({
                  variantId: toProductRef(pid),
                  productId: pid,
                  name: fallbackName,
                  refType: 'product',
                  isActive: variants.some((v) => v?.isActive && !v?.needsResolution) || true,
                  needsResolution: false,
                })
              },
              disabled: (p) => !extractProductId(p),
            }
          : null
      }
      action={
        !isProductMode && onPickVariant
          ? {
              label: 'Add',
              onClick: onPickVariant,
              disabled: (v) => !v?.isActive || v?.needsResolution,
            }
          : null
      }
      enableDrag={false}
      showFilters
    />
  )
}
