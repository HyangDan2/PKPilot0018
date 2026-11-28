#!/usr/bin/env python3
"""Render Statelia's HD2Lab brand icon set from the official dual-skew mark.

The mark is the HD2Lab brand lockup used in every hub and app header: two
sheared frames (vertical sides, a 26.57° rise on the top/bottom edges) that
cross, the front frame offset right and down so the thin background sliver of
the lockup stays visible. It is *not* the simplified single-outline favicon
glyph that earlier revisions of this file drew — that glyph only touched at the
corners and lost the interlocking geometry of the real mark.

Outputs (public/): favicon.svg, favicon-32x32.png, apple-touch-icon.png (180),
favicon.ico (16/32/48). Everything is derived from `geometry()` below, so the
vector and the raster set can never drift apart.

    python3 tools/make_icons.py
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"

BG = "#FAFAFD"
EDGE = "#E8E4F2"
INK = "#8B6CE8"

# Official mark, in 64-viewBox units — fitted to the brand
# assets/apple-touch-icon.png (IoU 0.98 at 180px).
ANG = 0.5          # tan of the rise of the top/bottom edges (26.57 deg)
W, H, T = 20.0, 32.8, 4.0   # frame width, frame height, stroke
DX, DY = 14.0, 11.1         # front frame offset, right and down
CENTRE = (32.0, 33.4)       # optical centre inside the 64 box


def _offset(poly, d: float):
    """Offset a convex polygon by d (positive = outward) with miter joins."""
    n = len(poly)
    area = 0.0
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        area += x0 * y1 - x1 * y0
    sign = 1.0 if area > 0 else -1.0
    lines = []
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        nx, ny = sign * dy / length, -sign * dx / length
        lines.append((nx, ny, nx * x0 + ny * y0 + d))
    out = []
    for i in range(n):
        a1, b1, c1 = lines[i - 1]
        a2, b2, c2 = lines[i]
        det = a1 * b2 - a2 * b1
        out.append(((c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det))
    return out


def _frame(x: float, ytop: float):
    """One frame ring: a rect sheared by ANG, then offset by +/- T/2."""
    rect = [(x, ytop), (x + W, ytop), (x + W, ytop + H), (x, ytop + H)]
    sheared = [(px, py - ANG * px) for px, py in rect]
    return _offset(sheared, T / 2), _offset(sheared, -T / 2)


def geometry():
    """Both frame rings, centred in the 64-unit viewBox."""
    o1, i1 = _frame(0.0, 0.0)
    o2, i2 = _frame(DX, DY)
    xs = [p[0] for p in o1 + o2]
    ys = [p[1] for p in o1 + o2]
    ox = CENTRE[0] - (min(xs) + max(xs)) / 2
    oy = CENTRE[1] - (min(ys) + max(ys)) / 2
    shift = lambda poly: [(x + ox, y + oy) for x, y in poly]  # noqa: E731
    return shift(o1), shift(i1), shift(o2), shift(i2)


def _path(outer, inner) -> str:
    pts = lambda poly: "M" + "L".join(f"{x:.3f} {y:.3f}" for x, y in poly) + "Z"  # noqa: E731
    return pts(outer) + pts(inner)


def svg() -> str:
    o1, i1, o2, i2 = geometry()
    # One <path> per frame: each ring is filled on its own, so where the two
    # frames cross the strokes merge instead of knocking each other out.
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        f'<rect width="64" height="64" rx="12" fill="{BG}" stroke="{EDGE}" stroke-width="2"/>'
        f'<path fill="{INK}" fill-rule="evenodd" d="{_path(o1, i1)}"/>'
        f'<path fill="{INK}" fill-rule="evenodd" d="{_path(o2, i2)}"/>'
        "</svg>\n"
    )


def icon(size: int) -> Image.Image:
    """The rounded-square icon with the official mark, at `size` px."""
    ss = 8 if size <= 64 else 4
    S = size * ss
    u = S / 64.0
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=12 * u, fill=BG, outline=EDGE, width=max(1, round(2 * u))
    )
    o1, i1, o2, i2 = geometry()
    mark = np.zeros((S, S), dtype=bool)
    for o, i in ((o1, i1), (o2, i2)):
        ring = Image.new("L", (S, S), 0)
        rd = ImageDraw.Draw(ring)
        rd.polygon([(x * u, y * u) for x, y in o], fill=255)
        rd.polygon([(x * u, y * u) for x, y in i], fill=0)
        mark |= np.array(ring) > 127
    img.paste(Image.new("RGBA", (S, S), INK), (0, 0), Image.fromarray((mark * 255).astype("uint8")))
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    (OUT / "favicon.svg").write_text(svg(), encoding="utf-8")
    icon(32).save(OUT / "favicon-32x32.png")
    icon(180).save(OUT / "apple-touch-icon.png")
    icon(48).save(
        OUT / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("wrote favicon.svg, favicon-32x32.png, apple-touch-icon.png, favicon.ico")


if __name__ == "__main__":
    main()
