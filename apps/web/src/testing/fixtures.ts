import type { AgentSession, BranchRef, Repository, Snapshot, Worktree } from '@repobs/contracts'

// Synthetic snapshot builders for component tests (no real paths or provider data).

export function repo(id: string, over: Partial<Repository> = {}): Repository {
  return {
    id,
    displayName: id,
    registeredPath: `C:\\src\\${id}`,
    primaryPath: `C:\\src\\${id}`,
    commonGitDir: `C:\\src\\${id}\\.git`,
    isBare: false,
    order: 0,
    addedAt: '2026-10-01T00:00:00.000Z',
    scanState: 'ok',
    ...over,
  }
}

export function branch(repoId: string, fullRef: string, over: Partial<BranchRef> = {}): BranchRef {
  const local = fullRef.startsWith('refs/heads/')
  return {
    id: `${repoId}|${fullRef}`,
    repoId,
    fullRef,
    shortName: fullRef.replace(/^refs\/(heads|remotes)\//, ''),
    kind: local ? 'local' : 'remote_tracking',
    tipOid: 'abc',
    unborn: false,
    classification: local ? 'local_only' : 'remote_only',
    worktreeIds: [],
    trackedByIds: [],
    ...over,
  }
}

export function worktree(repoId: string, id: string, over: Partial<Worktree> = {}): Worktree {
  return {
    id,
    repoId,
    path: `C:\\src\\${id}`,
    displayName: id,
    isPrimary: false,
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
    missing: false,
    status: { state: 'ok', staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    ...over,
  }
}

export function session(id: string, over: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    provider: id.startsWith('codex') ? 'codex' : 'claude',
    providerSessionId: id.split(':')[1] ?? id,
    title: `Session ${id}`,
    titleSource: 'provider',
    association: 'matched',
    state: { kind: 'idle_or_turn_finished', confidence: 'inferred', source: 'test' },
    historical: false,
    sourceAvailable: true,
    subagents: { total: 0, active: 0 },
    ...over,
  }
}

export function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    generatedAt: '2026-10-30T00:00:00.000Z',
    repositories: [],
    branches: [],
    worktrees: [],
    sessions: [],
    annotations: [],
    pullRequests: [],
    pullRequestStatus: [],
    commitGraphs: [],
    monitor: { state: 'ok', errors: [] },
    ...over,
  }
}

/** Repo A: main checked out in primary (2 sessions), feature in a linked worktree, scratch branch, remote-only, detached worktree. */
export function sampleSnapshot(): Snapshot {
  const r = repo('repo_a', { displayName: 'Repo A' })
  const primary = worktree(r.id, 'wt_main', { isPrimary: true, branchFullRef: 'refs/heads/main', displayName: 'repo-a' })
  const feature = worktree(r.id, 'wt_feat', {
    branchFullRef: 'refs/heads/feature',
    status: { state: 'ok', staged: 0, unstaged: 0, untracked: 0, conflicted: 2, gitOperation: 'merge' },
  })
  const det = worktree(r.id, 'wt_det', { detached: true })
  return snapshot({
    repositories: [r],
    worktrees: [primary, feature, det],
    branches: [
      branch(r.id, 'refs/heads/main', { classification: 'checked_out', worktreeIds: ['wt_main'], upstream: { fullRef: 'refs/remotes/origin/main', gone: false, ahead: 1, behind: 0 } }),
      branch(r.id, 'refs/heads/feature', { classification: 'checked_out', worktreeIds: ['wt_feat'] }),
      branch(r.id, 'refs/heads/claude/scratch-a8de'),
      branch(r.id, 'refs/remotes/origin/main', { classification: 'remote_tracking', trackedByIds: [`${r.id}|refs/heads/main`] }),
      branch(r.id, 'refs/remotes/origin/remote-only'),
    ],
    sessions: [
      session('claude:s1', { worktreeId: 'wt_main', repoId: r.id, title: 'Parser fix', state: { kind: 'running', confidence: 'direct', source: 'x' } }),
      session('codex:s2', { worktreeId: 'wt_main', repoId: r.id, title: 'Review tree', state: { kind: 'waiting_approval', confidence: 'inferred', source: 'x' } }),
      session('claude:s3', { worktreeId: 'wt_feat', repoId: r.id, title: 'Old idea', historical: true }),
      session('claude:gone', { repoId: r.id, association: 'unassigned', unassignedReason: 'worktree_removed', title: 'Removed worktree work' }),
    ],
    annotations: [
      { sessionId: 'claude:s3', review: 'flagged', tags: ['perf'], hasNote: true, note: 'Check the allocation spike', checklistOpen: 0, checklistDone: 1, updatedAt: 'x', displayAlias: 'Perf spike' },
    ],
  })
}
