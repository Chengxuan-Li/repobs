import { ACTIVITY_DETAIL_ZOOM } from '../../app/viewState'
import type { AxisMode } from './timeline'
import styles from './legend.module.css'

// What the graph marks mean. Shapes and line styles carry the meaning; colours repeat it.

const fill = (token: string) => ({ fill: `var(${token})` })

export function Legend({ axisMode, activityDetail, contextHeight }: { axisMode: AxisMode; activityDetail: boolean; contextHeight: boolean }) {
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
      <Item label="Agent activity, first to last message (colour = status); solid while working, dotted between">
        <rect x="1" y="5" width="6" height="6" className={styles.barWorking} />
        <line x1="8" x2="13" y1="8" y2="8" className={styles.idle} />
        <rect x="13" y="5" width="6" height="6" className={styles.barAttention} />
      </Item>
      <Item label="Agent card at the end of its work: name, last activity, status (click to set your review)">
        <rect x="1" y="6" width="5" height="5" className={styles.barWorking} />
        <rect x="8.5" y="3.5" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
      </Item>
      <Item label="Agent active before the start of the axis: alone, only then (its card says when); before a line, since then">
        <path d="M2,8 L8,4 L8,12 Z" className={styles.barWorking} />
        <line x1="10" x2="19" y1="8" y2="8" className={styles.idle} />
      </Item>
      <Item label="Spawned by the agent above (indented card; › n on the parent shows them)">
        <path d="M4,0 V9 H12" className={styles.spawn} fill="none" />
      </Item>
      {activityDetail ? (
        <>
          <Item label="On the agent’s line: model responding (an estimate from record times); darker: with thinking">
            <rect x="1" y="4" width="8" height="8" style={fill('--activity-model')} />
            <rect x="11" y="4" width="8" height="8" style={fill('--activity-thinking')} />
          </Item>
          <Item label="Tool: read or search">
            <rect x="1" y="4" width="18" height="8" style={fill('--activity-read')} />
          </Item>
          <Item label="Tool: edit">
            <rect x="1" y="4" width="18" height="8" style={fill('--activity-edit')} />
          </Item>
          <Item label="Tool: shell; hatched: tests and builds">
            <rect x="1" y="4" width="8" height="8" style={fill('--activity-shell')} />
            <rect x="11" y="4" width="8" height="8" style={fill('--activity-shell')} />
            <path d="M11,8 l4,-4 M11,12 l8,-8 M15,12 l4,-4" stroke="var(--color-bg)" strokeWidth="1.5" />
          </Item>
          <Item label="Other tools: web, MCP, agents, plan, questions">
            <rect x="1" y="4" width="18" height="8" style={fill('--activity-other')} />
          </Item>
          <Item label="Git change (commit, push, …) / Git inspection (status, diff, …)">
            <rect x="2.5" y="4.5" width="6" height="6" transform="rotate(45 5.5 7.5)" fill="var(--color-text)" />
            <circle cx="15" cy="8" r="3" fill="var(--color-bg)" stroke="var(--color-text)" strokeWidth="1.5" />
          </Item>
          <Item label="Prompt (a turn starts) / failed tool call / error">
            <line x1="3" y1="2" x2="3" y2="14" stroke="var(--color-text)" strokeWidth="1.5" />
            <rect x="6" y="11" width="6" height="2" fill="var(--tone-danger-text)" />
            <path d="M14,5 l5,5 m0,-5 l-5,5" stroke="var(--tone-danger-text)" strokeWidth="1.5" />
          </Item>
        </>
      ) : (
        <Item label={`Tool calls (ticks on the bar). Zoom to ${ACTIVITY_DETAIL_ZOOM * 100} % or more, or Agents → Activity detail, for steps and tool kinds on the line`}>
          <rect x="1" y="5" width="18" height="6" className={styles.barWorking} />
          <path d="M5,3 V13 M9,3 V13 M10,3 V13 M15,3 V13" stroke="var(--color-text)" strokeOpacity="0.55" />
        </Item>
      )}
      {contextHeight ? (
        <Item label="Line height: context used at the time, of the model's window (as recorded, else 200k or 1M, the smallest it fits)">
          <path d="M1,9.5 V6.5 H7 V4.5 H13 V2 H19 V14 H13 V11.5 H7 V9.5 Z" className={styles.barWorking} />
        </Item>
      ) : null}
      <Item label="Now">
        <line x1="10" y1="0" x2="10" y2="16" className={styles.now} />
      </Item>
      <p className={styles.note}>
        {axisMode === 'sequence'
          ? 'Axis: commits and agent activity in order, evenly spaced (dates are labels, not distances). Each commit, and the first and last activity of each agent, takes a column, so agents in a folder without Git or between two distant commits are spread out, not stacked.'
          : axisMode === 'compressed'
            ? 'Axis: calendar, compressed. Gaps follow elapsed time, but commits and agent starts and ends close together are pushed apart to a minimum spacing, so distances are only proportional between well-separated points. Zoom stretches the time gaps, never below that spacing.'
            : 'Axis: calendar time. Distances are proportional to elapsed time.'}{' '}
        Status colours: blue = working, amber = needs input or review, green = complete (reviewed), grey = unreviewed or unknown. Click an agent's status to set your review state. Hover any node, bar or row for details. Drag to pan; the mouse wheel or the − / + buttons zoom the history, and Ctrl + wheel changes the size of the whole interface.
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
