# Statelia — Statistical Engineering Suite

A statistical engineering suite that runs entirely in the browser on **Sigrdrifa
Engine v1.0**. No backend, no upload, no account: every table and chart is
computed in the tab.

Statelia keeps the repository, the Pages URL, the `.sigrun.json` project format
and the storage keys of earlier builds, so a project written by an earlier build
opens unchanged.

**Live:** https://hyangdan2.github.io/PKPilot0018/

**HD2Lab:** https://hyangdan2.github.io/ · **Contact:** hyperdimensionaldesignlab@gmail.com

**Correctness review:** [docs/CODE_REVIEW_REMEDIATION_REPORT.md](docs/CODE_REVIEW_REMEDIATION_REPORT.md) — P0/P1/GLM-DOE-RSM fixes with their SciPy/statsmodels references and the QA-01…QA-15 matrix.

**Minitab feature gap audit:** [docs/MINITAB_FEATURE_GAP.md](docs/MINITAB_FEATURE_GAP.md) — all 40 analyses compared with the official Minitab dialogs (SUPPORTED / PARTIAL / MISSING / DIFFERENT), with code evidence, document links and P1/P2 priorities.

**Chart engine upgrade (Phase 2):** [docs/CHART_ENGINE_UPGRADE_REPORT.md](docs/CHART_ENGINE_UPGRADE_REPORT.md) — contour fixes, 7-tab properties drawer, DPI export, before/after visual QA and the resolution benchmark.

**Minitab/Origin chart gap audit:** [docs/CHART_FEATURE_GAP.md](docs/CHART_FEATURE_GAP.md) — Graph Editing, Scale, Contour, Surface, Plot Details, Axis Dialog and Colormap compared item by item.

**Independent statistics QA:** [`qa/reports/latest.html`](qa/reports/latest.html) — 225 cases compared against a NumPy/SciPy/statsmodels reference engine (`npm run qa:stats`, also run in CI by `.github/workflows/qa-stats.yml`). Inventory: [`qa/inventory.md`](qa/inventory.md).

**Phase 3B corrective QA:** [docs/PHASE3_3B_CORRECTIVE_QA.md](docs/PHASE3_3B_CORRECTIVE_QA.md) — per-model factor transformation, no silent interval fallback, per-point prediction isolation, non-finite handling, multi-model extrapolation, Ultra grid convergence, interval conditions and engine input validation, with before/after reference numbers and 19 new QA-V cases (with the 12 Stage 3C QA-W cases in the same suite).

**Guided tutorial corrective QA (T-01 … T-13):** [docs/TUTORIAL_CORRECTIVE_QA.md](docs/TUTORIAL_CORRECTIVE_QA.md) — the reader's own project is written and read back before a practice replaces it (or the practice stops for an explicit backup), settings are isolated with the rest of the project, samples are matched on their data rather than their column names, analyses are judged on inputs/parameters/results, models per response, profiler factors/predictions/save, practice slots per tutorial and session with their evidence, round-trip comparison record by record, verified/manual/skipped endings and the build stage in the status bar. Red → Green evidence for every item is in `work/pk18-3e-logs/tutorial-red.txt` / `tutorial-green.txt`.

**Phase 3E corrective review (F-01 … F-15):** [docs/PHASE3_3E_CORRECTIVE_QA.md](docs/PHASE3_3E_CORRECTIVE_QA.md) — non-finite predictions refused by every path, decimal-exact discrete lattices and safe-integer/precision limits, fixed-factor extrapolation, project schema versioning and damaged-file refusal, lattice-consistent local steps, duplicate factor identifiers, machine-independent tooling with `npm ci`, reproducible ZIP timestamps and a build manifest. Before/after measurements are in the report's §2.

## Independence, trademarks and limitations

Statelia is an independently developed statistical and quality engineering application based on publicly available statistical and mathematical methods. Third-party product names, including Minitab, are used solely to identify products in factual comparisons; their trademarks belong to their respective owners. Statelia is not affiliated with, endorsed by, or sponsored by those vendors.

Public documentation is referenced for feature identification, not as a license to reproduce proprietary material. Access to a reference URL does not establish permission to reuse its contents. Numerical equivalence, compatibility, or certification by any third-party product is not claimed. Third-party components remain subject to their respective licenses and notices.

