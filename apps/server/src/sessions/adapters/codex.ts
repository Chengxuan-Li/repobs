import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { redactHome } from '../../platform/paths.ts'
import { JsonlCursor } from '../jsonl.ts'
import { isActivePhase, type Lifecycle, resolveState } from '../status.ts'
import {
  type AdapterConfig,
  type AdapterStatus,
  asIso,
  asString,
  type DiscoveredSession,
  earlierIso,
  isRecord,
  laterIso,
  ProblemLog,
  type SessionAdapter,
} from '../types.ts'

// OpenAI Codex adapter (observed with Codex 0.165 on Windows, October 2026; see
// docs/integrations.md). Reads, never writes:
//   <home>/sessions/YYYY/MM/DD/rollout-*.jsonl   one thread may span several rollout files
//   <home>/archived_sessions/**/rollout-*.jsonl  archived threads (historical)
//   <home>/session_index.jsonl                   thread names {id, thread_name, updated_at}
// Passive logs cannot observe live approval prompts reliably; repobs does not start a Codex
// app-server and does not claim to observe independently running Codex processes.

const FULL_WALK_MS = 60_000

export class CodexAccumulator {
  threadId?: string
  parentThreadId?: string
  cwd?: string
  firstTs?: string
  lastTs?: string
  version?: string
  gitBranch?: string
  lifecycle: Lifecycle = { phase: 'none' }
  unrecognized = 0

  feedHead = (rec: unknown) => {
    if (isRecord(rec) && rec.type === 'session_meta') this.feed(rec)
  }

  feed = (rec: unknown) => {
    if (!isRecord(rec) || typeof rec.type !== 'string') {
      this.unrecognized++
      return
    }
    const ts = asIso(rec.timestamp)
    if (ts) {
      this.lastTs = laterIso(this.lastTs, ts)
      this.firstTs = earlierIso(this.firstTs, ts)
    }
    const payload = isRecord(rec.payload) ? rec.payload : undefined
    if (rec.type === 'session_meta' && payload) {
      this.threadId = asString(payload.id, 128) ?? this.threadId
      this.cwd = this.cwd ?? asString(payload.cwd)
      this.version = asString(payload.cli_version, 40) ?? this.version
      const metaTs = asIso(payload.timestamp)
      if (metaTs) this.firstTs = earlierIso(this.firstTs, metaTs)
      const source = isRecord(payload.source) ? payload.source : undefined
      const spawn = isRecord(source?.subagent) && isRecord(source.subagent.thread_spawn) ? source.subagent.thread_spawn : undefined
      this.parentThreadId = asString(payload.parent_thread_id, 128) ?? asString(spawn?.parent_thread_id, 128) ?? this.parentThreadId
      const gitInfo = isRecord(payload.git) ? payload.git : undefined
      this.gitBranch = asString(gitInfo?.branch, 250) ?? this.gitBranch
      return
    }
    if (rec.type === 'turn_context' && payload) {
      this.cwd = asString(payload.cwd) ?? this.cwd
      return
    }
    if (rec.type === 'event_msg' && payload && typeof payload.type === 'string') {
      const phase = codexEventPhase(payload.type)
      if (phase) {
        this.lifecycle = { phase, at: ts ?? this.lifecycle.at }
        return
      }
    }
    // Any other activity after an approval/input request means the turn continued.
    if (
      (rec.type === 'response_item' || rec.type === 'event_msg') &&
      (this.lifecycle.phase === 'approval_requested' || this.lifecycle.phase === 'user_input_requested')
    ) {
      this.lifecycle = { phase: 'turn_in_progress', at: ts ?? this.lifecycle.at }
    }
  }
}

export function codexEventPhase(type: string): Lifecycle['phase'] | undefined {
  if (type === 'task_started' || type === 'turn_started') return 'turn_in_progress'
  if (type === 'task_complete' || type === 'turn_complete') return 'turn_completed'
  if (type === 'turn_aborted') return 'turn_aborted'
  // Not observed in local logs during development; names follow the Codex protocol. Unverified.
  if (type.endsWith('_approval_request') || type === 'approval_request') return 'approval_requested'
  if (type === 'request_user_input') return 'user_input_requested'
  if (type === 'error' || type === 'stream_error') return 'error_event'
  return undefined
}

