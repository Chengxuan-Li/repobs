import { useCallback, useState } from 'react'
import { type WorkflowStatus } from '@repobs/contracts'
import { DEFAULT_FILTERS, type DashboardFilters } from '../features/dashboard/filters'
import type { BranchMode } from '../features/dashboard/layout'

// Per-browser view preferences (panels, filters, toggles, selection). Conveniences, not user data:
// annotations and settings live on the server.

export type TimeRange = '1d' | '7d' | '30d' | '90d' | 'all'
export type RepoSort = 'activity' | 'active' | 'name' | 'manual'

export interface ViewState {
  leftOpen: boolean
  rightOpen: boolean
  leftWidth: number
  rightWidth: number
  selectedId?: string
  filters: DashboardFilters
  details: boolean
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
  showSpawned: true,
  branchMode: 'all',
  showRemoteOnly: false,
  timeRange: '7d',
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
}
