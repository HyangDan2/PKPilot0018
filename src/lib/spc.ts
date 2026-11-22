/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — statistical process control
   I-MR, Xbar-R, Xbar-S, P, NP, C and U charts with the eight Nelson rules.
   ───────────────────────────────────────────────────────────────────────── */

import { logGamma } from './dist';

export interface SpcViolation { index: number; rules: number[] }

export interface SpcPanel {
  key: string;
  titleKey: string;
  points: number[];
  center: number;
  ucl: number | number[];
  lcl: number | number[];
  sigma: number | number[];
  violations: SpcViolation[];
  yLabel?: string;
}

export interface SpcResult {
  panels: SpcPanel[];
  sigmaWithin: number;
  outOfControl: number;
  rulesHit: number[];
  /** Xbar-R only: how the fixed row-order subgroup boundaries were handled. */
  subgroupSummary?: {
    size: number;
    total: number;
    used: number;
    /** subgroups dropped because fewer than two valid values remained */
    skipped: number;
    /** rows at the end that did not fill a whole subgroup */
    leftoverRows: number;
    /** subgroups that contained at least one missing value (limits use their own nᵢ) */
    missingSubgroups?: number;
    /** true when the valid subgroup sizes nᵢ are not all equal */
    varying?: boolean;
  };
}

export type SpcIssueCode =
  | 'empty'
  | 'length'
  | 'nonFinite'
  | 'nonInteger'
  | 'negative'
  | 'exceeds'
  | 'size'
  | 'sizeNonInteger'
  | 'noGroups';

export interface SpcIssue {
  index?: number;
  code: SpcIssueCode;
  defect?: number;
  size?: number;
}

/** A validated input problem that the UI shows as a readable message. */
export class SpcValidationError extends Error {
  issues: SpcIssue[];
  constructor(issues: SpcIssue[]) {
    super('spc.invalid');
    this.name = 'SpcValidationError';
    this.issues = issues;
  }
}

export const XBAR_CONSTANTS: Record<number, { A2: number; d2: number; d3: number; D3: number; D4: number }> = {
  2: { A2: 1.88, d2: 1.128, d3: 0.853, D3: 0, D4: 3.267 },
  3: { A2: 1.023, d2: 1.693, d3: 0.888, D3: 0, D4: 2.574 },
  4: { A2: 0.729, d2: 2.059, d3: 0.88, D3: 0, D4: 2.282 },
  5: { A2: 0.577, d2: 2.326, d3: 0.864, D3: 0, D4: 2.114 },
  6: { A2: 0.483, d2: 2.534, d3: 0.848, D3: 0, D4: 2.004 },
  7: { A2: 0.419, d2: 2.704, d3: 0.833, D3: 0.076, D4: 1.924 },
  8: { A2: 0.373, d2: 2.847, d3: 0.82, D3: 0.136, D4: 1.864 },
  9: { A2: 0.337, d2: 2.97, d3: 0.808, D3: 0.184, D4: 1.816 },
  10: { A2: 0.308, d2: 3.078, d3: 0.797, D3: 0.223, D4: 1.777 },
};

function sigmaAt(sigma: number | number[], i: number): number {
  return Array.isArray(sigma) ? sigma[Math.min(i, sigma.length - 1)] : sigma;
}

/**
 * Nelson rules 1–8, evaluated on every point (windows end at that point).
 * Returns, per point, the list of rule numbers it violates.
 */
