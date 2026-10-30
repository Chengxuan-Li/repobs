import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Moon, PanelRightClose, PanelRightOpen, Plus, Search, Settings as SettingsIcon, Sun, SunMoon } from 'lucide-react'
import {
  isLiveKind,
  REVIEW_LABELS,
  type ReviewState,
  type Settings,
  type Snapshot,
  sessionNeedsAttention,
  type ThemePreference,
  worktreeNeedsAttention,
} from '@repobs/contracts'
import { AnnotationEditor } from '../features/annotations/AnnotationEditor'
import { BranchInspector, Overview, RepositoryView, SessionInspector, WorktreeInspector } from '../features/git-inspector/views'
import { buildTree, filterTree, findNode, flattenTree, ancestorsOf, type TreeNode } from '../features/repository-tree/buildTree'
import { RepositoryTree, reviewActions, type TreeAction } from '../features/repository-tree/RepositoryTree'
import { AddRepositoryDialog } from '../features/settings/AddRepositoryDialog'
import { DiagnosticsPanel } from '../features/settings/DiagnosticsPanel'
import { SettingsPanel } from '../features/settings/SettingsPanel'
import { Dialog, EmptyState, InlineAlert } from '../components/primitives'
import { api, ApiError } from './api'
import type { Connection } from './store'
import { applyTheme } from './theme'
import { clamp, useViewState } from './viewState'
import styles from './shell.module.css'

// Three-pane workbench: ribbon, repository tree, center view, inspector, status bar. Pane ids are
// stable (tree / center / inspector) so docking could be added later without reshaping state.

