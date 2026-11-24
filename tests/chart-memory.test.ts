import { describe, expect, it } from 'vitest';
import type { Block, ChartSpec } from '../src/types';
import { defaultChartConfig } from '../src/lib/chartConfig';
import { materializeRsm, fullChartConfig } from '../src/lib/chartConfigOps';
import {
  ChartConfigMemory,
  collectChartSlots,
  hasChartKind,
  restoreChartConfigs,
} from '../src/lib/chartMemory';

function scatterChart(title: string, config?: ChartSpec['config']): ChartSpec {
  return { kind: 'scatter', points: [{ x: 1, y: 2 }, { x: 2, y: 3 }], title, config };
}

function card(charts: ChartSpec[]): Block[] {
  return [{ type: 'chartgrid', charts: charts.map((chart) => ({ chart, title: chart.title ?? '' })) }];
}

describe('chart config memory — a re-run keeps the reader’s setup (WO-01/3)', () => {
  it('re-applies style, axis ranges and contour view to a fresh run', () => {
    const styled: ChartSpec = {
      kind: 'scatter',
      points: [{ x: 1, y: 2 }],
      title: 'Versus Fits',
      config: {
        appearance: { preset: 'dark', fontSize: 12 },
        xAxis: { min: 0, max: 10, majorInterval: 2, reverse: true },
        yAxis: { scale: 'log10', title: 'Residual' },
      },
    };
    const memory = new ChartConfigMemory();
    memory.remember('regression', [{ type: 'chart', chart: styled, caption: '@chart.versusFits' }]);

    const fresh = restoreChartConfigs(
      [{ type: 'chart', chart: scatterChart('Versus Fits'), caption: '@chart.versusFits' }],
      memory.get('regression'),
    );
    const config = (fresh.blocks[0] as Extract<Block, { type: 'chart' }>).chart.config;
    expect(config?.appearance?.preset).toBe('dark');
    expect(config?.xAxis).toMatchObject({ min: 0, max: 10, majorInterval: 2, reverse: true });
    expect(config?.yAxis?.scale).toBe('log10');
  });

  it('keeps an RSM factor pair, holdings and unit mode across a re-fit', () => {
    const model = {
      beta: [10, 1, 0.5, -0.5, 0.25, 1],
      labels: ['Constant', 'A', 'B', 'A×B', 'A²', 'B²'],
      factorNames: ['A', 'B'],
      designPoints: [],
      codedBounds: [{ min: -1, max: 1 }, { min: -1, max: 1 }],
      actualTransform: [{ center: 0, halfRange: 1, low: -1, high: 1 }, { center: 0, halfRange: 1, low: -1, high: 1 }],
      s: 1, r2: 0.9, n: 13,
    };
    const saved: ChartSpec = {
      kind: 'contour',
      xs: [0, 1], ys: [0, 1], z: [[1, 2], [3, 4]],
      rsmModel: model,
      config: {
        rsm: { xFactorIndex: 1, yFactorIndex: 0, unitMode: 'actual', holdingValues: { 2: 5 }, showOptimalPoint: true },
        contour: { resolution: 'high', renderMode: 'heatmap-discrete', colormap: 'viridis', levelCount: 6 },
      },
    };
    const memory = new ChartConfigMemory();
    memory.remember('rsmanalyze', [{ type: 'chart', chart: saved, caption: '@chart.contour' }]);

    const refit = restoreChartConfigs(
      [{ type: 'chart', chart: { ...saved, config: undefined }, caption: '@chart.contour' }],
      memory.get('rsmanalyze'),
    );
    const restored = (refit.blocks[0] as Extract<Block, { type: 'chart' }>).chart as Extract<ChartSpec, { kind: 'contour' }>;
    const config = fullChartConfig(restored);
    expect(config.rsm?.unitMode).toBe('actual');
    expect(config.rsm?.holdingValues).toEqual({ 2: 5 });
    expect(config.contour?.resolution).toBe('high');
    expect(config.contour?.levelCount).toBe(6);
    // Re-slicing from the model is deterministic: the same view gives the same grid.
    const again = materializeRsm(restored, config);
    expect(again.z).toEqual(materializeRsm({ ...restored, config }, config).z);
  });

  it('does nothing when no config was ever remembered', () => {
    const blocks: Block[] = [{ type: 'chart', chart: scatterChart('A'), caption: '@chart.a' }];
    const memory = new ChartConfigMemory();
    expect(memory.restore('unknown', blocks)).toBe(blocks);
    expect(restoreChartConfigs(blocks, undefined).blocks).toBe(blocks);
    expect(memory.size).toBe(0);
  });
});

