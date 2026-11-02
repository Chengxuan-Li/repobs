# Handoff progress

Dated implementation checkpoints against the [product handoff](product-handoff.md). Conversation memory is not project state; this page is.

## Checkpoint 31 — 2026-11-02: interface size; the wheel zooms the history (branch `claude/ui-zoom-timeline-pan-3b4ef3`)

Owner request: an interface-size zoom (text and all controls) on Ctrl + wheel, using repobs's own zoom instead of the browser's; the wheel alone zooms the history (dragging already pans both ways); no text selection in the dashboard, so panning never selects. Recorded in [ADR 0010](../decisions/0010-ui-size-and-wheel-controls.md).

| Change | Where |
| --- | --- |
| Interface size 50–200 %: CSS `zoom` and `--ui-scale` on the root, per browser (`repobs.uiScale`), applied before the first frame. Ctrl + wheel changes it smoothly; Ctrl + = / − step through the listed sizes; Ctrl + 0 resets. Handled in the capture phase with the default prevented, so the browser does not zoom, also in text fields | `app/uiScale.ts`, `public/theme-init.js` |
| *View → Styling*: larger, smaller, reset. The status bar shows *UI n %* when the size is not 100 % and resets it on click. The ribbon ignores keys that are already handled | `WorkbenchShell.tsx`, `Ribbon.tsx` |
| Screen to page pixels: `pageZoom()`, `boxOf()` and `windowSize()` return page pixels. Used by hover cards, dropdowns, ribbon menus, the review menu, the checklist list, drag-to-pan, the wheel anchor and the lane click | `components/placement.ts` and its callers |
| FlexLayout frame zoomed back to 1 (its splitters moved about 3× the pointer distance at 150 %); tab strips scaled by `--ui-scale`; each panel zoomed again | `dock.css`, `.panelScale` in `shell.module.css` |
| The wheel over the dashboard zooms the axis around the pointer and no longer scrolls; Ctrl + wheel is left to the interface size; open menus and dialogs keep their own scrolling | `Dashboard.tsx` |
| `user-select: none` on the dashboard scroller (text fields excepted) | `dashboard.module.css` |

Verification (2026-11-02, this machine):

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 205 tests passed: 5 new in `app/uiScale.test.ts`, 2 new in `components/placement.test.ts` |
| `npm run build` | Passed |
| `npm run test:e2e` | 36 passed, docs screenshot skipped. New: *Ctrl + wheel and Ctrl + = / − / 0 change the size of the interface*. It covers Ctrl + wheel, the keys, persistence across reload, the status-bar reset, `devicePixelRatio` staying 1, drag-to-pan at 150 % (screen 150 × 90 px gives 100 × 60 page px), a dock splitter following the pointer, and the View menu opening under its button. Extended: *the history zooms horizontally* (wheel zooms without scrolling, `user-select: none`) |
| `npm run docs:build` | Strict build passed |

Manual check with a Playwright script on Edge 156 and the e2e demo data (port 47398): screenshots at 150 % and 80 %. The whole workbench scales, tab strips and side-bar tabs included. The hover card sits beside its row, and the dropdown and View menu open under their buttons.

Not verified:

- Firefox and Safari (no e2e project for them). Browsers without standardized CSS zoom (Chromium before 128, Firefox before 126) would misplace floating cards at sizes other than 100 %.
- Touchpad pinch on real hardware: it arrives as Ctrl + wheel, and only the synthetic event was tested.
- FlexLayout tab drag-and-drop between docks at sizes other than 100 %. Splitters were tested; drag-and-drop uses the same coordinate space.
- Pixel paddings in FlexLayout's own stylesheet are not scaled.

Next action: owner review of the branch; no PR opened.

## Checkpoint 30 — 2026-11-02: folder picker no longer looks unresponsive (branch `claude/folder-picker-no-response-41aa92`)

Reproduced in a built copy of this branch (isolated data dir, port 47391, browser pane): *Browse…* returned `{"cancelled":true}` about 2 s after the click, no dialog stayed up, and the page did not change. A window trace showed the legacy `FolderBrowserDialog` (`SHBrowseForFolder`) visible for about 1.5 s, then closing itself as *Cancel* with no input. This happened on every attempt for a few minutes, through every launch path (server, direct `runProcess`, plain spawn), then stopped; the trigger on this machine is unknown. Independently of that trigger, `pickFolder` turned any empty output into `cancelled` whatever the exit code, stderr or timeout. The UI ignored a cancel, so every failure was a silent no-op.

| Change | Where |
| --- | --- |
| Shell folder dialog (`IFileOpenDialog`, `FOS_PICKFOLDERS`) from a fixed C# helper compiled by `Add-Type`. It is owned by a transparent topmost window on the monitor under the pointer, with a taskbar entry, and is brought to the foreground (`AttachThreadInput`). The script goes as `-EncodedCommand` and prints `selected\n<path>` or `cancelled`. Anything else, a non-zero exit (first readable stderr line, CLIXML included) or the 10-minute timeout is an error | `platform/folderPicker.ts` |
| Route aborts the picker when the client disconnects. Codes: `busy` 409, `picker_failed` 500 (logged, paths redacted), `picker_timeout` 504 | `api/server.ts` |
| While waiting: an info notice and *Stop waiting*, which aborts the request; closing the dialog also aborts. A cancel shows *closed without choosing a folder*; errors show the server message | `AddRepositoryDialog.tsx`, `api.ts` (optional `signal`) |

Verification (2026-11-02, this machine):

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 198 tests passed: 9 new in `tests/platform/folderPicker.test.ts`, 5 new in `AddRepositoryDialog.test.tsx`. The latter fail on the previous component |
| `npm run test:integration` | 86 tests passed |
| `npm run build` | Passed |
| `npx playwright test` (with `REPOBS_E2E_PORT=47419`, because another session held 47399) | 35 passed, docs screenshot skipped |
| `npm run docs:build` | Strict build passed |

Manual checks against the real dialog, with the built app in the browser pane:

- *Browse…*: the dialog was the topmost window, and the page showed the notice and *Stop waiting*.
- *Stop waiting*: the PowerShell process ended.
- A `WM_CLOSE` to the dialog: the page showed the cancel notice.
- Filling the folder box and clicking *Select Folder* (`WM_SETTEXT`/`BM_CLICK`): `D:\repobs\docs` was added and ticked.
- Called directly through `pickFolder`, Escape returned `cancelled` and a typed path returned it.

Owner check, 2026-11-02: the owner ran a separate instance of this branch (`REPOBS_DATA_DIR=%LOCALAPPDATA%\repobs\previews\folder-picker`, port 47391) in their usual browser and reported that *Browse…* works.

Not verified:

- Each outcome separately in the owner's check: it was reported as a whole.
- Behaviour on a machine where PowerShell runs in Constrained Language Mode, where `Add-Type` is blocked. This is now reported as `picker_failed`, not ignored.
- What made the legacy dialog cancel itself.

