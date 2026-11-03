import { useState } from 'react'
import type { SessionActivity } from '@repobs/contracts'
import type { Timeline } from './timeline'
import { activeSpans, type ActivityField, activityFields, type Chip, contextClip, contextScale, type Part, stepMarks, stepRuns, summarize, toolTicks } from './activity'
import styles from './board.module.css'

// An agent's line on the timeline (ADR 0013): first to last activity. With its activity read, the
// line is solid where the agent was working and faint between. Default: one status colour and a
// tick per tool call. Detail: the solid parts are model and tool spans with Git, prompt and error
// marks, on the same line. Optionally the solid parts are as tall as the context was full.

/** Half the line's height: default and detail. */
const HALF = { line: 3, detail: 5 }

export function AgentLine({
  activity,
  timeline,
  x1,
  x2,
  y,
  barClass,
  detail,
  hatchId,
  context,
}: {
  activity?: SessionActivity
  timeline: Timeline
  x1: number
  x2: number
  y: number
  /** The status colour (default view). */
  barClass: string
  detail: boolean
  hatchId: string
  /** Scale the solid parts by the context used at the time, up to `maxHalf` px each side of the line. */
  context?: { maxHalf: number; clipId: string }
}) {
  // Steps before the axis would all pile up at its left edge: only those that reach into it.
  const steps = activity?.steps.filter((s) => (s.end ?? s.start) >= timeline.start) ?? []
  if (!activity || !steps.length) return <rect x={x1} y={y - HALF.line} width={x2 - x1} height={HALF.line * 2} className={barClass} />
  let fromToken = 0
  activity.tokens.forEach((t, i) => {
    if (t.at <= timeline.start) fromToken = i
  })
  const tokens = activity.tokens.slice(fromToken)
  const first = timeline.x(steps.find((s) => s.kind === 'model' || s.kind === 'tool')?.start ?? steps[0]!.start)
  // By context: drawn full height, clipped to the context used at each response.
  const clip = context && tokens.length ? contextClip(tokens, timeline.x, y, context.maxHalf, contextScale(activity), x1, x2) : ''
  const half = clip && context ? context.maxHalf : detail ? HALF.detail : HALF.line
  const clipped = clip && context ? `url(#${context.clipId})` : undefined
  const clipDef =
    clip && context ? (
      <clipPath id={context.clipId}>
        <path d={clip} />
      </clipPath>
    ) : null
  // A truncated read misses the start: draw it solid, as without activity.
  const unread = activity.truncated && first > x1 ? <rect x={x1} y={y - half} width={first - x1} height={half * 2} className={barClass} /> : null
  const idle = <line x1={x1} x2={x2} y1={y} y2={y} className={`${barClass} ${styles.idle}`} />
  if (!detail) {
    return (
      <g className={styles.agentTrace}>
        {clipDef}
        {idle}
        <g clipPath={clipped}>
          {unread}
          {activeSpans(steps, timeline.x).map((s, i) => (
            <rect key={i} x={s.x1} y={y - half} width={s.x2 - s.x1} height={half * 2} className={barClass} />
          ))}
        </g>
        <g className={styles.ticks}>
          {toolTicks(steps, timeline.x).map((x) => (
            <line key={x} x1={x} x2={x} y1={y - 6} y2={y + 6} />
          ))}
        </g>
      </g>
    )
  }
  // Runs at the line's height (full when scaled by context); marks at the detail height.
  const h = HALF.detail * 2
  const top = y - HALF.detail
  return (
    <g className={`${styles.agentTrace} ${styles.actBand}`}>
      {clipDef}
      {idle}
      <g clipPath={clipped}>
        {unread}
        {stepRuns(steps, timeline.x).map((r, i) => (
          <g key={i}>
            <rect x={r.x1} y={y - half} width={r.x2 - r.x1} height={half * 2} className={styles[`act_${r.fill}`]} />
            {r.hatch ? <rect x={r.x1} y={y - half} width={r.x2 - r.x1} height={half * 2} fill={`url(#${hatchId})`} /> : null}
            {r.failed ? <rect x={r.x1} y={y + half - 2} width={r.x2 - r.x1} height={2} className={styles.actFailed} /> : null}
          </g>
        ))}
      </g>
      {stepMarks(steps, timeline.x).map((m) =>
        m.kind === 'git_write' ? (
          <rect key={`${m.kind}${m.x}`} x={m.x - 3.5} y={y - 3.5} width={7} height={7} transform={`rotate(45 ${m.x} ${y})`} className={styles.actGitWrite} />
        ) : m.kind === 'git_read' ? (
          <circle key={`${m.kind}${m.x}`} cx={m.x} cy={y} r={3} className={styles.actGitRead} />
        ) : m.kind === 'prompt' ? (
          <line key={`${m.kind}${m.x}`} x1={m.x} x2={m.x} y1={top - 3} y2={top + h + 3} className={styles.actPrompt} />
        ) : m.kind === 'compaction' ? (
          <line key={`${m.kind}${m.x}`} x1={m.x} x2={m.x} y1={top - 3} y2={top + h + 3} className={styles.actCompaction} />
        ) : (
          <path key={`${m.kind}${m.x}`} d={`M${m.x - 3},${top - 8} l6,6 m0,-6 l-6,6`} className={styles.actError} />
        ),
      )}
    </g>
  )
}

