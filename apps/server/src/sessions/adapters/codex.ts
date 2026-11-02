import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { redactHome, stripNamespace } from '../../platform/paths.ts'
import type { LastMessage } from '@repobs/contracts'
import { makeExcerpt, toolExcerpt } from '../excerpt.ts'
import { JsonlCursor, scanBackward } from '../jsonl.ts'
import { codexRecordPlanEvent, PLAN_MARKERS, PlanTracker } from '../plan.ts'
import { isActivePhase, type Lifecycle, resolveState } from '../status.ts'
import { readCompressedJsonl, zstdAvailable } from '../zstd-jsonl.ts'
import { CodexStateIndex } from './codex-state.ts'
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

// OpenAI Codex adapter (observed with Codex 0.165 and 0.166 on Windows, October–November 2026; see
// docs/integrations.md). Reads, never writes:
//   <home>/sessions/YYYY/MM/DD/rollout-*.jsonl   one thread may span several rollout files
//   <home>/sessions/**/rollout-*.jsonl.zst       older rollouts, compressed by Codex (ADR 0012)
//   <home>/archived_sessions/**/rollout-*.jsonl  archived threads (historical)
//   <home>/session_index.jsonl                   thread names {id, thread_name, updated_at}
//   <home>/state_5.sqlite                        thread index, metadata columns only (ADR 0012)
// Passive logs cannot observe live approval prompts reliably; repobs does not start a Codex
// app-server and does not claim to observe independently running Codex processes.

