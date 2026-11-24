import { describe, expect, it } from 'vitest';
import {
  buildAxisMap,
  dateLabel,
  dateTickValues,
  filterScaleValues,
  insideBreak,
  mapScaleValue,
  minorTickValues,
  normalizeAxisBreak,
  ticksOutsideBreak,
  unmapScaleValue,
} from '../src/lib/axisAdvanced';
import { axisTicks, computeAxisTicks, renderChart } from '../src/lib/charts';
import { defaultAxisConfig, defaultChartConfig, mergeChartConfig } from '../src/lib/chartConfig';
import { sanitizeAxisConfig, sanitizeChartConfig } from '../src/lib/chartGuards';
import type { ChartSpec } from '../src/types';

const scatter: ChartSpec = {
  kind: 'scatter',
  points: Array.from({ length: 12 }, (_, i) => ({ x: i + 1, y: 10 + i * i })),
  xLabel: 'x',
  yLabel: 'y',
};

const baseAxis = () => ({ ...defaultAxisConfig() });

describe('axis scales (WO-08)', () => {
  it('maps and inverts every scale it offers', () => {
    const scales = ['linear', 'log10', 'ln', 'symlog', 'power'] as const;
    const values = [0.25, 1, 2, 7.5, 100, 1e-3, -3, -0.5];
    scales.forEach((scale) => {
      values.forEach((value) => {
        if ((scale === 'log10' || scale === 'ln') && value <= 0) {
          expect(Number.isNaN(mapScaleValue(value, scale))).toBe(true);
          return;
        }
        const mapped = mapScaleValue(value, scale, { power: 0.5, logConstant: 1 });
        const back = unmapScaleValue(mapped, scale, { power: 0.5, logConstant: 1 });
        expect(Number.isFinite(mapped)).toBe(true);
        expect(back).toBeCloseTo(value, 9);
      });
    });
  });

  it('keeps zero and negative values on a symmetrical log axis', () => {
    expect(mapScaleValue(0, 'symlog', { logConstant: 1 })).toBeCloseTo(0, 12);
    expect(mapScaleValue(-10, 'symlog', { logConstant: 1 })).toBeCloseTo(-Math.log10(11), 12);
    expect(mapScaleValue(10, 'symlog', { logConstant: 1 })).toBeCloseTo(Math.log10(11), 12);
    // A log axis has no place for them, and says so by returning NaN.
    expect(Number.isNaN(mapScaleValue(0, 'log10'))).toBe(true);
    expect(Number.isNaN(mapScaleValue(-1, 'ln'))).toBe(true);
  });

  it('drops non-positive values only on a logarithmic scale', () => {
    expect(filterScaleValues([-2, 0, 3, NaN], 'log10')).toEqual([3]);
    expect(filterScaleValues([-2, 0, 3], 'linear')).toEqual([-2, 0, 3]);
  });

  it('places a power axis tick at the transformed position, labelled with the data value', () => {
    // √scale on 0 … 100: nice values in the transformed space are 0, 4, 16, 36, 64, 100 …
    const ticks = computeAxisTicks(0, 100, { scale: 'power', power: 0.5, count: 5 }).ticks;
    const values = ticks.map((tick) => tick.value);
    expect(values.length).toBeGreaterThan(2);
    values.forEach((value) => expect(value).toBeGreaterThanOrEqual(0));
    const square = values.map((value) => Math.sqrt(value));
    // The transformed ticks are evenly spaced within rounding, which is what a
    // power scale is for: the reader sees more resolution near zero.
    const gaps = square.slice(1).map((value, i) => value - square[i]);
    const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    gaps.forEach((gap) => expect(Math.abs(gap - mean)).toBeLessThan(mean * 0.25));
  });

  it('labels natural-log ticks with the values a reader can recognise', () => {
    const ticks = computeAxisTicks(1, 22000, { scale: 'ln' }).ticks;
    expect(ticks.length).toBeGreaterThan(2);
    ticks.forEach((tick) => expect(tick.value).toBeGreaterThan(0));
    // Two natural decades: e^0, e^1 … appear as 1, 2.718 …, 7.389 …
    expect(ticks.some((tick) => Math.abs(tick.value - Math.E) < 0.01)).toBe(true);
  });
});

