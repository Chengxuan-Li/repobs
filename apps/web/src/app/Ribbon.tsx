import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { boxOf } from '../components/placement'
import styles from './ribbon.module.css'

// The ribbon (EnergyAtlas family layout): the wordmark, the File, View and Help menus, a "Search
// commands" field that opens the command palette, and icon buttons for the side panels and the
// theme. Every command lives in one list, so menus, palette, buttons and shortcuts agree; groups
// without a menu (the current view's display options, repository order) are reached from the
// palette and from their own controls.

export type CommandGroup = 'File' | 'View' | 'Help' | 'Current view' | 'Repositories'
/** Groups with a ribbon menu, in order. */
export const MENU_GROUPS: CommandGroup[] = ['File', 'View', 'Help']

export interface Command {
  id: string
  label: string
  group: CommandGroup
  /** Submenu inside the group, e.g. "Axis". */
  submenu?: string
  /** Display form, e.g. "Ctrl+K". */
  shortcut?: string
  icon?: LucideIcon
  /** On/off state for toggles (shown as a check). */
  pressed?: boolean
  /** Reached from the palette (and shortcuts) only, not from a menu. */
  paletteOnly?: boolean
  run: () => void
}

export function Ribbon({ commands, quick, paletteShortcut }: { commands: Command[]; quick: string[]; paletteShortcut: string }) {
  const [palette, setPalette] = useState(false)
  useShortcuts(commands, paletteShortcut, () => setPalette(true))
  const byId = new Map(commands.map((c) => [c.id, c]))
  return (
    <header className={styles.ribbon}>
      <span className={styles.brand}>repobs</span>
      <div role="toolbar" aria-label="Workbench commands" className={styles.toolbar}>
        {MENU_GROUPS.map((group) => (
          <MenuButton key={group} label={group} commands={commands.filter((c) => c.group === group && !c.paletteOnly)} />
        ))}
        <span className={styles.separator} aria-hidden="true" />
        <button type="button" className={styles.searchButton} aria-keyshortcuts={paletteShortcut.replace('Ctrl', 'Control')} onClick={() => setPalette(true)}>
          <Search size={13} aria-hidden="true" />
          <span>Search commands</span>
          <kbd className={styles.kbd}>{paletteShortcut}</kbd>
        </button>
        <span className={styles.separator} aria-hidden="true" />
        {quick.map((id) => {
          const c = byId.get(id)
          if (!c) return null
          const Icon = c.icon
          return (
            <button
              key={id}
              type="button"
              className={styles.quickButton}
              aria-label={c.label}
              aria-pressed={c.pressed}
              title={`${c.label}${c.shortcut ? ` (${c.shortcut})` : ''}`}
              onClick={c.run}
            >
              {Icon ? <Icon size={16} aria-hidden="true" /> : c.label}
            </button>
          )
        })}
      </div>
      {palette ? <CommandPalette commands={commands} onClose={() => setPalette(false)} /> : null}
    </header>
  )
}

/** A ribbon menu: the group name opens a list of its commands (with submenus as headed sections). */
function MenuButton({ label, commands }: { label: string; commands: Command[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const r = boxOf(trigger.current)
    setPos({ left: r.left, top: r.bottom + 2 })
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
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

  const sections = groupBySubmenu(commands)
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.menuButton}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {label}
      </button>
      {open ? (
        <div ref={menu} role="menu" aria-label={`${label} menu`} className={styles.menu} style={pos} onKeyDown={onKey}>
          {sections.map(([submenu, items], si) => (
            <div key={si} role="group" aria-label={submenu} className={si ? styles.menuSection : undefined}>
              {submenu ? (
                <div className={styles.menuHeading} aria-hidden="true">
                  {submenu}
                </div>
              ) : null}
              {items.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role={c.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={c.pressed}
                  tabIndex={-1}
                  className={styles.menuItem}
                  onClick={() => {
                    close(true)
                    c.run()
                  }}
                >
                  <span className={styles.menuCheck} aria-hidden="true">
                    {c.pressed ? <Check size={13} /> : null}
                  </span>
                  <span>{c.label}</span>
                  {c.shortcut ? <kbd className={styles.kbd}>{c.shortcut}</kbd> : <span />}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}

/** Runs of consecutive commands with the same submenu, in list order (a menu's sections). */
function groupBySubmenu(commands: Command[]): Array<[string | undefined, Command[]]> {
  const out: Array<[string | undefined, Command[]]> = []
  for (const c of commands) {
    const last = out[out.length - 1]
    if (last && last[0] === c.submenu) last[1].push(c)
    else out.push([c.submenu, [c]])
  }
  return out
}

/** Type to filter every command; Enter runs the highlighted one. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const restore = useRef<Element | null>(null)
  useEffect(() => {
    restore.current = document.activeElement
    input.current?.focus()
    return () => (restore.current as HTMLElement | null)?.focus?.()
  }, [])
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => {
      const text = `${c.group} ${c.submenu ?? ''} ${c.label}`.toLowerCase()
      return words.every((w) => text.includes(w))
    })
  }, [commands, query])
  const current = Math.min(active, Math.max(0, matches.length - 1))
  const runAt = (i: number) => {
    const c = matches[i]
    if (!c) return
    onClose()
    c.run()
  }
  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search commands" className={styles.palette}>
        <input
          ref={input}
          className={`input ${styles.paletteInput}`}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={matches[current] ? `cmd-${matches[current]!.id}` : undefined}
          aria-label="Search commands"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((current + 1) % Math.max(1, matches.length))
            else if (e.key === 'ArrowUp') setActive((current - 1 + matches.length) % Math.max(1, matches.length))
            else if (e.key === 'Enter') runAt(current)
            else if (e.key === 'Escape') onClose()
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
        <ul id="palette-list" role="listbox" aria-label="Commands" className={styles.paletteList}>
          {matches.map((c, i) => (
            <li
              key={c.id}
              id={`cmd-${c.id}`}
              role="option"
              aria-selected={i === current}
              className={`${styles.menuItem} ${i === current ? styles.paletteActive : ''}`}
              onMouseMove={() => setActive(i)}
              onClick={() => runAt(i)}
            >
              <span className={styles.menuCheck} aria-hidden="true">
                {c.pressed ? <Check size={13} /> : null}
              </span>
              <span>
                <span className={styles.paletteGroup}>{[c.group, c.submenu].filter(Boolean).join(' › ')} › </span>
                {c.label}
              </span>
              {c.shortcut ? <kbd className={styles.kbd}>{c.shortcut}</kbd> : <span />}
            </li>
          ))}
          {matches.length === 0 ? <li className={styles.paletteEmpty}>No command matches “{query}”.</li> : null}
        </ul>
      </div>
    </div>
  )
}

/** Keyboard shortcuts for commands that declare one, plus the palette. Ignored while typing. */
function useShortcuts(commands: Command[], paletteShortcut: string, openPalette: () => void) {
  const latest = useRef({ commands, openPalette })
  useLayoutEffect(() => {
    latest.current = { commands, openPalette }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Already handled, e.g. the interface size (uiScale.ts), which also runs while typing.
      if (e.defaultPrevented) return
      const combo = keyCombo(e)
      if (combo === paletteShortcut) {
        e.preventDefault()
        latest.current.openPalette()
        return
      }
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return
      const c = latest.current.commands.find((x) => x.shortcut === combo)
      if (!c) return
      e.preventDefault()
      c.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteShortcut])
}

function keyCombo(e: KeyboardEvent): string {
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}
