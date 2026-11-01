# 0009 — Agent plans in checklists

- Status: accepted (owner request, 2026-11-01). Tried on `feature/chat-extraction` against the owner's own sessions, approved by the owner and merged into `main` the same day.

## Context

Agents keep step lists with their own planning tools. The owner asked repobs to extract these sequenced steps (stage, plan, phase, step, task) from sessions and keep them as checklists, without an extra LLM layer.

A survey of the owner's machine counted tool names and field shapes only, no text:

- **Claude desktop app's task list:** `mcp__ccd_turn__update_plan` appears in 69 of about 900 Claude transcripts, with about 2,700 updates. About 40 % of the updates are full lists. The rest are steps: *advance* to the next item, or mark items *done* and *start* another.
- **Not seen on that machine:**
  - Claude Code's `TodoWrite`;
  - plan mode (`ExitPlanMode`);
  - Codex `update_plan`, in 9 rollouts.

  These are still supported, with synthetic fixtures.

## Decision

### What is read

- **Structured plan tool calls only**, replayed in transcript order by `apps/server/src/sessions/plan.ts`:

  | Tool | Treatment |
  | --- | --- |
  | Claude desktop task list: `mcp__ccd_turn__update_plan` with `items`, `advance`, or `done` plus `start` | full lists replace the plan; *advance* and *done/start* are replayed |
  | `mcp__ccd_turn__wrap_up` | completes the step in progress; open steps stay open |
  | Claude Code `TodoWrite` | each call is a full list |
  | Claude Code `TaskCreate` / `TaskUpdate` (local fix under review, 2026-11-01) | correlate calls with successful structured tool results; create by returned id, then replay confirmed status/subject changes and deletions |
  | Codex `update_plan` | each call is a full list |

- **No guessing:**
  - Steps without a full list before them give no plan.
  - Unknown statuses read as pending.
  - Free chat text is not interpreted.
- **Claude Code tasks:** `sessions/claude-plan.ts` correlates `tool_use.id` with `tool_result.tool_use_id`. Creation requires a successful `toolUseResult.task` with a returned id. Updates require a matching, successful result; status changes come from the reported change (or explicitly updated status field), and subject edits require the result to confirm that field. Dependency-only updates do not change the checklist. Failed, unconfirmed, unrelated and ambiguous batched results are ignored. Updates without a known creation never invent a task. A new successful creation can reuse an old task id and replaces that item. At most 100 known tasks and 100 pending requests are retained; only subjects, ids and statuses are kept. Task source is `claude_tasks`, shown as *Claude Code tasks*. A full-list replacement switches back to the corresponding plan source and clears the known task items.
- **Long transcripts:** when the reader skipped the middle of a transcript and its tail holds no full list, it scans backwards (prefiltered by planning tool names and, for Claude, structured tool-result envelopes, up to 64 MB). A full list stops recovery; otherwise known task creations and updates within the bound are replayed. This also applies to subagent transcripts and skipped large appends. Creations outside the bound cannot be reconstructed; a task list may contain only the known tasks. No completeness or cross-session task synchronization is claimed.

### Two sections in one checklist

- The agent's plan comes first, fully synced from the agent. Your own items follow. The two never interfere.
- The agent never changes your items.
- You can tick or untick the agent's items. Your choice overrides the agent's status in repobs only and never reaches the agent. Choosing the agent's own status again removes the override.
- The dashboard pill counts both sections: done/total, with the pie. Its list, the details panel's *Agent plan* section and the hover card show the agent's source, steps in progress, and your overrides (*ticked by you*, *unticked by you*).

### Privacy and ownership

- **Plan text** is the agent's: it is held in memory only (`AgentSession.plan`), like message excerpts, and never written to the database, logs or exports.
- **Your overrides** are stored in the annotation (`planOverrides`, migration 3) by item key: a hash of the item's text and occurrence. The text itself is not stored.
- Edits that don't send overrides keep them.
- Settings → Privacy → *Read agents' plans into their checklists* (on by default) turns reading off.

## Consequences

- **Reworded steps:** an item whose text the agent changes is a new item; an override on the old text no longer applies.
- **Automation:** checklist conditions and actions still act on your items only.
- **Forked sessions:** a forked Claude session carries its parent's session id in its records, so repobs shows it as that session. Its plan appears there (existing behaviour, not changed here).
- **Version fragility:** the task-list tool belongs to the Claude desktop app and may change between versions. An unrecognised format gives no plan rather than a wrong one.
- **Not done yet:**
  - plan-mode documents;
  - checkbox (`- [ ]`) parsing of agent messages;
  - timeline marks for step changes;
  - chapter marks as phases.
