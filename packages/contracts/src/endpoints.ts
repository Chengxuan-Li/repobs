// The HTTP API surface, defined once. docs/api.md is generated from this list and the zod
// schemas (scripts/gen-api-docs.ts); tests/api/endpoints.int.test.ts checks the server serves
// every entry. Paths are relative to API_PREFIX (/api/v1).

export interface EndpointSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  auth: 'public' | 'session' | 'session+csrf'
  request?: string
  response?: string
  summary: string
}

export const API_ENDPOINTS: EndpointSpec[] = [
  { method: 'GET', path: '/health', auth: 'public', response: 'Health', summary: 'Version and monitor state; no paths or private data.' },
  { method: 'POST', path: '/auth/pair', auth: 'public', request: 'PairRequest', response: 'AuthSession', summary: 'Exchange a one-time launcher pairing token for an HttpOnly session cookie. Requires an Origin header.' },
  { method: 'GET', path: '/auth/session', auth: 'session', response: 'AuthSession', summary: 'CSRF token for the current session.' },
  { method: 'POST', path: '/auth/logout', auth: 'session+csrf', summary: 'Clear the session cookie.' },
  { method: 'GET', path: '/snapshot', auth: 'session', response: 'Snapshot', summary: 'Normalized repositories, refs, worktrees, sessions, annotation summaries and PR metadata.' },
  { method: 'GET', path: '/events', auth: 'session', response: 'SnapshotDiff', summary: 'Server-sent events: `hello` {version}, `diff` (SnapshotDiff), `monitor` (MonitorHealth). Refetch /snapshot on a version gap.' },
  { method: 'GET', path: '/repositories', auth: 'session', response: 'Repository[]', summary: 'Registered repositories.' },
  { method: 'POST', path: '/repositories', auth: 'session+csrf', request: 'RegisterRepositoryRequest', response: 'Repository', summary: 'Register a validated local Git repository (any path inside it), or with `kind: folder` a folder without Git (ADR 0011). Read-only for both.' },
  { method: 'POST', path: '/repositories/batch', auth: 'session+csrf', request: 'RegisterRepositoriesRequest', response: 'RegisterRepositoriesResponse', summary: 'Register up to 50 repositories (`paths`) and folders without Git (`folders`) at once; each path reports success or its own error.' },
  { method: 'GET', path: '/repositories/suggestions', auth: 'session', response: 'RepositorySuggestion[]', summary: 'Unregistered repositories and folders without Git seen in session working directories, with session counts and last activity (no disk indexing).' },
  { method: 'POST', path: '/repositories/pick-directory', auth: 'session+csrf', response: 'PickDirectoryResponse', summary: 'Show the native folder chooser on this Windows machine (501 elsewhere).' },
  { method: 'POST', path: '/repositories/reorder', auth: 'session+csrf', request: 'ReorderRepositoriesRequest', summary: 'Persist repository order.' },
  { method: 'PATCH', path: '/repositories/{id}', auth: 'session+csrf', request: 'UpdateRepositoryRequest', summary: 'Rename the dashboard entry.' },
  { method: 'DELETE', path: '/repositories/{id}', auth: 'session+csrf', summary: 'Remove from the dashboard only. Never deletes files; annotations are kept.' },
  { method: 'GET', path: '/repositories/{id}/pull-requests', auth: 'session', response: 'PullRequest[]', summary: 'Cached open PR metadata (only when the GitHub integration is enabled).' },
  { method: 'POST', path: '/pull-requests/refresh', auth: 'session+csrf', summary: 'Refresh PR metadata now (409 while the integration is disabled).' },
  { method: 'GET', path: '/sessions', auth: 'session', response: 'AgentSession[]', summary: 'Sessions associated with registered repositories (and annotated orphans).' },
  { method: 'GET', path: '/sessions/{id}', auth: 'session', response: 'AgentSession', summary: 'One session with its annotation.' },
  { method: 'GET', path: '/sessions/{id}/annotation', auth: 'session', response: 'SessionAnnotation', summary: 'Human annotation (or null).' },
  { method: 'PUT', path: '/sessions/{id}/annotation', auth: 'session+csrf', request: 'AnnotationInput', response: 'SessionAnnotation', summary: 'Upsert tags, review state, note, alias and checklist (app-local only).' },
  { method: 'DELETE', path: '/sessions/{id}/annotation', auth: 'session+csrf', summary: 'Explicitly delete a session annotation.' },
  { method: 'GET', path: '/annotations/export', auth: 'session', response: 'AnnotationExport', summary: 'Download all annotations as sanitized JSON (no transcripts).' },
  { method: 'POST', path: '/annotations/import', auth: 'session+csrf', request: 'AnnotationExport', summary: 'Merge an export; newer annotations win.' },
  { method: 'GET', path: '/sessions/{id}/automation', auth: 'session', response: 'AutomationApplication[]', summary: 'Automation rules that were applied to this session, newest first.' },
  { method: 'GET', path: '/automation/rules', auth: 'session', response: 'AutomationRuleStatus[]', summary: 'Automation rules with the agents each matches now and was applied to.' },
  { method: 'POST', path: '/automation/rules', auth: 'session+csrf', request: 'AutomationRuleInput', response: 'AutomationRule', summary: 'Create a rule. An enabled rule applies at once to the agents it matches (once per agent and revision).' },
  { method: 'PUT', path: '/automation/rules/{id}', auth: 'session+csrf', request: 'AutomationRuleInput', response: 'AutomationRule', summary: 'Edit a rule; changed conditions or actions start a new revision, which applies afresh.' },
  { method: 'DELETE', path: '/automation/rules/{id}', auth: 'session+csrf', summary: 'Delete a rule. Annotations it changed stay as they are.' },
  { method: 'POST', path: '/automation/preview', auth: 'session+csrf', request: 'AutomationRuleInput', response: 'AutomationPreview', summary: 'Agents a rule would match now; changes nothing.' },
  { method: 'GET', path: '/settings', auth: 'session', response: 'Settings', summary: 'App settings.' },
  { method: 'PATCH', path: '/settings', auth: 'session+csrf', request: 'SettingsPatch', response: 'Settings', summary: 'Change settings (deep partial).' },
  { method: 'POST', path: '/rescan', auth: 'session+csrf', summary: 'Troubleshooting only: full rescan. Normal operation never needs it.' },
  { method: 'GET', path: '/diagnostics', auth: 'session', response: 'Diagnostics', summary: 'Redacted adapter, watcher, Git and database health.' },
]
