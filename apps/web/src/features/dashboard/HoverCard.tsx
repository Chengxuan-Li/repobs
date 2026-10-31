import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { CommitGroup } from './layout'
import {
  type AgentSession,
  type AnnotationSummary,
  type CommitNode,
  CONFIDENCE_LABELS,
  DETAIL_LABELS,
  type PullRequest,
  REVIEW_LABELS,
  type ReviewState,
  stateLabel,
  WORKFLOW_LABELS,
  WORKFLOW_TONES,
  workflowStatus,
} from '@repobs/contracts'
import { Badge, formatAge } from '../../components/primitives'
import type { BranchRow } from './layout'
import { ReviewMenu } from './ReviewMenu'
import styles from './hover.module.css'

// Floating detail card shown while hovering graph nodes, agent rows, bars and branch labels.
// Everything here is also reachable without a mouse through the details panel.

export interface HoverState {
  content: ReactNode
  x: number
  y: number
  /** The pointer may move onto the card (lists you can hover or click, the review menu). */
  interactive?: boolean
  /** Accessible name of an interactive card. */
  label?: string
}

export type ShowHover = (content: ReactNode, e: { clientX: number; clientY: number }, options?: { interactive?: boolean; label?: string }) => void

export function HoverCard({ state, onEnter, onLeave }: { state?: HoverState; onEnter: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!state || !ref.current) return
    const { offsetWidth: w, offsetHeight: h } = ref.current
    // Interactive cards open right next to the pointer so it can move onto them.
    const gap = state.interactive ? 6 : 16
    const left = state.x + gap + w > window.innerWidth ? Math.max(8, state.x - gap - w) : state.x + gap
    const top = state.y + gap + h > window.innerHeight ? Math.max(8, state.y - gap - h) : state.y + gap
    setPos({ left, top })
  }, [state])
  if (!state) return null
  return (
    <div
      ref={ref}
      className={`${styles.card} ${state.interactive ? styles.interactive : ''}`}
      style={pos}
      role={state.interactive ? 'dialog' : 'tooltip'}
      aria-label={state.interactive ? (state.label ?? 'Details') : undefined}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {state.content}
    </div>
  )
}

export function CommitHover({ commit, branch, incoming, isHead, pullRequests }: { commit: CommitNode; branch?: string; incoming: boolean; isHead: boolean; pullRequests: PullRequest[] }) {
  const d = new Date(commit.time * 1000)
  return (
    <>
      <div className={styles.title}>{commit.subject || '(no subject)'}</div>
      <dl className={styles.facts}>
        <dt>Commit</dt>
        <dd className="mono">{commit.oid.slice(0, 12)}</dd>
        <dt>Date</dt>
        <dd>{d.toLocaleString()}</dd>
        {branch ? (
          <>
            <dt>Branch</dt>
            <dd className="mono">
              {branch}
              {isHead ? ' (head)' : ''}
            </dd>
          </>
        ) : null}
        <dt>Remote</dt>
        <dd>{commit.pushed ? 'On a remote-tracking ref (pushed)' : incoming ? 'On the upstream, not pulled' : 'Local only — not pushed'}</dd>
        {commit.parents.length > 1 ? (
          <>
            <dt>Merge</dt>
            <dd>{commit.parents.length} parents</dd>
          </>
        ) : null}
      </dl>
      {pullRequests.map((p) => (
        <div key={p.id} className="small">
          PR #{p.number} → {p.baseRef}: {p.title}
        </div>
      ))}
    </>
  )
}

