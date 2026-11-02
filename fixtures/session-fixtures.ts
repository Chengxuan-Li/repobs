import fs from 'node:fs'
import path from 'node:path'

// Synthetic, anonymized provider data shaped like the files Claude Code 2.1.x and Codex 0.165
// write (structure only; every text value is a placeholder). Paths are generated at test time.

export const iso = (ms: number) => new Date(ms).toISOString()

function appendJsonl(file: string, records: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, records.map((r) => JSON.stringify(r) + '\n').join(''))
}

// Claude --------------------------------------------------------------------------------------

export const encodeClaudeProject = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

export function claudeTranscriptPath(home: string, cwd: string, sessionId: string) {
  return path.join(home, 'projects', encodeClaudeProject(cwd), `${sessionId}.jsonl`)
}

const claudeCommon = (sessionId: string, cwd: string, at: number) => ({
  sessionId,
  cwd,
  timestamp: iso(at),
  version: '2.1.286',
  gitBranch: 'main',
  userType: 'external',
  entrypoint: 'cli',
  isSidechain: false,
  uuid: `${sessionId}-${at}`,
})

export const claude = {
  prompt: (sid: string, cwd: string, at: number) => ({
    ...claudeCommon(sid, cwd, at),
    type: 'user',
    message: { role: 'user', content: 'synthetic prompt' },
  }),
  toolUse: (sid: string, cwd: string, at: number) => ({
    ...claudeCommon(sid, cwd, at),
    type: 'assistant',
    message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
  }),
  toolResult: (sid: string, cwd: string, at: number) => ({
    ...claudeCommon(sid, cwd, at),
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'synthetic output' }] },
  }),
  endTurn: (sid: string, cwd: string, at: number) => ({
    ...claudeCommon(sid, cwd, at),
    type: 'assistant',
    message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'synthetic answer' }] },
  }),
  /** A failed API call as Claude Code records it (e.g. a run that could not sign in): a synthetic reply ending with stop_sequence. */
  apiError: (sid: string, cwd: string, at: number, error = 'authentication_failed') => ({
    ...claudeCommon(sid, cwd, at),
    type: 'assistant',
    error,
    isApiErrorMessage: true,
    message: { model: '<synthetic>', role: 'assistant', stop_reason: 'stop_sequence', content: [{ type: 'text', text: 'synthetic api error' }] },
  }),
  interrupted: (sid: string, cwd: string, at: number) => ({
    ...claudeCommon(sid, cwd, at),
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
  }),
  title: (sid: string, title: string) => ({ type: 'custom-title', customTitle: title, sessionId: sid }),
  relocated: (sid: string, cwd: string) => ({ type: 'relocated', sessionId: sid, relocatedCwd: cwd }),
  futureRecord: (sid: string) => ({ type: 'some-future-record', sessionId: sid, payload: { x: 1 } }),
  /** A plan tool call (ADR 0009): the Claude app's task list, `TodoWrite`, or the app's wrap-up. */
  planCall: (sid: string, cwd: string, at: number, name: 'mcp__ccd_turn__update_plan' | 'mcp__ccd_turn__wrap_up' | 'TodoWrite' | 'TaskCreate' | 'TaskUpdate', input: Record<string, unknown>, id = `plan-${at}`) => ({
    ...claudeCommon(sid, cwd, at),
    type: 'assistant',
    message: { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] },
  }),
  planResult: (sid: string, cwd: string, at: number, callId: string, result: Record<string, unknown>, isError = false) => ({
    ...claudeCommon(sid, cwd, at),
    type: 'user',
    toolUseResult: result,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: 'synthetic task result', is_error: isError }] },
  }),
}

export function writeClaudeSession(home: string, cwd: string, sessionId: string, records: unknown[]) {
  const file = claudeTranscriptPath(home, cwd, sessionId)
  appendJsonl(file, records)
  return file
}

export function writeClaudeSubagent(
  home: string,
  cwd: string,
  sessionId: string,
  agentId: string,
  records: unknown[],
  meta?: { agentType: string; description: string },
) {
  const file = path.join(home, 'projects', encodeClaudeProject(cwd), sessionId, 'subagents', `agent-${agentId}.jsonl`)
  appendJsonl(file, records)
  if (meta) fs.writeFileSync(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ ...meta, toolUseId: 'toolu_synthetic', spawnDepth: 1 }))
  return file
}

export function writeClaudeRegistry(
  home: string,
  entry: { pid: number; sessionId: string; cwd: string; status: string; name?: string; at: number },
) {
  const file = path.join(home, 'sessions', `${entry.pid}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({
      pid: entry.pid,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      startedAt: entry.at,
      version: '2.1.286',
      kind: 'interactive',
      entrypoint: 'cli',
      pidDomain: `${process.platform}:fixture-host`,
      name: entry.name,
      status: entry.status,
      updatedAt: entry.at,
      statusUpdatedAt: entry.at,
    }),
  )
  // A secret-looking sibling that adapters must never open.
  fs.writeFileSync(path.join(home, 'sessions', `${entry.pid}.deadbeef.key`), 'SYNTHETIC-SECRET-NEVER-READ')
  return file
}

// Codex ---------------------------------------------------------------------------------------

export function codexRolloutPath(home: string, threadId: string, at: number, suffix = '') {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = iso(at).slice(0, 19).replace(/:/g, '-')
  return path.join(
    home,
    'sessions',
    String(d.getFullYear()),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    `rollout-${stamp}-${threadId}${suffix}.jsonl`,
  )
}

export const codex = {
  meta: (threadId: string, cwd: string, at: number, parent?: string) => ({
    timestamp: iso(at),
    type: 'session_meta',
    payload: {
      id: threadId,
      session_id: parent ? `${threadId}-s` : threadId,
      parent_thread_id: parent ?? null,
      timestamp: iso(at),
      cwd,
      originator: 'codex_cli',
      cli_version: '0.165.0',
      source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : 'cli',
      base_instructions: { text: 'synthetic instructions' },
    },
  }),
  turnContext: (cwd: string, at: number) => ({ timestamp: iso(at), type: 'turn_context', payload: { cwd, model: 'synthetic' } }),
  event: (type: string, at: number) => ({ timestamp: iso(at), type: 'event_msg', payload: { type } }),
  item: (at: number) => ({ timestamp: iso(at), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } }),
  /** An update_plan call (ADR 0009); Codex passes the arguments as a JSON string. */
  updatePlan: (at: number, plan: Array<{ step: string; status: string }>) => ({
    timestamp: iso(at),
    type: 'response_item',
    payload: { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ explanation: 'synthetic', plan }) },
  }),
}

export function writeCodexRollout(home: string, file: string, records: unknown[]) {
  appendJsonl(file, records)
  return file
}

export function writeCodexIndex(home: string, entries: Array<{ id: string; thread_name: string; updated_at: string }>) {
  appendJsonl(path.join(home, 'session_index.jsonl'), entries)
}
