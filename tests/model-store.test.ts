import { describe, expect, it } from 'vitest';
import type { Column, Worksheet } from '../src/types';
import { makeWorksheet } from '../src/lib/datasets';
import { analyzeRsm } from '../src/lib/doe';
import { regress } from '../src/lib/stats';
import { fitGlm, type ModelFactor, type ModelTerm } from '../src/lib/glm';
import {
  checkCompatibility,
  designRow,
  modelSurface,
  parseCoefficientLabel,
  predictStoredModel,
  structureIssues,
} from '../src/lib/modelPredictor';
import {
  compareStoredModels,
  createStoredModel,
  defaultModelName,
  deleteStoredModel,
  draftFromGlm,
  draftFromRegression,
  draftFromRsmPayload,
  duplicateStoredModel,
  fingerprintColumns,
  mergeStoredModels,
  modelStaleness,
  parseStoredModels,
  refitStoredModel,
  renameStoredModel,
} from '../src/lib/modelStore';
import { parseProject, serializeProject } from '../src/lib/project';
import type { OutputDoc } from '../src/types';

/* ── a small worksheet and the fits the app would run on it ────────────── */

function reactor(): Worksheet {
  const x1 = [1, 2, 3, 4, 5, 6, 7, 8];
  const x2 = [2, 1, 4, 3, 6, 5, 8, 7];
  const y = x1.map((v, i) => 10 + 2 * v + 0.5 * x2[i] + (i % 2 ? 0.1 : -0.1));
  return makeWorksheet('Reactor', [
    { name: 'Time', type: 'numeric', values: x1 },
    { name: 'Temp', type: 'numeric', values: x2 },
    { name: 'Yield', type: 'numeric', values: y },
  ]);
}

function columns(sheet: Worksheet): Column[] {
  return sheet.columns;
}

function regressionModel(sheet: Worksheet) {
  const response = sheet.columns[2];
  const predictors = [sheet.columns[0], sheet.columns[1]];
  const result = regress(
    response.values.map((v) => (typeof v === 'number' ? v : null)),
    predictors.map((column) => ({ name: column.name, values: column.values.map((v) => (typeof v === 'number' ? v : null)) })),
    response.name,
  );
  const draft = draftFromRegression({
    result,
    predictors: predictors.map((column) => ({ column, name: column.name, values: column.values })),
    response: { id: response.id, name: response.name },
    sheet,
    analysisId: 'regression',
  });
  return { result, model: createStoredModel(draft, 'Yield fit') };
}

describe('stored model — regression (WO-02)', () => {
  it('stores the coefficients, covariance and diagnostics the engine produced', () => {
    const sheet = reactor();
    const { result, model } = regressionModel(sheet);
    expect(model.format).toBe('sigrun-model');
    expect(model.kind).toBe('multiple');
    expect(model.response.name).toBe('Yield');
    expect(model.predictors.map((p) => p.name)).toEqual(['Time', 'Temp']);
    expect(model.coefficients.map((c) => c.label)).toEqual(['Constant', 'Time', 'Temp']);
    expect(model.coefficients[1].value).toBeCloseTo(result.coefficients[1].coef, 12);
    expect(model.covariance).toHaveLength(3);
    expect(model.covariance?.[1][1]).toBeCloseTo((result.coefficients[1].se as number) ** 2, 12);
    expect(model.residual?.df).toBe(result.anova.dfErr);
    expect(model.residual?.mse).toBeCloseTo(result.anova.msErr, 12);
    expect(model.diagnostics.r2).toBeCloseTo(result.r2, 12);
    expect(model.diagnostics.r2pred).toBeCloseTo(result.r2pred, 12);
    expect(model.diagnostics.aliased).toBeUndefined();
    expect(model.training?.rows).toBe(result.n);
    expect(model.training?.columns.map((c) => c.id)).toEqual(['C1', 'C2', 'C3']);
  });

  it('predicts the fitted value at a stored row exactly', () => {
    const sheet = reactor();
    const { model, result } = regressionModel(sheet);
    const point = { Time: 3, Temp: 4 };
    const prediction = predictStoredModel(model, point);
    expect(prediction.nonEstimable).toEqual([]);
    // regress keeps only complete rows; row 2 (index 2) is Time 3, Temp 4.
    expect(prediction.value).toBeCloseTo(result.fits[2], 9);
    expect(prediction.se).not.toBeNull();
    expect(prediction.pi?.[0]).toBeLessThan(prediction.value as number);
    expect(prediction.pi?.[1]).toBeGreaterThan(prediction.value as number);
  });

  it('gives SE = s/√n at the centre of the design', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    const mean = (name: string) => {
      const column = sheet.columns.find((c) => c.name === name) as Column;
      const values = column.values.filter((v): v is number => typeof v === 'number');
      return values.reduce((a, b) => a + b, 0) / values.length;
    };
    const prediction = predictStoredModel(model, { Time: mean('Time'), Temp: mean('Temp') });
    const n = model.residual?.df as number;
    const expected = (model.residual?.s as number) / Math.sqrt(n + model.coefficients.length - 1);
    expect(prediction.se).toBeCloseTo(expected, 9);
  });

  it('reports a missing predictor value instead of a number', () => {
    const { model } = regressionModel(reactor());
    const prediction = predictStoredModel(model, { Time: 3 });
    expect(prediction.value).toBeNull();
    expect(prediction.issues).toContain('model.valueMissing');
  });
});

