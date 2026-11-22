# HD2Lab Sigrún — Statistical Workspace

A precision statistical and quality workspace that runs entirely in the browser.
No backend, no upload, no account: every table and chart is computed in the tab.

**Live:** https://hyangdan2.github.io/PKPilot0018/

**Correctness review:** [docs/CODE_REVIEW_REMEDIATION_REPORT.md](docs/CODE_REVIEW_REMEDIATION_REPORT.md) — P0/P1/GLM-DOE-RSM fixes with their SciPy/statsmodels references and the QA-01…QA-15 matrix.

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
| Graphs | Histogram (normal overlay, spec limits), boxplot (groups, outliers), scatterplot (fit line, groups), time series plot |
| Calc | Column formula calculator (`C1 * 2 + 1`, `MEAN(C1)`, `SQRT`, `LN`, `LOG`, `ROUND`, …), seeded random data, sort, standardize, recode |
| Workspace | Multiple worksheets, Excel/CSV multi-cell paste, undo/redo, `.mpx.json` projects, CSV import/export, IndexedDB autosave |

## Interface

- Classic Minitab menu bar — `File · Edit · Data · Calc · Stat · Graph · View · Help` with two-level submenus.
- `Ctrl+E` (`⌘E`) reopens the last analysis dialog with the same selections.
- `KO | EN` toggle translates the menu bar, toolbar, navigator, panel headers, dialogs and help.
- Soft Iris (light) and Navy & Lavender (dark) themes, both defined in `src/styles/tokens.css`.

## Development

```bash
npm install
npm run dev        # http://localhost:5178
npm test           # 78 unit tests (statistics, SPC, parser, project files, charts, i18n)
npm run typecheck  # tsc --noEmit
npm run build      # production bundle in dist/
```

The statistical engine is dependency-free: `src/lib/dist.ts` (normal, t, F and studentized-range
distributions), `src/lib/stats.ts` (tests, ANOVA/Tukey, regression), `src/lib/spc.ts`
(control charts, Nelson rules), `src/lib/capability.ts`.

## Deployment

Pushes to `main` deploy through GitHub Actions to GitHub Pages (`.github/workflows/deploy.yml`),
which runs the type check, the unit tests and the production build before publishing `dist/`.

---

HD2Lab · Sigrún · Phase 1
