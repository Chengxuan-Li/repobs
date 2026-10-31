import { ChevronDown, ChevronRight } from 'lucide-react'
import { type AgentSession, type AnnotationSummary, type ReviewState, workflowStatus } from '@repobs/contracts'
import { formatAge, StatusIndicator } from '../../components/primitives'
import type { TreeGuide } from './layout'
import { ReviewMenu } from './ReviewMenu'
import styles from './board.module.css'

// One agent per line, as a card indented by its spawn depth: name (or your alias) and its workflow
// status, which opens the review menu. Spawn lines run in the gutter left of the cards, so they can
// pass between rows. Everything else is in the hover card, the expanded block (chevron, → / ←, or
// "Expand agent details"), or the details panel.

/** Left edge of a depth-0 card and the indent per spawn level (px). */
export const CARD_BASE = 8
export const CARD_INDENT = 18

export function AgentRow({
  session,
  annotation,
  guides,
  hasChildren,
  expanded,
  focusable,
  now,
  onToggle,
  onReview,
}: {
  session: AgentSession
  annotation?: AnnotationSummary
  guides: TreeGuide[]
  hasChildren: boolean
  expanded: boolean
  /** Whether the row's controls are in the tab order (the row is the current keyboard row). */
  focusable: boolean
  now: number
  onToggle: () => void
  onReview: (review: ReviewState) => void
}) {
  const status = workflowStatus(session, annotation)
  const title = annotation?.displayAlias || session.title
  const total = (annotation?.checklistOpen ?? 0) + (annotation?.checklistDone ?? 0)
  const depth = guides.length
  return (
    <div className={`${styles.agent} ${session.historical ? styles.historical : ''}`} data-status={status}>
      {guides.map((g, i) =>
        g === 'none' ? null : <span key={i} className={`${styles.guide} ${styles[`guide_${g}`]}`} style={{ left: CARD_BASE + i * CARD_INDENT + 7, width: CARD_INDENT - 7 }} aria-hidden="true" />,
      )}
      {hasChildren ? <span className={styles.guideStub} style={{ left: CARD_BASE + depth * CARD_INDENT + 7 }} aria-hidden="true" /> : null}
      <div className={styles.card} style={{ marginLeft: CARD_BASE + depth * CARD_INDENT }}>
        <div className={styles.agentLine}>
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
          <ReviewMenu status={status} review={annotation?.review ?? 'unreviewed'} title={title} focusable={focusable} onReview={onReview} />
        </div>
        {expanded ? (
          <div className={styles.agentMore} onClick={(e) => e.stopPropagation()}>
            <div className={styles.moreLine}>
              <StatusIndicator state={session.state} />
              <span className="mono small muted">{formatAge(session.lastActivityAt, now)} ago</span>
              {session.agentType ? <span className="small muted">{session.agentType}</span> : null}
              {total ? (
                <span className="mono small muted">
                  ☑ {annotation!.checklistDone}/{total}
                </span>
              ) : null}
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
    </div>
  )
}
