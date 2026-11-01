import { describe, expect, it } from 'vitest'
import { AutomationRuleInput } from '@repobs/contracts'
import { describeRule, RULE_TEMPLATES } from './describe'

describe('automation rule descriptions', () => {
  it('reads as a sentence', () => {
    expect(describeRule(RULE_TEMPLATES[0]!.rule)).toBe('When last activity more than 7 days ago and review state is unreviewed or needs review: set review state to outdated.')
    expect(
      describeRule({
        match: 'any',
        conditions: [
          { kind: 'text', field: 'repository', op: 'contains', value: 'api' },
          { kind: 'tag', op: 'lacks', tag: 'keep' },
        ],
        actions: [{ kind: 'complete_checklist' }, { kind: 'add_tag', tag: 'done' }],
      }),
    ).toBe('When repository name contains “api” or does not have tag “keep”: tick every checklist item, add tag “done”.')
  })

  it('offers only templates the server accepts', () => {
    for (const t of RULE_TEMPLATES) expect(AutomationRuleInput.safeParse(t.rule).success).toBe(true)
  })
})
