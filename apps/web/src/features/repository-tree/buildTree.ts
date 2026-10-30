import {
  type AgentSession,
  type AnnotationSummary,
  type BranchRef,
  type PullRequest,
  type Repository,
  sessionNeedsAttention,
  type Snapshot,
  type Worktree,
  worktreeNeedsAttention,
} from '@repobs/contracts'

// Builds the repository -> branch -> worktree -> session tree from a snapshot, then flattens the
// visible part for rendering. Pure and deterministic (unit-tested in buildTree.test.ts).

export type NodeKind =
  | 'repo'
  | 'branch'
  | 'remote'
  | 'worktree'
  | 'session'
  | 'group-detached'
  | 'group-idle-branches'
  | 'group-remote-only'
  | 'group-unassigned'
  | 'group-global-unassigned'

export interface TreeNode {
  id: string
  kind: NodeKind
  label: string
  children: TreeNode[]
  repo?: Repository
  branch?: BranchRef
  worktree?: Worktree
  session?: AgentSession
  annotation?: AnnotationSummary
  pullRequests?: PullRequest[]
  count?: number
  attention: boolean
  /** Text searched by the quick filter (never transcript content). */
  searchText: string
}

export interface FlatRow {
  node: TreeNode
  depth: number
  parentId?: string
  expanded: boolean
  hasChildren: boolean
  posInSet: number
  setSize: number
}

export interface TreeFilter {
  mode: 'all' | 'attention'
  query: string
  showHistorical: boolean
}

export const nodeId = {
  repo: (id: string) => `repo:${id}`,
  branch: (id: string) => `branch:${id}`,
  worktree: (id: string) => `wt:${id}`,
  session: (id: string) => `session:${id}`,
  group: (repoId: string, kind: string) => `group:${repoId}:${kind}`,
}

export function buildTree(snapshot: Snapshot): TreeNode[] {
  const annotations = new Map(snapshot.annotations.map((a) => [a.sessionId, a]))
  const prsByRepo = new Map<string, PullRequest[]>()
  for (const pr of snapshot.pullRequests) prsByRepo.set(pr.repoId, [...(prsByRepo.get(pr.repoId) ?? []), pr])
  const sessionsByWorktree = new Map<string, AgentSession[]>()
  for (const s of snapshot.sessions) {
    if (s.worktreeId) sessionsByWorktree.set(s.worktreeId, [...(sessionsByWorktree.get(s.worktreeId) ?? []), s])
  }

  const sessionNode = (s: AgentSession): TreeNode => {
    const annotation = annotations.get(s.id)
    return {
      id: nodeId.session(s.id),
      kind: 'session',
      label: annotation?.displayAlias || s.title,
      children: [],
      session: s,
      annotation,
      attention: sessionNeedsAttention(s, annotation),
      searchText: [s.title, annotation?.displayAlias, ...(annotation?.tags ?? []), s.providerSessionId, s.provider, s.observedCwd]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }
  }

  const worktreeNode = (w: Worktree): TreeNode => {
    const children = (sessionsByWorktree.get(w.id) ?? []).map(sessionNode)
    return {
      id: nodeId.worktree(w.id),
      kind: 'worktree',
      label: w.displayName,
      children,
      worktree: w,
      attention: worktreeNeedsAttention(w),
      searchText: w.path.toLowerCase(),
    }
  }

  const repos = [...snapshot.repositories].sort((a, b) => a.order - b.order || a.displayName.localeCompare(b.displayName))
  const nodes: TreeNode[] = repos.map((repo) => {
    const worktrees = snapshot.worktrees.filter((w) => w.repoId === repo.id)
    const branches = snapshot.branches.filter((b) => b.repoId === repo.id)
    const prs = prsByRepo.get(repo.id) ?? []
    const wtById = new Map(worktrees.map((w) => [w.id, w]))
    const remoteById = new Map(branches.filter((b) => b.kind === 'remote_tracking').map((b) => [b.fullRef, b]))
    const prsFor = (b: BranchRef) => {
      const remoteShort = b.upstream && remoteById.get(b.upstream.fullRef)?.shortName.split('/').slice(1).join('/')
      return prs.filter((p) => p.headRef === (remoteShort || b.shortName))
    }
    const branchNode = (b: BranchRef, withWorktrees: boolean): TreeNode => ({
      id: nodeId.branch(b.id),
      kind: b.kind === 'local' ? 'branch' : 'remote',
      label: b.shortName,
      children: withWorktrees ? b.worktreeIds.map((id) => wtById.get(id)).filter((w): w is Worktree => !!w).map(worktreeNode) : [],
      branch: b,
      pullRequests: b.kind === 'local' ? prsFor(b) : prs.filter((p) => p.headRef === b.shortName.split('/').slice(1).join('/')),
      attention: false,
      searchText: b.fullRef.toLowerCase(),
    })

    const primaryBranch = worktrees.find((w) => w.isPrimary)?.branchFullRef
    const checkedOut = branches
      .filter((b) => b.kind === 'local' && b.worktreeIds.length > 0)
      .sort((a, b) => Number(b.fullRef === primaryBranch) - Number(a.fullRef === primaryBranch) || a.shortName.localeCompare(b.shortName))
      .map((b) => branchNode(b, true))
    const idle = branches.filter((b) => b.kind === 'local' && b.worktreeIds.length === 0).map((b) => branchNode(b, false))
    const remoteOnly = branches.filter((b) => b.classification === 'remote_only').map((b) => branchNode(b, false))
    // Worktrees not reached through a branch: detached heads, and any branch missing from refs.
    const reached = new Set(checkedOut.flatMap((n) => n.children.map((c) => c.worktree!.id)))
    const detached = worktrees.filter((w) => !reached.has(w.id)).map(worktreeNode)
    const unassigned = snapshot.sessions.filter((s) => s.repoId === repo.id && s.association === 'unassigned').map(sessionNode)

    const group = (kind: NodeKind, key: string, label: string, children: TreeNode[]): TreeNode[] =>
      children.length
        ? [{ id: nodeId.group(repo.id, key), kind, label, children, count: children.length, attention: false, searchText: '' }]
        : []

    const children = [
      ...checkedOut,
      ...group('group-detached', 'detached', 'Detached HEAD', detached),
      ...group('group-idle-branches', 'idle', 'Branches without worktree', idle),
      ...group('group-remote-only', 'remote-only', 'Remote-only', remoteOnly),
      ...group('group-unassigned', 'unassigned', 'Unassigned sessions', unassigned),
    ]
    return {
      id: nodeId.repo(repo.id),
      kind: 'repo',
      label: repo.displayName,
      children,
      repo,
      attention: repo.scanState === 'error',
      searchText: `${repo.displayName} ${repo.primaryPath}`.toLowerCase(),
    }
  })

  const orphaned = snapshot.sessions.filter((s) => !s.repoId).map(sessionNode)
  if (orphaned.length) {
    nodes.push({
      id: 'group:global:unassigned',
      kind: 'group-global-unassigned',
      label: 'Unassigned sessions (no repository)',
      children: orphaned,
      count: orphaned.length,
      attention: false,
      searchText: '',
    })
  }
  return nodes
}

