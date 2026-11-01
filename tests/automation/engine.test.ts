import { describe, expect, it } from 'vitest'
import { type AgentSession, type AnnotationInput, workflowStatus } from '@repobs/contracts'
import { type AgentFacts, annotationChanged, applyActions, conditionHolds, ruleMatches, toInput } from '../../apps/server/src/automation/engine.ts'

const now = Date.parse('2026-10-31T12:00:00Z')
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString()

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: 'claude:s1',
  provider: 'claude',
  providerSessionId: 's1',
  title: 'Fix the parser',
  titleSource: 'provider',
  association: 'matched',
  lastActivityAt: daysAgo(10),
  state: { kind: 'idle_or_turn_finished', confidence: 'inferred', source: 'test' },
  historical: false,
  sourceAvailable: true,
  subagents: { total: 0, active: 0 },
  ...over,
})
const annotation = (over: Partial<AnnotationInput> = {}): AnnotationInput => ({ review: 'unreviewed', tags: [], note: '', checklist: [], ...over })
const facts = (over: Partial<AgentFacts> = {}): AgentFacts => ({ session: session(), repositoryName: 'repo-a', branch: 'feature/login', ...over })

describe('automation conditions', () => {
  it('compares the last activity with the age, and never acts on an unknown age', () => {
    expect(conditionHolds({ kind: 'last_activity', op: 'older_than', amount: 7, unit: 'days' }, facts(), now)).toBe(true)
    expect(conditionHolds({ kind: 'last_activity', op: 'within', amount: 7, unit: 'days' }, facts(), now)).toBe(false)
    expect(conditionHolds({ kind: 'last_activity', op: 'within', amount: 300, unit: 'hours' }, facts(), now)).toBe(true)
    const unknown = facts({ session: session({ lastActivityAt: undefined }) })
    expect(conditionHolds({ kind: 'last_activity', op: 'older_than', amount: 1, unit: 'hours' }, unknown, now)).toBe(false)
    expect(conditionHolds({ kind: 'last_activity', op: 'within', amount: 1, unit: 'hours' }, unknown, now)).toBe(false)
  })

  it('matches keywords in agent and repository text, case-insensitively', () => {
    expect(conditionHolds({ kind: 'text', field: 'title', op: 'contains', value: 'PARSER' }, facts(), now)).toBe(true)
    expect(conditionHolds({ kind: 'text', field: 'repository', op: 'equals', value: 'Repo-A' }, facts(), now)).toBe(true)
    expect(conditionHolds({ kind: 'text', field: 'branch', op: 'not_contains', value: 'login' }, facts(), now)).toBe(false)
    // A missing field contains nothing.
    expect(conditionHolds({ kind: 'text', field: 'agent_type', op: 'contains', value: 'explore' }, facts(), now)).toBe(false)
    expect(conditionHolds({ kind: 'text', field: 'agent_type', op: 'not_contains', value: 'explore' }, facts(), now)).toBe(true)
    expect(conditionHolds({ kind: 'text', field: 'tags', op: 'equals', value: 'ui' }, facts({ annotation: annotation({ tags: ['perf', 'UI'] }) }), now)).toBe(true)
  })

  it('reads your review state, tags and checklist (no annotation is unreviewed, untagged and empty)', () => {
    expect(conditionHolds({ kind: 'review', states: ['unreviewed'] }, facts(), now)).toBe(true)
    expect(conditionHolds({ kind: 'review', states: ['flagged'] }, facts({ annotation: annotation({ review: 'flagged' }) }), now)).toBe(true)
    expect(conditionHolds({ kind: 'tag', op: 'lacks', tag: 'keep' }, facts(), now)).toBe(true)
    expect(conditionHolds({ kind: 'checklist', op: 'empty' }, facts(), now)).toBe(true)
    expect(conditionHolds({ kind: 'checklist', op: 'all_done' }, facts(), now)).toBe(false)
    const done = annotation({ checklist: [{ id: 'a', text: 'x', done: true, order: 0 }] })
    expect(conditionHolds({ kind: 'checklist', op: 'all_done' }, facts({ annotation: done }), now)).toBe(true)
    expect(conditionHolds({ kind: 'checklist', op: 'has_open' }, facts({ annotation: done }), now)).toBe(false)
  })

  it('reads observed activity, harness and spawning', () => {
    expect(conditionHolds({ kind: 'activity', state: 'finished' }, facts(), now)).toBe(true)
    const running = facts({ session: session({ state: { kind: 'running', confidence: 'direct', source: 'test' } }) })
    expect(conditionHolds({ kind: 'activity', state: 'live' }, running, now)).toBe(true)
    // Unknown state is neither live nor finished.
    const unknown = facts({ session: session({ state: { kind: 'unknown', confidence: 'unknown', source: 'test' } }) })
    expect(conditionHolds({ kind: 'activity', state: 'live' }, unknown, now) || conditionHolds({ kind: 'activity', state: 'finished' }, unknown, now)).toBe(false)
    expect(conditionHolds({ kind: 'provider', provider: 'codex' }, facts(), now)).toBe(false)
    expect(conditionHolds({ kind: 'spawned', value: true }, facts({ session: session({ parentSessionId: 'claude:p' }) }), now)).toBe(true)
  })

  it('combines conditions with all or any', () => {
    const conditions = [
      { kind: 'provider', provider: 'codex' },
      { kind: 'text', field: 'title', op: 'contains', value: 'fix' },
    ] as const
    expect(ruleMatches({ match: 'all', conditions: [...conditions] }, facts(), now)).toBe(false)
    expect(ruleMatches({ match: 'any', conditions: [...conditions] }, facts(), now)).toBe(true)
  })
})

