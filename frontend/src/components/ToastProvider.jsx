import { useCallback, useMemo, useState } from 'react'
import { ToastContext } from './toastContext.js'

function uid() {
  return `${Date.now()}:${Math.random().toString(16).slice(2)}`
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((toast) => {
    const id = uid()
    const payload = {
      id,
      type: toast?.type || 'info',
      title: toast?.title || null,
      message: toast?.message || '',
      createdAt: Date.now(),
      timeoutMs: typeof toast?.timeoutMs === 'number' ? toast.timeoutMs : 4500,
    }

    setItems((prev) => [payload, ...prev].slice(0, 5))
    if (payload.timeoutMs > 0) {
      window.setTimeout(() => remove(id), payload.timeoutMs)
    }
  }, [remove])

  const api = useMemo(() => {
    return {
      push,
      success: (message, title) => push({ type: 'success', title: title || 'Success', message }),
      error: (message, title) => push({ type: 'error', title: title || 'Error', message }),
      info: (message, title) => push({ type: 'info', title: title || 'Info', message }),
      warn: (message, title) => push({ type: 'warn', title: title || 'Warning', message }),
    }
  }, [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onClose }) {
  const stylesByType = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    error: 'border-rose-200 bg-rose-50 text-rose-950',
    warn: 'border-amber-200 bg-amber-50 text-amber-950',
    info: 'border-sky-200 bg-sky-50 text-sky-950',
  }

  return (
    <div
      className={[
        'w-full max-w-xl rounded-xl border px-4 py-3 shadow-sm backdrop-blur',
        stylesByType[toast.type] || stylesByType.info,
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {toast.title ? <div className="text-sm font-semibold">{toast.title}</div> : null}
          <div className="mt-0.5 break-words text-sm">{toast.message}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xs font-medium hover:bg-black/5"
        >
          Close
        </button>
      </div>
    </div>
  )
}
