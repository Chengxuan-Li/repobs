import { useCallback, useState } from 'react'
import { type WorkflowStatus } from '@repobs/contracts'
import { DEFAULT_FILTERS, type DashboardFilters } from '../features/dashboard/filters'
import type { BranchMode } from '../features/dashboard/layout'
import type { AxisMode } from '../features/dashboard/timeline'

// Per-browser view preferences (panels, filters, toggles, selection). Conveniences, not user data:
// annotations and settings live on the server.

export type TimeRange = '1d' | '7d' | '30d' | '90d' | '365d' | 'all'
export type RepoSort = 'activity' | 'active' | 'name' | 'manual'

export interface ViewState {
  leftOpen: boolean
  rightOpen: boolean
  leftWidth: number
  rightWidth: number
  selectedId?: string
  filters: DashboardFilters
  /** Expand every agent row (otherwise rows are one line; expand individually). */
  details: boolean
  expandedAgents: string[]
  axisMode: AxisMode
  /** Collapse runs of commits that change nothing in the topology. */
  collapseQuiet: boolean
  /** Collapsed groups the user opened (reset when collapsing is switched on again). */
  expandedGroups: string[]
  legendOpen: boolean
  showSpawned: boolean
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
  leftOpen: true,
  rightOpen: true,
  leftWidth: 240,
  rightWidth: 360,
  filters: DEFAULT_FILTERS,
  details: false,
  expandedAgents: [],
  axisMode: 'sequence',
  collapseQuiet: false,
  expandedGroups: [],
  legendOpen: false,
  showSpawned: true,
  branchMode: 'all',
  showRemoteOnly: false,
  timeRange: 'all',
  repoSort: 'activity',
  hiddenRepos: [],
  collapsedRepos: [],
  expandedBranches: [],
}

const STATUSES: WorkflowStatus[] = ['needs_input', 'working', 'needs_review', 'ready', 'complete', 'unknown']

export function loadView(): ViewState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_VIEW
    const p = JSON.parse(raw) as Partial<ViewState>
    const f = { ...DEFAULT_FILTERS, ...(p.filters ?? {}) }
    return {
      ...DEFAULT_VIEW,
      ...p,
      leftWidth: clamp(Number(p.leftWidth) || DEFAULT_VIEW.leftWidth, 180, 420),
      rightWidth: clamp(Number(p.rightWidth) || DEFAULT_VIEW.rightWidth, 280, 560),
      filters: { ...f, statuses: (f.statuses ?? []).filter((s) => STATUSES.includes(s)), tags: Array.isArray(f.tags) ? f.tags : [] },
      hiddenRepos: Array.isArray(p.hiddenRepos) ? p.hiddenRepos : [],
      collapsedRepos: Array.isArray(p.collapsedRepos) ? p.collapsedRepos : [],
      expandedBranches: Array.isArray(p.expandedBranches) ? p.expandedBranches : [],
      expandedAgents: Array.isArray(p.expandedAgents) ? p.expandedAgents : [],
      axisMode: p.axisMode === 'time' ? 'time' : 'sequence',
      collapseQuiet: p.collapseQuiet === true,
      expandedGroups: Array.isArray(p.expandedGroups) ? p.expandedGroups : [],
      // Views saved before the commit-order axis existed defaulted to a 7-day window.
      timeRange: p.axisMode ? (p.timeRange ?? 'all') : 'all',
    }
  } catch {
    return DEFAULT_VIEW
  }
}

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
