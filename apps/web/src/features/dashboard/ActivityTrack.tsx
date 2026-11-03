import type { SessionActivity } from '@repobs/contracts'
import type { Timeline } from './timeline'
import { categoryLabel, contextPath, formatDuration, formatTokens, stepMarks, stepRuns, summarize, toolTicks } from './activity'
import styles from './board.module.css'

// An agent's activity on its bar (ADR 0013). Default: a tick per tool call over the bar. Detail:
// a band of model and tool spans with Git, prompt and error marks, and a context-fill band below.

/** Detail rows: the band starts this far below the row top, the context band below it. */
export const DETAIL = { bandTop: 21, bandHeight: 12, contextTop: 37, contextHeight: 12 }

export function ActivityTicks({ activity, timeline, y }: { activity: SessionActivity; timeline: Timeline; y: number }) {
  return (
    <g className={styles.ticks}>
      {toolTicks(activity.steps, timeline.x).map((x) => (
        <line key={x} x1={x} x2={x} y1={y - 6} y2={y + 6} />
      ))}
    </g>
  )
}

export function ActivityDetail({ activity, timeline, top, endX, hatchId }: { activity: SessionActivity; timeline: Timeline; top: number; endX: number; hatchId: string }) {
  const band = top + DETAIL.bandTop
  const mid = band + DETAIL.bandHeight / 2
  const runs = stepRuns(activity.steps, timeline.x)
  const marks = stepMarks(activity.steps, timeline.x)
  const peak = Math.max(0, ...activity.tokens.map((t) => t.context))
  const max = activity.contextWindow && activity.contextWindow >= peak ? activity.contextWindow : peak * 1.1
  const ctx = contextPath(activity.tokens, timeline.x, top + DETAIL.contextTop, DETAIL.contextHeight, max, endX)
  return (
    <g>
      {runs.map((r, i) => (
        <g key={i}>
          <rect x={r.x1} y={band} width={r.x2 - r.x1} height={DETAIL.bandHeight} className={styles[`act_${r.fill}`]} />
          {r.hatch ? <rect x={r.x1} y={band} width={r.x2 - r.x1} height={DETAIL.bandHeight} fill={`url(#${hatchId})`} /> : null}
          {r.failed ? <rect x={r.x1} y={band + DETAIL.bandHeight - 2} width={r.x2 - r.x1} height={2} className={styles.actFailed} /> : null}
        </g>
      ))}
      {marks.map((m) =>
        m.kind === 'git_write' ? (
          <rect key={`${m.kind}${m.x}`} x={m.x - 3.5} y={mid - 3.5} width={7} height={7} transform={`rotate(45 ${m.x} ${mid})`} className={styles.actGitWrite} />
        ) : m.kind === 'git_read' ? (
          <circle key={`${m.kind}${m.x}`} cx={m.x} cy={mid} r={3} className={styles.actGitRead} />
        ) : m.kind === 'prompt' ? (
          <line key={`${m.kind}${m.x}`} x1={m.x} x2={m.x} y1={band - 3} y2={band + DETAIL.bandHeight} className={styles.actPrompt} />
        ) : m.kind === 'compaction' ? (
          <line key={`${m.kind}${m.x}`} x1={m.x} x2={m.x} y1={band - 3} y2={top + DETAIL.contextTop + DETAIL.contextHeight} className={styles.actCompaction} />
        ) : (
          <path key={`${m.kind}${m.x}`} d={`M${m.x - 3},${band - 4} l6,6 m0,-6 l-6,6`} className={styles.actError} />
        ),
      )}
      {ctx ? <path d={ctx} className={styles.actContext} /> : null}
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

/** Tools, commands, time and tokens of one agent, for hover cards and the details panel. */
export function ActivitySummary({ activity }: { activity: SessionActivity }) {
  const s = summarize(activity)
  const cached = s.totals.cacheRead
  const input = s.totals.input + s.totals.cacheRead + s.totals.cacheWrite
  return (
    <>
      <dt>Tools</dt>
      <dd>
        {s.tools ? (
          <>
            {s.tools} calls{s.failed ? `, ${s.failed} failed` : ''}
            {s.categories.length ? ` · ${s.categories.map(([c, n]) => `${categoryLabel(c)} ${n}`).join(', ')}` : ''}
          </>
        ) : (
          'none recorded'
        )}
      </dd>
      {s.verbs.length ? (
        <>
          <dt>Commands</dt>
          <dd className="mono small">{s.verbs.map(([v, n]) => (n > 1 ? `${v} ×${n}` : v)).join(' · ')}</dd>
        </>
      ) : null}
      <dt>Time</dt>
      <dd>
        model about {formatDuration(s.modelMs)} over {s.responses} responses
        {s.thinkingResponses ? ` (${s.thinkingResponses} with thinking)` : ''} · tools {formatDuration(s.toolMs)}
      </dd>
      {input + s.totals.output ? (
        <>
          <dt>Tokens</dt>
          <dd>
            {formatTokens(input)} in{input ? ` (${Math.round((cached / input) * 100)} % from cache)` : ''} · {formatTokens(s.totals.output)} out
            {s.totals.reasoning ? ` · ${formatTokens(s.totals.reasoning)} reasoning` : ''}
          </dd>
          {s.latestContext !== undefined ? (
            <>
              <dt>Context</dt>
              <dd>
                {formatTokens(s.latestContext)} now, peak {formatTokens(s.peakContext ?? 0)}
                {s.contextWindow ? ` of ${formatTokens(s.contextWindow)}` : ''}
                {s.compactions ? ` · compacted ${s.compactions}×` : ''}
              </dd>
            </>
          ) : null}
        </>
      ) : null}
      {s.truncated ? (
        <>
          <dt>Scope</dt>
          <dd className="muted">latest part of a long history</dd>
        </>
      ) : null}
    </>
  )
}