/** The hatch pattern for tests and builds; one per board. */
export function HatchDef({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="4" className={styles.actHatch} />
      </pattern>
    </defs>
  )
}

/**
 * Tools, commands, time, tokens, cache hit rate and context of one agent, a line per field. Tools,
 * commands and time are stacked bars of their parts, coloured as on the timeline; a click on a bar
 * lists each part with its amount (and other counts), a second click shows shares instead, a third
 * hides them. The rest
 * are chips: a label and, in the right half, its value. Without `expandable` (plain hover cards) the
 * bars do not open.
 */
export function ActivityFields({ activity, expandable = true, scopeNote = true }: { activity: SessionActivity; expandable?: boolean; scopeNote?: boolean }) {
  return (
    <span className={styles.fields}>
      {activityFields(summarize(activity)).map((f) =>
        f.kind === 'bar' ? (
          <BarField key={f.label} field={f} expandable={expandable} />
        ) : (
          <span key={f.label} className={styles.field}>
            <span className={styles.fieldLabel}>{f.label}</span>
            <span className={styles.chipLine}>{f.chips.map(chip)}</span>
          </span>
        ),
      )}
      {scopeNote && activity.truncated ? <span className={styles.chipNote}>Latest part of a long history only.</span> : null}
    </span>
  )
}

const chip = (c: Chip) => (
  <span key={c.label ?? c.value} className={`${styles.chip} ${c.tone ? styles[`chip_${c.tone}`] : ''}`}>
    {c.label ? <span className={`${styles.chipLabel} ${c.mono ? styles.chipMono : ''}`}>{c.label}</span> : null}
    <span className={`${styles.chipValue} ${c.label ? '' : styles.chipValueOnly}`}>{c.value}</span>
  </span>
)

type BarFieldData = Extract<ActivityField, { kind: 'bar' }>

const share = (part: Part, sum: number) => {
  const p = (part.amount / sum) * 100
  return p < 1 ? '<1 %' : `${Math.round(p)} %`
}

/** A bar's list, in turn on each click: closed, amounts, shares. */
const NEXT_VIEW = { closed: 'amounts', amounts: 'shares', shares: 'closed' } as const
const VIEW_ACTION = { closed: 'Show the amounts', amounts: 'Show the shares', shares: 'Hide the items' }

function BarField({ field, expandable }: { field: BarFieldData; expandable: boolean }) {
  const [view, setView] = useState<keyof typeof NEXT_VIEW>('closed')
  const sum = field.parts.reduce((n, p) => n + p.amount, 0)
  const parts = field.parts.map((p) => `${p.label} ${p.value} (${share(p, sum)})`).join(', ')
  const segments = field.parts.map((p) => <span key={p.label} className={`${styles.seg} ${p.tone ? styles[`seg_${p.tone}`] : ''}`} style={{ flexGrow: p.amount }} />)
  return (
    <span className={styles.field}>
      <span className={styles.fieldLabel}>
        {field.label} <span className={styles.fieldTotal}>({field.total})</span>
      </span>
      {expandable ? (
        <button
          type="button"
          className={styles.stackButton}
          aria-expanded={view !== 'closed'}
          aria-label={`${field.label}, ${field.total}: ${parts}. ${VIEW_ACTION[view]}`}
          onClick={() => setView(NEXT_VIEW[view])}
        >
          <span className={styles.stack}>{segments}</span>
        </button>
      ) : (
        <span className={styles.stackButton} role="img" aria-label={`${field.label}, ${field.total}: ${parts}`}>
          <span className={styles.stack}>{segments}</span>
        </span>
      )}
      {view !== 'closed' ? (
        <span className={`${styles.chipWrap} ${styles.fieldItems}`}>
          {field.parts.map((p) => chip(view === 'shares' ? { ...p, value: share(p, sum) } : p))}
          {field.extras.map(chip)}
        </span>
      ) : null}
    </span>
  )
}
