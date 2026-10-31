import { afterEach, describe, expect, it } from 'vitest'
import { loadView } from './viewState'

describe('stored view state', () => {
  afterEach(() => localStorage.clear())
  const store = (filters: object) => localStorage.setItem('repobs.view.v2', JSON.stringify({ filters }))

  it('reads the harness filter saved as one switch per harness', () => {
    store({ claude: true, codex: false })
    expect(loadView().filters.harnesses).toEqual(['claude'])
    store({ claude: true, codex: true })
    expect(loadView().filters.harnesses).toEqual([])
  })

  it('keeps only known harnesses from a saved list', () => {
    store({ harnesses: ['codex', 'other'] })
    expect(loadView().filters.harnesses).toEqual(['codex'])
  })
})
