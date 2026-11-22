/* ─────────────────────────────────────────────────────────────────────────
   QA-01 … QA-15 — regression suite for the GPT code review (P0 / P1 / GLM-DOE)
   Every expected number is an independent reference:

   · SciPy 1.18.1 / NumPy 2.5.4 — Weibull & lognormal censored MLE (Nelder–Mead
     on the full likelihood), Anderson–Darling with the fitted CDF, Kaplan–Meier,
     noncentral t and the normal-approximation power of proportions.
   · statsmodels 0.15.0 — anova_lm(typ=3) with C(factor, Sum) coding for the
     unbalanced designs.
   · Montgomery Table VI — A₂ / d₂ / d₃ / D₃ / D₄ used for the variable-limit
     Xbar-R check.

   The Python recipe for each block is kept beside the assertions.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import { fitGlm, type ModelFactor } from '../src/lib/glm';
import { gageRR, type GrrRow } from '../src/lib/gagerr';
import { fitNonnormal, nonnormalCapability } from '../src/lib/nonnormal';
import { solvePower } from '../src/lib/power';
import { fitLognormalReliability, fitWeibull } from '../src/lib/reliability';
import { capabilitySixpack } from '../src/lib/sixpack';
import { xbarRCharts } from '../src/lib/spc';
import { pairedT } from '../src/lib/stats';
import { csvToWorksheet } from '../src/lib/project';
import { rowsToWorksheet } from '../src/lib/xlsx';

/** Relative closeness — the right measure for powers of 1e-5 and of 0.5 alike.
 *  1e-5 absorbs the ~1e-7 absolute accuracy of the erf-based normal CDF. */
function expectRel(actual: number, expected: number, rel = 1e-5): void {
  expect(Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected))).toBeLessThan(rel);
}

/** Sub-α powers are ~1e-5; compare them on the absolute scale of the CDF. */
function expectTiny(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-7);
}

/* QA-02 / QA-03 shared sample: 20 failures + 5 right-censored times. */
const TIMES = [42, 58, 71, 84, 96, 103, 118, 126, 141, 155, 168, 183, 197, 214, 236, 258, 281, 305, 342, 388, 120, 175, 240, 300, 360];
const ROWS = TIMES.map((time, i) => ({ time, censored: i >= 20 }));
const COMPLETE = [24, 29, 31, 37, 41, 44, 48, 52, 58, 63, 71, 86, 94, 112, 133, 158, 196, 255, 342, 480];

describe('QA-01 Weibull complete data: MLE, AD from the FITTED CDF, band', () => {
  // python: stats.weibull_min.fit(COMPLETE, floc=0) → 1.1578632685145558, 124.89553167601156
  //   F = weibull_min.cdf(sorted, β, scale=η); A² = −n − Σ(2i−1)[lnF_i + ln(1−F_{n+1−i})]/n
  //   → A² 0.6898823579921505, A* = A²(1 + 0.2/√n) 0.7207348349711163
  it('computes AD against the fitted Weibull CDF, not the plotting positions', () => {
    const r = fitWeibull(COMPLETE.map((time) => ({ time, censored: false })));
    expect(r.shape).toBeCloseTo(1.1578632685145558, 6);
    expect(r.scale).toBeCloseTo(124.89553167601156, 4);
    expect(r.adBasis).toBe('complete');
    expect(r.ad).toBeCloseTo(0.6898823579921505, 6);
    expect(r.adAdjusted).toBeCloseTo(0.7207348349711163, 6);
    // 0.757 < A* would reject at 5 %; 0.7207 sits in the 5-10 % band.
    expect(r.band).toBe('between05and10');
    // The old bug (empirical plotting positions) returned A² ≈ 0.057, i.e. "fits".
    expect(r.ad).toBeGreaterThan(0.5);
  });

  it('keeps the MLE and the percentiles', () => {
    const r = fitWeibull(COMPLETE.map((time) => ({ time, censored: false })));
    expect(r.b10).toBeCloseTo(17.88434529364027, 3);
    expect(r.median).toBeCloseTo(91.00688405272258, 3);
    expect(r.failures).toBe(20);
    expect(r.censored).toBe(0);
  });
});

