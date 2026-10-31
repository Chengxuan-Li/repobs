import { useCallback, useMemo, useState } from 'react'
import { type Action, Actions, BorderNode, DockLocation, type IJsonModel, type IJsonTabNode, Model, TabNode, TabSetNode } from 'flexlayout-react'

// Dockable workbench layout (FlexLayout): views (dashboard tabs) in the centre, any number of them,
// each named and renamable; the repositories and details panels start in the left and right side
// bars and can be dragged into the centre, split beside a view, moved to the other side, collapsed
// or closed and docked back. The arrangement is a per-browser convenience, stored with the view
// settings (viewState.ts).

export type PanelId = 'repositories' | 'details'
export type TabComponent = 'dashboard' | PanelId

/** The tab id of a dashboard from before views existed; kept so its stored settings still apply. */
const LEGACY_DASHBOARD_TAB = 'tab:dashboard'
export const MAIN_TABSET = 'tabset:main'
const STORAGE_KEY = 'repobs.layout.v1'

/** Side panels keep at least this width, so their one-line entries do not wrap. */
export const PANELS: Record<PanelId, { id: string; name: string; home: 'left' | 'right'; size: number; minWidth: number }> = {
  repositories: { id: 'tab:repositories', name: 'Repositories', home: 'left', size: 300, minWidth: 280 },
  details: { id: 'tab:details', name: 'Details', home: 'right', size: 380, minWidth: 320 },
}
const SIDE_MIN = Math.min(...Object.values(PANELS).map((p) => p.minWidth))

const panelTab = (panel: PanelId): IJsonTabNode => ({ type: 'tab', id: PANELS[panel].id, name: PANELS[panel].name, component: panel, minWidth: PANELS[panel].minWidth })
const viewTab = (id: string, name: string): IJsonTabNode => ({ type: 'tab', id, name, component: 'dashboard', enableClose: true, enableRename: true })

/** "View n" with the smallest n no other view uses, counting from 0. */
export function nextViewName(names: string[]): string {
  const used = new Set(names.map((n) => /^view (\d+)$/i.exec(n.trim())?.[1]).filter(Boolean).map(Number))
  let n = 0
  while (used.has(n)) n++
  return `View ${n}`
}