describe('chart config memory — one chart cannot inherit another (WO-01/4)', () => {
  it('matches by identity, not by position, when a chart is inserted', () => {
    const first: ChartSpec = { ...scatterChart('Normal prob'), config: { appearance: { preset: 'dark' } } };
    const second: ChartSpec = { ...scatterChart('Versus fits'), config: { appearance: { preset: 'scientific' } } };
    const memory = new ChartConfigMemory();
    memory.remember('regression', card([first, second]));

    // A histogram is inserted at the front: positions shift, identities do not.
    const rerun = card([{ kind: 'histogram', values: [1, 2, 3], title: 'Residual histogram' }, scatterChart('Normal prob'), scatterChart('Versus fits')]);
    const restored = memory.restore('regression', rerun);
    const grid = restored[0] as Extract<Block, { type: 'chartgrid' }>;
    expect(grid.charts[0].chart.config).toBeUndefined();
    expect(grid.charts[1].chart.config?.appearance?.preset).toBe('dark');
    expect(grid.charts[2].chart.config?.appearance?.preset).toBe('scientific');
  });

  it('never hands the same remembered config to two charts', () => {
    const memory = new ChartConfigMemory();
    memory.remember('spc', card([{ ...scatterChart('I chart'), config: { appearance: { preset: 'dark' } } }]));
    const restored = restoreChartConfigs(card([scatterChart('I chart'), scatterChart('MR chart')]), memory.get('spc'));
    const grid = restored.blocks[0] as Extract<Block, { type: 'chartgrid' }>;
    expect(grid.charts[0].chart.config?.appearance?.preset).toBe('dark');
    // The second chart has its own identity and gets nothing from the first.
    expect(grid.charts[1].chart.config).toBeUndefined();
  });

  it('gives every card its own copy, so an edit cannot bleed into a sibling', () => {
    const memory = new ChartConfigMemory();
    memory.remember('capability', card([{ ...scatterChart('Capability'), config: { series: { perSeries: { 0: { color: '#111111' } } } } }]));

    const a = memory.restore('capability', card([scatterChart('Capability')]));
    const b = memory.restore('capability', card([scatterChart('Capability')]));
    const chartA = (a[0] as Extract<Block, { type: 'chartgrid' }>).charts[0].chart;
    const chartB = (b[0] as Extract<Block, { type: 'chartgrid' }>).charts[0].chart;
    expect(chartA.config).not.toBe(chartB.config);
    (chartA.config as { series: { perSeries: Record<number, { color: string }> } }).series.perSeries[0].color = '#ff0000';
    expect(chartB.config?.series?.perSeries?.[0]?.color).toBe('#111111');
    // The memory itself is untouched by an edit made on a restored copy.
    const again = memory.restore('capability', card([scatterChart('Capability')]));
    expect((again[0] as Extract<Block, { type: 'chartgrid' }>).charts[0].chart.config?.series?.perSeries?.[0]?.color).toBe('#111111');
  });

  it('separates analyses, so one analysis never styles another', () => {
    const memory = new ChartConfigMemory();
    memory.remember('regression', [{ type: 'chart', chart: { ...scatterChart('Plot'), config: { appearance: { preset: 'dark' } } } }]);
    const other = memory.restore('capability', [{ type: 'chart', chart: scatterChart('Plot') }]);
    expect((other[0] as Extract<Block, { type: 'chart' }>).chart.config).toBeUndefined();
  });

  it('lists chart slots with stable keys, twice for twins', () => {
    const slots = collectChartSlots(card([scatterChart('Same'), scatterChart('Same'), scatterChart('Other')]));
    expect(slots.map((slot) => slot.key)).toEqual([
      'scatter::Same#0',
      'scatter::Same#1',
      'scatter::Other#0',
    ]);
    expect(slots.map((slot) => slot.index)).toEqual([0, 1, 2]);
  });

  it('reports which charts still have no remembered config', () => {
    const saved = collectChartSlots(card([{ ...scatterChart('A'), config: { appearance: { preset: 'dark' } } }, { ...scatterChart('B'), config: { appearance: { preset: 'dark' } } }]));
    const result = restoreChartConfigs(card([scatterChart('A'), { kind: 'bar', items: [{ label: 'x', value: 1 }], title: 'B' }]), saved);
    expect(result.applied).toEqual(['scatter::A#0']);
    expect(result.unmatched).toEqual(['bar::B#0']);
  });

  it('answers whether an output holds a kind, for drawer routing', () => {
    const blocks = card([scatterChart('A')]);
    expect(hasChartKind(blocks, 'scatter')).toBe(true);
    expect(hasChartKind(blocks, 'contour')).toBe(false);
  });

  it('keeps the default config of a chart that carried none', () => {
    const memory = new ChartConfigMemory();
    memory.remember('desc', [{ type: 'chart', chart: { ...scatterChart('A'), config: { appearance: { preset: 'monochrome' } } } }]);
    const restored = memory.restore('desc', [{ type: 'chart', chart: scatterChart('A') }]);
    const chart = (restored[0] as Extract<Block, { type: 'chart' }>).chart;
    expect(fullChartConfig(chart).appearance?.preset).not.toBe(defaultChartConfig().appearance?.preset);
    expect(fullChartConfig(chart).appearance?.preset).toBe('monochrome');
  });
});
