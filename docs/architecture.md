# Architecture

```text
browser (React UI) ──HTTP/SSE──▶ repobs server (Node.js, 127.0.0.1)
                                   ├─ security/      pairing, session cookie, Host/Origin/CSRF
                                   ├─ api/           validated JSON endpoints + SSE
                                   ├─ monitoring/    Monitor: snapshot owner, watchers, polling, diffs
                                   ├─ git/           read-only Git reader (allowlisted git.exe calls), PR lookup
                                   ├─ sessions/      provider-neutral registry + Claude/Codex adapters
                                   ├─ automation/    pure rule engine: conditions and annotation actions
                                   ├─ persistence/   SQLite (node:sqlite): repos, settings, annotations, rules
                                   └─ platform/      Windows paths, safe process spawning, folder picker
packages/contracts   zod schemas + TypeScript types shared by server, UI and tests
```

The boundaries are deliberate: Git inspection, each provider adapter, the session registry, human annotations, persistence, the HTTP API and the UI are separate modules that meet only through the contracts.

## Domain model

Defined once in `packages/contracts` (see [HTTP API](api.md) for the generated schemas):

- **Repository** — identified by its *common Git directory* (`git rev-parse --git-common-dir`), so a primary checkout and its linked worktrees are one repository while separate clones stay separate even with the same `origin`. `kind: folder` registers a folder without Git instead ([ADR 0010](decisions/0010-folders-without-git.md)): no Git directory, branches, commits or pull requests, and one stand-in worktree at its path so sessions match it like a checkout.
- **BranchRef** — a local ref or remote-tracking ref with its classification (`checked_out`, `local_tracking`, `local_only`, `remote_tracking`, `remote_only`), configured upstream (with `gone`), ahead/behind and the worktrees where it is checked out. *Remote-only* is derived, not a Git ref type.
- **Worktree** — a physical directory with HEAD, branch or detached state, locked/prunable/missing flags and working-tree status counts plus any operation in progress.
- **AgentSession** — provider + provider session id, title (provider or fallback), observed cwd, association (matched worktree or *unassigned* with a reason), timestamps, **ObservedAgentState** (kind, confidence, source, evidence time, reason), historical flag, subagent counts.
- **CommitGraph** — per repository, the most recent 400 commits (oid, parents, commit time, subject) reachable from local branches, remote-tracking refs and detached heads, each marked *pushed* when reachable from a remote-tracking ref.
- **SessionAnnotation** — human-owned alias, review state, tags, note and checklist, keyed by session id and stored only in the app database.
- Sessions also carry `parentSessionId` (spawned agents) and an optional in-memory `lastMessage` excerpt ([ADR 0003](decisions/0003-dashboard-commit-graph-and-excerpts.md)).

