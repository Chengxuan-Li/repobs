import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeActivityBuilder, CodexActivityBuilder } from '../../apps/server/src/sessions/activity/builder.ts'
import { classifyCommand, classifyTool } from '../../apps/server/src/sessions/activity/classify.ts'
import { ActivityService, readActivity } from '../../apps/server/src/sessions/activity/service.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

// ADR 0013: steps, tool categories, allowlisted verbs and tokens. Synthetic records only; every
// text field carries a canary that must never appear in the output.

const CANARY = 'CANARY-secret-7f3a'
const t0 = Date.parse('2026-11-02T10:00:00Z')
const at = (s: number) => new Date(t0 + s * 1000).toISOString()
const dirs: string[] = []
afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!)
})

describe('command classification', () => {
  it.each([
    ['git status', 'git_read', 'git status'],
    ['cd /repo && git diff --stat', 'git_read', 'git diff'],
    [`git add -A && git commit -m "${CANARY}; && fix"`, 'git_write', 'git commit'],
    ['git commit -q -F - && git push origin feature/x', 'git_write', 'git push'],
    ['git -C /repo branch -D old', 'git_write', 'git branch'],
    ['git branch --show-current', 'git_read', 'git branch'],
    ['git stash list', 'git_read', 'git stash'],
    ['git stash pop', 'git_write', 'git stash'],
    ['npm test', 'test_build', 'npm test'],
    ['npm run build 2>&1 | tail -5', 'test_build', 'npm run build'],
    [`npm run ${CANARY}`, 'shell', 'npm run'],
    ['npx vitest run tests/x.test.ts', 'test_build', 'npx vitest'],
    ["$env:CI = '1'; npm run typecheck", 'test_build', 'npm run typecheck'],
    ['FOO=1 BAR=2 pytest -q', 'test_build', 'pytest'],
    ['python -m pytest tests', 'test_build', 'python -m pytest'],
    ['cargo test --all', 'test_build', 'cargo test'],
    ['gh pr create --title x', 'shell', 'gh pr'],
    [`cat /home/me/${CANARY}/token.txt`, 'shell', 'cat'],
    ['C:\\tools\\git.exe log -1', 'git_read', 'git log'],
    ['git status && npm test', 'test_build', 'npm test'],
  ])('%s → %s (%s)', (command, category, verb) => {
    expect(classifyCommand(command)).toEqual({ category, verb })
  })

  it('reports no verb for programs outside the allowlist, and never an argument', () => {
    expect(classifyCommand(`./${CANARY}-deploy --key ${CANARY}`)).toEqual({ category: 'shell' })
    for (const c of [`git commit -m "${CANARY}"`, `curl https://${CANARY}.example/x`, `npx ${CANARY}`, `yarn ${CANARY}`]) {
      expect(JSON.stringify(classifyCommand(c))).not.toContain(CANARY)
    }
  })

  it('maps tool names to categories; MCP tools by server', () => {
    expect(classifyTool('claude', 'Read')).toEqual({ category: 'read', tool: 'Read' })
    expect(classifyTool('claude', 'Bash', 'git push')).toEqual({ category: 'git_write', tool: 'Bash', verb: 'git push' })
    expect(classifyTool('claude', 'mcp__energyatlas__query')).toEqual({ category: 'mcp', tool: 'mcp:energyatlas' })
    expect(classifyTool('claude', 'mcp__ccd_turn__update_plan')).toEqual({ category: 'plan', tool: 'update_plan' })
    expect(classifyTool('claude', 'AskUserQuestion')).toMatchObject({ category: 'ask' })
    expect(classifyTool('claude', 'SomethingNew')).toEqual({ category: 'other', tool: 'SomethingNew' })
    expect(classifyTool('codex', 'exec', 'npm test')).toEqual({ category: 'test_build', tool: 'exec', verb: 'npm test' })
    expect(classifyTool('codex', 'apply_patch')).toMatchObject({ category: 'edit' })
    expect(classifyTool('codex', 'spawn_agent')).toMatchObject({ category: 'agents' })
  })
})

const claudeRec = (type: string, s: number, extra: Record<string, unknown>) => ({ type, timestamp: at(s), sessionId: 'c1', cwd: '/x', ...extra })
const usage = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  output_tokens: output,
})

