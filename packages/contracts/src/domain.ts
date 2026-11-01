import { z } from 'zod'

// Domain contracts shared by the server, the web UI and the tests. Field names follow
// docs/architecture.md; every observed status carries its evidence (source, time, confidence).

export const IsoDate = z.string().max(64)

export const Provider = z.enum(['claude', 'codex'])
export type Provider = z.infer<typeof Provider>

export const ErrorInfo = z.object({
  code: z.string().max(64),
  message: z.string().max(500),
})
export type ErrorInfo = z.infer<typeof ErrorInfo>

export const Repository = z.object({
  id: z.string(),
  displayName: z.string(),
  /** Path the user registered (display form). */
  registeredPath: z.string(),
  /** Top-level of the primary (first-listed) worktree, or the bare repository directory. */
  primaryPath: z.string(),
  /** Absolute common Git directory; the repository identity. */
  commonGitDir: z.string(),
  isBare: z.boolean(),
  order: z.number().int(),
  addedAt: IsoDate,
  lastSuccessfulScanAt: IsoDate.optional(),
  scanState: z.enum(['pending', 'ok', 'error']),
  error: ErrorInfo.optional(),
})
export type Repository = z.infer<typeof Repository>

export const BranchClassification = z.enum([
  'checked_out',
  'local_tracking',
  'local_only',
  'remote_tracking',
  'remote_only',
])
export type BranchClassification = z.infer<typeof BranchClassification>

export const Upstream = z.object({
  fullRef: z.string(),
  /** The configured upstream ref no longer exists locally (removed or renamed). */
  gone: z.boolean(),
  ahead: z.number().int().optional(),
  behind: z.number().int().optional(),
})
export type Upstream = z.infer<typeof Upstream>

export const BranchRef = z.object({
  id: z.string(),
  repoId: z.string(),
  fullRef: z.string(),
  shortName: z.string(),
  kind: z.enum(['local', 'remote_tracking']),
  remoteName: z.string().optional(),
  /** Empty for an unborn branch (checked out but without commits). */
  tipOid: z.string(),
  unborn: z.boolean(),
  upstream: Upstream.optional(),
  classification: BranchClassification,
  /** Worktree ids where this local branch is checked out (normally 0 or 1). */
  worktreeIds: z.array(z.string()),
  /** For remote-tracking refs: local branch ids that track this ref. */
  trackedByIds: z.array(z.string()),
})
export type BranchRef = z.infer<typeof BranchRef>

export const GitOperation = z.enum(['merge', 'rebase', 'cherry_pick', 'revert', 'bisect'])
export type GitOperation = z.infer<typeof GitOperation>

export const WorktreeStatus = z.object({
  state: z.enum(['ok', 'error', 'unavailable', 'pending']),
  staged: z.number().int(),
  unstaged: z.number().int(),
  untracked: z.number().int(),
  conflicted: z.number().int(),
  ahead: z.number().int().optional(),
  behind: z.number().int().optional(),
  gitOperation: GitOperation.optional(),
  error: ErrorInfo.optional(),
})
export type WorktreeStatus = z.infer<typeof WorktreeStatus>

export const Worktree = z.object({
  id: z.string(),
  repoId: z.string(),
  path: z.string(),
  displayName: z.string(),
  isPrimary: z.boolean(),
  bare: z.boolean(),
  headOid: z.string().optional(),
  branchFullRef: z.string().optional(),
  detached: z.boolean(),
  locked: z.boolean(),
  lockReason: z.string().optional(),
  prunable: z.boolean(),
  prunableReason: z.string().optional(),
  /** The directory Git lists no longer exists on disk. */
  missing: z.boolean(),
  status: WorktreeStatus,
  lastStatusAt: IsoDate.optional(),
})
export type Worktree = z.infer<typeof Worktree>

export const ObservedStateKind = z.enum([
  'running',
  'running_subagents',
  'waiting_approval',
  'waiting_user',
  'idle_or_turn_finished',
  'ended',
  'unknown',
  'error',
])
export type ObservedStateKind = z.infer<typeof ObservedStateKind>

export const Confidence = z.enum(['direct', 'inferred', 'unknown'])
export type Confidence = z.infer<typeof Confidence>

/** Structural, non-sensitive reasons. Never transcript text. */
export const StateDetail = z.enum([
  'provider_reports_busy',
  'provider_reports_idle',
  'provider_reports_other',
  'process_not_running',
  'turn_in_progress',
  'tool_pending',
  'turn_completed',
  'turn_aborted',
  'approval_requested',
  'user_input_requested',
  'subagent_active',
  'stale_evidence',
  'no_lifecycle_records',
  'unrecognized_records',
  'provider_error_event',
  'source_missing',
])
export type StateDetail = z.infer<typeof StateDetail>

