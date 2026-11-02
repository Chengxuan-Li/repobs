import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodexAdapter } from '../../apps/server/src/sessions/adapters/codex.ts'
import { CodexStateIndex, isWalDatabase } from '../../apps/server/src/sessions/adapters/codex-state.ts'
import { readCompressedJsonl } from '../../apps/server/src/sessions/zstd-jsonl.ts'
import {
  codexStateDbPath,
  insertThreads,
  openCodexStateDbWriter,
  PROMPT_CANARY,
  writeCodexStateDb,
  writeCompressedRollout,
} from '../../fixtures/codex-history-fixtures.ts'
import { codex, codexRolloutPath, writeCodexIndex, writeCodexRollout } from '../../fixtures/session-fixtures.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

// ADR 0011: compressed rollouts and the Codex state database. Synthetic data only.

let root: string
let home: string
const now = Date.now()
const ago = (m: number) => now - m * 60_000
const cwdA = 'C:\\work\\repo a'
const config = { enabled: true, home: '', staleAfterMs: 30 * 60_000 }

beforeEach(() => {
  root = makeTempDir('codex-history')
  home = path.join(root, '.codex')
  fs.mkdirSync(home, { recursive: true })
})
afterEach(() => removeDir(root))

const adapterFor = (h = home) => {
  const adapter = new CodexAdapter()
  adapter.configure({ ...config, home: h })
  return adapter
}
const byId = (sessions: Awaited<ReturnType<CodexAdapter['discover']>>) => Object.fromEntries(sessions.map((s) => [s.providerSessionId, s]))
const problemCodes = (adapter: CodexAdapter) => adapter.status().problems.map((p) => p.code)
const listing = (dir: string) => fs.readdirSync(dir).sort()

/** Filler records that make a rollout larger than the bounded tail (512 KB). */
const filler = (at: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ timestamp: new Date(at + i).toISOString(), type: 'token_usage_record', payload: { pad: 'x'.repeat(1000) } }))

describe('compressed rollouts', () => {
  it('reads rollout-*.jsonl.zst like a plain rollout', async () => {
    const t = 'thread-zst-1'
    writeCompressedRollout(codexRolloutPath(home, t, ago(600)), [
      codex.meta(t, cwdA, ago(600)),
      codex.event('task_started', ago(599)),
      codex.event('task_complete', ago(598)),
    ])
    writeCodexIndex(home, [{ id: t, thread_name: 'Compressed work', updated_at: new Date(ago(598)).toISOString() }])
    const adapter = adapterFor()
    const s = byId(await adapter.discover(now))[t]!
    expect(s).toMatchObject({
      title: 'Compressed work',
      cwd: cwdA,
      sourceFiles: 1,
      state: { kind: 'idle_or_turn_finished', confidence: 'inferred', source: 'codex.rollout', detail: 'turn_completed' },
    })
    expect(s.firstSeenAt).toBe(new Date(ago(600)).toISOString())
    expect(adapter.status().filesTracked).toBe(1)
  })

  it('reads the plain file while Codex is compressing it', async () => {
    const t = 'thread-twin'
    const file = codexRolloutPath(home, t, ago(10))
    writeCodexRollout(home, file, [codex.meta(t, cwdA, ago(10)), codex.event('task_started', ago(9))])
    writeCompressedRollout(file, [codex.meta(t, cwdA, ago(10)), codex.event('task_started', ago(9)), codex.event('task_complete', ago(8))])
    const s = byId(await adapterFor().discover(now))[t]!
    expect(s.sourceFiles).toBe(1)
    expect(s.state).toMatchObject({ kind: 'running', detail: 'turn_in_progress' })
  })

  it('takes the head and the bounded tail of a long rollout, and a plan from before the tail', async () => {
    const t = 'thread-long'
    writeCompressedRollout(codexRolloutPath(home, t, ago(300)), [
      codex.meta(t, cwdA, ago(300)),
      codex.event('task_started', ago(299)),
      codex.updatePlan(ago(298), [
        { step: 'Synthetic step one', status: 'completed' },
        { step: 'Synthetic step two', status: 'in_progress' },
      ]),
      ...filler(ago(297), 1500),
      codex.event('turn_aborted', ago(200)),
    ])
    const s = byId(await adapterFor().discover(now))[t]!
    expect(s.firstSeenAt).toBe(new Date(ago(300)).toISOString())
    expect(s.state).toMatchObject({ kind: 'idle_or_turn_finished', detail: 'turn_aborted' })
    expect(s.plan?.items.map((i) => i.status)).toEqual(['completed', 'in_progress'])
  })

  it('reads compressed files within a per-scan budget and lists the rest from the state database meanwhile', async () => {
    const plain = 'thread-plain'
    const old = 'thread-old'
    writeCodexRollout(home, codexRolloutPath(home, plain, ago(5)), [codex.meta(plain, cwdA, ago(5)), codex.event('task_started', ago(4))])
    writeCompressedRollout(codexRolloutPath(home, old, ago(900)), [codex.meta(old, cwdA, ago(900)), codex.event('task_complete', ago(899))])
    writeCodexStateDb(home, [{ id: old, cwd: `\\\\?\\${cwdA}`, createdAt: ago(900), updatedAt: ago(899), name: 'Old thread' }])
    const adapter = adapterFor()
    adapter.compressedBudgetMs = -1
    let sessions = byId(await adapter.discover(now))
    expect(sessions[plain]!.state.kind).toBe('running')
    expect(sessions[old]).toMatchObject({ title: 'Old thread', cwd: cwdA, state: { source: 'codex.state-db', detail: 'metadata_only' } })
    expect(problemCodes(adapter)).toContain('compressed_rollouts_pending')
    adapter.compressedBudgetMs = 60_000
    sessions = byId(await adapter.discover(now))
    expect(sessions[old]).toMatchObject({ title: 'Old thread', state: { source: 'codex.rollout', detail: 'turn_completed' } })
    expect(problemCodes(adapter)).not.toContain('compressed_rollouts_pending')
  })

  it('reports a file that does not decompress', async () => {
    const file = `${codexRolloutPath(home, 'thread-broken', ago(50))}.zst`
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from('not zstd at all'))
    const adapter = adapterFor()
    expect(await adapter.discover(now)).toEqual([])
    expect(problemCodes(adapter)).toContain('rollout_unreadable')
  })
})

