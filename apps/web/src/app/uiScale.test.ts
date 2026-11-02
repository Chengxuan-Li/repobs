import { afterEach, describe, expect, it } from 'vitest'
import { applyUiScale, normalizeUiScale, readUiScale, stepUiScale, uiScaleKey, wheelStep } from './uiScale'

describe('UI size', () => {
  afterEach(() => {
    applyUiScale(1)
    localStorage.clear()
  })

  it('keeps stored sizes within range, rounded to whole percent', () => {
    expect(normalizeUiScale('1.25')).toBe(1.25)
    expect(normalizeUiScale(1.2345)).toBe(1.23)
    expect(normalizeUiScale(9)).toBe(2)
    expect(normalizeUiScale(0.1)).toBe(0.5)
    expect(normalizeUiScale('nonsense')).toBe(1)
    expect(normalizeUiScale(-1)).toBe(1)
  })

  it('steps in whole 10 %, also from a size between steps, and stops at the ends', () => {
    expect(stepUiScale(1, 1)).toBe(1.1)
    expect(stepUiScale(1, -1)).toBe(0.9)
    expect(stepUiScale(1.1, 1)).toBe(1.2)
    expect(stepUiScale(0.7, -1)).toBe(0.6)
    expect(stepUiScale(1.16, 1)).toBe(1.2)
    expect(stepUiScale(1.16, -1)).toBe(1.1)
    expect(stepUiScale(2, 1)).toBe(2)
    expect(stepUiScale(0.5, -1)).toBe(0.5)
  })

  it('makes one step per wheel notch (up: larger), and adds up the small movements of a pinch', () => {
    expect(wheelStep(0, { deltaY: -100, deltaMode: 0 })).toEqual({ step: 1, pending: 0 })
    expect(wheelStep(0, { deltaY: 125, deltaMode: 0 })).toEqual({ step: -1, pending: 0 })
    expect(wheelStep(0, { deltaY: 3, deltaMode: 1 })).toEqual({ step: -1, pending: 0 })
    let pending = 0
    const steps: number[] = []
    for (let i = 0; i < 12; i++) {
      const r = wheelStep(pending, { deltaY: -10, deltaMode: 0 })
      pending = r.pending
      if (r.step) steps.push(r.step)
    }
    expect(steps).toEqual([1, 1])
    expect(wheelStep(-30, { deltaY: 20, deltaMode: 0 })).toEqual({ step: 0, pending: -10 })
  })

  it('reads Ctrl + = / + / − / 0 on the main row and the numpad, and nothing without Ctrl or with Alt', () => {
    const k = (key: string, code: string, mods: Partial<KeyboardEvent> = { ctrlKey: true }) => uiScaleKey({ key, code, ctrlKey: false, metaKey: false, altKey: false, ...mods })
    expect(k('=', 'Equal')).toBe('in')
    expect(k('+', 'Equal')).toBe('in')
    expect(k('+', 'NumpadAdd')).toBe('in')
    expect(k('-', 'Minus')).toBe('out')
    expect(k('-', 'NumpadSubtract')).toBe('out')
    expect(k('0', 'Digit0')).toBe('reset')
    expect(k('0', 'Digit0', { metaKey: true })).toBe('reset')
    expect(k('=', 'Equal', {})).toBeUndefined()
    expect(k('=', 'Equal', { ctrlKey: true, altKey: true })).toBeUndefined()
    expect(k('k', 'KeyK')).toBeUndefined()
  })

  it('applies the size to the page and remembers it for this browser', () => {
    applyUiScale(1.25)
    expect(document.documentElement.style.getPropertyValue('zoom')).toBe('1.25')
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe('1.25')
    expect(readUiScale()).toBe(1.25)
    applyUiScale(1)
    expect(document.documentElement.style.getPropertyValue('zoom')).toBe('')
    expect(localStorage.getItem('repobs.uiScale')).toBeNull()
    expect(readUiScale()).toBe(1)
  })
})
