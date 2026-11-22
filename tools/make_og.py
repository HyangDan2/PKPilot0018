#!/usr/bin/env python3
"""Render Sigrún's 1200x630 Open Graph card in the HD2Lab standard layout.

Reference cards: downloads/check_p14_og.png, check_p15_og.png, check_apphub_og.png
— Soft Iris background (#FAFAFD) with a faint 40px lavender grid, the dual-skew
lockup at the top left (mark + HD2Lab bold + hairline + app name in neutral
#544E68), a mono eyebrow, a two-line bold headline, a short sub-copy line, pill
chips bottom-left and the project URL bottom-right (neutral base + accent slug).

The right-hand white card carries a capability preview for C1 · Thickness. Its
specification limits are drawn as VERTICAL dashed lines on the X (measurement)
axis — LSL on the left of the mean, USL on the right — never as horizontal
Y-axis lines.

Everything is drawn at 2x and downsampled to 1200x630.

    python3 tools/make_og.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

S = 2
W, H = 1200, 630

FONT_DIR = Path("/usr/share/fonts/truetype/liberation")
SANS = FONT_DIR / "LiberationSans-Regular.ttf"
SANS_B = FONT_DIR / "LiberationSans-Bold.ttf"
MONO = FONT_DIR / "LiberationMono-Regular.ttf"
MONO_B = FONT_DIR / "LiberationMono-Bold.ttf"

INK = "#1D192B"
BODY = "#544E68"
MUTED = "#7C7690"
ACCENT = "#8B6CE8"
ACCENT_TEXT = "#6B4CD6"
ACCENT_SOFT = "#F1ECFE"
BORDER = "#E8E4F2"
LINE_SOFT = "#EFEBF7"
GRID = "#F6F4FC"
DANGER = "#E0395C"
OK = "#0F9D76"
SURFACE = "#FFFFFF"
BACKGROUND = "#FAFAFD"

TAU = math.tan(math.radians(23))


# ── drawing helpers ────────────────────────────────────────────────────────
def px(x: float, y: float) -> tuple[float, float]:
    return (x * S, y * S)


def box(x0: float, y0: float, x1: float, y1: float) -> list[float]:
    return [x0 * S, y0 * S, x1 * S, y1 * S]


def f(path: Path, size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), int(round(size * S)))


def text(draw: ImageDraw.ImageDraw, xy: tuple[float, float], value: str,
         font: ImageFont.FreeTypeFont, fill: str, anchor: str = "la") -> None:
    draw.text(px(*xy), value, font=font, fill=fill, anchor=anchor)


def spaced(draw: ImageDraw.ImageDraw, xy: tuple[float, float], value: str,
           font: ImageFont.FreeTypeFont, fill: str, spacing: float) -> float:
    """Draw letter-spaced text; returns the rendered width."""
    x, y = xy
    for i, ch in enumerate(value):
        draw.text(px(x, y), ch, font=font, fill=fill, anchor="la")
        x += draw.textlength(ch, font=font) / S + spacing
    return x - xy[0] - spacing


def dashed(draw: ImageDraw.ImageDraw, p0: tuple[float, float], p1: tuple[float, float],
           fill: str, width: float = 1.2, dash: float = 4, gap: float = 3) -> None:
    x0, y0 = p0
    x1, y1 = p1
    length = math.hypot(x1 - x0, y1 - y0)
    if length == 0:
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    pos = 0.0
    while pos < length:
        end = min(length, pos + dash)
        draw.line([px(x0 + ux * pos, y0 + uy * pos), px(x0 + ux * end, y0 + uy * end)],
                  fill=fill, width=max(1, int(width * S)))
        pos = end + gap


def _area(poly: list[tuple[float, float]]) -> float:
    total = 0.0
    for i, (x0, y0) in enumerate(poly):
        x1, y1 = poly[(i + 1) % len(poly)]
        total += x0 * y1 - x1 * y0
    return total / 2


def _offset(poly: list[tuple[float, float]], d: float) -> list[tuple[float, float]]:
    n = len(poly)
    sign = 1.0 if _area(poly) > 0 else -1.0
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


def skew_rect(x: float, y: float, w: float, h: float) -> list[tuple[float, float]]:
    """CSS `transform: skewY(-23deg)` around the rect's top-left corner."""
    return [(x, y), (x + w, y - w * TAU), (x + w, y + h - w * TAU), (x, y + h)]


