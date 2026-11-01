import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../../apps/server/src/sessions/adapters/claude.ts'
import { CodexAdapter } from '../../apps/server/src/sessions/adapters/codex.ts'
import { scanBackward } from '../../apps/server/src/sessions/jsonl.ts'
import { claudeRecordPlanEvents, codexRecordPlanEvent, PLAN_MARKERS, planItemKey, PlanTracker } from '../../apps/server/src/sessions/plan.ts'
import { claude, codex, codexRolloutPath, writeClaudeSession, writeCodexRollout } from '../../fixtures/session-fixtures.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

// Agent plans (ADR 0009): replaying planning tool calls from synthetic transcripts.

const cwd = 'C:\\work\\repo a'
const now = Date.now()
const ago = (m: number) => now - m * 60_000
const taskList = (at: number, input: Record<string, unknown>) => claude.planCall('s', cwd, at, 'mcp__ccd_turn__update_plan', input)
const items = (...steps: Array<[string, string]>) => ({ items: steps.map(([content, status]) => ({ content, status })), scope: 'first_task' })
const statuses = (t: PlanTracker) => t.plan()?.items.map((i) => `${i.text}:${i.status}`)
const replay = (records: unknown[]) => {
  const t = new PlanTracker()
  for (const r of records) for (const ev of claudeRecordPlanEvents(r)) t.feed(ev)
  return t
}

describe('plan replay', () => {
  it('replays the Claude app task list: full lists, advance, done/start and the closing wrap-up', () => {
    const t = replay([
      taskList(ago(9), items(['Read', 'in_progress'], ['Change', 'pending'], ['Test', 'pending'], ['Docs', 'pending'])),
      taskList(ago(8), { advance: true }),
      taskList(ago(7), { done: [2], start: 4 }),
    ])
    expect(statuses(t)).toEqual(['Read:completed', 'Change:completed', 'Test:pending', 'Docs:in_progress'])
    const wrapped = replay([
      taskList(ago(9), items(['Read', 'completed'], ['Change', 'in_progress'], ['Test', 'pending'])),
      claude.planCall('s', cwd, ago(1), 'mcp__ccd_turn__wrap_up', { recap: 'x' }),
    ])
    // The wrap-up completes the step in progress; open steps stay open (finishing is not a claim about them).
    expect(statuses(wrapped)).toEqual(['Read:completed', 'Change:completed', 'Test:pending'])
    expect(wrapped.plan()).toMatchObject({ source: 'claude_task_list', updatedAt: new Date(ago(1)).toISOString() })
  })

  it('a new full list replaces the old one', () => {
    const t = replay([taskList(ago(9), items(['A', 'completed'])), taskList(ago(8), items(['B', 'in_progress'], ['C', 'pending']))])
    expect(statuses(t)).toEqual(['B:in_progress', 'C:pending'])
  })

  it('reads Claude Code TodoWrite lists and Codex update_plan calls', () => {
    const todo = replay([
      claude.planCall('s', cwd, ago(2), 'TodoWrite', {
        todos: [
          { content: 'Write the parser', status: 'completed', activeForm: 'Writing the parser' },
          { content: 'Wire it up', status: 'in_progress', activeForm: 'Wiring it up' },
        ],
      }),
    ])
    expect(todo.plan()).toMatchObject({ source: 'claude_todo', items: [{ text: 'Write the parser', status: 'completed' }, { text: 'Wire it up', status: 'in_progress' }] })
    const ev = codexRecordPlanEvent(codex.updatePlan(ago(1), [{ step: 'Inspect', status: 'completed' }, { step: 'Patch', status: 'pending' }]))
    expect(ev).toMatchObject({ source: 'codex_update_plan', op: { kind: 'replace', items: [{ text: 'Inspect' }, { text: 'Patch', status: 'pending' }] } })
  })

  it('never guesses: steps without a list are no plan, unknown statuses are pending, other tools are ignored', () => {
    expect(replay([taskList(ago(2), { advance: true }), claude.planCall('s', cwd, ago(1), 'mcp__ccd_turn__wrap_up', {})]).plan()).toBeUndefined()
    expect(statuses(replay([taskList(ago(1), items(['A', 'blocked']))]))).toEqual(['A:pending'])
    expect(claudeRecordPlanEvents(claude.toolUse('s', cwd, ago(1)))).toEqual([])
    expect(codexRecordPlanEvent(codex.item(ago(1)))).toBeUndefined()
  })

  it('keys items by text and occurrence, without storing the text', () => {
    const plan = replay([taskList(ago(1), items(['Same', 'pending'], ['Same', 'pending'], ['Other', 'pending']))]).plan()!
    expect(new Set(plan.items.map((i) => i.key)).size).toBe(3)
    expect(plan.items[0]!.key).toBe(planItemKey('Same', 0))
    expect(plan.items[0]!.key).toMatch(/^[0-9a-f]{16}$/)
  })
})

