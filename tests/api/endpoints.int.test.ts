import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { API_ENDPOINTS, API_PREFIX } from '@repobs/contracts'
import { renderApiDocs } from '../../scripts/gen-api-docs.ts'
import { startTestServer, type Client, type TestServer } from '../helpers/server.ts'

let t: TestServer
let c: Client
beforeAll(async () => {
  t = await startTestServer()
  c = await t.pair()
})
afterAll(() => t.close())

describe('API contract', () => {
  it.each(API_ENDPOINTS.filter((e) => e.path !== '/events'))('$method $path is served with the documented access rule', async (e) => {
    const p = API_PREFIX + e.path.replace('{id}', e.path.startsWith('/sessions') ? 'claude%3Anope' : 'repo_000000000000')
    const anonymous = await t.request(e.method, p, { headers: e.method === 'GET' ? {} : { Origin: t.origin }, body: e.method === 'GET' || e.method === 'DELETE' ? undefined : {} })
    if (e.auth === 'public') expect(anonymous.status).not.toBe(401)
    else expect(anonymous.status).toBe(401)
    if (e.path === '/repositories/pick-directory') return // would open a real dialog on Windows
    const client = e.path === '/auth/logout' ? await t.pair() : c
    const authed = e.method === 'GET' ? await client.get(p) : await client.send(e.method, p, e.method === 'DELETE' ? undefined : {})
    // The route exists: no "route not found"/"method not allowed", and the session + CSRF were accepted.
    expect(authed.status).not.toBe(405)
    if (authed.status === 404) expect(authed.json().error.message).not.toBe('Not found')
    expect([401, 403]).not.toContain(authed.status)
  })

  it('logout revokes the session server-side', async () => {
    const other = await t.pair()
    expect((await other.send('POST', '/api/v1/auth/logout', {})).status).toBe(200)
    expect((await other.get('/api/v1/snapshot')).status).toBe(401)
    expect((await c.get('/api/v1/snapshot')).status).toBe(200)
  })

  it('docs/api.md is generated from the contracts and up to date', () => {
    const file = path.resolve(import.meta.dirname, '../../docs/api.md')
    expect(fs.readFileSync(file, 'utf8')).toBe(renderApiDocs())
  })
})
