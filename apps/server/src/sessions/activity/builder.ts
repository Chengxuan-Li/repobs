import { type ActivityStep, EMPTY_TOKENS, type TokenCounts, type TokenSample } from '@repobs/contracts'
import { asString, isRecord } from '../types.ts'
import { classifyTool } from './classify.ts'

// Builds an agent's steps and token samples from its transcript records (ADR 0013). Records are fed
// in file order; only structure is read: record types, timestamps, tool names and ids, error flags,
// the presence of thinking, token counts. A shell command is classified in memory and dropped.

export const ACTIVITY_LIMITS = { steps: 4_000, tokens: 2_000 }

export interface ActivityResult {
  steps: ActivityStep[]
  tokens: TokenSample[]
  totals: TokenCounts
  contextWindow?: number
  truncated: boolean
}

const ms = (v: unknown): number | undefined => {
  if (typeof v !== 'string') return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : undefined
}
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)

/** Shared bookkeeping: model spans between inputs, open tool calls by id, bounded lists. */
abstract class ActivityBuilder {
  protected steps: ActivityStep[] = []
  protected tokens: TokenSample[] = []
  protected contextWindow?: number
  protected truncated = false
  private open = new Map<string, ActivityStep>()
  /** The latest input (prompt, tool result) the model is responding to. */
  private inputAt?: number
  private model?: ActivityStep

  /** A prompt or tool result: the model's next output answers it. */
  protected input(at: number) {
    this.inputAt = at
    this.model = undefined
  }

  /** Any model output (text, thinking, tool call) at `at`. */
  protected output(at: number, thinking = false) {
    if (!this.model) {
      this.model = { kind: 'model', start: this.inputAt ?? at, end: at }
      this.push(this.model)
    }
    this.model.end = Math.max(this.model.end ?? at, at)
    if (thinking) this.model.thinking = true
  }

  protected mark(kind: 'prompt' | 'compaction' | 'error', at: number) {
    this.push({ kind, start: at })
  }

  protected toolStart(id: string | undefined, at: number, provider: 'claude' | 'codex', name: string, command?: string) {
    const c = classifyTool(provider, name, command)
    const step: ActivityStep = { kind: 'tool', start: at, category: c.category, tool: c.tool, ...(c.verb ? { verb: c.verb } : {}) }
    this.push(step)
    if (id) this.open.set(id, step)
  }

  protected toolEnd(id: string | undefined, at: number, ok?: boolean) {
    const step = id ? this.open.get(id) : undefined
    if (!step) return
    this.open.delete(id!)
    step.end = Math.max(step.start, at)
    if (ok !== undefined) step.ok = ok
  }

  protected sample(s: TokenSample) {
    this.tokens.push(s)
    if (this.tokens.length > ACTIVITY_LIMITS.tokens * 1.25) {
      this.tokens = this.tokens.slice(-ACTIVITY_LIMITS.tokens)
      this.truncated = true
    }
  }

  private push(step: ActivityStep) {
    this.steps.push(step)
    if (this.steps.length > ACTIVITY_LIMITS.steps * 1.25) {
      const dropped = new Set(this.steps.slice(0, this.steps.length - ACTIVITY_LIMITS.steps))
      this.steps = this.steps.slice(-ACTIVITY_LIMITS.steps)
      for (const [id, s] of this.open) if (dropped.has(s)) this.open.delete(id)
      this.truncated = true
    }
  }

  /** The reader skipped part of the file. */
  markTruncated() {
    this.truncated = true
  }

  result(): ActivityResult {
    const steps = this.steps.length > ACTIVITY_LIMITS.steps ? this.steps.slice(-ACTIVITY_LIMITS.steps) : this.steps
    const tokens = this.tokens.length > ACTIVITY_LIMITS.tokens ? this.tokens.slice(-ACTIVITY_LIMITS.tokens) : this.tokens
    const totals = { ...EMPTY_TOKENS }
    for (const t of tokens) {
      totals.input += t.input
      totals.cacheRead += t.cacheRead
      totals.cacheWrite += t.cacheWrite
      totals.output += t.output
      totals.reasoning += t.reasoning
    }
    return {
      steps: steps.map((s) => ({ ...s })),
      tokens,
      totals,
      ...(this.contextWindow ? { contextWindow: this.contextWindow } : {}),
      truncated: this.truncated || steps.length < this.steps.length || tokens.length < this.tokens.length,
    }
  }
}

/** Claude Code transcripts: one record per content block; usage repeated per message id. */
export class ClaudeActivityBuilder extends ActivityBuilder {
  private usageByMessage = new Map<string, TokenSample>()

