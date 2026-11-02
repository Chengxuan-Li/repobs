import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import {
  type AnnotationInput,
  type AnnotationSummary,
  type AutomationApplication,
  AutomationRule,
  type AutomationRuleInput,
  DEFAULT_SETTINGS,
  mergeSettings,
  type ReviewState,
  SessionAnnotation,
  Settings,
  type SettingsPatch,
} from '@repobs/contracts'

// Typed access to app-local state. Human annotations live only here; nothing in this module
// writes to a repository or to provider files.

export interface StoredRepository {
  id: string
  /** ADR 0011: `folder` registrations have no Git directory (stored as an empty string). */
  kind: 'git' | 'folder'
  displayName: string
  registeredPath: string
  primaryPath: string
  commonGitDir: string
  isBare: boolean
  order: number
  addedAt: string
}

export interface StoredSessionRecord {
  id: string
  provider: 'claude' | 'codex'
  providerSessionId: string
  title: string
  titleSource: 'provider' | 'fallback'
  observedCwd?: string
  repoId?: string
  worktreeId?: string
  firstSeenAt?: string
  lastActivityAt?: string
}

type Row = Record<string, unknown>
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v))

export class AppStore {
  private readonly db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.db = db
  }

  // Repositories ---------------------------------------------------------------------------

  listRepositories(): StoredRepository[] {
    return (this.db.prepare('SELECT * FROM repositories ORDER BY sort_order, added_at').all() as Row[]).map((r) => ({
      id: String(r.id),
      kind: r.kind === 'folder' ? 'folder' : 'git',
      displayName: String(r.display_name),
      registeredPath: String(r.registered_path),
      primaryPath: String(r.primary_path),
      commonGitDir: String(r.common_git_dir),
      isBare: r.is_bare === 1,
      order: Number(r.sort_order),
      addedAt: String(r.added_at),
    }))
  }

  addRepository(repo: Omit<StoredRepository, 'order' | 'addedAt'>): StoredRepository {
    const max = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM repositories').get() as { m: number }
    const stored: StoredRepository = { ...repo, order: max.m + 1, addedAt: new Date().toISOString() }
    this.db
      .prepare(
        `INSERT INTO repositories (id, kind, display_name, registered_path, primary_path, common_git_dir, is_bare, sort_order, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.id,
        stored.kind,
        stored.displayName,
        stored.registeredPath,
        stored.primaryPath,
        stored.commonGitDir,
        stored.isBare ? 1 : 0,
        stored.order,
        stored.addedAt,
      )
    return stored
  }

  updateRepositoryPaths(id: string, primaryPath: string): void {
    this.db.prepare('UPDATE repositories SET primary_path = ? WHERE id = ?').run(primaryPath, id)
  }

  renameRepository(id: string, displayName: string): boolean {
    return this.db.prepare('UPDATE repositories SET display_name = ? WHERE id = ?').run(displayName, id).changes > 0
  }

  /** Unregister only: removes the dashboard entry. Annotations and session records are kept. */
  removeRepository(id: string): boolean {
    return this.db.prepare('DELETE FROM repositories WHERE id = ?').run(id).changes > 0
  }

  reorderRepositories(ids: string[]): void {
    const known = new Set(this.listRepositories().map((r) => r.id))
    const ordered = [...ids.filter((id) => known.has(id)), ...[...known].filter((id) => !ids.includes(id))]
    const stmt = this.db.prepare('UPDATE repositories SET sort_order = ? WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      ordered.forEach((id, i) => stmt.run(i, id))
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // Annotations ----------------------------------------------------------------------------

  getAnnotation(sessionId: string): SessionAnnotation | undefined {
    const r = this.db.prepare('SELECT * FROM annotations WHERE session_id = ?').get(sessionId) as Row | undefined
    return r ? this.rowToAnnotation(r) : undefined
  }

  listAnnotations(): SessionAnnotation[] {
    return (this.db.prepare('SELECT * FROM annotations ORDER BY session_id').all() as Row[]).map((r) =>
      this.rowToAnnotation(r),
    )
  }

  private rowToAnnotation(r: Row): SessionAnnotation {
    return SessionAnnotation.parse({
      sessionId: String(r.session_id),
      displayAlias: str(r.display_alias),
      review: String(r.review) as ReviewState,
      tags: JSON.parse(String(r.tags_json)),
      note: String(r.note),
      checklist: JSON.parse(String(r.checklist_json)),
      planOverrides: JSON.parse(String(r.plan_overrides_json ?? '{}')),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    })
  }

  /** Upsert human-owned metadata. Server owns timestamps; completion times follow `done`. */
  putAnnotation(sessionId: string, input: AnnotationInput, now = new Date().toISOString()): SessionAnnotation {
    const existing = this.getAnnotation(sessionId)
    const previousItems = new Map(existing?.checklist.map((i) => [i.id, i]) ?? [])
    const checklist = input.checklist
      .map((item, index) => {
        const prior = previousItems.get(item.id)
        const createdAt = prior?.createdAt ?? item.createdAt ?? now
        const completedAt = item.done ? (prior?.done ? prior.completedAt : undefined) ?? item.completedAt ?? now : undefined
        return { id: item.id || randomUUID(), text: item.text, done: item.done, order: index, createdAt, completedAt }
      })
    const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))]
    const annotation = SessionAnnotation.parse({
      sessionId,
      displayAlias: input.displayAlias?.trim() || undefined,
      review: input.review,
      tags,
      note: input.note,
      checklist,
      planOverrides: input.planOverrides ?? existing?.planOverrides ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    this.writeAnnotation(annotation)
    return annotation
  }

  writeAnnotation(a: SessionAnnotation): void {
    this.db
      .prepare(
        `INSERT INTO annotations (session_id, display_alias, review, tags_json, note, checklist_json, plan_overrides_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET display_alias = excluded.display_alias, review = excluded.review,
           tags_json = excluded.tags_json, note = excluded.note, checklist_json = excluded.checklist_json,
           plan_overrides_json = excluded.plan_overrides_json, updated_at = excluded.updated_at`,
      )
      .run(
        a.sessionId,
        a.displayAlias ?? null,
        a.review,
        JSON.stringify(a.tags),
        a.note,
        JSON.stringify(a.checklist),
        JSON.stringify(a.planOverrides),
        a.createdAt,
        a.updatedAt,
      )
  }

  deleteAnnotation(sessionId: string): boolean {
    return this.db.prepare('DELETE FROM annotations WHERE session_id = ?').run(sessionId).changes > 0
  }

  annotationSummaries(): AnnotationSummary[] {
    return this.listAnnotations().map(summarizeAnnotation)
  }

  // Session records (minimal metadata so orphaned sessions stay visible) -------------------

  upsertSessionRecord(rec: StoredSessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO session_records (id, provider, provider_session_id, title, title_source, observed_cwd, repo_id,
           worktree_id, first_seen_at, last_activity_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, title_source = excluded.title_source,
           observed_cwd = excluded.observed_cwd, repo_id = excluded.repo_id, worktree_id = excluded.worktree_id,
           first_seen_at = COALESCE(session_records.first_seen_at, excluded.first_seen_at),
           last_activity_at = excluded.last_activity_at, updated_at = excluded.updated_at`,
      )
      .run(
        rec.id,
        rec.provider,
        rec.providerSessionId,
        rec.title,
        rec.titleSource,
        rec.observedCwd ?? null,
        rec.repoId ?? null,
        rec.worktreeId ?? null,
        rec.firstSeenAt ?? null,
        rec.lastActivityAt ?? null,
        new Date().toISOString(),
      )
  }

  listSessionRecords(): StoredSessionRecord[] {
    return (this.db.prepare('SELECT * FROM session_records').all() as Row[]).map((r) => ({
      id: String(r.id),
      provider: String(r.provider) as 'claude' | 'codex',
      providerSessionId: String(r.provider_session_id),
      title: String(r.title),
      titleSource: String(r.title_source) as 'provider' | 'fallback',
      observedCwd: str(r.observed_cwd),
      repoId: str(r.repo_id),
      worktreeId: str(r.worktree_id),
      firstSeenAt: str(r.first_seen_at),
      lastActivityAt: str(r.last_activity_at),
    }))
  }

  // Automation rules (ADR 0008) --------------------------------------------------------------

  listRules(): AutomationRule[] {
    return (this.db.prepare('SELECT rule_json FROM automation_rules ORDER BY sort_order, id').all() as Row[]).flatMap((r) => {
      const parsed = AutomationRule.safeParse(JSON.parse(String(r.rule_json)))
      return parsed.success ? [parsed.data] : []
    })
  }

  getRule(id: string): AutomationRule | undefined {
    return this.listRules().find((r) => r.id === id)
  }

  /** Creates a rule, or updates one; the revision increases when its conditions or actions change. */
  saveRule(input: AutomationRuleInput, id?: string, now = new Date().toISOString()): AutomationRule {
    const existing = id ? this.getRule(id) : undefined
    const max = this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM automation_rules').get() as { m: number }
    const changed = !existing || JSON.stringify([existing.match, existing.conditions, existing.actions]) !== JSON.stringify([input.match, input.conditions, input.actions])
    const rule = AutomationRule.parse({
      ...input,
      id: existing?.id ?? randomUUID(),
      revision: existing ? existing.revision + (changed ? 1 : 0) : 1,
      order: existing?.order ?? max.m + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })
    this.db
      .prepare('INSERT INTO automation_rules (id, rule_json, sort_order) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET rule_json = excluded.rule_json, sort_order = excluded.sort_order')
      .run(rule.id, JSON.stringify(rule), rule.order)
    return rule
  }

  deleteRule(id: string): boolean {
    this.db.prepare('DELETE FROM automation_applied WHERE rule_id = ?').run(id)
    return this.db.prepare('DELETE FROM automation_rules WHERE id = ?').run(id).changes > 0
  }

  /** The revision of each rule last applied to each agent, keyed `ruleId|sessionId`. */
  appliedRevisions(): Map<string, number> {
    const rows = this.db.prepare('SELECT rule_id, session_id, revision FROM automation_applied').all() as Row[]
    return new Map(rows.map((r) => [`${String(r.rule_id)}|${String(r.session_id)}`, Number(r.revision)]))
  }

  recordApplied(ruleId: string, sessionId: string, revision: number, at: string): void {
    this.db
      .prepare(
        `INSERT INTO automation_applied (rule_id, session_id, revision, applied_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(rule_id, session_id) DO UPDATE SET revision = excluded.revision, applied_at = excluded.applied_at`,
      )
      .run(ruleId, sessionId, revision, at)
  }

  /** Per rule: agents its current revision was applied to, and when it last applied. */
  ruleApplicationCounts(): Map<string, { applied: number; lastAppliedAt?: string }> {
    const rows = this.db
      .prepare(
        `SELECT a.rule_id AS rule_id, COUNT(*) AS n, MAX(a.applied_at) AS last FROM automation_applied a
         JOIN automation_rules r ON r.id = a.rule_id
         WHERE a.revision = json_extract(r.rule_json, '$.revision') GROUP BY a.rule_id`,
      )
      .all() as Row[]
    return new Map(rows.map((r) => [String(r.rule_id), { applied: Number(r.n), lastAppliedAt: str(r.last) }]))
  }

  /** Rules that were applied to one agent, newest first. */
  applicationsFor(sessionId: string): AutomationApplication[] {
    const names = new Map(this.listRules().map((r) => [r.id, r.name]))
    const rows = this.db.prepare('SELECT rule_id, revision, applied_at FROM automation_applied WHERE session_id = ? ORDER BY applied_at DESC').all(sessionId) as Row[]
    return rows.flatMap((r) => {
      const name = names.get(String(r.rule_id))
      return name ? [{ ruleId: String(r.rule_id), ruleName: name, revision: Number(r.revision), appliedAt: String(r.applied_at) }] : []
    })
  }

  // Settings -------------------------------------------------------------------------------

  getSettings(): Settings {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'app'").get() as Row | undefined
    if (!row) return DEFAULT_SETTINGS
    const parsed = Settings.safeParse(mergeLoose(DEFAULT_SETTINGS, JSON.parse(String(row.value_json))))
    return parsed.success ? parsed.data : DEFAULT_SETTINGS
  }

  patchSettings(patch: SettingsPatch): Settings {
    const next = mergeSettings(this.getSettings(), patch)
    this.db
      .prepare(
        "INSERT INTO settings (key, value_json) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
      )
      .run(JSON.stringify(next))
    return next
  }
}

export function summarizeAnnotation(a: SessionAnnotation): AnnotationSummary {
  return {
    sessionId: a.sessionId,
    displayAlias: a.displayAlias,
    review: a.review,
    tags: a.tags,
    hasNote: a.note.trim().length > 0,
    note: a.note,
    checklistOpen: a.checklist.filter((i) => !i.done).length,
    checklistDone: a.checklist.filter((i) => i.done).length,
    checklist: a.checklist.map((i) => ({ id: i.id, text: i.text, done: i.done })),
    planOverrides: a.planOverrides,
    updatedAt: a.updatedAt,
  }
}

/** Deep-merge stored settings over defaults so new settings keys get defaults after upgrades. */
function mergeLoose(base: unknown, over: unknown): unknown {
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return over ?? base
  if (typeof over !== 'object' || over === null) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (k in out) out[k] = mergeLoose(out[k], v)
  }
  return out
}
