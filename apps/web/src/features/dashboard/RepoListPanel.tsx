import { ArrowUpDown, Plus } from 'lucide-react'
import type { Repository } from '@repobs/contracts'
import type { RepoSort } from '../../app/viewState'
import { Dropdown } from '../../components/Dropdown'
import { formatAge } from '../../components/primitives'
import styles from './dashboard.module.css'

export interface RepoSummary {
  repo: Repository
  lastActivity: number
  agents: number
  active: number
  attention: number
}

const SORTS: Array<[RepoSort, string]> = [
  ['activity', 'Last activity'],
  ['active', 'Active agents'],
  ['name', 'Name'],
  ['manual', 'Manual order'],
]

// Left side panel: every repository registered in repobs, in dashboard order. Views take their
// repositories from here: the ticks are the current view's selection.

export function RepoListPanel({
  summaries,
  hidden,
  viewName,
  sort,
  now,
  onSort,
  onToggle,
  onJump,
  onAdd,
  onRemove,
}: {
  summaries: RepoSummary[]
  /** Repositories the current view leaves out. */
  hidden: Set<string>
  /** Name of the current view. */
  viewName: string
  sort: RepoSort
  now: number
  onSort: (sort: RepoSort) => void
  onToggle: (id: string, visible: boolean) => void
  onJump: (id: string) => void
  onAdd: () => void
  onRemove: (repo: Repository) => void
}) {
  return (
    <div className={styles.repoList}>
      <div className="section-strip">
        <span className={`label ${styles.stripTitle}`}>Repositories</span>
        <span className={styles.spacer} />
        <Dropdown
          label="Sort"
          icon={ArrowUpDown}
          value={SORTS.find(([s]) => s === sort)?.[1]}
          sections={[{ items: SORTS.map(([s, label]) => ({ type: 'radio' as const, label, checked: s === sort, onSelect: () => onSort(s) })) }]}
        />
        <button type="button" className={`btn btn-quiet ${styles.stripButton}`} onClick={onAdd}>
          <Plus size={13} aria-hidden="true" /> Add
        </button>
      </div>
      {summaries.length === 0 ? (
        <p className="small muted" style={{ padding: 12 }}>
          No repositories yet.
        </p>
      ) : (
        <p className={`small muted ${styles.repoHint}`}>
          Ticked repositories are shown in <strong>{viewName}</strong>.
        </p>
      )}
      <ul className={styles.repoItems}>
        {summaries.map((s) => (
          <li key={s.repo.id} className={styles.repoItem}>
            <input type="checkbox" checked={!hidden.has(s.repo.id)} onChange={(e) => onToggle(s.repo.id, e.target.checked)} aria-label={`Show ${s.repo.displayName} in ${viewName}`} />
            <button
              type="button"
              className={styles.repoJump}
              onClick={() => onJump(s.repo.id)}
              disabled={hidden.has(s.repo.id)}
              title={hidden.has(s.repo.id) ? `Not shown in ${viewName}` : s.repo.primaryPath}
            >
              <span className={styles.repoItemName}>{s.repo.displayName}</span>
              <span className={`mono small muted ${styles.repoStats}`}>
                {s.agents} agents{s.active ? ` · ${s.active} active` : ''} · {s.lastActivity ? formatAge(new Date(s.lastActivity).toISOString(), now) : '—'}
              </span>
            </button>
            {s.attention ? (
              <span className={styles.attentionDot} title={`${s.attention} need attention`}>
                {s.attention}
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-quiet btn-icon btn-danger"
              aria-label={`Remove ${s.repo.displayName} from repobs`}
              title="Remove from repobs (no files are touched)"
              onClick={() => onRemove(s.repo)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
