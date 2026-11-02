import { EventEmitter } from 'node:events'
import path from 'node:path'
import {
  type AgentSession,
  type AnnotationInput,
  type AnnotationSummary,
  type AutomationPreview,
  type AutomationRule,
  type AutomationRuleStatus,
  type BranchRef,
  type CommitGraph,
  type ErrorInfo,
  type MonitorHealth,
  type PullRequest,
  type PullRequestStatus,
  type Repository,
  type RepositorySuggestion,
  type SessionAnnotation,
  type Settings,
  type Snapshot,
  type SnapshotDiff,
  type Worktree,
} from '@repobs/contracts'
import { type AgentFacts, annotationChanged, applyActions, ruleMatches, toInput } from '../automation/engine.ts'
import type { GitRunner } from '../git/exec.ts'
import { GitError } from '../git/exec.ts'
import { checkFolderPath, folderIdFor, folderInRepository, folderWorktree, resolveFolder } from '../git/folder.ts'
import { fetchPullRequests, type GhOptions } from '../git/pulls.ts'
import {
  repositoryIdFor,
  resolveRepository,
  scanCommitGraph,
  scanRepository,
  scanWorktreeStatus,
  toErrorInfo,
  worktreeGitDir,
} from '../git/reader.ts'
import type { AppStore, StoredRepository, StoredSessionRecord } from '../persistence/store.ts'
import { basenameOf, isWithin, pathKey } from '../platform/paths.ts'
import { createLimiter } from '../platform/process.ts'
import { buildSessions } from '../sessions/registry.ts'
import type { DiscoveredSession, SessionAdapter } from '../sessions/types.ts'
import { SnapshotPublisher } from './snapshot.ts'
import { WatchManager, type WatchSpec } from './watchers.ts'

// The single owner of the authoritative snapshot (docs/architecture.md, "Monitoring"):
// watch events mark things dirty, a 500 ms tick rescans dirty or due items with bounded
// concurrency, and every change is published as a versioned diff. Polling is the safety net for
// missed fs.watch events, so normal operation never needs a manual rescan.

const TICK_MS = 500
const MIN_STATUS_INTERVAL_MS = 1_500
const MIN_SESSION_INTERVAL_MS = 1_000
const ACTIVE_WINDOW_MS = 5 * 60_000
const MONITOR_EVENT_INTERVAL_MS = 5_000

interface RepoState {
  stored: StoredRepository
  worktrees: Worktree[]
  branches: BranchRef[]
  lastSuccessfulScanAt?: string
  scanState: Repository['scanState']
  error?: ErrorInfo
  structureDirty: boolean
  nextStructureAt: number
  scanning: boolean
  /** linked worktree admin dir name (common/worktrees/<name>) -> worktree id */
  adminNames: Map<string, string>
  commitGraph?: CommitGraph
  /** Ref tips + detached heads the graph was built from. */
  graphKey: string
  /** Folders only (ADR 0010): Git now reports the folder as inside a repository. */
  gitDetected?: boolean
}

const isFolder = (repo: RepoState) => repo.stored.kind === 'folder'

interface WorktreeSchedule {
  dirty: boolean
  nextAt: number
  lastScanAt: number
  lastChangeAt: number
  scanning: boolean
  fingerprint: string
}

export interface MonitorOptions {
  store: AppStore
  git: GitRunner
  adapters: SessionAdapter[]
  gh?: GhOptions
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
  /** Disable timers/watchers (unit tests drive the monitor manually). */
  manual?: boolean
}

export class RegistrationError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export class Monitor extends EventEmitter {
  private readonly store: AppStore
  private readonly git: GitRunner
  private readonly adapters: SessionAdapter[]
  private readonly gh?: GhOptions
  private readonly log: NonNullable<MonitorOptions['log']>
  private readonly manual: boolean
  private readonly limit = createLimiter(4)
  private readonly publisher = new SnapshotPublisher()
  private readonly watchers = new WatchManager()
  private settings: Settings
  private repos = new Map<string, RepoState>()
  private schedules = new Map<string, WorktreeSchedule>()
  private discovered = new Map<string, DiscoveredSession[]>()
  private sessionsDirty = true
  private sessionsScanning = false
  private lastSessionScan = 0
  private persisted = new Map<string, string>()
  private annotations: AnnotationSummary[] = []
  private prs = new Map<string, { status: PullRequestStatus; pullRequests: PullRequest[] }>()
  private prScanning = false
  private lastPrRun = 0
  private lastPrError?: string
  private timer?: NodeJS.Timeout
  private stopped = false
  private inflight?: Promise<void>
  private health: MonitorHealth = { state: 'starting', errors: [] }
  private lastMonitorEvent = 0
  private outsideCounts: Record<'claude' | 'codex', number> = { claude: 0, codex: 0 }
  private insideCounts: Record<'claude' | 'codex', number> = { claude: 0, codex: 0 }
  gitInfo: { available: boolean; version?: string; error?: string } = { available: false }

