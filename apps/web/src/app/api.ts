import { API_PREFIX, CSRF_HEADER } from '@repobs/contracts'

// Thin fetch wrapper. The session cookie is HttpOnly (never visible here); the CSRF token is kept
// in memory only, never in localStorage.

let csrfToken: string | undefined

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function setCsrfToken(token: string | undefined) {
  csrfToken = token
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken
  let res: Response
  try {
    res = await fetch(API_PREFIX + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'offline', 'The repobs server is not reachable. Is it still running?')
  }
  const text = await res.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? `Request failed (${res.status})`)
  }
  return data as T
}

/** Exchange a one-time pairing token from the URL fragment, or resume an existing session. */
export async function establishSession(): Promise<'paired' | 'unpaired'> {
  const match = /(?:^#|&)pair=([^&]+)/.exec(window.location.hash)
  if (match) {
    // Remove the token from the address bar and history immediately.
    history.replaceState(null, '', window.location.pathname + window.location.search)
    try {
      const res = await api<{ csrfToken: string }>('POST', '/auth/pair', { token: decodeURIComponent(match[1]!) })
      setCsrfToken(res.csrfToken)
      return 'paired'
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) throw err
      // Fall through: an older valid cookie may still work.
    }
  }
  try {
    const res = await api<{ csrfToken: string }>('GET', '/auth/session')
    setCsrfToken(res.csrfToken)
    return 'paired'
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return 'unpaired'
    throw err
  }
}
