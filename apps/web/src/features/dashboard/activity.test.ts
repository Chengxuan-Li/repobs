import { describe, expect, it } from 'vitest'
import type { ActivityStep, SessionActivity } from '@repobs/contracts'
import { contextPath, formatTokens, groupOf, stepMarks, stepRuns, summarize, toolTicks } from './activity'

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

  it('draws the context fill as steps scaled to the window', () => {
    const tokens = [
      { at: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, context: 50_000 },
      { at: 10_000, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, context: 100_000 },
    ]
    expect(contextPath(tokens, x, 0, 10, 100_000, 30)).toBe('M0.0,10 L0.0,5.0 L10.0,5.0 L10.0,0.0 L30.0,0.0 L30.0,10 Z')
    expect(contextPath([], x, 0, 10, 1, 1)).toBe('')
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
    expect(s).toMatchObject({ tools: 5, failed: 1, prompts: 1, compactions: 1, errors: 1, responses: 2, thinkingResponses: 1, latestContext: 1_905, peakContext: 1_905 })
    expect(s.verbs).toEqual([
      ['git commit', 1],
      ['npm test', 1],
    ])
    expect(s.modelMs).toBe(12_000)
    expect(s.toolMs).toBe(10_000 + 9_500 + 8_000 + 10_000)
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(12_345)).toBe('12k')
    expect(formatTokens(1_234_567)).toBe('1.2M')
  })
})
