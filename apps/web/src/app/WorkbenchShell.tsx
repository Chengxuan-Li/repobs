import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type IJsonModel, Layout, Model, TabNode } from 'flexlayout-react'
import 'flexlayout-react/style/light.css'
import { Moon, PanelLeft, PanelRight, Sun, SunMoon, Zap } from 'lucide-react'
import {
  type AgentSession,
  AnnotationExport,
  type AnnotationInput,
  type AnnotationSummary,
  isLiveKind,
  type Repository,
  type ReviewState,
  type SessionAnnotation,
  type Settings,
  type Snapshot,
  type ThemePreference,
  statusNeedsAttention,
  workflowStatus,
} from '@repobs/contracts'
import { Dialog, Toast, useNow } from '../components/primitives'
import { type ChecklistEntry, planKeyOf } from '../features/dashboard/checklistEntries'
import { BranchDetails, SessionDetails } from '../features/dashboard/DetailsPanel'
import { knownTags as collectTags } from '../features/dashboard/filters'
import { type BranchRow, type RepoLayout, repositoryLastActivity } from '../features/dashboard/layout'
import { RepoListPanel, type RepoSummary } from '../features/dashboard/RepoListPanel'
import { AutomationPanel } from '../features/automation/AutomationPanel'
import { AddRepositoryDialog } from '../features/settings/AddRepositoryDialog'
import { DiagnosticsPanel } from '../features/settings/DiagnosticsPanel'
import { SettingsPanel } from '../features/settings/SettingsPanel'
import { api, ApiError } from './api'
import type { Connection } from './store'
import { applyTheme } from './theme'
import { useUiScale } from './uiScale'
import { defaultLayout, type PanelId, type TabComponent, useDockLayout, viewTabs } from './dockLayout'
import { type Command, Ribbon } from './Ribbon'
import { useViewData, ViewPanel } from './ViewPanel'
import { clamp, DEFAULT_VIEW, MAX_ZOOM, MIN_ZOOM, normalizeView, type RepoSort, useWorkbenchState, type ViewState } from './viewState'
import './dock.css'
import styles from './shell.module.css'

// Workbench (ADR 0003, ADR 0004, ADR 0005): the ribbon, a dockable layout — any number of views
// (dashboard tabs, each with its own settings) in the centre, the repositories and details panels
// in side bars that can be moved, split, collapsed or closed — and the status bar. Only the panels
// scroll; the page itself never does.

/** File format of File → Export / Open. */
const EXPORT_FORMAT = 'repobs-export'

