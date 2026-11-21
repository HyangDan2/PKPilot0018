import { describe, expect, it } from 'vitest';
import { findAnalysis } from '../src/lib/analyses';
import { DATASETS, makeWorksheet } from '../src/lib/datasets';
import type { Block, Worksheet } from '../src/types';

function run(id: string, sheet: Worksheet, values: Record<string, unknown>) {
  const def = findAnalysis(id);
  if (!def) throw new Error(`missing analysis ${id}`);
  return def.run({ lang: 'en', sheet, values });
}

function tables(blocks: Block[]) {
  return blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table');
}

const process = DATASETS.find((d) => d.id === 'process')!.build();
const comparison = DATASETS.find((d) => d.id === 'comparison')!.build();
const reactor = DATASETS.find((d) => d.id === 'regression')!.build();

describe('analysis registry', () => {
  it('registers every documented analysis', () => {
    const ids = ['desc', 'normality', 't1', 't2', 'paired', 'anova', 'regression', 'imr', 'xbarr', 'pchart', 'capability', 'pareto', 'histogram', 'boxplot', 'scatter', 'timeseries', 'calculator', 'random', 'sort', 'standardize', 'recode'];
    ids.forEach((id) => expect(findAnalysis(id), id).toBeDefined());
  });
});

describe('descriptive statistics', () => {
  it('produces one row per variable and per By group', () => {
    const result = run('desc', process, { variables: ['C1'], by: ['C2'] });
    const [table] = tables(result.blocks);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0][0]).toBe('Thickness (mm)');
    expect(String(table.rows[0][1])).toMatch(/Line/);
    expect(table.headers).toContain('@th.mean');
    expect(result.blocks).toHaveLength(1);
  });
});

describe('hypothesis tests', () => {
  it('runs a 1-sample t with the dialog values', () => {
    const result = run('t1', process, { variable: 'C1', hypMean: '10.2', confidence: '95', alternative: 'two-sided', chart: true });
    const table = tables(result.blocks)[0];
    expect(table.rows[0][0]).toBe('60');
    expect(result.blocks.some((b) => b.type === 'chart')).toBe(true);
  });

  it('runs a paired t on before/after columns', () => {
    const result = run('paired', comparison, { first: 'C4', second: 'C5', testDiff: 0, confidence: 95, alternative: 'two-sided', chart: false });
    const table = tables(result.blocks)[0];
    expect(Number(table.rows[0][0])).toBe(40);
    expect(result.blocks.some((b) => b.type === 'text')).toBe(true);
  });

  it('runs a Welch 2-sample t', () => {
    const sheet = makeWorksheet('Two', [
      { name: 'A', type: 'numeric', values: [10, 11, 12, 13, 14] },
      { name: 'B', type: 'numeric', values: [15, 16, 17, 18, 19] },
    ]);
    const result = run('t2', sheet, { sample1: 'C1', sample2: 'C2', welch: true, confidence: 95, alternative: 'two-sided', chart: true });
    const [samples, diff] = tables(result.blocks);
    expect(samples.rows).toHaveLength(2);
    expect(diff.rows[0][0]).toBe('-5');
  });
});

describe('ANOVA', () => {
  it('returns the table, Tukey pairs and grouping letters', () => {
    const result = run('anova', process, { response: 'C1', factor: 'C2', confidence: 95 });
    const all = tables(result.blocks);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all[0].rows).toHaveLength(3);
    expect(all[2].rows.length).toBe(3);
    expect(result.blocks.some((b) => b.type === 'chartgrid')).toBe(true);
    expect(result.blocks.some((b) => b.type === 'text')).toBe(true);
  });
});

describe('regression', () => {
  it('fits the reactor model with VIF and four-in-one plots', () => {
    const result = run('regression', reactor, { response: 'C4', predictors: ['C1', 'C2', 'C3'], fourInOne: true });
    const [summary, coefficients, anova] = tables(result.blocks);
    expect(summary.rows.length).toBe(5);
    expect(coefficients.rows).toHaveLength(4);
    expect(anova.rows).toHaveLength(3);
    const grid = result.blocks.find((b) => b.type === 'chartgrid');
    expect(grid).toBeDefined();
    if (grid && grid.type === 'chartgrid') expect(grid.charts).toHaveLength(4);
  });
});