describe('QA-02 right-censored Weibull and lognormal fits', () => {
  // python: Nelder–Mead on the censored likelihood (scipy) →
  //   Weibull β 1.901153981956382, η 237.87201252347234
  //   AD (failures only, fitted CDF) 0.8596323687414404, A* 0.898076296984741
  //   KM max |F̂ − F| 0.07926395690832211 (5 % bound 1.36/√20 = 0.3041)
  //   Lognormal μ 5.195802731231856, σ 0.6678889614286794, median 180.51298806659767,
  //     logLik −124.82124603051233
  it('includes the censored observations in the Weibull MLE and reports the AD basis', () => {
    const r = fitWeibull(ROWS);
    expect(r.shape).toBeCloseTo(1.901153981956382, 6);
    expect(r.scale).toBeCloseTo(237.87201252347234, 3);
    expect(r.failures).toBe(20);
    expect(r.censored).toBe(5);
    expect(r.adBasis).toBe('failures');
    expect(r.ad).toBeCloseTo(0.8596323687414404, 6);
    expect(r.adAdjusted).toBeCloseTo(0.898076296984741, 6);
    expect(r.band).toBe('between01and05');
    expect(r.kmDev).toBeCloseTo(0.07926395690832211, 7);
    expect(r.kmCritical05).toBeCloseTo(1.36 / Math.sqrt(20), 10);
    expect(r.kmBand).toBe('above05');
  });

  it('fits the lognormal by censored MLE instead of dropping censored rows', () => {
    const r = fitLognormalReliability(ROWS);
    expect(r.mu).toBeCloseTo(5.195802731231856, 5);
    expect(r.sigma).toBeCloseTo(0.6678889614286794, 5);
    expect(r.median).toBeCloseTo(180.51298806659767, 3);
    expect(r.logLik).toBeCloseTo(-124.82124603051233, 3);
    expect(r.mttf).toBeCloseTo(225.61738179757296, 2);
    expect(r.failures).toBe(20);
    expect(r.censored).toBe(5);
    expect(r.censoredPct).toBeCloseTo(20, 10);
    expect(r.closedForm).toBe(false);
  });

  it('reduces to the closed-form complete-data lognormal MLE', () => {
    const r = fitLognormalReliability(TIMES.map((time) => ({ time, censored: false })));
    expect(r.closedForm).toBe(true);
    expect(r.mu).toBeCloseTo(5.098661798314366, 8);
    expect(r.sigma).toBeCloseTo(0.5807760500435688, 8);
    expect(r.logLik).toBeCloseTo(-149.35525697615935, 4);
  });

  it('handles a 60 % censored sample (10 failures / 15 censored)', () => {
    // python: Nelder–Mead on the censored likelihood, censoring from index 10
    //   Weibull β 1.1337223485199095, η 434.8062993103676, logLik −71.56117962096862
    //   Lognormal μ 5.722111169019644, σ 1.1711428020162806, logLik −70.23066645219411
    const high = TIMES.map((time, i) => ({ time, censored: i >= 10 }));
    const w = fitWeibull(high);
    expect(w.failures).toBe(10);
    expect(w.censored).toBe(15);
    expect(w.shape).toBeCloseTo(1.1337223485199095, 5);
    expect(w.scale).toBeCloseTo(434.8062993103676, 2);
    expect(w.adBasis).toBe('failures');
    const l = fitLognormalReliability(high);
    expect(l.censoredPct).toBeCloseTo(60, 10);
    expect(l.mu).toBeCloseTo(5.722111169019644, 4);
    expect(l.sigma).toBeCloseTo(1.1711428020162806, 5);
    expect(l.median).toBeCloseTo(305.54930874851453, 2);
    expect(l.logLik).toBeCloseTo(-70.23066645219411, 3);
  });
});