  feed = (rec: unknown) => {
    if (!isRecord(rec) || rec.isSidechain === true) return
    const at = ms(rec.timestamp)
    if (at === undefined) return
    const message = isRecord(rec.message) ? rec.message : undefined
    const content = message?.content
    if (rec.type === 'system') {
      if (rec.subtype === 'compact_boundary') this.mark('compaction', at)
      else if (rec.subtype === 'api_error') this.mark('error', at)
      return
    }
    if (rec.type === 'user') {
      if (rec.isMeta === true || rec.isCompactSummary === true || rec.isVisibleInTranscriptOnly === true) return
      const results = Array.isArray(content) ? content.filter((c) => isRecord(c) && c.type === 'tool_result') : []
      if (results.length) {
        for (const r of results as Array<Record<string, unknown>>) this.toolEnd(asString(r.tool_use_id, 128), at, r.is_error !== true)
      } else {
        this.mark('prompt', at)
      }
      this.input(at)
      return
    }
    if (rec.type !== 'assistant') return
    if (rec.isApiErrorMessage === true) {
      this.mark('error', at)
      return
    }
    const blocks = Array.isArray(content) ? content.filter(isRecord) : []
    this.output(at, blocks.some((b) => b.type === 'thinking' || b.type === 'redacted_thinking'))
    for (const b of blocks) {
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
      const input = isRecord(b.input) ? b.input : undefined
      this.toolStart(asString(b.id, 128), at, 'claude', b.name, typeof input?.command === 'string' ? input.command : undefined)
    }
    const usage = isRecord(message?.usage) ? message.usage : undefined
    const id = asString(message?.id, 128)
    if (usage && id && message?.model !== '<synthetic>') {
      const input = int(usage.input_tokens)
      const cacheRead = int(usage.cache_read_input_tokens)
      const cacheWrite = int(usage.cache_creation_input_tokens)
      const sample: TokenSample = { at, input, cacheRead, cacheWrite, output: int(usage.output_tokens), reasoning: 0, context: input + cacheRead + cacheWrite }
      const known = this.usageByMessage.get(id)
      if (known) Object.assign(known, sample, { output: Math.max(known.output, sample.output) })
      else {
        this.usageByMessage.set(id, sample)
        this.sample(sample)
        if (this.usageByMessage.size > ACTIVITY_LIMITS.tokens * 2) this.usageByMessage.clear()
      }
    }
  }
}

/** Codex rollouts: response items, tool calls and outputs by call id, token_count events. */
export class CodexActivityBuilder extends ActivityBuilder {
  private threadId?: string
  private foreign = false
  private lastTotal?: number

  /** Head records: only the first session_meta, which names the file's thread. */
  feedHead = (rec: unknown) => {
    if (!this.threadId && isRecord(rec) && rec.type === 'session_meta' && isRecord(rec.payload)) this.threadId = asString(rec.payload.id, 128)
  }

  feed = (rec: unknown) => {
    if (!isRecord(rec)) return
    const payload = isRecord(rec.payload) ? rec.payload : undefined
    if (rec.type === 'session_meta') {
      // A forked sub-agent's rollout repeats its parent's history after the parent's session_meta.
      const id = asString(payload?.id, 128)
      if (!this.threadId) this.threadId = id
      this.foreign = id !== undefined && id !== this.threadId
      return
    }
    if (this.foreign || !payload) return
    const at = ms(rec.timestamp)
    if (at === undefined) return
    if (rec.type === 'compacted') {
      this.mark('compaction', at)
      return
    }
    if (rec.type === 'event_msg') {
      const type = payload.type
      if (type === 'task_started' || type === 'turn_started') {
        this.mark('prompt', at)
        this.input(at)
      } else if (type === 'error' || type === 'stream_error') this.mark('error', at)
      else if (type === 'token_count') this.tokenCount(payload.info, at)
      return
    }
    if (rec.type !== 'response_item') return
    switch (payload.type) {
      case 'reasoning':
        this.output(at, true)
        return
      case 'message':
        if (payload.role === 'assistant') this.output(at)
        else if (payload.role === 'user') this.input(at)
        return
      case 'function_call':
      case 'custom_tool_call': {
        this.output(at)
        if (typeof payload.name !== 'string') return
        this.toolStart(asString(payload.call_id, 128), at, 'codex', payload.name, codexCommand(payload))
        return
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
        this.toolEnd(asString(payload.call_id, 128), at)
        this.input(at)
        return
    }
  }

  private tokenCount(info: unknown, at: number) {
    if (!isRecord(info)) return
    const window = int(info.model_context_window)
    if (window) this.contextWindow = Math.max(this.contextWindow ?? 0, window)
    const total = isRecord(info.total_token_usage) ? int(info.total_token_usage.total_tokens) : undefined
    // Codex repeats a token_count without a new response; the running total tells them apart.
    if (total !== undefined && total === this.lastTotal) return
    this.lastTotal = total
    const last = isRecord(info.last_token_usage) ? info.last_token_usage : undefined
    if (!last) return
    const all = int(last.input_tokens)
    const cached = Math.min(all, int(last.cached_input_tokens))
    const reasoning = int(last.reasoning_output_tokens)
    this.sample({
      at,
      input: all - cached,
      cacheRead: cached,
      cacheWrite: int(last.cache_write_input_tokens),
      output: Math.max(0, int(last.output_tokens) - reasoning),
      reasoning,
      context: all,
    })
  }
}

/** The command of a Codex shell call: the free-form `exec` input, or `cmd` / `command` arguments. */
function codexCommand(payload: Record<string, unknown>): string | undefined {
  if (payload.type === 'custom_tool_call') return typeof payload.input === 'string' ? payload.input : undefined
  if (typeof payload.arguments !== 'string' || payload.arguments.length > 64 * 1024) return undefined
  let args: unknown
  try {
    args = JSON.parse(payload.arguments)
  } catch {
    return undefined
  }
  if (!isRecord(args)) return undefined
  const cmd = args.cmd ?? args.command
  if (typeof cmd === 'string') return cmd
  if (Array.isArray(cmd)) {
    const parts = cmd.filter((x): x is string => typeof x === 'string')
    // `["bash", "-lc", "git status"]`: the script is the last argument.
    if (parts.length >= 3 && /^(-c|-lc|-Command|\/c)$/i.test(parts[parts.length - 2]!)) return parts[parts.length - 1]
    return parts.join(' ')
  }
  return undefined
}
