import { useCallback, useEffect, useMemo, useState } from 'react'
import { Layout, type TabNode } from 'flexlayout-react'
import 'flexlayout-react/style/light.css'
import { Activity, Expand, Maximize2, Moon, PanelLeft, PanelRight, Plus, RotateCcw, Settings as SettingsIcon, Sun, SunMoon } from 'lucide-react'
import {
  type AgentSession,
  type AnnotationSummary,
  isLiveKind,
  type Repository,
  type ReviewState,
  type Settings,
  type Snapshot,
  type ThemePreference,
  workflowStatus,
} from '@repobs/contracts'
import { Dialog, EmptyState, InlineAlert, useNow } from '../components/primitives'
import { Dashboard } from '../features/dashboard/Dashboard'
import { BranchDetails, SessionDetails } from '../features/dashboard/DetailsPanel'
import { knownTags as collectTags, sessionMatches } from '../features/dashboard/filters'
import { type BranchRow, type LayoutOptions, layoutRepository, type RepoLayout, repositoryLastActivity } from '../features/dashboard/layout'
import { RepoListPanel, type RepoSummary } from '../features/dashboard/RepoListPanel'
import { AddRepositoryDialog } from '../features/settings/AddRepositoryDialog'
import { DiagnosticsPanel } from '../features/settings/DiagnosticsPanel'
import { SettingsPanel } from '../features/settings/SettingsPanel'
import { api, ApiError } from './api'
import type { Connection } from './store'
import { applyTheme } from './theme'
import { type PanelId, type TabComponent, useDockLayout } from './dockLayout'
import { type Command, Ribbon } from './Ribbon'
import { clamp, MAX_ZOOM, MIN_ZOOM, type RepoSort, useViewState } from './viewState'
import './dock.css'
import styles from './shell.module.css'

// Workbench (ADR 0003, ADR 0004): the ribbon, a dockable layout — the dashboard in the centre, the
// repositories and details panels in side bars that can be moved, split, collapsed or closed —
// and the status bar. Only the panels scroll; the page itself never does.