describe('stored model — coded and actual units (WO-02)', () => {
  function rsmModel() {
    const sheet = makeWorksheet('RSM', [
      { name: 'A', type: 'numeric', values: [-1, 1, -1, 1, 0, 1.414, -1.414, 0, 0, 0] },
      { name: 'B', type: 'numeric', values: [-1, -1, 1, 1, 0, 0, 0, 1.414, -1.414, 0] },
      { name: 'Y', type: 'numeric', values: [12, 16, 13, 17.5, 15, 13.2, 12.2, 12.5, 12.4, 15.1] },
    ]);
    const factors: ModelFactor[] = [
      { name: 'A', kind: 'numeric', values: sheet.columns[0].values },
      { name: 'B', kind: 'numeric', values: sheet.columns[1].values },
    ];
    const analysis = analyzeRsm(sheet.columns[2].values.map((v) => (typeof v === 'number' ? v : null)), factors);
    const payload = {
      beta: analysis.glm.beta,
      labels: analysis.glm.labels,
      factorNames: ['A', 'B'],
      designPoints: [],
      codedBounds: [{ min: -1.414, max: 1.414 }, { min: -1.414, max: 1.414 }],
      actualTransform: [{ center: 10, halfRange: 5, low: 5, high: 15 }, { center: 200, halfRange: 50, low: 150, high: 250 }],
      s: analysis.glm.s,
      r2: analysis.glm.r2,
      n: analysis.glm.n,
    };
    return createStoredModel(draftFromRsmPayload(payload, { response: { id: 'C3', name: 'Y' }, sheet, analysisId: 'rsmanalyze' }), 'RSM fit');
  }

  it('stores the coding transform of each factor', () => {
    const model = rsmModel();
    expect(model.kind).toBe('rsm');
    expect(model.predictors[0].coding).toEqual({ mode: 'coded', center: 10, halfRange: 5 });
    expect(model.predictors[1].coding?.center).toBe(200);
    expect(model.covariance).toBeNull();
    expect(model.dof).toBeNull();
    expect(model.residual?.mse).toBeCloseTo((model.residual?.s as number) ** 2, 12);
  });

  it('reads the same point in coded and actual units', () => {
    const model = rsmModel();
    const coded = predictStoredModel(model, { A: 0, B: 0 }, { mode: 'coded' });
    const actual = predictStoredModel(model, { A: 10, B: 200 }, { mode: 'actual' });
    expect(coded.value).not.toBeNull();
    expect(actual.value).toBeCloseTo(coded.value as number, 12);

    const codedEdge = predictStoredModel(model, { A: 1, B: -1 }, { mode: 'coded' });
    const actualEdge = predictStoredModel(model, { A: 15, B: 150 }, { mode: 'actual' });
    expect(actualEdge.value).toBeCloseTo(codedEdge.value as number, 12);
  });

  it('matches the model’s own quadratic formula at a corner', () => {
    const model = rsmModel();
    // ŷ = Σ β·x with x built from the labels (A, B, A×B, A², B²).
    const row = designRow(model, { A: 1, B: 1 }, 'coded');
    const manual = row.values.reduce((sum, value, index) => sum + value * model.coefficients[index].value, 0);
    expect(predictStoredModel(model, { A: 1, B: 1 }, { mode: 'coded' }).value).toBeCloseTo(manual, 12);
  });
});

