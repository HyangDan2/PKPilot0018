/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — statistical process control
   I-MR, Xbar-R and P charts with the eight Nelson rules.
   ───────────────────────────────────────────────────────────────────────── */

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
  const constants = XBAR_CONSTANTS[n];
  const clean: number[] = values.filter((x): x is number => typeof x === 'number' && isFinite(x));
  const groups: number[][] = [];
  for (let i = 0; i + n <= clean.length; i += n) groups.push(clean.slice(i, i + n));
  const means = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const ranges = groups.map((g) => Math.max(...g) - Math.min(...g));
  const grand = means.reduce((a, b) => a + b, 0) / means.length;
  const rBar = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const sigma = rBar / constants.d2;
  const xFlags = nelsonRules(means, grand, sigma / Math.sqrt(n));
  const rFlags = nelsonRules(ranges, rBar, constants.d3 * sigma);
  const panels: SpcPanel[] = [
    {
      key: 'xbar',
      titleKey: '@chart.xbarchart',
      points: means,
      center: grand,
      ucl: grand + constants.A2 * rBar,
      lcl: grand - constants.A2 * rBar,
      sigma: sigma / Math.sqrt(n),
      violations: violationsFrom(xFlags),
    },
    {
      key: 'r',
      titleKey: '@chart.rchart',
      points: ranges,
      center: rBar,
      ucl: constants.D4 * rBar,
      lcl: constants.D3 * rBar,
      sigma: constants.d3 * sigma,
      violations: violationsFrom(rFlags),
    },
  ];
  return summarizePanels(panels, sigma);
}

export function pChart(defects: number[], sizes: number[]): SpcResult {
  const totalDefects = defects.reduce((a, b) => a + b, 0);
  const totalSize = sizes.reduce((a, b) => a + b, 0);
  const pBar = totalDefects / totalSize;
  const proportions = defects.map((d, i) => d / sizes[i]);
  const sigmas = sizes.map((s) => Math.sqrt((pBar * (1 - pBar)) / s));
  const z = proportions.map((p, i) => (p - pBar) / sigmas[i]);
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