export function WorkbenchShell({ snapshot, connection, error }: { snapshot: Snapshot; connection: Connection; error?: string }) {
  const [view, setView] = useViewState()
  const [dialog, setDialog] = useState<'add' | 'settings' | 'diagnostics' | undefined>()
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | undefined>()
  const [theme, setTheme] = useState<ThemePreference>(() => (localStorage.getItem('repobs.theme') as ThemePreference | null) ?? 'system')
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    api<Settings>('GET', '/settings').then(
      (s) => {
        setTheme(s.theme)
        applyTheme(s.theme)
      },
      () => undefined,
    )
  }, [])

  const tree = useMemo(() => buildTree(snapshot), [snapshot])
  const filtered = useMemo(
    () => filterTree(tree, { mode: view.filter, query: view.query, showHistorical: view.showHistorical }),
    [tree, view.filter, view.query, view.showHistorical],
  )
  const rows = useMemo(() => flattenTree(filtered.nodes, view.expanded, filtered.forced), [filtered, view.expanded])
  const selected = view.selectedId ? findNode(tree, view.selectedId) : undefined

  const select = useCallback(
    (id: string) => {
      const ancestors = ancestorsOf(tree, id) ?? []
      setView((v) => ({ selectedId: id, expanded: { ...v.expanded, ...Object.fromEntries(ancestors.map((a) => [a, true])) } }))
    },
    [tree, setView],
  )

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

  const setReview = async (sessionId: string, review: ReviewState) => {
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
      setNotice(`Review state set to ${REVIEW_LABELS[review]}.`)
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not update the review state')
    }
  }

  const actionsFor = (node: TreeNode): TreeAction[] => {
    const copy = (label: string, value: string): TreeAction => ({ label, run: () => void navigator.clipboard?.writeText(value) })
    const toggleAll = (expanded: boolean): TreeAction => ({
      label: expanded ? 'Expand all below' : 'Collapse all below',
      run: () => {
        const ids: string[] = []
        const walk = (n: TreeNode) => {
          if (n.children.length) ids.push(n.id)
          n.children.forEach(walk)
        }
        walk(node)
        setView((v) => ({ expanded: { ...v.expanded, ...Object.fromEntries(ids.map((id) => [id, expanded])) } }))
      },
    })
    if (node.repo) {
      const repo = node.repo
      return [
        copy('Copy repository path', repo.primaryPath),
        toggleAll(true),
        toggleAll(false),
        { label: 'Remove from dashboard…', danger: true, run: () => setConfirmRemove({ id: repo.id, name: repo.displayName }) },
      ]
    }
    if (node.branch) return [copy('Copy ref name', node.branch.fullRef)]
    if (node.worktree) return [copy('Copy worktree path', node.worktree.path)]
    if (node.session) {
      const id = node.session.id
      return [copy('Copy session ID', node.session.providerSessionId), ...reviewActions((r) => void setReview(id, r))]
    }
    return node.children.length ? [toggleAll(true), toggleAll(false)] : []
  }

  const removeRepository = async (id: string) => {
    try {
      await api('DELETE', `/repositories/${id}`)
      setNotice('Repository removed from the dashboard. No files were changed; your session notes are kept.')
      if (view.selectedId?.includes(id)) setView({ selectedId: undefined })
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not remove the repository')
    }
  }

  const startResize = (pane: 'tree' | 'inspector') => (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = pane === 'tree' ? view.treeWidth : view.inspectorWidth
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      if (pane === 'tree') setView({ treeWidth: clamp(startW + dx, 220, 520) })
      else setView({ inspectorWidth: clamp(startW - dx, 260, 520) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const resizeKeys = (pane: 'tree' | 'inspector') => (e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
    if (!delta) return
    e.preventDefault()
    if (pane === 'tree') setView((v) => ({ treeWidth: clamp(v.treeWidth + delta, 220, 520) }))
    else setView((v) => ({ inspectorWidth: clamp(v.inspectorWidth - delta, 260, 520) }))
  }

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : SunMoon
  const empty = snapshot.repositories.length === 0

  return (
    <div className={styles.shell}>
      <header className={styles.ribbon}>
        <span className={styles.brand}>repobs</span>
        <span className={styles.rule} aria-hidden="true" />
        <button type="button" className="btn" onClick={() => setDialog('add')}>
          <Plus size={13} aria-hidden="true" /> Add repository
        </button>
        <span className={styles.rule} aria-hidden="true" />
        <div className={styles.search}>
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Filter repos, paths, branches, sessions, tags"
            aria-label="Filter the tree"
            value={view.query}
            onChange={(e) => setView({ query: e.target.value })}
          />
        </div>
        <div className={styles.segmented} role="radiogroup" aria-label="Tree filter">
          {(['all', 'attention'] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={view.filter === f} className={view.filter === f ? styles.on : undefined} onClick={() => setView({ filter: f })}>
              {f === 'all' ? 'All' : 'Attention'}
            </button>
          ))}
        </div>
        <label className={styles.toggle}>
          <input type="checkbox" checked={view.showHistorical} onChange={(e) => setView({ showHistorical: e.target.checked })} /> Historical
        </label>
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
          onClick={() => setView({ inspectorOpen: !view.inspectorOpen })}
          aria-label={view.inspectorOpen ? 'Hide inspector' : 'Show inspector'}
          aria-pressed={view.inspectorOpen}
        >
          {view.inspectorOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        </button>
      </header>

      <div className={styles.body}>
        <nav id="pane-tree" className={styles.treePane} style={{ width: view.treeWidth }} aria-label="Repository tree">
          <div className="section-strip">
            <span className="label">Repositories</span>
            <button type="button" className="btn btn-quiet" onClick={() => setView({ selectedId: undefined })} aria-pressed={!view.selectedId}>
              Overview
            </button>
          </div>
          {empty ? (
            <p className={`${styles.paneNote} small muted`}>No repositories yet.</p>
          ) : rows.length === 0 ? (
            <p className={`${styles.paneNote} small muted`}>{view.filter === 'attention' ? 'Nothing needs attention.' : 'No matches.'}</p>
          ) : (
            <RepositoryTree
              rows={rows}
              selectedId={view.selectedId}
              onSelect={select}
              onToggle={(id, expanded) => setView((v) => ({ expanded: { ...v.expanded, [id]: expanded } }))}
              actionsFor={actionsFor}
            />
          )}
        </nav>
        <div
          className={styles.splitter}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize repository tree"
          aria-valuenow={view.treeWidth}
          aria-valuemin={220}
          aria-valuemax={520}
          tabIndex={0}
          onPointerDown={startResize('tree')}
          onKeyDown={resizeKeys('tree')}
        />
        <main id="pane-center" className={styles.center}>
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
            <EmptyState
              title="Observe your Git worktrees and coding agents, locally"
              action={
                <button type="button" className="btn btn-primary" onClick={() => setDialog('add')}>
                  <Plus size={13} aria-hidden="true" /> Add repository
                </button>
              }
            >
              <p>Register a local Git repository to see its branches, worktrees, working-tree status and the Claude Code and Codex sessions that ran in it.</p>
              <p>repobs only reads: it never changes your repositories or agent histories, and needs no API keys.</p>
            </EmptyState>
          ) : (
            <CenterView snapshot={snapshot} node={selected} onSelect={select} onAddRepository={() => setDialog('add')} />
          )}
        </main>
        {view.inspectorOpen ? (
          <>
            <div
              className={styles.splitter}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inspector"
              aria-valuenow={view.inspectorWidth}
              aria-valuemin={260}
              aria-valuemax={520}
              tabIndex={0}
              onPointerDown={startResize('inspector')}
              onKeyDown={resizeKeys('inspector')}
            />
            <aside id="pane-inspector" className={styles.inspector} style={{ width: view.inspectorWidth }} aria-label="Inspector">
              <div className="section-strip">
                <span className="label">{selected?.session ? 'Your notes' : 'Inspection'}</span>
              </div>
              <div className={styles.inspectorBody}>
                <Inspector node={selected} snapshot={snapshot} />
              </div>
            </aside>
          </>
        ) : null}
      </div>

      <GlobalStatusBar snapshot={snapshot} connection={connection} onDiagnostics={() => setDialog('diagnostics')} />

      {dialog === 'add' ? <AddRepositoryDialog onClose={() => setDialog(undefined)} onAdded={(r) => select(`repo:${r.id}`)} /> : null}
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
                  const id = confirmRemove.id
                  setConfirmRemove(undefined)
                  void removeRepository(id)
                }}
              >
                Remove from dashboard
              </button>
            </>
          }
        >
          <p>
            Stop observing <strong>{confirmRemove.name}</strong>? This only removes it from repobs. No files, branches or worktrees are deleted, and your
            session notes are kept.
          </p>
        </Dialog>
      ) : null}
    </div>
  )
}

