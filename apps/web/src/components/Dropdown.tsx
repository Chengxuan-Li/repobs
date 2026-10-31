import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, type LucideIcon } from 'lucide-react'
import styles from './dropdown.module.css'

// A labelled button showing its current value that opens either a menu of options (check boxes for
// multiple choice, radio items for one choice, in headed sections) or a small panel of controls.
// Choosing a check box keeps the menu open, so several can be set in one visit.

export type DropdownItem =
  | { type: 'check'; label: string; checked: boolean; onToggle: () => void }
  | { type: 'radio'; label: string; checked: boolean; onSelect: () => void }

export interface DropdownSection {
  heading?: string
  items: DropdownItem[]
}

export function Dropdown({
  label,
  value,
  active = false,
  icon: Icon,
  sections,
  children,
}: {
  label: string
  /** Current value, shown after the label. */
  value?: string
  /** Marks a dropdown whose setting differs from the default (for filters). */
  active?: boolean
  /** Compact button for tight strips: the icon instead of the label and value (both stay in the name and tooltip). */
  icon?: LucideIcon
  sections?: DropdownSection[]
  /** A panel of controls instead of a menu (role dialog). */
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const isMenu = sections !== undefined

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!popup.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false)
    }
    const onResize = () => setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return
    // Below the button, kept inside the window.
    const r = trigger.current.getBoundingClientRect()
    const w = popup.current.offsetWidth
    setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - w - 4)), top: r.bottom + 2 })
    const first = isMenu
      ? (popup.current.querySelector<HTMLElement>('[aria-checked="true"]') ?? popup.current.querySelector<HTMLElement>('[role^="menuitem"]'))
      : popup.current.querySelector<HTMLElement>('input, select, textarea, button')
    first?.focus()
  }, [open, isMenu])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close(true)
      e.preventDefault()
      return
    }
    if (!isMenu) {
      if (e.key === 'Tab') {
        // Leaving the panel by keyboard closes it.
        const focusable = [...(popup.current?.querySelectorAll<HTMLElement>('input, select, textarea, button') ?? [])]
        const last = focusable[focusable.length - 1]
        if (!e.shiftKey && document.activeElement === last) close(false)
      }
      return
    }
    const items = [...(popup.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => items[(n + items.length) % items.length]?.focus()
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Tab') return close(false)
    else return
    e.preventDefault()
  }

  // A menu of a single radio list is a plain choice: picking closes it.
  const closesOnPick = sections?.length === 1 && sections[0]!.items.every((i) => i.type === 'radio')

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`btn ${styles.trigger} ${active ? styles.active : ''} ${Icon ? styles.compact : ''}`}
        title={Icon ? (value ? `${label}: ${value}` : label) : undefined}
        aria-haspopup={isMenu ? 'menu' : 'dialog'}
        aria-expanded={open}
        aria-label={value ? `${label}: ${value}` : label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {Icon ? (
          <Icon size={14} aria-hidden="true" />
        ) : (
          <>
            <span>{label}</span>
            {value ? <span className={styles.value}>{value}</span> : null}
          </>
        )}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={popup}
          role={isMenu ? 'menu' : 'dialog'}
          aria-label={label}
          className={`${styles.popup} ${isMenu ? '' : styles.panel}`}
          style={pos}
          onKeyDown={onKey}
        >
          {isMenu
            ? sections.map((section, si) => (
                <div key={section.heading ?? `s${si}`} role="group" aria-label={section.heading} className={si ? styles.section : undefined}>
                  {section.heading ? (
                    <div className={styles.heading} aria-hidden="true">
                      {section.heading}
                    </div>
                  ) : null}
                  {section.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role={item.type === 'check' ? 'menuitemcheckbox' : 'menuitemradio'}
                      aria-checked={item.checked}
                      tabIndex={-1}
                      className={styles.item}
                      onClick={() => {
                        if (item.type === 'check') item.onToggle()
                        else {
                          item.onSelect()
                          if (closesOnPick) close(true)
                        }
                      }}
                    >
                      <span className={item.type === 'check' ? styles.box : styles.mark} aria-hidden="true">
                        {item.checked ? <Check size={item.type === 'check' ? 11 : 13} /> : null}
                      </span>
                      {item.label}
                    </button>
                  ))}
                </div>
              ))
            : children}
        </div>
      ) : null}
    </>
  )
}