/** Default expansion when the user has not toggled a node. */
export function defaultExpanded(node: TreeNode): boolean {
  switch (node.kind) {
    case 'repo':
    case 'branch':
    case 'worktree':
    case 'group-detached':
    case 'group-unassigned':
      return true
    default:
      return false
  }
}

/** Apply filters: keep matching nodes with their ancestors; a matching container keeps its subtree. */
export function filterTree(nodes: TreeNode[], filter: TreeFilter): { nodes: TreeNode[]; forced: Set<string> } {
  const query = filter.query.trim().toLowerCase()
  const forced = new Set<string>()
  const active = filter.mode === 'attention' || query.length > 0

  const visit = (node: TreeNode, ancestorMatched: boolean): TreeNode | undefined => {
    if (node.session && !filter.showHistorical && node.session.historical && !node.attention) return undefined
    const selfMatch =
      (filter.mode !== 'attention' || node.attention) && (!query || node.searchText.includes(query) || ancestorMatched)
    const children = node.children
      .map((c) => visit(c, ancestorMatched || (!!query && node.searchText.includes(query) && filter.mode === 'all')))
      .filter((c): c is TreeNode => !!c)
    if (!active) return { ...node, children, count: node.count !== undefined ? children.length : undefined }
    if (children.length) {
      forced.add(node.id)
      return { ...node, children, count: node.count !== undefined ? children.length : undefined }
    }
    if (selfMatch && (node.kind === 'session' || node.kind === 'worktree' || node.kind === 'branch' || node.kind === 'remote' || node.kind === 'repo')) {
      return { ...node, children: [] }
    }
    return undefined
  }
  const result = nodes.map((n) => visit(n, false)).filter((n): n is TreeNode => !!n)
  return { nodes: result, forced }
}

export function flattenTree(nodes: TreeNode[], expanded: Record<string, boolean>, forced: Set<string> = new Set()): FlatRow[] {
  const rows: FlatRow[] = []
  const walk = (list: TreeNode[], depth: number, parentId?: string) => {
    list.forEach((node, i) => {
      const hasChildren = node.children.length > 0
      const isExpanded = hasChildren && (forced.has(node.id) || (expanded[node.id] ?? defaultExpanded(node)))
      rows.push({ node, depth, parentId, expanded: isExpanded, hasChildren, posInSet: i + 1, setSize: list.length })
      if (isExpanded) walk(node.children, depth + 1, node.id)
    })
  }
  walk(nodes, 0)
  return rows
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findNode(n.children, id)
    if (hit) return hit
  }
  return undefined
}

/** Ancestors of `id` (outermost first). */
export function ancestorsOf(nodes: TreeNode[], id: string, trail: string[] = []): string[] | undefined {
  for (const n of nodes) {
    if (n.id === id) return trail
    const hit = ancestorsOf(n.children, id, [...trail, n.id])
    if (hit) return hit
  }
  return undefined
}