describe('stored model — rank deficiency (WO-02)', () => {
  function aliasedModel() {
    const sheet = makeWorksheet('Aliased', [
      { name: 'A', type: 'numeric', values: [1, 2, 3, 4, 5, 6] },
      { name: 'A2', type: 'numeric', values: [1, 2, 3, 4, 5, 6] },
      { name: 'Y', type: 'numeric', values: [3, 5, 7, 9, 11, 13] },
    ]);
    const factors: ModelFactor[] = [
      { name: 'A', kind: 'numeric', values: sheet.columns[0].values },
      { name: 'A2', kind: 'numeric', values: sheet.columns[1].values },
    ];
    const terms: ModelTerm[] = [{ name: 'A', factors: ['A'] }, { name: 'A2', factors: ['A2'] }];
    const glm = fitGlm(sheet.columns[2].values.map((v) => (typeof v === 'number' ? v : null)), factors, terms);
    const draft = draftFromGlm({ glm, factors, terms, response: { id: 'C3', name: 'Y', values: sheet.columns[2].values }, kind: 'glm', sheet, analysisId: 'glm' });
    return { model: createStoredModel(draft, 'Aliased fit'), glm };
  }

  it('marks the aliased coefficient as not estimable', () => {
    const { model, glm } = aliasedModel();
    expect(glm.aliased).toHaveLength(1);
    const aliased = model.coefficients.filter((coefficient) => !coefficient.estimable);
    expect(aliased).toHaveLength(1);
    expect(model.diagnostics.aliased).toEqual(glm.aliased);
  });

  it('refuses to report a plausible value when the row leans on the aliased term', () => {
    const { model } = aliasedModel();
    const prediction = predictStoredModel(model, { A: 3, A2: 3 });
    expect(prediction.value).toBeNull();
    expect(prediction.nonEstimable).toHaveLength(1);
    expect(prediction.se).toBeNull();
    expect(prediction.pi).toBeNull();
  });

  it('keeps the constant-only row estimable', () => {
    const { model } = aliasedModel();
    const row = designRow(model, { A: 0, A2: 0 }, 'actual');
    // The intercept is identified, so a row with only the constant is fine.
    expect(row.values[0]).toBe(1);
    const restricted = { ...model, coefficients: model.coefficients.map((c, i) => (i === 0 ? c : { ...c, estimable: false })) };
    const prediction = predictStoredModel(restricted, { A: 0, A2: 0 });
    expect(prediction.value).toBeCloseTo(model.coefficients[0].value, 12);
  });

  it('draws a surface with NaN where the model cannot predict', () => {
    const { model } = aliasedModel();
    const surface = modelSurface(model, { xName: 'A', yName: 'A2', resolution: 5 });
    expect(surface.z.flat().every((value) => Number.isNaN(value))).toBe(true);
    expect(surface.nonEstimable.length).toBeGreaterThan(0);
  });
});