export function nelsonRules(values: number[], center: number, sigma: number | number[]): number[][] {
  const out: number[][] = values.map(() => []);
  const n = values.length;
  const z = values.map((v, i) => (v - center) / Math.max(1e-12, sigmaAt(sigma, i)));

  const push = (i: number, rule: number) => {
    if (i >= 0 && i < n && !out[i].includes(rule)) out[i].push(rule);
  };

  for (let i = 0; i < n; i += 1) {
    // Rule 1 — one point beyond 3σ
    if (Math.abs(z[i]) > 3) push(i, 1);

    // Rule 2 — nine (or more) points on one side of the centre line
    if (i >= 8) {
      const win = z.slice(i - 8, i + 1);
      if (win.every((v) => v > 0) || win.every((v) => v < 0)) push(i, 2);
    }

    // Rule 3 — six points steadily increasing or decreasing
    if (i >= 5) {
      const win = values.slice(i - 5, i + 1);
      let up = true;
      let down = true;
      for (let j = 1; j < win.length; j += 1) {
        if (!(win[j] > win[j - 1])) up = false;
        if (!(win[j] < win[j - 1])) down = false;
      }
      if (up || down) push(i, 3);
    }

    // Rule 4 — fourteen points alternating up and down
    if (i >= 13) {
      const win = values.slice(i - 13, i + 1);
      let alternating = true;
      for (let j = 2; j < win.length; j += 1) {
        const d1 = win[j - 1] - win[j - 2];
        const d2 = win[j] - win[j - 1];
        if (!(d1 * d2 < 0)) { alternating = false; break; }
      }
      if (alternating) push(i, 4);
    }

    // Rule 5 — two of three successive points beyond 2σ on the same side
    if (i >= 2) {
      const win = z.slice(i - 2, i + 1);
      const high = win.filter((v) => v > 2).length;
      const low = win.filter((v) => v < -2).length;
      if (high >= 2 || low >= 2) push(i, 5);
    }

    // Rule 6 — four of five successive points beyond 1σ on the same side
    if (i >= 4) {
      const win = z.slice(i - 4, i + 1);
      const high = win.filter((v) => v > 1).length;
      const low = win.filter((v) => v < -1).length;
      if (high >= 4 || low >= 4) push(i, 6);
    }

    // Rule 7 — fifteen successive points within 1σ (either side)
    if (i >= 14) {
      const win = z.slice(i - 14, i + 1);
      if (win.every((v) => Math.abs(v) < 1)) push(i, 7);
    }

    // Rule 8 — eight successive points beyond 1σ (either side)
    if (i >= 7) {
      const win = z.slice(i - 7, i + 1);
      if (win.every((v) => Math.abs(v) > 1)) push(i, 8);
    }
  }
  return out;
}

function violationsFrom(flags: number[][]): SpcViolation[] {
  const out: SpcViolation[] = [];
  flags.forEach((rules, index) => {
    if (rules.length) out.push({ index, rules: [...rules].sort((a, b) => a - b) });
  });
  return out;
}

function summarizePanels(panels: SpcPanel[], sigmaWithin: number): SpcResult {
  const rulesHit = new Set<number>();
  panels.forEach((p) => p.violations.forEach((v) => v.rules.forEach((r) => rulesHit.add(r))));
  const outOfControl = panels.reduce((a, p) => a + p.violations.filter((v) => v.rules.includes(1)).length, 0);
  return { panels, sigmaWithin, outOfControl, rulesHit: [...rulesHit].sort((a, b) => a - b) };
}

export function imrChart(values: number[]): SpcResult {
  const v = values.filter((x) => isFinite(x));
  const n = v.length;
  const center = v.reduce((a, b) => a + b, 0) / n;
  const mr: number[] = [];
  for (let i = 1; i < n; i += 1) mr.push(Math.abs(v[i] - v[i - 1]));
  const mrBar = mr.length ? mr.reduce((a, b) => a + b, 0) / mr.length : 0;
  const sigma = mrBar / 1.128;
  const iFlags = nelsonRules(v, center, sigma);
  const mrCenter = mrBar;
  const mrSigma = 0.8525 * mrBar / 1.128;
  const mrFlags = nelsonRules(mr, mrCenter, mrSigma);
  const panels: SpcPanel[] = [
    {
      key: 'i',
      titleKey: '@chart.ichart',
      points: v,
      center,
      ucl: center + 3 * sigma,
      lcl: center - 3 * sigma,
      sigma,
      violations: violationsFrom(iFlags),
    },
    {
      key: 'mr',
      titleKey: '@chart.mrchart',
      points: mr,
      center: mrCenter,
      ucl: 3.267 * mrBar,
      lcl: 0,
      sigma: mrSigma,
      violations: violationsFrom(mrFlags),
    },
  ];
  return summarizePanels(panels, sigma);
}