function claudeSession() {
  return [
    claudeRec('user', 0, { permissionMode: 'bypassPermissions', message: { role: 'user', content: `${CANARY} prompt` } }),
    // One response streamed as three records sharing a message id and usage.
    claudeRec('assistant', 4, { message: { id: 'm1', role: 'assistant', content: [{ type: 'thinking', thinking: CANARY }], usage: usage(10, 1000, 200, 5) } }),
    claudeRec('assistant', 5, { message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: CANARY }], usage: usage(10, 1000, 200, 40) } }),
    claudeRec('assistant', 6, {
      message: { id: 'm1', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u1', name: 'Bash', input: { command: `git commit -m "${CANARY}"`, description: CANARY } }], usage: usage(10, 1000, 200, 60) },
    }),
    claudeRec('user', 9, { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u1', content: CANARY }] } }),
    claudeRec('assistant', 11, {
      message: { id: 'm2', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u2', name: 'Read', input: { file_path: `/${CANARY}` } }], usage: usage(5, 1300, 0, 20) },
    }),
    claudeRec('user', 12, { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u2', is_error: true, content: CANARY }] } }),
    claudeRec('system', 13, { subtype: 'compact_boundary', content: CANARY }),
    claudeRec('assistant', 15, { message: { id: 'm3', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u3', name: 'Grep', input: { pattern: CANARY } }], usage: usage(1, 50, 0, 2) } }),
    claudeRec('assistant', 16, { isSidechain: true, message: { id: 's1', role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'Write', input: {} }], usage: usage(9, 9, 9, 9) } }),
    claudeRec('assistant', 17, { isApiErrorMessage: true, message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: CANARY }] } }),
  ]
}

describe('Claude Code activity', () => {
  it('builds model spans, tool spans with outcomes, marks and per-response tokens', () => {
    const b = new ClaudeActivityBuilder()
    for (const r of claudeSession()) b.feed(r)
    const r = b.result()
    expect(r.steps.map((s) => s.kind)).toEqual(['prompt', 'model', 'tool', 'model', 'tool', 'compaction', 'model', 'tool', 'error'])
    const [, model1, commit, , read, , , grep] = r.steps
    expect(model1).toMatchObject({ start: t0, end: t0 + 6_000, thinking: true })
    expect(commit).toMatchObject({ category: 'git_write', tool: 'Bash', verb: 'git commit', start: t0 + 6_000, end: t0 + 9_000, ok: true })
    expect(read).toMatchObject({ category: 'read', ok: false, end: t0 + 12_000 })
    expect(grep).toMatchObject({ category: 'search' })
    expect(grep!.end).toBeUndefined() // still running
    // Three responses (the sidechain and the synthetic error are not counted); m1 once, with its final output.
    expect(r.tokens).toHaveLength(3)
    expect(r.tokens[0]).toMatchObject({ input: 10, cacheRead: 1000, cacheWrite: 200, output: 60, context: 1210 })
    expect(r.totals).toEqual({ input: 16, cacheRead: 2350, cacheWrite: 200, output: 82, reasoning: 0 })
    expect(r.truncated).toBe(false)
    expect(JSON.stringify(r)).not.toContain(CANARY)
  })

  it('keeps only the latest steps beyond the bound and says so', () => {
    const b = new ClaudeActivityBuilder()
    for (let i = 0; i < 5_200; i++) {
      b.feed(claudeRec('assistant', i * 2, { message: { id: `m${i}`, role: 'assistant', content: [{ type: 'tool_use', id: `u${i}`, name: 'Read', input: {} }] } }))
      b.feed(claudeRec('user', i * 2 + 1, { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `u${i}` }] } }))
    }
    const r = b.result()
    expect(r.steps).toHaveLength(4_000)
    expect(r.truncated).toBe(true)
    expect(r.steps.at(-1)).toMatchObject({ kind: 'tool', end: t0 + (5_199 * 2 + 1) * 1000 })
  })
})

const codexRec = (type: string, s: number, payload: Record<string, unknown>) => ({ timestamp: at(s), type, payload })
const tokenCount = (s: number, total: number, input: number, cached: number, output: number, reasoning: number) =>
  codexRec('event_msg', s, {
    type: 'token_count',
    info: {
      total_token_usage: { total_tokens: total },
      last_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning, total_tokens: input + output },
      model_context_window: 258_400,
    },
  })

function codexThread(id = 'th-1') {
  return [
    codexRec('session_meta', 0, { id, cwd: '/x', base_instructions: { text: CANARY } }),
    codexRec('event_msg', 1, { type: 'task_started' }),
    codexRec('response_item', 1, { type: 'message', role: 'user', content: [{ type: 'input_text', text: CANARY }] }),
    codexRec('response_item', 3, { type: 'reasoning', encrypted_content: CANARY }),
    codexRec('response_item', 4, { type: 'custom_tool_call', name: 'exec', call_id: 'c1', input: `git push origin ${CANARY}` }),
    tokenCount(4, 1_000, 900, 800, 100, 30),
    tokenCount(4, 1_000, 900, 800, 100, 30), // repeated without a new response
    codexRec('response_item', 8, { type: 'custom_tool_call_output', call_id: 'c1', output: [{ type: 'input_text', text: CANARY }] }),
    codexRec('response_item', 9, { type: 'function_call', name: 'exec_command', call_id: 'c2', arguments: JSON.stringify({ cmd: ['bash', '-lc', `npm test -- ${CANARY}`] }) }),
    codexRec('response_item', 12, { type: 'function_call_output', call_id: 'c2', output: CANARY }),
    codexRec('response_item', 13, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: CANARY }] }),
    tokenCount(13, 2_500, 1_400, 1_000, 100, 0),
    codexRec('event_msg', 14, { type: 'task_complete', last_agent_message: CANARY }),
  ]
}