let root: string
beforeEach(() => {
  root = makeTempDir('plans')
})
afterEach(() => removeDir(root))

describe('plans in the adapters', () => {
  it('finds the latest full list before a skipped middle of a long transcript', async () => {
    const home = path.join(root, '.claude')
    const filler = Array.from({ length: 3200 }, (_, i) => claude.toolResult('s', cwd, ago(60) + i))
    const file = writeClaudeSession(home, cwd, 's', [
      claude.prompt('s', cwd, ago(70)),
      taskList(ago(65), items(['Old', 'pending'])),
      taskList(ago(64), items(['Plan', 'in_progress'], ['Build', 'pending'], ['Ship', 'pending'])),
      ...filler,
      taskList(ago(2), { advance: true }),
      claude.endTurn('s', cwd, ago(1)),
    ])
    expect(fs.statSync(file).size).toBeGreaterThan(512 * 1024 + 256 * 1024) // the reader skips the middle
    const adapter = new ClaudeAdapter({ pidAlive: () => false })
    adapter.configure({ enabled: true, home, staleAfterMs: 30 * 60_000, plans: true })
    const [s] = await adapter.discover(now)
    expect(s!.plan?.items.map((i) => `${i.text}:${i.status}`)).toEqual(['Plan:completed', 'Build:in_progress', 'Ship:pending'])

    // Plans are read only when the privacy setting allows it.
    const off = new ClaudeAdapter({ pidAlive: () => false })
    off.configure({ enabled: true, home, staleAfterMs: 30 * 60_000, plans: false })
    expect((await off.discover(now))[0]!.plan).toBeUndefined()
  })

  it('scans backwards to the latest base record only', async () => {
    const file = path.join(root, 'scan.jsonl')
    const lines = [
      { k: 'plan', n: 1, base: true },
      { k: 'other' },
      { k: 'plan', n: 2, base: true },
      { k: 'plan', n: 3 },
      { k: 'other' },
    ]
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
    const found = await scanBackward(file, fs.statSync(file).size, ['"plan"'], (r) => (r as { base?: boolean }).base === true, 1 << 20, 16)
    expect(found).toEqual([lines[2], lines[3]])
  })

  it('reads the Codex plan of a thread', async () => {
    const home = path.join(root, '.codex')
    writeCodexRollout(home, codexRolloutPath(home, 't-1', ago(5)), [
      codex.meta('t-1', cwd, ago(5)),
      codex.updatePlan(ago(4), [{ step: 'Inspect', status: 'in_progress' }, { step: 'Patch', status: 'pending' }]),
      codex.updatePlan(ago(3), [{ step: 'Inspect', status: 'completed' }, { step: 'Patch', status: 'in_progress' }]),
    ])
    const adapter = new CodexAdapter()
    adapter.configure({ enabled: true, home, staleAfterMs: 30 * 60_000, plans: true })
    const [s] = await adapter.discover(now)
    expect(s!.plan).toMatchObject({ source: 'codex_update_plan', items: [{ text: 'Inspect', status: 'completed' }, { text: 'Patch', status: 'in_progress' }] })
  })

  it('prefilters lines with the plan tool names', () => {
    expect(PLAN_MARKERS).toContain('mcp__ccd_turn__update_plan')
  })
})
