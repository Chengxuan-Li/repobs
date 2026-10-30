# Architecture

```text
browser (React UI) ──HTTP/SSE──▶ repobs server (Node.js, 127.0.0.1)
                                   ├─ security/      pairing, session cookie, Host/Origin/CSRF
                                   ├─ api/           validated JSON endpoints + SSE
                                   ├─ monitoring/    Monitor: snapshot owner, watchers, polling, diffs
                                   ├─ git/           read-only Git reader (allowlisted git.exe calls), PR lookup
                                   ├─ sessions/      provider-neutral registry + Claude/Codex adapters
                                   ├─ persistence/   SQLite (node:sqlite): repos, settings, annotations
                                   └─ platform/      Windows paths, safe process spawning, folder picker
packages/contracts   zod schemas + TypeScript types shared by server, UI and tests
```

The boundaries are deliberate: Git inspection, each provider adapter, the session registry, human annotations, persistence, the HTTP API and the UI are separate modules that meet only through the contracts.

## Domain model

Defined once in `packages/contracts` (see [HTTP API](api.md) for the generated schemas):

- **Repository** — identified by its *common Git directory* (`git rev-parse --git-common-dir`), so a primary checkout and its linked worktrees are one repository while separate clones stay separate even with the same `origin`.
- **BranchRef** — a local ref or remote-tracking ref with its classification (`checked_out`, `local_tracking`, `local_only`, `remote_tracking`, `remote_only`), configured upstream (with `gone`), ahead/behind and the worktrees where it is checked out. *Remote-only* is derived, not a Git ref type.
- **Worktree** — a physical directory with HEAD, branch or detached state, locked/prunable/missing flags and working-tree status counts plus any operation in progress.
- **AgentSession** — provider + provider session id, title (provider or fallback), observed cwd, association (matched worktree or *unassigned* with a reason), timestamps, **ObservedAgentState** (kind, confidence, source, evidence time, reason), historical flag, subagent counts.
- **SessionAnnotation** — human-owned alias, review state, tags, note and checklist, keyed by session id and stored only in the app database.

Stable ids: `repo_<hash(common dir)>`, `wt_<hash(path)>`, `<repoId>|<full ref>`, `claude:<session-id>`, `codex:<thread-id>`. Paths are canonicalized Windows-aware (realpath for junctions, upper-case drive letters, native separators, case-insensitive keys) and compared on path boundaries.

## Git reader

All Git calls go through `git/exec.ts`: argv only, no shell, bounded time and output, `--no-optional-locks`, `-c core.fsmonitor=false`, and an allowlist of read-only commands that is unit-tested. The reader uses NUL-delimited porcelain formats (`worktree list --porcelain -z`, `status --porcelain=v2 --branch -z`, `for-each-ref` with `%00` separators), so names with spaces, Unicode or newlines parse correctly. Operation markers (`MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`) are read from each worktree's administrative directory. An integration test hashes every file under `.git` before and after repeated scans to prove nothing is written.

## Session adapters

```ts
interface SessionAdapter {
  provider: 'claude' | 'codex'
  configure(config: AdapterConfig): void      // home override, enabled, stale threshold
  discover(now?): Promise<DiscoveredSession[]> // incremental; never throws for bad data
  watchTargets(): string[]                     // directories for fs.watch
  status(): AdapterStatus                      // redacted diagnostics
}
```

Adapters keep a cursor per file (`sessions/jsonl.ts`): bounded head/tail on first read, appended bytes afterwards, safe handling of partial lines, truncation and replacement. They extract structural facts into a lifecycle phase; `sessions/status.ts` turns facts into an `ObservedAgentState` with the rules in [Status semantics](status-semantics.md). `sessions/registry.ts` associates sessions with worktrees (longest canonical worktree root containing the cwd, which must still exist), keeps unassigned and source-missing sessions visible when they relate to a registered repository or carry annotations, and persists minimal records so annotations stay recoverable.

## Monitoring and reconciliation

One `Monitor` owns the authoritative snapshot:

1. **Start:** restore registered repositories and annotations, scan everything, discover sessions.
2. **Watch:** `fs.watch` on each common Git directory (refs, HEAD, index, per-worktree admin dirs), on each worktree (recursive, optional) and on provider folders. Events only mark items *dirty*.
3. **Tick (500 ms):** rescan dirty or due items with bounded concurrency (4 Git processes). Status polling is 5 s for recently changed worktrees or worktrees with live sessions and 30 s otherwise; repository structure every 30 s; sessions every 4 s. A worktree is never rescanned more than once per 1.5 s, and ticks never overlap, so bursts coalesce and polling cannot run away.
4. **Reconcile** by stable ids: additions, updates, removals; annotations are never deleted because a source vanished.
5. **Publish:** each change produces a versioned entity-level diff on the SSE stream (`diff`), plus periodic `monitor` health events. Clients apply diffs in order and refetch `/snapshot` on a version gap or reconnect. Entities are ordered by stable keys (repository order, ref names, session start time) so rows do not jump during updates.

Failures are surfaced, not hidden: per-repository scan errors, Git missing, watcher errors and adapter problems appear in the status bar and Diagnostics while the last known data stays visible.

## Persistence

SQLite through Node 24's built-in `node:sqlite` (see [decision 0002](decisions/0002-engineering-choices.md)). Versioned forward migrations with a file backup before upgrading an existing database; a database from a newer schema is refused rather than modified; an unreadable database is moved aside and recreated, and the event is disclosed.

## UI

React 19 + Vite, CSS Modules and design tokens (light/dark/system), Geist and Geist Mono bundled from `@fontsource-variable` packages, Lucide icons. The tree is a custom WAI-ARIA tree (roving focus, keyboard navigation, context menu, windowed rendering above 300 rows). Pane components have stable ids (`pane-tree`, `pane-center`, `pane-inspector`) so docking could be added later.

## Extension contract

A future client (for example a VS Code extension) would pair through the same launcher flow and use the documented HTTP API and SSE stream. New providers implement `SessionAdapter`. Anything that would mutate Git or control agents requires a new product decision.
