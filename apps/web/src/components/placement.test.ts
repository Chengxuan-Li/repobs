import { describe, expect, it } from 'vitest'
import { placeFloating } from './placement'

const viewport = { width: 1000, height: 800 }
const size = { width: 200, height: 100 }

describe('placeFloating', () => {
  it('puts a card below its element, aligned with the element’s left edge', () => {
    expect(placeFloating({ left: 100, top: 50, right: 160, bottom: 70 }, size, viewport, { placement: 'below', gap: 4 })).toEqual({ left: 100, top: 74 })
  })

  it('uses the entry point on a wide element, and the result does not depend on later pointer moves', () => {
    const anchor = { left: 0, top: 50, right: 900, bottom: 70 }
    expect(placeFloating(anchor, size, viewport, { placement: 'below', gap: 4, x: 420 })).toEqual({ left: 420, top: 74 })
  })

  it('flips above when there is no room below, and shifts left to stay inside the window', () => {
    expect(placeFloating({ left: 900, top: 750, right: 950, bottom: 770 }, size, viewport, { placement: 'below', gap: 4 })).toEqual({ left: 792, top: 646 })
  })

  it('puts a card to the right, or to the left when the right side has no room', () => {
    expect(placeFloating({ left: 10, top: 300, right: 300, bottom: 330 }, size, viewport, { placement: 'right', gap: 6 })).toEqual({ left: 306, top: 300 })
    expect(placeFloating({ left: 700, top: 300, right: 900, bottom: 330 }, size, viewport, { placement: 'right', gap: 6 })).toEqual({ left: 494, top: 300 })
  })

  it('keeps a card inside the window vertically', () => {
    expect(placeFloating({ left: 10, top: 760, right: 300, bottom: 790 }, size, viewport, { placement: 'right', gap: 6 }).top).toBe(692)
  })
})
