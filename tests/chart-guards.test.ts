import { describe, expect, it } from 'vitest';
import { renderChart } from '../src/lib/charts';
import {
  GUARD_LIMITS,
  PRESET_IDS,
  hasNonFiniteConfig,
  resolveManualRange,
  sanitizeAxisConfig,
  sanitizeChartConfig,
  sanitizeContourConfig,
  sanitizeExportConfig,
} from '../src/lib/chartGuards';
import type { ChartConfig } from '../src/lib/chartConfig';
import { CHART_STYLE_IDS } from '../src/lib/chartStyles';
import type { ChartSpec } from '../src/types';

const scatter: ChartSpec = {
  kind: 'scatter',
  points: [{ x: 1, y: 2 }, { x: 2, y: 4.2 }, { x: 3, y: 6.1 }],
  fit: { intercept: 0.1, slope: 2 },
  xLabel: 'X',
  yLabel: 'Y',
};

function badNumbers(svg: string): string[] {
  const hits: string[] = [];
  ['NaN', 'Infinity', 'undefined', 'null'].forEach((needle) => {
    if (svg.includes(needle)) hits.push(needle);
  });
  return hits;
}

describe('axis range defence (WO-01/7)', () => {
  it('keeps its preset list identical to the style system', () => {
    expect([...PRESET_IDS].sort()).toEqual([...CHART_STYLE_IDS].sort());
  });
  it('refuses a reversed, equal or non-finite manual range', () => {
    expect(resolveManualRange(5, 1)).toEqual({ range: null, warning: expect.objectContaining({ code: 'range-reversed' }) });
    expect(resolveManualRange(3, 3).range).toBeNull();
    expect(resolveManualRange(Number.NaN, 10).range).toBeNull();
    expect(resolveManualRange(1, Number.POSITIVE_INFINITY).range).toBeNull();
    expect(resolveManualRange(null, null)).toEqual({ range: null });
    expect(resolveManualRange(1, 5).range).toEqual([1, 5]);
    expect(resolveManualRange(1, Number.NaN)).toEqual({ range: null });
  });

  it('drops an impossible range but keeps a half-specified one', () => {
    const reversed = sanitizeAxisConfig({ min: 10, max: 2 });
    expect(reversed.min).toBe(10);
    expect(reversed.max).toBe(2);
    // Both ends are kept so the drawer still shows what was typed, but the
    // renderer sees max <= min and falls back to the data extent.
    expect(hasNonFiniteConfig({ xAxis: { min: 10, max: 2 } })).toBe(false);
    const svg = renderChart(scatter, { config: { xAxis: { min: 10, max: 2 } } });
    expect(badNumbers(svg)).toEqual([]);
    expect(sanitizeAxisConfig({ min: Number.NaN, max: 10 }).min).toBeNull();
  });

  it('ignores a zero, negative or NaN tick interval and clamps the margin', () => {
    expect(sanitizeAxisConfig({ majorInterval: 0 }).majorInterval).toBeNull();
    expect(sanitizeAxisConfig({ majorInterval: -2 }).majorInterval).toBeNull();
    expect(sanitizeAxisConfig({ majorInterval: Number.NaN }).majorInterval).toBeNull();
    expect(sanitizeAxisConfig({ minorInterval: 0 }).minorInterval).toBeNull();
    expect(sanitizeAxisConfig({ axisMargin: Number.POSITIVE_INFINITY }).axisMargin).toBe(0.06);
    expect(sanitizeAxisConfig({ axisMargin: 3 }).axisMargin).toBe(GUARD_LIMITS.axisMargin[1]);
    expect(sanitizeAxisConfig({ decimals: 999 }).decimals).toBe(GUARD_LIMITS.decimals[1]);
    expect(sanitizeAxisConfig({ decimals: -1 }).decimals).toBe(0);
    expect(sanitizeAxisConfig({ scale: 'probit' as never }).scale).toBe('linear');
    expect(sanitizeAxisConfig({ tickDirection: 'sideways' as never }).tickDirection).toBe('out');
    expect(sanitizeAxisConfig({ crossAt: Number.NaN as never }).crossAt).toBe('auto');
  });
});

describe('contour option defence (WO-01/7)', () => {
  it('drops a reversed z window so the data range is drawn instead of a blank frame', () => {
    const config = sanitizeContourConfig({ zMin: 90, zMax: 60 });
    expect(config.zMin).toBeNull();
    expect(config.zMax).toBeNull();
    const grid = { xs: [0, 1], ys: [0, 1], z: [[0, 1], [2, 3]] };
    const spec = { kind: 'contour' as const, ...grid };
    const svg = renderChart(spec, { config: { contour: { zMin: 90, zMax: 60, levelCount: 4 } } });
    expect(badNumbers(svg)).toEqual([]);
    expect(svg).toContain('data-chart-role="chart-contour-band"');
  });

  it('replaces a NaN band count and unknown enum values', () => {
    expect(sanitizeContourConfig({ levelCount: Number.NaN }).levelCount).toBe(10);
    expect(sanitizeContourConfig({ levelCount: 9999 }).levelCount).toBe(50);
    expect(sanitizeContourConfig({ levelCount: 1 }).levelCount).toBe(2);
    expect(sanitizeContourConfig({ renderMode: 'sparkle' as never }).renderMode).toBe('filled-lines');
    expect(sanitizeContourConfig({ colormap: 'rainbow' as never }).colormap).toBe('sigrun-classic');
    expect(sanitizeContourConfig({ resolution: 'insane' as never }).resolution).toBe('standard');
    expect(sanitizeContourConfig({ levelInterval: 0 }).levelInterval).toBeNull();
    expect(sanitizeContourConfig({ customLevels: [Number.NaN, 5, 5, 3] }).customLevels).toEqual([3, 5]);
  });

  it('rejects spec limits that cross over and a non-positive tolerance', () => {
    const cfg = sanitizeContourConfig({ specLsl: 10, specUsl: 4, targetTolerance: -1 });
    expect(cfg.specLsl).toBeNull();
    expect(cfg.specUsl).toBeNull();
    expect(cfg.targetTolerance).toBeNull();
  });

  it('draws a contour whose grid is entirely NaN without inventing values', () => {
    const spec: ChartSpec = { kind: 'contour', xs: [0, 1], ys: [0, 1], z: [[Number.NaN, Number.NaN], [Number.NaN, Number.NaN]] };
    const svg = renderChart(spec);
    expect(badNumbers(svg)).toEqual([]);
    expect(svg.includes('chart-contour-band')).toBe(false);
  });
});

