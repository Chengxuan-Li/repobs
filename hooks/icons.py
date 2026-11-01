"""MkDocs hook: inline the hand-drawn icons (design/icons/repobs_icons.py, rendered to docs/assets/icons/).

Pages write `<span class="ui-icon" data-icon="timeline"></span>` (an icon) or `<span class="ui-icon-backdrop"
data-icon="guide"></span>` (a card's faint backdrop copy); at build time the placeholder becomes the icon's SVG, inline,
so the site's CSS colours its `.ink` and `.accent` groups with the theme (design/docs-ui-spec.md, 0.16). A missing icon
fails the build.
"""

import re
from functools import lru_cache
from pathlib import Path

ICON_DIR = Path(__file__).resolve().parents[1] / "docs" / "assets" / "icons"
PLACEHOLDER = re.compile(r'<span class="(ui-icon|ui-icon-backdrop)" data-icon="([a-z0-9-]+)"></span>')


@lru_cache(maxsize=None)
def icon_svg(name: str) -> str:
    return (ICON_DIR / f"{name}.svg").read_text(encoding="utf-8").strip()


def on_page_content(html, page, config, files):
    def render(match: re.Match) -> str:
        kind, name = match.groups()
        return f'<span class="{kind} {kind}-{name}" aria-hidden="true">{icon_svg(name)}</span>'

    return PLACEHOLDER.sub(render, html)
