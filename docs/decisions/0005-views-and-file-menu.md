# 0005 — Views: several named dashboards; File and View menus

- Status: accepted (owner request, 2026-10-31)
- Amends: [0004](0004-reference-ui-alignment-ribbon-docking.md) (ribbon menus and icon buttons, single dashboard tab)

## Context

The owner asked for several instances of the dashboard, each a named view with its own repository selection, while the repositories panel stays the one list of every repository in the project; for side panels that keep their entries on one line; and for a ribbon with *File* (Export, Open, Settings, Diagnostics) and *View* (Panels, Open new view, Styling, Full screen, Refresh) menus, keeping only the side-panel and theme icon buttons.

## Decisions

1. **Views are dashboard tabs.** Any number of tabs with component `dashboard` in the dock (`dockLayout.ts`); each is renamable (double-click, or *Rename view* in Search commands) and closable, except the last. Names are trimmed, non-empty and unique (case-insensitive); refused changes say why.
2. **Naming.** A new view is *View n* with the smallest n not used by another view's *View n* name, counting from 0 (`nextViewName`). The single dashboard of an older stored arrangement becomes *View 0*, keeping its tab id so its settings carry over.
3. **Per-view settings.** Filters, display toggles, axis, zoom, collapsed/expanded rows and the repository selection belong to the view (`ViewState`, stored per view id in `repobs.workbench.v1`); the selection and the repository sort order are shared. Settings of closed views are dropped. The view state from before views (`repobs.view.v2`) becomes the settings of views that have none yet.
4. **Repositories.** The repositories panel lists every registered repository (with a *Sort* dropdown). A view hides repositories rather than listing the ones it shows, so a newly registered repository appears in every view. The panel's ticks edit the *current view* — the view last selected, clicked or focused — and say which view that is; each view also has a *Repositories* dropdown.
5. **Menus and icons.** The ribbon has *File* and *View* menus only; commands without a menu (the current view's display options, rename, zoom, repository sorting, adding repositories) remain in Search commands and in their own controls. Icon buttons: repositories panel, details panel, theme. *Maximize view* and *Reset layout* sit under *View → Panels*; *Reset layout* keeps every view.
6. **Export and Open.** *Export* writes one JSON file (`format: "repobs-export"`, version 1): the server's sanitized annotation export (no transcript content) and every view's id, name and settings plus the arrangement. *Open* merges the annotations through the existing import endpoint and replaces the views; view settings are normalized on the way in (unknown fields dropped, invalid values defaulted) and the arrangement is used only if it parses and holds those views, else the views open side by side as tabs. A plain annotation export is accepted too. Files over 20 MB are refused.
7. **Refresh** asks the server to rescan everything now (`POST /rescan`); live updates make it rarely necessary.
8. **Side panel widths.** Repositories at least 280 px (default 300), details at least 320 px; stored side bars narrower than that are widened on load. Repository entries no longer wrap (ellipsis).

## Consequences

- Each view computes its own layout of the repositories it shows; the details panel resolves a selected branch row against the current view.
- The e2e suite drives the menus instead of the retired icon buttons and covers views, per-view repositories, renaming, closing and export/open.