interface TrackedFile {
  cursor: JsonlCursor
  acc: CodexAccumulator
  statKey: string
  archived: boolean
}

export function resolveCodexHome(config: Pick<AdapterConfig, 'home'>, env = process.env) {
  if (config.home) return { root: config.home, source: 'settings' as const }
  if (env.CODEX_HOME) return { root: env.CODEX_HOME, source: 'environment' as const }
  return { root: path.join(os.homedir(), '.codex'), source: 'default' as const }
}

export class CodexAdapter implements SessionAdapter {
  readonly provider = 'codex' as const
  private config: AdapterConfig = { enabled: true, home: null, staleAfterMs: 30 * 60_000 }
  private files = new Map<string, TrackedFile>()
  private known = new Set<string>()
  private lastFullWalk = 0
  private titles = new Map<string, { name: string; at: number }>()
  private indexCursor?: JsonlCursor
  private problems = new ProblemLog()
  private available = false
  private lastScanAt?: string
  private lastScanMs?: number

  configure(config: AdapterConfig): void {
    const before = resolveCodexHome(this.config).root
    this.config = config
    if (resolveCodexHome(config).root !== before) {
      this.files.clear()
      this.known.clear()
      this.titles.clear()
      this.indexCursor = undefined
      this.lastFullWalk = 0
    }
  }

  private get home() {
    return resolveCodexHome(this.config)
  }

  watchTargets(): string[] {
    if (!this.config.enabled) return []
    return [path.join(this.home.root, 'sessions'), path.join(this.home.root, 'archived_sessions')]
  }

  status(): AdapterStatus {
    return {
      provider: 'codex',
      enabled: this.config.enabled,
      available: this.available,
      root: redactHome(this.home.root),
      rootSource: this.home.source,
      filesTracked: this.files.size,
      lastScanAt: this.lastScanAt,
      lastScanMs: this.lastScanMs,
      problems: this.problems.list(),
    }
  }

  async discover(now = Date.now()): Promise<DiscoveredSession[]> {
    const started = Date.now()
    this.problems.clear()
    if (!this.config.enabled) {
      this.available = false
      return []
    }
    const sessionsDir = path.join(this.home.root, 'sessions')
    try {
      await fs.access(sessionsDir)
      this.available = true
    } catch {
      this.available = false
      this.files.clear()
      this.known.clear()
      return []
    }

    // Full walk occasionally; otherwise only the most recent day directories (new files land there).
    if (now - this.lastFullWalk > FULL_WALK_MS || this.known.size === 0) {
      this.known = new Set([
        ...(await walkRollouts(sessionsDir, 4)),
        ...(await walkRollouts(path.join(this.home.root, 'archived_sessions'), 4)),
      ])
      this.lastFullWalk = now
    } else {
      for (const dir of recentDayDirs(sessionsDir, now)) {
        for (const f of await walkRollouts(dir, 0)) this.known.add(f)
      }
    }
    for (const file of [...this.files.keys()]) if (!this.known.has(file)) this.files.delete(file)
    const archivedRoot = path.join(this.home.root, 'archived_sessions')
    for (const file of this.known) {
      let tracked = this.files.get(file)
      if (!tracked) {
        tracked = {
          cursor: new JsonlCursor(file),
          acc: new CodexAccumulator(),
          statKey: '',
          archived: file.startsWith(archivedRoot),
        }
        this.files.set(file, tracked)
      }
      await this.refreshFile(tracked)
    }
    await this.readIndex()

    // Group rollout files by thread id; the newest file carries the current state.
    const threads = new Map<string, TrackedFile[]>()
    for (const t of this.files.values()) {
      const id = t.acc.threadId
      if (!id) {
        if (t.acc.unrecognized > 0 || t.cursor.position > 0) this.problems.add('rollout_without_meta', 'A rollout file had no readable session_meta record')
        continue
      }
      const list = threads.get(id) ?? []
      list.push(t)
      threads.set(id, list)
    }

    const children = new Map<string, { total: number; active: number }>()
    const topLevel: Array<[string, TrackedFile[]]> = []
    for (const [id, files] of threads) {
      const parent = files.find((f) => f.acc.parentThreadId)?.acc.parentThreadId
      if (parent) {
        const latest = newest(files)
        const c = children.get(parent) ?? { total: 0, active: 0 }
        c.total++
        const fresh = latest.acc.lastTs && now - Date.parse(latest.acc.lastTs) < this.config.staleAfterMs
        if (fresh && isActivePhase(latest.acc.lifecycle.phase)) c.active++
        children.set(parent, c)
      } else {
        topLevel.push([id, files])
      }
    }

    const sessions: DiscoveredSession[] = []
    for (const [id, files] of topLevel) {
      const latest = newest(files)
      const acc = latest.acc
      const subagents = children.get(id) ?? { total: 0, active: 0 }
      const state = resolveState({
        source: 'codex.rollout',
        lifecycle: acc.lifecycle,
        subagentsActive: subagents.active,
        sourceAvailable: true,
        unrecognizedRecords: acc.unrecognized,
        now,
        staleAfterMs: this.config.staleAfterMs,
      })
      sessions.push({
        id: `codex:${id}`,
        provider: 'codex',
        providerSessionId: id,
        title: this.titles.get(id)?.name,
        cwd: acc.cwd,
        firstSeenAt: files.reduce<string | undefined>((m, f) => earlierIso(m, f.acc.firstTs), undefined),
        lastActivityAt: files.reduce<string | undefined>((m, f) => laterIso(m, f.acc.lastTs), undefined),
        providerVersion: acc.version,
        recordedBranch: acc.gitBranch,
        lifecycle: acc.lifecycle,
        state,
        live: false,
        subagents,
        sourceFiles: files.length,
      })
    }
    this.lastScanAt = new Date().toISOString()
    this.lastScanMs = Date.now() - started
    return sessions
  }

