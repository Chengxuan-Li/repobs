import { describe, expect, it } from 'vitest'
import type { CommitGraph, CommitNode } from '@repobs/contracts'
import { branch, repo, session, worktree } from '../../testing/fixtures'
import { DEFAULT_LAYOUT, layoutRepository, type SessionRow } from './layout'

const c = (oid: string, parents: string[], time: number, pushed = true): CommitNode => ({ oid, parents, time, subject: oid, pushed })

// main: A - B - M (merge of X)      feature: B - F1 - F2 (F2 local only)      deleted branch: A - X
function setup() {
  const r = repo('r')
  const graph: CommitGraph = {
    repoId: 'r',
    truncated: false,
    scannedAt: 'x',
    commits: [c('M', ['B', 'X'], 50), c('F2', ['F1'], 45, false), c('F1', ['B'], 40), c('X', ['A'], 30), c('B', ['A'], 20), c('A', [], 10)],
  }
  const primary = worktree('r', 'wt_main', { isPrimary: true, branchFullRef: 'refs/heads/main' })
  const feat = worktree('r', 'wt_feat', {
    branchFullRef: 'refs/heads/feature',
    status: { state: 'ok', staged: 1, unstaged: 2, untracked: 0, conflicted: 0 },
  })
  const branches = [
    branch('r', 'refs/heads/main', { classification: 'checked_out', worktreeIds: ['wt_main'], tipOid: 'M' }),
    branch('r', 'refs/heads/feature', { classification: 'checked_out', worktreeIds: ['wt_feat'], tipOid: 'F2' }),
    branch('r', 'refs/heads/old', { tipOid: 'A' }),
    branch('r', 'refs/remotes/origin/feature', { classification: 'remote_only', tipOid: 'F1' }),
  ]
  const parent = session('claude:p', { worktreeId: 'wt_feat', repoId: 'r', firstSeenAt: '2026-10-01T00:00:00Z' })
  const child = session('claude:p__agent-1', { worktreeId: 'wt_feat', repoId: 'r', parentSessionId: 'claude:p' })
  const other = session('codex:o', { worktreeId: 'wt_main', repoId: 'r' })
  return { r, graph, worktrees: [primary, feat], branches, sessions: [parent, child, other] }
}

