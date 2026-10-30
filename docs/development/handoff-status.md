# Handoff progress

Dated implementation checkpoints against the [product handoff](product-handoff.md). Conversation memory is not project state; this page is.

## Checkpoint 3 — 2026-10-30: second review (ADR 0003 amendment)

| Request | Implementation |
| --- | --- |
| Sub-agent topology elements were shifted | Indentation and tree connectors now live inside the fixed label column (no overflowing margins); lane connectors are drawn from row centres |
| Commits should not be spaced by calendar time (keep it as an option) | *Axis → Commit order* (default): evenly spaced commits in time order; *Calendar time* is the toggle (`features/dashboard/timeline.ts`) |
| Date range too compressed; should go back further; axis shared across projects | One axis for all repositories, sticky at the top, scrolling horizontally through all loaded history (default *All loaded*, up to 1 year selectable) |
| Commit messages on hover should be more visible | Custom hover cards with larger hit targets for commits, branch heads/pointers, uncommitted-change markers, agent rows and bars |
| One line per agent: name/alias and status; the rest collapsed | 24 px agent rows; details on hover, per-row expansion (chevron, →/←) or *Expand agent details*, and in the details panel |
| A legend | *Legend* toggle explaining node, edge, marker and bar styles and colours |
| Branch relationships should be visible | Labels *from X*, *→ X*, *at X*; fork/merge curves; dashed pointers for branches without their own commits |

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 13 files / 113 tests passed; `npm run test:integration` 6 files / 73 tests passed; `npm run test:e2e` 18 passed (Edge); `npm run docs:build` exit 0. Backend unchanged in this round.

## Checkpoint 2 — 2026-10-30: dashboard redesign (owner feedback, ADR 0003)

### Owner feedback addressed

| Request | Implementation |
| --- | --- |
| The page itself scrolled | The shell is fixed to the viewport; only the dashboard and side panels scroll (e2e asserts `scrollY = 0` and no document overflow) |
| One primary working panel plus side panels | Dashboard in the center; optional, resizable repositories (left) and details/notes (right) panels |
| Add repositories from a multi-selection list, sortable | Checklist of repositories found in session folders (merged per repository, with session/active counts and last activity), sortable; `POST /api/v1/repositories/batch` with per-path results |
| Filters: harness, last-message age, status, tags; sort repositories | Filter bar (harness, 24 h–40 days, workflow status chips, tag filter with autocomplete, text search); repositories sorted by activity, active agents, name or manual order |
| Visualize branches and commits like a Git tree, with uncommitted and unpushed work distinguished | Per repository: one row per branch, commits placed by time, fork/merge edges, filled = pushed, hollow amber dashed = local only, grey dashed = not pulled, dashed diamond = uncommitted changes (red when conflicted), head labels; new read-only `git log` (≤ 400 commits) |
| Agents as card rows under their branch, with a mechanical latest-message synopsis | Cards with workflow status, observed state, timeline bar, and the latest assistant text or running tool (*Tool: description*), truncated and redacted, in memory only, switchable in Settings → Privacy |
| Show agent spawning; toggle to hide spawned agents | Claude subagents and Codex sub-threads are child sessions linked to their parent (indented card + connector); *Hide spawned agents* |
| Review state as a dropdown; keep alias; tags with autocomplete and tag filter; notes with line breaks; details toggle | Dropdown in the details panel and on every card; tag autocomplete (prefix, then substring, most used first; Tab/Enter); notes rendered with `pre-wrap`; *Show notes & tags* shows alias, tags, full notes and checklist progress on cards |

Removed: the old tree sidebar and center detail views (`features/repository-tree`, `features/git-inspector`).

### Verification run (2026-10-30, this machine)

| Command | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | 12 files, 107 tests passed |
| `npm run build` | exit 0 |
| `npm run test:integration` | 6 files, 73 tests passed |
| `npm run test:e2e` | 16 passed (Edge); docs screenshot regenerated with the opt-in spec (temp paths masked) |
| `npm run docs:build` | exit 0 |

Real data (read-only, counts only): Claude adapter now reports 858 sessions including 674 spawned subagents, 849 with an excerpt, in about 1.3 s cold and 50 ms incrementally (about 120 MB RSS); Codex 13 threads including 8 sub-threads. Commit graph on a local 29-branch repository: 214 commits (64 unpushed) in 46 ms.

Bugs found and fixed while verifying: a pairing link opened in an already-open tab was ignored (hash-only navigation); newly started agents could land behind the per-branch *show more* cutoff because live diffs append to the client's arrays (the layout now orders by start time); clicks on graph nodes did not select their row; a `key: value` redaction rule let `Authorization: Bearer …` tokens through.

### Open items

- Unchanged from checkpoint 1 (no GitHub remote yet, so CI and Pages have not run).
- Repositories with many branches show every local branch by default; the *Branches* menu narrows to checked-out branches or branches with agents.