describe('QA-03 Weibull confidence level 90 / 95 / 99 %', () => {
  // python: observed information at the censored MLE, delta method on
  //   ln MTTF with ∂g/∂β = −ψ(1+1/β)/β² (digamma 0.06051539889523957,
  //   Var(ln MTTF) 0.013898578556928083, MTTF 211.0748072499697)
  //   90 % → [173.86813040434504, 256.2434768925224]
  //   95 % → [167.52759383455492, 265.94170689045177]
  //   99 % → [155.79520236914013, 285.96884613975004]
  it('widens the MTTF interval with the confidence level and matches SciPy', () => {
    const w90 = fitWeibull(ROWS, 0.9);
    const w95 = fitWeibull(ROWS, 0.95);
    const w99 = fitWeibull(ROWS, 0.99);
    expect(w90.mttfCi[0]).toBeCloseTo(173.86813040434504, 2);
    expect(w90.mttfCi[1]).toBeCloseTo(256.2434768925224, 2);
    expect(w95.mttfCi[0]).toBeCloseTo(167.52759383455492, 2);
    expect(w95.mttfCi[1]).toBeCloseTo(265.94170689045177, 2);
    expect(w99.mttfCi[0]).toBeCloseTo(155.79520236914013, 2);
    expect(w99.mttfCi[1]).toBeCloseTo(285.96884613975004, 2);
    const width = (r: { mttfCi: [number, number] }) => r.mttfCi[1] - r.mttfCi[0];
    expect(width(w90)).toBeLessThan(width(w95));
    expect(width(w95)).toBeLessThan(width(w99));
  });

  // python: Var(w) = β²cov.aa + dx²cov.bb − 2β·dx·cov.ba at x = ln 200 →
  //   95 % band [−0.7991202990921044, 0.1397415427176194]
  it('builds the probability-plot band with the full delta-method variance', () => {
    const r = fitWeibull(ROWS);
    const x = Math.log(200);
    const [lo, hi] = r.ciBand(x, 0.95);
    expect(lo).toBeCloseTo(-0.7991202990921044, 2);
    expect(hi).toBeCloseTo(0.1397415427176194, 2);
    // Centre line of the band is the fitted w(x).
    expect((lo + hi) / 2).toBeCloseTo(r.shape * (x - Math.log(r.scale)), 6);
    const [lo90, hi90] = r.ciBand(x, 0.9);
    const [lo99, hi99] = r.ciBand(x, 0.99);
    expect(hi90 - lo90).toBeLessThan(hi - lo);
    expect(hi - lo).toBeLessThan(hi99 - lo99);
    // band95 is the same curve at 95 %.
    expect(r.band95(x)[0]).toBeCloseTo(lo, 10);
  });
});

describe('QA-04 one-sided t keeps the effect direction', () => {
  // python: nct power, n=20, δ=0.5, σ=1, α=0.05
  //   greater 0.6951493382443412 · less 7.083752209514557e-05
  //   greater with δ=−0.5 → 7.083752209513516e-05
  it('reports power below α when the effect points the other way', () => {
    const greater = solvePower({ method: 'oneT', solveFor: 'power', n: 20, difference: 0.5, sd: 1, alpha: 0.05, alternative: 'greater' });
    expectRel(greater.power, 0.6951493382443412);
    const lessSame = solvePower({ method: 'oneT', solveFor: 'power', n: 20, difference: 0.5, sd: 1, alpha: 0.05, alternative: 'less' });
    expectRel(lessSame.power, 7.083752209514557e-05, 1e-3);
    expect(lessSame.power).toBeLessThan(0.05);
    const greaterOpposite = solvePower({ method: 'oneT', solveFor: 'power', n: 20, difference: -0.5, sd: 1, alpha: 0.05, alternative: 'greater' });
    expectTiny(greaterOpposite.power, 7.083752209513516e-05);
    const lessMirrored = solvePower({ method: 'oneT', solveFor: 'power', n: 20, difference: -0.5, sd: 1, alpha: 0.05, alternative: 'less' });
    expectRel(lessMirrored.power, 0.6951493382443412);
  });
});

