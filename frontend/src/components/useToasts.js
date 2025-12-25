import { useContext } from 'react'
import { ToastContext } from './toastContext.js'

export function useToasts() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToasts must be used within ToastProvider')
  return ctx
}

