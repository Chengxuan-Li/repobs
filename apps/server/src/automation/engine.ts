import { randomUUID } from 'node:crypto'
import {
  type AgentSession,
  type AnnotationInput,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
  type AutomationTextField,
  isLiveKind,
  LIMITS,
  type SessionAnnotation,
} from '@repobs/contracts'

// Automation rules (ADR 0008). Pure functions: whether a rule's conditions hold for an agent, and
// what its actions make of the agent's annotation. Applying them (once per agent and rule
// revision) is the monitor's job; nothing here reads or writes files, repositories or transcripts.

/** What a rule can look at for one agent. */
export interface AgentFacts {
  session: AgentSession
  annotation?: SessionAnnotation | AnnotationInput
  repositoryName?: string
  /** The branch checked out in the agent's worktree, else the branch its provider recorded. */
  branch?: string
}

const HOUR_MS = 3_600_000

function textOf(field: AutomationTextField, f: AgentFacts): string[] {
  const a = f.annotation
  switch (field) {
    case 'title':
      return [f.session.title]
    case 'alias':
      return [a?.displayAlias ?? '']
    case 'note':
      return [a?.note ?? '']
    case 'tags':
      return a?.tags ?? []
    case 'repository':
      return [f.repositoryName ?? '']
    case 'branch':
      return [f.branch ?? '']
    case 'agent_type':
      return [f.session.agentType ?? '']
    case 'last_message':
      return [f.session.lastMessage?.text ?? '']
  }
}

export function conditionHolds(c: AutomationCondition, f: AgentFacts, now: number): boolean {
  const a = f.annotation
  switch (c.kind) {
    case 'last_activity': {
      // No recorded activity: the age is unknown, so neither "older than" nor "within" holds.
      const last = Date.parse(f.session.lastActivityAt ?? '')
      if (!last) return false
      const age = now - last
      const limit = c.amount * (c.unit === 'days' ? 24 : 1) * HOUR_MS
      return c.op === 'older_than' ? age > limit : age <= limit
    }
    case 'text': {
      const needle = c.value.toLowerCase()
      const values = textOf(c.field, f).map((v) => v.toLowerCase())
      if (c.op === 'equals') return values.some((v) => v === needle)
      const found = values.some((v) => v.includes(needle))
      return c.op === 'contains' ? found : !found
    }
    case 'review':
      return c.states.includes(a?.review ?? 'unreviewed')
    case 'tag': {
      const has = (a?.tags ?? []).some((t) => t.toLowerCase() === c.tag.toLowerCase())
      return c.op === 'has' ? has : !has
    }
    case 'provider':
      return f.session.provider === c.provider
    case 'activity': {
      const k = f.session.state.kind
      if (c.state === 'live') return isLiveKind(k) && !f.session.historical
      return f.session.historical || k === 'idle_or_turn_finished' || k === 'ended'
    }
    case 'checklist': {
      const items = a?.checklist ?? []
      if (c.op === 'empty') return items.length === 0
      if (c.op === 'has_open') return items.some((i) => !i.done)
      return items.length > 0 && items.every((i) => i.done)
    }
    case 'spawned':
      return !!f.session.parentSessionId === c.value
  }
}

export function ruleMatches(rule: Pick<AutomationRule, 'match' | 'conditions'>, f: AgentFacts, now: number): boolean {
  const holds = (c: AutomationCondition) => conditionHolds(c, f, now)
  return rule.match === 'all' ? rule.conditions.every(holds) : rule.conditions.some(holds)
}

/** The annotation of an agent as an editable input (an agent without one starts empty). */
export function toInput(a?: SessionAnnotation | AnnotationInput): AnnotationInput {
  return {
    displayAlias: a?.displayAlias,
    review: a?.review ?? 'unreviewed',
    tags: [...(a?.tags ?? [])],
    note: a?.note ?? '',
    checklist: (a?.checklist ?? []).map((i) => ({ ...i })),
  }
}

/** The annotation after a rule's actions, in order. Actions that would exceed a limit are skipped. */
export function applyActions(current: AnnotationInput, actions: AutomationAction[]): AnnotationInput {
  const next = toInput(current)
  for (const act of actions) {
    switch (act.kind) {
      case 'set_review':
        next.review = act.review
        break
      case 'add_tag':
        if (!next.tags.some((t) => t.toLowerCase() === act.tag.toLowerCase()) && next.tags.length < LIMITS.tags) next.tags.push(act.tag)
        break
      case 'remove_tag':
        next.tags = next.tags.filter((t) => t.toLowerCase() !== act.tag.toLowerCase())
        break
      case 'set_alias':
        next.displayAlias = act.alias
        break
      case 'append_note': {
        const note = next.note.trim() ? `${next.note.trimEnd()}\n\n${act.text}` : act.text
        if (note.length <= LIMITS.noteChars) next.note = note
        break
      }
      case 'add_checklist_item':
        if (!next.checklist.some((i) => i.text === act.text) && next.checklist.length < LIMITS.checklistItems) {
          next.checklist.push({ id: randomUUID(), text: act.text, done: false, order: next.checklist.length })
        }
        break
      case 'complete_checklist': {
        const match = act.match?.toLowerCase()
        next.checklist = next.checklist.map((i) => (!i.done && (!match || i.text.toLowerCase().includes(match)) ? { ...i, done: true } : i))
        break
      }
      case 'remove_done_items':
        next.checklist = next.checklist.filter((i) => !i.done).map((i, order) => ({ ...i, order }))
        break
    }
  }
  return next
}

/** Whether two annotation inputs differ in anything a person would see. */
export function annotationChanged(a: AnnotationInput, b: AnnotationInput): boolean {
  const key = (x: AnnotationInput) =>
    JSON.stringify([x.displayAlias ?? '', x.review, x.tags, x.note, x.checklist.map((i) => [i.id, i.text, i.done])])
  return key(a) !== key(b)
}