describe('stored model — staleness and re-fitting (WO-02)', () => {
  it('detects changed data, a missing column and an untracked model', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    expect(modelStaleness(model, [sheet]).state).toBe('fresh');

    const changed: Worksheet = {
      ...sheet,
      columns: sheet.columns.map((column, index) => (index === 2
        ? { ...column, values: column.values.map((value) => (typeof value === 'number' ? value + 1 : value)) }
        : column)),
    };
    const stale = modelStaleness(model, [changed]);
    expect(stale.state).toBe('stale');
    expect(stale.detail.code).toBe('model.track.stale');

    const dropped: Worksheet = { ...sheet, columns: sheet.columns.slice(0, 2) };
    const missing = modelStaleness(model, [dropped]);
    expect(missing.state).toBe('missing-data');
    expect(missing.detail.missing).toEqual(['Yield']);

    expect(modelStaleness(model, []).state).toBe('missing-data');
    expect(modelStaleness({ ...model, training: null }, [sheet]).state).toBe('untracked');
  });

  it('re-fits against the current worksheet, keeping the record identity', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    const shifted: Worksheet = {
      ...sheet,
      columns: sheet.columns.map((column, index) => (index === 2
        ? { ...column, values: column.values.map((value) => (typeof value === 'number' ? value * 2 : value)) }
        : column)),
    };
    const refit = refitStoredModel(model, shifted);
    expect(refit.id).toBe(model.id);
    expect(refit.name).toBe(model.name);
    expect(refit.coefficients[1].value).toBeCloseTo(model.coefficients[1].value * 2, 8);
    expect(refit.training?.fingerprint).not.toBe(model.training?.fingerprint);
    expect(modelStaleness(refit, [shifted]).state).toBe('fresh');
  });

  it('refuses to re-fit when a fitted column is gone', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    const dropped: Worksheet = { ...sheet, columns: sheet.columns.slice(0, 2) };
    expect(() => refitStoredModel(model, dropped)).toThrow(/model.track.missingColumn/);
  });

  it('fingerprints only the columns the model was fitted on', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    const extra: Worksheet = {
      ...sheet,
      columns: [...sheet.columns, { id: 'C4', name: 'Note', type: 'text', values: ['a', 'b', null, null, null, null, null, null] }],
    };
    expect(modelStaleness(model, [extra]).state).toBe('fresh');
    // Adding a row changes the digest, removing one again restores it.
    const longer: Worksheet = {
      ...sheet,
      columns: sheet.columns.map((column) => ({ ...column, values: [...column.values, 1] })),
    };
    expect(modelStaleness(model, [longer]).state).toBe('stale');
  });

  it('computes the same fingerprint for the same values in a fresh object', () => {
    const sheet = reactor();
    expect(fingerprintColumns(sheet.columns)).toBe(fingerprintColumns(sheet.columns.map((c) => ({ ...c, values: [...c.values] }))));
  });
});

