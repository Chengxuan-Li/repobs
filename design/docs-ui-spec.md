# repobs documentation site — UI design specification

This specification restyles the repobs documentation site (MkDocs, `docs/`) into the visual family of the repobs
application, which itself follows the EnergyAtlas family conventions recorded in `docs/development/reference-audit.md`.
Section 0 records the decisions taken for the site. **Where section 0 and a later section disagree, section 0 wins.**

This folder (`design/`) is versioned but is not part of the published site.

---

## 0. Implementation decisions

Decided by the owner on 2026-10-31 and revised on 2026-11-01 (marked *2026-11-01*), when the owner found that the site
did not match the shape of the EnergyAtlas documentation sites. These are implementation rules, not one-off
clarifications.

### 0.1 Brand

- The site stays **repobs**. This is a visual-family alignment with the repobs application, not a rename.
- The header shows only the text wordmark `repobs`: no mark in the header or the phone drawer (owner request,
  2026-10-31). The browser favicon is the repobs mark (`docs/assets/favicon.svg`, a copy of the app's
  `apps/web/public/favicon.svg`). No EnergyAtlas logo, mark or brand asset (reference audit, "No product mark").

### 0.2 Sources of truth

- **Reference UI:** the repobs application itself (ribbon, dock tab strips, section strips, data tables, buttons). No
  reference image is kept in the repository; section 0.11 describes the reference in words.
- **Site shape (2026-11-01):** the EnergyAtlas documentation sites, BEMGen
  (`energy-atlas.github.io/BEMGen-docs`) and the Energy Archetype Atlas (`energy-atlas.github.io/archetype-atlas`):
  a two-part structure, a hero with a serif italic second line, a two-cell landing grid, section index pages with a
  reading order, and a header and tab bar on one surface. Their uppercase mono labels, product mark, repository link
  and left-striped callouts are not adopted (sections 0.1, 0.11, 0.14, 0.15).
- **Palette:** `apps/web/src/theme/tokens.css`. If it changes, the docs tokens (`docs/assets/stylesheets/site.css`) follow
  it. The values in section 1 match it as of 2026-10-31.

### 0.3 Theme engine and behaviour

- The site uses **Material for MkDocs** (pinned in `requirements-docs.txt`), replacing MkDocs' built-in theme, so the
  docs get a light/dark toggle, tabs, breadcrumbs, search and instant navigation.
- The default theme follows the system preference; the light/dark toggle stays. Never force a scheme.
- Dark and light keep the same grid, typography and framing; only the tokens change.

### 0.4 Fonts

- Families: Geist (interface and prose) and Geist Mono (code, identifiers, numeric indices).
- *2026-11-01:* Cormorant Garamond italic 500, as on the EnergyAtlas sites, on the product landing page only: its
  tagline, its feature leads and its closing line (0.7); nowhere else. Its two WOFF2 subsets and OFL licence are the
  files the BEMGen documentation vendors.
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

### 0.7 Landing page: a product page