def stroke(img: Image.Image, poly: list[tuple[float, float]], color: str, width: float) -> None:
    """Stroke a convex polygon with square (miter) corners, composited onto img."""
    scaled = [(x * S, y * S) for x, y in poly]
    half = width * S / 2
    mask = Image.new("L", img.size, 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.polygon(_offset(scaled, half), fill=255)
    mdraw.polygon(_offset(scaled, -half), fill=0)
    img.paste(Image.new("RGBA", img.size, color), (0, 0), mask)


def chip(draw: ImageDraw.ImageDraw, x: float, y: float, label: str,
         font: ImageFont.FreeTypeFont, height: float = 33) -> float:
    tw = draw.textlength(label, font=font) / S
    w = tw + 30
    draw.rounded_rectangle(box(x, y, x + w, y + height), radius=height / 2,
                           fill=SURFACE, outline=BORDER, width=int(1.1 * S))
    text(draw, (x + 15, y + height / 2 - font.size / (2 * S) + 1.2), label, font, BODY)
    return w


# ── card ───────────────────────────────────────────────────────────────────
def render() -> Image.Image:
    image = Image.new("RGB", (W * S, H * S), BACKGROUND)

    # faint 40px grid, then a white top-left wash and a soft lavender corner glow
    grid = Image.new("RGBA", image.size, (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(grid)
    for x in range(0, W + 1, 40):
        gdraw.line([px(x, 0), px(x, H)], fill=(139, 108, 232, 6), width=S)
    for y in range(0, H + 1, 40):
        gdraw.line([px(0, y), px(W, y)], fill=(139, 108, 232, 6), width=S)
    image = Image.alpha_composite(image.convert("RGBA"), grid).convert("RGB")

    glow = Image.new("L", image.size, 0)
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse(box(-320, -420, 560, 320), fill=120)
    glow_white = glow.filter(ImageFilter.GaussianBlur(150 * S))
    image.paste(Image.new("RGB", image.size, (255, 255, 255)), (0, 0), glow_white)

    glow = Image.new("L", image.size, 0)
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse(box(820, 360, 1520, 1080), fill=26)
    glow_lav = glow.filter(ImageFilter.GaussianBlur(150 * S))
    image.paste(Image.new("RGB", image.size, (167, 139, 250)), (0, 0), glow_lav)
    draw = ImageDraw.Draw(image)

    # ── brand lockup ──────────────────────────────────────────────────────
    stroke(image, skew_rect(76, 68, 18, 26), ACCENT, 3)
    stroke(image, skew_rect(66, 64, 19, 27), ACCENT, 3.2)
    draw = ImageDraw.Draw(image)

    text(draw, (105, 76), "HD2Lab", f(SANS_B, 36), INK, anchor="lm")
    draw.line([px(240, 62), px(240, 89)], fill="#D4CCE8", width=int(1.1 * S))
    text(draw, (253, 77), "Sigrún", f(SANS, 15), BODY, anchor="lm")

    # ── eyebrow ───────────────────────────────────────────────────────────
    r = 4.6
    draw.ellipse(box(69 - r, 191 - r, 69 + r, 191 + r), fill=ACCENT)
    spaced(draw, (84, 184), "PKPILOT 0018 · SIGRÚN", f(MONO, 13.5), MUTED, 2.5)

    # ── headline ──────────────────────────────────────────────────────────
    f_h1 = f(SANS_B, 74)
    text(draw, (64, 285), "Statistical", f_h1, INK, anchor="ls")
    text(draw, (64, 361), "Workspace", f_h1, ACCENT, anchor="ls")

    # ── sub-copy ──────────────────────────────────────────────────────────
    f_sub = f(SANS, 18.5)
    for i, line in enumerate((
        "Descriptive statistics, hypothesis tests, ANOVA with Tukey, regression,",
        "control charts and process capability — all computed in your browser.",
    )):
        text(draw, (64, 425 + i * 30), line, f_sub, BODY, anchor="ls")

    # ── pills + URL footer ────────────────────────────────────────────────
    f_pill = f(SANS, 14.5)
    cx = 64
    for label in ("100% browser", "No upload", "Nelson rules"):
        cx += chip(draw, cx, 514, label, f_pill) + 10

    f_foot = f(MONO, 13.5)
    f_foot_b = f(MONO_B, 13.5)
    host, slug = "hyangdan2.github.io/", "PKPilot0018"
    w_host = draw.textlength(host, font=f_foot) / S
    w_slug = draw.textlength(slug, font=f_foot_b) / S
    fx = 1136 - w_host - w_slug
    text(draw, (fx, 570), host, f_foot, MUTED, anchor="ls")
    text(draw, (fx + w_host, 570), slug, f_foot_b, ACCENT_TEXT, anchor="ls")

    # ── right-hand capability card ────────────────────────────────────────
    card = (754, 150, 1134, 484)
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(box(card[0], card[1] + 10, card[2], card[3] + 16), radius=16,
                            fill=(29, 25, 43, 40))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16 * S))
    image = Image.alpha_composite(image.convert("RGBA"), shadow).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(box(*card), radius=14, fill=SURFACE, outline=BORDER, width=int(1.1 * S))

    spaced(draw, (772, 170), "CAPABILITY · THICKNESS", f(MONO, 9.5), ACCENT, 1.5)
    text(draw, (1116, 170), "C1 · N 60", f(MONO, 9), MUTED, anchor="ra")

    # plot geometry: measurement values run along X, 9.6 … 10.4
    plot_x0, plot_x1 = 786.0, 1116.0
    plot_y0, plot_y1 = 196.0, 300.0
    v_lo, v_hi = 9.6, 10.4
    lsl, usl = 9.82, 10.18

    def x_of(v: float) -> float:
        return plot_x0 + (v - v_lo) / (v_hi - v_lo) * (plot_x1 - plot_x0)

    counts = [1, 2, 4, 9, 13, 12, 10, 6, 2, 1]
    per_count = (plot_y1 - plot_y0 - 12) / max(counts)
    bin_w = (plot_x1 - plot_x0) / len(counts)

    for gy in (0.25, 0.5, 0.75, 1.0):
        draw.line([px(plot_x0, plot_y1 - (plot_y1 - plot_y0) * gy),
                   px(plot_x1, plot_y1 - (plot_y1 - plot_y0) * gy)], fill=LINE_SOFT, width=S)

    bars = Image.new("RGBA", image.size, (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(bars)
    for i, count in enumerate(counts):
        bx0 = plot_x0 + i * bin_w + 1.2
        bx1 = plot_x0 + (i + 1) * bin_w - 1.2
        bt = plot_y1 - count * per_count
        bdraw.rounded_rectangle(box(bx0, bt, bx1, plot_y1), radius=2.5, fill=(139, 108, 232, 96))
    image = Image.alpha_composite(image.convert("RGBA"), bars).convert("RGB")
    draw = ImageDraw.Draw(image)

    # fitted normal curve (slightly narrower than the histogram spread)
    pts = []
    peak = plot_y1 - (plot_y1 - plot_y0) * 0.86
    for i in range(0, 181):
        v = v_lo + i * (v_hi - v_lo) / 180
        y = plot_y1 - (plot_y1 - peak) * math.exp(-((v - 10.0) ** 2) / (2 * 0.062 ** 2))
        pts.append(px(x_of(v), y))
    draw.line(pts, fill=ACCENT, width=int(2.2 * S), joint="curve")

    # specification limits — vertical lines on the X axis
    for value, label in ((lsl, "LSL"), (usl, "USL")):
        dashed(draw, (x_of(value), plot_y0 + 2), (x_of(value), plot_y1), DANGER, width=1.2)
        draw.rectangle(box(x_of(value) - 12, plot_y0 - 15, x_of(value) + 12, plot_y0 - 3), fill=SURFACE)
        text(draw, (x_of(value), plot_y0 - 13), label, f(MONO, 8.5), DANGER, anchor="ma")

    draw.line([px(plot_x0, plot_y1), px(plot_x1, plot_y1)], fill="#D4CCE8", width=S)
    f_axis = f(MONO, 8.5)
    for v in (9.6, 9.8, 10.0, 10.2, 10.4):
        text(draw, (x_of(v), plot_y1 + 14), f"{v:.1f}", f_axis, MUTED, anchor="ms")

    # KPI row
    kpis = (("Cp", "1.42", "within σ", ACCENT_TEXT), ("Cpk", "1.31", "capable", OK),
            ("PPM", "42", "expected", INK))
    kb_w = (1116 - 772 - 16) / 3
    for i, (label, value, tag, color) in enumerate(kpis):
        kx = 772 + i * (kb_w + 8)
        draw.rounded_rectangle(box(kx, 318, kx + kb_w, 374), radius=8, fill=BACKGROUND,
                              outline=LINE_SOFT, width=S)
        text(draw, (kx + 9, 326), label, f(MONO, 8.5), MUTED)
        text(draw, (kx + 9, 338), value, f(SANS_B, 19), color)
        text(draw, (kx + 9, 364), tag, f(MONO, 8.5), MUTED)

    draw.line([px(772, 386), px(1116, 386)], fill=LINE_SOFT, width=S)

    # I-MR mini chart
    mx0, my0, mw, mh = 772.0, 396.0, 220.0, 66.0

    def m(vx: float, vy: float) -> tuple[float, float]:
        return (mx0 + vx / 220 * mw, my0 + vy / 66 * mh)

    for gy in (14, 33, 52):
        draw.line([px(*m(2, gy)), px(*m(218, gy))], fill=LINE_SOFT, width=S)
    draw.line([px(*m(2, 33)), px(*m(218, 33))], fill=ACCENT, width=S)
    dashed(draw, m(2, 12), m(218, 12), DANGER, width=1, dash=4, gap=3)
    dashed(draw, m(2, 56), m(218, 56), DANGER, width=1, dash=4, gap=3)

    series = [(4, 30), (18, 40), (32, 27), (46, 37), (60, 34), (74, 43), (88, 29), (102, 38),
              (116, 32), (130, 35), (144, 31), (158, 41), (172, 34), (186, 6), (200, 37), (214, 32)]
    draw.line([px(*m(vx, vy)) for vx, vy in series], fill="#D4CCE8", width=int(1.4 * S),
              joint="curve")
    for vx, vy in series:
        if (vx, vy) == (186, 6):
            continue
        cx_, cy_ = m(vx, vy)
        draw.ellipse(box(cx_ - 2.3, cy_ - 2.3, cx_ + 2.3, cy_ + 2.3), fill="#A78BFA")
    ox, oy = m(186, 6)
    draw.ellipse(box(ox - 4.2, oy - 4.2, ox + 4.2, oy + 4.2), fill=DANGER)
    text(draw, (ox, oy - 12), "1", f(MONO, 7.5), DANGER, anchor="ma")

    text(draw, (1004, 398), "I-MR chart", f(SANS, 11.5), BODY)
    text(draw, (1004, 417), "Nelson rule 1", f(SANS_B, 11.5), DANGER)
    text(draw, (1004, 437), "beyond 3σ", f(MONO, 9), MUTED)

    return image.resize((W, H), Image.LANCZOS)


def main() -> int:
    out = render()
    target = Path(__file__).resolve().parent.parent / "public" / "og-image.png"
    out.save(target, "PNG", optimize=True)
    print(f"wrote {target} ({target.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
