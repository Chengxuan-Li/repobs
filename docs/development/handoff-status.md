# Handoff progress

Dated implementation checkpoints against the [product handoff](product-handoff.md). Conversation memory is not project state; this page is.

## Checkpoint 14 — 2026-10-31: release preparation, v0.2.0

- Version 0.2.0 in all package manifests, the lockfile's workspace entries and `APP_VERSION` (reported by `/health`).
- `CHANGELOG.md`: the Unreleased entries consolidated into `[0.2.0] — 2026-10-31` describing the shipped state (superseded intermediate entries removed); three entries that had landed in the 0.1.0 section moved back.
- Docs refreshed for the shipped UI: README feature list, index, getting started (File → Diagnostics, View 0), limitations (docking, per-browser views), architecture (workbench, views, routing, timeline cards, panning), testing coverage list, privacy (File → Export holds no excerpts).
- Dead CSS removed (classes no component uses: `orphanRow`, `segmented`/`segment`/`segmentOn`, settings `suggestion`/`code`).

Verification (2026-10-31, this machine) — see the release commit message for the final run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, `npm run docs:build`.

Not done (owner decisions): tagging `v0.2.0` and pushing; whether `v0.1.0` gets a retroactive tag; a public clone URL for the README and getting-started placeholders; a dependency audit (`npm audit` contacts the npm registry).

## Checkpoint 13 — 2026-10-31: drag to pan; repositories panel header

| Request | Implementation |
| --- | --- |
| Add button in the repositories panel is cropped | `Dropdown` `icon` (compact) variant for *Sort*; strip title ellipsizes, *Add* never shrinks |
| Pan the view by click-and-hold, like a map | `useDragPan.ts` on the view's scroller: 4 px threshold, pointer capture, swallowed click after a pan, controls excluded; grab / grabbing cursors |

Verification (2026-10-31, this machine): typecheck, lint and build exit 0; `npm run test:e2e` 27 passed, 1 skipped (new pan test: scroll offsets follow the drag, no selection, a click still selects); `npm test` 16 files / 135 tests passed; `npm run docs:build` exit 0. Screenshot checked: panel header with Sort icon and Add at default width.

## Checkpoint 12 — 2026-10-31: views, File and View menus (ADR 0005)

