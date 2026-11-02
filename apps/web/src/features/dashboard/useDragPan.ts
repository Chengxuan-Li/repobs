import { type RefObject, useRef } from 'react'
import { pageZoom } from '../../components/placement'

// Drag to pan, like a map: press the primary mouse button anywhere on the dashboard that is not a
// control and move; the view scrolls with the pointer. A press that moves less than a few pixels
// stays a click (selecting a row, expanding a group). Touch and pens keep their native scrolling.
// Text in the view cannot be selected (dashboard.module.css), so a drag never starts a selection.

const THRESHOLD_PX = 4
/** Presses on these start no pan: controls keep their own drag and click behaviour. */
const NO_PAN = 'button, a, input, select, textarea, label, [role="menu"], [role="dialog"], [data-no-pan]'

export function useDragPan(ref: RefObject<HTMLElement | null>, onPanStart?: () => void) {
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number; panning: boolean } | null>(null)
  /** The click that ends a pan must not select what is under the pointer. */
  const swallowClick = useRef(false)

  const end = (e: React.PointerEvent) => {
    const d = drag.current
    const el = ref.current
    drag.current = null
    if (!d?.panning || !el) return
    delete el.dataset.panning
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    swallowClick.current = true
    // No click follows a release outside the view; do not swallow a later one.
    setTimeout(() => (swallowClick.current = false), 0)
  }

  return {
    onPointerDown: (e: React.PointerEvent) => {
      const el = ref.current
      if (!el || e.pointerType !== 'mouse' || e.button !== 0 || (e.target as Element).closest(NO_PAN)) return
      drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId, panning: false }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      const el = ref.current
      if (!d || !el || e.pointerId !== d.id) return
      // Pointer distances are screen pixels; scrolling is in page pixels (they differ at other UI sizes).
      const dx = (e.clientX - d.x) / pageZoom()
      const dy = (e.clientY - d.y) / pageZoom()
      if (!d.panning) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < THRESHOLD_PX) return
        d.panning = true
        el.setPointerCapture(d.id)
        el.dataset.panning = ''
        window.getSelection()?.removeAllRanges()
        onPanStart?.()
      }
      el.scrollLeft = d.left - dx
      el.scrollTop = d.top - dy
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e: React.MouseEvent) => {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.stopPropagation()
      e.preventDefault()
    },
  }
}
