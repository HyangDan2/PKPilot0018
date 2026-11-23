import { describe, expect, it } from 'vitest';
import { defaultValues, findAnalysis, refList } from '../src/lib/analyses';
import { normalizeValues } from '../src/components/AnalysisDialog';
import { makeWorksheet } from '../src/lib/datasets';
import { regress } from '../src/lib/stats';
import type { Block, ChartSpec, Worksheet } from '../src/types';

/* Stage 2 — scatterplot with several Y and X variables.
   Every statistic is recomputed here with a plain OLS so the analysis is checked
   against an independent implementation, not against itself. */

const def = findAnalysis('scatter')!;

function run(sheet: Worksheet, values: Record<string, unknown>) {
  return def.run({ lang: 'en', sheet, values });
}

type Scatter = Extract<ChartSpec, { kind: 'scatter' }>;

function charts(blocks: Block[]): Scatter[] {
  const out: Scatter[] = [];
  blocks.forEach((block) => {
    if (block.type === 'chart' && block.chart.kind === 'scatter') out.push(block.chart);
    if (block.type === 'chartgrid') block.charts.forEach((item) => { if (item.chart.kind === 'scatter') out.push(item.chart); });
  });
  return out;
}

function tables(blocks: Block[]) {
  return blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table');
}

function texts(blocks: Block[]): string[] {
  return blocks.flatMap((b) => (b.type === 'text' ? b.lines : []));
}

/** Least squares on the rows where both values are numeric. */
function ols(xs: (number | null)[], ys: (number | null)[]) {
  const px: number[] = [];
  const py: number[] = [];
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    if (typeof x === 'number' && typeof y === 'number') {
      px.push(x);
      py.push(y);
    }
  }
  const mx = px.reduce((a, v) => a + v, 0) / px.length;
  const my = py.reduce((a, v) => a + v, 0) / py.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < px.length; i += 1) {
    sxy += (px[i] - mx) * (py[i] - my);
    sxx += (px[i] - mx) ** 2;
    syy += (py[i] - my) ** 2;
  }
  const slope = sxy / sxx;
  return { n: px.length, slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy), r2: (sxy * sxy) / (sxx * syy) };
}

const X1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const X2 = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
const X3: (number | null)[] = [2, 7, null, 8, 5, 11, 3, null, 4, 6, 1, 10];
const Y1: (number | null)[] = [4.2, 6.8, 9.1, 12.4, 14.3, 17.9, 19.2, 22.6, 25.4, 27.1, 30.9, 32.2];
const Y2: (number | null)[] = [10.1, 4.3, 13.2, 3.9, 16.8, 28.4, null, 19.1, 15.9, 10.8, 16.2, 25.5];
const GRP = ['A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B', 'A', 'B'];

function sheet(): Worksheet {
  return makeWorksheet('stage2', [
    { name: 'Feed', type: 'numeric', values: X1 },
    { name: 'Speed', type: 'numeric', values: X2 },
    { name: 'Temp', type: 'numeric', values: X3 },
    { name: 'Strength', type: 'numeric', values: Y1 },
    { name: 'Yield', type: 'numeric', values: Y2 },
    { name: 'Line', type: 'text', values: GRP },
  ]);
}

const st = (key: keyof typeof data) => data[key] as (number | null)[];

const data = { X1, X2, X3, Y1, Y2 };

