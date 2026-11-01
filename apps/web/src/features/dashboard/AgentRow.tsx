import { ChevronDown, ChevronRight } from 'lucide-react'
import { type AgentSession, type AnnotationSummary, type ReviewState, workflowStatus } from '@repobs/contracts'
import type { TreeGuide } from './layout'
import { ChecklistPill } from './ChecklistPill'
import { ReviewMenu } from './ReviewMenu'
import styles from './board.module.css'

// One agent per line, as a card indented by its spawn depth: name (or your alias), its workflow
// status, which opens the review menu, and your checklist's progress when it has one. Spawn lines run in the gutter left of the cards, so they can
// pass between rows. An agent that spawned others has a chevron (or → / ←) that shows or hides them.
// Details stay out of the dashboard: they are in the hover card and the details panel.

/** Left edge of a depth-0 card and the indent per spawn level (px). */
export const CARD_BASE = 8
export const CARD_INDENT = 18

export function AgentRow({
  session,
  annotation,
  guides,
  hasChildren,
  childCount,
  expanded,
  focusable,
  showName = true,
  onToggle,
  onReview,
  onChecklist,
  onHide,
  onPopover,
}: {
  session: AgentSession
  annotation?: AnnotationSummary
  guides: TreeGuide[]
  /** Spawned agents are shown directly below. */
  hasChildren: boolean
  /** Agents it spawned (0: no chevron). */
  childCount: number
  expanded: boolean
  /** Whether the row's controls are in the tab order (the row is the current keyboard row). */
  focusable: boolean
  /** Off when names are shown on the timeline only: the card keeps the provider mark and status. */
  showName?: boolean
  onToggle: () => void
  onReview: (review: ReviewState) => void
  onChecklist: (itemId: string, done: boolean) => Promise<boolean>
  onHide?: () => void
  /** The checklist list opened: the row's hover card closes. */
  onPopover?: () => void
}) {
  const status = workflowStatus(session, annotation)
  const title = annotation?.displayAlias || session.title
  const depth = guides.length
  return (
    <div className={`${styles.agent} ${session.historical ? styles.historical : ''}`} data-status={status}>
      {guides.map((g, i) =>
        g === 'none' ? null : <span key={i} className={`${styles.guide} ${styles[`guide_${g}`]}`} style={{ left: CARD_BASE + i * CARD_INDENT + 7, width: CARD_INDENT - 7 }} aria-hidden="true" />,
      )}
      {hasChildren ? <span className={styles.guideStub} style={{ left: CARD_BASE + depth * CARD_INDENT + 7 }} aria-hidden="true" /> : null}
      <div className={styles.card} style={{ marginLeft: CARD_BASE + depth * CARD_INDENT }}>
        <div className={styles.agentLine}>
          {childCount ? (
            <button
              type="button"
              className={styles.expand}
              tabIndex={-1}
              aria-label={`${expanded ? 'Hide' : 'Show'} ${childCount} spawned ${childCount === 1 ? 'agent' : 'agents'} of ${title}`}
              title={`${expanded ? 'Hide' : 'Show'} ${childCount} spawned ${childCount === 1 ? 'agent' : 'agents'}`}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation()
                onToggle()
              }}
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {expanded ? null : <span className={styles.childCount}>{childCount}</span>}
            </button>
          ) : (
            <span className={styles.expandSpace} aria-hidden="true" />
          )}
          <span className={styles.providerMark} title={session.provider === 'claude' ? 'Claude Code' : 'Codex'}>
            {session.provider === 'claude' ? 'C' : 'X'}
          </span>
          {showName ? <span className={styles.agentName}>{title}</span> : <span className={styles.agentName} />}
          <ReviewMenu status={status} review={annotation?.review ?? 'unreviewed'} title={title} focusable={focusable} onReview={onReview} onHide={onHide} />
          {annotation?.checklist.length ? <ChecklistPill items={annotation.checklist} title={title} focusable={focusable} onToggle={onChecklist} onOpen={onPopover} /> : null}
        </div>
      </div>
    </div>
  )
}
