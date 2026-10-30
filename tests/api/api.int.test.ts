import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentSession, Snapshot } from '@repobs/contracts'
import { buildGitFixture, snapshotTree, type GitFixture } from '../../fixtures/git-fixtures.ts'
import {
  claude,
  codex,
  codexRolloutPath,
  writeClaudeSession,
  writeCodexIndex,
  writeCodexRollout,
} from '../../fixtures/session-fixtures.ts'
import { startServer } from '../../apps/server/src/app.ts'
import { ClaudeAdapter } from '../../apps/server/src/sessions/adapters/claude.ts'
import { CodexAdapter } from '../../apps/server/src/sessions/adapters/codex.ts'
import { pathKey } from '../../apps/server/src/platform/paths.ts'
import { startTestServer, type Client, type TestServer } from '../helpers/server.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

let t: TestServer
let c: Client
let fx: GitFixture
let fxRoot: string
const now = Date.now()
const ago = (m: number) => now - m * 60_000

beforeAll(async () => {
  fxRoot = makeTempDir('api-git')
  fx = buildGitFixture(fxRoot)
  t = await startTestServer()
  c = await t.pair()
  // Two Claude + two Codex sessions in the same worktree, one session per other worktree.
  writeClaudeSession(t.claudeHome, fx.repoA, 'c-1', [claude.title('c-1', 'Parser fix'), claude.prompt('c-1', fx.repoA, ago(3))])
  writeClaudeSession(t.claudeHome, fx.repoA, 'c-2', [claude.prompt('c-2', fx.repoA, ago(10)), claude.endTurn('c-2', fx.repoA, ago(9))])
  writeClaudeSession(t.claudeHome, fx.worktrees.feature, 'c-3', [claude.prompt('c-3', fx.worktrees.feature, ago(2))])
  writeClaudeSession(t.claudeHome, path.join(fx.worktrees.removed, 'sub'), 'c-removed', [
    claude.endTurn('c-removed', path.join(fx.worktrees.removed, 'sub'), ago(60)),
  ])
  writeClaudeSession(t.claudeHome, path.join(fxRoot, 'unrelated'), 'c-other', [claude.prompt('c-other', path.join(fxRoot, 'unrelated'), ago(1))])
  for (const [id, at] of [['x-1', 4], ['x-2', 8]] as const) {
    writeCodexRollout(t.codexHome, codexRolloutPath(t.codexHome, id, ago(at)), [
      codex.meta(id, fx.repoA, ago(at)),
      codex.event('task_started', ago(at)),
      codex.event('task_complete', ago(at - 1)),
    ])
  }
  writeCodexRollout(t.codexHome, codexRolloutPath(t.codexHome, 'x-b', ago(5)), [codex.meta('x-b', fx.repoB, ago(5)), codex.event('task_started', ago(5))])
  writeCodexIndex(t.codexHome, [{ id: 'x-1', thread_name: 'Codex review', updated_at: new Date(ago(4)).toISOString() }])
})
afterAll(async () => {
  await t.close()
  removeDir(fxRoot)
})

const snapshot = async (): Promise<Snapshot> => (await c.get('/api/v1/snapshot')).json()