describe('readCompressedJsonl', () => {
  const write = (records: unknown[]) => writeCompressedRollout(path.join(root, 'r', 'rollout-x.jsonl'), records)

  it('feeds head and tail, skips the middle, and keeps marker lines from before the tail', async () => {
    const records = [{ type: 'session_meta', n: 0 }, { type: 'plan', marker: 'update_plan', n: 1 }, ...filler(0, 40), { type: 'last', n: 2 }]
    const head: unknown[] = []
    const tail: unknown[] = []
    const stats = await readCompressedJsonl(write(records), (r) => tail.push(r), (r) => head.push(r), ['update_plan'], {
      headBytes: 64,
      tailBytes: 4096,
    })
    expect(stats.jumped).toBe(true)
    expect(head).toEqual([{ type: 'session_meta', n: 0 }])
    expect(tail.at(-1)).toEqual({ type: 'last', n: 2 })
    expect(tail.length).toBeLessThan(10)
    expect(stats.marked).toEqual([{ type: 'plan', marker: 'update_plan', n: 1 }])
  })

  it('stops at the decompressed size limit and feeds the head only', async () => {
    const head: unknown[] = []
    const tail: unknown[] = []
    const stats = await readCompressedJsonl(write([{ type: 'session_meta' }, ...filler(0, 400)]), (r) => tail.push(r), (r) => head.push(r), [], {
      maxBytes: 100_000,
    })
    expect(stats.tooLarge).toBe(true)
    expect(head.length).toBeGreaterThan(0)
    expect(tail).toEqual([])
  })

  it('counts lines that are not JSON', async () => {
    const file = path.join(root, 'bad.jsonl')
    writeCompressedRollout(file, [])
    fs.writeFileSync(`${file}.zst`, (await import('node:zlib')).zstdCompressSync(Buffer.from('{"type":"a"}\nnot json\n{"type":"b"}\n')))
    const seen: unknown[] = []
    const stats = await readCompressedJsonl(`${file}.zst`, (r) => seen.push(r))
    expect(seen).toEqual([{ type: 'a' }, { type: 'b' }])
    expect(stats.badLines).toBe(1)
  })
})

