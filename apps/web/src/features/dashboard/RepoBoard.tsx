import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Cloud, Folder, GitBranch, GitFork, Inbox } from 'lucide-react'
import {
  type AgentSession,
  type AnnotationSummary,
  type CommitGraph,
  type PullRequest,
  type Repository,
  type ReviewState,
  type SessionActivity,
  WORKFLOW_LABELS,
  WORKFLOW_TONES,
  workflowStatus,
} from '@repobs/contracts'
import { pageZoom } from '../../components/placement'
import { Badge, formatAge } from '../../components/primitives'
import { AgentLine, HatchDef } from './ActivityTrack'
import { AgentRow } from './AgentRow'
import { AGENT_HOVER_DELAY, AgentHover, BranchHover, CommitHover, GroupHover, PendingHover, type HoverOptions, type ShowHover } from './HoverCard'
import type { BoardRow, BranchRow, RepoLayout, SessionRow } from './layout'
import { type ChecklistEntry, checklistEntries, PLAN_SOURCE_LABELS } from './checklistEntries'
import { ChecklistPill } from './ChecklistPill'
import { ReviewMenu } from './ReviewMenu'
import { type RouteInput, routeEdges } from './routing'
import { PAD, type Timeline } from './timeline'
import styles from './board.module.css'

// One repository: a sticky label column (branches and one-line agents) and lanes drawn as one SVG
// on the shared axis, with a card per agent at the end of its activity. Row positions are measured
// and shared by the lanes and the cards.

export const LABEL_W = 360
/** Label column width when agent names are shown on the timeline only. */
export const LABEL_W_NARROW = 230

interface Geometry {
  rows: Record<string, { top: number; height: number }>
  height: number
}

export interface RepoBoardProps {
  repo: Repository
  layout: RepoLayout
  graph?: CommitGraph
  pullRequests: PullRequest[]
  timeline: Timeline
  /** Width of the label column (px). */
  labelWidth: number
  /** Agent names in the label column. */
  agentNames: boolean
  /** Agent cards at the end of their activity bars. */
  barLabels: boolean
  /** Steps and tokens of the drawn agents, as they arrive (ADR 0013). */
  activity: Map<string, SessionActivity>
  /** Draw activity in detail (taller agent rows) instead of tool ticks. */
  activityDetail: boolean
  /** Agent lines as tall as the context was full (ADR 0013). */
  contextHeight: boolean
  viewportWidth: number
  now: number
  collapsed: boolean
  selectedId?: string
  tabbableId?: string
  shownAgents: number
  totalAgents: number
  attention: number
  sessionsById: Map<string, AgentSession>
  childCount: Map<string, number>
  annotations: Map<string, AnnotationSummary>
  showHover: ShowHover
  hideHover: () => void
  onToggleCollapsed: () => void
  onSelect: (id: string) => void
  onReview: (sessionId: string, review: ReviewState) => void
  /** Resolves to whether the change was saved. */
  onChecklist: (sessionId: string, entry: ChecklistEntry, done: boolean) => Promise<boolean>
  /** Hides an agent from this view. */
  onHide: (sessionId: string) => void
  onExpandBranch: (branchRowId: string) => void
  onToggleAgent: (sessionId: string) => void
  onExpandGroup: (groupId: string) => void
}

