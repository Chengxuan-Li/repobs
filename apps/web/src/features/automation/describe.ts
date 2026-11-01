import { type AutomationAction, type AutomationCondition, type AutomationRuleInput, type AutomationTextField, REVIEW_LABELS } from '@repobs/contracts'

// Plain-language descriptions of automation rules, for the rule list and the editor's choices.

export const TEXT_FIELD_LABELS: Record<AutomationTextField, string> = {
  title: 'Title',
  alias: 'Your alias',
  note: 'Your note',
  tags: 'A tag',
  repository: 'Repository name',
  branch: 'Branch',
  agent_type: 'Agent type',
  last_message: 'Latest message',
}

export const CONDITION_LABELS: Record<AutomationCondition['kind'], string> = {
  last_activity: 'Last activity',
  text: 'Text',
  review: 'Review state',
  tag: 'Tag',
  provider: 'Harness',
  activity: 'Agent activity',
  checklist: 'Checklist',
  spawned: 'Spawned',
}

export const ACTION_LABELS: Record<AutomationAction['kind'], string> = {
  set_review: 'Set review state',
  add_tag: 'Add tag',
  remove_tag: 'Remove tag',
  set_alias: 'Set alias',
  append_note: 'Add to note',
  add_checklist_item: 'Add checklist item',
  complete_checklist: 'Tick checklist items',
  remove_done_items: 'Remove ticked items',
}

/** A new condition of a kind, with sensible values. */
export function defaultCondition(kind: AutomationCondition['kind']): AutomationCondition {
  switch (kind) {
    case 'last_activity':
      return { kind, op: 'older_than', amount: 7, unit: 'days' }
    case 'text':
      return { kind, field: 'title', op: 'contains', value: '' }
    case 'review':
      return { kind, states: ['unreviewed'] }
    case 'tag':
      return { kind, op: 'has', tag: '' }
    case 'provider':
      return { kind, provider: 'claude' }
    case 'activity':
      return { kind, state: 'finished' }
    case 'checklist':
      return { kind, op: 'all_done' }
    case 'spawned':
      return { kind, value: true }
  }
}

export function defaultAction(kind: AutomationAction['kind']): AutomationAction {
  switch (kind) {
    case 'set_review':
      return { kind, review: 'outdated' }
    case 'add_tag':
    case 'remove_tag':
      return { kind, tag: '' }
    case 'set_alias':
      return { kind, alias: '' }
    case 'append_note':
    case 'add_checklist_item':
      return { kind, text: '' }
    case 'complete_checklist':
      return { kind }
    case 'remove_done_items':
      return { kind }
  }
}

const quote = (s: string) => `“${s}”`

export function describeCondition(c: AutomationCondition): string {
  switch (c.kind) {
    case 'last_activity':
      return `last activity ${c.op === 'older_than' ? 'more than' : 'within'} ${c.amount} ${c.amount === 1 ? c.unit.slice(0, -1) : c.unit}${c.op === 'older_than' ? ' ago' : ''}`
    case 'text': {
      const op = { contains: 'contains', not_contains: 'does not contain', equals: 'is' }[c.op]
      return `${TEXT_FIELD_LABELS[c.field].toLowerCase()} ${op} ${quote(c.value)}`
    }
    case 'review':
      return `review state is ${c.states.map((s) => REVIEW_LABELS[s].toLowerCase()).join(' or ')}`
    case 'tag':
      return `${c.op === 'has' ? 'has' : 'does not have'} tag ${quote(c.tag)}`
    case 'provider':
      return `harness is ${c.provider === 'claude' ? 'Claude Code' : 'Codex'}`
    case 'activity':
      return c.state === 'live' ? 'agent is working or waiting' : 'agent has finished'
    case 'checklist':
      return { all_done: 'every checklist item is ticked', has_open: 'the checklist has open items', empty: 'the checklist is empty' }[c.op]
    case 'spawned':
      return c.value ? 'agent was spawned by another agent' : 'agent is a top-level session'
  }
}

export function describeAction(a: AutomationAction): string {
  switch (a.kind) {
    case 'set_review':
      return `set review state to ${REVIEW_LABELS[a.review].toLowerCase()}`
    case 'add_tag':
      return `add tag ${quote(a.tag)}`
    case 'remove_tag':
      return `remove tag ${quote(a.tag)}`
    case 'set_alias':
      return `set alias to ${quote(a.alias)}`
    case 'append_note':
      return `add ${quote(a.text)} to the note`
    case 'add_checklist_item':
      return `add checklist item ${quote(a.text)}`
    case 'complete_checklist':
      return a.match ? `tick checklist items containing ${quote(a.match)}` : 'tick every checklist item'
    case 'remove_done_items':
      return 'remove ticked checklist items'
  }
}

/** "When … and …, then …" */
export function describeRule(r: Pick<AutomationRuleInput, 'match' | 'conditions' | 'actions'>): string {
  const when = r.conditions.map(describeCondition).join(r.match === 'all' ? ' and ' : ' or ')
  return `When ${when}: ${r.actions.map(describeAction).join(', ')}.`
}

/** Ready-made rules to start from. */
export const RULE_TEMPLATES: Array<{ label: string; rule: AutomationRuleInput }> = [
  {
    label: 'Mark agents idle for 7 days as outdated',
    rule: {
      name: 'Idle for 7 days → outdated',
      enabled: true,
      match: 'all',
      conditions: [
        { kind: 'last_activity', op: 'older_than', amount: 7, unit: 'days' },
        { kind: 'review', states: ['unreviewed', 'needs_review'] },
      ],
      actions: [{ kind: 'set_review', review: 'outdated' }],
    },
  },
  {
    label: 'Complete agents whose checklist is done',
    rule: {
      name: 'Checklist done → complete',
      enabled: true,
      match: 'all',
      conditions: [{ kind: 'checklist', op: 'all_done' }],
      actions: [{ kind: 'set_review', review: 'complete' }],
    },
  },
  {
    label: 'Ask for review of agents with “fix” in the title',
    rule: {
      name: 'Fixes need review',
      enabled: true,
      match: 'all',
      conditions: [
        { kind: 'text', field: 'title', op: 'contains', value: 'fix' },
        { kind: 'activity', state: 'finished' },
      ],
      actions: [
        { kind: 'set_review', review: 'needs_review' },
        { kind: 'add_checklist_item', text: 'Run the tests' },
      ],
    },
  },
]
