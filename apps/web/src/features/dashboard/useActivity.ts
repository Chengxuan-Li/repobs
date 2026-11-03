import { useEffect, useState } from 'react'
import type { AgentSession, SessionActivity } from '@repobs/contracts'
import { api } from '../../app/api'

// Steps and tokens of the agents a view draws (ADR 0013), fetched on demand: newest first, a few at
// a time, kept per session until its last activity changes. Shared by every view in this tab.

const PARALLEL = 3
const cache = new Map<string, { key: string; activity?: SessionActivity; failed?: boolean }>()
const listeners = new Set<() => void>()
const queue: Array<{ id: string; key: string }> = []
let running = 0

const keyOf = (s: AgentSession) => `${s.lastActivityAt ?? ''}|${s.state.kind}`

function pump() {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift()!
    if (cache.get(job.id)?.key !== job.key) continue
    running++
    api<SessionActivity>('GET', `/sessions/${encodeURIComponent(job.id)}/activity`)
      .then((activity) => {
        const entry = cache.get(job.id)
        if (entry?.key === job.key) entry.activity = activity
      })
      .catch(() => {
        const entry = cache.get(job.id)
        if (entry?.key === job.key) entry.failed = true
      })
      .finally(() => {
        running--
        listeners.forEach((l) => l())
        pump()
      })
  }
}

function request(sessions: AgentSession[]) {
  const wanted = [...sessions].sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
  let added = false
  for (const s of wanted) {
    const key = keyOf(s)
    const entry = cache.get(s.id)
    if (entry?.key === key) continue
    // Keep the old result on screen until the new one arrives.
    cache.set(s.id, { key, activity: entry?.activity })
    queue.push({ id: s.id, key })
    added = true
  }
  if (added) pump()
}

/** Activity per session id, for the given sessions; entries appear as they arrive. */
export function useActivity(sessions: AgentSession[], enabled: boolean): Map<string, SessionActivity> {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  useEffect(() => {
    if (enabled) request(sessions)
  }, [sessions, enabled])
  const out = new Map<string, SessionActivity>()
  if (!enabled) return out
  for (const s of sessions) {
    const a = cache.get(s.id)?.activity
    if (a?.state === 'ok') out.set(s.id, a)
  }
  return out
}
