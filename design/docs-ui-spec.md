# repobs documentation site — UI design specification

This specification restyles the repobs documentation site (MkDocs, `docs/`) into the visual family of the repobs
application, which itself follows the EnergyAtlas family conventions recorded in `docs/development/reference-audit.md`.
Section 0 records the decisions taken for the site. **Where section 0 and a later section disagree, section 0 wins.**

This folder (`design/`) is versioned but is not part of the published site.

---

## 0. Implementation decisions

Decided by the owner on 2026-10-31. These are implementation rules, not one-off clarifications.

### 0.1 Brand

- The site stays **repobs**. This is a visual-family alignment with the repobs application, not a rename.
- The header shows only the text wordmark `repobs`: no mark in the header or the phone drawer (owner request,
  2026-10-31). The browser favicon is the repobs mark (`docs/assets/favicon.svg`, a copy of the app's
  `apps/web/public/favicon.svg`). No EnergyAtlas logo, mark or brand asset (reference audit, "No product mark").

### 0.2 Sources of truth

- **Reference UI:** the repobs application itself (ribbon, dock tab strips, section strips, data tables, buttons). No
  reference image is kept in the repository; section 0.11 describes the reference in words.
- **Palette:** `apps/web/src/theme/tokens.css`. If it changes, the docs tokens (`docs/assets/stylesheets/site.css`) follow
  it. The values in section 1 match it as of 2026-10-31.

### 0.3 Theme engine and behaviour

- The site uses **Material for MkDocs** (pinned in `requirements-docs.txt`), replacing MkDocs' built-in theme, so the
  docs get a light/dark toggle, tabs, breadcrumbs, search and instant navigation.
- The default theme follows the system preference; the light/dark toggle stays. Never force a scheme.
- Dark and light keep the same grid, typography and framing; only the tokens change.

### 0.4 Fonts

- Families: Geist (interface and prose) and Geist Mono (code, identifiers, numeric indices). No serif: the application has
  none.
- Self-hosted in `docs/assets/fonts/` (copied from the `@fontsource-variable` 5.3.0 packages the app already pins, Latin
  and Latin Extended subsets, with their OFL licences), declared in `docs/assets/stylesheets/fonts.css`;
  `theme.font: false`. The browser contacts no font host.

### 0.5 Colour roles

| Role | Dark | Light | Use |
| --- | --- | --- | --- |
| Accent / info | `#4da3ff` | `#125dae` | links, navigation, information, active and selected states, focus |
| Success | `#28a745` | `#188038` | success admonitions |
| Warning | `#ffc107` | `#946300` | warnings |
| Danger | `#f44336` | `#c5221f` | errors, destructive actions, failures |

- Red only for error, destructive and failure states; never decorative.
- Admonitions: `note`, `info`, `abstract`, `tip`, `question` accent; `success` green; `warning` amber; `danger`,
  `failure`, `bug`, `error` red; `example`, `quote` muted.

### 0.6 Contrast

Targets (WCAG 2.2 AA): text below 24 px at least 4.5:1 on every surface it sits on; large text 3:1; borders of controls
3:1; decorative grid rules may stay lighter. The application palette already meets them, so no value is adjusted:

| Token | Theme | Value | Contrast |
| --- | --- | --- | --- |
| `--ui-text-muted` | dark | `#999999` | 7.37 on `#000000`, 6.11 on `#1a1a1a`, 6.17 on `#0c1a29` |
| `--ui-text-muted` | light | `#5f6b7a` | 5.43 on `#ffffff`, 5.19 on `#f8fafc`, 4.67 on `#e7eff7` |
| `--ui-accent` | dark | `#4da3ff` | 8.00 on `#000000`, 6.63 on `#1a1a1a` |
| `--ui-accent` | light | `#125dae` | 6.56 on `#ffffff`, 5.65 on `#e7eff7` |
| `--ui-border-interactive` | dark | `#6b6b6b` | 3.94 on `#000000`, 3.27 on `#1a1a1a` |
| `--ui-border-interactive` | light | `#768599` | 3.76 on `#ffffff`, 3.59 on `#f8fafc` |
| `--ui-border-subtle` | both | `#404040` / `#cfd8e5` | decorative only (2.03 / 1.44) |
| Warning text | light | `#946300` | 5.19 on `#ffffff` |

