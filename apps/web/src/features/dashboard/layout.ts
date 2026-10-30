import type { AgentSession, AnnotationSummary, BranchRef, CommitGraph, CommitNode, Repository, Worktree } from '@repobs/contracts'

// Pure layout of one repository for the dashboard: branch rows (a lane each), commits placed on
// the lane of the first branch that reaches them along first parents, edges between lanes for
// forks and merges, a pending-changes node after dirty heads, and agent rows under their branch.
// Rendering (DOM + SVG) lives in RepoBoard.tsx; this module is unit-tested in layout.test.ts.

export type BranchMode = 'all' | 'with_agents' | 'checked_out'

export interface BranchRow {
  kind: 'branch'
  id: string
  label: string
  /** Local branch, remote-only ref, or undefined for a detached HEAD row. */
  branch?: BranchRef
  worktrees: Worktree[]
  detached: boolean
  remoteOnly: boolean
  /** Pseudo-row for sessions of this repository that match no current worktree. */
  unassigned?: boolean
  headOid?: string
  /** Sum of working-tree changes over this row's worktrees (staged + unstaged + untracked + conflicted). */
  pendingChanges: number
  conflicted: number
}

export interface SessionRow {
  kind: 'session'
  id: string
  session: AgentSession
  annotation?: AnnotationSummary
  /** 0 for a top-level session, 1+ for spawned agents shown under their parent. */
  depth: number
  parentRowId?: string
  branchRowId: string
}

export interface MoreRow {
  kind: 'more'
  id: string
  branchRowId: string
  hidden: number
}

export type BoardRow = BranchRow | SessionRow | MoreRow

export interface PlacedCommit {
  commit: CommitNode
  rowId: string
  /** On the row's lane but only on its upstream (not yet pulled). */
  incoming: boolean
}

export interface GraphEdge {
  from: string
  to: string
  kind: 'lane' | 'fork' | 'merge'
  /** The child commit exists only locally. */
  localOnly: boolean
}

export interface RepoLayout {
  rows: BoardRow[]
  commits: Map<string, PlacedCommit>
  edges: GraphEdge[]
  /** Parent session row -> child session rows (spawned agents). */
  spawnLinks: Array<{ from: string; to: string }>
}

export interface LayoutOptions {
  branchMode: BranchMode
  showSpawned: boolean
  showRemoteOnly: boolean
  /** Max sessions listed per branch before a "show more" row. */
  sessionLimit: number
  /** Branch row ids whose session list is fully expanded. */
  expandedBranches: Set<string>
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  branchMode: 'all',
  showSpawned: true,
  showRemoteOnly: false,
  sessionLimit: 12,
  expandedBranches: new Set(),
}

const pending = (w: Worktree) => (w.status.state === 'ok' ? w.status.staged + w.status.unstaged + w.status.untracked + w.status.conflicted : 0)

