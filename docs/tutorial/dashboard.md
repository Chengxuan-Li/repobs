# Read the dashboard

Each repository is a section of the dashboard. Its branches are rows on the left, with the agents that worked on each branch under it. The history runs from left to right, with **now** at the right edge.

![A repository: branch rows with their agents on the left, commits and agent lines on the timeline](../assets/tutorial/dashboard-repository.png#only-light){ loading=lazy }
![A repository: branch rows with their agents on the left, commits and agent lines on the timeline](../assets/tutorial/dashboard-repository-dark.png#only-dark){ loading=lazy }

## Branches and commits

- **One row per branch.** The checked-out branches come first, then the other local branches, detached worktrees and *Unassigned sessions*.
- **The label says how a branch relates to another:** *from main* (it started from `main`), *→ main* (it was merged into `main`), *at main* (it has no commits of its own and points at a commit on `main`).
- **Commits are dots on the branch's row.** Lines connect each commit to its parent; a fork drops from the commit it started from, a merge turns into the merge commit.
- **The style of a dot shows where the commit is:**
    - filled: pushed;
    - hollow amber with a dashed line: only on this computer;
    - grey dashed: on the upstream, not pulled yet.
- **A dashed diamond** after a branch head means uncommitted changes in its worktree (red: conflicts).

Hover a commit for its message, id, date and push state:

![A commit's hover card: message, id, date and push state](../assets/tutorial/dashboard-commit.png#only-light){ loading=lazy }
![A commit's hover card: message, id, date and push state](../assets/tutorial/dashboard-commit-dark.png#only-dark){ loading=lazy }

Hover a branch label for its upstream and worktree, and a diamond for the changed files.

## Fold quiet commits

Long runs of plain commits can take a lot of room. Choose **Branches → Collapse quiet commits** to fold each run into one pill with a count. Hover the pill to list its commits; click it to show them again.

![A pill folding eight quiet commits, with its list of commits](../assets/tutorial/dashboard-quiet.png#only-light){ loading=lazy }
![A pill folding eight quiet commits, with its list of commits](../assets/tutorial/dashboard-quiet-dark.png#only-dark){ loading=lazy }

## Choose the timeline

The **Timeline** menu sets how history is spread out and how far back it goes.

![The Timeline menu: axis modes and history range](../assets/tutorial/dashboard-timeline.png#only-light){ loading=lazy }
![The Timeline menu: axis modes and history range](../assets/tutorial/dashboard-timeline-dark.png#only-dark){ loading=lazy }

- **Commit order:** commits and agent starts and ends, evenly spaced in the order they happened. Dates are labels, not distances. Best for following what happened when.
- **Calendar time:** distances are proportional to elapsed time. Best for seeing how long agents worked.
- **Calendar, compressed:** like calendar time, but items close together are pushed apart so they stay readable.
- **History:** the last 24 hours, 7, 30 or 90 days, a year, or everything loaded.

## Zoom and pan

![The axis with the zoom buttons and the dates](../assets/tutorial/dashboard-axis.png#only-light){ loading=lazy }
![The axis with the zoom buttons and the dates](../assets/tutorial/dashboard-axis-dark.png#only-dark){ loading=lazy }

- **Zoom:** turn the mouse wheel over the history, or use **−** and **+** beside the axis. Click the percentage to go back to 100 %.
- **Pan:** drag the history with the mouse in any direction, or swipe sideways on a touchpad.
- **Make everything larger or smaller:** Ctrl + mouse wheel, or Ctrl + = and Ctrl + −. Ctrl + 0 resets it.

## Look up a mark

Open **Help → Legend and controls** for every mark on the dashboard and every mouse and keyboard control.

![The Legend and controls dialog](../assets/tutorial/dashboard-legend.png#only-light){ loading=lazy }
![The Legend and controls dialog](../assets/tutorial/dashboard-legend-dark.png#only-dark){ loading=lazy }

**Next:** [Follow your agents](agents.md)
