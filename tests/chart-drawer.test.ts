import { describe, expect, it } from 'vitest';
import { renderChart } from '../src/lib/charts';
import {
  ChartConfigHistory,
  allPairSurfaces,
  applyStylePack,
  factorPairCount,
  fullChartConfig,
  materializeRsm,
  packChartStyle,
  resetChartConfig,
  rsmViewIsExtrapolated,
  withChartConfig,
} from '../src/lib/chartConfigOps';
import { defaultChartConfig, mergeChartConfig } from '../src/lib/chartConfig';
import { bilinearAt, nearestPoint, probeContour } from '../src/lib/chartProbe';
import type { RsmModelPayload } from '../src/lib/doe';
import type { ChartSpec } from '../src/types';

const values = [10.1, 9.8, 10.3, 10.0, 9.9, 10.2, 10.4, 9.7, 10.1, 10.0];

const scatter: ChartSpec = {
  kind: 'scatter',
  points: values.map((v, i) => ({ x: i + 1, y: v })),
  fit: { intercept: 9.9, slope: 0.01 },
  title: 'Hardness',
};

function model3(): RsmModelPayload {
  // y = 10 + 2 A + 3 B + 1 C, coded ±1; B lives on 60…80.
  return {
    beta: [10, 2, 3, 1, 0, 0, 0, 0, 0, 0],
    labels: ['Constant', 'A', 'B', 'C', 'A²', 'B²', 'C²', 'A×B', 'A×C', 'B×C'],
    factorNames: ['A', 'B', 'C'],
    designPoints: [{ levels: [0, 0, 0], y: 10 }],
    codedBounds: [{ min: -1, max: 1 }, { min: -1, max: 1 }, { min: -1, max: 1 }],
    actualTransform: [
      { center: 0, halfRange: 1, low: -1, high: 1 },
      { center: 70, halfRange: 10, low: 60, high: 80 },
      { center: 0, halfRange: 1, low: -1, high: 1 },
    ],
  };
}

function contourWithModel(): ChartSpec {
  return {
    kind: 'contour',
    xs: [-1, 0, 1],
    ys: [-1, 0, 1],
    z: [[7, 8, 9], [9, 10, 11], [11, 12, 13]],
    rsmModel: model3(),
    config: defaultChartConfig(),
  };
}

describe('chart config operations (WO-02 / WO-09)', () => {
  it('fills a sparse chart config without losing the chart defaults', () => {
    const config = fullChartConfig({ ...scatter, config: { appearance: { preset: 'dark' } } });
    expect(config.appearance?.preset).toBe('dark');
    expect(config.xAxis?.axisMargin).toBe(0.06);
    expect(config.contour?.levelCount).toBe(10);
    expect(config.export?.dpi).toBe(300);
  });

  it('copies style between charts without their title or data', () => {
    const source: ChartSpec = {
      ...scatter,
      config: {
        appearance: { preset: 'dark', title: 'Source title', chartBg: '#0f172a', fontSize: 12 },
        series: { palette: ['#123456', '#654321'], lineWidth: 3 },
        legend: { position: 'right' },
        contour: { colormap: 'turbo' },
      },
    };
    const pack = packChartStyle(source);
    expect(JSON.stringify(pack)).not.toContain('Source title');
    const target: ChartSpec = { ...scatter, title: 'Target title', config: { appearance: { title: 'Target title' } } };
    const pasted = applyStylePack(target, pack);
    const cfg = fullChartConfig(pasted);
    expect(cfg.appearance?.title).toBe('Target title');
    expect(cfg.appearance?.preset).toBe('dark');
    expect(cfg.appearance?.chartBg).toBe('#0f172a');
    expect(cfg.series?.palette).toEqual(['#123456', '#654321']);
    expect(cfg.legend?.position).toBe('right');
    expect(cfg.contour?.colormap).toBe('turbo');
    expect(pasted.kind).toBe('scatter');
    expect((pasted as Extract<ChartSpec, { kind: 'scatter' }>).points).toHaveLength(values.length);
  });

  it('resets a chart to the default look but keeps its data', () => {
    const styled = withChartConfig<ChartSpec>({ ...scatter, config: { appearance: { preset: 'dark', chartBg: '#000000' } } }, {
      ...defaultChartConfig(),
      appearance: { preset: 'dark', chartBg: '#000000' },
      legend: { position: 'right' },
    });
    const reset = resetChartConfig(styled);
    expect(reset.kind).toBe('scatter');
    expect(fullChartConfig(reset).appearance?.preset).toBe('engineering');
    expect(fullChartConfig(reset).legend?.position).toBe('top-right');
    expect((reset as Extract<ChartSpec, { kind: 'scatter' }>).points).toHaveLength(values.length);
  });

  it('undoes and redoes a configuration session', () => {
    const history = new ChartConfigHistory(3);
    const a = defaultChartConfig('engineering');
    const b = mergeChartConfig(a, { appearance: { preset: 'dark' } });
    const c = mergeChartConfig(b, { legend: { position: 'bottom' } });
    history.push(a);
    history.push(b);
    expect(history.state()).toEqual({ canUndo: true, canRedo: false, size: 2 });
    const back = history.undo(c);
    expect(back?.appearance?.preset).toBe('dark');
    expect(back?.legend?.position).toBe('top-right');
    const forward = history.redo(back as typeof c);
    expect(forward?.legend?.position).toBe('bottom');
    history.push(a);
    expect(history.state().canRedo).toBe(false);
    expect(history.state().size).toBeLessThanOrEqual(3);
  });
});

