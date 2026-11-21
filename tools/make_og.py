#!/usr/bin/env python3
"""Render Sigrún's 1200x630 Open Graph card with Pillow (2x supersampled)."""
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
DANGER = "#E0395C"
OK = "#0F9D76"
SURFACE = "#FFFFFF"
BACKGROUND = "#FAFAFD"


def px(x: float, y: float) -> tuple[float, float]:
    return (x * S, y * S)


def box(x0: float, y0: float, x1: float, y1: float) -> list[float]:
    return [x0 * S, y0 * S, x1 * S, y1 * S]


def f(path: Path, size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), int(round(size * S)))


def text(draw: ImageDraw.ImageDraw, xy: tuple[float, float], value: str, font: ImageFont.FreeTypeFont, fill: str, anchor: str = "la") -> None:
    draw.text(px(*xy), value, font=font, fill=fill, anchor=anchor)


def dashed(draw: ImageDraw.ImageDraw, p0: tuple[float, float], p1: tuple[float, float], fill: str, width: float = 1.2, dash: float = 4, gap: float = 3) -> None:
    x0, y0 = p0
    x1, y1 = p1
    length = math.hypot(x1 - x0, y1 - y0)
    if length == 0:
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    pos = 0.0
    while pos < length:
        end = min(length, pos + dash)
        draw.line([px(x0 + ux * pos, y0 + uy * pos), px(x0 + ux * end, y0 + uy * end)], fill=fill, width=max(1, int(width * S)))
        pos = end + gap


