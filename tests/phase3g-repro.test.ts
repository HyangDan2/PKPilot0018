/* ─────────────────────────────────────────────────────────────────────────
   Phase 3G — Statistical Integrity Reproduction & Regression Suite
   Independent references computed with SciPy 1.18.1 / NumPy 2.5.4 /
   statsmodels 0.15.0, D'Agostino & Stephens (1986), Lenth (1989),
   Minitab Methods & Formulas, Montgomery SQC, and AIAG MSA 4th Ed.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import {
  erf,
  fInv,
  ncfCdf,
  nctCdf,
  normalCdf,
  normalInv,
  rangeCdf,
  rangeInv,
  tInv,
} from '../src/lib/dist';
import { adNormality, anovaOneWay, groupingLetters, regress } from '../src/lib/stats';
import { lenthPse } from '../src/lib/errorPooling';
import { analyzeRsm } from '../src/lib/doe';
import { fitGlm } from '../src/lib/glm';
import { solvePower, powerAt } from '../src/lib/power';
import { fitWeibull } from '../src/lib/reliability';
import { nonnormalCapability } from '../src/lib/nonnormal';
import { gageRR } from '../src/lib/gagerr';
import { pChart, xbarRCharts } from '../src/lib/spc';
import { capability } from '../src/lib/capability';
import { optimize } from '../src/lib/optimizer';
import { createStoredModel, type StoredModel } from '../src/lib/modelStore';

/* ── WO-3G-01 / ADD-03: Core Distribution Engine ──────────────────────── */

describe('WO-3G-01: dist.ts precision, tails, noncentral, dynamic brackets', () => {
  it('normalCdf matches SciPy in extreme lower tail (z = -5..-8)', () => {
    // SciPy 1.18.1 stats.norm.sf(z)
    expect(normalCdf(-5)).toBeCloseTo(2.866515718791934e-7, 12);
    expect(normalCdf(-6)).toBeCloseTo(9.865876450376944e-10, 14);
    expect(normalCdf(-7)).toBeCloseTo(1.279812543885835e-12, 16);
    expect(normalCdf(-8)).toBeGreaterThan(0);
    expect(Math.abs(normalCdf(-8) - 6.22096057427174e-16) / 6.22096057427174e-16).toBeLessThan(1e-6);
  });

  it('normalInv matches SciPy at extreme tail probabilities (p = 1e-12, 1e-9, 1e-7)', () => {
    expect(normalInv(1e-12)).toBeCloseTo(-7.034483825301, 6);
    expect(normalInv(1e-9)).toBeCloseTo(-5.997807015008, 6);
    expect(normalInv(1e-7)).toBeCloseTo(-5.199337582193, 6);
    expect(normalInv(1 - 1e-7)).toBeCloseTo(5.199337582291, 6);
  });

  it('erf does not clamp |x| > 6 prematurely and stays monotonic', () => {
    expect(1 - erf(5)).toBeGreaterThan(0);
    expect(1 - erf(5.5)).toBeGreaterThan(0);
    expect(erf(5.5)).toBeGreaterThan(erf(5));
  });

  it('ncfCdf handles large ncp (800, 1600) without underflow or truncation', () => {
    // SciPy: stats.ncf.cdf(200, 3, 40, 800) and stats.ncf.cdf(400, 3, 40, 1600)
    // At f = ncp / df1 (~266.7 for ncp=800, df1=3), CDF is around ~0.5
    const p800 = ncfCdf(266.7, 3, 40, 800);
    expect(p800).toBeGreaterThan(0.3);
    expect(p800).toBeLessThan(0.7);
    const p1600 = ncfCdf(533.3, 3, 40, 1600);
    expect(p1600).toBeGreaterThan(0.3);
    expect(p1600).toBeLessThan(0.7);
  });

  it('nctCdf handles very large df (1e6) accurately', () => {
    // SciPy: stats.nct.cdf(2.0, 1e6, 3.0) = 0.1586553749165622
    expect(nctCdf(2.0, 1_000_000, 3.0)).toBeCloseTo(0.1586553749165622, 4);
  });

  it('tInv, fInv, rangeInv expand dynamically beyond fixed caps and guard NaN', () => {
    // SciPy: t.ppf(0.9995, 1) = 636.6192487687897
    expect(tInv(0.9995, 1)).toBeCloseTo(636.6192487687897, 2);
    expect(Number.isNaN(tInv(NaN, 10))).toBe(true);
    // SciPy: f.ppf(0.999, 3, 1) = 540379.2016; f.ppf(0.9999, 3, 1) > 1e6
    expect(fInv(0.9999, 3, 1)).toBeGreaterThan(1e7);
    expect(Number.isNaN(fInv(NaN, 3, 10))).toBe(true);
    // SciPy: studentized_range.ppf(0.95, 3, 1) = 26.975529869499873
    expect(rangeInv(0.95, 3, 1)).toBeCloseTo(26.975529869499873, 1);
  });

  it('rangeCdf is accurate for df = 1 and df = 2 without singularity error', () => {
    // SciPy: studentized_range.cdf(5.0, 3, 1) = 0.73929215, cdf(5.0, 3, 2) = 0.87257660
    expect(rangeCdf(5.0, 3, 1)).toBeCloseTo(0.73929215, 2);
    expect(rangeCdf(5.0, 3, 2)).toBeCloseTo(0.8725766, 2);
  });
});