export const newViewId = () => `view:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export function defaultLayout(views: Array<{ id: string; name: string }> = [{ id: 'view:default', name: 'View 0' }]): IJsonModel {
  return {
    global: {
      // Keep panels mounted so each view keeps its scroll position and state when hidden.
      tabEnableRenderOnDemand: false,
      tabEnablePopout: false,
      tabEnableFloat: false,
      enableRotateBorderIcons: true,
      borderLeftTabDirection: 'down',
      // Side bars stay in place when empty, so panels can be docked back.
      borderEnableAutoHide: false,
      borderMinSize: SIDE_MIN,
    },
    borders: [
      { type: 'border', location: 'left', size: PANELS.repositories.size, selected: 0, children: [panelTab('repositories')] },
      { type: 'border', location: 'right', size: PANELS.details.size, selected: 0, children: [panelTab('details')] },
    ],
    layout: {
      type: 'row',
      children: [{ type: 'tabset', id: MAIN_TABSET, weight: 100, enableDeleteWhenEmpty: false, selected: 0, children: views.map((v) => viewTab(v.id, v.name)) }],
    },
  }
}

/** Every view (dashboard tab), in layout order. */
export function viewTabs(model: Model): TabNode[] {
  const tabs: TabNode[] = []
  model.visitNodes((node) => {
    if (node instanceof TabNode && node.getComponent() === 'dashboard') tabs.push(node)
  })
  return tabs
}

/** A stored or opened arrangement, if it parses and has at least one view; otherwise the default. */
export function restoreLayout(raw: string | null): Model {
  if (raw) {
    try {
      const model = Model.fromJson(JSON.parse(raw) as IJsonModel)
      const views = viewTabs(model)
      if (views.length) {
        // Global settings always come from the app, never from storage.
        model.doAction(Actions.updateModelAttributes(defaultLayout().global!))
        for (const tab of views) {
          model.doAction(Actions.updateNodeAttributes(tab.getId(), { enableClose: true, enableRename: true }))
          // The single dashboard from before views existed becomes a numbered view.
          if (tab.getId() === LEGACY_DASHBOARD_TAB && tab.getName() === 'Dashboard') {
            model.doAction(Actions.renameTab(tab.getId(), nextViewName(views.map((t) => t.getName()))))
          }
        }
        for (const panel of Object.keys(PANELS) as PanelId[]) {
          if (model.getNodeById(PANELS[panel].id)) model.doAction(Actions.updateNodeAttributes(PANELS[panel].id, { minWidth: PANELS[panel].minWidth }))
        }
        model.visitNodes((node) => {
          if (node instanceof BorderNode && node.getSize() < SIDE_MIN) model.doAction(Actions.updateNodeAttributes(node.getId(), { size: SIDE_MIN }))
        })
        return model
      }
    } catch {
      // unreadable or from an older version: fall through to the default
    }
  }
  return Model.fromJson(defaultLayout())
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const tabOf = (model: Model, panel: PanelId) => model.getNodeById(PANELS[panel].id) as TabNode | undefined

export interface DockLayout {
  model: Model
  /** Changes on every model change, so controls depending on the layout re-render. */
  version: number
  onModelChange: () => void
  /** Keeps at least one view open and view names unique and non-empty. */
  onAction: (action: Action) => Action | undefined
  views: () => Array<{ id: string; name: string }>
  /** Opens a new view beside the given one (or in the main tab set) and returns its id. */
  openView: (besideViewId?: string) => string
  renameView: (viewId: string, name: string) => boolean
  selectView: (viewId: string) => void
  isPanelVisible: (panel: PanelId) => boolean
  togglePanel: (panel: PanelId) => void
  showPanel: (panel: PanelId) => void
  isMaximized: () => boolean
  toggleMaximize: (viewId?: string) => void
  /** Replaces the arrangement (opening a file), naming views by id; returns false when it has no view. */
  load: (json: unknown, names?: Record<string, string>) => boolean
  reset: () => void
}

export interface DockEvents {
  /** A change was refused (closing the last view, an empty or duplicate view name). */
  onRejected?: (message: string) => void
  /** The user selected a view's tab. */
  onViewSelected?: (viewId: string) => void
  /** The set of views changed (after any layout change). */
  onViewsChanged?: (viewIds: string[]) => void
}

export function useDockLayout({ onRejected, onViewSelected, onViewsChanged }: DockEvents = {}): DockLayout {
  const [model, setModel] = useState(() => restoreLayout(readStored()))
  const [version, setVersion] = useState(0)
  /** Panels that were open when a view was maximized, to bring back on restore. */
  const [focus, setFocus] = useState<PanelId[] | null>(null)

  const onModelChange = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model.toJson()))
    } catch {
      // storage blocked: the arrangement lasts for this session only
    }
    onViewsChanged?.(viewTabs(model).map((t) => t.getId()))
    setVersion((v) => v + 1)
  }, [model, onViewsChanged])

  return useMemo(() => {
    const names = (except?: string) =>
      viewTabs(model)
        .filter((t) => t.getId() !== except)
        .map((t) => t.getName())
    const validName = (viewId: string, name: string): string | undefined => {
      const text = name.trim()
      if (!text) return onRejected?.('A view needs a name.'), undefined
      if (names(viewId).some((n) => n.trim().toLowerCase() === text.toLowerCase())) return onRejected?.(`There is already a view named “${text}”.`), undefined
      return text
    }
    const onAction = (action: Action): Action | undefined => {
      const ref = action.data.node ?? action.data.tabNode ?? action.data.tabsetNode
      const node = typeof ref === 'string' ? model.getNodeById(ref) : undefined
      const views = viewTabs(model)
      if (action.type === Actions.DELETE_TAB && node instanceof TabNode && node.getComponent() === 'dashboard' && views.length === 1) {
        onRejected?.('The last view cannot be closed.')
        return undefined
      }
      if (action.type === Actions.DELETE_TABSET && node instanceof TabSetNode && views.every((t) => t.getParent() === node)) {
        onRejected?.('The last view cannot be closed.')
        return undefined
      }
      if (action.type === Actions.SELECT_TAB && node instanceof TabNode && node.getComponent() === 'dashboard') onViewSelected?.(node.getId())
      if (action.type === Actions.SET_ACTIVE_TABSET && node instanceof TabSetNode) {
        const shown = node.getSelectedNode()
        if (shown instanceof TabNode && shown.getComponent() === 'dashboard') onViewSelected?.(shown.getId())
      }
      if (action.type === Actions.RENAME_TAB && node instanceof TabNode && node.getComponent() === 'dashboard') {
        const text = validName(node.getId(), String(action.data.text ?? ''))
        return text === undefined ? undefined : Actions.renameTab(node.getId(), text)
      }
      return action
    }
    const isPanelVisible = (panel: PanelId) => tabOf(model, panel)?.isVisible() ?? false
    const showPanel = (panel: PanelId) => {
      const tab = tabOf(model, panel)
      if (!tab) {
        // Closed: dock it back in its home side bar.
        const home = PANELS[panel].home === 'left' ? DockLocation.LEFT : DockLocation.RIGHT
        let border: BorderNode | undefined
        model.visitNodes((node) => {
          if (node instanceof BorderNode && node.getLocation() === home) border = node
        })
        if (border) model.doAction(Actions.addTab(panelTab(panel), border.getId(), DockLocation.CENTER, -1, true))
        return
      }
      if (!tab.isVisible()) {
        // A maximized view hides panels docked beside it: restore first.
        const maximized = model.getMaximizedTabset()
        if (maximized && maximized !== tab.getParent()) model.doAction(Actions.maximizeToggle(maximized.getId()))
        if (!tab.isVisible()) model.doAction(Actions.selectTab(tab.getId()))
      }
    }
    const togglePanel = (panel: PanelId) => {
      const tab = tabOf(model, panel)
      if (!tab || !tab.isVisible()) return showPanel(panel)
      // Visible: collapse a side bar (selecting its tab again closes it), or close a docked tab.
      if (tab.isInsideBorder()) model.doAction(Actions.selectTab(tab.getId()))
      else model.doAction(Actions.deleteTab(tab.getId()))
    }
    const viewSet = (viewId?: string) => {
      const tab = (viewId ? model.getNodeById(viewId) : undefined) ?? viewTabs(model)[0]
      return tab?.getParent() instanceof TabSetNode ? (tab.getParent() as TabSetNode) : undefined
    }
    return {
      model,
      version,
      onModelChange,
      onAction,
      views: () => viewTabs(model).map((t) => ({ id: t.getId(), name: t.getName() })),
      openView: (besideViewId?: string) => {
        const id = newViewId()
        let set = viewSet(besideViewId) ?? (model.getNodeById(MAIN_TABSET) as TabSetNode | undefined)
        if (!set) {
          model.visitNodes((node) => {
            if (!set && node instanceof TabSetNode) set = node
          })
        }
        if (set) model.doAction(Actions.addTab(viewTab(id, nextViewName(names())), set.getId(), DockLocation.CENTER, -1, true))
        return id
      },
      renameView: (viewId: string, name: string) => {
        const text = validName(viewId, name)
        if (text === undefined) return false
        model.doAction(Actions.renameTab(viewId, text))
        return true
      },
      selectView: (viewId: string) => {
        const tab = model.getNodeById(viewId) as TabNode | undefined
        if (tab && !tab.isVisible()) model.doAction(Actions.selectTab(viewId))
      },
      isPanelVisible,
      togglePanel,
      showPanel,
      isMaximized: () => focus !== null || !!model.getMaximizedTabset(),
      // Maximizing gives a view the whole workspace: open side panels collapse and its tab set
      // fills the centre; restoring brings back what was open.
      toggleMaximize: (viewId?: string) => {
        const maximized = model.getMaximizedTabset()
        if (focus !== null || maximized) {
          if (maximized) model.doAction(Actions.maximizeToggle(maximized.getId()))
          for (const panel of focus ?? []) showPanel(panel)
          setFocus(null)
          return
        }
        const open = (Object.keys(PANELS) as PanelId[]).filter(isPanelVisible)
        for (const panel of open) {
          const tab = tabOf(model, panel)
          if (tab?.isInsideBorder()) model.doAction(Actions.selectTab(tab.getId()))
        }
        // Anything docked beside the view (not in a side bar) gives way by maximizing its tab set.
        const set = viewSet(viewId)
        const besides = viewTabs(model).some((t) => t.getParent() !== set) || open.some((panel) => !tabOf(model, panel)?.isInsideBorder() && tabOf(model, panel)?.getParent() !== set)
        if (set && besides) model.doAction(Actions.maximizeToggle(set.getId()))
        setFocus(open)
      },
      load: (json: unknown, names: Record<string, string> = {}) => {
        try {
          if (!viewTabs(Model.fromJson(json as IJsonModel)).length) return false
        } catch {
          return false
        }
        const next = restoreLayout(JSON.stringify(json))
        for (const tab of viewTabs(next)) if (names[tab.getId()]) next.doAction(Actions.renameTab(tab.getId(), names[tab.getId()]!))
        setModel(next)
        setFocus(null)
        setVersion((v) => v + 1)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next.toJson()))
        } catch {
          // ignore
        }
        return true
      },
      reset: () => {
        try {
          localStorage.removeItem(STORAGE_KEY)
        } catch {
          // ignore
        }
        // Every view is kept (with its name and settings), as tabs of one tab set; panels go home.
        const views = viewTabs(model).map((t) => ({ id: t.getId(), name: t.getName() }))
        setModel(Model.fromJson(defaultLayout(views.length ? views : undefined)))
        setFocus(null)
        setVersion((v) => v + 1)
      },
    }
  }, [model, version, onModelChange, focus, onRejected, onViewSelected])
}
