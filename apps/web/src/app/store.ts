import { useSyncExternalStore } from 'react'
import {
  API_PREFIX,
  ENTITY_COLLECTIONS,
  entityKey,
  type MonitorHealth,
  type Snapshot,
  type SnapshotDiff,
} from '@repobs/contracts'
import { api, ApiError } from './api'

// Client copy of the server snapshot, kept current by SSE diffs. On a version gap or reconnect
// we refetch the full snapshot, so the view converges without a browser refresh.

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'offline'

export interface StoreState {
  snapshot?: Snapshot
  connection: Connection
  error?: string
  /** Last time any server message arrived (SSE event or snapshot). */
  lastMessageAt?: number
}

type Listener = () => void

export function applyDiff(snapshot: Snapshot, diff: SnapshotDiff): Snapshot {
  const next = { ...snapshot, version: diff.toVersion, generatedAt: diff.generatedAt } as Snapshot
  for (const c of ENTITY_COLLECTIONS) {
    const removed = new Set(diff.removes[c])
    const upserts = diff.upserts[c] as object[]
    if (!removed.size && !upserts.length) continue
    const byKey = new Map((snapshot[c] as object[]).map((e) => [entityKey(c, e), e]))
    for (const key of removed) byKey.delete(key)
    for (const e of upserts) byKey.set(entityKey(c, e), e)
    ;(next as unknown as Record<string, object[]>)[c] = [...byKey.values()]
  }
  return next
}

export class SnapshotStore {
  private state: StoreState = { connection: 'connecting' }
  private listeners = new Set<Listener>()
  private source?: EventSource
  private refetching = false
  private closed = false

  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getState = () => this.state

  private set(patch: Partial<StoreState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  private started = false

  async startOnce() {
    if (this.started) return
    this.started = true
    await this.refetch()
    this.connect()
  }

  stop() {
    this.closed = true
    this.source?.close()
  }

  async refetch() {
    if (this.refetching) return
    this.refetching = true
    try {
      const snapshot = await api<Snapshot>('GET', '/snapshot')
      this.set({ snapshot, error: undefined, lastMessageAt: Date.now() })
    } catch (err) {
      this.set({ error: err instanceof ApiError ? err.message : 'Could not load data' })
      if (err instanceof ApiError && err.status === 401) this.set({ connection: 'offline' })
    } finally {
      this.refetching = false
    }
  }

  private connect() {
    if (this.closed) return
    const source = new EventSource(`${API_PREFIX}/events`)
    this.source = source
    source.addEventListener('hello', (e) => {
      const { version, monitor } = JSON.parse((e as MessageEvent<string>).data) as { version: number; monitor: MonitorHealth }
      this.set({ connection: 'live', lastMessageAt: Date.now() })
      if (this.state.snapshot?.version !== version) void this.refetch()
      else if (this.state.snapshot) this.set({ snapshot: { ...this.state.snapshot, monitor } })
    })
    source.addEventListener('diff', (e) => {
      const diff = JSON.parse((e as MessageEvent<string>).data) as SnapshotDiff
      const snap = this.state.snapshot
      if (!snap || snap.version !== diff.fromVersion) {
        void this.refetch()
        return
      }
      this.set({ snapshot: applyDiff(snap, diff), lastMessageAt: Date.now() })
    })
    source.addEventListener('monitor', (e) => {
      const monitor = JSON.parse((e as MessageEvent<string>).data) as MonitorHealth
      if (this.state.snapshot) this.set({ snapshot: { ...this.state.snapshot, monitor }, lastMessageAt: Date.now() })
    })
    source.onerror = () => {
      if (this.closed) return
      if (source.readyState === EventSource.CLOSED) {
        // The server refused the stream (e.g. session expired) or is gone: retry with backoff.
        this.set({ connection: 'offline' })
        setTimeout(() => {
          if (!this.closed) {
            void this.refetch().then(() => this.connect())
          }
        }, 5_000)
      } else {
        this.set({ connection: 'reconnecting' })
      }
    }
  }
}

export const store = new SnapshotStore()

export function useStore(): StoreState {
  return useSyncExternalStore(store.subscribe, store.getState)
}
