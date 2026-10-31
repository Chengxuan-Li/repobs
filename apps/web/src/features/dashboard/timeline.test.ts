import { describe, expect, it } from 'vitest'
import type { CommitGraph, CommitNode } from '@repobs/contracts'
import { buildTimeline, PAD } from './timeline'

const DAY = 86_400_000
const now = Date.parse('2026-10-30T12:00:00Z')
const c = (oid: string, daysAgo: number): CommitNode => ({ oid, parents: [], time: Math.round((now - daysAgo * DAY) / 1000), subject: oid, pushed: true })
const graph = (repoId: string, commits: CommitNode[]): CommitGraph => ({ repoId, commits, truncated: false, scannedAt: 'x' })

const itemsOf = (gs: CommitGraph[]) => gs.flatMap((g) => g.commits.map((x) => ({ key: x.oid, time: x.time * 1000 })))

describe('shared timeline', () => {
  const graphs = [graph('a', [c('a1', 300), c('a2', 2)]), graph('b', [c('b1', 100), c('b2', 1)])]

  it('sequence mode spaces commits evenly in time order across repositories', () => {
    const t = buildTimeline({ mode: 'sequence', items: itemsOf(graphs), activity: [], rangeStart: null, now, availableWidth: 400, minSpacing: 20 })
    const xs = ['a1', 'b1', 'a2', 'b2'].map((o) => t.commitX(o)!)
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!)
    expect(new Set(gaps.map((g) => g.toFixed(3))).size).toBe(1) // equal spacing despite 300 vs 1 day gaps
    expect(t.nowX).toBeGreaterThan(xs[3]!)
    expect(t.ticks.length).toBeGreaterThan(0)
  })

  it('sequence mode interpolates agent activity between neighbouring commits', () => {
    const t = buildTimeline({ mode: 'sequence', items: itemsOf(graphs), activity: [], rangeStart: null, now, availableWidth: 400, minSpacing: 20 })
    const mid = t.x(now - 50 * DAY) // between b1 (100d) and a2 (2d)
    expect(mid).toBeGreaterThan(t.commitX('b1')!)
    expect(mid).toBeLessThan(t.commitX('a2')!)
    expect(t.x(now)).toBe(t.nowX)
  })

  it('sequence mode grows wider than the viewport when there are many commits', () => {
    const many = graph('m', Array.from({ length: 200 }, (_, i) => c(`m${i}`, 200 - i)))
    const t = buildTimeline({ mode: 'sequence', items: itemsOf([many]), activity: [], rangeStart: null, now, availableWidth: 500, minSpacing: 18 })
    expect(t.width).toBeGreaterThanOrEqual(2 * PAD + 18 * 201)
  })

  it('a range drops older commits from the axis', () => {
    const t = buildTimeline({ mode: 'sequence', items: itemsOf(graphs), activity: [], rangeStart: now - 30 * DAY, now, availableWidth: 400, minSpacing: 20 })
    expect(t.commitX('a1')).toBeUndefined()
    expect(t.commitX('a2')).toBeDefined()
  })

  it('a collapsed group takes a single column', () => {
    const items = [...itemsOf(graphs).filter((i) => i.key !== 'a1' && i.key !== 'b1'), { key: 'grp:a1', time: now - 100 * DAY }]
    const t = buildTimeline({ mode: 'sequence', items, activity: [], rangeStart: null, now, availableWidth: 400, minSpacing: 20 })
    const xs = ['grp:a1', 'a2', 'b2'].map((k) => t.commitX(k)!)
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!)
    expect(t.commitX('a1')).toBeUndefined()
  })

  it('time mode is a linear calendar scale', () => {
    const t = buildTimeline({ mode: 'time', items: itemsOf(graphs), activity: [], rangeStart: now - 10 * DAY, now, availableWidth: 1000, minSpacing: 20 })
    const x2 = t.commitX('a2')!
    const x1 = t.commitX('b2')!
    expect(x1 - x2).toBeGreaterThan(50) // one day apart on a ~10-day axis of ~1000px
    expect(t.commitX('a1')).toBeUndefined()
    expect(t.width).toBe(1000)
  })

  it('compressed mode follows the calendar but keeps a minimum gap between items', () => {
    const minute = 60_000
    const burst = [c('old', 9), ...Array.from({ length: 5 }, (_, i) => ({ ...c(`b${i}`, 3), time: Math.round((now - 3 * DAY + i * minute) / 1000) }))]
    const input = { mode: 'compressed' as const, items: itemsOf([graph('r', burst)]), activity: [], rangeStart: null, now, availableWidth: 1000, minSpacing: 20 }
    const t = buildTimeline(input)
    const xs = ['b0', 'b1', 'b2', 'b3', 'b4'].map((k) => t.commitX(k)!)
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(20) // a burst a minute apart: pushed apart
    // Six days between "old" and the burst is a large, time-proportional gap.
    expect(t.commitX('b0')! - t.commitX('old')!).toBeGreaterThan(400)
    expect(t.width).toBeGreaterThanOrEqual(1000)
    expect(t.x(now - 3 * DAY + 2.5 * minute)).toBeGreaterThan(xs[2]!) // activity interpolates between items
    expect(t.x(now - 3 * DAY + 2.5 * minute)).toBeLessThan(xs[3]!)
    expect(t.ticks.some((k) => k.label === 'now')).toBe(true)

    // Zoom scales only the time part: the burst stays at the minimum gap, the long gap grows.
    const zoomed = buildTimeline({ ...input, zoom: 2 })
    expect(zoomed.commitX('b1')! - zoomed.commitX('b0')!).toBeCloseTo(20)
    expect(zoomed.commitX('b0')! - zoomed.commitX('old')!).toBeGreaterThan(1.9 * (t.commitX('b0')! - t.commitX('old')!))
    const out = buildTimeline({ ...input, zoom: 0.1 })
    expect(out.commitX('b0')! - out.commitX('old')!).toBeGreaterThanOrEqual(20)
  })

  it('zoom widens both axes proportionally and never shrinks below the viewport', () => {
    const many = graph('m', Array.from({ length: 200 }, (_, i) => c(`m${i}`, 200 - i)))
    const base = { mode: 'sequence' as const, items: itemsOf([many]), activity: [], rangeStart: null, now, availableWidth: 500, minSpacing: 20 }
    const gap = (t: ReturnType<typeof buildTimeline>) => t.commitX('m1')! - t.commitX('m0')!
    expect(gap(buildTimeline({ ...base, zoom: 2 }))).toBeCloseTo(2 * gap(buildTimeline(base)))
    expect(gap(buildTimeline({ ...base, zoom: 0.5 }))).toBeCloseTo(10)
    const few = buildTimeline({ ...base, items: itemsOf(graphs), zoom: 0.25 })
    expect(few.width).toBe(500)
    const time = buildTimeline({ ...base, mode: 'time', zoom: 3 })
    expect(time.width).toBe(1500)
  })
})
