import { Search } from 'lucide-react'
import { WORKFLOW_LABELS, type WorkflowStatus } from '@repobs/contracts'
import type { RepoSort, TimeRange, ViewState } from '../../app/viewState'
import { TagInput } from '../annotations/TagInput'
import { DEFAULT_FILTERS, filtersActive, LAST_MESSAGE_OPTIONS } from './filters'
import type { BranchMode } from './layout'
import type { AxisMode } from './timeline'
import styles from './dashboard.module.css'

const STATUSES: WorkflowStatus[] = ['needs_input', 'working', 'needs_review', 'ready', 'complete', 'unknown']

export function FilterBar({
  view,
  setView,
  knownTags,
  shown,
  total,
}: {
  view: ViewState
  setView: (patch: Partial<ViewState> | ((v: ViewState) => Partial<ViewState>)) => void
  knownTags: string[]
  shown: number
  total: number
}) {
  const f = view.filters
  const setFilters = (patch: Partial<ViewState['filters']>) => setView((v) => ({ filters: { ...v.filters, ...patch } }))
  const toggleStatus = (s: WorkflowStatus) => setFilters({ statuses: f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] })
  return (
    <div className={styles.filterBar} role="region" aria-label="Filters and view options">
      <div className={styles.filterRow}>
        <div className={styles.search}>
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search agents"
            placeholder="Search titles, aliases, tags, messages"
            value={f.query}
            onChange={(e) => setFilters({ query: e.target.value })}
          />
        </div>
        <fieldset className={styles.chips}>
          <legend className="visually-hidden">Harness</legend>
          <label className={styles.chip}>
            <input type="checkbox" checked={f.claude} onChange={(e) => setFilters({ claude: e.target.checked })} /> Claude Code
          </label>
          <label className={styles.chip}>
            <input type="checkbox" checked={f.codex} onChange={(e) => setFilters({ codex: e.target.checked })} /> Codex
          </label>
        </fieldset>
        <label className={styles.inline}>
          <span className="label">Last message</span>
          <select className="input" value={f.lastMessageDays ?? ''} onChange={(e) => setFilters({ lastMessageDays: e.target.value ? Number(e.target.value) : null })}>
            {LAST_MESSAGE_OPTIONS.map((o) => (
              <option key={o.label} value={o.days ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.tagFilter}>
          <TagInput value={f.tags} known={knownTags} onChange={(tags) => setFilters({ tags })} label="Filter by tags" placeholder="Filter by tag…" />
        </div>
        <span className={styles.spacer} />
        <span className="small muted" aria-live="polite">
          {shown === total ? `${total} agents` : `${shown} of ${total} agents`}
        </span>
        {filtersActive(f) ? (
          <button type="button" className="btn btn-quiet" onClick={() => setView({ filters: DEFAULT_FILTERS })}>
            Clear filters
          </button>
        ) : null}
      </div>
      <div className={styles.filterRow}>
        <fieldset className={styles.chips}>
          <legend className="label">Status</legend>
          {STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={f.statuses.includes(s)} className={`${styles.chipButton} ${f.statuses.includes(s) ? styles.on : ''}`} onClick={() => toggleStatus(s)}>
              {WORKFLOW_LABELS[s]}
            </button>
          ))}
        </fieldset>
        <span className={styles.spacer} />
        <label className={styles.chip}>
          <input type="checkbox" checked={view.details} onChange={(e) => setView({ details: e.target.checked })} /> Expand agent details
        </label>
        <label className={styles.chip}>
          <input type="checkbox" checked={!view.showSpawned} onChange={(e) => setView({ showSpawned: !e.target.checked })} /> Hide spawned agents
        </label>
        <label className={styles.chip}>
          <input type="checkbox" checked={view.showRemoteOnly} onChange={(e) => setView({ showRemoteOnly: e.target.checked })} /> Remote-only branches
        </label>
        <label className={styles.inline}>
          <span className="label">Branches</span>
          <select className="input" value={view.branchMode} onChange={(e) => setView({ branchMode: e.target.value as BranchMode })}>
            <option value="all">All</option>
            <option value="checked_out">Checked out</option>
            <option value="with_agents">With agents</option>
          </select>
        </label>
        <label className={styles.inline}>
          <span className="label">Axis</span>
          <select className="input" value={view.axisMode} onChange={(e) => setView({ axisMode: e.target.value as AxisMode })}>
            <option value="sequence">Commit order</option>
            <option value="time">Calendar time</option>
          </select>
        </label>
        <label className={styles.inline}>
          <span className="label">History</span>
          <select className="input" value={view.timeRange} onChange={(e) => setView({ timeRange: e.target.value as TimeRange })}>
            <option value="1d">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="90d">90 days</option>
            <option value="365d">1 year</option>
            <option value="all">All loaded</option>
          </select>
        </label>
        <label className={styles.inline}>
          <span className="label">Sort repos</span>
          <select className="input" value={view.repoSort} onChange={(e) => setView({ repoSort: e.target.value as RepoSort })}>
            <option value="activity">Last activity</option>
            <option value="active">Active agents</option>
            <option value="name">Name</option>
            <option value="manual">Manual order</option>
          </select>
        </label>
        <button type="button" className="btn btn-quiet" aria-pressed={view.legendOpen} onClick={() => setView({ legendOpen: !view.legendOpen })}>
          {view.legendOpen ? 'Hide legend' : 'Legend'}
        </button>
      </div>
    </div>
  )
}
