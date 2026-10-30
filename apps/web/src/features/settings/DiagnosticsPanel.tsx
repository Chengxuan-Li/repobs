import { useEffect, useState } from 'react'
import type { Diagnostics } from '@repobs/contracts'
import { api, ApiError } from '../../app/api'
import { Badge, Dialog, formatTime, InlineAlert } from '../../components/primitives'

// Redacted health of adapters, watchers and Git. No transcript content is available here.

type Diag = Diagnostics & { outsideRegistered?: Record<string, number> }

export function DiagnosticsPanel({ onClose }: { onClose: () => void }) {
  const [diag, setDiag] = useState<Diag>()
  const [error, setError] = useState<string>()
  const [rescanning, setRescanning] = useState(false)

  const load = () => api<Diag>('GET', '/diagnostics').then(setDiag, (e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load diagnostics'))
  useEffect(() => {
    void load()
  }, [])

  const rescan = async () => {
    setRescanning(true)
    try {
      await api('POST', '/rescan', {})
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Rescan failed')
    } finally {
      setRescanning(false)
    }
  }

  return (
    <Dialog
      title="Diagnostics"
      onClose={onClose}
      wide
      footer={
        <button type="button" className="btn" onClick={() => void rescan()} disabled={rescanning} title="Troubleshooting only: repobs normally updates on its own">
          {rescanning ? 'Rescanning…' : 'Troubleshoot: rescan everything'}
        </button>
      }
    >
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {!diag ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <dl className="facts">
            <dt>repobs</dt>
            <dd>
              {diag.version}, started {formatTime(diag.startedAt)}
            </dd>
            <dt>Git</dt>
            <dd>{diag.git.available ? <span className="mono">{diag.git.version}</span> : <Badge tone="danger">{diag.git.error ?? 'not available'}</Badge>}</dd>
            <dt>Data folder</dt>
            <dd className="mono">{diag.dataDir}</dd>
            <dt>Database</dt>
            <dd className="mono">
              {diag.database.path} (schema v{diag.database.schemaVersion})
            </dd>
            <dt>Monitor</dt>
            <dd>
              <Badge tone={diag.monitor.state === 'ok' ? 'success' : 'warning'}>{diag.monitor.state}</Badge> · last sync {formatTime(diag.monitor.lastSyncAt)} ·{' '}
              {diag.monitor.watchers} watchers ({diag.monitor.watcherErrors} errors) · snapshot v{diag.monitor.snapshotVersion} · {diag.monitor.sseClients} live
              clients
            </dd>
            <dt>Polling (ms)</dt>
            <dd className="mono">
              {Object.entries(diag.monitor.pollIntervalsMs)
                .map(([k, v]) => `${k} ${v}`)
                .join(' · ')}
            </dd>
            <dt>GitHub</dt>
            <dd>{diag.github.enabled ? `enabled · last run ${formatTime(diag.github.lastRunAt)}${diag.github.error ? ` · ${diag.github.error}` : ''}` : 'disabled (no network requests)'}</dd>
          </dl>
          {diag.database.recoveredFromCorruption ? (
            <InlineAlert tone="danger">
              The database was unreadable at startup. It was moved to <span className="mono">{diag.database.recoveredFromCorruption}</span> and a new one was
              created. Your previous annotations are in that file.
            </InlineAlert>
          ) : null}
          <table className="data-table">
            <thead>
              <tr>
                <th>Adapter</th>
                <th>Status</th>
                <th>Root</th>
                <th>Files</th>
                <th>Sessions</th>
                <th>Last scan</th>
              </tr>
            </thead>
            <tbody>
              {diag.adapters.map((a) => (
                <tr key={a.provider}>
                  <td>{a.provider === 'claude' ? 'Claude Code' : 'Codex'}</td>
                  <td>
                    {!a.enabled ? <Badge>disabled</Badge> : a.available ? <Badge tone="success">available</Badge> : <Badge tone="warning">not found</Badge>}
                    {a.liveRegistryEntries !== undefined ? <span className="small muted"> · {a.liveRegistryEntries} live registry entries</span> : null}
                  </td>
                  <td className="mono">
                    {a.root} <span className="muted">({a.rootSource})</span>
                  </td>
                  <td className="mono">{a.filesTracked}</td>
                  <td className="mono">
                    {a.sessionsInRegisteredRepos} in registered repos / {a.sessionsDiscovered} total
                  </td>
                  <td>
                    {formatTime(a.lastScanAt)}
                    {a.lastScanMs !== undefined ? <span className="muted"> ({a.lastScanMs} ms)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {diag.adapters.some((a) => a.problems.length) ? (
            <ul className="small">
              {diag.adapters.flatMap((a) =>
                a.problems.map((p) => (
                  <li key={`${a.provider}-${p.code}`}>
                    <span className="mono">{a.provider}</span>: {p.message} ({p.count})
                  </li>
                )),
              )}
            </ul>
          ) : (
            <p className="small muted">No adapter problems reported.</p>
          )}
          <p className="small muted">
            Sessions outside registered repositories are counted but not shown (Claude: {diag.outsideRegistered?.claude ?? 0}, Codex:{' '}
            {diag.outsideRegistered?.codex ?? 0}).
          </p>
        </>
      )}
    </Dialog>
  )
}
