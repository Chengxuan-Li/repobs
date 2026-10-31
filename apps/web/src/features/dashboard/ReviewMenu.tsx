import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { REVIEW_LABELS, type ReviewState, WORKFLOW_LABELS, WORKFLOW_TONES, type WorkflowStatus } from '@repobs/contracts'
import { badgeClassName } from '../../components/primitives'
import styles from './reviewMenu.module.css'

// The workflow status badge of an agent, as a button: it opens a menu to set your review state
// directly from the dashboard row or the agent's hover card.

const REVIEWS = Object.keys(REVIEW_LABELS) as ReviewState[]

export function ReviewMenu({
  status,
  review,
  title,
  focusable = true,
  onReview,
}: {
  status: WorkflowStatus
  review: ReviewState
  title: string
  focusable?: boolean
  onReview: (review: ReviewState) => void
}) {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return
    // Open upwards when the menu would run past the bottom of the scrolling area.
    const box = trigger.current.closest('[data-menu-bounds]') ?? document.documentElement
    setAbove(trigger.current.getBoundingClientRect().bottom + menu.current.offsetHeight > box.getBoundingClientRect().bottom)
    ;(menu.current.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.current.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus()
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => items[(n + items.length) % items.length]?.focus()
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Escape') close(true)
    else if (e.key === 'Tab') return close(false)
    else return
    e.preventDefault()
  }

  return (
    <span
      ref={wrap}
      className={styles.wrap}
      data-open={open || undefined}
      // Keep row selection and dashboard keyboard navigation out of the menu.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={trigger}
        type="button"
        className={`${badgeClassName(WORKFLOW_TONES[status])} ${styles.trigger}`}
        tabIndex={focusable ? 0 : -1}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${WORKFLOW_LABELS[status]}: change review state of ${title}`}
        title="Change review state"
        onClick={() => setOpen((o) => !o)}
      >
        {WORKFLOW_LABELS[status]}
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open ? (
        <div ref={menu} role="menu" aria-label={`Review state of ${title}`} className={`${styles.menu} ${above ? styles.above : ''}`} onKeyDown={onMenuKey}>
          <div className={styles.head} aria-hidden="true">
            Review state
          </div>
          {REVIEWS.map((r) => (
            <button
              key={r}
              type="button"
              role="menuitemradio"
              aria-checked={r === review}
              tabIndex={-1}
              className={styles.item}
              onClick={() => {
                close(true)
                if (r !== review) onReview(r)
              }}
            >
              <span className={styles.check} aria-hidden="true">
                {r === review ? <Check size={12} /> : null}
              </span>
              {REVIEW_LABELS[r]}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  )
}
