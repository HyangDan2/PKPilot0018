import { describe, expect, it } from 'vitest';
import { fInv, normalCdf, normalInv, rangeInv, tCdf, tInv } from '../src/lib/dist';
import { adNormality, anovaOneWay, groupingLetters, mean, pairedT, regress, stdev, summarize, tTest1, tTest2, tukeyHSD } from '../src/lib/stats';

describe('distributions', () => {
  it('normal CDF/quantile are inverses', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.959963985)).toBeCloseTo(0.975, 5);
    expect(normalInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalInv(0.5)).toBeCloseTo(0, 6);
  });

  it('matches Student-t table values', () => {
    expect(tCdf(2.228139, 10)).toBeCloseTo(0.975, 4);
    expect(tInv(0.975, 10)).toBeCloseTo(2.228139, 4);
    expect(tInv(0.95, 20)).toBeCloseTo(1.724718, 3);
    expect(tInv(0.975, 1)).toBeCloseTo(12.7062, 2);
  });

  it('matches F table values', () => {
    expect(fInv(0.95, 3, 20)).toBeCloseTo(3.0984, 3);
    expect(fInv(0.99, 2, 10)).toBeCloseTo(7.5594, 2);
  });

  it('matches Tukey studentized range quantiles', () => {
    expect(rangeInv(0.95, 3, 12)).toBeGreaterThan(3.6);
    expect(rangeInv(0.95, 3, 12)).toBeLessThan(3.95);
    expect(rangeInv(0.95, 3, 12)).toBeCloseTo(3.77, 1);
    expect(rangeInv(0.95, 4, 20)).toBeCloseTo(3.96, 1);
    expect(rangeInv(0.95, 3, 100000)).toBeCloseTo(3.314, 1);
  });
});

describe('descriptive statistics', () => {
  const data = [2, 4, 4, 4, 5, 5, 7, 9];
  it('computes the textbook summary', () => {
    const s = summarize(data);
    expect(s.n).toBe(8);
    expect(s.mean).toBe(5);
    expect(s.stdev).toBeCloseTo(2.13809, 4);
    expect(s.variance).toBeCloseTo(4.5714, 3);
    expect(s.median).toBe(4.5);
    expect(s.q1).toBeCloseTo(4, 5);
    expect(s.q3).toBeCloseTo(6.5, 5);
    expect(s.iqr).toBeCloseTo(2.5, 5);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
    expect(s.seMean).toBeCloseTo(0.7559, 3);
  });

  it('counts missing values as N*', () => {
    const s = summarize([1, null, 3, null]);
    expect(s.n).toBe(2);
    expect(s.nStar).toBe(2);
  });
});

describe('Anderson–Darling normality', () => {
  it('accepts a well-behaved normal sample', () => {
    const sample: number[] = [];
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 80; i += 1) {
      const u = rnd() || 0.5;
      const v = rnd() || 0.5;
      sample.push(50 + 5 * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
    }
    const ad = adNormality(sample);
    expect(ad.n).toBe(80);
    expect(ad.p).toBeGreaterThan(0.05);
  });

  it('rejects a strongly skewed sample', () => {
    const sample = Array.from({ length: 60 }, (_, i) => Math.exp(i / 8));
    const ad = adNormality(sample);
    expect(ad.p).toBeLessThan(0.05);
  });
});

