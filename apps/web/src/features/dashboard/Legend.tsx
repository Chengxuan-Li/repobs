import type { ReactNode } from 'react'
import { ACTIVITY_DETAIL_ZOOM } from '../../app/viewState'
import { Dialog } from '../../components/primitives'
import type { AxisMode } from './timeline'
import styles from './legend.module.css'

// Help → Legend and controls: what every mark on the dashboard means, and how to move around it.
// Shapes and line styles carry the meaning; colours repeat it.

const fill = (token: string) => ({ fill: `var(${token})` })

const AXIS_NOTES: Record<AxisMode, [string, string]> = {
  sequence: ['Commit order', 'Commits and agent starts and ends in the order they happened, evenly spaced. Dates are labels, not distances.'],
  time: ['Calendar time', 'Distances are proportional to elapsed time.'],
  compressed: ['Calendar, compressed', 'Gaps follow elapsed time, but items close together are pushed apart to a minimum spacing.'],
}

const MOUSE: Array<[string, string]> = [
  ['Wheel over the history', 'Zoom the history around the pointer'],
  ['Drag', 'Pan the history and the rows'],
  ['Shift + wheel, or swipe sideways', 'Scroll sideways'],
  ['Ctrl + wheel, or pinch', 'Make the whole interface larger or smaller'],
  ['Hover a commit, branch, bar or agent', 'Show its details (in the lanes after half a second)'],
  ['Click an agent', 'Open it in the details panel'],
  ['Click an agent’s status', 'Set your review state'],
  ['Click a checklist pill', 'Open the agent’s checklist'],
  ['Click a count pill on a branch', 'Show the quiet commits it folds'],
  ['Click a bar in Activity', 'Show the amounts, then the shares, then close'],
]

const KEYS: Array<[string, string]> = [
  ['Ctrl+K', 'Search commands'],
  ['↑ / ↓, Home / End', 'Move between rows (dashboard focused)'],
  ['→ / ←', 'Show / hide the agents an agent spawned'],
  ['Enter', 'Open the focused row in the details panel'],
  ['+ / − / 0', 'Zoom the history in / out / reset (dashboard focused)'],
  ['Ctrl+B / Ctrl+Alt+B', 'Show or hide the repositories / details panel'],
  ['Ctrl+Alt+U', 'Show or hide the automation panel'],
  ['Ctrl+Alt+N', 'Open a new view'],
  ['Ctrl+= / Ctrl+− / Ctrl+0', 'Interface size larger / smaller / reset'],
  ['F6 / Shift+F6', 'Move to the next / previous group of tabs'],
  ['Esc', 'Close dialogs, menus and lists'],
]

