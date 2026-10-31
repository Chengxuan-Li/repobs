import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_VIEW, loadWorkbench, normalizeView } from './viewState'

describe('stored view state', () => {
  afterEach(() => localStorage.clear())

  it('reads the harness filter saved as one switch per harness', () => {
    expect(normalizeView({ filters: { claude: true, codex: false } }).filters.harnesses).toEqual(['claude'])
    expect(normalizeView({ filters: { claude: true, codex: true } }).filters.harnesses).toEqual([])
  })

  it('keeps only known values from a stored or opened view', () => {
    const v = normalizeView({ filters: { harnesses: ['codex', 'other'], statuses: ['ready', 'bogus'] }, axisMode: 'sideways', zoom: 999, hiddenRepos: ['r1', 3] })
    expect(v.filters.harnesses).toEqual(['codex'])
    expect(v.filters.statuses).toEqual(['unreviewed'])
    expect(v.axisMode).toBe('sequence')
    expect(v.zoom).toBe(16)
    expect(v.hiddenRepos).toEqual(['r1'])
    expect(normalizeView('nonsense')).toEqual(DEFAULT_VIEW)
  })

  it('carries the single view state from before views over to the existing dashboard', () => {
    localStorage.setItem('repobs.view.v2', JSON.stringify({ selectedId: 'session:x', repoSort: 'name', hiddenRepos: ['r2'], axisMode: 'time' }))
    const bench = loadWorkbench()
    expect(bench.selectedId).toBe('session:x')
    expect(bench.repoSort).toBe('name')
    expect(bench.views).toEqual({})
    expect(bench.legacy).toMatchObject({ hiddenRepos: ['r2'], axisMode: 'time' })
  })

  it('reads per-view settings', () => {
    localStorage.setItem('repobs.workbench.v1', JSON.stringify({ repoSort: 'active', views: { 'view:a': { hiddenRepos: ['r1'] }, 'view:b': {} } }))
    const bench = loadWorkbench()
    expect(bench.views['view:a']?.hiddenRepos).toEqual(['r1'])
    expect(bench.views['view:b']?.hiddenRepos).toEqual([])
    expect(bench.repoSort).toBe('active')
  })
})
