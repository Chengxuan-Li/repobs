import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SnapshotDiff } from '@repobs/contracts'
import { buildGitFixture, fixtureGit, type GitFixture } from '../../fixtures/git-fixtures.ts'
import { claude, writeClaudeSession } from '../../fixtures/session-fixtures.ts'
import { createGitRunner } from '../../apps/server/src/git/exec.ts'
import { pathKey } from '../../apps/server/src/platform/paths.ts'
import { SnapshotPublisher, emptyCollections } from '../../apps/server/src/monitoring/snapshot.ts'
import { startTestServer, type Client, type TestServer } from '../helpers/server.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

let t: TestServer
let c: Client
let fx: GitFixture
let fxRoot: string
const spawned: string[][] = []
let events: Array<{ event: string; data: unknown }> = []
let sse: http.ClientRequest

function openEvents(server: TestServer, cookie: string) {
  return new Promise<void>((resolve, reject) => {
    sse = http.get(
      { host: '127.0.0.1', port: server.running.port, path: '/api/v1/events', headers: { Cookie: cookie, Host: `127.0.0.1:${server.running.port}` } },
      (res) => {
        expect(res.statusCode).toBe(200)
        let buf = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          buf += chunk
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i)
            buf = buf.slice(i + 2)
            const ev = /^event: (.+)$/m.exec(block)?.[1]
            const data = /^data: (.+)$/m.exec(block)?.[1]
            if (ev && data) events.push({ event: ev, data: JSON.parse(data) })
          }
        })
        resolve()
      },
    )
    sse.on('error', reject)
  })
}

async function waitForDiff(predicate: (d: SnapshotDiff) => boolean, timeoutMs = 15_000): Promise<SnapshotDiff> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const hit = events.find((e) => e.event === 'diff' && predicate(e.data as SnapshotDiff))
    if (hit) return hit.data as SnapshotDiff
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('timed out waiting for a matching diff')
}

beforeAll(async () => {
  fxRoot = makeTempDir('live-git')
  fx = buildGitFixture(fxRoot)
  t = await startTestServer({ manualMonitor: false, git: createGitRunner({ onSpawn: (a) => spawned.push([...a]) }) })
  t.running.monitor.applySettings(t.running.store.patchSettings({ monitoring: { activeWorktreePollMs: 2_000, idleWorktreePollMs: 30_000, sessionPollMs: 2_000 } }))
  c = await t.pair()
  expect((await c.send('POST', '/api/v1/repositories', { path: fx.repoA })).status).toBe(201)
  await openEvents(t, c.cookie)
})
afterAll(async () => {
  sse?.destroy()
  await t.close()
  removeDir(fxRoot)
})

describe('live updates without browser refresh', () => {
  it('greets SSE clients with the current version', async () => {
    await new Promise((r) => setTimeout(r, 200))
    expect(events[0]).toMatchObject({ event: 'hello' })
  })

  it('publishes an external working-tree change', async () => {
    events = []
    fs.writeFileSync(path.join(fx.worktrees.feature, 'new file.txt'), 'x')
    const diff = await waitForDiff((d) =>
      d.upserts.worktrees.some((w) => pathKey(w.path) === pathKey(fx.worktrees.feature) && w.status.untracked === 1),
    )
    expect(diff.toVersion).toBe(diff.fromVersion + 1)
  })

  it('publishes a new branch created outside repobs', async () => {
    events = []
    fixtureGit(fx.repoA, ['branch', 'agent/new-scratch'])
    await waitForDiff((d) => d.upserts.branches.some((b) => b.fullRef === 'refs/heads/agent/new-scratch'))
  })

  it('discovers a session started after repobs and follows appended records', async () => {
    events = []
    const file = writeClaudeSession(t.claudeHome, fx.worktrees.feature, 'late-session', [claude.prompt('late-session', fx.worktrees.feature, Date.now())])
    await waitForDiff((d) => d.upserts.sessions.some((s) => s.providerSessionId === 'late-session' && s.state.kind === 'running'))
    fs.appendFileSync(file, JSON.stringify(claude.endTurn('late-session', fx.worktrees.feature, Date.now())) + '\n')
    await waitForDiff((d) => d.upserts.sessions.some((s) => s.providerSessionId === 'late-session' && s.state.kind === 'idle_or_turn_finished'))
  })

  it('does not block `git worktree remove` on a watched worktree, and reports the removal', async () => {
    events = []
    fixtureGit(fx.repoA, ['worktree', 'remove', '--force', fx.worktrees.detached])
    expect(fs.existsSync(fx.worktrees.detached)).toBe(false)
    await waitForDiff((d) => d.removes.worktrees.length > 0)
  })

  it('recovers through polling when watch events are missed', async () => {
    t.running.monitor.applySettings(t.running.store.patchSettings({ monitoring: { watchWorkingTrees: false, idleWorktreePollMs: 5_000 } }))
    await new Promise((r) => setTimeout(r, 500))
    events = []
    fs.writeFileSync(path.join(fx.worktrees.unicode, 'poll-only.txt'), 'x')
    await waitForDiff((d) => d.upserts.worktrees.some((w) => pathKey(w.path) === pathKey(fx.worktrees.unicode) && w.status.untracked === 1), 20_000)
  }, 30_000)

  it('does not poll Git in a runaway loop while idle', async () => {
    await new Promise((r) => setTimeout(r, 1_000))
    spawned.length = 0
    await new Promise((r) => setTimeout(r, 4_000))
    // 6 worktrees: at most one status each per active interval (2 s) plus occasional structure scans.
    expect(spawned.length).toBeLessThan(30)
    expect(spawned.every((a) => !['fetch', 'pull', 'push'].includes(a[a.indexOf('-C') + 2]!))).toBe(true)
  }, 15_000)
})

describe('SnapshotPublisher', () => {
  it('bumps the version only on real changes and reports removals', () => {
    const p = new SnapshotPublisher()
    const base = emptyCollections()
    const repo = { id: 'r', displayName: 'r', registeredPath: 'r', primaryPath: 'r', commonGitDir: 'r', isBare: false, order: 0, addedAt: 'x', scanState: 'ok' as const }
    expect(p.update({ ...base, repositories: [repo] })?.toVersion).toBe(1)
    expect(p.update({ ...base, repositories: [repo] })).toBeUndefined()
    const d = p.update(base)!
    expect(d.removes.repositories).toEqual(['r'])
    expect(d.fromVersion).toBe(1)
  })
})
