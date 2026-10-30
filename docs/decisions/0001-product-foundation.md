# 0001 — Product foundation

- **Status:** Accepted (owner decisions in the product handoff, 2026-10-30)
- **Source:** [Product handoff](../development/product-handoff.md), section 1

## Decisions

The owner settled these product decisions; they are not reopened during implementation:

1. **Name and shape.** `repobs`, a local-first, multi-repository, read-only Git and coding-agent observability dashboard, delivered as a Node.js loopback service with a browser UI. Windows 11 with native paths is the primary platform.
2. **Tree-first information architecture.** Repository → branch → worktree → zero or more sessions, with auxiliary groups for remote-only refs, detached HEADs and unassigned sessions. Many sessions per worktree are normal.
3. **Metadata-focused agent observation.** Claude Code and OpenAI Codex sessions are observed from local metadata (identity, provider, activity, timestamps, working directory, structural activity labels) — not a transcript viewer, not an agent controller.
4. **Read-only Git.** No fetch, pull, push, checkout, branch/worktree changes, reset, merge, rebase, stash, commit or staging. App-local writes are limited to repobs' own registrations, settings and annotations.
5. **Stack and docs.** TypeScript/Node backend, React + TypeScript + Vite frontend, shared zod contracts; MkDocs documentation built and deployed to GitHub Pages by GitHub Actions (documentation only).

Further fixed points: event-driven updates with self-healing polling; human notes and review states authored only in repobs; a future VS Code extension would be a thin client and is not part of v1.

## Consequences

- Every Git invocation goes through an allowlist of read-only inspections, and tests prove `.git` is not modified by scanning.
- Agent status must always carry evidence and confidence; when evidence is missing the UI says *unknown*.
- Annotations are keyed by stable provider session ids and survive disappearance of sessions, worktrees and repository registrations.
- Out of scope for v1: agent execution or approvals, Git mutation, LLM features, cross-machine monitoring, commit graphs, transcript reading, embedded terminals, required GitHub use, automatic hook installation.
- Later changes to these decisions are recorded as new ADRs in this folder.