describe('QA-05 two-sided proportions power sums both tails', () => {
  // python: 1 − Φ((z_{α/2}SE₀ − d)/SE_a) + Φ((−z_{α/2}SE₀ − d)/SE_a)
  //   oneProp n=100 p0=0.3 p_a=0.4: two-sided 0.5823854343613419, greater 0.6923848903103909,
  //                                  less 0.00017188842473614332
  //   twoProp n=200 0.5→0.6: two-sided 0.5201179041645299, greater 0.6432205704507108
  it('one-proportion: both tails, and the direction matters', () => {
    const two = solvePower({ method: 'oneProp', solveFor: 'power', n: 100, p1: 0.3, difference: 0.1, alpha: 0.05, alternative: 'two-sided' });
    expectRel(two.power, 0.5823854343613419);
    const greater = solvePower({ method: 'oneProp', solveFor: 'power', n: 100, p1: 0.3, difference: 0.1, alpha: 0.05, alternative: 'greater' });
    expectRel(greater.power, 0.6923848903103909);
    const less = solvePower({ method: 'oneProp', solveFor: 'power', n: 100, p1: 0.3, difference: 0.1, alpha: 0.05, alternative: 'less' });
    expectTiny(less.power, 0.00017188842473614332);
    // The one-sided (upper) formula alone would give 0.6924 for the two-sided case.
    expect(two.power).toBeLessThan(greater.power);
  });

  it('two-proportion: both tails', () => {
    const two = solvePower({ method: 'twoProp', solveFor: 'power', n: 200, p1: 0.5, p2: 0.6, alpha: 0.05, alternative: 'two-sided' });
    expectRel(two.power, 0.5201179041645299);
    const greater = solvePower({ method: 'twoProp', solveFor: 'power', n: 200, p1: 0.5, p2: 0.6, alpha: 0.05, alternative: 'greater' });
    expectRel(greater.power, 0.6432205704507108);
  });
});

describe('QA-06 unreachable power requests fail loudly', () => {
  // python: smallest n for twoProp 0.5→0.6 (greater) at 90 % = 423 (power 0.9005886996220601)
  it('throws power.unreachable instead of returning an arbitrary n', () => {
    expect(() => solvePower({ method: 'oneT', solveFor: 'n', difference: -0.5, sd: 1, power: 0.9, alpha: 0.05, alternative: 'greater' }))
      .toThrow('power.unreachable');
    expect(() => solvePower({ method: 'oneT', solveFor: 'n', difference: 0, sd: 1, power: 0.9, alpha: 0.05, alternative: 'two-sided' }))
      .toThrow('power.unreachable');
    // target below α can never be the power of a valid test
    expect(() => solvePower({ method: 'oneT', solveFor: 'n', difference: 0.5, sd: 1, power: 0.04, alpha: 0.05, alternative: 'two-sided' }))
      .toThrow('power.unreachable');
    // one-proportion difference outside (0, 1)
    expect(() => solvePower({ method: 'oneProp', solveFor: 'n', p1: 0.9, difference: 0.5, power: 0.9, alpha: 0.05, alternative: 'greater' }))
      .toThrow('power.unreachable');
  });

  it('still solves the reachable sample size exactly', () => {
    const solved = solvePower({ method: 'twoProp', solveFor: 'n', p1: 0.5, p2: 0.6, power: 0.9, alpha: 0.05, alternative: 'greater' });
    expect(solved.n).toBe(423);
    expect(solved.power).toBeCloseTo(0.9005886996220601, 6);
  });
});

describe('QA-07 Gage R&R needs repeat measurements', () => {
  const cells: Record<string, number[]> = {
    p1: [10.1], p2: [10.6], p3: [11.0],
  };
  it('rejects a crossed study with one replicate per cell', () => {
    const rows: GrrRow[] = [];
    Object.entries(cells).forEach(([part, values]) => {
      values.forEach((measurement) => ['Op1', 'Op2'].forEach((operator) => rows.push({ part, operator, measurement })));
    });
    expect(() => gageRR(rows, 'crossed')).toThrow('grr.needReplicates');
  });
});