describe('forked sub-agent rollouts', () => {
  it('the first session_meta names the thread; the parent meta that follows it is history', async () => {
    const parent = 'thread-parent'
    const child = 'thread-forked-child'
    writeCodexRollout(home, codexRolloutPath(home, parent, ago(30)), [codex.meta(parent, cwdA, ago(30)), codex.event('task_complete', ago(29))])
    writeCodexRollout(home, codexRolloutPath(home, child, ago(20)), [
      codex.meta(child, cwdA, ago(20), parent),
      codex.meta(parent, cwdA, ago(30)),
      codex.event('task_started', ago(19)),
    ])
    const sessions = byId(await adapterFor().discover(now))
    expect(sessions[child]).toMatchObject({ parentSessionId: `codex:${parent}`, sourceFiles: 1, state: { kind: 'running' } })
    expect(sessions[child]!.firstSeenAt).toBe(new Date(ago(20)).toISOString())
    expect(sessions[parent]).toMatchObject({ sourceFiles: 1, subagents: { total: 1, active: 1 } })
  })
})

describe('Codex state database', () => {
  const parent = 'thread-db-parent'
  const child = 'thread-db-child'
  const edgeChild = 'thread-db-edge-child'
  const rows = () => [
    { id: parent, cwd: `\\\\?\\${cwdA}`, createdAt: ago(3000), updatedAt: ago(2), name: 'Database thread', branch: 'feature/x' },
    { id: child, cwd: `\\\\?\\${cwdA}`, createdAt: ago(2990), updatedAt: ago(1), nickname: 'Mencius', source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1 } } } },
    { id: edgeChild, cwd: `\\\\?\\UNC\\server\\share\\work`, createdAt: ago(2980), updatedAt: ago(2980), role: 'explorer', source: 'vscode' },
  ]

  it('lists threads without a readable rollout as metadata-only, with unknown state', async () => {
    writeCodexStateDb(home, rows(), { edges: [{ parent, child: edgeChild }] })
    const adapter = adapterFor()
    const sessions = await adapter.discover(now)
    const s = byId(sessions)
    expect(s[parent]).toMatchObject({
      title: 'Database thread',
      cwd: cwdA,
      recordedBranch: 'feature/x',
      providerVersion: '0.166.0',
      firstSeenAt: new Date(ago(3000)).toISOString(),
      lastActivityAt: new Date(ago(2)).toISOString(),
      sourceFiles: 0,
      subagents: { total: 2, active: 0 },
      state: { kind: 'unknown', confidence: 'unknown', source: 'codex.state-db', detail: 'metadata_only', observedAt: new Date(ago(2)).toISOString() },
    })
    // A thread updated a minute ago is still not "running": the database proves nothing about turns.
    expect(s[child]).toMatchObject({ parentSessionId: `codex:${parent}`, agentType: 'Mencius', title: 'Mencius (sub-agent)', state: { kind: 'unknown' } })
    expect(s[edgeChild]).toMatchObject({ parentSessionId: `codex:${parent}`, agentType: 'explorer', cwd: '\\\\server\\share\\work' })
    expect(adapter.status()).toMatchObject({ available: true, problems: [] })
  })

  it('never reads prompt-bearing columns', async () => {
    writeCodexStateDb(home, rows())
    const adapter = adapterFor()
    const sessions = await adapter.discover(now)
    expect(JSON.stringify(sessions)).not.toContain(PROMPT_CANARY)
    expect(JSON.stringify(adapter.status())).not.toContain(PROMPT_CANARY)
  })

  it('a rollout is the source when there is one; the database only supplies a missing title', async () => {
    const withIndex = 'thread-indexed'
    writeCodexRollout(home, codexRolloutPath(home, parent, ago(5)), [codex.meta(parent, `\\\\?\\${cwdA}`, ago(5)), codex.event('task_complete', ago(4))])
    writeCodexRollout(home, codexRolloutPath(home, withIndex, ago(5)), [codex.meta(withIndex, cwdA, ago(5))])
    writeCodexIndex(home, [{ id: withIndex, thread_name: 'Index name', updated_at: new Date(ago(4)).toISOString() }])
    writeCodexStateDb(home, [
      { id: parent, cwd: 'C:\\elsewhere', createdAt: ago(5), updatedAt: ago(4), name: 'Database name' },
      { id: withIndex, cwd: cwdA, createdAt: ago(5), updatedAt: ago(4), name: 'Database name' },
    ])
    const s = byId(await adapterFor().discover(now))
    expect(s[parent]).toMatchObject({ title: 'Database name', cwd: cwdA, sourceFiles: 1, state: { source: 'codex.rollout', detail: 'turn_completed' } })
    expect(s[withIndex]!.title).toBe('Index name')
  })

  it('opens a closed database immutable and creates no file in the Codex home', async () => {
    writeCodexStateDb(home, rows())
    const before = listing(home)
    expect(before).toEqual(['state_5.sqlite'])
    const index = new CodexStateIndex()
    index.refresh(home)
    expect(index.lastMode).toBe('immutable')
    expect(index.size).toBe(3)
    await adapterFor().discover(now)
    expect(listing(home)).toEqual(before)
  })

  it('reads a database Codex holds open with mode=ro, sees its WAL, and does not block its writes', async () => {
    writeCodexStateDb(home, [])
    const writer = openCodexStateDbWriter(home)
    try {
      insertThreads(writer, rows())
      expect(fs.existsSync(`${codexStateDbPath(home)}-wal`)).toBe(true)
      const before = listing(home)
      const index = new CodexStateIndex()
      index.refresh(home)
      expect(index.lastMode).toBe('ro')
      expect(index.size).toBe(3)
      // Codex keeps writing.
      insertThreads(writer, [{ id: 'thread-later', cwd: cwdA, createdAt: ago(1), updatedAt: ago(1) }])
      index.refresh(home)
      expect(index.get('thread-later')).toBeDefined()
      expect(listing(home)).toEqual(before)
    } finally {
      writer.close()
    }
  })

  it('does not open a database outside WAL mode', async () => {
    writeCodexStateDb(home, rows(), { journal: 'delete' })
    expect(isWalDatabase(codexStateDbPath(home))).toBe(false)
    const adapter = adapterFor()
    expect(await adapter.discover(now)).toEqual([])
    expect(problemCodes(adapter)).toEqual(['state_db_unsupported'])
  })

  it('does not read another database generation', async () => {
    writeCodexStateDb(home, rows(), { generation: 6 })
    const adapter = adapterFor()
    expect(await adapter.discover(now)).toEqual([])
    expect(problemCodes(adapter)).toEqual(['state_db_unsupported'])
  })

  it('reports an unrecognized thread table', async () => {
    writeCodexStateDb(home, [], { ddl: 'CREATE TABLE threads (id TEXT PRIMARY KEY, workdir TEXT)' })
    const adapter = adapterFor()
    expect(await adapter.discover(now)).toEqual([])
    expect(problemCodes(adapter)).toEqual(['state_db_unrecognized'])
  })

  it('reports an unreadable database and still reads rollouts', async () => {
    const t = 'thread-still-here'
    writeCodexRollout(home, codexRolloutPath(home, t, ago(5)), [codex.meta(t, cwdA, ago(5))])
    // A WAL header followed by garbage.
    const header = Buffer.alloc(100)
    header.write('SQLite format 3\u0000', 0, 'latin1')
    header[18] = 2
    header[19] = 2
    fs.writeFileSync(codexStateDbPath(home), Buffer.concat([header, Buffer.alloc(4000, 0x5a)]))
    const adapter = adapterFor()
    expect(Object.keys(byId(await adapter.discover(now)))).toEqual([t])
    expect(problemCodes(adapter)).toContain('state_db_unreadable')
  })

  it('a Codex home with only the database is available; one with neither is not', async () => {
    writeCodexStateDb(home, rows())
    const adapter = adapterFor()
    expect((await adapter.discover(now)).length).toBe(3)
    expect(adapter.status().available).toBe(true)
    const empty = adapterFor(path.join(root, 'empty'))
    expect(await empty.discover(now)).toEqual([])
    expect(empty.status()).toMatchObject({ available: false, problems: [] })
  })
})
