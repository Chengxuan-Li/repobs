import { z } from 'zod'

// What an agent did, step by step, and the tokens it used (ADR 0013). Structural only: tool names,
// categories, allowlisted command verbs, times, outcomes and token counts. Never prompts, replies,
// reasoning text, tool inputs or outputs.

export const ToolCategory = z.enum([
  'read',
  'search',
  'edit',
  'shell',
  'git_read',
  'git_write',
  'test_build',
  'web',
  'agents',
  'plan',
  'ask',
  'mcp',
  'other',
])
export type ToolCategory = z.infer<typeof ToolCategory>

export const ActivityStepKind = z.enum([
  /** The model producing a response: from the record before it to the response (an estimate). */
  'model',
  /** A tool call, from the call to its result (no end while pending). */
  'tool',
  /** A prompt: a turn starts. */
  'prompt',
  /** The context was compacted. */
  'compaction',
  /** A failed API call or a recorded error. */
  'error',
])
export type ActivityStepKind = z.infer<typeof ActivityStepKind>

export const ActivityStep = z.object({
  kind: ActivityStepKind,
  /** Epoch ms. */
  start: z.number(),
  /** Epoch ms; absent for marks and for a tool call still running. */
  end: z.number().optional(),
  /** Tool calls only. */
  category: ToolCategory.optional(),
  /** Tool name; MCP tools as `mcp:<server>`. */
  tool: z.string().max(80).optional(),
  /** Allowlisted command verb of a shell call, e.g. `git commit`, `npm test`. */
  verb: z.string().max(40).optional(),
  /** Tool outcome when the provider records it (Claude Code); absent when unknown. */
  ok: z.boolean().optional(),
  /** Model steps: the response included thinking / reasoning. */
  thinking: z.boolean().optional(),
})
export type ActivityStep = z.infer<typeof ActivityStep>

export const TokenCounts = z.object({
  /** Uncached input. */
  input: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  /** Reasoning output, when reported separately (Codex). */
  reasoning: z.number().int().nonnegative(),
})
export type TokenCounts = z.infer<typeof TokenCounts>

export const TokenSample = TokenCounts.extend({
  /** Epoch ms of the response. */
  at: z.number(),
  /** Tokens in the model's context for this response: all input, cached or not. */
  context: z.number().int().nonnegative(),
})
export type TokenSample = z.infer<typeof TokenSample>

export const SessionActivity = z.object({
  sessionId: z.string(),
  /** `ok`, or why there is nothing: turned off in settings, provider files unavailable. */
  state: z.enum(['ok', 'disabled', 'unavailable']),
  steps: z.array(ActivityStep),
  tokens: z.array(TokenSample),
  /** Sum over the samples read (a truncated read sums only what was read). */
  totals: TokenCounts,
  /** Largest context window the provider recorded (Codex), if any. */
  contextWindow: z.number().int().positive().optional(),
  /** Older steps or samples beyond the read bounds were left out. */
  truncated: z.boolean(),
  /** Changes whenever the session's files change; lets the browser keep a cached result. */
  version: z.string(),
})
export type SessionActivity = z.infer<typeof SessionActivity>

export const TOOL_CATEGORY_LABELS: Record<ToolCategory, string> = {
  read: 'Read',
  search: 'Search',
  edit: 'Edit',
  shell: 'Shell',
  git_read: 'Git: inspect',
  git_write: 'Git: change',
  test_build: 'Test or build',
  web: 'Web',
  agents: 'Agents',
  plan: 'Plan',
  ask: 'Question to you',
  mcp: 'MCP',
  other: 'Other',
}

export const EMPTY_TOKENS: TokenCounts = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 }
