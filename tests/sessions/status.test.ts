import { describe, expect, it } from 'vitest'
import { resolveState, type StateInput } from '../../apps/server/src/sessions/status.ts'

const now = Date.parse('2026-10-30T12:00:00Z')
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString()
const base = (over: Partial<StateInput>): StateInput => ({
  source: 'test',
  lifecycle: { phase: 'none' },
  subagentsActive: 0,
  sourceAvailable: true,
  unrecognizedRecords: 0,
  now,
  staleAfterMs: 30 * 60_000,
  ...over,
})

describe('resolveState', () => {
  it('treats missing data as unknown, never idle', () => {
    expect(resolveState(base({}))).toMatchObject({ kind: 'unknown', confidence: 'unknown', detail: 'no_lifecycle_records' })
    expect(resolveState(base({ unrecognizedRecords: 3 }))).toMatchObject({ kind: 'unknown', detail: 'unrecognized_records' })
  })

  it('reports provider registry evidence as direct', () => {
    const busy = resolveState(base({ registry: { status: 'busy', alive: true, statusAt: minutesAgo(1) } }))
    expect(busy).toMatchObject({ kind: 'running', confidence: 'direct', detail: 'provider_reports_busy' })
    expect(busy.possiblyAwaitingApproval).toBeUndefined()
    const idle = resolveState(base({ registry: { status: 'idle', alive: true } }))
    expect(idle).toMatchObject({ kind: 'idle_or_turn_finished', confidence: 'direct' })
    expect(resolveState(base({ registry: { status: 'paused-new', alive: true } }))).toMatchObject({
      kind: 'unknown',
      detail: 'provider_reports_other',
    })
  })

  it('flags busy with a pending tool call as possibly awaiting approval only where prompts are possible', () => {
    const s = resolveState(
      base({ registry: { status: 'busy', alive: true }, lifecycle: { phase: 'tool_pending', at: minutesAgo(1) } }),
    )
    expect(s.kind).toBe('running')
    expect(s.possiblyAwaitingApproval).toBe(true)
    const never = resolveState(
      base({ registry: { status: 'busy', alive: true }, lifecycle: { phase: 'tool_pending', at: minutesAgo(1), approvals: 'never' } }),
    )
    expect(never).toMatchObject({ kind: 'running', confidence: 'direct' })
    expect(never.possiblyAwaitingApproval).toBeUndefined()
  })

  it('an explicit request in the transcript wins over a live busy or idle process', () => {
    for (const status of ['busy', 'idle']) {
      expect(
        resolveState(base({ registry: { status, alive: true }, lifecycle: { phase: 'user_input_requested', at: minutesAgo(40) } })),
      ).toMatchObject({ kind: 'waiting_user', confidence: 'inferred', detail: 'user_input_requested' })
    }
  })

  it('a dead registry process means ended (inferred)', () => {
    expect(resolveState(base({ registry: { status: 'busy', alive: false } }))).toMatchObject({
      kind: 'ended',
      confidence: 'inferred',
    })
  })

  it('downgrades stale in-progress evidence to unknown', () => {
    expect(resolveState(base({ lifecycle: { phase: 'turn_in_progress', at: minutesAgo(5) } }))).toMatchObject({
      kind: 'running',
      confidence: 'inferred',
    })
    expect(resolveState(base({ lifecycle: { phase: 'turn_in_progress', at: minutesAgo(45) } }))).toMatchObject({
      kind: 'unknown',
      detail: 'stale_evidence',
    })
  })

  it('never turns a pending tool call or inactivity into waiting_approval', () => {
    const fresh = resolveState(base({ lifecycle: { phase: 'tool_pending', at: minutesAgo(2) } }))
    expect(fresh).toMatchObject({ kind: 'running', confidence: 'inferred', detail: 'tool_pending', possiblyAwaitingApproval: true })
    const bypass = resolveState(base({ lifecycle: { phase: 'tool_pending', at: minutesAgo(2), approvals: 'never' } }))
    expect(bypass).toMatchObject({ kind: 'running', detail: 'tool_pending' })
    expect(bypass.possiblyAwaitingApproval).toBeUndefined()
    const stale = resolveState(base({ lifecycle: { phase: 'tool_pending', at: minutesAgo(90) } }))
    expect(stale.kind).toBe('unknown')
    expect(stale.possiblyAwaitingApproval).toBeUndefined()
  })

  it('reports explicit approval/input requests as inferred waiting states while fresh', () => {
    expect(resolveState(base({ lifecycle: { phase: 'approval_requested', at: minutesAgo(1) } }))).toMatchObject({
      kind: 'waiting_approval',
      confidence: 'inferred',
    })
    expect(resolveState(base({ lifecycle: { phase: 'user_input_requested', at: minutesAgo(1) } })).kind).toBe('waiting_user')
  })

  it('finished turns with active subagents are running_subagents', () => {
    expect(
      resolveState(base({ lifecycle: { phase: 'turn_completed', at: minutesAgo(1) }, subagentsActive: 1 })).kind,
    ).toBe('running_subagents')
    expect(resolveState(base({ lifecycle: { phase: 'turn_completed', at: minutesAgo(600) } }))).toMatchObject({
      kind: 'idle_or_turn_finished',
      detail: 'turn_completed',
    })
  })

  it('source missing is unknown', () => {
    expect(resolveState(base({ sourceAvailable: false })).detail).toBe('source_missing')
  })
})