describe('QA-08 nested Gage R&R balance', () => {
  function nestedRows(): GrrRow[] {
    const rows: GrrRow[] = [];
    // Op1 owns o1p1..o1p3, Op2 owns o2p1..o2p2 → different part counts per operator.
    [['o1p1', 'o1p2', 'o1p3'], ['o2p1', 'o2p2']].forEach((parts, op) => {
      parts.forEach((part) => {
        [10 + op, 10.2 + op].forEach((measurement) => rows.push({ part, operator: `Op${op + 1}`, measurement }));
      });
    });
    return rows;
  }

  it('refuses an unbalanced nested design instead of averaging counts', () => {
    expect(() => gageRR(nestedRows(), 'nested')).toThrow('grr.unbalancedNested');
  });

  it('refuses a part shared by two operators in a nested study', () => {
    const rows: GrrRow[] = [];
    ['p1', 'p2'].forEach((part) => {
      ['Op1', 'Op2'].forEach((operator) => {
        [10, 10.2].forEach((measurement) => rows.push({ part, operator, measurement }));
      });
    });
    expect(() => gageRR(rows, 'nested')).toThrow(/grr\.(unbalancedNested|nestedPartShared|needReplicates)/);
  });

  it('accepts a balanced nested design and keeps the negative-component policy additive', () => {
    const rows: GrrRow[] = [];
    [['p1', 'p2', 'p3'], ['p4', 'p5', 'p6']].forEach((parts, op) => {
      parts.forEach((part) => {
        [10 + op * 0.1, 10.3 + op * 0.1].forEach((measurement) => rows.push({ part, operator: `Op${op + 1}`, measurement }));
      });
    });
    const r = gageRR(rows, 'nested', { tolerance: 4 });
    expect(r.type).toBe('nested');
    expect(r.replicates).toBe(2);
    expect(r.parts).toBe(3);
    expect(r.operators).toBe(2);
    // Components stay additive: GRR + part-to-part = total.
    expect(r.grrVariance + (r.components.find((c) => c.name === 'partToPart')?.variance ?? 0)).toBeCloseTo(r.totalVariance, 10);
    expect(Array.isArray(r.negativeComponents)).toBe(true);
  });
});

describe('QA-09 Sixpack: chart and capability use the same subgroups', () => {
  // 36 observations · python: monkey-consistent data
  const data = Array.from({ length: 36 }, (_, i) => 10 + 0.1 * Math.sin(i / 2) + 0.05 * (i % 3));

  it('switches to Xbar-S above subgroup size 10 and shares the S̄/c₄ sigma', () => {
    const one = capabilitySixpack(data, { lsl: 9.6, usl: 10.4, subgroup: 1 });
    const two = capabilitySixpack(data, { lsl: 9.6, usl: 10.4, subgroup: 2 });
    const five = capabilitySixpack(data, { lsl: 9.6, usl: 10.4, subgroup: 5 });
    const ten = capabilitySixpack(data, { lsl: 9.6, usl: 10.4, subgroup: 10 });
    expect(one.chart).toBe('imr');
    expect(two.chart).toBe('xbar-r');
    expect(five.primary.key).toBe('xbar');
    expect(five.secondary.key).toBe('r');
    expect(ten.chart).toBe('xbar-r');
    // 11+ : Xbar-S, and the indices' within sigma IS the chart's s̄/c₄
    const eleven = capabilitySixpack(data, { lsl: 9.6, usl: 10.4, subgroup: 11 });
    const twelve = capabilitySixpack(data, { lsl: 9.6, usl: 10.4, subgroup: 12 });
    expect(eleven.chart).toBe('xbar-s');
    expect(twelve.chart).toBe('xbar-s');
    expect(twelve.secondary.key).toBe('s');
    // python: s̄ 0.08471973712716485, c̄₄ exponent → σ 0.08666454570397374 for n = 12
    expect(twelve.sigmaWithin).toBeCloseTo(0.08666454570397374, 8);
    expect(twelve.capability.sdWithin).toBeCloseTo(twelve.sigmaWithin, 12);
    expect(twelve.sdWithinFromChart).toBe(true);
    // three complete subgroups of 12
    expect(twelve.primary.points).toHaveLength(3);
    // python: n = 11 → σ 0.08480851350391294
    expect(eleven.sigmaWithin).toBeCloseTo(0.08480851350391294, 8);
  });
});

