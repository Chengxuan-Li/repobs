import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { redactHome } from '../../platform/paths.ts'
import { JsonlCursor, readSmallJson } from '../jsonl.ts'
import { isActivePhase, type Lifecycle, type RegistryEvidence, resolveState } from '../status.ts'
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

// Claude Code adapter (observed with Claude Code 2.1.x on Windows, October 2026; see
// docs/integrations.md). Reads, never writes:
//   <home>/projects/<encoded-cwd>/<session-id>.jsonl          transcript (head/tail/appends only)
//   <home>/projects/<encoded-cwd>/<session-id>/subagents/*.jsonl  subagent transcripts (tail only)
//   <home>/sessions/<pid>.json                                live-process registry (status idle|busy)
// The directory name is never decoded into a path; cwd comes from the records themselves.
// Only structural fields are extracted; message content is never stored.

const INTERRUPT_MARKER = '[Request interrupted by user'
const SUBAGENT_ACTIVE_MS = 3 * 60_000

export class ClaudeAccumulator {
  sessionId?: string
  cwd?: string
  firstTs?: string
  lastTs?: string
  title?: string
  agentName?: string
  version?: string
  gitBranch?: string
  lifecycle: Lifecycle = { phase: 'none' }
  unrecognized = 0

  feedHead = (rec: unknown) => {
    if (!isRecord(rec)) return
    const ts = asIso(rec.timestamp)
    if (ts) this.firstTs = earlierIso(this.firstTs, ts)
    if (!this.sessionId) this.sessionId = asString(rec.sessionId, 128)
    if (!this.cwd) this.cwd = asString(rec.cwd)
  }

  feed = (rec: unknown) => {
    if (!isRecord(rec) || typeof rec.type !== 'string') {
      this.unrecognized++
      return
    }
    const ts = asIso(rec.timestamp)
    const sid = asString(rec.sessionId, 128)
    if (sid && !this.sessionId) this.sessionId = sid
    switch (rec.type) {
      case 'custom-title':
        this.title = asString(rec.customTitle, 200) ?? this.title
        return
      case 'agent-name':
        this.agentName = asString(rec.agentName, 200) ?? this.agentName
        return
      case 'relocated':
        this.cwd = asString(rec.relocatedCwd) ?? this.cwd
        return
      case 'user':
      case 'assistant':
      case 'system':
      case 'attachment':
        break
      default:
        // Metadata records (mode, cost-state, file-history-*, ...) carry no lifecycle meaning.
        return
    }
    if (ts) {
      this.lastTs = laterIso(this.lastTs, ts)
      this.firstTs = earlierIso(this.firstTs, ts)
    }
    this.cwd = asString(rec.cwd) ?? this.cwd
    this.version = asString(rec.version, 40) ?? this.version
    this.gitBranch = asString(rec.gitBranch, 250) ?? this.gitBranch
    if (rec.isSidechain === true) return
    const phase = claudePhase(rec)
    if (phase) this.lifecycle = { phase, at: ts ?? this.lifecycle.at }
  }
}

function claudePhase(rec: Record<string, unknown>): Lifecycle['phase'] | undefined {
  const message = isRecord(rec.message) ? rec.message : undefined
  if (rec.type === 'assistant') {
    const stop = message?.stop_reason
    if (stop === 'tool_use') return 'tool_pending'
    if (stop === 'end_turn' || stop === 'stop_sequence' || stop === 'max_tokens' || stop === 'refusal') return 'turn_completed'
    return 'turn_in_progress'
  }
  if (rec.type === 'user') {
    if (rec.isMeta === true || rec.isCompactSummary === true || rec.isVisibleInTranscriptOnly === true) return undefined
    const content = message?.content
    if (Array.isArray(content) && content.some((c) => isRecord(c) && c.type === 'tool_result')) return 'turn_in_progress'
    if (isInterruptMarker(content)) return 'turn_aborted'
    return 'turn_in_progress'
  }
  if (rec.type === 'system' && rec.subtype === 'stop_hook_summary') return 'turn_completed'
  return undefined
}

/** Compares against Claude Code's fixed interrupt marker without retaining any content. */
function isInterruptMarker(content: unknown): boolean {
  if (typeof content === 'string') return content.startsWith(INTERRUPT_MARKER)
  if (Array.isArray(content) && content.length === 1 && isRecord(content[0])) {
    const text = content[0].text
    return typeof text === 'string' && text.startsWith(INTERRUPT_MARKER)
  }
  return false
}

interface TrackedFile {
  cursor: JsonlCursor
  acc: ClaudeAccumulator
  statKey: string
}

