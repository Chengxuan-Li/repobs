import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RepositorySuggestion, Snapshot } from '@repobs/contracts'
import { buildGitFixture, fixtureGit, snapshotTree, type GitFixture } from '../../fixtures/git-fixtures.ts'
import { claude, writeClaudeSession } from '../../fixtures/session-fixtures.ts'
import { pathKey } from '../../apps/server/src/platform/paths.ts'
import { startTestServer, type Client, type TestServer } from '../helpers/server.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

// Folders without Git (ADR 0010): registration, refusals, matching next to Git repositories,
// suggestions, a folder that becomes a repository, and a folder that disappears.

let t: TestServer
let c: Client
let fx: GitFixture
let root: string
let notes: string
let later: string
const now = Date.now()
const ago = (m: number) => now - m * 60_000

const session = (cwd: string, id: string, minutesAgo: number) =>
  writeClaudeSession(t.claudeHome, cwd, id, [claude.title(id, `Session ${id}`), claude.endTurn(id, cwd, ago(minutesAgo))])

beforeAll(async () => {
  // <root>/repo-a, <root>/repo-b (Git), <root>/notes and <root>/notes/deep (plain); <later> elsewhere.
  root = makeTempDir('folders')
  fx = buildGitFixture(root)
  notes = path.join(root, 'notes')
  fs.mkdirSync(path.join(notes, 'deep'), { recursive: true })
  fs.mkdirSync(path.join(fx.repoA, 'empty-sub'))
  later = makeTempDir('folders-later')
  t = await startTestServer()
  c = await t.pair()
  session(fx.repoA, 'c-a', 5)
  session(fx.repoB, 'c-b', 6)
  session(notes, 'c-notes', 7)
  session(path.join(notes, 'deep'), 'c-deep', 8)
  session(later, 'c-later', 9)
  await t.running.monitor.refreshAll()
})
afterAll(async () => {
  await t.close()
  removeDir(root)
  removeDir(later)
})

const snapshot = async (): Promise<Snapshot> => (await c.get('/api/v1/snapshot')).json()
const suggestions = async (): Promise<RepositorySuggestion[]> => (await c.get('/api/v1/repositories/suggestions')).json().suggestions
const byKey = (list: RepositorySuggestion[], p: string) => list.find((s) => pathKey(s.path) === pathKey(p))

