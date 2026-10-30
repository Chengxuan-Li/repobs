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

// One agent session as a card: identity, workflow status, observed state with evidence, the latest
// message excerpt, and (in details mode) alias, tags, full notes and checklist progress.

export function SessionCard({
  session,
  annotation,
  depth,
  details,
  now,
  onReview,
}: {
  session: AgentSession
  annotation?: AnnotationSummary
  depth: number
  details: boolean
  now: number
  onReview: (review: ReviewState) => void
}) {
  const status = workflowStatus(session, annotation)
  const title = annotation?.displayAlias || session.title
  const total = (annotation?.checklistOpen ?? 0) + (annotation?.checklistDone ?? 0)
  return (
    <div className={`${styles.card} ${session.historical ? styles.cardHistorical : ''}`} style={{ marginLeft: depth * 16 }} data-status={status}>
      <div className={styles.cardTop}>
        <span className={styles.provider}>{session.provider === 'claude' ? 'Claude' : 'Codex'}</span>
        {depth > 0 || session.parentSessionId ? (
          <span className={styles.spawned} title="Spawned by another agent">
            ↳ {session.agentType ?? 'sub-agent'}
          </span>
        ) : null}
        <span className={styles.cardTitle} title={session.title}>
          {title}
        </span>
        <span className={styles.age} title={session.lastActivityAt ? `Last activity ${new Date(session.lastActivityAt).toLocaleString()}` : undefined}>
          {formatAge(session.lastActivityAt, now)}
        </span>
      </div>
      <div className={styles.cardMeta}>
        <Badge tone={WORKFLOW_TONES[status]}>{WORKFLOW_LABELS[status]}</Badge>
        <StatusIndicator state={session.state} />
        {session.subagents.total ? (
          <span className="mono small muted" title="Spawned agents (active / total)">
            ⑂ {session.subagents.active}/{session.subagents.total}
          </span>
        ) : null}
        {total ? (
          <span className="mono small muted" title="Checklist items done / total">
            ☑ {annotation!.checklistDone}/{total}
          </span>
        ) : null}
        <label className={styles.reviewSelect} onClick={(e) => e.stopPropagation()}>
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
        <p className={`${styles.excerpt} ${details ? '' : styles.clamp}`} title={session.lastMessage.at ? `From the provider's session file, ${new Date(session.lastMessage.at).toLocaleString()}` : undefined}>
          <span className={styles.excerptKind}>{session.lastMessage.kind === 'tool' ? 'Tool' : 'Agent'}</span> {session.lastMessage.text}
        </p>
      ) : session.activityLabel ? (
        <p className={`${styles.excerpt} muted`}>{session.activityLabel}</p>
      ) : null}
      {details ? (
        <div className={styles.cardDetails}>
          {annotation?.displayAlias ? (
            <div className="small muted">
              Provider title: <span className={styles.plain}>{session.title}</span>
            </div>
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
