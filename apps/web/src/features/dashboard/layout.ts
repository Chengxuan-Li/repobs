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
  /** Branch whose commit this branch's first own commit was made on top of. */
  forkedFrom?: string
  /** Branches that merged this branch's commits. */
  mergedInto: string[]
  /** The head is a commit drawn on another branch's row (this branch has no commits of its own). */
  pointsAt?: string
}

export interface SessionRow {
  kind: 'session'
  id: string
  session: AgentSession
  annotation?: AnnotationSummary
  /** 0 for a top-level session, 1+ for spawned agents shown under their parent. */
  depth: number
  /**
   * Tree guides drawn left of the agent card, one per level 1..depth: 'pipe' continues an
   * ancestor's line past this row, 'tee' / 'last' connect this row to its parent, 'none' is blank.
   */
  guides: TreeGuide[]
  /** Spawned agents follow directly below (the line leaves the bottom of this card). */
  hasChildren: boolean
  /** Agents this one spawned that passed the filters, shown or not. */
  childCount: number
  /** Whether its spawned agents are shown (the chevron toggles it). */
  expanded: boolean
  parentRowId?: string
  branchRowId: string
}

export type TreeGuide = 'pipe' | 'tee' | 'last' | 'none'

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

/** A run of consecutive "quiet" commits on one branch row, drawn as one node. */
export interface CommitGroup {
  id: string
  rowId: string
  /** Oldest first. */
  commits: CommitNode[]
  /** Commit times in ms. */
  start: number
  end: number
}

export interface RepoLayout {
  rows: BoardRow[]
  commits: Map<string, PlacedCommit>
  /** Edges between drawn nodes (commit oids or group ids); edges inside a group are dropped. */
  edges: GraphEdge[]
  /** Parent session row -> child session rows (spawned agents). */
  spawnLinks: Array<{ from: string; to: string }>
  groups: CommitGroup[]
  /** Commit oid -> id of the group that hides it. */
  groupOf: Map<string, string>
}

