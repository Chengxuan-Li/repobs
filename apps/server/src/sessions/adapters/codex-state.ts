import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { stripNamespace } from '../../platform/paths.ts'
import { asIso, asString, isRecord } from '../types.ts'

// Codex's thread index, `<home>/state_5.sqlite` (observed with Codex 0.166, ADR 0012). Read-only,
// metadata columns only: the query names its columns and never selects `title`,
// `first_user_message` or `preview`, which hold prompt text. Opening never creates files in the
// Codex home and never takes a lock that could block Codex:
//   - only WAL databases are read (a rollback-journal reader would hold a shared file lock);
//   - when Codex has the database open (both -wal and -shm exist): `mode=ro`, an ordinary reader;
//   - otherwise `immutable=1` (no companion files, no locks), discarded if the file changed meanwhile.

export const STATE_DB_GENERATION = 5
const STATE_DB_PATTERN = /^state_(\d+)\.sqlite$/
const MAX_THREADS = 20_000

/** Columns repobs may read from `threads`. Prompt-bearing columns are deliberately absent. */
const THREAD_COLUMNS = [
  'id',
  'cwd',
  'name',
  'created_at_ms',
  'updated_at_ms',
  'created_at',
  'updated_at',
  'source',
  'git_branch',
  'cli_version',
  'agent_nickname',
  'agent_role',
] as const
const REQUIRED_COLUMNS = ['id', 'cwd']

export interface CodexThreadMeta {
  id: string
  cwd?: string
  name?: string
  createdAt?: string
  updatedAt?: string
  parentId?: string
  nickname?: string
  branch?: string
  version?: string
}

export interface StateDbProblem {
  code: 'state_db_unsupported' | 'state_db_unrecognized' | 'state_db_unreadable'
  message: string
}

const PROBLEMS = {
  generation: { code: 'state_db_unsupported', message: 'A Codex state database of an unsupported generation was found and not read' },
  journal: { code: 'state_db_unsupported', message: 'The Codex state database is not in WAL mode and was not opened' },
  columns: { code: 'state_db_unrecognized', message: 'The Codex state database has an unrecognized thread table' },
  unreadable: { code: 'state_db_unreadable', message: 'The Codex state database could not be read' },
} satisfies Record<string, StateDbProblem>

export type StateDbOpenMode = 'ro' | 'immutable'

export class CodexStateIndex {
  private key = ''
  private threads = new Map<string, CodexThreadMeta>()
  /** Problem from the latest attempt, if any. */
  problem?: StateDbProblem
  /** How the database was last opened (tests and diagnostics). */
  lastMode?: StateDbOpenMode
  /** The database file exists (any generation). */
  present = false

  get(id: string): CodexThreadMeta | undefined {
    return this.threads.get(id)
  }

  all(): IterableIterator<CodexThreadMeta> {
    return this.threads.values()
  }

  get size(): number {
    return this.threads.size
  }

  reset() {
    this.key = ''
    this.threads.clear()
    this.problem = undefined
    this.lastMode = undefined
    this.present = false
  }

  /** Re-read the index when the database or its companion files changed. Never throws. */
  refresh(home: string): void {
    let generations: number[]
    try {
      generations = fs
        .readdirSync(home)
        .map((n) => STATE_DB_PATTERN.exec(n)?.[1])
        .filter((g): g is string => g !== undefined)
        .map(Number)
    } catch {
      generations = []
    }
    this.present = generations.length > 0
    if (!generations.length) {
      // Codex 0.165 and earlier, or a Codex home without a database: rollouts only.
      this.reset()
      return
    }
    if (Math.max(...generations) !== STATE_DB_GENERATION) {
      this.threads.clear()
      this.key = ''
      this.problem = PROBLEMS.generation
      return
    }
    const file = path.join(home, `state_${STATE_DB_GENERATION}.sqlite`)
    const before = fileState(file)
    if (!before) return
    if (before.key === this.key) return
    if (!isWalDatabase(file)) {
      this.threads.clear()
      this.key = before.key
      this.problem = PROBLEMS.journal
      return
    }
    const mode: StateDbOpenMode = before.wal && before.shm ? 'ro' : 'immutable'
    let rows: CodexThreadMeta[] | 'columns'
    try {
      rows = readThreads(file, mode)
    } catch {
      // Busy, locked or corrupt: keep the last good snapshot and retry on the next change.
      this.problem = PROBLEMS.unreadable
      this.key = before.key
      return
    }
    // An immutable read is only valid when nothing changed while it ran.
    if (mode === 'immutable' && fileState(file)?.key !== before.key) return
    this.key = before.key
    this.lastMode = mode
    if (rows === 'columns') {
      this.threads.clear()
      this.problem = PROBLEMS.columns
      return
    }
    this.problem = undefined
    this.threads = new Map(rows.map((r) => [r.id, r]))
  }
}

