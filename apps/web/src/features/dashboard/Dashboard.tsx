import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { type AgentSession, type AnnotationSummary, type ReviewState, type Snapshot, statusNeedsAttention, workflowStatus } from '@repobs/contracts'
import { wheelPixels } from '../../app/uiScale'
import { ACTIVITY_DETAIL_ZOOM, clamp, MAX_ZOOM, MIN_ZOOM, RANGE_MS, type ViewPatch, type ViewState } from '../../app/viewState'
import { pageZoom } from '../../components/placement'
import { AgentRow } from './AgentRow'
import type { ChecklistEntry } from './checklistEntries'
import { FilterBar } from './FilterBar'
import { AgentHover, HoverCard, hoverAt, type HoverState, type ShowHover } from './HoverCard'
import type { RepoLayout } from './layout'
import { LABEL_W, LABEL_W_NARROW, RepoBoard } from './RepoBoard'
import type { RepoSummary } from './RepoListPanel'
import { buildTimeline, timeAt } from './timeline'
import { useDragPan } from './useDragPan'
import { useActivity } from './useActivity'
import boardStyles from './board.module.css'
import styles from './dashboard.module.css'

const AXIS_HEIGHT = 24
const ZOOM_STEP = 1.5
/** Open menus and cards inside the view keep the wheel for their own scrolling. */
const OWN_WHEEL = '[role="menu"], [role="dialog"], [role="listbox"]'
const AXIS_LABELS = { sequence: 'Commits in order →', time: 'Calendar time →', compressed: 'Calendar, compressed →' } as const

