import { type AgentPlan, type PlanItemStatus, LIMITS } from '@repobs/contracts'
import { claudePlanEvent, planItemKey, PlanTracker, PLAN_MARKERS } from './plan.ts'
import { asIso, asString, isRecord } from './types.ts'

// Task ids come from successful tool results, never from counting TaskCreate calls. Only
// subjects, ids and statuses are retained; descriptions and tool output text are not kept.
export const CLAUDE_PLAN_MARKERS = [...PLAN_MARKERS, 'TaskCreate', 'TaskUpdate', '"toolUseResult"']
const MAX_TASKS = 100
const text = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, LIMITS.checklistTextChars) || undefined : undefined
const identifier = (value: unknown) => typeof value === 'string' && value.length <= 128 && value.trim().length > 0 ? value : undefined
const taskStatus = (value: unknown): value is PlanItemStatus => value === 'pending' || value === 'in_progress' || value === 'completed'

interface TaskRequest {
  name: 'TaskCreate' | 'TaskUpdate'
  subject?: string
  taskId?: string
  status?: string
}

export class ClaudePlanReader {
  private tracker = new PlanTracker()
  private pending = new Map<string, TaskRequest>()
  private tasks = new Map<string, { text: string; status: PlanItemStatus }>()
  private taskMode = false
  private updatedAt?: string

  feedRecord(rec: unknown): void {
    if (!isRecord(rec) || rec.isSidechain === true || !isRecord(rec.message) || !Array.isArray(rec.message.content)) return
    const content = rec.message.content.filter(isRecord)
    for (const item of content) {
      if (rec.type === 'assistant' && item.type === 'tool_use') {
        const event = claudePlanEvent(item, asIso(rec.timestamp))
        if (event) {
          if (event.op.kind === 'replace') {
            this.tasks.clear()
            this.pending.clear()
            this.taskMode = false
          }
          if (!this.taskMode) this.tracker.feed(event)
        }
      }
      if (rec.type === 'assistant' && item.type === 'tool_use' && (item.name === 'TaskCreate' || item.name === 'TaskUpdate') && isRecord(item.input)) {
        const id = identifier(item.id)
        if (!id) continue
        this.pending.set(id, { name: item.name, subject: text(item.input.subject), taskId: identifier(item.input.taskId), status: asString(item.input.status, 32) })
        if (this.pending.size > MAX_TASKS) this.pending.delete(this.pending.keys().next().value!)
      } else if (rec.type === 'user' && item.type === 'tool_result') {
        const callId = identifier(item.tool_use_id)
        const request = callId ? this.pending.get(callId) : undefined
        if (!request) continue
        this.pending.delete(callId!)
        // The envelope describes a single tool result. Batched/unknown formats cannot be
        // correlated safely; failing closed is preferable to attaching another tool's data.
        if (item.is_error === true || content.length !== 1 || !isRecord(rec.toolUseResult)) continue
        const result = rec.toolUseResult
        if ((result.success !== undefined && result.success !== true) || result.error !== undefined) continue
        if (request.name === 'TaskCreate') {
          if (!isRecord(result.task)) continue
          const id = identifier(result.task.id)
          const subject = text(result.task.subject) ?? request.subject
          if (!id || !subject || (!this.tasks.has(id) && this.tasks.size >= MAX_TASKS)) continue
          // Claude can reuse task ids later in a session. A new confirmed creation replaces
          // that id's old item; a repeated result alone has no pending request and is ignored.
          this.tasks.delete(id)
          this.tasks.set(id, { text: subject, status: 'pending' })
        } else {
          if (result.success !== true || !request.taskId || result.taskId !== request.taskId) continue
          const task = this.tasks.get(request.taskId)
          if (!task) continue
          const fields = Array.isArray(result.updatedFields) ? result.updatedFields : []
          const reportedStatus = isRecord(result.statusChange) ? result.statusChange.to : fields.includes('status') ? request.status : undefined
          const subject = fields.includes('subject') ? request.subject : undefined
          if (reportedStatus === 'deleted') this.tasks.delete(request.taskId)
          else {
            if (!subject && !taskStatus(reportedStatus)) continue
            if (subject) task.text = subject
            if (taskStatus(reportedStatus)) task.status = reportedStatus
          }
        }
        this.taskMode = true
        this.updatedAt = asIso(rec.timestamp) ?? this.updatedAt
      }
    }
  }

  replay(records: unknown[]): void {
    this.tracker = new PlanTracker()
    this.pending.clear()
    this.tasks.clear()
    this.taskMode = false
    this.updatedAt = undefined
    for (const record of records) this.feedRecord(record)
  }

  plan(): AgentPlan | undefined {
    if (!this.taskMode) return this.tracker.plan()
    const seen = new Map<string, number>()
    return {
      source: 'claude_tasks',
      updatedAt: this.updatedAt,
      items: [...this.tasks.values()].map((item) => {
        const occurrence = seen.get(item.text) ?? 0
        seen.set(item.text, occurrence + 1)
        return { ...item, key: planItemKey(item.text, occurrence) }
      }),
    }
  }
}