describe('RSM re-slice (WO-02)', () => {
  it('redraws the surface from the fitted model without touching the data', () => {
    const chart = contourWithModel();
    const config = mergeChartConfig(chart.config, {
      rsm: { xFactorIndex: 0, yFactorIndex: 1, unitMode: 'actual', factorRanges: { 1: { min: 60, max: 80 } } },
      contour: { resolution: 'draft' },
    });
    const next = materializeRsm(chart, config);
    if (next.kind !== 'contour') throw new Error('kind');
    expect(next.xs).toHaveLength(41);
    expect(next.ys).toHaveLength(41);
    expect(next.ys[0]).toBeCloseTo(60, 6);
    expect(next.ys[40]).toBeCloseTo(80, 6);
    expect(next.xLabel).toBe('A');
    expect(next.yLabel).toBe('B');
    // z = 10 + 2A + 3B with C held at 0, in actual B units.
    const mid = 20;
    expect(next.z[0][mid]).toBeCloseTo(10 + 3 * -1, 4);
    expect(next.z[40][mid]).toBeCloseTo(10 + 3 * 1, 4);
    // The fitted payload is untouched: no re-fit happened.
    expect(next.kind === 'contour' ? next.rsmModel : undefined).toBe(chart.kind === 'contour' ? chart.rsmModel : undefined);
  });

  it('flags a view that reaches outside the experimental region', () => {
    const model = model3();
    expect(rsmViewIsExtrapolated(model, { xFactorIndex: 0, yFactorIndex: 1 })).toBe(false);
    expect(rsmViewIsExtrapolated(model, { xFactorIndex: 0, yFactorIndex: 1, unitMode: 'actual', factorRanges: { 1: { min: 50, max: 80 } } })).toBe(true);
    const outside: RsmModelPayload = { ...model, stationary: { point: [2, 0, 0], response: 1, eigenvalues: [1, 1, 1], kind: 'minimum', maxAbs: 2, outsideRegion: true } };
    expect(rsmViewIsExtrapolated(outside, {})).toBe(true);
  });

  it('lists every factor pair of the model', () => {
    const model = model3();
    expect(factorPairCount(model)).toBe(3);
    const surfaces = allPairSurfaces(model, { unitMode: 'coded' }, { resolution: 'draft' });
    expect(surfaces.map((surface) => `${surface.xName}×${surface.yName}`)).toEqual(['A×B', 'A×C', 'B×C']);
    surfaces.forEach((surface) => {
      expect(surface.grid.xs).toHaveLength(41);
      expect(surface.grid.z.flat().every((value) => Number.isFinite(value))).toBe(true);
    });
  });
});

describe('chart probing (WO-09)', () => {
  it('interpolates a contour grid between its nodes', () => {
    const xs = [0, 1, 2];
    const ys = [0, 1, 2];
    const z = [[0, 1, 2], [1, 2, 3], [2, 3, 4]];
    expect(bilinearAt(xs, ys, z, 0.5, 0.5)).toBeCloseTo(1, 9);
    expect(bilinearAt(xs, ys, z, 1.5, 0.5)).toBeCloseTo(2, 9);
    expect(bilinearAt(xs, ys, z, 5, 0.5)).toBeNull();
  });

  it('probes a rendered contour surface', () => {
    const chart: ChartSpec = {
      kind: 'contour',
      xs: [-1, 0, 1],
      ys: [-1, 0, 1],
      z: [[0, 1, 2], [1, 2, 3], [2, 3, 4]],
    };
    const probe = probeContour(chart, 0, 0);
    expect(probe?.z).toBeCloseTo(2, 9);
    expect(probeContour(chart, 4, 0)).toBeNull();
  });

  it('finds the plotted point closest to the pointer', () => {
    const points = [{ x: 1, y: 2 }, { x: 5, y: 5 }];
    expect(nearestPoint(points, 1.05, 2.02, { toleranceX: 0.2, toleranceY: 0.2 })).toEqual(points[0]);
    expect(nearestPoint(points, 3, 3, { toleranceX: 0.2, toleranceY: 0.2 })).toBeNull();
  });
});

