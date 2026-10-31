// Metro-map routing for the commit graph: every connector between rows is orthogonal (one vertical
// and one horizontal leg, rounded corners). Legs that would lie on top of each other — several
// forks dropping from one commit, a merge running along a branch's own lane — are moved onto
// parallel tracks a few pixels apart, so each line stays distinguishable. Pure; see routing.test.ts.

export interface RouteInput {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** lane: straight along one row; vh: vertical first (forks); hv: horizontal first (merges). */
  order: 'lane' | 'vh' | 'hv'
}

interface Segment {
  route: string
  /** 'v' segments share an x, 'h' segments share a y. */
  axis: 'v' | 'h'
  at: number
  lo: number
  hi: number
  /** Side the connector continues to at the turn (−1/+1), 0 for a straight line. */
  side: number
  /** Larger = keep closer to the shared centre (lines that turn later sit inside). */
  rank: number
  fixed?: boolean
  slot?: number
}

export const TRACK_GAP = 4
const MAX_SLOT = 4

/** Path data per route key. */
export function routeEdges(routes: RouteInput[], gap = TRACK_GAP): Map<string, string> {
  const segments: Segment[] = []
  const legs = new Map<string, { v?: Segment; h?: Segment }>()
  const seg = (route: string, axis: 'v' | 'h', at: number, a: number, b: number, turn: number, other: number, side: number, fixed = false) => {
    const s: Segment = { route, axis, at, lo: Math.min(a, b), hi: Math.max(a, b), side: Math.sign(side), rank: turn * Math.sign(turn - other) || Math.abs(b - a), fixed }
    segments.push(s)
    return s
  }
  for (const r of routes) {
    if (r.order === 'lane' || Math.abs(r.y2 - r.y1) < 0.5) {
      legs.set(r.key, { h: seg(r.key, 'h', r.y1, r.x1, r.x2, r.x2, r.x1, 0, r.order === 'lane') })
    } else if (Math.abs(r.x2 - r.x1) < 0.5) {
      legs.set(r.key, { v: seg(r.key, 'v', r.x1, r.y1, r.y2, r.y2, r.y1, 0) })
    } else if (r.order === 'vh') {
      legs.set(r.key, {
        v: seg(r.key, 'v', r.x1, r.y1, r.y2, r.y2, r.y1, r.x2 - r.x1),
        h: seg(r.key, 'h', r.y2, r.x1, r.x2, r.x1, r.x2, r.y1 - r.y2),
      })
    } else {
      legs.set(r.key, {
        h: seg(r.key, 'h', r.y1, r.x1, r.x2, r.x2, r.x1, r.y2 - r.y1),
        v: seg(r.key, 'v', r.x2, r.y1, r.y2, r.y1, r.y2, r.x1 - r.x2),
      })
    }
  }
  assignSlots(segments)

  const out = new Map<string, string>()
  for (const r of routes) {
    const { v, h } = legs.get(r.key)!
    const dv = (v?.slot ?? 0) * gap
    const dh = (h?.slot ?? 0) * gap
    let points: Array<[number, number]>
    if (v && h && r.order === 'vh') points = [[r.x1, r.y1], [r.x1 + dv, r.y1], [r.x1 + dv, r.y2 + dh], [r.x2, r.y2 + dh], [r.x2, r.y2]]
    else if (v && h) points = [[r.x1, r.y1], [r.x1, r.y1 + dh], [r.x2 + dv, r.y1 + dh], [r.x2 + dv, r.y2], [r.x2, r.y2]]
    else if (v) points = [[r.x1, r.y1], [r.x1 + dv, r.y1], [r.x1 + dv, r.y2], [r.x2, r.y2]]
    else points = [[r.x1, r.y1], [r.x1, r.y1 + dh], [r.x2, r.y2 + dh], [r.x2, r.y2]]
    out.set(r.key, roundedPath(points))
  }
  return out
}

/**
 * Within each group of collinear segments, give overlapping ones distinct tracks: fixed lanes keep
 * the centre, then the line that turns last takes the innermost free track on the side it turns to.
 */
function assignSlots(segments: Segment[]) {
  const groups = new Map<string, Segment[]>()
  for (const s of segments) {
    const k = `${s.axis}:${Math.round(s.at * 2) / 2}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  for (const group of groups.values()) {
    const placed: Segment[] = []
    for (const s of group.filter((g) => g.fixed)) {
      s.slot = 0
      placed.push(s)
    }
    for (const s of group.filter((g) => !g.fixed).sort((a, b) => b.rank - a.rank)) {
      // Own side first (no crossings); when that is full, the other side (a crossing, but still apart).
      const candidates = [0]
      for (let i = 1; i <= MAX_SLOT; i++) candidates.push(...(s.side ? [s.side * i] : [i, -i]))
      if (s.side) for (let i = 1; i <= MAX_SLOT; i++) candidates.push(-s.side * i)
      const free = candidates.find((c) => !placed.some((p) => p.slot === c && p.hi - s.lo > 1 && s.hi - p.lo > 1))
      s.slot = free ?? candidates.at(-1)!
      placed.push(s)
    }
  }
}

/** Polyline through axis-aligned points with rounded corners; zero-length and straight joints are dropped. */
export function roundedPath(points: Array<[number, number]>, radius = 6): string {
  const pts: Array<[number, number]> = []
  for (const p of points) {
    const last = pts.at(-1)
    if (last && Math.abs(last[0] - p[0]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01) continue
    const prev = pts.at(-2)
    if (prev && last && ((prev[0] === last[0] && last[0] === p[0]) || (prev[1] === last[1] && last[1] === p[1]))) pts.pop()
    pts.push(p)
  }
  const f = (n: number) => Math.round(n * 100) / 100
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1]!
    const [bx, by] = pts[i]!
    const [cx, cy] = pts[i + 1]!
    const lenIn = Math.abs(bx - ax) + Math.abs(by - ay)
    const lenOut = Math.abs(cx - bx) + Math.abs(cy - by)
    const r = Math.min(radius, lenIn / 2, lenOut / 2)
    const inX = bx - Math.sign(bx - ax) * r
    const inY = by - Math.sign(by - ay) * r
    const outX = bx + Math.sign(cx - bx) * r
    const outY = by + Math.sign(cy - by) * r
    d += ` L${f(inX)},${f(inY)} Q${f(bx)},${f(by)} ${f(outX)},${f(outY)}`
  }
  const end = pts.at(-1)!
  return pts.length > 1 ? `${d} L${f(end[0])},${f(end[1])}` : d
}
