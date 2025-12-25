export class HttpError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const ENV_API_BASE_URL = import.meta.env.VITE_API_BASE_URL
const API_BASE_URL =
  ENV_API_BASE_URL ||
  (import.meta.env.PROD && window.location.hostname.endsWith('netlify.app')
    ? 'https://bundle-phi.vercel.app'
    : window.location.origin)

function safeJsonParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function requestJson(path, { method = 'GET', token, query, body, headers, signal } = {}) {
  // Single JSON client used across dashboard:
  // - Sends `Authorization: Bearer <merchantAccessToken>` when `token` exists
  // - Throws `HttpError` with normalized `{ status, code, details }` for toast + auth handling
  const url = new URL(path, API_BASE_URL)
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v == null || v === '') continue
      url.searchParams.set(k, String(v))
    }
  }

  let response
  try {
    const ngrokHeaders = API_BASE_URL.includes('ngrok') ? { 'ngrok-skip-browser-warning': '1' } : {}
    response = await fetch(url.toString(), {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...ngrokHeaders,
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    throw new HttpError(aborted ? 'Request cancelled' : 'Network error while calling API', {
      status: 0,
      code: aborted ? 'REQUEST_ABORTED' : 'NETWORK_ERROR',
      details: { message: String(err?.message || err || '') },
    })
  }

  const text = await response.text()
  const json = text ? safeJsonParse(text) : null

  if (!response.ok) {
    const message = json?.message || json?.error || response.statusText || 'Request failed'
    const code = json?.code || json?.meta?.code || json?.error?.code || null
    const details = json?.details || json?.meta?.details || json?.error?.details || json
    throw new HttpError(message, { status: response.status, code, details })
  }

  if (text && json == null) {
    const contentType = response.headers.get('content-type') || null
    throw new HttpError('Invalid JSON response from API', {
      status: response.status,
      code: 'INVALID_JSON',
      details: { contentType, sample: text.slice(0, 300) },
    })
  }

  return json
}

export async function requestAuthedJson(path, { onUnauthorized, ...opts } = {}) {
  try {
    return await requestJson(path, opts)
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      onUnauthorized?.()
    }
    throw err
  }
}
