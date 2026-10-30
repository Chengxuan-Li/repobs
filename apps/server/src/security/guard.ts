import type { IncomingMessage } from 'node:http'

// Host/Origin validation against DNS rebinding and cross-site requests. The server binds to
// loopback only; additionally every request must name a loopback host with our port, and any
// Origin header must be one of our own origins. No CORS headers are ever sent.

export interface OriginPolicy {
  port: number
  /** Extra exact origins (dev UI), e.g. http://127.0.0.1:5173. */
  extraOrigins?: string[]
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]']

export function allowedHosts(policy: OriginPolicy): Set<string> {
  const hosts = new Set(LOOPBACK_HOSTS.map((h) => `${h}:${policy.port}`))
  for (const o of policy.extraOrigins ?? []) {
    try {
      hosts.add(new URL(o).host)
    } catch {
      // ignore malformed
    }
  }
  return hosts
}

export function allowedOrigins(policy: OriginPolicy): Set<string> {
  return new Set([...LOOPBACK_HOSTS.map((h) => `http://${h}:${policy.port}`), ...(policy.extraOrigins ?? [])])
}

export function checkHostAndOrigin(
  req: IncomingMessage,
  policy: OriginPolicy,
): { ok: true } | { ok: false; reason: 'bad_host' | 'bad_origin' } {
  const host = (req.headers.host ?? '').toLowerCase()
  if (!allowedHosts(policy).has(host)) return { ok: false, reason: 'bad_host' }
  const origin = req.headers.origin
  if (origin !== undefined && !allowedOrigins(policy).has(origin.toLowerCase())) return { ok: false, reason: 'bad_origin' }
  // Browsers send Sec-Fetch-Site; reject explicit cross-site requests even without Origin.
  const site = req.headers['sec-fetch-site']
  if (site === 'cross-site') return { ok: false, reason: 'bad_origin' }
  return { ok: true }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k && !(k in out)) out[k] = decodeURIComponent(v)
  }
  return out
}

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ')
