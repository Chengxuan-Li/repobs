import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FolderGit2, GitBranch, GitFork, Inbox, Bot, Cloud, MonitorDot } from 'lucide-react'
import { type ReviewState, REVIEW_LABELS, stateLabel } from '@repobs/contracts'
import { Badge, formatAge, ReviewBadge, StatusIndicator, useNow } from '../../components/primitives'
import type { FlatRow, TreeNode } from './buildTree'
import styles from './tree.module.css'

// WAI-ARIA tree: roving focus, arrows/Home/End, Enter/Space select, Shift+F10 or the Menu key
// for the context menu. Rows are windowed when the list is long.

const ROW_HEIGHT = 26
const VIRTUALIZE_ABOVE = 300

export interface TreeAction {
  label: string
  run: () => void
  danger?: boolean
}

export interface RepositoryTreeProps {
  rows: FlatRow[]
  selectedId?: string
  onSelect: (id: string) => void
  onToggle: (id: string, expanded: boolean) => void
  actionsFor: (node: TreeNode) => TreeAction[]
}

export function RepositoryTree({ rows, selectedId, onSelect, onToggle, actionsFor }: RepositoryTreeProps) {
  const [focusId, setFocusId] = useState<string | undefined>(selectedId ?? rows[0]?.node.id)
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | undefined>()
  const containerRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 600 })
  const now = useNow()

  const index = useMemo(() => new Map(rows.map((r, i) => [r.node.id, i])), [rows])
  const focusIndex = focusId !== undefined ? (index.get(focusId) ?? -1) : -1
  const effectiveFocus = focusIndex >= 0 ? focusId : rows[0]?.node.id

  // Focus follows a selection made elsewhere (e.g. a link in the center pane).
  const [prevSelected, setPrevSelected] = useState(selectedId)
  if (selectedId !== prevSelected) {
    setPrevSelected(selectedId)
    if (selectedId) setFocusId(selectedId)
  }

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setViewport({ top: el.scrollTop, height: el.clientHeight || 600 })
    update()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  const virtual = rows.length > VIRTUALIZE_ABOVE
  const start = virtual ? Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - 20) : 0
  const end = virtual ? Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + 20) : rows.length

  const focusRow = (i: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, i))]
    if (!row) return
    setFocusId(row.node.id)
    const el = containerRef.current
    if (el) {
      const top = rows.indexOf(row) * ROW_HEIGHT
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight
      setViewport({ top: el.scrollTop, height: el.clientHeight || 600 })
    }
    requestAnimationFrame(() => containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(row.node.id)}"]`)?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = effectiveFocus ? (index.get(effectiveFocus) ?? 0) : 0
    const row = rows[i]
    if (!row) return
    switch (e.key) {
      case 'ArrowDown':
        focusRow(i + 1)
        break
      case 'ArrowUp':
        focusRow(i - 1)
        break
      case 'Home':
        focusRow(0)
        break
      case 'End':
        focusRow(rows.length - 1)
        break
      case 'ArrowRight':
        if (row.hasChildren && !row.expanded) onToggle(row.node.id, true)
        else if (row.hasChildren) focusRow(i + 1)
        break
      case 'ArrowLeft':
        if (row.hasChildren && row.expanded) onToggle(row.node.id, false)
        else if (row.parentId) focusRow(index.get(row.parentId) ?? i)
        break
      case 'Enter':
      case ' ':
        onSelect(row.node.id)
        break
      case 'ContextMenu':
        openMenu(row.node)
        break
      case 'F10':
        if (e.shiftKey) openMenu(row.node)
        else return
        break
      default:
        return
    }
    e.preventDefault()
  }

  const openMenu = (node: TreeNode, x?: number, y?: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`)
    const rect = el?.getBoundingClientRect()
    setMenu({ node, x: x ?? (rect ? rect.left + 24 : 40), y: y ?? (rect ? rect.bottom : 40) })
  }

  return (
    <>
      <div
        ref={containerRef}
        className={styles.tree}
        role="tree"
        aria-label="Repositories, branches, worktrees and sessions"
        onKeyDown={onKeyDown}
        onScroll={(e) => virtual && setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      >
        {virtual ? <div style={{ height: start * ROW_HEIGHT }} aria-hidden="true" /> : null}
        {rows.slice(start, end).map((row) => (
          <TreeRow
            key={row.node.id}
            row={row}
            now={now}
            selected={row.node.id === selectedId}
            focused={row.node.id === effectiveFocus}
            onClick={() => {
              setFocusId(row.node.id)
              onSelect(row.node.id)
            }}
            onToggle={() => onToggle(row.node.id, !row.expanded)}
            onContextMenu={(e) => {
              e.preventDefault()
              setFocusId(row.node.id)
              openMenu(row.node, e.clientX, e.clientY)
            }}
          />
        ))}
        {virtual ? <div style={{ height: (rows.length - end) * ROW_HEIGHT }} aria-hidden="true" /> : null}
      </div>
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          actions={actionsFor(menu.node)}
          onClose={() => {
            setMenu(undefined)
            containerRef.current?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(menu.node.id)}"]`)?.focus()
          }}
        />
      ) : null}
    </>
  )
}

