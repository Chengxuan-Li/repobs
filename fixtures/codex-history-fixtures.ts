import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import zlib from 'node:zlib'

// Synthetic Codex 0.166 history (ADR 0012): zstd-compressed rollouts and a `state_5.sqlite` thread
// index shaped like the observed schema (a subset of its columns, with the observed names and
// types). Every value is a placeholder; prompt-bearing columns carry a canary that tests assert
// never reaches repobs output.

export const PROMPT_CANARY = 'CANARY-PROMPT-TEXT-never-read'

/** Write records as `<file>.zst`, the way Codex compresses an older rollout next to where it was. */
export function writeCompressedRollout(file: string, records: unknown[]): string {
  const target = `${file}.zst`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, zlib.zstdCompressSync(Buffer.from(records.map((r) => JSON.stringify(r) + '\n').join(''))))
  return target
}

export interface ThreadRowInput {
  id: string
  cwd: string
  createdAt: number
  updatedAt: number
  name?: string | null
  /** A plain token ("vscode", "exec") or a JSON object, stored as Codex stores it. */
  source?: string | Record<string, unknown>
  branch?: string | null
  nickname?: string | null
  role?: string | null
  rolloutPath?: string
}

/** Columns as observed in Codex 0.166 (subset). */
const THREADS_DDL = `
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    git_branch TEXT,
    cli_version TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    agent_nickname TEXT,
    agent_role TEXT,
    created_at_ms INTEGER,
    updated_at_ms INTEGER,
    preview TEXT NOT NULL DEFAULT '',
    history_mode TEXT NOT NULL DEFAULT 'legacy',
    name TEXT
  );
  CREATE TABLE thread_spawn_edges (
    parent_thread_id TEXT NOT NULL,
    child_thread_id TEXT NOT NULL PRIMARY KEY,
    status TEXT NOT NULL
  );`

export interface StateDbOptions {
  /** Journal mode; Codex 0.166 uses WAL. */
  journal?: 'wal' | 'delete'
  generation?: number
  edges?: Array<{ parent: string; child: string }>
  /** Replace the thread table DDL (unrecognized schemas). */
  ddl?: string
}

export function codexStateDbPath(home: string, generation = 5) {
  return path.join(home, `state_${generation}.sqlite`)
}

/** Create the database and close it, as Codex leaves it between uses (no -wal or -shm file). */
export function writeCodexStateDb(home: string, rows: ThreadRowInput[], options: StateDbOptions = {}): string {
  fs.mkdirSync(home, { recursive: true })
  const file = codexStateDbPath(home, options.generation)
  const db = new DatabaseSync(file)
  try {
    db.exec(`PRAGMA journal_mode = ${options.journal ?? 'wal'}`)
    db.exec(options.ddl ?? THREADS_DDL)
    if (!options.ddl) {
      insertThreads(db, rows)
      const edge = db.prepare("INSERT INTO thread_spawn_edges VALUES (?, ?, 'open')")
      for (const e of options.edges ?? []) edge.run(e.parent, e.child)
    }
  } finally {
    db.close()
  }
  return file
}

export function insertThreads(db: DatabaseSync, rows: ThreadRowInput[]) {
  const insert = db.prepare(`
    INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, git_branch,
      cli_version, first_user_message, agent_nickname, agent_role, created_at_ms, updated_at_ms, preview, name)
    VALUES (?, ?, ?, ?, ?, 'openai', ?, ?, ?, '0.166.0', ?, ?, ?, ?, ?, ?, ?)`)
  for (const r of rows) {
    const source = typeof r.source === 'object' ? JSON.stringify(r.source) : (r.source ?? 'vscode')
    insert.run(
      r.id,
      r.rolloutPath ?? `\\\\?\\C:\\synthetic\\.codex\\sessions\\rollout-${r.id}.jsonl`,
      Math.floor(r.createdAt / 1000),
      Math.floor(r.updatedAt / 1000),
      source,
      r.cwd,
      PROMPT_CANARY,
      r.branch ?? null,
      PROMPT_CANARY,
      r.nickname ?? null,
      r.role ?? null,
      r.createdAt,
      r.updatedAt,
      PROMPT_CANARY,
      r.name ?? null,
    )
  }
}

/** Keep the database open as a running Codex does: WAL mode, no automatic checkpoint. */
export function openCodexStateDbWriter(home: string): DatabaseSync {
  const db = new DatabaseSync(codexStateDbPath(home))
  db.exec('PRAGMA wal_autocheckpoint = 0')
  return db
}
