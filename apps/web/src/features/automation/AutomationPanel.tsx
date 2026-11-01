import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  type AutomationAction,
  type AutomationCondition,
  type AutomationPreview,
  type AutomationRule,
  type AutomationRuleInput,
  type AutomationRuleStatus,
  type AutomationTextField,
  REVIEW_LABELS,
  type ReviewState,
} from '@repobs/contracts'
import { api, ApiError } from '../../app/api'
import { formatAge, InlineAlert, ReviewDot } from '../../components/primitives'
import {
  ACTION_LABELS,
  CONDITION_LABELS,
  defaultAction,
  defaultCondition,
  describeRule,
  RULE_TEMPLATES,
  TEXT_FIELD_LABELS,
} from './describe'
import styles from './automation.module.css'

// The Automation panel (ADR 0008): rules that change agents' annotations — review state, tags,
// alias, note, checklist — when their conditions hold. A rule applies to an agent once per
// revision, so your own later edits stick. Rules never decide what a view shows: that is the
// view's Hidden filter.

const REVIEWS = Object.keys(REVIEW_LABELS) as ReviewState[]
const CONDITION_KINDS = Object.keys(CONDITION_LABELS) as Array<AutomationCondition['kind']>
const ACTION_KINDS = Object.keys(ACTION_LABELS) as Array<AutomationAction['kind']>
const TEXT_FIELDS = Object.keys(TEXT_FIELD_LABELS) as AutomationTextField[]

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; rules: AutomationRuleStatus[] }
type Editing = { id?: string; rule: AutomationRuleInput }