describe('Stage 2 — scatterplot defaults and legacy input', () => {
  it('opens with the single-plot defaults and keeps a one-plot card shaped as before', () => {
    const values = defaultValues(def);
    expect(values.mode).toBe('each');
    expect(values.layout).toBe('individual');
    expect(values.fit).toBe(true);
    expect(values.stats).toBe(true);
    expect(values.y).toEqual([]);

    const result = run(sheet(), { y: 'C4', x: 'C1', by: [] });
    expect(result.blocks[0].type).toBe('chart');
    expect(charts(result.blocks)).toHaveLength(1);
    const table = tables(result.blocks)[0];
    expect(table.headers).toEqual(['R²', 'Pearson r', '@th.coef', '@th.p']);
    expect(table.rows[0][0]).toMatch(/%/);
    expect(texts(result.blocks)).toContain('n = 12');
  });

  it('treats a column id saved as a bare string as a one-variable list', () => {
    expect(refList({ y: 'C4', x: 'C1' }, 'y')).toEqual(['C4']);
    expect(refList({ y: ['C4', 'C5'] }, 'y')).toEqual(['C4', 'C5']);

    const legacy = run(sheet(), { y: 'C4', x: 'C1', by: [] });
    const modern = run(sheet(), { y: ['C4'], x: ['C1'], by: [], mode: 'each', layout: 'individual', fit: true, stats: true });
    expect(modern.blocks).toEqual(legacy.blocks);
    expect(modern.subtitle).toBe(legacy.subtitle);
  });

  it('reopens a saved single X-Y run with the columns as list chips', () => {
    // A project saved before Stage 2 stores y/x as plain strings; the dialog
    // turns them back into the list the new slots expect.
    const opened = normalizeValues(def, { y: 'C4', x: 'C1', by: [] });
    expect(opened.y).toEqual(['C4']);
    expect(opened.x).toEqual(['C1']);
    expect(opened.mode).toBe('each');
    expect(opened.layout).toBe('individual');

    const rerun = run(sheet(), opened);
    expect(rerun.blocks).toEqual(run(sheet(), { y: 'C4', x: 'C1', by: [] }).blocks);
  });
});

describe('Stage 2 — one Y against three X', () => {
  const result = run(sheet(), { y: ['C4'], x: ['C1', 'C2', 'C3'], by: [], mode: 'each', layout: 'individual', fit: true, stats: true });

  it('draws one chart per X and labels each one', () => {
    expect(charts(result.blocks)).toHaveLength(3);
    const captions = result.blocks.filter((b) => b.type === 'chart').map((b) => (b as { caption?: string }).caption);
    expect(captions).toEqual(['Strength vs Feed', 'Strength vs Speed', 'Strength vs Temp']);
  });

  it('selects the valid rows of every combination on its own', () => {
    const [feed, speed, temp] = charts(result.blocks);
    expect(feed.points).toHaveLength(12);
    expect(speed.points).toHaveLength(12);
    // Temp has two missing cells: that combination drops those rows only.
    expect(temp.points).toHaveLength(10);
    expect(texts(result.blocks)).toContain('n = 10 · N* = 2');
  });

  it('fits a simple regression for each pair, not a multiple regression', () => {
    const pairs: [keyof typeof data, keyof typeof data][] = [['Y1', 'X1'], ['Y1', 'X2'], ['Y1', 'X3']];
    charts(result.blocks).forEach((chart, i) => {
      const [yk, xk] = pairs[i];
      const expected = ols(st(xk), st(yk));
      expect(chart.fit!.slope).toBeCloseTo(expected.slope, 10);
      expect(chart.fit!.intercept).toBeCloseTo(expected.intercept, 10);
      expect(chart.points).toHaveLength(expected.n);
      expect(chart.notes?.[0]).toBe(`Pearson r = ${expected.r.toFixed(3)}`);
      expect(chart.notes?.[1]).toBe(`R² = ${(expected.r2 * 100).toFixed(1)}%`);
    });
    // A multiple regression on all three X is a different model; the plots must not use it.
    const multi = regress(Y1 as number[], [
      { name: 'Feed', values: X1 },
      { name: 'Speed', values: X2 },
      { name: 'Temp', values: X3.map((v) => v ?? 0) },
    ]);
    expect(charts(result.blocks)[0].fit!.slope).toBeCloseTo(ols(st('X1'), st('Y1')).slope, 10);
    expect(Math.abs(charts(result.blocks)[0].fit!.slope - multi.coefficients[1].coef)).toBeGreaterThan(1e-3);
  });

  it('can turn the line and the statistics off', () => {
    const plain = run(sheet(), { y: ['C4'], x: ['C1', 'C2'], by: [], layout: 'individual', fit: false, stats: false });
    expect(charts(plain.blocks).every((c) => c.fit === null)).toBe(true);
    expect(charts(plain.blocks).every((c) => c.notes === undefined)).toBe(true);
    expect(tables(plain.blocks)).toHaveLength(0);
  });
});

