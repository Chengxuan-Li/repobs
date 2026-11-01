import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../../apps/server/src/sessions/adapters/claude.ts'
import { claude, writeClaudeSession, writeClaudeSubagent } from '../../fixtures/session-fixtures.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

const cwd = 'C:\\work\\synthetic-tasks'
const now = Date.now()
const at = (n: number) => now - 60_000 + n
const create = (n: number, id: string, subject: string) => [
  claude.planCall('s', cwd, at(n), 'TaskCreate', { subject, description: 'private detail', activeForm: 'Working' }, `create-${id}`),
  claude.planResult('s', cwd, at(n + 1), `create-${id}`, { task: { id, subject } }),
] as const
const update = (n: number, taskId: string, status: string, success = true) => [
  claude.planCall('s', cwd, at(n), 'TaskUpdate', { taskId, status }, `update-${n}`),
  claude.planResult('s', cwd, at(n + 1), `update-${n}`, { success, taskId, updatedFields: ['status'], statusChange: { from: 'pending', to: status } }),
] as const

let root: string
let home: string
let adapter: ClaudeAdapter
beforeEach(() => {
  root = makeTempDir('claude-tasks')
  home = path.join(root, '.claude')
  adapter = new ClaudeAdapter({ pidAlive: () => false })
  adapter.configure({ enabled: true, home, plans: true, excerpts: false, staleAfterMs: 1_800_000 })
})
afterEach(() => removeDir(root))
const read = async () => (await adapter.discover(now)).find((s) => s.id === 'claude:s')