describe('interactive role hooks (WO-09)', () => {
  it('exposes the plot box and corners for live coordinate mapping', () => {
    const svg = renderChart({
      kind: 'scatter',
      points: values.map((v, i) => ({ x: i + 1, y: v })),
      fit: { intercept: 9.9, slope: 0.01 },
    });
    const match = /<rect data-chart-role="plot" data-plot-box="([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)" data-x-min="([-\d.e]+)" data-x-max="([-\d.e]+)" data-y-min="([-\d.e]+)" data-y-max="([-\d.e]+)"/.exec(svg);
    expect(match).not.toBeNull();
    const [, bx, by, bw, bh, xMin, xMax, yMin, yMax] = (match ?? []).map(Number);
    expect(bw).toBeGreaterThan(100);
    expect(bh).toBeGreaterThan(80);
    expect(xMin).toBeLessThan(xMax);
    expect(yMin).toBeLessThan(yMax);
    expect(bx).toBeGreaterThanOrEqual(0);
    expect(by).toBeGreaterThanOrEqual(0);
  });

  it('marks every plotted point with data-point and its values', () => {
    const svg = renderChart({ kind: 'timeseries', values });
    expect((svg.match(/data-point="1"/g) ?? []).length).toBe(values.length);
    expect(svg).toContain('data-x="1"');
    expect(svg).toContain('data-y="10.1"');
  });

  it('names each region the drawer routes from', () => {
    const contour = renderChart({
      kind: 'contour',
      xs: [-1, 0, 1],
      ys: [-1, 0, 1],
      z: [[1, 2, 3], [2, 3, 4], [3, 4, 5]],
      title: 'RSM',
    });
    ['axis-x', 'axis-y', 'colorbar', 'title', 'plot'].forEach((role) => expect(contour).toContain(`data-chart-role="${role}"`));
    const grouped = renderChart({ kind: 'scatter', points: values.map((v, i) => ({ x: i, y: v, g: i % 2 ? 'B' : 'A' })), groups: ['A', 'B'], legend: true });
    expect(grouped).toContain('data-chart-role="legend"');
  });
});

describe('legend placement outside the data area (Phase 2)', () => {
  const grouped: ChartSpec = {
    kind: 'scatter',
    points: values.map((v, i) => ({ x: i + 1, y: v, g: i % 2 ? 'B' : 'A' })),
    groups: ['A', 'B'],
    legend: true,
  };

  function box(svg: string): { x: number; y: number; w: number; h: number } {
    const match = /data-plot-box="([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)"/.exec(svg);
    if (!match) throw new Error('plot box missing');
    return { x: Number(match[1]), y: Number(match[2]), w: Number(match[3]), h: Number(match[4]) };
  }

  function legendRect(svg: string): { x: number; y: number; w: number; h: number } {
    const group = /<g data-chart-role="legend">(<rect[^>]*>)/.exec(svg);
    if (!group) throw new Error('legend background missing');
    const attr = (name: string) => Number(new RegExp(`${name}="([-\\d.]+)"`).exec(group[1])?.[1]);
    return { x: attr('x'), y: attr('y'), w: attr('width'), h: attr('height') };
  }

  it('reserves a right-hand strip for a right legend', () => {
    const svg = renderChart({ ...grouped, config: { legend: { position: 'right' } } });
    const plot = box(svg);
    const legend = legendRect(svg);
    expect(legend.x).toBeGreaterThanOrEqual(plot.x + plot.w + 6);
    expect(legend.x + legend.w).toBeLessThanOrEqual(560);
  });

  it('reserves a bottom strip for a bottom legend', () => {
    const svg = renderChart({ ...grouped, config: { legend: { position: 'bottom' } } });
    const plot = box(svg);
    const legend = legendRect(svg);
    expect(legend.y).toBeGreaterThanOrEqual(plot.y + plot.h + 6);
    expect(legend.y + legend.h).toBeLessThanOrEqual(300);
  });

  it('keeps a top-right legend inside the plot but over an unused corner', () => {
    const svg = renderChart({ ...grouped, config: { legend: { position: 'top-right' } } });
    const plot = box(svg);
    const legend = legendRect(svg);
    expect(legend.x + legend.w).toBeLessThanOrEqual(plot.x + plot.w - 2);
    expect(legend.y).toBeGreaterThanOrEqual(plot.y);
  });

  it('draws no legend at all when it is switched off', () => {
    const svg = renderChart({ ...grouped, config: { legend: { visible: false } } });
    expect(svg).not.toContain('data-chart-role="legend"');
  });
});
