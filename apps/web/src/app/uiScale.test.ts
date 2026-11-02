import { afterEach, describe, expect, it } from 'vitest'
import { applyUiScale, normalizeUiScale, readUiScale, stepUiScale, uiScaleKey, wheelUiScale } from './uiScale'

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

  it('steps to the next listed size, also from a size between steps', () => {
    expect(stepUiScale(1, 1)).toBe(1.1)
    expect(stepUiScale(1, -1)).toBe(0.9)
    expect(stepUiScale(1.16, 1)).toBe(1.25)
    expect(stepUiScale(1.16, -1)).toBe(1.1)
    expect(stepUiScale(2, 1)).toBe(2)
    expect(stepUiScale(0.5, -1)).toBe(0.5)
  })

  it('grows when the wheel moves up and shrinks when it moves down, in pixels, lines or pages', () => {
    expect(wheelUiScale(1, { deltaY: -100, deltaMode: 0 })).toBeGreaterThan(1.1)
    expect(wheelUiScale(1, { deltaY: 100, deltaMode: 0 })).toBeLessThan(0.9)
    expect(wheelUiScale(1, { deltaY: 3, deltaMode: 1 })).toBeCloseTo(wheelUiScale(1, { deltaY: 99, deltaMode: 0 }), 2)
    expect(wheelUiScale(1, { deltaY: -1, deltaMode: 2 })).toBe(2)
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
