import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AnnotationSummary } from '@repobs/contracts'
import { boxOf, placeFloating } from '../../components/placement'
import styles from './checklistPill.module.css'

// Your checklist of an agent, as a pill beside its review state: a pie filled clockwise by the
// share of items done, then done / total, in the theme's info colour (success once all are done,
// neutral before any is). Hovering or clicking opens one popover with the items, where you tick or
// untick them. Opened by hover it stays while the pointer is on the pill or the popover; opened by
// a click (or the keyboard) it stays until Escape or a click elsewhere. It sits below the pill
// (above it near the window's bottom edge) and does not follow the pointer.

/** How long the popover waits before closing after the pointer leaves it (to cross the gap). */
const LEAVE_MS = 200

type Item = AnnotationSummary['checklist'][number]

export function ChecklistPill({
  items,
  title,
  focusable = true,
  onToggle,
  onOpen,
}: {
  items: Item[]
  title: string
  focusable?: boolean
  /** Resolves to whether the change was saved. */
  onToggle: (itemId: string, done: boolean) => Promise<boolean>
  /** The list opened (hover cards of the row give way to it). */
  onOpen?: () => void
}) {
  const [mode, setMode] = useState<'closed' | 'hover' | 'open'>('closed')
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Ticks show at once; they give way to the saved list when it arrives, and are undone if saving fails.
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState(items)
  if (saved !== items) {
    setSaved(items)
    setTicks({})
  }
  const shown = items.map((i) => (ticks[i.id] === undefined ? i : { ...i, done: ticks[i.id]! }))
  const toggle = (itemId: string, done: boolean) => {
    setTicks((t) => ({ ...t, [itemId]: done }))
    void onToggle(itemId, done).then((ok) => {
      if (!ok)
        setTicks((t) => {
          const { [itemId]: _, ...rest } = t
          return rest
        })
    })
  }
  const [pos, setPos] = useState<{ left: number; top: number }>()
  const trigger = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const popId = useId()
  const done = shown.filter((i) => i.done).length

  useLayoutEffect(() => {
    if (mode === 'closed') return
    const place = () => {
      if (!trigger.current || !pop.current) return
      const size = { width: pop.current.offsetWidth, height: pop.current.offsetHeight }
      setPos(placeFloating(boxOf(trigger.current), size, { width: window.innerWidth, height: window.innerHeight }, { placement: 'below', gap: 3 }))
    }
    place()
    // The popover follows its pill when the dashboard scrolls or the window resizes.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [mode, items.length])

  useEffect(() => () => clearTimeout(leaveTimer.current), [])
  useEffect(() => {
    if (mode !== 'open') return
    pop.current?.querySelector<HTMLInputElement>('input')?.focus()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) setMode('closed')
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [mode])

  if (!items.length) return null
  const close = () => {
    setMode('closed')
    trigger.current?.focus()
  }
  const enter = () => {
    clearTimeout(leaveTimer.current)
    if (mode === 'closed') onOpen?.()
    setMode((m) => (m === 'closed' ? 'hover' : m))
  }
  const leave = () => {
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setMode((m) => (m === 'hover' ? 'closed' : m)), LEAVE_MS)
  }
  // The popover is rendered in <body>, but React events still bubble to the row: keep row
  // selection, dashboard keys and drag-to-pan out of it.
  const contain = {
    onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') close()
    },
    onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  }
  return (
    <span className={styles.wrap} {...contain}>
      <button
        ref={trigger}
        type="button"
        className={`${styles.pill} ${styles[done === items.length ? 'success' : done ? 'info' : 'neutral']}`}
        tabIndex={focusable ? 0 : -1}
        aria-label={`Checklist of ${title}: ${done} of ${items.length} done`}
        aria-haspopup="dialog"
        aria-expanded={mode !== 'closed'}
        aria-controls={mode === 'closed' ? undefined : popId}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onClick={() => {
          clearTimeout(leaveTimer.current)
          if (mode === 'closed') onOpen?.()
          // A click on a list opened by hover keeps it open; a second click closes it.
          setMode((m) => (m === 'open' ? 'closed' : 'open'))
        }}
      >
        <Pie fraction={done / items.length} />
        {done}/{items.length}
      </button>
      {mode !== 'closed'
        ? createPortal(
            <div
              ref={pop}
              id={popId}
              className={styles.popover}
              style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
              role="dialog"
              aria-label={`Checklist of ${title}`}
              data-no-pan=""
              onMouseEnter={enter}
              onMouseLeave={leave}
              {...contain}
            >
              <div className={styles.head}>
                <span className="label">Checklist</span>
                <span className="small muted">
                  {done} of {items.length} done
                </span>
              </div>
              <ul className={styles.items}>
                {shown.map((item) => (
                  <li key={item.id}>
                    <label className={styles.item}>
                      <input type="checkbox" checked={item.done} onChange={(e) => toggle(item.id, e.target.checked)} />
                      <span className={item.done ? styles.done : undefined}>{item.text}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

/** A pie filled clockwise from 12 o'clock by `fraction` (0–1), inside a thin ring. */
export function Pie({ fraction, size = 10 }: { fraction: number; size?: number }) {
  const r = size / 2
  const f = Math.max(0, Math.min(1, fraction))
  const a = 2 * Math.PI * f
  const round = (n: number) => Math.round(n * 100) / 100
  const x = round(r + r * Math.sin(a))
  const y = round(r - r * Math.cos(a))
  return (
    <svg className={styles.pie} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={r} cy={r} r={r - 0.5} className={styles.pieRing} />
      {f >= 1 ? (
        <circle cx={r} cy={r} r={r} className={styles.pieFill} />
      ) : f > 0 ? (
        <path d={`M${r},${r} L${r},0 A${r},${r} 0 ${f > 0.5 ? 1 : 0} 1 ${x},${y} Z`} className={styles.pieFill} />
      ) : null}
    </svg>
  )
}
