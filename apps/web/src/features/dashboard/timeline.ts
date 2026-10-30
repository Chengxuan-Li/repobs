import type { CommitGraph } from '@repobs/contracts'

// The horizontal axis shared by every repository on the dashboard.
//   sequence (default): commits are evenly spaced in time order, merged across all visible
//     repositories, so the axis is the same for every project; times between commits (agent
//     activity) are placed by interpolating between neighbouring commits.
//   time: a linear calendar scale over the chosen range.
// Pure and unit-tested (timeline.test.ts).

export type AxisMode = 'sequence' | 'time'

export interface Tick {
  x: number
  label: string
}

export interface Timeline {
  mode: AxisMode
  width: number
  /** x for a timestamp in ms (clamped to the axis). */
  x: (ms: number) => number
  /** x for a commit, if it is on the axis. */
  commitX: (oid: string) => number | undefined
  /** Earliest time shown (ms); commits/agents older than this are off-axis. */
  start: number
  end: number
  ticks: Tick[]
  /** x of "now". */
  nowX: number
}

export interface TimelineInput {
  mode: AxisMode
  graphs: CommitGraph[]
  /** Start/end of agent activity to include on the axis (ms). */
  activity: Array<{ start: number; end: number }>
  /** Range start in ms (null = everything loaded). */
  rangeStart: number | null
  now: number
  /** Width available for the lane area; the axis may be wider (horizontal scroll). */
  availableWidth: number
  /** Minimum distance between commits in sequence mode. */
  minSpacing: number
}

export const PAD = 16
const DAY = 86_400_000

export function buildTimeline(input: TimelineInput): Timeline {
  return input.mode === 'time' ? timeAxis(input) : sequenceAxis(input)
}

function timeAxis(input: TimelineInput): Timeline {
  const times = [...input.graphs.flatMap((g) => g.commits.map((c) => c.time * 1000)), ...input.activity.map((a) => a.start)]
  const earliest = times.length ? Math.min(...times) : input.now - 7 * DAY
  const start = input.rangeStart ?? Math.min(earliest, input.now - DAY)
  const end = input.now + Math.max(60 * 60_000, (input.now - start) * 0.02)
  const width = Math.max(input.availableWidth, 200)
  const scale = (ms: number) => PAD + ((ms - start) / Math.max(1, end - start)) * (width - 2 * PAD)
  const x = (ms: number) => Math.min(width - PAD, Math.max(PAD, scale(ms)))
  const commitTimes = new Map(input.graphs.flatMap((g) => g.commits.map((c) => [c.oid, c.time * 1000] as const)))
  const commitX = (oid: string) => {
    const t = commitTimes.get(oid)
    return t === undefined || t < start ? undefined : x(t)
  }
  return { mode: 'time', width, x, commitX, start, end, ticks: timeTicks(start, end, scale, width), nowX: x(input.now) }
}

function sequenceAxis(input: TimelineInput): Timeline {
  const commits = input.graphs
    .flatMap((g) => g.commits)
    .filter((c) => input.rangeStart === null || c.time * 1000 >= input.rangeStart)
    .sort((a, b) => a.time - b.time || a.oid.localeCompare(b.oid))
  // Columns: one per commit, plus a final column for "now" (pending changes, live agents).
  const n = commits.length + 1
  const spacing = Math.max(input.minSpacing, (input.availableWidth - 2 * PAD) / Math.max(1, n))
  const width = Math.max(input.availableWidth, 2 * PAD + spacing * n)
  const colX = (i: number) => PAD + spacing * (i + 0.5)
  const oidX = new Map(commits.map((c, i) => [c.oid, colX(i)]))
  const times = commits.map((c) => c.time * 1000)
  const nowX = colX(commits.length)
  const start = times[0] ?? input.rangeStart ?? input.now - DAY

  // Interpolate a timestamp between the columns of the commits around it.
  const x = (ms: number) => {
    if (!times.length) return nowX
    if (ms <= times[0]!) return colX(0) - spacing / 2
    if (ms >= input.now) return nowX
    let lo = 0
    let hi = times.length - 1
    if (ms >= times[hi]!) return colX(hi) + ((ms - times[hi]!) / Math.max(1, input.now - times[hi]!)) * spacing
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (times[mid]! <= ms) lo = mid
      else hi = mid
    }
    const f = (ms - times[lo]!) / Math.max(1, times[hi]! - times[lo]!)
    return colX(lo) + f * (colX(hi) - colX(lo))
  }

  // Date labels where the day changes, at least ~72px apart.
  const ticks: Tick[] = []
  let lastX = -Infinity
  let lastDay = ''
  commits.forEach((c, i) => {
    const d = new Date(c.time * 1000)
    const day = d.toDateString()
    if (day === lastDay) return
    lastDay = day
    const cx = colX(i)
    if (cx - lastX < 72) return
    lastX = cx
    ticks.push({ x: cx, label: d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date(input.now).getFullYear() ? undefined : '2-digit' }) })
  })
  if (nowX - lastX >= 40) ticks.push({ x: nowX, label: 'now' })
  return { mode: 'sequence', width, x, commitX: (oid) => oidX.get(oid), start, end: input.now, ticks, nowX }
}

function timeTicks(start: number, end: number, scale: (ms: number) => number, width: number): Tick[] {
  const span = end - start
  const steps = [3_600_000 * 6, DAY, 7 * DAY, 30 * DAY, 91 * DAY, 365 * DAY]
  const maxTicks = Math.max(2, Math.floor(width / 80))
  const step = steps.find((s) => span / s <= maxTicks) ?? 365 * DAY
  const out: Tick[] = []
  for (let t = Math.ceil(start / step) * step; t <= end && out.length < 60; t += step) {
    const d = new Date(t)
    const label =
      step < DAY
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : step >= 91 * DAY
          ? d.toLocaleDateString([], { month: 'short', year: 'numeric' })
          : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    out.push({ x: scale(t), label })
  }
  return out
}
