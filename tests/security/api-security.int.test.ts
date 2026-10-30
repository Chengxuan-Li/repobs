import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from '../helpers/server.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'
import { buildGitFixture, type GitFixture } from '../../fixtures/git-fixtures.ts'
import { redactLogMessage } from '../../apps/server/src/config/logger.ts'

let t: TestServer
let fx: GitFixture
let fxRoot: string

beforeAll(async () => {
  fxRoot = makeTempDir('sec-git')
  fx = buildGitFixture(fxRoot)
  t = await startTestServer()
})
afterAll(async () => {
  await t.close()
  removeDir(fxRoot)
})

describe('localhost security', () => {
  it('binds to loopback only', () => {
    const addr = t.running.server.address()
    expect(typeof addr === 'object' && addr?.address).toBe('127.0.0.1')
  })

  it('health is public but minimal (no paths)', async () => {
    const res = await t.request('GET', '/api/v1/health')
    expect(res.status).toBe(200)
    expect(Object.keys(res.json()).sort()).toEqual(['monitor', 'name', 'ok', 'version'])
    expect(res.text).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//)
  })

  it.each(['/api/v1/snapshot', '/api/v1/events', '/api/v1/sessions', '/api/v1/settings', '/api/v1/diagnostics', '/api/v1/repositories'])(
    'denies %s without a paired session',
    async (p) => {
      expect((await t.request('GET', p)).status).toBe(401)
    },
  )

  it('rejects a forged or tampered session cookie', async () => {
    const c = await t.pair()
    const tampered = c.cookie.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'))
    expect((await t.request('GET', '/api/v1/snapshot', { headers: { Cookie: tampered } })).status).toBe(401)
    expect((await t.request('GET', '/api/v1/snapshot', { headers: { Cookie: 'repobs_session=s1.9999999999999.x.y' } })).status).toBe(401)
  })

  it('rejects foreign Host headers (DNS rebinding) even with a valid session', async () => {
    const c = await t.pair()
    const res = await t.request('GET', '/api/v1/snapshot', { headers: { Cookie: c.cookie, Host: 'evil.example:80' } })
    expect(res.status).toBe(403)
    expect((await t.request('GET', '/api/v1/health', { headers: { Host: `attacker.test:${t.running.port}` } })).status).toBe(403)
    expect((await t.request('GET', '/', { headers: { Host: 'evil.example' } })).status).toBe(403)
  })

  it('rejects cross-origin requests and never sends CORS headers', async () => {
    const c = await t.pair()
    const res = await t.request('GET', '/api/v1/snapshot', { headers: { Cookie: c.cookie, Origin: 'https://evil.example' } })
    expect(res.status).toBe(403)
    const pre = await t.request('OPTIONS', '/api/v1/repositories', {
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    })
    expect(pre.status).toBe(403)
    expect(pre.headers['access-control-allow-origin']).toBeUndefined()
    const site = await t.request('GET', '/api/v1/snapshot', { headers: { Cookie: c.cookie, 'Sec-Fetch-Site': 'cross-site' } })
    expect(site.status).toBe(403)
  })

  it('requires Origin and a valid CSRF token for state changes', async () => {
    const c = await t.pair()
    const body = { theme: 'dark' }
    expect((await t.request('PATCH', '/api/v1/settings', { headers: { Cookie: c.cookie, 'X-Repobs-CSRF': c.csrf }, body })).status).toBe(403)
    expect((await t.request('PATCH', '/api/v1/settings', { headers: { Cookie: c.cookie, Origin: t.origin }, body })).status).toBe(403)
    expect(
      (await t.request('PATCH', '/api/v1/settings', { headers: { Cookie: c.cookie, Origin: t.origin, 'X-Repobs-CSRF': 'nope' }, body })).status,
    ).toBe(403)
    const other = await t.pair()
    expect(
      (await t.request('PATCH', '/api/v1/settings', { headers: { Cookie: c.cookie, Origin: t.origin, 'X-Repobs-CSRF': other.csrf }, body })).status,
    ).toBe(403)
    expect((await c.send('PATCH', '/api/v1/settings', body)).status).toBe(200)
  })

  it('rejects non-JSON bodies (no simple-request CSRF)', async () => {
    const c = await t.pair()
    const res = await t.request('POST', '/api/v1/repositories', {
      headers: { Cookie: c.cookie, Origin: t.origin, 'X-Repobs-CSRF': c.csrf, 'Content-Type': 'text/plain' },
      rawBody: JSON.stringify({ path: fx.repoA }),
    })
    expect(res.status).toBe(415)
  })

  it('pairing tokens are single-use and must be genuine', async () => {
    const token = t.running.tokens.mintPairingToken()
    const first = await t.request('POST', '/api/v1/auth/pair', { headers: { Origin: t.origin }, body: { token } })
    expect(first.status).toBe(200)
    expect(String(first.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Strict/)
    const again = await t.request('POST', '/api/v1/auth/pair', { headers: { Origin: t.origin }, body: { token } })
    expect(again.status).toBe(401)
    const forged = await t.request('POST', '/api/v1/auth/pair', { headers: { Origin: t.origin }, body: { token: 'p1.9999999999999.abc.def' } })
    expect(forged.status).toBe(401)
  })

  it('validates repository paths and does not become a file server', async () => {
    const c = await t.pair()
    const cases: Array<[unknown, number, string]> = [
      [{ path: 'relative\\dir' }, 422, 'invalid_path'],
      [{ path: path.join(fxRoot, 'does-not-exist') }, 422, 'path_missing'],
      [{ path: fxRoot }, 422, 'not_a_repository'],
      [{ path: path.join(fx.repoA, 'README.md') }, 422, 'not_a_directory'],
      [{ path: `${fx.repoA} & calc.exe` }, 422, 'path_missing'],
      [{ path: '--upload-pack=evil' }, 422, 'invalid_path'],
      [{ path: '' }, 400, 'validation_failed'],
      [{ nope: 1 }, 400, 'validation_failed'],
    ]
    for (const [body, status, code] of cases) {
      const res = await c.send('POST', '/api/v1/repositories', body)
      expect({ body, status: res.status, code: res.json().error?.code }).toEqual({ body, status, code })
    }
    expect((await c.get('/api/v1/files?path=C:\\Windows\\win.ini')).status).toBe(404)
    expect((await t.request('GET', '/..%2f..%2fpackage.json')).status).not.toBe(200)
  })

  it('renders hostile annotation text as data and enforces size limits', async () => {
    const c = await t.pair()
    const repo = await c.send('POST', '/api/v1/repositories', { path: fx.repoB })
    expect(repo.status).toBe(201)
    expect((await c.send('PUT', '/api/v1/sessions/claude%3Aunknown-session/annotation', { review: 'flagged', tags: [], note: '', checklist: [] })).status).toBe(404)
    expect((await c.send('PUT', '/api/v1/sessions/..%2f..%2fx/annotation', { review: 'flagged', tags: [], note: '', checklist: [] })).status).toBe(400)
    const huge = await c.send('PUT', '/api/v1/sessions/claude%3Ax/annotation', { review: 'flagged', tags: [], note: 'x'.repeat(300_000), checklist: [] })
    expect(huge.status).toBe(413)
  })

  it('redacts tokens and home paths from log lines', () => {
    const line = redactLogMessage(`opened p1.123456.abc_DEF.sig-xyz at ${process.env.USERPROFILE ?? 'C:\\Users\\x'}\\secret`)
    expect(line).not.toMatch(/p1\.123456/)
    expect(line).toContain('[redacted-token]')
  })

  it('stores the install secret in the data dir, outside any repository', () => {
    expect(fs.existsSync(path.join(t.dataDir, 'secret.key'))).toBe(true)
    expect(fs.existsSync(path.join(fx.repoA, 'secret.key'))).toBe(false)
  })
})