export function xbarRCharts(values: (number | null)[], subgroup: number): SpcResult {
  const n = Math.max(2, Math.min(10, Math.round(subgroup)));
  // Subgroup boundaries follow the ORIGINAL row order. Missing values are
  // dropped inside each finished subgroup only, so later subgroups never shift.
  // A subgroup with missing values keeps its own valid size nᵢ, and its limits
  // use the constants A₂(nᵢ), D₃(nᵢ), D₄(nᵢ) and d₂(nᵢ) — using the nominal n
  // for a shorter subgroup made its limits too narrow.
  const groups: { values: number[]; ni: number; missing: boolean }[] = [];
  let skipped = 0;
  for (let start = 0; start + n <= values.length; start += n) {
    const slice = values.slice(start, start + n);
    const chunk = slice.filter((x): x is number => typeof x === 'number' && isFinite(x));
    if (chunk.length < 2) {
      skipped += 1;
      continue;
    }
    groups.push({ values: chunk, ni: chunk.length, missing: chunk.length < slice.length });
  }
  const totalGroups = Math.floor(values.length / n);
  if (!groups.length) throw new SpcValidationError([{ code: 'noGroups' }]);
  const means = groups.map((g) => g.values.reduce((a, b) => a + b, 0) / g.ni);
  const ranges = groups.map((g) => Math.max(...g.values) - Math.min(...g.values));
  const grand = means.reduce((a, b) => a + b, 0) / means.length;
  // Weighted within-subgroup sigma: (ni−1)/Σ(ni−1) on each R̃ᵢ = Rᵢ/d₂(nᵢ).
  // With equal nᵢ this is exactly R̄/d₂(n), so the classical table values hold.
  const weights = groups.reduce((a, g) => a + (g.ni - 1), 0);
  const sigma = weights > 0
    ? groups.reduce((a, g, i) => a + ((g.ni - 1) / weights) * (ranges[i] / XBAR_CONSTANTS[g.ni].d2), 0)
    : NaN;
  const d2Bar = groups.reduce((a, g) => a + ((g.ni - 1) / weights) * XBAR_CONSTANTS[g.ni].d2, 0);
  const rBar = sigma * d2Bar;
  const xbarSigma = groups.map((g) => sigma / Math.sqrt(g.ni));
  const rSigma = groups.map((g) => XBAR_CONSTANTS[g.ni].d3 * sigma);
  const xbarUcl = groups.map((g) => grand + 3 * (sigma / Math.sqrt(g.ni)));
  const xbarLcl = groups.map((g) => grand - 3 * (sigma / Math.sqrt(g.ni)));
  const rUcl = groups.map((g) => {
    const c = XBAR_CONSTANTS[g.ni];
    return c.D4 * c.d2 * sigma;
  });
  const rLcl = groups.map((g) => {
    const c = XBAR_CONSTANTS[g.ni];
    return Math.max(0, c.D3 * c.d2 * sigma);
  });
  const xFlags = nelsonRules(means, grand, xbarSigma);
  const rFlags = nelsonRules(ranges, rBar, rSigma);
  const panels: SpcPanel[] = [
    {
      key: 'xbar',
      titleKey: '@chart.xbarchart',
      points: means,
      center: grand,
      ucl: xbarUcl,
      lcl: xbarLcl,
      sigma: xbarSigma,
      violations: violationsFrom(xFlags),
    },
    {
      key: 'r',
      titleKey: '@chart.rchart',
      points: ranges,
      center: rBar,
      ucl: rUcl,
      lcl: rLcl,
      sigma: rSigma,
      violations: violationsFrom(rFlags),
    },
  ];
  const result = summarizePanels(panels, sigma);
  result.subgroupSummary = {
    size: n,
    total: totalGroups,
    used: groups.length,
    skipped,
    leftoverRows: values.length % n,
    missingSubgroups: groups.filter((g) => g.missing).length,
    varying: groups.some((g) => g.ni !== n),
  };
  return result;
}

/**
 * P chart with strict input validation: a bad defect count or sample size is
 * reported instead of silently dropped, and a zero-variance p̄ never divides
 * by zero.
 */
