# 0004 — Reference UI alignment: label type, ribbon and dockable layout

- Status: accepted (owner request, 2026-10-30)
- Supersedes: the "No FlexLayout docking" and "Labels in Geist Mono" deviations in [the reference audit](../development/reference-audit.md)

## Context

The owner asked for closer alignment with the EnergyAtlas UI reference: panel titles are not set in a mono font there, its ribbon carries menus, a command search and layout buttons, and its panels dock in a flexible layout. repobs had a fixed three-pane shell with resizable splitters, mono uppercase labels and a ribbon of plain buttons.

## Decisions

1. **Label type.** Labels — panel and section titles, table headers, filter labels, the status bar, menus, buttons and badges — use the interface sans, sentence case, 12 px, semibold, no tracking, through `--label-*` tokens (`apps/web/src/theme/tokens.css`). Geist Mono stays for identifiers and data: branch names, commit ids, paths, counts and keyboard shortcuts.
2. **Control grammar.** Buttons are a raised block (`--button-bg`, darker on hover and press) with an even edge; fields are a well with a 2 px bottom edge. Scrollbars are dim overlays that brighten on hover.
3. **Ribbon.** Wordmark; one menu per command group (*Repositories*, *View*, *Tools*) with check marks for toggles, headed sections for submenus and shortcuts; a *Search commands* field (Ctrl+K) opening a command palette; icon buttons for Add repositories, the two panels, Maximize dashboard, Reset layout, Full screen, theme, Diagnostics and Settings. All of these come from one command list (`WorkbenchShell.tsx`), so menus, palette, buttons and shortcuts cannot disagree.
4. **Dockable layout.** `flexlayout-react` 0.11.0 (MIT, pinned) — the package the reference uses — with a repobs theme (`apps/web/src/app/dock.css`) mapping its variables to repobs tokens. The dashboard is the centre tab (not closable); *Repositories* and *Details* start in the left and right side bars and can be collapsed, dragged beside or into the dashboard, moved to the other side, or closed and docked back from the View menu. *Maximize dashboard* collapses the open panels (and maximizes the dashboard's tab set when panels are docked beside it); pressing it again restores them. The arrangement is stored per browser (`repobs.layout.v1`), validated on load (falls back to the default if unreadable or missing the dashboard; stored global settings never override the app's), and *Reset layout* restores the default. Floating and pop-out windows are off.

## Consequences

- Panel widths and open state now live in the dock model, not in the view state; the old splitter keyboard resizing is replaced by the library's splitters and F6 / Shift+F6 to move between tab sets.
- The library copies inline styles when drawing a drag preview; under the strict CSP (`style-src 'self'`) that copy could be refused. No CSP violation was observed while dragging in Edge.
- No reference code, assets or text are copied; the reference has no licence file. The theme mapping and ribbon are written for repobs, following the observed conventions.
