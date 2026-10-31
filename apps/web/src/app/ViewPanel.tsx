import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import type { AnnotationSummary, ReviewState, Snapshot } from '@repobs/contracts'
import { EmptyState } from '../components/primitives'
import { Dashboard } from '../features/dashboard/Dashboard'
import { sessionMatches } from '../features/dashboard/filters'
import { type LayoutOptions, layoutRepository, type RepoLayout } from '../features/dashboard/layout'
import type { RepoSummary } from '../features/dashboard/RepoListPanel'
import type { ViewPatch, ViewState } from './viewState'
import styles from './shell.module.css'

// One view (a dashboard tab): its own filters, display options and repository selection over the
// shared snapshot, annotations and selection.

/** The agents a view shows and the layout of each repository it shows. */
export function useViewData(snapshot: Snapshot, view: ViewState, annotations: Map<string, AnnotationSummary>, summaries: RepoSummary[], now: number) {
  const filtered = useMemo(
    () => snapshot.sessions.filter((s) => sessionMatches(s, annotations.get(s.id), view.filters, now)),
    [snapshot.sessions, annotations, view.filters, now],
  )
  const repos = useMemo(() => summaries.filter((s) => !view.hiddenRepos.includes(s.repo.id)), [summaries, view.hiddenRepos])
  const options: LayoutOptions = useMemo(
    () => ({
      branchMode: view.branchMode,
      collapseSpawned: view.collapseSpawned,
      toggledAgents: new Set(view.toggledAgents),
      showRemoteOnly: view.showRemoteOnly,
      sessionLimit: 12,
      expandedBranches: new Set(view.expandedBranches),
      collapseQuiet: view.collapseQuiet,
      expandedGroups: new Set(view.expandedGroups),
    }),
    [view.branchMode, view.collapseSpawned, view.toggledAgents, view.showRemoteOnly, view.expandedBranches, view.collapseQuiet, view.expandedGroups],
  )
  const layouts = useMemo(() => {
    const m = new Map<string, RepoLayout>()
    for (const { repo } of repos) {
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
          options,
        ),
      )
    }
    return m
  }, [repos, snapshot.branches, snapshot.worktrees, snapshot.commitGraphs, filtered, annotations, options])
  return { filtered, repos, layouts }
}

export function ViewPanel({
  name,
  view,
  setView,
  snapshot,
  annotations,
  summaries,
  tags,
  selectedId,
  now,
  onActivate,
  onSelect,
  onReview,
  onAdd,
}: {
  name: string
  view: ViewState
  setView: (patch: ViewPatch) => void
  snapshot: Snapshot
  annotations: Map<string, AnnotationSummary>
  summaries: RepoSummary[]
  tags: string[]
  selectedId?: string
  now: number
  /** The pointer or focus entered this view: it becomes the current view. */
  onActivate: () => void
  onSelect: (id: string) => void
  onReview: (sessionId: string, review: ReviewState) => void
  onAdd: () => void
}) {
  const { filtered, repos, layouts } = useViewData(snapshot, view, annotations, summaries, now)
  return (
    <main className={styles.main} aria-label={`${name} dashboard`} onPointerDownCapture={onActivate} onFocusCapture={onActivate}>
      {snapshot.repositories.length === 0 ? (
        <div className={styles.boards}>
          <EmptyState
            title="Observe your Git worktrees and coding agents, locally"
            action={
              <button type="button" className="btn btn-primary" onClick={onAdd}>
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
          repos={repos}
          allRepos={summaries}
          tags={tags}
          view={view}
          setView={setView}
          selectedId={selectedId}
          now={now}
          onSelect={onSelect}
          onReview={onReview}
        />
      )}
    </main>
  )
}
