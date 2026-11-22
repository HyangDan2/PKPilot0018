#!/usr/bin/env python3
"""Render Sigrún's HD2Lab-standard icon set from the dual-skew mark.

Source of truth is the 64x64 Soft Iris mark shared by every HD2Lab web app:

    <rect width="64" height="64" rx="12" fill="#FAFAFD" stroke="#E8E4F2" stroke-width="2"/>
    <path d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z" fill="none" stroke="#8B6CE8" stroke-width="4"/>

The mark is rasterised with Pillow at 1024px (16x supersampling of the 64
viewBox) and downsampled with LANCZOS, which keeps the 4px strokes crisp at
32px and 180px without needing cairo. The two parallelograms are stroked by
offsetting their outlines with miter joins, so the corners stay square exactly
as the SVG miter join renders them.

    python3 tools/make_icons.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public"

MARK_BG = "#FAFAFD"
MARK_EDGE = "#E8E4F2"
MARK_STROKE = "#8B6CE8"

FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    f'<rect width="64" height="64" rx="12" fill="{MARK_BG}" stroke="{MARK_EDGE}" stroke-width="2"/>'
    f'<path d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z" fill="none" stroke="{MARK_STROKE}" stroke-width="4"/>'
    "</svg>\n"
)

VIEW = 64
MASTER = 1024
SCALE = MASTER / VIEW
STROKE = 4 * SCALE / 2  # half of the 4px stroke, already in master pixels

# The two parallelograms of the standard mark, in 64-viewBox units.
FRONT = [(15, 20), (35, 10), (35, 43), (15, 53)]
BACK = [(29, 24), (49, 14), (49, 47), (29, 57)]


def u(v: float) -> float:
    return v * SCALE


def _area(poly: list[tuple[float, float]]) -> float:
    total = 0.0
    for i, (x0, y0) in enumerate(poly):
        x1, y1 = poly[(i + 1) % len(poly)]
        total += x0 * y1 - x1 * y0
    return total / 2


def offset(poly: list[tuple[float, float]], d: float) -> list[tuple[float, float]]:
    """Offset a convex polygon by d (positive = outward) with miter joins."""
    n = len(poly)
    sign = 1.0 if _area(poly) > 0 else -1.0
    lines: list[tuple[float, float, float]] = []  # (a, b, c) for a*x + b*y = c
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        # Outward normal for this winding.
        nx, ny = sign * dy / length, -sign * dx / length
        lines.append((nx, ny, nx * x0 + ny * y0 + d))

    out: list[tuple[float, float]] = []
    for i in range(n):
        a1, b1, c1 = lines[i - 1]
        a2, b2, c2 = lines[i]
        det = a1 * b2 - a2 * b1
        out.append(((c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det))
    return out


def stroke_polygon(mask: ImageDraw.ImageDraw, poly: list[tuple[float, float]], half: float) -> None:
    outer = offset(poly, half)
    inner = offset(poly, -half)
    mask.polygon(outer, fill=255)
    mask.polygon(inner, fill=0)


def render_master() -> Image.Image:
    """The 64-viewBox favicon rasterised at 1024x1024."""
    img = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background tile: the SVG stroke is centred on the rect edge, so only its
    # inner half is visible -> a 1px border inside a 12px rounded tile.
    draw.rounded_rectangle([0, 0, MASTER - 1, MASTER - 1], radius=u(12), fill=MARK_EDGE)
    draw.rounded_rectangle(
        [u(1), u(1), MASTER - 1 - u(1), MASTER - 1 - u(1)],
        radius=u(11),
        fill=MARK_BG,
    )

    shape = Image.new("L", (MASTER, MASTER), 0)
    sdraw = ImageDraw.Draw(shape)
    for poly in (BACK, FRONT):
        stroke_polygon(sdraw, [(u(x), u(y)) for x, y in poly], STROKE)
    img.paste(Image.new("RGBA", (MASTER, MASTER), MARK_STROKE), (0, 0), shape)
    return img


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    master = render_master()

    (OUT / "favicon.svg").write_text(FAVICON_SVG, encoding="utf-8")

    for name, size in (("favicon-32x32.png", 32), ("apple-touch-icon.png", 180)):
        master.resize((size, size), Image.LANCZOS).save(OUT / name, "PNG", optimize=True)

    master.resize((256, 256), Image.LANCZOS).convert("RGBA").save(
        OUT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)]
    )

    for name in ("favicon.svg", "favicon-32x32.png", "apple-touch-icon.png", "favicon.ico"):
        p = OUT / name
        print(f"{name:22s} {p.stat().st_size:>7,d} B {'%.3f KiB' % (p.stat().st_size / 1024)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
