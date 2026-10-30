import { type AgentSession, type AnnotationSummary, type WorkflowStatus, workflowStatus } from '@repobs/contracts'

// Dashboard filters (ADR 0003). Applied to sessions only; branches and commits are always shown
// according to the branch mode.

export interface DashboardFilters {
  claude: boolean
  codex: boolean
  /** Only sessions whose last message is newer than this many days (null = any time). */
  lastMessageDays: number | null
  /** Empty = every status. */
  statuses: WorkflowStatus[]
  /** Any-of match. Empty = no tag filter. */
  tags: string[]
  query: string
}

export const DEFAULT_FILTERS: DashboardFilters = { claude: true, codex: true, lastMessageDays: null, statuses: [], tags: [], query: '' }

export const LAST_MESSAGE_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: 'Any time', days: null },
  { label: 'Last 24 hours', days: 1 },
  { label: 'Last 2 days', days: 2 },
  { label: 'Last 3 days', days: 3 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 40 days', days: 40 },
]

export function filtersActive(f: DashboardFilters): boolean {
  return !f.claude || !f.codex || f.lastMessageDays !== null || f.statuses.length > 0 || f.tags.length > 0 || f.query.trim() !== ''
}

export function sessionMatches(s: AgentSession, a: AnnotationSummary | undefined, f: DashboardFilters, now: number): boolean {
  if (s.provider === 'claude' && !f.claude) return false
  if (s.provider === 'codex' && !f.codex) return false
  if (f.lastMessageDays !== null) {
    const last = Date.parse(s.lastActivityAt ?? '')
    if (!last || now - last > f.lastMessageDays * 86_400_000) return false
  }
  if (f.statuses.length && !f.statuses.includes(workflowStatus(s, a))) return false
  if (f.tags.length && !f.tags.some((t) => a?.tags.includes(t))) return false
  const q = f.query.trim().toLowerCase()
  if (q) {
    const hay = [s.title, a?.displayAlias, ...(a?.tags ?? []), s.providerSessionId, s.provider, s.agentType, s.lastMessage?.text, s.recordedBranch]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  return true
}

/** All tags in use, most used first (for filter chips and autocomplete). */
export function knownTags(annotations: AnnotationSummary[]): string[] {
  const counts = new Map<string, number>()
  for (const a of annotations) for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([t]) => t)
}

/** Prefix matches first, then substring matches; excludes tags already chosen. */
export function suggestTags(all: string[], input: string, exclude: string[] = [], limit = 8): string[] {
  const q = input.trim().toLowerCase()
  const pool = all.filter((t) => !exclude.includes(t))
  if (!q) return pool.slice(0, limit)
  const prefix = pool.filter((t) => t.toLowerCase().startsWith(q))
  const contains = pool.filter((t) => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q))
  return [...prefix, ...contains].slice(0, limit)
}
