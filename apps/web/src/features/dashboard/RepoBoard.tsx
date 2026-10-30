import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Cloud, GitBranch, GitFork, Inbox } from 'lucide-react'
import {
  type AgentSession,
  type AnnotationSummary,
  type CommitGraph,
  type PullRequest,
  type Repository,
  type ReviewState,
  WORKFLOW_TONES,
  workflowStatus,
} from '@repobs/contracts'
import { Badge } from '../../components/primitives'
import { AgentRow } from './AgentRow'
import { AgentHover, BranchHover, CommitHover, PendingHover, type ShowHover } from './HoverCard'
import type { BoardRow, BranchRow, RepoLayout } from './layout'
import { PAD, type Timeline } from './timeline'
import styles from './board.module.css'

// One repository: a sticky label column (branches and one-line agents) and lanes drawn as one SVG
// on the shared axis. Row positions are measured, so expanded agents can be taller.

export const LABEL_W = 360

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
  viewportWidth: number
  expandAll: boolean
  expandedAgents: Set<string>
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
  onExpandBranch: (branchRowId: string) => void
  onToggleAgent: (sessionId: string) => void
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
  useLayoutEffect(() => measure(), [measure, layout, props.expandAll, props.expandedAgents, collapsed])
  useLayoutEffect(() => {
    const el = rowsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, collapsed])

  const total = LABEL_W + timeline.width
  return (
    <section className={styles.repo} aria-label={`${repo.displayName} repository`} id={`repo-${repo.id}`} style={{ width: total }}>
      <header className={styles.repoHeader}>
        <div className={styles.repoHeaderInner} style={{ width: Math.min(total, props.viewportWidth) }}>
          <button type="button" className={styles.collapse} onClick={props.onToggleCollapsed} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${repo.displayName}`}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <h2 className={styles.repoName}>{repo.displayName}</h2>
          <span className={`mono small muted ${styles.repoPath}`} title={repo.commonGitDir}>
            {repo.primaryPath}
          </span>
          <span className={styles.spacer} />
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
            style={{ left: LABEL_W }}
            width={timeline.width}
            height={geo.height}
            aria-hidden="true"
            onClick={(e) => {
              // Nodes and bars take pointer events (for hover cards); a click on them selects their row.
              const y = e.clientY - e.currentTarget.getBoundingClientRect().top
              const hit = Object.entries(geo.rows).find(([, r]) => y >= r.top && y < r.top + r.height)
              if (hit && !hit[0].startsWith('more:')) props.onSelect(hit[0])
            }}
          >
            <Overlay {...props} geo={geo} />
          </svg>
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
  const expanded = props.expandAll || props.expandedAgents.has(s.id)
  const parent = s.parentSessionId ? props.sessionsById.get(s.parentSessionId) : undefined
  const hover = (e: React.MouseEvent) =>
    showHover(<AgentHover session={s} annotation={row.annotation} now={props.now} parentTitle={parent?.title} children={props.childCount.get(s.id) ?? 0} />, e)
  return (
    <div
      {...common}
      data-session-id={s.id}
      aria-label={`${row.annotation?.displayAlias || s.title}, ${s.provider === 'claude' ? 'Claude Code' : 'Codex'} agent`}
      aria-expanded={expanded}
      onClick={() => onSelect(row.id)}
    >
      <div className={styles.label} onMouseEnter={hover} onMouseMove={hover} onMouseLeave={hideHover}>
        <AgentRow
          session={s}
          annotation={row.annotation}
          depth={row.depth}
          expanded={expanded}
          now={props.now}
          onToggle={() => props.onToggleAgent(s.id)}
          onReview={(r) => props.onReview(s.id, r)}
        />
      </div>
    </div>
  )
}

function BranchLabel({ row }: { row: BranchRow }) {
  const Icon = row.unassigned ? Inbox : row.remoteOnly ? Cloud : row.detached ? GitFork : GitBranch
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
      {row.remoteOnly ? <span className={styles.dim}>remote</span> : null}
    </div>
  )
}

function branchAriaLabel(row: BranchRow): string {
  const kind = row.unassigned ? 'group' : row.remoteOnly ? 'remote branch' : row.detached ? 'detached worktree' : 'branch'
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
    return r.top + (id.startsWith('session:') ? 12 : 14)
  }
  const hoverProps = (content: () => React.ReactNode) => ({
    onMouseEnter: (e: React.MouseEvent) => showHover(content(), e),
    onMouseMove: (e: React.MouseEvent) => showHover(content(), e),
    onMouseLeave: hideHover,
  })
  const els: React.ReactNode[] = []
  const branchRows = layout.rows.filter((r): r is BranchRow => r.kind === 'branch')

  for (const row of branchRows) {
    const y = center(row.id)
    if (y !== undefined) els.push(<line key={`base-${row.id}`} x1={PAD / 2} x2={timeline.width - PAD / 2} y1={y} y2={y} className={styles.baseline} />)
  }
  els.push(<line key="now" x1={timeline.nowX} x2={timeline.nowX} y1={0} y2={geo.height} className={styles.nowLine} />)

  // Edges first (under the nodes). Parents off the axis enter from the left edge.
  for (const e of layout.edges) {
    const to = layout.commits.get(e.to)!
    const from = layout.commits.get(e.from)!
    const x2 = timeline.commitX(e.to)
    const y1 = center(from.rowId)
    const y2 = center(to.rowId)
    if (x2 === undefined || y1 === undefined || y2 === undefined) continue
    const x1 = timeline.commitX(e.from) ?? PAD / 2
    const cls = `${styles.edge} ${e.kind !== 'lane' ? styles.edgeCross : ''} ${e.localOnly ? styles.edgeLocal : ''} ${to.incoming ? styles.edgeIncoming : ''}`
    if (y1 === y2) els.push(<line key={`e-${e.from}-${e.to}`} x1={x1} x2={x2} y1={y1} y2={y2} className={cls} />)
    else {
      const bend = Math.min(Math.max((x2 - x1) * 0.5, 10), 60)
      els.push(<path key={`e-${e.from}-${e.to}`} d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`} className={cls} fill="none" />)
    }
  }

  // Commit nodes, with a larger invisible target for hovering.
  const heads = new Map(branchRows.filter((r) => r.headOid).map((r) => [r.headOid!, r]))
  for (const { commit, rowId, incoming } of layout.commits.values()) {
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
    if (hx !== undefined && owner && owner.rowId !== row.id) {
      // No commits of its own: connect the branch row to the commit it points at on another row.
      const oy = center(owner.rowId)
      if (oy !== undefined) {
        els.push(
          <g key={`ptr-${row.id}`} {...hoverProps(() => <BranchHover row={row} />)}>
            <path d={`M${hx},${oy} C${hx + 14},${oy} ${hx + 14},${y} ${hx + 24},${y}`} className={`${styles.edge} ${styles.edgePointer}`} fill="none" />
            <circle cx={hx + 28} cy={y} r={10} className={styles.hit} />
            <circle cx={hx + 28} cy={y} r={4} className={styles.pointer} />
          </g>,
        )
      }
    }
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
    const start = Date.parse(s.firstSeenAt ?? s.lastActivityAt ?? '')
    const end = Date.parse(s.lastActivityAt ?? s.firstSeenAt ?? '') || start
    if (y === undefined || !start || end < timeline.start) continue
    const x1 = timeline.x(start)
    const x2 = Math.max(x1 + 4, timeline.x(end))
    barStart.set(row.id, x1)
    const tone = WORKFLOW_TONES[workflowStatus(s, annotations.get(s.id))]
    els.push(
      <g key={`b-${row.id}`} {...hoverProps(() => <AgentHover session={s} annotation={row.annotation} now={now} children={props.childCount.get(s.id) ?? 0} parentTitle={s.parentSessionId ? props.sessionsById.get(s.parentSessionId)?.title : undefined} />)}>
        <rect x={x1} y={y - 7} width={x2 - x1} height={14} className={styles.hit} />
        <rect x={x1} y={y - 3} width={x2 - x1} height={6} className={`${styles.bar} ${styles[`bar_${tone}`]}`} />
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
