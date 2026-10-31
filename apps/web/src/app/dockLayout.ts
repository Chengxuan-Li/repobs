import { useCallback, useMemo, useState } from 'react'
import { Actions, BorderNode, DockLocation, type IJsonModel, type IJsonTabNode, Model, type TabNode, type TabSetNode } from 'flexlayout-react'

// Dockable workbench layout (FlexLayout): the dashboard is the centre tab; the repositories and
// details panels start in the left and right side bars and can be dragged into the centre, split
// beside the dashboard, moved to the other side, collapsed or closed and docked back. The
// arrangement is a per-browser convenience, stored like the rest of the view (viewState.ts).

export type PanelId = 'repositories' | 'details'
export type TabComponent = 'dashboard' | PanelId

export const DASHBOARD_TAB = 'tab:dashboard'
export const MAIN_TABSET = 'tabset:main'
const STORAGE_KEY = 'repobs.layout.v1'

export const PANELS: Record<PanelId, { id: string; name: string; home: 'left' | 'right'; size: number }> = {
  repositories: { id: 'tab:repositories', name: 'Repositories', home: 'left', size: 250 },
  details: { id: 'tab:details', name: 'Details', home: 'right', size: 380 },
}

const panelTab = (panel: PanelId): IJsonTabNode => ({ type: 'tab', id: PANELS[panel].id, name: PANELS[panel].name, component: panel })

export function defaultLayout(): IJsonModel {
  return {
    global: {
      // Keep panels mounted so the dashboard keeps its scroll position and state when hidden.
      tabEnableRenderOnDemand: false,
      tabEnablePopout: false,
      tabEnableFloat: false,
      enableRotateBorderIcons: true,
      borderLeftTabDirection: 'down',
      // Side bars stay in place when empty, so panels can be docked back.
      borderEnableAutoHide: false,
      borderMinSize: 200,
    },
    borders: [
      { type: 'border', location: 'left', size: PANELS.repositories.size, selected: 0, children: [panelTab('repositories')] },
      { type: 'border', location: 'right', size: PANELS.details.size, selected: 0, children: [panelTab('details')] },
    ],
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          id: MAIN_TABSET,
          weight: 100,
          enableDeleteWhenEmpty: false,
          children: [{ type: 'tab', id: DASHBOARD_TAB, name: 'Dashboard', component: 'dashboard', enableClose: false }],
        },
      ],
    },
  }
}

/** A stored arrangement, if it parses and still has the dashboard; otherwise the default. */
export function restoreLayout(raw: string | null): Model {
  if (raw) {
    try {
      const model = Model.fromJson(JSON.parse(raw) as IJsonModel)
      if (model.getNodeById(DASHBOARD_TAB)) {
        // Global settings always come from the app, never from storage.
        model.doAction(Actions.updateModelAttributes(defaultLayout().global!))
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
  isPanelVisible: (panel: PanelId) => boolean
  togglePanel: (panel: PanelId) => void
  showPanel: (panel: PanelId) => void
  isMaximized: () => boolean
  toggleMaximize: () => void
  reset: () => void
}

export function useDockLayout(): DockLayout {
  const [model, setModel] = useState(() => restoreLayout(readStored()))
  const [version, setVersion] = useState(0)
  /** Panels that were open when the dashboard was maximized, to bring back on restore. */
  const [focus, setFocus] = useState<PanelId[] | null>(null)

  const onModelChange = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model.toJson()))
    } catch {
      // storage blocked: the arrangement lasts for this session only
    }
    setVersion((v) => v + 1)
  }, [model])

  return useMemo(() => {
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
        // A maximized dashboard hides panels docked beside it: restore first.
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
    const dashboardSet = () => (model.getNodeById(DASHBOARD_TAB) as TabNode | undefined)?.getParent() as TabSetNode | undefined
    return {
      model,
      version,
      onModelChange,
      isPanelVisible,
      togglePanel,
      showPanel,
      isMaximized: () => focus !== null || !!model.getMaximizedTabset(),
      // Maximizing gives the dashboard the whole workspace: open side panels collapse and the
      // dashboard's tab set fills the centre; restoring brings back what was open.
      toggleMaximize: () => {
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
        // Panels docked beside the dashboard (not in a side bar) give way by maximizing its tab set.
        const set = dashboardSet()
        if (set && open.some((panel) => !tabOf(model, panel)?.isInsideBorder() && tabOf(model, panel)?.getParent() !== set)) model.doAction(Actions.maximizeToggle(set.getId()))
        setFocus(open)
      },
      reset: () => {
        try {
          localStorage.removeItem(STORAGE_KEY)
        } catch {
          // ignore
        }
        setModel(Model.fromJson(defaultLayout()))
        setFocus(null)
        setVersion((v) => v + 1)
      },
    }
  }, [model, version, onModelChange, focus])
}
