# 0013 — Agent activity: steps, tools and tokens

- Status: accepted (owner request, 2026-11-02). Implemented on `feature/agent-activity`.
- Extends [ADR 0001](0001-product-foundation.md) (metadata-only agent observation, read-only sources) and [ADR 0003](0003-dashboard-commit-graph-and-excerpts.md) (agent bars on the shared axis). Privacy follows the same rule as excerpts and plans: derived in memory, never stored.

## Context

An agent's bar shows when it was active, not what it did. The owner asked to see what happens inside each agent — tool calls, Git and system commands, reasoning and waiting — and how many tokens it used, with a summarized default and a more detailed view that turns itself on when zoomed in.

A read-only survey of the owner's machine (2026-11-02; key names, enum values and counts only) found:

- **Claude Code** (952 transcripts, 650,000 records): 112,869 `tool_use` blocks, each answered by a `tool_result` with `is_error` (2,840 errors); 73,415 `thinking` blocks; every assistant record has `usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`); `system` records mark compactions (`compact_boundary`) and API errors. Tool names: `Bash` (85,763), `Edit`, `Read`, `Write`, `PowerShell`, `Grep`, `Agent`, `WebFetch`, MCP tools (`mcp__<server>__<tool>`) and others. `Bash` and `PowerShell` carry the command in `input.command`.
- **Codex** (314 rollouts): `response_item`s `reasoning` (33,807), `custom_tool_call` / `function_call` with outputs by `call_id`; the shell tool is `exec` with the command as a free-form string; outputs are content arrays with **no exit code**. `event_msg` `token_count` carries `last_token_usage` (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`) and `model_context_window`.

## Decision

### Two levels of detail

1. **Default: tool ticks.** Each drawn agent bar carries a thin tick for every recorded tool call, all in one ink: when the agent was busy with tools, nothing about which.
2. **Activity detail** (*Agents → Activity detail*: *Auto*, *Always*, *Off*; *Auto* by default). In *Auto* it turns on at 300 % zoom and above. Agent rows grow taller and show, under the bar:
   - a band of model spans (darker with thinking) and tool spans; failed calls underlined; prompts, compactions and errors as marks;
   - Git as shapes: ◆ a change (`git commit`, `push`, …), ○ an inspection (`status`, `diff`, …);
   - a context-fill band: tokens in the model's context at each response.
3. **Summary** in the agent's hover card and the details panel, at any level: tool calls by category and failures, the top command verbs, model and tool time, input (and the share from cache), output and reasoning tokens, current and peak context, compactions.

Colour follows the dataviz method: three hues only — *Read and search* (blue), *Edit* (orange), *Shell, Git, tests and builds* (aqua) — with everything else neutral. The three pass the palette checks with all pairs compared in both themes (worst CVD ΔE 9.2 light, 9.4 dark); four or more did not. Git is carried by shape and tests and builds by hatching, so no identity depends on colour; light-mode aqua is under 3:1 against white, so every step is also named in text (legend, hover card).

### What is read

From the session's own transcript files, on demand, for the agents a view draws:

| Field | Source | Kept |
| --- | --- | --- |
| Times | record timestamps | start and end of each step |
| Tool | tool name | the name; MCP tools as `mcp:<server>` |
| Category | tool name, and for shell tools the command | one of the categories below |
| Command verb | shell command, in memory | only allowlisted programs and subcommands, e.g. `git commit`, `npm test`, `npx vitest`, `pytest`; anything else is dropped |
| Outcome | Claude `is_error` | failed or not; unknown for Codex |
| Reasoning | Claude `thinking` blocks, Codex `reasoning` items | presence and time only, never text |
| Tokens | Claude `usage` per response (deduplicated by message id), Codex `token_count` | input, cache read, cache write, output, reasoning; context window when recorded |

**Never kept or sent:** prompts, replies, thinking or reasoning text, tool inputs (paths, patterns, URLs, command arguments), tool outputs. The command string is classified in memory and discarded. Program names outside the allowlist are not reported.

Categories: *Read*, *Search*, *Edit*, *Shell*, *Git: inspect*, *Git: change*, *Test or build*, *Web*, *Agents*, *Plan*, *Question to you*, *MCP*, *Other*. A shell command is classified by its most significant part: any Git change wins, then tests and builds, then Git inspection, else *Shell*. Unknown Git subcommands are *Git: inspect* with their verb shown.

### Bounds

- Read on demand (`GET /sessions/{id}/activity`) for the agents a view draws, never for the whole snapshot; cached per session until its files change.
- At most 24 MiB from the end of each file (plain or decompressed), 4,000 steps and 2,000 token samples, latest first; a result over a bound says it is truncated.
- At most two sessions are parsed at a time.
- Setting *Privacy → Read agents’ activity* (on by default) turns it off: the endpoint then answers *disabled* and no transcript beyond the status fields is read.

### Not claimed

- Waiting for permission is not shown as a step: the logs cannot tell it apart from a running tool (checkpoint 40).
- Model time is the gap between records, not measured generation time; it is labelled as such.
- Codex tool outcomes are unknown; repobs does not parse their output text for exit codes.
- Steps are placed on the shared axis like any time. In *Commit order* an agent's bar spans its own columns, which widen with zoom; in *Calendar, compressed* the minimum gap does not, so a short-lived agent's detail stays narrow there. *Calendar time* gives steps their real proportions.

## Consequences

- The default dashboard stays light: one fetch per drawn agent, ticks only.
- The detail adds a category palette to the legend; it must stay readable in both themes and at 300 % zoom.
- New providers or tool names fall into *Other* until mapped; a new allowlisted verb is a code change with a test.
