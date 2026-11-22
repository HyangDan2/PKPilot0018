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
    const [samples, diff] = tables(result.blocks);
    expect(samples.rows).toHaveLength(2);
    expect(diff.rows[0][0]).toBe('40');
    expect(result.blocks.some((b) => b.type === 'text')).toBe(true);
  });

  it('paired t applies the dialog test difference μ₀ and keeps option notes', () => {
    const zero = run('paired', comparison, { first: 'C4', second: 'C5', testDiff: 0, confidence: 95, alternative: 'two-sided', chart: false });
    const one = run('paired', comparison, { first: 'C4', second: 'C5', testDiff: 1, confidence: 95, alternative: 'two-sided', chart: false });
    const diffOf = (result: ReturnType<typeof run>) => Number(tables(result.blocks)[1].rows[0][1]);
    // Difference column = observed mean difference in BOTH runs; μ₀ changes t/p only.
    expect(diffOf(one)).toBeCloseTo(diffOf(zero), 6);
    const tOf = (result: ReturnType<typeof run>) => Math.abs(Number(tables(result.blocks)[1].rows[0][5]));
    expect(tOf(one)).toBeLessThan(tOf(zero));
    const method = one.blocks.find((b) => b.type === 'text');
    expect(method && method.type === 'text' ? method.lines.join(' ') : '').toContain('Test of μ_d: μ_d = 1');
  });

  it('paired t drops rows with a missing side and keeps the complete pairs', () => {
    const sheet = makeWorksheet('Pairs', [
      { name: 'Before', type: 'numeric', values: [10, null, 12, 14, null] },
      { name: 'After', type: 'numeric', values: [1, 2, null, 3, 5] },
    ]);
    const result = run('paired', sheet, { first: 'C1', second: 'C2', testDiff: 0, confidence: 95, alternative: 'two-sided', chart: false });
    const [samples, diff] = tables(result.blocks);
    expect(samples.rows[0][1]).toBe('2');
    expect(diff.rows[0][0]).toBe('2');
    expect(samples.caption).toBe('@res.pairedNote');
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

  it('passes the dialog confidence level into the Tukey comparisons', () => {
    const ninety = run('anova', process, { response: 'C1', factor: 'C2', confidence: 90 });
    const ninetyFive = run('anova', process, { response: 'C1', factor: 'C2', confidence: 95 });
    const titleOf = (result: ReturnType<typeof run>) => tables(result.blocks)[2].title ?? '';
    expect(titleOf(ninety)).toContain('90.0%');
    expect(titleOf(ninetyFive)).toContain('95.0%');
    const width = (result: ReturnType<typeof run>) => {
      const [low, high] = String(tables(result.blocks)[2].rows[0][3]).split('  ').map(Number);
      return high - low;
    };
    expect(width(ninety)).toBeLessThan(width(ninetyFive));
  });

  it('rejects a factor whose every group has a single value', () => {
    const sheet = makeWorksheet('Thin', [
      { name: 'Y', type: 'numeric', values: [1, 2, 3, 4] },
      { name: 'G', type: 'text', values: ['a', 'b', 'c', 'd'] },
    ]);
    expect(() => run('anova', sheet, { response: 'C1', factor: 'C2', confidence: 95 })).toThrow('res.groupTooSmall');
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

  it('notes how fixed row-order subgroups were handled', () => {
    const sheet = makeWorksheet('XbarR', [
      { name: 'Value', type: 'numeric', values: [10, 12, null, 16, 11, 13, 15, 17, 12, 14, 11, 13] },
    ]);
    const result = run('xbarr', sheet, { variable: 'C1', subgroup: '2' });
    const text = result.blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.lines.join(' ') : '')).join(' ');
    expect(text).toContain('Subgroups of 2 keep the original row order');
    expect(text).toContain('1 skipped');
  });

  it('refuses Xbar-R when no subgroup has two valid values', () => {
    const sheet = makeWorksheet('Empty X', [{ name: 'Value', type: 'numeric', values: [null, null, null, null, null, null] }]);
    expect(() => run('xbarr', sheet, { variable: 'C1', subgroup: '2' })).toThrow('res.insufficient');
  });

  it('renders a P chart from defect counts', () => {
    const sheet = makeWorksheet('P', [
      { name: 'Defectives', type: 'numeric', values: [4, 6, 5, 7, 3, 6, 4, 5] },
      { name: 'Inspected', type: 'numeric', values: [100, 100, 100, 100, 100, 100, 100, 100] },
    ]);
    const result = run('pchart', sheet, { defects: 'C1', sizes: 'C2', sampleSize: '100' });
    expect(result.blocks.some((b) => b.type === 'chart')).toBe(true);
  });

  it('names the offending P-chart row instead of dropping it', () => {
    const sheet = makeWorksheet('Bad P', [
      { name: 'Defectives', type: 'numeric', values: [4, 120, 5, 7] },
      { name: 'Inspected', type: 'numeric', values: [100, 100, 100, 100] },
    ]);
    expect(() => run('pchart', sheet, { defects: 'C1', sizes: 'C2', sampleSize: '100' })).toThrow(/Sample 2/);
  });

  it('pastes a constant sample size when no size column is chosen', () => {
    const sheet = makeWorksheet('Const P', [{ name: 'Defectives', type: 'numeric', values: [4, 6, 5, 7] }]);
    const result = run('pchart', sheet, { defects: 'C1', sizes: '', sampleSize: '100' });
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

  it('shows Cpm as a dash with a target hint, and never reports DPMO', () => {
    const result = run('capability', process, { variable: 'C1', lsl: '9.4', usl: '10.9', target: '', subgroup: 1 });
    const stats = tables(result.blocks)[1];
    const cpmRow = stats.rows.find((row) => row[0] === 'Cpm');
    expect(cpmRow?.[1]).toBe('—');
    const labels = tables(result.blocks).flatMap((table) => table.rows.map((row) => String(row[0])));
    expect(labels.some((label) => /DPMO/i.test(label))).toBe(false);
    expect(labels.filter((label) => /PPM/.test(label)).length).toBeGreaterThanOrEqual(3);
    const notes = result.blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.lines.join(' ') : '')).join(' ');
    expect(notes).toContain('Target required for Cpm');
  });

  it('names the selected sigma-level method in the statistics table', () => {
    const labelsFor = (sigmaMethod: string) => {
      const result = run('capability', process, { variable: 'C1', lsl: '9.4', usl: '10.9', target: '10.2', sigmaMethod, subgroup: 1 });
      const stats = tables(result.blocks)[1];
      return { label: String(stats.rows[stats.rows.length - 1][0]), value: Number(stats.rows[stats.rows.length - 1][1]), cpk: Number(stats.rows[4][1]) };
    };
    const cpk = labelsFor('cpk_shift');
    expect(cpk.label).toBe('Sigma level (3×Cpk + 1.5)');
    expect(cpk.value).toBeCloseTo(3 * cpk.cpk + 1.5, 2);
    expect(labelsFor('z_bench').label).toBe('Sigma level (Z.bench, 0σ shift)');
    expect(labelsFor('z_bench_shift').label).toBe('Sigma level (Z.bench + 1.5σ)');
    expect(labelsFor('z_bench_shift').value).toBeCloseTo(labelsFor('z_bench').value + 1.5, 2);
  });

  it('explains a one-sided specification instead of printing NaN', () => {
    const result = run('capability', process, { variable: 'C1', lsl: '', usl: '10.9', target: '', subgroup: 1 });
    const stats = tables(result.blocks)[1];
    const cpk = stats.rows.find((row) => row[0] === 'Cpk');
    expect(cpk?.[1]).not.toBe('—');
    const notes = result.blocks.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.lines.join(' ') : '')).join(' ');
    expect(notes).toContain('With a single specification limit');
    expect(result.blocks.some((b) => b.type === 'chart')).toBe(true);
  });

  it('uses the subgroup size for the within sigma', () => {
    const result = run('capability', process, { variable: 'C1', lsl: '9.4', usl: '10.9', target: '', subgroup: 5 });
    const stats = tables(result.blocks)[1];
    const within = Number(stats.rows[1][1]);
    const moving = run('capability', process, { variable: 'C1', lsl: '9.4', usl: '10.9', target: '', subgroup: 1 });
    const movingWithin = Number(tables(moving.blocks)[1].rows[1][1]);
    expect(within).toBeGreaterThan(0);
    expect(within).not.toBeCloseTo(movingWithin, 4);
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

describe('awkward data is refused or handled, never crashed', () => {
  it('refuses a paired t with fewer than two complete pairs', () => {
    const sheet = makeWorksheet('One pair', [
      { name: 'A', type: 'numeric', values: [10, 12, null] },
      { name: 'B', type: 'numeric', values: [1, null, 5] },
    ]);
    expect(() => run('paired', sheet, { first: 'C1', second: 'C2', testDiff: 0, confidence: 95, alternative: 'two-sided', chart: false })).toThrow('res.insufficientPairs');
  });

  it('refuses a t test on a constant column', () => {
    const sheet = makeWorksheet('Flat', [{ name: 'X', type: 'numeric', values: [4, 4, 4, 4, 4] }]);
    expect(() => run('t1', sheet, { variable: 'C1', hypMean: 4, confidence: 95, alternative: 'two-sided', chart: false })).toThrow('res.zeroVariance');
  });

  it('refuses a normality test on too few values', () => {
    const sheet = makeWorksheet('Short', [{ name: 'X', type: 'numeric', values: [1, 2, 3] }]);
    expect(() => run('normality', sheet, { variable: 'C1' })).toThrow('res.insufficient');
  });

  it('reports a collinear regression as singular', () => {
    const x1 = [1, 2, 3, 4, 5, 6];
    const sheet = makeWorksheet('Collinear', [
      { name: 'Y', type: 'numeric', values: [2, 4, 6, 8, 10, 12] },
      { name: 'X1', type: 'numeric', values: x1 },
      { name: 'X2', type: 'numeric', values: x1.map((v) => v * 2) },
    ]);
    expect(() => run('regression', sheet, { response: 'C1', predictors: ['C2', 'C3'], fourInOne: true })).toThrow('res.singular');
  });

  it('plots a single value and a constant column', () => {
    const one = makeWorksheet('One', [{ name: 'X', type: 'numeric', values: [5] }]);
    expect(run('histogram', one, { variable: 'C1', bins: '', normal: true, lsl: '', usl: '', target: '' }).blocks[0].type).toBe('chart');
    const flat = makeWorksheet('Flat', [{ name: 'X', type: 'numeric', values: [5, 5, 5, 5] }]);
    expect(run('histogram', flat, { variable: 'C1', bins: '', normal: true, lsl: '', usl: '', target: '' }).blocks[0].type).toBe('chart');
    expect(run('boxplot', flat, { variables: ['C1'], by: [] }).blocks[0].type).toBe('chart');
  });

  it('summarizes a column holding only missing values', () => {
    const empty = makeWorksheet('Empty', [{ name: 'X', type: 'numeric', values: [null, null, null] }]);
    const result = run('desc', empty, { variables: ['C1'], by: [] });
    expect(tables(result.blocks)[0].rows[0][1]).toBe('0');
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

/* ── review fixes as they appear in the rendered output (P0 / P1) ────── */

function textOf(result: ReturnType<typeof run>): string {
  return result.blocks
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.lines.join(' '))
    .join(' | ');
}

describe('correctness-review output', () => {
  it('Weibull shows the AD basis, the Kaplan–Meier check and the lognormal comparison', () => {
    const rows = [42, 58, 71, 84, 96, 103, 118, 126, 141, 155, 168, 183, 197, 214, 236, 258, 281, 305, 342, 388, 120, 175, 240, 300, 360];
    const sheet = makeWorksheet('Weib', [
      { name: 'Time', type: 'numeric', values: rows },
      { name: 'Censored', type: 'numeric', values: rows.map((_, i) => (i >= 20 ? 1 : 0)) },
    ]);
    const result = run('weibull', sheet, { time: 'C1', censor: 'C2', confidence: 95, censorCode: '1=censored' });
    const [params, ad] = tables(result.blocks);
    expect(params.title).toContain('95%');
    // MTTF CI present at the analysed confidence level
    const mttfRow = params.rows.find((r) => r[0] === 'MTTF');
    expect(String(mttfRow?.[3])).toMatch(/\d/);
    const labels = ad.rows.map((r) => String(r[0]));
    expect(labels).toContain('AD evaluation');
    expect(labels).toContain('KM max deviation');
    // Censored AD is a failures-only REFERENCE statistic: the complete-data
    // critical values and their p-range verdict must not be printed.
    expect(labels).toContain('AD (failures-only, ref.)');
    expect(labels).toContain('AD* (failures-only, ref.)');
    expect(labels).toContain('Bootstrap p-value (B=300)');
    expect(labels).not.toContain('AD* critical values');
    expect(labels).not.toContain('Conclusion');
    expect(String(ad.rows[labels.indexOf('AD evaluation')][1])).toMatch(/failure times only/);
    expect(String(ad.caption)).toMatch(/approximate|Kaplan/i);
    expect(String(ad.caption)).toMatch(/bootstrap/i);
    const fitTable = tables(result.blocks).find((t) => t.title === '@res.lognormalFit');
    expect(fitTable).toBeDefined();
    expect(fitTable!.rows.map((r) => String(r[0]))).toEqual(expect.arrayContaining(['μ (ln)', 'σ (ln)', 'MTTF']));
  });

  it('Sixpack with subgroup 12 runs Xbar-S and says so', () => {
    const values = Array.from({ length: 36 }, (_, i) => 10 + 0.1 * Math.sin(i / 2) + 0.05 * (i % 3));
    const sheet = makeWorksheet('Six', [{ name: 'Value', type: 'numeric', values }]);
    const result = run('sixpack', sheet, { variable: 'C1', subgroup: 12, lsl: '9.6', usl: '10.4', target: '' });
    expect(textOf(result)).toMatch(/Xbar-S/);
    const charts = result.blocks.filter((b) => b.type === 'chartgrid');
    expect(charts.length).toBe(1);
  });

  it('Sixpack prints the sigma basis and the same within-sigma at n = 2, 5, 10, 12', () => {
    const values = [9.986, 10.186, 10.116, 10.027, 9.83, 9.77, 10.142, 10.099, 9.761, 10.075, 9.713, 10.12, 10.134, 10.166, 9.997, 10.133, 10.019, 9.881, 10.116, 10.107, 10.071, 10.081, 9.977, 10.051, 10.062, 9.98, 9.995, 10.092, 9.852, 10.078, 10.265, 10.28, 10.164, 10.164, 10.051, 10.134, 10.086, 10.263, 10.088, 9.957, 9.991, 10.047, 10.291, 9.934, 10.262, 10.135, 10.085, 10.219, 10.489, 10.23, 10.208, 10.226, 10.169, 10.293, 10.055, 10.078, 10.17, 10.267, 10.016, 10.078];
    const sheet = makeWorksheet('Six', [{ name: 'Value', type: 'numeric', values }]);
    const expected: Record<number, string> = { 2: 'R̄/d₂(2)', 5: 'R̄/d₂(5)', 10: 'R̄/d₂(10)', 12: 'S̄/c₄(12)' };
    [2, 5, 10, 12].forEach((subgroup) => {
      const result = run('sixpack', sheet, { variable: 'C1', subgroup, lsl: '9.5', usl: '10.8', target: '' });
      const sigmaTable = tables(result.blocks).find((table) => table.title === '@res.sigmaEstimate');
      expect(sigmaTable, `n=${subgroup}`).toBeDefined();
      const rows = sigmaTable!.rows.map((row) => row.map(String));
      const chartRow = rows.find((row) => row[0] === 'Chart within σ')!;
      const capRow = rows.find((row) => row[0] === 'Capability within σ (Cp/Cpk)')!;
      const overallRow = rows.find((row) => row[0] === 'Overall σ')!;
      // both within-sigma cells print the SAME number, with the chart basis beside them
      expect(chartRow[1]).toBe(capRow[1]);
      expect(chartRow[2]).toBe(expected[subgroup]);
      expect(capRow[2]).toBe(expected[subgroup]);
      expect(Number(chartRow[1])).toBeGreaterThan(0);
      expect(overallRow[2]).toBe('s (n − 1)');
      // the basis is also named in the note above the charts and in the caption
      expect(textOf(result)).toContain(expected[subgroup]);
      expect(String(sigmaTable!.caption)).toContain(expected[subgroup]);
    });
  });

  it('non-normal capability reports the excluded non-positive values', () => {
    const sheet = makeWorksheet('NonN', [{ name: 'Life', type: 'numeric', values: [0, -1, 42, 58, 71, 84, 96, 103, 118, 126, 141, 155] }]);
    const result = run('capnonnormal', sheet, { variable: 'C1', distribution: 'weibull', lsl: '20', usl: '180', target: '' });
    expect(textOf(result)).toMatch(/excluded/i);
    const fitTable = tables(result.blocks)[0];
    expect(fitTable.rows.map((r) => String(r[0]))).toContain('Excluded (≤ 0)');
  });

  it('Xbar-R explains the point-wise limits when a subgroup lost a value', () => {
    const values: (number | null)[] = [10.1, 10.4, 9.9, null, 10.3, 10.0, 10.5, 10.1, 9.8, 10.2, 10.0, 10.3, 10.4, 10.1, 10.2, 10.6];
    const sheet = makeWorksheet('XR', [{ name: 'Thickness', type: 'numeric', values }]);
    const result = run('xbarr', sheet, { variable: 'C1', subgroup: 4 });
    expect(textOf(result)).toMatch(/missing/i);
    expect(textOf(result)).toMatch(/point by point|own valid/i);
  });

  it('paired t shows the observed mean difference and the tested μ₀ separately', () => {
    const sheet = makeWorksheet('Pairs', [
      { name: 'Before', type: 'numeric', values: [13, 15, 17, 19] },
      { name: 'After', type: 'numeric', values: [10, 12, 14, 16] },
    ]);
    const result = run('paired', sheet, { first: 'C1', second: 'C2', testDiff: 3, confidence: 95, alternative: 'two-sided', chart: false });
    const text = textOf(result);
    expect(text).toContain('Mean difference: Before − After = 3');
    expect(text).toContain('Test of μ_d: μ_d = 3');
    const diffTable = tables(result.blocks)[1];
    expect(diffTable.headers[1]).toBe('@th.meanDiff');
    expect(diffTable.caption).toContain('μ₀ = 3');
    expect(String(diffTable.rows[0][4])).toContain('3');
  });

  it('RSM warns when the stationary point lies outside the design region', () => {
    const design: [number, number][] = [[-1, -1], [-1, 1], [1, -1], [1, 1], [1.414, 0], [-1.414, 0], [0, 1.414], [0, -1.414], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
    const y = design.map(([a, b]) => 70 - 6 * a - 5 * b + 0.5 * a * a + 0.5 * b * b + 0.3 * a * b);
    const sheet = makeWorksheet('RSM', [
      { name: 'A', type: 'numeric', values: design.map((d) => d[0]) },
      { name: 'B', type: 'numeric', values: design.map((d) => d[1]) },
      { name: 'Y', type: 'numeric', values: y },
    ]);
    const result = run('rsmanalyze', sheet, { response: 'C3', factors: ['C1', 'C2'], confidence: 95 });
    const stationary = tables(result.blocks).find((t) => t.title === '@res.stationary');
    expect(stationary).toBeDefined();
    expect(stationary?.caption).toMatch(/outside the experimental region/i);
    expect(stationary!.rows.map((r) => String(r[0]))).toContain('Design region');
  });
});
