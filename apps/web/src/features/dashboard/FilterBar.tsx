import { Search } from 'lucide-react'
import { PROVIDER_LABELS, type Provider, REVIEW_LABELS, type ReviewState, WORKFLOW_LABELS, WORKFLOW_STATUSES, type WorkflowStatus } from '@repobs/contracts'
import type { TimeRange, ViewPatch, ViewState } from '../../app/viewState'
import { Dropdown, type DropdownSection } from '../../components/Dropdown'
import { ReviewDot } from '../../components/primitives'
import { TagInput } from '../annotations/TagInput'
import { DEFAULT_FILTERS, filtersActive, LAST_MESSAGE_OPTIONS } from './filters'
import type { BranchMode } from './layout'
import type { AxisMode } from './timeline'
import styles from './dashboard.module.css'

// Filters on the left (which agents are shown), display options on the right (how the history is
// drawn); each group is a dropdown so the bar stays one line.

const HARNESSES = Object.keys(PROVIDER_LABELS) as Provider[]
const STATUSES: WorkflowStatus[] = WORKFLOW_STATUSES
const REVIEWS = Object.keys(REVIEW_LABELS) as ReviewState[]
const BRANCH_MODES: Array<[BranchMode, string]> = [
  ['all', 'All branches'],
  ['checked_out', 'Checked out'],
  ['with_agents', 'With agents'],
]
const AXIS_MODES: Array<[AxisMode, string]> = [
  ['sequence', 'Commit order'],
  ['time', 'Calendar time'],
  ['compressed', 'Calendar, compressed'],
]
const TIME_RANGES: Array<[TimeRange, string]> = [
  ['1d', '24 hours'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
  ['365d', '1 year'],
  ['all', 'All loaded'],
]

/** "Any" when nothing is chosen, otherwise the choices (or their count when there are many). */
function summary(chosen: string[]): string {
  if (!chosen.length) return 'Any'
  return chosen.length <= 2 ? chosen.join(', ') : `${chosen.length} selected`
}

/**
 * A multiple-choice filter where no choice means "any": an "Any" item, then one check box per
 * option. Choosing every option is the same as "any", so it resets to that.
 */
function multiSelect<T extends string>(heading: string, options: T[], labels: Record<T, string>, chosen: T[], set: (next: T[]) => void): DropdownSection[] {
  const toggle = (o: T) => {
    const next = chosen.includes(o) ? chosen.filter((x) => x !== o) : options.filter((x) => x === o || chosen.includes(x))
    set(next.length === options.length ? [] : next)
  }
  return [
    {
      items: [
        {
          type: 'radio',
          label: `Any ${heading.toLowerCase()}`,
          checked: !chosen.length,
          onSelect: () => set([]),
        },
      ],
    },
    {
      heading: 'Only',
      items: options.map((o) => ({
        type: 'check' as const,
        label: labels[o],
        checked: chosen.includes(o),
        onToggle: () => toggle(o),
      })),
    },
  ]
}

function hiddenSummary(byHand: number, reviews: ReviewState[]): string {
  const parts = [...reviews.map((r) => REVIEW_LABELS[r]), ...(byHand ? [`${byHand} by hand`] : [])]
  return parts.length <= 2 ? parts.join(', ') : `${parts.length} rules`
}

export function FilterBar({
  view,
  setView,
  knownTags,
  repositories,
  agentTitle,
  shown,
  total,
}: {
  view: ViewState
  setView: (patch: ViewPatch) => void
  knownTags: string[]
  /** Every registered repository; the view shows those it does not hide. */
  repositories: Array<{ id: string; name: string }>
  /** Name of an agent hidden by hand (its alias or title). */
  agentTitle: (sessionId: string) => string
  shown: number
  total: number
}) {
  const f = view.filters
  const setFilters = (patch: Partial<ViewState['filters']>) => setView((v) => ({ filters: { ...v.filters, ...patch } }))
  const lastMessage = LAST_MESSAGE_OPTIONS.find((o) => o.days === f.lastMessageDays) ?? LAST_MESSAGE_OPTIONS[0]!

  return (
    <div className={styles.filterBar} role="region" aria-label="Filters and view options">
      <div className={styles.filterRow}>
        <div className={styles.filterGroup} role="group" aria-label="Filters">
          <div className={styles.search}>
            <Search size={13} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search agents"
              placeholder="Search agents"
              value={f.query}
              onChange={(e) => setFilters({ query: e.target.value })}
            />
          </div>
          <Dropdown
            label="Harness"
            value={summary(f.harnesses.map((h) => PROVIDER_LABELS[h]))}
            active={f.harnesses.length > 0}
            sections={multiSelect('Harness', HARNESSES, PROVIDER_LABELS, f.harnesses, (harnesses) => setFilters({ harnesses }))}
          />
          <Dropdown
            label="Status"
            value={summary(f.statuses.map((s) => WORKFLOW_LABELS[s]))}
            active={f.statuses.length > 0}
            sections={multiSelect('Status', STATUSES, WORKFLOW_LABELS, f.statuses, (statuses) => setFilters({ statuses }))}
          />
          <Dropdown
            label="Last message"
            value={lastMessage.label}
            active={f.lastMessageDays !== null}
            sections={[
              {
                items: LAST_MESSAGE_OPTIONS.map((o) => ({
                  type: 'radio' as const,
                  label: o.label,
                  checked: o.days === f.lastMessageDays,
                  onSelect: () => setFilters({ lastMessageDays: o.days }),
                })),
              },
            ]}
          />
          <Dropdown label="Tags" value={summary(f.tags)} active={f.tags.length > 0}>
            <TagInput value={f.tags} known={knownTags} onChange={(tags) => setFilters({ tags })} label="Filter by tags" placeholder="Filter by tag…" />
            <p className="small muted">Agents with any of these tags.</p>
          </Dropdown>
          <Dropdown
            label="Hidden"
            value={f.hiddenAgents.length + f.hiddenReviews.length ? hiddenSummary(f.hiddenAgents.length, f.hiddenReviews) : 'None'}
            active={f.hiddenAgents.length + f.hiddenReviews.length > 0}
          >
            <fieldset className={styles.hiddenGroup}>
              <legend className="label">Hide agents marked</legend>
              {REVIEWS.map((r) => (
                <label key={r} className={styles.hiddenCheck}>
                  <input
                    type="checkbox"
                    checked={f.hiddenReviews.includes(r)}
                    onChange={(e) => setFilters({ hiddenReviews: e.target.checked ? REVIEWS.filter((x) => x === r || f.hiddenReviews.includes(x)) : f.hiddenReviews.filter((x) => x !== r) })}
                  />
                  <ReviewDot review={r} />
                  {REVIEW_LABELS[r]}
                </label>
              ))}
            </fieldset>
            <div className={styles.hiddenGroup}>
              <span className="label">Hidden by hand</span>
              {f.hiddenAgents.length ? (
                <>
                  <ul className={styles.hiddenList} aria-label="Agents hidden by hand">
                    {f.hiddenAgents.map((id) => (
                      <li key={id}>
                        <span className={styles.hiddenName}>{agentTitle(id)}</span>
                        <button type="button" className="btn btn-quiet" onClick={() => setFilters({ hiddenAgents: f.hiddenAgents.filter((x) => x !== id) })}>
                          Show
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn" onClick={() => setFilters({ hiddenAgents: [] })}>
                    Show all {f.hiddenAgents.length}
                  </button>
                </>
              ) : (
                <p className="small muted">None. Use “Hide from this view” in an agent’s status menu.</p>
              )}
            </div>
            <p className="small muted">Hiding changes this view only; the agents and your notes stay as they are.</p>
          </Dropdown>
          <span className="small muted" aria-live="polite">
            {shown === total ? `${total} agents` : `${shown} of ${total} agents`}
          </span>
          {filtersActive(f) ? (
            <button type="button" className="btn btn-quiet" onClick={() => setView({ filters: DEFAULT_FILTERS })}>
              Clear filters
            </button>
          ) : null}
        </div>
        <div className={styles.filterGroup} role="group" aria-label="View options">
          <Dropdown
            label="Repositories"
            value={
              view.hiddenRepos.length === 0
                ? 'All'
                : `${repositories.filter((r) => !view.hiddenRepos.includes(r.id)).length} of ${repositories.length}`
            }
            active={view.hiddenRepos.length > 0}
            sections={[
              { items: [{ type: 'radio', label: 'All repositories', checked: view.hiddenRepos.length === 0, onSelect: () => setView({ hiddenRepos: [] }) }] },
              {
                heading: 'Shown in this view',
                items: repositories.map((r) => ({
                  type: 'check' as const,
                  label: r.name,
                  checked: !view.hiddenRepos.includes(r.id),
                  onToggle: () => setView((v) => ({ hiddenRepos: v.hiddenRepos.includes(r.id) ? v.hiddenRepos.filter((x) => x !== r.id) : [...v.hiddenRepos, r.id] })),
                })),
              },
            ]}
          />
          <Dropdown
            label="Branches"
            value={BRANCH_MODES.find(([m]) => m === view.branchMode)?.[1]}
            sections={[
              {
                heading: 'Show',
                items: BRANCH_MODES.map(([m, label]) => ({
                  type: 'radio' as const,
                  label,
                  checked: view.branchMode === m,
                  onSelect: () => setView({ branchMode: m }),
                })),
              },
              {
                items: [
                  {
                    type: 'check',
                    label: 'Remote-only branches',
                    checked: view.showRemoteOnly,
                    onToggle: () => setView((v) => ({ showRemoteOnly: !v.showRemoteOnly })),
                  },
                  {
                    type: 'check',
                    label: 'Collapse quiet commits',
                    checked: view.collapseQuiet,
                    onToggle: () =>
                      setView((v) => ({
                        collapseQuiet: !v.collapseQuiet,
                        expandedGroups: [],
                      })),
                  },
                ],
              },
            ]}
          />
          <Dropdown
            label="Agents"
            sections={[
              {
                items: [
                  {
                    type: 'check',
                    label: 'Collapse spawned agents',
                    checked: view.collapseSpawned,
                    onToggle: () => setView((v) => ({ collapseSpawned: !v.collapseSpawned, toggledAgents: [] })),
                  },
                  {
                    type: 'check',
                    label: 'Agent names in list',
                    checked: view.agentNames,
                    onToggle: () => setView((v) => ({ agentNames: !v.agentNames })),
                  },
                  {
                    type: 'check',
                    label: 'Agent labels on timeline',
                    checked: view.barLabels,
                    onToggle: () => setView((v) => ({ barLabels: !v.barLabels })),
                  },
                ],
              },
            ]}
          />
          <Dropdown
            label="Timeline"
            value={AXIS_MODES.find(([m]) => m === view.axisMode)?.[1]}
            sections={[
              {
                heading: 'Axis',
                items: AXIS_MODES.map(([m, label]) => ({
                  type: 'radio' as const,
                  label,
                  checked: view.axisMode === m,
                  onSelect: () => setView({ axisMode: m }),
                })),
              },
              {
                heading: 'History',
                items: TIME_RANGES.map(([r, label]) => ({
                  type: 'radio' as const,
                  label,
                  checked: view.timeRange === r,
                  onSelect: () => setView({ timeRange: r }),
                })),
              },
            ]}
          />
          <button type="button" className="btn btn-quiet" aria-pressed={view.legendOpen} onClick={() => setView({ legendOpen: !view.legendOpen })}>
            {view.legendOpen ? 'Hide legend' : 'Legend'}
          </button>
        </div>
      </div>
    </div>
  )
}