export function WorkbenchShell({ snapshot, connection, error }: { snapshot: Snapshot; connection: Connection; error?: string }) {
  const [view, setView] = useViewState()
  const [dialog, setDialog] = useState<'add' | 'settings' | 'diagnostics' | undefined>()
  const [confirmRemove, setConfirmRemove] = useState<Repository | undefined>()
  const [theme, setTheme] = useState<ThemePreference>(() => (localStorage.getItem('repobs.theme') as ThemePreference | null) ?? 'system')
  const [notice, setNotice] = useState<string>()
  const now = useNow(30_000)
  const dock = useDockLayout()

  useEffect(() => {
    api<Settings>('GET', '/settings').then(
      (s) => {
        setTheme(s.theme)
        applyTheme(s.theme)
      },
      () => undefined,
    )
  }, [])

  const annotations = useMemo(() => new Map(snapshot.annotations.map((a) => [a.sessionId, a])), [snapshot.annotations])
  const tags = useMemo(() => collectTags(snapshot.annotations), [snapshot.annotations])
  const filtered = useMemo(
    () => snapshot.sessions.filter((s) => sessionMatches(s, annotations.get(s.id), view.filters, now)),
    [snapshot.sessions, annotations, view.filters, now],
  )

  const summaries: RepoSummary[] = useMemo(() => {
    const list = snapshot.repositories.map((repo) => {
      const sessions = snapshot.sessions.filter((s) => s.repoId === repo.id)
      return {
        repo,
        lastActivity: repositoryLastActivity(snapshot.commitGraphs.find((g) => g.repoId === repo.id), sessions),
        agents: sessions.length,
        active: sessions.filter((s) => isLiveKind(s.state.kind)).length,
        attention: sessions.filter((s) => ['needs_input', 'needs_review'].includes(workflowStatus(s, annotations.get(s.id)))).length,
      }
    })
    const by: Record<RepoSort, (a: RepoSummary, b: RepoSummary) => number> = {
      activity: (a, b) => b.lastActivity - a.lastActivity,
      active: (a, b) => b.active - a.active || b.attention - a.attention || b.lastActivity - a.lastActivity,
      name: (a, b) => a.repo.displayName.localeCompare(b.repo.displayName),
      manual: (a, b) => a.repo.order - b.repo.order,
    }
    return list.sort(by[view.repoSort])
  }, [snapshot, annotations, view.repoSort])

  const hidden = useMemo(() => new Set(view.hiddenRepos), [view.hiddenRepos])
  const layoutOptions: LayoutOptions = useMemo(
    () => ({
      branchMode: view.branchMode,
      showSpawned: view.showSpawned,
      showRemoteOnly: view.showRemoteOnly,
      sessionLimit: 12,
      expandedBranches: new Set(view.expandedBranches),
      collapseQuiet: view.collapseQuiet,
      expandedGroups: new Set(view.expandedGroups),
    }),
    [view.branchMode, view.showSpawned, view.showRemoteOnly, view.expandedBranches, view.collapseQuiet, view.expandedGroups],
  )

  // Layouts are computed once here so the dashboard and the details panel agree (branch relations).
  const layouts = useMemo(() => {
    const m = new Map<string, RepoLayout>()
    for (const { repo } of summaries) {
      if (hidden.has(repo.id)) continue
      m.set(
        repo.id,
        layoutRepository(
          repo,
          {
            branches: snapshot.branches.filter((b) => b.repoId === repo.id),
            worktrees: snapshot.worktrees.filter((w) => w.repoId === repo.id),
            sessions: filtered.filter((s) => s.repoId === repo.id),
            annotations,
            graph: snapshot.commitGraphs.find((g) => g.repoId === repo.id),
          },
          layoutOptions,
        ),
      )
    }
    return m
  }, [summaries, hidden, snapshot.branches, snapshot.worktrees, snapshot.commitGraphs, filtered, annotations, layoutOptions])

  const { showPanel } = dock
  const select = useCallback(
    (id: string) => {
      setView({ selectedId: id })
      showPanel('details')
    },
    [setView, showPanel],
  )

  const setReview = useCallback(async (sessionId: string, review: ReviewState) => {
    try {
      const current = await api<{ annotation: { displayAlias?: string; tags: string[]; note: string; checklist: unknown[] } | null }>(
        'GET',
        `/sessions/${encodeURIComponent(sessionId)}/annotation`,
      )
      const a = current.annotation
      await api('PUT', `/sessions/${encodeURIComponent(sessionId)}/annotation`, {
        displayAlias: a?.displayAlias,
        review,
        tags: a?.tags ?? [],
        note: a?.note ?? '',
        checklist: a?.checklist ?? [],
      })
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not update the review state')
    }
  }, [])

  const removeRepository = async (repo: Repository) => {
    try {
      await api('DELETE', `/repositories/${repo.id}`)
      setNotice(`${repo.displayName} was removed from the dashboard. No files were changed; your session notes are kept.`)
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not remove the repository')
    }
  }

  const chooseTheme = async (next: ThemePreference) => {
    setTheme(next)
    applyTheme(next)
    try {
      await api('PATCH', '/settings', { theme: next })
    } catch {
      setNotice('The theme could not be saved on the server; it applies to this browser only.')
    }
  }

  const selected = useMemo(() => resolveSelection(snapshot, layouts, view.selectedId), [snapshot, layouts, view.selectedId])
  const empty = snapshot.repositories.length === 0

  const dashboardPanel = (
    <main className={styles.main} aria-label="Dashboard">
      {notice ? (
        <div className={styles.notice}>
          <InlineAlert tone="info" onDismiss={() => setNotice(undefined)}>
            {notice}
          </InlineAlert>
        </div>
      ) : null}
      {error ? (
        <div className={styles.notice}>
          <InlineAlert tone="danger">{error}</InlineAlert>
        </div>
      ) : null}
      {empty ? (
        <div className={styles.boards}>
          <EmptyState
            title="Observe your Git worktrees and coding agents, locally"
            action={
              <button type="button" className="btn btn-primary" onClick={() => setDialog('add')}>
                <Plus size={13} aria-hidden="true" /> Add repositories
              </button>
            }
          >
            <p>Register local Git repositories to see their branches and commits on a timeline, with the Claude Code and Codex agents that worked on each branch.</p>
            <p>repobs only reads: it never changes your repositories or agent histories, and needs no API keys.</p>
          </EmptyState>
        </div>
      ) : (
        <Dashboard
          snapshot={snapshot}
          filtered={filtered}
          annotations={annotations}
          layouts={layouts}
          repos={summaries.filter((s) => !hidden.has(s.repo.id))}
          tags={tags}
          view={view}
          setView={setView}
          now={now}
          onSelect={select}
          onReview={(id, r) => void setReview(id, r)}
        />
      )}
    </main>
  )

  const panels: Record<TabComponent, () => React.ReactNode> = {
    dashboard: () => dashboardPanel,
    repositories: () => (
      <aside className={styles.side} aria-label="Repositories panel">
        <RepoListPanel
          summaries={summaries}
          hidden={hidden}
          now={now}
          onToggle={(id, visible) => setView((v) => ({ hiddenRepos: visible ? v.hiddenRepos.filter((x) => x !== id) : [...v.hiddenRepos, id] }))}
          onJump={(id) => {
            setView((v) => ({ collapsedRepos: v.collapsedRepos.filter((x) => x !== id) }))
            document.getElementById(`repo-${id}`)?.scrollIntoView({ block: 'start' })
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
            <button type="button" className="btn btn-quiet" onClick={() => setView({ selectedId: undefined })}>
              Clear
            </button>
          ) : null}
        </div>
        <div className={styles.sideBody}>
          {selected?.session ? (
            <SessionDetails snapshot={snapshot} session={selected.session} now={now} knownTags={tags} onSelect={select} />
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
  }
  const factory = (node: TabNode) => {
    const render = panels[node.getComponent() as TabComponent]
    return render ? render() : <p className="small muted">Unknown panel “{node.getName()}”. Reset the layout from the View menu.</p>
  }

  const panelCommand = (panel: PanelId, label: string, shortcut: string, icon: Command['icon']): Command => ({
    id: `view.${panel}`,
    label,
    group: 'View',
    shortcut,
    icon,
    pressed: dock.isPanelVisible(panel),
    run: () => dock.togglePanel(panel),
  })
  const toggle = (id: string, label: string, key: 'legendOpen' | 'details' | 'agentNames' | 'barLabels' | 'showRemoteOnly' | 'collapseQuiet'): Command => ({
    id,
    label,
    group: 'View',
    submenu: 'Dashboard',
    pressed: view[key],
    run: () => setView((v) => ({ [key]: !v[key], ...(key === 'collapseQuiet' ? { expandedGroups: [] } : {}) })),
  })
  const zoom = (factor: number) => setView((v) => ({ zoom: clamp(Math.round(v.zoom * factor * 100) / 100, MIN_ZOOM, MAX_ZOOM) }))
  const commands: Command[] = [
    { id: 'repos.add', label: 'Add repositories', group: 'Repositories', icon: Plus, run: () => setDialog('add') },
    ...(['activity', 'active', 'name', 'manual'] as RepoSort[]).map((sort) => ({
      id: `repos.sort.${sort}`,
      label: { activity: 'Last activity', active: 'Active agents', name: 'Name', manual: 'Manual order' }[sort],
      group: 'Repositories' as const,
      submenu: 'Sort by',
      pressed: view.repoSort === sort,
      run: () => setView({ repoSort: sort }),
    })),
    panelCommand('repositories', 'Repositories panel', 'Ctrl+B', PanelLeft),
    panelCommand('details', 'Details panel', 'Ctrl+Alt+B', PanelRight),
    { id: 'view.maximize', label: 'Maximize dashboard', group: 'View', icon: Maximize2, pressed: dock.isMaximized(), run: dock.toggleMaximize },
    { id: 'view.reset', label: 'Reset layout', group: 'View', icon: RotateCcw, run: dock.reset },
    {
      id: 'view.fullscreen',
      label: 'Full screen',
      group: 'View',
      icon: Expand,
      run: () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined),
    },
    toggle('view.legend', 'Legend', 'legendOpen'),
    toggle('view.expand', 'Expand agent details', 'details'),
    toggle('view.agentNames', 'Agent names in list', 'agentNames'),
    toggle('view.barLabels', 'Agent labels on timeline', 'barLabels'),
    { id: 'view.spawned', label: 'Hide spawned agents', group: 'View', submenu: 'Dashboard', pressed: !view.showSpawned, run: () => setView((v) => ({ showSpawned: !v.showSpawned })) },
    toggle('view.remoteOnly', 'Remote-only branches', 'showRemoteOnly'),
    toggle('view.quiet', 'Collapse quiet commits', 'collapseQuiet'),
    ...(['sequence', 'time', 'compressed'] as const).map((mode) => ({
      id: `view.axis.${mode}`,
      label: { sequence: 'Commit order', time: 'Calendar time', compressed: 'Calendar, compressed' }[mode],
      group: 'View' as const,
      submenu: 'Axis',
      pressed: view.axisMode === mode,
      run: () => setView({ axisMode: mode }),
    })),
    { id: 'view.zoomIn', label: 'Zoom in', group: 'View', submenu: 'Axis', run: () => zoom(1.5) },
    { id: 'view.zoomOut', label: 'Zoom out', group: 'View', submenu: 'Axis', run: () => zoom(1 / 1.5) },
    { id: 'view.zoomReset', label: 'Reset zoom', group: 'View', submenu: 'Axis', run: () => setView({ zoom: 1 }) },
    ...(['system', 'light', 'dark'] as ThemePreference[]).map((t) => ({
      id: `view.theme.${t}`,
      label: { system: 'Match the system', light: 'Light', dark: 'Dark' }[t],
      group: 'View' as const,
      submenu: 'Theme',
      pressed: theme === t,
      run: () => void chooseTheme(t),
    })),
    {
      id: 'view.themeCycle',
      label: `Switch theme (now ${theme})`,
      group: 'View',
      submenu: 'Theme',
      icon: theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon,
      run: () => void chooseTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'),
    },
    { id: 'tools.diagnostics', label: 'Diagnostics', group: 'Tools', icon: Activity, run: () => setDialog('diagnostics') },
    { id: 'tools.settings', label: 'Settings', group: 'Tools', icon: SettingsIcon, run: () => setDialog('settings') },
  ]

  return (
    <div className={styles.shell}>
      <Ribbon commands={commands} quick={QUICK_COMMANDS} paletteShortcut="Ctrl+K" />

      <div className={styles.dock}>
        <Layout model={dock.model} factory={factory} onModelChange={dock.onModelChange} keyMap={{ focusNextTabset: 'F6', focusPreviousTabset: 'Shift+F6' }} />
      </div>

      <GlobalStatusBar snapshot={snapshot} annotations={annotations} connection={connection} onDiagnostics={() => setDialog('diagnostics')} />

      {dialog === 'add' ? (
        <AddRepositoryDialog
          onClose={() => setDialog(undefined)}
          onAdded={(ids) => setView((v) => ({ hiddenRepos: v.hiddenRepos.filter((x) => !ids.includes(x)) }))}
        />
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
      {confirmRemove ? (
        <Dialog
          title="Remove repository from dashboard"
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
                Remove from dashboard
              </button>
            </>
          }
        >
          <p>
            Stop observing <strong>{confirmRemove.displayName}</strong>? This only removes it from repobs. No files, branches or worktrees are deleted, and your
            session notes are kept.
          </p>
        </Dialog>
      ) : null}
    </div>
  )
}

/** The selected agent, or the selected branch row as laid out on the dashboard (with its relations). */
/** Icon buttons on the ribbon, in order. */
const QUICK_COMMANDS = ['repos.add', 'view.repositories', 'view.details', 'view.maximize', 'view.reset', 'view.fullscreen', 'view.themeCycle', 'tools.diagnostics', 'tools.settings']

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
  onDiagnostics,
}: {
  snapshot: Snapshot
  annotations: Map<string, AnnotationSummary>
  connection: Connection
  onDiagnostics: () => void
}) {
  const working = snapshot.sessions.filter((s) => workflowStatus(s, annotations.get(s.id)) === 'working').length
  const attention = snapshot.sessions.filter((s) => ['needs_input', 'needs_review'].includes(workflowStatus(s, annotations.get(s.id)))).length
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
      <span>Synced {synced}</span>
      <span className={connection === 'live' ? undefined : styles.warn} aria-live="polite">
        ● {connLabel}
      </span>
      <span>Local only</span>
    </footer>
  )
}
