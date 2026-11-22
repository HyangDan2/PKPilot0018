/* ─────────────────────────────────────────────────────────────────────────
   Follow-up QA (Section 7 of docs/CODE_REVIEW_REMEDIATION_REPORT.md)

   Regression tests for the REVIEW-3 / UNVERIFIED-9 resolution:

   · QA-X-04/05/06 — the se = 0 convention: t and p are undefined (NaN),
     never 0 or ±∞, in every t-test variant.
   · QA-B-06 — rank-deficient GLM keeps the model invariants (fitted values,
     residuals, SSE, df, R²) and reports the aliased columns instead of
     failing; which column is aliased is solver policy, not a defect.
   · QA-U-01…09 — the chart rules (pareto, histogram, boxplot, scatter,
     timeseries) and worksheet transforms (sort, standardize, recode, random)
     driven through the same findAnalysis(id).run entry the UI uses.
   ───────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAnalysis } from '../src/lib/analyses';
import { boxplotStats, histogramBins, histogramCurve } from '../src/lib/charts';
import { fitGlm, type ModelFactor, type ModelTerm } from '../src/lib/glm';
import { pairedT, tTest1, tTest2 } from '../src/lib/stats';
import { generateRandom } from '../src/lib/random';
import type { Worksheet } from '../src/types';

function run(id: string, sheet: Worksheet, values: Record<string, unknown>) {
  const def = findAnalysis(id);
  expect(def, id).toBeDefined();
  return (def as NonNullable<typeof def>).run({ lang: 'en', sheet, values });
}

function sheetOf(columns: { name: string; type: 'numeric' | 'text'; values: (number | string | null)[] }[]): Worksheet {
  return {
    id: 'ws-test',
    name: 'Test',
    columns: columns.map((col, i) => ({ ...col, id: `C${i + 1}` })),
  };
}

/* ── QA-X-04/05/06 — the se = 0 convention ────────────────────────────── */

describe('QA-X se = 0 convention: t and p are undefined, not 0 / ±∞', () => {
  const flat = [5, 5, 5, 5, 5, 5];
  const zeros = [0, 0, 0, 0, 0, 0];

  it('1-sample t on a constant sample reports NaN t and p (QA-X-04)', () => {
    const r = tTest1(flat, 5);
    expect(r.se).toBe(0);
    expect(Number.isNaN(r.t)).toBe(true);
    expect(Number.isNaN(r.p)).toBe(true);
    // The degenerate confidence interval still brackets the estimate.
    expect(r.ci[0]).toBe(5);
    expect(r.ci[1]).toBe(5);
  });

  it('2-sample t with both variances 0 reports NaN t and p (QA-X-05)', () => {
    const r = tTest2(flat, zeros);
    expect(r.se).toBe(0);
    expect(Number.isNaN(r.t)).toBe(true);
    expect(Number.isNaN(r.p)).toBe(true);
    expect(r.varianceTest).toBeUndefined();
  });

  it('paired t with constant differences reports NaN t and p even when m = μ₀ (QA-X-06)', () => {
    // Every difference is 5 and μ₀ = 5 — the old 0 / ±∞ rule answered t = 0 here.
    const r = pairedT(flat, zeros, 5);
    expect(r.se).toBe(0);
    expect(Number.isNaN(r.t)).toBe(true);
    expect(Number.isNaN(r.p)).toBe(true);
    // ... and the one-sided variants stay undefined as well.
    const greater = pairedT(flat, zeros, 0, 0.95, 'greater');
    expect(Number.isNaN(greater.t)).toBe(true);
    expect(Number.isNaN(greater.p)).toBe(true);
  });

  it('keeps the finite-sample behaviour untouched when se > 0', () => {
    // mean 2.5, s 1.29099, se 0.64550 → t = (2.5 − 3)/0.64550 = −0.774597
    const r = tTest1([1, 2, 3, 4], 3);
    expect(r.t).toBeCloseTo(-0.7745966692, 6);
    expect(r.p).toBeCloseTo(0.4950253461, 6);
  });
});

/* ── QA-B-06 — rank-deficient GLM invariants ──────────────────────────── */