export function Dashboard({
  snapshot,
  filtered,
  annotations,
  layouts,
  repos,
  tags,
  view,
  setView,
  allRepos,
  selectedId,
  now,
  onSelect,
  onReview,
  onChecklist,
}: {
  snapshot: Snapshot
  filtered: AgentSession[]
  annotations: Map<string, AnnotationSummary>
  layouts: Map<string, RepoLayout>
  repos: RepoSummary[]
  tags: string[]
  view: ViewState
  setView: (patch: ViewPatch) => void
  /** Every registered repository; the view shows those it does not hide. */
  allRepos: RepoSummary[]
  selectedId?: string
  now: number
  onSelect: (id: string) => void
  onReview: (sessionId: string, review: ReviewState) => void
  /** Resolves to whether the change was saved. */
  onChecklist: (sessionId: string, entry: ChecklistEntry, done: boolean) => Promise<boolean>
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

  const labelW = view.agentNames ? LABEL_W : LABEL_W_NARROW
  const visibleIds = useMemo(() => new Set(repos.map((r) => r.repo.id)), [repos])
  const timeline = useMemo(
    () =>
      buildTimeline({
        mode: view.axisMode,
        // Drawn items only: a collapsed run of quiet commits takes one column.
        items: [...layouts.entries()]
          .filter(([repoId]) => visibleIds.has(repoId))
          .flatMap(([, l]) => [
            ...[...l.commits.values()].filter((p) => !l.groupOf.has(p.commit.oid)).map((p) => ({ key: p.commit.oid, time: p.commit.time * 1000 })),
            ...l.groups.map((g) => ({ key: g.id, time: g.end })),
          ]),
        // Drawn agent bars only (not those behind "show more"), so hidden agents take no space.
        activity: [...layouts.entries()]
          .filter(([repoId]) => visibleIds.has(repoId))
          .flatMap(([, l]) => l.rows.flatMap((r) => (r.kind === 'session' ? [r.session] : [])))
          .map((s) => ({ start: Date.parse(s.firstSeenAt ?? s.lastActivityAt ?? '') || now, end: Date.parse(s.lastActivityAt ?? '') || now })),
        rangeStart: view.timeRange === 'all' ? null : now - RANGE_MS[view.timeRange],
        now,
        availableWidth: Math.max(240, viewport - labelW),
        minSpacing: 22,
        zoom: view.zoom,
      }),
    [view.axisMode, view.timeRange, view.zoom, layouts, visibleIds, now, viewport, labelW],
  )

  // Horizontal zoom keeps the moment under the pointer (or the middle of the lanes) in place: after
  // the redraw the view scrolls so that the same time is under the same pixel, on every axis mode.
  const zoomState = useRef({ zoom: view.zoom, timeline, labelW })
  useLayoutEffect(() => {
    zoomState.current = { zoom: view.zoom, timeline, labelW }
  })
  const anchor = useRef<{ time: number; px: number }>(undefined)
  const zoomTo = useCallback(
    (zoom: number, px?: number, time?: number) => {
      const el = scrollRef.current
      const next = clamp(Math.round(zoom * 100) / 100, MIN_ZOOM, MAX_ZOOM)
      if (next === zoomState.current.zoom) return
      if (el) {
        const { timeline: t, labelW: lw } = zoomState.current
        const at = px ?? lw + (el.clientWidth - lw) / 2
        anchor.current = { time: time ?? timeAt(t, el.scrollLeft + at - lw), px: at }
      }
      setView({ zoom: next })
    },
    [setView],
  )
  useLayoutEffect(() => {
    const el = scrollRef.current
    const a = anchor.current
    if (!el || !a) return
    anchor.current = undefined
    el.scrollLeft = timeline.x(a.time) + labelW - a.px
  }, [timeline, labelW])

  // The wheel zooms live: notches add up, and the history is redrawn at most once per frame (each
  // redraw is a few paths per agent, activity.ts), about the moment under the pointer when the
  // gesture began, so it neither stretches nor drifts.
  const wheel = useRef<{ zoom: number; time: number; px: number; frame?: number; idle?: ReturnType<typeof setTimeout> }>(undefined)
  useEffect(
    () => () => {
      cancelAnimationFrame(wheel.current?.frame ?? 0)
      clearTimeout(wheel.current?.idle)
    },
    [],
  )
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // The wheel zooms the history around the pointer, 10 % per notch, instead of scrolling (dragging
    // pans both ways); Ctrl + wheel is left to the UI size (app/uiScale.ts). Sideways swipes
    // (touchpads, tilting wheels) and Shift + wheel still scroll sideways. Needs a non-passive listener.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || (e.target as Element).closest(OWN_WHEEL)) return
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      const px = (e.clientX - el.getBoundingClientRect().left) / pageZoom()
      let g = wheel.current
      if (!g || Math.abs(g.px - px) > 2) {
        if (g) cancelAnimationFrame(g.frame ?? 0)
        const { zoom, timeline: t, labelW: lw } = zoomState.current
        g = wheel.current = { zoom, time: timeAt(t, el.scrollLeft + px - lw), px }
        setHover(undefined)
      }
      g.zoom = clamp(g.zoom * Math.pow(1.1, -wheelPixels(e) / 100), MIN_ZOOM, MAX_ZOOM)
      const gesture = g
      gesture.frame ??= requestAnimationFrame(() => {
        gesture.frame = undefined
        zoomTo(gesture.zoom, gesture.px, gesture.time)
      })
      clearTimeout(gesture.idle)
      gesture.idle = setTimeout(() => {
        if (wheel.current === gesture && gesture.frame === undefined) wheel.current = undefined
      }, 250)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo])

  // Start scrolled to the newest end of history; later the user's scroll position is kept.
  const scrolledFor = useRef('')
  useLayoutEffect(() => {
    const el = scrollRef.current
    const key = `${view.axisMode}|${view.timeRange}`
    if (!el || !viewport || scrolledFor.current === key) return
    scrolledFor.current = key
    el.scrollLeft = el.scrollWidth
  }, [viewport, view.axisMode, view.timeRange, timeline.width])

  // Steps and tokens of the agents this view draws (ADR 0013), fetched as they are needed.
  const drawnSessions = useMemo(
    () =>
      [...layouts.entries()]
        .filter(([repoId]) => visibleIds.has(repoId) && !view.collapsedRepos.includes(repoId))
        .flatMap(([, l]) => l.rows.flatMap((r) => (r.kind === 'session' ? [r.session] : []))),
    [layouts, visibleIds, view.collapsedRepos],
  )
  const activity = useActivity(drawnSessions, true)
  const activityDetail = view.activityDetail === 'on' || (view.activityDetail === 'auto' && view.zoom >= ACTIVITY_DETAIL_ZOOM)

  const sessionsById = useMemo(() => new Map(snapshot.sessions.map((s) => [s.id, s])), [snapshot.sessions])
  const childCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of snapshot.sessions) if (s.parentSessionId) m.set(s.parentSessionId, (m.get(s.parentSessionId) ?? 0) + 1)
    return m
  }, [snapshot.sessions])
  const collapsed = useMemo(() => new Set(view.collapsedRepos), [view.collapsedRepos])

  // Interactive cards (commit lists) stay open briefly so the pointer can move onto them.
  // Some cards open after a pause (agents in the lanes); leaving before then cancels them.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const interactiveOpen = useRef(false)
  const showHover: ShowHover = useCallback((content, e, options) => {
    clearTimeout(showTimer.current)
    // A delayed card lets the open one close as usual meanwhile.
    if (!options?.delay) clearTimeout(hideTimer.current)
    const state = hoverAt(content, e, options)
    const open = () => {
      clearTimeout(hideTimer.current)
      interactiveOpen.current = !!options?.interactive
      setHover(state)
    }
    if (options?.delay) showTimer.current = setTimeout(open, options.delay)
    else open()
  }, [])
  const hideHover = useCallback(() => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHover(undefined), interactiveOpen.current ? 250 : 0)
  }, [])
  const keepHover = useCallback(() => clearTimeout(hideTimer.current), [])
  const expandGroup = useCallback(
    (id: string) => {
      setHover(undefined)
      setView((v) => ({ expandedGroups: v.expandedGroups.includes(id) ? v.expandedGroups : [...v.expandedGroups, id] }))
    },
    [setView],
  )
  /** Shows or hides the agents a session spawned. */
  const toggleAgent = useCallback(
    (id: string) => setView((v) => ({ toggledAgents: v.toggledAgents.includes(id) ? v.toggledAgents.filter((x) => x !== id) : [...v.toggledAgents, id] })),
    [setView],
  )
  const toggleCollapsed = useCallback(
    (id: string) => setView((v) => ({ collapsedRepos: v.collapsedRepos.includes(id) ? v.collapsedRepos.filter((x) => x !== id) : [...v.collapsedRepos, id] })),
    [setView],
  )
  /** Hides an agent from this view (a filter: the agent and your notes are unchanged). */
  const hideAgent = useCallback(
    (id: string) => setView((v) => ({ filters: { ...v.filters, hiddenAgents: v.filters.hiddenAgents.includes(id) ? v.filters.hiddenAgents : [...v.filters.hiddenAgents, id] } })),
    [setView],
  )
  const expandBranch = useCallback((rowId: string) => setView((v) => ({ expandedBranches: [...v.expandedBranches, rowId] })), [setView])

  // Keyboard: ↑/↓/Home/End move between rows across repositories, → / ← show or hide an agent's
  // spawned agents, Enter/Space selects.
  const pan = useDragPan(scrollRef, () => setHover(undefined))

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
    const expanded = current >= 0 ? rows[current]!.getAttribute('aria-expanded') : null
    if (e.key === 'ArrowDown') focus(current + 1)
    else if (e.key === 'ArrowUp') focus(current < 0 ? 0 : current - 1)
    else if (e.key === 'Home') focus(0)
    else if (e.key === 'End') focus(rows.length - 1)
    else if (e.key === 'ArrowRight' && sessionId && expanded === 'false') toggleAgent(sessionId)
    else if (e.key === 'ArrowLeft' && sessionId && expanded === 'true') toggleAgent(sessionId)
    else if ((e.key === 'Enter' || e.key === ' ') && current >= 0) rows[current]!.click()
    else if (e.ctrlKey || e.metaKey || e.altKey) return
    else if (e.key === '+' || e.key === '=') zoomTo(view.zoom * ZOOM_STEP)
    else if (e.key === '-') zoomTo(view.zoom / ZOOM_STEP)
    else if (e.key === '0') zoomTo(1)
    else return
    e.preventDefault()
  }

  const orphans = filtered.filter((s) => !s.repoId)
  return (
    <>
      <FilterBar
        view={view}
        setView={setView}
        knownTags={tags}
        repositories={allRepos.map((r) => ({ id: r.repo.id, name: r.repo.displayName }))}
        agentTitle={(id) => {
          const s = sessionsById.get(id)
          return annotations.get(id)?.displayAlias || s?.title || 'An agent no longer observed'
        }}
        shown={filtered.length}
        total={snapshot.sessions.length}
      />
      <div
        ref={scrollRef}
        className={styles.scroller}
        onKeyDown={onKeyDown}
        onScroll={() => setHover(undefined)}
        {...pan}
        data-menu-bounds=""
        tabIndex={0}
        aria-label="Branches and agents. Use the arrow keys to move between rows, right and left arrows to show or hide an agent's spawned agents, Enter to open it, plus and minus to zoom the history. Drag with the mouse to pan; the mouse wheel zooms."
        style={{ ['--axis-height' as string]: `${AXIS_HEIGHT}px`, ['--label-w' as string]: `${labelW}px` }}
      >
        <div className={styles.canvas} style={{ width: labelW + timeline.width }}>
          <div className={styles.axis} style={{ height: AXIS_HEIGHT }}>
            <div className={styles.axisLabel} style={{ width: labelW }}>
              <span aria-hidden="true">{AXIS_LABELS[view.axisMode]}</span>
              <span className={styles.spacer} />
              <div className={styles.zoom} role="group" aria-label="Zoom history" onKeyDown={(e) => e.stopPropagation()}>
                <button type="button" className={styles.zoomButton} aria-label="Zoom out" title="Zoom out (−, or the wheel)" disabled={view.zoom <= MIN_ZOOM} onClick={() => zoomTo(view.zoom / ZOOM_STEP)}>
                  <Minus size={11} />
                </button>
                <button type="button" className={styles.zoomLevel} title="Reset zoom (0)" aria-label={`Zoom ${Math.round(view.zoom * 100)}%, reset`} onClick={() => zoomTo(1)}>
                  {Math.round(view.zoom * 100)}%
                </button>
                <button type="button" className={styles.zoomButton} aria-label="Zoom in" title="Zoom in (+, or the wheel)" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomTo(view.zoom * ZOOM_STEP)}>
                  <Plus size={11} />
                </button>
              </div>
            </div>
            <svg width={timeline.width} height={AXIS_HEIGHT} aria-hidden="true">
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
                labelWidth={labelW}
                agentNames={view.agentNames}
                barLabels={view.barLabels}
                activity={activity}
                activityDetail={activityDetail}
                contextHeight={view.contextHeight}
                viewportWidth={viewport}
                now={now}
                collapsed={collapsed.has(repo.id)}
                selectedId={selectedId}
                tabbableId={selectedId}
                shownAgents={sessions.length}
                totalAgents={summary.agents}
                attention={sessions.filter((s) => statusNeedsAttention(workflowStatus(s, annotations.get(s.id)))).length}
                sessionsById={sessionsById}
                childCount={childCount}
                annotations={annotations}
                showHover={showHover}
                hideHover={hideHover}
                onToggleCollapsed={() => toggleCollapsed(repo.id)}
                onSelect={onSelect}
                onReview={onReview}
                onChecklist={onChecklist}
                onHide={hideAgent}
                onExpandBranch={expandBranch}
                onToggleAgent={toggleAgent}
                onExpandGroup={expandGroup}
              />
            )
          })}
          {orphans.length ? (
            <section className={styles.orphans} aria-label="Sessions without a repository">
              <div className={`section-strip ${styles.stickyNote}`} style={{ width: Math.min(viewport, labelW + timeline.width) }}>
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
                    className={`${boardStyles.row} ${boardStyles.row_session} ${selectedId === `session:${s.id}` ? boardStyles.selected : ''}`}
                    aria-label={`${annotations.get(s.id)?.displayAlias || s.title}, ${s.provider === 'claude' ? 'Claude Code' : 'Codex'} agent`}
                    onClick={() => onSelect(`session:${s.id}`)}
                  >
                    <div
                      className={boardStyles.label}
                      onMouseEnter={(e) => showHover(<AgentHover session={s} annotation={annotations.get(s.id)} now={now} children={childCount.get(s.id) ?? 0} />, e, { placement: 'right' })}
                      onMouseLeave={hideHover}
                    >
                      <AgentRow
                        session={s}
                        annotation={annotations.get(s.id)}
                        guides={[]}
                        hasChildren={false}
                        childCount={0}
                        expanded={false}
                        focusable={selectedId === `session:${s.id}`}
                        showName={view.agentNames}
                        onToggle={() => toggleAgent(s.id)}
                        onReview={(r) => onReview(s.id, r)}
                        onChecklist={(item, done) => onChecklist(s.id, item, done)}
                        onHide={() => hideAgent(s.id)}
                        onPopover={hideHover}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      <HoverCard state={hover} onEnter={keepHover} onLeave={hideHover} />
    </>
  )
}
