import { useEffect, useId, useMemo, useState } from 'react'
import type { RegisterRepositoriesResponse, RepositorySuggestion } from '@repobs/contracts'
import { api, ApiError } from '../../app/api'
import { Dialog, formatAge, InlineAlert, useNow } from '../../components/primitives'
import styles from './settings.module.css'

// Register several repositories at once: tick candidates found in agent session folders (no disk
// indexing) and/or add paths by hand or with the native folder picker.

type Sort = 'activity' | 'sessions' | 'active' | 'name'

interface Candidate {
  path: string
  sessionCount?: number
  activeSessionCount?: number
  lastActivityAt?: string
  manual?: boolean
}

export function AddRepositoryDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (repositoryIds: string[]) => void }) {
  const [path, setPath] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<Sort>('activity')
  const [error, setError] = useState<string>()
  const [results, setResults] = useState<RegisterRepositoriesResponse['results']>()
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickerUnavailable, setPickerUnavailable] = useState<string>()
  const now = useNow(60_000)
  const ids = { path: useId(), sort: useId() }

  useEffect(() => {
    api<{ suggestions: RepositorySuggestion[] }>('GET', '/repositories/suggestions').then(
      (r) => {
        setCandidates((prev) => [...prev.filter((c) => c.manual), ...r.suggestions])
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [])

  const sorted = useMemo(() => {
    const list = [...candidates]
    const by: Record<Sort, (a: Candidate, b: Candidate) => number> = {
      activity: (a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
      sessions: (a, b) => (b.sessionCount ?? 0) - (a.sessionCount ?? 0),
      active: (a, b) => (b.activeSessionCount ?? 0) - (a.activeSessionCount ?? 0) || (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
      name: (a, b) => a.path.localeCompare(b.path),
    }
    return list.sort((a, b) => Number(!!b.manual) - Number(!!a.manual) || by[sort](a, b))
  }, [candidates, sort])

  const addPath = (p: string) => {
    const value = p.trim()
    if (!value) return
    setCandidates((prev) => (prev.some((c) => c.path.toLowerCase() === value.toLowerCase()) ? prev : [{ path: value, manual: true }, ...prev]))
    setChecked((prev) => new Set(prev).add(value))
    setPath('')
  }

  const toggle = (p: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(p)
      else next.delete(p)
      return next
    })

  const browse = async () => {
    setPicking(true)
    setError(undefined)
    try {
      const res = await api<{ path?: string; cancelled: boolean }>('POST', '/repositories/pick-directory', {})
      if (res.path) addPath(res.path)
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) setPickerUnavailable(e.message)
      else setError(e instanceof ApiError ? e.message : 'The folder picker failed')
    } finally {
      setPicking(false)
    }
  }

  const submit = async () => {
    const paths = [...checked]
    if (path.trim() && !paths.includes(path.trim())) paths.push(path.trim())
    if (!paths.length) return
    setBusy(true)
    setError(undefined)
    try {
      const res = await api<RegisterRepositoriesResponse>('POST', '/repositories/batch', { paths })
      setResults(res.results)
      const added = res.results.filter((r) => r.ok).map((r) => r.repositoryId!)
      if (added.length) onAdded(added)
      if (res.results.every((r) => r.ok)) onClose()
      else {
        setChecked(new Set(res.results.filter((r) => !r.ok).map((r) => r.path)))
        setCandidates((prev) => prev.filter((c) => !res.results.some((r) => r.ok && r.path === c.path)))
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not register the repositories')
    } finally {
      setBusy(false)
    }
  }

  const count = checked.size + (path.trim() && !checked.has(path.trim()) ? 1 : 0)
  const failed = results?.filter((r) => !r.ok) ?? []

  return (
    <Dialog
      title="Add repositories"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!count || busy} onClick={() => void submit()}>
            {busy ? 'Adding…' : count > 1 ? `Add ${count} repositories` : 'Add repository'}
          </button>
        </>
      }
    >
      <form
        className={styles.pathRow}
        onSubmit={(e) => {
          e.preventDefault()
          addPath(path)
        }}
      >
        <label className="visually-hidden" htmlFor={ids.path}>
          Local repository path
        </label>
        <input id={ids.path} className="input mono" value={path} placeholder="C:\src\my-project" onChange={(e) => setPath(e.target.value)} autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn" disabled={!path.trim()}>
          Add to list
        </button>
        <button type="button" className="btn" onClick={() => void browse()} disabled={picking || !!pickerUnavailable} title={pickerUnavailable ?? 'Opens a native folder chooser on this computer'}>
          {picking ? 'Waiting for folder…' : 'Browse…'}
        </button>
      </form>
      <p className="small muted">
        Any folder inside a repository works, including a linked worktree. Registering is read-only. Candidates below come from the working directories of your Claude
        Code and Codex sessions; repobs never scans your disk.
      </p>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {failed.length ? (
        <InlineAlert tone="danger">
          {failed.map((r) => (
            <div key={r.path}>
              <span className="mono">{r.path}</span>: {r.error?.message}
            </div>
          ))}
        </InlineAlert>
      ) : null}
      <div className={styles.candidateHead}>
        <span className="label">Candidates</span>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={sorted.length > 0 && sorted.every((c) => checked.has(c.path))}
            onChange={(e) => setChecked(e.target.checked ? new Set(sorted.map((c) => c.path)) : new Set())}
            disabled={!sorted.length}
          />
          Select all
        </label>
        <span style={{ flex: 1 }} />
        <label className={styles.check} htmlFor={ids.sort}>
          Sort by
        </label>
        <select id={ids.sort} className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="activity">Last activity</option>
          <option value="active">Active sessions</option>
          <option value="sessions">Session count</option>
          <option value="name">Path</option>
        </select>
      </div>
      {loading && !sorted.length ? (
        <p className="small muted">Looking at session working directories…</p>
      ) : !sorted.length ? (
        <p className="small muted">No unregistered repositories found in session metadata. Add a path above.</p>
      ) : (
        <ul className={styles.candidates} aria-label="Repositories to add">
          {sorted.map((c) => (
            <li key={c.path}>
              <label className={styles.candidate}>
                <input type="checkbox" checked={checked.has(c.path)} onChange={(e) => toggle(c.path, e.target.checked)} />
                <span className="mono">{c.path}</span>
                <span className="small muted">
                  {c.manual
                    ? 'added by path'
                    : `${c.sessionCount} sessions${c.activeSessionCount ? `, ${c.activeSessionCount} active` : ''} · ${formatAge(c.lastActivityAt, now)}`}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