describe('QA-B-06 rank-deficient GLM keeps the model invariants', () => {
  // The 2^3 design with 2 centre points: declaring B categorical gives it the
  // levels −1 / 0 / +1, and at the centres A = 0 makes A·B[0] a linear
  // combination of A and A·B[−1] (A − A·B[−1] + 2·A·B[0] = 0).
  const A = [-1, -1, -1, -1, 1, 1, 1, 1, 0, 0];
  const B = [-1, -1, 1, 1, -1, -1, 1, 1, 0, 0];
  const Y = [21.5, 22.1, 27.3, 27.9, 30.2, 30.8, 38.4, 37.6, 30.1, 29.9];
  const factors: ModelFactor[] = [
    { name: 'A', kind: 'numeric', values: A },
    { name: 'B', kind: 'categorical', values: B.map(String) },
  ];
  const terms: ModelTerm[] = [
    { name: 'A', factors: ['A'] },
    { name: 'B', factors: ['B'] },
    { name: 'A×B', factors: ['A', 'B'] },
  ];

  it('reports exactly one aliased column and keeps dfe = n − rank', () => {
    const glm = fitGlm(Y, factors, terms);
    expect(glm.rank).toBe(5);
    expect(glm.aliased.length).toBe(1);
    expect(glm.dfe).toBe(10 - 5);
    // The aliased label names a design column, not a raw index.
    expect(glm.aliased[0]).toMatch(/A/);
  });

  it('keeps fitted values and residuals finite and SSE consistent', () => {
    const glm = fitGlm(Y, factors, terms);
    expect(glm.fitted).toHaveLength(10);
    expect(glm.residuals).toHaveLength(10);
    glm.fitted.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    glm.residuals.forEach((v) => expect(Number.isFinite(v)).toBe(true));
    const sse = glm.residuals.reduce((a, v) => a + v * v, 0);
    expect(sse).toBeCloseTo(glm.sse, 10);
    expect(glm.ssModel + glm.sse).toBeCloseTo(glm.ssTotal, 10);
    expect(glm.r2).toBeGreaterThan(0.8);
  });
});

/* ── QA-U — chart rules and worksheet transforms through the runners ──── */

const CHARTS = JSON.parse(readFileSync(resolve(process.cwd(), 'qa/datasets/charts.json'), 'utf8')) as {
  columns: Record<string, (number | string | null)[]>;
};

function chartsSheet(): Worksheet {
  return sheetOf([
    { name: 'id', type: 'numeric', values: CHARTS.columns.id as number[] },
    { name: 'defect', type: 'text', values: CHARTS.columns.defect as string[] },
    { name: 'machine', type: 'text', values: CHARTS.columns.machine as string[] },
    { name: 'x', type: 'numeric', values: CHARTS.columns.x as number[] },
    { name: 'y', type: 'numeric', values: CHARTS.columns.y as number[] },
    { name: 'value', type: 'numeric', values: CHARTS.columns.value as number[] },
    { name: 'code', type: 'numeric', values: CHARTS.columns.code as number[] },
  ]);
}

describe('QA-U-01 pareto', () => {
  it('sorts by descending count and closes the cumulative percentage at 100', () => {
    const result = run('pareto', chartsSheet(), { category: 'C2' });
    const chart = result.blocks.find((b) => b.type === 'chart');
    const items = (chart as { chart: { kind: string; items: { label: string; count: number }[] } }).chart.items;
    expect(items).toHaveLength(9);
    for (let i = 1; i < items.length; i += 1) expect(items[i - 1].count).toBeGreaterThanOrEqual(items[i].count);
    expect(items[0]).toEqual({ label: 'Scratch', count: 15 });
    expect(items[8]).toEqual({ label: 'Void', count: 1 });
    const table = result.blocks.find((b) => b.type === 'table') as { rows: (string | number)[][] };
    expect(table.rows[8][3]).toBe('100.0%');
    expect(table.rows.reduce((a, r) => a + Number(r[1]), 0)).toBe(55);
  });
});

