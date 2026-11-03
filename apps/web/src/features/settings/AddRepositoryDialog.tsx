import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RegisterRepositoriesResponse, RepositoryKind, RepositorySuggestion } from '@repobs/contracts'
import { api, ApiError } from '../../app/api'
import { Badge, Dialog, formatAge, InlineAlert, useNow } from '../../components/primitives'
import styles from './settings.module.css'

// Register several repositories and folders without Git (ADR 0011) at once: tick candidates found
// in agent session folders (no disk indexing) and/or add paths by hand or with the native folder
// picker. A path is tried as a repository; when Git does not recognise it, the dialog offers to add
// it as a folder instead of falling back silently.

type Sort = 'activity' | 'sessions' | 'active' | 'name'

interface Candidate {
  path: string
  kind: RepositoryKind
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
  const [pickNotice, setPickNotice] = useState<string>()
  const pickAbort = useRef<AbortController>(undefined)
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
    setCandidates((prev) => (prev.some((c) => c.path.toLowerCase() === value.toLowerCase()) ? prev : [{ path: value, kind: 'git', manual: true }, ...prev]))
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

  // Every outcome of Browse is reported; the native dialog opens outside the browser, so a click
  // that changed nothing visible would look broken. Stopping (or closing this dialog) aborts the
  // request, which closes the native dialog on the server.
  useEffect(() => () => pickAbort.current?.abort(), [])

  const browse = async () => {
    const abort = new AbortController()
    pickAbort.current = abort
    setPicking(true)
    setError(undefined)
    setPickNotice(undefined)
    try {
      const res = await api<{ path?: string; cancelled: boolean }>('POST', '/repositories/pick-directory', {}, { signal: abort.signal })
      if (res.path) addPath(res.path)
      else setPickNotice('The folder chooser was closed without choosing a folder.')
    } catch (e) {
      if (abort.signal.aborted) return
      if (e instanceof ApiError && e.status === 501) setPickerUnavailable(e.message)
      else setError(e instanceof ApiError ? e.message : 'The folder picker failed')
    } finally {
      if (pickAbort.current === abort) {
        pickAbort.current = undefined
        setPicking(false)
      }
    }
  }

  const asFolder = (p: string) => {
    setCandidates((prev) => prev.map((c) => (c.path === p ? { ...c, kind: 'folder' } : c)))
    setChecked((prev) => new Set(prev).add(p))
    setResults((prev) => prev?.filter((r) => r.path !== p))
  }

  const kindOf = (p: string) => candidates.find((c) => c.path === p)?.kind ?? 'git'

  const stopPicking = () => {
    pickAbort.current?.abort()
    pickAbort.current = undefined
    setPicking(false)
  }

  const submit = async () => {
    const all = [...checked]
    if (path.trim() && !all.includes(path.trim())) all.push(path.trim())
    if (!all.length) return
    const paths = all.filter((p) => kindOf(p) === 'git')
    const folders = all.filter((p) => kindOf(p) === 'folder')
    setBusy(true)
    setError(undefined)
    try {
      const res = await api<RegisterRepositoriesResponse>('POST', '/repositories/batch', { paths, folders })
      setResults(res.results)
      const added = res.results.filter((r) => r.ok).map((r) => r.repositoryId!)
      if (added.length) onAdded(added)
      if (res.results.every((r) => r.ok)) onClose()
      else {
        setChecked(new Set(res.results.filter((r) => !r.ok).map((r) => r.path)))
        setCandidates((prev) => prev.filter((c) => !res.results.some((r) => r.ok && r.path === c.path)))
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not register the repositories and folders')
    } finally {
      setBusy(false)
    }
  }

  const typed = path.trim() && !checked.has(path.trim()) ? 1 : 0
  const folderCount = [...checked].filter((p) => kindOf(p) === 'folder').length
  const repoCount = checked.size - folderCount + typed
  const count = repoCount + folderCount
  const failed = results?.filter((r) => !r.ok) ?? []

  return (
    <Dialog
      title="Add repositories or folders"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!count || busy} onClick={() => void submit()}>
            {busy ? 'Adding…' : addLabel(repoCount, folderCount)}
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
          Local repository or folder path
        </label>
        <input id={ids.path} className="input mono" value={path} placeholder="C:\src\my-project" onChange={(e) => setPath(e.target.value)} autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn" disabled={!path.trim()}>
          Add to list
        </button>
        {picking ? (
          <button type="button" className="btn" onClick={stopPicking} title="Closes the folder chooser and stops waiting">
            Stop waiting
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void browse()} disabled={!!pickerUnavailable} title={pickerUnavailable ?? 'Opens a native folder chooser on this computer'}>
            Browse…
          </button>
        )}
      </form>
      {picking ? (
        <InlineAlert tone="info">
          A folder chooser is open on this computer. Choose a folder there; if you cannot see it, look for “Select a Git repository folder” in the taskbar.
        </InlineAlert>
      ) : null}
      {pickNotice ? (
        <InlineAlert tone="info" onDismiss={() => setPickNotice(undefined)}>
          {pickNotice}
        </InlineAlert>
      ) : null}
      <p className="small muted">
        Any folder inside a repository works, including a linked worktree. A folder without Git can be added too: repobs then shows the agents working in it, with no
        commits. Registering is read-only. Candidates below come from the working directories of your Claude Code and Codex sessions; repobs never scans your disk.
      </p>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {failed.length ? (
        <InlineAlert tone="danger">
          {failed.map((r) => (
            <div key={r.path} className={styles.failure}>
              <span>
                <span className="mono">{r.path}</span>: {r.error?.message}
              </span>
              {r.error?.code === 'not_a_repository' && kindOf(r.path) === 'git' ? (
                <button type="button" className="btn btn-quiet" onClick={() => asFolder(r.path)}>
                  Add as folder
                </button>
              ) : null}
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
        <p className="small muted">No unregistered repositories or folders found in session metadata. Add a path above.</p>
      ) : (
        <ul className={styles.candidates} aria-label="Repositories and folders to add">
          {sorted.map((c) => (
            <li key={c.path}>
              <label className={styles.candidate}>
                <input type="checkbox" checked={checked.has(c.path)} onChange={(e) => toggle(c.path, e.target.checked)} />
                <span>
                  <span className="mono">{c.path}</span>
                  {c.kind === 'folder' ? (
                    <span className={styles.kind} title="Not a Git repository: added as a folder, with its agents and no commits">
                      <Badge tone="neutral">folder</Badge>
                    </span>
                  ) : null}
                </span>
                <span className="small muted">
                  {c.manual
                    ? 'added by path'
                    : `${c.sessionCount} ${c.sessionCount === 1 ? 'session' : 'sessions'}${c.activeSessionCount ? `, ${c.activeSessionCount} active` : ''} · ${formatAge(c.lastActivityAt, now)}`}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

function addLabel(repos: number, folders: number): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`
  if (repos && folders) return `Add ${n(repos, 'repository', 'repositories')} and ${n(folders, 'folder', 'folders')}`
  if (folders) return folders > 1 ? `Add ${folders} folders` : 'Add folder'
  return repos > 1 ? `Add ${repos} repositories` : 'Add repository'
}
