import { useCallback, useEffect, useState } from 'react'

// UI size: repobs's own zoom of the whole workbench (text, controls, panels), applied as CSS zoom
// on the root element. Ctrl + wheel and Ctrl + = / − / 0 change it instead of the browser's zoom,
// which those inputs would otherwise trigger. Per browser, like the cached theme; the first frame
// applies it from public/theme-init.js. Pointer and box coordinates stay in screen pixels; code
// that turns them into positions or scroll offsets divides by the page zoom (components/placement.ts).
// FlexLayout mixes the two, so its frame is zoomed back to 1 and scaled through --ui-scale instead,
// and each panel inside it is zoomed again (dock.css, shell.module.css .panelScale).

const KEY = 'repobs.uiScale'
export const MIN_UI_SCALE = 0.5
export const MAX_UI_SCALE = 2
/** Sizes Ctrl + = / − step through (the wheel changes the size continuously). */
export const UI_SCALE_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** A stored or computed size, rounded to whole percent and kept within range (1 when invalid). */
export function normalizeUiScale(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Math.round(n * 100) / 100))
}

/** The next step larger (+1) or smaller (−1) than `scale`. */
export function stepUiScale(scale: number, direction: 1 | -1): number {
  const next = direction > 0 ? UI_SCALE_STEPS.find((s) => s > scale + 0.001) : UI_SCALE_STEPS.findLast((s) => s < scale - 0.001)
  return next ?? scale
}

/** Wheel distance in pixels (lines and pages converted), for zooming by wheel. */
export function wheelPixels(e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  return e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1)
}

/** The size after a Ctrl + wheel movement: about 15 % per wheel notch, smooth on touchpads. */
export function wheelUiScale(scale: number, e: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  return normalizeUiScale(scale * Math.exp(-wheelPixels(e) * 0.0015))
}

/** The UI-size change a key press asks for (Ctrl + = / + / − / 0, main row or numpad), if any. */
export function uiScaleKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>): 'in' | 'out' | 'reset' | undefined {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return undefined
  if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') return 'in'
  if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') return 'out'
  if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') return 'reset'
  return undefined
}

export function readUiScale(): number {
  try {
    return normalizeUiScale(localStorage.getItem(KEY) ?? 1)
  } catch {
    return 1
  }
}

/** Apply the size and remember it for this browser. */
export function applyUiScale(scale: number) {
  const root = document.documentElement
  for (const prop of ['zoom', '--ui-scale']) {
    if (scale === 1) root.style.removeProperty(prop)
    else root.style.setProperty(prop, String(scale))
  }
  try {
    if (scale === 1) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, String(scale))
  } catch {
    // storage unavailable: the size lasts until the page reloads
  }
}

/** The UI size, its commands, and the Ctrl + wheel / Ctrl + key handlers that replace browser zoom. */
export function useUiScale() {
  const [scale, setScaleState] = useState(readUiScale)
  const setScale = useCallback((next: number | ((s: number) => number)) => setScaleState((s) => normalizeUiScale(typeof next === 'function' ? next(s) : next)), [])

  useEffect(() => applyUiScale(scale), [scale])

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      // Ctrl + wheel (and touchpad pinch, which arrives as one) would zoom the browser.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setScale((s) => wheelUiScale(s, e))
    }
    const onKey = (e: KeyboardEvent) => {
      const action = uiScaleKey(e)
      if (!action) return
      // Also while typing: the browser would zoom otherwise. The ribbon skips handled keys.
      e.preventDefault()
      setScale((s) => (action === 'reset' ? 1 : stepUiScale(s, action === 'in' ? 1 : -1)))
    }
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.removeEventListener('wheel', onWheel, { capture: true })
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [setScale])

  return {
    scale,
    zoomIn: () => setScale((s) => stepUiScale(s, 1)),
    zoomOut: () => setScale((s) => stepUiScale(s, -1)),
    reset: () => setScale(1),
  }
}
