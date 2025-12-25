import { useMemo, useState } from 'react'
import { Badge } from '../ui/Badge.jsx'

function uniqGroupName(existing, base) {
  const set = new Set(existing)
  if (!set.has(base)) return base
  for (let i = 2; i < 1000; i += 1) {
    const n = `${base}-${i}`
    if (!set.has(n)) return n
  }
  return `${base}-${Date.now()}`
}

export function BundleBuilder({ components, onChangeComponents, variantMetaById, variantLiveById, missingVariantById, onVariantMeta }) {
  const [newGroup, setNewGroup] = useState('')

  const groups = useMemo(() => {
    const map = new Map()
    for (const c of Array.isArray(components) ? components : []) {
      const g = String(c.group || '').trim()
      if (!g) continue
      const arr = map.get(g) || []
      arr.push(c)
      map.set(g, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [components])

  function addComponent(group, variantInput) {
    const variantId = typeof variantInput === 'string' ? variantInput : variantInput?.variantId
    const vid = String(variantId || '').trim()
    const g = String(group || '').trim()
    if (!vid || !g) return
    if (variantInput && typeof variantInput === 'object') onVariantMeta?.(variantInput)
    onChangeComponents([
      ...(Array.isArray(components) ? components : []),
      { variantId: vid, quantity: 1, group: g },
    ])
  }

  function updateAt(index, patch) {
    const next = [...(Array.isArray(components) ? components : [])]
    next[index] = { ...next[index], ...patch }
    onChangeComponents(next)
  }

  function removeAt(index) {
    const next = [...(Array.isArray(components) ? components : [])]
    next.splice(index, 1)
    onChangeComponents(next)
  }

  function renameGroup(fromGroup, toGroup) {
    const from = String(fromGroup || '').trim()
    const to = String(toGroup || '').trim().slice(0, 50)
    if (!from || !to || from === to) return
    const existing = Array.from(new Set((components || []).map((c) => String(c.group || '').trim()).filter(Boolean)))
    const name = uniqGroupName(existing.filter((g) => g !== from), to)
    const next = (Array.isArray(components) ? components : []).map((c) => (String(c.group || '').trim() === from ? { ...c, group: name } : c))
    onChangeComponents(next)
  }

  function deleteGroup(group) {
    const g = String(group || '').trim()
    if (!g) return
    const next = (Array.isArray(components) ? components : []).filter((c) => String(c.group || '').trim() !== g)
    onChangeComponents(next)
  }

  function moveComponent(fromIndex, toIndex) {
    const from = Number(fromIndex)
    const to = Number(toIndex)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return
    const arr = [...(Array.isArray(components) ? components : [])]
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return
    const [item] = arr.splice(from, 1)
    arr.splice(to, 0, item)
    onChangeComponents(arr)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Bundle Builder</div>
          <div className="mt-1 text-xs text-slate-600">
            Add items, drag into groups, then preview. Prices/stock stay live from Salla (IDs only).
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="slate">{components.length} components</Badge>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-900">Groups</div>
          <div className="text-xs text-slate-600">Drop a variant into any group, or create a new group dropzone.</div>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="text-xs font-semibold text-slate-700">New Group Dropzone</div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Type group name, then drop a variant here…"
              className="w-full flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none ring-slate-900/10 focus:ring-4"
            />
            <div className="text-xs text-slate-600 sm:w-40">Example: group-a</div>
          </div>
          <div
            className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-600"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              let variant = null
              const json = e.dataTransfer.getData('application/json')
              if (json) {
                try {
                  const parsed = JSON.parse(json)
                  if (parsed?.type === 'variant' && parsed?.variant) variant = parsed.variant
                } catch {
                  variant = null
                }
              }
              const variantId = String(variant?.variantId || e.dataTransfer.getData('text/plain') || '').trim()
              if (!variantId) return
              const g = String(newGroup || '').trim()
              if (!g) return
              const current = Array.from(new Set((components || []).map((c) => String(c.group || '').trim()).filter(Boolean)))
              const name = uniqGroupName(current, g)
              setNewGroup('')
              addComponent(name, variant || variantId)
            }}
          >
            Drop a variant here to create the group.
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map(([groupName, items]) => (
            <GroupColumn
              key={groupName}
              group={groupName}
              items={items}
              allComponents={components}
              onDropVariant={(variant) => addComponent(groupName, variant)}
              onUpdate={(componentIndex, patch) => updateAt(componentIndex, patch)}
              onRemove={(componentIndex) => removeAt(componentIndex)}
              onRenameGroup={renameGroup}
              onDeleteGroup={deleteGroup}
              onMove={moveComponent}
              variantMetaById={variantMetaById}
              variantLiveById={variantLiveById}
              missingVariantById={missingVariantById}
            />
          ))}

          {!groups.length ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              Create a group, then drag variants into it.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function GroupColumn({
  group,
  items,
  allComponents,
  onDropVariant,
  onUpdate,
  onRemove,
  onRenameGroup,
  onDeleteGroup,
  onMove,
  variantMetaById,
  variantLiveById,
  missingVariantById,
}) {
  const [editing, setEditing] = useState(false)
  const [nextName, setNextName] = useState(group)

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const jsonComponent = e.dataTransfer.getData('application/x-bundle-component')
        if (jsonComponent) {
          try {
            const parsed = JSON.parse(jsonComponent)
            const fromIndex = Number(parsed?.index)
            const fromGroup = String(parsed?.group || '').trim()
            if (!Number.isFinite(fromIndex)) return
            if (fromGroup !== String(group || '').trim()) return
            const toIndex = allComponents.findIndex((c) => String(c.group || '').trim() === group)
            if (toIndex >= 0) onMove?.(fromIndex, toIndex)
            return
          } catch {
            return
          }
        }
        let variant = null
        const json = e.dataTransfer.getData('application/json')
        if (json) {
          try {
            const parsed = JSON.parse(json)
            if (parsed?.type === 'variant' && parsed?.variant) variant = parsed.variant
          } catch {
            variant = null
          }
        }
        const variantId = String(variant?.variantId || e.dataTransfer.getData('text/plain') || '').trim()
        if (!variantId) return
        onDropVariant(variant || variantId)
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          {!editing ? <div className="truncate text-sm font-semibold text-slate-900">{group}</div> : null}
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={nextName}
                onChange={(e) => setNextName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none ring-slate-900/10 focus:ring-4"
              />
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                onClick={() => {
                  onRenameGroup?.(group, nextName)
                  setEditing(false)
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setNextName(group)
                  setEditing(false)
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="slate">{items.length}</Badge>
          {!editing ? (
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold hover:bg-slate-50"
              onClick={() => {
                setNextName(group)
                setEditing(true)
              }}
            >
              Rename
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            onClick={() => onDeleteGroup?.(group)}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="p-3">
        <div className="space-y-2">
          {items.map((c) => {
            const idx = allComponents.indexOf(c)
            const meta = variantMetaById ? variantMetaById[c.variantId] : null
            const live = variantLiveById ? variantLiveById[c.variantId] : null
            const missing = missingVariantById ? missingVariantById[c.variantId] : null
            const name = String(meta?.name || live?.name || '').trim() || '—'
            const sku = meta?.sku ? String(meta.sku) : live?.sku ? String(live.sku) : null
            const attrs = meta?.attributes || live?.attributes || null
            const color = meta?.color ? String(meta.color) : attrs?.color ? String(attrs.color) : null
            const size = meta?.size ? String(meta.size) : attrs?.size ? String(attrs.size) : null
            const imageUrl = meta?.imageUrl || meta?.productImageUrl || live?.imageUrl || null
            const price = live?.price ?? meta?.price ?? null
            const stock = live?.stock ?? meta?.stock ?? null
            const isActive = live?.isActive ?? meta?.isActive ?? false
            const status = String(live?.status ?? meta?.status ?? '').trim() || null
            const loading = meta == null && live == null && !missing
            const insufficientStock = stock != null && Number.isFinite(Number(stock)) && Number(stock) < Number(c.quantity || 0)
            return (
              <div
                key={`${c.variantId}:${idx}`}
                className="rounded-xl border border-slate-200 bg-white p-3"
                draggable
                onDragStart={(e) => {
                  const payload = JSON.stringify({ type: 'bundle-component', index: idx, group })
                  e.dataTransfer.setData('application/x-bundle-component', payload)
                  e.dataTransfer.setData('text/plain', String(c.variantId || ''))
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const jsonComponent = e.dataTransfer.getData('application/x-bundle-component')
                  if (!jsonComponent) return
                  try {
                    const parsed = JSON.parse(jsonComponent)
                    const fromIndex = Number(parsed?.index)
                    const fromGroup = String(parsed?.group || '').trim()
                    if (!Number.isFinite(fromIndex)) return
                    if (fromGroup !== String(group || '').trim()) return
                    onMove?.(fromIndex, idx)
                  } catch {
                    return
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
                        {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-900">{loading ? 'Loading…' : name}</div>
                        <div className="mt-0.5 truncate font-mono text-xs text-slate-600">{c.variantId || '—'}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {sku ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">SKU: {sku}</span> : null}
                          {color ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">Color: {color}</span> : null}
                          {size ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">Size: {size}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {missing ? <Badge tone="red">Missing</Badge> : null}
                      {insufficientStock ? <Badge tone="amber">Insufficient stock</Badge> : null}
                      <Badge tone={isActive ? 'green' : 'red'}>{isActive ? 'Active' : 'Inactive'}</Badge>
                      {status ? <Badge tone="slate">{status}</Badge> : null}
                      <span className="text-xs text-slate-600">
                        Price <span className="font-semibold text-slate-900">{price == null ? '—' : Number(price).toFixed(2)}</span>
                      </span>
                      <span className="text-xs text-slate-600">
                        Stock <span className="font-semibold text-slate-900">{stock == null ? '—' : stock}</span>
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    onClick={() => onRemove(idx)}
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3 flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-slate-600" title="How many units required from this item per bundle use">
                      Quantity
                    </label>
                    <input
                      value={c.quantity}
                      onChange={(e) => onUpdate(idx, { quantity: Math.max(1, Math.floor(Number(e.target.value || 1))) })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="w-32">
                    <label className="text-xs font-semibold text-slate-600" title="Group name: used by matching rules (must include all groups)">
                      Group
                    </label>
                    <input
                      value={c.group}
                      onChange={(e) => onUpdate(idx, { group: String(e.target.value || '').slice(0, 50) })}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none ring-slate-900/10 focus:ring-4"
                    />
                  </div>
                </div>
              </div>
            )
          })}

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-600">
            Drop variants here
          </div>
        </div>
      </div>
    </div>
  )
}