export function pChart(defects: number[], sizes: number[]): SpcResult {
  const issues: SpcIssue[] = [];
  if (!defects.length || !sizes.length) throw new SpcValidationError([{ code: 'empty' }]);
  if (defects.length !== sizes.length) issues.push({ code: 'length', defect: defects.length, size: sizes.length });
  const len = Math.min(defects.length, sizes.length);
  for (let i = 0; i < len; i += 1) {
    const d = defects[i];
    const s = sizes[i];
    if (!Number.isFinite(d)) {
      issues.push({ index: i, code: 'nonFinite', defect: d });
      continue;
    }
    if (!Number.isInteger(d)) issues.push({ index: i, code: 'nonInteger', defect: d });
    if (d < 0) issues.push({ index: i, code: 'negative', defect: d });
    if (!Number.isFinite(s) || s <= 0) {
      issues.push({ index: i, code: 'size', size: s });
      continue;
    }
    if (!Number.isInteger(s)) issues.push({ index: i, code: 'sizeNonInteger', size: s });
    if (Number.isFinite(d) && d > s) issues.push({ index: i, code: 'exceeds', defect: d, size: s });
  }
  if (issues.length) throw new SpcValidationError(issues);
  const totalDefects = defects.reduce((a, b) => a + b, 0);
  const totalSize = sizes.reduce((a, b) => a + b, 0);
  const pBar = totalSize > 0 ? totalDefects / totalSize : NaN;
  if (!isFinite(pBar)) throw new SpcValidationError([{ code: 'size', size: totalSize }]);
  const proportions = defects.map((d, i) => d / sizes[i]);
  const sigmas = sizes.map((s) => Math.sqrt((pBar * (1 - pBar)) / s));
  // p̄ = 0 or 1 makes every sigma zero: the chart is flat at the centre line.
  const z = proportions.map((p, i) => (sigmas[i] > 0 ? (p - pBar) / sigmas[i] : 0));
  const flags = nelsonRules(z, 0, 1);
  const ucl = sigmas.map((s) => Math.min(1, pBar + 3 * s));
  const lcl = sigmas.map((s) => Math.max(0, pBar - 3 * s));
  const panels: SpcPanel[] = [
    {
      key: 'p',
      titleKey: '@chart.pchart',
      points: proportions,
      center: pBar,
      ucl,
      lcl,
      sigma: sigmas,
      violations: violationsFrom(flags),
    },
  ];
  return summarizePanels(panels, Math.sqrt((pBar * (1 - pBar)) / totalSize / sizes.length));
}

/* ── Xbar-S chart (P2) ──────────────────────────────────────────────────
   S-chart constants come from the unbiasing constant c₄, so any subgroup
   size ≥ 2 is exact instead of being read from a 2..10 lookup table.
   ──────────────────────────────────────────────────────────────────── */

/** c₄(n) = √(2/(n−1)) · Γ(n/2) / Γ((n−1)/2) — the S-chart unbiasing constant. */
export function c4Constant(n: number): number {
  if (!(n >= 2)) return NaN;
  return Math.sqrt(2 / (n - 1)) * Math.exp(logGamma(n / 2) - logGamma((n - 1) / 2));
}

export function xbarSConstants(n: number): { c4: number; A3: number; B3: number; B4: number } {
  const c = c4Constant(n);
  const spread = Math.sqrt(Math.max(0, 1 - c * c));
  return {
    c4: c,
    A3: 3 / (c * Math.sqrt(n)),
    B3: Math.max(0, 1 - (3 * spread) / c),
    B4: 1 + (3 * spread) / c,
  };
}

/**
 * Xbar-S charts. Subgroups are either consecutive rows of a fixed size (row
 * order preserved, missing values dropped inside a finished subgroup) or the
 * rows sharing an optional group-id column, which gives varying nᵢ.
 */
