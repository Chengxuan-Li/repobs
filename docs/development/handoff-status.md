# Handoff progress

Dated implementation checkpoints against the [product handoff](product-handoff.md). Conversation memory is not project state; this page is.

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
