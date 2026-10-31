import { useCallback, useState } from 'react'
import { type Provider, type WorkflowStatus } from '@repobs/contracts'
import { DEFAULT_FILTERS, type DashboardFilters } from '../features/dashboard/filters'
import type { BranchMode } from '../features/dashboard/layout'
import type { AxisMode } from '../features/dashboard/timeline'

// Per-browser view preferences (panels, filters, toggles, selection). Conveniences, not user data:
// annotations and settings live on the server.

export type TimeRange = '1d' | '7d' | '30d' | '90d' | '365d' | 'all'
export type RepoSort = 'activity' | 'active' | 'name' | 'manual'

export interface ViewState {
  selectedId?: string
  filters: DashboardFilters
  /** Agent names in the label column (off: the column narrows to the spawn tree and status). */
  agentNames: boolean
  /** Agent labels at the end of each activity bar on the timeline. */
  barLabels: boolean
  /** Spawned agents start hidden under their parent (its chevron shows them). */
  collapseSpawned: boolean
  /** Agents whose spawned agents are shown (when collapsing) or hidden (when not); reset when that switch changes. */
  toggledAgents: string[]
  axisMode: AxisMode
  /** Horizontal zoom of the shared axis (1 = fit the commits to the viewport where possible). */
  zoom: number
  /** Collapse runs of commits that change nothing in the topology. */
  collapseQuiet: boolean
  /** Collapsed groups the user opened (reset when collapsing is switched on again). */
  expandedGroups: string[]
  legendOpen: boolean
  branchMode: BranchMode
  showRemoteOnly: boolean
  timeRange: TimeRange
  repoSort: RepoSort
  hiddenRepos: string[]
  collapsedRepos: string[]
  expandedBranches: string[]
}

const KEY = 'repobs.view.v2'

export const DEFAULT_VIEW: ViewState = {
  filters: DEFAULT_FILTERS,
  agentNames: true,
  barLabels: true,
  collapseSpawned: true,
  toggledAgents: [],
  axisMode: 'sequence',
  zoom: 1,
  collapseQuiet: false,
  expandedGroups: [],
  legendOpen: false,
  branchMode: 'all',
  showRemoteOnly: false,
  timeRange: 'all',
  repoSort: 'activity',
  hiddenRepos: [],
  collapsedRepos: [],
  expandedBranches: [],
}

const STATUSES: WorkflowStatus[] = ['needs_input', 'working', 'needs_review', 'unreviewed', 'complete', 'unknown']

export function loadView(): ViewState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_VIEW
    const p = JSON.parse(raw) as Partial<ViewState>
    // Replaced by spawned-agent collapsing (agents no longer expand to show details).
    for (const old of ['details', 'showSpawned', 'expandedAgents']) delete (p as Record<string, unknown>)[old]
    const f = { ...DEFAULT_FILTERS, ...(p.filters ?? {}) }
    return {
      ...DEFAULT_VIEW,
      ...p,
      filters: {
        ...f,
        // 'ready' was renamed 'unreviewed'.
        statuses: (f.statuses ?? []).map((s) => ((s as string) === 'ready' ? 'unreviewed' : s)).filter((s) => STATUSES.includes(s)),
        tags: Array.isArray(f.tags) ? f.tags : [],
        harnesses: storedHarnesses(p.filters),
      },
      hiddenRepos: Array.isArray(p.hiddenRepos) ? p.hiddenRepos : [],
      collapsedRepos: Array.isArray(p.collapsedRepos) ? p.collapsedRepos : [],
      expandedBranches: Array.isArray(p.expandedBranches) ? p.expandedBranches : [],
      toggledAgents: Array.isArray(p.toggledAgents) ? p.toggledAgents : [],
      collapseSpawned: p.collapseSpawned !== false,
      axisMode: p.axisMode === 'time' || p.axisMode === 'compressed' ? p.axisMode : 'sequence',
      zoom: clamp(Number(p.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
      collapseQuiet: p.collapseQuiet === true,
      agentNames: p.agentNames !== false,
      barLabels: p.barLabels !== false,
      expandedGroups: Array.isArray(p.expandedGroups) ? p.expandedGroups : [],
      // Views saved before the commit-order axis existed defaulted to a 7-day window.
      timeRange: p.axisMode ? (p.timeRange ?? 'all') : 'all',
    }
  } catch {
    return DEFAULT_VIEW
  }
}

const HARNESSES: Provider[] = ['claude', 'codex']

/** The harness filter; views saved before it was a list had one switch per harness. */
function storedHarnesses(f: unknown): Provider[] {
  const o = (f ?? {}) as { harnesses?: unknown; claude?: unknown; codex?: unknown }
  const list = o.harnesses
  if (Array.isArray(list)) return HARNESSES.filter((h) => list.includes(h))
  const on = HARNESSES.filter((h) => o[h] !== false)
  return on.length === HARNESSES.length ? [] : on
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 16

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function useViewState(): [ViewState, (patch: Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)) => void] {
  const [view, setView] = useState<ViewState>(loadView)
  const update = useCallback((patch: Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)) => {
    setView((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // storage full or disabled: the view still works for this session
      }
      return next
    })
  }, [])
  return [view, update]
}

export const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '1d': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
  '365d': 365 * 86_400_000,
}