  private async refreshFile(tracked: TrackedFile) {
    let st: import('node:fs').Stats
    try {
      st = await fs.stat(tracked.cursor.file)
    } catch {
      return
    }
    const key = `${st.size}:${st.mtimeMs}`
    if (key === tracked.statKey) return
    tracked.statKey = key
    try {
      const stats = await tracked.cursor.read(tracked.acc.feed, tracked.acc.feedHead)
      if (stats?.reset) {
        tracked.acc = new CodexAccumulator()
        tracked.cursor = new JsonlCursor(tracked.cursor.file)
        tracked.statKey = ''
        await this.refreshFile(tracked)
        return
      }
      if (stats && stats.badLines > 0) this.problems.add('bad_jsonl_lines', 'Some rollout lines were not valid JSON (partial write or unknown format)')
    } catch {
      this.problems.add('rollout_unreadable', 'A Codex rollout file could not be read')
    }
  }

  private async readIndex() {
    const file = path.join(this.home.root, 'session_index.jsonl')
    this.indexCursor ??= new JsonlCursor(file, { tailBytes: 4 * 1024 * 1024 })
    try {
      const stats = await this.indexCursor.read((rec) => {
        if (!isRecord(rec)) return
        const id = asString(rec.id, 128)
        const name = asString(rec.thread_name, 200)
        if (!id || !name) return
        const at = Date.parse(asIso(rec.updated_at) ?? '') || 0
        const prior = this.titles.get(id)
        if (!prior || at >= prior.at) this.titles.set(id, { name, at })
      })
      if (stats?.reset) this.titles.clear()
    } catch {
      this.problems.add('index_unreadable', 'The Codex session index could not be read')
    }
  }
}

function newest(files: TrackedFile[]): TrackedFile {
  return files.reduce((a, b) => (Date.parse(b.acc.lastTs ?? '') > Date.parse(a.acc.lastTs ?? '') ? b : a))
}

async function walkRollouts(dir: string, depth: number): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(p)
    else if (e.isDirectory() && depth > 0) out.push(...(await walkRollouts(p, depth - 1)))
  }
  return out
}

function recentDayDirs(sessionsDir: string, now: number): string[] {
  const dirs = new Set<string>()
  for (const offset of [0, -1, 1]) {
    // Local and UTC dates, since rollout directories follow the local clock.
    const d = new Date(now + offset * 86_400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    dirs.add(path.join(sessionsDir, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())))
    dirs.add(path.join(sessionsDir, String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1), pad(d.getUTCDate())))
  }
  return [...dirs]
}
