import { z } from 'zod'
import { IsoDate, LIMITS, ReviewState } from './domain.ts'

// Automation rules (ADR 0008): conditions on an agent's observed metadata and your annotation, and
// actions that change the annotation. Rules write to the local annotation store only, the same
// place your own edits go; what a view shows is decided by view filters, never by rules.

export const AUTOMATION_LIMITS = {
  rules: 100,
  conditions: 12,
  actions: 12,
  nameChars: 80,
  textChars: 200,
} as const

/** Text an agent condition can look in (case-insensitive). */
export const AutomationTextField = z.enum(['title', 'alias', 'note', 'tags', 'repository', 'branch', 'agent_type', 'last_message'])
export type AutomationTextField = z.infer<typeof AutomationTextField>

const text = z.string().trim().min(1).max(AUTOMATION_LIMITS.textChars)
const tag = z.string().trim().min(1).max(LIMITS.tagChars)

export const AutomationCondition = z.discriminatedUnion('kind', [
  /** Time since the agent's last recorded activity. */
  z.object({ kind: z.literal('last_activity'), op: z.enum(['older_than', 'within']), amount: z.number().int().min(1).max(10_000), unit: z.enum(['hours', 'days']) }),
  z.object({ kind: z.literal('text'), field: AutomationTextField, op: z.enum(['contains', 'not_contains', 'equals']), value: text }),
  /** Your review state is one of these (no annotation counts as unreviewed). */
  z.object({ kind: z.literal('review'), states: z.array(ReviewState).min(1) }),
  z.object({ kind: z.literal('tag'), op: z.enum(['has', 'lacks']), tag }),
  z.object({ kind: z.literal('provider'), provider: z.enum(['claude', 'codex']) }),
  /** What the agent is observed doing: live (working or waiting) or finished (idle, ended or historical). */
  z.object({ kind: z.literal('activity'), state: z.enum(['live', 'finished']) }),
  z.object({ kind: z.literal('checklist'), op: z.enum(['all_done', 'has_open', 'empty']) }),
  z.object({ kind: z.literal('spawned'), value: z.boolean() }),
])
export type AutomationCondition = z.infer<typeof AutomationCondition>

export const AutomationAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('set_review'), review: ReviewState }),
  z.object({ kind: z.literal('add_tag'), tag }),
  z.object({ kind: z.literal('remove_tag'), tag }),
  z.object({ kind: z.literal('set_alias'), alias: z.string().trim().min(1).max(LIMITS.aliasChars) }),
  /** Appended as a new paragraph. */
  z.object({ kind: z.literal('append_note'), text }),
  /** Skipped when an item with the same text exists. */
  z.object({ kind: z.literal('add_checklist_item'), text: z.string().trim().min(1).max(LIMITS.checklistTextChars) }),
  /** Ticks every open item, or only those whose text contains `match`. */
  z.object({ kind: z.literal('complete_checklist'), match: z.string().trim().max(AUTOMATION_LIMITS.textChars).optional() }),
  z.object({ kind: z.literal('remove_done_items') }),
])
export type AutomationAction = z.infer<typeof AutomationAction>

/** A rule as you edit it. */
export const AutomationRuleInput = z.object({
  name: z.string().trim().min(1).max(AUTOMATION_LIMITS.nameChars),
  enabled: z.boolean(),
  /** All conditions must hold, or any one of them. */
  match: z.enum(['all', 'any']),
  conditions: z.array(AutomationCondition).min(1).max(AUTOMATION_LIMITS.conditions),
  actions: z.array(AutomationAction).min(1).max(AUTOMATION_LIMITS.actions),
})
export type AutomationRuleInput = z.infer<typeof AutomationRuleInput>

export const AutomationRule = AutomationRuleInput.extend({
  id: z.string().min(1).max(64),
  /**
   * Increases whenever the conditions or actions change. A rule applies to an agent once per
   * revision, so your later edits to that agent stick; editing the rule applies it afresh.
   */
  revision: z.number().int().min(1),
  order: z.number().int(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
})
export type AutomationRule = z.infer<typeof AutomationRule>

/** A rule with what it did and what it would do now. */
export const AutomationRuleStatus = AutomationRule.extend({
  /** Agents the conditions match now (enabled or not). */
  matching: z.number().int(),
  /** Agents the current revision was applied to. */
  applied: z.number().int(),
  lastAppliedAt: IsoDate.optional(),
})
export type AutomationRuleStatus = z.infer<typeof AutomationRuleStatus>

export const AutomationPreview = z.object({
  matching: z.number().int(),
  /** Up to ten matching agents. */
  examples: z.array(z.object({ sessionId: z.string(), title: z.string() })),
})
export type AutomationPreview = z.infer<typeof AutomationPreview>

/** A rule that changed an agent's annotation (shown with the agent's details). */
export const AutomationApplication = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  revision: z.number().int(),
  appliedAt: IsoDate,
})
export type AutomationApplication = z.infer<typeof AutomationApplication>
