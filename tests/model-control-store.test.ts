import { describe, expect, it } from 'vitest';
import { findAnalysis } from '../src/lib/analyses';
import { makeWorksheet } from '../src/lib/datasets';
import {
  createStoredModel,
  draftFromGlm,
  duplicateStoredModel,
  parseStoredModels,
  refitStoredModel,
  type StoredModel,
} from '../src/lib/modelStore';
import { predictStoredModel } from '../src/lib/modelPredictor';
import { fitGlm, type ModelFactor, type ModelTerm } from '../src/lib/glm';
import type { Block, ChartSpec, Worksheet } from '../src/types';

function replicates() {
  const A: number[] = [];
  const B: number[] = [];
  const C: number[] = [];
  const y: number[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const c of [-1, 1]) {
        for (const rep of [0, 1]) {
          A.push(a); B.push(b); C.push(c);
          y.push(10 + 3 * a + 2 * b + 1.5 * c + 1 * a * b - 0.5 * a * c + 0.75 * b * c + 0.25 * a * b * c
            + (rep === 0 ? 0.2 : -0.2));
        }
      }
    }
  }
  return { A, B, C, y };
}

function designSheet(): Worksheet {
  const { A, B, C, y } = replicates();
  return makeWorksheet('Replicated 2^3', [
    { name: 'A', type: 'numeric', values: A },
    { name: 'B', type: 'numeric', values: B },
    { name: 'C', type: 'numeric', values: C },
    { name: 'Y', type: 'numeric', values: y },
  ]);
}

function tables(blocks: Block[]) {
  return blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table');
}

function textLines(blocks: Block[]): string[] {
  return blocks
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .flatMap((b) => b.lines);
}

function charts(blocks: Block[]): { title: string; chart: ChartSpec }[] {
  return blocks
    .filter((b): b is Extract<Block, { type: 'chartgrid' }> => b.type === 'chartgrid')
    .flatMap((b) => b.charts);
}

describe('model comparison reaches the analysis output (WO-3F-05)', () => {
  it('shows the original and reduced DOE side by side after pooling', () => {
    const sheet = designSheet();
    const def = findAnalysis('doeanalyze');
    const result = def!.run({
      lang: 'en',
      sheet,
      values: {
        response: 'C4',
        factors: ['C1', 'C2', 'C3'],
        order: '3',
        terms: ['A', 'B', 'C', 'A|B', 'A|C', 'B|C', 'A|B|C'],
        pooled: ['B|C'],
        hierarchy: 'unrestricted',
      },
    });
    const titles = tables(result.blocks).map((table) => table.title);
    expect(titles).toContain('@res.modelComparison');
    expect(titles).toContain('@res.coefficientComparison');
    expect(titles).toContain('@res.anovaComparison');
    expect(titles).toContain('@res.partialF');
    expect(textLines(result.blocks).join('\n')).toContain('Removed terms: B×C');
    expect(textLines(result.blocks).join('\n')).toContain('Model formula: Y = β0 + A + B + C + A×B + A×C + A×B×C');
    expect(result.modelOriginal).toBeDefined();
    expect(result.modelOriginal!.terms.map((term) => term.label)).toContain('B×C');
    expect(result.modelDraft!.terms.map((term) => term.label)).not.toContain('B×C');
    const comparison = tables(result.blocks).find((table) => table.title === '@res.modelComparison')!;
    expect(comparison.headers).toEqual(expect.arrayContaining(['@th.metric', '@th.original', '@th.reduced', '@th.difference']));
    expect(comparison.rows.map((row) => row[0])).toContain('Error df');
  });

  it('compares a GLM whose terms were reduced in the editor', () => {
    const sheet = designSheet();
    const def = findAnalysis('glm');
    const result = def!.run({
      lang: 'en',
      sheet,
      values: { response: 'C4', factors: ['C1', 'C2'], terms: ['A', 'B'] },
    });
    expect(tables(result.blocks).map((table) => table.title)).toContain('@res.modelComparison');
    expect(result.modelOriginal).toBeDefined();
    expect(textLines(result.blocks).join('\n')).toContain('Removed terms: A×B');
  });

  it('draws effect charts from the chart engine, including the normal plot', () => {
    const sheet = designSheet();
    const def = findAnalysis('doeanalyze');
    const result = def!.run({ lang: 'en', sheet, values: { response: 'C4', factors: ['C1', 'C2', 'C3'], order: '2' } });
    const items = charts(result.blocks);
    expect(items.map((item) => item.title)).toEqual(expect.arrayContaining(['@chart.paretoEffects', '@chart.normalEffects', '@chart.halfNormal']));
    const normal = items.find((item) => item.title === '@chart.normalEffects')!;
    expect(normal.chart.kind).toBe('probplot');
    if (normal.chart.kind === 'probplot') expect(normal.chart.points.length).toBeGreaterThan(0);
    const mainA = items.find((item) => item.title === 'A')!;
    if (mainA.chart.kind === 'line') {
      expect(mainA.chart.series.map((series) => series.label)).toContain('Model estimate');
      expect(mainA.chart.series.map((series) => series.label)).toContain('95% CI low');
    }
  });

  it('switches the Pareto chart to effects and a Lenth line on a saturated design', () => {
    const rows: [number, number, number][] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) rows.push([a, b, c]);
    const y = rows.map(([a, b, c]) => 10 + 3 * a + 2 * b + 1.5 * c + 1 * a * b - 0.5 * a * c + 0.75 * b * c + 0.25 * a * b * c);
    const sheet = makeWorksheet('Unreplicated', [
      { name: 'A', type: 'numeric', values: rows.map((row) => row[0]) },
      { name: 'B', type: 'numeric', values: rows.map((row) => row[1]) },
      { name: 'C', type: 'numeric', values: rows.map((row) => row[2]) },
      { name: 'Y', type: 'numeric', values: y },
    ]);
    const def = findAnalysis('doeanalyze');
    const result = def!.run({ lang: 'en', sheet, values: { response: 'C4', factors: ['C1', 'C2', 'C3'], order: '3' } });
    const pareto = charts(result.blocks).find((item) => item.title === '@chart.paretoEffects')!;
    expect(pareto.chart.kind).toBe('bar');
    if (pareto.chart.kind === 'bar') {
      expect(pareto.chart.items).toHaveLength(7);
      expect(pareto.chart.yLabel).toBe('|Effect|');
      expect(pareto.chart.refLine?.label).toMatch(/^Lenth ME/);
    }
  });
});

