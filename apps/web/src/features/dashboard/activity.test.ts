import { describe, expect, it } from 'vitest'
import type { ActivityStep, SessionActivity } from '@repobs/contracts'
import { activeSpans, activityFields, contextClip, contextScale, formatTokens, markPaths, runPaths, spansPath, strokesPath, groupOf, stepMarks, stepRuns, summarize, toolTicks } from './activity'

const x = (ms: number) => ms / 1000 // 1 px per second

const steps: ActivityStep[] = [
  { kind: 'prompt', start: 0 },
  { kind: 'model', start: 0, end: 10_000, thinking: true },
  { kind: 'tool', start: 10_000, end: 20_000, category: 'read', tool: 'Read', ok: true },
  { kind: 'tool', start: 20_500, end: 30_000, category: 'search', tool: 'Grep', ok: true },
  { kind: 'model', start: 30_000, end: 32_000 },
  { kind: 'tool', start: 32_000, end: 40_000, category: 'git_write', tool: 'Bash', verb: 'git commit', ok: false },
  { kind: 'tool', start: 40_000, end: 50_000, category: 'test_build', tool: 'Bash', verb: 'npm test', ok: true },
  { kind: 'tool', start: 50_200, category: 'mcp', tool: 'mcp:energyatlas' },
  { kind: 'compaction', start: 60_000 },
  { kind: 'error', start: 61_000 },
]

