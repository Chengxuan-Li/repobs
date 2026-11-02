# Status semantics

repobs separates two things that are easy to conflate:

1. **Observed execution state** — what the agent process appears to be doing, as far as local evidence shows.
2. **Human review state** — what *you* (or an automation rule you set up) decided about the work (Unreviewed, Needs review, Reviewed, Complete, Flagged, Outdated).

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
| Error | The provider recorded an error event (for Claude Code, a failed API call such as a run that could not sign in), and no prompt has followed it. |

## Evidence and confidence

Every state carries a **source** (e.g. `claude.session-registry`, `claude.transcript`, `codex.rollout`, `codex.state-db`), the **time of the evidence**, a structural **reason**, and a **confidence**:

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
- **Metadata is not a state.** A Codex thread known only from Codex's state database (no readable rollout) is *Unknown* with the reason *only thread metadata is available* (source `codex.state-db`), however recently Codex updated it ([ADR 0011](decisions/0011-codex-compressed-rollouts-and-state-database.md)).

## What repobs cannot see

- Live approval prompts of Codex sessions are only visible if Codex writes an approval request record to its rollout file; passive log reading cannot prove an approval wait in every case.
- repobs does not start a Codex app-server and does not claim to observe independently running Codex processes.
- Claude Code hooks (`PermissionRequest`, `Stop`, …) could give more precise events, but repobs never installs hooks automatically. See [Integrations](integrations.md).
- A process id from the Claude registry could in rare cases be reused by an unrelated process; liveness is therefore treated as evidence, not proof.

## Workflow status on cards and filters

Dashboard cards and the *Status* filter combine the observed state with your review state into one workflow status (defined once in `packages/contracts`):

| Workflow status | When |
| --- | --- |
| Needs input | Awaiting approval / input, an error, or a pending tool call that may be waiting for permission (not for historical sessions) |
| Working | Running or running subagents |
| Flagged | You marked it *Flagged* |
| Needs review | You marked it *Needs review* |
| Reviewed | You marked it *Reviewed* |
| Complete | You marked it *Complete* |
| Outdated | You marked it *Outdated* (no longer relevant) |
| Unreviewed | Idle / turn finished or ended, and you have not reviewed it (neutral colour: finishing is not a result) |
| Unknown | Anything else (including stale evidence) |

Clicking the status on a dashboard card (or in its hover card) opens a menu that sets your review state; the observed state is never changed by it.

Agent activity that needs a person wins over your review state, so a session you marked complete shows *Working* again if it starts a new turn. Otherwise every review state shows as itself, so the card always agrees with the details panel. *Needs input*, *Flagged* and *Needs review* count as needing attention in the status bar and the repository list.

An automation rule can set the review state (for example *Outdated* after a week without activity). It does so once per version of the rule, like an edit you make, and the details panel names the rule; it never changes the observed state. Rules use only the evidence listed above: an agent whose last activity is unknown never matches a time condition.
