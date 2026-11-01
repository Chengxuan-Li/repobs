import fs from 'node:fs'
import {
  type AgentSession,
  type AnnotationSummary,
  fallbackSessionTitle,
  type Repository,
  type UnassignedReason,
  type Worktree,
} from '@repobs/contracts'
import type { StoredSessionRecord } from '../persistence/store.ts'
import { canonicalPathCached, isWithin, pathKey } from '../platform/paths.ts'
import { activityLabel } from './status.ts'
import type { DiscoveredSession } from './types.ts'

// Joins provider sessions with registered worktrees. Association rule (docs/architecture.md):
// the canonical session cwd must lie inside a current worktree root (path-boundary aware); the
// longest root wins. Sessions whose cwd no longer exists, or that were associated before but no
// longer match, become "unassigned" under their repository. Nothing is ever guessed from branch
// names. Sessions unrelated to registered repositories are not shown (only counted).

export interface AssociationResult {
  association?: 'matched' | 'unassigned'
  worktreeId?: string
  repoId?: string
  reason?: UnassignedReason
}

const existsCache = new Map<string, { value: boolean; at: number }>()
function existsCached(p: string, now: number): boolean {
  const key = pathKey(p)
  const hit = existsCache.get(key)
  if (hit && now - hit.at < 15_000) return hit.value
  const value = fs.existsSync(p)
  if (existsCache.size > 5_000) existsCache.clear()
  existsCache.set(key, { value, at: now })
  return value
}

export function associate(
  cwd: string | undefined,
  worktrees: Worktree[],
  previous: StoredSessionRecord | undefined,
  registeredRepoIds: Set<string>,
  now = Date.now(),
): AssociationResult {
  if (cwd) {
    const canonical = canonicalPathCached(cwd)
    let best: Worktree | undefined
    for (const wt of worktrees) {
      if (!isWithin(canonical, wt.path) && !isWithin(cwd, wt.path)) continue
      if (!best || wt.path.length > best.path.length) best = wt
    }
    if (best) {
      if (best.missing) return { association: 'unassigned', repoId: best.repoId, reason: 'worktree_removed' }
      if (pathKey(canonical) !== pathKey(best.path) && !existsCached(canonical, now)) {
        // e.g. a deleted nested worktree directory inside the primary checkout: do not attribute it
        // to the enclosing worktree.
        return { association: 'unassigned', repoId: best.repoId, reason: 'cwd_missing' }
      }
      return { association: 'matched', worktreeId: best.id, repoId: best.repoId }
    }
  }
  if (previous?.repoId && registeredRepoIds.has(previous.repoId)) {
    const stillThere = previous.worktreeId && worktrees.some((w) => w.id === previous.worktreeId)
    return { association: 'unassigned', repoId: previous.repoId, reason: stillThere ? 'no_matching_worktree' : 'worktree_removed' }
  }
  return {}
}

export interface BuildSessionsInput {
  discovered: DiscoveredSession[]
  worktrees: Worktree[]
  repositories: Repository[]
  records: StoredSessionRecord[]
  annotations: AnnotationSummary[]
  /** Provider adapters that ran (a disabled/unavailable provider's sessions are not "missing"). */
  activeProviders: Set<'claude' | 'codex'>
  historicalAfterMs: number
  now?: number
}

export interface BuildSessionsOutput {
  sessions: AgentSession[]
  /** Records to persist for sessions associated with registered repositories. */
  recordsToPersist: StoredSessionRecord[]
  outsideRegistered: Record<'claude' | 'codex', number>
  insideRegistered: Record<'claude' | 'codex', number>
}

