import { describe, expect, it } from 'vitest'
import type { CommitGraph, CommitNode } from '@repobs/contracts'
import { buildTimeline, PAD } from './timeline'

const DAY = 86_400_000
const now = Date.parse('2026-10-30T12:00:00Z')
const c = (oid: string, daysAgo: number): CommitNode => ({ oid, parents: [], time: Math.round((now - daysAgo * DAY) / 1000), subject: oid, pushed: true })
const graph = (repoId: string, commits: CommitNode[]): CommitGraph => ({ repoId, commits, truncated: false, scannedAt: 'x' })

describe('shared timeline', () => {
  const graphs = [graph('a', [c('a1', 300), c('a2', 2)]), graph('b', [c('b1', 100), c('b2', 1)])]

  it('sequence mode spaces commits evenly in time order across repositories', () => {
    const t = buildTimeline({ mode: 'sequence', graphs, activity: [], rangeStart: null, now, availableWidth: 400, minSpacing: 20 })
    const xs = ['a1', 'b1', 'a2', 'b2'].map((o) => t.commitX(o)!)
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!)
    expect(new Set(gaps.map((g) => g.toFixed(3))).size).toBe(1) // equal spacing despite 300 vs 1 day gaps
    expect(t.nowX).toBeGreaterThan(xs[3]!)
    expect(t.ticks.length).toBeGreaterThan(0)
  })

  it('sequence mode interpolates agent activity between neighbouring commits', () => {
    const t = buildTimeline({ mode: 'sequence', graphs, activity: [], rangeStart: null, now, availableWidth: 400, minSpacing: 20 })
    const mid = t.x(now - 50 * DAY) // between b1 (100d) and a2 (2d)
    expect(mid).toBeGreaterThan(t.commitX('b1')!)
    expect(mid).toBeLessThan(t.commitX('a2')!)
    expect(t.x(now)).toBe(t.nowX)
  })

  it('sequence mode grows wider than the viewport when there are many commits', () => {
    const many = graph('m', Array.from({ length: 200 }, (_, i) => c(`m${i}`, 200 - i)))
    const t = buildTimeline({ mode: 'sequence', graphs: [many], activity: [], rangeStart: null, now, availableWidth: 500, minSpacing: 18 })
    expect(t.width).toBeGreaterThanOrEqual(2 * PAD + 18 * 201)
  })

  it('a range drops older commits from the axis', () => {
    const t = buildTimeline({ mode: 'sequence', graphs, activity: [], rangeStart: now - 30 * DAY, now, availableWidth: 400, minSpacing: 20 })
    expect(t.commitX('a1')).toBeUndefined()
    expect(t.commitX('a2')).toBeDefined()
  })

  it('time mode is a linear calendar scale', () => {
    const t = buildTimeline({ mode: 'time', graphs, activity: [], rangeStart: now - 10 * DAY, now, availableWidth: 1000, minSpacing: 20 })
    const x2 = t.commitX('a2')!
    const x1 = t.commitX('b2')!
    expect(x1 - x2).toBeGreaterThan(50) // one day apart on a ~10-day axis of ~1000px
    expect(t.commitX('a1')).toBeUndefined()
    expect(t.width).toBe(1000)
  })
})