export const ObservedAgentState = z.object({
  kind: ObservedStateKind,
  confidence: Confidence,
  /** Machine-readable evidence source, e.g. `claude.session-registry`, `codex.rollout`. */
  source: z.string(),
  /** When the evidence was produced (provider timestamp), not when repobs looked. */
  observedAt: IsoDate.optional(),
  detail: StateDetail.optional(),
  /** The tool call may be executing or waiting for permission; repobs cannot tell which. */
  possiblyAwaitingApproval: z.boolean().optional(),
})
export type ObservedAgentState = z.infer<typeof ObservedAgentState>

export const SessionAssociation = z.enum([
  /** cwd resolves to a current worktree of a registered repository. */
  'matched',
  /** related to a registered repository but no current worktree can be matched safely. */
  'unassigned',
])
export type SessionAssociation = z.infer<typeof SessionAssociation>

export const UnassignedReason = z.enum([
  'cwd_missing',
  'worktree_removed',
  'no_matching_worktree',
  'source_missing',
])
export type UnassignedReason = z.infer<typeof UnassignedReason>

export const LastMessage = z.object({
  kind: z.enum(['assistant', 'tool']),
  text: z.string().max(400),
  at: IsoDate.optional(),
})
export type LastMessage = z.infer<typeof LastMessage>

export const PlanItemStatus = z.enum(['pending', 'in_progress', 'completed'])
export type PlanItemStatus = z.infer<typeof PlanItemStatus>

/** Which planning tool a plan came from (ADR 0009). */
export const AgentPlanSource = z.enum(['claude_task_list', 'claude_todo', 'codex_update_plan'])
export type AgentPlanSource = z.infer<typeof AgentPlanSource>

/**
 * The step list an agent keeps with its own planning tool, as the agent last reported it. Text is
 * the agent's: held in memory only, never stored. `key` identifies an item for your ticks.
 */
export const AgentPlan = z.object({
  source: AgentPlanSource,
  updatedAt: IsoDate.optional(),
  items: z.array(z.object({ key: z.string(), text: z.string(), status: PlanItemStatus })),
})
export type AgentPlan = z.infer<typeof AgentPlan>

export const AgentSession = z.object({
  id: z.string(),
  provider: Provider,
  providerSessionId: z.string(),
  title: z.string(),
  titleSource: z.enum(['provider', 'fallback']),
  observedCwd: z.string().optional(),
  worktreeId: z.string().optional(),
  repoId: z.string().optional(),
  association: SessionAssociation,
  unassignedReason: UnassignedReason.optional(),
  firstSeenAt: IsoDate.optional(),
  lastActivityAt: IsoDate.optional(),
  state: ObservedAgentState,
  /** Older than the historical threshold and not reported live by the provider. */
  historical: z.boolean(),
  /** The provider's session source (file) currently exists. */
  sourceAvailable: z.boolean(),
  subagents: z.object({ total: z.number().int(), active: z.number().int() }),
  providerVersion: z.string().optional(),
  /** Branch the provider recorded during the session; historical, not today's checkout. */
  recordedBranch: z.string().optional(),
  /** Safe structural label such as "Turn completed". */
  activityLabel: z.string().optional(),
  /** Session that spawned this one (Claude Code subagent, Codex sub-thread). */
  parentSessionId: z.string().optional(),
  /** Provider's agent type or nickname for spawned agents. */
  agentType: z.string().optional(),
  /** Truncated, redacted excerpt of the latest agent message or tool activity (ADR 0003). In memory only. */
  lastMessage: LastMessage.optional(),
  /** The agent's own step list (ADR 0009). In memory only. */
  plan: AgentPlan.optional(),
})
export type AgentSession = z.infer<typeof AgentSession>

/** Your review of an agent's work. `outdated`: no longer relevant (often set by an automation rule). */
export const ReviewState = z.enum(['unreviewed', 'needs_review', 'reviewed', 'complete', 'flagged', 'outdated'])
export type ReviewState = z.infer<typeof ReviewState>

export const LIMITS = {
  noteChars: 20_000,
  tagChars: 40,
  tags: 32,
  checklistItems: 200,
  checklistTextChars: 500,
  aliasChars: 120,
  pathChars: 1024,
} as const

export const ChecklistItem = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(LIMITS.checklistTextChars),
  done: z.boolean(),
  order: z.number().int(),
  createdAt: IsoDate,
  completedAt: IsoDate.optional(),
})
export type ChecklistItem = z.infer<typeof ChecklistItem>

export const PlanOverrides = z
  .record(z.string().regex(/^[0-9a-f]{16}$/), z.boolean())
  .refine((r) => Object.keys(r).length <= LIMITS.checklistItems, 'Too many plan overrides')
export type PlanOverrides = z.infer<typeof PlanOverrides>