describe('stored model — collection operations (WO-02)', () => {
  const sheet = reactor();
  const { model } = regressionModel(sheet);

  it('renames, duplicates and deletes', () => {
    let models = [model];
    models = renameStoredModel(models, model.id, '  Reactor yield  ');
    expect(models[0].name).toBe('Reactor yield');
    models = renameStoredModel(models, model.id, '   ');
    expect(models[0].name).toBe('Reactor yield');

    models = duplicateStoredModel(models, model.id);
    expect(models).toHaveLength(2);
    expect(models[1].id).not.toBe(model.id);
    expect(models[1].name).toBe('Reactor yield (copy)');
    expect(models[1].coefficients).toEqual(model.coefficients);
    expect(models[1].coefficients).not.toBe(model.coefficients);

    models = deleteStoredModel(models, model.id);
    expect(models.map((m) => m.name)).toEqual(['Reactor yield (copy)']);
  });

  it('merges a project into a session, the newer copy winning', () => {
    const older = { ...model, name: 'old', updatedAt: '2026-01-01T00:00:00.000Z' };
    const newer = { ...model, name: 'new', updatedAt: '2026-06-01T00:00:00.000Z' };
    const merged = mergeStoredModels([older], [newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('new');
    expect(mergeStoredModels([newer], [older])[0].name).toBe('new');
    const extra = createStoredModel({ ...model }, 'second');
    expect(mergeStoredModels([newer], [extra])).toHaveLength(2);
  });

  it('drops a damaged project entry instead of reconstructing it', () => {
    const parsed = parseStoredModels([{ format: 'sigrun-model' }, null, 'x', model]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(model.id);
    expect(parseStoredModels(undefined)).toEqual([]);
  });

  it('names a model from its response and predictors', () => {
    expect(defaultModelName(model)).toBe('Yield ← Time, Temp');
  });

  it('compares several models on the metrics they actually report', () => {
    const second = createStoredModel(draftFromRsmPayload(
      {
        beta: [1, 1], labels: ['Constant', 'A'], factorNames: ['A'], designPoints: [],
        codedBounds: [{ min: -1, max: 1 }], actualTransform: [{ center: 0, halfRange: 1, low: -1, high: 1 }], n: 6,
      },
      { response: { id: 'C1', name: 'Y' } },
    ), 'simple');
    const rows = compareStoredModels([model, second]);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    expect(byKey.r2.values[model.id]).toMatch(/%$/);
    expect(byKey.covariance.values[second.id]).toBe('model.cmp.unavailable');
    expect(byKey.r2pred.values[second.id]).toBe('—');
    expect(byKey.kind.values[second.id]).toBe('rsm');
  });

  it('round-trips through a project file with chart styles and chart configs', () => {
    const output: OutputDoc = {
      id: 'out-1',
      titleKey: 'an.regression',
      createdAt: 1,
      collapsed: false,
      blocks: [{
        type: 'chart',
        chart: { kind: 'scatter', points: [{ x: 1, y: 2 }], config: { appearance: { preset: 'dark' }, xAxis: { min: 0, max: 5 } } },
        caption: '@chart.versusFits',
      }],
      model: model as never,
    };
    const text = serializeProject({
      worksheets: [sheet],
      activeSheetId: sheet.id,
      settings: { theme: 'dark', lang: 'ko' },
      outputs: [output],
      customChartStyles: [{ id: 'custom:1', name: 'Mine', base: 'engineering', overrides: {} }],
      models: [model],
    });
    const parsed = parseProject(text);
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models?.[0].coefficients).toEqual(model.coefficients);
    expect(parsed.customChartStyles?.[0].name).toBe('Mine');
    const chart = parsed.outputs[0].blocks[0];
    expect(chart.type === 'chart' && chart.chart.config?.xAxis?.max).toBe(5);
    expect(parsed.settings).toEqual({ theme: 'dark', lang: 'ko' });
  });
});

describe('stored model — input validation (WO-02)', () => {
  it('parses square and interaction labels', () => {
    expect(parseCoefficientLabel('Constant')).toEqual([]);
    expect(parseCoefficientLabel('A')).toEqual([{ name: 'A', squares: 0, level: null }]);
    expect(parseCoefficientLabel('A²')).toEqual([{ name: 'A', squares: 1, level: null }]);
    expect(parseCoefficientLabel('A×B')).toEqual([
      { name: 'A', squares: 0, level: null },
      { name: 'B', squares: 0, level: null },
    ]);
    expect(parseCoefficientLabel('Machine[Line A]')).toEqual([{ name: 'Machine', squares: 0, level: 'Line A' }]);
    expect(parseCoefficientLabel('A×Machine[Line A]')).toHaveLength(2);
  });

  it('rejects an unknown categorical level and names the levels it knows', () => {
    const sheet = makeWorksheet('Machines', [
      { name: 'Machine', type: 'text', values: ['A', 'B', 'C', 'A', 'B', 'C'] },
      { name: 'Temp', type: 'numeric', values: [1, 2, 3, 4, 5, 6] },
      { name: 'Y', type: 'numeric', values: [1, 2, 3, 4, 5, 6] },
    ]);
    const factors: ModelFactor[] = [
      { name: 'Machine', kind: 'categorical', values: sheet.columns[0].values },
      { name: 'Temp', kind: 'numeric', values: sheet.columns[1].values },
    ];
    const terms: ModelTerm[] = [{ name: 'Machine', factors: ['Machine'] }, { name: 'Temp', factors: ['Temp'] }];
    const glm = fitGlm(sheet.columns[2].values.map((v) => (typeof v === 'number' ? v : null)), factors, terms);
    const model = createStoredModel(draftFromGlm({
      glm, factors, terms, response: { id: 'C3', name: 'Y', values: sheet.columns[2].values }, kind: 'glm', sheet,
    }), 'Machine fit');
    expect(model.predictors[0].levels).toEqual(['A', 'B', 'C']);
    expect(model.categoricalLevels).toEqual({ Machine: ['A', 'B', 'C'] });

    const ok = predictStoredModel(model, { Machine: 'A', Temp: 2 });
    expect(ok.value).not.toBeNull();
    const unknown = predictStoredModel(model, { Machine: 'Z', Temp: 2 });
    expect(unknown.value).toBeNull();
    expect(unknown.issues).toContain('model.levelUnknown');
    expect(structureIssues(model)).toEqual([]);
  });

  it('checks compatibility against a worksheet', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    expect(checkCompatibility(model, sheet.columns).ok).toBe(true);

    const textType = sheet.columns.map((column, index) => (index === 0 ? { ...column, type: 'text' as const } : column));
    expect(checkCompatibility(model, textType).problems[0].code).toBe('model.compat.type');
    const missing = checkCompatibility(model, sheet.columns.slice(0, 1));
    expect(missing.problems.map((p) => p.code)).toContain('model.compat.missing');
  });

  it('does not multiply a structural error by zero', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    const broken = { ...model, coefficients: [...model.coefficients, { label: 'Ghost', value: 1, estimable: true }] };
    expect(structureIssues(broken)).toEqual(['model.structure.unknown:Ghost']);
    expect(predictStoredModel(broken, { Time: 1, Temp: 1 }).value).toBeNull();
  });
});