export interface LayoutOptions {
  branchMode: BranchMode
  /** Spawned agents start hidden under their parent; `toggledAgents` lists the exceptions. */
  collapseSpawned: boolean
  /** Session ids whose spawned agents are shown (when collapsing) or hidden (when not). */
  toggledAgents: Set<string>
  showRemoteOnly: boolean
  /** Max sessions listed per branch before a "show more" row. */
  sessionLimit: number
  /** Branch row ids whose session list is fully expanded. */
  expandedBranches: Set<string>
  /** Collapse runs of commits that change nothing in the topology (no heads, forks or merges). */
  collapseQuiet: boolean
  /** Group ids the user expanded while collapsing is on. */
  expandedGroups: Set<string>
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  branchMode: 'all',
  collapseSpawned: false,
  toggledAgents: new Set(),
  showRemoteOnly: false,
  sessionLimit: 12,
  expandedBranches: new Set(),
  collapseQuiet: false,
  expandedGroups: new Set(),
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
      childrenOf.set(s.parentSessionId, [...(childrenOf.get(s.parentSessionId) ?? []), s])
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
        mergedInto: [],
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
        mergedInto: [],
      },
      sessions: sessionsForWorktrees(new Set([w.id])),
    })
  }
  const unassigned = roots.filter((s) => !s.worktreeId)
  if (unassigned.length) {
    branchRows.push({
      row: { kind: 'branch', id: `unassigned:${repo.id}`, label: 'Unassigned sessions', worktrees: [], detached: false, remoteOnly: false, unassigned: true, pendingChanges: 0, conflicted: 0, mergedInto: [] },
      sessions: unassigned,
    })
  }
  for (const b of remoteOnly) {
    branchRows.push({
      row: { kind: 'branch', id: `branch:${b.id}`, label: b.shortName, branch: b, worktrees: [], detached: false, remoteOnly: true, headOid: b.tipOid, pendingChanges: 0, conflicted: 0, mergedInto: [] },
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

  // Branch relationships for the label column: where each branch forked from, where it merged into,
  // and — for branches without commits of their own — which branch's commit they point at.
  const rowById = new Map(branchRows.map(({ row }) => [row.id, row]))
  for (const { row } of branchRows) {
    const owner = row.headOid ? commits.get(row.headOid)?.rowId : undefined
    if (owner && owner !== row.id) row.pointsAt = rowById.get(owner)?.label
  }
  for (const e of edges) {
    const from = rowById.get(commits.get(e.from)!.rowId)
    const to = rowById.get(commits.get(e.to)!.rowId)
    if (!from || !to || from === to) continue
    if (e.kind === 'fork' && !to.forkedFrom) to.forkedFrom = from.label
    if (e.kind === 'merge' && !from.mergedInto.includes(to.label)) from.mergedInto.push(to.label)
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
    // Depth-first, so a parent's spawned agents sit directly below it; `open` says, per ancestor
    // level, whether that ancestor's line continues further down (more siblings to come).
    const addSession = (s: AgentSession, open: boolean[], last: boolean, parentRowId?: string) => {
      const id = `session:${s.id}`
      const spawned = childrenOf.get(s.id) ?? []
      const expanded = spawned.length > 0 && options.collapseSpawned === options.toggledAgents.has(s.id)
      const children = expanded ? spawned : []
      const guides: TreeGuide[] = parentRowId ? [...open.map((o): TreeGuide => (o ? 'pipe' : 'none')), last ? 'last' : 'tee'] : []
      rows.push({
        kind: 'session',
        id,
        session: s,
        annotation: input.annotations.get(s.id),
        depth: guides.length,
        guides,
        hasChildren: children.length > 0,
        childCount: spawned.length,
        expanded,
        parentRowId,
        branchRowId: row.id,
      })
      if (parentRowId) spawnLinks.push({ from: parentRowId, to: id })
      const childOpen = parentRowId ? [...open, !last] : []
      children.forEach((child, i) => addSession(child, childOpen, i === children.length - 1, id))
    }
    for (const s of visible) addSession(s, [], true)
    if (visible.length < sessions.length) rows.push({ kind: 'more', id: `more:${row.id}`, branchRowId: row.id, hidden: sessions.length - visible.length })
  }
  const { groups, groupOf } = options.collapseQuiet
    ? groupQuietCommits(commits, edges, branchRows.map(({ row }) => row), input.branches, options.expandedGroups)
    : { groups: [], groupOf: new Map<string, string>() }
  return { rows, commits, edges: groupOf.size ? remapEdges(edges, groupOf) : edges, spawnLinks, groups, groupOf }
}

/**
 * Quiet in the Git sense: commits worth showing individually are branch tips (local and remote),
 * the first own commit of a branch, fork bases, merges and merge sources. Everything else — however
 * many commits an agent made in a burst — is quiet; runs of two or more quiet commits along one
 * row's first-parent chain become a group.
 */
function groupQuietCommits(
  commits: Map<string, PlacedCommit>,
  edges: GraphEdge[],
  branchRows: BranchRow[],
  branches: BranchRef[],
  expanded: Set<string>,
) {
  const keep = new Set<string>(branches.map((b) => b.tipOid).filter(Boolean))
  for (const row of branchRows) if (row.headOid) keep.add(row.headOid)
  for (const e of edges) {
    if (e.kind === 'lane') continue
    keep.add(e.from)
    keep.add(e.to)
  }
  for (const { commit, rowId } of commits.values()) {
    if (commit.parents.length > 1) keep.add(commit.oid)
    const parent = commit.parents[0] ? commits.get(commit.parents[0]) : undefined
    if (!parent || parent.rowId !== rowId) keep.add(commit.oid)
  }
  const byRow = new Map<string, CommitNode[]>()
  for (const { commit, rowId } of commits.values()) byRow.set(rowId, [...(byRow.get(rowId) ?? []), commit])

  const groups: CommitGroup[] = []
  const groupOf = new Map<string, string>()
  for (const [rowId, list] of byRow) {
    list.sort((a, b) => a.time - b.time || a.oid.localeCompare(b.oid))
    let run: CommitNode[] = []
    const close = () => {
      if (run.length >= 2) {
        const id = `grp:${run[0]!.oid}`
        if (!expanded.has(id)) {
          groups.push({ id, rowId, commits: run, start: run[0]!.time * 1000, end: run.at(-1)!.time * 1000 })
          for (const c of run) groupOf.set(c.oid, id)
        }
      }
      run = []
    }
    for (const c of list) {
      const quiet = !keep.has(c.oid)
      if (quiet && (run.length === 0 || c.parents[0] === run.at(-1)!.oid)) run.push(c)
      else {
        close()
        if (quiet) run.push(c)
      }
    }
    close()
  }
  return { groups, groupOf }
}

/** Point edges at group nodes; drop edges inside a group and duplicates. */
function remapEdges(edges: GraphEdge[], groupOf: Map<string, string>): GraphEdge[] {
  const seen = new Set<string>()
  const out: GraphEdge[] = []
  for (const e of edges) {
    const from = groupOf.get(e.from) ?? e.from
    const to = groupOf.get(e.to) ?? e.to
    const key = `${from}>${to}`
    if (from === to || seen.has(key)) continue
    seen.add(key)
    out.push({ ...e, from, to })
  }
  return out
}

/** Latest activity in a repository: newest commit or session activity. */
export function repositoryLastActivity(graph: CommitGraph | undefined, sessions: AgentSession[]): number {
  const commit = Math.max(0, ...(graph?.commits ?? []).map((c) => c.time * 1000))
  const session = Math.max(0, ...sessions.map((s) => Date.parse(s.lastActivityAt ?? '') || 0))
  return Math.max(commit, session)
}
