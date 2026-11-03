import type { AgentPlan, LastMessage, ObservedAgentState, Provider } from '@repobs/contracts'
import type { Lifecycle } from './status.ts'
import type { ActivitySources } from './activity/service.ts'

export interface AdapterConfig {
  enabled: boolean
  /** Settings override; null/undefined uses the provider environment variable, then the default. */
  home: string | null | undefined
  staleAfterMs: number
  /** Extract latest-message excerpts (Settings → Privacy). */
  excerpts?: boolean
  /** Replay agents' plan tool calls (Settings → Privacy, ADR 0009). */
  plans?: boolean
}

/** Provider-neutral result of discovery; contains structural metadata only. */
export interface DiscoveredSession {
  id: string
  provider: Provider
  providerSessionId: string
  title?: string
  cwd?: string
  firstSeenAt?: string
  lastActivityAt?: string
  providerVersion?: string
  recordedBranch?: string
  /** Id (repobs form) of the session that spawned this one. */
  parentSessionId?: string
  agentType?: string
  lastMessage?: LastMessage
  /** The agent's own step list (ADR 0009), when plans are read. */
  plan?: AgentPlan
  lifecycle: Lifecycle
  state: ObservedAgentState
  /** Provider reports a live process for this session. */
  live: boolean
  subagents: { total: number; active: number }
  sourceFiles: number
}

export interface AdapterProblem {
  code: string
  message: string
  count: number
}

export interface AdapterStatus {
  provider: Provider
  enabled: boolean
  available: boolean
  root: string
  rootSource: 'settings' | 'environment' | 'default'
  filesTracked: number
  liveRegistryEntries?: number
  lastScanAt?: string
  lastScanMs?: number
  problems: AdapterProblem[]
}

export interface SessionAdapter {
  readonly provider: Provider
  configure(config: AdapterConfig): void
  /** Incremental discovery of all sessions (pre-existing and new). Never throws for bad data. */
  discover(now?: number): Promise<DiscoveredSession[]>
  /** Directories to watch for changes (non-existent ones are skipped by the monitor). */
  watchTargets(): string[]
  status(): AdapterStatus
  /** The files holding one session's history, oldest first, for its activity (ADR 0013). */
  activitySources?(providerSessionId: string): ActivitySources | undefined
}

/** Collects sanitized problems with counts; messages never include transcript text. */
export class ProblemLog {
  private readonly problems = new Map<string, AdapterProblem>()
  add(code: string, message: string) {
    const p = this.problems.get(code)
    if (p) p.count++
    else this.problems.set(code, { code, message, count: 1 })
  }
  clear() {
    this.problems.clear()
  }
  list(): AdapterProblem[] {
    return [...this.problems.values()]
  }
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const asString = (v: unknown, max = 1024): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined

export function laterIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

export function earlierIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b
  if (!b) return a
  return Date.parse(b) < Date.parse(a) ? b : a
}

/** Accept only ISO-like timestamps from provider records. */
export function asIso(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString()
  if (typeof v === 'number' && Number.isFinite(v) && v > 1e12 && v < 1e14) return new Date(v).toISOString()
  return undefined
}
