import { useCallback, useEffect, useState } from 'react'
import { type Provider, type WorkflowStatus } from '@repobs/contracts'
import { DEFAULT_FILTERS, type DashboardFilters } from '../features/dashboard/filters'
import type { BranchMode } from '../features/dashboard/layout'
import type { AxisMode } from '../features/dashboard/timeline'

// Per-browser workbench state: the settings of each view (dashboard tab) — filters, display
// toggles, axis, which repositories it shows — plus the selection and the repository order, which
// all views share. Conveniences, not user data: annotations and settings live on the server.

export type TimeRange = '1d' | '7d' | '30d' | '90d' | '365d' | 'all'
export type RepoSort = 'activity' | 'active' | 'name' | 'manual'

/** Settings of one view (dashboard tab). */
export interface ViewState {
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
  /** Repositories this view leaves out (of all registered ones; a new repository shows in every view). */
  hiddenRepos: string[]
  collapsedRepos: string[]
  expandedBranches: string[]
}

export type ViewPatch = Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)

/** The settings of every view, and what they share. */
export interface WorkbenchState {
  selectedId?: string
  repoSort: RepoSort
  views: Record<string, ViewState>
  /** Settings from before views existed: used by views that have none of their own yet. */
  legacy?: ViewState
}

const KEY = 'repobs.workbench.v1'
const LEGACY_KEY = 'repobs.view.v2'

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
  hiddenRepos: [],
  collapsedRepos: [],
  expandedBranches: [],
}

const STATUSES: WorkflowStatus[] = ['needs_input', 'working', 'needs_review', 'unreviewed', 'complete', 'unknown']
const SORTS: RepoSort[] = ['activity', 'active', 'name', 'manual']
const RANGES: TimeRange[] = ['1d', '7d', '30d', '90d', '365d', 'all']
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Settings of one view from storage or an opened file: unknown fields dropped, invalid ones defaulted. */
export function normalizeView(raw: unknown): ViewState {
  if (!raw || typeof raw !== 'object') return DEFAULT_VIEW
  const p = raw as Partial<ViewState>
  const f = { ...DEFAULT_FILTERS, ...(p.filters ?? {}) }
  return {
    filters: {
      query: typeof f.query === 'string' ? f.query : '',
      lastMessageDays: typeof f.lastMessageDays === 'number' ? f.lastMessageDays : null,
      // 'ready' was renamed 'unreviewed'.
      statuses: strings(f.statuses)
        .map((s) => (s === 'ready' ? 'unreviewed' : s))
        .filter((s): s is WorkflowStatus => STATUSES.includes(s as WorkflowStatus)),
      tags: strings(f.tags),
      harnesses: storedHarnesses(p.filters),
    },
    agentNames: p.agentNames !== false,
    barLabels: p.barLabels !== false,
    collapseSpawned: p.collapseSpawned !== false,
    toggledAgents: strings(p.toggledAgents),
    axisMode: p.axisMode === 'time' || p.axisMode === 'compressed' ? p.axisMode : 'sequence',
    zoom: clamp(Number(p.zoom) || 1, MIN_ZOOM, MAX_ZOOM),
    collapseQuiet: p.collapseQuiet === true,
    expandedGroups: strings(p.expandedGroups),
    legendOpen: p.legendOpen === true,
    branchMode: p.branchMode === 'checked_out' || p.branchMode === 'with_agents' ? p.branchMode : 'all',
    showRemoteOnly: p.showRemoteOnly === true,
    // Views saved before the commit-order axis existed defaulted to a 7-day window.
    timeRange: p.axisMode && RANGES.includes(p.timeRange as TimeRange) ? p.timeRange! : 'all',
    hiddenRepos: strings(p.hiddenRepos),
    collapsedRepos: strings(p.collapsedRepos),
    expandedBranches: strings(p.expandedBranches),
  }
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

export function loadWorkbench(): WorkbenchState {
  const stored = read(KEY) as Partial<WorkbenchState> | undefined
  if (stored && typeof stored === 'object') {
    const views: Record<string, ViewState> = {}
    for (const [id, v] of Object.entries(stored.views ?? {})) views[id] = normalizeView(v)
    return {
      selectedId: typeof stored.selectedId === 'string' ? stored.selectedId : undefined,
      repoSort: SORTS.includes(stored.repoSort!) ? stored.repoSort! : 'activity',
      views,
      legacy: stored.legacy ? normalizeView(stored.legacy) : undefined,
    }
  }
  // Before views: one stored view state, which becomes the settings of the existing dashboard.
  const old = read(LEGACY_KEY) as (Partial<ViewState> & { selectedId?: unknown; repoSort?: RepoSort }) | undefined
  if (!old || typeof old !== 'object') return { repoSort: 'activity', views: {} }
  return {
    selectedId: typeof old.selectedId === 'string' ? old.selectedId : undefined,
    repoSort: SORTS.includes(old.repoSort!) ? old.repoSort! : 'activity',
    views: {},
    legacy: normalizeView(old),
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

export interface Workbench {
  state: WorkbenchState
  settingsFor: (viewId: string) => ViewState
  setView: (viewId: string, patch: ViewPatch) => void
  setShared: (patch: Partial<Pick<WorkbenchState, 'selectedId' | 'repoSort'>>) => void
  /** Keeps the settings of these views only (the others were closed). */
  keepViews: (viewIds: string[]) => void
  /** Replaces every view's settings (opening a file). */
  replaceViews: (views: Record<string, ViewState>) => void
}

export function useWorkbenchState(): Workbench {
  const [state, setState] = useState<WorkbenchState>(loadWorkbench)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      // storage full or disabled: the views still work for this session
    }
  }, [state])
  const settingsFor = useCallback((viewId: string) => state.views[viewId] ?? state.legacy ?? DEFAULT_VIEW, [state])
  const setView = useCallback((viewId: string, patch: ViewPatch) => {
    setState((prev) => {
      const current = prev.views[viewId] ?? prev.legacy ?? DEFAULT_VIEW
      return { ...prev, views: { ...prev.views, [viewId]: { ...current, ...(typeof patch === 'function' ? patch(current) : patch) } } }
    })
  }, [])
  const setShared = useCallback((patch: Partial<Pick<WorkbenchState, 'selectedId' | 'repoSort'>>) => setState((prev) => ({ ...prev, ...patch })), [])
  const keepViews = useCallback(
    (viewIds: string[]) =>
      setState((prev) => {
        if (Object.keys(prev.views).every((id) => viewIds.includes(id))) return prev
        return { ...prev, views: Object.fromEntries(Object.entries(prev.views).filter(([id]) => viewIds.includes(id))) }
      }),
    [],
  )
  const replaceViews = useCallback((views: Record<string, ViewState>) => setState((prev) => ({ ...prev, views, legacy: undefined })), [])
  return { state, settingsFor, setView, setShared, keepViews, replaceViews }
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 16

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export const RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '1d': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
  '365d': 365 * 86_400_000,
}