## Checkpoint 1 — 2026-10-30: v0.1.0, phases P0–P6 implemented

### Environment used

Windows 11 Enterprise (10.0.26200), Node.js 24.21.0, npm 11.19.0, Git 2.56.0.windows.4, Python 3.14.7 with MkDocs 1.6.1, Microsoft Edge (Playwright channel), GitHub CLI 2.103.3. Local provider data present: Claude Code 2.1.286 and Codex 0.165.

### Bootstrap

- `D:\repobs` contained only the handoff document and was not a Git repository. Initialized Git (`main`); no remote was created or pushed. The handoff is retained verbatim with a provenance note at `docs/development/product-handoff.md` (the original copy under `docs/` was removed to keep the docs tree clean).
- `AGENTS.md` and `CLAUDE.md` use the exact starter content from handoff section 8.

### Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| P0 Foundation | Done | npm workspaces (contracts, server, web), strict TS, ESLint, Vitest/Playwright, app-local storage, security shell, MkDocs + workflows |
| P1 Git | Done | `tests/git/*` incl. read-only proof against real disposable repositories |
| P2 Tree UI | Done | Workbench, tree, inspectors, filters, persisted view state; Playwright keyboard, virtualization, theme, empty/error states |
| P3 Agent discovery | Done (live: Claude + Codex) | `tests/sessions/*`, `tests/api/api.int.test.ts`; smoke run against real local data (counts only, below) |
| P4 Live updates | Done | `tests/monitoring/live.int.test.ts`, e2e live test; watcher loss recovery by polling |
| P5 Annotations | Done | `tests/persistence/*`, API + e2e tests (independence, restart, source disappearance, checklist collapse) |
| P6 PR / quality / release | Done locally; CI not yet run on GitHub | Opt-in `gh` integration with fake-gh tests; launcher; docs; security tests. Workflows are written but no remote exists, so they have not executed |

### Verification run (2026-10-30, this machine)

| Command | Result |
| --- | --- |
| `npm ci` | exit 0, 0 vulnerabilities |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (after fixing three findings in the first full run) |
| `npm test` | 10 files, 83 tests passed |
| `npm run build` | exit 0 |
| `npm run test:integration` | 6 files, 71 tests passed |
| `npm run test:e2e` | 12 passed (Edge), plus the opt-in docs screenshot spec |
| `python -m pip install -r requirements-docs.txt` | exit 0 |
| `npm run docs:build` (API docs check + `mkdocs build --strict`) | exit 0 once this page exists |

Manual checks with the built app on synthetic demo data (`scripts/demo.ts`): pairing, empty state, registering through a linked-worktree path, session inspector evidence, annotations with autosave and checklist collapse, persistence across reload, and a provider record appended on disk updating the open page without a reload. Launcher checks: `npm start` reuses a running instance ("already running"), falls back to the next port when the port is taken, and leaves no server process when the launcher is killed (Windows terminates the child with its launcher; with a non-piped parent the server's watchdog shuts down cleanly and removes `runtime.json`).

**Real-data smoke test (read-only, counts only):** Claude adapter found 184 sessions on this machine (183 with provider titles) in about 0.9 s cold and about 40 ms incrementally, about 95 MB RSS; states: 87 turn completed, 82 interrupted, 8 provider-reported idle, 2 provider-reported busy, 5 unknown (stale). Codex adapter found 5 top-level threads (subagent threads folded into parents). No content was recorded.

### Live vs synthetic

- **Verified live (real local files, read-only):** Claude transcripts, Claude live-session registry (`busy`/`idle`), Claude subagent folders, Codex rollouts spanning multiple files, Codex `session_index.jsonl`, Codex subagent threads.
- **Synthetic only:** Codex approval / user-input request events (protocol names, not observed in local logs), Claude registry statuses other than `busy`/`idle`, provider error events, the GitHub CLI (fake `gh`; the real `gh` was not called), Linux/macOS behaviour (CI configured, not yet run).

### Known blockers / open items

- No GitHub remote exists, so CI, Pages deployment, `site_url`/`repo_url` in `mkdocs.yml` and the README clone URL are pending the owner creating the repository and enabling *Settings → Pages → Source: GitHub Actions*.
- Third-party actions are pinned to major versions; pin to commit SHAs when the security policy requires.
- With a piped launcher on Windows, killing the launcher terminates the server abruptly (no orphan, but `runtime.json` stays until the next start, which ignores stale entries).

### Next actions

1. Create the GitHub repository, push `main`, confirm both workflows are green on `windows-latest` and `ubuntu-latest`, then set `site_url`/`repo_url`.
2. Exercise the GitHub PR integration with a real `gh` login on a test repository.
3. Consider an explicit, opt-in, report-only Claude Code hook bridge for direct approval-wait evidence (new ADR required).
4. Packaged executable / installer (nice-to-have).
