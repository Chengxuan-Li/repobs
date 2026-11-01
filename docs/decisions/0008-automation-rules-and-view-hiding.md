# 0008 — Automation rules change annotations; views decide visibility

- Status: accepted (owner request, 2026-10-31)

## Context

Review states were collapsed on the dashboard: *Reviewed* showed as *Complete* and *Flagged* as *Needs review*, so the card and the details panel disagreed. The owner also asked for:

- automatic labelling, for example marking agents whose last message is more than seven days old;
- a way to hide agents;
- checklist progress on the dashboard.

The owner set the boundary between labelling and hiding:

- **Labelling** changes stored data, so it is an automation.
- **Hiding** only narrows what one view shows, so it is a view filter.

## Decision

### Review states and workflow status

- A new review state, **Outdated**, means *no longer relevant*.
- The workflow status shows every review state as itself: *Flagged*, *Needs review*, *Reviewed*, *Complete* and *Outdated*.
- Agent activity still comes first: *Needs input* and *Working* win over any review state.
- *Flagged* counts as needing attention, like *Needs review* and *Needs input*.

### Automation rules

- Rules are kept in the app database (migration 2: `automation_rules`, `automation_applied`) and edited in an **Automation** panel.
- A rule has a name, an on/off switch, conditions (*all* or *any* must hold) and actions.
- **Conditions:**
  - time since the last activity (older than, or within, N hours or days);
  - text containing, not containing or equal to a keyword (case-insensitive) in the title, alias, note, tags, repository name, branch, agent type or latest message excerpt;
  - review state;
  - a tag being set or not;
  - harness;
  - live or finished;
  - checklist all ticked, has open items, or empty;
  - spawned by another agent or not.
  - Unknown values never satisfy a time or activity condition.
- **Actions:**
  - set the review state;
  - add or remove a tag;
  - set the alias;
  - append to the note;
  - add a checklist item (skipped if the same text exists);
  - tick checklist items (all, or those containing a text);
  - remove ticked items.
- **Writes** go to the same annotation store as your own edits, through the same validation. A rule never touches Git, provider files, transcripts or the network.
- **Once per revision:** a rule applies to each agent at most once per *revision*. Changing its conditions or actions starts a new revision, which applies afresh; renaming it or switching it on and off does not. So your own edit after a rule ran sticks.
- **When rules run:** the monitor applies enabled rules, in order, after each session rescan and after annotation or rule changes. Age-based conditions take effect at the next rescan after the age is reached.
- **Preview:** the editor shows how many agents a rule matches now before you save it. Up to ten names appear in the count's tooltip. When editing a saved rule, the editor also shows how many agents its current revision already changed: a rule whose action alters a field its conditions test stops matching the agents it changed.
- The details panel names the rules that were applied to an agent.
- **Deleting a rule** keeps the changes it made.
- **API:**
  - `GET`/`POST /automation/rules`;
  - `PUT`/`DELETE /automation/rules/{id}`;
  - `POST /automation/preview`;
  - `GET /sessions/{id}/automation`.

### Hiding from a view

- Each view's filters gain a **Hidden** dropdown with two kinds of hiding:
  - *Hide agents marked* one or more review states (an agent without notes counts as *Unreviewed*);
  - agents hidden by hand with **Hide from this view** in the status menu, listed there with *Show* and *Show all*.
- Hiding is per view and per browser (like every view setting) and never changes an agent's annotation.

### Checklists and floating cards

- The dashboard card and the timeline card show a rounded **done/total** pill beside the status when the agent has a checklist. A pie at its left fills clockwise with the share done. The pill is coloured from the theme's tones: info while items are open, success when all are done, neutral before any is.
- Hovering or clicking the pill opens one list, a small dialog where items can be ticked and unticked. Opened by hover it closes shortly after the pointer leaves the pill and the list; opened by a click it stays until Escape or a click elsewhere. Annotation summaries carry the checklist items for this.
- Hovering an agent's card on the timeline shows the same agent details card as hovering it in the label column.
- Hover cards, the pill list and the status menus are placed against the element that opened them, never the pointer. Wide elements (agent bars) use the point where the pointer entered. Cards flip or shift only to stay inside the window.

## Consequences

- A database opened by this version is at schema 2. An older repobs refuses it, as for every forward migration, and a backup is written before migrating.
- Older builds also cannot read the *Outdated* review state.
- Rules act on agents in registered repositories and annotated orphans: the agents the monitor knows. They do not run while repobs is stopped; they catch up at the next start.
- A rule matching many agents changes them all at once. The preview count before saving is the safeguard; there is no undo beyond editing the agents or importing an earlier annotation export.
