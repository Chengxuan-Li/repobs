import type {
  AgentSession,
  AnnotationSummary,
  ObservedAgentState,
  ObservedStateKind,
  ReviewState,
  StateDetail,
  Worktree,
} from './domain.ts'

// Display semantics shared by the UI and tests, so the meaning of a status is defined once.
// docs/status-semantics.md explains each label.

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export const STATE_LABELS: Record<ObservedStateKind, string> = {
  running: 'Running',
  running_subagents: 'Running subagents',
  waiting_approval: 'Awaiting approval',
  waiting_user: 'Awaiting input',
  idle_or_turn_finished: 'Idle / turn finished',
  ended: 'Ended',
  unknown: 'Unknown',
  error: 'Error',
}

/** Running is "info" (activity), never "success": activity is not a result. */
export const STATE_TONES: Record<ObservedStateKind, Tone> = {
  running: 'info',
  running_subagents: 'info',
  waiting_approval: 'warning',
  waiting_user: 'warning',
  idle_or_turn_finished: 'neutral',
  ended: 'neutral',
  unknown: 'neutral',
  error: 'danger',
}

export const DETAIL_LABELS: Record<StateDetail, string> = {
  provider_reports_busy: 'Provider reports the session busy',
  provider_reports_idle: 'Provider reports the session idle',
  provider_reports_other: 'Provider reported a status repobs does not recognize',
  process_not_running: 'The recorded provider process is no longer running',
  turn_in_progress: 'Prompt or tool result recorded; model turn in progress',
  tool_pending: 'Tool call pending: executing or awaiting permission',
  turn_completed: 'Turn completed',
  turn_aborted: 'Turn interrupted',
  approval_requested: 'Approval request recorded',
  user_input_requested: 'User input request recorded',
  subagent_active: 'A subagent shows recent activity',
  stale_evidence: 'Last evidence is older than the stale threshold',
  no_lifecycle_records: 'No turn lifecycle records found',
  unrecognized_records: 'Records in an unrecognized format',
  provider_error_event: 'Provider recorded an error event',
  source_missing: 'The provider session file no longer exists',
}

export const CONFIDENCE_LABELS = {
  direct: 'Direct (provider-reported)',
  inferred: 'Inferred from local records',
  unknown: 'Unknown',
} as const

export const REVIEW_LABELS: Record<ReviewState, string> = {
  unreviewed: 'Unreviewed',
  needs_review: 'Needs review',
  reviewed: 'Reviewed',
  complete: 'Complete',
  flagged: 'Flagged',
}

export const REVIEW_TONES: Record<ReviewState, Tone> = {
  unreviewed: 'neutral',
  needs_review: 'warning',
  reviewed: 'info',
  complete: 'success',
  flagged: 'danger',
}

export function stateLabel(state: ObservedAgentState): string {
  if (state.kind === 'unknown' && state.possiblyAwaitingApproval) return 'Unknown · tool pending'
  if (state.kind === 'running' && state.possiblyAwaitingApproval) return 'Busy · tool pending'
  return STATE_LABELS[state.kind]
}

export function isLiveKind(kind: ObservedStateKind): boolean {
  return kind === 'running' || kind === 'running_subagents' || kind === 'waiting_approval' || kind === 'waiting_user'
}

export function sessionNeedsAttention(session: AgentSession, annotation?: AnnotationSummary): boolean {
  const s = session.state
  if (s.kind === 'waiting_approval' || s.kind === 'waiting_user' || s.kind === 'error') return true
  if (s.possiblyAwaitingApproval && !session.historical) return true
  if (annotation && (annotation.review === 'needs_review' || annotation.review === 'flagged')) return true
  return false
}

export function worktreeNeedsAttention(worktree: Worktree): boolean {
  const st = worktree.status
  return (
    st.conflicted > 0 ||
    st.gitOperation !== undefined ||
    st.state === 'error' ||
    worktree.missing ||
    worktree.prunable
  )
}

export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8)
}

export function fallbackSessionTitle(provider: 'claude' | 'codex', providerSessionId: string): string {
  return `${provider === 'claude' ? 'Claude' : 'Codex'} session ${shortId(providerSessionId)}`
}

/**
 * Workflow status used by dashboard filters and cards: combines what the agent is observed doing
 * with what the human decided. Agent activity that needs a person wins; then running work; then
 * the human review state; a finished session nobody has reviewed yet is "unreviewed" (never shown
 * as a success: finishing is not a result), otherwise unknown.
 */
export type WorkflowStatus = 'needs_input' | 'working' | 'needs_review' | 'unreviewed' | 'complete' | 'unknown'

export const WORKFLOW_LABELS: Record<WorkflowStatus, string> = {
  needs_input: 'Needs input',
  working: 'Working',
  needs_review: 'Needs review',
  unreviewed: 'Unreviewed',
  complete: 'Complete',
  unknown: 'Unknown',
}

export const WORKFLOW_TONES: Record<WorkflowStatus, Tone> = {
  needs_input: 'warning',
  working: 'info',
  needs_review: 'warning',
  unreviewed: 'neutral',
  complete: 'success',
  unknown: 'neutral',
}

export function workflowStatus(session: AgentSession, annotation?: AnnotationSummary): WorkflowStatus {
  const s = session.state
  if (s.kind === 'waiting_approval' || s.kind === 'waiting_user' || s.kind === 'error') return 'needs_input'
  if (s.possiblyAwaitingApproval && !session.historical) return 'needs_input'
  if (s.kind === 'running' || s.kind === 'running_subagents') return 'working'
  if (annotation?.review === 'needs_review' || annotation?.review === 'flagged') return 'needs_review'
  if (annotation?.review === 'reviewed' || annotation?.review === 'complete') return 'complete'
  if (s.kind === 'idle_or_turn_finished' || s.kind === 'ended') return 'unreviewed'
  return 'unknown'
}
