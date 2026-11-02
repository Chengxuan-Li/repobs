import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddRepositoryDialog } from './AddRepositoryDialog'

// Browse opens a dialog outside the browser, so each outcome must show up in the page: a chosen
// folder, a cancel, a failure, and a way to stop waiting.

type Pending = { resolve: (r: Response) => void; signal?: AbortSignal | null }
let picks: Pending[] = []

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  picks = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/repositories/suggestions')) return Promise.resolve(json(200, { suggestions: [] }))
      return new Promise<Response>((resolve, reject) => {
        picks.push({ resolve, signal: init?.signal })
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function browse() {
  render(<AddRepositoryDialog onClose={() => undefined} onAdded={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))
  await screen.findByText(/A folder chooser is open on this computer/)
  expect(picks).toHaveLength(1)
}

describe('AddRepositoryDialog folder picker', () => {
  it('adds and ticks the chosen folder', async () => {
    await browse()
    await act(async () => picks[0]!.resolve(json(200, { path: 'D:\\work\\demo', cancelled: false })))
    expect((await screen.findByRole<HTMLInputElement>('checkbox', { name: /D:\\work\\demo/ })).checked).toBe(true)
    expect(screen.queryByText(/A folder chooser is open/)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Browse…' }).disabled).toBe(false)
  })

  it('says so when the chooser was closed without a folder', async () => {
    await browse()
    await act(async () => picks[0]!.resolve(json(200, { cancelled: true })))
    expect(await screen.findByText('The folder chooser was closed without choosing a folder.')).toBeTruthy()
  })

  it('shows the server error when the chooser fails', async () => {
    await browse()
    await act(async () => picks[0]!.resolve(json(500, { error: { code: 'picker_failed', message: 'The folder picker failed (exit code 1): boom' } })))
    expect((await screen.findByRole('alert')).textContent).toContain('The folder picker failed (exit code 1): boom')
  })

  it('stops waiting on request, aborting the call without reporting an error', async () => {
    await browse()
    fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }))
    expect(picks[0]!.signal?.aborted).toBe(true)
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: 'Browse…' })).disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/A folder chooser is open/)).toBeNull()
  })

  it('aborts a pending chooser when the dialog closes', async () => {
    await browse()
    cleanup()
    expect(picks[0]!.signal?.aborted).toBe(true)
  })
})