Revised on 2026-11-01 (third time, owner's review of the first product page): the landing page is a **product page** in
the manner of energyatlas.io that **opens on the film**. This replaces the earlier "restrained hero, not a marketing
page" rule, the film's earlier place under *What repobs shows*, and its caption.

- **Opening:** the film fills the window (`overrides/home.html`, Material's `hero` block, so instant navigation swaps it
  with the page): `100svh` high, the video scaled to fit (`object-fit: contain`), black wherever the film does not
  reach, no frame, no caption, no player controls and no Play or Replay button (owner, 2026-11-01).
  - **On entry** it plays by itself, muted (browsers allow only muted autoplay), and the page waits for it: scrolling
    is held (`html[data-ui-film-hold]`, `overflow: hidden`).
  - **Trying to scroll** while held (wheel, touch, or a scroll key) shows a *Skip* button. *Skip*, Escape or the film's
    end fades the film out (700 ms), releases the page and scrolls to the title.
  - **Scrolling back up** to the film (60 % of it in view) fades it in and plays it again from the start, without
    holding; scrolling away pauses it.
  - **Never held:** after the first hold in a browser tab's session (`sessionStorage`), when reduced motion is
    requested (then it does not start by itself either), when the page opens on an anchor or a restored scroll
    position, or when the browser refuses to play.
  - A click, or Space or Enter when it has focus, pauses and resumes it, so its motion can always be stopped. The
    video's accessible name says it is an animated illustration with invented repositories and agents, and how to
    pause it. `opening.js` sets the film up on every page change (Material's `document$`) and undoes it when leaving. The film is made in a separate repository
  (`repobs-video`); only the web encode (`repobs-film.mp4`, H.264 CRF 27, AAC) and its poster
  (`repobs-film-poster.jpg`) are copied here, replaced at the same paths when the film changes.
- **Header:** hidden while the page is at its top; it slides in as soon as the page scrolls (`docs/assets/javascripts/
  opening.js` sets `html[data-ui-scrolled]`) or when focus enters it. On this page it lies over the content
  (`position: fixed`), keeps the wordmark (Material's swap to the page title is undone), shows the section links *Film*,
  *Features*, *Privacy*, *Documentation* and a *Download* button, and hides the tabs and the back-to-top button. Every
  page carries the links (`overrides/partials/product-nav.html`, in a copy of Material 9.7.7's `partials/header.html`:
  refresh it when the pinned Material version changes); CSS applies all of this only while the content holds
  `.ui-product`. Below 60em the links are hidden; the menu button opens the navigation.
- **Hero:** right under the film: the product name `repobs` in Geist bold, sized to the hero's width; the tagline
  "*every worktree and coding agent, / on one local timeline.*" in Cormorant Garamond italic; one paragraph; a primary
  *Download* button (the latest release) and *Get started*. It is sticky under the header and its stage is 30vh taller
  than it, so it holds still for a short scroll before moving on with the page.
- **No frame and no rules:** no vertical rules beside the content, no strips (no *01 / Features*-style subtitles), no
  separators between sections, no page footer (previous/next).
- **Features (`#features`):** three rows, *See every branch*, *Follow every agent*, *Review on your terms*, then *Local and
  read-only* (`#local-and-read-only`, its icon beside the text, no picture). Each row has a large title, then a real
  screenshot (left, about 63 %) beside its hand-drawn icon, a lead line in the serif italic and three points.
- **Screenshots:** all 16:9 (`docs/assets/feature-*.png`, whole 1280 × 720 windows made by
  `tests/e2e/docs-screenshot.spec.ts` on the synthetic demo, temporary paths replaced by `C:\src\<name>`), shown as on
  energyatlas.io: rounded top corners (1rem; the one exception to radius 0, 0.11), a soft glow (white at 22 % in dark,
  black at 35 % in light, blurred 3rem), and a fade to transparent towards the bottom. The glow's room (4rem) is at least
  its blur, so the fade's mask never cuts it.
- **Documentation (`#documentation`):** two cards in the manner of energyatlas.io's product cards: no rules; a 4rem
  hand-drawn icon (`guide`, `developer`), an underlined title with an accent arrow, a short text; the whole card is the
  link. On hover a torn-paper wash (`docs/assets/shapes/card-wash.svg`, a mask drawn for this site) sweeps in from the
  left, slightly turned, with a faint oversized copy of the icon in the accent behind the text, and the icon's accent
  mark pulses. No motion under `prefers-reduced-motion: reduce`.
- **Closing:** a serif italic line and the two buttons. No support table on this page (the platforms are in the README
  and the limitations page).

### 0.8 Numbered section strips

On the landing page and (*2026-11-01*) the two section index pages. Never automatic on the `##` headings of ordinary
pages.

### 0.9 Content width

Prose (paragraphs, lists, headings, admonitions) is capped at about 46rem (≈ 690–920 px depending on Material's root
size). Tables, code, figures and grids use the full column; wide tables (the generated `api.md`) scroll inside their own
container; the page never overflows horizontally.

### 0.10 Breadcrumbs

`navigation.path` on; the label style (section 2.2), muted, `/` separators, no bar, background or border.

### 0.11 The reference, described

- **Surface:** black (dark) or white (light) base; a raised surface (`#1a1a1a` / `#f8fafc`) for strips, table headers and
  the tab bar; no shadows except one overlay shadow for menus; radius 0 everywhere, except the landing page's
  screenshots (0.7).
- **Page frame:** 1 px rules on pane boundaries; in the docs, the content column is bounded by two thin vertical rules.
- **Header (the ribbon):** one line on the base surface with a bottom rule; the wordmark bold in the text colour
  (*2026-11-01*, as on the EnergyAtlas sites; before, the accent colour). The search field has a plain 1 px edge.
- **Tab strip (the dock):** the base surface, like the header (*2026-11-01*; before, the raised surface), with a
  bottom rule; tab labels in the label style; the selected tab is an inverted block (text colour fill, base colour
  text) inside a thin accent outline drawn inset with a gap.
- **Section strip:** the page's own surface (*2026-11-01*, as on the EnergyAtlas sites; before, the raised surface),
  top and bottom rule, a label in the text colour; in the docs a mono `01 /` index on
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
- Cells are indexed `A`, `B`, … in mono, muted, or `01`, `02`, … in a numbered list (a reading order). No icons in
  cells; the hand-drawn icons belong to the landing page's feature rows (0.16).
- *2026-11-01:* columns fit the width (at least 14rem each), so two cells share a row on desktop and a reading order
  runs three or four to a row.

### 0.14 Navigation

- Top-level tabs (*2026-11-01*): *Home*, *User guide* and *Developer*. Each part opens with a section index page
  (`guide/index.md`, `developer/index.md`, `navigation.indexes`) that lists its pages in reading order. *User guide*:
  getting started, using repobs, status semantics, integrations, privacy and security, limitations. *Developer*:
  architecture, HTTP API, testing, progress, the decisions, the reference audit and the original handoff. Grouping
  changes no page URL; the page `user-guide.md` is titled *Using repobs* so it does not repeat its part's name.
- No `repo_url`: Material would query the GitHub API from the visitor's browser for the repository's statistics, and the
  site makes no request beyond its own origin.

### 0.15 No accent stripes

Decided by the owner on 2026-10-31, for the docs and the application alike: no card, callout, quote or message is marked
by a heavy stroke on one side (the "left border accent" pattern). State colour goes in the title, an icon, a dot or the
text; boxes are ruled evenly or not at all. Structural lines (tree guides, table column rules) are not stripes.

### 0.16 Hand-drawn feature icons

Decided by the owner on 2026-11-01, after approving a pilot.

- Six editorial ink icons for the landing page. One per feature row: `timeline` (a commit ring, the main line, a branch
  curving up to its head), `agents` (a card with a pulse line, its status light), `review` (a three-row checklist, the
  first ticked), `local` (a house with a lock on its door). One per documentation card: `guide` (an open book, its ribbon
  in the accent), `developer` (`< / >`, the slash in the accent).
- Drawn by the editorial-icons skill from `design/icons/repobs_icons.py` (the source; never edit the SVGs), rendered to
  `docs/assets/icons/<name>.svg` (regular, used at about 3.6rem) and `<name>-bold.svg` (for sizes below about 26 px,
  unused so far). Validated with `--require-matching-canvas`.
- `hooks/icons.py` replaces `<span class="ui-icon" data-icon="name"></span>` (and `ui-icon-backdrop`, a card's faint
  copy) with the inline SVG at build time, so CSS colours it: ink `currentColor` (the text colour), the one accent mark `--ui-accent`, in both themes.

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

- **Header:** base surface, bottom rule, no shadow; the wordmark in the text colour, bold (0.11).
- **Tabs:** base surface like the header, bottom rule; labels; the active tab inverted inside an inset accent outline.
- **Search:** square field with a plain 1 px interactive edge on the header's surface; accent edge when open; results
  on the base surface with a hover tint.
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
- **Grid columns:** superseded on 2026-11-01 by section 0.13: columns of at least 14rem that fit the width.
- **Local preview:** instant navigation only intercepts links listed in the sitemap, whose URLs come from `site_url`. A
  local build served elsewhere than the Pages address reloads on each click; `mkdocs serve` rewrites `site_url` and
  behaves like the published site.