export function WorkbenchShell({ snapshot, connection, error }: { snapshot: Snapshot; connection: Connection; error?: string }) {
  const bench = useWorkbenchState()
  const { state, settingsFor, setView, setShared, keepViews, replaceViews } = bench
  const [dialog, setDialog] = useState<'add' | 'settings' | 'diagnostics' | 'rename' | undefined>()
  const [confirmRemove, setConfirmRemove] = useState<Repository | undefined>()
  const [theme, setTheme] = useState<ThemePreference>(() => (localStorage.getItem('repobs.theme') as ThemePreference | null) ?? 'system')
  // The latest notice: a confirmation (info) leaves by itself; a failure or refusal stays until dismissed.
  const [notice, setNoticeState] = useState<{ id: number; text: string; tone: 'info' | 'warning' | 'danger' }>()
  const setNotice = useCallback((text: string, tone: 'info' | 'warning' | 'danger' = 'info') => setNoticeState((n) => ({ id: (n?.id ?? 0) + 1, text, tone })), [])
  const failed = useCallback((text: string) => setNotice(text, 'danger'), [setNotice])
  const refused = useCallback((text: string) => setNotice(text, 'warning'), [setNotice])
  const now = useNow(30_000)
  const ui = useUiScale()
  // The current view: the one last selected, clicked or focused. Ribbon commands, the repository
  // ticks and the details panel follow it.
  const [currentId, setCurrentId] = useState<string>()
  const dock = useDockLayout({
    onRejected: refused,
    onViewSelected: setCurrentId,
    // Settings of closed views are dropped.
    onViewsChanged: keepViews,
  })
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api<Settings>('GET', '/settings').then(
      (s) => {
        setTheme(s.theme)
        applyTheme(s.theme)
      },
      () => undefined,
    )
  }, [])

  const views = useMemo(() => dock.views(), [dock])
  const current = views.find((v) => v.id === currentId) ?? views[0]
  const view = current ? settingsFor(current.id) : DEFAULT_VIEW
  const setCurrentView = useCallback((patch: Parameters<typeof setView>[1]) => current && setView(current.id, patch), [current, setView])

  const annotations = useMemo(() => new Map(snapshot.annotations.map((a) => [a.sessionId, a])), [snapshot.annotations])
  const tags = useMemo(() => collectTags(snapshot.annotations), [snapshot.annotations])

  const summaries: RepoSummary[] = useMemo(() => {
    const list = snapshot.repositories.map((repo) => {
      const sessions = snapshot.sessions.filter((s) => s.repoId === repo.id)
      return {
        repo,
        lastActivity: repositoryLastActivity(snapshot.commitGraphs.find((g) => g.repoId === repo.id), sessions),
        agents: sessions.length,
        active: sessions.filter((s) => isLiveKind(s.state.kind)).length,
        attention: sessions.filter((s) => statusNeedsAttention(workflowStatus(s, annotations.get(s.id)))).length,
      }
    })
    const by: Record<RepoSort, (a: RepoSummary, b: RepoSummary) => number> = {
      activity: (a, b) => b.lastActivity - a.lastActivity,
      active: (a, b) => b.active - a.active || b.attention - a.attention || b.lastActivity - a.lastActivity,
      name: (a, b) => a.repo.displayName.localeCompare(b.repo.displayName),
      manual: (a, b) => a.repo.order - b.repo.order,
    }
    return list.sort(by[state.repoSort])
  }, [snapshot, annotations, state.repoSort])

  // The current view's layouts resolve a selected branch row (with its relations) for the details panel.
  const { layouts } = useViewData(snapshot, view, annotations, summaries, now)
  const hidden = useMemo(() => new Set(view.hiddenRepos), [view.hiddenRepos])

  const { showPanel } = dock
  const select = useCallback(
    (id: string) => {
      setShared({ selectedId: id })
      showPanel('details')
    },
    [setShared, showPanel],
  )

  /** Changes one part of an agent's annotation from the dashboard (the rest is read back first); resolves to whether it was saved. */
  const updateAnnotation = useCallback(async (sessionId: string, change: (a: AnnotationInput) => AnnotationInput, failure: string) => {
    try {
      const path = `/sessions/${encodeURIComponent(sessionId)}/annotation`
      const { annotation: a } = await api<{ annotation: SessionAnnotation | null }>('GET', path)
      const current: AnnotationInput = {
        displayAlias: a?.displayAlias,
        review: a?.review ?? 'unreviewed',
        tags: a?.tags ?? [],
        note: a?.note ?? '',
        checklist: a?.checklist ?? [],
        planOverrides: a?.planOverrides ?? {},
      }
      await api('PUT', path, change(current))
      return true
    } catch (e) {
      failed(e instanceof ApiError ? e.message : failure)
      return false
    }
  }, [failed])
  const setReview = useCallback((sessionId: string, review: ReviewState) => updateAnnotation(sessionId, (a) => ({ ...a, review }), 'Could not update the review state'), [updateAnnotation])
  /** Ticks one of your items, or overrides the agent's status of a plan item (kept in repobs only). */
  const setChecklistItem = useCallback(
    (sessionId: string, entry: ChecklistEntry, done: boolean) =>
      updateAnnotation(
        sessionId,
        (a) => {
          if (entry.section === 'human') return { ...a, checklist: a.checklist.map((i) => (i.id === entry.id ? { ...i, done } : i)) }
          const { [planKeyOf(entry)]: _, ...rest } = a.planOverrides ?? {}
          // Back to the agent's own status: no override needed.
          return { ...a, planOverrides: done === (entry.agentStatus === 'completed') ? rest : { ...rest, [planKeyOf(entry)]: done } }
        },
        'Could not update the checklist',
      ),
    [updateAnnotation],
  )

  const removeRepository = async (repo: Repository) => {
    try {
      await api('DELETE', `/repositories/${repo.id}`)
      setNotice(`${repo.displayName} was removed from repobs. No files were changed; your session notes are kept.`)
    } catch (e) {
      failed(e instanceof ApiError ? e.message : 'Could not remove the repository')
    }
  }

  const chooseTheme = async (next: ThemePreference) => {
    setTheme(next)
    applyTheme(next)
    try {
      await api('PATCH', '/settings', { theme: next })
    } catch {
      failed('The theme could not be saved on the server; it applies to this browser only.')
    }
  }

  const openView = () => {
    const id = dock.openView(current?.id)
    setView(id, DEFAULT_VIEW)
    setCurrentId(id)
  }

  const refresh = async () => {
    try {
      await api('POST', '/rescan')
      setNotice('Refreshed: repositories and agent sessions were read again.')
    } catch (e) {
      failed(e instanceof ApiError ? e.message : 'Could not refresh')
    }
  }

  // File → Export: your annotations and every view (name, settings, arrangement) as one JSON file.
  // Annotations are the sanitized server export: no transcript content.
  const exportFile = async () => {
    try {
      const annotationExport = await api<AnnotationExport>('GET', '/annotations/export')
      const payload = {
        format: EXPORT_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        annotations: annotationExport,
        workbench: {
          repoSort: state.repoSort,
          views: views.map((v) => ({ id: v.id, name: v.name, settings: settingsFor(v.id) })),
          layout: dock.model.toJson(),
        },
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `repobs-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      failed(e instanceof ApiError ? e.message : 'Could not export')
    }
  }

  // File → Open: a file from Export (annotations are merged, views replace the current ones), or an
  // annotation export from Settings.
  const openFile = async (file: File) => {
    try {
      if (file.size > 20_000_000) throw new Error('This file is too large for a repobs export.')
      const data = JSON.parse(await file.text()) as Record<string, unknown>
      const done: string[] = []
      const isExport = data?.format === EXPORT_FORMAT
      const annotationPart = AnnotationExport.safeParse(isExport ? data.annotations : data)
      if (!isExport && !annotationPart.success) throw new Error('This file is not a repobs export.')
      if (annotationPart.success) {
        const res = await api<{ imported: number; skipped: number }>('POST', '/annotations/import', annotationPart.data)
        done.push(`${res.imported} annotations imported (${res.skipped} skipped: older or already present)`)
      }
      const bench = isExport ? (data.workbench as { repoSort?: RepoSort; views?: unknown; layout?: unknown } | undefined) : undefined
      const list = Array.isArray(bench?.views) ? (bench.views as Array<{ id?: unknown; name?: unknown; settings?: unknown }>) : []
      const opened = list
        .filter((v) => typeof v.id === 'string' && v.id && typeof v.name === 'string' && v.name.trim())
        .map((v) => ({ id: v.id as string, name: (v.name as string).trim().slice(0, 80), settings: normalizeView(v.settings) }))
      if (opened.length) {
        const settings: Record<string, ViewState> = Object.fromEntries(opened.map((v) => [v.id, v.settings]))
        replaceViews(settings)
        // The arrangement from the file if it holds these views, else the views side by side as tabs.
        const names = Object.fromEntries(opened.map((v) => [v.id, v.name]))
        const layoutViews = bench?.layout ? viewIdsOf(bench.layout) : []
        if (!(opened.every((v) => layoutViews.includes(v.id)) && dock.load(bench?.layout, names))) dock.load(defaultLayout(opened))
        if (bench?.repoSort) setShared({ repoSort: bench.repoSort })
        setCurrentId(opened[0]!.id)
        done.push(`${opened.length} ${opened.length === 1 ? 'view' : 'views'} opened`)
      }
      setNotice(`${file.name}: ${done.join('; ') || 'nothing to open'}.`)
    } catch (e) {
      failed(e instanceof SyntaxError ? 'This file is not valid JSON.' : e instanceof Error ? e.message : 'Could not open the file')
    }
  }

  const selected = useMemo(() => resolveSelection(snapshot, layouts, state.selectedId), [snapshot, layouts, state.selectedId])

  const panels: Record<TabComponent, (node: TabNode) => React.ReactNode> = {
    dashboard: (node) => (
      <ViewPanel
        name={node.getName()}
        view={settingsFor(node.getId())}
        setView={(patch) => setView(node.getId(), patch)}
        snapshot={snapshot}
        annotations={annotations}
        summaries={summaries}
        tags={tags}
        selectedId={state.selectedId}
        now={now}
        onActivate={() => {
          if (currentId !== node.getId()) setCurrentId(node.getId())
        }}
        onSelect={select}
        onReview={(id, r) => void setReview(id, r)}
        onChecklist={setChecklistItem}
        onAdd={() => setDialog('add')}
      />
    ),
    repositories: () => (
      <aside className={styles.side} aria-label="Repositories panel">
        <RepoListPanel
          summaries={summaries}
          hidden={hidden}
          viewName={current?.name ?? 'the current view'}
          sort={state.repoSort}
          now={now}
          onSort={(repoSort) => setShared({ repoSort })}
          onToggle={(id, visible) => setCurrentView((v) => ({ hiddenRepos: visible ? v.hiddenRepos.filter((x) => x !== id) : [...v.hiddenRepos, id] }))}
          onJump={(id) => {
            setCurrentView((v) => ({ collapsedRepos: v.collapsedRepos.filter((x) => x !== id) }))
            if (current) dock.selectView(current.id)
            document.querySelector(`[aria-label="${CSS.escape(`${current?.name ?? ''} dashboard`)}"] #repo-${CSS.escape(id)}`)?.scrollIntoView({ block: 'start' })
          }}
          onAdd={() => setDialog('add')}
          onRemove={setConfirmRemove}
        />
      </aside>
    ),
    details: () => (
      <aside className={styles.side} aria-label="Details panel">
        <div className="section-strip">
          <span className="label">{selected?.session ? 'Agent' : selected?.branch ? 'Branch' : 'Details'}</span>
          {selected ? (
            <button type="button" className="btn btn-quiet" onClick={() => setShared({ selectedId: undefined })}>
              Clear
            </button>
          ) : null}
        </div>
        <div className={styles.sideBody}>
          {selected?.session ? (
            <SessionDetails snapshot={snapshot} session={selected.session} now={now} knownTags={tags} onSelect={select} onChecklist={setChecklistItem} />
          ) : selected?.branch ? (
            <BranchDetails snapshot={snapshot} row={selected.branch} />
          ) : (
            <div className="small muted">
              <p>Select an agent card to see its evidence and edit your notes, review state, tags and checklist.</p>
              <p>Select a branch row for its upstream, worktrees and status.</p>
              <p>Observed agent status and your review state are separate: an agent can be idle and still need your review.</p>
            </div>
          )}
        </div>
      </aside>
    ),
    automation: () => <AutomationPanel changeKey={snapshot.annotations} now={now} />,
  }
  const factory = (node: TabNode) => {
    const render = panels[node.getComponent() as TabComponent]
    // The dock frame is not zoomed (dock.css); its panels take the UI size again.
    return <div className={styles.panelScale}>{render ? render(node) : <p className="small muted">Unknown panel “{node.getName()}”. Reset the layout from View → Panels.</p>}</div>
  }

  const panelCommand = (panel: PanelId, label: string, shortcut: string, icon: Command['icon']): Command => ({
    id: `view.${panel}`,
    label,
    group: 'View',
    submenu: 'Panels',
    shortcut,
    icon,
    pressed: dock.isPanelVisible(panel),
    run: () => dock.togglePanel(panel),
  })
  const toggle = (id: string, label: string, key: 'legendOpen' | 'agentNames' | 'barLabels' | 'showRemoteOnly' | 'collapseQuiet' | 'collapseSpawned'): Command => ({
    id,
    label,
    group: 'Current view',
    pressed: view[key],
    paletteOnly: true,
    // Switching a collapse mode resets the exceptions made under the old one.
    run: () => setCurrentView((v) => ({ [key]: !v[key], ...(key === 'collapseQuiet' ? { expandedGroups: [] } : key === 'collapseSpawned' ? { toggledAgents: [] } : {}) })),
  })
  const zoom = (factor: number) => setCurrentView((v) => ({ zoom: clamp(Math.round(v.zoom * factor * 100) / 100, MIN_ZOOM, MAX_ZOOM) }))
  const commands: Command[] = [
    { id: 'file.export', label: 'Export…', group: 'File', run: () => void exportFile() },
    { id: 'file.open', label: 'Open…', group: 'File', run: () => fileInput.current?.click() },
    { id: 'file.settings', label: 'Settings', group: 'File', run: () => setDialog('settings') },
    { id: 'file.diagnostics', label: 'Diagnostics', group: 'File', run: () => setDialog('diagnostics') },

    panelCommand('repositories', 'Repositories panel', 'Ctrl+B', PanelLeft),
    panelCommand('details', 'Details panel', 'Ctrl+Alt+B', PanelRight),
    panelCommand('automation', 'Automation panel', 'Ctrl+Alt+U', Zap),
    { id: 'view.maximize', label: 'Maximize view', group: 'View', submenu: 'Panels', pressed: dock.isMaximized(), run: () => dock.toggleMaximize(current?.id) },
    { id: 'view.reset', label: 'Reset layout', group: 'View', submenu: 'Panels', run: dock.reset },
    { id: 'view.new', label: 'Open new view', group: 'View', shortcut: 'Ctrl+Alt+N', run: openView },
    ...(['system', 'light', 'dark'] as ThemePreference[]).map((t) => ({
      id: `view.theme.${t}`,
      label: { system: 'Match the system', light: 'Light', dark: 'Dark' }[t],
      group: 'View' as const,
      submenu: 'Styling',
      pressed: theme === t,
      run: () => void chooseTheme(t),
    })),
    { id: 'view.uiLarger', label: 'Larger interface', group: 'View', submenu: 'Styling', shortcut: 'Ctrl+=', run: ui.zoomIn },
    { id: 'view.uiSmaller', label: 'Smaller interface', group: 'View', submenu: 'Styling', shortcut: 'Ctrl+-', run: ui.zoomOut },
    { id: 'view.uiReset', label: `Reset interface size (now ${Math.round(ui.scale * 100)}%)`, group: 'View', submenu: 'Styling', shortcut: 'Ctrl+0', run: ui.reset },
    {
      id: 'view.fullscreen',
      label: 'Full screen',
      group: 'View',
      run: () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined),
    },
    { id: 'view.refresh', label: 'Refresh', group: 'View', run: () => void refresh() },
    {
      id: 'view.themeCycle',
      label: `Switch theme (now ${theme})`,
      group: 'View',
      submenu: 'Styling',
      paletteOnly: true,
      icon: theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon,
      run: () => void chooseTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'),
    },

    { id: 'current.rename', label: `Rename view (${current?.name ?? ''})…`, group: 'Current view', paletteOnly: true, run: () => setDialog('rename') },
    toggle('current.legend', 'Legend', 'legendOpen'),
    toggle('current.agentNames', 'Agent names in list', 'agentNames'),
    toggle('current.barLabels', 'Agent labels on timeline', 'barLabels'),
    toggle('current.spawned', 'Collapse spawned agents', 'collapseSpawned'),
    toggle('current.remoteOnly', 'Remote-only branches', 'showRemoteOnly'),
    toggle('current.quiet', 'Collapse quiet commits', 'collapseQuiet'),
    ...(['sequence', 'time', 'compressed'] as const).map((mode) => ({
      id: `current.axis.${mode}`,
      label: `Axis: ${{ sequence: 'Commit order', time: 'Calendar time', compressed: 'Calendar, compressed' }[mode]}`,
      group: 'Current view' as const,
      paletteOnly: true,
      pressed: view.axisMode === mode,
      run: () => setCurrentView({ axisMode: mode }),
    })),
    { id: 'current.zoomIn', label: 'Zoom in', group: 'Current view', paletteOnly: true, run: () => zoom(1.5) },
    { id: 'current.zoomOut', label: 'Zoom out', group: 'Current view', paletteOnly: true, run: () => zoom(1 / 1.5) },
    { id: 'current.zoomReset', label: 'Reset zoom', group: 'Current view', paletteOnly: true, run: () => setCurrentView({ zoom: 1 }) },

    { id: 'repos.add', label: 'Add repositories…', group: 'Repositories', paletteOnly: true, run: () => setDialog('add') },
    ...(['activity', 'active', 'name', 'manual'] as RepoSort[]).map((sort) => ({
      id: `repos.sort.${sort}`,
      label: `Sort by ${{ activity: 'last activity', active: 'active agents', name: 'name', manual: 'manual order' }[sort]}`,
      group: 'Repositories' as const,
      paletteOnly: true,
      pressed: state.repoSort === sort,
      run: () => setShared({ repoSort: sort }),
    })),
  ]

  return (
    <div className={styles.shell}>
      <Ribbon commands={commands} quick={QUICK_COMMANDS} paletteShortcut="Ctrl+K" />

      <div className={styles.notices}>
        {error ? <Toast tone="danger">{error}</Toast> : null}
        {notice ? (
          <Toast key={notice.id} tone={notice.tone} onDismiss={() => setNoticeState(undefined)}>
            {notice.text}
          </Toast>
        ) : null}
      </div>

      <div className={styles.dock}>
        <Layout
          model={dock.model}
          factory={factory}
          onModelChange={dock.onModelChange}
          onAction={dock.onAction}
          keyMap={{ focusNextTabset: 'F6', focusPreviousTabset: 'Shift+F6' }}
        />
      </div>

      <GlobalStatusBar snapshot={snapshot} annotations={annotations} connection={connection} uiScale={ui.scale} onResetUiScale={ui.reset} onDiagnostics={() => setDialog('diagnostics')} />

      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void openFile(f)
        }}
      />

      {dialog === 'add' ? (
        <AddRepositoryDialog onClose={() => setDialog(undefined)} onAdded={(ids) => setCurrentView((v) => ({ hiddenRepos: v.hiddenRepos.filter((x) => !ids.includes(x)) }))} />
      ) : null}
      {dialog === 'settings' ? (
        <SettingsPanel
          onClose={() => setDialog(undefined)}
          onSaved={(s) => {
            setTheme(s.theme)
            applyTheme(s.theme)
          }}
        />
      ) : null}
      {dialog === 'diagnostics' ? <DiagnosticsPanel onClose={() => setDialog(undefined)} /> : null}
      {dialog === 'rename' && current ? <RenameDialog name={current.name} onClose={() => setDialog(undefined)} onRename={(name) => dock.renameView(current.id, name)} /> : null}
      {confirmRemove ? (
        <Dialog
          title="Remove repository from repobs"
          onClose={() => setConfirmRemove(undefined)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmRemove(undefined)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const repo = confirmRemove
                  setConfirmRemove(undefined)
                  void removeRepository(repo)
                }}
              >
                Remove from repobs
              </button>
            </>
          }
        >
          <p>
            Stop observing <strong>{confirmRemove.displayName}</strong>? It disappears from every view. This only removes it from repobs: no files, branches or
            worktrees are deleted, and your session notes are kept.
          </p>
        </Dialog>
      ) : null}
    </div>
  )
}

