import fs from 'node:fs'
import { pathKey } from '../platform/paths.ts'

// fs.watch management. Watch events are hints only: they schedule a targeted rescan, and periodic
// polling (monitor.ts) recovers from anything missed. A watcher that errors (e.g. its directory
// was deleted) is closed immediately so it never holds a handle on a removed worktree.

export interface WatchSpec {
  key: string
  path: string
  recursive: boolean
  onEvent: (filename: string | null) => void
}

export class WatchManager {
  private readonly watchers = new Map<string, { spec: WatchSpec; watcher: fs.FSWatcher }>()
  private errors = 0

  get count(): number {
    return this.watchers.size
  }

  get errorCount(): number {
    return this.errors
  }

  /** Make the active watchers exactly `specs` (by key + path). */
  sync(specs: WatchSpec[]): void {
    const wanted = new Map(specs.map((s) => [s.key, s]))
    for (const [key, entry] of this.watchers) {
      const spec = wanted.get(key)
      if (!spec || pathKey(spec.path) !== pathKey(entry.spec.path) || spec.recursive !== entry.spec.recursive) {
        entry.watcher.close()
        this.watchers.delete(key)
      } else {
        entry.spec = spec
      }
    }
    for (const spec of specs) {
      if (this.watchers.has(spec.key)) continue
      if (!fs.existsSync(spec.path)) continue
      try {
        const watcher = fs.watch(spec.path, { recursive: spec.recursive, persistent: false }, (_event, filename) => {
          const entry = this.watchers.get(spec.key)
          entry?.spec.onEvent(typeof filename === 'string' ? filename : null)
        })
        watcher.on('error', () => {
          this.errors++
          watcher.close()
          if (this.watchers.get(spec.key)?.watcher === watcher) this.watchers.delete(spec.key)
          spec.onEvent(null)
        })
        this.watchers.set(spec.key, { spec, watcher })
      } catch {
        this.errors++
      }
    }
  }

  closeAll(): void {
    for (const { watcher } of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }
}
