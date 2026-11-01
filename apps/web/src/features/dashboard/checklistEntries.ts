import type { AgentPlan, AgentSession, AnnotationSummary, PlanItemStatus } from '@repobs/contracts'

// One checklist in two parts (ADR 0009): first the agent's plan, synced from its planning tool,
// then your own items. The agent never changes your items; you can tick or untick its items,
// which overrides its status in repobs only (nothing goes back to the agent).

export interface ChecklistEntry {
  /** `plan:<key>` for agent items, the item id for yours. */
  id: string
  text: string
  done: boolean
  section: 'agent' | 'human'
  /** Agent items: the status the agent reports. */
  agentStatus?: PlanItemStatus
  /** Agent items: you ticked or unticked it, against the agent's status. */
  overridden?: boolean
}

export const PLAN_SOURCE_LABELS: Record<AgentPlan['source'], string> = {
  claude_task_list: 'Claude task list',
  claude_todo: 'Claude Code to-do list',
  claude_tasks: 'Claude Code tasks',
  codex_update_plan: 'Codex plan',
}

export function checklistEntries(session: AgentSession | undefined, annotation: AnnotationSummary | undefined): ChecklistEntry[] {
  const overrides = annotation?.planOverrides ?? {}
  const agent: ChecklistEntry[] = (session?.plan?.items ?? []).map((i) => {
    const own = overrides[i.key]
    return {
      id: `plan:${i.key}`,
      text: i.text,
      done: own ?? i.status === 'completed',
      section: 'agent',
      agentStatus: i.status,
      overridden: own !== undefined && own !== (i.status === 'completed'),
    }
  })
  const human: ChecklistEntry[] = (annotation?.checklist ?? []).map((i) => ({ id: i.id, text: i.text, done: i.done, section: 'human' }))
  return [...agent, ...human]
}

/** The plan item key of an agent entry. */
export const planKeyOf = (entry: ChecklistEntry) => entry.id.slice('plan:'.length)
