import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tone } from '@repobs/contracts'
import { Toast } from './primitives'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Harness({ tone }: { tone: Tone }) {
  const [shown, setShown] = useState(true)
  const [, rerender] = useState(0)
  return (
    <>
      <button type="button" onClick={() => rerender((n) => n + 1)}>
        Re-render
      </button>
      {shown ? (
        <Toast tone={tone} timeout={1000} onDismiss={() => setShown(false)}>
          Done
        </Toast>
      ) : null}
    </>
  )
}

describe('Toast', () => {
  it('leaves by itself after the timeout, even when the parent re-renders meanwhile', () => {
    render(<Harness tone="info" />)
    act(() => vi.advanceTimersByTime(600))
    fireEvent.click(screen.getByRole('button', { name: 'Re-render' }))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.queryByText('Done')).toBeNull()
  })

  it('stays while the pointer is on it', () => {
    render(<Harness tone="info" />)
    fireEvent.mouseEnter(screen.getByRole('status'))
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByText('Done')).toBeTruthy()
    fireEvent.mouseLeave(screen.getByRole('status'))
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText('Done')).toBeNull()
  })

  it('keeps a failure until it is dismissed', () => {
    render(<Harness tone="danger" />)
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('alert').textContent).toContain('Done')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
