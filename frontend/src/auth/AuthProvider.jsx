import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocalStorage } from '../hooks/useLocalStorage.js'
import { requestJson, HttpError } from '../lib/http.js'
import { useToasts } from '../components/useToasts.js'
import { AuthContext, STORAGE_KEY } from './authContext.js'

export function AuthProvider({ children }) {
  // Token is stored client-side (merchant dashboard UX). Backend validates + refreshes its stored token per request.
  const [token, setToken] = useLocalStorage(STORAGE_KEY, '')
  const navigate = useNavigate()
  const toasts = useToasts()

  const logout = useCallback(() => {
    setToken('')
    navigate('/login', { replace: true })
  }, [navigate, setToken])

  const login = useCallback(
    async (nextToken) => {
      const t = String(nextToken || '').trim()
      if (!t) {
        toasts.error('Please provide a valid merchant access token.')
        return { ok: false }
      }

      try {
        await requestJson('/api/bundles', { token: t, query: { status: 'draft' } })
      } catch (err) {
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
          toasts.error('Token is invalid or merchant is inactive.')
          return { ok: false }
        }
        toasts.error('Network error while validating token.')
        return { ok: false }
      }

      setToken(t)
      navigate('/', { replace: true })
      return { ok: true }
    },
    [navigate, setToken, toasts]
  )

  const api = useMemo(() => ({ token: String(token || '').trim(), login, logout }), [login, logout, token])

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>
}
