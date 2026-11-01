# 0009 — Agent plans in checklists

- Status: accepted for experimentation on `feature/chat-extraction` (owner request, 2026-11-01)

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
  | Codex `update_plan` | each call is a full list |

- **No guessing:**
  - Steps without a full list before them give no plan.
  - Unknown statuses read as pending.
  - Free chat text is not interpreted.
- **Long transcripts:** when the reader skipped the middle of a transcript and its tail holds no full list, it scans backwards (prefiltered by the tool names, up to 64 MB) for the latest full list and replays from there.

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