Stable ids: `repo_<hash(common dir)>`, `folder_<hash(path)>`, `wt_<hash(path)>` (a folder's stand-in worktree hashes a prefixed path, so it never collides with a Git worktree at the same place), `<repoId>|<full ref>`, `claude:<session-id>`, `codex:<thread-id>`. Paths are canonicalized Windows-aware (realpath for junctions, upper-case drive letters, native separators, case-insensitive keys) and compared on path boundaries.

## Git reader

All Git calls go through `git/exec.ts`: argv only, no shell, bounded time and output, `--no-optional-locks`, `-c core.fsmonitor=false`, and an allowlist of read-only commands that is unit-tested. The commit graph uses `git log -z` with a fixed format and `--max-count=400` over `--branches --remotes` plus detached-head commit ids, and is rebuilt only when ref tips change. The reader uses NUL-delimited porcelain formats (`worktree list --porcelain -z`, `status --porcelain=v2 --branch -z`, `for-each-ref` with `%00` separators), so names with spaces, Unicode or newlines parse correctly. Operation markers (`MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`) are read from each worktree's administrative directory. An integration test hashes every file under `.git` before and after repeated scans to prove nothing is written.

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

Adapters keep a cursor per file (`sessions/jsonl.ts`): bounded head/tail on first read, appended bytes afterwards, safe handling of partial lines, truncation and replacement. They extract structural facts into a lifecycle phase; `sessions/status.ts` turns facts into an `ObservedAgentState` with the rules in [Status semantics](status-semantics.md). `sessions/registry.ts` associates sessions with worktrees (longest canonical worktree root containing the cwd, which must still exist; a Git worktree wins a tie with a registered folder at the same path), keeps unassigned and source-missing sessions visible when they relate to a registered repository or carry annotations, and persists minimal records so annotations stay recoverable.

## Monitoring and reconciliation

One `Monitor` owns the authoritative snapshot:

1. **Start:** restore registered repositories and annotations, scan everything, discover sessions.
2. **Watch:** `fs.watch` on each common Git directory (refs, HEAD, index, per-worktree admin dirs), on each worktree (recursive, optional) and on provider folders. Events only mark items *dirty*.
3. **Tick (500 ms):** rescan dirty or due items with bounded concurrency (4 Git processes). Status polling is 5 s for recently changed worktrees or worktrees with live sessions and 30 s otherwise; repository structure every 30 s; sessions every 4 s. A worktree is never rescanned more than once per 1.5 s, and ticks never overlap, so bursts coalesce and polling cannot run away.
4. **Reconcile** by stable ids: additions, updates, removals; annotations are never deleted because a source vanished.
   After each session rebuild (and after annotation or rule changes) enabled automation rules run (`automation/engine.ts`, [ADR 0008](decisions/0008-automation-rules-and-view-hiding.md)): each rule changes the annotation of each matching agent at most once per rule revision, through the same store method as a person's edit, and the application is recorded so the details panel can name it.
5. **Publish:** each change produces a versioned entity-level diff on the SSE stream (`diff`), plus periodic `monitor` health events. Clients apply diffs in order and refetch `/snapshot` on a version gap or reconnect. Entities are ordered by stable keys (repository order, ref names, session start time) so rows do not jump during updates.

Failures are surfaced, not hidden: per-repository scan errors, Git missing, watcher errors and adapter problems appear in the status bar and Diagnostics while the last known data stays visible.

## Persistence

SQLite through Node 24's built-in `node:sqlite` (see [decision 0002](decisions/0002-engineering-choices.md)). Versioned forward migrations with a file backup before upgrading an existing database; a database from a newer schema is refused rather than modified; an unreadable database is moved aside and recreated, and the event is disclosed.

## UI

React 19 + Vite, CSS Modules and design tokens (light/dark/system), Geist and Geist Mono bundled from `@fontsource-variable` packages, Lucide icons. The workbench (`app/WorkbenchShell.tsx`) is a ribbon with File and View menus and a command palette (`app/Ribbon.tsx`), a dockable layout (`flexlayout-react`, `app/dockLayout.ts`) holding any number of views — dashboard tabs, each with its own settings (`app/viewState.ts`, `app/ViewPanel.tsx`) — and the repositories and details panels, and a status bar. The page never scrolls; panels do.

Each repository section is laid out by a pure function (`features/dashboard/layout.ts`, unit-tested): branch rows in a stable order, commits assigned to the first branch reaching them along first parents (commits reached only through merges go to the merging row), lane/fork/merge edges, pending-change markers for dirty worktrees, and agent rows (newest first by start time, spawned agents under their parent, at most 12 per branch before *show more*). The horizontal axis is shared by all repositories (`features/dashboard/timeline.ts`, unit-tested): in commit order (default) every commit of every visible repository gets an evenly spaced column in time order and other timestamps are interpolated between neighbouring commits; in calendar mode it is a linear time scale. Calendar, compressed keeps time-proportional gaps above a minimum spacing; zoom scales the axis. Edges are routed orthogonally and overlapping legs get parallel tracks (`routing.ts`); runs of quiet commits can fold into groups. `RepoBoard.tsx` renders a sticky label column (branch labels with their relations, one-line agent cards with a chevron for spawned agents) and draws the lanes as one SVG positioned from the measured row geometry (ResizeObserver), with an HTML layer of agent cards at the end of their activity bars; the dashboard scrolls through history with a sticky axis and pans by mouse drag (`useDragPan.ts`). Hover cards (`HoverCard.tsx`) explain commits, branches, pending changes and agents; they and the checklist pill's list (`ChecklistPill.tsx`) are placed against the element that opened them (`components/placement.ts`, unit-tested), never the pointer. The automation panel (`features/automation/`) edits rules through the API and previews their matches. Filters (`filters.ts`) and the workflow status (`packages/contracts`) are pure and tested. Rows are a keyboard-navigable list (arrows, Home/End, Enter).

## Extension contract

A future client (for example a VS Code extension) would pair through the same launcher flow and use the documented HTTP API and SSE stream. New providers implement `SessionAdapter`. Anything that would mutate Git or control agents requires a new product decision.