/* ── WO-3G-02 / ADD-02: Basic Statistics & QR Regression ────────────────── */

describe('WO-3G-02: stats.ts AD p-value, QR regress VIF, Tukey CLD', () => {
  it('adNormality gives p ~ 0.90+ (not 0) for strongly normal data with 0.14 < A* < 0.2', () => {
    // Nearly exact normal quantiles (n=20) -> A* around 0.15..0.19
    const normalSample = Array.from({ length: 20 }, (_, i) => normalInv((i + 0.5) / 20));
    const res = adNormality(normalSample);
    expect(res.adAdj).toBeLessThan(0.2);
    expect(res.p).toBeGreaterThan(0.85);
  });

  it('regress computes VIF in O(1) without recursion hang and matches valid rows', () => {
    // 15 predictors — old O(k!) recursion would take 15! calls; QR-based runs in <10ms
    const n = 50;
    const predictors = Array.from({ length: 15 }, (_, j) => ({
      name: `X${j + 1}`,
      values: Array.from({ length: n }, (__, i) => Math.sin((i + 1) * (j + 1) * 1.37) + 0.05 * i),
    }));
    const y: (number | null)[] = Array.from({ length: n }, (_, i) => (i === 0 ? null : 2 + 0.5 * predictors[0].values[i] - 0.3 * predictors[1].values[i] + 0.01 * i));
    const t0 = performance.now();
    const fit = regress(y, predictors);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(200);
    expect(fit.n).toBe(n - 1);
    for (const coef of fit.coefficients.slice(1)) {
      expect(coef.vif).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('groupingLetters produces overlapping multi-letter CLD (A, AB, B)', () => {
    // Means 10.0, 9.0, 8.0 with within-group SD ~ 0.8 (n=5):
    // G1 vs G2 not sig, G2 vs G3 not sig, G1 vs G3 sig -> A, AB, B
    const table = anovaOneWay([
      { label: 'G1', values: [9.2, 9.6, 10.0, 10.4, 10.8] },
      { label: 'G2', values: [8.2, 8.6, 9.0, 9.4, 9.8] },
      { label: 'G3', values: [7.2, 7.6, 8.0, 8.4, 8.8] },
    ]);
    const letters = groupingLetters(table, 0.95);
    const byLabel = new Map(letters.map((l) => [l.label, l.letter]));
    expect(byLabel.get('G1')).toBe('A');
    expect(byLabel.get('G2')).toBe('AB');
    expect(byLabel.get('G3')).toBe('B');
  });
});

/* ── WO-3G-03 / ADD-04: DOE / GLM / RSM / Error Pooling ───────────────── */

describe('WO-3G-03: Lenth PSE, GLM missing-y level filtering, RSM Square Block SS', () => {
  it('lenthPse computes Lenth (1989) d = m/3 and SME > ME', () => {
    const effects = [
      { term: 'A', effect: 0.2 },
      { term: 'B', effect: -0.3 },
      { term: 'C', effect: 0.5 },
      { term: 'AB', effect: -0.4 },
      { term: 'AC', effect: 0.1 },
      { term: 'BC', effect: 4.5 },
      { term: 'ABC', effect: -3.2 },
    ];
    const res = lenthPse(effects, { saturated: true, replicated: false });
    expect(res.available).toBe(true);
    const r = res.result!;
    expect(r.pseudoDf).toBeCloseTo(7 / 3, 6);
    expect(r.pse).toBeCloseTo(0.45, 6);
    expect(r.me).toBeCloseTo(1.693855, 2);
    expect(r.sme).toBeCloseTo(4.053738, 2);
    expect(r.sme).toBeGreaterThan(r.me);
  });

  it('fitGlm extracts categorical levels AFTER complete-case filtering', () => {
    // Level 'Z' only appears on a row where y is null
    const y: (number | null)[] = [10, 11, 20, 21, null];
    const f = { name: 'Group', kind: 'categorical' as const, values: ['A', 'A', 'B', 'B', 'Z'] };
    const fit = fitGlm(y, [f], [{ name: 'Group', factors: ['Group'] }]);
    // Only A and B exist in valid rows -> df = 1, grand mean = 15.5
    expect(fit.terms[0].df).toBe(1);
    expect(fit.beta[0]).toBeCloseTo(15.5, 6);
  });

  it('analyzeRsm Square block SS equals joint SSE_reduced - SSE_full (not sum of individual Type III SS)', () => {
    // 2-factor rotatable CCD with 5 center points
    const a = Math.SQRT2;
    const x1 = [-1, 1, -1, 1, -a, a, 0, 0, 0, 0, 0, 0, 0];
    const x2 = [-1, -1, 1, 1, 0, 0, -a, a, 0, 0, 0, 0, 0];
    const y = x1.map((u, i) => {
      const v = x2[i];
      return 10 + 2 * u - 1.5 * v - 3 * u * u - 2.5 * v * v + 1.2 * u * v + (i % 3) * 0.05;
    });
    const rsm = analyzeRsm(y, [
      { name: 'X1', kind: 'numeric', values: x1 },
      { name: 'X2', kind: 'numeric', values: x2 },
    ]);
    // Fit reduced model without square terms via fitGlm
    const factors = [
      { name: 'X1', kind: 'numeric' as const, values: x1 },
      { name: 'X2', kind: 'numeric' as const, values: x2 },
    ];
    const noSq = fitGlm(y, factors, [
      { name: 'X1', factors: ['X1'] },
      { name: 'X2', factors: ['X2'] },
      { name: 'X1×X2', factors: ['X1', 'X2'] },
    ]);
    const jointSquareSs = noSq.sse - rsm.glm.sse;
    expect(rsm.square.ss).toBeCloseTo(jointSquareSs, 6);
  });
});

/* ── WO-3G-04: Power & Sample Size ────────────────────────────────────── */

describe('WO-3G-04: power.ts ANOVA conservative NCP and input validation', () => {
  it('powerOfAnova matches Minitab/Montgomery conservative NCP = n*delta^2/(2*sd^2)', () => {
    // SciPy 1.18.1 reference: k=4, n=10, delta=1, sd=1, alpha=0.05 -> power=0.3991677230
    const p4 = powerAt({ method: 'anova', solveFor: 'power', n: 10, difference: 1, sd: 1, groups: 4, alpha: 0.05, alternative: 'two-sided' }, 10, 1);
    expect(p4).toBeCloseTo(0.399167723, 4);
    // k=6 -> 0.3289079342
    const p6 = powerAt({ method: 'anova', solveFor: 'power', n: 10, difference: 1, sd: 1, groups: 6, alpha: 0.05, alternative: 'two-sided' }, 10, 1);
    expect(p6).toBeCloseTo(0.3289079342, 4);
  });

  it('rejects negative sd in solvePower (operator precedence bug)', () => {
    expect(() =>
      solvePower({
        method: 'oneT',
        solveFor: 'n',
        power: 0.8,
        difference: 1,
        sd: -5,
        alpha: 0.05,
        alternative: 'two-sided',
      }),
    ).toThrow();
  });
});

/* ── WO-3G-05 / ADD-05: Reliability & Nonnormal ───────────────────────── */

describe('WO-3G-05: reliability.ts & nonnormal.ts scaling, Benard ranks, AD adjustment', () => {
  it('fitWeibull is scale-invariant for large cycle counts (t ~ 1e6) with high shape', () => {
    const base = [0.82, 0.91, 0.95, 0.98, 1.01, 1.04, 1.07, 1.12];
    const scaled = base.map((t) => t * 1e6);
    const f1 = fitWeibull(base.map((time) => ({ time, censored: false })));
    const f2 = fitWeibull(scaled.map((time) => ({ time, censored: false })));
    expect(Number.isFinite(f2.shape)).toBe(true);
    expect(f2.shape).toBeCloseTo(f1.shape, 3);
    expect(f2.scale / 1e6).toBeCloseTo(f1.scale, 3);
  });

  it('fitWeibull uses Benard median ranks for complete data (max F < 1)', () => {
    const data = [10, 20, 30, 40, 50].map((time) => ({ time, censored: false }));
    const fit = fitWeibull(data);
    // Benard: (i - 0.3) / (n + 0.4) -> for i=5, n=5: 4.7 / 5.4 = 0.87037
    const maxProb = Math.max(...fit.points.map((pt) => pt.f));
    expect(maxProb).toBeCloseTo(4.7 / 5.4, 4);
  });

  it('nonnormalCapability (weibull) in nonnormal.ts does not overflow on t ~ 1e7', () => {
    const scaled = [0.85, 0.92, 0.96, 1.0, 1.03, 1.08, 1.15].map((t) => t * 1e7);
    const { fit } = nonnormalCapability(scaled, 'weibull', { lsl: 5e6, usl: 1.5e7 });
    expect(Number.isFinite(fit.params.shape)).toBe(true);
    expect(fit.params.shape).toBeGreaterThan(5);
  });

  it('nonnormalCapability uses Normal AD adjustment for lognormal (not Weibull 1+0.2/sqrt(n))', () => {
    const data = [10, 12, 15, 18, 22, 27, 33, 41, 50, 62];
    const cap = nonnormalCapability(data, 'lognormal', { lsl: 5, usl: 100 });
    const expectedAdj = cap.fit.ad * (1 + 0.75 / data.length + 2.25 / (data.length * data.length));
    expect(cap.fit.adAdjusted).toBeCloseTo(expectedAdj, 6);
  });
});

/* ── WO-3G-06: Gage R&R ───────────────────────────────────────────────── */

describe('WO-3G-06: gagerr.ts negative variance clamping & nested df=0 guard', () => {
  it('clamps negative variance components consistently so %Contribution sums to 100%', () => {
    // Construct balanced crossed data where MS_PO < MS_E (negative interaction variance)
    const rows = [];
    const base = [10, 20, 30, 40, 50];
    for (let o = 0; o < 2; o += 1) {
      for (let p = 0; p < 5; p += 1) {
        rows.push({ part: `P${p + 1}`, operator: `O${o + 1}`, measurement: base[p] + (o === 0 ? 0.5 : -0.5) });
        rows.push({ part: `P${p + 1}`, operator: `O${o + 1}`, measurement: base[p] + (o === 0 ? -0.5 : 0.5) });
      }
    }
    const res = gageRR(rows, 'crossed', { poolInteraction: false });
    const grr = res.components.find((c) => c.name === 'grr')!;
    const part = res.components.find((c) => c.name === 'partToPart')!;
    expect(grr.variance).toBeGreaterThanOrEqual(0);
    expect(part.variance).toBeGreaterThanOrEqual(0);
    expect(grr.contribution + part.contribution).toBeCloseTo(100, 6);
  });

  it('guards nested Gage R&R when each operator has only 1 part (dfPartOp = 0)', () => {
    const rows = [
      { part: 'P1', operator: 'O1', measurement: 10 },
      { part: 'P1', operator: 'O1', measurement: 11 },
      { part: 'P2', operator: 'O2', measurement: 12 },
      { part: 'P2', operator: 'O2', measurement: 13 },
    ];
    expect(() => gageRR(rows, 'nested')).toThrow();
  });
});

/* ── WO-3G-07: SPC & Capability ───────────────────────────────────────── */

describe('WO-3G-07: spc.ts pChart sigmaWithin & capability.ts missing specs', () => {
  it('pChart sigmaWithin divides by mean subgroup size (totalSize / k)', () => {
    // 10 subgroups of size 100, 5 defects each -> pBar = 0.05, nBar = 100
    const defects = Array(10).fill(5);
    const sizes = Array(10).fill(100);
    const res = pChart(defects, sizes);
    const expected = Math.sqrt((0.05 * 0.95) / 100);
    expect(res.sigmaWithin).toBeCloseTo(expected, 8);
  });

  it('xbarRCharts uses size-weighted grand mean for variable subgroup sizes', () => {
    // Subgroup 1: [10, 10, 10, 10] (n=4, mean=10); Subgroup 2: [20, 20] (n=2, mean=20)
    // Weighted grand mean = (4*10 + 2*20) / 6 = 80/6 = 13.3333...
    const values: (number | null)[] = [10, 10, 10, 10, 20, 20, null, null];
    const res = xbarRCharts(values, 4);
    expect(res.panels[0].center).toBeCloseTo(80 / 6, 6);
  });

  it('capability returns NaN for PPM and sigmaLevel when neither LSL nor USL is given', () => {
    const res = capability([10, 10.1, 9.9, 10.2, 9.8]);
    expect(Number.isNaN(res.ppmOverall)).toBe(true);
    expect(Number.isNaN(res.sigmaLevel)).toBe(true);
  });
});

/* ── WO-3G-08: Response Optimizer ─────────────────────────────────────── */

describe('WO-3G-08: optimizer.ts multistart budget & infeasible guidance', () => {
  it('multistart reserves local refinement budget for 5 continuous factors', () => {
    const names = ['A', 'B', 'C', 'D', 'E'];
    const model: StoredModel = createStoredModel({
      format: 'sigrun-model',
      version: 1,
      kind: 'glm',
      response: { id: '', name: 'Y', kind: 'numeric' },
      predictors: names.map((name) => ({
        id: '',
        name,
        kind: 'numeric',
        coding: { mode: 'actual', center: 0, halfRange: 1 },
      })),
      terms: names.map((name) => ({ label: name, factors: [name] })),
      coefficients: [
        { label: 'Constant', value: 50, estimable: true },
        { label: 'A', value: 3, estimable: true },
        { label: 'B', value: 2, estimable: true },
        { label: 'C', value: -4, estimable: true },
        { label: 'D', value: 1, estimable: true },
        { label: 'E', value: 5, estimable: true },
      ],
      covariance: null,
      residual: null,
      dof: null,
      categoricalLevels: {},
      training: null,
      diagnostics: { r2: 1, r2adj: 1, r2pred: 1, s: 0, n: 12, aliased: [] },
      factorBounds: Object.fromEntries(names.map((name) => [name, { min: -1, max: 1 }])),
      source: { analysisId: 'test' },
    }, 'M5');
    const factorCfg = names.map((name) => ({
      name,
      kind: 'continuous' as const,
      lower: -1,
      upper: 1,
      step: 0.1,
      fixed: false,
      fixedValue: 0,
      levels: [],
    }));
    const respCfg = [{
      modelId: model.id,
      name: 'Y',
      goal: 'maximize' as const,
      lower: 35,
      target: 65,
      upper: 65,
      weight: 1,
      importance: 1,
    }];
    const out = optimize([model], respCfg, factorCfg, {
      method: 'multistart',
      gridPoints: 9,
      maxEvaluations: 5000,
      seed: 42,
    });
    expect(out.solutions.length).toBeGreaterThan(0);
    // True optimum is at (1, 1, -1, 1, 1) -> Y = 50 + 3 + 2 + 4 + 1 + 5 = 65 -> d = 1
    expect(out.solutions[0].composite).toBeGreaterThan(0.95);
    expect(out.evaluations).toBeLessThanOrEqual(5000);
  });
});