describe('folders without Git', () => {
  it('suggests repositories as git and other working directories as folders', async () => {
    const list = await suggestions()
    expect(byKey(list, fx.repoA)?.kind).toBe('git')
    expect(byKey(list, notes)).toMatchObject({ kind: 'folder', sessionCount: 1 })
    expect(byKey(list, path.join(notes, 'deep'))?.kind).toBe('folder')
    expect(byKey(list, later)?.kind).toBe('folder')
  })

  it('refuses paths that cannot be folders, and does not fall back from git to folder', async () => {
    const send = (p: string, kind?: 'git' | 'folder') => c.send('POST', '/api/v1/repositories', { path: p, kind })
    const refused = async (p: string, code: string, kind: 'git' | 'folder' = 'folder') => {
      const res = await send(p, kind)
      expect(res.status, p).toBe(422)
      expect(res.json().error.code, p).toBe(code)
    }
    await refused(notes, 'not_a_repository', 'git')
    await refused(os.homedir(), 'folder_too_broad')
    await refused(path.dirname(os.homedir()), 'folder_too_broad')
    await refused(path.parse(root).root, 'folder_too_broad')
    await refused(path.join(fx.repoA, 'empty-sub'), 'inside_repository')
    await refused(fx.repoA, 'inside_repository')
    await refused(path.join(root, 'missing'), 'path_missing')
    await refused('relative\\path', 'invalid_path')
    expect((await snapshot()).repositories).toEqual([])
  })

  it('registers a folder: no Git data, one row of agents, and the deepest registration wins', async () => {
    const before = snapshotTree(fx.repoA)
    expect((await c.send('POST', '/api/v1/repositories', { path: fx.repoA })).status).toBe(201)
    const res = await c.send('POST', '/api/v1/repositories', { path: root, kind: 'folder', displayName: 'Workspace' })
    expect(res.status).toBe(201)
    const folder = res.json()
    expect(folder).toMatchObject({ kind: 'folder', displayName: 'Workspace', isBare: false, scanState: 'ok' })
    expect(folder.id).toMatch(/^folder_[0-9a-f]{12}$/)
    expect(folder.commonGitDir).toBeUndefined()
    expect((await c.send('POST', '/api/v1/repositories', { path: root, kind: 'folder' })).status).toBe(409)

    const s = await snapshot()
    const repoA = s.repositories.find((r) => r.kind === 'git')!
    expect(s.branches.some((b) => b.repoId === folder.id)).toBe(false)
    expect(s.commitGraphs.some((g) => g.repoId === folder.id)).toBe(false)
    const folderTrees = s.worktrees.filter((w) => w.repoId === folder.id)
    expect(folderTrees).toHaveLength(1)
    expect(folderTrees[0]).toMatchObject({ isPrimary: true, detached: false, missing: false, status: { state: 'unavailable' } })
    const where = new Map(s.sessions.map((x) => [x.providerSessionId, x.repoId]))
    expect(where.get('c-a')).toBe(repoA.id)
    expect(where.get('c-b')).toBe(folder.id)
    expect(where.get('c-notes')).toBe(folder.id)
    expect(where.get('c-deep')).toBe(folder.id)
    expect(s.sessions.find((x) => x.providerSessionId === 'c-notes')).toMatchObject({ association: 'matched', worktreeId: folderTrees[0]!.id })
    expect(where.has('c-later')).toBe(false)
    expect(snapshotTree(fx.repoA)).toEqual(before)
  })

  it('still suggests a Git repository inside a registered folder, but not its plain subfolders', async () => {
    const list = await suggestions()
    expect(byKey(list, fx.repoB)?.kind).toBe('git')
    expect(byKey(list, notes)).toBeUndefined()
    expect(byKey(list, path.join(notes, 'deep'))).toBeUndefined()
    expect(byKey(list, later)?.kind).toBe('folder')
  })

  it('registers folders in a batch and reports per-path results', async () => {
    const res = await c.send('POST', '/api/v1/repositories/batch', { folders: [later, path.join(root, 'missing')] })
    expect(res.status).toBe(200)
    const [ok, failed] = res.json().results
    expect(ok).toMatchObject({ ok: true })
    expect(ok.repositoryId).toMatch(/^folder_/)
    expect(failed).toMatchObject({ ok: false, error: { code: 'path_missing' } })
    expect((await c.send('POST', '/api/v1/repositories/batch', { paths: [], folders: [] })).status).toBe(400)
    const s = await snapshot()
    expect(s.sessions.find((x) => x.providerSessionId === 'c-later')?.repoId).toBe(ok.repositoryId)
  })

  it('reports a folder that became a Git repository without converting it', async () => {
    fixtureGit(later, ['init', '-q'])
    await t.running.monitor.refreshAll()
    const s = await snapshot()
    const folder = s.repositories.find((r) => r.kind === 'folder' && pathKey(r.primaryPath) === pathKey(later))!
    expect(folder).toMatchObject({ kind: 'folder', gitDetected: true })
    expect(s.sessions.find((x) => x.providerSessionId === 'c-later')?.repoId).toBe(folder.id)
  })

  it('shows a missing folder as a scan error and its agents as unassigned, then removes it', async () => {
    removeDir(later)
    await t.running.monitor.refreshAll()
    const s = await snapshot()
    const folder = s.repositories.find((r) => pathKey(r.primaryPath) === pathKey(later))!
    expect(folder).toMatchObject({ scanState: 'error', error: { code: 'path_missing' } })
    expect(s.worktrees.find((w) => w.repoId === folder.id)?.missing).toBe(true)
    expect(s.sessions.find((x) => x.providerSessionId === 'c-later')).toMatchObject({ association: 'unassigned', unassignedReason: 'worktree_removed', repoId: folder.id })
    expect(s.monitor.state).toBe('degraded')
    expect((await c.send('DELETE', `/api/v1/repositories/${folder.id}`)).status).toBe(200)
    expect((await snapshot()).repositories.some((r) => r.id === folder.id)).toBe(false)
  })
})
