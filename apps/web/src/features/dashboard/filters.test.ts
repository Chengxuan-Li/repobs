import { describe, expect, it } from 'vitest'
import type { AnnotationSummary } from '@repobs/contracts'
import { session } from '../../testing/fixtures'
import { DEFAULT_FILTERS, filtersActive, knownTags, sessionMatches, suggestTags } from './filters'

const now = Date.parse('2026-10-30T12:00:00Z')
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString()
const ann = (sessionId: string, over: Partial<AnnotationSummary> = {}): AnnotationSummary => ({
  sessionId,
  review: 'unreviewed',
  tags: [],
  hasNote: false,
  note: '',
  checklistOpen: 0,
  checklistDone: 0,
  checklist: [],
  planOverrides: {},
  updatedAt: 'x',
  ...over,
})

describe('dashboard filters', () => {
  const running = session('claude:a', { lastActivityAt: daysAgo(0.5), state: { kind: 'running', confidence: 'direct', source: 'x' } })
  const waiting = session('codex:b', { lastActivityAt: daysAgo(2.5), state: { kind: 'waiting_approval', confidence: 'inferred', source: 'x' } })
  const old = session('claude:c', { lastActivityAt: daysAgo(30), lastMessage: { kind: 'assistant', text: 'Refactored the parser' } })

  it('filters by harness', () => {
    const f = { ...DEFAULT_FILTERS, harnesses: ['claude' as const] }
    expect([running, waiting, old].filter((s) => sessionMatches(s, undefined, f, now)).map((s) => s.id)).toEqual(['claude:a', 'claude:c'])
    expect(filtersActive(f)).toBe(true)
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false)
  })

  it('filters by time of the last message', () => {
    const f = { ...DEFAULT_FILTERS, lastMessageDays: 3 }
    expect([running, waiting, old].filter((s) => sessionMatches(s, undefined, f, now)).map((s) => s.id)).toEqual(['claude:a', 'codex:b'])
  })

  it('filters by workflow status, including human review state', () => {
    const f = { ...DEFAULT_FILTERS, statuses: ['needs_input' as const, 'needs_review' as const] }
    expect(sessionMatches(waiting, undefined, f, now)).toBe(true)
    expect(sessionMatches(running, undefined, f, now)).toBe(false)
    expect(sessionMatches(old, ann('claude:c', { review: 'needs_review' }), f, now)).toBe(true)
    expect(sessionMatches(old, undefined, { ...DEFAULT_FILTERS, statuses: ['unreviewed'] }, now)).toBe(true)
  })

  it('filters by tags (any of) and free text including the latest excerpt', () => {
    expect(sessionMatches(old, ann('claude:c', { tags: ['perf', 'ui'] }), { ...DEFAULT_FILTERS, tags: ['ui', 'x'] }, now)).toBe(true)
    expect(sessionMatches(old, ann('claude:c', { tags: ['perf'] }), { ...DEFAULT_FILTERS, tags: ['ui'] }, now)).toBe(false)
    expect(sessionMatches(old, undefined, { ...DEFAULT_FILTERS, query: 'parser' }, now)).toBe(true)
  })

  it('hides agents by hand and by review state, without touching their annotation', () => {
    const f = { ...DEFAULT_FILTERS, hiddenAgents: ['codex:b'], hiddenReviews: ['outdated' as const, 'unreviewed' as const] }
    expect(sessionMatches(waiting, ann('codex:b', { review: 'needs_review' }), f, now)).toBe(false)
    // An agent without an annotation counts as unreviewed.
    expect(sessionMatches(running, undefined, f, now)).toBe(false)
    expect(sessionMatches(old, ann('claude:c', { review: 'outdated' }), f, now)).toBe(false)
    expect(sessionMatches(old, ann('claude:c', { review: 'flagged' }), f, now)).toBe(true)
    expect(filtersActive({ ...DEFAULT_FILTERS, hiddenAgents: ['x'] })).toBe(true)
  })

  it('suggests existing tags by prefix, then substring, most used first', () => {
    const tags = knownTags([ann('a', { tags: ['ui', 'perf'] }), ann('b', { tags: ['perf', 'urgent'] })])
    expect(tags).toEqual(['perf', 'ui', 'urgent'])
    expect(suggestTags(tags, 'u')).toEqual(['ui', 'urgent'])
    expect(suggestTags(tags, 'r', ['perf'])).toEqual(['urgent'])
    expect(suggestTags(tags, '', ['ui'])).toEqual(['perf', 'urgent'])
  })
})
