import { describe, expect, it } from 'vitest'
import { roundedPath, routeEdges, TRACK_GAP } from './routing'

// Corner points of a path made by roundedPath: the start, each Q control point, the end.
const points = (d: string) => {
  const pair = (m: RegExpMatchArray) => [Number(m[1]), Number(m[2])] as const
  const ends = [...d.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)]
  return [pair(ends[0]!), ...[...d.matchAll(/Q([-\d.]+),([-\d.]+)/g)].map(pair), pair(ends.at(-1)!)]
}

describe('metro routing', () => {
  it('draws a single connector through node centres with rounded corners', () => {
    const d = routeEdges([{ key: 'f', x1: 100, y1: 14, x2: 200, y2: 70, order: 'vh' }]).get('f')!
    expect(d.startsWith('M100,14')).toBe(true)
    expect(d.endsWith('L200,70')).toBe(true)
    expect(d).toContain('Q100,70')
  })

  it('puts forks leaving one commit on parallel tracks, the longest in the middle', () => {
    const paths = routeEdges([
      { key: 'near', x1: 100, y1: 14, x2: 200, y2: 42, order: 'vh' },
      { key: 'far', x1: 100, y1: 14, x2: 300, y2: 98, order: 'vh' },
      { key: 'mid', x1: 100, y1: 14, x2: 250, y2: 70, order: 'vh' },
    ])
    const verticalX = (k: string) => points(paths.get(k)!)[1]![0]
    expect(verticalX('far')).toBe(100)
    expect(verticalX('mid')).toBe(100 + TRACK_GAP)
    expect(verticalX('near')).toBe(100 + 2 * TRACK_GAP) // turns first, so it sits outermost: no crossings
  })

  it('moves a merge leg off the lane it runs along', () => {
    const paths = routeEdges([
      { key: 'lane1', x1: 100, y1: 40, x2: 150, y2: 40, order: 'lane' },
      { key: 'lane2', x1: 150, y1: 40, x2: 200, y2: 40, order: 'lane' },
      { key: 'merge', x1: 100, y1: 40, x2: 250, y2: 14, order: 'hv' },
    ])
    expect(paths.get('lane1')).toBe('M100,40 L150,40')
    const legY = points(paths.get('merge')!)[1]![1]
    expect(legY).toBe(40 - TRACK_GAP) // merging upwards: offset towards the side it turns to
  })

  it('leaves legs that do not overlap on the centre line', () => {
    const paths = routeEdges([
      { key: 'a', x1: 100, y1: 14, x2: 200, y2: 42, order: 'vh' },
      { key: 'b', x1: 100, y1: 42, x2: 200, y2: 70, order: 'vh' },
    ])
    expect(points(paths.get('a')!)[1]![0]).toBe(100)
    expect(points(paths.get('b')!)[1]![0]).toBe(100)
  })

  it('rounds corners no wider than half the shorter neighbouring segment', () => {
    expect(roundedPath([[0, 0], [0, 4], [50, 4]])).toBe('M0,0 L0,2 Q0,4 2,4 L50,4')
    expect(roundedPath([[0, 0], [0, 0], [10, 0], [20, 0]])).toBe('M0,0 L20,0')
  })
})
