import fs from 'node:fs/promises'
import type { SessionActivity } from '@repobs/contracts'
import { EMPTY_TOKENS } from '@repobs/contracts'
import { JsonlCursor } from '../jsonl.ts'
import { readCompressedJsonl, zstdAvailable } from '../zstd-jsonl.ts'
import { type ActivityResult, ClaudeActivityBuilder, CodexActivityBuilder } from './builder.ts'

// Reads an agent's activity on demand (ADR 0013): the session's own files, a bounded tail of each,
// cached until the files change, at most two sessions parsed at a time. Nothing is written.

export interface ActivitySource {
  file: string
  compressed: boolean
}

export interface ActivitySources {
  provider: 'claude' | 'codex'
  /** In history order (oldest first). */
  files: ActivitySource[]
}

export const ACTIVITY_READ_LIMITS = {
  /** Bytes from the end of each file (plain, or decompressed). */
  tailBytes: 24 * 1024 * 1024,
  headBytes: 64 * 1024,
  parallel: 2,
  cacheEntries: 400,
}

export async function readActivity(sources: ActivitySources, limits = ACTIVITY_READ_LIMITS): Promise<ActivityResult> {
  const builder = sources.provider === 'claude' ? new ClaudeActivityBuilder() : new CodexActivityBuilder()
  // The head is read again as part of the body unless the reader jumps; it only names the thread.
  const onHead = builder instanceof CodexActivityBuilder ? builder.feedHead : undefined
  for (const src of sources.files) {
    if (src.compressed) {
      if (!zstdAvailable) {
        builder.markTruncated()
        continue
      }
      const stats = await readCompressedJsonl(src.file, builder.feed, onHead, [], { headBytes: limits.headBytes, tailBytes: limits.tailBytes })
      if (stats.jumped || stats.tooLarge) builder.markTruncated()
    } else {
      const cursor = new JsonlCursor(src.file, { headBytes: limits.headBytes, tailBytes: limits.tailBytes })
      const stats = await cursor.read(builder.feed, onHead)
      if (stats?.jumped) builder.markTruncated()
    }
  }
  return builder.result()
}

export class ActivityService {
  private cache = new Map<string, SessionActivity>()
  private running = 0
  private queue: Array<() => void> = []
  private inflight = new Map<string, Promise<SessionActivity>>()

  private readonly limits: typeof ACTIVITY_READ_LIMITS

  constructor(limits = ACTIVITY_READ_LIMITS) {
    this.limits = limits
  }

  async get(sessionId: string, sources: ActivitySources | undefined): Promise<SessionActivity> {
    if (!sources || !sources.files.length) return empty(sessionId, 'unavailable', 'none')
    const version = await versionOf(sources)
    if (!version) return empty(sessionId, 'unavailable', 'none')
    const cached = this.cache.get(sessionId)
    if (cached?.version === version) return cached
    const key = `${sessionId}\0${version}`
    const pending = this.inflight.get(key)
    if (pending) return pending
    const job = this.limit(async () => {
      const r = await readActivity(sources, this.limits)
      const activity: SessionActivity = { sessionId, state: 'ok', ...r, version }
      this.cache.delete(sessionId)
      this.cache.set(sessionId, activity)
      if (this.cache.size > this.limits.cacheEntries) this.cache.delete(this.cache.keys().next().value!)
      return activity
    }).finally(() => this.inflight.delete(key))
    this.inflight.set(key, job)
    return job
  }

  clear() {
    this.cache.clear()
  }

  private async limit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.limits.parallel) await new Promise<void>((resolve) => this.queue.push(resolve))
    this.running++
    try {
      return await fn()
    } finally {
      this.running--
      this.queue.shift()?.()
    }
  }
}

/** Size and modification time of every file: changes whenever the session's history does. */
async function versionOf(sources: ActivitySources): Promise<string | undefined> {
  const parts: string[] = []
  for (const f of sources.files) {
    try {
      const st = await fs.stat(f.file)
      parts.push(`${st.size}:${Math.round(st.mtimeMs)}`)
    } catch {
      parts.push('missing')
    }
  }
  return parts.every((p) => p === 'missing') ? undefined : parts.join('|')
}

export function empty(sessionId: string, state: SessionActivity['state'], version: string): SessionActivity {
  return { sessionId, state, steps: [], tokens: [], totals: { ...EMPTY_TOKENS }, truncated: false, version }
}