export function layoutRepository(
  repo: Repository,
  input: {
    branches: BranchRef[]
    worktrees: Worktree[]
    /** Sessions of this repository that passed the dashboard filters. */
    sessions: AgentSession[]
    annotations: Map<string, AnnotationSummary>
    graph?: CommitGraph
  },
  options: LayoutOptions = DEFAULT_LAYOUT,
): RepoLayout {
  const commitsByOid = new Map((input.graph?.commits ?? []).map((c) => [c.oid, c]))
  const worktreesById = new Map(input.worktrees.map((w) => [w.id, w]))
  const primary = input.worktrees.find((w) => w.isPrimary)

  // Sessions by worktree, newest first by start time (a stable key: rows do not jump as agents
  // report activity, and arrival order from live diffs does not matter); spawned agents under
  // their parent.
  const ordered = [...input.sessions].sort(
    (a, b) => (Date.parse(b.firstSeenAt ?? '') || 0) - (Date.parse(a.firstSeenAt ?? '') || 0) || a.id.localeCompare(b.id),
  )
  const byId = new Map(ordered.map((s) => [s.id, s]))
  const childrenOf = new Map<string, AgentSession[]>()
  const roots: AgentSession[] = []
  for (const s of ordered) {
    if (s.parentSessionId && byId.has(s.parentSessionId)) {
      if (!options.showSpawned) continue
      childrenOf.set(s.parentSessionId, [...(childrenOf.get(s.parentSessionId) ?? []), s])
    } else if (s.parentSessionId && !options.showSpawned) {
      continue
    } else {
      roots.push(s)
    }
  }
  const sessionsForWorktrees = (ids: Set<string>) => roots.filter((s) => s.worktreeId && ids.has(s.worktreeId))

  // Branch rows in a stable order: primary checkout, other checked-out branches, other local
  // branches (newest tip first), detached heads, remote-only refs.
  const tipTime = (oid?: string) => (oid ? (commitsByOid.get(oid)?.time ?? 0) : 0)
  const local = input.branches.filter((b) => b.kind === 'local')
  const checkedOut = local
    .filter((b) => b.worktreeIds.length > 0)
    .sort((a, b) => Number(b.fullRef === primary?.branchFullRef) - Number(a.fullRef === primary?.branchFullRef) || tipTime(b.tipOid) - tipTime(a.tipOid))
  const idle = local.filter((b) => b.worktreeIds.length === 0).sort((a, b) => tipTime(b.tipOid) - tipTime(a.tipOid))
  const remoteOnly = options.showRemoteOnly
    ? input.branches.filter((b) => b.classification === 'remote_only').sort((a, b) => tipTime(b.tipOid) - tipTime(a.tipOid))
    : []

  const branchRows: Array<{ row: BranchRow; sessions: AgentSession[]; upstreamTip?: string }> = []
  const remoteTips = new Map(input.branches.filter((b) => b.kind === 'remote_tracking').map((b) => [b.fullRef, b.tipOid]))
  for (const b of [...checkedOut, ...idle]) {
    const wts = b.worktreeIds.map((id) => worktreesById.get(id)).filter((w): w is Worktree => !!w)
    branchRows.push({
      row: {
        kind: 'branch',
        id: `branch:${b.id}`,
        label: b.shortName,
        branch: b,
        worktrees: wts,
        detached: false,
        remoteOnly: false,
        headOid: b.tipOid || undefined,
        pendingChanges: wts.reduce((n, w) => n + pending(w), 0),
        conflicted: wts.reduce((n, w) => n + w.status.conflicted, 0),
      },
      sessions: sessionsForWorktrees(new Set(b.worktreeIds)),
      upstreamTip: b.upstream && !b.upstream.gone && (b.upstream.behind ?? 0) > 0 ? remoteTips.get(b.upstream.fullRef) : undefined,
    })
  }
  const reached = new Set(checkedOut.flatMap((b) => b.worktreeIds))
  for (const w of input.worktrees.filter((w) => !reached.has(w.id))) {
    branchRows.push({
      row: {
        kind: 'branch',
        id: `detached:${w.id}`,
        label: `${w.displayName} (detached)`,
        worktrees: [w],
        detached: true,
        remoteOnly: false,
        headOid: w.headOid,
        pendingChanges: pending(w),
        conflicted: w.status.conflicted,
      },
      sessions: sessionsForWorktrees(new Set([w.id])),
    })
  }
  const unassigned = roots.filter((s) => !s.worktreeId)
  if (unassigned.length) {
    branchRows.push({
      row: { kind: 'branch', id: `unassigned:${repo.id}`, label: 'Unassigned sessions', worktrees: [], detached: false, remoteOnly: false, unassigned: true, pendingChanges: 0, conflicted: 0 },
      sessions: unassigned,
    })
  }
  for (const b of remoteOnly) {
    branchRows.push({
      row: { kind: 'branch', id: `branch:${b.id}`, label: b.shortName, branch: b, worktrees: [], detached: false, remoteOnly: true, headOid: b.tipOid, pendingChanges: 0, conflicted: 0 },
      sessions: [],
    })
  }

  // Lane assignment along first parents; the first row to reach a commit owns it.
  const commits = new Map<string, PlacedCommit>()
  const claim = (tip: string | undefined, rowId: string, incoming: boolean) => {
    let oid = tip
    while (oid) {
      const c = commitsByOid.get(oid)
      if (!c || commits.has(oid)) return
      commits.set(oid, { commit: c, rowId, incoming })
      oid = c.parents[0]
    }
  }
  for (const { row, upstreamTip } of branchRows) {
    claim(row.headOid, row.id, false)
    claim(upstreamTip, row.id, true)
  }
  // Commits reached only through merges (deleted branches): place them on their child's lane.
  const queue = [...commits.keys()]
  for (let i = 0; i < queue.length; i++) {
    const placed = commits.get(queue[i]!)!
    for (const p of placed.commit.parents) {
      const parent = commitsByOid.get(p)
      if (!parent || commits.has(p)) continue
      commits.set(p, { commit: parent, rowId: placed.rowId, incoming: false })
      queue.push(p)
    }
  }

  const edges: GraphEdge[] = []
  for (const { commit, rowId } of commits.values()) {
    commit.parents.forEach((p, i) => {
      const parent = commits.get(p)
      if (!parent) return
      edges.push({ from: p, to: commit.oid, kind: parent.rowId === rowId ? 'lane' : i === 0 ? 'fork' : 'merge', localOnly: !commit.pushed })
    })
  }

  // Rows: optionally drop branches without agents / worktrees, then interleave session rows.
  const rows: BoardRow[] = []
  const spawnLinks: Array<{ from: string; to: string }> = []
  for (const { row, sessions } of branchRows) {
    if (options.branchMode === 'with_agents' && sessions.length === 0) continue
    if (options.branchMode === 'checked_out' && row.worktrees.length === 0 && !row.unassigned) continue
    rows.push(row)
    const expanded = options.expandedBranches.has(row.id)
    const visible = expanded ? sessions : sessions.slice(0, options.sessionLimit)
    const addSession = (s: AgentSession, depth: number, parentRowId?: string) => {
      const id = `session:${s.id}`
      rows.push({ kind: 'session', id, session: s, annotation: input.annotations.get(s.id), depth, parentRowId, branchRowId: row.id })
      if (parentRowId) spawnLinks.push({ from: parentRowId, to: id })
      for (const child of childrenOf.get(s.id) ?? []) addSession(child, depth + 1, id)
    }
    for (const s of visible) addSession(s, 0)
    if (visible.length < sessions.length) rows.push({ kind: 'more', id: `more:${row.id}`, branchRowId: row.id, hidden: sessions.length - visible.length })
  }
  return { rows, commits, edges, spawnLinks }
}

/** Latest activity in a repository: newest commit or session activity. */
export function repositoryLastActivity(graph: CommitGraph | undefined, sessions: AgentSession[]): number {
  const commit = Math.max(0, ...(graph?.commits ?? []).map((c) => c.time * 1000))
  const session = Math.max(0, ...sessions.map((s) => Date.parse(s.lastActivityAt ?? '') || 0))
  return Math.max(commit, session)
}