describe('layoutRepository', () => {
  it('assigns commits to the first branch reaching them and links forks and merges', () => {
    const s = setup()
    const l = layoutRepository(s.r, { ...s, annotations: new Map() })
    const lane = (oid: string) => l.commits.get(oid)!.rowId
    expect(lane('M')).toBe('branch:r|refs/heads/main')
    expect(lane('A')).toBe('branch:r|refs/heads/main')
    expect(lane('X')).toBe('branch:r|refs/heads/main') // reached only through the merge
    expect(lane('F2')).toBe('branch:r|refs/heads/feature')
    expect(lane('F1')).toBe('branch:r|refs/heads/feature')
    expect(l.edges).toContainEqual({ from: 'B', to: 'F1', kind: 'fork', localOnly: false })
    expect(l.edges).toContainEqual({ from: 'F1', to: 'F2', kind: 'lane', localOnly: true })
    expect(l.edges).toContainEqual({ from: 'X', to: 'M', kind: 'lane', localOnly: false })
  })

  it('orders rows primary-first and puts agents (and spawned agents) under their branch', () => {
    const s = setup()
    const l = layoutRepository(s.r, { ...s, annotations: new Map() })
    expect(l.rows.map((r) => r.id)).toEqual([
      'branch:r|refs/heads/main',
      'session:codex:o',
      'branch:r|refs/heads/feature',
      'session:claude:p',
      'session:claude:p__agent-1',
      'branch:r|refs/heads/old',
    ])
    const feature = l.rows.find((r) => r.id === 'branch:r|refs/heads/feature')
    expect(feature).toMatchObject({ pendingChanges: 3 })
    expect(l.rows.find((r) => r.id === 'session:claude:p__agent-1')).toMatchObject({ depth: 1, parentRowId: 'session:claude:p' })
    expect(l.spawnLinks).toEqual([{ from: 'session:claude:p', to: 'session:claude:p__agent-1' }])
  })

  it('draws spawn trees with guides that continue past siblings and their descendants', () => {
    const s = setup()
    const at = (m: number) => `2026-10-01T00:0${m}:00Z`
    const kids = [
      session('claude:p__agent-1', { worktreeId: 'wt_feat', repoId: 'r', parentSessionId: 'claude:p', firstSeenAt: at(3) }),
      session('claude:p__agent-2', { worktreeId: 'wt_feat', repoId: 'r', parentSessionId: 'claude:p', firstSeenAt: at(2) }),
      session('claude:p__agent-1__g', { worktreeId: 'wt_feat', repoId: 'r', parentSessionId: 'claude:p__agent-1', firstSeenAt: at(4) }),
    ]
    const l = layoutRepository(s.r, { ...s, sessions: [s.sessions[0]!, ...kids], annotations: new Map() })
    const tree = l.rows.filter((r): r is SessionRow => r.kind === 'session').map((r) => [r.id.replace('session:claude:', ''), r.guides.join(' '), r.hasChildren])
    expect(tree).toEqual([
      ['p', '', true],
      ['p__agent-1', 'tee', true],
      ['p__agent-1__g', 'pipe last', false], // the line to agent-2 runs past the grandchild
      ['p__agent-2', 'last', false],
    ])
  })

  it('can hide spawned agents, idle branches, and show remote-only refs', () => {
    const s = setup()
    const hidden = layoutRepository(s.r, { ...s, annotations: new Map() }, { ...DEFAULT_LAYOUT, showSpawned: false, branchMode: 'with_agents' })
    expect(hidden.rows.map((r) => r.id)).toEqual(['branch:r|refs/heads/main', 'session:codex:o', 'branch:r|refs/heads/feature', 'session:claude:p'])
    const remote = layoutRepository(s.r, { ...s, annotations: new Map() }, { ...DEFAULT_LAYOUT, showRemoteOnly: true })
    expect(remote.rows.at(-1)).toMatchObject({ kind: 'branch', remoteOnly: true, label: 'origin/feature' })
  })

  it('limits long session lists with a "more" row', () => {
    const s = setup()
    const many = Array.from({ length: 30 }, (_, i) => session(`codex:m${i}`, { worktreeId: 'wt_main', repoId: 'r' }))
    const l = layoutRepository(s.r, { ...s, sessions: many, annotations: new Map() }, { ...DEFAULT_LAYOUT, sessionLimit: 5 })
    expect(l.rows.filter((r) => r.kind === 'session')).toHaveLength(5)
    expect(l.rows.find((r) => r.kind === 'more')).toMatchObject({ hidden: 25 })
    const all = layoutRepository(s.r, { ...s, sessions: many, annotations: new Map() }, { ...DEFAULT_LAYOUT, sessionLimit: 5, expandedBranches: new Set(['branch:r|refs/heads/main']) })
    expect(all.rows.filter((r) => r.kind === 'session')).toHaveLength(30)
  })

  it('records which branch each branch forked from and merged into', () => {
    const s = setup()
    const topic = branch('r', 'refs/heads/topic', { tipOid: 'X' })
    const l = layoutRepository(s.r, { ...s, branches: [...s.branches, topic], annotations: new Map() })
    const byLabel = (label: string) => l.rows.find((r) => r.kind === 'branch' && r.label === label) as import('./layout').BranchRow
    expect(byLabel('feature').forkedFrom).toBe('main')
    expect(byLabel('old').pointsAt).toBe('main') // tip A is a main commit; no commits of its own
    expect(byLabel('feature').pointsAt).toBeUndefined()
    expect(byLabel('topic')).toMatchObject({ forkedFrom: 'main', mergedInto: ['main'] })
    expect(l.commits.get('X')!.rowId).toBe('branch:r|refs/heads/topic')
  })

  describe('collapsing quiet commits', () => {
    // main: Q1..Q4 - F0 (fork base) - Q5..Q7 - A - Q8 - M (merge) - Q9 - H (head); feature forks at F0.
    // An agent is active through Q5..A: that does not make those commits eventful.
    function chain() {
      const r = repo('r')
      const oids = ['Q1', 'Q2', 'Q3', 'Q4', 'F0', 'Q5', 'Q6', 'Q7', 'A', 'Q8', 'M', 'Q9', 'H']
      const commits = oids.map((oid, i) => c(oid, i ? (oid === 'M' ? [oids[i - 1]!, 'X2'] : [oids[i - 1]!]) : [], 100 + i * 60))
      commits.push(c('X1', ['F0'], 270), c('X2', ['X1'], 330))
      const graph: CommitGraph = { repoId: 'r', truncated: false, scannedAt: 'x', commits }
      const main = worktree('r', 'wt_main', { isPrimary: true, branchFullRef: 'refs/heads/main' })
      const branches = [
        branch('r', 'refs/heads/main', { classification: 'checked_out', worktreeIds: ['wt_main'], tipOid: 'H' }),
        branch('r', 'refs/heads/feature', { tipOid: 'X2' }),
      ]
      const agent = session('claude:a', { worktreeId: 'wt_main', repoId: 'r', firstSeenAt: new Date(400_000).toISOString(), lastActivityAt: new Date(600_000).toISOString() })
      return { r, graph, worktrees: [main], branches, sessions: [agent], annotations: new Map() }
    }

    it('groups runs of commits without branching or merging, including bursts made by an agent', () => {
      const s = chain()
      const l = layoutRepository(s.r, s, { ...DEFAULT_LAYOUT, collapseQuiet: true })
      expect(l.groups.map((g) => g.commits.map((x) => x.oid))).toEqual([
        ['Q2', 'Q3', 'Q4'], // Q1 is a root (no parent on the row) and stays visible
        ['Q5', 'Q6', 'Q7', 'A', 'Q8'], // an agent committing in a burst is still quiet
      ])
      expect(l.groupOf.get('Q6')).toBe('grp:Q5')
      expect(l.groupOf.has('M')).toBe(false) // merge
      expect(l.groupOf.has('Q9')).toBe(false) // a single quiet commit is not grouped
      // Edges now connect drawn nodes: Q1 -> group -> F0 -> group -> M; no edges inside groups.
      expect(l.edges).toContainEqual(expect.objectContaining({ from: 'Q1', to: 'grp:Q2' }))
      expect(l.edges).toContainEqual(expect.objectContaining({ from: 'grp:Q2', to: 'F0' }))
      expect(l.edges).toContainEqual(expect.objectContaining({ from: 'grp:Q5', to: 'M' }))
      expect(l.edges.some((e) => e.from === 'Q2' || e.to === 'Q3')).toBe(false)
      expect(l.edges).toContainEqual(expect.objectContaining({ from: 'F0', to: 'X1', kind: 'fork' }))
    })

    it('leaves everything visible when off, and honours individually expanded groups', () => {
      const s = chain()
      expect(layoutRepository(s.r, s, DEFAULT_LAYOUT).groups).toEqual([])
      const l = layoutRepository(s.r, s, { ...DEFAULT_LAYOUT, collapseQuiet: true, expandedGroups: new Set(['grp:Q2']) })
      expect(l.groups.map((g) => g.id)).toEqual(['grp:Q5'])
    })
  })

  it('orders agents newest-first by start time regardless of arrival order', () => {
    const s = setup()
    const old = session('codex:old', { worktreeId: 'wt_main', repoId: 'r', firstSeenAt: '2026-10-01T00:00:00Z' })
    const fresh = session('codex:new', { worktreeId: 'wt_main', repoId: 'r', firstSeenAt: '2026-10-30T00:00:00Z' })
    const l = layoutRepository(s.r, { ...s, sessions: [old, fresh], annotations: new Map() })
    expect(l.rows.filter((r) => r.kind === 'session').map((r) => r.id)).toEqual(['session:codex:new', 'session:codex:old'])
  })

  it('handles a repository without a commit graph and detached worktrees', () => {
    const s = setup()
    const det = worktree('r', 'wt_det', { detached: true, headOid: 'B' })
    const l = layoutRepository(s.r, { ...s, worktrees: [...s.worktrees, det], graph: undefined, annotations: new Map() })
    expect(l.commits.size).toBe(0)
    expect(l.rows.some((r) => r.kind === 'branch' && r.detached)).toBe(true)
  })
})
