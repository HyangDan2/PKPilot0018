/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — Capability Sixpack
   Six linked views of one process: the location chart, its dispersion chart,
   the last 25 subgroups, the capability histogram, the normal probability plot
   and the capability summary. Subgroup size 1 uses I-MR; 2+ uses Xbar-R.
   ───────────────────────────────────────────────────────────────────────── */

import { adNormality, clean, type ADResult } from './stats';
import { capability, type CapabilityResult, type SigmaMethod } from './capability';
import { imrChart, xbarRCharts, type SpcPanel } from './spc';

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
}

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
  const spc = subgroup > 1
    ? xbarRCharts(raw, Math.min(10, subgroup))
    : imrChart(values);
  const cap = capability(raw, {
    lsl: options.lsl ?? null,
    usl: options.usl ?? null,
    target: options.target ?? null,
    subgroup,
    sigmaMethod: options.sigmaMethod ?? 'z_bench_shift',
  });
  const ad = adNormality(values);
  const lastCount = options.lastCount ?? 25;
  const last = lastPanel(spc.panels[0], lastCount, 'Last subgroups', '@chart.last25');
  const width = cap.lsl !== null && cap.usl !== null ? (cap.usl as number) - (cap.lsl as number) : NaN;
  return {
    subgroup,
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
  };
}