### 0.7 Landing page

- A restrained hero followed immediately by a shared-border grid of the documentation pages; not a marketing page.
- Headline: "Observe your Git worktrees and coding agents, locally." in Geist bold; one sentence of supporting copy; a
  primary *Get started* button and a *Download* button (the releases page).
- The landing page hides both sidebars but keeps their widths as empty margins, without their rules, so its text starts
  where every other page's text starts. Strips and grid rules still run from frame to frame.
- The headline is sized to the hero's width (container query units) so it stays on at most two lines on desktop.
- The page's existing sections (what it answers, the screenshot, what repobs is not, privacy, support matrix) stay, under
  numbered strips.

### 0.8 Numbered section strips

Only on the landing page. Never automatic on the `##` headings of ordinary pages. The site has no section index pages.

### 0.9 Content width

Prose (paragraphs, lists, headings, admonitions) is capped at about 46rem (≈ 690–920 px depending on Material's root
size). Tables, code, figures and grids use the full column; wide tables (the generated `api.md`) scroll inside their own
container; the page never overflows horizontally.

### 0.10 Breadcrumbs

`navigation.path` on; the label style (section 2.2), muted, `/` separators, no bar, background or border.

### 0.11 The reference, described

- **Surface:** black (dark) or white (light) base; a raised surface (`#1a1a1a` / `#f8fafc`) for strips, table headers and
  the tab bar; no shadows except one overlay shadow for menus; radius 0 everywhere.
- **Page frame:** 1 px rules on pane boundaries; in the docs, the content column is bounded by two thin vertical rules.
- **Header (the ribbon):** one line on the base surface with a bottom rule; the wordmark bold in the accent colour.
- **Tab strip (the dock):** raised surface with a bottom rule; tab labels in the label style; the selected tab is an
  inverted block (text colour fill, base colour text) inside a thin accent outline drawn inset with a gap.
- **Section strip:** raised surface, top and bottom rule, a label in the text colour; in the docs a mono `01 /` index on
  the left and a muted note on the right.
- **Buttons:** square, 1 px interactive edge, a raised fill (text colour at 8 %); hover turns the edge to the accent;
  primary is an inverted block that turns accent on hover.
- **Data tables:** raised header row with labels in the label style, muted; rules between rows; no zebra striping.
- **Labels:** the interface sans, sentence case, 12 px semibold. Mono only for identifiers, code and numeric indices.
- **Not adopted:** the application's dense 13 px base size (docs prose needs a reading size), its status bar, menus and
  command palette, docking, and any uppercase tracked mono labels (the app moved away from them in ADR 0004).

### 0.12 Stable page changes

- `navigation.instant` and `navigation.instant.progress` are on (they need `site_url`, set to the GitHub Pages address).
- `html` reserves the scrollbar's width (`scrollbar-gutter: stable`).
- `overrides/main.html` preloads `geist-latin.woff2` and `geist-mono-latin.woff2`.

### 0.13 Grid cells

- A cell whose title is a link is clickable as a whole; other links in it keep their own targets.
- Cell text is padded by the article gutter, so it lines up with strips and prose.
- Every cell is closed on all four sides; where an empty sidebar margin moves a grid in from the frame, the grid draws its
  own outer rules.
- Cells are indexed `A`, `B`, … in mono, muted. No icons.

### 0.14 Navigation

- Top-level tabs: *Home*, *Guide* (getting started, user guide, status semantics, integrations, privacy and security,
  limitations), *Reference* (architecture, HTTP API) and *Development*. Grouping changes no page URL.
- No `repo_url`: Material would query the GitHub API from the visitor's browser for the repository's statistics, and the
  site makes no request beyond its own origin.

### 0.15 No accent stripes

Decided by the owner on 2026-10-31, for the docs and the application alike: no card, callout, quote or message is marked
by a heavy stroke on one side (the "left border accent" pattern). State colour goes in the title, an icon, a dot or the
text; boxes are ruled evenly or not at all. Structural lines (tree guides, table column rules) are not stripes.

---

## 1. Tokens

