import { Search } from 'lucide-react'
import { PROVIDER_LABELS, type Provider, WORKFLOW_LABELS, type WorkflowStatus } from '@repobs/contracts'
import type { TimeRange, ViewState } from '../../app/viewState'
import { Dropdown, type DropdownSection } from '../../components/Dropdown'
import { TagInput } from '../annotations/TagInput'
import { DEFAULT_FILTERS, filtersActive, LAST_MESSAGE_OPTIONS } from './filters'
import type { BranchMode } from './layout'
import type { AxisMode } from './timeline'
import styles from './dashboard.module.css'

// Filters on the left (which agents are shown), display options on the right (how the history is
// drawn); each group is a dropdown so the bar stays one line.

const HARNESSES = Object.keys(PROVIDER_LABELS) as Provider[]
const STATUSES: WorkflowStatus[] = ['needs_input', 'working', 'needs_review', 'unreviewed', 'complete', 'unknown']
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
                    label: 'Hide spawned agents',
                    checked: !view.showSpawned,
                    onToggle: () => setView((v) => ({ showSpawned: !v.showSpawned })),
                  },
                  {
                    type: 'check',
                    label: 'Expand agent details',
                    checked: view.details,
                    onToggle: () => setView((v) => ({ details: !v.details })),
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
