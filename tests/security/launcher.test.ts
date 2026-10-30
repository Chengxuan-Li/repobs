import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM launcher helper
import { mintPairingToken } from '../../scripts/lib.mjs'
import { loadOrCreateSecret, TokenService } from '../../apps/server/src/security/tokens.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!)
})

describe('launcher pairing tokens', () => {
  it('tokens minted by scripts/lib.mjs are accepted once by the server', () => {
    const dir = makeTempDir('launcher')
    dirs.push(dir)
    const tokens = new TokenService(loadOrCreateSecret(dir))
    const token = mintPairingToken(dir) as string
    expect(tokens.consumePairingToken(token)).toBe(true)
    expect(tokens.consumePairingToken(token)).toBe(false)
  })

  it('rejects expired tokens and tokens from another install', () => {
    const a = makeTempDir('launcher-a')
    const b = makeTempDir('launcher-b')
    dirs.push(a, b)
    const tokens = new TokenService(loadOrCreateSecret(a))
    loadOrCreateSecret(b)
    expect(tokens.consumePairingToken(mintPairingToken(b) as string)).toBe(false)
    expect(tokens.consumePairingToken(mintPairingToken(a, Date.now() - 10 * 60_000) as string)).toBe(false)
  })

  it('keeps the install secret stable across restarts', () => {
    const dir = makeTempDir('launcher-c')
    dirs.push(dir)
    const s1 = loadOrCreateSecret(dir)
    const s2 = loadOrCreateSecret(dir)
    expect(s1.equals(s2)).toBe(true)
    expect(fs.readFileSync(path.join(dir, 'secret.key'), 'utf8')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('session cookies carry a CSRF token bound to the session', () => {
    const dir = makeTempDir('launcher-d')
    dirs.push(dir)
    const tokens = new TokenService(loadOrCreateSecret(dir))
    const s = tokens.mintSession()
    const v = tokens.verifySession(s.cookie)!
    expect(tokens.verifyCsrf(v.nonce, s.csrf)).toBe(true)
    expect(tokens.verifyCsrf(v.nonce, tokens.mintSession().csrf)).toBe(false)
    expect(tokens.verifySession(s.cookie, Date.now() + 13 * 3_600_000)).toBeUndefined()
  })
})
