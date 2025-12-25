import { ProductsExplorer } from '../products/ProductsExplorer.jsx'

export function VariantPicker({ token, onUnauthorized, onPickVariant }) {
  return (
    <ProductsExplorer
      token={token}
      onUnauthorized={onUnauthorized}
      title="Variant Picker"
      subtitle="اختار Variant واضغط Add."
      initialStatus="all"
      initialPerPage={50}
      action={
        onPickVariant
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