describe('activity drawing', () => {
  it('scales the agent line by context: recorded window, else the smallest standard one that fits', () => {
    const at = (context: number) => ({ at: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, context })
    const a = (peak: number, contextWindow?: number): SessionActivity => ({
      sessionId: 's',
      state: 'ok',
      steps: [],
      tokens: [at(peak)],
      totals: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
      truncated: false,
      version: 'v',
      ...(contextWindow ? { contextWindow } : {}),
    })
    expect([contextScale(a(150_000)), contextScale(a(400_000)), contextScale(a(2_000_000)), contextScale(a(10_000, 258_000))]).toEqual([200_000, 1_000_000, 2_000_000, 258_000])
    // Steps about y = 10: half of 8 px at 50 %, all 8 px at 100 %, from the bar's start to past its end.
    const tokens = [
      { ...at(50), at: 0 },
      { ...at(100), at: 10_000 },
    ]
    expect(contextClip(tokens, x, 10, 8, 100, -5, 20)).toBe(
      'M-5.0,10.0 L-5.0,6.0 L10.0,6.0 L10.0,2.0 L24.0,2.0 L24.0,18.0 L10.0,18.0 L10.0,14.0 L-5.0,14.0 Z',
    )
    expect(contextClip([], x, 10, 8, 100, 0, 1)).toBe('')
  })


  it('groups categories into three colours plus other', () => {
    expect([groupOf('read'), groupOf('search'), groupOf('edit'), groupOf('git_write'), groupOf('test_build'), groupOf('mcp'), groupOf(undefined)]).toEqual([
      'read',
      'read',
      'edit',
      'shell',
      'shell',
      'other',
      'other',
    ])
  })

  it('merges touching steps of the same kind into one run; model spans draw first', () => {
    const runs = stepRuns(steps, x)
    expect(runs.slice(0, 2).map((r) => r.fill)).toEqual(['thinking', 'model'])
    const read = runs.filter((r) => r.fill === 'read')
    expect(read).toEqual([{ x1: 10, x2: 30, fill: 'read' }]) // Read and Grep, 0.5 px apart
    const shell = runs.filter((r) => r.fill === 'shell')
    expect(shell).toEqual([
      { x1: 32, x2: 40, fill: 'shell', failed: true },
      { x1: 40, x2: 50, fill: 'shell', hatch: true },
    ])
    // A running tool (no end) still takes the minimum width.
    expect(runs.find((r) => r.fill === 'other')).toMatchObject({ x1: 50.2, x2: 52.2 })
  })

  it('places one tick per pixel column and marks Git, prompts, compactions and errors', () => {
    expect(toolTicks(steps, x)).toEqual([10, 21, 32, 40, 50])
    expect(stepMarks(steps, x)).toEqual([
      { x: 0, kind: 'prompt' },
      { x: 32, kind: 'git_write' },
      { x: 60, kind: 'compaction' },
      { x: 61, kind: 'error' },
    ])
  })

  it('draws the line solid where the agent worked: model and tool spans, merged across small gaps', () => {
    // 0–50 s of steps (gaps of at most 0.5 px), then a running MCP call from 50.2 s.
    expect(activeSpans(steps, x)).toEqual([{ x1: 0, x2: 52.2 }])
    const apart: ActivityStep[] = [
      { kind: 'model', start: 0, end: 5_000 },
      { kind: 'tool', start: 5_000, end: 6_000, category: 'read' },
      { kind: 'prompt', start: 100_000 },
      { kind: 'model', start: 100_000, end: 110_000 },
    ]
    expect(activeSpans(apart, x)).toEqual([
      { x1: 0, x2: 7 }, // the 1 s tool call takes the 2 px minimum
      { x1: 100, x2: 110 },
    ])
  })

  it('draws each kind of mark of an agent as one path', () => {
    expect(spansPath([{ x1: 0, x2: 4 }, { x1: 10, x2: 12 }], 10, 3)).toBe('M0.0,7.0h4.0v6.0h-4.0zM10.0,7.0h2.0v6.0h-2.0z')
    expect(strokesPath([5, 9], 4, 16)).toBe('M5.0,4.0V16.0M9.0,4.0V16.0')
    const runs = runPaths(stepRuns(steps, x), 10, 5)
    expect(runs.fills.map(([fill]) => fill)).toEqual(['thinking', 'model', 'read', 'shell', 'other'])
    expect(runs.hatch).toBe('M40.0,5.0h10.0v10.0h-10.0z')
    expect(runs.failed).toBe('M32.0,13.0h8.0v2h-8.0z')
    const marks = markPaths(stepMarks(steps, x), 10, 5)
    expect(marks.git_write).toBe('M32.0,5.0l5,5l-5,5l-5,-5z')
    expect(marks.prompt).toBe('M0.0,2.0V18.0')
    expect(marks.git_read).toBe('')
  })

  it('summarizes tools, commands, time and tokens', () => {
    const a: SessionActivity = {
      sessionId: 's',
      state: 'ok',
      steps,
      tokens: [
        { at: 0, input: 10, cacheRead: 900, cacheWrite: 90, output: 50, reasoning: 0, context: 1_000 },
        { at: 30_000, input: 5, cacheRead: 1_900, cacheWrite: 0, output: 20, reasoning: 0, context: 1_905 },
      ],
      totals: { input: 15, cacheRead: 2_800, cacheWrite: 90, output: 70, reasoning: 0 },
      truncated: false,
      version: 'v',
    }
    const s = summarize(a)
    expect(s).toMatchObject({ tools: 5, failed: 1, commands: 2, prompts: 1, compactions: 1, errors: 1, responses: 2, thinkingResponses: 1, latestContext: 1_905, peakContext: 1_905 })
    expect(s.verbs).toEqual([
      ['git commit', 1],
      ['npm test', 1],
    ])
    expect(s.modelMs).toBe(12_000)
    expect(s.toolMs).toBe(10_000 + 9_500 + 8_000 + 10_000)
    expect(s.thinkingMs).toBe(10_000)
    expect(s.toolMsByGroup).toEqual({ read: 19_500, edit: 0, shell: 18_000, other: 0 })
    // A line per field: tools, commands and time as stacked bars (parts grouped by colour), the
    // rest as figures; quantities in another unit only in the breakdown.
    const fields = activityFields(s)
    expect(fields.map((f) => f.label)).toEqual(['Tools', 'Commands', 'Time', 'Tokens', 'Cache hit', 'Context'])
    const [tools, commands, time, tokens, cache, context] = fields
    expect(tools).toMatchObject({ kind: 'bar', total: '5', extras: [{ label: 'Failed', value: '1', tone: 'failed' }] })
    expect(tools!.kind === 'bar' && tools!.parts.map((p) => [p.label, p.amount, p.tone])).toEqual([
      ['Read', 1, 'read'],
      ['Search', 1, 'read'],
      ['Git: change', 1, 'shell'],
      ['Test or build', 1, 'shell'],
      ['MCP', 1, 'other'],
    ])
    expect(commands!.kind === 'bar' && commands!.parts.map((p) => p.label)).toEqual(['git commit', 'npm test'])
    expect(time).toMatchObject({ total: '50 s' })
    expect(time!.kind === 'bar' && time!.parts.map((p) => [p.label, p.value])).toEqual([
      ['Model, thinking', '10 s'],
      ['Model', '2 s'],
      ['Read and search', '20 s'],
      ['Shell, Git, tests', '18 s'],
    ])
    expect(time!.kind === 'bar' && time!.extras.map((c) => c.label)).toEqual(['Prompts', 'Responses', 'With thinking', 'Errors'])
    expect(tokens).toEqual({ kind: 'chips', label: 'Tokens', chips: [{ label: 'In', value: '2.9k' }, { label: 'Out', value: '70' }] })
    expect(cache).toEqual({ kind: 'chips', label: 'Cache hit', chips: [{ value: '96 %' }] })
    expect(context).toEqual({ kind: 'chips', label: 'Context', chips: [{ value: '1.9k' }] })
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12_345)).toBe('12k')
    expect(formatTokens(1_234_567)).toBe('1.2M')
  })
})
