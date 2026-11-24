import { describe, expect, it } from 'vitest';
import { regressionBands } from '../src/lib/stats';

/**
 * Reference values from Python statsmodels (OLS + get_prediction):
 *
 *   import numpy as np, statsmodels.api as sm
 *   x = np.array([1,2,3,4,5,6,7,8,9,10.])
 *   y = np.array([2.3,2.1,4.9,5.2,4.4,6.1,7.3,6.9,8.4,8.8])
 *   m = sm.OLS(y, sm.add_constant(x)).fit()
 *   m.get_prediction(np.array([[1., 5.5]])).summary_frame(alpha=0.05)
 *
 *   params 1.62, 0.73090909…   s 0.7115284444579341   R² 0.915838628996305   df 8
 *   x=1.0  fit 2.350909  CI [1.386530, 3.315288]  PI [0.447698, 4.254120]
 *   x=5.5  fit 5.640000  CI [5.121137, 6.158863]  PI [3.919128, 7.360872]
 *   x=10.0 fit 8.929091  CI [7.964712, 9.893470]  PI [7.025880, 10.832302]
 */
const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const y = [2.3, 2.1, 4.9, 5.2, 4.4, 6.1, 7.3, 6.9, 8.4, 8.8];

describe('regression confidence and prediction bands (WO-08)', () => {
  const bands = regressionBands(x, y, 0.95, 19);

  it('reproduces the statsmodels OLS fit', () => {
    expect(bands.intercept).toBeCloseTo(1.62, 10);
    expect(bands.slope).toBeCloseTo(0.7309090909090897, 10);
    expect(bands.s).toBeCloseTo(0.7115284444579341, 10);
    expect(bands.r2).toBeCloseTo(0.915838628996305, 10);
    expect(bands.df).toBe(8);
    expect(bands.tCrit).toBeCloseTo(2.3060041350333704, 9);
  });

  it('matches the mean confidence interval at the observed endpoints and centre', () => {
    const at = (value: number) => bands.mean.find((point) => Math.abs(point.x - value) < 1e-9)!;
    const one = at(1);
    expect(one.lo).toBeCloseTo(1.3865299596928895, 8);
    expect(one.hi).toBeCloseTo(3.31528822212529, 8);
    const five = at(5.5);
    expect(five.lo).toBeCloseTo(5.121137423224241, 8);
    expect(five.hi).toBeCloseTo(6.158862576775759, 8);
    const ten = at(10);
    expect(ten.lo).toBeCloseTo(7.964711777874709, 8);
    expect(ten.hi).toBeCloseTo(9.893470040307111, 8);
  });

  it('matches the individual prediction interval', () => {
    const at = (value: number) => bands.individual.find((point) => Math.abs(point.x - value) < 1e-9)!;
    expect(at(1).lo).toBeCloseTo(0.4476984235080481, 8);
    expect(at(1).hi).toBeCloseTo(4.254119758310131, 8);
    expect(at(5.5).lo).toBeCloseTo(3.919127515077835, 8);
    expect(at(5.5).hi).toBeCloseTo(7.360872484922164, 8);
    expect(at(10).lo).toBeCloseTo(7.025880241689868, 8);
    expect(at(10).hi).toBeCloseTo(10.832301576491952, 8);
  });

  it('keeps the prediction band wider everywhere and the mean band narrowest at x̄', () => {
    bands.mean.forEach((point, i) => {
      const individual = bands.individual[i];
      expect(individual.hi - individual.lo).toBeGreaterThan(point.hi - point.lo);
    });
    const width = (point: { lo: number; hi: number }) => point.hi - point.lo;
    const narrowest = bands.mean.reduce((best, point) => (width(point) < width(best) ? point : best), bands.mean[0]);
    expect(narrowest.x).toBeCloseTo(5.5, 9);
  });

  it('returns empty bands when the data cannot support a fit', () => {
    expect(regressionBands([1, 2], [2, 3]).mean).toHaveLength(0);
    expect(regressionBands([1, 1, 1], [2, 3, 4]).mean).toHaveLength(0);
    expect(regressionBands([1, 2, 3], [1, null, 3] as (number | null)[]).mean).toHaveLength(0);
  });

  it('drives the scatterplot bands end to end', async () => {
    const { renderChart } = await import('../src/lib/charts');
    const bandPoints = bands.mean;
    const svg = renderChart({
      kind: 'scatter',
      points: x.map((xv, i) => ({ x: xv, y: y[i] })),
      fit: { intercept: bands.intercept, slope: bands.slope },
      bands: { mean: bandPoints, individual: bands.individual },
      config: { scatter: { showMeanCi: true, showPredictionBand: true } },
    });
    expect((svg.match(/<polygon/g) ?? []).length).toBe(2);
    expect(svg).not.toContain('NaN');
  });
});
