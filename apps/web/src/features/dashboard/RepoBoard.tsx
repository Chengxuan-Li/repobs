import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Cloud, GitBranch, GitFork, Inbox } from 'lucide-react'
import {
  type AgentSession,
  type AnnotationSummary,
  type BranchRef,
  type CommitGraph,
  type Repository,
  type ReviewState,
  type Worktree,
  WORKFLOW_TONES,
  workflowStatus,
} from '@repobs/contracts'
import { Badge } from '../../components/primitives'
import { layoutRepository, type BoardRow, type BranchRow, type LayoutOptions } from './layout'
import { SessionCard } from './SessionCard'
import styles from './board.module.css'

// One repository on the dashboard: a Git-tree/Gantt hybrid. Left column: branch labels and agent
// cards. Right: an SVG timeline drawn from measured row positions, so rows can grow (details mode).

export const CARD_COLUMN = 420
const PAD = 14
const DAY = 86_400_000

export interface TimeDomain {
  start: number
  end: number
}

interface Geometry {
  rows: Record<string, { top: number; height: number }>
  width: number
  height: number
}

export interface RepoBoardProps {
  repo: Repository
  branches: BranchRef[]
  worktrees: Worktree[]
  sessions: AgentSession[]
  annotations: Map<string, AnnotationSummary>
  graph?: CommitGraph
  options: LayoutOptions
  domain: TimeDomain
  details: boolean
  now: number
  collapsed: boolean
  selectedId?: string
  tabbableId?: string
  totalSessions: number
  onToggleCollapsed: () => void
  onSelect: (id: string) => void
  onReview: (sessionId: string, review: ReviewState) => void
  onExpandBranch: (branchRowId: string) => void
}