const FULL_WALK_MS = 60_000
/** Decompression time spent per scan; the remaining compressed rollouts are read on later scans. */
export const COMPRESSED_BUDGET_MS = 2_000
const COMPRESSED_SUFFIX = '.zst'

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
  nickname?: string
  lastMessage?: LastMessage
  readonly excerpts: boolean
  /** Replays update_plan calls when plans are read (ADR 0009). */
  readonly plan?: PlanTracker

  constructor(excerpts = true, plans = false) {
    this.excerpts = excerpts
    if (plans) this.plan = new PlanTracker()
  }

  feedHead = (rec: unknown) => {
    if (isRecord(rec) && rec.type === 'session_meta') this.feed(rec)
  }

  feed = (rec: unknown) => {
    if (!isRecord(rec) || typeof rec.type !== 'string') {
      this.unrecognized++
      return
    }
    const payload = isRecord(rec.payload) ? rec.payload : undefined
    // A forked sub-agent's rollout repeats its parent's session_meta after its own (observed with
    // Codex 0.166): the first one names the file's thread; another thread's record is history.
    const metaId = rec.type === 'session_meta' ? asString(payload?.id, 128) : undefined
    if (this.threadId && metaId && metaId !== this.threadId) return
    const ts = asIso(rec.timestamp)
    if (ts) {
      this.lastTs = laterIso(this.lastTs, ts)
      this.firstTs = earlierIso(this.firstTs, ts)
    }
    if (rec.type === 'session_meta' && payload) {
      this.threadId = metaId ?? this.threadId
      this.cwd = this.cwd ?? asString(payload.cwd)
      this.version = asString(payload.cli_version, 40) ?? this.version
      const metaTs = asIso(payload.timestamp)
      if (metaTs) this.firstTs = earlierIso(this.firstTs, metaTs)
      const source = isRecord(payload.source) ? payload.source : undefined
      const spawn = isRecord(source?.subagent) && isRecord(source.subagent.thread_spawn) ? source.subagent.thread_spawn : undefined
      this.parentThreadId = asString(payload.parent_thread_id, 128) ?? asString(spawn?.parent_thread_id, 128) ?? this.parentThreadId
      const gitInfo = isRecord(payload.git) ? payload.git : undefined
      this.gitBranch = asString(gitInfo?.branch, 250) ?? this.gitBranch
      this.nickname = asString(payload.agent_nickname, 80) ?? asString(payload.agent_role, 80) ?? this.nickname
      return
    }
    if (this.excerpts && payload) this.captureExcerpt(rec.type, payload, ts)
    const planEvent = this.plan ? codexRecordPlanEvent(rec) : undefined
    if (planEvent) this.plan!.feed(planEvent)
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

  /** Latest assistant reply or tool call (ADR 0003). User and developer messages are never taken. */
  private captureExcerpt(type: string, payload: Record<string, unknown>, at: string | undefined) {
    if (type === 'event_msg' && payload.type === 'task_complete' && typeof payload.last_agent_message === 'string') {
      this.lastMessage = makeExcerpt('assistant', payload.last_agent_message, at) ?? this.lastMessage
      return
    }
    if (type !== 'response_item') return
    if (payload.type === 'message' && payload.role === 'assistant' && Array.isArray(payload.content)) {
      const text = payload.content
        .filter((c): c is Record<string, unknown> => isRecord(c) && c.type === 'output_text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join(' ')
      this.lastMessage = makeExcerpt('assistant', text, at) ?? this.lastMessage
    } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      this.lastMessage = toolExcerpt(payload.name, undefined, at) ?? this.lastMessage
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
  file: string
  /** Plain rollouts only; compressed ones are re-read whole when they change. */
  cursor?: JsonlCursor
  acc: CodexAccumulator
  statKey: string
  archived: boolean
  /** Some bytes were read. */
  read: boolean
  /** Compressed and over the decompression limit: head only. */
  tooLarge?: boolean
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
  private readonly state = new CodexStateIndex()
  /** Decompression budget per scan (tests lower it). */
  compressedBudgetMs = COMPRESSED_BUDGET_MS

  configure(config: AdapterConfig): void {
    const before = resolveCodexHome(this.config).root
    const readsBefore = `${this.config.excerpts !== false}|${this.config.plans !== false}`
    this.config = config
    if (resolveCodexHome(config).root !== before || readsBefore !== `${config.excerpts !== false}|${config.plans !== false}`) {
      this.files.clear()
      this.known.clear()
      this.titles.clear()
      this.indexCursor = undefined
      this.lastFullWalk = 0
      this.state.reset()
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
    const hasSessions = await fs.access(sessionsDir).then(
      () => true,
      () => false,
    )
    this.state.refresh(this.home.root)
    if (!hasSessions && !this.state.present) {
      this.available = false
      this.files.clear()
      this.known.clear()
      return []
    }
    this.available = true
    if (this.state.problem) this.problems.add(this.state.problem.code, this.state.problem.message)

    // Full walk occasionally; otherwise only the most recent day directories (new files land there).
    if (now - this.lastFullWalk > FULL_WALK_MS || this.known.size === 0) {
      this.known = withoutCompressedTwins([
        ...(await walkRollouts(sessionsDir, 4)),
        ...(await walkRollouts(path.join(this.home.root, 'archived_sessions'), 4)),
      ])
      this.lastFullWalk = now
    } else {
      for (const dir of recentDayDirs(sessionsDir, now)) {
        for (const f of await walkRollouts(dir, 0)) this.known.add(f)
      }
      this.known = withoutCompressedTwins(this.known)
    }
    for (const file of [...this.files.keys()]) if (!this.known.has(file)) this.files.delete(file)
    const archivedRoot = path.join(this.home.root, 'archived_sessions')
    // Plain rollouts first; compressed ones within the decompression budget, newest first.
    const ordered = [...this.known].sort((a, b) => Number(isCompressed(a)) - Number(isCompressed(b)) || b.localeCompare(a))
    const deadline = Date.now() + this.compressedBudgetMs
    let pending = 0
    for (const file of ordered) {
      let tracked = this.files.get(file)
      if (!tracked) {
        tracked = {
          file,
          cursor: isCompressed(file) ? undefined : new JsonlCursor(file),
          acc: new CodexAccumulator(this.config.excerpts !== false, this.config.plans !== false),
          statKey: '',
          archived: file.startsWith(archivedRoot),
          read: false,
        }
        this.files.set(file, tracked)
      }
      if (!tracked.cursor && Date.now() > deadline) {
        if (await this.changed(tracked)) pending++
        continue
      }
      await this.refreshFile(tracked)
    }
    if (pending > 0) this.problems.add('compressed_rollouts_pending', 'Some compressed Codex rollouts are still waiting to be read')
    await this.readIndex()

    // Group rollout files by thread id; the newest file carries the current state.
    const threads = new Map<string, TrackedFile[]>()
    for (const t of this.files.values()) {
      const id = t.acc.threadId
      if (!id) {
        if (t.acc.unrecognized > 0 || t.cursor?.position || (t.read && !t.cursor)) {
          this.problems.add('rollout_without_meta', 'A rollout file had no readable session_meta record')
        }
        continue
      }
      const list = threads.get(id) ?? []
      list.push(t)
      threads.set(id, list)
    }

    // Sub-threads are sessions of their own, linked to the parent (ADR 0003), and counted on it.
    const children = new Map<string, { total: number; active: number }>()
    const parentOf = new Map<string, string>()
    for (const [id, files] of threads) {
      const parent = files.find((f) => f.acc.parentThreadId)?.acc.parentThreadId
      if (!parent) continue
      parentOf.set(id, parent)
      const latest = newest(files)
      const c = children.get(parent) ?? { total: 0, active: 0 }
      c.total++
      const fresh = latest.acc.lastTs && now - Date.parse(latest.acc.lastTs) < this.config.staleAfterMs
      if (fresh && isActivePhase(latest.acc.lifecycle.phase)) c.active++
      children.set(parent, c)
    }
    // Threads known only from the state database (ADR 0012): counted, never active.
    const metadataOnly = [...this.state.all()].filter((t) => !threads.has(t.id))
    for (const t of metadataOnly) {
      if (!t.parentId) continue
      const c = children.get(t.parentId) ?? { total: 0, active: 0 }
      c.total++
      children.set(t.parentId, c)
    }

    const sessions: DiscoveredSession[] = []
    for (const [id, files] of threads) {
      const latest = newest(files)
      const acc = latest.acc
      const parent = parentOf.get(id)
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
        title: this.titles.get(id)?.name ?? this.state.get(id)?.name ?? (parent && acc.nickname ? `${acc.nickname} (sub-agent)` : undefined),
        cwd: acc.cwd ? stripNamespace(acc.cwd) : undefined,
        parentSessionId: parent ? `codex:${parent}` : undefined,
        agentType: parent ? acc.nickname : undefined,
        lastMessage: this.config.excerpts === false ? undefined : acc.lastMessage,
        // The newest rollout file of the thread that holds a plan.
        plan: [...files]
          .sort((a, b) => Date.parse(b.acc.lastTs ?? '') - Date.parse(a.acc.lastTs ?? ''))
          .map((f) => f.acc.plan?.plan())
          .find(Boolean),
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
    for (const t of metadataOnly) {
      sessions.push({
        id: `codex:${t.id}`,
        provider: 'codex',
        providerSessionId: t.id,
        title: this.titles.get(t.id)?.name ?? t.name ?? (t.parentId && t.nickname ? `${t.nickname} (sub-agent)` : undefined),
        cwd: t.cwd,
        parentSessionId: t.parentId ? `codex:${t.parentId}` : undefined,
        agentType: t.parentId ? t.nickname : undefined,
        firstSeenAt: t.createdAt,
        lastActivityAt: t.updatedAt,
        providerVersion: t.version,
        recordedBranch: t.branch,
        lifecycle: { phase: 'none' },
        // The last update time proves nothing about the turn: never running, idle or ended.
        state: { kind: 'unknown', confidence: 'unknown', source: 'codex.state-db', observedAt: t.updatedAt, detail: 'metadata_only' },
        live: false,
        subagents: children.get(t.id) ?? { total: 0, active: 0 },
        sourceFiles: 0,
      })
    }
    this.lastScanAt = new Date().toISOString()
    this.lastScanMs = Date.now() - started
    return sessions
  }

  /** The file changed since it was last read (or was never read). */
  private async changed(tracked: TrackedFile): Promise<boolean> {
    const key = await statKey(tracked.file)
    return key !== undefined && key !== tracked.statKey
  }

  private async refreshFile(tracked: TrackedFile) {
    if (!tracked.cursor) {
      await this.refreshCompressed(tracked)
      return
    }
    const key = await statKey(tracked.file)
    if (key === undefined || key === tracked.statKey) return
    tracked.statKey = key
    try {
      const stats = await tracked.cursor.read(tracked.acc.feed, tracked.acc.feedHead)
      tracked.read = true
      if (stats?.reset) {
        tracked.acc = new CodexAccumulator(this.config.excerpts !== false, this.config.plans !== false)
        tracked.cursor = new JsonlCursor(tracked.file)
        tracked.statKey = ''
        await this.refreshFile(tracked)
        return
      }
      // The middle of a long rollout was skipped: look back for the latest plan.
      const plan = tracked.acc.plan
      if (stats?.jumped && stats.jumpedFrom && plan && !plan.hasList()) {
        const earlier = await scanBackward(tracked.file, stats.jumpedFrom, PLAN_MARKERS, (rec) => !!codexRecordPlanEvent(rec))
        plan.prepend(earlier.flatMap((rec) => codexRecordPlanEvent(rec) ?? []))
      }
      if (stats && stats.badLines > 0) this.problems.add('bad_jsonl_lines', 'Some rollout lines were not valid JSON (partial write or unknown format)')
    } catch {
      this.problems.add('rollout_unreadable', 'A Codex rollout file could not be read')
    }
  }

  /** Compressed rollouts are not appended to: each change is a full, bounded re-read (ADR 0012). */
  private async refreshCompressed(tracked: TrackedFile) {
    if (!zstdAvailable) {
      this.problems.add('compressed_rollouts_unsupported', 'This Node.js runtime cannot read compressed Codex rollouts')
      return
    }
    const key = await statKey(tracked.file)
    if (key === undefined) return
    if (key === tracked.statKey) {
      if (tracked.tooLarge) this.problems.add('rollout_too_large', 'A compressed Codex rollout exceeded the size limit; only its metadata was read')
      return
    }
    tracked.statKey = key
    const plans = this.config.plans !== false
    const acc = new CodexAccumulator(this.config.excerpts !== false, plans)
    try {
      const stats = await readCompressedJsonl(tracked.file, acc.feed, acc.feedHead, plans ? PLAN_MARKERS : [])
      if (acc.plan && !acc.plan.hasList()) acc.plan.prepend(stats.marked.flatMap((rec) => codexRecordPlanEvent(rec) ?? []))
      tracked.acc = acc
      tracked.read = true
      tracked.tooLarge = stats.tooLarge
      if (stats.tooLarge) this.problems.add('rollout_too_large', 'A compressed Codex rollout exceeded the size limit; only its metadata was read')
      if (stats.badLines > 0) this.problems.add('bad_jsonl_lines', 'Some rollout lines were not valid JSON (partial write or unknown format)')
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
    if (e.isFile() && e.name.startsWith('rollout-') && (e.name.endsWith('.jsonl') || e.name.endsWith(`.jsonl${COMPRESSED_SUFFIX}`))) out.push(p)
    else if (e.isDirectory() && depth > 0) out.push(...(await walkRollouts(p, depth - 1)))
  }
  return out
}

const isCompressed = (file: string) => file.endsWith(COMPRESSED_SUFFIX)

/** While Codex compresses a rollout both forms exist; the plain one is read. */
function withoutCompressedTwins(files: Iterable<string>): Set<string> {
  const all = new Set(files)
  for (const f of all) if (isCompressed(f) && all.has(f.slice(0, -COMPRESSED_SUFFIX.length))) all.delete(f)
  return all
}

async function statKey(file: string): Promise<string | undefined> {
  try {
    const st = await fs.stat(file)
    return `${st.size}:${st.mtimeMs}`
  } catch {
    return undefined
  }
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
