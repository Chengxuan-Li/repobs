import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionActivity, Snapshot } from '@repobs/contracts'
import { buildGitFixture, type GitFixture } from '../../fixtures/git-fixtures.ts'
import { claude, writeClaudeSession } from '../../fixtures/session-fixtures.ts'
import { startTestServer, type Client, type TestServer } from '../helpers/server.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

// GET /sessions/{id}/activity (ADR 0013): read on demand, structural only, off with the setting.

let t: TestServer
let c: Client
let fx: GitFixture
let root: string
const now = Date.now()
const ago = (m: number) => now - m * 60_000

beforeAll(async () => {
  root = makeTempDir('activity-api')
  fx = buildGitFixture(root)
  t = await startTestServer()
  c = await t.pair()
  expect((await c.send('POST', '/api/v1/repositories', { path: fx.repoA })).status).toBe(201)
  writeClaudeSession(t.claudeHome, fx.repoA, 'act-1', [
    claude.prompt('act-1', fx.repoA, ago(6), 'bypassPermissions'),
    claude.toolUse('act-1', fx.repoA, ago(5)),
    claude.toolResult('act-1', fx.repoA, ago(4)),
    claude.endTurn('act-1', fx.repoA, ago(3)),
  ])
  await t.running.monitor.refreshAll()
})
afterAll(async () => {
  await t.close()
  removeDir(root)
})

const activity = async (id: string) => c.get(`/api/v1/sessions/${encodeURIComponent(id)}/activity`)

describe('session activity', () => {
  it('returns steps for a known session, structural only', async () => {
    const snap: Snapshot = await (await c.get('/api/v1/snapshot')).json()
    const id = snap.sessions.find((s) => s.providerSessionId === 'act-1')!.id
    const res = await activity(id)
    expect(res.status).toBe(200)
    const body: SessionActivity = await res.json()
    expect(body.state).toBe('ok')
    expect(body.steps.map((s) => s.kind)).toEqual(['prompt', 'model', 'tool', 'model'])
    expect(body.steps[2]).toMatchObject({ category: 'shell', tool: 'Bash', ok: true })
    const text = JSON.stringify(body)
    for (const leak of ['synthetic prompt', 'synthetic output', 'synthetic answer']) expect(text).not.toContain(leak)
  })

  it('answers 404 for an unknown session and "disabled" when the setting is off', async () => {
    expect((await activity('claude:does-not-exist')).status).toBe(404)
    const snap: Snapshot = await (await c.get('/api/v1/snapshot')).json()
    const id = snap.sessions.find((s) => s.providerSessionId === 'act-1')!.id
    expect((await c.send('PATCH', '/api/v1/settings', { privacy: { readAgentActivity: false } })).status).toBe(200)
    const off: SessionActivity = await (await activity(id)).json()
    expect(off).toMatchObject({ state: 'disabled', steps: [], tokens: [] })
    expect((await c.send('PATCH', '/api/v1/settings', { privacy: { readAgentActivity: true } })).status).toBe(200)
    expect(((await (await activity(id)).json()) as SessionActivity).state).toBe('ok')
  })
})
