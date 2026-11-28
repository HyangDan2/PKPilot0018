/* ─────────────────────────────────────────────────────────────────────────
   Statelia — Capability Sixpack
   Six linked views of one process: the location chart, its dispersion chart,
   the last 25 subgroups, the capability histogram, the normal probability plot
   and the capability summary. Subgroup size 1 uses I-MR; 2–10 uses Xbar-R (the
   A₂/D₃/D₄ table covers exactly n = 2..10); 11 and above switches to Xbar-S,
   whose c₄-based constants are exact for any n. The chart and the capability
   always describe the SAME subgroups — the earlier code charted min(10, n)
   while the indices used n, so a subgroup of 12 was charted in tens and
   measured in twelves.
   ───────────────────────────────────────────────────────────────────────── */

import { adNormality, clean, type ADResult } from './stats';
import { capability, type CapabilityResult, type SigmaMethod } from './capability';
import { imrChart, xbarRCharts, xbarSCharts, type SpcPanel } from './spc';

export interface SixpackOptions {
  subgroup?: number;
  lsl?: number | null;
  usl?: number | null;
  target?: number | null;
  sigmaMethod?: SigmaMethod;
  lastCount?: number;
}

export interface SixpackResult {
  subgroup: number;
  /** which location/dispersion pair was used for this subgroup size */
  chart: 'imr' | 'xbar-r' | 'xbar-s';
  primary: SpcPanel;
  secondary: SpcPanel;
  last: SpcPanel;
  capability: CapabilityResult;
  ad: ADResult;
  values: number[];
  sigmaWithin: number;
  sigmaOverall: number;
  /** share of the specification width used by 6σ within (Cp inverse) */
  says: { within: number; overall: number };
  /** subgroups that contained a missing value (handled with their own nᵢ) */
  missingSubgroups: number;
  /** true when the within sigma of the indices came from the chart estimate (always) */
  sdWithinFromChart: boolean;
  /** which chart estimator produced the shared within sigma */
  sigmaBasis: SixpackSigmaBasis;
  /** e.g. `R̄/d₂(5)` — the basis with its subgroup size spelled out */
  withinMethodLabel: string;
}

/** The chart estimator that supplies BOTH the limits and Cp/Cpk. */
export type SixpackSigmaBasis = 'MRbar/d2' | 'Rbar/d2' | 'Sbar/c4';

/** Largest subgroup size the Xbar-R constant table (A₂, d₂, d₃, D₃, D₄) covers. */
export const XBAR_R_MAX = 10;

/** Trim a panel to its last `count` points, recomputing the run signals. */
function lastPanel(panel: SpcPanel, count: number, label: string, titleKey: string): SpcPanel {
  const start = Math.max(0, panel.points.length - count);
  return {
    ...panel,
    key: `${panel.key}-last`,
    titleKey,
    points: panel.points.slice(start),
    violations: panel.violations
      .filter((v) => v.index >= start)
      .map((v) => ({ index: v.index - start, rules: v.rules })),
    yLabel: label,
  };
}

export function capabilitySixpack(raw: (number | null)[], options: SixpackOptions = {}): SixpackResult {
  const values = clean(raw);
  if (values.length < 5) throw new Error('res.insufficient');
  const subgroup = Math.max(1, Math.round(options.subgroup ?? 1));
  const chart: SixpackResult['chart'] = subgroup <= 1 ? 'imr' : subgroup <= XBAR_R_MAX ? 'xbar-r' : 'xbar-s';
  const spc = chart === 'imr'
    ? imrChart(values)
    : chart === 'xbar-r'
      ? xbarRCharts(raw, subgroup)
      : xbarSCharts(raw, { size: subgroup });
  // ONE within-sigma for the whole sixpack: the chart's own estimator (MR̄/d₂(2)
  // for I-MR, R̄/d₂(n) for Xbar-R, S̄/c₄(n) for Xbar-S) is also what Cp/Cpk use.
  // Only Xbar-S used to hand its estimate over, so with subgroups of 2, 5 or 10
  // the limits were drawn on R̄/d₂ while Cp/Cpk were computed on the pooled
  // within-subgroup s — two different variability estimates for one process.
  const sdWithinFromChart = true;
  const sigmaBasis: SixpackSigmaBasis = chart === 'imr' ? 'MRbar/d2' : chart === 'xbar-r' ? 'Rbar/d2' : 'Sbar/c4';
  const withinMethodLabel = chart === 'imr'
    ? 'MR̄/d₂(2)'
    : chart === 'xbar-r'
      ? `R̄/d₂(${subgroup})`
      : `S̄/c₄(${subgroup})`;
  const cap = capability(raw, {
    lsl: options.lsl ?? null,
    usl: options.usl ?? null,
    target: options.target ?? null,
    subgroup,
    sigmaMethod: options.sigmaMethod ?? 'z_bench_shift',
    sdWithin: spc.sigmaWithin,
  });
  const ad = adNormality(values);
  const lastCount = options.lastCount ?? 25;
  const last = lastPanel(spc.panels[0], lastCount, 'Last subgroups', '@chart.last25');
  const width = cap.lsl !== null && cap.usl !== null ? (cap.usl as number) - (cap.lsl as number) : NaN;
  return {
    subgroup,
    chart,
    primary: spc.panels[0],
    secondary: spc.panels[1],
    last,
    capability: cap,
    ad,
    values,
    sigmaWithin: spc.sigmaWithin,
    sigmaOverall: cap.sdOverall,
    says: {
      within: isFinite(width) ? (6 * cap.sdWithin) / width : NaN,
      overall: isFinite(width) ? (6 * cap.sdOverall) / width : NaN,
    },
    missingSubgroups: spc.subgroupSummary && 'missingSubgroups' in spc.subgroupSummary
      ? (spc.subgroupSummary as { missingSubgroups?: number }).missingSubgroups ?? 0
      : 0,
    sdWithinFromChart,
    sigmaBasis,
    withinMethodLabel,
  };
}
