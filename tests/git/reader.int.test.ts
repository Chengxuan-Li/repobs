import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BranchRef, Worktree } from '@repobs/contracts'
import { buildGitFixture, snapshotTree, type GitFixture } from '../../fixtures/git-fixtures.ts'
import { createGitRunner } from '../../apps/server/src/git/exec.ts'
import {
  repositoryIdFor,
  resolveRepository,
  scanCommitGraph,
  scanRepository,
  scanWorktreeStatus,
} from '../../apps/server/src/git/reader.ts'
import { pathKey } from '../../apps/server/src/platform/paths.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

let fx: GitFixture
let root: string
const spawned: string[][] = []
const git = createGitRunner({ onSpawn: (argv) => spawned.push([...argv]) })

beforeAll(() => {
  root = makeTempDir('git')
  fx = buildGitFixture(root)
})
afterAll(() => removeDir(root))

const byName = (branches: BranchRef[], fullRef: string) => branches.find((b) => b.fullRef === fullRef)
const wtAt = (worktrees: Worktree[], p: string) => worktrees.find((w) => pathKey(w.path) === pathKey(p))

describe('Git reader against real disposable repositories', () => {
  it('resolves the common Git directory from the primary path, a subdirectory and a linked worktree', async () => {
    const fromPrimary = await resolveRepository(git, fx.repoA)
    const fromLinked = await resolveRepository(git, fx.worktrees.feature)
    expect(pathKey(fromPrimary.commonGitDir)).toBe(pathKey(path.join(fx.repoA, '.git')))
    expect(pathKey(fromLinked.commonGitDir)).toBe(pathKey(fromPrimary.commonGitDir))
    expect(pathKey(fromLinked.primaryPath)).toBe(pathKey(fx.repoA))
    const b = await resolveRepository(git, fx.repoB)
    expect(repositoryIdFor(b.commonGitDir)).not.toBe(repositoryIdFor(fromPrimary.commonGitDir))
  })

  it('rejects non-repositories, relative paths and missing paths with clear codes', async () => {
    await expect(resolveRepository(git, root)).rejects.toMatchObject({ code: 'not_a_repository' })
    await expect(resolveRepository(git, 'repo-a')).rejects.toMatchObject({ code: 'invalid_path' })
    await expect(resolveRepository(git, path.join(root, 'nope'))).rejects.toMatchObject({ code: 'path_missing' })
  })

  it('identifies a bare repository', async () => {
    const r = await resolveRepository(git, fx.origin)
    expect(r.isBare).toBe(true)
  })

  it('discovers worktrees, refs, upstreams, remote-only and gone upstreams', async () => {
    const r = await resolveRepository(git, fx.repoA)
    const repo = { id: repositoryIdFor(r.commonGitDir), ...r }
    const scan = await scanRepository(git, repo)

    expect(scan.worktrees).toHaveLength(7)
    const primary = wtAt(scan.worktrees, fx.repoA)!
    expect(primary.isPrimary).toBe(true)
    expect(primary.branchFullRef).toBe('refs/heads/main')
    expect(wtAt(scan.worktrees, fx.worktrees.detached)).toMatchObject({ detached: true, branchFullRef: undefined })
    expect(wtAt(scan.worktrees, fx.worktrees.unicode)?.displayName).toBe('wt ü space')
    expect(wtAt(scan.worktrees, fx.worktrees.removed)).toMatchObject({ missing: true, prunable: true })

    const main = byName(scan.branches, 'refs/heads/main')!
    expect(main.classification).toBe('checked_out')
    expect(main.upstream).toMatchObject({ fullRef: 'refs/remotes/origin/main', gone: false })
    expect(byName(scan.branches, 'refs/heads/feature/tracked')).toMatchObject({
      classification: 'checked_out',
      upstream: { ahead: 1, behind: 0 },
    })
    expect(byName(scan.branches, 'refs/heads/claude/scratch-a8de')?.classification).toBe('local_only')
    expect(byName(scan.branches, 'refs/heads/gone-branch')).toMatchObject({
      classification: 'local_tracking',
      upstream: { gone: true },
    })
    expect(byName(scan.branches, 'refs/remotes/origin/remote-only')?.classification).toBe('remote_only')
    expect(byName(scan.branches, 'refs/remotes/origin/main')).toMatchObject({
      classification: 'remote_tracking',
      trackedByIds: [main.id],
    })
    expect(scan.branches.some((b) => b.fullRef === 'refs/remotes/origin/HEAD')).toBe(false)
    // A local branch and its remote-tracking ref are not duplicated as worktrees.
    expect(new Set(scan.worktrees.map((w) => w.id)).size).toBe(scan.worktrees.length)
  })

  it('reports dirty, conflicted and in-progress operation states', async () => {
    const r = await resolveRepository(git, fx.repoA)
    const scan = await scanRepository(git, { id: repositoryIdFor(r.commonGitDir), ...r })
    const status = async (p: string) => scanWorktreeStatus(git, wtAt(scan.worktrees, p)!)

    expect(await status(fx.repoA)).toMatchObject({ state: 'ok', staged: 1, unstaged: 1, untracked: 1, conflicted: 0 })
    expect(await status(fx.worktrees.conflict)).toMatchObject({ conflicted: 1, gitOperation: 'merge' })
    expect(await status(fx.worktrees.rebase)).toMatchObject({ gitOperation: 'rebase' })
    expect(await status(fx.worktrees.feature)).toMatchObject({ state: 'ok', ahead: 1, behind: 0 })
    expect(await status(fx.worktrees.removed)).toMatchObject({ state: 'unavailable', error: { code: 'worktree_missing' } })
  })

  it('builds a bounded commit graph and marks local-only commits as unpushed', async () => {
    const r = await resolveRepository(git, fx.repoA)
    const repo = { id: repositoryIdFor(r.commonGitDir), ...r }
    const scan = await scanRepository(git, repo)
    const graph = await scanCommitGraph(git, repo, scan.branches, scan.worktrees)
    const bySubject = (s: string) => graph.commits.find((c) => c.subject === s)
    expect(bySubject('initial')).toMatchObject({ pushed: true, parents: [] })
    expect(bySubject('remote only work')?.pushed).toBe(true)
    expect(bySubject('feature work')?.pushed).toBe(false)
    expect(bySubject('feature work')?.parents).toEqual([bySubject('initial')!.oid])
    expect(bySubject('conflict side')?.pushed).toBe(false)
    expect(graph.truncated).toBe(false)
    expect(graph.commits.every((c) => c.time > 1_600_000_000)).toBe(true)
  })

  it('never writes to the repository: every file in .git and the origin is unchanged after scanning', async () => {
    const before = snapshotTree(path.join(fx.repoA, '.git'))
    const originBefore = snapshotTree(fx.origin)
    spawned.length = 0
    const r = await resolveRepository(git, fx.repoA)
    const repo = { id: repositoryIdFor(r.commonGitDir), ...r }
    for (let i = 0; i < 3; i++) {
      const scan = await scanRepository(git, repo)
      await Promise.all(scan.worktrees.map((w) => scanWorktreeStatus(git, w)))
      await scanCommitGraph(git, repo, scan.branches, scan.worktrees)
    }
    expect(snapshotTree(path.join(fx.repoA, '.git'))).toEqual(before)
    expect(snapshotTree(fx.origin)).toEqual(originBefore)
    const subcommands = new Set(spawned.map((argv) => argv[argv.indexOf('-C') + 2]))
    expect([...subcommands].sort()).toEqual(['for-each-ref', 'log', 'rev-parse', 'status', 'worktree'])
    expect(spawned.every((argv) => argv[0] === '--no-optional-locks')).toBe(true)
  })
})
