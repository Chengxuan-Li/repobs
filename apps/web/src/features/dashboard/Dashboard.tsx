import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type AgentSession, type AnnotationSummary, type ReviewState, type Snapshot, workflowStatus } from '@repobs/contracts'
import { RANGE_MS, type ViewState } from '../../app/viewState'
import { clamp } from '../../app/viewState'
import { AgentRow } from './AgentRow'
import { FilterBar } from './FilterBar'
import { AgentHover, HoverCard, type HoverState, type ShowHover } from './HoverCard'
import type { RepoLayout } from './layout'
import { Legend } from './Legend'
import { LABEL_W, RepoBoard } from './RepoBoard'
import type { RepoSummary } from './RepoListPanel'
import { buildTimeline } from './timeline'
import boardStyles from './board.module.css'
import styles from './dashboard.module.css'

const AXIS_HEIGHT = 24

export function Dashboard({
  snapshot,
  filtered,
  annotations,
  layouts,
  repos,
  tags,
  view,
  setView,
  now,
  onSelect,
  onReview,
}: {
  snapshot: Snapshot
  filtered: AgentSession[]
  annotations: Map<string, AnnotationSummary>
  layouts: Map<string, RepoLayout>
  repos: RepoSummary[]
  tags: string[]
  view: ViewState
  setView: (patch: Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)) => void
  now: number
  onSelect: (id: string) => void
  onReview: (sessionId: string, review: ReviewState) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(0)
  const [hover, setHover] = useState<HoverState>()

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setViewport(el.clientWidth)
    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  const visibleIds = useMemo(() => new Set(repos.map((r) => r.repo.id)), [repos])
  const timeline = useMemo(
    () =>
      buildTimeline({
        mode: view.axisMode,
        graphs: snapshot.commitGraphs.filter((g) => visibleIds.has(g.repoId)),
        activity: filtered
          .filter((s) => s.repoId && visibleIds.has(s.repoId))
          .map((s) => ({ start: Date.parse(s.firstSeenAt ?? s.lastActivityAt ?? '') || now, end: Date.parse(s.lastActivityAt ?? '') || now })),
        rangeStart: view.timeRange === 'all' ? null : now - RANGE_MS[view.timeRange],
        now,
        availableWidth: Math.max(240, viewport - LABEL_W),
        minSpacing: 22,
      }),
    [view.axisMode, view.timeRange, snapshot.commitGraphs, visibleIds, filtered, now, viewport],
  )

  // Start scrolled to the newest end of history; later the user's scroll position is kept.
  const scrolledFor = useRef('')
  useLayoutEffect(() => {
    const el = scrollRef.current
    const key = `${view.axisMode}|${view.timeRange}`
    if (!el || !viewport || scrolledFor.current === key) return
    scrolledFor.current = key
    el.scrollLeft = el.scrollWidth
  }, [viewport, view.axisMode, view.timeRange, timeline.width])

  const sessionsById = useMemo(() => new Map(snapshot.sessions.map((s) => [s.id, s])), [snapshot.sessions])
  const childCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of snapshot.sessions) if (s.parentSessionId) m.set(s.parentSessionId, (m.get(s.parentSessionId) ?? 0) + 1)
    return m
  }, [snapshot.sessions])
  const expandedAgents = useMemo(() => new Set(view.expandedAgents), [view.expandedAgents])
  const collapsed = useMemo(() => new Set(view.collapsedRepos), [view.collapsedRepos])

  const showHover: ShowHover = useCallback((content, e) => setHover({ content, x: e.clientX, y: e.clientY }), [])
  const hideHover = useCallback(() => setHover(undefined), [])
  const toggleAgent = useCallback(
    (id: string) => setView((v) => ({ expandedAgents: v.expandedAgents.includes(id) ? v.expandedAgents.filter((x) => x !== id) : [...v.expandedAgents, id] })),
    [setView],
  )
  const toggleCollapsed = useCallback(
    (id: string) => setView((v) => ({ collapsedRepos: v.collapsedRepos.includes(id) ? v.collapsedRepos.filter((x) => x !== id) : [...v.collapsedRepos, id] })),
    [setView],
  )
  const expandBranch = useCallback((rowId: string) => setView((v) => ({ expandedBranches: [...v.expandedBranches, rowId] })), [setView])

  // Keyboard: ↑/↓/Home/End move between rows across repositories, → / ← expand or collapse an
  // agent, Enter/Space selects.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(target.tagName)) return
    const rows = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-nav-row]') ?? [])]
    if (!rows.length) return
    const current = rows.indexOf(target.closest<HTMLElement>('[data-nav-row]')!)
    const focus = (i: number) => {
      const el = rows[clamp(i, 0, rows.length - 1)]!
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    const sessionId = current >= 0 ? rows[current]!.dataset.sessionId : undefined
    if (e.key === 'ArrowDown') focus(current + 1)
    else if (e.key === 'ArrowUp') focus(current < 0 ? 0 : current - 1)
    else if (e.key === 'Home') focus(0)
    else if (e.key === 'End') focus(rows.length - 1)
    else if (e.key === 'ArrowRight' && sessionId && !expandedAgents.has(sessionId)) toggleAgent(sessionId)
    else if (e.key === 'ArrowLeft' && sessionId && expandedAgents.has(sessionId)) toggleAgent(sessionId)
    else if ((e.key === 'Enter' || e.key === ' ') && current >= 0) rows[current]!.click()
    else return
    e.preventDefault()
  }

  const orphans = filtered.filter((s) => !s.repoId)
  return (
    <>
      <FilterBar view={view} setView={setView} knownTags={tags} shown={filtered.length} total={snapshot.sessions.length} />
      {view.legendOpen ? <Legend axisMode={view.axisMode} /> : null}
      <div
        ref={scrollRef}
        className={styles.scroller}
        onKeyDown={onKeyDown}
        onScroll={hideHover}
        tabIndex={0}
        aria-label="Branches and agents. Use the arrow keys to move between rows, right and left arrows to expand or collapse an agent, Enter to open it."
        style={{ ['--axis-height' as string]: `${AXIS_HEIGHT}px` }}
      >
        <div className={styles.canvas} style={{ width: LABEL_W + timeline.width }}>
          <div className={styles.axis} style={{ height: AXIS_HEIGHT }} aria-hidden="true">
            <div className={styles.axisLabel} style={{ width: LABEL_W }}>
              {view.axisMode === 'sequence' ? 'Commits in order →' : 'Calendar time →'}
            </div>
            <svg width={timeline.width} height={AXIS_HEIGHT}>
              {timeline.ticks.map((t, i) => (
                <g key={`${t.label}-${i}`} transform={`translate(${t.x},0)`}>
                  <line y1={17} y2={AXIS_HEIGHT} className={styles.tick} />
                  <text y={13} textAnchor="middle" className={styles.tickLabel}>
                    {t.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          {repos.length === 0 ? <p className={`${styles.stickyNote} small muted`}>All repositories are hidden. Tick them in the repositories panel.</p> : null}
          {repos.map((summary) => {
            const repo = summary.repo
            const layout = layouts.get(repo.id)
            if (!layout) return null
            const sessions = filtered.filter((s) => s.repoId === repo.id)
            return (
              <RepoBoard
                key={repo.id}
                repo={repo}
                layout={layout}
                graph={snapshot.commitGraphs.find((g) => g.repoId === repo.id)}
                pullRequests={snapshot.pullRequests.filter((p) => p.repoId === repo.id)}
                timeline={timeline}
                viewportWidth={viewport}
                expandAll={view.details}
                expandedAgents={expandedAgents}
                now={now}
                collapsed={collapsed.has(repo.id)}
                selectedId={view.selectedId}
                tabbableId={view.selectedId}
                shownAgents={sessions.length}
                totalAgents={summary.agents}
                attention={sessions.filter((s) => ['needs_input', 'needs_review'].includes(workflowStatus(s, annotations.get(s.id)))).length}
                sessionsById={sessionsById}
                childCount={childCount}
                annotations={annotations}
                showHover={showHover}
                hideHover={hideHover}
                onToggleCollapsed={() => toggleCollapsed(repo.id)}
                onSelect={onSelect}
                onReview={onReview}
                onExpandBranch={expandBranch}
                onToggleAgent={toggleAgent}
              />
            )
          })}
          {orphans.length ? (
            <section className={styles.orphans} aria-label="Sessions without a repository">
              <div className={`section-strip ${styles.stickyNote}`} style={{ width: Math.min(viewport, LABEL_W + timeline.width) }}>
                <span className="label">Sessions without a repository</span>
                <span className="small muted">annotated sessions whose repository is no longer registered</span>
              </div>
              <div role="list">
                {orphans.map((s) => (
                  <div
                    key={s.id}
                    role="listitem"
                    data-nav-row=""
                    data-session-id={s.id}
                    data-row-id={`session:${s.id}`}
                    tabIndex={-1}
                    className={boardStyles.row}
                    aria-label={`${annotations.get(s.id)?.displayAlias || s.title}, ${s.provider === 'claude' ? 'Claude Code' : 'Codex'} agent`}
                    onClick={() => onSelect(`session:${s.id}`)}
                  >
                    <div
                      className={boardStyles.label}
                      onMouseEnter={(e) => showHover(<AgentHover session={s} annotation={annotations.get(s.id)} now={now} children={childCount.get(s.id) ?? 0} />, e)}
                      onMouseLeave={hideHover}
                    >
                      <AgentRow
                        session={s}
                        annotation={annotations.get(s.id)}
                        depth={0}
                        expanded={view.details || expandedAgents.has(s.id)}
                        now={now}
                        onToggle={() => toggleAgent(s.id)}
                        onReview={(r) => onReview(s.id, r)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      <HoverCard state={hover} />
    </>
  )
}