Next action: merge [PR #6](https://github.com/Chengxuan-Li/repobs/pull/6) once its CI passes; no merge has been performed.

## Checkpoint 29 — 2026-11-01: Claude task checklist fix ready for local review

Branch `codex/claude-task-checklists` implements the follow-up to checkpoint 28. The owner requested a local branch first and a PR only after checking it. The owner checked the preview, approved the result and authorized opening the PR on 2026-11-01. Local implementation commit: `72fc7e4`. Published as [PR #4](https://github.com/Chengxuan-Li/repobs/pull/4) against `main`; the PR is open and ready for review.

- `sessions/claude-plan.ts` matches `TaskCreate`/`TaskUpdate` calls to successful structured results, takes returned task ids, and replays confirmed statuses, subject changes, deletions and reused ids. Failed, unrelated, malformed and unconfirmed results are ignored. Task text stays in memory; human overrides retain their existing keys. Contracts and the UI identify this source as *Claude Code tasks*.
- The Claude adapter recovers creations and results across skipped transcript regions, including large appends and subagents; truncation/replacement resets the child's accumulator too. Existing full-list formats remain supported.
- Thirteen new synthetic adapter regressions were run red before implementation/fixes, then green. A new browser test verifies task results appearing as a checklist, live completion without refresh, human overrides and the details panel. Independent review found pending requests surviving a full-list replacement and truncated ids matching unrelated results; both now have regression coverage and are resolved on re-review.
- A read-only local adapter check now finds 12 sessions with plans (85 known items), seven in registered repositories, compared with none before. The separate built preview's snapshot contains seven plans among its 197 sessions. Only counts were reported; no real source text was committed or exported.

Verification (PowerShell, repository root):

| Command | Final result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 181 tests passed |
| `npm run test:integration` | 86 tests passed |
| `npm run build` | Passed |
| `npx playwright test` | 35 passed, one opt-in docs screenshot skipped |
| `npm run docs:api` | Regenerated API schemas for the added source |
| `npm run docs:build` | Strict build passed |
| `git diff --check` | Passed |

The first integration run correctly rejected stale generated API docs, which were regenerated before the successful rerun. A later typecheck caught readonly tuples passed to mutable fixture helpers; fixed and rechecked. No remaining check failures are known.

Local review: a separate loopback preview runs on port 47323 with data under `%LOCALAPPDATA%\repobs\previews\claude-task-checklists`, seeded from the existing registrations and annotations. Edits there belong to that preview copy. The original instance and database were left running unchanged. To reopen a paired browser from this checkout:

```powershell
$taskPreviousDataDir = $env:REPOBS_DATA_DIR
try {
  $env:REPOBS_DATA_DIR = Join-Path $env:LOCALAPPDATA 'repobs\previews\claude-task-checklists'
  npm run open
} finally {
  $env:REPOBS_DATA_DIR = $taskPreviousDataDir
}
```

Remaining limits: plan-mode documents and free-text plan parsing remain unsupported; creations beyond the 64 MB recovery bound or in other sessions cannot be reconstructed, so only known tasks appear. Next action: review PR #4 and its GitHub CI results; no merge has been performed.

## Checkpoint 28 — 2026-11-01: missing automatic plan tracking investigated

The running 0.3.0 app has `privacy.readAgentPlans: true`, both adapters available, no adapter problems, and a healthy monitor. Its snapshot contains 197 Claude sessions with no plans; the newest activity among those sessions is September 27. The Codex adapter discovers 16 sessions, all outside the registered repositories, so none appear in that snapshot.

Root cause for the Claude checklists: the source records use **`TaskCreate` and `TaskUpdate`**, which `sessions/plan.ts` does not recognize. A read-only structural audit of the configured Claude source counted 128 creations and 223 updates across 15 transcript files; 68 creations and 117 updates occur in registered repositories (eight transcript files). Creation inputs have `subject`, `description` and `activeForm`; updates identify `taskId` and report `in_progress` or `completed`, or change dependencies. None of the scanned Claude or Codex records yield a supported plan event. Six Claude `ExitPlanMode` calls also exist in registered repositories; plan-mode documents are explicitly unsupported by ADR 0009. Counts and field shapes only were reported; no transcript content was saved.

The parser currently supports only the Claude desktop task-list tools, `TodoWrite`, and Codex `update_plan`. The earlier checkpoint 20 survey is historical evidence, not evidence of coverage for these currently configured sources. The nine existing plan tests exercise those supported formats and do not cover `TaskCreate`/`TaskUpdate`.

Verification (PowerShell, repository root): `node --conditions=development --input-type=module` with read-only diagnostic scripts on stdin (paired localhost API summaries, adapter discovery, then streamed source-record counts/field shapes); `npx vitest run --project unit tests/sessions/plan.test.ts` — nine tests passed; `npm run docs:build` — strict build passed; `git diff --check` — passed.

No application code, settings, annotations or provider files changed. Next action: add synthetic regression fixtures and replay support for task creation (including returned task ids) and updates; separately decide plan-mode document support. Recheck current source freshness and repository registration when validating recent desktop sessions. No claim is made that automatic tracking is fixed.

## Checkpoint 27 — 2026-11-01: dark-theme screenshots; no film in the README (branch `docs/dark-screenshots`)

| Request | Implementation |
| --- | --- |
| Remove the video and its caption from the README | The poster link to the MP4 and its caption removed; the film stays on the landing page |
| Dark-theme equivalents of the screenshots | `docs-screenshot.spec.ts` captures each picture twice from the same state: light, then dark (`emulateMedia`; the app follows the system theme), with transitions fast-forwarded (controls fade their colours over 150 ms, so a capture right after the switch caught them half-way). New: `repobs-overview-dark.png`, `feature-{timeline,agent,review}-dark.png`; the light ones regenerated. The landing page lists both with `#only-light` / `#only-dark`, and `site.css` hides the other theme's one (its `display: block` outranks Material's rule). The README shows the overview through `<picture>` with a `prefers-color-scheme: dark` source |

Verification (2026-11-01): `npm run build`, then `REPOBS_DOCS_SCREENSHOT=1 npx playwright test docs-screenshot` (1 passed); all eight pictures inspected. `npm run docs:build` (strict) passes. The built site in headless Edge at 1440 × 900: in light (`default`) the three light pictures show and load, in dark (`slate`) the three dark ones, the other three hidden each time; a capture of the dark page showed the dark pictures with the white glow. Not checked: GitHub's README rendering of `<picture>` (not pushed).

## Checkpoint 26 — 2026-11-01: floating notices; repository published

| Request | Implementation |
| --- | --- |
| "*storefront-web* was removed from repobs…" should be a floating message, not a bar under the ribbon that moves the layout | `Toast` in `components/primitives.tsx`: the `InlineAlert` on an opaque surface with the popover shadow. `WorkbenchShell` stacks them in a fixed `.notices` box above the status bar (bottom right, 420 px at most, under dialogs); the shell grid lost its notice row. Each notice has a tone and an id: confirmations (`info`) leave after 8 s, not while hovered or focused; refusals from the dock (`warning`) and failures (`danger`) stay until dismissed; the lost-connection error stays while it lasts. The automation panel keeps its own inline notices |
| GitHub page | Owner's request: description "Local, read-only dashboard for Git worktrees and the Claude Code / Codex agents working in them", website the docs site, topics `ai-agents`, `claude-code`, `codex`, `dashboard`, `developer-tools`, `git-worktree` |

Verification (2026-11-01): `npm run typecheck`, `npm run lint`, `npm test` (171 tests, with the new `Toast.test.tsx`: leaves after the timeout across parent re-renders, stays while hovered, a failure stays until dismissed), `npm run test:integration` (86), `npm run build`, then `npx playwright test` (34 passed, 1 skipped: the docs screenshots). The removal e2e test asserts the toast and that the view's top edge does not move; a screenshot of that state showed the toast bottom right over the empty dashboard area.

## Checkpoint 25 — 2026-11-01: the landing page as a product page (branch `docs/product-landing`, ADR 0007 amended)

Built on `docs/product-film` (checkpoint 24, PR #1), which the film session finished before this started.

| Request | Implementation |
| --- | --- |
| A product page rather than a docs page, like energyatlas.io (read from its local build, `D:\EnergyAtlasWebsite\dist`, read only) | `docs/index.md` wrapped in `.ui-product`: hero (`repobs`, serif tagline, *Download* and *Get started*), the film (`#film`), *Features* (three rows), *Local and read-only*, *Support*, *Documentation*, a closing call to action. Design in `design/docs-ui-spec.md` 0.7 |
| Prepare for the product film | The film is the hero's media: the same `<video class="ui-film">` and asset paths, so a re-export at the same paths needs no page change |
| Three new screenshots | `tests/e2e/docs-screenshot.spec.ts` also writes `docs/assets/feature-timeline.png`, `feature-agent.png` (details panel with the agent plan) and `feature-review.png` (the checklist with the agent's plan and one item of yours, added by the test); paths replaced by `C:\src\<name>`. The candidate-list wait is 15 s (it timed out once at 5 s) |
| Hand-drawn icons | Pilot (`timeline`) approved by the owner; `agents`, `review`, `local` in the same grammar. Source `design/icons/repobs_icons.py`, rendered by the editorial-icons skill to `docs/assets/icons/`, all eight files valid (`--require-matching-canvas`); inlined by `hooks/icons.py`; ink `currentColor`, accent `--ui-accent` (0.16) |
| Product-style header | `overrides/partials/header.html` (copy of Material 9.7.7's, plus `partials/product-nav.html`); CSS shows the links and hides the tabs only with `.ui-product` on the page |

Verification (2026-11-01): `npm run docs:build` (strict) passes. The built site served locally: in the browser pane, the product links show and the tabs hide on the landing page, the reverse on `/guide/`; four inline icons, ink and accent in the theme colours; the serif loaded; no horizontal overflow. Screenshots with Edge (headless Playwright, the pane was hidden): 1440 × 900 dark and light, and 375 px, the feature rows stacking on the phone. Not checked: the published Pages site (not pushed).

### Checkpoint 25, revised — the owner's review of the first product page

| Request | Implementation |
| --- | --- |
| The film as the opening content, black around it, no frame, no caption | `overrides/home.html` puts it in Material's `hero` block: `100svh`, `object-fit: contain` on black |
| The header, title and buttons appear after scrolling; title and buttons hold still for a short distance | `docs/assets/javascripts/opening.js` sets `html[data-ui-scrolled]`; the header is fixed and slides in; the hero is sticky under it with a stage 30vh taller (measured: it stays 48 px from the top for about 270 px of scroll, then moves on) |
| No vertical rules, no horizontal rules, no *01 / Features* subtitles | Frame, strips and the page footer removed on this page; titles only |
| Screenshots at one aspect ratio, rounded, with the reference's glow | All three are 1280 × 720 windows; rounded top, glow, fade (spec 0.7) |
| Remove the support section | Removed |
| Remove the play button; autoplay on entry; hold scrolling until the film ends; Skip when the visitor tries to scroll, fading the film and showing the title; the film again when scrolling back up | `opening.js`: muted autoplay, `html[data-ui-film-hold]` (no scrolling), wheel/touch/scroll keys show *Skip*; *Skip*, Escape or the end fade it and scroll to the title; back at the film (60 % in view) it plays again without holding. Held once per tab session, never with reduced motion, an anchor, a restored scroll position or a refused play. Checked in Edge on `mkdocs serve`: held and playing on entry; wheel and ArrowDown keep `scrollY` 0 and show *Skip*; *Skip* and Escape release, fade and land on the title (`scrollY` 900 at 900 px high); the end at 24.8 s does the same; scrolling back up plays from the start; a reload in the same tab plays without holding; instant navigation away and back leaves the guide unheld and plays again; reduced motion: still, not held; `#features`: not held; no page errors |
| The film must play without a click (it did not on the owner's machine) | Cause: the machine reports `prefers-reduced-motion: reduce` (Windows animation effects off), and the film waited for a click then. Now it plays and holds whatever the preference; with reduced motion the move to the title is instant. Checked in the app's browser pane (reduced motion on, no user activation): playing, muted, held; in Edge with reduced motion: held on entry, Escape releases and lands on the title |
| Hide the video's play widgets; just allow replay (superseded by the next row: no Replay button) | No `controls`; `opening.js` starts it muted (only muted autoplay is allowed), shows *Replay* when it ends, which restarts it with sound; *Play* instead when reduced motion is requested; click or Space pauses. Checked in Edge: muted and playing on load, paused by a click, *Replay* at 24.8 s, then playing from 0 with sound, set up again after instant navigation, *Play* and paused with reduced motion. Seeking was not testable on the local Python server (no range requests); GitHub Pages serves ranges |
| Documentation cards like the reference's | Two cards with new `guide` and `developer` icons, underlined titles, a torn-paper hover wash with the icon's faint copy |

Verification (2026-11-01): `npm run docs:build` (strict) passes; the six icons and their bold weights pass the validator. The built site served locally and captured with Edge (headless Playwright): at 1440 × 900 in dark and light, the opening shows only the film (the header is above the window), after one screen of scroll the header is in, the wordmark stays `repobs`, the hero holds, the glow is not cut, and a card's hover shows the wash; at 375 px the film fills the first screen letterboxed; no horizontal overflow anywhere. The real browser pane was hidden during this work. Not checked: playback with sound in a browser, the published site.

## Checkpoint 24 — 2026-11-01: product film in the README and on the landing page

| Request | Implementation |
| --- | --- |
| Put the product film into the README and the docs site | The film is made in a separate local repository (`D:
epobs-video`, Remotion; not part of this repository's build). Copied here: `docs/assets/repobs-film.mp4` (1920×1080, 60 fps, 24.8 s, H.264 CRF 27, AAC 160 kb/s, 6.9 MB, from the CRF 16 master) and `docs/assets/repobs-film-poster.jpg` (the frame at 7.9 s) |
| Landing page (moved into the hero in checkpoint 25) | *What repobs shows* holds a `<video class="ui-film">` with controls, the poster and no autoplay, above the screenshot; its caption says it is animated, with invented names, and that the screenshot is the real application. Recorded in `design/docs-ui-spec.md` section 0.7; one rule in `site.css` |
| README | The poster links to the MP4 (GitHub does not play videos embedded from repository paths in a README; it plays the file on its page), after the real screenshot |

Verification (2026-11-01, this machine): `npm run docs:build` passes (strict); in the browser pane (built site served locally): the film fills the column at 16:9 (975×548 px at a 1024 px window, 343 px on a 375 px phone) with no horizontal overflow; it plays (1920×1080, 24.8 s, no media error; checked muted, as autoplay with sound is blocked); dark and light themes take the matching frame token; no console errors. Not checked: the published Pages site and GitHub's README rendering (not pushed).

## Checkpoint 23 — 2026-11-01: documentation site in the shape of the EnergyAtlas sites (ADR 0007 amended)

| Request | Implementation |
| --- | --- |
| Simplify the docs; they did not match the shape of the BEMGen and Archetype Atlas sites | Compared with local builds of both (`D:\BEMGen-docs\site`, `D:\archetype-atlas\build\site`, read only; the live sites are blocked in this machine's browser pane). Owner decisions: two parts, serif hero line, header and tabs on one surface; labels stay sentence-case sans |
| Two parts | Tabs *Home*, *User guide*, *Developer*; `docs/guide/index.md` and `docs/developer/index.md` list their pages in reading order (`navigation.indexes`); `user-guide.md` titled *Using repobs*; no page URL changed |
| Landing page | "Observe worktrees and agents / *locally, on one timeline.*" with the second line in Cormorant Garamond italic 500 (vendored, OFL, the BEMGen files); two cells; four strips instead of five; the privacy paragraph now mentions excerpts and plan steps |
| Surfaces | Wordmark in the text colour; tab bar and strips on the base surface; search with a plain edge; grid columns of at least 14rem that fit the width; larger part cells |

Verification (2026-11-01): `npm run docs:build` (strict) passes. In the browser pane at 1440 × 900, dark and light: the landing page, both index pages and an ordinary page side by side with the BEMGen build; at 375 px no horizontal overflow, cells in one column, the serif loaded from the site.

## Checkpoint 22 — 2026-11-01: dashboard-only screenshot, realistic demo names, toolbar fix

| Request | Implementation |
| --- | --- |
| The screenshot should show as much dashboard as possible: no legend, no side panels | `docs-screenshot.spec.ts` closes the Repositories and Details panels from the toolbar, leaves the legend closed, sets *Flagged*, *Complete* and *Reviewed* on three agents so the state colours show, uses a 1440 × 800 viewport, and replaces the temporary-folder paths with `C:\src\<name>` instead of masking them |
| Realistic repository names instead of *repo-a* / *repo-b* | `buildGitFixture(root, names)` takes the folder names (default still `repo-a` / `repo-b` for unit and integration tests); the demo uses `DEMO_REPOS` = `git-status-kit` and `storefront-web`; the e2e tests use the new names |
| Found while doing it: a toolbar panel button stayed pressed after closing its panel | `isPanelVisible` read `TabNode.isVisible()`, which flexlayout updates only on its next render. `panelShown(model, panel)` reads the model (selected tab of its border or tab set, and the maximized tab set); unit-tested in `dockLayout.test.ts`, and the screenshot test asserts both buttons end unpressed |

## Checkpoint 21 — 2026-11-01: release preparation, v0.3.0

- Version 0.3.0 in all package manifests, the lockfile's workspace entries and `APP_VERSION` (reported by `/health`).
- `CHANGELOG.md`: the Unreleased entries became `[0.3.0] — 2026-11-01` (agent plans, automation, Outdated, Hidden, checklist pill, the release zip, the fixes and the documentation site), with the two *Added* lists merged and an upgrade note: schema v3, backed up before migrating, not readable by 0.2.0.

Verification (2026-11-01, this machine): `npm run typecheck`, `npm run lint`, `npm test` (167 tests), `npm run test:integration` (86), `npm run build`, `npx playwright test` (34 passed, 1 skipped), `npm run docs:build` and `npm run package` (`release\repobs-0.3.0.zip`, 817 files) all succeeded. The zip unpacked with `Expand-Archive`; its server started on an empty data folder reported version 0.3.0 at `/api/v1/health`, served `/`, and returned 401 for an unpaired `/api/v1/snapshot`.

Published (owner approval): `main` and the annotated tag `v0.3.0` pushed; the release workflow succeeded and published *repobs 0.3.0* with `repobs-0.3.0.zip` and `SHA256SUMS.txt`. The published checksum differs from the local test package, which was built before the release commit.

Afterwards, on `main`: the README rewritten for readers (shorter introduction; quick start from the latest release with an upgrade note; features grouped as see, follow, review and organise; privacy in plain promises first; a *Supported* section; links to the documentation site; a development section), and `docs/assets/repobs-overview.png` regenerated from the demo (`REPOBS_DOCS_SCREENSHOT=1 npx playwright test docs-screenshot`) to show checklist pills and an agent plan. The 0.3.0 zip keeps the earlier README.

## Checkpoint 20 — 2026-11-01: agent plans in checklists (ADR 0009, merged into `main`)

| Request | Implementation |
| --- | --- |
| Extract sequenced steps from sessions into checklists without an LLM | `sessions/plan.ts` replays planning tool calls: Claude desktop task list (full lists, *advance*, *done/start*, wrap-up), `TodoWrite`, Codex `update_plan`. Adapters feed it; `scanBackward` (jsonl.ts) finds the latest full list behind a skipped middle |
| Agent section first, fully synced; your items after; the agent never ticks yours; you can override the agent's | `checklistEntries.ts` merges both; the pill, its list (two sections), the hover card and the details panel's *Agent plan* show them; overrides stored by item key in `planOverrides` (migration 3), never the text |
| Privacy | Plan text in memory only; Settings → Privacy → *Read agents' plans into their checklists* |

Verification (2026-11-01, this machine):

- typecheck, lint, `npm test` (167 tests), `npm run test:integration` (86), and `npx playwright test` (34 passed, 1 skipped) all pass.
- Run against the owner's real Claude transcripts, counting only: 62 of 874 sessions have a plan, all from the desktop task list (194 steps completed, 9 in progress, 97 pending). The 4 transcripts with a full list but no plan under their own id are forked sessions, which repobs lists under their parent's id.
- The owner restarted their own repobs on the branch: the database migrated from v2 to v3 with the automatic backup `repobs.db.bak-v2-2026-11-01T06-21-40-061Z`, and the owner confirmed the agent sections in the live dashboard. The owner approved the merge into `main` (fast-forward, no other changes on `main` since the branch).

Not done: plan-mode documents, `- [ ]` parsing of messages, timeline marks for step changes, chapter marks as phases. Real `TodoWrite` and Codex `update_plan` transcripts were not available here.

Next action: none requested. Candidates: `- [ ]` checkboxes in agent messages, plan-mode documents, and timeline marks for step changes.

## Checkpoint 19 — 2026-11-01: timeline card details, one checklist popover, no completion banner

| Request | Implementation |
| --- | --- |
| Hovering an agent's card on the timeline showed nothing | `BarCard` opens the same interactive agent details card (`AgentDetailsHover`, shared with the label column), below the card |
| Hover and click showed two different checklist lists | `ChecklistPill`: one dialog with check boxes for both; opened by hover it closes 200 ms after the pointer leaves pill and list, opened by a click it stays until Escape or a click elsewhere |
| The details panel's "All N checklist items complete / Show completed" banner | Removed: the checklist always lists its items, ticked ones struck through |

Verification (2026-11-01): `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run build`, `npx playwright test` (33 passed, 1 skipped), `npm run docs:build`. See the closing report for counts.

## Checkpoint 18 — 2026-10-31: checklist pie, rule preview, state colours, no accent stripes

| Request | Implementation |
| --- | --- |
| A pie left of the checklist count, filled clockwise by the share done; theme colours (too faint before) | `Pie` in `ChecklistPill.tsx`; the pill uses the tone tokens: info while open, success when all done, neutral before any |
| "All of these hold" matched no agents for *Idle for 7 days → outdated* | Not a matching bug. The owner's saved rule (read from the local database, rules table only) had set its agents to *Outdated*, so its own condition *review state is unreviewed* no longer held. With *any*, every unreviewed agent matched. The editor now shows *· already changed N* beside the matches when editing a saved rule; the guide explains self-falsifying rules and *any* |
| Shorter preview text | "Matches N agents"; names moved to the count's tooltip |
| No left-stripe accent anywhere | Removed from the rule preview, hover and details excerpts, and docs admonitions; recorded in `reference-audit.md` and `docs-ui-spec.md` §0.15 |
| A slight colour for the states | `ReviewDot` beside each review state in the status menu, the Hidden filter and the rule editor (hollow for Outdated) |

Owner's data, observed and not changed: the rule's revision 2 uses *any* (idle > 8 days **or** unreviewed) and had set 252 agents to *Outdated*, including recently active unreviewed ones.

## Checkpoint 17 — 2026-10-31: review states, automation rules, view hiding, checklist pill, anchored hover cards (ADR 0008)

| Request | Implementation |
| --- | --- |
| *Reviewed* showed as *Complete* and *Flagged* as *Needs review*; the dashboard disagreed with the details panel | `workflowStatus` (contracts) returns every review state as itself; new statuses *Flagged*, *Reviewed*, *Outdated*; `statusNeedsAttention` counts *Flagged* |
| An *Outdated* state | `ReviewState` gains `outdated` (no migration: the column is text) |
| Automation rules that label agents (age of last message, keywords in agent or repository, metadata), configurable in a new panel | `automation/engine.ts` (pure, unit-tested), migration 2 (`automation_rules`, `automation_applied`), monitor applies rules once per agent and rule revision after each session rebuild, API `/automation/*` and `/sessions/{id}/automation`, *Automation* panel (View → Panels, Ctrl+Alt+U) with editor, live preview and templates; the details panel names applied rules |
| Visibility through view filters, not automation | Per-view *Hidden* dropdown: hide by review state, *Hide from this view* in the status menu, list with *Show* / *Show all* |
| Checklist count on dashboard rows with hover list and click-to-tick | `ChecklistPill.tsx` beside the status on list and timeline cards; ticks show at once and are undone if saving fails; annotation summaries carry checklist items; the demo seeds two checklists |
| Hover menus followed the cursor inside their trigger | `components/placement.ts`: cards are placed against the trigger's box (entry point on wide elements), flipped or shifted only to stay in the window; `onMouseMove` repositioning removed |

Verification (2026-10-31, this machine):

- `npm run typecheck` and `npm run lint` pass.
- `npm test`: 20 files, 155 tests.
- `npm run test:integration`: 7 files, 86 tests.
- `npm run build`, then `npx playwright test`: 32 passed, 1 skipped (the documentation screenshot).
- New tests:
  - `tests/automation/engine.test.ts`;
  - `tests/api/automation.int.test.ts` (preview, apply once per revision, later edits kept, re-apply on edit, switch on and off, delete, validation);
  - `placement.test.ts`, `ChecklistPill.test.tsx`, `describe.test.ts` and the hidden filters in `filters.test.ts`;
  - e2e:
    - every review state on the card;
    - the checklist pill's hover list, pinned ticking and fixed position;
    - hover cards staying put;
    - hiding from a view;
    - an automation rule end to end.
- Browser pane (synthetic demo, 1440 px, dark):
  - the pill, its pinned list (the row's hover card now closes when it opens), the status menu with *Hide from this view*, and the Automation panel with a template preview (192 matching demo agents, not saved);
  - a commit hover card stayed at the same position while the pointer moved within the commit.

Not checked: light theme and narrow widths for the new panel; rules over a long-running session with real agent data; the Firefox and Safari engines.

Next: decide whether rules need reordering in the panel (order is creation order today) and whether the *Hidden* filter should default to hiding *Outdated* in new views.

## Checkpoint 16 — 2026-10-31: documentation site in the app's visual family (ADR 0007)

| Request | Implementation |
| --- | --- |
| UI alignment for the MkDocs site | Material for MkDocs 9.7.7 (pinned in `requirements-docs.txt`) styled with the app's tokens (`docs/assets/stylesheets/site.css`); rules and owner decisions in `design/docs-ui-spec.md` (section 0 wins), referenced from `AGENTS.md` |
| No font host | Geist and Geist Mono copied from the app's pinned `@fontsource-variable` 5.3.0 packages into `docs/assets/fonts/` with their OFL licences; `theme.font: false`; `overrides/main.html` preloads them |
| Landing page | Hero, a grid of the eight guide and reference pages, the existing sections under numbered strips; sidebars hidden but kept as margins |
| Navigation | Tabs *Home*, *Guide*, *Reference*, *Development*; no page URL changed; breadcrumbs; instant navigation (`site_url` set to the Pages address); no `repo_url` |
| Follow-up: no header icon; shorter button | The header and phone drawer show only the `repobs` wordmark (the favicon stays); the landing button reads *Download* |

Verification (2026-10-31, this machine, Edge in the app's browser pane, built site served locally): `python -m mkdocs build --strict` passes. Dark and light at 1440 px, phone at 375 px: no horizontal overflow; hero, strip labels, grid cells and paragraphs share one left edge (267 px into the frame on the landing page, the same absolute edge as on pages with sidebars); strips and grid rules reach the frame; each grid cell's empty area opens its page; fonts load from the site only and no request leaves the origin (the built pages reference no font host); instant navigation keeps the same document and re-requests no font (checked with a build whose `site_url` was the local address); search returns results; the generated API table scrolls inside its container; the phone drawer opens on the landing page. Not checked: the published GitHub Pages site (not pushed), Firefox and Safari. Material 9.7.7 prints an informational notice about MkDocs 2.0; it is not a build warning, and MkDocs stays pinned at 1.6.1.

## Checkpoint 15 — 2026-10-31: ready-to-run release package (ADR 0006)

| Request | Implementation |
| --- | --- |
| The release only had the source zip; ship something usable | `scripts/package.mjs` (`npm run package`): `release/repobs-<version>.zip` with the built app, launchers, `zod`, licences and `THIRD-PARTY-NOTICES.txt`; `SHA256SUMS.txt`; notes from the changelog |
| Repeatable releases | `.github/workflows/release.yml`: on `v*` tags, checks, build, package (tag must match the version), `gh release create` |
| Docs | README and getting started: install from a release; real clone URL (`https://github.com/Chengxuan-Li/repobs`, public); contributing: release steps; limitations: packaging |

Verification (2026-10-31, this machine): the zip unpacked with Windows `Expand-Archive` into an empty folder; `npm start --no-open` there (empty data, Claude and Codex folders) reported `repobs 0.2.0`, `/api/v1/health` returned version 0.2.0, `/` served the UI, an unpaired `/api/v1/snapshot` returned 401, and Edge paired and showed *View 0* with no console errors. Packaging twice gave the same SHA-256. Lint, typecheck and tests: see the commit message.

The v0.2.0 release itself was packaged from the `v0.2.0` tag's sources (the workflow did not exist when the tag was pushed) and published with `gh release create`.

## Checkpoint 14 — 2026-10-31: release preparation, v0.2.0

- Version 0.2.0 in all package manifests, the lockfile's workspace entries and `APP_VERSION` (reported by `/health`).
- `CHANGELOG.md`: the Unreleased entries consolidated into `[0.2.0] — 2026-10-31` describing the shipped state (superseded intermediate entries removed); three entries that had landed in the 0.1.0 section moved back.
- Docs refreshed for the shipped UI: README feature list, index, getting started (File → Diagnostics, View 0), limitations (docking, per-browser views), architecture (workbench, views, routing, timeline cards, panning), testing coverage list, privacy (File → Export holds no excerpts).
- Dead CSS removed (classes no component uses: `orphanRow`, `segmented`/`segment`/`segmentOn`, settings `suggestion`/`code`).

Verification (2026-10-31, this machine) — see the release commit message for the final run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e`, `npm run docs:build`.

Done afterwards: `v0.2.0` tagged and pushed (owner approval); the clone URL is now the public repository (checkpoint 15). Still open: whether `v0.1.0` gets a retroactive tag; a dependency audit (`npm audit` contacts the npm registry).

## Checkpoint 13 — 2026-10-31: drag to pan; repositories panel header

| Request | Implementation |
| --- | --- |
| Add button in the repositories panel is cropped | `Dropdown` `icon` (compact) variant for *Sort*; strip title ellipsizes, *Add* never shrinks |
| Pan the view by click-and-hold, like a map | `useDragPan.ts` on the view's scroller: 4 px threshold, pointer capture, swallowed click after a pan, controls excluded; grab / grabbing cursors |

Verification (2026-10-31, this machine): typecheck, lint and build exit 0; `npm run test:e2e` 27 passed, 1 skipped (new pan test: scroll offsets follow the drag, no selection, a click still selects); `npm test` 16 files / 135 tests passed; `npm run docs:build` exit 0. Screenshot checked: panel header with Sort icon and Add at default width.

## Checkpoint 12 — 2026-10-31: views, File and View menus (ADR 0005)

| Request | Implementation |
| --- | --- |
| Multiple dashboard instances as named views, renamable, layout saved | `dockLayout.ts`: view tabs (`viewTabs`, `openView`, `renameView`, guarded close/rename in `onAction`), `nextViewName`; `ViewPanel.tsx` per view; `viewState.ts` per-view settings in `repobs.workbench.v1` |
| "View X", smallest unused number from 0 | `nextViewName` (unit-tested with the owner's example) |
| Repository selection per view; repositories panel stays the list of all | per-view `hiddenRepos`; panel ticks edit the current view and name it; *Repositories* dropdown in the view's bar |
| Side panels keep a minimum width | panel `minWidth` 280 / 320 px, `borderMinSize`, narrow stored side bars widened; repository entries ellipsize |
| File: Export, Open, Settings, Diagnostics; View: Panels, Open new view, Styling, Full screen, Refresh; only side-panel and theme icons | `WorkbenchShell.tsx` command list, `Ribbon.tsx` `MENU_GROUPS` and `paletteOnly`; export/open JSON (`repobs-export` v1) |

Verification (2026-10-31, this machine): typecheck, lint and build exit 0; `npm test` 16 files / 135 tests passed; `npm run test:e2e` 26 passed, 1 skipped (docs screenshot, regenerated); `npm run docs:build` exit 0. Screenshots checked: two views with different repository selections, View menu sections, no console errors.

Unknown: narrow-window overlay panels (unchanged). Opening a file replaces views without a confirmation step; annotations merge as with Settings → Import.

## Checkpoint 11 — 2026-10-31: chevron for spawned agents, timeline cards (ADR 0003, eighth review)

| Request | Implementation |
| --- | --- |
| The chevron should not expand agent details; only agents with subagents get one, and it shows them | `layout.ts`: `collapseSpawned` + `toggledAgents` options, `childCount` / `expanded` on session rows; `AgentRow.tsx`: chevron with count only when `childCount > 0`, inline details block removed; view state `collapseSpawned` (default on) and `toggledAgents` replace `details`, `showSpawned`, `expandedAgents` (old keys dropped on load) |
| No agent expansion with info on the dashboard | *Expand agent details* removed from the Agents dropdown and View menu; details stay in the hover card and details panel |
| Name and status (editable dropdown) at the timeline end, in a card like the left one | `RepoBoard.tsx` `BarCards` / `BarCard`: HTML cards above the lanes with provider mark, name, age and `ReviewMenu`; lanes SVG marked `data-lanes` |

Verification (2026-10-31, this machine): typecheck, lint and build exit 0; `npm test` 16 files / 130 tests passed; `npm run test:e2e` 24 passed, 1 skipped (docs screenshot, regenerated); `npm run docs:build` exit 0. Screenshots checked: a collapsed parent shows "› 2", expanded shows the indented children, timeline cards sit before the bars near the axis end; no console errors.

Unknown: unchanged (narrow-window overlay panels).

## Checkpoint 10 — 2026-10-31: filter bar as dropdowns (ADR 0004, decision 5)

| Request | Implementation |
| --- | --- |
| Filter controls are all over the place; collapse them into a few dropdowns | `components/Dropdown.tsx` (menu of check/radio sections, or a panel); `FilterBar.tsx` regrouped into Harness, Status, Last message, Tags (filters) and Branches, Agents, Timeline, Legend (view options), each group wrapping as a whole |
| Harness should be a multi-select dropdown | `filters.harnesses: Provider[]` (empty = any) with `PROVIDER_LABELS` in contracts; old stored `claude`/`codex` switches migrated in `loadView` |

Verification (2026-10-31, this machine): typecheck, lint and build exit 0; `npm test` 16 files / 129 tests passed (new `viewState.test.ts`); `npm run test:e2e` 24 passed, 1 skipped (docs screenshot, regenerated). Screenshots of every open dropdown checked at 1500 px wide with both side panels open: filters on one line, view options on the next; no console errors.

Unknown: unchanged (narrow-window overlay panels).

## Checkpoint 9 — 2026-10-30: reference UI alignment (ADR 0004)

| Request | Implementation |
| --- | --- |
| Panel titles not in a mono font | `--label-*` tokens (sans, sentence case, 12 px semibold) for `.label`, section strips, table headers, filter labels, status bar, menus, buttons and badges; mono kept for identifiers |
| Borrow the ribbon content | `Ribbon.tsx`: Repositories / View / Tools menus with checks, submenus and shortcuts; *Search commands* (Ctrl+K) command palette; icon buttons; one command list in `WorkbenchShell.tsx` |
| Adjustable dockable flexible layout | `flexlayout-react` 0.11.0 (pinned); `dockLayout.ts` (default model, validated restore, toggle/show panel, maximize that collapses side bars, reset) and `dock.css` (repobs theme) |

Also: raised buttons and well-style fields (control grammar), overlay scrollbars.

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 15 files / 127 tests passed; `npm run test:e2e` 24 passed, 1 skipped (docs screenshot, regenerated); `npm run docs:build` exit 0. Manual check in Edge: dragging the Details tab beside the dashboard docks it, the empty side bar shows its drop hint, no console or CSP errors. Integration suite not rerun (no backend change).

Unknown: narrow windows (under ~1100 px) — the reference switches side panels to overlays there; repobs does not yet.

## Checkpoint 8 — 2026-10-30: seventh review — agent labels on the timeline (trial)

| Request | Implementation |
| --- | --- |
| Agent info next to the end of its work in the chronology, as a mode enabled or disabled separately from the left column | `barLabels` and `agentNames` in the view state, each a filter-bar checkbox (both on by default). `RepoBoard.tsx` draws name · status · age after each bar (flipped before the bar near the axis end, with a halo over crossing lines); without names in the list the column narrows to `LABEL_W_NARROW` (230 px) and cards keep provider mark, tree and status menu |

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 14 files / 124 tests passed; `npm run test:e2e` 23 passed, 1 skipped (docs screenshot, regenerated); `npm run docs:build` exit 0. Integration suite not rerun (no backend change).

Unknown: label width is estimated from the character count (6.2 px per character), so a label can still run slightly past the axis end with wide glyphs; not seen on the demo.

## Checkpoint 7 — 2026-10-30: sixth review — quiet commits are Git-quiet

| Request | Implementation |
| --- | --- |
| Collapse quiet commits folded almost nothing on a real repository | `groupQuietCommits` (`layout.ts`) no longer treats agent activity as eventful; only tips/heads, fork and merge endpoints, merges and first own commits stay visible |

Observed on the owner's instance (counts only): `energyatlas-mcp` `main` had 77 of 83 commits inside some agent's first-to-last-message span (sessions of up to 308 hours), so only one run of 5 folded; now 6 commits stay visible and two runs (60 and 18) fold.

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 14 files / 124 tests passed; `npm run test:e2e` 22 passed, 1 skipped (docs screenshot); `npm run docs:build` exit 0. Integration suite not rerun (no backend change).

## Checkpoint 6 — 2026-10-30: fifth review — compressed calendar axis

| Request | Implementation |
| --- | --- |
| Commits collide in calendar mode; try a calendar mode that only shrinks the space between elements, keeping a minimum distance | New axis mode *Calendar, compressed* (`compressedAxis` and `rankedTicks` in `timeline.ts`): gaps are `max(22 px, elapsed × scale)`, zoom scales only the time part; agent activity interpolates between items; saved views accept the new mode |

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 14 files / 124 tests passed; `npm run test:e2e` 22 passed, 1 skipped (docs screenshot); `npm run docs:build` exit 0. Integration suite not rerun (no backend change). Visual check on the demo: the ten scratch commits made seconds apart overlap in *Calendar time* and sit 22 px apart in *Calendar, compressed*.

## Checkpoint 5 — 2026-10-30: fourth review (ADR 0003 amendment)

| Request | Implementation |
| --- | --- |
| Subagent topology lines poorly designed; indent cards by level; drop coloured left edges | Agent rows are cards offset by spawn depth (`AgentRow.tsx`); tree guides (`pipe`/`tee`/`last` plus a stub under parents) are computed per row in `layout.ts` and drawn in the gutter, continuous across rows; the status stripe and the selected-row inset stripe are gone |
| "Unreviewed" sessions shown as "Ready" | Workflow status `ready` renamed `unreviewed` (neutral tone; `complete` is now success); saved status filters migrate |
| Change review state from the dashboard and the popup | `ReviewMenu.tsx`: the status badge opens a keyboard-operable review menu on rows and in the (now interactive) agent hover card |
| Overlapping/intersecting connectors indistinguishable | `routing.ts` assigns parallel tracks to overlapping collinear legs (metro style); unit-tested |
| Horizontal zoom | `zoom` in view state and `buildTimeline`; buttons on the axis, Ctrl + wheel anchored at the pointer, +/−/0 keys |

Also fixed: lanes scrolled under the sticky label column showed through the 1 px row borders. The demo gives the feature-branch agent a second subagent.

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 14 files / 123 tests passed; `npm run test:integration` 6 files / 73 tests passed; `npm run test:e2e` 22 passed, 1 skipped (the docs screenshot, regenerated separately with `REPOBS_DOCS_SCREENSHOT=1`); `npm run docs:build` exit 0. Backend unchanged except the shared `WorkflowStatus` contract.

Unknown: with many branches leaving one commit (more than 9) tracks are reused, so some lines still overlap; not seen on real data yet.

## Checkpoint 4 — 2026-10-30: third review

| Request | Implementation |
| --- | --- |
| Branch connectors looked like free-form curves | Orthogonal paths with rounded corners (`elbow()` in `RepoBoard.tsx`): forks drop from the base commit then run to the branch; merges run along the branch then turn into the merge commit; branch pointers likewise |
| Optionally collapse commits where nothing happens | *Collapse quiet commits* (off by default): runs of 2+ commits on one branch without a head, fork, merge, first own commit or (until checkpoint 7) agent activity within 5 minutes become a counted pill taking one axis column (`groupQuietCommits` in `layout.ts`); hover lists them in an interactive card where each commit can be inspected; click expands the run; re-ticking re-collapses |

The demo (`scripts/demo.ts`) now gives `claude/scratch-a8de` ten commits so there is a run to collapse.

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 13 files / 116 tests passed; `npm run test:integration` 6 files / 73 tests passed; `npm run test:e2e` 20 passed (Edge); `npm run docs:build` exit 0. Backend unchanged in this round.

## Checkpoint 3 — 2026-10-30: second review (ADR 0003 amendment)

| Request | Implementation |
| --- | --- |
| Sub-agent topology elements were shifted | Indentation and tree connectors now live inside the fixed label column (no overflowing margins); lane connectors are drawn from row centres |
| Commits should not be spaced by calendar time (keep it as an option) | *Axis → Commit order* (default): evenly spaced commits in time order; *Calendar time* is the toggle (`features/dashboard/timeline.ts`) |
| Date range too compressed; should go back further; axis shared across projects | One axis for all repositories, sticky at the top, scrolling horizontally through all loaded history (default *All loaded*, up to 1 year selectable) |
| Commit messages on hover should be more visible | Custom hover cards with larger hit targets for commits, branch heads/pointers, uncommitted-change markers, agent rows and bars |
| One line per agent: name/alias and status; the rest collapsed | 24 px agent rows; details on hover, per-row expansion (chevron, →/←) or *Expand agent details*, and in the details panel |
| A legend | *Legend* toggle explaining node, edge, marker and bar styles and colours |
| Branch relationships should be visible | Labels *from X*, *→ X*, *at X*; fork/merge curves; dashed pointers for branches without their own commits |

Verification (2026-10-30, this machine): typecheck, lint and build exit 0; `npm test` 13 files / 113 tests passed; `npm run test:integration` 6 files / 73 tests passed; `npm run test:e2e` 18 passed (Edge); `npm run docs:build` exit 0. Backend unchanged in this round.

## Checkpoint 2 — 2026-10-30: dashboard redesign (owner feedback, ADR 0003)

### Owner feedback addressed

| Request | Implementation |
| --- | --- |
| The page itself scrolled | The shell is fixed to the viewport; only the dashboard and side panels scroll (e2e asserts `scrollY = 0` and no document overflow) |
| One primary working panel plus side panels | Dashboard in the center; optional, resizable repositories (left) and details/notes (right) panels |
| Add repositories from a multi-selection list, sortable | Checklist of repositories found in session folders (merged per repository, with session/active counts and last activity), sortable; `POST /api/v1/repositories/batch` with per-path results |
| Filters: harness, last-message age, status, tags; sort repositories | Filter bar (harness, 24 h–40 days, workflow status chips, tag filter with autocomplete, text search); repositories sorted by activity, active agents, name or manual order |
| Visualize branches and commits like a Git tree, with uncommitted and unpushed work distinguished | Per repository: one row per branch, commits placed by time, fork/merge edges, filled = pushed, hollow amber dashed = local only, grey dashed = not pulled, dashed diamond = uncommitted changes (red when conflicted), head labels; new read-only `git log` (≤ 400 commits) |
| Agents as card rows under their branch, with a mechanical latest-message synopsis | Cards with workflow status, observed state, timeline bar, and the latest assistant text or running tool (*Tool: description*), truncated and redacted, in memory only, switchable in Settings → Privacy |
| Show agent spawning; toggle to hide spawned agents | Claude subagents and Codex sub-threads are child sessions linked to their parent (indented card + connector); *Hide spawned agents* |
| Review state as a dropdown; keep alias; tags with autocomplete and tag filter; notes with line breaks; details toggle | Dropdown in the details panel and on every card; tag autocomplete (prefix, then substring, most used first; Tab/Enter); notes rendered with `pre-wrap`; *Show notes & tags* shows alias, tags, full notes and checklist progress on cards |

Removed: the old tree sidebar and center detail views (`features/repository-tree`, `features/git-inspector`).

### Verification run (2026-10-30, this machine)

| Command | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | 12 files, 107 tests passed |
| `npm run build` | exit 0 |
| `npm run test:integration` | 6 files, 73 tests passed |
| `npm run test:e2e` | 16 passed (Edge); docs screenshot regenerated with the opt-in spec (temp paths masked) |
| `npm run docs:build` | exit 0 |

Real data (read-only, counts only): Claude adapter now reports 858 sessions including 674 spawned subagents, 849 with an excerpt, in about 1.3 s cold and 50 ms incrementally (about 120 MB RSS); Codex 13 threads including 8 sub-threads. Commit graph on a local 29-branch repository: 214 commits (64 unpushed) in 46 ms.

Bugs found and fixed while verifying: a pairing link opened in an already-open tab was ignored (hash-only navigation); newly started agents could land behind the per-branch *show more* cutoff because live diffs append to the client's arrays (the layout now orders by start time); clicks on graph nodes did not select their row; a `key: value` redaction rule let `Authorization: Bearer …` tokens through.

### Open items

- Unchanged from checkpoint 1 (no GitHub remote yet, so CI and Pages have not run).
- Repositories with many branches show every local branch by default; the *Branches* menu narrows to checked-out branches or branches with agents.

## Checkpoint 1 — 2026-10-30: v0.1.0, phases P0–P6 implemented

### Environment used

Windows 11 Enterprise (10.0.26200), Node.js 24.21.0, npm 11.19.0, Git 2.56.0.windows.4, Python 3.14.7 with MkDocs 1.6.1, Microsoft Edge (Playwright channel), GitHub CLI 2.103.3. Local provider data present: Claude Code 2.1.286 and Codex 0.165.

### Bootstrap

- `D:\repobs` contained only the handoff document and was not a Git repository. Initialized Git (`main`); no remote was created or pushed. The handoff is retained verbatim with a provenance note at `docs/development/product-handoff.md` (the original copy under `docs/` was removed to keep the docs tree clean).
- `AGENTS.md` and `CLAUDE.md` use the exact starter content from handoff section 8.

### Phase status

| Phase | Status | Evidence |
| --- | --- | --- |
| P0 Foundation | Done | npm workspaces (contracts, server, web), strict TS, ESLint, Vitest/Playwright, app-local storage, security shell, MkDocs + workflows |
| P1 Git | Done | `tests/git/*` incl. read-only proof against real disposable repositories |
| P2 Tree UI | Done | Workbench, tree, inspectors, filters, persisted view state; Playwright keyboard, virtualization, theme, empty/error states |
| P3 Agent discovery | Done (live: Claude + Codex) | `tests/sessions/*`, `tests/api/api.int.test.ts`; smoke run against real local data (counts only, below) |
| P4 Live updates | Done | `tests/monitoring/live.int.test.ts`, e2e live test; watcher loss recovery by polling |
| P5 Annotations | Done | `tests/persistence/*`, API + e2e tests (independence, restart, source disappearance, checklist collapse) |
| P6 PR / quality / release | Done locally; CI not yet run on GitHub | Opt-in `gh` integration with fake-gh tests; launcher; docs; security tests. Workflows are written but no remote exists, so they have not executed |

### Verification run (2026-10-30, this machine)

| Command | Result |
| --- | --- |
| `npm ci` | exit 0, 0 vulnerabilities |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (after fixing three findings in the first full run) |
| `npm test` | 10 files, 83 tests passed |
| `npm run build` | exit 0 |
| `npm run test:integration` | 6 files, 71 tests passed |
| `npm run test:e2e` | 12 passed (Edge), plus the opt-in docs screenshot spec |
| `python -m pip install -r requirements-docs.txt` | exit 0 |
| `npm run docs:build` (API docs check + `mkdocs build --strict`) | exit 0 once this page exists |

Manual checks with the built app on synthetic demo data (`scripts/demo.ts`): pairing, empty state, registering through a linked-worktree path, session inspector evidence, annotations with autosave and checklist collapse, persistence across reload, and a provider record appended on disk updating the open page without a reload. Launcher checks: `npm start` reuses a running instance ("already running"), falls back to the next port when the port is taken, and leaves no server process when the launcher is killed (Windows terminates the child with its launcher; with a non-piped parent the server's watchdog shuts down cleanly and removes `runtime.json`).

**Real-data smoke test (read-only, counts only):** Claude adapter found 184 sessions on this machine (183 with provider titles) in about 0.9 s cold and about 40 ms incrementally, about 95 MB RSS; states: 87 turn completed, 82 interrupted, 8 provider-reported idle, 2 provider-reported busy, 5 unknown (stale). Codex adapter found 5 top-level threads (subagent threads folded into parents). No content was recorded.

### Live vs synthetic

- **Verified live (real local files, read-only):** Claude transcripts, Claude live-session registry (`busy`/`idle`), Claude subagent folders, Codex rollouts spanning multiple files, Codex `session_index.jsonl`, Codex subagent threads.
- **Synthetic only:** Codex approval / user-input request events (protocol names, not observed in local logs), Claude registry statuses other than `busy`/`idle`, provider error events, the GitHub CLI (fake `gh`; the real `gh` was not called), Linux/macOS behaviour (CI configured, not yet run).

### Known blockers / open items

- No GitHub remote exists, so CI, Pages deployment, `site_url`/`repo_url` in `mkdocs.yml` and the README clone URL are pending the owner creating the repository and enabling *Settings → Pages → Source: GitHub Actions*.
- Third-party actions are pinned to major versions; pin to commit SHAs when the security policy requires.
- With a piped launcher on Windows, killing the launcher terminates the server abruptly (no orphan, but `runtime.json` stays until the next start, which ignores stale entries).

### Next actions

1. Create the GitHub repository, push `main`, confirm both workflows are green on `windows-latest` and `ubuntu-latest`, then set `site_url`/`repo_url`.
2. Exercise the GitHub PR integration with a real `gh` login on a test repository.
3. Consider an explicit, opt-in, report-only Claude Code hook bridge for direct approval-wait evidence (new ADR required).
4. Packaged executable / installer (nice-to-have).
