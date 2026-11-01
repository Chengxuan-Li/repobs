# 0007 — Documentation site in the application's visual family

- Status: accepted (owner request, 2026-10-31); amended twice on 2026-11-01 (see the amendments below)

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

## Amendment — 2026-11-01: the shape of the EnergyAtlas documentation sites

The owner found that the site did not match the shape of the EnergyAtlas documentation sites ([BEMGen](https://energy-atlas.github.io/BEMGen-docs/) and the [Energy Archetype Atlas](https://energy-atlas.github.io/archetype-atlas/)) and asked for a simpler site. Decided with the owner:

- **Two parts:** tabs *Home*, *User guide* and *Developer* replace *Guide*, *Reference* and *Development*. Each part opens with an index page listing its pages in reading order (`guide/index.md`, `developer/index.md`). No page URL changed; `user-guide.md` is titled *Using repobs*.
- **Landing page:** the headline's second line is in Cormorant Garamond italic, as on the EnergyAtlas sites (the only use of the serif); a two-cell grid, one cell per part, replaces the eight-cell grid; the other sections are fewer and shorter.
- **Surfaces:** the wordmark is in the text colour, and the tab bar and section strips are on the page's own surface between rules, no longer on the raised surface.
- **Kept:** sentence-case sans labels (the owner chose not to adopt the references' uppercase mono labels), no logo, no repository link, no left-striped callouts.

The rules are in `design/docs-ui-spec.md`, section 0, marked *2026-11-01*.

## Amendment — 2026-11-01: the landing page as a product page

The owner asked for the landing page to read as a product page rather than a documentation page, in the manner of [energyatlas.io](https://www.energyatlas.io/), with the product film. Decided with the owner:

- **Film-led:** the product name and a serif italic tagline, then the film directly under the hero (it had been under *What repobs shows*).
- **Feature rows:** *See every branch*, *Follow every agent*, *Review on your terms*, each with a new real screenshot from the synthetic demo, a hand-drawn icon, a serif lead and three points; then *Local and read-only*, *Support*, the two documentation parts and a closing call to action.
- **Hand-drawn icons:** four editorial ink icons drawn from a versioned module (`design/icons/`), inlined at build time so they follow the theme's colours.
- **Product header on the landing page:** section links and *Download* in the header line, no tabs. The links are on every page and shown by CSS only on the product page, so instant navigation stays correct.

The rules are in `design/docs-ui-spec.md`, sections 0.4, 0.7 and 0.16.
