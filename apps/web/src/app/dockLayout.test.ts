import { describe, expect, it } from 'vitest'
import { Actions, DockLocation, Model, type TabNode } from 'flexlayout-react'
import { defaultLayout, MAIN_TABSET, nextViewName, PANELS, restoreLayout, viewTabs } from './dockLayout'

describe('dock layout', () => {
  it('starts with one view, "View 0", in the centre and the panels in their side bars', () => {
    const model = restoreLayout(null)
    expect(viewTabs(model).map((t) => t.getName())).toEqual(['View 0'])
    for (const panel of Object.values(PANELS)) expect((model.getNodeById(panel.id) as TabNode).isInsideBorder()).toBe(true)
  })

  it('names a new view with the smallest unused number', () => {
    expect(nextViewName([])).toBe('View 0')
    expect(nextViewName(['View 0', 'View 1'])).toBe('View 2')
    // Renaming "View 0" frees its number.
    expect(nextViewName(['View main', 'View 1'])).toBe('View 0')
    expect(nextViewName(['view 0', ' View 2 ', 'Viewpoint 1'])).toBe('View 1')
  })

  it('restores a stored arrangement with several views, but never stored global settings', () => {
    const model = Model.fromJson(defaultLayout([{ id: 'view:a', name: 'View main' }, { id: 'view:b', name: 'View 1' }]))
    model.doAction(Actions.moveNode(PANELS.details.id, MAIN_TABSET, DockLocation.RIGHT, -1))
    const stored = model.toJson()
    stored.global = { ...stored.global, tabEnableFloat: true }
    const restored = restoreLayout(JSON.stringify(stored))
    expect(viewTabs(restored).map((t) => t.getName())).toEqual(['View main', 'View 1'])
    expect((restored.getNodeById(PANELS.details.id) as TabNode).isInsideBorder()).toBe(false)
    expect(restored.toJson().global?.tabEnableFloat ?? false).toBe(false) // the app's setting wins (false is the default, so it is omitted)
  })

  it('turns the dashboard of an arrangement from before views into View 0, keeping its id', () => {
    const old = defaultLayout()
    old.layout.children = [{ type: 'tabset', id: MAIN_TABSET, children: [{ type: 'tab', id: 'tab:dashboard', name: 'Dashboard', component: 'dashboard', enableClose: false }] }]
    const restored = restoreLayout(JSON.stringify(old))
    const [view] = viewTabs(restored)
    expect(view?.getId()).toBe('tab:dashboard')
    expect(view?.getName()).toBe('View 0')
    expect(view?.isEnableClose()).toBe(true)
  })

  it('falls back to the default for unreadable arrangements or ones without a view', () => {
    expect(viewTabs(restoreLayout('{not json'))).toHaveLength(1)
    const noView = { ...defaultLayout(), layout: { type: 'row' as const, children: [] } }
    expect(viewTabs(restoreLayout(JSON.stringify(noView)))).toHaveLength(1)
  })

  it('widens side bars narrower than the panels need', () => {
    const narrow = defaultLayout()
    narrow.borders![0]!.size = 120
    const restored = restoreLayout(JSON.stringify(narrow))
    expect(restored.toJson().borders![0]!.size).toBeGreaterThanOrEqual(PANELS.repositories.minWidth)
  })
})