describe('t tests', () => {
  it('1-sample t matches a hand calculation', () => {
    const result = tTest1([10, 11, 12, 13, 14], 10, 0.95);
    expect(result.mean).toBe(12);
    expect(result.se).toBeCloseTo(0.70711, 5);
    expect(result.t).toBeCloseTo(2.82843, 4);
    expect(result.df).toBe(4);
    expect(result.p).toBeCloseTo(0.0474, 3);
    expect(result.ci[0]).toBeCloseTo(10.0368, 3);
    expect(result.ci[1]).toBeCloseTo(13.9632, 3);
  });

  it('2-sample Welch and pooled agree on equal-sized, equal-variance samples', () => {
    const a = [10, 11, 12, 13, 14];
    const b = [15, 16, 17, 18, 19];
    const welch = tTest2(a, b, { welch: true });
    const pooled = tTest2(a, b, { welch: false });
    expect(welch.difference).toBe(-5);
    expect(welch.se).toBeCloseTo(1, 5);
    expect(welch.df).toBeCloseTo(8, 5);
    expect(welch.p).toBeCloseTo(0.00105, 4);
    expect(pooled.df).toBe(8);
    expect(pooled.p).toBeCloseTo(welch.p, 6);
  });

  it('paired t uses row-wise differences', () => {
    const result = pairedT([12, 14, 16, 18], [10, 11, 13, 15]);
    expect(result.n).toBe(4);
    expect(result.difference).toBeCloseTo(2.75, 6);
    expect(result.df).toBe(3);
    expect(result.t).toBeGreaterThan(3);
  });

  it('paired t subtracts the hypothesized difference μ₀', () => {
    const a = [12, 14, 16, 18];
    const b = [10, 11, 13, 15];
    const zero = pairedT(a, b);
    const one = pairedT(a, b, 1);
    expect(one.mu0).toBe(1);
    expect(one.difference).toBeCloseTo(zero.difference - 1, 8);
    expect(Math.abs(one.t)).toBeLessThan(Math.abs(zero.t));
    expect(one.ci[0]).toBeLessThan(one.difference);
    expect(one.ci[1]).toBeGreaterThan(one.difference);
  });

  it('paired t drops rows where either side is missing', () => {
    const result = pairedT([10, null, 12, 14], [1, 2, null, 3]);
    // Only rows 1 and 4 form a complete pair (10−1, 14−3).
    expect(result.n).toBe(2);
    expect(result.pairedCount).toBe(2);
    expect(result.mean).toBe(12);
    expect(result.meanB).toBe(2);
    expect(result.difference).toBe(10);
    expect(result.df).toBe(1);
  });

  it('paired t refuses to divide by zero on a single pair', () => {
    const result = pairedT([10, null], [1, null]);
    expect(result.n).toBe(1);
    expect(Number.isNaN(result.se)).toBe(true);
    expect(Number.isNaN(result.t)).toBe(true);
    expect(result.p).toBeNaN();
  });

  it('t tests stay finite-safe on constant and single-value columns', () => {
    const single = tTest1([5]);
    expect(single.n).toBe(1);
    expect(Number.isNaN(single.stdev)).toBe(true);
    expect(Number.isNaN(single.t)).toBe(true);
    const flat = tTest1([5, 5, 5, 5]);
    expect(flat.stdev).toBe(0);
    expect(Number.isNaN(flat.t)).toBe(true);
    expect(flat.ci[0]).not.toBe(Number.POSITIVE_INFINITY);
    const empty = summarize([]);
    expect(empty.n).toBe(0);
    expect(Number.isNaN(empty.mean)).toBe(true);
  });

  it('normality test refuses constant data instead of returning Infinity', () => {
    const ad = adNormality([5, 5, 5, 5, 5]);
    expect(ad.n).toBe(5);
    expect(Number.isNaN(ad.p)).toBe(true);
    expect(Number.isNaN(ad.ad)).toBe(true);
  });
});

describe('ANOVA and Tukey', () => {
  const groups = [
    { label: 'A', values: [1, 2, 3] },
    { label: 'B', values: [4, 5, 6] },
    { label: 'C', values: [7, 8, 9] },
  ];

  it('computes the ANOVA table', () => {
    const table = anovaOneWay(groups);
    expect(table.dfBetween).toBe(2);
    expect(table.dfWithin).toBe(6);
    expect(table.ssBetween).toBeCloseTo(54, 6);
    expect(table.ssWithin).toBeCloseTo(6, 6);
    expect(table.f).toBeCloseTo(27, 6);
    expect(table.p).toBeLessThan(0.01);
    expect(table.msWithin).toBeCloseTo(1, 6);
  });

  it('separates clearly different groups with Tukey letters', () => {
    const table = anovaOneWay(groups);
    const tukey = tukeyHSD(table);
    expect(tukey.pairs).toHaveLength(3);
    expect(tukey.pairs.every((pair) => pair.significant)).toBe(true);
    const letters = tukey.letters;
    expect(new Set(letters.map((l) => l.letter)).size).toBe(3);
    expect(groupingLetters(table)[0].mean).toBeCloseTo(8, 6);
  });

  it('keeps overlapping groups in one letter', () => {
    const overlap = [
      { label: 'A', values: [4, 5, 6, 5, 5] },
      { label: 'B', values: [5, 5, 6, 5, 4] },
    ];
    const letters = groupingLetters(anovaOneWay(overlap));
    expect(letters[0].letter).toBe(letters[1].letter);
  });
});

describe('regression', () => {
  it('recovers an exact line', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [5, 8, 11, 14, 17];
    const result = regress(y, [{ name: 'X', values: x }]);
    expect(result.coefficients[0].coef).toBeCloseTo(2, 6);
    expect(result.coefficients[1].coef).toBeCloseTo(3, 6);
    expect(result.r2).toBeCloseTo(1, 8);
    expect(result.coefficients[1].vif).toBeCloseTo(1, 6);
    expect(result.anova.dfReg).toBe(1);
    expect(result.anova.dfErr).toBe(3);
  });

  it('reports VIF above 1 for correlated predictors', () => {
    const x1 = [1, 2, 3, 4, 5, 6, 7, 8];
    const x2 = x1.map((v) => v + (v % 2 === 0 ? 0.1 : -0.1));
    const y = x1.map((v, i) => 2 * v + 3 * x2[i] + (i % 3));
    const result = regress(y, [{ name: 'X1', values: x1 }, { name: 'X2', values: x2 }]);
    expect(result.coefficients[2].vif).toBeGreaterThan(5);
    expect(result.coefficients).toHaveLength(3);
  });

  it('throws when there is not enough data', () => {
    expect(() => regress([1, 2], [{ name: 'X', values: [1, 2] }])).toThrow();
  });

  it('rejects a constant predictor with a readable code', () => {
    expect(() => regress([1, 2, 3, 4, 5], [{ name: 'X', values: [2, 2, 2, 2, 2] }])).toThrow('res.constantPredictor');
  });
});

describe('basic helpers', () => {
  it('mean and stdev behave', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(stdev([1, 2, 3])).toBeCloseTo(1, 8);
  });
});