describe('Claude task checklists', () => {
  it('uses returned task ids, preserves creation order and replays updates across polls', async () => {
    writeClaudeSession(home, cwd, 's', [...create(0, '7', 'Inspect'), ...create(10, '12', 'Patch'), ...update(20, '7', 'completed')])
    const first = await read()
    expect(first?.plan).toMatchObject({ source: 'claude_tasks', items: [{ text: 'Inspect', status: 'completed' }, { text: 'Patch', status: 'pending' }] })
    expect(JSON.stringify(first?.plan)).not.toContain('private detail')
    writeClaudeSession(home, cwd, 's', [...update(30, '12', 'in_progress')])
    expect((await read())?.plan?.items).toMatchObject([{ text: 'Inspect', status: 'completed' }, { text: 'Patch', status: 'in_progress' }])
  })

  it('ignores failed, unconfirmed and unrelated calls and orphan updates', async () => {
    writeClaudeSession(home, cwd, 's', [
      ...create(0, '1', 'Real'),
      ...update(10, '1', 'completed', false),
      ...update(20, '99', 'completed'),
      claude.planCall('s', cwd, at(30), 'TaskCreate', { subject: 'Unconfirmed' }, 'unconfirmed'),
      claude.planCall('s', cwd, at(31), 'TaskCreate', { subject: 'Failed' }, 'failed'),
      claude.planResult('s', cwd, at(32), 'failed', { task: { id: '2', subject: 'Failed' } }, true),
      claude.planResult('s', cwd, at(33), 'unrelated', { task: { id: '3', subject: 'Unrelated' } }),
    ])
    expect((await read())?.plan?.items).toMatchObject([{ text: 'Real', status: 'pending' }])
    expect((await read())?.plan?.items).toHaveLength(1)
  })

  it('renames and deletes known tasks, ignores dependency-only edits and unknown statuses', async () => {
    writeClaudeSession(home, cwd, 's', [
      ...create(0, '1', 'Old name'), ...create(10, '2', 'Remove'),
      ...update(20, '1', 'in_progress'),
      claude.planCall('s', cwd, at(30), 'TaskUpdate', { taskId: '1', subject: 'New name', addBlockedBy: ['2'] }, 'rename'),
      claude.planResult('s', cwd, at(31), 'rename', { success: true, taskId: '1', updatedFields: ['subject', 'blockedBy'] }),
      ...update(40, '1', 'future_status'), ...update(50, '2', 'deleted'),
    ])
    expect((await read())?.plan?.items).toEqual([{ key: expect.any(String), text: 'New name', status: 'in_progress' }])
  })

  it('does not duplicate replayed creation results or guess ids from request order', async () => {
    const records = create(0, '42', 'One task')
    writeClaudeSession(home, cwd, 's', [...records, records[1], ...update(10, '1', 'completed')])
    expect((await read())?.plan?.items).toEqual([{ key: expect.any(String), text: 'One task', status: 'pending' }])
  })

  it('rejects oversized correlation/task ids and malformed success flags', async () => {
    const prefix = 'x'.repeat(128)
    writeClaudeSession(home, cwd, 's', [
      ...create(0, '1', 'Real'),
      claude.planCall('s', cwd, at(10), 'TaskCreate', { subject: 'Unrelated' }, prefix + 'A'),
      claude.planResult('s', cwd, at(11), prefix + 'B', { task: { id: '2', subject: 'Unrelated' } }),
      claude.planCall('s', cwd, at(20), 'TaskCreate', { subject: 'Malformed success' }, 'flag'),
      claude.planResult('s', cwd, at(21), 'flag', { success: 'false', task: { id: '3', subject: 'Malformed success' } }),
      ...create(30, prefix + 'C', 'Oversized task id'),
    ])
    expect((await read())?.plan?.items).toEqual([{ key: expect.any(String), text: 'Real', status: 'pending' }])
  })

  it('uses the status confirmed by the result and ignores fields the tool did not change', async () => {
    writeClaudeSession(home, cwd, 's', [
      ...create(0, '1', 'Keep name'),
      claude.planCall('s', cwd, at(10), 'TaskUpdate', { taskId: '1', status: 'completed', subject: 'Ignored name' }, 'update'),
      claude.planResult('s', cwd, at(11), 'update', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' } }),
    ])
    expect((await read())?.plan?.items).toMatchObject([{ text: 'Keep name', status: 'in_progress' }])
  })

  it('replaces a task when the provider reuses its id for a new successful creation', async () => {
    writeClaudeSession(home, cwd, 's', [...create(0, '1', 'Old task'), ...update(10, '1', 'completed'), ...create(20, '1', 'New task')])
    expect((await read())?.plan?.items).toEqual([{ key: expect.any(String), text: 'New task', status: 'pending' }])
  })

  it.each([false, true])('ignores pending task requests superseded by a full plan (same record: %s)', async (sameRecord) => {
    const [request, result] = create(0, '1', 'Superseded request')
    const full = claude.planCall('s', cwd, at(2), 'TodoWrite', { todos: [{ content: 'Current plan', status: 'pending' }] })
    const records = sameRecord
      ? [{ ...request, message: { ...request.message, content: [...request.message.content, ...full.message.content] } }, result]
      : [request, full, result]
    writeClaudeSession(home, cwd, 's', records)
    expect((await read())?.plan).toMatchObject({ source: 'claude_todo', items: [{ text: 'Current plan', status: 'pending' }] })
  })

  it('replays skipped task creation even when a prior poll already had an older full plan', async () => {
    writeClaudeSession(home, cwd, 's', [claude.planCall('s', cwd, at(0), 'TodoWrite', { todos: [{ content: 'Superseded', status: 'pending' }] })])
    expect((await read())?.plan?.source).toBe('claude_todo')
    writeClaudeSession(home, cwd, 's', [...create(10, '4', 'New tasks'), ...Array.from({ length: 14000 }, (_, i) => claude.toolResult('s', cwd, at(100 + i))), ...update(15000, '4', 'completed')])
    expect((await read())?.plan).toMatchObject({ source: 'claude_tasks', items: [{ text: 'New tasks', status: 'completed' }] })
  })

  it('recovers every creation before a skipped middle, including when a creation is in the tail', async () => {
    const filler = Array.from({ length: 4200 }, (_, i) => claude.toolResult('s', cwd, at(100 + i)))
    const file = writeClaudeSession(home, cwd, 's', [...create(0, '7', 'First'), ...create(10, '8', 'Second'), ...filler, ...create(5000, '9', 'Third'), ...update(5010, '7', 'completed')])
    expect(fs.statSync(file).size).toBeGreaterThan(768 * 1024)
    expect((await read())?.plan?.items).toMatchObject([{ text: 'First', status: 'completed' }, { text: 'Second', status: 'pending' }, { text: 'Third', status: 'pending' }])
    // A large append also skips records: replay the intervening updates in order.
    writeClaudeSession(home, cwd, 's', [...update(5020, '8', 'in_progress'), ...Array.from({ length: 14000 }, (_, i) => claude.toolResult('s', cwd, at(6000 + i))), ...update(21000, '9', 'completed')])
    expect((await read())?.plan?.items).toMatchObject([{ text: 'First', status: 'completed' }, { text: 'Second', status: 'in_progress' }, { text: 'Third', status: 'completed' }])
  })

  it('recovers a subagent task list separately from its parent and clears it on truncation', async () => {
    writeClaudeSession(home, cwd, 's', [...create(0, '1', 'Parent task')])
    const records = [...create(0, '1', 'Child task'), ...Array.from({ length: 1600 }, (_, i) => claude.toolResult('s', cwd, at(100 + i))), ...update(2000, '1', 'completed')]
    const file = writeClaudeSubagent(home, cwd, 's', 'child', records.map((r) => ({ ...r, isSidechain: true })))
    const sessions = await adapter.discover(now)
    expect(sessions.find((s) => s.id === 'claude:s')?.plan?.items).toMatchObject([{ text: 'Parent task', status: 'pending' }])
    expect(sessions.find((s) => s.parentSessionId === 'claude:s')?.plan?.items).toMatchObject([{ text: 'Child task', status: 'completed' }])
    fs.writeFileSync(file, JSON.stringify({ ...claude.endTurn('s', cwd, at(3000)), isSidechain: true }) + '\n')
    expect((await adapter.discover(now)).find((s) => s.parentSessionId === 'claude:s')?.plan).toBeUndefined()
  })

  it('drops task text when privacy reading is disabled and rediscovers it when reenabled', async () => {
    writeClaudeSession(home, cwd, 's', [...create(0, '1', 'Private plan')])
    expect((await read())?.plan?.items).toHaveLength(1)
    adapter.configure({ enabled: true, home, plans: false, excerpts: false, staleAfterMs: 1_800_000 })
    expect((await read())?.plan).toBeUndefined()
    adapter.configure({ enabled: true, home, plans: true, excerpts: false, staleAfterMs: 1_800_000 })
    expect((await read())?.plan?.items).toMatchObject([{ text: 'Private plan' }])
  })
})