interface FileState {
  key: string
  wal: boolean
  shm: boolean
}

function fileState(file: string): FileState | undefined {
  const stat = (p: string) => {
    try {
      return fs.statSync(p)
    } catch {
      return undefined
    }
  }
  const db = stat(file)
  if (!db) return undefined
  const wal = stat(`${file}-wal`)
  const shm = stat(`${file}-shm`)
  return {
    key: `${db.size}:${db.mtimeMs}|${wal ? `${wal.size}:${wal.mtimeMs}` : '-'}|${shm ? 'shm' : '-'}`,
    wal: !!wal,
    shm: !!shm,
  }
}

/** SQLite header: bytes 18 and 19 (file format write/read version) are 2 in WAL mode. */
export function isWalDatabase(file: string): boolean {
  const header = Buffer.alloc(20)
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    if (fs.readSync(fd, header, 0, 20, 0) < 20) return false
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  return header.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000' && header[18] === 2 && header[19] === 2
}

function readThreads(file: string, mode: StateDbOpenMode): CodexThreadMeta[] | 'columns' {
  const url = pathToFileURL(file)
  if (mode === 'ro') url.searchParams.set('mode', 'ro')
  else url.searchParams.set('immutable', '1')
  const db = new DatabaseSync(url, { readOnly: true, timeout: 50 })
  try {
    const present = new Set(
      (db.prepare('SELECT name FROM pragma_table_info(?)').all('threads') as Array<{ name: unknown }>).map((c) => String(c.name)),
    )
    if (!REQUIRED_COLUMNS.every((c) => present.has(c))) return 'columns'
    const cols = THREAD_COLUMNS.filter((c) => present.has(c))
    const rows = db.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM threads LIMIT ${MAX_THREADS}`).all() as Array<Record<string, unknown>>
    const parents = new Map<string, string>()
    const hasEdges = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_spawn_edges'").get()
    if (hasEdges) {
      for (const e of db.prepare(`SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges LIMIT ${MAX_THREADS}`).all() as Array<Record<string, unknown>>) {
        const child = asString(e.child_thread_id, 128)
        const parent = asString(e.parent_thread_id, 128)
        if (child && parent) parents.set(child, parent)
      }
    }
    const out: CodexThreadMeta[] = []
    for (const r of rows) {
      const id = asString(r.id, 128)
      if (!id) continue
      const cwd = asString(r.cwd)
      out.push({
        id,
        cwd: cwd ? stripNamespace(cwd) : undefined,
        name: asString(r.name, 200),
        createdAt: msIso(r.created_at_ms) ?? secondsIso(r.created_at),
        updatedAt: msIso(r.updated_at_ms) ?? secondsIso(r.updated_at),
        parentId: spawnParent(r.source) ?? parents.get(id),
        nickname: asString(r.agent_nickname, 80) ?? asString(r.agent_role, 80),
        branch: asString(r.git_branch, 250),
        version: asString(r.cli_version, 40),
      })
    }
    return out
  } finally {
    db.close()
  }
}

const msIso = (v: unknown) => asIso(typeof v === 'bigint' ? Number(v) : v)
const secondsIso = (v: unknown) => {
  const n = typeof v === 'bigint' ? Number(v) : v
  return typeof n === 'number' && n > 1e9 && n < 1e11 ? asIso(n * 1000) : undefined
}

/** `source` is a plain token ("vscode", "exec") or JSON such as {"subagent":{"thread_spawn":{…}}}. */
function spawnParent(source: unknown): string | undefined {
  if (typeof source !== 'string' || !source.startsWith('{') || source.length > 64 * 1024) return undefined
  try {
    const s: unknown = JSON.parse(source)
    if (!isRecord(s) || !isRecord(s.subagent) || !isRecord(s.subagent.thread_spawn)) return undefined
    return asString(s.subagent.thread_spawn.parent_thread_id, 128)
  } catch {
    return undefined
  }
}