describe('export option defence (WO-01/7)', () => {
  it('falls back to a usable DPI and physical size', () => {
    expect(sanitizeExportConfig({ dpi: Number.NaN }).dpi).toBe(300);
    expect(sanitizeExportConfig({ dpi: 0 }).dpi).toBe(GUARD_LIMITS.dpi[0]);
    expect(sanitizeExportConfig({ dpi: 9000 }).dpi).toBe(GUARD_LIMITS.dpi[1]);
    expect(sanitizeExportConfig({ physicalWidth: 0 }).physicalWidth).toBe(GUARD_LIMITS.physicalSize[0]);
    expect(sanitizeExportConfig({ widthPx: -5 }).widthPx).toBe(0);
    expect(sanitizeExportConfig({ format: 'jpeg' as never }).format).toBe('svg');
    expect(sanitizeExportConfig({ background: 'pink' as never }).background).toBe('current');
  });
});

describe('hostile configuration end to end (WO-01/7)', () => {
  const hostile: ChartConfig = {
    appearance: { fontSize: Number.NaN, width: Number.POSITIVE_INFINITY, aspectRatio: 0, borderWidth: -3, preset: 'neon' as never },
    xAxis: { min: 5, max: 1, majorInterval: 0, axisMargin: Number.NaN, decimals: Number.NaN },
    yAxis: { scale: 'log10', min: -10, max: -1 },
    series: { lineWidth: Number.NaN, markerSize: Number.POSITIVE_INFINITY, fillOpacity: 4, palette: ['nonsense', '#123456'] },
    legend: { position: 'middle' as never, fontSize: Number.NaN },
    grid: { width: Number.NaN },
    export: { dpi: Number.NaN },
    referenceLines: [{ id: 'r', axis: 'y', value: Number.NaN, label: '', color: '', width: 1, dash: '', visible: true }],
  };

  it('sanitizes every block it is given', () => {
    const clean = sanitizeChartConfig(hostile);
    expect(clean.appearance?.fontSize).toBe(10.5);
    expect(clean.appearance?.width).toBe(560);
    expect(clean.appearance?.aspectRatio).toBe(GUARD_LIMITS.aspectRatio[0]);
    expect(clean.appearance?.preset).toBe('engineering');
    expect(clean.xAxis?.majorInterval).toBeNull();
    expect(clean.xAxis?.axisMargin).toBe(0.06);
    expect(clean.yAxis?.scale).toBe('log10');
    // The typed range survives (the drawer shows it) while the renderer ignores it.
    expect(clean.xAxis?.min).toBe(5);
    expect(clean.xAxis?.max).toBe(1);
    expect(clean.series?.palette).toEqual(['#123456']);
    expect(clean.legend?.position).toBe('top-right');
    expect(clean.referenceLines).toEqual([]);
    expect(hasNonFiniteConfig(hostile)).toBe(true);
    expect(hasNonFiniteConfig(clean)).toBe(false);
  });

  it('renders scatter, histogram, line and contour charts without NaN coordinates', () => {
    const specs: ChartSpec[] = [
      scatter,
      { kind: 'histogram', values: [1, 2, 2, 3, 5, 8], normal: true },
      { kind: 'line', series: [{ label: 'S1', points: [{ x: 0, y: 1 }, { x: 1, y: Number.NaN }, { x: 2, y: 3 }] }] },
      { kind: 'contour', xs: [0, 1, 2], ys: [0, 1, 2], z: [[0, 1, 2], [1, Number.NaN, 3], [2, 3, 4]] },
      { kind: 'boxplot', groups: [{ label: 'A', values: [1, 2, 3] }, { label: 'B', values: [Number.NaN, 4] }] },
    ];
    for (const spec of specs) {
      const svg = renderChart(spec, { config: hostile });
      expect(badNumbers(svg), `${spec.kind} produced a bad token`).toEqual([]);
      expect(svg.startsWith('<svg')).toBe(true);
    }
  });

  it('keeps every rendered coordinate finite', () => {
    const svg = renderChart(scatter, {
      config: { xAxis: { min: -1e308, max: 1e308, majorInterval: Number.POSITIVE_INFINITY }, yAxis: { majorInterval: 1e-320 } },
    });
    const numbers = [...svg.matchAll(/[\s<](?:x|y|cx|cy|x1|x2|y1|y2|width|height)="([^"]*)"/g)]
      .map((match) => match[1])
      .filter((value) => value !== '' && !value.includes('%'));
    numbers.forEach((value) => {
      const parts = value.split(/[\s,]+/).map(Number);
      parts.forEach((part) => {
        expect(Number.isFinite(part), `coordinate "${value}" is not finite`).toBe(true);
      });
    });
  });
});