| Request | Implementation |
| --- | --- |
| Multiple dashboard instances as named views, renamable, layout saved | `dockLayout.ts`: view tabs (`viewTabs`, `openView`, `renameView`, guarded close/rename in `onAction`), `nextViewName`; `ViewPanel.tsx` per view; `viewState.ts` per-view settings in `repobs.workbench.v1` |
| "View X", smallest unused number from 0 | `nextViewName` (unit-tested with the owner's example) |
| Repository selection per view; repositories panel stays the list of all | per-view `hiddenRepos`; panel ticks edit the current view and name it; *Repositories* dropdown in the view's bar |
| Side panels keep a minimum width | panel `minWidth` 280 / 320 px, `borderMinSize`, narrow stored side bars widened; repository entries ellipsize |
| File: Export, Open, Settings, Diagnostics; View: Panels, Open new view, Styling, Full screen, Refresh; only side-panel and theme icons | `WorkbenchShell.tsx` command list, `Ribbon.tsx` `MENU_GROUPS` and `paletteOnly`; export/open JSON (`repobs-export` v1) |

Verification (2026-10-31, this machine): typecheck, lint and build exit 0; `npm test` 16 files / 135 tests passed; `npm run test:e2e` 26 passed, 1 skipped (docs screenshot, regenerated); `npm run docs:build` exit 0. Screenshots checked: two views with different repository selections, View menu sections, no console errors.

Unknown: narrow-window overlay panels (unchanged). Opening a file replaces views without a confirmation step; annotations merge as with Settings → Import.

## Checkpoint 11 — 2026-10-31: chevron for spawned agents, timeline cards (ADR 0003, eighth review)

| Request | Implementation |
| --- | --- |
| The chevron should not expand agent details; only agents with subagents get one, and it shows them | `layout.ts`: `collapseSpawned` + `toggledAgents` options, `childCount` / `expanded` on session rows; `AgentRow.tsx`: chevron with count only when `childCount > 0`, inline details block removed; view state `collapseSpawned` (default on) and `toggledAgents` replace `details`, `showSpawned`, `expandedAgents` (old keys dropped on load) |
| No agent expansion with info on the dashboard | *Expand agent details* removed from the Agents dropdown and View menu; details stay in the hover card and details panel |
| Name and status (editable dropdown) at the timeline end, in a card like the left one | `RepoBoard.tsx` `BarCards` / `BarCard`: HTML cards above the lanes with provider mark, name, age and `ReviewMenu`; lanes SVG marked `data-lanes` |

Verification (2026-10-31, this machine): typecheck, lint and build exit 0; `npm test` 16 files / 130 tests passed; `npm run test:e2e` 24 passed, 1 skipped (docs screenshot, regenerated); `npm run docs:build` exit 0. Screenshots checked: a collapsed parent shows "› 2", expanded shows the indented children, timeline cards sit before the bars near the axis end; no console errors.

Unknown: unchanged (narrow-window overlay panels).

## Checkpoint 10 — 2026-10-31: filter bar as dropdowns (ADR 0004, decision 5)

| Request | Implementation |
| --- | --- |
| Filter controls are all over the place; collapse them into a few dropdowns | `components/Dropdown.tsx` (menu of check/radio sections, or a panel); `FilterBar.tsx` regrouped into Harness, Status, Last message, Tags (filters) and Branches, Agents, Timeline, Legend (view options), each group wrapping as a whole |
| Harness should be a multi-select dropdown | `filters.harnesses: Provider[]` (empty = any) with `PROVIDER_LABELS` in contracts; old stored `claude`/`codex` switches migrated in `loadView` |

Verification (2026-10-31, this machine): typecheck, lint and build exit 0; `npm test` 16 files / 129 tests passed (new `viewState.test.ts`); `npm run test:e2e` 24 passed, 1 skipped (docs screenshot, regenerated). Screenshots of every open dropdown checked at 1500 px wide with both side panels open: filters on one line, view options on the next; no console errors.

Unknown: unchanged (narrow-window overlay panels).

## Checkpoint 9 — 2026-10-30: reference UI alignment (ADR 0004)

| Request | Implementation |
| --- | --- |
| Panel titles not in a mono font | `--label-*` tokens (sans, sentence case, 12 px semibold) for `.label`, section strips, table headers, filter labels, status bar, menus, buttons and badges; mono kept for identifiers |
| Borrow the ribbon content | `Ribbon.tsx`: Repositories / View / Tools menus with checks, submenus and shortcuts; *Search commands* (Ctrl+K) command palette; icon buttons; one command list in `WorkbenchShell.tsx` |
| Adjustable dockable flexible layout | `flexlayout-react` 0.11.0 (pinned); `dockLayout.ts` (default model, validated restore, toggle/show panel, maximize that collapses side bars, reset) and `dock.css` (repobs theme) |

Also: raised buttons and well-style fields (control grammar), overlay scrollbars.

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 15 files / 127 tests passed; `npm run test:e2e` 24 passed, 1 skipped (docs screenshot, regenerated); `npm run docs:build` exit 0. Manual check in Edge: dragging the Details tab beside the dashboard docks it, the empty side bar shows its drop hint, no console or CSP errors. Integration suite not rerun (no backend change).

Unknown: narrow windows (under ~1100 px) — the reference switches side panels to overlays there; repobs does not yet.

## Checkpoint 8 — 2026-10-30: seventh review — agent labels on the timeline (trial)

| Request | Implementation |
| --- | --- |
| Agent info next to the end of its work in the chronology, as a mode enabled or disabled separately from the left column | `barLabels` and `agentNames` in the view state, each a filter-bar checkbox (both on by default). `RepoBoard.tsx` draws name · status · age after each bar (flipped before the bar near the axis end, with a halo over crossing lines); without names in the list the column narrows to `LABEL_W_NARROW` (230 px) and cards keep provider mark, tree and status menu |

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 14 files / 124 tests passed; `npm run test:e2e` 23 passed, 1 skipped (docs screenshot, regenerated); `npm run docs:build` exit 0. Integration suite not rerun (no backend change).

Unknown: label width is estimated from the character count (6.2 px per character), so a label can still run slightly past the axis end with wide glyphs; not seen on the demo.

## Checkpoint 7 — 2026-10-30: sixth review — quiet commits are Git-quiet

| Request | Implementation |
| --- | --- |
| Collapse quiet commits folded almost nothing on a real repository | `groupQuietCommits` (`layout.ts`) no longer treats agent activity as eventful; only tips/heads, fork and merge endpoints, merges and first own commits stay visible |

Observed on the owner's instance (counts only): `energyatlas-mcp` `main` had 77 of 83 commits inside some agent's first-to-last-message span (sessions of up to 308 hours), so only one run of 5 folded; now 6 commits stay visible and two runs (60 and 18) fold.

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 14 files / 124 tests passed; `npm run test:e2e` 22 passed, 1 skipped (docs screenshot); `npm run docs:build` exit 0. Integration suite not rerun (no backend change).

## Checkpoint 6 — 2026-10-30: fifth review — compressed calendar axis

| Request | Implementation |
| --- | --- |
| Commits collide in calendar mode; try a calendar mode that only shrinks the space between elements, keeping a minimum distance | New axis mode *Calendar, compressed* (`compressedAxis` and `rankedTicks` in `timeline.ts`): gaps are `max(22 px, elapsed × scale)`, zoom scales only the time part; agent activity interpolates between items; saved views accept the new mode |

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 14 files / 124 tests passed; `npm run test:e2e` 22 passed, 1 skipped (docs screenshot); `npm run docs:build` exit 0. Integration suite not rerun (no backend change). Visual check on the demo: the ten scratch commits made seconds apart overlap in *Calendar time* and sit 22 px apart in *Calendar, compressed*.

## Checkpoint 5 — 2026-10-30: fourth review (ADR 0003 amendment)

| Request | Implementation |
| --- | --- |
| Subagent topology lines poorly designed; indent cards by level; drop coloured left edges | Agent rows are cards offset by spawn depth (`AgentRow.tsx`); tree guides (`pipe`/`tee`/`last` plus a stub under parents) are computed per row in `layout.ts` and drawn in the gutter, continuous across rows; the status stripe and the selected-row inset stripe are gone |
| "Unreviewed" sessions shown as "Ready" | Workflow status `ready` renamed `unreviewed` (neutral tone; `complete` is now success); saved status filters migrate |
| Change review state from the dashboard and the popup | `ReviewMenu.tsx`: the status badge opens a keyboard-operable review menu on rows and in the (now interactive) agent hover card |
| Overlapping/intersecting connectors indistinguishable | `routing.ts` assigns parallel tracks to overlapping collinear legs (metro style); unit-tested |
| Horizontal zoom | `zoom` in view state and `buildTimeline`; buttons on the axis, Ctrl + wheel anchored at the pointer, +/−/0 keys |

Also fixed: lanes scrolled under the sticky label column showed through the 1 px row borders. The demo gives the feature-branch agent a second subagent.

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 14 files / 123 tests passed; `npm run test:integration` 6 files / 73 tests passed; `npm run test:e2e` 22 passed, 1 skipped (the docs screenshot, regenerated separately with `REPOBS_DOCS_SCREENSHOT=1`); `npm run docs:build` exit 0. Backend unchanged except the shared `WorkflowStatus` contract.

Unknown: with many branches leaving one commit (more than 9) tracks are reused, so some lines still overlap; not seen on real data yet.

## Checkpoint 4 — 2026-10-30: third review

| Request | Implementation |
| --- | --- |
| Branch connectors looked like free-form curves | Orthogonal paths with rounded corners (`elbow()` in `RepoBoard.tsx`): forks drop from the base commit then run to the branch; merges run along the branch then turn into the merge commit; branch pointers likewise |
| Optionally collapse commits where nothing happens | *Collapse quiet commits* (off by default): runs of 2+ commits on one branch without a head, fork, merge, first own commit or (until checkpoint 7) agent activity within 5 minutes become a counted pill taking one axis column (`groupQuietCommits` in `layout.ts`); hover lists them in an interactive card where each commit can be inspected; click expands the run; re-ticking re-collapses |

The demo (`scripts/demo.ts`) now gives `claude/scratch-a8de` ten commits so there is a run to collapse.

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 13 files / 116 tests passed; `npm run test:integration` 6 files / 73 tests passed; `npm run test:e2e` 20 passed (Edge); `npm run docs:build` exit 0. Backend unchanged in this round.

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
