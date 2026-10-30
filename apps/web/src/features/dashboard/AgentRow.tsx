import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  type AgentSession,
  type AnnotationSummary,
  REVIEW_LABELS,
  type ReviewState,
  WORKFLOW_LABELS,
  WORKFLOW_TONES,
  workflowStatus,
} from '@repobs/contracts'
import { Badge, formatAge, StatusIndicator } from '../../components/primitives'
import styles from './board.module.css'

// One agent per line: name (or your alias) and its workflow status. Everything else is in the
// hover card, the expanded block (chevron, → / ←, or "Expand agent details"), or the details panel.

export function AgentRow({
  session,
  annotation,
  depth,
  expanded,
  now,
  onToggle,
  onReview,
}: {
  session: AgentSession
  annotation?: AnnotationSummary
  depth: number
  expanded: boolean
  now: number
  onToggle: () => void
  onReview: (review: ReviewState) => void
}) {
  const status = workflowStatus(session, annotation)
  const title = annotation?.displayAlias || session.title
  const total = (annotation?.checklistOpen ?? 0) + (annotation?.checklistDone ?? 0)
  return (
    <div className={`${styles.agent} ${session.historical ? styles.historical : ''}`} data-status={status}>
      <div className={styles.agentLine}>
        {Array.from({ length: depth }, (_, i) => (
          <span key={i} className={i === depth - 1 ? styles.treeElbow : styles.treeIndent} aria-hidden="true" />
        ))}
        <button
          type="button"
          className={styles.expand}
          tabIndex={-1}
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className={styles.providerMark} title={session.provider === 'claude' ? 'Claude Code' : 'Codex'}>
          {session.provider === 'claude' ? 'C' : 'X'}
        </span>
        <span className={styles.agentName}>{title}</span>
        <Badge tone={WORKFLOW_TONES[status]}>{WORKFLOW_LABELS[status]}</Badge>
      </div>
      {expanded ? (
        <div className={styles.agentMore} style={{ paddingLeft: 20 + depth * 14 }} onClick={(e) => e.stopPropagation()}>
          <div className={styles.moreLine}>
            <StatusIndicator state={session.state} />
            <span className="mono small muted">{formatAge(session.lastActivityAt, now)} ago</span>
            {session.agentType ? <span className="small muted">{session.agentType}</span> : null}
            {total ? (
              <span className="mono small muted">
                ☑ {annotation!.checklistDone}/{total}
              </span>
            ) : null}
            <label className={styles.reviewSelect}>
              <span className="visually-hidden">Review state for {title}</span>
              <select value={annotation?.review ?? 'unreviewed'} onChange={(e) => onReview(e.target.value as ReviewState)} onKeyDown={(e) => e.stopPropagation()}>
                {(Object.keys(REVIEW_LABELS) as ReviewState[]).map((r) => (
                  <option key={r} value={r}>
                    {REVIEW_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {session.lastMessage ? (
            <p className={styles.excerpt}>
              <span className={styles.excerptKind}>{session.lastMessage.kind === 'tool' ? 'Tool' : 'Agent'}</span> {session.lastMessage.text}
            </p>
          ) : null}
          {annotation?.tags.length ? (
            <div className={styles.tags}>
              {annotation.tags.map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          {annotation?.note ? <p className={styles.note}>{annotation.note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