describe('QA-10 lognormal log-likelihood', () => {
  // python: scipy.stats.lognorm.logpdf(values, σ, scale=exp(μ)).sum() = −149.35525697615935
  const values = [42, 58, 71, 84, 96, 103, 118, 126, 141, 155, 168, 183, 197, 214, 236, 258, 281, 305, 342, 388, 120, 175, 240, 300, 360];
  it('sums −ln(σt) − ½ln2π − z²/2 (no ln(ln t) any more)', () => {
    const fit = fitNonnormal(values, 'lognormal');
    expect(fit.params.logLik).toBeCloseTo(-149.35525697615935, 4);
    expect(fit.params.scale).toBeCloseTo(5.098661798314366, 8);
    expect(fit.params.shape).toBeCloseTo(0.5807760500435688, 8);
    const manual = values.reduce((sum, t) => {
      const z = (Math.log(t) - fit.params.scale) / fit.params.shape;
      return sum + (-Math.log(fit.params.shape) - Math.log(t) - 0.5 * Math.log(2 * Math.PI) - 0.5 * z * z);
    }, 0);
    expect(fit.params.logLik).toBeCloseTo(manual, 8);
  });
});

describe('QA-11 non-positive values are reported, never dropped silently', () => {
  it('counts the excluded observations', () => {
    const fit = fitNonnormal([0, -1, 5, 6, 7, 8, 9, 10], 'weibull');
    expect(fit.excluded).toBe(2);
    expect(fit.n).toBe(6);
    const cap = nonnormalCapability([0, -1, 5, 6, 7, 8, 9, 10], 'weibull', { lsl: 2, usl: 12 });
    expect(cap.excluded).toBe(2);
    expect(cap.n).toBe(6);
  });

  it('errors out when nothing is positive', () => {
    expect(() => fitNonnormal([0, -1, -2, -3, -4, -5], 'lognormal')).toThrow('nonnormal.invalidData');
  });

  it('errors when fewer than 5 positive values remain', () => {
    expect(() => fitNonnormal([0, 0, 1, 2, 3, 4], 'gamma')).toThrow('res.insufficient');
  });
});

describe('QA-12 paired t: CI on the observed difference, test on μ₀', () => {
  it('gives t = 0, p = 1 and a CI centred on 3 when the difference equals μ₀', () => {
    const a = [13, 15, 17, 19];
    const b = [10, 12, 14, 16];
    const r = pairedT(a, b, 3);
    expect(r.difference).toBeCloseTo(3, 12);
    expect(r.differenceVsMu0).toBeCloseTo(0, 12);
    expect(r.t).toBe(0);
    expect(r.p).toBeCloseTo(1, 12);
    expect(r.ci[0]).toBeCloseTo(3, 12);
    expect(r.ci[1]).toBeCloseTo(3, 12);
  });

  it('centres the interval on the sample mean difference when μ₀ differs', () => {
    const a = [13, 15, 17, 19];
    const b = [10, 12, 14, 16];
    const r = pairedT(a, b, 0, 0.95, 'two-sided');
    expect(r.difference).toBeCloseTo(3, 12);
    expect((r.ci[0] + r.ci[1]) / 2).toBeCloseTo(3, 10);
    // t statistic still tests μ_d = 0 → (3 − 0)/se
    expect(r.t).toBeGreaterThan(1);
  });
});