const BLANK: AutomationRuleInput = {
  name: '',
  enabled: true,
  match: 'all',
  conditions: [defaultCondition('last_activity')],
  actions: [defaultAction('set_review')],
}

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/** `changeKey` changes when annotations change, so match and apply counts are read again. */
export function AutomationPanel({ changeKey, now }: { changeKey: unknown; now: number }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [editing, setEditing] = useState<Editing>()
  const [notice, setNotice] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState<string>()

  const fetchRules = useCallback(
    () =>
      api<AutomationRuleStatus[]>('GET', '/automation/rules').then(
        (rules): Load => ({ kind: 'ready', rules }),
        (e: unknown): Load => ({ kind: 'error', message: message(e, 'Could not load the automation rules') }),
      ),
    [],
  )
  const reload = useCallback(async () => setLoad(await fetchRules()), [fetchRules])
  useEffect(() => {
    let cancelled = false
    void fetchRules().then((next) => !cancelled && setLoad(next))
    return () => {
      cancelled = true
    }
  }, [fetchRules, changeKey])

  const save = async (edit: Editing) => {
    try {
      const rule = await api<AutomationRule>(edit.id ? 'PUT' : 'POST', edit.id ? `/automation/rules/${edit.id}` : '/automation/rules', edit.rule)
      setEditing(undefined)
      setNotice(`Saved “${rule.name}”.${rule.enabled ? ' It applies to the agents it matches now and to others as they come to match.' : ' It is switched off.'}`)
      await reload()
    } catch (e) {
      setNotice(message(e, 'Could not save the rule'))
    }
  }
  const setEnabled = async (r: AutomationRuleStatus, enabled: boolean) => {
    try {
      await api('PUT', `/automation/rules/${r.id}`, { name: r.name, enabled, match: r.match, conditions: r.conditions, actions: r.actions } satisfies AutomationRuleInput)
      await reload()
    } catch (e) {
      setNotice(message(e, 'Could not switch the rule'))
    }
  }
  const remove = async (id: string) => {
    setConfirmDelete(undefined)
    try {
      await api('DELETE', `/automation/rules/${id}`)
      await reload()
    } catch (e) {
      setNotice(message(e, 'Could not delete the rule'))
    }
  }

  return (
    <aside className={styles.panel} aria-label="Automation panel">
      <div className="section-strip">
        <span className="label">Automation</span>
        <button type="button" className="btn btn-quiet" disabled={!!editing} onClick={() => setEditing({ rule: BLANK })}>
          <Plus size={13} aria-hidden="true" /> New rule
        </button>
      </div>
      <div className={styles.body}>
        <p className="small muted">
          Rules change the review state, tags, alias, note or checklist of agents that match, like your own edits do. Each rule applies to an agent once per version of
          the rule, so you can still change that agent afterwards. To hide agents, use a view’s <em>Hidden</em> filter.
        </p>
        {notice ? (
          <InlineAlert tone="info" onDismiss={() => setNotice(undefined)}>
            {notice}
          </InlineAlert>
        ) : null}
        {editing ? (
          <RuleEditor
            key={editing.id ?? 'new'}
            initial={editing.rule}
            isNew={!editing.id}
            applied={load.kind === 'ready' ? (load.rules.find((r) => r.id === editing.id)?.applied ?? 0) : 0}
            onCancel={() => setEditing(undefined)}
            onSave={(rule) => void save({ id: editing.id, rule })}
          />
        ) : null}
        {load.kind === 'loading' ? <p className="small muted">Loading rules…</p> : null}
        {load.kind === 'error' ? (
          <InlineAlert tone="danger">
            {load.message}{' '}
            <button type="button" className="btn btn-quiet" onClick={() => void reload()}>
              Retry
            </button>
          </InlineAlert>
        ) : null}
        {load.kind === 'ready' && !load.rules.length && !editing ? (
          <div className={styles.empty}>
            <p className="small">No rules yet. Start from one of these, or create your own:</p>
            {RULE_TEMPLATES.map((t) => (
              <button key={t.label} type="button" className="btn" onClick={() => setEditing({ rule: t.rule })}>
                {t.label}
              </button>
            ))}
          </div>
        ) : null}
        {load.kind === 'ready' && load.rules.length ? (
          <ul className={styles.rules} aria-label="Automation rules">
            {load.rules.map((r) => (
              <li key={r.id} className={`${styles.rule} ${r.enabled ? '' : styles.off}`}>
                <div className={styles.ruleHead}>
                  <label className={styles.toggle}>
                    <input type="checkbox" checked={r.enabled} onChange={(e) => void setEnabled(r, e.target.checked)} aria-label={`Rule ${r.name} switched on`} />
                    <span className={styles.ruleName}>{r.name}</span>
                  </label>
                  <button type="button" className="btn btn-quiet" disabled={!!editing} onClick={() => setEditing({ id: r.id, rule: { name: r.name, enabled: r.enabled, match: r.match, conditions: r.conditions, actions: r.actions } })}>
                    Edit
                  </button>
                  {confirmDelete === r.id ? (
                    <>
                      <button type="button" className="btn btn-danger" onClick={() => void remove(r.id)}>
                        Delete
                      </button>
                      <button type="button" className="btn btn-quiet" onClick={() => setConfirmDelete(undefined)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-quiet btn-icon" aria-label={`Delete rule ${r.name}`} title="Delete rule" onClick={() => setConfirmDelete(r.id)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className={styles.ruleText}>{describeRule(r)}</p>
                <p className="small muted">
                  Matches {r.matching} {r.matching === 1 ? 'agent' : 'agents'} now · applied to {r.applied}
                  {r.lastAppliedAt ? `, last ${formatAge(r.lastAppliedAt, now)} ago` : ''}
                  {r.enabled ? '' : ' · switched off'}
                </p>
                {confirmDelete === r.id ? <p className="small muted">Deleting the rule keeps the changes it already made.</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  )
}

function RuleEditor({
  initial,
  isNew,
  applied,
  onCancel,
  onSave,
}: {
  initial: AutomationRuleInput
  isNew: boolean
  /** Agents the saved rule's current version changed. */
  applied: number
  onCancel: () => void
  onSave: (rule: AutomationRuleInput) => void
}) {
  const [rule, setRule] = useState<AutomationRuleInput>(initial)
  const [preview, setPreview] = useState<{ result?: AutomationPreview; error?: string }>({})
  const set = (patch: Partial<AutomationRuleInput>) => setRule((r) => ({ ...r, ...patch }))
  const setCondition = (i: number, c: AutomationCondition) => set({ conditions: rule.conditions.map((x, j) => (j === i ? c : x)) })
  const setAction = (i: number, a: AutomationAction) => set({ actions: rule.actions.map((x, j) => (j === i ? a : x)) })
  const conditionsIncomplete = rule.conditions.some(conditionIncomplete)
  const incomplete = !rule.name.trim() || conditionsIncomplete || rule.actions.some(actionIncomplete)

  // What the conditions match now, read again shortly after each change.
  useEffect(() => {
    if (rule.conditions.some(conditionIncomplete)) return
    const timer = setTimeout(() => {
      api<AutomationPreview>('POST', '/automation/preview', { ...rule, name: rule.name.trim() || 'Preview' }).then(
        (result) => setPreview({ result }),
        (e: unknown) => setPreview({ error: message(e, 'Could not check the conditions') }),
      )
    }, 300)
    return () => clearTimeout(timer)
  }, [rule])

  return (
    <form
      className={styles.editor}
      aria-label={isNew ? 'New rule' : `Edit rule ${initial.name}`}
      onSubmit={(e) => {
        e.preventDefault()
        if (!incomplete) onSave(rule)
      }}
    >
      <label className={styles.field}>
        <span className="label">Name</span>
        <input className="input" value={rule.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="What the rule does" />
      </label>

      <fieldset className={styles.group}>
        <legend className="label">
          When{' '}
          <select className={`input ${styles.inline}`} aria-label="Which conditions must hold" value={rule.match} onChange={(e) => set({ match: e.target.value as 'all' | 'any' })}>
            <option value="all">all of these hold</option>
            <option value="any">any of these holds</option>
          </select>
        </legend>
        {rule.conditions.map((c, i) => (
          <div key={i} className={styles.line}>
            <select className="input" aria-label={`Condition ${i + 1}`} value={c.kind} onChange={(e) => setCondition(i, defaultCondition(e.target.value as AutomationCondition['kind']))}>
              {CONDITION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONDITION_LABELS[k]}
                </option>
              ))}
            </select>
            <ConditionFields condition={c} index={i} onChange={(next) => setCondition(i, next)} />
            <button type="button" className="btn btn-quiet btn-icon" aria-label={`Remove condition ${i + 1}`} disabled={rule.conditions.length === 1} onClick={() => set({ conditions: rule.conditions.filter((_, j) => j !== i) })}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-quiet" disabled={rule.conditions.length >= 12} onClick={() => set({ conditions: [...rule.conditions, defaultCondition('text')] })}>
          <Plus size={13} aria-hidden="true" /> Add condition
        </button>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">Then</legend>
        {rule.actions.map((a, i) => (
          <div key={i} className={styles.line}>
            <select className="input" aria-label={`Action ${i + 1}`} value={a.kind} onChange={(e) => setAction(i, defaultAction(e.target.value as AutomationAction['kind']))}>
              {ACTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ACTION_LABELS[k]}
                </option>
              ))}
            </select>
            <ActionFields action={a} index={i} onChange={(next) => setAction(i, next)} />
            <button type="button" className="btn btn-quiet btn-icon" aria-label={`Remove action ${i + 1}`} disabled={rule.actions.length === 1} onClick={() => set({ actions: rule.actions.filter((_, j) => j !== i) })}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-quiet" disabled={rule.actions.length >= 12} onClick={() => set({ actions: [...rule.actions, defaultAction('add_tag')] })}>
          <Plus size={13} aria-hidden="true" /> Add action
        </button>
      </fieldset>

      <label className={styles.toggle}>
        <input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Switched on
      </label>

      <div className={styles.preview} aria-live="polite">
        {conditionsIncomplete ? (
          <span className="small muted">Fill in the conditions to see which agents they match.</span>
        ) : preview.error ? (
          <span className="small">{preview.error}</span>
        ) : preview.result ? (
          <span className="small" title={preview.result.examples.map((x) => x.title).join(' · ') || undefined}>
            Matches <strong>{preview.result.matching}</strong> {preview.result.matching === 1 ? 'agent' : 'agents'}
            {/* Agents the rule already changed can stop matching (it set the review state its conditions test). */}
            {applied ? <span className="muted"> · already changed {applied}</span> : null}
          </span>
        ) : (
          <span className="small muted">Fill in the conditions to see which agents they match.</span>
        )}
      </div>

      <div className={styles.buttons}>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={incomplete}>
          {isNew ? 'Create rule' : 'Save rule'}
        </button>
      </div>
    </form>
  )
}

function conditionIncomplete(c: AutomationCondition): boolean {
  return (c.kind === 'text' && !c.value.trim()) || (c.kind === 'tag' && !c.tag.trim()) || (c.kind === 'review' && !c.states.length)
}

function actionIncomplete(a: AutomationAction): boolean {
  return (
    ((a.kind === 'add_tag' || a.kind === 'remove_tag') && !a.tag.trim()) ||
    (a.kind === 'set_alias' && !a.alias.trim()) ||
    ((a.kind === 'append_note' || a.kind === 'add_checklist_item') && !a.text.trim())
  )
}

function ConditionFields({ condition: c, index, onChange }: { condition: AutomationCondition; index: number; onChange: (c: AutomationCondition) => void }) {
  const name = (part: string) => `Condition ${index + 1} ${part}`
  switch (c.kind) {
    case 'last_activity':
      return (
        <>
          <select className="input" aria-label={name('comparison')} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
            <option value="older_than">more than</option>
            <option value="within">within</option>
          </select>
          <input className={`input ${styles.number}`} type="number" min={1} max={10000} aria-label={name('amount')} value={c.amount} onChange={(e) => onChange({ ...c, amount: Math.max(1, Math.min(10_000, Math.round(Number(e.target.value)) || 1)) })} />
          <select className="input" aria-label={name('unit')} value={c.unit} onChange={(e) => onChange({ ...c, unit: e.target.value as typeof c.unit })}>
            <option value="hours">hours{c.op === 'older_than' ? ' ago' : ''}</option>
            <option value="days">days{c.op === 'older_than' ? ' ago' : ''}</option>
          </select>
        </>
      )
    case 'text':
      return (
        <>
          <select className="input" aria-label={name('field')} value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value as AutomationTextField })}>
            {TEXT_FIELDS.map((f) => (
              <option key={f} value={f}>
                {TEXT_FIELD_LABELS[f]}
              </option>
            ))}
          </select>
          <select className="input" aria-label={name('comparison')} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
            <option value="contains">contains</option>
            <option value="not_contains">does not contain</option>
            <option value="equals">is</option>
          </select>
          <input className={`input ${styles.grow}`} aria-label={name('text')} value={c.value} maxLength={200} onChange={(e) => onChange({ ...c, value: e.target.value })} placeholder="keyword" />
        </>
      )
    case 'review':
      return (
        <span className={styles.checks} role="group" aria-label={name('review states')}>
          {REVIEWS.map((r) => (
            <label key={r}>
              <input type="checkbox" checked={c.states.includes(r)} onChange={(e) => onChange({ ...c, states: e.target.checked ? REVIEWS.filter((x) => x === r || c.states.includes(x)) : c.states.filter((x) => x !== r) })} />
              <ReviewDot review={r} />
              {REVIEW_LABELS[r]}
            </label>
          ))}
        </span>
      )
    case 'tag':
      return (
        <>
          <select className="input" aria-label={name('comparison')} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
            <option value="has">is set</option>
            <option value="lacks">is not set</option>
          </select>
          <input className={`input ${styles.grow}`} aria-label={name('tag')} value={c.tag} maxLength={40} onChange={(e) => onChange({ ...c, tag: e.target.value })} placeholder="tag" />
        </>
      )
    case 'provider':
      return (
        <select className="input" aria-label={name('harness')} value={c.provider} onChange={(e) => onChange({ ...c, provider: e.target.value as typeof c.provider })}>
          <option value="claude">is Claude Code</option>
          <option value="codex">is Codex</option>
        </select>
      )
    case 'activity':
      return (
        <select className="input" aria-label={name('state')} value={c.state} onChange={(e) => onChange({ ...c, state: e.target.value as typeof c.state })}>
          <option value="finished">has finished</option>
          <option value="live">is working or waiting</option>
        </select>
      )
    case 'checklist':
      return (
        <select className="input" aria-label={name('state')} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })}>
          <option value="all_done">is all ticked</option>
          <option value="has_open">has open items</option>
          <option value="empty">is empty</option>
        </select>
      )
    case 'spawned':
      return (
        <select className="input" aria-label={name('kind')} value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value === 'true' })}>
          <option value="true">by another agent</option>
          <option value="false">no: a top-level session</option>
        </select>
      )
  }
}

function ActionFields({ action: a, index, onChange }: { action: AutomationAction; index: number; onChange: (a: AutomationAction) => void }) {
  const name = (part: string) => `Action ${index + 1} ${part}`
  switch (a.kind) {
    case 'set_review':
      return (
        <select className="input" aria-label={name('review state')} value={a.review} onChange={(e) => onChange({ ...a, review: e.target.value as ReviewState })}>
          {REVIEWS.map((r) => (
            <option key={r} value={r}>
              {REVIEW_LABELS[r]}
            </option>
          ))}
        </select>
      )
    case 'add_tag':
    case 'remove_tag':
      return <input className={`input ${styles.grow}`} aria-label={name('tag')} value={a.tag} maxLength={40} onChange={(e) => onChange({ ...a, tag: e.target.value })} placeholder="tag" />
    case 'set_alias':
      return <input className={`input ${styles.grow}`} aria-label={name('alias')} value={a.alias} maxLength={120} onChange={(e) => onChange({ ...a, alias: e.target.value })} placeholder="alias" />
    case 'append_note':
    case 'add_checklist_item':
      return <input className={`input ${styles.grow}`} aria-label={name('text')} value={a.text} maxLength={200} onChange={(e) => onChange({ ...a, text: e.target.value })} placeholder="text" />
    case 'complete_checklist':
      return (
        <input
          className={`input ${styles.grow}`}
          aria-label={name('items containing')}
          value={a.match ?? ''}
          maxLength={200}
          onChange={(e) => onChange({ ...a, match: e.target.value || undefined })}
          placeholder="all, or items containing…"
        />
      )
    case 'remove_done_items':
      return null
  }
}