The software is provided "as is," without warranties to the extent permitted by applicable law. Independently validate analytical results before relying on them for critical engineering, regulatory, safety, or business decisions.

## What is inside

| Area | Capability |
| --- | --- |
| Basic statistics | Descriptive statistics (N, N*, Mean, SE Mean, StDev, Variance, CoefVar, Min, Q1, Median, Q3, Max, IQR, Skewness, Kurtosis) with `By` groups |
| Normality | Anderson–Darling A² (case-weighted A*²) with p-value and normal probability plot with 95% bands |
| Hypothesis tests | 1-sample t, 2-sample t (Welch / pooled) with an F-test for equal variances, paired t — estimate, CI, T, DF, P |
| ANOVA | One-way ANOVA, group confidence intervals, Tukey HSD pairwise comparisons, compact-letter grouping, interval + box plots |
| Regression | Multiple OLS with coefficients, SE, T, P, VIF, ANOVA table, R²/R²(adj)/R²(pred), four-in-one residual plots |
| Control charts | I-MR, Xbar-R (A₂, d₂, D₃, D₄), P chart, with all eight Nelson rules flagged on the chart and in a table |
| Capability | Cp, Cpk, CPL, CPU, Pp, Ppk, PPL, PPU, Cpm, expected/observed PPM, DPMO, sigma level, histogram + normal curve |
| Quality tools | Pareto chart with 80 % cumulative line |
| Graphs | Histogram (normal overlay, spec limits), boxplot (groups, outliers), scatterplot (several Y × several X, XY pairs, individual/panel/overlaid layout, groups, shared scales, fit line and per-pair statistics), time series plot |
| Calc | Column formula calculator (`C1 * 2 + 1`, `MEAN(C1)`, `SQRT`, `LN`, `LOG`, `ROUND`, …), seeded random data, sort, standardize, recode |
| Workspace | Multiple worksheets, Excel/CSV multi-cell paste, undo/redo, `.mpx.json` projects, CSV import/export, IndexedDB autosave; three desktop arrangements (three-panel · focus drawer · classic) with saved widths |

## Interface

- One slim top bar (40 px) holds the whole chrome: the HD2Lab dual-skew `.mark` wordmark sits
  directly beside the `File · Edit · Data · Calc · Stat · Graph · View · Help` menus, and
  `KO | EN`, the theme toggle and the `⋮` workspace/kebab menu close the same line.
- `Ctrl+E` (`⌘E`) reopens the last analysis dialog with the same selections.
- `KO | EN` toggle translates the top bar, toolbar, navigator, panel headers, dialogs and help.
- Soft Iris (light) and Navy & Lavender (dark) themes, both defined in `src/styles/tokens.css`.
- Panel layout presets (`View ▸ Panel layout`, also in the `⋮` menu): *Balanced*, *Worksheet
  focus*, *Results & charts focus*, *Full focus* (navigator folded away). The same four presets
  move the three-panel output column or the classic split, whichever is on screen.
- Three workspace arrangements, switched from the toolbar (`Classic (default) · 3-panel (extra) ·
  Focus (drawer)`), from `View ▸ Workspace layout` and from the `⋮` menu:
  - **Classic** (default) — the Phase 1 shell, output above worksheet, the four emphasis presets
    acting on the stacked split exactly as they did before Stage 3.
  - **3-panel** (extra) — `[ Navigator ][ Output ][ Worksheet ]` left to right, each column
    with its own minimum width and a drag splitter (arrow keys work too); charts and the virtual
    grid re-measure through `ResizeObserver` as a column changes width.
  - **Focus** (drawer, extra) — the output takes the full workspace and the worksheet slides in
    from the right as a resizable drawer. The drawer is the same live grid: cell editing,
    selection, copy/paste, its own right-click menus, and a one-click rerun of the last analysis
    against the edited sheet.
  The chosen arrangement, every column width and the drawer width are stored in `localStorage`
  (`sigrun.workspace.v2`) and come back after a reload. A desktop narrower than 1200 px folds the
  three panels back to classic on its own (the stored choice is kept), and the phone/tablet shell
  below 1024 px is unchanged.