describe('control charts', () => {
  it('renders I-MR panels and a summary', () => {
    const result = run('imr', process, { variable: 'C1' });
    expect(result.blocks.filter((b) => b.type === 'chart')).toHaveLength(2);
    expect(tables(result.blocks)[0].rows).toHaveLength(2);
  });

  it('renders Xbar-R with a subgroup size', () => {
    const result = run('xbarr', process, { variable: 'C1', subgroup: '5' });
    expect(result.blocks.filter((b) => b.type === 'chart')).toHaveLength(2);
  });

  it('renders a P chart from defect counts', () => {
    const sheet = makeWorksheet('P', [
      { name: 'Defectives', type: 'numeric', values: [4, 6, 5, 7, 3, 6, 4, 5] },
      { name: 'Inspected', type: 'numeric', values: [100, 100, 100, 100, 100, 100, 100, 100] },
    ]);
    const result = run('pchart', sheet, { defects: 'C1', sizes: 'C2', sampleSize: '100' });
    expect(result.blocks.some((b) => b.type === 'chart')).toBe(true);
  });
});

describe('quality tools', () => {
  it('computes capability with limits', () => {
    const result = run('capability', process, { variable: 'C1', lsl: '9.4', usl: '10.9', target: '10.2', subgroup: '1' });
    const stats = tables(result.blocks)[1];
    const cp = Number(stats.rows[3][1]);
    expect(cp).toBeGreaterThan(0);
    expect(result.blocks.some((b) => b.type === 'chart')).toBe(true);
  });

  it('rejects capability without specification limits', () => {
    expect(() => run('capability', process, { variable: 'C1', lsl: '', usl: '', target: '', subgroup: 1 })).toThrow('res.needSpec');
  });

  it('orders the Pareto chart descending', () => {
    const result = run('pareto', process, { category: 'C4' });
    const table = tables(result.blocks)[0];
    const counts = table.rows.map((row) => Number(row[1]));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(table.rows[0][0]).toBe('Scratch');
  });
});

describe('graphs', () => {
  it('plots a histogram with summary statistics', () => {
    const result = run('histogram', process, { variable: 'C1', bins: '10', normal: true, lsl: '9.4', usl: '10.9', target: '' });
    expect(result.blocks[0].type).toBe('chart');
  });

  it('groups a boxplot by a By column', () => {
    const result = run('boxplot', process, { variables: ['C1'], by: ['C2'] });
    const table = tables(result.blocks)[0];
    expect(table.rows).toHaveLength(3);
  });

  it('fits a line through a scatterplot', () => {
    const result = run('scatter', reactor, { y: 'C4', x: 'C1', by: [] });
    const table = tables(result.blocks)[0];
    expect(table.rows[0][0]).toMatch(/%/);
  });

  it('plots a time series with specification limits', () => {
    const result = run('timeseries', process, { variable: 'C1', lsl: '9.4', usl: '10.9', target: '' });
    expect(result.blocks[0].type).toBe('chart');
  });
});

describe('worksheet transforms', () => {
  it('stores a calculator result in a new column', () => {
    const result = run('calculator', process, { formula: 'C1 * 2', storeIn: 'Twice' });
    expect(result.sheetPatch).toBeDefined();
    const added = result.sheetPatch!.columns.find((c) => c.name === 'Twice');
    expect(added).toBeDefined();
    expect(added!.values[0]).toBeCloseTo((process.columns[0].values[0] as number) * 2, 6);
  });

  it('generates reproducible random data', () => {
    const a = run('random', process, { distribution: 'normal', count: 20, mean: 0, sd: 1, min: 0, max: 10, seed: 7, storeIn: 'R1' });
    const b = run('random', process, { distribution: 'normal', count: 20, mean: 0, sd: 1, min: 0, max: 10, seed: 7, storeIn: 'R1' });
    expect(a.sheetPatch!.columns.at(-1)!.values).toEqual(b.sheetPatch!.columns.at(-1)!.values);
  });

  it('sorts rows and standardizes a column', () => {
    const sorted = run('sort', comparison, { column: 'C2', descending: true });
    const values = sorted.sheetPatch!.columns[1].values as number[];
    expect(values[0]).toBe(Math.max(...values));
    const standardized = run('standardize', comparison, { column: 'C2', storeIn: 'Z' });
    const z = standardized.sheetPatch!.columns.at(-1)!.values as number[];
    const raw = comparison.columns[1].values as number[];
    const m = raw.reduce((a, b) => a + b, 0) / raw.length;
    const sd = Math.sqrt(raw.reduce((a, b) => a + (b - m) ** 2, 0) / (raw.length - 1));
    expect(z[0]).toBeCloseTo((raw[0] - m) / sd, 8);
    expect(z.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 8);
  });
});
