import { useCallback, useState } from 'react'

// Per-browser view preferences (pane widths, expansion, selection, filters). These are
// conveniences, not user data: annotations and settings live on the server.

export interface ViewState {
  treeWidth: number
  inspectorWidth: number
  inspectorOpen: boolean
  /** Node id -> expanded override (defaults depend on node kind). */
  expanded: Record<string, boolean>
  selectedId?: string
  filter: 'all' | 'attention'
  query: string
  showHistorical: boolean
}

const KEY = 'repobs.view.v1'

export const DEFAULT_VIEW: ViewState = {
  treeWidth: 300,
  inspectorWidth: 340,
  inspectorOpen: true,
  expanded: {},
  filter: 'all',
  query: '',
  showHistorical: true,
}

export function loadView(): ViewState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_VIEW
    const parsed = JSON.parse(raw) as Partial<ViewState>
    return {
      ...DEFAULT_VIEW,
      ...parsed,
      treeWidth: clamp(Number(parsed.treeWidth) || DEFAULT_VIEW.treeWidth, 220, 520),
      inspectorWidth: clamp(Number(parsed.inspectorWidth) || DEFAULT_VIEW.inspectorWidth, 260, 520),
      expanded: typeof parsed.expanded === 'object' && parsed.expanded ? parsed.expanded : {},
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