describe('Stage 2 — two Y against two X', () => {
  const result = run(sheet(), { y: ['C4', 'C5'], x: ['C1', 'C2'], by: [], mode: 'each', layout: 'individual' });

  it('draws four independent plots', () => {
    expect(charts(result.blocks)).toHaveLength(4);
    expect(tables(result.blocks)).toHaveLength(4);
  });

  it('keeps each combination’s own N and statistics', () => {
    const [, , , y2x2] = charts(result.blocks);
    const expected = ols(X2, Y2);
    expect(y2x2.points).toHaveLength(expected.n);
    expect(y2x2.fit!.slope).toBeCloseTo(expected.slope, 10);
    // Yield has one missing cell, so its pairs drop that row independently.
    expect(texts(result.blocks)).toContain('n = 11 · N* = 1');
  });
});

describe('Stage 2 — XY pairs mode', () => {
  it('pairs the k-th Y with the k-th X', () => {
    const result = run(sheet(), { y: ['C4', 'C5'], x: ['C1', 'C2'], by: [], mode: 'pairs', layout: 'individual' });
    expect(charts(result.blocks)).toHaveLength(2);
    const captions = result.blocks.filter((b) => b.type === 'chart').map((b) => (b as { caption?: string }).caption);
    expect(captions).toEqual(['Strength vs Feed', 'Yield vs Speed']);
  });

  it('refuses lists of different length', () => {
    expect(() => run(sheet(), { y: ['C4', 'C5'], x: ['C1', 'C2', 'C3'], by: [], mode: 'pairs' })).toThrow('res.scatterPairsCount');
  });
});

describe('Stage 2 — layout options', () => {
  it('prints a panel grid with one summary table', () => {
    const result = run(sheet(), { y: ['C4', 'C5'], x: ['C1', 'C2'], by: [], layout: 'panel' });
    const grid = result.blocks.find((b) => b.type === 'chartgrid') as Extract<Block, { type: 'chartgrid' }>;
    expect(grid.charts).toHaveLength(4);
    expect(grid.charts.map((c) => c.title)).toEqual([
      'Strength vs Feed', 'Strength vs Speed', 'Yield vs Feed', 'Yield vs Speed',
    ]);
    const summary = tables(result.blocks)[0];
    expect(summary.headers).toEqual(['@th.y', '@th.x', '@th.n', '@th.r', '@th.r2', '@th.equation', '@th.p']);
    expect(summary.rows).toHaveLength(4);
    expect(summary.rows[0][0]).toBe('Strength');
    expect(summary.rows[0][1]).toBe('Feed');
  });

  it('overlays every combination in one frame with a legend', () => {
    const result = run(sheet(), { y: ['C4', 'C5'], x: ['C1', 'C2'], by: [], layout: 'overlay' });
    const list = charts(result.blocks);
    expect(list).toHaveLength(1);
    expect(list[0].series).toHaveLength(4);
    expect(list[0].legend).toBe(true);
    expect(list[0].series!.map((s) => s.label)).toContain('Yield vs Speed');
    // Overlaid plots need one shared frame: the domain must hold every point.
    const all = list[0].series!.flatMap((s) => s.points);
    const [xLo, xHi] = list[0].xDomain!;
    expect(xLo).toBeLessThanOrEqual(Math.min(...all.map((p) => p.x)));
    expect(xHi).toBeGreaterThanOrEqual(Math.max(...all.map((p) => p.x)));
    expect(result.blocks.some((b) => b.type === 'chartgrid')).toBe(false);
  });

  it('shares one scale across panels only when asked', () => {
    const shared = run(sheet(), { y: ['C4', 'C5'], x: ['C1', 'C2'], by: [], layout: 'panel', commonX: true, commonY: true });
    const domains = charts(shared.blocks).map((c) => c.xDomain);
    expect(domains[0]).toBeDefined();
    expect(new Set(domains.map((d) => JSON.stringify(d))).size).toBe(1);

    const free = run(sheet(), { y: ['C4', 'C5'], x: ['C1', 'C2'], by: [], layout: 'panel' });
    expect(charts(free.blocks).every((c) => c.xDomain === undefined)).toBe(true);
  });
});

