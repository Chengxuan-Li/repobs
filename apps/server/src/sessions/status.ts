import type { ObservedAgentState } from '@repobs/contracts'

// Provider-neutral state resolution. Inputs are structural facts extracted by adapters; output is
// an ObservedAgentState with evidence. Rules are documented in docs/status-semantics.md and pinned
// by tests/sessions/status.test.ts. Inactivity never becomes "waiting approval".

export type LifecyclePhase =
  | 'none'
  | 'turn_in_progress'
  | 'tool_pending'
  | 'turn_completed'
  | 'turn_aborted'
  | 'approval_requested'
  | 'user_input_requested'
  | 'error_event'

export interface Lifecycle {
  phase: LifecyclePhase
  /** Provider timestamp of the record that set the phase. */
  at?: string
}

export interface RegistryEvidence {
  /** Raw provider status token, e.g. "busy" / "idle". */
  status: string
  /** true/false when liveness could be checked; undefined when it could not. */
  alive: boolean | undefined
  statusAt?: string
}

export interface StateInput {
  source: string
  lifecycle: Lifecycle
  registry?: RegistryEvidence
  registrySource?: string
  subagentsActive: number
  sourceAvailable: boolean
  unrecognizedRecords: number
  now: number
  staleAfterMs: number
}

const age = (now: number, at?: string) => (at ? now - Date.parse(at) : Number.POSITIVE_INFINITY)

export function resolveState(input: StateInput): ObservedAgentState {
  const { lifecycle, registry, now, staleAfterMs } = input
  const pending = lifecycle.phase === 'tool_pending'

  if (registry && registry.alive === true) {
    const source = input.registrySource ?? `${input.source}.registry`
    if (registry.status === 'busy') {
      return {
        kind: 'running',
        confidence: 'direct',
        source,
        observedAt: registry.statusAt,
        detail: 'provider_reports_busy',
        ...(pending ? { possiblyAwaitingApproval: true } : {}),
      }
    }
    if (registry.status === 'idle') {
      if (input.subagentsActive > 0) {
        return { kind: 'running_subagents', confidence: 'inferred', source, observedAt: registry.statusAt, detail: 'subagent_active' }
      }
      return { kind: 'idle_or_turn_finished', confidence: 'direct', source, observedAt: registry.statusAt, detail: 'provider_reports_idle' }
    }
    return { kind: 'unknown', confidence: 'unknown', source, observedAt: registry.statusAt, detail: 'provider_reports_other' }
  }
  if (registry && registry.alive === false) {
    return {
      kind: 'ended',
      confidence: 'inferred',
      source: input.registrySource ?? `${input.source}.registry`,
      observedAt: registry.statusAt,
      detail: 'process_not_running',
    }
  }
  if (!input.sourceAvailable) {
    return { kind: 'unknown', confidence: 'unknown', source: input.source, detail: 'source_missing' }
  }

  const base = { source: input.source, observedAt: lifecycle.at }
  const stale = age(now, lifecycle.at) > staleAfterMs
  const staleState = (): ObservedAgentState => ({ kind: 'unknown', confidence: 'unknown', ...base, detail: 'stale_evidence' })

  switch (lifecycle.phase) {
    case 'none':
      return {
        kind: 'unknown',
        confidence: 'unknown',
        ...base,
        detail: input.unrecognizedRecords > 0 ? 'unrecognized_records' : 'no_lifecycle_records',
      }
    case 'turn_in_progress':
      if (stale) return staleState()
      return { kind: 'running', confidence: 'inferred', ...base, detail: 'turn_in_progress' }
    case 'tool_pending':
      if (stale) return staleState()
      // A pending tool call is either executing or waiting for permission; the log cannot tell which.
      return { kind: 'unknown', confidence: 'unknown', ...base, detail: 'tool_pending', possiblyAwaitingApproval: true }
    case 'approval_requested':
      if (stale) return staleState()
      return { kind: 'waiting_approval', confidence: 'inferred', ...base, detail: 'approval_requested' }
    case 'user_input_requested':
      if (stale) return staleState()
      return { kind: 'waiting_user', confidence: 'inferred', ...base, detail: 'user_input_requested' }
    case 'error_event':
      return { kind: 'error', confidence: 'inferred', ...base, detail: 'provider_error_event' }
    case 'turn_completed':
    case 'turn_aborted':
      if (input.subagentsActive > 0) {
        return { kind: 'running_subagents', confidence: 'inferred', ...base, detail: 'subagent_active' }
      }
      return {
        kind: 'idle_or_turn_finished',
        confidence: 'inferred',
        ...base,
        detail: lifecycle.phase === 'turn_aborted' ? 'turn_aborted' : 'turn_completed',
      }
  }
}

const ACTIVITY_LABELS: Partial<Record<LifecyclePhase, string>> = {
  turn_in_progress: 'Turn in progress',
  tool_pending: 'Tool call pending',
  turn_completed: 'Turn completed',
  turn_aborted: 'Turn interrupted',
  approval_requested: 'Approval requested',
  user_input_requested: 'Input requested',
  error_event: 'Error recorded',
}

/** Safe structural label for the latest recorded activity (never transcript text). */
export function activityLabel(phase: LifecyclePhase): string | undefined {
  return ACTIVITY_LABELS[phase]
}

export function isActivePhase(phase: LifecyclePhase): boolean {
  return phase === 'turn_in_progress' || phase === 'tool_pending' || phase === 'approval_requested' || phase === 'user_input_requested'
}
