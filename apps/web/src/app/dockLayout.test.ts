import { describe, expect, it } from 'vitest'
import { Actions, DockLocation, type TabNode } from 'flexlayout-react'
import { DASHBOARD_TAB, defaultLayout, MAIN_TABSET, PANELS, restoreLayout } from './dockLayout'

describe('dock layout', () => {
  it('starts with the dashboard in the centre and the panels in their side bars', () => {
    const model = restoreLayout(null)
    expect(model.getNodeById(DASHBOARD_TAB)).toBeDefined()
    for (const panel of Object.values(PANELS)) expect((model.getNodeById(panel.id) as TabNode).isInsideBorder()).toBe(true)
  })

  it('restores a stored arrangement, but never stored global settings', () => {
    const model = restoreLayout(null)
    model.doAction(Actions.moveNode(PANELS.details.id, MAIN_TABSET, DockLocation.RIGHT, -1))
    const stored = model.toJson()
    stored.global = { ...stored.global, tabEnableFloat: true }
    const restored = restoreLayout(JSON.stringify(stored))
    expect((restored.getNodeById(PANELS.details.id) as TabNode).isInsideBorder()).toBe(false)
    expect(restored.toJson().global?.tabEnableFloat ?? false).toBe(false) // the app's setting wins (false is the default, so it is omitted)
  })

  it('falls back to the default for unreadable or incomplete arrangements', () => {
    expect(restoreLayout('{not json').getNodeById(DASHBOARD_TAB)).toBeDefined()
    const noDashboard = { ...defaultLayout(), layout: { type: 'row' as const, children: [] } }
    expect(restoreLayout(JSON.stringify(noDashboard)).getNodeById(DASHBOARD_TAB)).toBeDefined()
  })
})