const KIND_ICONS = {
  repo: FolderGit2,
  branch: GitBranch,
  remote: Cloud,
  worktree: MonitorDot,
  session: Bot,
  'group-detached': GitFork,
  'group-idle-branches': GitBranch,
  'group-remote-only': Cloud,
  'group-unassigned': Inbox,
  'group-global-unassigned': Inbox,
} as const

function TreeRow({
  row,
  now,
  selected,
  focused,
  onClick,
  onToggle,
  onContextMenu,
}: {
  row: FlatRow
  now: number
  selected: boolean
  focused: boolean
  onClick: () => void
  onToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { node } = row
  const Icon = KIND_ICONS[node.kind]
  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-posinset={row.posInSet}
      aria-setsize={row.setSize}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      aria-label={rowAriaLabel(node)}
      data-node-id={node.id}
      data-kind={node.kind}
      className={`${styles.row} ${selected ? styles.selected : ''}`}
      style={{ paddingLeft: 6 + row.depth * 14 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={rowTitle(node)}
    >
      <span
        className={styles.twisty}
        aria-hidden="true"
        onClick={(e) => {
          if (!row.hasChildren) return
          e.stopPropagation()
          onToggle()
        }}
      >
        {row.hasChildren ? row.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
      </span>
      <Icon size={13} className={styles.icon} aria-hidden="true" />
      {node.kind === 'session' && node.session ? (
        <span className={styles.provider}>{node.session.provider === 'claude' ? 'Claude' : 'Codex'}</span>
      ) : null}
      <span className={`${styles.label} ${node.kind === 'worktree' || node.kind === 'branch' || node.kind === 'remote' ? 'mono' : ''} ${node.session?.historical ? styles.historical : ''}`}>
        {node.label}
      </span>
      {node.count !== undefined ? <span className={styles.count}>{node.count}</span> : null}
      <RowMeta node={node} now={now} />
    </div>
  )
}

/** Deliberate accessible names: kind, state and review in words (color is never the only signal). */
function rowAriaLabel(node: TreeNode): string {
  if (node.repo) return `${node.label} repository${node.repo.scanState === 'error' ? ', scan error' : ''}`
  if (node.branch) return `${node.label} ${node.kind === 'remote' ? 'remote ref' : 'branch'}${node.branch.upstream?.gone ? ', upstream gone' : ''}`
  if (node.worktree) {
    const w = node.worktree
    const st = w.status
    const status = w.missing
      ? 'directory missing'
      : st.state === 'ok'
        ? [
            st.gitOperation && `${st.gitOperation} in progress`,
            st.conflicted && `${st.conflicted} conflicted`,
            st.staged && `${st.staged} staged`,
            st.unstaged && `${st.unstaged} unstaged`,
            st.untracked && `${st.untracked} untracked`,
          ]
            .filter(Boolean)
            .join(', ') || 'clean'
        : st.state
    return `${node.label} worktree, ${status}`
  }
  if (node.session) {
    const sess = node.session
    const review = node.annotation && node.annotation.review !== 'unreviewed' ? `, review: ${REVIEW_LABELS[node.annotation.review]}` : ''
    return `${node.label}, ${sess.provider === 'claude' ? 'Claude Code' : 'Codex'} session, ${stateLabel(sess.state)}${review}${sess.historical ? ', historical' : ''}`
  }
  return `${node.label} (${node.count ?? node.children.length})`
}

function rowTitle(node: TreeNode): string | undefined {
  if (node.worktree) return node.worktree.path
  if (node.branch) return node.branch.fullRef
  if (node.repo) return node.repo.primaryPath
  if (node.session) return `${node.session.title} (${node.session.providerSessionId})`
  return undefined
}

function RowMeta({ node, now }: { node: TreeNode; now: number }) {
  if (node.repo?.scanState === 'error') return <Badge tone="danger">error</Badge>
  if (node.branch) {
    const b = node.branch
    return (
      <span className={styles.meta}>
        {b.upstream?.gone ? <Badge tone="warning" title="Configured upstream no longer exists locally">gone</Badge> : null}
        {b.upstream && !b.upstream.gone && (b.upstream.ahead || b.upstream.behind) ? (
          <span className="mono" title="Ahead / behind the configured upstream (local refs; not fetched)">
            {b.upstream.ahead ? `↑${b.upstream.ahead}` : ''}
            {b.upstream.behind ? `↓${b.upstream.behind}` : ''}
          </span>
        ) : null}
        {b.kind === 'local' && !b.upstream ? <span className={styles.dim}>local</span> : null}
        {node.pullRequests?.slice(0, 1).map((pr) => (
          <Badge key={pr.id} tone="info" title={`${pr.title} — remote metadata fetched ${pr.fetchedAt}`}>
            PR #{pr.number} → {pr.baseRef}
          </Badge>
        ))}
      </span>
    )
  }
  if (node.worktree) {
    const w = node.worktree
    const s = w.status
    if (w.missing) return <Badge tone="danger">missing</Badge>
    return (
      <span className={styles.meta}>
        {s.gitOperation ? <Badge tone="warning">{s.gitOperation.replace('_', '-')}</Badge> : null}
        {s.conflicted ? <Badge tone="danger">{s.conflicted} conflict{s.conflicted > 1 ? 's' : ''}</Badge> : null}
        {s.state === 'error' ? <Badge tone="danger">status error</Badge> : null}
        {s.state === 'ok' && !s.conflicted ? (
          s.staged + s.unstaged + s.untracked === 0 ? (
            <span className={styles.dim}>clean</span>
          ) : (
            <span className="mono" title={`${s.staged} staged, ${s.unstaged} unstaged, ${s.untracked} untracked`}>
              {s.staged ? `+${s.staged}` : ''} {s.unstaged ? `~${s.unstaged}` : ''} {s.untracked ? `?${s.untracked}` : ''}
            </span>
          )
        ) : null}
        {w.locked ? <Badge tone="neutral">locked</Badge> : null}
        {w.prunable ? <Badge tone="warning">prunable</Badge> : null}
      </span>
    )
  }
  if (node.session) {
    const s = node.session
    return (
      <span className={styles.meta}>
        {node.annotation ? <ReviewBadge review={node.annotation.review} /> : null}
        {node.annotation && node.annotation.checklistOpen > 0 ? (
          <span className="mono" title={`${node.annotation.checklistOpen} open checklist items`}>☐{node.annotation.checklistOpen}</span>
        ) : null}
        <StatusIndicator state={s.state} compact />
        <span className={styles.age}>{formatAge(s.lastActivityAt, now)}</span>
      </span>
    )
  }
  return null
}

function ContextMenu({ x, y, actions, onClose }: { x: number; y: number; actions: TreeAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])
  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      items[(i + 1) % items.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i - 1 + items.length) % items.length]?.focus()
    }
  }
  return (
    <div
      ref={ref}
      role="menu"
      className={styles.menu}
      style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 40 - actions.length * 28) }}
      onKeyDown={onKeyDown}
    >
      {actions.length === 0 ? <div className={styles.menuEmpty}>No actions</div> : null}
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={`${styles.menuItem} ${a.danger ? styles.menuDanger : ''}`}
          onClick={() => {
            onClose()
            a.run()
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

export function reviewActions(set: (r: ReviewState) => void): TreeAction[] {
  return (['needs_review', 'reviewed', 'complete', 'flagged', 'unreviewed'] as ReviewState[]).map((r) => ({
    label: `Mark: ${REVIEW_LABELS[r]}`,
    run: () => set(r),
  }))
}
