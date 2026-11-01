import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Checklist, type DraftItem } from './Checklist'

afterEach(cleanup)

function Harness({ initial }: { initial: DraftItem[] }) {
  const [items, setItems] = useState(initial)
  return (
    <>
      <Checklist items={items} onChange={setItems} />
      <output data-testid="state">{JSON.stringify(items)}</output>
    </>
  )
}

const item = (id: string, text: string, done: boolean, order: number): DraftItem => ({ id, text, done, order })
const state = () => JSON.parse(screen.getByTestId('state').textContent ?? '[]') as DraftItem[]

describe('Checklist', () => {
  it('keeps a fully completed checklist listed, with nothing hidden or announced', () => {
    render(<Harness initial={[item('a', 'Read diff', true, 0), item('b', 'Run tests', false, 1)]} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Run tests' }))
    expect((screen.getByRole('checkbox', { name: 'Run tests' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Read diff' }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByText(/complete/i)).toBeNull()
    expect(state()).toHaveLength(2)
    // A ticked item can be unticked again.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read diff' }))
    expect(state().map((i) => i.done)).toEqual([false, true])
  })

  it('adds, reorders and explicitly deletes items', () => {
    render(<Harness initial={[item('a', 'First', false, 0)]} />)
    fireEvent.change(screen.getByLabelText('New checklist item'), { target: { value: 'Second' } })
    fireEvent.keyDown(screen.getByLabelText('New checklist item'), { key: 'Enter' })
    expect(state().map((i) => i.text)).toEqual(['First', 'Second'])
    fireEvent.click(screen.getByRole('button', { name: 'Move "Second" up' }))
    expect(state().map((i) => [i.text, i.order])).toEqual([
      ['Second', 0],
      ['First', 1],
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Delete "First"' }))
    expect(state().map((i) => i.text)).toEqual(['Second'])
  })

  it('renders hostile text literally', () => {
    render(<Harness initial={[item('x', '<img src=x onerror=alert(1)>', false, 0)]} />)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy()
    expect(document.querySelector('img')).toBeNull()
  })
})
