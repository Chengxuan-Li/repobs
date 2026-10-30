import { ENTITY_COLLECTIONS, entityKey, type EntityCollection, type Snapshot, type SnapshotDiff } from '@repobs/contracts'

export type Collections = Pick<Snapshot, EntityCollection>

type Fingerprints = Record<EntityCollection, Map<string, string>>

/** Tracks the published snapshot and produces versioned entity-level diffs. */
export class SnapshotPublisher {
  private version = 0
  private current: Collections = emptyCollections()
  private fingerprints: Fingerprints = emptyFingerprints()
  private generatedAt = new Date().toISOString()

  get snapshotVersion(): number {
    return this.version
  }

  collections(): Collections {
    return this.current
  }

  get lastGeneratedAt(): string {
    return this.generatedAt
  }

  /** Replace the state; returns a diff when anything changed, else undefined. */
  update(next: Collections): SnapshotDiff | undefined {
    const upserts = emptyCollections()
    const removes = Object.fromEntries(ENTITY_COLLECTIONS.map((c) => [c, [] as string[]])) as SnapshotDiff['removes']
    const nextFingerprints = emptyFingerprints()
    let changed = false
    for (const c of ENTITY_COLLECTIONS) {
      const prev = this.fingerprints[c]
      const fp = nextFingerprints[c]
      for (const entity of next[c] as object[]) {
        const key = entityKey(c, entity)
        const json = JSON.stringify(entity)
        fp.set(key, json)
        if (prev.get(key) !== json) {
          ;(upserts[c] as object[]).push(entity)
          changed = true
        }
      }
      for (const key of prev.keys()) {
        if (!fp.has(key)) {
          removes[c].push(key)
          changed = true
        }
      }
    }
    // Clients order entities by explicit fields (Repository.order, ref names, start times), so
    // array order is not part of the diff.
    if (!changed) return undefined
    const fromVersion = this.version
    this.version++
    this.current = next
    this.fingerprints = nextFingerprints
    this.generatedAt = new Date().toISOString()
    return { fromVersion, toVersion: this.version, generatedAt: this.generatedAt, upserts, removes }
  }
}

export function emptyCollections(): Collections {
  return {
    repositories: [],
    branches: [],
    worktrees: [],
    sessions: [],
    annotations: [],
    pullRequests: [],
    pullRequestStatus: [],
  }
}

function emptyFingerprints(): Fingerprints {
  return Object.fromEntries(ENTITY_COLLECTIONS.map((c) => [c, new Map<string, string>()])) as Fingerprints
}