export function buildSessions(input: BuildSessionsInput): BuildSessionsOutput {
  const now = input.now ?? Date.now()
  const repoIds = new Set(input.repositories.map((r) => r.id))
  const recordById = new Map(input.records.map((r) => [r.id, r]))
  const annotated = new Set(input.annotations.map((a) => a.sessionId))
  const sessions: AgentSession[] = []
  const recordsToPersist: StoredSessionRecord[] = []
  const outsideRegistered = { claude: 0, codex: 0 }
  const insideRegistered = { claude: 0, codex: 0 }
  const seen = new Set<string>()

  for (const d of input.discovered) {
    if (seen.has(d.id)) continue
    seen.add(d.id)
    const prior = recordById.get(d.id)
    const assoc = associate(d.cwd, input.worktrees, prior, repoIds, now)
    if (!assoc.association && !annotated.has(d.id)) {
      outsideRegistered[d.provider]++
      continue
    }
    if (assoc.association) insideRegistered[d.provider]++
    const title = d.title ?? fallbackSessionTitle(d.provider, d.providerSessionId)
    const last = d.lastActivityAt ? Date.parse(d.lastActivityAt) : undefined
    const session: AgentSession = {
      id: d.id,
      provider: d.provider,
      providerSessionId: d.providerSessionId,
      title,
      titleSource: d.title ? 'provider' : 'fallback',
      observedCwd: d.cwd,
      worktreeId: assoc.worktreeId,
      repoId: assoc.repoId,
      association: assoc.association ?? 'unassigned',
      unassignedReason: assoc.association === 'matched' ? undefined : (assoc.reason ?? 'no_matching_worktree'),
      firstSeenAt: d.firstSeenAt,
      lastActivityAt: d.lastActivityAt,
      state: d.state,
      historical: !d.live && (last === undefined || now - last > input.historicalAfterMs),
      sourceAvailable: true,
      subagents: d.subagents,
      providerVersion: d.providerVersion,
      recordedBranch: d.recordedBranch,
      activityLabel: activityLabel(d.lifecycle.phase),
      parentSessionId: d.parentSessionId,
      agentType: d.agentType,
      lastMessage: d.lastMessage,
      plan: d.plan,
    }
    sessions.push(session)
    if (assoc.repoId) {
      recordsToPersist.push({
        id: d.id,
        provider: d.provider,
        providerSessionId: d.providerSessionId,
        title,
        titleSource: session.titleSource,
        observedCwd: d.cwd,
        repoId: assoc.repoId,
        worktreeId: assoc.worktreeId ?? prior?.worktreeId,
        firstSeenAt: d.firstSeenAt,
        lastActivityAt: d.lastActivityAt,
      })
    }
  }

  // Sessions known from earlier scans whose provider source disappeared: keep them visible so
  // their annotations stay recoverable, but never claim a live status.
  for (const rec of input.records) {
    if (seen.has(rec.id) || !input.activeProviders.has(rec.provider)) continue
    const relevant = (rec.repoId && repoIds.has(rec.repoId)) || annotated.has(rec.id)
    if (!relevant) continue
    seen.add(rec.id)
    sessions.push({
      id: rec.id,
      provider: rec.provider,
      providerSessionId: rec.providerSessionId,
      title: rec.title,
      titleSource: rec.titleSource,
      observedCwd: rec.observedCwd,
      repoId: rec.repoId && repoIds.has(rec.repoId) ? rec.repoId : undefined,
      association: 'unassigned',
      unassignedReason: 'source_missing',
      firstSeenAt: rec.firstSeenAt,
      lastActivityAt: rec.lastActivityAt,
      state: { kind: 'unknown', confidence: 'unknown', source: `${rec.provider}.records`, detail: 'source_missing' },
      historical: true,
      sourceAvailable: false,
      subagents: { total: 0, active: 0 },
    })
  }

  // Annotated sessions that are in neither list (e.g. provider disabled): still recoverable.
  for (const a of input.annotations) {
    if (seen.has(a.sessionId)) continue
    const rec = recordById.get(a.sessionId)
    const [provider, ...rest] = a.sessionId.split(':')
    if (provider !== 'claude' && provider !== 'codex') continue
    seen.add(a.sessionId)
    const providerSessionId = rec?.providerSessionId ?? rest.join(':')
    sessions.push({
      id: a.sessionId,
      provider,
      providerSessionId,
      title: rec?.title ?? fallbackSessionTitle(provider, providerSessionId),
      titleSource: rec?.titleSource ?? 'fallback',
      observedCwd: rec?.observedCwd,
      repoId: rec?.repoId && repoIds.has(rec.repoId) ? rec.repoId : undefined,
      association: 'unassigned',
      unassignedReason: 'source_missing',
      firstSeenAt: rec?.firstSeenAt,
      lastActivityAt: rec?.lastActivityAt,
      state: { kind: 'unknown', confidence: 'unknown', source: `${provider}.records`, detail: 'source_missing' },
      historical: true,
      sourceAvailable: false,
      subagents: { total: 0, active: 0 },
    })
  }

  // Order by start time (newest first), which does not change as sessions report activity, so
  // rows do not jump around during ordinary updates.
  sessions.sort((a, b) => (Date.parse(b.firstSeenAt ?? '') || 0) - (Date.parse(a.firstSeenAt ?? '') || 0) || a.id.localeCompare(b.id))
  return { sessions, recordsToPersist, outsideRegistered, insideRegistered }
}