describe('QA-13 Xbar-R with a missing value uses each subgroup’s own nᵢ', () => {
  // python: groups [10.1,10.4,9.9] (n=3), [10.3,10.0,10.5,10.1], [9.8,10.2,10.0,10.3],
  //   [10.4,10.1,10.2,10.6], [10.0,9.9,10.1,10.2]
  //   → grand 10.161666666666667, σ̂ 0.22952141428730014, R̄ 0.46058390092767215
  const values: (number | null)[] = [10.1, 10.4, 9.9, null, 10.3, 10.0, 10.5, 10.1, 9.8, 10.2, 10.0, 10.3, 10.4, 10.1, 10.2, 10.6, 10.0, 9.9, 10.1, 10.2];

  it('applies A₂(nᵢ), D₃(nᵢ) and D₄(nᵢ) point by point', () => {
    const r = xbarRCharts(values, 4);
    const xbar = r.panels[0];
    const rChart = r.panels[1];
    expect(xbar.center).toBeCloseTo(10.161666666666667, 10);
    expect(r.sigmaWithin).toBeCloseTo(0.22952141428730014, 10);
    expect(rChart.center).toBeCloseTo(0.46058390092767215, 10);
    expect(Array.isArray(xbar.ucl)).toBe(true);
    const ucl = xbar.ucl as number[];
    const lcl = xbar.lcl as number[];
    const rUcl = rChart.ucl as number[];
    expect(ucl[0]).toBeCloseTo(10.559209417637335, 8);
    expect(ucl[1]).toBeCloseTo(10.505948788097617, 8);
    expect(lcl[0]).toBeCloseTo(9.764123915695999, 8);
    expect(rUcl[0]).toBeCloseTo(1.0002042877957393, 8);
    expect(rUcl[1]).toBeCloseTo(1.0784380389840516, 8);
    // The n = 3 subgroup has its own (wider) Xbar limit.
    expect(ucl[0]).toBeGreaterThan(ucl[1]);
    expect(r.subgroupSummary?.missingSubgroups).toBe(1);
    expect(r.subgroupSummary?.varying).toBe(true);
  });

  it('reduces exactly to the classical table limits when every subgroup is full', () => {
    const full = [10.1, 10.4, 9.9, 10.2, 10.3, 10.0, 10.5, 10.1, 9.8, 10.2, 10.0, 10.3];
    const r = xbarRCharts(full, 4);
    const means = [10.15, 10.225, 10.075];
    const ranges = [0.5, 0.5, 0.5];
    const grand = means.reduce((a, b) => a + b, 0) / 3;
    const rBar = 0.5;
    const sigma = rBar / 2.059;
    expect(r.panels[0].center).toBeCloseTo(grand, 12);
    expect(r.panels[1].center).toBeCloseTo(rBar, 12);
    expect((r.panels[0].ucl as number[])[0]).toBeCloseTo(grand + 3 * sigma / 2, 10);
    expect((r.panels[1].ucl as number[])[0]).toBeCloseTo(2.282 * 2.059 * sigma, 10);
    expect(ranges.length).toBe(3);
  });
});

describe('QA-14 headerless CSV / Excel keeps row 1', () => {
  it('imports a headerless numeric CSV without losing the first row', () => {
    const ws = csvToWorksheet('10,20\n11,21\n12,22', 'NoHeader', { header: false });
    expect(ws.columns.map((c) => c.name)).toEqual(['C1', 'C2']);
    expect(ws.columns[0].values).toEqual([10, 11, 12]);
    expect(ws.columns[1].values).toEqual([20, 21, 22]);
  });

  it('keeps a headerless TEXT csv intact too', () => {
    const ws = csvToWorksheet('Red,1\nBlue,2\n', 'Text', { header: false });
    expect(ws.columns[0].values).toEqual(['Red', 'Blue']);
    expect(ws.columns[0].type).toBe('text');
  });

  it('uses the header row when the user says so', () => {
    const ws = csvToWorksheet('temp,press\n10,20\n11,21', 'Header', { header: true });
    expect(ws.columns.map((c) => c.name)).toEqual(['temp', 'press']);
    expect(ws.columns[0].values).toEqual([10, 11]);
  });

  it('applies the same choice to Excel rows', () => {
    const headerless = rowsToWorksheet([[1, 2], [3, 4]], 'X', { header: false });
    expect(headerless.columns.map((c) => c.name)).toEqual(['C1', 'C2']);
    expect(headerless.columns[0].values).toEqual([1, 3]);
    const headed = rowsToWorksheet([['A', 'B'], [1, 2]], 'Y', { header: true });
    expect(headed.columns.map((c) => c.name)).toEqual(['A', 'B']);
    expect(headed.columns[0].values).toEqual([1]);
  });

  it('classifies a mixed date + number column as text instead of losing the data', () => {
    const ws = rowsToWorksheet([['When'], [new Date(2024, 0, 2)], [3]], 'Mixed', { header: true });
    expect(ws.columns[0].type).toBe('text');
    expect(ws.columns[0].values).toEqual(['2024-01-02', 3]);
    const dates = rowsToWorksheet([['When'], [new Date(2024, 0, 2)], [new Date(2024, 0, 3)]], 'Dates', { header: true });
    expect(dates.columns[0].type).toBe('date');
  });
});

