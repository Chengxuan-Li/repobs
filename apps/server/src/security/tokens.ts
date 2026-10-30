import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// Local pairing (docs/privacy-security.md):
//   * A per-install 32-byte secret lives in the app data directory (user profile, not the repo).
//   * The launcher, which can read that secret, mints a short-lived single-use pairing token and
//     opens http://127.0.0.1:<port>/#pair=<token>. The fragment is never sent over HTTP.
//   * The page exchanges it (POST /api/v1/auth/pair) for an HttpOnly, SameSite=Strict session
//     cookie signed with the secret. State-changing requests also need a CSRF token derived from
//     the session nonce, which the page keeps in memory only.

export const PAIRING_TTL_MS = 5 * 60_000
export const SESSION_TTL_MS = 12 * 60 * 60_000

export function loadOrCreateSecret(dataDir: string): Buffer {
  const file = path.join(dataDir, 'secret.key')
  fs.mkdirSync(dataDir, { recursive: true })
  try {
    const hex = fs.readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
  } catch {
    // create below
  }
  const secret = randomBytes(32)
  fs.writeFileSync(file, secret.toString('hex'), { mode: 0o600 })
  return secret
}

const sign = (secret: Buffer, purpose: string, ...parts: string[]) =>
  createHmac('sha256', secret).update([purpose, ...parts].join('|')).digest('base64url')

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function mintPairingToken(secret: Buffer, now = Date.now()): string {
  const exp = String(now + PAIRING_TTL_MS)
  const nonce = randomBytes(16).toString('base64url')
  return `p1.${exp}.${nonce}.${sign(secret, 'pair', exp, nonce)}`
}

export class TokenService {
  private readonly secret: Buffer
  private readonly usedPairingNonces = new Map<string, number>()
  /** Logged-out session nonces (in memory; sessions also expire after SESSION_TTL_MS). */
  private readonly revoked = new Map<string, number>()

  constructor(secret: Buffer) {
    this.secret = secret
  }

  mintPairingToken(now = Date.now()): string {
    return mintPairingToken(this.secret, now)
  }

  /** Verify and consume a pairing token (single use). */
  consumePairingToken(token: string, now = Date.now()): boolean {
    const parts = token.split('.')
    if (parts.length !== 4 || parts[0] !== 'p1') return false
    const [, exp, nonce, sig] = parts as [string, string, string, string]
    const expMs = Number(exp)
    if (!Number.isFinite(expMs) || expMs < now || expMs > now + PAIRING_TTL_MS + 60_000) return false
    if (!safeEqual(sig, sign(this.secret, 'pair', exp, nonce))) return false
    for (const [n, e] of this.usedPairingNonces) if (e < now) this.usedPairingNonces.delete(n)
    if (this.usedPairingNonces.has(nonce)) return false
    this.usedPairingNonces.set(nonce, expMs)
    return true
  }

  mintSession(now = Date.now()): { cookie: string; csrf: string; expiresAt: string } {
    const exp = String(now + SESSION_TTL_MS)
    const nonce = randomBytes(16).toString('base64url')
    const cookie = `s1.${exp}.${nonce}.${sign(this.secret, 'session', exp, nonce)}`
    return { cookie, csrf: this.csrfFor(nonce), expiresAt: new Date(Number(exp)).toISOString() }
  }

  /** Returns the session nonce when the cookie value is valid. */
  verifySession(value: string | undefined, now = Date.now()): { nonce: string; expiresAt: string } | undefined {
    if (!value) return undefined
    const parts = value.split('.')
    if (parts.length !== 4 || parts[0] !== 's1') return undefined
    const [, exp, nonce, sig] = parts as [string, string, string, string]
    const expMs = Number(exp)
    if (!Number.isFinite(expMs) || expMs < now) return undefined
    if (!safeEqual(sig, sign(this.secret, 'session', exp, nonce))) return undefined
    if (this.revoked.has(nonce)) return undefined
    return { nonce, expiresAt: new Date(expMs).toISOString() }
  }

  revokeSession(nonce: string, expiresAt: string, now = Date.now()): void {
    for (const [n, e] of this.revoked) if (e < now) this.revoked.delete(n)
    this.revoked.set(nonce, Date.parse(expiresAt))
  }

  csrfFor(nonce: string): string {
    return sign(this.secret, 'csrf', nonce)
  }

  verifyCsrf(nonce: string, token: string | undefined): boolean {
    return !!token && safeEqual(token, this.csrfFor(nonce))
  }
}