describe('QA-U-02 histogram bins and normal curve', () => {
  it('follows the documented bin rule and sums the counts to n', () => {
    const values = (CHARTS.columns.value as (number | null)[]).filter((v): v is number => typeof v === 'number');
    const bins = histogramBins(values);
    expect(bins).toHaveLength(7); // max(5, min(20, ceil(1 + log2 57)))
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(values.length);
    expect(bins[0].lo).toBe(Math.min(...values));
    expect(bins[6].hi).toBeCloseTo(Math.max(...values), 9);
  });

  it('peaks the normal curve at the sample mean with height n·w·φ(m)', () => {
    const values = (CHARTS.columns.value as (number | null)[]).filter((v): v is number => typeof v === 'number');
    const curve = histogramCurve(values);
    expect(curve.points).toHaveLength(121);
    const peak = curve.points.reduce((a, b) => (b.y > a.y ? b : a), curve.points[0]);
    // The 121-point grid resolves the peak only to half a grid step.
    const step = (Math.max(...values) - Math.min(...values)) / 120;
    expect(Math.abs(peak.x - curve.mean)).toBeLessThan(step);
    const w = (Math.max(...values) - Math.min(...values)) / 7;
    const phi0 = 1 / Math.sqrt(2 * Math.PI);
    // The grid point nearest the mean carries the peak; the residual z offset
    // keeps it a hair below n·w·φ(0)/s.
    expect(peak.y).toBeCloseTo(values.length * w * phi0 / curve.sd, 1);
  });
});

describe('QA-U-03 boxplot statistics', () => {
  it('computes type-6 quartiles, 1.5·IQR whiskers and the outlier list', () => {
    const s = boxplotStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
    expect(s.n).toBe(10);
    // h = (n+1)·0.25 = 2.75 → between the 2nd and 3rd order statistics.
    expect(s.q1).toBeCloseTo(2.75, 10);
    expect(s.median).toBeCloseTo(5.5, 10);
    expect(s.q3).toBeCloseTo(8.25, 10);
    expect(s.iqr).toBeCloseTo(5.5, 10);
    expect(s.lowFence).toBeCloseTo(2.75 - 8.25, 10);
    expect(s.highFence).toBeCloseTo(8.25 + 8.25, 10);
    expect(s.whiskerLow).toBe(1);
    expect(s.whiskerHigh).toBe(9);
    expect(s.outliers).toEqual([100]);
  });
});

describe('QA-U-04 scatter fit and groups', () => {
  it('draws the OLS line and maps the by groups in first-appearance order', () => {
    const result = run('scatter', chartsSheet(), { y: 'C5', x: 'C4', by: ['C3'] });
    const chart = (result.blocks.find((b) => b.type === 'chart') as { chart: { points: { x: number; y: number; g?: string }[]; fit: { slope: number; intercept: number }; groups?: string[] } }).chart;
    expect(chart.points.length).toBe(60);
    expect(chart.groups).toEqual(['M1', 'M2', 'M3']);
    // Exact least-squares line: recompute slope from the points.
    const n = chart.points.length;
    const mx = chart.points.reduce((a, p) => a + p.x, 0) / n;
    const my = chart.points.reduce((a, p) => a + p.y, 0) / n;
    const slope = chart.points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0)
      / chart.points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
    expect(chart.fit.slope).toBeCloseTo(slope, 10);
    expect(chart.fit.intercept).toBeCloseTo(my - slope * mx, 10);
  });
});

describe('QA-U-05 timeseries spec lines', () => {
  it('keeps the raw length, skips missing values and echoes the limits', () => {
    const result = run('timeseries', chartsSheet(), { variable: 'C6', lsl: '40', usl: '60', target: '50' });
    const chart = (result.blocks.find((b) => b.type === 'chart') as { chart: { values: number[]; lsl: number | null; usl: number | null; target: number | null } }).chart;
    expect(chart.values).toHaveLength(60);
    expect(chart.values.filter((v) => Number.isFinite(v))).toHaveLength(57);
    expect(chart.lsl).toBe(40);
    expect(chart.usl).toBe(60);
    expect(chart.target).toBe(50);
  });
});

