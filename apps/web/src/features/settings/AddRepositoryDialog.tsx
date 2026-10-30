import { useEffect, useId, useState } from 'react'
import type { Repository, RepositorySuggestion } from '@repobs/contracts'
import { api, ApiError } from '../../app/api'
import { Dialog, InlineAlert } from '../../components/primitives'
import styles from './settings.module.css'

// Register a local repository by path. The backend validates it (absolute, existing, Git) and
// never indexes the disk; suggestions come only from working directories of known sessions.

export function AddRepositoryDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (repo: Repository) => void }) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickerUnavailable, setPickerUnavailable] = useState<string>()
  const [suggestions, setSuggestions] = useState<RepositorySuggestion[] | undefined>()
  const ids = { path: useId(), name: useId(), hint: useId() }

  useEffect(() => {
    api<{ suggestions: RepositorySuggestion[] }>('GET', '/repositories/suggestions').then(
      (r) => setSuggestions(r.suggestions),
      () => setSuggestions([]),
    )
  }, [])

  const submit = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const repo = await api<Repository>('POST', '/repositories', { path: path.trim(), ...(name.trim() ? { displayName: name.trim() } : {}) })
      onAdded(repo)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not register the repository')
    } finally {
      setBusy(false)
    }
  }

  const browse = async () => {
    setPicking(true)
    setError(undefined)
    try {
      const res = await api<{ path?: string; cancelled: boolean }>('POST', '/repositories/pick-directory', {})
      if (res.path) setPath(res.path)
    } catch (e) {
      if (e instanceof ApiError && e.status === 501) setPickerUnavailable(e.message)
      else setError(e instanceof ApiError ? e.message : 'The folder picker failed')
    } finally {
      setPicking(false)
    }
  }

  return (
    <Dialog
      title="Add repository"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!path.trim() || busy} onClick={() => void submit()}>
            {busy ? 'Adding…' : 'Add repository'}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (path.trim()) void submit()
        }}
        className={styles.group}
        style={{ border: 0, padding: 0 }}
      >
        <label className="label" htmlFor={ids.path}>
          Local repository path
        </label>
        <div className={styles.pathRow}>
          <input
            id={ids.path}
            className="input mono"
            value={path}
            placeholder="C:\src\my-project"
            onChange={(e) => setPath(e.target.value)}
            aria-describedby={ids.hint}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void browse()}
            disabled={picking || !!pickerUnavailable}
            title={pickerUnavailable ?? 'Opens a native folder chooser on this computer'}
          >
            {picking ? 'Waiting for folder…' : 'Browse…'}
          </button>
        </div>
        <p id={ids.hint} className="small muted">
          Any folder inside the repository works, including a linked worktree; repobs registers the whole repository. Registering is read-only:
          nothing in the repository changes.
          {pickerUnavailable ? ` ${pickerUnavailable}` : ''}
        </p>
        <label className="label" htmlFor={ids.name}>
          Display name (optional)
        </label>
        <input id={ids.name} className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        <button type="submit" hidden />
      </form>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <div>
        <div className="label">Suggestions from your agent sessions</div>
        {suggestions === undefined ? (
          <p className="small muted">Looking at session working directories…</p>
        ) : suggestions.length === 0 ? (
          <p className="small muted">No unregistered repositories found in Claude Code or Codex session metadata.</p>
        ) : (
          <ul className={styles.suggestions}>
            {suggestions.map((s) => (
              <li key={s.path}>
                <button type="button" className={styles.suggestion} onClick={() => setPath(s.path)}>
                  <span className="mono">{s.path}</span>
                  <span className="muted">
                    {s.sessionCount} {s.source === 'claude' ? 'Claude' : 'Codex'} session{s.sessionCount > 1 ? 's' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
