import type { ActivityStep, SessionActivity, TokenCounts, TokenSample, ToolCategory } from '@repobs/contracts'
import { TOOL_CATEGORY_LABELS } from '@repobs/contracts'

// Agent activity on the timeline (ADR 0013), as pure functions: steps become pixel runs, marks and
// a context-fill path; and a summary for hover cards. Unit-tested (activity.test.ts).
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

/** A step path of the context fill between `top` and `top + height`, scaled to `max` tokens. */
export function contextPath(tokens: TokenSample[], x: (ms: number) => number, top: number, height: number, max: number, endX: number): string {
  if (!tokens.length || max <= 0) return ''
  const yOf = (t: number) => top + height - Math.min(1, t / max) * height
  const base = top + height
  let d = `M${x(tokens[0]!.at).toFixed(1)},${base}`
  tokens.forEach((t, i) => {
    const x1 = x(t.at)
    const x2 = i + 1 < tokens.length ? x(tokens[i + 1]!.at) : Math.max(x1 + 2, endX)
    const y = yOf(t.context).toFixed(1)
    d += ` L${x1.toFixed(1)},${y} L${x2.toFixed(1)},${y}`
  })
  return `${d} L${Math.max(x(tokens.at(-1)!.at) + 2, endX).toFixed(1)},${base} Z`
}

export interface ActivitySummaryData {
  tools: number
  failed: number
  /** Tool calls per category, most first. */
  categories: Array<[ToolCategory, number]>
  /** Command verbs, most first (top 6). */
  verbs: Array<[string, number]>
  prompts: number
  compactions: number
  errors: number
  /** Estimated time the model spent responding, and tools running (ms). */
  modelMs: number
  toolMs: number
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
    verbs: [],
    prompts: 0,
    compactions: 0,
    errors: 0,
    modelMs: 0,
    toolMs: 0,
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
      if (step.category) categories.set(step.category, (categories.get(step.category) ?? 0) + 1)
      if (step.verb) verbs.set(step.verb, (verbs.get(step.verb) ?? 0) + 1)
      if (step.end !== undefined) s.toolMs += step.end - step.start
    } else if (step.kind === 'model') {
      s.responses++
      if (step.thinking) s.thinkingResponses++
      s.modelMs += (step.end ?? step.start) - step.start
    } else if (step.kind === 'prompt') s.prompts++
    else if (step.kind === 'compaction') s.compactions++
    else if (step.kind === 'error') s.errors++
  }
  s.categories = [...categories.entries()].sort((x, y) => y[1] - x[1])
  s.verbs = [...verbs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6)
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
