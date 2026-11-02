import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeAdapter } from '../../apps/server/src/sessions/adapters/claude.ts'
import { CodexAdapter } from '../../apps/server/src/sessions/adapters/codex.ts'
import {
  claude,
  claudeTranscriptPath,
  codex,
  codexRolloutPath,
  writeClaudeRegistry,
  writeClaudeSession,
  writeClaudeSubagent,
  writeCodexIndex,
  writeCodexRollout,
} from '../../fixtures/session-fixtures.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

let root: string
let claudeHome: string
let codexHome: string
const now = Date.now()
const ago = (m: number) => now - m * 60_000
const cwdA = 'C:\\work\\repo a'
const cwdB = 'C:\\work\\repo a-worktrees\\feature'

beforeEach(() => {
  root = makeTempDir('sessions')
  claudeHome = path.join(root, '.claude')
  codexHome = path.join(root, '.codex')
})
afterEach(() => removeDir(root))

const config = (home: string) => ({ enabled: true, home, staleAfterMs: 30 * 60_000 })

describe('Claude adapter', () => {
  it('discovers pre-existing sessions, several per cwd, with provider titles and fallbacks', async () => {
    writeClaudeSession(claudeHome, cwdA, 's-one', [claude.title('s-one', 'Fix parser'), claude.prompt('s-one', cwdA, ago(5)), claude.endTurn('s-one', cwdA, ago(4))])
    writeClaudeSession(claudeHome, cwdA, 's-two', [claude.prompt('s-two', cwdA, ago(3))])
    writeClaudeSession(claudeHome, cwdB, 's-three', [claude.prompt('s-three', cwdB, ago(2)), claude.toolUse('s-three', cwdB, ago(1))])
    const adapter = new ClaudeAdapter()
    adapter.configure(config(claudeHome))
    const sessions = await adapter.discover(now)
    const byId = Object.fromEntries(sessions.map((s) => [s.providerSessionId, s]))
    expect(Object.keys(byId).sort()).toEqual(['s-one', 's-three', 's-two'])
    expect(byId['s-one']).toMatchObject({ title: 'Fix parser', cwd: cwdA, state: { kind: 'idle_or_turn_finished', confidence: 'inferred' } })
    expect(byId['s-two']!.title).toBeUndefined()
    expect(byId['s-two']!.state).toMatchObject({ kind: 'running', confidence: 'inferred', detail: 'turn_in_progress' })
    expect(byId['s-three']!.state).toMatchObject({ kind: 'unknown', possiblyAwaitingApproval: true })
    expect(byId['s-three']!.firstSeenAt).toBe(new Date(ago(2)).toISOString())
  })

  it('uses the live registry: busy is direct, dead pid is ended, *.key files are never opened', async () => {
    writeClaudeSession(claudeHome, cwdA, 'live', [claude.prompt('live', cwdA, ago(60))])
    writeClaudeSession(claudeHome, cwdA, 'dead', [claude.endTurn('dead', cwdA, ago(60))])
    writeClaudeRegistry(claudeHome, { pid: 111, sessionId: 'live', cwd: cwdA, status: 'busy', name: 'Live work', at: ago(0) })
    writeClaudeRegistry(claudeHome, { pid: 222, sessionId: 'dead', cwd: cwdA, status: 'idle', at: ago(90) })
    // Point the registry at this host so liveness is evaluated.
    for (const f of ['111.json', '222.json']) {
      const p = path.join(claudeHome, 'sessions', f)
      const o = JSON.parse(fs.readFileSync(p, 'utf8'))
      o.pidDomain = undefined
      fs.writeFileSync(p, JSON.stringify(o))
    }
    const keyFile = path.join(claudeHome, 'sessions', '111.deadbeef.key')
    fs.chmodSync(keyFile, 0o000)
    const adapter = new ClaudeAdapter({ pidAlive: (pid) => pid === 111 })
    adapter.configure(config(claudeHome))
    const sessions = await adapter.discover(now)
    const live = sessions.find((s) => s.providerSessionId === 'live')!
    expect(live).toMatchObject({ title: 'Live work', live: true, state: { kind: 'running', confidence: 'direct' } })
    expect(sessions.find((s) => s.providerSessionId === 'dead')!.state).toMatchObject({ kind: 'ended', detail: 'process_not_running' })
    expect(adapter.status().liveRegistryEntries).toBe(2)
  })

  it('follows appended records incrementally, including a partial line', async () => {
    const file = writeClaudeSession(claudeHome, cwdA, 'grow', [claude.prompt('grow', cwdA, ago(3))])
    const adapter = new ClaudeAdapter()
    adapter.configure(config(claudeHome))
    expect((await adapter.discover(now))[0]!.state.kind).toBe('running')
    const line = JSON.stringify(claude.endTurn('grow', cwdA, ago(1))) + '\n'
    fs.appendFileSync(file, line.slice(0, 20))
    expect((await adapter.discover(now))[0]!.state.kind).toBe('running')
    fs.appendFileSync(file, line.slice(20))
    expect((await adapter.discover(now))[0]!.state).toMatchObject({ kind: 'idle_or_turn_finished', detail: 'turn_completed' })
  })

  it('records relocation, interrupts, unknown record types and subagent activity', async () => {
    writeClaudeSession(claudeHome, cwdA, 'moved', [
      claude.prompt('moved', cwdA, ago(10)),
      claude.futureRecord('moved'),
      claude.relocated('moved', cwdB),
      claude.interrupted('moved', cwdB, ago(9)),
    ])
    writeClaudeSession(claudeHome, cwdA, 'parent', [claude.endTurn('parent', cwdA, ago(2))])
    writeClaudeSubagent(claudeHome, cwdA, 'parent', 'a1', [claude.prompt('parent', cwdA, ago(1)), claude.toolUse('parent', cwdA, ago(1))], {
      agentType: 'Explore',
      description: 'Survey the parser module',
    })
    const adapter = new ClaudeAdapter()
    adapter.configure(config(claudeHome))
    const sessions = await adapter.discover(now)
    const moved = sessions.find((s) => s.providerSessionId === 'moved')!
    expect(moved.cwd).toBe(cwdB)
    expect(moved.state.detail).toBe('turn_aborted')
    const parent = sessions.find((s) => s.providerSessionId === 'parent')!
    expect(parent.subagents).toEqual({ total: 1, active: 1 })
    expect(parent.state.kind).toBe('running_subagents')
    // Subagents are child sessions linked to their parent (ADR 0003).
    expect(sessions).toHaveLength(3)
    const child = sessions.find((s) => s.parentSessionId === 'claude:parent')!
    expect(child).toMatchObject({
      id: 'claude:parent__agent-a1',
      title: 'Survey the parser module',
      agentType: 'Explore',
      cwd: cwdA,
      lastMessage: { kind: 'tool', text: 'Bash' },
    })
  })

  it('shows a failed API call as an error, not a finished turn, until the next prompt', async () => {
    // A run that could not sign in: the only reply is an API error record, hours old.
    writeClaudeSession(claudeHome, cwdA, 'no-login', [claude.prompt('no-login', cwdA, ago(181)), claude.apiError('no-login', cwdA, ago(180))])
    // A rate-limited turn the user retried.
    writeClaudeSession(claudeHome, cwdA, 'retried', [
      claude.prompt('retried', cwdA, ago(5)),
      claude.apiError('retried', cwdA, ago(4), 'rate_limit'),
      claude.prompt('retried', cwdA, ago(2)),
    ])
    writeClaudeSession(claudeHome, cwdA, 'parent', [claude.endTurn('parent', cwdA, ago(2))])
    writeClaudeSubagent(claudeHome, cwdA, 'parent', 'a1', [claude.prompt('parent', cwdA, ago(1)), claude.apiError('parent', cwdA, ago(1), 'server_error')])
    const adapter = new ClaudeAdapter()
    adapter.configure(config(claudeHome))
    const sessions = await adapter.discover(now)
    const byId = Object.fromEntries(sessions.map((s) => [s.providerSessionId, s]))
    expect(byId['no-login']!.lifecycle.phase).toBe('error_event')
    expect(byId['no-login']!.state).toEqual({
      kind: 'error',
      confidence: 'inferred',
      source: 'claude.transcript',
      observedAt: new Date(ago(180)).toISOString(),
      detail: 'provider_error_event',
    })
    expect(byId['retried']!.state).toMatchObject({ kind: 'running', detail: 'turn_in_progress' })
    // A failed subagent is an error child and does not keep its parent running.
    expect(byId['parent__agent-a1']!.state).toMatchObject({ kind: 'error', source: 'claude.subagent', detail: 'provider_error_event' })
    expect(byId['parent']!.subagents).toEqual({ total: 1, active: 0 })
    expect(byId['parent']!.state).toMatchObject({ kind: 'idle_or_turn_finished', detail: 'turn_completed' })
  })

  it('captures the latest assistant text, and nothing when excerpts are off', async () => {
    writeClaudeSession(claudeHome, cwdA, 'talk', [claude.prompt('talk', cwdA, ago(3)), claude.endTurn('talk', cwdA, ago(2))])
    const adapter = new ClaudeAdapter()
    adapter.configure(config(claudeHome))
    expect((await adapter.discover(now))[0]!.lastMessage).toMatchObject({ kind: 'assistant', text: 'synthetic answer' })
    adapter.configure({ ...config(claudeHome), excerpts: false })
    expect((await adapter.discover(now))[0]!.lastMessage).toBeUndefined()
  })

  it('handles a missing installation and garbage files without throwing', async () => {
    const adapter = new ClaudeAdapter()
    adapter.configure(config(path.join(root, 'nope')))
    expect(await adapter.discover(now)).toEqual([])
    expect(adapter.status().available).toBe(false)

    const file = claudeTranscriptPath(claudeHome, cwdA, 'junk')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'garbage\n{"truncated":\n')
    adapter.configure(config(claudeHome))
    const sessions = await adapter.discover(now)
    expect(sessions[0]).toMatchObject({ providerSessionId: 'junk', state: { kind: 'unknown' } })
    expect(adapter.status().problems.map((p) => p.code)).toContain('bad_jsonl_lines')
  })
})

