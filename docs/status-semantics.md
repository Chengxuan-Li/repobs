# Status semantics

repobs separates two things that are easy to conflate:

1. **Observed execution state** — what the agent process appears to be doing, as far as local evidence shows.
2. **Human review state** — what *you* decided about the work (Unreviewed, Needs review, Reviewed, Complete, Flagged).

They have no causal relationship. A session can be idle and still need your review; a running session can already be reviewed.

## Observed execution states

| State | Meaning |
| --- | --- |
| Running | Evidence of an ongoing turn. |
| Running subagents | The main turn ended, but a subagent shows recent activity. |
| Awaiting approval | The provider *recorded* an approval request that has not been followed by further activity. |
| Awaiting input | The provider recorded a request for user input. |
| Idle / turn finished | The last turn completed or was interrupted, or the provider reports the session idle. |
| Ended | The provider's live-session registry points to a process that is no longer running. |
| Unknown | Not enough evidence. **Missing data is unknown, never idle.** |
| Error | The provider recorded an error event. |

## Evidence and confidence

Every state carries a **source** (e.g. `claude.session-registry`, `claude.transcript`, `codex.rollout`), the **time of the evidence**, a structural **reason**, and a **confidence**:

- **Direct** — reported by the provider itself. Today this is Claude Code's live-session registry (`busy` / `idle`) for sessions whose process is running on this machine.
- **Inferred** — derived from local session records (turn started, tool call recorded, turn completed, …).
- **Unknown** — nothing reliable.

## Rules repobs follows

- **Inactivity is never "waiting for approval".** A quiet session is quiet, not blocked.
- **File modification time never proves anything.** A recently written file is not shown as green or "done"; running is shown in the info color, not the success color.
- **A pending tool call is ambiguous.** When the latest record is a tool call without a result, the tool may be executing *or* waiting for your permission. repobs shows *Unknown · tool pending* (or *Busy · tool pending* when the provider reports busy), lists it in the Attention filter, and says it cannot tell which.
- **Stale evidence is downgraded.** Inferred *running* / *waiting* evidence older than the stale threshold (Settings, default 30 minutes) becomes *Unknown — stale evidence*. A completed turn stays *Idle / turn finished*, since that is a fact about the last record.
- **Historical** sessions are those without activity for longer than the historical threshold (default 24 hours) and not reported live by the provider.
- **Provider-reported states repobs does not recognize** are shown as *Unknown* with the reason *provider reported a status repobs does not recognize*.

## What repobs cannot see

- Live approval prompts of Codex sessions are only visible if Codex writes an approval request record to its rollout file; passive log reading cannot prove an approval wait in every case.
- repobs does not start a Codex app-server and does not claim to observe independently running Codex processes.
- Claude Code hooks (`PermissionRequest`, `Stop`, …) could give more precise events, but repobs never installs hooks automatically. See [Integrations](integrations.md).
- A process id from the Claude registry could in rare cases be reused by an unrelated process; liveness is therefore treated as evidence, not proof.
