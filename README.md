# HD2Lab Sigrún — Statistical Workspace

A precision statistical and quality workspace that runs entirely in the browser.
No backend, no upload, no account: every table and chart is computed in the tab.

**Live:** https://hyangdan2.github.io/PKPilot0018/

**Correctness review:** [docs/CODE_REVIEW_REMEDIATION_REPORT.md](docs/CODE_REVIEW_REMEDIATION_REPORT.md) — P0/P1/GLM-DOE-RSM fixes with their SciPy/statsmodels references and the QA-01…QA-15 matrix.

**Minitab feature gap audit:** [docs/MINITAB_FEATURE_GAP.md](docs/MINITAB_FEATURE_GAP.md) — all 40 analyses compared with the official Minitab dialogs (SUPPORTED / PARTIAL / MISSING / DIFFERENT), with code evidence, document links and P1/P2 priorities.

**Independent statistics QA:** [`qa/reports/latest.html`](qa/reports/latest.html) — 156 cases compared against a NumPy/SciPy/statsmodels reference engine (`npm run qa:stats`, also run in CI by `.github/workflows/qa-stats.yml`). Inventory: [`qa/inventory.md`](qa/inventory.md).

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
- Three workspace arrangements, switched from the toolbar (`3-panel · Focus · Classic`), from
  `View ▸ Workspace layout` and from the `⋮` menu:
  - **Three-panel** (default) — `[ Navigator ][ Output ][ Worksheet ]` left to right, each column
    with its own minimum width and a drag splitter (arrow keys work too); charts and the virtual
    grid re-measure through `ResizeObserver` as a column changes width.
  - **Focus mode** — the output takes the full workspace and the worksheet slides in from the right
    as a resizable drawer. The drawer is the same live grid: cell editing, selection, copy/paste,
    its own right-click menus, and a one-click rerun of the last analysis against the edited sheet.
  - **Classic mode** — the Phase 1 shell, output above worksheet.
  The chosen arrangement, every column width and the drawer width are stored in `localStorage`
  (`sigrun.workspace.v1`) and come back after a reload. A desktop narrower than 1200 px folds the
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
npm install
npm run dev        # http://localhost:5178
npm test           # 583 unit tests (statistics, SPC, parser, project files, charts, layout, workspace layouts, i18n, input audit, scatter Stage 2, QA-F regressions)
npm run qa:stats   # independent reference QA → qa/reports/latest.html
npm run typecheck  # tsc --noEmit
npm run build      # production bundle in dist/

# live browser E2E for the compact top bar, sample-dropdown layer, chart clipboard,
# floating panels (drag · resize · remembered size) and layout presets
# (needs playwright + a preview server on :4178)
PART=ui node tools/e2e_ui_compact.cjs     # ui · panels · mobile (or no PART for all)
node tools/e2e_chart_axes.cjs             # Cure Study 2-sample t boxplot axis regression
node tools/e2e_stage2.cjs                 # scatter Stage 2: Y×X, XY pairs, groups, save/reopen (LIVE=1 for Pages)
node tools/e2e_stage3.cjs                 # Stage 3: 15 scenarios at 1366×768 and 1920×1080 + report screenshots
```

The statistical engine is dependency-free: `src/lib/dist.ts` (normal, t, F and studentized-range
distributions), `src/lib/stats.ts` (tests, ANOVA/Tukey, regression), `src/lib/spc.ts`
(control charts, Nelson rules), `src/lib/capability.ts`.

## Deployment

Pushes to `main` deploy through GitHub Actions to GitHub Pages (`.github/workflows/deploy.yml`),
which runs the type check, the unit tests and the production build before publishing `dist/`.

---

HD2Lab · Sigrún · Phase 1
