import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AutomationRuleInput, AutomationRuleStatus, Snapshot } from '@repobs/contracts'
import { buildGitFixture, type GitFixture } from '../../fixtures/git-fixtures.ts'
import { claude, writeClaudeSession } from '../../fixtures/session-fixtures.ts'
import { startTestServer, type Client, type TestServer } from '../helpers/server.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

// Automation rules end to end through the API: preview, apply once per revision, keep the
// person's later edits, re-apply on a new revision, switch on and off, delete (ADR 0008).

let t: TestServer
let c: Client
let fx: GitFixture
let fxRoot: string
const now = Date.now()
const daysAgo = (d: number) => now - d * 86_400_000

const OLD = 'claude:old-1'
const RECENT = 'claude:new-1'

beforeAll(async () => {
  fxRoot = makeTempDir('automation-git')
  fx = buildGitFixture(fxRoot)
  t = await startTestServer()
  c = await t.pair()
  writeClaudeSession(t.claudeHome, fx.repoA, 'old-1', [claude.title('old-1', 'Old spike'), claude.endTurn('old-1', fx.repoA, daysAgo(10))])
  writeClaudeSession(t.claudeHome, fx.repoA, 'new-1', [claude.title('new-1', 'Fresh fix'), claude.endTurn('new-1', fx.repoA, daysAgo(1))])
  expect((await c.send('POST', '/api/v1/repositories', { path: fx.repoA })).status).toBe(201)
  await t.running.monitor.refreshAll()
})
afterAll(async () => {
  await t.close()
  removeDir(fxRoot)
})

const snapshot = async (): Promise<Snapshot> => (await c.get('/api/v1/snapshot')).json()
const annotationOf = async (id: string) => (await snapshot()).annotations.find((a) => a.sessionId === id)
const rules = async (): Promise<AutomationRuleStatus[]> => (await c.get('/api/v1/automation/rules')).json()

const stale: AutomationRuleInput = {
  name: 'Idle for a week',
  enabled: true,
  match: 'all',
  conditions: [{ kind: 'last_activity', op: 'older_than', amount: 7, unit: 'days' }],
  actions: [
    { kind: 'set_review', review: 'outdated' },
    { kind: 'add_checklist_item', text: 'Decide whether to delete the branch' },
  ],
}

describe('automation rules', () => {
  let ruleId: string

  it('previews the agents a rule matches without changing anything', async () => {
    const res = await c.send('POST', '/api/v1/automation/preview', stale)
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ matching: 1, examples: [{ sessionId: OLD, title: 'Old spike' }] })
    expect(await annotationOf(OLD)).toBeUndefined()
  })

  it('applies a new rule at once to the agents it matches, and only to them', async () => {
    const res = await c.send('POST', '/api/v1/automation/rules', stale)
    expect(res.status).toBe(200)
    ruleId = res.json().id
    expect(res.json()).toMatchObject({ revision: 1, enabled: true })
    expect(await annotationOf(OLD)).toMatchObject({ review: 'outdated', checklistOpen: 1, checklist: [{ text: 'Decide whether to delete the branch', done: false }] })
    expect(await annotationOf(RECENT)).toBeUndefined()
    expect(await rules()).toMatchObject([{ id: ruleId, matching: 1, applied: 1 }])
    const history = (await c.get(`/api/v1/sessions/${encodeURIComponent(OLD)}/automation`)).json()
    expect(history).toMatchObject([{ ruleId, ruleName: 'Idle for a week', revision: 1 }])
  })

  it('keeps your later edits: a rule applies once per revision', async () => {
    const current = (await c.get(`/api/v1/sessions/${encodeURIComponent(OLD)}/annotation`)).json().annotation
    expect((await c.send('PUT', `/api/v1/sessions/${encodeURIComponent(OLD)}/annotation`, { ...current, review: 'needs_review' })).status).toBe(200)
    await t.running.monitor.refreshAll()
    expect(await annotationOf(OLD)).toMatchObject({ review: 'needs_review', checklistOpen: 1 })
  })

  it('applies afresh after its conditions or actions change, but not after a rename', async () => {
    const renamed = await c.send('PUT', `/api/v1/automation/rules/${ruleId}`, { ...stale, name: 'Idle for seven days' })
    expect(renamed.json().revision).toBe(1)
    expect(await annotationOf(OLD)).toMatchObject({ review: 'needs_review' })
    const edited = await c.send('PUT', `/api/v1/automation/rules/${ruleId}`, { ...stale, actions: [{ kind: 'set_review', review: 'complete' }, { kind: 'add_checklist_item', text: 'Decide whether to delete the branch' }] })
    expect(edited.json().revision).toBe(2)
    // The same item is not added twice.
    expect(await annotationOf(OLD)).toMatchObject({ review: 'complete', checklistOpen: 1 })
  })

  it('a switched-off rule does nothing until it is switched on', async () => {
    const tagFixes: AutomationRuleInput = { name: 'Tag fixes', enabled: false, match: 'all', conditions: [{ kind: 'text', field: 'title', op: 'contains', value: 'fix' }], actions: [{ kind: 'add_tag', tag: 'fix' }] }
    const created = (await c.send('POST', '/api/v1/automation/rules', tagFixes)).json()
    expect(await annotationOf(RECENT)).toBeUndefined()
    expect((await rules()).find((r) => r.id === created.id)).toMatchObject({ matching: 1, applied: 0 })
    await c.send('PUT', `/api/v1/automation/rules/${created.id}`, { ...tagFixes, enabled: true })
    expect(await annotationOf(RECENT)).toMatchObject({ tags: ['fix'], review: 'unreviewed' })
  })

  it('deleting a rule keeps the changes it made', async () => {
    expect((await c.send('DELETE', `/api/v1/automation/rules/${ruleId}`)).status).toBe(200)
    expect((await rules()).some((r) => r.id === ruleId)).toBe(false)
    expect(await annotationOf(OLD)).toMatchObject({ review: 'complete' })
    expect((await c.get(`/api/v1/sessions/${encodeURIComponent(OLD)}/automation`)).json()).toEqual([])
  })

  it('validates rules and rule ids', async () => {
    expect((await c.send('POST', '/api/v1/automation/rules', { ...stale, conditions: [] })).status).toBe(400)
    expect((await c.send('POST', '/api/v1/automation/rules', { ...stale, actions: [{ kind: 'run_shell', command: 'x' }] })).status).toBe(400)
    expect((await c.send('PUT', '/api/v1/automation/rules/nope', stale)).status).toBe(404)
    expect((await c.send('DELETE', '/api/v1/automation/rules/..%2fx')).status).toBe(400)
  })
})
