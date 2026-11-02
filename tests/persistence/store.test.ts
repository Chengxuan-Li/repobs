import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@repobs/contracts'
import { MIGRATIONS, openDatabase, SCHEMA_VERSION } from '../../apps/server/src/persistence/database.ts'
import { AppStore } from '../../apps/server/src/persistence/store.ts'
import { makeTempDir, removeDir } from '../helpers/tmp.ts'

const dirs: string[] = []
const tempDb = () => {
  const d = makeTempDir('db')
  dirs.push(d)
  return path.join(d, 'repobs.db')
}
afterEach(() => {
  while (dirs.length) removeDir(dirs.pop()!)
})

const baseInput = {
  review: 'needs_review' as const,
  tags: ['ui', 'ui', ' perf '],
  note: 'Check <script>alert(1)</script> literally',
  checklist: [
    { id: 'a', text: 'Read diff', done: true, order: 0 },
    { id: 'b', text: 'Run tests', done: false, order: 1 },
  ],
}

describe('persistence', () => {
  it('creates the schema and survives reopen (restart)', () => {
    const file = tempDb()
    const first = openDatabase(file)
    expect(first.schemaVersion).toBe(SCHEMA_VERSION)
    const store = new AppStore(first.db)
    store.addRepository({
      id: 'repo_1',
      kind: 'git',
      displayName: 'A',
      registeredPath: 'C:\\a',
      primaryPath: 'C:\\a',
      commonGitDir: 'C:\\a\\.git',
      isBare: false,
    })
    store.putAnnotation('claude:s1', baseInput)
    first.db.close()

    const second = openDatabase(file)
    const store2 = new AppStore(second.db)
    expect(store2.listRepositories().map((r) => r.id)).toEqual(['repo_1'])
    const a = store2.getAnnotation('claude:s1')!
    expect(a.tags).toEqual(['ui', 'perf'])
    expect(a.note).toContain('<script>')
    expect(a.checklist[0]).toMatchObject({ done: true, completedAt: expect.any(String) })
    expect(a.checklist[1]!.completedAt).toBeUndefined()
    second.db.close()
  })

  it('keeps annotations independent per session and preserves completion timestamps', () => {
    const { db } = openDatabase(':memory:')
    const store = new AppStore(db)
    const first = store.putAnnotation('claude:s1', baseInput, '2026-10-01T00:00:00.000Z')
    store.putAnnotation('claude:s2', { ...baseInput, note: 'other', checklist: [] })
    const again = store.putAnnotation('claude:s1', baseInput, '2026-10-02T00:00:00.000Z')
    expect(again.checklist[0]!.completedAt).toBe(first.checklist[0]!.completedAt)
    expect(again.createdAt).toBe(first.createdAt)
    expect(store.getAnnotation('claude:s2')!.note).toBe('other')
  })

  it('keeps your ticks on agent plan items across edits that do not mention them', () => {
    const { db } = openDatabase(':memory:')
    const store = new AppStore(db)
    store.putAnnotation('claude:p', { ...baseInput, planOverrides: { '0123456789abcdef': true } })
    store.putAnnotation('claude:p', { ...baseInput, note: 'edited elsewhere' })
    expect(store.getAnnotation('claude:p')!.planOverrides).toEqual({ '0123456789abcdef': true })
    store.putAnnotation('claude:p', { ...baseInput, planOverrides: {} })
    expect(store.getAnnotation('claude:p')!.planOverrides).toEqual({})
    // Only keys are stored, never the agent's text.
    expect(JSON.stringify(db.prepare('SELECT plan_overrides_json FROM annotations').all())).not.toContain('Read diff')
  })

  it('unregistering a repository keeps annotations and session records', () => {
    const { db } = openDatabase(':memory:')
    const store = new AppStore(db)
    store.addRepository({ id: 'r', kind: 'git', displayName: 'r', registeredPath: 'C:\\r', primaryPath: 'C:\\r', commonGitDir: 'C:\\r\\.git', isBare: false })
    store.putAnnotation('codex:t', baseInput)
    store.upsertSessionRecord({ id: 'codex:t', provider: 'codex', providerSessionId: 't', title: 'T', titleSource: 'provider', repoId: 'r' })
    expect(store.removeRepository('r')).toBe(true)
    expect(store.getAnnotation('codex:t')).toBeDefined()
    expect(store.listSessionRecords()).toHaveLength(1)
  })

  it('reorders repositories', () => {
    const { db } = openDatabase(':memory:')
    const store = new AppStore(db)
    for (const id of ['a', 'b', 'c']) {
      store.addRepository({ id, kind: 'git', displayName: id, registeredPath: id, primaryPath: id, commonGitDir: id, isBare: false })
    }
    store.reorderRepositories(['c', 'a'])
    expect(store.listRepositories().map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('merges settings patches over defaults', () => {
    const { db } = openDatabase(':memory:')
    const store = new AppStore(db)
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS)
    const next = store.patchSettings({ theme: 'dark', github: { enabled: true } })
    expect(next.theme).toBe('dark')
    expect(next.github).toEqual({ enabled: true, pollMinutes: DEFAULT_SETTINGS.github.pollMinutes })
    expect(store.getSettings().adapters).toEqual(DEFAULT_SETTINGS.adapters)
  })

  it('backs up the database before applying a new migration', () => {
    const file = tempDb()
    openDatabase(file, MIGRATIONS).db.close()
    const extra = [...MIGRATIONS, { version: SCHEMA_VERSION + 1, name: 'test', sql: 'CREATE TABLE extra (x);' }]
    const upgraded = openDatabase(file, extra)
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION + 1)
    expect(upgraded.backups).toHaveLength(1)
    expect(fs.existsSync(upgraded.backups[0]!)).toBe(true)
    upgraded.db.close()
  })

  it('migrates v3 repositories to Git registrations and stores folders without a Git directory (ADR 0010)', () => {
    const file = tempDb()
    const v3 = openDatabase(file, MIGRATIONS.filter((m) => m.version <= 3))
    v3.db
      .prepare(
        `INSERT INTO repositories (id, display_name, registered_path, primary_path, common_git_dir, is_bare, sort_order, added_at)
         VALUES ('repo_1', 'A', 'C:\\a', 'C:\\a', 'C:\\a\\.git', 0, 0, 'x')`,
      )
      .run()
    v3.db.close()
    const upgraded = openDatabase(file)
    expect(upgraded.schemaVersion).toBe(SCHEMA_VERSION)
    expect(upgraded.backups).toHaveLength(1)
    const store = new AppStore(upgraded.db)
    store.addRepository({ id: 'folder_1', kind: 'folder', displayName: 'notes', registeredPath: 'C:\\notes', primaryPath: 'C:\\notes', commonGitDir: '', isBare: false })
    expect(store.listRepositories().map((r) => [r.id, r.kind, r.commonGitDir])).toEqual([
      ['repo_1', 'git', 'C:\\a\\.git'],
      ['folder_1', 'folder', ''],
    ])
    upgraded.db.close()
  })

  it('refuses a database from a newer schema instead of corrupting it', () => {
    const file = tempDb()
    const { db } = openDatabase(file)
    db.exec('PRAGMA user_version = 999')
    db.close()
    expect(() => openDatabase(file)).toThrow(/newer/)
  })

  it('moves a corrupt database aside, starts fresh and discloses it', () => {
    const file = tempDb()
    fs.writeFileSync(file, 'this is not a sqlite database at all, just garbage bytes '.repeat(200))
    const opened = openDatabase(file)
    expect(opened.recoveredFromCorruption).toMatch(/\.corrupt-/)
    expect(fs.existsSync(opened.recoveredFromCorruption!)).toBe(true)
    expect(new AppStore(opened.db).listRepositories()).toEqual([])
    opened.db.close()
  })
})
