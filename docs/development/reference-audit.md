# Reference audit: EnergyAtlas UI

The EnergyAtlas UI is a **visual reference only** (handoff section 2.1). This page records what was inspected, what was taken as a design principle, and where repobs deviates.

## Inspected source

- Repository: `Energy-Atlas/energyatlas-ui` (<https://github.com/Energy-Atlas/energyatlas-ui>), read from a local read-only checkout.
- Revision: `master` at `27e8a1f39a98e55e8b7e2ddad2339ac4971d09c3` (2026-10-27); the inspected design files were last changed in `68eec8dec5a132fa669bb5cc5f145d5d082532bd` (2026-10-27).
- Files read: `docs/20260915_energyatlas_ui_design_guidelines.md`, `docs/decisions/0021-energyatlas-family-ui-alignment.md`, `src/index.css`, `src/app/appearance/appearances.ts`, `src/assets/fonts/README.md`, `package.json`.
- Inspected on 2026-10-30. The reference repository has **no license file**, so no code, assets, logos or text were copied. Colour values below are the starting palette that the repobs handoff itself specifies; they match the reference tokens.

## Observed facts and how repobs uses them

| Reference (observed) | repobs |
| --- | --- |
| Light tokens: bg/surface `#ffffff`, raised `#f8fafc`, text `#18202c`, muted `#5f6b7a`, rule `#cfd8e5`, interactive edge `#768599`, accent `#125dae`, selection `#e7eff7` | Same starting values (`apps/web/src/theme/tokens.css`) |
| Dark tokens: bg `#000000`, raised `#1a1a1a`, text `#e5e5e5`, muted `#999999`, rule `#404040`, accent `#4da3ff`, selection `#0c1a29` | Same starting values |
| Tone pairs for success / info / warning / danger / neutral (text + 8 % / 16 % tint) | Same semantic roles; running sessions use **info**, never success (handoff: activity is not success) |
| Type scale: label 11 px, small 12 px, base 13 px, title 15 px | Same four roles (rem based, so user scaling works) |
| Geist for UI text, Geist Mono for labels, identifiers and logs | Geist + Geist Mono via `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` 5.3.0 (SIL OFL 1.1, bundled; no font host) with system fallbacks (`Segoe UI`, `Cascadia Code`, `Consolas`) |
| Radius 0, no shadows except one overlay shadow for menus/dialogs | Same |
| Rules on pane boundaries, under the ribbon, above the status bar, under header strips; section strips on the raised surface with small uppercase mono labels | Same; tree pane, center and inspector separated by 1 px rules with resizable splitters |
| Buttons: square, 1 px interactive edge, hover turns edge and label to accent; primary is an inverted block; disabled has a dashed edge and still explains itself | Same (`.btn`, `.btn-primary`, disabled buttons carry a `title` reason) |
| Data tables: raised header with mono uppercase labels, rules between rows, no zebra striping | Same (`.data-table`) |
| Narrow one-line ribbon, bottom status bar, contextual inspection panel | Same information architecture with repobs content |
| Light / dark / system appearance, persisted; first frame set before the bundle runs | Same behaviour; persisted on the server (Settings) and mirrored to `localStorage` for the first frame via an external `theme-init.js` (the CSP forbids inline scripts) |

## Deliberate deviations

- **No FlexLayout docking.** The reference docks panes with FlexLayout; repobs uses a stable three-pane shell (handoff 3.2) with stable pane ids for later docking.
- **Tree instead of workflow stages.** The main navigation is the repository → branch → worktree → session tree; no 12-stage process, maps, charts, chat or compute controls were taken.
- **Custom accessible tree instead of React Aria.** See [decision 0002](../decisions/0002-engineering-choices.md); the reference uses React Aria Components elsewhere.
- **Labels in Geist Mono.** The reference owner moved labels back to Geist (decision 0021, section 12); repobs keeps Geist Mono for small technical labels, as the repobs handoff asks.
- **Fonts from npm, not vendored.** repobs installs Geist Mono from `@fontsource-variable/geist-mono` (pinned) for version and license tracking instead of vendoring files.
- **No product mark.** repobs uses a plain text wordmark and a generic favicon; no EnergyAtlas logo or brand asset.