def main() -> None:
    image = Image.new("RGB", (W * S, H * S), BACKGROUND)
    draw = ImageDraw.Draw(image)

    # soft radial glows
    glow = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse(box(-250, -330, 540, 460), fill=(139, 108, 232, 52))
    gdraw.ellipse(box(720, 250, 1560, 1090), fill=(167, 139, 250, 58))
    glow = glow.filter(ImageFilter.GaussianBlur(120 * S))
    image = Image.alpha_composite(image.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(image)

    # ── brand row ───────────────────────────────────────────────────────
    mk_x, mk_y = 64, 58
    skew = math.tan(math.radians(23))
    w, h = 24, 32
    def skew_rect(x: float, y: float, ww: float, hh: float) -> list[tuple[float, float]]:
        return [px(x, y), px(x + ww, y + ww * skew), px(x + ww, y + hh + ww * skew), px(x, y + hh)]
    back = skew_rect(mk_x + 6, mk_y + 6, w - 6, h - 6)
    front = skew_rect(mk_x, mk_y, w - 6, h - 6)
    draw.line(back + [back[0]], fill=ACCENT, width=3 * S, joint="curve")
    draw.line(front + [front[0]], fill=ACCENT, width=4 * S, joint="curve")

    f_brand = f(SANS_B, 25)
    text(draw, (112, 56), "HD2Lab", f_brand, INK)
    draw.line([px(212, 62), px(212, 88)], fill="#D4CCE8", width=S)
    text(draw, (230, 59), "Sigrún", f(SANS_B, 22), ACCENT_TEXT)

    # ── headline ────────────────────────────────────────────────────────
    f_h1 = f(SANS_B, 62)
    text(draw, (62, 128), "Statistical", f_h1, INK)
    text(draw, (62, 194), "Workspace", f_h1, ACCENT_TEXT)

    # ── subtitle ────────────────────────────────────────────────────────
    f_sub = f(SANS, 18.5)
    subtitle = [
        "Descriptive statistics, hypothesis tests, ANOVA with Tukey,",
        "regression, control charts and process capability —",
        "computed entirely in your browser.",
    ]
    for i, line in enumerate(subtitle):
        text(draw, (64, 288 + i * 27), line, f_sub, BODY)

    # ── chips ───────────────────────────────────────────────────────────
    chips = ["DESCRIPTIVE", "T-TESTS", "ANOVA · TUKEY", "REGRESSION", "SPC · NELSON", "CAPABILITY", "PARETO"]
    f_chip = f(MONO, 11.5)
    cx, cy = 64, 396
    for label in chips:
        tw = draw.textlength(label, font=f_chip) / S
        bw, bh = tw + 22, 28
        if cx + bw > 640:
            cx = 64
            cy += 36
        draw.rounded_rectangle(box(cx, cy, cx + bw, cy + bh), radius=14, fill=ACCENT_SOFT, outline=BORDER, width=S)
        text(draw, (cx + 11, cy + 7.5), label, f_chip, ACCENT_TEXT)
        cx += bw + 8

    # ── footer ──────────────────────────────────────────────────────────
    f_foot = f(MONO, 12.5)
    text(draw, (64, 566), "hyangdan2.github.io/PKPilot0018", f(MONO_B, 12.5), ACCENT_TEXT)
    text(draw, (368, 566), "·   NO BACKEND · NO UPLOAD", f_foot, MUTED)

    # ── dashboard card ──────────────────────────────────────────────────
    card = (700, 86, 1136, 544)
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle(box(card[0], card[1] + 10, card[2], card[3] + 16), radius=16, fill=(29, 25, 43, 46))
    shadow = shadow.filter(ImageFilter.GaussianBlur(16 * S))
    image = Image.alpha_composite(image.convert("RGBA"), shadow).convert("RGB")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(box(*card), radius=14, fill=SURFACE, outline=BORDER, width=S)

    text(draw, (718, 104), "Capability · Thickness", f(SANS_B, 14), INK)
    text(draw, (1118, 107), "C1 · N 60", f(MONO, 9.5), MUTED, anchor="ra")

    # chart geometry
    ch_x0, ch_y0, ch_x1, ch_y1 = 734, 134, 1118, 292
    vb_w, vb_h = 404, 168
    def ch(vx: float, vy: float) -> tuple[float, float]:
        return (ch_x0 + (vx - 34) / (398 - 34) * (ch_x1 - ch_x0), ch_y0 + (vy - 10) / (144 - 10) * (ch_y1 - ch_y0))

    for gy in (16, 52, 88, 124):
        draw.line([px(*ch(34, gy)), px(*ch(398, gy))], fill=LINE_SOFT, width=S)

    counts = [8, 18, 38, 62, 82, 88, 70, 44, 20, 9]
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    odraw = ImageDraw.Draw(overlay)
    for i, count in enumerate(counts):
        bx = 60 + i * 32
        x0, y0 = ch(bx, 128 - count)
        x1, y1 = ch(bx + 24, 128)
        odraw.rounded_rectangle([px(x0, y0), px(x1, y1)], radius=3 * S, fill=(139, 108, 232, 105))
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(image)

    # normal-ish curve
    points = []
    for i in range(0, 161):
        vx = 34 + i * (398 - 34) / 160
        vy = 128 - 88 * math.exp(-((vx - 204) ** 2) / (2 * 55 ** 2))
        points.append(px(*ch(vx, vy)))
    draw.line(points, fill=ACCENT, width=int(2.2 * S), joint="curve")

    dashed(draw, ch(34, 104), ch(398, 104), DANGER, width=1.2)
    dashed(draw, ch(34, 30), ch(398, 30), DANGER, width=1.2)
    text(draw, (ch(392, 30)[0], ch(392, 30)[1] - 10), "USL", f(MONO, 8.5), DANGER, anchor="ra")
    text(draw, (ch(392, 104)[0], ch(392, 104)[1] - 10), "LSL", f(MONO, 8.5), DANGER, anchor="ra")

    draw.line([px(*ch(34, 144)), px(*ch(398, 144))], fill="#D4CCE8", width=S)
    draw.line([px(*ch(34, 10)), px(*ch(34, 144))], fill="#D4CCE8", width=S)
    f_axis = f(MONO, 8.5)
    for label, vy in (("10.4", 30), ("10.0", 74), ("9.6", 118)):
        text(draw, (ch(30, 0)[0], ch(0, vy)[1] - 4), label, f_axis, MUTED, anchor="ra")

    # KPI boxes
    kpis = [("Cp", "1.42", "within σ", ACCENT_TEXT), ("Cpk", "1.31", "capable", OK), ("PPM", "42", "expected", INK)]
    kb_w = (404 - 16) / 3
    for i, (label, value, tag, color) in enumerate(kpis):
        kx = 718 + i * (kb_w + 8)
        draw.rounded_rectangle(box(kx, 302, kx + kb_w, 376), radius=8, fill="#FAFAFD", outline=LINE_SOFT, width=S)
        text(draw, (kx + 9, 310), label, f(MONO, 8.5), MUTED)
        text(draw, (kx + 9, 324), value, f(SANS_B, 19), color)
        text(draw, (kx + 9, 358), tag, f(MONO, 8.5), MUTED)

    draw.line([px(718, 392), px(1118, 392)], fill=LINE_SOFT, width=S)

    # mini I-MR chart
    mx0, my0 = 718, 408
    mw, mh = 250, 86
    def m(vx: float, vy: float) -> tuple[float, float]:
        return (mx0 + vx / 250 * mw, my0 + vy / 86 * mh)

    for gy in (18, 44, 70):
        draw.line([px(*m(2, gy)), px(*m(248, gy))], fill=LINE_SOFT, width=S)
    draw.line([px(*m(2, 44)), px(*m(248, 44))], fill=ACCENT, width=S)
    dashed(draw, m(2, 16), m(248, 16), DANGER, width=1, dash=4, gap=3)
    dashed(draw, m(2, 72), m(248, 72), DANGER, width=1, dash=4, gap=3)

    series = [(4, 40), (20, 52), (36, 36), (52, 48), (68, 44), (84, 56), (100, 38), (116, 50),
              (132, 42), (148, 46), (164, 40), (180, 54), (196, 44), (212, 10), (228, 48), (246, 42)]
    draw.line([px(*m(vx, vy)) for vx, vy in series], fill="#D4CCE8", width=int(1.4 * S), joint="curve")
    for vx, vy in series:
        cx_, cy_ = m(vx, vy)
        if (vx, vy) == (212, 10):
            continue
        draw.ellipse(box(cx_ - 2.4, cy_ - 2.4, cx_ + 2.4, cy_ + 2.4), fill="#A78BFA")
    out_x, out_y = m(212, 10)
    draw.ellipse(box(out_x - 4.2, out_y - 4.2, out_x + 4.2, out_y + 4.2), fill=DANGER)
    text(draw, (out_x, out_y - 13), "1", f(MONO, 7.5), DANGER, anchor="ma")

    text(draw, (mx0 + mw + 16, my0 + 8), "I-MR chart", f(SANS, 11.5), BODY)
    text(draw, (mx0 + mw + 16, my0 + 26), "Nelson rule 1", f(SANS_B, 11.5), DANGER)
    text(draw, (mx0 + mw + 16, my0 + 44), "beyond 3σ", f(MONO, 9), MUTED)

    out = image.resize((W, H), Image.LANCZOS)
    target = Path(__file__).resolve().parent.parent / "public" / "og-image.png"
    out.save(target, "PNG", optimize=True)
    print(f"wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
