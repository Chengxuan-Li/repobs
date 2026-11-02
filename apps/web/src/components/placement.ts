// Placement of floating cards and popovers next to the element that opened them. The position
// depends on that element's box only, never on where the pointer moves inside it; the card is
// flipped or shifted only to stay inside the window.

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export type Placement = 'below' | 'right'

/** Distance kept from the window's edges (px). */
export const EDGE_MARGIN = 8

/** Elements wider than this anchor a card below at the point where the pointer entered them. */
export const WIDE_ANCHOR = 200

export interface PlaceOptions {
  placement: Placement
  /** Gap between the element and the card (px). */
  gap: number
  /** Below only: the card's left edge (an entry point on a wide element); default the element's left edge. */
  x?: number
}

/** Top-left corner of a card of `size` beside `anchor`, kept inside a window of `viewport`. */
export function placeFloating(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  { placement, gap, x }: PlaceOptions,
): { left: number; top: number } {
  const m = EDGE_MARGIN
  const fit = (pos: number, extent: number, room: number) => Math.max(m, Math.min(pos, room - m - extent))
  if (placement === 'right') {
    let left = anchor.right + gap
    if (left + size.width > viewport.width - m) {
      const before = anchor.left - gap - size.width
      left = before >= m ? before : fit(left, size.width, viewport.width)
    }
    return { left, top: fit(anchor.top, size.height, viewport.height) }
  }
  let top = anchor.bottom + gap
  if (top + size.height > viewport.height - m) {
    const above = anchor.top - gap - size.height
    top = above >= m ? above : fit(top, size.height, viewport.height)
  }
  return { left: fit(x ?? anchor.left, size.width, viewport.width), top }
}

/**
 * Zoom of the page (the UI size: CSS zoom on the root). Pointer coordinates, element boxes and the
 * window size are in screen pixels; positions, sizes and scroll offsets inside the page are in page
 * pixels, so screen distances are divided by this.
 */
export function pageZoom(): number {
  return document.documentElement.currentCSSZoom || 1
}

/** The box of an element as plain numbers (a DOMRect without its methods), in page pixels. */
export function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect()
  const z = pageZoom()
  return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z }
}

/** The window's size in page pixels. */
export function windowSize(): { width: number; height: number } {
  const z = pageZoom()
  return { width: window.innerWidth / z, height: window.innerHeight / z }
}