describe('API vertical slice: repositories, Git state and sessions', () => {
  it('starts empty', async () => {
    const s = await snapshot()
    expect(s.repositories).toEqual([])
    expect(s.sessions).toEqual([])
  })

  it('registers two repositories (via a linked worktree path too) and rejects duplicates', async () => {
    const a = await c.send('POST', '/api/v1/repositories', { path: fx.worktrees.feature })
    expect(a.status).toBe(201)
    expect(pathKey(a.json().primaryPath)).toBe(pathKey(fx.repoA))
    expect(a.json().displayName).toBe('repo-a')
    const dup = await c.send('POST', '/api/v1/repositories', { path: fx.repoA })
    expect(dup.status).toBe(409)
    expect((await c.send('POST', '/api/v1/repositories', { path: fx.repoB, displayName: 'Repo B' })).status).toBe(201)
    const s = await snapshot()
    expect(s.repositories.map((r) => r.displayName)).toEqual(['repo-a', 'Repo B'])
    expect(s.worktrees.filter((w) => w.repoId === s.repositories[0]!.id)).toHaveLength(7)
    expect(s.branches.find((b) => b.fullRef === 'refs/heads/codex/experiment-1')?.classification).toBe('local_only')
    const primary = s.worktrees.find((w) => pathKey(w.path) === pathKey(fx.repoA))!
    expect(primary.status).toMatchObject({ state: 'ok', staged: 1, unstaged: 1, untracked: 1 })
  })

  it('associates multiple sessions per worktree, leaves ambiguous ones unassigned, hides unrelated ones', async () => {
    await t.running.monitor.refreshAll()
    const s = await snapshot()
    const byId = new Map(s.sessions.map((x) => [x.providerSessionId, x]))
    const primary = s.worktrees.find((w) => pathKey(w.path) === pathKey(fx.repoA))!
    const feature = s.worktrees.find((w) => pathKey(w.path) === pathKey(fx.worktrees.feature))!
    const inPrimary = s.sessions.filter((x) => x.worktreeId === primary.id).map((x) => x.providerSessionId).sort()
    expect(inPrimary).toEqual(['c-1', 'c-2', 'x-1', 'x-2'])
    expect(byId.get('c-3')!.worktreeId).toBe(feature.id)
    expect(byId.get('c-removed')).toMatchObject({ association: 'unassigned', unassignedReason: 'worktree_removed' })
    expect(byId.get('c-removed')!.worktreeId).toBeUndefined()
    expect(byId.has('c-other')).toBe(false)
    expect(byId.get('c-1')).toMatchObject({ title: 'Parser fix', titleSource: 'provider', state: { kind: 'running', confidence: 'inferred' } })
    expect(byId.get('c-2')!.titleSource).toBe('fallback')
    expect(byId.get('x-1')).toMatchObject({ title: 'Codex review', state: { kind: 'idle_or_turn_finished' } })
    expect(byId.get('x-b')!.repoId).toBe(s.repositories[1]!.id)
    const diag = (await c.get('/api/v1/diagnostics')).json()
    expect(diag.outsideRegistered.claude).toBe(1)
    expect(JSON.stringify(diag)).not.toContain('synthetic prompt')
  })

  it('stores independent annotations for sessions on the same worktree and publishes summaries', async () => {
    const put = (id: string, note: string, done: boolean[]) =>
      c.send('PUT', `/api/v1/sessions/${encodeURIComponent(id)}/annotation`, {
        review: 'needs_review',
        tags: ['parser', 'urgent'],
        note,
        checklist: done.map((d, i) => ({ id: `i${i}`, text: `item ${i}`, done: d, order: i })),
      })
    expect((await put('claude:c-1', 'note one', [true, false])).status).toBe(200)
    expect((await put('claude:c-2', 'note two', [true, true])).status).toBe(200)
    const a1 = (await c.get('/api/v1/sessions/claude%3Ac-1/annotation')).json().annotation
    const a2 = (await c.get('/api/v1/sessions/claude%3Ac-2/annotation')).json().annotation
    expect(a1.note).toBe('note one')
    expect(a2.note).toBe('note two')
    const s = await snapshot()
    expect(s.annotations.find((a) => a.sessionId === 'claude:c-2')).toMatchObject({ checklistOpen: 0, checklistDone: 2, review: 'needs_review' })
  })

  it('exports and re-imports annotations as sanitized JSON without transcript data', async () => {
    const exp = await c.get('/api/v1/annotations/export')
    expect(exp.headers['content-disposition']).toContain('attachment')
    const data = exp.json()
    expect(data.annotations).toHaveLength(2)
    expect(exp.text).not.toContain('synthetic prompt')
    const res = await c.send('POST', '/api/v1/annotations/import', data)
    expect(res.json()).toEqual({ imported: 0, skipped: 2 })
  })

  it('unregistering removes only the dashboard entry; files and annotations remain', async () => {
    const before = snapshotTree(path.join(fx.repoB, '.git'))
    const s = await snapshot()
    const repoB = s.repositories.find((r) => r.displayName === 'Repo B')!
    const res = await c.send('DELETE', `/api/v1/repositories/${repoB.id}`)
    expect(res.json()).toEqual({ ok: true, filesDeleted: false })
    expect(fs.existsSync(path.join(fx.repoB, 'b.txt'))).toBe(true)
    expect(snapshotTree(path.join(fx.repoB, '.git'))).toEqual(before)
    const after = await snapshot()
    expect(after.repositories).toHaveLength(1)
    expect(after.sessions.some((x) => x.providerSessionId === 'x-b')).toBe(false)
  })

  it('keeps annotated sessions recoverable when the provider file disappears', async () => {
    const file = path.join(t.claudeHome, 'projects')
    const transcript = fs
      .readdirSync(file, { recursive: true, withFileTypes: false })
      .map(String)
      .find((f) => f.endsWith('c-1.jsonl'))!
    fs.rmSync(path.join(file, transcript))
    await t.running.monitor.refreshAll()
    const s = await snapshot()
    const gone = s.sessions.find((x) => x.id === 'claude:c-1') as AgentSession
    expect(gone).toMatchObject({ sourceAvailable: false, association: 'unassigned', unassignedReason: 'source_missing', title: 'Parser fix' })
    expect(gone.state.kind).toBe('unknown')
    expect((await c.get('/api/v1/sessions/claude%3Ac-1/annotation')).json().annotation.note).toBe('note one')
  })

  it('survives a restart with repositories, annotations and settings intact', async () => {
    await c.send('PATCH', '/api/v1/settings', { theme: 'dark' })
    await t.running.close()
    const restarted = await startServer({
      dataDir: t.dataDir,
      port: 0,
      webDist: null,
      log: () => {},
      adapters: [new ClaudeAdapter(), new CodexAdapter()],
      manualMonitor: true,
    })
    try {
      const snap = restarted.monitor.snapshot()
      expect(snap.repositories.map((r) => r.displayName)).toEqual(['repo-a'])
      expect(restarted.store.getAnnotation('claude:c-2')!.note).toBe('note two')
      expect(restarted.store.getSettings().theme).toBe('dark')
    } finally {
      await restarted.close()
      // Reopen for afterAll's close().
      t.running = await startServer({ dataDir: t.dataDir, port: 0, webDist: null, log: () => {}, manualMonitor: true })
    }
  })
})