describe('QA-15 GLM Type III SS on an unbalanced 3-factor design (statsmodels Sum coding)', () => {
  // python:
  //   m = ols('y ~ C(A,Sum)*C(B,Sum)*C(D,Sum)').fit(); anova_lm(m, typ=3)
  //   A 14.490566037735727 · B 65.43396226414707 · D 22.64150943396482
  //   A×B 0.22641509433963977 · A×D 0.9056603773584617 · B×D 2.0377358490558732
  //   A×B×D 0.22641509433963009 · SSE 10.5 (df 10) · R² 0.9405099150141643
  const cells: Record<string, number[]> = {
    'a1|b1|c1': [10, 11],
    'a1|b1|c2': [12],
    'a1|b2|c1': [13, 14, 15],
    'a1|b2|c2': [16, 17],
    'a2|b1|c1': [11, 12, 13],
    'a2|b1|c2': [14],
    'a2|b2|c1': [15, 16],
    'a2|b2|c2': [18, 19, 20, 21],
  };

  function build(): { y: number[]; factors: ModelFactor[] } {
    const y: number[] = [];
    const a: string[] = [];
    const b: string[] = [];
    const c: string[] = [];
    Object.entries(cells).forEach(([key, values]) => {
      const [fa, fb, fc] = key.split('|');
      values.forEach((v) => {
        y.push(v);
        a.push(fa);
        b.push(fb);
        c.push(fc);
      });
    });
    return {
      y,
      factors: [
        { name: 'A', kind: 'categorical', values: a },
        { name: 'B', kind: 'categorical', values: b },
        { name: 'C', kind: 'categorical', values: c },
      ],
    };
  }

  it('reproduces the statsmodels typ=3 sums of squares', () => {
    const { y, factors } = build();
    const glm = fitGlm(y, factors, [
      { name: 'A', factors: ['A'] },
      { name: 'B', factors: ['B'] },
      { name: 'C', factors: ['C'] },
      { name: 'A×B', factors: ['A', 'B'] },
      { name: 'A×C', factors: ['A', 'C'] },
      { name: 'B×C', factors: ['B', 'C'] },
      { name: 'A×B×C', factors: ['A', 'B', 'C'] },
    ]);
    const ss = (name: string) => glm.terms.find((t) => t.name === name)?.ssAdj ?? NaN;
    expect(ss('A')).toBeCloseTo(14.490566037735727, 8);
    expect(ss('B')).toBeCloseTo(65.43396226414707, 8);
    expect(ss('C')).toBeCloseTo(22.64150943396482, 8);
    expect(ss('A×B')).toBeCloseTo(0.22641509433963977, 8);
    expect(ss('A×C')).toBeCloseTo(0.9056603773584617, 8);
    expect(ss('B×C')).toBeCloseTo(2.0377358490558732, 8);
    expect(ss('A×B×C')).toBeCloseTo(0.22641509433963009, 8);
    expect(glm.sse).toBeCloseTo(10.5, 9);
    expect(glm.dfe).toBe(10);
    expect(glm.r2).toBeCloseTo(0.9405099150141643, 9);
  });

  it('stays stable on a badly conditioned polynomial design (QR, not XᵀX)', () => {
    // Degree-5 polynomial on [0,1]: κ(X) ≈ 3.4e3, so κ(XᵀX) ≈ 1.1e7.
    // python: numpy.linalg.lstsq(column_stack([x**k for k in range(6)]), y) →
    //   3.0003732364599913, 2.005947207445532, 0.41852560258767424,
    //   0.2740216807817213, -0.3502054637098673, 0.15220672386758483
    const x = Array.from({ length: 30 }, (_, i) => i / 29);
    const y = x.map((v) => 3 + 2 * v + 0.5 * v * v + 0.001 * Math.sin(20 * v));
    const factors: ModelFactor[] = Array.from({ length: 6 }, (_, k) => ({
      name: `x${k}`,
      kind: 'numeric' as const,
      values: x.map((v) => v ** k),
    }));
    const terms = factors.slice(1).map((f) => ({ name: f.name, factors: [f.name] }));
    const glm = fitGlm(y, factors, terms);
    const expected = [3.0003732364599913, 2.005947207445532, 0.41852560258767424, 0.2740216807817213, -0.3502054637098673, 0.15220672386758483];
    expected.forEach((value, i) => expect(glm.beta[i]).toBeCloseTo(value, 8));
    expect(glm.rank).toBe(6);
    // The 0.001·sin(20x) ripple is not in the model, so SSE is tiny but not 0.
    expect(glm.sse).toBeLessThan(1e-4);
  });
});
