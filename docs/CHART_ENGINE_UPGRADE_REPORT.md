# Sigrún Chart Engine Upgrade — Phase 2 Report

Phase 2 turns the Phase 1 chart engine into an editing surface: a seven-tab properties drawer, a chart context menu and readout, high-DPI export, and a visual verification pass with before/after evidence.

- App: HD2Lab Sigrún — Statistical Workspace (`HyangDan2/PKPilot0018`)
- Baseline: `ee1dafe` (main before the chart work)
- Phase 1 engine commit: `5986f8a`
- Live: https://hyangdan2.github.io/PKPilot0018/

---

## 1. Existing chart issues and root causes

The Phase 1 audit of `ee1dafe` found four classes of defect. Phase 2 kept every fix and wired the UI that was missing.

| Issue | Symptom at `ee1dafe` | Root cause |
| --- | --- | --- |
| Contour fill staircase | Filled contours were drawn as one rectangle per grid cell, so band edges stepped by a whole cell | The renderer walked cells instead of interpolating the iso-line between corner values |
| Contour topology errors | Some saddle cells lost a segment, and lines stopped at cell borders | Only the 8 common Marching Squares cases were handled, with no asymptotic decider and no segment stitching |
| Shared render state | A second chart on the page could inherit the first chart's width or clip counter | Width and clip ids lived in module scope instead of a per-call render context |
| Tick precision | Axes showed `0.0000` for `1.2e-6`, or `1.0M` for `1,000,000.001 … 1,000,000.005` | Formatting looked only at magnitude, not at the tick step |
| Legend overlap | A top-right legend sat over the plotted data | The legend was always drawn inside the plot box |
| No editing surface | Titles, scales, colours, contour options were only reachable by editing stored config | No drawer, no context menu, no per-chart toolbar |
| No professional export | Card-level SVG/PNG at 2× only; no DPI, no physical size, no single-chart file | Export wrote a fixed 560 px document and rasterised at a hard-coded scale |
| No readout | Hovering a point showed nothing | Points carried values in `data-*` but no UI consumed them |

The Phase 2 before/after set (`/workspace/downloads/sigrun-upgrade-shots/`) shows the visible difference on identical data: `before_contour_ee1dafe.png` against `after_contour_101_filled_lines.png`, and `before_boxplot_ee1dafe.png` against `after_boxplot_engineering.png`.

---

## 2. Contour algorithm fixes

Implemented in `src/lib/contour.ts` and consumed by `src/lib/charts.ts`.

- 16-case Marching Squares: every corner-sign combination is handled, including the four single-corner cases and the two full-cell/empty-cell cases.
- Asymptotic decider: a saddle cell decides which pair of corners connects by comparing the bilinear saddle value with the iso-level, so `Z = X² − Y²` at level 0 draws two crossing segments, not one arbitrary line.
- Segment stitching: segments are joined into continuous polylines with a tolerance relative to the axis span, so a contour is one path instead of hundreds of fragments.
- Band polygons: `filled` and `filled-lines` interpolate the level boundary along cell edges and build closed polygons, which removes the staircase visible at `ee1dafe`.
- Clipping: every plot group is clipped by a per-render clip path (`sigrun-clip-<render>-<n>`), so a band that leaves the plot box does not paint over axes or labels.
- Constant surfaces: a flat surface has no iso-lines, so the frame is filled with the mid colour and annotated (`Constant surface <value>`) rather than left empty.
- Deterministic touching vertices: a level that lands exactly on a grid node produces a single point per level, so a repeated or self-touching line is never emitted.

Geometry tests in `tests/contour-geometry.test.ts` compare the output against analytic planes (`Z = X + Y`), paraboloids (`Z = X² + Y²`), saddles (`Z = X² − Y²`), interaction surfaces (`Z = XY`), constant surfaces and NaN masks.

---

## 3. Before/after on the same data

All pairs use the Cure Study and Response Surface (CCD) samples shipped with the app.

| Comparison | `ee1dafe` | Phase 2 |
| --- | --- | --- |
| RSM contour fill | Cell staircase, no colorbar, no range badge | Interpolated bands, colour bar 60–80 with labels, range badge `57.392 – 80.837`, stationary point marker |
| RSM contour lines | Fixed orange lines, no level labels | Engineering palette, optional level labels, target iso-line highlight |
| Boxplot | Two boxes, no outlier legend, no group `n` | Engineering palette, outlier legend `1.5×IQR`, per-group `n=40`, mean marker |
| Legend | Always inside the plot, over the data | `right` and `bottom` reserve plot margin and sit outside the data area |
| Export | 560 px card image | SVG/PNG at 160 × 100 mm, 300 DPI = 1890 × 1181 px |

Screenshot set: `before_contour_ee1dafe.png`, `after_contour_101_filled_lines.png`, `before_boxplot_ee1dafe.png`, `after_boxplot_engineering.png`.

---

## 4. Resolution benchmark

Median of five runs after one warm-up, 560 × 300 SVG, `filled-lines`, 10 bands (`node_modules/.bin/vite-node tools/contour_benchmark.ts`).