export const RepoBoard = memo(function RepoBoard(props: RepoBoardProps) {
  const { repo, layout, timeline, collapsed } = props
  const rowsRef = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geometry>({ rows: {}, height: 0 })

  const measure = useCallback(() => {
    const el = rowsRef.current
    if (!el) return
    const rows: Geometry['rows'] = {}
    for (const node of el.querySelectorAll<HTMLElement>('[data-row-id]')) rows[node.dataset.rowId!] = { top: node.offsetTop, height: node.offsetHeight }
    const next = { rows, height: el.scrollHeight }
    setGeo((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [])
  useLayoutEffect(() => measure(), [measure, layout, collapsed, props.activityDetail])
  useLayoutEffect(() => {
    const el = rowsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, collapsed])

  const total = props.labelWidth + timeline.width
  return (
    <section className={styles.repo} aria-label={`${repo.displayName} repository`} id={`repo-${repo.id}`} style={{ width: total }}>
      <header className={styles.repoHeader}>
        <div className={styles.repoHeaderInner} style={{ width: Math.min(total, props.viewportWidth) }}>
          <button type="button" className={styles.collapse} onClick={props.onToggleCollapsed} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${repo.displayName}`}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <h2 className={styles.repoName}>{repo.displayName}</h2>
          {repo.kind === 'folder' ? <Badge tone="neutral">folder</Badge> : null}
          <span className={`mono small muted ${styles.repoPath}`} title={repo.commonGitDir ?? repo.primaryPath}>
            {repo.primaryPath}
          </span>
          <span className={styles.spacer} />
          {repo.gitDetected ? (
            <span title="Git now reports this folder as inside a repository. Add the repository; then remove this folder entry.">
              <Badge tone="info">now a Git repository</Badge>
            </span>
          ) : null}
          {repo.scanState === 'error' ? <Badge tone="danger">scan error: {repo.error?.message}</Badge> : null}
          {props.graph?.error ? <Badge tone="warning">commit graph unavailable</Badge> : null}
          {props.graph?.truncated ? <span className="small muted">latest {props.graph.commits.length} commits</span> : null}
          {props.attention ? <Badge tone="warning">{props.attention} need attention</Badge> : null}
          <span className="small muted">{props.shownAgents === props.totalAgents ? `${props.totalAgents} agents` : `${props.shownAgents} of ${props.totalAgents} agents`}</span>
        </div>
      </header>
      {collapsed ? null : (
        <div className={styles.rows} ref={rowsRef} role="list" aria-label={`Branches and agents of ${repo.displayName}`}>
          {layout.rows.map((row) => (
            <Row key={row.id} row={row} {...props} />
          ))}
          {layout.rows.length === 0 ? <p className={`${styles.emptyRow} small muted`}>No branches or agents match the current filters.</p> : null}
          <svg
            className={styles.overlay}
            style={{ left: props.labelWidth }}
            width={timeline.width}
            height={geo.height}
            aria-hidden="true"
            data-lanes=""
            onClick={(e) => {
              // Nodes and bars take pointer events (for hover cards); a click on them selects their row.
              const y = (e.clientY - e.currentTarget.getBoundingClientRect().top) / pageZoom()
              const hit = Object.entries(geo.rows).find(([, r]) => y >= r.top && y < r.top + r.height)
              if (hit && !hit[0].startsWith('more:')) props.onSelect(hit[0])
            }}
          >
            <Overlay {...props} geo={geo} />
          </svg>
          {props.barLabels ? <BarCards {...props} geo={geo} /> : null}
        </div>
      )}
    </section>
  )
})

function Row(props: { row: BoardRow } & RepoBoardProps) {
  const { row, selectedId, tabbableId, onSelect, showHover, hideHover } = props
  const selected = selectedId === row.id
  const common = {
    'data-row-id': row.id,
    'data-nav-row': '',
    tabIndex: tabbableId === row.id ? 0 : -1,
    role: 'listitem',
    'aria-current': selected ? ('true' as const) : undefined,
    className: `${styles.row} ${styles[`row_${row.kind}`] ?? ''} ${selected ? styles.selected : ''}`,
  }
  if (row.kind === 'more') {
    return (
      <div {...common} aria-label={`Show ${row.hidden} more agents`} onClick={() => props.onExpandBranch(row.branchRowId)}>
        <div className={styles.label}>
          <span className={`small ${styles.more}`}>Show {row.hidden} more agents…</span>
        </div>
      </div>
    )
  }
  if (row.kind === 'branch') {
    return (
      <div {...common} aria-label={branchAriaLabel(row)} onClick={() => onSelect(row.id)}>
        <div className={styles.label} onMouseEnter={(e) => showHover(<BranchHover row={row} />, e)} onMouseLeave={hideHover}>
          <BranchLabel row={row} />
        </div>
      </div>
    )
  }
  const s = row.session
  // Opens beside the label column, so the pointer can move onto it (to change the review state)
  // without crossing other rows.
  const hover = (e: React.MouseEvent<HTMLElement>) => showHover(<AgentDetailsHover {...props} row={row} />, e, { interactive: true, label: 'Agent details', placement: 'right' })
  return (
    <div
      {...common}
      data-session-id={s.id}
      aria-label={`${row.annotation?.displayAlias || s.title}, ${s.provider === 'claude' ? 'Claude Code' : 'Codex'} agent`}
      aria-expanded={row.childCount ? row.expanded : undefined}
      onClick={() => onSelect(row.id)}
    >
      <div className={styles.label} onMouseEnter={hover} onMouseLeave={hideHover}>
        <AgentRow
          session={s}
          annotation={row.annotation}
          guides={row.guides}
          hasChildren={row.hasChildren}
          childCount={row.childCount}
          expanded={row.expanded}
          focusable={tabbableId === row.id}
          showName={props.agentNames}
          onToggle={() => props.onToggleAgent(s.id)}
          onReview={(r) => props.onReview(s.id, r)}
          onChecklist={(item, done) => props.onChecklist(s.id, item, done)}
          onHide={() => props.onHide(s.id)}
          onPopover={hideHover}
        />
      </div>
    </div>
  )
}

/** The agent details card with its review menu, the same from the label column and the timeline card. */
function AgentDetailsHover({ row, now, sessionsById, childCount, hideHover, onReview, onHide, activity }: { row: SessionRow } & RepoBoardProps) {
  const s = row.session
  return (
    <AgentHover
      session={s}
      activity={activity.get(s.id)}
      annotation={row.annotation}
      now={now}
      parentTitle={s.parentSessionId ? sessionsById.get(s.parentSessionId)?.title : undefined}
      children={childCount.get(s.id) ?? 0}
      onReview={(r) => {
        onReview(s.id, r)
        hideHover()
      }}
      onHide={() => {
        hideHover()
        onHide(s.id)
      }}
    />
  )
}

function BranchLabel({ row }: { row: BranchRow }) {
  const Icon = row.unassigned ? Inbox : row.folder ? Folder : row.remoteOnly ? Cloud : row.detached ? GitFork : GitBranch
  const up = row.branch?.upstream
  const op = row.worktrees.find((w) => w.status.gitOperation)?.status.gitOperation
  return (
    <div className={styles.branchLabel}>
      <Icon size={13} aria-hidden="true" className={styles.branchIcon} />
      <span className={`mono ${styles.branchName}`}>{row.label}</span>
      {row.forkedFrom ? <span className={styles.relation}>from {row.forkedFrom}</span> : null}
      {row.pointsAt ? <span className={styles.relation}>at {row.pointsAt}</span> : null}
      {row.mergedInto.length ? <span className={styles.relation}>→ {row.mergedInto.join(', ')}</span> : null}
      <span className={styles.spacer} />
      {op ? <Badge tone="warning">{op.replace('_', '-')}</Badge> : null}
      {row.worktrees.some((w) => w.missing) ? <Badge tone="danger">missing</Badge> : null}
      {up?.gone ? <Badge tone="warning">gone</Badge> : null}
      {up && !up.gone && (up.ahead || up.behind) ? (
        <span className="mono small muted">
          {up.ahead ? `↑${up.ahead}` : ''}
          {up.behind ? `↓${up.behind}` : ''}
        </span>
      ) : null}
      {row.branch?.kind === 'local' && !up ? <span className={styles.dim}>local</span> : null}
      {row.folder ? <span className={styles.dim}>no Git</span> : null}
      {row.remoteOnly ? <span className={styles.dim}>remote</span> : null}
    </div>
  )
}

function branchAriaLabel(row: BranchRow): string {
  const kind = row.unassigned ? 'group' : row.folder ? 'without Git' : row.remoteOnly ? 'remote branch' : row.detached ? 'detached worktree' : 'branch'
  const pending = row.pendingChanges ? `, ${row.pendingChanges} uncommitted changes` : ''
  const rel = row.forkedFrom ? `, branched from ${row.forkedFrom}` : row.pointsAt ? `, at ${row.pointsAt}` : ''
  return `${row.label} ${kind}${pending}${rel}`
}

function Overlay(props: RepoBoardProps & { geo: Geometry }) {
  const { layout, geo, timeline, now, annotations, showHover, hideHover } = props
  if (!timeline.width) return null
  const center = (id: string) => {
    const r = geo.rows[id]
    if (!r) return undefined
    return r.top + (id.startsWith('session:') ? 13 : 14)
  }
  const hoverProps = (content: () => React.ReactNode, options?: HoverOptions) => ({
    onMouseEnter: (e: React.MouseEvent) => showHover(content(), e, options),
    onMouseLeave: hideHover,
  })
  const els: React.ReactNode[] = []
  // Tests and builds are hatched (a pattern per board: ids are document-wide).
  const hatchId = `hatch-${props.repo.id.replace(/[^\w-]/g, '_')}`
  if (props.activityDetail) els.push(<HatchDef key="hatch" id={hatchId} />)
  const branchRows = layout.rows.filter((r): r is BranchRow => r.kind === 'branch')

  for (const row of branchRows) {
    const y = center(row.id)
    if (y !== undefined) els.push(<line key={`base-${row.id}`} x1={PAD / 2} x2={timeline.width - PAD / 2} y1={y} y2={y} className={styles.baseline} />)
  }
  els.push(<line key="now" x1={timeline.nowX} x2={timeline.nowX} y1={0} y2={geo.height} className={styles.nowLine} />)

  // Edges first (under the nodes): straight along a row; between rows, orthogonal with rounded
  // corners — a fork drops from its base commit and runs to the branch, a merge runs along its
  // branch and turns into the merge commit. Parents off the axis enter from the left edge. Legs
  // that would overlap get parallel tracks (routing.ts); pointers of branches without commits of
  // their own are routed with them.
  const groupsById = new Map(layout.groups.map((g) => [g.id, g]))
  const rowOf = (key: string) => layout.commits.get(key)?.rowId ?? groupsById.get(key)?.rowId
  const routes: RouteInput[] = []
  const edgeClass = new Map<string, string>()
  for (const e of layout.edges) {
    const fromRow = rowOf(e.from)
    const toRow = rowOf(e.to)
    const x2 = timeline.commitX(e.to)
    const y1 = fromRow ? center(fromRow) : undefined
    const y2 = toRow ? center(toRow) : undefined
    if (x2 === undefined || y1 === undefined || y2 === undefined) continue
    const x1 = timeline.commitX(e.from) ?? PAD / 2
    const key = `e-${e.from}-${e.to}`
    routes.push({ key, x1, y1, x2, y2, order: e.kind === 'lane' ? 'lane' : e.kind === 'merge' ? 'hv' : 'vh' })
    const incoming = layout.commits.get(e.to)?.incoming
    edgeClass.set(key, `${styles.edge} ${e.kind !== 'lane' ? styles.edgeCross : ''} ${e.localOnly ? styles.edgeLocal : ''} ${incoming ? styles.edgeIncoming : ''}`)
  }
  const heads = new Map(branchRows.filter((r) => r.headOid).map((r) => [r.headOid!, r]))
  const pointers: Array<{ row: BranchRow; x: number; y: number }> = []
  for (const row of branchRows) {
    const y = center(row.id)
    const hx = row.headOid ? timeline.commitX(row.headOid) : undefined
    const owner = row.headOid ? layout.commits.get(row.headOid) : undefined
    const oy = owner && owner.rowId !== row.id ? center(owner.rowId) : undefined
    if (y === undefined || hx === undefined || oy === undefined) continue
    // No commits of its own: connect the branch row to the commit it points at on another row.
    routes.push({ key: `ptr-${row.id}`, x1: hx, y1: oy, x2: hx + 24, y2: y, order: 'vh' })
    pointers.push({ row, x: hx + 28, y })
  }
  const paths = routeEdges(routes)
  for (const r of routes) {
    if (r.key.startsWith('ptr-')) continue
    els.push(<path key={r.key} d={paths.get(r.key)} className={edgeClass.get(r.key)} fill="none" />)
  }
  for (const p of pointers) {
    els.push(
      <g key={`ptr-${p.row.id}`} {...hoverProps(() => <BranchHover row={p.row} />)}>
        <path d={paths.get(`ptr-${p.row.id}`)} className={`${styles.edge} ${styles.edgePointer}`} fill="none" />
        <circle cx={p.x} cy={p.y} r={10} className={styles.hit} />
        <circle cx={p.x} cy={p.y} r={4} className={styles.pointer} />
      </g>,
    )
  }

  // Collapsed runs of quiet commits: one pill each; hover lists the commits, click expands.
  for (const g of layout.groups) {
    const x = timeline.commitX(g.id)
    const y = center(g.rowId)
    if (x === undefined || y === undefined) continue
    const x0 = timeline.mode === 'time' ? Math.min(x, timeline.x(g.start)) : x
    const left = Math.min(x0, x - 13)
    const width = Math.max(26, x - x0 + 26)
    const branch = branchRows.find((r) => r.id === g.rowId)
    const unpushed = g.commits.some((c) => !c.pushed)
    els.push(
      <g
        key={`g-${g.id}`}
        className={styles.group}
        onMouseEnter={(ev) => showHover(<GroupHover group={g} branch={branch?.label} onExpand={() => props.onExpandGroup(g.id)} />, ev, { interactive: true, label: 'Commit details' })}
        onMouseLeave={hideHover}
        onClick={(ev) => {
          ev.stopPropagation()
          hideHover()
          props.onExpandGroup(g.id)
        }}
      >
        <rect x={left - 2} y={y - 10} width={width + 4} height={20} className={styles.hit} />
        <rect x={left} y={y - 7} width={width} height={14} rx={7} className={`${styles.groupPill} ${unpushed ? styles.groupLocal : ''}`} />
        <text x={left + width / 2} y={y + 3.5} textAnchor="middle" className={styles.groupCount}>
          {g.commits.length}
        </text>
      </g>,
    )
  }

  // Commit nodes, with a larger invisible target for hovering.
  for (const { commit, rowId, incoming } of layout.commits.values()) {
    if (layout.groupOf.has(commit.oid)) continue
    const x = timeline.commitX(commit.oid)
    const y = center(rowId)
    if (x === undefined || y === undefined) continue
    const head = heads.get(commit.oid)
    const branch = branchRows.find((r) => r.id === rowId)
    const prs = head?.branch ? props.pullRequests.filter((p) => p.headRef === head.branch!.shortName || head.branch!.upstream?.fullRef.endsWith(`/${p.headRef}`)) : []
    els.push(
      <g key={`c-${commit.oid}`} {...hoverProps(() => <CommitHover commit={commit} branch={branch?.label} incoming={incoming} isHead={!!head} pullRequests={prs} />)}>
        <circle cx={x} cy={y} r={10} className={styles.hit} />
        <circle cx={x} cy={y} r={head ? 5.5 : 4} className={`${styles.commit} ${commit.pushed ? styles.pushed : styles.local} ${incoming ? styles.incoming : ''}`} />
        {prs.length ? <rect x={x - 3} y={y - 14} width={6} height={6} className={styles.prMark} /> : null}
      </g>,
    )
  }

  // Head labels and uncommitted-change markers.
  for (const row of branchRows) {
    const y = center(row.id)
    if (y === undefined) continue
    const hx = row.headOid ? timeline.commitX(row.headOid) : undefined
    const owner = row.headOid ? layout.commits.get(row.headOid) : undefined
    if (hx !== undefined) {
      els.push(
        <text
          key={`h-${row.id}`}
          x={Math.min(hx + (owner && owner.rowId !== row.id ? 36 : 8), timeline.width - 80)}
          y={owner && owner.rowId !== row.id ? y + 4 : y - 7}
          className={styles.headLabel}
          {...hoverProps(() => <BranchHover row={row} />)}
        >
          {row.label}
        </text>,
      )
    }
    if (row.pendingChanges > 0) {
      const from = hx ?? PAD / 2
      const px = Math.max(from + 18, timeline.nowX)
      els.push(
        <g key={`p-${row.id}`} {...hoverProps(() => <PendingHover row={row} />)}>
          <line x1={from} x2={px} y1={y} y2={y} className={`${styles.edge} ${styles.edgePending}`} />
          <circle cx={px} cy={y} r={10} className={styles.hit} />
          <rect x={px - 5} y={y - 5} width={10} height={10} transform={`rotate(45 ${px} ${y})`} className={`${styles.pending} ${row.conflicted ? styles.pendingConflict : ''}`} />
        </g>,
      )
    }
  }

  // Agent bars (first to last activity) and spawn connectors.
  const barStart = new Map<string, number>()
  for (const row of layout.rows) {
    if (row.kind !== 'session') continue
    const y = center(row.id)
    const s = row.session
    const span = barSpan(s, timeline)
    if (y === undefined || !span) continue
    const { x1, x2 } = span
    barStart.set(row.id, x1)
    const status = workflowStatus(s, annotations.get(s.id))
    const tone = WORKFLOW_TONES[status]
    const act = props.activity.get(s.id)
    // Agents in the lanes open their card after a pause, so the pointer can cross them.
    const hover = hoverProps(
      () => (
        <AgentHover session={s} annotation={row.annotation} activity={act} now={now} children={props.childCount.get(s.id) ?? 0} parentTitle={s.parentSessionId ? props.sessionsById.get(s.parentSessionId)?.title : undefined} />
      ),
      { delay: AGENT_HOVER_DELAY },
    )
    // By context: up to the row's height, less a margin above and below.
    const r = geo.rows[row.id]!
    if (span.before) {
      // Active only before the axis starts: a mark at its left edge; the card says when.
      els.push(
        <g key={`b-${row.id}`} {...hover}>
          <rect x={x1 - 4} y={y - 8} width={x2 - x1 + 8} height={16} className={styles.hit} />
          <path d={`M${x1},${y} L${x1 + 6},${y - 4} L${x1 + 6},${y + 4} Z`} className={`${styles.bar} ${styles[`bar_${tone}`]}`} />
          <line x1={x1 + 8} x2={x2} y1={y} y2={y} className={`${styles.bar} ${styles[`bar_${tone}`]} ${styles.idle}`} />
        </g>,
      )
      continue
    }
    const context = props.contextHeight ? { maxHalf: Math.max(3, Math.min(y - r.top, r.top + r.height - y) - 2), clipId: `ctx-${hatchId}-${row.id.replace(/[^\w-]/g, '_')}` } : undefined
    els.push(
      <g key={`b-${row.id}`} {...hover}>
        <rect x={x1} y={y - 8} width={x2 - x1} height={16} className={styles.hit} />
        <AgentLine
          activity={act}
          timeline={timeline}
          x1={x1}
          x2={x2}
          y={y}
          barClass={`${styles.bar} ${styles[`bar_${tone}`]}`}
          detail={props.activityDetail}
          hatchId={hatchId}
          {...(context ? { context } : {})}
        />
      </g>,
    )
  }
  for (const link of layout.spawnLinks) {
    const py = center(link.from)
    const cy = center(link.to)
    const cx = barStart.get(link.to) ?? barStart.get(link.from)
    if (py === undefined || cy === undefined || cx === undefined) continue
    els.push(<path key={`s-${link.to}`} d={`M${cx - 3},${py + 3} V${cy} H${cx}`} className={styles.spawnLink} fill="none" />)
  }
  return <>{els}</>
}

/**
 * Horizontal extent of an agent's activity bar: first to last activity, at least 4 px. An agent
 * active only before the axis starts (an earlier history range) gets a short span at the left edge,
 * marked `before`, so its row is never empty.
 */
function barSpan(s: AgentSession, timeline: Timeline): { x1: number; x2: number; before?: boolean } | undefined {
  const start = Date.parse(s.firstSeenAt ?? s.lastActivityAt ?? '')
  const end = Date.parse(s.lastActivityAt ?? s.firstSeenAt ?? '') || start
  if (!start) return undefined
  if (end < timeline.start) return { x1: PAD / 2, x2: PAD / 2 + 14, before: true }
  const x1 = timeline.x(start)
  return { x1, x2: Math.max(x1 + 4, timeline.x(end)) }
}

/**
 * A card at the end of each agent's work, like the one in the label column: provider, name, how
 * long ago it was active and its status, which opens the review menu. It sits after the bar, or
 * before it when it would run off the axis. HTML over the lanes, so the menu works as on the left.
 */
function BarCards(props: RepoBoardProps & { geo: Geometry }) {
  const { layout, geo, timeline } = props
  if (!timeline.width) return null
  const cards: React.ReactNode[] = []
  for (const row of layout.rows) {
    if (row.kind !== 'session') continue
    const r = geo.rows[row.id]
    const span = barSpan(row.session, timeline)
    if (!r || !span) continue
    cards.push(<BarCard key={row.id} {...props} row={row} top={r.top + 2} span={span} width={timeline.width} />)
  }
  return (
    <div className={styles.barCards} style={{ left: props.labelWidth, width: timeline.width, height: geo.height }} role="group" aria-label={`Agents on the timeline of ${props.repo.displayName}`}>
      {cards}
    </div>
  )
}

function BarCard(props: { row: SessionRow; top: number; span: { x1: number; x2: number }; width: number } & RepoBoardProps) {
  const { row, top, span, width, now, selectedId, onSelect, onReview, onChecklist, onHide, showHover, hideHover } = props
  const s = row.session
  const status = workflowStatus(s, row.annotation)
  const title = row.annotation?.displayAlias || s.title
  const name = clip(title, 40)
  const entries = checklistEntries(s, row.annotation)
  const ageText = s.lastActivityAt ? formatAge(s.lastActivityAt, now) : ''
  const age = ageText ? (ageText === 'now' ? 'now' : `${ageText} ago`) : ''
  // Estimated width (the card is laid out by the browser; this only decides the side).
  const w = 54 + name.length * 7 + age.length * 6 + WORKFLOW_LABELS[status].length * 6.5 + (entries.length ? 52 : 0)
  const after = span.x2 + 8 + w <= width - 4
  const before = !after && span.x1 - 8 - w >= 4
  const place = after ? { left: span.x2 + 8 } : before ? { right: width - (span.x1 - 8) } : { right: 4 }
  return (
    <div
      className={`${styles.barCard} ${selectedId === row.id ? styles.barCardSelected : ''} ${s.historical ? styles.historical : ''}`}
      style={{ top, ...place }}
      data-bar-label={s.id}
      onClick={() => onSelect(row.id)}
      // The same agent details as the label column, below the card so the pointer can move onto it.
      onMouseEnter={(e) => showHover(<AgentDetailsHover {...props} />, e, { interactive: true, label: 'Agent details', delay: AGENT_HOVER_DELAY })}
      onMouseLeave={hideHover}
    >
      <span className={styles.providerMark} title={s.provider === 'claude' ? 'Claude Code' : 'Codex'}>
        {s.provider === 'claude' ? 'C' : 'X'}
      </span>
      <span className={styles.agentName} title={title}>
        {name}
      </span>
      {age ? <span className={styles.barCardAge}>{age}</span> : null}
      <ReviewMenu status={status} review={row.annotation?.review ?? 'unreviewed'} title={title} focusable={false} onReview={(r) => onReview(s.id, r)} onHide={() => onHide(s.id)} />
      {entries.length ? (
        <ChecklistPill
          entries={entries}
          planSource={s.plan ? PLAN_SOURCE_LABELS[s.plan.source] : undefined}
          title={title}
          focusable={false}
          onToggle={(entry, done) => onChecklist(s.id, entry, done)}
          onOpen={hideHover}
        />
      ) : null}
    </div>
  )
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