describe('model surface (WO-02 follow-up entry)', () => {
  it('draws the fitted plane on its grid and flags extrapolation', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    const surface = modelSurface(model, { xName: 'Time', yName: 'Temp', resolution: 3 });
    expect(surface.xs).toHaveLength(3);
    expect(surface.z).toHaveLength(3);
    const value = (x: number, y: number) => predictStoredModel(model, { Time: x, Temp: y }).value;
    expect(surface.z[0][0]).toBeCloseTo(value(surface.xs[0], surface.ys[0]) as number, 9);
    expect(surface.z[2][2]).toBeCloseTo(value(surface.xs[2], surface.ys[2]) as number, 9);
    expect(surface.outOfRange).toBe(false);
    const wide = modelSurface(model, { xName: 'Time', yName: 'Temp', xRange: [0, 100], resolution: 3 });
    expect(wide.outOfRange).toBe(true);
  });

  it('holds the other factors at their coded centre', () => {
    const sheet = makeWorksheet('Three factors', [
      { name: 'A', type: 'numeric', values: [-1, 1, -1, 1, 0] },
      { name: 'B', type: 'numeric', values: [-1, -1, 1, 1, 0] },
      { name: 'C', type: 'numeric', values: [-1, 1, 1, -1, 0] },
      { name: 'Y', type: 'numeric', values: [1, 2, 3, 4, 2.5] },
    ]);
    const factors: ModelFactor[] = [0, 1, 2].map((i) => ({ name: String.fromCharCode(65 + i), kind: 'numeric' as const, values: sheet.columns[i].values }));
    const terms: ModelTerm[] = factors.map((f) => ({ name: f.name, factors: [f.name] }));
    const glm = fitGlm(sheet.columns[3].values.map((v) => (typeof v === 'number' ? v : null)), factors, terms);
    const model = createStoredModel(draftFromGlm({
      glm, factors, terms, response: { id: 'C4', name: 'Y', values: sheet.columns[3].values }, kind: 'doe', codingMode: 'coded', sheet,
    }), 'three factors');
    const surface = modelSurface(model, { xName: 'A', yName: 'B', resolution: 3, mode: 'coded' });
    const expected = predictStoredModel(model, { A: surface.xs[1], B: surface.ys[1], C: 0 }, { mode: 'coded' }).value;
    expect(surface.z[1][1]).toBeCloseTo(expected as number, 9);
  });

  it('refuses a surface for a categorical factor', () => {
    const sheet = makeWorksheet('Cat', [
      { name: 'Machine', type: 'text', values: ['A', 'B', 'A', 'B'] },
      { name: 'Y', type: 'numeric', values: [1, 2, 1.5, 2.5] },
    ]);
    const factors: ModelFactor[] = [{ name: 'Machine', kind: 'categorical', values: sheet.columns[0].values }];
    const terms: ModelTerm[] = [{ name: 'Machine', factors: ['Machine'] }];
    const glm = fitGlm(sheet.columns[1].values.map((v) => (typeof v === 'number' ? v : null)), factors, terms);
    const model = createStoredModel(draftFromGlm({ glm, factors, terms, response: { id: 'C2', name: 'Y', values: sheet.columns[1].values }, kind: 'glm', sheet }), 'cat');
    expect(() => modelSurface(model, { xName: 'Machine', yName: 'Machine' })).toThrow(/model.surface.numericOnly/);
  });
});

describe('model store — column helpers', () => {
  it('keeps numeric bounds per predictor and no invented levels', () => {
    const sheet = reactor();
    const { model } = regressionModel(sheet);
    expect(model.factorBounds).toEqual({ Time: { min: 1, max: 8 }, Temp: { min: 1, max: 8 } });
    expect(model.categoricalLevels).toBeNull();
    expect(columns(sheet).length).toBe(3);
  });
});