| Grid | Time (median) | Fastest | SVG bytes | Notes |
| ---: | ---: | ---: | ---: | --- |
| 41 × 41 | 8.5 ms | 4.7 ms | 57,935 | Draft; visible cell edges on a wide plot |
| 101 × 101 | 30.2 ms | 19.7 ms | 135,063 | Standard default; smooth at 560 px |
| 201 × 201 | 50.7 ms | 33.9 ms | 263,130 | High; useful for print |
| 401 × 401 | 100.9 ms | 96.2 ms | 519,965 | Ultra; largest supported grid |

Browser timings measured by the E2E run (drawer resolution switch, including React re-render and paint): 41 → 521 ms, 101 → 482 ms, 201 → 555 ms, 401 → 702 ms.

A 401 × 401 grid produces 160,801 predicted values. Phase 2 replaced the `Math.min(...values)` / `Math.max(...values)` extent calls with a loop after a stack overflow (`Maximum call stack size exceeded`) was reproduced in the browser on Ultra; the grid now renders in every mode.

---

## 5. Style presets

Seven built-in presets plus saved user styles (`src/lib/chartStyles.ts`, `cd-preset-*` cards).

| # | Preset | Intent | Palette |
| ---: | --- | --- | --- |
| 1 | Sigrún Classic | Follows the app theme (light/dark) | Soft Iris tokens |
| 2 | Engineering | Default; report figure on white | Navy, steel, rust, green, purple, amber |
| 3 | Scientific | Publication serif, thin strokes | Muted dark tones |
| 4 | Corporate | Presentation weight and warmer paper | Blue, teal, orange, violet |
| 5 | Monochrome | Black-and-white print with dash/marker cycles | Greys plus dash identity |
| 6 | High contrast | Accessible, Okabe–Ito series | Colour-vision-safe six |
| 7 | Dark | Dark slide background | Light series on navy |

A preset is applied to the chart immediately on selection in the Style tab; Save style stores the current colours and font as a named style in local storage.

Screenshots: `style_1_sigrun_classic.png` … `style_7_dark.png`.

---

## 6. Axis Scale Editor and Chart Properties Drawer UX

The drawer is docked at the right on desktop (≥ 1024 px) and becomes a bottom sheet with a drag handle on mobile (≤ 1023 px).

| Tab | Contents |
| --- | --- |
| General | Title, subtitle, show title, width, height, aspect ratio, four margins; for contours: resolution, render mode, factor pair, holding values, coded/actual units, per-factor display range, experimental/stationary/optimal toggles, extrapolation banner, Generate all factor-pair contours |
| Scale | Sub-tabs X / Y / (Z / colorbar for contour) / (Y2 for line and bar); auto range, min, max, major and minor interval, linear/log10 with inline non-positive warning, reverse, title, unit, decimals, scientific, thousands separator, tick direction, grids, margin, cross-at, probability grid, staged limits, category order; Z adds level mode/count/interval/custom levels, target and tolerance, LSL/USL and satisfaction shading |
| Series | Line width, dash, marker, marker size, fill opacity, palette, per-series colour and visibility; chart options per kind (fit line, CI/PI bands, equation, R², data labels, bins, Y mode, fitted curve, spec lines, mean/median, orientation, whisker rule, points, control limits, violations, observation window, capability curves, probability grid, secondary Y series) |
| Style | Seven preset cards, custom style save/apply/delete, chart and plot background, font, font size, axis/tick/label/grid colours, border width; contour colormap, colourbar mode/position/title/unit, contour labels, line width and colour |
| Reference lines | Add, edit, toggle and remove X and Y lines with value, label, colour and dash |
| Legend | Visible, position (`top-right`, `top-left`, `bottom`, `right`, `none`), font size, background box |
| Export | Format, 150/300/600/custom DPI, physical size in mm or inch, pixel box, background, include title/legend, download, copy PNG, batch export |

Interaction details:

- Live preview: every change redraws the chart behind the drawer. Apply commits to the output block, Cancel restores the snapshot taken when the drawer opened.
- Undo and redo: bounded 60-step history inside the session, bound to Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z.
- Double-click routing: an SVG region decides the tab. `axis-x`, `axis-y`, `axis-y2` → Scale, `colorbar` → Scale/Z, `title` → General, `legend` → Legend, plot or point → Style.
- Context menu: right-clicking a chart opens the chart menu (`Scale…`, `Appearance…`, `Export…`, `Edit properties…`, `Zoom view`, `Fullscreen`, `Copy style`, `Paste style`, `Apply style to all charts`, `Copy chart PNG`, `Reset chart style`). Right-clicking outside a chart still opens the output-card menu.
- Readout: points expose `data-point="1"` with `data-x`, `data-y`, `data-z`, `data-label`; the plot region exposes `data-plot-box` and the four data bounds, so the contour view interpolates `Z_hat` at the pointer.
- Zoom and fullscreen: a per-chart viewer renders the same chart at up to 1600 px and closes on Escape.
- Re-run preservation: `App.tsx` keeps each analysis's chart configuration by kind and index, so re-running a card keeps its style, scale and contour view while the numbers refresh.