export function xbarSCharts(
  values: (number | null)[],
  options: { size?: number; groupIds?: (string | null)[] } = {},
): SpcResult {
  let groups: number[][] = [];
  let skipped = 0;
  let totalGroups = 0;
  let leftoverRows = 0;
  if (options.groupIds && options.groupIds.length) {
    const map = new Map<string, number[]>();
    options.groupIds.forEach((key, index) => {
      const value = values[index];
      if (key === null || key === '') return;
      if (typeof value !== 'number' || !isFinite(value)) return;
      const list = map.get(key) ?? [];
      list.push(value);
      map.set(key, list);
    });
    groups = [...map.values()].filter((g) => g.length >= 2);
    skipped = [...map.values()].filter((g) => g.length < 2).length;
    totalGroups = map.size;
  } else {
    const n = Math.max(2, Math.round(options.size ?? 5));
    for (let start = 0; start + n <= values.length; start += n) {
      const chunk = values.slice(start, start + n).filter((x): x is number => typeof x === 'number' && isFinite(x));
      if (chunk.length < 2) {
        skipped += 1;
        continue;
      }
      groups.push(chunk);
    }
    totalGroups = Math.floor(values.length / n);
    leftoverRows = values.length % n;
  }
  if (!groups.length) throw new SpcValidationError([{ code: 'noGroups' }]);
  const sizes = groups.map((g) => g.length);
  const means = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const sds = groups.map((g) => {
    if (g.length < 2) return NaN;
    const m = g.reduce((a, b) => a + b, 0) / g.length;
    return Math.sqrt(g.reduce((a, b) => a + (b - m) ** 2, 0) / (g.length - 1));
  });
  const grand = means.reduce((a, b) => a + b, 0) / means.length;
  const sBar = sds.reduce((a, b) => a + b, 0) / sds.length;
  const c4Bar = sizes.reduce((a, c) => a + c4Constant(c), 0) / sizes.length;
  const sigma = sBar / c4Bar;
  const xbarSigma = sizes.map((n) => sigma / Math.sqrt(n));
  const sSigma = sizes.map((n) => sigma * Math.sqrt(Math.max(0, 1 - c4Constant(n) ** 2)));
  const xbarUcl = sizes.map((_, i) => grand + 3 * xbarSigma[i]);
  const xbarLcl = sizes.map((_, i) => grand - 3 * xbarSigma[i]);
  const sUcl = sizes.map((_, i) => sBar + 3 * sSigma[i]);
  const sLcl = sizes.map((_, i) => Math.max(0, sBar - 3 * sSigma[i]));
  const zXbar = means.map((m, i) => (xbarSigma[i] > 0 ? (m - grand) / xbarSigma[i] : 0));
  const zS = sds.map((s, i) => (sSigma[i] > 0 ? (s - sBar) / sSigma[i] : 0));
  const panels: SpcPanel[] = [
    {
      key: 'xbar',
      titleKey: '@chart.xbarchart',
      points: means,
      center: grand,
      ucl: xbarUcl,
      lcl: xbarLcl,
      sigma: xbarSigma,
      violations: violationsFrom(nelsonRules(zXbar, 0, 1)),
    },
    {
      key: 's',
      titleKey: '@chart.schart',
      points: sds,
      center: sBar,
      ucl: sUcl,
      lcl: sLcl,
      sigma: sSigma,
      violations: violationsFrom(nelsonRules(zS, 0, 1)),
    },
  ];
  const result = summarizePanels(panels, sigma);
  result.subgroupSummary = {
    size: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length),
    total: totalGroups,
    used: groups.length,
    skipped,
    leftoverRows,
  };
  return result;
}

/* ── attribute charts NP, C, U (P2) ──────────────────────────────────── */

function checkCounts(counts: number[], sizes: number[] | null, requireInteger: boolean): SpcIssue[] {
  const issues: SpcIssue[] = [];
  counts.forEach((d, i) => {
    if (!Number.isFinite(d)) {
      issues.push({ index: i, code: 'nonFinite', defect: d });
      return;
    }
    if (requireInteger && !Number.isInteger(d)) issues.push({ index: i, code: 'nonInteger', defect: d });
    if (d < 0) issues.push({ index: i, code: 'negative', defect: d });
    if (sizes) {
      const n = sizes[i];
      if (!Number.isFinite(n) || n <= 0) {
        issues.push({ index: i, code: 'size', size: n });
        return;
      }
      if (Number.isFinite(d) && d > n) issues.push({ index: i, code: 'exceeds', defect: d, size: n });
    }
  });
  return issues;
}

