"""repobs feature icons: an editorial, hand-drawn family (rendered by the editorial-icons skill).

Shown on the documentation landing page's feature rows at about 64-96 px (regular weight); see design/docs-ui-spec.md.

Render (adjust the skill path):

    python <skill-dir>/scripts/ink_icons.py design/icons/repobs_icons.py --out <workspace> [name ...]

then copy the SVGs to docs/assets/icons/. Edit this module, never the rendered SVGs. Keep each icon's seed; reordering
the marks inside an icon changes its wobble.
"""

from ink_icons import Pen, arc_points, rotate, rounded_polyline  # noqa: F401  (helpers for the icons)

TITLE = "repobs feature icons"
INK = "#1f2933"                              # standalone ink; the site sets .ink to currentColor
ACCENT = "#125dae"                           # standalone accent; the site sets .accent to --ui-accent
WEIGHTS = {"regular": 1.3, "bold": 1.85}     # <name>.svg, <name>-bold.svg


def timeline(pen: Pen) -> None:
    """Branches on one timeline: a commit (open ring), the main line running on, a branch curving up to its head."""
    pen.stroke(arc_points(5.6, 16.6, 2.2, 200, 548), weight=0.95)
    pen.stroke([(8.2, 16.7), (13.0, 16.5), (20.6, 16.7)], taper=(0.8, 0.7))
    pen.stroke([(6.4, 14.2), (7.6, 10.6), (10.6, 7.9), (14.8, 7.2)], taper=(0.8, 0.85))
    pen.dot(18.4, 7.2, 2.1, accent=True)


def agents(pen: Pen) -> None:
    """Following an agent: its card with a live pulse line, the status light in the accent."""
    pen.stroke(pen.rounded_rect(3.6, 6.4, 20.4, 18.6, 2.2), closed=True, overshoot=0.3)
    pen.stroke([(6.6, 13.0), (9.0, 13.0), (10.6, 9.8), (12.8, 16.0), (14.6, 12.6), (17.4, 12.6)], taper=(0.75, 0.75), spline=False)
    pen.dot(19.6, 5.6, 2.0, accent=True)


def review(pen: Pen) -> None:
    """Your review: a checklist of three rows, the tick of the first in the accent."""
    for y in (6.6, 12.3, 18.0):
        pen.stroke(pen.rounded_rect(3.6, y - 2.0, 7.6, y + 2.0, 0.8), closed=True, overshoot=0.6, weight=0.85)
    pen.stroke([(10.6, 6.7), (15.0, 6.5), (20.4, 6.7)], taper=(0.8, 0.7))
    pen.stroke([(10.6, 12.4), (14.6, 12.2), (19.0, 12.4)], taper=(0.8, 0.7))
    pen.stroke([(10.6, 18.1), (13.4, 17.9), (16.4, 18.1)], taper=(0.8, 0.7))
    pen.stroke([(4.6, 6.4), (5.8, 7.9), (9.0, 3.4)], taper=(0.8, 0.75), spline=False, weight=0.85, accent=True)


def local(pen: Pen) -> None:
    """Local and read-only: a house, a lock on its door in the accent."""
    pen.stroke([(3.4, 11.4), (12.0, 3.8), (20.6, 11.4)], taper=(0.75, 0.75), spline=False)
    pen.stroke(rounded_polyline([(5.8, 9.6), (5.8, 20.2), (18.2, 20.2), (18.2, 9.6)], r=1.6), taper=(0.75, 0.75), spline=False)
    pen.stroke(arc_points(12.0, 13.4, 1.9, 270 - 95, 270 + 95), weight=0.85, taper=(0.8, 0.8))
    pen.blob(pen.rounded_rect(9.2, 13.6, 14.8, 17.8, 0.8, jitter=0.08), accent=True)


def guide(pen: Pen) -> None:
    """The user guide: an open book, its ribbon in the accent."""
    pen.stroke([(12.0, 7.4), (8.6, 5.6), (3.4, 5.8), (3.4, 18.4), (8.6, 18.0), (12.0, 19.6)], taper=(0.75, 0.75))
    pen.stroke([(12.0, 7.4), (15.4, 5.6), (20.6, 5.8), (20.6, 18.4), (15.4, 18.0), (12.0, 19.6)], taper=(0.75, 0.75))
    pen.stroke([(12.0, 8.4), (12.0, 13.4), (12.0, 18.4)], weight=0.85, taper=(0.8, 0.8))
    pen.blob([(15.6, 5.4), (17.6, 5.4), (17.6, 12.4), (16.6, 11.2), (15.6, 12.4)], accent=True)


def developer(pen: Pen) -> None:
    """The developer documentation: `< / >`, the slash in the accent."""
    pen.stroke([(8.0, 6.6), (3.6, 12.0), (8.0, 17.4)], taper=(0.75, 0.75))
    pen.stroke([(16.0, 6.6), (20.4, 12.0), (16.0, 17.4)], taper=(0.75, 0.75))
    pen.stroke([(13.6, 4.4), (12.0, 12.0), (10.4, 19.6)], taper=(0.8, 0.8), accent=True)


ICONS = {
    "timeline": (timeline, 7),
    "agents": (agents, 19),
    "review": (review, 23),
    "local": (local, 31),
    "guide": (guide, 41),
    "developer": (developer, 43),
}
