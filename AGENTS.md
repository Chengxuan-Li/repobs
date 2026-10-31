# repobs — Agent operating instructions

Read `docs/development/product-handoff.md`, `docs/decisions/0001-product-foundation.md`, and `docs/development/handoff-status.md` before substantial work. This repository is a Windows-first, local-first Git worktree and coding-agent observability dashboard. Source control, provider data and personal annotations have separate ownership; never mix them.

## Authority and scope

- The handoff's approved decisions are authoritative: name `repobs`, tree-first UI, Claude Code + Codex metadata observation, read-only Git, TypeScript/Node backend, React/Vite frontend, MkDocs Pages docs.
- Build the app, tests, fixtures, documentation and deployment workflows. Do not implement Git mutations, agent execution, model calls, cross-machine monitoring or VS Code extension without an explicit new decision.
- Never modify external reference repositories. EnergyAtlas UI is a visual reference only.
- No automatic installation of hooks or edits to Claude/Codex configuration. Do not send agent transcript content to third-party services.

## Git safety and working discipline

- Inspect `git status --short --branch` and relevant files before edits; preserve pre-existing changes.
- Small focused commits with tests and updated docs are authorized when the current repository is clean enough. Do not hard reset, force push, delete branches, rewrite history, or discard changes. Do not create/push remotes without explicit instruction.
- Preserve configured human Git identity; never invent author details or add agent/model co-author trailers.
- Examine staged diff for private paths, transcripts, secrets, credentials and generated state before each commit.
- All application Git calls must be allowlisted **read-only inspections** and invoked using argv without a shell. Never execute mutating Git commands against monitored repos.

## Architecture and quality

- Source-of-truth domain contracts in `packages/contracts`; keep Git reader, Claude adapter, Codex adapter, reconciliation, persistence, HTTP API and UI independent.
- Each user-facing status needs source/evidence/confidence; never infer “waiting approval” from mere inactivity or last modified time. Prefer `unknown` over false certainty.
- Multiple sessions per worktree, local-only scratch branches, detached HEAD, and missing/unassigned worktrees are first-class cases.
- App-local annotations survive agent and worktree disappearance and are never written into transcripts or repos.
- Enforce localhost security, validation, safe process spawning, private app storage and opt-in network integrations.
- Keep UI consistent with the EnergyAtlas-derived design audit; do not copy unrelated energy application features.
- Documentation-site styling (`mkdocs.yml` theme, `overrides/`, `docs/assets/stylesheets/`, landing-page layout) follows `design/docs-ui-spec.md`; its section 0 wins over the rest. `design/` is versioned but not published; the vendored fonts in `docs/assets/fonts/` are hand-maintained copies of the app's pinned `@fontsource-variable` files.
- Use synthetic fixtures in automated tests. Never commit real session histories or user repository snapshots.
- Cover empty, loading, success, stale, permission-denied, disconnected and error states; no silent no-op controls.

## Verification and continuity

- Prefer a tested vertical slice over a broad mock. Run relevant typecheck, lint, tests, integration/e2e and MkDocs checks; log exact commands and outcomes.
- Record major choices in `docs/decisions/`; update `docs/development/handoff-status.md` after meaningful steps with what works, what was tested, what is unknown, and the next action. Conversation memory is not project state.
- When an installed Claude/Codex version lacks an expected feature, document observed behavior and ensure the UI reports partial/unknown state without failure.
- Finish with precise, reproducible Windows commands and note any unverified claims. Never say a suite passed unless it ran successfully.
