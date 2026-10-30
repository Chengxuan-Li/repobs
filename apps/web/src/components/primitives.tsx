import { type ReactNode, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CircleAlert, Info, X } from 'lucide-react'
import {
  CONFIDENCE_LABELS,
  DETAIL_LABELS,
  type ObservedAgentState,
  REVIEW_LABELS,
  REVIEW_TONES,
  type ReviewState,
  stateLabel,
  STATE_TONES,
  type Tone,
} from '@repobs/contracts'
import styles from './primitives.module.css'

// Small shared components (StatusIndicator, Badge, EmptyState, InlineAlert, Dialog). Every
// colored status also carries text, so color is never the only signal.

export function Badge({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={title}>
      {children}
    </span>
  )
}

const STATE_GLYPHS: Record<ObservedAgentState['kind'], string> = {
  running: '●',
  running_subagents: '●',
  waiting_approval: '!',
  waiting_user: '?',
  idle_or_turn_finished: '○',
  ended: '–',
  unknown: '·',
  error: '×',
}

export function StatusIndicator({ state, compact = false, stale = false }: { state: ObservedAgentState; compact?: boolean; stale?: boolean }) {
  const tone = state.possiblyAwaitingApproval ? 'warning' : STATE_TONES[state.kind]
  const label = stateLabel(state)
  const title = [
    label,
    state.detail ? DETAIL_LABELS[state.detail] : undefined,
    `Evidence: ${CONFIDENCE_LABELS[state.confidence]}`,
    stale ? 'Stale' : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <span className={`${styles.status} ${styles[`text-${tone}`]}`} title={title} data-state={state.kind}>
      <span aria-hidden="true" className={styles.glyph}>
        {STATE_GLYPHS[state.kind]}
      </span>
      {compact ? <span className="visually-hidden">{label}</span> : <span>{label}</span>}
      {!compact && state.confidence !== 'direct' && state.kind !== 'unknown' ? (
        <span className={styles.confidence}>{state.confidence}</span>
      ) : null}
    </span>
  )
}

export function ReviewBadge({ review }: { review: ReviewState }) {
  if (review === 'unreviewed') return null
  return <Badge tone={REVIEW_TONES[review]}>{REVIEW_LABELS[review]}</Badge>
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <h2 className={styles.emptyTitle}>{title}</h2>
      {children ? <div className={styles.emptyBody}>{children}</div> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  )
}

export function InlineAlert({ tone = 'warning', children, onDismiss }: { tone?: Tone; children: ReactNode; onDismiss?: () => void }) {
  const Icon = tone === 'danger' ? CircleAlert : tone === 'warning' ? AlertTriangle : Info
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={14} aria-hidden="true" />
      <div className={styles.alertBody}>{children}</div>
      {onDismiss ? (
        <button type="button" className="btn btn-quiet btn-icon" onClick={onDismiss} aria-label="Dismiss">
          <X size={14} />
        </button>
      ) : null}
    </div>
  )
}

/** Modal dialog with focus containment and Escape to close. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')
    first?.focus()
    return () => previous?.focus?.()
  }, [])
  // Escape works even when focus fell to <body> (e.g. a button became disabled while busy).
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && ref.current) {
      const items = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex="0"]')].filter((el) => !el.hasAttribute('disabled'))
      if (!items.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`${styles.dialog} ${wide ? styles.wide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        <div className="section-strip">
          <h2 className={styles.dialogTitle}>{title}</h2>
          <button type="button" className="btn btn-quiet btn-icon" data-close onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className={styles.dialogBody}>{children}</div>
        {footer ? <div className={styles.dialogFooter}>{footer}</div> : null}
      </div>
    </div>
  )
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function formatAge(iso: string | undefined, now: number): string {
  if (!iso) return '—'
  const ms = now - Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  if (ms < 45_000) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 60) return `${d}d`
  return `${Math.round(d / 30)}mo`
}

export function formatTime(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export function shortOid(oid: string | undefined) {
  return oid ? oid.slice(0, 8) : '—'
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn btn-quiet"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1_500)
          })
          .catch(() => setCopied(false))
      }
      aria-label={label}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
