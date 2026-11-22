/* ─────────────────────────────────────────────────────────────────────────
   QA-F-01 / QA-F-02 — regression tests for the two real defects the independent
   QA suite (qa/, run with `npm run qa:stats`) found on main 0bfe385.

   F-01  nctCdf evaluated u^(df−1)·e^{−u²/2} in the linear domain. The power
         overflowed a double for df ≳ 200 and the product Inf × 0 came back NaN,
         so every non-central-t power / sample-size request above roughly
         n = 100 (two-sample) answered NaN or "power.unreachable".
         Reference: SciPy stats.nct.cdf(1.969, 254, 4) = 1.3855584175787939e-09,
         statsmodels TTestIndPower().power(0.5, 128, 0.05) = 0.9785595156646403.

   F-02  the AD goodness-of-fit bootstrap drew a censoring INDICATOR with the
         observed censored share and then took min(life, c). Taking the minimum
         turned most of those draws back into failures — 32.2 failures per
         replicate where the sample has 25 — which made the null A* distribution
         far too small. With the empirical censoring-TIME mechanism a correct
         Weibull model was rejected at α = 0.05 in 0.7 % of 150 simulated
         samples; with the old mechanism, in 100 %. On the sample below the
         p-value moves from 0.0033 to 0.93.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import { nctCdf } from '../src/lib/dist';
import { powerAt, solvePower } from '../src/lib/power';
import { fitWeibull, type WeibullInput } from '../src/lib/reliability';

const TIMES = [237.733735, 101.678231, 80.65952, 113.498638, 89.107755, 68.341761, 147.146506, 196.75185,
  26.478001, 113.965034, 61.262843, 72.415012, 138.455672, 32.906257, 116.91362, 102.236478, 10.443534,
  153.077232, 24.454797, 42.788052, 40.883152, 145.044137, 116.195264, 192.118633, 20.943232, 140.724908,
  92.416659, 98.152856, 255.937156, 150.50417, 182.10655, 129.035642, 103.679303, 95.652462, 77.717001,
  189.668615, 128.550078, 120.355242, 79.933738, 229.404627];
const CENS = [1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 1];
const ROWS: WeibullInput[] = TIMES.map((time, i) => ({ time, censored: CENS[i] === 1 }));

describe('QA-F-01 noncentral-t tail above df ≈ 200', () => {
  it('returns the SciPy value instead of NaN', () => {
    const value = nctCdf(-1.969, 254, 4);
    expect(Number.isFinite(value)).toBe(true);
    // 800-step Simpson quadrature in the deep tail: absolute agreement to 1e-11
    // (the same atol/rtol class the QA suite uses for nct values).
    expect(Math.abs(value - 1.3855584175787939e-9)).toBeLessThan(1e-11);
  });

  it('keeps the small-df values unchanged', () => {
    // scipy: stats.nct.cdf(1.5, 10, 2.0) = 0.3047854473760421
    expect(Math.abs(nctCdf(1.5, 10, 2) - 0.3047854473760421)).toBeLessThan(1e-8);
  });

  it('gives a finite two-sample power at n = 128 (statsmodels 0.9785595156646403)', () => {
    const spec = { method: 'twoT' as const, solveFor: 'power' as const, difference: 0.5, sd: 1, alpha: 0.05, alternative: 'two-sided' as const };
    const power = powerAt(spec, 128, 0.5);
    expect(Number.isFinite(power)).toBe(true);
    expect(Math.abs(power - 0.9785595156646403) / 0.9785595156646403).toBeLessThan(1e-6);
  });

  it('solves the two-sample sample size (86 per group) instead of throwing', () => {
    const solution = solvePower({
      method: 'twoT', solveFor: 'n', difference: 0.5, sd: 1, alpha: 0.05, alternative: 'two-sided', power: 0.9,
    });
    expect(solution.n).toBe(86);
    expect(solution.power).toBeGreaterThanOrEqual(0.9);
  });

  it('stays finite for a one-sample power at n = 400', () => {
    const spec = { method: 'oneT' as const, solveFor: 'power' as const, difference: 0.4, sd: 1, alpha: 0.05, alternative: 'two-sided' as const };
    expect(Math.abs(powerAt(spec, 400, 0.4) - 0.9999999991315782)).toBeLessThan(1e-9);
  });
});

describe('QA-F-02 censored Weibull AD bootstrap', () => {
  it('does not reject a correct Weibull model (p ≈ 0.93, was 0.0033)', () => {
    const r = fitWeibull(ROWS);
    expect(r.failures).toBe(25);
    expect(r.adBasis).toBe('failures');
    // The observed A* is ~3.36 — large only because the failures-only statistic
    // is biased under censoring; the bootstrap has to reproduce that bias.
    expect(r.adAdjusted).toBeGreaterThan(3);
    expect(r.adBootstrapReps).toBe(300);
    expect(r.adBootstrapP).toBeGreaterThan(0.5);
    expect(r.adBootstrapP).toBeLessThan(1);
  });

  it('keeps the p-value stable and reproducible (fixed seed)', () => {
    const a = fitWeibull(ROWS).adBootstrapP;
    const b = fitWeibull(ROWS).adBootstrapP;
    expect(a).toBe(b);
  });

  it('reports no bootstrap p for complete data (tabulated critical values apply)', () => {
    const complete = fitWeibull(TIMES.map((time) => ({ time, censored: false })));
    expect(complete.adBasis).toBe('complete');
    expect(Number.isNaN(complete.adBootstrapP)).toBe(true);
  });
});