export const RepoBoard = memo(function RepoBoard(props: RepoBoardProps) {
  const { repo, domain, details, now, collapsed } = props
  const layout = useMemo(
    () =>
      layoutRepository(
        repo,
        { branches: props.branches, worktrees: props.worktrees, sessions: props.sessions, annotations: props.annotations, graph: props.graph },
        props.options,
      ),
    [repo, props.branches, props.worktrees, props.sessions, props.annotations, props.graph, props.options],
  )
  const rowsRef = useRef<HTMLDivElement>(null)
  const [geo, setGeo] = useState<Geometry>({ rows: {}, width: 0, height: 0 })

  const measure = useCallback(() => {
    const el = rowsRef.current
    if (!el) return
    const rows: Geometry['rows'] = {}
    for (const node of el.querySelectorAll<HTMLElement>('[data-row-id]')) rows[node.dataset.rowId!] = { top: node.offsetTop, height: node.offsetHeight }
    const next = { rows, width: Math.max(0, el.clientWidth - CARD_COLUMN), height: el.scrollHeight }
    setGeo((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, layout, details, collapsed])

  useLayoutEffect(() => {
    const el = rowsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, collapsed])

  const x = (ms: number) => PAD + ((ms - domain.start) / Math.max(1, domain.end - domain.start)) * Math.max(1, geo.width - 2 * PAD)
  const sessionCount = props.sessions.length
  const attention = props.sessions.filter((s) => {
    const st = workflowStatus(s, props.annotations.get(s.id))
    return st === 'needs_input' || st === 'needs_review'
  }).length

  return (
    <section className={styles.repo} aria-label={`${repo.displayName} repository`} id={`repo-${repo.id}`}>
      <header className={styles.repoHeader}>
        <button type="button" className={styles.collapse} onClick={props.onToggleCollapsed} aria-expanded={!collapsed} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${repo.displayName}`}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        <h2 className={styles.repoName}>{repo.displayName}</h2>
        <span className="mono small muted" title={repo.commonGitDir}>
          {repo.primaryPath}
        </span>
        <span className={styles.spacer} />
        {repo.scanState === 'error' ? <Badge tone="danger">scan error: {repo.error?.message}</Badge> : null}
        {props.graph?.error ? <Badge tone="warning">commit graph unavailable</Badge> : null}
        {props.graph?.truncated ? (
          <span className="small muted" title="Only the most recent commits are drawn">
            latest {props.graph.commits.length} commits
          </span>
        ) : null}
        {attention ? <Badge tone="warning">{attention} need attention</Badge> : null}
        <span className="small muted">
          {sessionCount === props.totalSessions ? `${sessionCount} agents` : `${sessionCount} of ${props.totalSessions} agents`}
        </span>
      </header>
      {collapsed ? null : (
        <div className={styles.board}>
          <div className={styles.axis} aria-hidden="true">
            <div style={{ width: CARD_COLUMN }} />
            <svg width={geo.width} height={22}>
              {ticks(domain).map((t) => (
                <g key={t} transform={`translate(${x(t)},0)`}>
                  <line y1={16} y2={22} className={styles.tick} />
                  <text y={12} textAnchor="middle" className={styles.tickLabel}>
                    {tickLabel(t, domain)}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          <div className={styles.rows} ref={rowsRef} role="list" aria-label={`Branches and agents of ${repo.displayName}`}>
            {layout.rows.map((row) => (
              <Row key={row.id} row={row} {...props} />
            ))}
            {layout.rows.length === 0 ? <p className={`${styles.emptyRow} small muted`}>No branches or agents match the current filters.</p> : null}
            <svg
              className={styles.overlay}
              style={{ left: CARD_COLUMN }}
              width={geo.width}
              height={geo.height}
              aria-hidden="true"
              onClick={(e) => {
                // Nodes and bars take pointer events (for tooltips); a click on them selects their row.
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top
                const hit = Object.entries(geo.rows).find(([, r]) => y >= r.top && y < r.top + r.height)
                if (hit && !hit[0].startsWith('more:')) props.onSelect(hit[0])
              }}
            >
              <Overlay layout={layout} geo={geo} x={x} domain={domain} now={now} annotations={props.annotations} />
            </svg>
          </div>
        </div>
      )}
    </section>
  )
})

function Row({ row, selectedId, tabbableId, details, now, onSelect, onReview, onExpandBranch }: { row: BoardRow } & RepoBoardProps) {
  const selected = selectedId === row.id
  const common = {
    'data-row-id': row.id,
    'data-nav-row': '',
    tabIndex: tabbableId === row.id ? 0 : -1,
    className: `${styles.row} ${styles[`row_${row.kind}`] ?? ''} ${selected ? styles.selected : ''}`,
    'aria-current': selected ? ('true' as const) : undefined,
    role: 'listitem',
  }
  if (row.kind === 'more') {
    return (
      <div {...common} aria-label={`Show ${row.hidden} more agents`} onClick={() => onExpandBranch(row.branchRowId)} onKeyDown={(e) => e.key === 'Enter' && onExpandBranch(row.branchRowId)}>
        <button type="button" className={`btn btn-quiet ${styles.more}`} tabIndex={-1}>
          Show {row.hidden} more agents
        </button>
      </div>
    )
  }
  if (row.kind === 'branch') {
    return (
      <div {...common} aria-label={branchAriaLabel(row)} onClick={() => onSelect(row.id)}>
        <BranchLabel row={row} />
      </div>
    )
  }
  return (
    <div {...common} aria-label={`${row.annotation?.displayAlias || row.session.title}, ${row.session.provider === 'claude' ? 'Claude Code' : 'Codex'} agent`} onClick={() => onSelect(row.id)}>
      <SessionCard session={row.session} annotation={row.annotation} depth={row.depth} details={details} now={now} onReview={(r) => onReview(row.session.id, r)} />
    </div>
  )
}

function BranchLabel({ row }: { row: BranchRow }) {
  const Icon = row.unassigned ? Inbox : row.remoteOnly ? Cloud : row.detached ? GitFork : GitBranch
  const up = row.branch?.upstream
  return (
    <div className={styles.branchLabel}>
      <Icon size={13} aria-hidden="true" className={styles.branchIcon} />
      <span className={`mono ${styles.branchName}`} title={row.branch?.fullRef ?? row.worktrees[0]?.path}>
        {row.label}
      </span>
      {row.worktrees.length ? (
        <span className="small muted" title={row.worktrees.map((w) => w.path).join('\n')}>
          {row.worktrees.map((w) => w.displayName).join(', ')}
        </span>
      ) : null}
      <span className={styles.spacer} />
      {row.worktrees.some((w) => w.status.gitOperation) ? <Badge tone="warning">{row.worktrees.find((w) => w.status.gitOperation)!.status.gitOperation!.replace('_', '-')}</Badge> : null}
      {row.worktrees.some((w) => w.missing) ? <Badge tone="danger">missing</Badge> : null}
      {up?.gone ? <Badge tone="warning">upstream gone</Badge> : null}
      {up && !up.gone && (up.ahead || up.behind) ? (
        <span className="mono small muted" title="Ahead / behind the configured upstream (local refs; repobs never fetches)">
          {up.ahead ? `↑${up.ahead}` : ''}
          {up.behind ? `↓${up.behind}` : ''}
        </span>
      ) : null}
      {row.branch?.kind === 'local' && !up ? <span className={styles.dim}>local only</span> : null}
      {row.remoteOnly ? <span className={styles.dim}>remote only</span> : null}
    </div>
  )
}

function branchAriaLabel(row: BranchRow): string {
  const kind = row.unassigned ? 'group' : row.remoteOnly ? 'remote branch' : row.detached ? 'detached worktree' : 'branch'
  const pending = row.pendingChanges ? `, ${row.pendingChanges} uncommitted changes` : ''
  return `${row.label} ${kind}${pending}`
}

function Overlay({
  layout,
  geo,
  x,
  domain,
  now,
  annotations,
}: {
  layout: ReturnType<typeof layoutRepository>
  geo: Geometry
  x: (ms: number) => number
  domain: TimeDomain
  now: number
  annotations: Map<string, AnnotationSummary>
}) {
  if (!geo.width) return null
  const rowY = (id: string) => {
    const r = geo.rows[id]
    return r ? r.top + Math.min(r.height / 2, 15) : undefined
  }
  const cx = (time: number) => Math.max(PAD / 2, x(time * 1000))
  const visible = (time: number) => time * 1000 >= domain.start
  const elements: React.ReactNode[] = []

  // Lane baselines and the "now" line.
  for (const row of layout.rows) {
    if (row.kind !== 'branch') continue
    const y = rowY(row.id)
    if (y === undefined) continue
    elements.push(<line key={`base-${row.id}`} x1={PAD / 2} x2={geo.width - PAD / 2} y1={y} y2={y} className={styles.baseline} />)
  }
  elements.push(<line key="now" x1={x(now)} x2={x(now)} y1={0} y2={geo.height} className={styles.nowLine} />)

  // Edges between commits.
  for (const e of layout.edges) {
    const from = layout.commits.get(e.from)!
    const to = layout.commits.get(e.to)!
    if (!visible(to.commit.time)) continue
    const y1 = rowY(from.rowId)
    const y2 = rowY(to.rowId)
    if (y1 === undefined || y2 === undefined) continue
    const x1 = visible(from.commit.time) ? cx(from.commit.time) : PAD / 2
    const x2 = cx(to.commit.time)
    const cls = `${styles.edge} ${e.localOnly ? styles.edgeLocal : ''} ${to.incoming ? styles.edgeIncoming : ''}`
    if (y1 === y2) elements.push(<line key={`e-${e.from}-${e.to}`} x1={x1} x2={x2} y1={y1} y2={y2} className={cls} />)
    else {
      const mid = x1 + Math.max(8, (x2 - x1) / 2)
      elements.push(<path key={`e-${e.from}-${e.to}`} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} className={cls} fill="none" />)
    }
  }

  // Commit nodes and head labels.
  const heads = new Map(layout.rows.filter((r): r is BranchRow => r.kind === 'branch' && !!r.headOid).map((r) => [r.headOid!, r]))
  for (const { commit, rowId, incoming } of layout.commits.values()) {
    if (!visible(commit.time)) continue
    const y = rowY(rowId)
    if (y === undefined) continue
    const head = heads.get(commit.oid)
    elements.push(
      <circle
        key={`c-${commit.oid}`}
        cx={cx(commit.time)}
        cy={y}
        r={head ? 5 : 4}
        className={`${styles.commit} ${commit.pushed ? styles.pushed : styles.local} ${incoming ? styles.incoming : ''}`}
      >
        <title>{`${commit.oid.slice(0, 8)} ${commit.subject}\n${new Date(commit.time * 1000).toLocaleString()}${commit.pushed ? '' : incoming ? '\nOn the upstream only (not pulled)' : '\nLocal only (not on any remote-tracking ref)'}`}</title>
      </circle>,
    )
  }

  // Branch heads: name label, and a pending-changes node after dirty heads.
  for (const row of layout.rows) {
    if (row.kind !== 'branch') continue
    const y = rowY(row.id)
    if (y === undefined) continue
    const head = row.headOid ? layout.commits.get(row.headOid) : undefined
    const hx = head && visible(head.commit.time) ? cx(head.commit.time) : PAD / 2
    elements.push(
      <text key={`h-${row.id}`} x={Math.min(hx + 8, geo.width - 60)} y={y - 7} className={styles.headLabel}>
        {row.label}
      </text>,
    )
    if (row.pendingChanges > 0) {
      const px = Math.max(hx + 26, x(now) - 10)
      const tone = row.conflicted ? styles.pendingConflict : ''
      elements.push(
        <g key={`p-${row.id}`}>
          <line x1={hx} x2={px} y1={y} y2={y} className={`${styles.edge} ${styles.edgePending}`} />
          <rect x={px - 6} y={y - 6} width={12} height={12} transform={`rotate(45 ${px} ${y})`} className={`${styles.pending} ${tone}`}>
            <title>{`${row.pendingChanges} uncommitted change${row.pendingChanges > 1 ? 's' : ''}${row.conflicted ? ` (${row.conflicted} conflicted)` : ''}`}</title>
          </rect>
        </g>,
      )
    }
  }

  // Agent activity bars and spawn links.
  for (const row of layout.rows) {
    if (row.kind !== 'session') continue
    const r = geo.rows[row.id]
    if (!r) continue
    const s = row.session
    const start = Date.parse(s.firstSeenAt ?? s.lastActivityAt ?? '')
    const end = Date.parse(s.lastActivityAt ?? s.firstSeenAt ?? '')
    if (!start || end < domain.start) continue
    const y = r.top + 16
    const x1 = Math.max(PAD / 2, x(start))
    const x2 = Math.max(x1 + 4, x(end))
    const tone = WORKFLOW_TONES[workflowStatus(s, annotations.get(s.id))]
    elements.push(
      <rect key={`b-${row.id}`} x={x1} y={y - 3} width={x2 - x1} height={6} className={`${styles.bar} ${styles[`bar_${tone}`]}`}>
        <title>{`${s.title}\n${new Date(start).toLocaleString()} → ${new Date(end).toLocaleString()}`}</title>
      </rect>,
    )
  }
  for (const link of layout.spawnLinks) {
    const p = geo.rows[link.from]
    const c = geo.rows[link.to]
    const child = layout.rows.find((r) => r.id === link.to)
    if (!p || !c || child?.kind !== 'session') continue
    const cxStart = Math.max(PAD / 2, x(Date.parse(child.session.firstSeenAt ?? child.session.lastActivityAt ?? '') || domain.start))
    elements.push(<path key={`s-${link.to}`} d={`M${cxStart},${p.top + 19} V${c.top + 16} h4`} className={styles.spawnLink} fill="none" />)
  }
  return <>{elements}</>
}

function ticks(domain: TimeDomain): number[] {
  const span = domain.end - domain.start
  const step = span <= 2 * DAY ? 6 * 3_600_000 : span <= 10 * DAY ? DAY : span <= 45 * DAY ? 7 * DAY : 30 * DAY
  const first = Math.ceil(domain.start / step) * step
  const out: number[] = []
  for (let t = first; t <= domain.end && out.length < 16; t += step) out.push(t)
  return out
}

function tickLabel(t: number, domain: TimeDomain): string {
  const d = new Date(t)
  if (domain.end - domain.start <= 2 * DAY) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
