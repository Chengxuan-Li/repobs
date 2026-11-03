import type { ActivityStep, SessionActivity, TokenCounts, TokenSample, ToolCategory } from '@repobs/contracts'
import { TOOL_CATEGORY_LABELS } from '@repobs/contracts'

// Agent activity on the timeline (ADR 0013), as pure functions: steps become pixel runs, marks and
// active spans on the agent's line; and a summary, as chips, for hover cards and the details panel.
// Unit-tested (activity.test.ts).
//
// Colour carries three groups only (validated all-pairs: read, edit, shell); Git is shown by shape
// (◆ change, ○ inspect) and tests/builds by hatching, so no identity depends on colour alone.

export type ActivityGroup = 'read' | 'edit' | 'shell' | 'other'

export function groupOf(category: ToolCategory | undefined): ActivityGroup {
  switch (category) {
    case 'read':
    case 'search':
      return 'read'
    case 'edit':
      return 'edit'
    case 'shell':
    case 'git_read':
    case 'git_write':
    case 'test_build':
      return 'shell'
    default:
      return 'other'
  }
}

export const GROUP_LABELS: Record<ActivityGroup, string> = {
  read: 'Read and search',
  edit: 'Edit',
  shell: 'Shell, Git, tests and builds',
  other: 'Other tools: web, MCP, agents, plan, questions',
}

export interface Run {
  x1: number
  x2: number
  fill: 'model' | 'thinking' | ActivityGroup
  /** Tests and builds. */
  hatch?: boolean
  /** At least one failed tool call in the run. */
  failed?: boolean
}

export type MarkKind = 'git_write' | 'git_read' | 'prompt' | 'compaction' | 'error'
export interface Mark {
  x: number
  kind: MarkKind
}

/**
 * Model and tool spans as runs at least `minWidth` wide; neighbours of the same kind that touch
 * (within 1 px) merge, so an agent costs at most about one element per pixel.
 */
export function stepRuns(steps: ActivityStep[], x: (ms: number) => number, minWidth = 2): Run[] {
  const runs: Run[] = []
  const last: Partial<Record<string, Run>> = {}
  for (const s of steps) {
    if (s.kind !== 'model' && s.kind !== 'tool') continue
    const fill: Run['fill'] = s.kind === 'model' ? (s.thinking ? 'thinking' : 'model') : groupOf(s.category)
    const hatch = s.category === 'test_build'
    const x1 = x(s.start)
    const x2 = Math.max(x1 + (s.kind === 'tool' ? minWidth : 1), x(s.end ?? s.start))
    const key = `${fill}${hatch ? '#' : ''}`
    const prev = last[key]
    if (prev && x1 <= prev.x2 + 1) {
      prev.x2 = Math.max(prev.x2, x2)
      if (s.ok === false) prev.failed = true
      continue
    }
    const run: Run = { x1, x2, fill, ...(hatch ? { hatch } : {}), ...(s.ok === false ? { failed: true } : {}) }
    runs.push(run)
    last[key] = run
  }
  // Model spans first, so tool calls draw over the response that made them.
  return runs.sort((a, b) => Number(b.fill === 'model' || b.fill === 'thinking') - Number(a.fill === 'model' || a.fill === 'thinking'))
}

/** Pixel columns of tool calls (the default ticks), one per column. */
export function toolTicks(steps: ActivityStep[], x: (ms: number) => number): number[] {
  const seen = new Set<number>()
  for (const s of steps) if (s.kind === 'tool') seen.add(Math.round(x(s.start)))
  return [...seen].sort((a, b) => a - b)
}

