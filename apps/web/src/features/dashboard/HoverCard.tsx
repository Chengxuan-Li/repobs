import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import {
  type AgentSession,
  type AnnotationSummary,
  type CommitNode,
  CONFIDENCE_LABELS,
  DETAIL_LABELS,
  type PullRequest,
  REVIEW_LABELS,
  stateLabel,
  WORKFLOW_LABELS,
  WORKFLOW_TONES,
  workflowStatus,
} from '@repobs/contracts'
import { Badge, formatAge } from '../../components/primitives'
import type { BranchRow } from './layout'
import styles from './hover.module.css'

// Floating detail card shown while hovering graph nodes, agent rows, bars and branch labels.
// Everything here is also reachable without a mouse through the details panel.

export interface HoverState {
  content: ReactNode
  x: number
  y: number
}

export type ShowHover = (content: ReactNode, e: { clientX: number; clientY: number }) => void

export function HoverCard({ state }: { state?: HoverState }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!state || !ref.current) return
    const { offsetWidth: w, offsetHeight: h } = ref.current
    const left = state.x + 16 + w > window.innerWidth ? Math.max(8, state.x - 16 - w) : state.x + 16
    const top = state.y + 16 + h > window.innerHeight ? Math.max(8, state.y - 12 - h) : state.y + 16
    setPos({ left, top })
  }, [state])
  if (!state) return null
  return (
    <div ref={ref} className={styles.card} style={pos} role="tooltip">
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

export function AgentHover({ session, annotation, now, parentTitle, children }: { session: AgentSession; annotation?: AnnotationSummary; now: number; parentTitle?: string; children: number }) {
  const status = workflowStatus(session, annotation)
  const total = (annotation?.checklistOpen ?? 0) + (annotation?.checklistDone ?? 0)
  return (
    <>
      <div className={styles.title}>{annotation?.displayAlias || session.title}</div>
      <div className={styles.row}>
        <Badge tone={WORKFLOW_TONES[status]}>{WORKFLOW_LABELS[status]}</Badge>
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
        {annotation && annotation.review !== 'unreviewed' ? (
          <>
            <dt>Review</dt>
            <dd>{REVIEW_LABELS[annotation.review]}</dd>
          </>
        ) : null}
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