export function AgentHover({
  session,
  annotation,
  now,
  parentTitle,
  children,
  onReview,
}: {
  session: AgentSession
  annotation?: AnnotationSummary
  now: number
  parentTitle?: string
  children: number
  /** Show the status as the review menu (interactive cards only). */
  onReview?: (review: ReviewState) => void
}) {
  const status = workflowStatus(session, annotation)
  const total = (annotation?.checklistOpen ?? 0) + (annotation?.checklistDone ?? 0)
  const title = annotation?.displayAlias || session.title
  return (
    <>
      <div className={styles.title}>{title}</div>
      <div className={styles.row}>
        {onReview ? (
          <ReviewMenu status={status} review={annotation?.review ?? 'unreviewed'} title={title} onReview={onReview} />
        ) : (
          <Badge tone={WORKFLOW_TONES[status]}>{WORKFLOW_LABELS[status]}</Badge>
        )}
        <span className="small">{stateLabel(session.state)}</span>
        <span className="small muted">({CONFIDENCE_LABELS[session.state.confidence].toLowerCase()})</span>
      </div>
      <dl className={styles.facts}>
        <dt>Agent</dt>
        <dd>
          {session.provider === 'claude' ? 'Claude Code' : 'Codex'}
          {session.agentType ? ` · ${session.agentType}` : ''}
          {annotation?.displayAlias ? ` · “${session.title}”` : ''}
        </dd>
        {parentTitle ? (
          <>
            <dt>Spawned by</dt>
            <dd>{parentTitle}</dd>
          </>
        ) : null}
        {children ? (
          <>
            <dt>Spawned</dt>
            <dd>{children} agents</dd>
          </>
        ) : null}
        <dt>Last activity</dt>
        <dd>
          {formatAge(session.lastActivityAt, now)} ago{session.lastActivityAt ? ` · ${new Date(session.lastActivityAt).toLocaleString()}` : ''}
        </dd>
        {session.state.detail ? (
          <>
            <dt>Why</dt>
            <dd>{DETAIL_LABELS[session.state.detail]}</dd>
          </>
        ) : null}
        <dt>Review</dt>
        <dd>{REVIEW_LABELS[annotation?.review ?? 'unreviewed']}</dd>
        {total ? (
          <>
            <dt>Checklist</dt>
            <dd>
              {annotation!.checklistDone}/{total} done
            </dd>
          </>
        ) : null}
      </dl>
      {session.lastMessage ? (
        <p className={styles.excerpt}>
          <span className={styles.kind}>{session.lastMessage.kind === 'tool' ? 'Tool' : 'Agent'}</span> {session.lastMessage.text}
        </p>
      ) : null}
      {annotation?.tags.length ? (
        <div className={styles.row}>
          {annotation.tags.map((t) => (
            <span key={t} className={styles.tag}>
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {annotation?.note ? <p className={styles.note}>{annotation.note}</p> : null}
    </>
  )
}

export function BranchHover({ row }: { row: BranchRow }) {
  const up = row.branch?.upstream
  return (
    <>
      <div className={`${styles.title} mono`}>{row.label}</div>
      <dl className={styles.facts}>
        {row.branch ? (
          <>
            <dt>Ref</dt>
            <dd className="mono">{row.branch.fullRef}</dd>
          </>
        ) : null}
        {row.forkedFrom ? (
          <>
            <dt>Branched from</dt>
            <dd className="mono">{row.forkedFrom}</dd>
          </>
        ) : null}
        {row.pointsAt ? (
          <>
            <dt>Points at</dt>
            <dd>a commit on <span className="mono">{row.pointsAt}</span> (no commits of its own)</dd>
          </>
        ) : null}
        {row.mergedInto.length ? (
          <>
            <dt>Merged into</dt>
            <dd className="mono">{row.mergedInto.join(', ')}</dd>
          </>
        ) : null}
        <dt>Upstream</dt>
        <dd className="mono">
          {up ? `${up.fullRef.replace('refs/remotes/', '')}${up.gone ? ' (gone)' : ` ↑${up.ahead ?? 0} ↓${up.behind ?? 0}`}` : row.remoteOnly ? '—' : 'none (local only)'}
        </dd>
        {row.worktrees.map((w) => (
          <div key={w.id} style={{ display: 'contents' }}>
            <dt>Worktree</dt>
            <dd className="mono">{w.path}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

export function PendingHover({ row }: { row: BranchRow }) {
  const totals = row.worktrees.reduce(
    (t, w) => ({ staged: t.staged + w.status.staged, unstaged: t.unstaged + w.status.unstaged, untracked: t.untracked + w.status.untracked, conflicted: t.conflicted + w.status.conflicted }),
    { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  )
  return (
    <>
      <div className={styles.title}>Uncommitted changes on {row.label}</div>
      <div className="small">
        {totals.staged} staged · {totals.unstaged} unstaged · {totals.untracked} untracked{totals.conflicted ? ` · ${totals.conflicted} conflicted` : ''}
      </div>
    </>
  )
}

/** Collapsed run of quiet commits: a list you can hover for details, and a way to expand it. */
export function GroupHover({ group, branch, onExpand }: { group: CommitGroup; branch?: string; onExpand: () => void }) {
  const newestFirst = [...group.commits].reverse()
  const [active, setActive] = useState<CommitNode>()
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <>
      <div className={styles.title}>
        {group.commits.length} quiet commits{branch ? <> on <span className="mono">{branch}</span></> : null}
      </div>
      <div className="small muted">
        {fmt(group.start)} – {fmt(group.end)} · no branching, merging or branch heads
      </div>
      <ul className={styles.commitList} aria-label="Collapsed commits">
        {newestFirst.map((c) => (
          <li key={c.oid} onMouseEnter={() => setActive(c)} className={active?.oid === c.oid ? styles.commitActive : undefined}>
            <span className="mono">{c.oid.slice(0, 7)}</span> {c.subject || '(no subject)'}
          </li>
        ))}
      </ul>
      {active ? (
        <div className={styles.commitDetail}>
          <div className={styles.subject}>{active.subject || '(no subject)'}</div>
          <div className="small muted">
            <span className="mono">{active.oid.slice(0, 12)}</span> · {new Date(active.time * 1000).toLocaleString()} · {active.pushed ? 'pushed' : 'local only'}
          </div>
        </div>
      ) : (
        <div className="small muted">Hover a commit for its details.</div>
      )}
      <button type="button" className="btn" onClick={onExpand}>
        Show these commits on the graph
      </button>
    </>
  )
}