/** Git, prompt, compaction and error marks; one per kind and pixel column. */
export function stepMarks(steps: ActivityStep[], x: (ms: number) => number): Mark[] {
  const out: Mark[] = []
  const seen = new Set<string>()
  for (const s of steps) {
    const kind: MarkKind | undefined =
      s.kind === 'tool' ? (s.category === 'git_write' ? 'git_write' : s.category === 'git_read' ? 'git_read' : undefined) : s.kind === 'model' ? undefined : s.kind
    if (!kind) continue
    const px = Math.round(x(s.start))
    const key = `${kind}:${px}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ x: px, kind })
  }
  return out
}

// Drawing in bulk: each kind of mark of an agent is one SVG path, not an element per tick or step,
// so a zoom redraw sets a few attributes per agent instead of hundreds (checkpoint 43).
const f1 = (n: number) => n.toFixed(1)

/** Rectangles from `y - half` to `y + half` as one path. */
export function spansPath(spans: Array<{ x1: number; x2: number }>, y: number, half: number): string {
  return spans.map((s) => `M${f1(s.x1)},${f1(y - half)}h${f1(s.x2 - s.x1)}v${f1(half * 2)}h${f1(s.x1 - s.x2)}z`).join('')
}

/** Vertical strokes at each x, from `y1` to `y2`, as one path. */
export function strokesPath(xs: number[], y1: number, y2: number): string {
  return xs.map((x) => `M${f1(x)},${f1(y1)}V${f1(y2)}`).join('')
}

/** Detail runs as one path per fill, plus the hatched (tests and builds) and failed parts. */
export function runPaths(runs: Run[], y: number, half: number): { fills: Array<[Run['fill'], string]>; hatch: string; failed: string } {
  const by = new Map<Run['fill'], Run[]>()
  for (const r of runs) by.set(r.fill, [...(by.get(r.fill) ?? []), r])
  return {
    fills: [...by.entries()].map(([fill, rs]) => [fill, spansPath(rs, y, half)]),
    hatch: spansPath(
      runs.filter((r) => r.hatch),
      y,
      half,
    ),
    failed: runs
      .filter((r) => r.failed)
      .map((r) => `M${f1(r.x1)},${f1(y + half - 2)}h${f1(r.x2 - r.x1)}v2h${f1(r.x1 - r.x2)}z`)
      .join(''),
  }
}

/** Git, prompt, compaction and error marks as one path per kind, about the line at `y`. */
export function markPaths(marks: Mark[], y: number, half: number): Record<MarkKind, string> {
  const out: Record<MarkKind, string> = { git_write: '', git_read: '', prompt: '', compaction: '', error: '' }
  const top = y - half
  for (const { x, kind } of marks) {
    out[kind] +=
      kind === 'git_write'
        ? `M${f1(x)},${f1(y - 5)}l5,5l-5,5l-5,-5z`
        : kind === 'git_read'
          ? `M${f1(x - 3)},${f1(y)}a3,3 0 1,0 6,0a3,3 0 1,0 -6,0z`
          : kind === 'error'
            ? `M${f1(x - 3)},${f1(top - 8)}l6,6m0,-6l-6,6`
            : `M${f1(x)},${f1(top - 3)}V${f1(y + half + 3)}`
  }
  return out
}

/**
 * When the agent was working (model or tool steps), as pixel spans; spans less than `gap` px apart
 * merge. Between them the agent's line is drawn faint.
 */
export function activeSpans(steps: ActivityStep[], x: (ms: number) => number, gap = 2): Array<{ x1: number; x2: number }> {
  const raw: Array<{ x1: number; x2: number }> = []
  for (const s of steps) {
    if (s.kind !== 'model' && s.kind !== 'tool') continue
    const x1 = x(s.start)
    raw.push({ x1, x2: Math.max(x1 + (s.kind === 'tool' ? 2 : 1), x(s.end ?? s.start)) })
  }
  raw.sort((a, b) => a.x1 - b.x1)
  const out: Array<{ x1: number; x2: number }> = []
  for (const r of raw) {
    const prev = out.at(-1)
    if (prev && r.x1 <= prev.x2 + gap) prev.x2 = Math.max(prev.x2, r.x2)
    else out.push({ ...r })
  }
  return out
}

export interface ActivitySummaryData {
  tools: number
  failed: number
  /** Tool calls per category, most first. */
  categories: Array<[ToolCategory, number]>
  /** Shell, Git, test and build calls. */
  commands: number
  /** Command verbs, most first (top 12). */
  verbs: Array<[string, number]>
  prompts: number
  compactions: number
  errors: number
  /** Estimated time the model spent responding, and tools running (ms). */
  modelMs: number
  /** Of which responses with thinking. */
  thinkingMs: number
  toolMs: number
  toolMsByGroup: Record<ActivityGroup, number>
  thinkingResponses: number
  responses: number
  totals: TokenCounts
  /** Context of the latest response, and the largest seen. */
  latestContext?: number
  peakContext?: number
  contextWindow?: number
  truncated: boolean
}

export function summarize(a: SessionActivity): ActivitySummaryData {
  const categories = new Map<ToolCategory, number>()
  const verbs = new Map<string, number>()
  const s: ActivitySummaryData = {
    tools: 0,
    failed: 0,
    categories: [],
    commands: 0,
    verbs: [],
    prompts: 0,
    compactions: 0,
    errors: 0,
    modelMs: 0,
    thinkingMs: 0,
    toolMs: 0,
    toolMsByGroup: { read: 0, edit: 0, shell: 0, other: 0 },
    thinkingResponses: 0,
    responses: 0,
    totals: a.totals,
    ...(a.contextWindow ? { contextWindow: a.contextWindow } : {}),
    truncated: a.truncated,
  }
  for (const step of a.steps) {
    if (step.kind === 'tool') {
      s.tools++
      if (step.ok === false) s.failed++
      if (groupOf(step.category) === 'shell') s.commands++
      if (step.category) categories.set(step.category, (categories.get(step.category) ?? 0) + 1)
      if (step.verb) verbs.set(step.verb, (verbs.get(step.verb) ?? 0) + 1)
      if (step.end !== undefined) {
        s.toolMs += step.end - step.start
        s.toolMsByGroup[groupOf(step.category)] += step.end - step.start
      }
    } else if (step.kind === 'model') {
      s.responses++
      if (step.thinking) s.thinkingResponses++
      s.modelMs += (step.end ?? step.start) - step.start
      if (step.thinking) s.thinkingMs += (step.end ?? step.start) - step.start
    } else if (step.kind === 'prompt') s.prompts++
    else if (step.kind === 'compaction') s.compactions++
    else if (step.kind === 'error') s.errors++
  }
  s.categories = [...categories.entries()].sort((x, y) => y[1] - x[1])
  s.verbs = [...verbs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 12)
  if (a.tokens.length) {
    s.latestContext = a.tokens.at(-1)!.context
    s.peakContext = Math.max(...a.tokens.map((t) => t.context))
  }
  return s
}

export function formatTokens(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`
}

export const categoryLabel = (c: ToolCategory) => TOOL_CATEGORY_LABELS[c]

export type Tone = ActivityGroup | 'model' | 'thinking' | 'failed'

export interface Chip {
  /** None: the value alone. */
  label?: string
  value: string
  /** A command verb: shown as typed, not in label case. */
  mono?: boolean
  /** The dashboard colour of what it counts, if it has one. */
  tone?: Tone
}

/** One part of a stacked bar: its share is `amount` of the bar's total. */
export interface Part extends Chip {
  label: string
  amount: number
}

/**
 * A field of the activity summary. `bar`: a stacked bar of parts in one unit (counts or time), with
 * `extras` (other quantities) shown only in its breakdown. `chips`: figures on one line.
 */
export type ActivityField = { kind: 'bar'; label: string; total: string; parts: Part[]; extras: Chip[] } | { kind: 'chips'; label: string; chips: Chip[] }

const GROUP_ORDER: ActivityGroup[] = ['read', 'edit', 'shell', 'other']
const TIME_LABELS: Record<ActivityGroup, string> = { read: 'Read and search', edit: 'Edit', shell: 'Shell, Git, tests', other: 'Other tools' }

/**
 * The summary as fields: tools, commands and time as stacked bars (parts grouped by colour, larger
 * first); tokens, cache hit rate and current context as figures.
 */
export function activityFields(s: ActivitySummaryData): ActivityField[] {
  const t = s.totals
  const input = t.input + t.cacheRead + t.cacheWrite
  const part = (label: string, amount: number, value: string, tone?: Tone, mono?: boolean): Part[] =>
    amount > 0 ? [{ label, amount, value, ...(tone ? { tone } : {}), ...(mono ? { mono } : {}) }] : []
  const quantity = (label: string, n: number, tone?: Tone): Chip[] => (n ? [{ label, value: String(n), ...(tone ? { tone } : {}) }] : [])
  const byGroup = [...s.categories].sort((a, b) => GROUP_ORDER.indexOf(groupOf(a[0])) - GROUP_ORDER.indexOf(groupOf(b[0])) || b[1] - a[1])
  const named = s.verbs.reduce((n, [, c]) => n + c, 0)
  const fields: ActivityField[] = [
    {
      kind: 'bar',
      label: 'Tools',
      total: String(s.tools),
      parts: byGroup.flatMap(([c, n]) => part(categoryLabel(c), n, String(n), groupOf(c))),
      extras: quantity('Failed', s.failed, 'failed'),
    },
    {
      kind: 'bar',
      label: 'Commands',
      total: String(s.commands),
      parts: [...s.verbs.flatMap(([v, n]) => part(v, n, String(n), 'shell', true)), ...part('Other commands', s.commands - named, String(s.commands - named))],
      extras: [],
    },
    {
      kind: 'bar',
      label: 'Time',
      total: formatDuration(s.modelMs + s.toolMs),
      parts: [
        ...part('Model, thinking', s.thinkingMs, formatDuration(s.thinkingMs), 'thinking'),
        ...part('Model', s.modelMs - s.thinkingMs, formatDuration(s.modelMs - s.thinkingMs), 'model'),
        ...GROUP_ORDER.flatMap((g) => part(TIME_LABELS[g], s.toolMsByGroup[g], formatDuration(s.toolMsByGroup[g]), g)),
      ],
      extras: [...quantity('Prompts', s.prompts), ...quantity('Responses', s.responses), ...quantity('With thinking', s.thinkingResponses, 'thinking'), ...quantity('Errors', s.errors, 'failed')],
    },
    {
      kind: 'chips',
      label: 'Tokens',
      chips: input + t.output ? [{ label: 'In', value: formatTokens(input) }, { label: 'Out', value: formatTokens(t.output) }] : [],
    },
    { kind: 'chips', label: 'Cache hit', chips: input ? [{ value: `${Math.round((t.cacheRead / input) * 100)} %` }] : [] },
    {
      kind: 'chips',
      label: 'Context',
      chips: s.latestContext !== undefined ? [{ value: formatTokens(s.latestContext) + (s.contextWindow ? ` / ${formatTokens(s.contextWindow)}` : '') }] : [],
    },
  ]
  return fields.filter((f) => (f.kind === 'bar' ? f.parts.length : f.chips.length))
}

/**
 * The context window an agent's line is scaled to: as recorded (Codex), else the smallest standard
 * window its peak fits (200k, then 1M), else its peak.
 */
export function contextScale(a: SessionActivity): number {
  const peak = Math.max(0, ...a.tokens.map((t) => t.context))
  if (a.contextWindow && a.contextWindow >= peak) return a.contextWindow
  return [200_000, 1_000_000].find((w) => w >= peak) ?? peak
}

/**
 * A clip path for the agent's line, symmetric about `y`: at each response, `maxHalf` times the share
 * of `max` in context (at least `minHalf`), held until the next; from `from` to past `to`.
 */
export function contextClip(tokens: TokenSample[], x: (ms: number) => number, y: number, maxHalf: number, max: number, from: number, to: number, minHalf = 1): string {
  if (!tokens.length || max <= 0) return ''
  const half = (c: number) => Math.max(minHalf, Math.min(1, c / max) * maxHalf)
  const xs = tokens.map((t) => x(t.at))
  const end = Math.max(to, xs.at(-1)!) + 4
  const steps = tokens.map((t, i) => ({ x1: i ? xs[i]! : Math.min(from, xs[0]!), x2: i + 1 < xs.length ? xs[i + 1]! : end, h: half(t.context) }))
  const f = (n: number) => n.toFixed(1)
  const top = steps.map((p) => `L${f(p.x1)},${f(y - p.h)} L${f(p.x2)},${f(y - p.h)}`).join(' ')
  const bottom = [...steps]
    .reverse()
    .map((p) => `L${f(p.x2)},${f(y + p.h)} L${f(p.x1)},${f(y + p.h)}`)
    .join(' ')
  return `M${f(steps[0]!.x1)},${f(y)} ${top} ${bottom} Z`
}