One prefix, `--ui-`, defined per Material scheme (`[data-md-color-scheme="slate"]` dark, `"default"` light), the same names
in both, then mapped onto Material's own variables.

| Token | Dark | Light |
| --- | --- | --- |
| `--ui-bg-base` | `#000000` | `#ffffff` |
| `--ui-bg-raised` | `#1a1a1a` | `#f8fafc` |
| `--ui-bg-hover` | `#111418` | `#f1f5f9` |
| `--ui-bg-selected` | `#0c1a29` | `#e7eff7` |
| `--ui-text-primary` | `#e5e5e5` | `#18202c` |
| `--ui-text-secondary` | `#b3b3b3` | `#3f4b5b` |
| `--ui-text-muted` | `#999999` | `#5f6b7a` |
| `--ui-border-subtle` | `#404040` | `#cfd8e5` |
| `--ui-border-interactive` | `#6b6b6b` | `#768599` |
| `--ui-accent` | `#4da3ff` | `#125dae` |
| `--ui-success` | `#28a745` | `#188038` |
| `--ui-warning` | `#ffc107` | `#946300` |
| `--ui-danger` | `#f44336` | `#c5221f` |
| `--ui-button-bg` | text 8 % on base | text 8 % on base |

`--ui-text-secondary` is the app's neutral tone text (`--tone-neutral-text`): body copy; headings and `strong` use the
primary text colour.

## 2. Typography

### 2.1 Scale

Material's root font size is 20 px (rem-based, larger on very wide screens); sizes are in rem so they scale with it.

| Role | Size | Weight |
| --- | --- | --- |
| Hero headline | container-sized, 1.6–2.8rem | 700, tracking −0.03em |
| `h1` | 1.6rem | 700, tracking −0.02em |
| `h2` | 1.2rem | 650 |
| `h3` | 0.95rem | 650 |
| Prose | 0.75rem (15 px) | 400, line height 1.6 |
| Label | 0.6rem (12 px) | 600, sentence case |
| Code | 0.85em of its context | Geist Mono |

### 2.2 Labels

Tabs, breadcrumbs, sidebar section titles, the table-of-contents title, table headers, admonition titles, buttons and
footer directions use the label style: Geist, 0.6rem, semibold, sentence case, muted unless active.

## 3. Components

- **Header:** base surface, bottom rule, no shadow; the wordmark in the accent colour, bold.
- **Tabs:** raised surface, bottom rule; labels; the active tab inverted inside an inset accent outline.
- **Search:** square field with the interactive edge and a heavier bottom edge (the app's field grammar); accent edge
  when open; results on the base surface with a hover tint.
- **Sidebars:** navigation links in the secondary colour, the active page in the accent with a thin accent edge; section
  titles in the label style; the table of contents hangs from a thin rule.
- **Code:** square blocks on the raised surface with a subtle rule; inline code on the raised surface without a border.
- **Tables:** square subtle outer edge, rules between rows and columns, raised header row in the label style, accent tint
  on row hover.
- **Admonitions:** transparent body, an even subtle edge on all four sides (no left stripe, spec 0.15), title in the label
  style in the state colour on a rule.
- **Buttons:** the app's button (section 0.11); primary inverted.
- **Footer:** previous/next with label-style directions; a meta line with a top rule.
- **Strips and grids:** sections 0.8 and 0.13.
- **Motion:** 150 ms colour transitions; none under `prefers-reduced-motion: reduce`.

## 4. Additions found during verification (2026-10-31)

- **Wide tables:** in a table of five or more columns (the generated API index) the last column, which holds prose, keeps
  a minimum width of 16rem; the table scrolls inside its container instead of wrapping that column a word per line.
- **Phone drawer on the landing page:** the landing page hides its navigation sidebar, which also emptied Material's phone
  drawer. Below the tabs breakpoint the sidebar is shown as the drawer anyway, so the menu button always opens the
  navigation.
- **Grid columns:** four columns from 60em, two from 30em, one below, so the landing grid's eight cells fill whole rows.
- **Local preview:** instant navigation only intercepts links listed in the sitemap, whose URLs come from `site_url`. A
  local build served elsewhere than the Pages address reloads on each click; `mkdocs serve` rewrites `site_url` and
  behaves like the published site.
