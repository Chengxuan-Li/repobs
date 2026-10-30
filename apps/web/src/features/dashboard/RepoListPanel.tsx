import { Plus } from 'lucide-react'
import type { Repository } from '@repobs/contracts'
import { formatAge } from '../../components/primitives'
import styles from './dashboard.module.css'

export interface RepoSummary {
  repo: Repository
  lastActivity: number
  agents: number
  active: number
  attention: number
}

// Left side panel: which repositories are open on the dashboard, in dashboard order.

export function RepoListPanel({
  summaries,
  hidden,
  now,
  onToggle,
  onJump,
  onAdd,
  onRemove,
}: {
  summaries: RepoSummary[]
  hidden: Set<string>
  now: number
  onToggle: (id: string, visible: boolean) => void
  onJump: (id: string) => void
  onAdd: () => void
  onRemove: (repo: Repository) => void
}) {
  return (
    <div className={styles.repoList}>
      <div className="section-strip">
        <span className="label">Repositories</span>
        <button type="button" className="btn btn-quiet" onClick={onAdd}>
          <Plus size={13} aria-hidden="true" /> Add
        </button>
      </div>
      {summaries.length === 0 ? <p className="small muted" style={{ padding: 12 }}>No repositories yet.</p> : null}
      <ul className={styles.repoItems}>
        {summaries.map((s) => (
          <li key={s.repo.id} className={styles.repoItem}>
            <input type="checkbox" checked={!hidden.has(s.repo.id)} onChange={(e) => onToggle(s.repo.id, e.target.checked)} aria-label={`Show ${s.repo.displayName} on the dashboard`} />
            <button type="button" className={styles.repoJump} onClick={() => onJump(s.repo.id)} disabled={hidden.has(s.repo.id)} title={hidden.has(s.repo.id) ? 'Hidden from the dashboard' : s.repo.primaryPath}>
              <span className={styles.repoItemName}>{s.repo.displayName}</span>
              <span className="mono small muted">
                {s.agents} agents{s.active ? ` · ${s.active} active` : ''} · {s.lastActivity ? formatAge(new Date(s.lastActivity).toISOString(), now) : '—'}
              </span>
            </button>
            {s.attention ? (
              <span className={styles.attentionDot} title={`${s.attention} need attention`}>
                {s.attention}
              </span>
            ) : null}
            <button type="button" className="btn btn-quiet btn-icon btn-danger" aria-label={`Remove ${s.repo.displayName} from the dashboard`} title="Remove from dashboard (no files are touched)" onClick={() => onRemove(s.repo)}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
