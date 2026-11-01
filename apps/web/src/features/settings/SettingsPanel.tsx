import { useEffect, useId, useState } from 'react'
import { AnnotationExport, type Settings, type SettingsPatch, type ThemePreference } from '@repobs/contracts'
import { api, ApiError } from '../../app/api'
import { Dialog, InlineAlert } from '../../components/primitives'
import styles from './settings.module.css'

export function SettingsPanel({ onClose, onSaved }: { onClose: () => void; onSaved: (s: Settings) => void }) {
  const [settings, setSettings] = useState<Settings>()
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)
  const ids = { claude: useId(), codex: useId(), stale: useId(), hist: useId(), active: useId(), idle: useId(), file: useId() }

  useEffect(() => {
    api<Settings>('GET', '/settings').then(setSettings, (e: unknown) => setError(e instanceof ApiError ? e.message : 'Could not load settings'))
  }, [])

  if (!settings) {
    return (
      <Dialog title="Settings" onClose={onClose}>
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : <p className="muted">Loading…</p>}
      </Dialog>
    )
  }

  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch })
  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const patch: SettingsPatch = {
        theme: settings.theme,
        adapters: {
          claude: { enabled: settings.adapters.claude.enabled, home: settings.adapters.claude.home?.trim() || null },
          codex: { enabled: settings.adapters.codex.enabled, home: settings.adapters.codex.home?.trim() || null },
        },
        monitoring: settings.monitoring,
        status: settings.status,
        privacy: settings.privacy,
        github: settings.github,
      }
      const next = await api<Settings>('PATCH', '/settings', patch)
      onSaved(next)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save settings')
    } finally {
      setBusy(false)
    }
  }

  const importFile = async (file: File) => {
    setMessage(undefined)
    setError(undefined)
    try {
      const parsed = AnnotationExport.safeParse(JSON.parse(await file.text()))
      if (!parsed.success) throw new Error('This file is not a repobs annotation export')
      const res = await api<{ imported: number; skipped: number }>('POST', '/annotations/import', parsed.data)
      setMessage(`Imported ${res.imported} annotations (${res.skipped} skipped: older or already present).`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    }
  }

  return (
    <Dialog
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </>
      }
    >
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {message ? <InlineAlert tone="info">{message}</InlineAlert> : null}
      <fieldset className={styles.group}>
        <legend className="label">Appearance</legend>
        <div className={styles.row} role="radiogroup" aria-label="Theme">
          {(['system', 'light', 'dark'] as ThemePreference[]).map((t) => (
            <label key={t} className={styles.radio}>
              <input type="radio" name="theme" checked={settings.theme === t} onChange={() => set({ theme: t })} /> {t[0]!.toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">Session sources (read-only)</legend>
        <p className="small muted">
          repobs reads session metadata from these folders. Leave a path empty to use the provider default (CLAUDE_CONFIG_DIR / CODEX_HOME, else your
          profile). It never installs hooks or changes provider configuration.
        </p>
        {(['claude', 'codex'] as const).map((p) => (
          <div key={p} className={styles.adapterRow}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.adapters[p].enabled}
                onChange={(e) => set({ adapters: { ...settings.adapters, [p]: { ...settings.adapters[p], enabled: e.target.checked } } })}
              />
              {p === 'claude' ? 'Claude Code' : 'Codex'}
            </label>
            <label className="visually-hidden" htmlFor={ids[p]}>
              {p === 'claude' ? 'Claude Code' : 'Codex'} home folder
            </label>
            <input
              id={ids[p]}
              className="input mono"
              placeholder={p === 'claude' ? 'Default: %USERPROFILE%\\.claude' : 'Default: %USERPROFILE%\\.codex'}
              value={settings.adapters[p].home ?? ''}
              onChange={(e) => set({ adapters: { ...settings.adapters, [p]: { ...settings.adapters[p], home: e.target.value } } })}
            />
          </div>
        ))}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">Status semantics</legend>
        <div className={styles.grid}>
          <label htmlFor={ids.stale}>Treat inferred activity as stale after (minutes)</label>
          <input id={ids.stale} className="input" type="number" min={1} max={1440} value={settings.status.staleAfterMinutes} onChange={(e) => set({ status: { ...settings.status, staleAfterMinutes: Number(e.target.value) } })} />
          <label htmlFor={ids.hist}>Show sessions as historical after (hours)</label>
          <input id={ids.hist} className="input" type="number" min={1} max={8760} value={settings.status.historicalAfterHours} onChange={(e) => set({ status: { ...settings.status, historicalAfterHours: Number(e.target.value) } })} />
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">Privacy</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={settings.privacy.showMessageExcerpts} onChange={(e) => set({ privacy: { ...settings.privacy, showMessageExcerpts: e.target.checked } })} />
          Show latest message excerpts on agent cards
        </label>
        <p className="small muted">
          Excerpts are read from the provider session files, truncated to a few lines with obvious secrets (keys, tokens, passwords) redacted, and kept in memory
          only — never stored, logged or exported. Turn this off to show only structural activity labels.
        </p>
        <label className={styles.check}>
          <input type="checkbox" checked={settings.privacy.readAgentPlans} onChange={(e) => set({ privacy: { ...settings.privacy, readAgentPlans: e.target.checked } })} />
          Read agents’ plans into their checklists
        </label>
        <p className="small muted">
          The step lists agents keep with their planning tools (Claude’s task list or to-do list, Codex’s plan) are read from the session files and kept in
          memory only. Your ticks on them are stored by item key, without their text.
        </p>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">Monitoring</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={settings.monitoring.watchWorkingTrees} onChange={(e) => set({ monitoring: { ...settings.monitoring, watchWorkingTrees: e.target.checked } })} />
          Watch working files for changes (one watcher per worktree; polling always continues)
        </label>
        <div className={styles.grid}>
          <label htmlFor={ids.active}>Status poll for recently changed worktrees (ms)</label>
          <input id={ids.active} className="input" type="number" min={1000} step={500} value={settings.monitoring.activeWorktreePollMs} onChange={(e) => set({ monitoring: { ...settings.monitoring, activeWorktreePollMs: Number(e.target.value) } })} />
          <label htmlFor={ids.idle}>Status poll for quiet worktrees (ms)</label>
          <input id={ids.idle} className="input" type="number" min={5000} step={1000} value={settings.monitoring.idleWorktreePollMs} onChange={(e) => set({ monitoring: { ...settings.monitoring, idleWorktreePollMs: Number(e.target.value) } })} />
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">GitHub pull requests (optional, off by default)</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={settings.github.enabled} onChange={(e) => set({ github: { ...settings.github, enabled: e.target.checked } })} />
          Look up open pull requests with the GitHub CLI (<span className="mono">gh</span>)
        </label>
        <p className="small muted">
          When enabled, repobs runs <span className="mono">gh pr list</span> for registered repositories with a GitHub remote every {settings.github.pollMinutes}{' '}
          minutes. This sends the repository owner/name to GitHub using your existing <span className="mono">gh</span> login. Nothing is sent while this is off;
          core features work offline.
        </p>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">Annotations</legend>
        <div className={styles.row}>
          <a className="btn" href="/api/v1/annotations/export" download="repobs-annotations.json">
            Export annotations (JSON)
          </a>
          <label className="btn" htmlFor={ids.file}>
            Import annotations…
          </label>
          <input
            id={ids.file}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importFile(f)
              e.target.value = ''
            }}
          />
        </div>
        <p className="small muted">Exports contain only your notes, tags, review states and checklists — never provider transcripts.</p>
      </fieldset>
    </Dialog>
  )
}
