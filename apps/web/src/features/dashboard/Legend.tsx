import type { AxisMode } from './timeline'
import styles from './legend.module.css'

// What the graph marks mean. Shapes and line styles carry the meaning; colours repeat it.

export function Legend({ axisMode }: { axisMode: AxisMode }) {
  return (
    <div className={styles.legend} role="region" aria-label="Legend">
      <Item label="Commit on a remote branch (pushed)">
        <circle cx="10" cy="8" r="4" className={styles.pushed} />
      </Item>
      <Item label="Local only, not pushed">
        <line x1="0" y1="8" x2="6" y2="8" className={styles.edgeLocal} />
        <circle cx="11" cy="8" r="4" className={styles.local} />
      </Item>
      <Item label="On the upstream, not pulled">
        <circle cx="10" cy="8" r="4" className={styles.incoming} />
      </Item>
      <Item label="Branch head">
        <circle cx="10" cy="8" r="5" className={styles.pushed} />
      </Item>
      <Item label="Uncommitted changes (red: conflicts)">
        <rect x="5" y="3" width="9" height="9" transform="rotate(45 9.5 7.5)" className={styles.pending} />
      </Item>
      <Item label="Branched from / merged into another branch">
        <path d="M2,2 V9 Q2,13 6,13 H18" className={styles.fork} fill="none" />
      </Item>
      <Item label="Parallel lines: connectors sharing a path are drawn side by side">
        <path d="M2,2 V8 Q2,12 6,12 H18" className={styles.fork} fill="none" />
        <path d="M6,2 V4 Q6,8 10,8 H18" className={styles.fork} fill="none" />
      </Item>
      <Item label="Branch with no commits of its own, pointing at a commit on another branch">
        <path d="M2,2 V8 Q2,12 6,12 H12" className={styles.fork} fill="none" strokeDasharray="2 2" />
        <circle cx="16" cy="12" r="3" className={styles.local} style={{ stroke: 'var(--color-accent)' }} />
      </Item>
      <Item label="Collapsed quiet commits (count; hover to list, click to expand)">
        <rect x="1" y="3" width="18" height="10" rx="5" className={styles.group} />
      </Item>
      <Item label="Agent activity, first to last message (colour = status)">
        <rect x="1" y="5" width="7" height="6" className={styles.barWorking} />
        <rect x="11" y="5" width="7" height="6" className={styles.barAttention} />
      </Item>
      <Item label="Agent card at the end of its work: name, last activity, status (click to set your review)">
        <rect x="1" y="6" width="5" height="5" className={styles.barWorking} />
        <rect x="8.5" y="3.5" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
      </Item>
      <Item label="Spawned by the agent above (indented card; › n on the parent shows them)">
        <path d="M4,0 V9 H12" className={styles.spawn} fill="none" />
      </Item>
      <Item label="Now">
        <line x1="10" y1="0" x2="10" y2="16" className={styles.now} />
      </Item>
      <p className={styles.note}>
        {axisMode === 'sequence'
          ? 'Axis: commits and agent activity in order, evenly spaced (dates are labels, not distances). Each commit, and the first and last activity of each agent, takes a column, so agents in a folder without Git or between two distant commits are spread out, not stacked.'
          : axisMode === 'compressed'
            ? 'Axis: calendar, compressed. Gaps follow elapsed time, but commits and agent starts and ends close together are pushed apart to a minimum spacing, so distances are only proportional between well-separated points. Zoom stretches the time gaps, never below that spacing.'
            : 'Axis: calendar time. Distances are proportional to elapsed time.'}{' '}
        Status colours: blue = working, amber = needs input or review, green = complete (reviewed), grey = unreviewed or unknown. Click an agent's status to set your review state. Hover any node, bar or row for details; Ctrl + wheel or the − / + buttons zoom the history.
      </p>
    </div>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className={styles.item}>
      <svg width="20" height="16" aria-hidden="true">
        {children}
      </svg>
      {label}
    </span>
  )
}