Screenshots: `drawer_scale_desktop.png`, `drawer_style_desktop.png`, `drawer_export_desktop.png`, `drawer_mobile_390.png`, `chart_zoom.png`, `chart_zoom_tooltip.png`, `contour_rsm_options.png`, `contour_modes.png`.

---

## 7. Option gap matrix summary

Full matrix with official documentation links: `docs/CHART_FEATURE_GAP.md`.

| Area | Phase 1 supported | After Phase 2 |
| --- | ---: | --- |
| Minitab graph editing | 3 / 8 | 5 / 8 (edit dialog and save graph wired) |
| Minitab axis and tick editing | 7 / 12 | 7 / 12 (editor UI added; value-list ticks still partial) |
| Minitab contour plot | 7 / 14 | 8 / 14 (target and spec region editable) |
| Minitab surface plot | 0 / 5 | 0 / 5 (3D is Phase 3) |
| Origin plot details | 5 / 10 | 5 / 10 |
| Origin axis dialog | 5 / 11 | 5 / 11 |
| Origin colormap and contour | 4 / 11 | 4 / 11 (per-level colour still missing) |

Remaining gaps are listed in the same document and in section 9 below.

---

## 8. Statistical QA and visualization QA

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | 661 / 661 PASS |
| `npm run qa:stats` | 156 / 156 PASS, 0 FAIL |
| `npm run build` | clean offline build, 201 modules, no CDN |
| Phase 2 E2E `tools/e2e_chart_upgrade.cjs` | 35 / 35 PASS on desktop 1440 × 900 and mobile 390 × 844 |
| Regression E2E `tools/e2e_chart_axes.cjs` | 6 / 6 PASS |
| Regression E2E `tools/e2e_stage3.cjs` | 176 / 176 PASS |

New unit coverage in Phase 2:

- `tests/chart-export.test.ts` (9): physical ↔ pixel conversion, DPI box, standalone SVG with zero `var(--…)`, title/legend inclusion, background modes, file naming, batch document, canvas-less raster.
- `tests/chart-drawer.test.ts` (17): config fill, style pack copy/paste, reset, history undo/redo, RSM re-slice, extrapolation detection, factor pairs, contour probing, role hooks, legend right/bottom/top-right/off.

Visual QA assertions inside the E2E: no console or page error on either viewport, no horizontal overflow at 1440 or 390 px, no chart text outside its drawn frame, every contour render mode draws geometry without `NaN`, and both the single-chart and card-level PNG copy reach the clipboard as `image/png`.

---

## 9. Unimplemented items and follow-up roadmap

| Item | Why it is out of Phase 2 | Suggested phase |
| --- | --- | --- |
| 3D surface and wireframe, rotation, lighting | Needs a projected renderer; the model API already predicts any grid | Phase 3 |
| Split (broken) axis and symmetrical log | Changes the axis engine contract | Phase 3 |
| Overlaid multi-response contour | Requires a second fitted model in one frame | Phase 3 |
| Per-level colour, line style and label visibility | Per-level styling model not yet in `ContourConfig` | Phase 3 |
| Annotation shapes and free layout | A separate annotation layer over the SVG | Phase 3 |
| Tick value lists and tick counts | Only interval-based ticks are exposed; Minitab also accepts explicit values | P2 |
| Drop lines and fill-area series | New series renderer modes | P2 |
| Date axis formatting | Data model stores no date axis yet | P2 |
| Custom contour palettes from the Color Manager | Only series palettes are user editable | P2 |

Known limits recorded during verification:

- `tools/e2e_ui_compact.cjs` opens a second browser context in the same process and the container's single-process Chromium exits at that point. The chart-copy checks before that step pass, and the same script stops at the same place against the `ee1dafe` baseline, so this is an environment limit rather than a Phase 2 regression.
- The chart viewer is a full-viewport overlay rather than the browser's native fullscreen API, so it behaves identically on desktop and mobile.
- Export uses the browser canvas for PNG; in an environment without a 2-D canvas the API returns `null` instead of writing a broken file.

---

## 10. Live deployment

| Item | Value |
| --- | --- |
| Pages URL | https://hyangdan2.github.io/PKPilot0018/ |
| Branch | `main` (Phase 2 merged from `feat/chart-engine-phase1`) |
| Workflows | `Deploy` and `qa-stats` — both `completed / success` on the merge commit |
| Phase 2 merge commit | `9a00f7f` |
| Live smoke | 33 / 33 checks against the published site (desktop and mobile) |

Verification commands:

```bash
cd repos/PKPilot0018
export PATH="/workspace/node/bin:$PATH"
npx tsc --noEmit
npm test
npm run qa:stats
npm run build
BASE=http://localhost:4178/PKPilot0018/ node tools/e2e_chart_upgrade.cjs
```

Screenshot set captured by the E2E run lives in `/workspace/downloads/sigrun-upgrade-shots/` (before/after, seven presets, five contour modes, RSM options, drawer desktop and mobile, zoom and readout).