describe('Stage 2 — By groups', () => {
  it('colours the groups in first-appearance order and adds a legend', () => {
    const result = run(sheet(), { y: ['C4'], x: ['C1'], by: ['C6'], layout: 'individual' });
    const chart = charts(result.blocks)[0];
    expect(chart.groups).toEqual(['A', 'B']);
    expect(chart.points.map((p) => p.g)).toEqual(GRP);
    expect(chart.legend).toBe(true);
  });

  it('keeps group points while dropping rows where the pair is incomplete', () => {
    const result = run(sheet(), { y: ['C4'], x: ['C3'], by: ['C6'], layout: 'individual' });
    const chart = charts(result.blocks)[0];
    expect(chart.points).toHaveLength(10);
    expect(chart.points.some((p) => p.g === undefined)).toBe(false);
  });
});

describe('Stage 2 — awkward input', () => {
  it('names a text column instead of reporting too few points', () => {
    expect(() => run(sheet(), { y: ['C6'], x: ['C1'] })).toThrow(/^res\.numericOnly/);
    expect(() => run(sheet(), { y: ['C4'], x: ['C6'] })).toThrow(/^res\.numericOnly/);
  });

  it('drops a repeated column instead of drawing the same plot twice', () => {
    const result = run(sheet(), { y: ['C4', 'C4'], x: ['C1'], by: [] });
    expect(charts(result.blocks)).toHaveLength(1);
  });

  it('keeps the good combinations when one is unusable', () => {
    const flat = makeWorksheet('flat', [
      { name: 'Const', type: 'numeric', values: [5, 5, 5, 5, 5, 5] },
      { name: 'Ramp', type: 'numeric', values: [1, 2, 3, 4, 5, 6] },
      { name: 'Y', type: 'numeric', values: [2, 4, 7, 8, 11, 12] },
    ]);
    const result = run(flat, { y: ['C3'], x: ['C2', 'C1'], by: [], layout: 'individual' });
    expect(charts(result.blocks)).toHaveLength(1);
    expect(texts(result.blocks).join(' ')).toContain('Const');
    expect(texts(result.blocks).join(' ')).toContain('constant');
  });

  it('refuses a run where no combination can be plotted', () => {
    const flat = makeWorksheet('flat', [
      { name: 'Const', type: 'numeric', values: [5, 5, 5, 5] },
      { name: 'Y', type: 'numeric', values: [1, 2, 3, 4] },
    ]);
    expect(() => run(flat, { y: ['C2'], x: ['C1'] })).toThrow('res.constantPredictor');
  });

  it('requires both variable slots', () => {
    expect(() => run(sheet(), { y: [], x: ['C1'] })).toThrow('req.input');
    expect(() => run(sheet(), { y: ['C4'], x: [] })).toThrow('req.input');
  });

  it('refuses a wall of plots instead of freezing the tab', () => {
    const refs = ['C1', 'C2', 'C3', 'C4', 'C5'];   // 5 × 5 = 25 is fine
    expect(() => run(sheet(), { y: refs, x: refs })).not.toThrow();
    const wide = makeWorksheet('wide', Array.from({ length: 7 }, (_, i) => ({
      name: `X${i + 1}`,
      type: 'numeric' as const,
      values: Array.from({ length: 10 }, (_, r) => (r + 1) * (i + 1)),
    })));
    // 7 × 7 = 49 combinations is over the cap.
    expect(() => run(wide, { y: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'], x: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'] }))
      .toThrow(/^res\.scatterTooMany/);
  });

  it('ignores a By column that is not on the worksheet', () => {
    const result = run(sheet(), { y: ['C4'], x: ['C1'], by: ['C99'] });
    expect(charts(result.blocks)[0].groups).toBeUndefined();
  });
});