interface SubagentFile {
  cursor: JsonlCursor
  acc: ClaudeAccumulator
  statKey: string
  mtimeMs: number
}

export interface ClaudeRegistryEntry {
  sessionId: string
  status: string
  name?: string
  cwd?: string
  alive: boolean | undefined
  statusAt?: string
}

export function resolveClaudeHome(config: Pick<AdapterConfig, 'home'>, env = process.env) {
  if (config.home) return { root: config.home, source: 'settings' as const }
  if (env.CLAUDE_CONFIG_DIR) return { root: env.CLAUDE_CONFIG_DIR, source: 'environment' as const }
  return { root: path.join(os.homedir(), '.claude'), source: 'default' as const }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class ClaudeAdapter implements SessionAdapter {
  readonly provider = 'claude' as const
  private config: AdapterConfig = { enabled: true, home: null, staleAfterMs: 30 * 60_000 }
  private files = new Map<string, TrackedFile>()
  private subagentFiles = new Map<string, SubagentFile>()
  private problems = new ProblemLog()
  private lastScanAt?: string
  private lastScanMs?: number
  private available = false
  private registryCount = 0
  private readonly hostDomain = `${process.platform}:${os.hostname()}`.toLowerCase()
  private readonly pidAlive: (pid: number) => boolean

  constructor(options: { pidAlive?: (pid: number) => boolean } = {}) {
    this.pidAlive = options.pidAlive ?? isPidAlive
  }

  configure(config: AdapterConfig): void {
    const before = resolveClaudeHome(this.config).root
    this.config = config
    if (resolveClaudeHome(config).root !== before) {
      this.files.clear()
      this.subagentFiles.clear()
    }
  }

  private get home() {
    return resolveClaudeHome(this.config)
  }

  watchTargets(): string[] {
    if (!this.config.enabled) return []
    return [path.join(this.home.root, 'projects'), path.join(this.home.root, 'sessions')]
  }

  status(): AdapterStatus {
    return {
      provider: 'claude',
      enabled: this.config.enabled,
      available: this.available,
      root: redactHome(this.home.root),
      rootSource: this.home.source,
      filesTracked: this.files.size,
      liveRegistryEntries: this.registryCount,
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
    const projectsDir = path.join(this.home.root, 'projects')
    let projectDirs: string[]
    try {
      projectDirs = (await fs.readdir(projectsDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => path.join(projectsDir, d.name))
      this.available = true
    } catch (err) {
      this.available = false
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') this.problems.add('projects_unreadable', `Cannot read the Claude projects directory (${code})`)
      this.files.clear()
      return []
    }

    const seen = new Set<string>()
    const subagentDirs = new Map<string, string>()
    for (const dir of projectDirs) {
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        this.problems.add('project_unreadable', 'A Claude project directory could not be read')
        continue
      }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.jsonl')) seen.add(path.join(dir, e.name))
        else if (e.isDirectory()) subagentDirs.set(e.name, path.join(dir, e.name, 'subagents'))
      }
    }
    for (const file of [...this.files.keys()]) if (!seen.has(file)) this.files.delete(file)

    for (const file of seen) {
      let tracked = this.files.get(file)
      if (!tracked) {
        tracked = { cursor: new JsonlCursor(file), acc: new ClaudeAccumulator(), statKey: '' }
        this.files.set(file, tracked)
      }
      await this.refreshFile(tracked)
    }

    const registry = await this.readRegistry()
    const sessions = new Map<string, DiscoveredSession>()
    for (const tracked of this.files.values()) {
      const acc = tracked.acc
      const sid = acc.sessionId ?? path.basename(tracked.cursor.file, '.jsonl')
      const subagents = await this.subagentActivity(subagentDirs.get(sid), now)
      const reg = registry.get(sid)
      const regEvidence: RegistryEvidence | undefined = reg
        ? { status: reg.status, alive: reg.alive, statusAt: reg.statusAt }
        : undefined
      const state = resolveState({
        source: 'claude.transcript',
        registrySource: 'claude.session-registry',
        lifecycle: acc.lifecycle,
        registry: regEvidence,
        subagentsActive: subagents.active,
        sourceAvailable: true,
        unrecognizedRecords: acc.unrecognized,
        now,
        staleAfterMs: this.config.staleAfterMs,
      })
      const title = reg?.name ?? acc.title ?? acc.agentName
      const session: DiscoveredSession = {
        id: `claude:${sid}`,
        provider: 'claude',
        providerSessionId: sid,
        title,
        cwd: acc.cwd ?? reg?.cwd,
        firstSeenAt: acc.firstTs,
        lastActivityAt: laterIso(acc.lastTs, reg?.alive ? reg.statusAt : undefined),
        providerVersion: acc.version,
        recordedBranch: acc.gitBranch,
        lifecycle: acc.lifecycle,
        state,
        live: reg?.alive === true,
        subagents,
        sourceFiles: 1,
      }
      const prior = sessions.get(session.id)
      // The same session id in two project directories (e.g. after relocation): keep the newest.
      if (!prior || Date.parse(session.lastActivityAt ?? '') > Date.parse(prior.lastActivityAt ?? '')) {
        sessions.set(session.id, { ...session, sourceFiles: (prior?.sourceFiles ?? 0) + 1 })
      }
    }
    this.lastScanAt = new Date().toISOString()
    this.lastScanMs = Date.now() - started
    return [...sessions.values()]
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
        // File replaced or truncated: rebuild the accumulator from scratch on the next read.
        tracked.acc = new ClaudeAccumulator()
        tracked.cursor = new JsonlCursor(tracked.cursor.file)
        tracked.statKey = ''
        await this.refreshFile(tracked)
        return
      }
      if (stats && stats.badLines > 0) this.problems.add('bad_jsonl_lines', 'Some transcript lines were not valid JSON (partial write or unknown format)')
      if (stats && stats.skippedLongLines > 0) this.problems.add('long_lines_skipped', 'Very long transcript lines were skipped')
    } catch {
      this.problems.add('transcript_unreadable', 'A Claude transcript could not be read')
    }
  }

  private async subagentActivity(dir: string | undefined, now: number) {
    if (!dir) return { total: 0, active: 0 }
    let names: string[]
    try {
      names = (await fs.readdir(dir)).filter((n) => n.endsWith('.jsonl'))
    } catch {
      return { total: 0, active: 0 }
    }
    let active = 0
    for (const name of names) {
      const file = path.join(dir, name)
      let st: import('node:fs').Stats
      try {
        st = await fs.stat(file)
      } catch {
        continue
      }
      // Only recently written subagent logs are read (tail only) to decide whether they are still working.
      if (now - st.mtimeMs > SUBAGENT_ACTIVE_MS) {
        this.subagentFiles.delete(file)
        continue
      }
      let sub = this.subagentFiles.get(file)
      if (!sub) {
        sub = { cursor: new JsonlCursor(file, { tailBytes: 64 * 1024 }), acc: new ClaudeAccumulator(), statKey: '', mtimeMs: 0 }
        this.subagentFiles.set(file, sub)
      }
      const key = `${st.size}:${st.mtimeMs}`
      if (key !== sub.statKey) {
        sub.statKey = key
        sub.mtimeMs = st.mtimeMs
        const acc = sub.acc
        await sub.cursor.read((rec) => {
          // Subagent records are sidechain records; evaluate them as their own lifecycle.
          if (isRecord(rec)) acc.feed({ ...rec, isSidechain: false })
        }).catch(() => undefined)
      }
      if (isActivePhase(sub.acc.lifecycle.phase)) active++
    }
    return { total: names.length, active }
  }

  private async readRegistry(): Promise<Map<string, ClaudeRegistryEntry>> {
    const dir = path.join(this.home.root, 'sessions')
    const result = new Map<string, ClaudeRegistryEntry>()
    let names: string[]
    try {
      // Only *.json; the registry directory also holds *.key secrets, which are never opened.
      names = (await fs.readdir(dir)).filter((n) => /^\d+\.json$/.test(n))
    } catch {
      this.registryCount = 0
      return result
    }
    for (const name of names) {
      try {
        const raw = await readSmallJson(path.join(dir, name))
        if (!isRecord(raw)) continue
        const sessionId = asString(raw.sessionId, 128)
        const pid = typeof raw.pid === 'number' ? raw.pid : undefined
        if (!sessionId || !pid) continue
        const domain = typeof raw.pidDomain === 'string' ? raw.pidDomain.toLowerCase() : undefined
        const alive = domain && domain !== this.hostDomain ? undefined : this.pidAlive(pid)
        const entry: ClaudeRegistryEntry = {
          sessionId,
          status: asString(raw.status, 32) ?? 'unknown',
          name: asString(raw.name, 200),
          cwd: asString(raw.cwd),
          alive,
          statusAt: asIso(raw.statusUpdatedAt) ?? asIso(raw.updatedAt),
        }
        const prior = result.get(sessionId)
        if (!prior || (entry.alive && !prior.alive)) result.set(sessionId, entry)
      } catch {
        this.problems.add('registry_unreadable', 'A Claude session registry entry could not be read')
      }
    }
    this.registryCount = result.size
    return result
  }
}