export function LegendDialog({ axisMode, onClose }: { axisMode: AxisMode; onClose: () => void }) {
  return (
    <Dialog title="Legend and controls" onClose={onClose} wide>
      <div className={styles.dialog}>
        <section aria-label="Commits and branches">
          <h3 className={styles.heading}>Commits and branches</h3>
          <div className={styles.items}>
            <Item label="Commit, pushed">
              <circle cx="10" cy="8" r="4" className={styles.pushed} />
            </Item>
            <Item label="Commit only on this computer, not pushed">
              <line x1="0" y1="8" x2="6" y2="8" className={styles.edgeLocal} />
              <circle cx="11" cy="8" r="4" className={styles.local} />
            </Item>
            <Item label="Commit on the upstream, not pulled">
              <circle cx="10" cy="8" r="4" className={styles.incoming} />
            </Item>
            <Item label="Branch head">
              <circle cx="10" cy="8" r="5" className={styles.pushed} />
            </Item>
            <Item label="Uncommitted changes (red: conflicts)">
              <rect x="5" y="3" width="9" height="9" transform="rotate(45 9.5 7.5)" className={styles.pending} />
            </Item>
            <Item label="Branched from, or merged into, another branch">
              <path d="M2,2 V9 Q2,13 6,13 H18" className={styles.fork} fill="none" />
            </Item>
            <Item label="Connectors sharing a path, drawn side by side">
              <path d="M2,2 V8 Q2,12 6,12 H18" className={styles.fork} fill="none" />
              <path d="M6,2 V4 Q6,8 10,8 H18" className={styles.fork} fill="none" />
            </Item>
            <Item label="Branch with no commits of its own, pointing at a commit">
              <path d="M2,2 V8 Q2,12 6,12 H12" className={styles.fork} fill="none" strokeDasharray="2 2" />
              <circle cx="16" cy="12" r="3" className={styles.local} style={{ stroke: 'var(--color-accent)' }} />
            </Item>
            <Item label="Quiet commits folded into one (count)">
              <rect x="1" y="3" width="18" height="10" rx="5" className={styles.group} />
            </Item>
            <Item label="Now">
              <line x1="10" y1="0" x2="10" y2="16" className={styles.now} />
            </Item>
          </div>
        </section>

        <section aria-label="Agents">
          <h3 className={styles.heading}>Agents</h3>
          <div className={styles.items}>
            <Item label="Agent line: solid while working, dotted between (colour = status)">
              <rect x="1" y="5" width="6" height="6" className={styles.barWorking} />
              <line x1="8" x2="13" y1="8" y2="8" className={styles.idle} />
              <rect x="13" y="5" width="6" height="6" className={styles.barAttention} />
            </Item>
            <Item label="A tick per tool call">
              <rect x="1" y="5" width="18" height="6" className={styles.barWorking} />
              <path d="M5,3 V13 M9,3 V13 M10,3 V13 M15,3 V13" stroke="var(--color-text)" strokeOpacity="0.55" />
            </Item>
            <Item label="Agent card: name, last activity, status">
              <rect x="1" y="6" width="5" height="5" className={styles.barWorking} />
              <rect x="8.5" y="3.5" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
            </Item>
            <Item label="Active before the start of the history range">
              <path d="M2,8 L8,4 L8,12 Z" className={styles.barWorking} />
              <line x1="10" x2="19" y1="8" y2="8" className={styles.idle} />
            </Item>
            <Item label="Spawned by the agent above">
              <path d="M4,0 V9 H12" className={styles.spawn} fill="none" />
            </Item>
            <Item label="Line height: context used (Agents → Agent line)">
              <path d="M1,9.5 V6.5 H7 V4.5 H13 V2 H19 V14 H13 V11.5 H7 V9.5 Z" className={styles.barWorking} />
            </Item>
          </div>
          <p className={styles.note}>
            Status colours: blue working, amber needs input or review, red flagged, green complete, grey unreviewed or unknown.
          </p>
        </section>

        <section aria-label="Activity detail">
          <h3 className={styles.heading}>Activity detail</h3>
          <p className={styles.note}>From {ACTIVITY_DETAIL_ZOOM * 100} % zoom, or with Agents → Activity detail → Always.</p>
          <div className={styles.items}>
            <Item label="Model responding; darker with thinking">
              <rect x="1" y="4" width="8" height="8" style={fill('--activity-model')} />
              <rect x="11" y="4" width="8" height="8" style={fill('--activity-thinking')} />
            </Item>
            <Item label="Read or search">
              <rect x="1" y="4" width="18" height="8" style={fill('--activity-read')} />
            </Item>
            <Item label="Edit">
              <rect x="1" y="4" width="18" height="8" style={fill('--activity-edit')} />
            </Item>
            <Item label="Shell; hatched: tests and builds">
              <rect x="1" y="4" width="8" height="8" style={fill('--activity-shell')} />
              <rect x="11" y="4" width="8" height="8" style={fill('--activity-shell')} />
              <path d="M11,8 l4,-4 M11,12 l8,-8 M15,12 l4,-4" stroke="var(--color-bg)" strokeWidth="1.5" />
            </Item>
            <Item label="Other tools: web, MCP, agents, plan, questions">
              <rect x="1" y="4" width="18" height="8" style={fill('--activity-other')} />
            </Item>
            <Item label="Git change / Git inspection">
              <rect x="2.5" y="4.5" width="6" height="6" transform="rotate(45 5.5 7.5)" fill="var(--color-text)" />
              <circle cx="15" cy="8" r="3" fill="var(--color-bg)" stroke="var(--color-text)" strokeWidth="1.5" />
            </Item>
            <Item label="New prompt / failed tool call / error">
              <line x1="3" y1="2" x2="3" y2="14" stroke="var(--color-text)" strokeWidth="1.5" />
              <rect x="6" y="11" width="6" height="2" fill="var(--tone-danger-text)" />
              <path d="M14,5 l5,5 m0,-5 l-5,5" stroke="var(--tone-danger-text)" strokeWidth="1.5" />
            </Item>
            <Item label="Context compacted">
              <line x1="10" y1="1" x2="10" y2="15" stroke="var(--color-text-muted)" strokeWidth="1" strokeDasharray="2 2" />
            </Item>
          </div>
        </section>

        <section aria-label="Timeline">
          <h3 className={styles.heading}>Timeline</h3>
          <dl className={styles.axes}>
            {(Object.keys(AXIS_NOTES) as AxisMode[]).map((mode) => (
              <div key={mode}>
                <dt>
                  {AXIS_NOTES[mode][0]}
                  {mode === axisMode ? <span className={styles.currentTag}>this view</span> : null}
                </dt>
                <dd>{AXIS_NOTES[mode][1]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-label="Controls">
          <h3 className={styles.heading}>Controls</h3>
          <div className={styles.tables}>
            <Table caption="Mouse" rows={MOUSE} />
            <Table caption="Keyboard" rows={KEYS} />
          </div>
        </section>
      </div>
    </Dialog>
  )
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className={styles.item}>
      <svg width="20" height="16" aria-hidden="true">
        {children}
      </svg>
      {label}
    </span>
  )
}

function Table({ caption, rows }: { caption: string; rows: Array<[string, string]> }) {
  return (
    <table className={styles.table}>
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([input, action]) => (
          <tr key={input}>
            <th scope="row">{input}</th>
            <td>{action}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
