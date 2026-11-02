// The horizontal axis shared by every repository on the dashboard.
//   sequence (default): drawn items — commits, or groups of collapsed commits — and the first and
//     last activity of each drawn agent are evenly spaced in time order, merged across all visible
//     repositories, so the axis is the same for every project; other times are interpolated
//     between neighbours.
//   time: a linear calendar scale over the chosen range.
//   compressed: calendar order and gaps proportional to elapsed time, but every item and agent
//     activity point keeps at least minSpacing from the previous one, so bursts of commits or
//     agents never collide; zoom scales only the time-proportional part of the gaps.
// Agent activity takes part in both ordinal modes, so agents never collapse into one point where
// there are no commits (folders without Git, ADR 0010) or between two distant commits.
// Pure and unit-tested (timeline.test.ts).

export type AxisMode = 'sequence' | 'time' | 'compressed'

export interface Tick {
  x: number
  label: string
}

export interface Timeline {
  mode: AxisMode
  width: number
  /** x for a timestamp in ms (clamped to the axis). */
  x: (ms: number) => number
  /** x for a drawn item (commit oid or group id), if it is on the axis. */
  commitX: (key: string) => number | undefined
  /** Earliest time shown (ms); commits/agents older than this are off-axis. */
  start: number
  end: number
  ticks: Tick[]
  /** x of "now". */
  nowX: number
}

export interface TimelineInput {
  mode: AxisMode
  /** Drawn items: commits (key = oid) and collapsed groups (key = group id), time in ms. */
  items: Array<{ key: string; time: number }>
  /**
   * First and last activity of each drawn agent (ms). The ordinal modes place every point before
   * now as an anchor of its own; calendar time uses the earliest start for its default range.
   */
  activity: Array<{ start: number; end: number }>
  /** Range start in ms (null = everything loaded). */
  rangeStart: number | null
  now: number
  /** Width available for the lane area; the axis may be wider (horizontal scroll). */
  availableWidth: number
  /** Minimum distance between anchors (commits, agent activity) in sequence and compressed modes. */
  minSpacing: number
  /**
   * Horizontal zoom (default 1). Above 1 the axis widens proportionally; below 1 commits may sit
   * closer than minSpacing, but the axis never shrinks below the available width.
   */
  zoom?: number
}

export const PAD = 16
const DAY = 86_400_000

export function buildTimeline(input: TimelineInput): Timeline {
  return input.mode === 'time' ? timeAxis(input) : input.mode === 'compressed' ? compressedAxis(input) : sequenceAxis(input)
}

function timeAxis(input: TimelineInput): Timeline {
  const times = [...input.items.map((i) => i.time), ...input.activity.map((a) => a.start)]
  const earliest = times.length ? Math.min(...times) : input.now - 7 * DAY
  const start = input.rangeStart ?? Math.min(earliest, input.now - DAY)
  const end = input.now + Math.max(60 * 60_000, (input.now - start) * 0.02)
  const width = Math.max(input.availableWidth, 200) * Math.max(1, input.zoom ?? 1)
  const scale = (ms: number) => PAD + ((ms - start) / Math.max(1, end - start)) * (width - 2 * PAD)
  const x = (ms: number) => Math.min(width - PAD, Math.max(PAD, scale(ms)))
  const commitTimes = new Map(input.items.map((i) => [i.key, i.time] as const))
  const commitX = (oid: string) => {
    const t = commitTimes.get(oid)
    return t === undefined || t < start ? undefined : x(t)
  }
  return { mode: 'time', width, x, commitX, start, end, ticks: timeTicks(start, end, scale, width), nowX: x(input.now) }
}

interface Anchor {
  /** Drawn item key; absent for an agent activity point. */
  key?: string
  time: number
}

/**
 * Points the ordinal axes are built on, in time order: every drawn item in range, and each agent
 * start/end in range and before now that does not coincide with an anchor already there.
 */
function anchorsOf(input: TimelineInput): Anchor[] {
  const inRange = (t: number) => input.rangeStart === null || t >= input.rangeStart
  const out: Anchor[] = input.items.filter((i) => inRange(i.time))
  const taken = new Set(out.map((a) => a.time))
  for (const a of input.activity) {
    for (const t of [a.start, a.end]) {
      if (!Number.isFinite(t) || !inRange(t) || t >= input.now || taken.has(t)) continue
      taken.add(t)
      out.push({ time: t })
    }
  }
  return out.sort((a, b) => a.time - b.time || (a.key ?? '').localeCompare(b.key ?? ''))
}