describe('automation actions', () => {
  it('sets the review state, tags, alias and note, in order', () => {
    const next = applyActions(annotation({ tags: ['old'], note: 'Mine.' }), [
      { kind: 'set_review', review: 'outdated' },
      { kind: 'add_tag', tag: 'stale' },
      { kind: 'add_tag', tag: 'STALE' },
      { kind: 'remove_tag', tag: 'old' },
      { kind: 'set_alias', alias: 'Parked' },
      { kind: 'append_note', text: 'Marked by a rule.' },
    ])
    expect(next).toMatchObject({ review: 'outdated', tags: ['stale'], displayAlias: 'Parked', note: 'Mine.\n\nMarked by a rule.' })
  })

  it('adds, ticks and removes checklist items without duplicating them', () => {
    const start = annotation({
      checklist: [
        { id: 'a', text: 'Run the tests', done: false, order: 0 },
        { id: 'b', text: 'Read the diff', done: false, order: 1 },
      ],
    })
    const added = applyActions(start, [
      { kind: 'add_checklist_item', text: 'Run the tests' },
      { kind: 'add_checklist_item', text: 'Update the changelog' },
    ])
    expect(added.checklist.map((i) => i.text)).toEqual(['Run the tests', 'Read the diff', 'Update the changelog'])
    const ticked = applyActions(added, [{ kind: 'complete_checklist', match: 'TEST' }])
    expect(ticked.checklist.map((i) => i.done)).toEqual([true, false, false])
    const cleaned = applyActions(applyActions(ticked, [{ kind: 'complete_checklist' }]), [{ kind: 'remove_done_items' }])
    expect(cleaned.checklist).toEqual([])
  })

  it('never changes its input and reports whether anything visible changed', () => {
    const start = annotation({ tags: ['a'] })
    const same = applyActions(start, [{ kind: 'add_tag', tag: 'a' }])
    expect(start.tags).toEqual(['a'])
    expect(annotationChanged(start, same)).toBe(false)
    expect(annotationChanged(toInput(undefined), applyActions(toInput(undefined), [{ kind: 'set_review', review: 'complete' }]))).toBe(true)
  })
})

describe('workflow status', () => {
  it('shows every review state as itself once the agent is not live', () => {
    const idle = session()
    const status = (review: AnnotationInput['review']) =>
      workflowStatus(idle, { sessionId: idle.id, review, tags: [], hasNote: false, note: '', checklistOpen: 0, checklistDone: 0, checklist: [], updatedAt: 'x' })
    expect(status('reviewed')).toBe('reviewed')
    expect(status('flagged')).toBe('flagged')
    expect(status('complete')).toBe('complete')
    expect(status('outdated')).toBe('outdated')
    expect(status('unreviewed')).toBe('unreviewed')
    // Live activity still wins over the review state.
    expect(workflowStatus(session({ state: { kind: 'running', confidence: 'direct', source: 'test' } }), { sessionId: idle.id, review: 'flagged', tags: [], hasNote: false, note: '', checklistOpen: 0, checklistDone: 0, checklist: [], updatedAt: 'x' })).toBe('working')
  })
})