describe('QA-U-06 sort moves whole rows', () => {
  it('sorts ascending with nulls last and keeps the id column aligned', () => {
    const result = run('sort', chartsSheet(), { column: 'C6', descending: false });
    const patched = result.sheetPatch as Worksheet;
    const value = patched.columns.find((c) => c.name === 'value')?.values ?? [];
    const id = patched.columns.find((c) => c.name === 'id')?.values ?? [];
    expect(value).toHaveLength(60);
    const finite = value.filter((v): v is number => typeof v === 'number');
    expect(finite).toHaveLength(57);
    for (let i = 1; i < finite.length; i += 1) expect(finite[i - 1]).toBeLessThanOrEqual(finite[i]);
    for (let i = finite.length; i < value.length; i += 1) expect(value[i]).toBeNull();
    // Row integrity: the id that travels with the smallest value is the row
    // whose original value was the smallest.
    const original = CHARTS.columns.value as (number | null)[];
    let minIndex = -1;
    original.forEach((v, i) => {
      if (typeof v === 'number' && (minIndex < 0 || v < (original[minIndex] as number))) minIndex = i;
    });
    expect(id[0]).toBe(CHARTS.columns.id[minIndex]);
  });
});

describe('QA-U-07 standardize', () => {
  it('stores z-scores with missing values preserved and z̄ ≈ 0, s ≈ 1', () => {
    const result = run('standardize', chartsSheet(), { column: 'C6', storeIn: '' });
    const patched = result.sheetPatch as Worksheet;
    const z = patched.columns.find((c) => c.name === 'Std value')?.values ?? [];
    expect(z).toHaveLength(60);
    const finite = z.filter((v): v is number => typeof v === 'number');
    expect(finite).toHaveLength(57);
    for (let i = 0; i < z.length; i += 1) {
      if (typeof CHARTS.columns.value[i] !== 'number') expect(z[i]).toBeNull();
    }
    const m = finite.reduce((a, b) => a + b, 0) / finite.length;
    const s = Math.sqrt(finite.reduce((a, b) => a + (b - m) ** 2, 0) / (finite.length - 1));
    expect(Math.abs(m)).toBeLessThan(1e-12);
    expect(Math.abs(s - 1)).toBeLessThan(1e-12);
  });
});

describe('QA-U-08 recode', () => {
  it('maps 1→10, 2→20, 3→30 and preserves unmapped 9 and nulls', () => {
    const result = run('recode', chartsSheet(), { column: 'C7', mapping: '1=10, 2=20, 3=30', fallback: '' });
    const patched = result.sheetPatch as Worksheet;
    const out = patched.columns.find((c) => c.name === 'Recode code')?.values ?? [];
    expect(out).toHaveLength(60);
    const counts: Record<string, number> = {};
    out.forEach((v) => {
      if (typeof v === 'number') counts[String(v)] = (counts[String(v)] ?? 0) + 1;
    });
    expect(counts).toEqual({ '10': 15, '20': 10, '30': 18, '9': 17 });
    for (let i = 0; i < out.length; i += 1) {
      const src = CHARTS.columns.code[i];
      if (typeof src !== 'number') expect(out[i]).toBeNull();
      else if (src === 9) expect(out[i]).toBe(9);
      else expect(out[i]).toBe(src * 10);
    }
  });
});

describe('QA-U-09 random generation', () => {
  it('is deterministic under the same seed and length-true', () => {
    const options = { kind: 'normal' as const, count: 200, mean: 10, sd: 2, seed: 20261121 };
    const a = generateRandom(options);
    const b = generateRandom(options);
    expect(a).toEqual(b);
    expect(a).toHaveLength(200);
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    const s = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
    // Moment sanity on a 200-draw sample: 5 standard errors of the mean.
    expect(Math.abs(m - 10)).toBeLessThan(5 * (2 / Math.sqrt(200)));
    expect(Math.abs(s - 2)).toBeLessThan(0.35);
  });

  it('respects the distribution bounds for uniform and integer kinds', () => {
    const uniform = generateRandom({ kind: 'uniform', count: 500, min: 2, max: 5, seed: 7 });
    expect(Math.min(...uniform)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...uniform)).toBeLessThanOrEqual(5);
    const ints = generateRandom({ kind: 'integer', count: 500, min: 1, max: 6, seed: 7 });
    ints.forEach((v) => expect(Number.isInteger(v)).toBe(true));
  });
});