describe('Codex adapter', () => {
  it('groups rollouts by thread, titles from the index, subagents attached to the parent', async () => {
    const t1 = 'thread-aaaa-1111'
    const t2 = 'thread-bbbb-2222'
    const child = 'thread-cccc-3333'
    writeCodexRollout(codexHome, codexRolloutPath(codexHome, t1, ago(120)), [
      codex.meta(t1, cwdA, ago(120)),
      codex.event('task_started', ago(119)),
      codex.event('task_complete', ago(118)),
    ])
    writeCodexRollout(codexHome, codexRolloutPath(codexHome, t1, ago(5), '-b'), [
      codex.meta(t1, cwdA, ago(5)),
      codex.turnContext(cwdA, ago(5)),
      codex.event('task_started', ago(4)),
      codex.item(ago(3)),
    ])
    writeCodexRollout(codexHome, codexRolloutPath(codexHome, t2, ago(30)), [
      codex.meta(t2, cwdA, ago(30)),
      codex.event('task_started', ago(29)),
      codex.event('task_complete', ago(28)),
    ])
    writeCodexRollout(codexHome, codexRolloutPath(codexHome, child, ago(2)), [
      codex.meta(child, cwdA, ago(2), t2),
      codex.event('task_started', ago(1)),
    ])
    writeCodexIndex(codexHome, [
      { id: t1, thread_name: 'Old name', updated_at: new Date(ago(100)).toISOString() },
      { id: t1, thread_name: 'Refactor tree', updated_at: new Date(ago(2)).toISOString() },
    ])
    const adapter = new CodexAdapter()
    adapter.configure(config(codexHome))
    const sessions = await adapter.discover(now)
    expect(sessions.map((s) => s.providerSessionId).sort()).toEqual([t1, t2, child])
    expect(sessions.find((s) => s.providerSessionId === child)!.parentSessionId).toBe(`codex:${t2}`)
    const s1 = sessions.find((s) => s.providerSessionId === t1)!
    expect(s1).toMatchObject({ title: 'Refactor tree', sourceFiles: 2, state: { kind: 'running', confidence: 'inferred' } })
    expect(s1.firstSeenAt).toBe(new Date(ago(120)).toISOString())
    const s2 = sessions.find((s) => s.providerSessionId === t2)!
    expect(s2.subagents).toEqual({ total: 1, active: 1 })
    expect(s2.state.kind).toBe('running_subagents')
    expect(s2.title).toBeUndefined()
  })

  it('maps aborted turns, explicit approval requests, and stale progress', async () => {
    const a = 'thread-abort'
    const b = 'thread-approval'
    const c = 'thread-stale'
    writeCodexRollout(codexHome, codexRolloutPath(codexHome, a, ago(10)), [codex.meta(a, cwdA, ago(10)), codex.event('task_started', ago(9)), codex.event('turn_aborted', ago(8))])
    writeCodexRollout(codexHome, codexRolloutPath(codexHome, b, ago(3)), [codex.meta(b, cwdA, ago(3)), codex.event('task_started', ago(3)), codex.event('exec_approval_request', ago(2))])
    writeCodexRollout(codexHome, codexRolloutPath(codexHome, c, ago(300)), [codex.meta(c, cwdA, ago(300)), codex.event('task_started', ago(299))])
    const adapter = new CodexAdapter()
    adapter.configure(config(codexHome))
    const byId = Object.fromEntries((await adapter.discover(now)).map((s) => [s.providerSessionId, s.state]))
    expect(byId[a]).toMatchObject({ kind: 'idle_or_turn_finished', detail: 'turn_aborted' })
    expect(byId[b]).toMatchObject({ kind: 'waiting_approval', confidence: 'inferred' })
    expect(byId[c]).toMatchObject({ kind: 'unknown', detail: 'stale_evidence' })
  })

  it('missing CODEX_HOME is reported unavailable, not an error', async () => {
    const adapter = new CodexAdapter()
    adapter.configure(config(path.join(root, 'nope')))
    expect(await adapter.discover(now)).toEqual([])
    expect(adapter.status()).toMatchObject({ available: false, problems: [] })
  })
})
