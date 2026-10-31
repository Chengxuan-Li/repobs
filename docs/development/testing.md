# Testing

## Commands

| Command | What it runs |
| --- | --- |
| `npm ci` | Install exact dependency versions |
| `npm run typecheck` | `tsc -b` for contracts and server, `tsc` for the web app and the tests |
| `npm run lint` | ESLint (includes a rule banning shell-based `exec`/`execSync`) |
| `npm test` | Unit tests (`tests/**/*.test.ts`, Node) and web component tests (`apps/web/src/**/*.test.tsx`, jsdom) |
| `npm run test:integration` | Integration tests (`tests/**/*.int.test.ts`) against real disposable Git repositories and a real server |
| `npm run build` | Contracts, server and web UI |
| `npm run test:e2e` | Playwright against the built app on synthetic demo data (run `npm run build` first) |
| `npm run docs:api` | Regenerate `docs/api.md` from the contracts |
| `python -m pip install -r requirements-docs.txt` then `python -m mkdocs build --strict` | Documentation build (`npm run docs:build` also checks `docs/api.md` is current) |

## Fixture policy

- **Synthetic only.** `fixtures/git-fixtures.ts` builds real but disposable repositories in a temporary folder (two unrelated repositories, linked worktrees, local-only/tracking/remote-only/gone branches, detached HEAD, Unicode and spaces in paths, staged/unstaged/untracked files, a merge conflict, a rebase stopped on a conflict, a removed worktree). It uses a fixture identity (`fixture@repobs.invalid`) and never touches real repositories.
- `fixtures/session-fixtures.ts` writes synthetic Claude Code and Codex files with the observed **structure** and placeholder text only. Real session histories are never committed (`.gitignore` also excludes `*.real.jsonl` and `real-sessions/`).
- `scripts/demo.ts` combines both into a demo environment used by e2e tests and documentation screenshots. Playwright screenshots/traces are written to `test-results/` only on failure and are ignored by Git.

## What is covered

- **Git:** porcelain parsers (spaces, Unicode, newlines, renames, unborn/detached), the allowlist (mutating commands and injection attempts are rejected before spawning), path identity, and against real repositories: common-dir resolution from primary/subdirectory/linked worktree, bare repos, refs and upstreams (tracking, gone, remote-only, no duplicates), worktree states (locked/prunable/missing), dirty/conflict/merge/rebase states, and a **read-only proof** (every file under `.git` and the origin hashed before and after repeated scans; only allowlisted subcommands spawned).
- **Sessions:** JSONL cursor (partial lines, UTF-8 boundaries, truncation, bounded head/tail on large files), state rules (unknown vs idle, direct vs inferred, stale downgrade, tool pending never becomes approval), Claude adapter (several sessions per cwd, titles, live registry busy/idle/dead, `*.key` never read, appends, relocation, interrupts, unknown records, subagents, missing installation), Codex adapter (multi-file threads, index titles, subagents, aborted turns, approval events, stale progress, missing home).
- **Persistence:** restart, independence of annotations, completion timestamps, unregistering keeps annotations, reordering, settings merge, backup before migration, newer-schema refusal, corrupt database recovery.
- **API and security:** loopback binding, minimal public health, 401 on every private route (incl. SSE), forged cookies, foreign Host (DNS rebinding), cross-origin and `Sec-Fetch-Site`, Origin + CSRF on mutations, JSON-only bodies, single-use pairing, path validation and command-injection strings, no file endpoints, annotation size limits, log redaction, logout revocation, every documented endpoint served, `docs/api.md` in sync.
- **Monitoring:** SSE diffs for external working-tree changes, new branches, new and growing sessions, `git worktree remove` on a watched worktree (Windows handle safety), recovery by polling with watchers disabled, bounded Git activity while idle.
- **PR integration:** remote parsing, fake `gh` (argv, fork filtering, unauthenticated, missing), and **no GitHub call before opt-in**.
- **UI (Playwright):** unpaired browsers get no data, empty state, bulk registration from session candidates, per-path errors for duplicate/invalid paths, no page-level scrolling, the commit graph (pushed and local-only nodes, pending-change markers, head labels, fork and "at" relations), orthogonal connectors, collapsing quiet commits (hover list, per-commit details, expand), the shared commit-order axis, calendar and compressed modes (minimum spacing), zoom and drag-to-pan, parallel connector tracks, commit hover cards and the legend, one-line agents with hover details, spawned agents behind a chevron (click and →/←, collapse switch), filter dropdowns (harness, status, last-message time, tags), keyboard row navigation, notes (review dropdown, tag autocomplete across sessions, multi-line notes with line breaks, checklist collapse and recovery, persistence across reload), the review menu on list cards, hover cards and timeline cards, agent names and timeline cards toggles, "show more" for 350+ agents, live Git and agent updates without reload, ribbon menus, command palette, shortcuts and the dockable layout (reload persistence, reset, maximize), views (open, per-view repositories, rename, numbering, reload, closing), File → Export / Open, theme persistence, turning excerpts off, diagnostics, removing a repository.
- **Dashboard logic (unit):** quiet-commit grouping (what stays visible, edge remapping, expanded groups), shared axis (groups take one column, even commit spacing across repositories, interpolation of agent activity, width growth, range cut-off, calendar scale), branch relations (forked from, merged into, points at), lane assignment, fork/merge/lane edges, local-only edges, row order, spawned-agent links, branch modes, remote-only rows, show-more limits, newest-first ordering, filters and tag suggestions, excerpt truncation and secret redaction.

## CI matrix

`.github/workflows/ci.yml` runs lint, typecheck, unit, integration, build and e2e on `windows-latest` and `ubuntu-latest` (Node 24), and the strict MkDocs build. `.github/workflows/pages.yml` builds the documentation on pull requests and deploys it from `main`.

## Provenance

All fixture data is generated by code in this repository. Formats were modelled on files written by Claude Code 2.1.286 and Codex 0.165 on the development machine; only record **types and field names** were used, and no provider content was copied into the repository.
