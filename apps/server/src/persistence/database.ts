import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// App-owned SQLite database (node:sqlite, Node 24). See docs/decisions/0003-persistence-node-sqlite.md.
// Migrations are forward-only and versioned; before applying any migration to an existing
// database we copy the file to <name>.bak-v<from>-<timestamp> so an upgrade can be undone.

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
      CREATE TABLE repositories (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        registered_path TEXT NOT NULL,
        primary_path TEXT NOT NULL,
        common_git_dir TEXT NOT NULL,
        is_bare INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        added_at TEXT NOT NULL
      );
      CREATE TABLE annotations (
        session_id TEXT PRIMARY KEY,
        display_alias TEXT,
        review TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        note TEXT NOT NULL,
        checklist_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE session_records (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        title_source TEXT NOT NULL,
        observed_cwd TEXT,
        repo_id TEXT,
        worktree_id TEXT,
        first_seen_at TEXT,
        last_activity_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'automation rules',
    sql: `
      CREATE TABLE automation_rules (
        id TEXT PRIMARY KEY,
        rule_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );
      CREATE TABLE automation_applied (
        rule_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (rule_id, session_id)
      );
    `,
  },
  {
    version: 3,
    name: 'agent plan overrides',
    sql: `ALTER TABLE annotations ADD COLUMN plan_overrides_json TEXT NOT NULL DEFAULT '{}';`,
  },
]

export const SCHEMA_VERSION = MIGRATIONS.at(-1)!.version

export interface OpenedDatabase {
  db: DatabaseSync
  path: string
  schemaVersion: number
  /** Set when a corrupt database was moved aside and a new one created. */
  recoveredFromCorruption?: string
  backups: string[]
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

function checkIntegrity(db: DatabaseSync): boolean {
  const row = db.prepare('PRAGMA quick_check').get() as Record<string, string> | undefined
  return !!row && Object.values(row)[0] === 'ok'
}

export function openDatabase(file: string, migrations: Migration[] = MIGRATIONS): OpenedDatabase {
  const memory = file === ':memory:'
  if (!memory) fs.mkdirSync(path.dirname(file), { recursive: true })
  let recoveredFromCorruption: string | undefined
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file)
    if (!memory && !checkIntegrity(db)) throw new Error('integrity check failed')
  } catch (err) {
    if (memory) throw err
    // Keep the damaged file for inspection, start fresh, and disclose it in diagnostics.
    try {
      db?.close()
    } catch {
      // already closed
    }
    const aside = `${file}.corrupt-${stamp()}`
    fs.renameSync(file, aside)
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, aside + suffix)
    }
    recoveredFromCorruption = aside
    db = new DatabaseSync(file)
  }
  return migrate(db, file, migrations, recoveredFromCorruption)
}

function migrate(db: DatabaseSync, file: string, migrations: Migration[], recoveredFromCorruption?: string): OpenedDatabase {
  const memory = file === ':memory:'
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;')

  const backups: string[] = []
  const current = userVersion(db)
  const latest = migrations.at(-1)?.version ?? 0
  if (current > latest) {
    db.close()
    throw new Error(
      `The repobs database schema (v${current}) is newer than this version of repobs supports (v${latest}). ` +
        'Use a newer repobs or restore a backup.',
    )
  }
  const pending = migrations.filter((m) => m.version > current)
  if (pending.length > 0 && current > 0 && !memory) {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const backup = `${file}.bak-v${current}-${stamp()}`
    fs.copyFileSync(file, backup)
    backups.push(backup)
  }
  for (const m of pending) {
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.version}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`, { cause: err })
    }
  }
  return { db, path: file, schemaVersion: userVersion(db), recoveredFromCorruption, backups }
}
