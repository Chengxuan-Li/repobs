import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Moon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Settings as SettingsIcon, Sun, SunMoon } from 'lucide-react'
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
import { clamp, type RepoSort, useViewState } from './viewState'
import styles from './shell.module.css'

// Workbench (ADR 0003): one primary working panel — the repository dashboard — plus optional
// side panels: repositories on the left, details and notes on the right. Only the panels scroll;
// the page itself never does.

export function WorkbenchShell({ snapshot, connection, error }: { snapshot: Snapshot; connection: Connection; error?: string }) {
  const [view, setView] = useViewState()
  const [dialog, setDialog] = useState<'add' | 'settings' | 'diagnostics' | undefined>()
  const [confirmRemove, setConfirmRemove] = useState<Repository | undefined>()
  const [theme, setTheme] = useState<ThemePreference>(() => (localStorage.getItem('repobs.theme') as ThemePreference | null) ?? 'system')
  const [notice, setNotice] = useState<string>()
  const now = useNow(30_000)

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
    }),
    [view.branchMode, view.showSpawned, view.showRemoteOnly, view.expandedBranches],
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

  const select = useCallback((id: string) => setView({ selectedId: id, rightOpen: true }), [setView])

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

  const cycleTheme = async () => {
    const next: ThemePreference = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
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
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon

  const resizer = (side: 'left' | 'right') => ({
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    'aria-label': side === 'left' ? 'Resize repositories panel' : 'Resize details panel',
    tabIndex: 0,
    className: styles.splitter,
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = side === 'left' ? view.leftWidth : view.rightWidth
      const move = (ev: PointerEvent) =>
        setView(side === 'left' ? { leftWidth: clamp(startW + ev.clientX - startX, 180, 420) } : { rightWidth: clamp(startW - (ev.clientX - startX), 280, 560) })
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
      if (!d) return
      e.preventDefault()
      setView((v) => (side === 'left' ? { leftWidth: clamp(v.leftWidth + d, 180, 420) } : { rightWidth: clamp(v.rightWidth - d, 280, 560) }))
    },
  })

  return (
    <div className={styles.shell}>
      <header className={styles.ribbon}>
        <button
          type="button"
          className="btn btn-quiet btn-icon"
          onClick={() => setView({ leftOpen: !view.leftOpen })}
          aria-label={view.leftOpen ? 'Hide repositories panel' : 'Show repositories panel'}
          aria-pressed={view.leftOpen}
        >
          {view.leftOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        <span className={styles.brand}>repobs</span>
        <span className={styles.rule} aria-hidden="true" />
        <button type="button" className="btn" onClick={() => setDialog('add')}>
          <Plus size={13} aria-hidden="true" /> Add repositories
        </button>
        <span className={styles.spacer} />
        <button type="button" className="btn btn-quiet" onClick={() => setDialog('diagnostics')} title="Adapters, watchers and Git health">
          <Activity size={13} aria-hidden="true" /> Diagnostics
        </button>
        <button type="button" className="btn btn-quiet btn-icon" onClick={() => void cycleTheme()} aria-label={`Theme: ${theme}. Switch theme`} title={`Theme: ${theme}`}>
          <ThemeIcon size={14} />
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setDialog('settings')}>
          <SettingsIcon size={13} aria-hidden="true" /> Settings
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-icon"
          onClick={() => setView({ rightOpen: !view.rightOpen })}
          aria-label={view.rightOpen ? 'Hide details panel' : 'Show details panel'}
          aria-pressed={view.rightOpen}
        >
          {view.rightOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
      </header>

      <div className={styles.body}>
        {view.leftOpen ? (
          <>
            <aside className={styles.side} style={{ width: view.leftWidth }} aria-label="Repositories panel">
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
            <div {...resizer('left')} aria-valuenow={view.leftWidth} aria-valuemin={180} aria-valuemax={420} />
          </>
        ) : null}

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

        {view.rightOpen ? (
          <>
            <div {...resizer('right')} aria-valuenow={view.rightWidth} aria-valuemin={280} aria-valuemax={560} />
            <aside className={styles.side} style={{ width: view.rightWidth }} aria-label="Details panel">
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
          </>
        ) : null}
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
