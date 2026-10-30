import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { BranchDetails, SessionDetails } from '../features/dashboard/DetailsPanel'
import { FilterBar } from '../features/dashboard/FilterBar'
import { knownTags as collectTags, sessionMatches } from '../features/dashboard/filters'
import { type BranchRow, type LayoutOptions, repositoryLastActivity } from '../features/dashboard/layout'
import { RepoBoard, type TimeDomain } from '../features/dashboard/RepoBoard'
import { RepoListPanel, type RepoSummary } from '../features/dashboard/RepoListPanel'
import { SessionCard } from '../features/dashboard/SessionCard'
import { AddRepositoryDialog } from '../features/settings/AddRepositoryDialog'
import { DiagnosticsPanel } from '../features/settings/DiagnosticsPanel'
import { SettingsPanel } from '../features/settings/SettingsPanel'
import { api, ApiError } from './api'
import type { Connection } from './store'
import { applyTheme } from './theme'
import { clamp, RANGE_MS, type RepoSort, useViewState } from './viewState'
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
  const boardsRef = useRef<HTMLDivElement>(null)
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
  const collapsed = useMemo(() => new Set(view.collapsedRepos), [view.collapsedRepos])
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

  const domain: TimeDomain = useMemo(() => {
    const end = now + 60 * 60_000
    if (view.timeRange !== 'all') return { start: now - RANGE_MS[view.timeRange], end }
    const times = [
      ...snapshot.commitGraphs.flatMap((g) => g.commits.map((c) => c.time * 1000)),
      ...snapshot.sessions.map((s) => Date.parse(s.firstSeenAt ?? '') || now),
    ]
    return { start: Math.min(now - 86_400_000, ...times), end }
  }, [now, view.timeRange, snapshot.commitGraphs, snapshot.sessions])

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

  // Keyboard: arrows move between rows across repositories; Enter/Space selects.
  const onBoardsKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (['SELECT', 'INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName) && target.closest('[data-nav-row]') !== target) {
      if (!(target.tagName === 'BUTTON' && (e.key === 'ArrowDown' || e.key === 'ArrowUp'))) return
    }
    const rows = [...(boardsRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]') ?? [])]
    if (!rows.length) return
    const current = rows.indexOf(target.closest<HTMLElement>('[data-nav-row]')!)
    const focus = (i: number) => {
      const el = rows[clamp(i, 0, rows.length - 1)]!
      el.focus()
      el.scrollIntoView({ block: 'nearest' })
    }
    if (e.key === 'ArrowDown') focus(current + 1)
    else if (e.key === 'ArrowUp') focus(current < 0 ? 0 : current - 1)
    else if (e.key === 'Home') focus(0)
    else if (e.key === 'End') focus(rows.length - 1)
    else if ((e.key === 'Enter' || e.key === ' ') && current >= 0) rows[current]!.click()
    else return
    e.preventDefault()
  }

  const selected = useMemo(() => resolveSelection(snapshot, view.selectedId), [snapshot, view.selectedId])
  const visibleRepos = summaries.filter((s) => !hidden.has(s.repo.id))
  const orphans = filtered.filter((s) => !s.repoId)
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
            <>
              <FilterBar view={view} setView={setView} knownTags={tags} shown={filtered.length} total={snapshot.sessions.length} />
              <div ref={boardsRef} className={styles.boards} onKeyDown={onBoardsKeyDown} tabIndex={0} aria-label="Branches and agents. Use the arrow keys to move between rows, Enter to open one.">
                {visibleRepos.length === 0 ? <p className="small muted" style={{ padding: 16 }}>All repositories are hidden. Tick them in the repositories panel.</p> : null}
                {visibleRepos.map(({ repo }) => (
                  <RepoBoard
                    key={repo.id}
                    repo={repo}
                    branches={branchesOf(snapshot, repo.id)}
                    worktrees={worktreesOf(snapshot, repo.id)}
                    sessions={sessionsOf(filtered, repo.id)}
                    totalSessions={snapshot.sessions.filter((s) => s.repoId === repo.id).length}
                    annotations={annotations}
                    graph={snapshot.commitGraphs.find((g) => g.repoId === repo.id)}
                    options={layoutOptions}
                    domain={domain}
                    details={view.details}
                    now={now}
                    collapsed={collapsed.has(repo.id)}
                    selectedId={view.selectedId}
                    tabbableId={view.selectedId}
                    onToggleCollapsed={() =>
                      setView((v) => ({ collapsedRepos: v.collapsedRepos.includes(repo.id) ? v.collapsedRepos.filter((x) => x !== repo.id) : [...v.collapsedRepos, repo.id] }))
                    }
                    onSelect={select}
                    onReview={(id, r) => void setReview(id, r)}
                    onExpandBranch={(rowId) => setView((v) => ({ expandedBranches: [...v.expandedBranches, rowId] }))}
                  />
                ))}
                {orphans.length ? <OrphanSessions sessions={orphans} annotations={annotations} details={view.details} now={now} onSelect={select} onReview={setReview} /> : null}
              </div>
            </>
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

const branchesOf = memoBy((s: Snapshot, repoId: string) => s.branches.filter((b) => b.repoId === repoId))
const worktreesOf = memoBy((s: Snapshot, repoId: string) => s.worktrees.filter((w) => w.repoId === repoId))
const sessionsOf = memoBy((sessions: AgentSession[], repoId: string) => sessions.filter((s) => s.repoId === repoId))

/** Memoize per (source array/object, repoId) so boards receive stable props between renders. */
function memoBy<S extends object, T>(fn: (source: S, repoId: string) => T[]) {
  const cache = new WeakMap<S, Map<string, T[]>>()
  return (source: S, repoId: string): T[] => {
    let m = cache.get(source)
    if (!m) {
      m = new Map()
      cache.set(source, m)
    }
    let v = m.get(repoId)
    if (!v) {
      v = fn(source, repoId)
      m.set(repoId, v)
    }
    return v
  }
}

function resolveSelection(snapshot: Snapshot, id: string | undefined): { session?: AgentSession; branch?: BranchRow } | undefined {
  if (!id) return undefined
  if (id.startsWith('session:')) {
    const session = snapshot.sessions.find((s) => s.id === id.slice('session:'.length))
    return session ? { session } : undefined
  }
  const pending = (w: { status: { state: string; staged: number; unstaged: number; untracked: number; conflicted: number } }) =>
    w.status.state === 'ok' ? w.status.staged + w.status.unstaged + w.status.untracked + w.status.conflicted : 0
  if (id.startsWith('branch:')) {
    const branch = snapshot.branches.find((b) => b.id === id.slice('branch:'.length))
    if (!branch) return undefined
    const worktrees = snapshot.worktrees.filter((w) => branch.worktreeIds.includes(w.id))
    return {
      branch: {
        kind: 'branch',
        id,
        label: branch.shortName,
        branch,
        worktrees,
        detached: false,
        remoteOnly: branch.classification === 'remote_only',
        headOid: branch.tipOid,
        pendingChanges: worktrees.reduce((n, w) => n + pending(w), 0),
        conflicted: worktrees.reduce((n, w) => n + w.status.conflicted, 0),
      },
    }
  }
  if (id.startsWith('detached:')) {
    const w = snapshot.worktrees.find((x) => x.id === id.slice('detached:'.length))
    if (!w) return undefined
    return {
      branch: { kind: 'branch', id, label: `${w.displayName} (detached)`, worktrees: [w], detached: true, remoteOnly: false, headOid: w.headOid, pendingChanges: pending(w), conflicted: w.status.conflicted },
    }
  }
  return undefined
}

function OrphanSessions({
  sessions,
  annotations,
  details,
  now,
  onSelect,
  onReview,
}: {
  sessions: AgentSession[]
  annotations: Map<string, AnnotationSummary>
  details: boolean
  now: number
  onSelect: (id: string) => void
  onReview: (id: string, r: ReviewState) => Promise<void>
}) {
  return (
    <section className={styles.orphans} aria-label="Sessions without a repository">
      <div className="section-strip">
        <span className="label">Sessions without a repository</span>
        <span className="small muted">Annotated sessions whose repository is no longer registered</span>
      </div>
      <div role="list">
        {sessions.map((s) => (
          <div key={s.id} role="listitem" data-nav-row="" data-row-id={`session:${s.id}`} tabIndex={-1} className={styles.orphanRow} onClick={() => onSelect(`session:${s.id}`)}>
            <SessionCard session={s} annotation={annotations.get(s.id)} depth={0} details={details} now={now} onReview={(r) => void onReview(s.id, r)} />
          </div>
        ))}
      </div>
    </section>
  )
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
