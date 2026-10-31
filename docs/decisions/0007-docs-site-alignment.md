# 0007 — Documentation site in the application's visual family

- Status: accepted (owner request, 2026-10-31)

## Context

The documentation site used MkDocs' built-in theme with a light CSS restyle: no dark mode, Bootstrap shapes and system fonts. The application already follows the EnergyAtlas family conventions (ADR 0004, [reference audit](../development/reference-audit.md)); the documentation looked like a different product.

## Decision

- Switch the site to **Material for MkDocs** (pinned in `requirements-docs.txt`) and style it with the application's tokens: same light and dark palette, Geist and Geist Mono, square ruled surfaces, labels in sentence-case semibold sans, the inverted selected tab, raised section strips, buttons and data tables as in the app.
- The full rules live in `design/docs-ui-spec.md` (versioned, not published); its section 0 records the owner's decisions and wins over the rest. `AGENTS.md` points to it.
- Fonts are copied from the `@fontsource-variable` packages the app already pins into `docs/assets/fonts/` with their OFL licences; the site makes no request to a font host or any other origin (no `repo_url`, so no GitHub API call from visitors' browsers).
- The landing page gets a restrained hero and a grid of the documentation pages, keeping its existing sections under numbered strips. Navigation is grouped into *Guide*, *Reference* and *Development* tabs without changing any page URL.
- `site_url` is set to the GitHub Pages address (instant navigation needs it).
- The generated `api.md` is styled through CSS only.

## Consequences

- The docs build needs `pip install -r requirements-docs.txt` (MkDocs 1.6.1 and Material 9.7.7) as before; the Pages workflow is unchanged.
- Light/dark follows the system with a toggle; the visitor's choice is remembered by the browser.
- Palette changes in `apps/web/src/theme/tokens.css` must be mirrored in `docs/assets/stylesheets/site.css`.
