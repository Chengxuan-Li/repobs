import { createHash } from 'node:crypto'
import { type AgentPlan, type AgentPlanSource, type PlanItemStatus, LIMITS } from '@repobs/contracts'
import { asIso, isRecord } from './types.ts'

// Agent plans (ADR 0009): the step lists agents keep with their own planning tools, rebuilt by
// replaying the tool calls in transcript order. No interpretation of free text: only these
// structured calls count.
//
//   Claude app task list   mcp__ccd_turn__update_plan  {items:[{content,status}]} replaces the list;
//                          {advance:true}; {done:[n], start:m} (1-based); mcp__ccd_turn__wrap_up
//                          completes the step in progress
//   Claude Code to-do list TodoWrite {todos:[{content,status,activeForm}]} replaces the list
//   Codex                  update_plan function call, arguments {explanation?, plan:[{step,status}]}
//
// Item text is the agent's own words: it is kept in memory only, like message excerpts, and is
// never written to the repobs database. Your ticks on agent items are stored by item key.

export type PlanOp =
  | { kind: 'replace'; items: Array<{ text: string; status: PlanItemStatus }> }
  | { kind: 'advance' }
  | { kind: 'mark'; done: number[]; start?: number }
  | { kind: 'finish' }

export interface PlanEvent {
  source: AgentPlanSource
  at?: string
  op: PlanOp
}

/** Tool names whose calls carry plan events; used to prefilter transcript lines cheaply. */
export const PLAN_MARKERS = ['mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up', 'TodoWrite', 'update_plan']

const STATUSES: PlanItemStatus[] = ['pending', 'in_progress', 'completed']
const MAX_ITEMS = 100

function status(v: unknown): PlanItemStatus {
  return STATUSES.includes(v as PlanItemStatus) ? (v as PlanItemStatus) : 'pending'
}

function items(list: unknown, textField: string): Array<{ text: string; status: PlanItemStatus }> | undefined {
  if (!Array.isArray(list)) return undefined
  const out: Array<{ text: string; status: PlanItemStatus }> = []
  for (const it of list.slice(0, MAX_ITEMS)) {
    if (!isRecord(it) || typeof it[textField] !== 'string') continue
    const text = (it[textField] as string).replace(/\s+/g, ' ').trim().slice(0, LIMITS.checklistTextChars)
    if (text) out.push({ text, status: status(it.status) })
  }
  return out
}

const indices = (v: unknown): number[] => (Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [])

/** The plan event of a Claude `tool_use` content item, if it is one. */
export function claudePlanEvent(item: Record<string, unknown>, at: string | undefined): PlanEvent | undefined {
  const input = isRecord(item.input) ? item.input : {}
  if (item.name === 'TodoWrite') {
    const list = items(input.todos, 'content')
    return list ? { source: 'claude_todo', at, op: { kind: 'replace', items: list } } : undefined
  }
  if (item.name === 'mcp__ccd_turn__wrap_up') return { source: 'claude_task_list', at, op: { kind: 'finish' } }
  if (item.name !== 'mcp__ccd_turn__update_plan') return undefined
  const list = items(input.items, 'content')
  if (list) return { source: 'claude_task_list', at, op: { kind: 'replace', items: list } }
  if (input.advance === true) return { source: 'claude_task_list', at, op: { kind: 'advance' } }
  const done = indices(input.done)
  const start = Number.isInteger(input.start) && (input.start as number) > 0 ? (input.start as number) : undefined
  if (done.length || start) return { source: 'claude_task_list', at, op: { kind: 'mark', done, start } }
  return undefined
}

/** Plan events of one Claude transcript record (an assistant message may hold several tool calls). */
export function claudeRecordPlanEvents(rec: unknown): PlanEvent[] {
  if (!isRecord(rec) || rec.type !== 'assistant' || !isRecord(rec.message) || !Array.isArray(rec.message.content)) return []
  const at = asIso(rec.timestamp)
  const out: PlanEvent[] = []
  for (const c of rec.message.content) {
    if (isRecord(c) && c.type === 'tool_use') {
      const ev = claudePlanEvent(c, at)
      if (ev) out.push(ev)
    }
  }
  return out
}

/** The plan event of a Codex rollout record, if it is an `update_plan` call. */
export function codexRecordPlanEvent(rec: unknown): PlanEvent | undefined {
  if (!isRecord(rec) || rec.type !== 'response_item' || !isRecord(rec.payload)) return undefined
  const p = rec.payload
  if (p.type !== 'function_call' || p.name !== 'update_plan') return undefined
  let args: unknown = p.arguments
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return undefined
    }
  }
  const list = isRecord(args) ? items(args.plan, 'step') : undefined
  return list ? { source: 'codex_update_plan', at: asIso(rec.timestamp), op: { kind: 'replace', items: list } } : undefined
}

/** Stable key of an item: its text (and occurrence, for repeated texts), hashed so no text is stored with your ticks. */
export function planItemKey(text: string, occurrence = 0): string {
  return createHash('sha256').update(`${occurrence}\u0000${text.toLowerCase()}`).digest('hex').slice(0, 16)
}

/**
 * Replays plan events in order. Incremental events with no full list before them cannot be
 * replayed (the list they change is unknown): the plan is then undefined, never guessed.
 */
export class PlanTracker {
  private events: PlanEvent[] = []

  feed(ev: PlanEvent) {
    this.events.push(ev)
    // Everything before the latest full list is superseded.
    if (ev.op.kind === 'replace') this.events = [ev]
  }

  /** Earlier events found by scanning back past a skipped part of the transcript. */
  prepend(earlier: PlanEvent[]) {
    if (this.hasList() || !earlier.length) return
    const base = earlier.findLastIndex((e) => e.op.kind === 'replace')
    this.events = [...(base >= 0 ? earlier.slice(base) : earlier), ...this.events]
  }

  /** A full list has been seen, so the plan can be replayed without earlier events. */
  hasList(): boolean {
    return this.events[0]?.op.kind === 'replace'
  }

  plan(): AgentPlan | undefined {
    let list: Array<{ text: string; status: PlanItemStatus }> | undefined
    let source: AgentPlanSource | undefined
    let updatedAt: string | undefined
    for (const ev of this.events) {
      // A wrap-up without a list from the same tool says nothing about a plan.
      if (ev.op.kind === 'finish' && !list) continue
      source = ev.source
      updatedAt = ev.at ?? updatedAt
      const op = ev.op
      if (op.kind === 'replace') list = op.items.map((i) => ({ ...i }))
      else if (!list) continue
      else if (op.kind === 'advance') {
        const cur = list.findIndex((i) => i.status === 'in_progress')
        if (cur >= 0) list[cur]!.status = 'completed'
        const next = list.findIndex((i, n) => n > cur && i.status === 'pending')
        if (next >= 0) list[next]!.status = 'in_progress'
      } else if (op.kind === 'mark') {
        for (const n of op.done) if (list[n - 1]) list[n - 1]!.status = 'completed'
        if (op.start && list[op.start - 1]) list[op.start - 1]!.status = 'in_progress'
      } else if (op.kind === 'finish') {
        for (const i of list) if (i.status === 'in_progress') i.status = 'completed'
      }
    }
    if (!list || !source) return undefined
    const seen = new Map<string, number>()
    return {
      source,
      updatedAt,
      items: list.map((i) => {
        const n = seen.get(i.text) ?? 0
        seen.set(i.text, n + 1)
        return { key: planItemKey(i.text, n), text: i.text, status: i.status }
      }),
    }
  }
}