/** View ids in a stored or opened arrangement (none if it does not parse). */
function viewIdsOf(layout: unknown): string[] {
  try {
    return viewTabs(Model.fromJson(layout as IJsonModel)).map((t) => t.getId())
  } catch {
    return []
  }
}

/** Icon buttons on the ribbon, in order. */
const QUICK_COMMANDS = ['view.repositories', 'view.details', 'view.themeCycle']

function RenameDialog({ name, onClose, onRename }: { name: string; onClose: () => void; onRename: (name: string) => boolean }) {
  const [text, setText] = useState(name)
  const submit = () => {
    if (onRename(text)) onClose()
  }
  return (
    <Dialog
      title="Rename view"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Rename
          </button>
        </>
      }
    >
      <label className={styles.renameField}>
        <span className="label">Name</span>
        <input
          className="input"
          value={text}
          maxLength={80}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </label>
      <p className="small muted">You can also double-click a view’s tab to rename it.</p>
    </Dialog>
  )
}

/** The selected agent, or the selected branch row as laid out in the current view (with its relations). */
function resolveSelection(snapshot: Snapshot, layouts: Map<string, RepoLayout>, id: string | undefined): { session?: AgentSession; branch?: BranchRow } | undefined {
  if (!id) return undefined
  if (id.startsWith('session:')) {
    const session = snapshot.sessions.find((s) => s.id === id.slice('session:'.length))
    return session ? { session } : undefined
  }
  for (const layout of layouts.values()) {
    const row = layout.rows.find((r): r is BranchRow => r.kind === 'branch' && r.id === id)
    if (row) return { branch: row }
  }
  return undefined
}