function CenterView({ snapshot, node, onSelect, onAddRepository }: { snapshot: Snapshot; node?: TreeNode; onSelect: (id: string) => void; onAddRepository: () => void }) {
  if (node?.session) return <SessionInspector snapshot={snapshot} session={node.session} onSelect={onSelect} />
  if (node?.worktree) return <WorktreeInspector snapshot={snapshot} worktree={node.worktree} onSelect={onSelect} />
  if (node?.branch) return <BranchInspector snapshot={snapshot} branch={node.branch} onSelect={onSelect} />
  if (node?.repo) return <RepositoryView snapshot={snapshot} repo={node.repo} onSelect={onSelect} />
  return <Overview snapshot={snapshot} onSelect={onSelect} onAddRepository={onAddRepository} />
}

function Inspector({ node, snapshot }: { node?: TreeNode; snapshot: Snapshot }) {
  if (node?.session) {
    return <AnnotationEditor key={node.session.id} session={node.session} summary={snapshot.annotations.find((a) => a.sessionId === node.session!.id)} />
  }
  if (!node) {
    return (
      <div className="small muted">
        <p>Select a session to add tags, a review state, a scratch note and a checklist.</p>
        <p>Observed agent status and your review state are separate: a session can be idle and still need your review.</p>
      </div>
    )
  }
  const facts: Array<[string, string | undefined]> = node.repo
    ? [
        ['Repository id', node.repo.id],
        ['Common Git dir', node.repo.commonGitDir],
        ['Primary path', node.repo.primaryPath],
      ]
    : node.worktree
      ? [
          ['Worktree id', node.worktree.id],
          ['Path', node.worktree.path],
          ['HEAD', node.worktree.headOid],
        ]
      : node.branch
        ? [
            ['Ref', node.branch.fullRef],
            ['Tip', node.branch.tipOid || 'unborn'],
            ['Upstream', node.branch.upstream?.fullRef],
          ]
        : [['Group', node.label]]
  return (
    <dl className="facts">
      {facts.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd className="mono">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

function GlobalStatusBar({ snapshot, connection, onDiagnostics }: { snapshot: Snapshot; connection: Connection; onDiagnostics: () => void }) {
  const annotations = new Map(snapshot.annotations.map((a) => [a.sessionId, a]))
  const running = snapshot.sessions.filter((s) => isLiveKind(s.state.kind)).length
  const attention =
    snapshot.sessions.filter((s) => sessionNeedsAttention(s, annotations.get(s.id))).length + snapshot.worktrees.filter(worktreeNeedsAttention).length
  const synced = snapshot.monitor.lastSyncAt ? new Date(snapshot.monitor.lastSyncAt).toLocaleTimeString() : '—'
  const connLabel = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline — data may be stale' }[connection]
  return (
    <footer className={styles.statusbar} role="contentinfo">
      <span>
        {snapshot.repositories.length} repos • {snapshot.worktrees.length} worktrees • {running} active • {attention} need attention
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
