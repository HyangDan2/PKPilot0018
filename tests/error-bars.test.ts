import { describe, expect, it } from 'vitest';
import { errorBarExtent, errorBarFor, errorBarLabel } from '../src/lib/seriesStats';
import { renderChart } from '../src/lib/charts';
import { mergeChartConfig } from '../src/lib/chartConfig';
import type { ChartSpec } from '../src/types';

/* Reference values come from SciPy:
     numpy.std([1,2,3,4,5], ddof=1)          = 1.5811388300841898
     scipy.stats.sem(...)                    = 0.7071067811865476
     scipy.stats.t.ppf(0.975, 4)             = 2.7764451051977987
   They are copied here rather than recomputed, so the test fails if the
   shipped definition drifts from the one the QA harness checks. */

const FIVE = [1, 2, 3, 4, 5];

describe('error-bar statistics (WO-08)', () => {
  it('computes the sample standard deviation with n − 1', () => {
    const stat = errorBarFor(FIVE, 'sd');
    expect(stat).not.toBeNull();
    expect(stat?.mean).toBeCloseTo(3, 12);
    expect(stat?.sd).toBeCloseTo(1.5811388300841898, 12);
    expect(stat?.half).toBeCloseTo(1.5811388300841898, 12);
    expect(stat?.lower).toBeCloseTo(3 - 1.5811388300841898, 12);
    expect(stat?.upper).toBeCloseTo(3 + 1.5811388300841898, 12);
  });

  it('computes the standard error as sd / √n', () => {
    const stat = errorBarFor(FIVE, 'se');
    expect(stat?.se).toBeCloseTo(0.7071067811865476, 12);
    expect(stat?.half).toBeCloseTo(0.7071067811865476, 12);
  });

  it('computes the two-sided Student-t confidence interval', () => {
    const stat = errorBarFor(FIVE, 'ci', 0.95);
    expect(stat?.tCrit).toBeCloseTo(2.7764451051977987, 9);
    expect(stat?.half).toBeCloseTo(1.9632431614775572, 10);
    expect(stat?.conf).toBe(0.95);
    expect(errorBarLabel(stat!, 'ci')).toContain('95%');
  });

  it('widens the interval when the confidence level rises', () => {
    const ninety = errorBarFor(FIVE, 'ci', 0.9)!.half;
    const ninetyNine = errorBarFor(FIVE, 'ci', 0.99)!.half;
    expect(ninetyNine).toBeGreaterThan(ninety);
  });

  it('returns no bar when the statistic cannot be computed', () => {
    expect(errorBarFor([4.2], 'sd')).toBeNull();
    expect(errorBarFor([], 'se')).toBeNull();
    expect(errorBarFor([1, Number.NaN, Number.POSITIVE_INFINITY], 'ci')).toBeNull();
    expect(errorBarFor([1, 2, 3], 'mean' as never)).toBeNull();
  });

  it('ignores non-finite values instead of counting them', () => {
    const stat = errorBarFor([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3, 4, 5], 'sd');
    expect(stat?.n).toBe(5);
    expect(stat?.sd).toBeCloseTo(1.5811388300841898, 12);
  });

  it('reports the extent the axis must cover', () => {
    const one = errorBarFor([10, 12, 14], 'sd')!;
    const two = errorBarFor([20, 22], 'se')!;
    const extent = errorBarExtent([one, two]);
    expect(extent?.min).toBeCloseTo(one.lower, 12);
    expect(extent?.max).toBeCloseTo(two.upper, 12);
    expect(errorBarExtent([])).toBeNull();
  });
});

describe('error bars on a chart (WO-08)', () => {
  const line: ChartSpec = {
    kind: 'line',
    series: [
      {
        label: 'Run',
        points: [
          { x: 1, y: 10, replicates: [9, 10, 11] },
          { x: 2, y: 14, replicates: [13, 14, 15] },
          { x: 3, y: 9 },
        ],
      },
    ],
  };

  it('draws a bar per point from its own replicates', () => {
    const config = mergeChartConfig(undefined, { seriesAdvanced: { errorBars: { kind: 'ci', scope: 'point', conf: 0.95, capWidth: 4 } } });
    const svg = renderChart(line, { width: 560, config });
    const bars = svg.match(/data-chart-role="error-bar"/g) ?? [];
    // The third point carries no replicates: it gets no bar, not a zero-width one.
    expect(bars).toHaveLength(2);
    expect(svg).toContain('data-stat="ci"');
    expect(svg).toContain('data-n="3"');
    expect(svg).toContain('data-chart-role="error-bar-cap"');
  });

  it('draws no bar at all when the statistic is off', () => {
    const svg = renderChart(line, { width: 560, config: mergeChartConfig(undefined, { seriesAdvanced: { errorBars: { kind: 'none' } } }) });
    expect(svg).not.toContain('data-chart-role="error-bar"');
  });

  it('uses the whole series when that basis is chosen', () => {
    const config = mergeChartConfig(undefined, { seriesAdvanced: { errorBars: { kind: 'sd', scope: 'series' } } });
    const svg = renderChart(line, { width: 560, config });
    const bars = svg.match(/data-chart-role="error-bar"/g) ?? [];
    expect(bars).toHaveLength(3);
    expect(svg).toContain('data-scope="series"');
  });

  it('grows the value axis so a bar is never clipped', () => {
    const tall = [1, 2, 3].map((x) => ({ x, y: 100, replicates: [0, 100, 200] }));
    const plain = renderChart({ kind: 'line', series: [{ label: 'a', points: tall.map((p) => ({ x: p.x, y: p.y })) }] }, { width: 560 });
    const withBars = renderChart(
      { kind: 'line', series: [{ label: 'a', points: tall }] },
      { width: 560, config: mergeChartConfig(undefined, { seriesAdvanced: { errorBars: { kind: 'sd' } } }) },
    );
    const axisMax = (svg: string) => Number(/data-y-max="([-\d.e]+)"/.exec(svg)?.[1] ?? '0');
    expect(axisMax(withBars)).toBeGreaterThan(axisMax(plain));
  });
});