- Right-click a result card: copy the results as text, copy or save the chart image, export its
  table, rerun the analysis on the current sheet, reproduce from the card's snapshot, collapse or
  expand it, or delete it — the same actions as the card header, positioned near the pointer and
  clamped to the viewport (`Esc` closes). Right-clicking the empty output copies every result or
  collapses/expands all cards.
- Detach any panel — navigator, output, worksheet — into a floating window from the panel header,
  drag it by its title bar, resize it from any edge or corner (the bottom-right grip also takes
  arrow keys), and dock it back from the window header. The detached panel is the
  same live panel, so charts, worksheets and selections keep their state; the last size is
  remembered across docking, re-detaching and page reloads, and charts redraw at the new width.
- Charts copy to the clipboard as PNG (`navigator.clipboard.write` + `ClipboardItem`) from the
  card header (all charts of the card) or the per-chart button; browsers without clipboard-image
  support get the identical PNG downloaded instead, with a notice that says so.

## Development

```bash
npm ci             # exact lockfile: the build and the E2E suites depend only on it
npm run dev        # http://localhost:5178
npm test           # 1 075 unit tests (46 files: statistics, SPC, charts and their guards,
                   # model store, surface, optimizer, profiler, graph layout, project files, i18n,
                   # QA regressions and the Phase 3E corrective suites, Round 1 and Round 2)
npm run qa:stats   # independent reference QA → qa/reports/latest.html
npm run typecheck  # tsc --noEmit
npm run build      # production bundle in dist/
npm run build:portable  # one self-contained HTML for offline/file:// use → dist-portable/

# live browser E2E for the compact top bar, sample-dropdown layer, chart clipboard,
# floating panels (drag · resize · remembered size) and layout presets
# (browser + libraries are resolved by tools/browser_env.cjs: CHROME_PATH / CHROME_LIBS
#  override it, otherwise a Playwright download and a sibling chrome-libs are used)
PART=ui node tools/e2e_ui_compact.cjs     # ui · panels · mobile (or no PART for all)
node tools/e2e_chart_axes.cjs             # Cure Study 2-sample t boxplot axis regression
node tools/e2e_stage2.cjs                 # scatter Stage 2: Y×X, XY pairs, groups, save/reopen (LIVE=1 for Pages)
node tools/e2e_stage3.cjs                 # Stage 3: 15 scenarios at 1366×768 and 1920×1080 + report screenshots
node tools/e2e_phase3_3a.cjs              # 3A: chart guards, stored model manager
node tools/e2e_phase3_3b.cjs              # 3B: 3D surface (WebGL + fallback), overlaid contour
node tools/e2e_phase3_3c.cjs              # 3C: multi-response optimizer, prediction profiler
node tools/e2e_phase3_3d.cjs              # 3D: layout editor, advanced axes/contours, chart interaction
node tools/run_e2e_suite.cjs              # every browser suite above, one command (local dist)
node tools/e2e_portable_offline.cjs       # the portable HTML opened from file:// with the network off
node tools/perf_qa_3e.cjs                 # boot, large-data and optimizer timings → qa/reports/perf-3e.json
```

The portable build (a single HTML that runs from `file://` with no server, no Node and no
network) is documented in [`docs/PORTABLE_BUILD_GUIDE.md`](docs/PORTABLE_BUILD_GUIDE.md).
The Phase 3 result as a whole — what changed, what was measured, what is not claimed — is in
[`docs/PHASE3_UPGRADE_REPORT.md`](docs/PHASE3_UPGRADE_REPORT.md).

The statistical engine is dependency-free: `src/lib/dist.ts` (normal, t, F and studentized-range
distributions), `src/lib/stats.ts` (tests, ANOVA/Tukey, regression), `src/lib/spc.ts`
(control charts, Nelson rules), `src/lib/capability.ts`.

## Deployment

Pushes to `main` deploy through GitHub Actions to GitHub Pages (`.github/workflows/deploy.yml`),
which runs `npm ci`, the type check, the unit tests and the production build before publishing `dist/`.
`.github/workflows/portable.yml` qualifies the portable build from a fresh checkout: `npm ci`,
`build:portable` with a reproducible timestamp, and the `file://` offline smoke test in Chromium.

---

HD2Lab · Statelia · Phase 3