function GlobalStatusBar({
  snapshot,
  annotations,
  connection,
  uiScale,
  onResetUiScale,
  onDiagnostics,
}: {
  snapshot: Snapshot
  annotations: Map<string, AnnotationSummary>
  connection: Connection
  uiScale: number
  onResetUiScale: () => void
  onDiagnostics: () => void
}) {
  const working = snapshot.sessions.filter((s) => workflowStatus(s, annotations.get(s.id)) === 'working').length
  const attention = snapshot.sessions.filter((s) => statusNeedsAttention(workflowStatus(s, annotations.get(s.id)))).length
  const synced = snapshot.monitor.lastSyncAt ? new Date(snapshot.monitor.lastSyncAt).toLocaleTimeString() : '—'
  const connLabel = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline — data may be stale' }[connection]
  return (
    <footer className={styles.statusbar} role="contentinfo">
      <span>
        {snapshot.repositories.length} repos • {snapshot.worktrees.length} worktrees • {working} working • {attention} need attention
      </span>
      <span className={styles.spacer} />
      {snapshot.monitor.state === 'degraded' ? (
        <button type="button" className={styles.statusButton} onClick={onDiagnostics} title={snapshot.monitor.errors.map((e) => e.message).join('\n')}>
          ⚠ Monitoring degraded ({snapshot.monitor.errors.length})
        </button>
      ) : null}
      {uiScale !== 1 ? (
        <button type="button" className={styles.statusLink} onClick={onResetUiScale} title="Interface size (Ctrl + wheel, Ctrl + = / −). Click to reset (Ctrl + 0)." aria-label={`Interface size ${Math.round(uiScale * 100)}%, reset`}>
          UI {Math.round(uiScale * 100)}%
        </button>
      ) : null}
      <span>Synced {synced}</span>
      <span className={connection === 'live' ? undefined : styles.warn} aria-live="polite">
        ● {connLabel}
      </span>
      <span>Local only</span>
    </footer>
  )
}