  constructor(options: MonitorOptions) {
    super()
    this.store = options.store
    this.git = options.git
    this.adapters = options.adapters
    this.gh = options.gh
    this.log = options.log ?? (() => {})
    this.manual = options.manual ?? false
    this.settings = this.store.getSettings()
    this.configureAdapters()
  }

  // Lifecycle --------------------------------------------------------------------------------

  async start(): Promise<void> {
    try {
      const out = await this.git(process.cwd(), ['--version'])
      this.gitInfo = { available: true, version: out.toString('utf8').trim() }
    } catch (err) {
      const e = toErrorInfo(err)
      this.gitInfo = { available: false, error: e.message }
      this.log('error', `Git unavailable: ${e.message}`)
    }
    this.annotations = this.store.annotationSummaries()
    for (const stored of this.store.listRepositories()) this.repos.set(stored.id, this.newRepoState(stored))
    await this.refreshAll()
    if (!this.manual) {
      this.timer = setInterval(() => {
        if (!this.inflight) this.inflight = this.tick().finally(() => (this.inflight = undefined))
      }, TICK_MS)
      this.timer.unref?.()
    }
  }

  /** Stop timers and watchers and wait for in-flight scans, so nothing touches the database afterwards. */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.watchers.closeAll()
    await this.inflight?.catch(() => undefined)
  }

  /** Full rescan of everything (startup, troubleshooting, tests). */
  async refreshAll(): Promise<void> {
    await Promise.all([...this.repos.values()].map((r) => this.scanStructure(r)))
    await Promise.all([...this.repos.values()].flatMap((r) => (isFolder(r) ? [] : r.worktrees.map((w) => this.scanStatus(r, w)))))
    await this.scanSessions(true)
    if (this.settings.github.enabled) await this.scanPullRequests()
    this.syncWatchers()
    this.publish()
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.stopped) return
    const jobs: Promise<unknown>[] = []
    for (const repo of this.repos.values()) {
      if (!repo.scanning && (repo.structureDirty || now >= repo.nextStructureAt)) jobs.push(this.scanStructure(repo).then(() => this.syncWatchers()))
      if (isFolder(repo)) continue
      for (const wt of repo.worktrees) {
        const sch = this.schedule(wt.id)
        if (sch.scanning || now - sch.lastScanAt < MIN_STATUS_INTERVAL_MS) continue
        if (sch.dirty || now >= sch.nextAt) jobs.push(this.scanStatus(repo, wt))
      }
    }
    if (
      !this.sessionsScanning &&
      now - this.lastSessionScan >= MIN_SESSION_INTERVAL_MS &&
      (this.sessionsDirty || now - this.lastSessionScan >= this.settings.monitoring.sessionPollMs)
    ) {
      jobs.push(this.scanSessions())
    }
    if (this.settings.github.enabled && !this.prScanning && now - this.lastPrRun >= this.settings.github.pollMinutes * 60_000) {
      jobs.push(this.scanPullRequests())
    }
    await Promise.all(jobs)
    if (!this.stopped) this.publish()
  }

  // Repositories -----------------------------------------------------------------------------

  private newRepoState(stored: StoredRepository): RepoState {
    return {
      stored,
      worktrees: [],
      branches: [],
      scanState: 'pending',
      structureDirty: true,
      nextStructureAt: 0,
      scanning: false,
      adminNames: new Map(),
      graphKey: '',
    }
  }

  async registerRepository(inputPath: string, displayName?: string, kind: Repository['kind'] = 'git'): Promise<Repository> {
    if (kind === 'folder') return this.registerFolder(inputPath, displayName)
    let resolved
    try {
      resolved = await resolveRepository(this.git, inputPath)
    } catch (err) {
      const e = toErrorInfo(err)
      throw new RegistrationError(e.code, err instanceof GitError ? err.message : e.message, 422)
    }
    const id = repositoryIdFor(resolved.commonGitDir)
    const existing = this.repos.get(id)
    if (existing) {
      throw new RegistrationError(
        'already_registered',
        `This repository is already registered as "${existing.stored.displayName}"`,
        409,
      )
    }
    const name = displayName ?? defaultRepoName(resolved.primaryPath, resolved.isBare)
    const stored = this.store.addRepository({
      id,
      kind: 'git',
      displayName: name,
      registeredPath: inputPath.trim(),
      primaryPath: resolved.primaryPath,
      commonGitDir: resolved.commonGitDir,
      isBare: resolved.isBare,
    })
    return this.activate(stored)
  }

  /** Register a folder without Git (ADR 0010). */
  private async registerFolder(inputPath: string, displayName?: string): Promise<Repository> {
    let folder
    try {
      folder = await resolveFolder(this.git, inputPath)
    } catch (err) {
      const e = toErrorInfo(err)
      throw new RegistrationError(e.code, err instanceof GitError ? err.message : e.message, 422)
    }
    const id = folderIdFor(folder)
    const existing = this.repos.get(id)
    if (existing) throw new RegistrationError('already_registered', `This folder is already registered as "${existing.stored.displayName}"`, 409)
    const stored = this.store.addRepository({
      id,
      kind: 'folder',
      displayName: displayName ?? basenameOf(folder),
      registeredPath: inputPath.trim(),
      primaryPath: folder,
      commonGitDir: '',
      isBare: false,
    })
    return this.activate(stored)
  }

  private async activate(stored: StoredRepository): Promise<Repository> {
    const state = this.newRepoState(stored)
    this.repos.set(stored.id, state)
    await this.scanStructure(state)
    if (!isFolder(state)) await Promise.all(state.worktrees.map((w) => this.scanStatus(state, w)))
    this.sessionsDirty = true
    await this.scanSessions(true)
    this.syncWatchers()
    this.publish()
    this.log('info', `Registered ${stored.kind === 'folder' ? 'folder' : 'repository'} ${stored.id}`)
    return this.repositoryView(state)
  }

  /** Register several repositories and folders; each result reports success or a per-path error. */
  async registerRepositories(paths: string[], folders: string[] = []) {
    const results: Array<{ path: string; ok: boolean; repositoryId?: string; error?: ErrorInfo }> = []
    const items = [...paths.map((p) => ({ p, kind: 'git' as const })), ...folders.map((p) => ({ p, kind: 'folder' as const }))]
    for (const { p, kind } of items) {
      try {
        const repo = await this.registerRepository(p, undefined, kind)
        results.push({ path: p, ok: true, repositoryId: repo.id })
      } catch (err) {
        const e = err instanceof RegistrationError ? { code: err.code, message: err.message } : toErrorInfo(err)
        results.push({ path: p, ok: false, error: e })
      }
    }
    return { results }
  }

  unregisterRepository(id: string): boolean {
    const state = this.repos.get(id)
    if (!state) return false
    this.store.removeRepository(id)
    this.repos.delete(id)
    for (const wt of state.worktrees) this.schedules.delete(wt.id)
    this.prs.delete(id)
    this.sessionsDirty = true
    this.syncWatchers()
    this.rebuildSessions()
    this.publish()
    return true
  }

  renameRepository(id: string, displayName: string): boolean {
    const state = this.repos.get(id)
    if (!state || !this.store.renameRepository(id, displayName)) return false
    state.stored = { ...state.stored, displayName }
    this.publish()
    return true
  }

  reorderRepositories(ids: string[]): void {
    this.store.reorderRepositories(ids)
    for (const stored of this.store.listRepositories()) {
      const state = this.repos.get(stored.id)
      if (state) state.stored = stored
    }
    this.publish()
  }

  private async scanStructure(repo: RepoState): Promise<void> {
    if (isFolder(repo)) return this.scanFolder(repo)
    repo.scanning = true
    repo.structureDirty = false
    try {
      const previous = new Map(repo.worktrees.map((w) => [w.id, w]))
      const scan = await this.limit(() => scanRepository(this.git, repo.stored, previous))
      repo.worktrees = scan.worktrees
      repo.branches = scan.branches
      repo.scanState = 'ok'
      repo.error = undefined
      repo.lastSuccessfulScanAt = new Date().toISOString()
      repo.adminNames = new Map()
      for (const wt of scan.worktrees) {
        const dir = wt.isPrimary ? undefined : worktreeGitDir(wt.path)
        if (dir && isWithin(dir, repo.stored.commonGitDir)) repo.adminNames.set(path.basename(dir).toLowerCase(), wt.id)
        const sch = this.schedule(wt.id)
        if (!previous.has(wt.id)) sch.dirty = true
      }
      for (const id of previous.keys()) if (!scan.worktrees.some((w) => w.id === id)) this.schedules.delete(id)
      if (!previous.size || scan.worktrees.length !== previous.size) this.sessionsDirty = true
      await this.scanGraph(repo)
    } catch (err) {
      repo.scanState = 'error'
      repo.error = toErrorInfo(err)
      this.log('warn', `Repository scan failed (${repo.stored.id}): ${repo.error.code}`)
    } finally {
      repo.scanning = false
      repo.nextStructureAt = Date.now() + this.settings.monitoring.idleWorktreePollMs
    }
  }

  /** A folder: whether it exists, and whether Git now covers it. Nothing else is read (ADR 0010). */
  private async scanFolder(repo: RepoState): Promise<void> {
    repo.scanning = true
    repo.structureDirty = false
    try {
      const previous = repo.worktrees[0]
      const wt = folderWorktree(repo.stored, previous)
      if (!previous || previous.missing !== wt.missing) this.sessionsDirty = true
      repo.worktrees = [wt]
      repo.branches = []
      if (wt.missing) {
        repo.scanState = 'error'
        repo.error = { code: 'path_missing', message: 'The folder no longer exists' }
        repo.gitDetected = undefined
      } else {
        const detected = await this.limit(() => folderInRepository(this.git, repo.stored.primaryPath))
        if (detected !== undefined) repo.gitDetected = detected
        repo.scanState = 'ok'
        repo.error = undefined
        repo.lastSuccessfulScanAt = new Date().toISOString()
      }
    } finally {
      repo.scanning = false
      repo.nextStructureAt = Date.now() + this.settings.monitoring.idleWorktreePollMs
    }
  }

  /** Rebuild the commit graph only when branch tips or detached heads changed. */
  private async scanGraph(repo: RepoState): Promise<void> {
    const key = [
      ...repo.branches.map((b) => b.fullRef + '=' + b.tipOid),
      ...repo.worktrees.filter((w) => w.detached).map((w) => w.headOid ?? ''),
    ].join(',')
    if (key === repo.graphKey && repo.commitGraph && !repo.commitGraph.error) return
    try {
      const g = await this.limit(() => scanCommitGraph(this.git, repo.stored, repo.branches, repo.worktrees))
      repo.commitGraph = { repoId: repo.stored.id, commits: g.commits, truncated: g.truncated, scannedAt: new Date().toISOString() }
      repo.graphKey = key
    } catch (err) {
      repo.commitGraph = { repoId: repo.stored.id, commits: repo.commitGraph?.commits ?? [], truncated: false, scannedAt: new Date().toISOString(), error: toErrorInfo(err) }
    }
  }

  private schedule(id: string): WorktreeSchedule {
    let s = this.schedules.get(id)
    if (!s) {
      s = { dirty: true, nextAt: 0, lastScanAt: 0, lastChangeAt: 0, scanning: false, fingerprint: '' }
      this.schedules.set(id, s)
    }
    return s
  }

  private async scanStatus(repo: RepoState, wt: Worktree): Promise<void> {
    const sch = this.schedule(wt.id)
    sch.scanning = true
    sch.dirty = false
    sch.lastScanAt = Date.now()
    try {
      const status = await this.limit(() => scanWorktreeStatus(this.git, wt))
      const current = repo.worktrees.find((w) => w.id === wt.id)
      if (!current) return
      const fingerprint = JSON.stringify(status)
      if (fingerprint !== sch.fingerprint) {
        if (sch.fingerprint) sch.lastChangeAt = Date.now()
        sch.fingerprint = fingerprint
        current.status = status
      }
      current.lastStatusAt = new Date().toISOString()
    } finally {
      sch.scanning = false
      const now = Date.now()
      const active = now - sch.lastChangeAt < ACTIVE_WINDOW_MS || this.worktreeHasLiveSession(wt.id)
      sch.nextAt = now + (active ? this.settings.monitoring.activeWorktreePollMs : this.settings.monitoring.idleWorktreePollMs)
    }
  }

  private worktreeHasLiveSession(worktreeId: string): boolean {
    return this.publisher
      .collections()
      .sessions.some((s) => s.worktreeId === worktreeId && !s.historical && s.state.kind !== 'idle_or_turn_finished' && s.state.kind !== 'ended')
  }

  // Sessions ---------------------------------------------------------------------------------

  private configureAdapters() {
    for (const adapter of this.adapters) {
      const cfg = this.settings.adapters[adapter.provider]
      adapter.configure({
        enabled: cfg.enabled,
        home: cfg.home,
        staleAfterMs: this.settings.status.staleAfterMinutes * 60_000,
        excerpts: this.settings.privacy.showMessageExcerpts,
        plans: this.settings.privacy.readAgentPlans,
      })
    }
  }

  private async scanSessions(force = false): Promise<void> {
    if (this.sessionsScanning && !force) return
    this.sessionsScanning = true
    this.sessionsDirty = false
    try {
      for (const adapter of this.adapters) {
        try {
          this.discovered.set(adapter.provider, await adapter.discover())
        } catch (err) {
          // Adapters should never throw; keep the last result if one does.
          this.log('error', `Session adapter ${adapter.provider} failed: ${(err as Error).message}`)
        }
      }
      this.rebuildSessions()
    } finally {
      this.lastSessionScan = Date.now()
      this.sessionsScanning = false
    }
  }

  private currentSessions: AgentSession[] = []

  /** Recomputes the agents; then applies automation rules, and recomputes once more when they changed an annotation. */
  private rebuildSessions() {
    if (this.stopped) return
    this.computeSessions()
    if (this.applyAutomation()) {
      this.annotations = this.store.annotationSummaries()
      this.computeSessions()
    }
  }

  private computeSessions() {
    const repositories = [...this.repos.values()].map((r) => this.repositoryView(r))
    const worktrees = [...this.repos.values()].flatMap((r) => r.worktrees)
    const activeProviders = new Set(this.adapters.filter((a) => a.status().enabled && a.status().available).map((a) => a.provider))
    const result = buildSessions({
      discovered: [...this.discovered.values()].flat(),
      worktrees,
      repositories,
      records: this.store.listSessionRecords(),
      annotations: this.annotations,
      activeProviders,
      historicalAfterMs: this.settings.status.historicalAfterHours * 3_600_000,
    })
    this.currentSessions = result.sessions
    this.outsideCounts = result.outsideRegistered
    this.insideCounts = result.insideRegistered
    for (const rec of result.recordsToPersist) this.persistRecord(rec)
  }

  private persistRecord(rec: StoredSessionRecord) {
    const fp = JSON.stringify([rec.title, rec.titleSource, rec.observedCwd, rec.repoId, rec.worktreeId, rec.lastActivityAt])
    if (this.persisted.get(rec.id) === fp) return
    this.store.upsertSessionRecord(rec)
    this.persisted.set(rec.id, fp)
  }

  // Automation rules (ADR 0008) --------------------------------------------------------------

  private factsFor(session: AgentSession, annotation?: SessionAnnotation | AnnotationInput): AgentFacts {
    const repo = session.repoId ? this.repos.get(session.repoId) : undefined
    const branchRef = repo?.worktrees.find((w) => w.id === session.worktreeId)?.branchFullRef
    return { session, annotation, repositoryName: repo?.stored.displayName, branch: branchRef?.replace(/^refs\/heads\//, '') ?? session.recordedBranch }
  }

  /**
   * Applies each enabled rule, in order, to every current agent it matches and has not been
   * applied to at its current revision. Changes go to the annotation store, like your own edits.
   * Returns whether any annotation changed.
   */
  private applyAutomation(): boolean {
    let rules: AutomationRule[]
    try {
      rules = this.store.listRules().filter((r) => r.enabled)
    } catch (err) {
      this.log('error', `Automation rules could not be read: ${(err as Error).message}`)
      return false
    }
    if (!rules.length || !this.currentSessions.length) return false
    const applied = this.store.appliedRevisions()
    const annotations = new Map(this.store.listAnnotations().map((a) => [a.sessionId, a]))
    const now = Date.now()
    const at = new Date(now).toISOString()
    let changed = false
    for (const session of this.currentSessions) {
      let current: SessionAnnotation | undefined = annotations.get(session.id)
      for (const rule of rules) {
        if ((applied.get(`${rule.id}|${session.id}`) ?? 0) >= rule.revision) continue
        if (!ruleMatches(rule, this.factsFor(session, current), now)) continue
        try {
          const before = toInput(current)
          const after = applyActions(before, rule.actions)
          if (annotationChanged(before, after)) {
            current = this.store.putAnnotation(session.id, after, at)
            changed = true
          }
          this.store.recordApplied(rule.id, session.id, rule.revision, at)
        } catch (err) {
          this.log('error', `Automation rule "${rule.name}" failed for ${session.id}: ${(err as Error).message}`)
        }
      }
    }
    return changed
  }

  /** Applies rules now (after a rule was created, edited or switched on) and publishes any change. */
  automationChanged(): void {
    if (this.applyAutomation()) {
      this.annotations = this.store.annotationSummaries()
      this.computeSessions()
    }
    this.publish()
  }

  /** Agents a rule's conditions match now, with a few examples. */
  previewRule(rule: Pick<AutomationRule, 'match' | 'conditions'>): AutomationPreview {
    const annotations = new Map(this.store.listAnnotations().map((a) => [a.sessionId, a]))
    const now = Date.now()
    const matching = this.currentSessions.filter((s) => ruleMatches(rule, this.factsFor(s, annotations.get(s.id)), now))
    return {
      matching: matching.length,
      examples: matching.slice(0, 10).map((s) => ({ sessionId: s.id, title: annotations.get(s.id)?.displayAlias || s.title })),
    }
  }

  ruleStatuses(): AutomationRuleStatus[] {
    const counts = this.store.ruleApplicationCounts()
    return this.store.listRules().map((r) => ({ ...r, matching: this.previewRule(r).matching, applied: counts.get(r.id)?.applied ?? 0, lastAppliedAt: counts.get(r.id)?.lastAppliedAt }))
  }

  annotationsChanged(): void {
    this.annotations = this.store.annotationSummaries()
    this.rebuildSessions()
    this.publish()
  }

  sessionExists(id: string): boolean {
    return this.currentSessions.some((s) => s.id === id)
  }

  // Pull requests (opt-in) -------------------------------------------------------------------

  private async scanPullRequests(): Promise<void> {
    this.prScanning = true
    this.lastPrRun = Date.now()
    try {
      for (const repo of this.repos.values()) {
        if (isFolder(repo)) continue
        const result = await fetchPullRequests(this.git, repo.stored, this.gh)
        this.prs.set(repo.stored.id, result)
        this.lastPrError = result.status.error?.message
      }
    } finally {
      this.prScanning = false
    }
  }

  async refreshPullRequests(): Promise<void> {
    if (!this.settings.github.enabled) return
    await this.scanPullRequests()
    this.publish()
  }

  // Settings ---------------------------------------------------------------------------------

  applySettings(settings: Settings): void {
    const githubWasEnabled = this.settings.github.enabled
    this.settings = settings
    this.configureAdapters()
    this.sessionsDirty = true
    for (const s of this.schedules.values()) s.nextAt = 0
    if (!settings.github.enabled) this.prs.clear()
    else if (!githubWasEnabled) this.lastPrRun = 0
    this.syncWatchers()
    this.publish()
  }

  // Watchers ---------------------------------------------------------------------------------

  private syncWatchers() {
    if (this.manual) return
    const specs: WatchSpec[] = []
    for (const repo of this.repos.values()) {
      // Folders are not watched: there is no Git directory, and their contents are not read.
      if (isFolder(repo)) continue
      specs.push({
        key: `repo:${repo.stored.id}`,
        path: repo.stored.commonGitDir,
        recursive: true,
        onEvent: (f) => this.onGitDirEvent(repo.stored.id, f),
      })
      if (this.settings.monitoring.watchWorkingTrees) {
        for (const wt of repo.worktrees) {
          if (wt.missing) continue
          specs.push({
            key: `wt:${wt.id}`,
            path: wt.path,
            recursive: true,
            onEvent: (f) => {
              if (f && /^\.git([\\/]|$)/.test(f)) return
              this.schedule(wt.id).dirty = true
            },
          })
        }
      }
    }
    this.adapters.forEach((adapter) =>
      adapter.watchTargets().forEach((target, i) =>
        specs.push({
          key: `sessions:${adapter.provider}:${i}`,
          path: target,
          recursive: true,
          onEvent: () => {
            this.sessionsDirty = true
          },
        }),
      ),
    )
    this.watchers.sync(specs)
  }

  private onGitDirEvent(repoId: string, filename: string | null) {
    const repo = this.repos.get(repoId)
    if (!repo) return
    const markAll = () => repo.worktrees.forEach((w) => (this.schedule(w.id).dirty = true))
    if (!filename) {
      repo.structureDirty = true
      markAll()
      return
    }
    const f = filename.replace(/\\/g, '/')
    if (f.startsWith('objects/') || f.startsWith('logs/') || f.endsWith('.lock') || f === 'FETCH_HEAD') return
    const wtMatch = /^worktrees\/([^/]+)(?:\/(.*))?$/.exec(f)
    if (wtMatch) {
      const id = repo.adminNames.get(wtMatch[1]!.toLowerCase())
      if (id) this.schedule(id).dirty = true
      if (!id || !wtMatch[2] || wtMatch[2] === 'HEAD' || wtMatch[2] === 'locked') repo.structureDirty = true
      return
    }
    if (f.startsWith('refs/') || f === 'packed-refs' || f === 'config' || f === 'HEAD') {
      repo.structureDirty = true
      markAll()
      return
    }
    const primary = repo.worktrees.find((w) => w.isPrimary)
    if (primary) this.schedule(primary.id).dirty = true
  }

  // Snapshot ---------------------------------------------------------------------------------

  private repositoryView(r: RepoState): Repository {
    const folder = isFolder(r)
    return {
      id: r.stored.id,
      kind: r.stored.kind,
      displayName: r.stored.displayName,
      registeredPath: r.stored.registeredPath,
      primaryPath: r.stored.primaryPath,
      commonGitDir: folder ? undefined : r.stored.commonGitDir,
      isBare: r.stored.isBare,
      gitDetected: folder ? r.gitDetected : undefined,
      order: r.stored.order,
      addedAt: r.stored.addedAt,
      lastSuccessfulScanAt: r.lastSuccessfulScanAt,
      scanState: r.scanState,
      error: r.error,
    }
  }

  private publish(): void {
    const repos = [...this.repos.values()].sort((a, b) => a.stored.order - b.stored.order)
    const errors: ErrorInfo[] = []
    if (!this.gitInfo.available) errors.push({ code: 'git_unavailable', message: this.gitInfo.error ?? 'Git is not available' })
    for (const r of repos) if (r.error) errors.push({ code: r.error.code, message: `${r.stored.displayName}: ${r.error.message}` })
    if (this.watchers.errorCount > 0) errors.push({ code: 'watcher_errors', message: 'Some file watchers failed; polling continues' })
    this.health = {
      state: errors.length ? 'degraded' : 'ok',
      lastSyncAt: new Date().toISOString(),
      errors,
    }
    const diff = this.publisher.update({
      repositories: repos.map((r) => this.repositoryView(r)),
      // Branch/worktree objects are mutated in place by scans; publish copies so diffs see changes.
      branches: repos.flatMap((r) => r.branches.map((b) => ({ ...b }))),
      worktrees: repos.flatMap((r) => r.worktrees.map((w) => ({ ...w, status: { ...w.status } }))),
      sessions: this.currentSessions,
      annotations: this.annotations,
      pullRequests: [...this.prs.values()].flatMap((p) => p.pullRequests),
      pullRequestStatus: this.settings.github.enabled
        ? repos.filter((r) => !isFolder(r)).map((r) => this.prs.get(r.stored.id)?.status ?? { repoId: r.stored.id, state: 'pending' as const })
        : [],
      commitGraphs: repos.flatMap((r) => (r.commitGraph ? [r.commitGraph] : [])),
    })
    if (diff) this.emit('diff', diff satisfies SnapshotDiff)
    const now = Date.now()
    if (diff || now - this.lastMonitorEvent >= MONITOR_EVENT_INTERVAL_MS) {
      this.lastMonitorEvent = now
      this.emit('monitor', this.health)
    }
  }

  snapshot(): Snapshot {
    return {
      version: this.publisher.snapshotVersion,
      generatedAt: this.publisher.lastGeneratedAt,
      ...this.publisher.collections(),
      monitor: this.health,
    }
  }

  get version(): number {
    return this.publisher.snapshotVersion
  }

  monitorHealth(): MonitorHealth {
    return this.health
  }

  // Diagnostics and suggestions --------------------------------------------------------------

  diagnostics() {
    return {
      watchers: this.watchers.count,
      watcherErrors: this.watchers.errorCount,
      pollIntervalsMs: {
        tick: TICK_MS,
        activeWorktree: this.settings.monitoring.activeWorktreePollMs,
        idleWorktree: this.settings.monitoring.idleWorktreePollMs,
        sessions: this.settings.monitoring.sessionPollMs,
        repositoryStructure: this.settings.monitoring.idleWorktreePollMs,
      },
      adapters: this.adapters.map((a) => {
        const status = a.status()
        return {
          ...status,
          sessionsDiscovered: this.discovered.get(a.provider)?.length ?? 0,
          sessionsInRegisteredRepos: this.insideCounts[a.provider],
          watching: this.watchers.count > 0 && a.watchTargets().length > 0,
        }
      }),
      github: { enabled: this.settings.github.enabled, lastRunAt: this.lastPrRun ? new Date(this.lastPrRun).toISOString() : undefined, error: this.lastPrError },
      outsideRegistered: this.outsideCounts,
    }
  }

  /** Repositories suggested from session working directories (no disk indexing). */
  async suggestions(limit = 40): Promise<RepositorySuggestion[]> {
    // A Git repository nested in a registered folder can still be suggested; plain subfolders cannot.
    const registered = [...this.repos.values()].filter((r) => !isFolder(r))
    const folders = [...this.repos.values()].filter(isFolder)
    const byCwd = new Map<string, RepositorySuggestion>()
    for (const s of [...this.discovered.values()].flat()) {
      if (!s.cwd) continue
      if (registered.some((r) => r.worktrees.some((w) => isWithin(s.cwd!, w.path)) || isWithin(s.cwd!, r.stored.primaryPath))) continue
      const key = pathKey(s.cwd)
      const prior = byCwd.get(key)
      const active = s.live || s.state.kind === 'running' || s.state.kind === 'running_subagents' || s.state.kind === 'waiting_approval' || s.state.kind === 'waiting_user'
      if (prior) {
        if (active) prior.activeSessionCount++
        prior.sessionCount++
        if ((s.lastActivityAt ?? '') > (prior.lastActivityAt ?? '')) prior.lastActivityAt = s.lastActivityAt
      } else {
        byCwd.set(key, { path: s.cwd, kind: 'git', source: s.provider, sessionCount: 1, activeSessionCount: active ? 1 : 0, lastActivityAt: s.lastActivityAt })
      }
    }
    const candidates = [...byCwd.values()].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')).slice(0, limit * 2)
    // Several working directories (worktrees, subfolders) can belong to one repository: merge them.
    // Working directories outside any repository are offered as folders, one each (ADR 0010).
    const byRepo = new Map<string, RepositorySuggestion>()
    for (const c of candidates) {
      if (byRepo.size >= limit) break
      try {
        const resolved = await resolveRepository(this.git, c.path)
        const id = repositoryIdFor(resolved.commonGitDir)
        if (this.repos.has(id)) continue
        const existing = byRepo.get(id)
        if (existing) {
          existing.sessionCount += c.sessionCount
          existing.activeSessionCount += c.activeSessionCount
          if ((c.lastActivityAt ?? '') > (existing.lastActivityAt ?? '')) existing.lastActivityAt = c.lastActivityAt
          continue
        }
        byRepo.set(id, { ...c, path: resolved.primaryPath })
      } catch (err) {
        if (!(err instanceof GitError) || err.code !== 'not_a_repository') continue
        if (folders.some((f) => isWithin(c.path, f.stored.primaryPath))) continue
        try {
          // Missing folders, roots, the home folder and its parents cannot be registered: not offered.
          const folder = checkFolderPath(c.path)
          const id = folderIdFor(folder)
          if (!this.repos.has(id) && !byRepo.has(id)) byRepo.set(id, { ...c, kind: 'folder', path: folder })
        } catch {
          // Not registrable as a folder either: skip silently.
        }
      }
    }
    return [...byRepo.values()]
  }
}

function defaultRepoName(primaryPath: string, isBare: boolean): string {
  const base = basenameOf(primaryPath)
  return isBare ? base.replace(/\.git$/i, '') : base
}