describe('Codex activity', () => {
  it('builds spans from calls and outputs, reasoning, and deduplicated token counts', () => {
    const b = new CodexActivityBuilder()
    for (const r of codexThread()) b.feed(r)
    const r = b.result()
    expect(r.steps.map((s) => s.kind)).toEqual(['prompt', 'model', 'tool', 'model', 'tool', 'model'])
    expect(r.steps[1]).toMatchObject({ start: t0 + 1_000, end: t0 + 4_000, thinking: true })
    expect(r.steps[2]).toMatchObject({ category: 'git_write', tool: 'exec', verb: 'git push', start: t0 + 4_000, end: t0 + 8_000 })
    expect(r.steps[2]!.ok).toBeUndefined() // Codex records no exit code
    expect(r.steps[4]).toMatchObject({ category: 'test_build', tool: 'exec_command', verb: 'npm test', end: t0 + 12_000 })
    expect(r.tokens).toHaveLength(2)
    expect(r.tokens[0]).toMatchObject({ input: 100, cacheRead: 800, output: 70, reasoning: 30, context: 900 })
    expect(r.contextWindow).toBe(258_400)
    expect(JSON.stringify(r)).not.toContain(CANARY)
  })

  it("ignores a parent's history repeated in a forked sub-agent's rollout", () => {
    const b = new CodexActivityBuilder()
    const own = codexThread('child').slice(0, 5)
    const parent = codexThread('parent')
    for (const r of [...own, ...parent]) b.feed(r)
    expect(b.result().steps.filter((s) => s.kind === 'tool')).toHaveLength(1)
  })
})

describe('reading on demand', () => {
  const writeJsonl = (file: string, recs: unknown[]) => fs.writeFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n')

  it('reads a plain transcript, caches until the file changes, and reads compressed rollouts', async () => {
    const dir = makeTempDir('activity')
    dirs.push(dir)
    const file = path.join(dir, 'c1.jsonl')
    writeJsonl(file, claudeSession())
    const service = new ActivityService()
    const sources = { provider: 'claude' as const, files: [{ file, compressed: false }] }
    const first = await service.get('claude:c1', sources)
    expect(first.state).toBe('ok')
    expect(first.steps.filter((s) => s.kind === 'tool')).toHaveLength(3)
    expect(await service.get('claude:c1', sources)).toBe(first)
    fs.appendFileSync(file, JSON.stringify(claudeRec('user', 30, { message: { role: 'user', content: 'again' } })) + '\n')
    const second = await service.get('claude:c1', sources)
    expect(second).not.toBe(first)
    expect(second.steps.at(-1)).toMatchObject({ kind: 'prompt' })
    expect(await service.get('claude:none', { provider: 'claude', files: [{ file: path.join(dir, 'missing.jsonl'), compressed: false }] })).toMatchObject({ state: 'unavailable' })

    if (typeof zlib.zstdCompressSync === 'function') {
      const zst = path.join(dir, 'rollout.jsonl.zst')
      fs.writeFileSync(zst, zlib.zstdCompressSync(Buffer.from(codexThread().map((r) => JSON.stringify(r)).join('\n') + '\n')))
      const r = await readActivity({ provider: 'codex', files: [{ file: zst, compressed: true }] })
      expect(r.steps.filter((s) => s.kind === 'tool')).toHaveLength(2)
      expect(JSON.stringify(r)).not.toContain(CANARY)
    }
  })

  it('reads only a bounded tail of a large file and marks the result truncated', async () => {
    const dir = makeTempDir('activity')
    dirs.push(dir)
    const file = path.join(dir, 'big.jsonl')
    const recs = Array.from({ length: 400 }, (_, i) => claudeRec('user', i, { message: { role: 'user', content: 'x'.repeat(200) } }))
    writeJsonl(file, recs)
    const r = await readActivity({ provider: 'claude', files: [{ file, compressed: false }] }, { tailBytes: 8 * 1024, headBytes: 1024, parallel: 1, cacheEntries: 1 })
    expect(r.truncated).toBe(true)
    expect(r.steps.length).toBeGreaterThan(0)
    expect(r.steps.length).toBeLessThan(400)
  })
})
