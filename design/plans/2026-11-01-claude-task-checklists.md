# Claude task checklist fix

**Goal:** Show Claude Code `TaskCreate` / `TaskUpdate` tasks in the existing agent checklist on `codex/claude-task-checklists`, for local owner review before any PR.

**Design:** Extend ADR 0009's structured-tool replay. Match successful task results to tool calls, use returned task ids, and replay status/subject changes and deletions without guessing ids or reading plan documents. Keep task text in memory and human overrides unchanged. A dedicated Claude reader owns request/result correlation and bounded task state, alongside the existing full-list plan tracker. Recover bounded earlier records after a transcript jump, including for subagents. The plan lives in `design/` so internal implementation notes are not published.

**Approaches:** Parsing free-text plans would broaden scope and infer state. Reading Claude's separate task storage would introduce another source and ownership/lifecycle rules. Replaying the observed transcript tools fits the existing adapter and is the selected local proposal.

## Implementation plan

- [x] Add synthetic regression coverage for successful creation/result correlation, updates, failures, missing creation, duplicates, deletion, privacy, long transcripts, and subagent isolation. Run the tests and confirm the missing behavior fails.
- [x] Add the Claude record reader, bounded recovery, and a distinct source label. Keep all prior planning formats working.
- [x] Verify the task list through the built UI with synthetic data; run typecheck, lint, unit/web tests, integration, build, e2e and strict docs checks. Reinspect local sources read-only, reporting counts only.
- [x] Update ADR 0009, integration documentation, changelog and handoff evidence. Leave the branch local and the PR unopened until the owner's approval.

## Review focus

- Results must match a planning request; failed or unrelated results must not create or complete tasks.
- Updates without known creations must not invent a checklist item.
- Skipped transcript records must not lose creations needed by later updates; source reads remain bounded.
- A subagent's tasks must remain separate from its parent's; replacement/truncation must discard stale state.
- Turning plan reading off must remove plan text while keeping human checklist items and overrides intact.
