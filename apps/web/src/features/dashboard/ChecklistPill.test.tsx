import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChecklistEntry } from './checklistEntries'
import { ChecklistPill, Pie } from './ChecklistPill'

afterEach(cleanup)

const mine = (id: string, text: string, done: boolean): ChecklistEntry => ({ id, text, done, section: 'human' })

function Harness({ initial = [mine('a', 'Read the diff', true), mine('b', 'Run the tests', false)] }: { initial?: ChecklistEntry[] }) {
  const [items, setItems] = useState(initial)
  return (
    <ChecklistPill
      entries={items}
      planSource="Claude task list"
      title="Parser fix"
      onToggle={(entry, done) => {
        setItems((l) => l.map((i) => (i.id === entry.id ? { ...i, done } : i)))
        return Promise.resolve(true)
      }}
    />
  )
}

describe('checklist pill', () => {
  it('shows done / total; hovering and clicking open the same list, where items can be ticked and unticked', async () => {
    render(<Harness />)
    const pill = screen.getByRole('button', { name: 'Checklist of Parser fix: 1 of 2 done' })
    expect(pill.textContent).toBe('1/2')

    // Hover: the list with check boxes; it stays while the pointer is on it and closes after it leaves.
    fireEvent.mouseEnter(pill)
    const list = screen.getByRole('dialog', { name: 'Checklist of Parser fix' })
    fireEvent.mouseLeave(pill)
    fireEvent.mouseEnter(list)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Run the tests' }))
    expect(pill.textContent).toBe('2/2')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read the diff' }))
    expect(pill.textContent).toBe('1/2')
    fireEvent.mouseLeave(list)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Click: the same list, kept open after the pointer leaves, closed by Escape.
    fireEvent.click(pill)
    fireEvent.mouseLeave(pill)
    await new Promise((r) => setTimeout(r, 250))
    expect(screen.getByRole('checkbox', { name: 'Run the tests' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Run the tests' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a tick at once and undoes it when saving fails', async () => {
    render(<ChecklistPill entries={[mine('a', 'Run the tests', false)]} title="Parser fix" onToggle={() => Promise.resolve(false)} />)
    fireEvent.click(screen.getByRole('button', { name: /^Checklist of Parser fix/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Run the tests' }))
    expect((screen.getByRole('checkbox', { name: 'Run the tests' }) as HTMLInputElement).checked).toBe(true)
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Run the tests' }) as HTMLInputElement).checked).toBe(false))
  })

  it('fills its pie clockwise by the share of items done', () => {
    const half = render(<Pie fraction={0.5} size={10} />)
    // From 12 o'clock clockwise to 6 o'clock: a half disc.
    expect(half.container.querySelector('path')?.getAttribute('d')).toBe('M5,5 L5,0 A5,5 0 0 1 5,10 Z')
    half.unmount()
    const full = render(<Pie fraction={1} />)
    expect(full.container.querySelectorAll('circle')).toHaveLength(2)
    expect(full.container.querySelector('path')).toBeNull()
  })

  it("lists the agent's plan first, then your items, with notes on steps in progress and your overrides", () => {
    render(
      <Harness
        initial={[
          { id: 'plan:1', text: 'Write the parser', done: true, section: 'agent', agentStatus: 'completed' },
          { id: 'plan:2', text: 'Wire it up', done: false, section: 'agent', agentStatus: 'in_progress' },
          { id: 'plan:3', text: 'Ship', done: true, section: 'agent', agentStatus: 'pending', overridden: true },
          mine('m', 'Review the diff', false),
        ]}
      />,
    )
    const pill = screen.getByRole('button', { name: 'Checklist of Parser fix: 2 of 4 done' })
    fireEvent.mouseEnter(pill)
    const agent = screen.getByRole('region', { name: 'Agent plan' })
    expect(agent.textContent).toContain('Agent plan · Claude task list')
    expect(agent.textContent).toContain('in progress')
    expect(agent.textContent).toContain('ticked by you')
    expect(screen.getByRole('region', { name: 'Your items' }).textContent).toContain('Yours')
    const boxes = screen.getAllByRole('checkbox').map((b) => b.getAttribute('aria-label') ?? b.parentElement?.textContent)
    expect(boxes[0]).toContain('Write the parser')
    expect(boxes[3]).toContain('Review the diff')
  })

  it('renders nothing without items', () => {
    const { container } = render(<ChecklistPill entries={[]} title="x" onToggle={() => Promise.resolve(true)} />)
    expect(container.textContent).toBe('')
  })
})