/** NP chart — defectives per subgroup with a constant subgroup size n. */
export function npChart(defectives: number[], sampleSize: number): SpcResult {
  if (!defectives.length) throw new SpcValidationError([{ code: 'empty' }]);
  const n = Math.round(sampleSize);
  if (!(n > 0)) throw new SpcValidationError([{ code: 'size', size: sampleSize }]);
  const issues = checkCounts(defectives, defectives.map(() => n), true);
  if (issues.length) throw new SpcValidationError(issues);
  const npBar = defectives.reduce((a, b) => a + b, 0) / defectives.length;
  const pBar = npBar / n;
  const sigma = Math.sqrt(Math.max(0, npBar * (1 - pBar)));
  const ucl = Math.min(n, npBar + 3 * sigma);
  const lcl = Math.max(0, npBar - 3 * sigma);
  const z = defectives.map((d) => (sigma > 0 ? (d - npBar) / sigma : 0));
  const panels: SpcPanel[] = [
    {
      key: 'np',
      titleKey: '@chart.npchart',
      points: defectives,
      center: npBar,
      ucl,
      lcl,
      sigma,
      violations: violationsFrom(nelsonRules(z, 0, 1)),
    },
  ];
  return summarizePanels(panels, sigma);
}

/** C chart — defects per unit with a constant inspection unit. */
export function cChart(defects: number[]): SpcResult {
  if (!defects.length) throw new SpcValidationError([{ code: 'empty' }]);
  const issues = checkCounts(defects, null, true);
  if (issues.length) throw new SpcValidationError(issues);
  const cBar = defects.reduce((a, b) => a + b, 0) / defects.length;
  const sigma = Math.sqrt(Math.max(0, cBar));
  const ucl = cBar + 3 * sigma;
  const lcl = Math.max(0, cBar - 3 * sigma);
  const z = defects.map((c) => (sigma > 0 ? (c - cBar) / sigma : 0));
  const panels: SpcPanel[] = [
    {
      key: 'c',
      titleKey: '@chart.cchart',
      points: defects,
      center: cBar,
      ucl,
      lcl,
      sigma,
      violations: violationsFrom(nelsonRules(z, 0, 1)),
    },
  ];
  return summarizePanels(panels, sigma);
}

/** U chart — defects per unit with a varying (or constant) inspection size. */
export function uChart(defects: number[], unitSizes: number[]): SpcResult {
  if (!defects.length || !unitSizes.length) throw new SpcValidationError([{ code: 'empty' }]);
  if (defects.length !== unitSizes.length) {
    throw new SpcValidationError([{ code: 'length', defect: defects.length, size: unitSizes.length }]);
  }
  const issues = checkCounts(defects, null, true);
  unitSizes.forEach((n, i) => {
    if (!Number.isFinite(n) || n <= 0) issues.push({ index: i, code: 'size', size: n });
    else if (!Number.isInteger(n)) issues.push({ index: i, code: 'sizeNonInteger', size: n });
  });
  if (issues.length) throw new SpcValidationError(issues);
  const totalDefects = defects.reduce((a, b) => a + b, 0);
  const totalUnits = unitSizes.reduce((a, b) => a + b, 0);
  const uBar = totalDefects / totalUnits;
  const points = defects.map((c, i) => c / unitSizes[i]);
  const sigmas = unitSizes.map((n) => Math.sqrt(Math.max(0, uBar / n)));
  const ucl = sigmas.map((s) => uBar + 3 * s);
  const lcl = sigmas.map((s) => Math.max(0, uBar - 3 * s));
  const z = points.map((u, i) => (sigmas[i] > 0 ? (u - uBar) / sigmas[i] : 0));
  const panels: SpcPanel[] = [
    {
      key: 'u',
      titleKey: '@chart.uchart',
      points,
      center: uBar,
      ucl,
      lcl,
      sigma: sigmas,
      violations: violationsFrom(nelsonRules(z, 0, 1)),
    },
  ];
  return summarizePanels(panels, Math.sqrt(uBar / (totalUnits / unitSizes.length)));
}