describe('model-control metadata in the store (WO-3F-08)', () => {
  it('stores hierarchy, pooling, formula and schema with the coefficients', () => {
    const sheet = designSheet();
    const factors: ModelFactor[] = ['A', 'B', 'C'].map((name) => ({
      name,
      kind: 'categorical',
      values: sheet.columns.find((column) => column.name === name)!.values,
    }));
    const terms: ModelTerm[] = [
      { name: 'A', factors: ['A'] },
      { name: 'B', factors: ['B'] },
      { name: 'C', factors: ['C'] },
    ];
    const glm = fitGlm(sheet.columns[3].values as number[], factors, terms);
    const draft = draftFromGlm({
      glm,
      factors,
      terms,
      response: { id: 'C4', name: 'Y', values: sheet.columns[3].values },
      kind: 'doe',
      sheet,
      control: {
        hierarchy: 'auto',
        excluded: ['A×B'],
        pooling: [{ term: 'A×B×C', df: 1, ss: 0.5, estimable: true }],
        fitMethod: 'glm',
        formula: 'Y = β0 + A + B + C',
      },
    });
    const model = createStoredModel(draft, 'meta');
    expect(model.schemaVersion).toBe(2);
    expect(model.control?.hierarchy).toBe('auto');
    expect(model.control?.selected).toEqual(['A', 'B', 'C']);
    expect(model.control?.excluded).toEqual(['A×B']);
    expect(model.control?.pooling[0].term).toBe('A×B×C');
    expect(model.control?.formula).toBe('Y = β0 + A + B + C');
    expect(model.control?.errorDf).toBe(glm.dfe);
    expect(model.control?.rank).toBe(glm.rank);
    expect(model.control?.datasetFingerprint).toBe(model.training?.fingerprint);
    const copy = duplicateStoredModel([model], model.id)[1];
    expect(copy.control).toEqual(model.control);
  });

  it('leaves a pre-3F model exactly as it was saved', () => {
    const legacy: StoredModel = {
      format: 'sigrun-model',
      version: 1,
      id: 'mdl-old',
      name: 'Old',
      kind: 'glm',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      response: { id: 'C2', name: 'Y', kind: 'numeric' },
      predictors: [{ id: 'C1', name: 'A', kind: 'numeric', coding: { mode: 'actual', center: 0, halfRange: 1 } }],
      terms: [{ label: 'A', factors: ['A'] }],
      coefficients: [
        { label: 'Constant', value: 1, estimable: true },
        { label: 'A', value: 2, estimable: true },
      ],
      covariance: null,
      residual: { sse: 1, df: 3, mse: 1 / 3, s: Math.sqrt(1 / 3) },
      dof: { model: 1, residual: 3, total: 4, rank: 2 },
      factorBounds: null,
      categoricalLevels: null,
      training: null,
      diagnostics: { n: 5, r2: 0.5 },
      source: {},
    };
    const [parsed] = parseStoredModels([legacy]);
    expect('schemaVersion' in parsed).toBe(false);
    expect('control' in parsed).toBe(false);
    const prediction = predictStoredModel(parsed, { A: '1' }, { mode: 'actual' });
    expect(prediction.value).toBeCloseTo(3, 9);
  });

  it('re-fits a stored saturated model with the same allowance', () => {
    const rows: [number, number, number][] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) rows.push([a, b, c]);
    const y = rows.map(([a, b, c]) => 10 + 3 * a + 2 * b + 1.5 * c + a * b - 0.5 * a * c + 0.75 * b * c + 0.25 * a * b * c);
    const sheet = makeWorksheet('Unreplicated', [
      { name: 'A', type: 'numeric', values: rows.map((row) => row[0]) },
      { name: 'B', type: 'numeric', values: rows.map((row) => row[1]) },
      { name: 'C', type: 'numeric', values: rows.map((row) => row[2]) },
      { name: 'Y', type: 'numeric', values: y },
    ]);
    const factors: ModelFactor[] = ['A', 'B', 'C'].map((name) => ({
      name,
      kind: 'categorical',
      values: sheet.columns.find((column) => column.name === name)!.values,
    }));
    const terms: ModelTerm[] = [
      { name: 'A', factors: ['A'] },
      { name: 'B', factors: ['B'] },
      { name: 'C', factors: ['C'] },
      { name: 'A×B', factors: ['A', 'B'] },
      { name: 'A×C', factors: ['A', 'C'] },
      { name: 'B×C', factors: ['B', 'C'] },
      { name: 'A×B×C', factors: ['A', 'B', 'C'] },
    ];
    const glm = fitGlm(sheet.columns[3].values as number[], factors, terms, { allowZeroDf: true });
    const model = createStoredModel(draftFromGlm({
      glm,
      factors,
      terms,
      response: { id: 'C4', name: 'Y', values: sheet.columns[3].values },
      kind: 'doe',
      codingMode: 'coded',
      sheet,
      control: { hierarchy: 'strict', excluded: [], fitMethod: 'glm' },
    }), 'saturated');
    expect(model.control?.saturated).toBe(true);
    expect(model.control?.inferable).toBe(false);
    const refit = refitStoredModel(model, sheet);
    expect(refit.dof?.residual).toBe(0);
    expect(refit.residual).toBeNull();
    expect(refit.control?.saturated).toBe(true);
  });

  it('does not let an excluded term back into a prediction', () => {
    const sheet = makeWorksheet('AB', [
      { name: 'A', type: 'numeric', values: [-1, -1, 1, 1, 0, 0] },
      { name: 'B', type: 'numeric', values: [-1, 1, -1, 1, 0, 0] },
      { name: 'Y', type: 'numeric', values: [3, 5, 7, 9, 5, 5] },
    ]);
    const factors: ModelFactor[] = ['A', 'B'].map((name) => ({
      name,
      kind: 'numeric',
      values: sheet.columns.find((column) => column.name === name)!.values,
    }));
    const terms: ModelTerm[] = [{ name: 'A', factors: ['A'] }];
    const glm = fitGlm(sheet.columns[2].values as number[], factors, terms);
    const model = createStoredModel(draftFromGlm({
      glm,
      factors,
      terms,
      response: { id: 'C3', name: 'Y', values: sheet.columns[2].values },
      kind: 'glm',
      sheet,
      control: { hierarchy: 'strict', excluded: ['B', 'A×B'], fitMethod: 'glm' },
    }), 'reduced');
    // Only A was fitted: the OLS line gives 34/6 at A = 0 whichever B value
    // the caller supplies, so the excluded terms cannot re-enter prediction.
    const prediction = predictStoredModel(model, { A: '0', B: '1' }, { mode: 'actual' });
    expect(prediction.value).toBeCloseTo(34 / 6, 6);
    const withB = predictStoredModel(model, { A: '0', B: '-1' }, { mode: 'actual' });
    expect(withB.value).toBeCloseTo(prediction.value!, 12);
  });
});