export const SessionAnnotation = z.object({
  sessionId: z.string(),
  displayAlias: z.string().max(LIMITS.aliasChars).optional(),
  review: ReviewState,
  tags: z.array(z.string().min(1).max(LIMITS.tagChars)).max(LIMITS.tags),
  note: z.string().max(LIMITS.noteChars),
  checklist: z.array(ChecklistItem).max(LIMITS.checklistItems),
  /** Your ticks (true) and unticks (false) of agent plan items, by item key; they win over the agent's status. */
  planOverrides: PlanOverrides.default({}),
  createdAt: IsoDate,
  updatedAt: IsoDate,
})
export type SessionAnnotation = z.infer<typeof SessionAnnotation>

/** Compact projection used by the tree, filters and search. */
export const AnnotationSummary = z.object({
  sessionId: z.string(),
  displayAlias: z.string().optional(),
  review: ReviewState,
  tags: z.array(z.string()),
  hasNote: z.boolean(),
  note: z.string(),
  checklistOpen: z.number().int(),
  checklistDone: z.number().int(),
  /** The checklist itself, for the dashboard's checklist pill. */
  checklist: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean() })),
  /** Your ticks and unticks of agent plan items, by item key. */
  planOverrides: z.record(z.string(), z.boolean()),
  updatedAt: IsoDate,
})
export type AnnotationSummary = z.infer<typeof AnnotationSummary>

export const PullRequest = z.object({
  id: z.string(),
  repoId: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  headRef: z.string(),
  baseRef: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  updatedAt: IsoDate.optional(),
  fetchedAt: IsoDate,
})
export type PullRequest = z.infer<typeof PullRequest>

export const PullRequestStatus = z.object({
  repoId: z.string(),
  state: z.enum(['disabled', 'ok', 'error', 'no_github_remote', 'pending']),
  remote: z.string().optional(),
  fetchedAt: IsoDate.optional(),
  error: ErrorInfo.optional(),
})
export type PullRequestStatus = z.infer<typeof PullRequestStatus>

export const CommitNode = z.object({
  oid: z.string(),
  parents: z.array(z.string()),
  /** Committer time, unix seconds. */
  time: z.number().int(),
  subject: z.string(),
  /** Reachable from a remote-tracking ref (within the loaded window). */
  pushed: z.boolean(),
})
export type CommitNode = z.infer<typeof CommitNode>

export const CommitGraph = z.object({
  repoId: z.string(),
  commits: z.array(CommitNode),
  /** More commits exist than were loaded. */
  truncated: z.boolean(),
  scannedAt: IsoDate,
  error: ErrorInfo.optional(),
})
export type CommitGraph = z.infer<typeof CommitGraph>

export const MonitorHealth = z.object({
  state: z.enum(['starting', 'ok', 'degraded']),
  lastSyncAt: IsoDate.optional(),
  errors: z.array(ErrorInfo),
})
export type MonitorHealth = z.infer<typeof MonitorHealth>

export const Snapshot = z.object({
  version: z.number().int(),
  generatedAt: IsoDate,
  repositories: z.array(Repository),
  branches: z.array(BranchRef),
  worktrees: z.array(Worktree),
  sessions: z.array(AgentSession),
  annotations: z.array(AnnotationSummary),
  pullRequests: z.array(PullRequest),
  pullRequestStatus: z.array(PullRequestStatus),
  commitGraphs: z.array(CommitGraph),
  monitor: MonitorHealth,
})
export type Snapshot = z.infer<typeof Snapshot>

export const ENTITY_COLLECTIONS = [
  'repositories',
  'branches',
  'worktrees',
  'sessions',
  'annotations',
  'pullRequests',
  'pullRequestStatus',
  'commitGraphs',
] as const
export type EntityCollection = (typeof ENTITY_COLLECTIONS)[number]

/** Versioned diff published over SSE. Clients refetch the snapshot on a version gap. */
export const SnapshotDiff = z.object({
  fromVersion: z.number().int(),
  toVersion: z.number().int(),
  generatedAt: IsoDate,
  upserts: z.object({
    repositories: z.array(Repository),
    branches: z.array(BranchRef),
    worktrees: z.array(Worktree),
    sessions: z.array(AgentSession),
    annotations: z.array(AnnotationSummary),
    pullRequests: z.array(PullRequest),
    pullRequestStatus: z.array(PullRequestStatus),
    commitGraphs: z.array(CommitGraph),
  }),
  removes: z.object({
    repositories: z.array(z.string()),
    branches: z.array(z.string()),
    worktrees: z.array(z.string()),
    sessions: z.array(z.string()),
    annotations: z.array(z.string()),
    pullRequests: z.array(z.string()),
    pullRequestStatus: z.array(z.string()),
    commitGraphs: z.array(z.string()),
  }),
})
export type SnapshotDiff = z.infer<typeof SnapshotDiff>

/** Primary key of each entity collection. */
export function entityKey(collection: EntityCollection, entity: object): string {
  const e = entity as Record<string, unknown>
  if (collection === 'annotations') return String(e.sessionId)
  if (collection === 'pullRequestStatus' || collection === 'commitGraphs') return String(e.repoId)
  return String(e.id)
}