describe('tick selection (WO-08)', () => {
  it('honours an explicit tick count', () => {
    const cfg = { ...baseAxis(), tickCount: 3 };
    const ticks = axisTicks(0, 100, cfg, 5).ticks;
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it('uses the custom tick values exactly, ignoring values outside the range', () => {
    const cfg = { ...baseAxis(), tickValues: [0, 5, 12.5, 40] };
    const ticks = axisTicks(0, 20, cfg).ticks;
    expect(ticks.map((tick) => tick.value)).toEqual([0, 5, 12.5]);
  });

  it('divides each interval into the requested number of minor ticks', () => {
    const minor = minorTickValues([0, 10, 20], 4);
    expect(minor).toHaveLength(8);
    expect(minor.slice(0, 4)).toEqual([2, 4, 6, 8]);
    expect(minor.slice(4)).toEqual([12, 14, 16, 18]);
  });

  it('skips the interval that straddles a break', () => {
    const minor = minorTickValues([0, 10, 20, 30], 1, { from: 10.5, to: 19.5, size: 8 });
    expect(minor).not.toContain(15);
    expect(minor).toContain(5);
    expect(minor).toContain(25);
  });

  it('reads a date axis as calendar labels', () => {
    const cfg = { ...baseAxis(), dateAxis: { epoch: 0, unit: 'day' as const, format: 'date' as const } };
    // Day 0 is 1970-01-01, day 31 is 1970-02-01.
    const ticks = axisTicks(0, 60, cfg).ticks;
    expect(ticks[0].label).toBe('1970-01-01');
    ticks.forEach((tick) => expect(tick.label).toMatch(/^1970-0[12]-\d{2}$/));
    const monthStart = dateTickValues(0, 31, { epoch: 0, unit: 'day', format: 'date' }, 12);
    expect(monthStart.map((value) => dateLabel(value, { epoch: 0, unit: 'day', format: 'date' }))).toContain('1970-02-01');
    expect(dateLabel(31, { epoch: 0, unit: 'day', format: 'month-year' })).toBe('Feb 1970');
    expect(dateLabel(365, { epoch: 0, unit: 'day', format: 'year' })).toBe('1971');
  });

  it('keeps a bounded number of date labels', () => {
    const values = dateTickValues(0, 3650, { epoch: 0, unit: 'day', format: 'date' }, 12);
    expect(values.length).toBeLessThanOrEqual(12);
    expect(values.length).toBeGreaterThan(2);
  });
});

describe('broken axis (WO-08)', () => {
  const linear = (options: Parameters<typeof buildAxisMap>[3] = {}) =>
    buildAxisMap([0, 100], 'linear', [0, 400], { axisBreak: { from: 40, to: 60, size: 20 }, ...options });

  it('leaves a visible gap where the omitted stretch would be', () => {
    const map = linear();
    expect(map.breakBand).not.toBeNull();
    const band = map.breakBand!;
    expect(Math.abs(band.p1 - band.p0)).toBeCloseTo(20, 6);
    // Values on either side keep their own scale: 20 is half-way up the first
    // segment, 80 is half-way up the second.
    expect(map.toPixel(20)).toBeCloseTo((400 - 20) * (20 / 80), 6);
    expect(map.toPixel(80)).toBeCloseTo((400 - 20) * (60 / 80) + 20, 6);
  });

  it('never draws a value from inside the omitted stretch as if it belonged to a segment', () => {
    const map = linear();
    const band = map.breakBand!;
    const inside = map.toPixel(50);
    expect(inside).toBeGreaterThanOrEqual(Math.min(band.p0, band.p1) - 1e-9);
    expect(inside).toBeLessThanOrEqual(Math.max(band.p0, band.p1) + 1e-9);
    expect(insideBreak(50, { from: 40, to: 60, size: 20 })).toBe(true);
    expect(insideBreak(30, { from: 40, to: 60, size: 20 })).toBe(false);
  });

  it('inverts its own mapping (the pixel under the pointer is the value shown)', () => {
    const map = linear();
    const band = map.breakBand!;
    const lowHalf = map.toPixel(20);
    const highHalf = map.toPixel(80);
    expect(map.fromPixel(lowHalf)).toBeCloseTo(20, 6);
    expect(map.fromPixel(highHalf)).toBeCloseTo(80, 6);
    // A pixel inside the gap answers with the far edge of the omitted stretch.
    expect(map.fromPixel((band.p0 + band.p1) / 2)).toBeCloseTo(60, 6);
  });

  it('drops the ticks that fall inside the omitted stretch', () => {
    const ticks = [{ value: 20 }, { value: 40 }, { value: 50 }, { value: 60 }, { value: 80 }];
    expect(ticksOutsideBreak(ticks, { from: 40, to: 60, size: 20 }).map((tick) => tick.value)).toEqual([20, 40, 60, 80]);
  });

  it('refuses a break that describes nothing', () => {
    expect(normalizeAxisBreak({ from: 60, to: 40, size: 10 }, [0, 100])).toBeNull();
    expect(normalizeAxisBreak({ from: 0, to: 100, size: 10 }, [0, 100])).toBeNull();
    expect(normalizeAxisBreak({ from: 10, to: 20, size: 1 }, [0, 100])).toEqual({ from: 10, to: 20, size: 2 });
    expect(normalizeAxisBreak(null, [0, 100])).toBeNull();
  });

  it('draws the break marks and keeps the axis readable', () => {
    const config = mergeChartConfig(undefined, { xAxis: { min: 0, max: 100, axisBreak: { from: 40, to: 60, size: 14 } } });
    const svg = renderChart(scatter, { width: 560, config });
    expect(svg).toContain('data-chart-role="axis-break"');
    expect(svg).toContain('data-axis="x"');
  });
});

describe('axis guards (WO-08)', () => {
  it('rejects hostile tick, break and date values instead of drawing them', () => {
    const axis = sanitizeAxisConfig({
      tickCount: Number.NaN,
      tickValues: [1, Number.POSITIVE_INFINITY, 2, 2] as number[],
      minorTickCount: -4,
      axisBreak: { from: 10, to: 5, size: 4 },
      power: 0,
      logConstant: 0,
      tickLength: -3,
      dateAxis: { epoch: Number.NaN, unit: 'decade' as never, format: 'nope' as never },
      secondary: { title: 3 as never, unit: '', min: 10, max: 5, decimals: 99, showGrid: 'yes' as never },
    });
    expect(axis.tickCount).toBeNull();
    expect(axis.tickValues).toEqual([1, 2]);
    expect(axis.minorTickCount).toBe(1);
    expect(axis.axisBreak).toBeNull();
    expect(axis.power).toBe(0.05);
    expect(axis.logConstant).toBe(1);
    expect(axis.tickLength).toBe(0);
    expect(axis.dateAxis).toEqual({ epoch: 0, unit: 'day', format: 'date' });
    expect(axis.secondary).toEqual({ title: '', unit: '', min: 10, max: null, decimals: 12, showGrid: false });
  });

  it('keeps the new blocks when a whole config is sanitised', () => {
    const config = sanitizeChartConfig({ seriesAdvanced: { areaFill: true, errorBars: { kind: 'ci', conf: 0.99 } } });
    expect(config.seriesAdvanced?.areaFill).toBe(true);
    expect(config.seriesAdvanced?.errorBars?.kind).toBe('ci');
    expect(config.seriesAdvanced?.errorBars?.scope).toBe('point');
    expect(defaultChartConfig().seriesAdvanced?.errorBars?.kind).toBe('none');
  });
});