function sequenceAxis(input: TimelineInput): Timeline {
  const commits = anchorsOf(input)
  // Columns: one per anchor, plus a final column for "now" (pending changes, live agents).
  const n = commits.length + 1
  const fit = (input.availableWidth - 2 * PAD) / Math.max(1, n)
  const zoom = input.zoom ?? 1
  const spacing = zoom >= 1 ? Math.max(fit, input.minSpacing) * zoom : Math.max(fit, input.minSpacing * zoom)
  const width = Math.max(input.availableWidth, 2 * PAD + spacing * n)
  const colX = (i: number) => PAD + spacing * (i + 0.5)
  const oidX = new Map(commits.flatMap((c, i) => (c.key === undefined ? [] : [[c.key, colX(i)] as const])))
  const times = commits.map((c) => c.time)
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
    const d = new Date(c.time)
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

function compressedAxis(input: TimelineInput): Timeline {
  const items = anchorsOf(input)
  const gap = input.minSpacing
  const first = items[0]?.time ?? input.rangeStart ?? input.now - DAY
  const start = input.rangeStart ?? Math.min(first, input.now - DAY)
  // Pixels per ms: at zoom 1 the plain calendar scale for the available width; items closer than
  // the minimum spacing push everything after them to the right (the axis grows and scrolls).
  const scale = ((Math.max(input.availableWidth, 200) - 2 * PAD - gap) / Math.max(1, input.now - start)) * (input.zoom ?? 1)
  const anchors: Array<{ t: number; x: number }> = []
  const itemX = new Map<string, number>()
  let x = PAD + gap / 2 + Math.max(0, first - start) * scale
  let prev: number | undefined
  for (const item of items) {
    if (prev !== undefined) x += Math.max(gap, (item.time - prev) * scale)
    prev = item.time
    if (item.key !== undefined) itemX.set(item.key, x)
    anchors.push({ t: item.time, x })
  }
  const nowX = prev === undefined ? x : x + Math.max(gap, (input.now - prev) * scale)
  anchors.push({ t: input.now, x: nowX })
  const width = Math.max(input.availableWidth, nowX + gap / 2 + PAD)

  // Piecewise linear between anchors; before the first item, the plain scale back to the start.
  const at = (ms: number) => {
    if (ms <= anchors[0]!.t) return anchors[0]!.x - (anchors[0]!.t - ms) * scale
    if (ms >= input.now) return nowX
    let lo = 0
    let hi = anchors.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (anchors[mid]!.t <= ms) lo = mid
      else hi = mid
    }
    const a = anchors[lo]!
    const b = anchors[hi]!
    return a.x + ((ms - a.t) / Math.max(1, b.t - a.t)) * (b.x - a.x)
  }
  const xOf = (ms: number) => Math.min(width - PAD, Math.max(PAD, at(ms)))
  return { mode: 'compressed', width, x: xOf, commitX: (key) => itemX.get(key), start, end: input.now, ticks: rankedTicks(start, input.now, at), nowX }
}

/**
 * Calendar ticks for a non-linear axis: "now" first, then boundaries by importance (year, month,
 * day, 6 h, hour), each kept only if it is at least 72px from the ticks already placed.
 */
function rankedTicks(start: number, end: number, at: (ms: number) => number): Tick[] {
  const HOUR = 3_600_000
  const levels: Array<{ step: (d: Date) => void; label: (d: Date) => string }> = [
    { step: (d) => d.setFullYear(d.getFullYear() + 1, 0, 1), label: (d) => String(d.getFullYear()) },
    { step: (d) => d.setMonth(d.getMonth() + 1, 1), label: (d) => d.toLocaleDateString([], { month: 'short', year: 'numeric' }) },
    { step: (d) => d.setDate(d.getDate() + 1), label: (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' }) },
    { step: (d) => d.setHours(d.getHours() + 6), label: (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
    { step: (d) => d.setHours(d.getHours() + 1), label: (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
  ]
  const floors = [
    (d: Date) => d.setMonth(0, 1),
    (d: Date) => d.setDate(1),
    () => undefined,
    (d: Date) => d.setHours(d.getHours() - (d.getHours() % 6)),
    () => undefined,
  ]
  const placed: Tick[] = [{ x: at(end), label: 'now' }]
  const free = (x: number) => placed.every((p) => Math.abs(p.x - x) >= 72)
  levels.forEach((level, i) => {
    // Skip fine levels over long spans (too many candidates to be useful).
    if (i >= 3 && end - start > 60 * 24 * HOUR) return
    if (i === 4 && end - start > 7 * 24 * HOUR) return
    const d = new Date(start)
    d.setHours(i <= 2 ? 0 : d.getHours(), 0, 0, 0)
    floors[i]!(d)
    if (d.getTime() < start) level.step(d)
    for (let n = 0; d.getTime() <= end && n < 5000; n++, level.step(d)) {
      const x = at(d.getTime())
      if (free(x)) placed.push({ x, label: level.label(d) })
    }
  })
  return placed.sort((a, b) => a.x - b.x)
}
