/* Stage 3E corrective review — ROUND 2 (R-01 … R-06), fail-first suite.

   Baseline: `2695b65` (the Round-1 correction merged as #27).

   Every test below is written against APIs that already exist on that baseline,
   so a failure here is an assertion about behaviour — the mean being thrown away
   with the interval, an offset-sized tolerance accepting a value 0.3 of a step
   off the lattice, a CrossCheck that never compares the interval, a project
   that restores a damaged figure by deleting it, a one-point lattice that is
   refused — and never a module that failed to load. The same file must pass,
   unchanged, on the corrected tree.

   The Round-1 suite (`phase3e-corrective.test.ts`) pins the earlier findings;
   one of its assertions stated the OLD value/interval policy (a finite mean
   refused because the interval overflowed) and is updated by R-01, which is the
   only place the two rounds disagree. */

import { describe, expect, it } from 'vitest';
import { createStoredModel, type ModelVariable, type StoredModel, type StoredModelDraft } from '../src/lib/modelStore';
import { compileSurfaceEvaluator, modelSurface, predictStoredModel } from '../src/lib/modelPredictor';
import { createPredictionAdapter, crossCheck } from '../src/lib/predictionAdapter';
import { evaluateCondition, optimize } from '../src/lib/optimizer';
import { profileCurves } from '../src/lib/profiler';
import {
  discreteAxis,
  discreteValueAt,
  factorIssues,
  isOnStep,
  nearestStepValue,
  validateFactorValue,
} from '../src/lib/factorDomain';
import { buildProject, parseProject, serializeProject } from '../src/lib/project';
import { createLayout } from '../src/lib/graphLayout';
import { DATASETS } from '../src/lib/datasets';
import type { FactorSettings, ResponseSettings } from '../src/lib/optimizationTypes';

/* ── helpers ───────────────────────────────────────────────────────────── */

const VALUE_NON_FINITE = 'model.value.nonFinite';
/** The interval failed although the mean is finite — never the value's code. */
const INTERVAL_NON_FINITE = 'model.interval.nonFinite';

function numeric(name: string, center = 0, halfRange = 1): ModelVariable {
  return { id: `col-${name}`, name, kind: 'numeric', coding: { mode: 'coded', center, halfRange } };
}

function model(
  predictors: ModelVariable[],
  coefficients: [string, number][],
  options: {
    response?: string;
    bounds?: Record<string, { min: number; max: number }>;
    covariance?: number[][] | null;
    df?: number | null;
    mse?: number | null;
  } = {},
): StoredModel {
  const residual = options.df != null
    ? (options.mse == null ? { df: options.df } : { df: options.df, mse: options.mse, s: Math.sqrt(options.mse) })
    : null;
  const draft: StoredModelDraft = {
    format: 'sigrun-model',
    version: 1,
    kind: 'polynomial',
    response: { id: '', name: options.response ?? 'Y', kind: 'numeric' },
    predictors,
    terms: coefficients.filter(([label]) => label !== 'Constant').map(([label]) => ({ label, factors: [] })),
    coefficients: coefficients.map(([label, value]) => ({ label, value, estimable: true })),
    covariance: options.covariance ?? null,
    residual,
    dof: null,
    factorBounds: options.bounds ?? null,
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
  return createStoredModel(draft, 'qa-r2');
}

/** Y = 1 + 2A + A² over A ∈ [−1, 1]; covariance I₃, df 5, mse 0.25. */
function quadratic(): StoredModel {
  return model(
    [numeric('A'), numeric('B')],
    [['Constant', 1], ['A', 2], ['A²', 1]],
    {
      bounds: { A: { min: -1, max: 1 }, B: { min: -1, max: 1 } },
      covariance: [[0.04, 0, 0], [0, 0.04, 0], [0, 0, 0.04]],
      df: 5,
      mse: 0.25,
    },
  );
}

function responseFor(stored: StoredModel): ResponseSettings {
  return {
    modelId: stored.id,
    name: stored.response.name,
    goal: 'maximize',
    lower: -1000,
    upper: 1000,
    target: null,
    weight: 1,
    importance: 1,
  };
}

function factor(name: string, overrides: Partial<FactorSettings> = {}): FactorSettings {
  return {
    name,
    kind: 'continuous',
    lower: -1,
    upper: 1,
    step: 0.1,
    fixed: false,
    fixedValue: 0,
    levels: [],
    ...overrides,
  };
}

function discrete(name: string, lower: number, upper: number, step: number): FactorSettings {
  return factor(name, { kind: 'discrete', lower, upper, step });
}

/* ── R-01 · mean prediction and interval failure are two answers ───────── */

describe('[R-01] a finite mean survives an interval that cannot be computed', () => {
  /**
   * ŷ = 1 + 2A + A² with a covariance of 1e308·I.
   *
   * The covariance is finite, symmetric and positive definite, so the model
   * does carry an interval basis. At A = 1e154 the squared term's weight is
   * 1e308, and w'Σw overflows: the interval cannot be computed while ŷ = 1e308
   * is a perfectly finite number. Every path must return that number and put
   * the failure on the interval.
   */
  function overflowingInterval(): StoredModel {
    return model(
      [numeric('A'), numeric('B')],
      [['Constant', 1], ['A', 2], ['A²', 1]],
      {
        bounds: { A: { min: -1e160, max: 1e160 }, B: { min: -1, max: 1 } },
        covariance: [[1e308, 0, 0], [0, 1e308, 0], [0, 0, 1e308]],
        df: 5,
        mse: 0.25,
      },
    );
  }
  const point = { A: 1e154, B: 0 };
  /** The mean the five paths must agree on: 1 + 2e154 + 1e308. */
  const expected = 1 + 2e154 + (1e154) ** 2;
  const closeToExpected = (value: number | null): void => {
    expect(value).not.toBeNull();
    expect(Math.abs((value as number) - expected) / expected).toBeLessThan(1e-12);
  };

  it('the Model Manager states ŷ and files the failure under the interval', () => {
    const direct = predictStoredModel(overflowingInterval(), point);
    closeToExpected(direct.value);
    expect(direct.se).toBeNull();
    expect(direct.pi).toBeNull();
    expect(direct.issues).toContain(INTERVAL_NON_FINITE);
    // The value itself is finite: the value's own code must not be used for it.
    expect(direct.issues).not.toContain(VALUE_NON_FINITE);
  });

  it('the adapter keeps the same value instead of refusing the point', () => {
    const adapter = createPredictionAdapter(overflowingInterval());
    const evaluation = adapter.evaluate(point);
    closeToExpected(evaluation.value);
    expect(evaluation.se).toBeNull();
    expect(evaluation.ci).toBeNull();
    expect(evaluation.pi).toBeNull();
    expect(evaluation.issues).toContain(INTERVAL_NON_FINITE);
  });

  it('the surface node keeps the value and drops only the bands', () => {
    const stored = overflowingInterval();
    const grid = modelSurface(stored, { xName: 'A', yName: 'B', xRange: [1e154, 1e154], yRange: [0, 0], resolution: 2, mode: 'actual' });
    expect(grid.z.flat().every((value) => Number.isFinite(value))).toBe(true);
    const evaluator = compileSurfaceEvaluator(stored, { xName: 'A', yName: 'B', mode: 'actual' });
    const node = evaluator.evaluate(1e154, 0);
    expect(node.value).not.toBeNull();
    expect(node.ciHalf).toBeNull();
    expect(node.piHalf).toBeNull();
    expect(node.issues).toContain(INTERVAL_NON_FINITE);
  });

  it('the optimiser scores the mean and reports the interval separately', () => {
    const stored = overflowingInterval();
    const condition = evaluateCondition(
      [stored],
      [responseFor(stored)],
      [
        factor('A', { fixed: true, fixedValue: 1e154, lower: -1e160, upper: 1e160 }),
        factor('B', { fixed: true, fixedValue: 0 }),
      ],
      { A: 1e154, B: 0 },
      { allowExtrapolation: true },
    );
    const prediction = condition?.responses[0];
    closeToExpected(prediction?.value ?? null);
    expect(prediction?.ci).toBeNull();
    expect(prediction?.issues).toContain(INTERVAL_NON_FINITE);
    // An interval that cannot be computed does not make the MEAN point unusable.
    expect(prediction?.nonEstimable).toEqual([]);
  });

  it('the profiler draws the mean curve and names the missing band', () => {
    const stored = overflowingInterval();
    const rows = profileCurves(
      [stored],
      [responseFor(stored)],
      [
        factor('A', { fixed: true, fixedValue: 1e154, lower: -1e160, upper: 1e160 }),
        factor('B', { fixed: true, fixedValue: 0 }),
      ],
      {},
      { resolution: 3 },
    );
    closeToExpected(rows[0].prediction?.value ?? null);
    const curve = rows[0].curves[0];
    expect(curve.mean.every((value) => Number.isFinite(value))).toBe(true);
    expect(curve.ci).toBeNull();
    expect(curve.issues).toContain(INTERVAL_NON_FINITE);
  });

  it('a value that really overflows is still refused on every path', () => {
    const stored = overflowingInterval();
    const overflow = { A: 1e160, B: 0 };
    const direct = predictStoredModel(stored, overflow);
    const adapter = createPredictionAdapter(stored);
    const evaluation = adapter.evaluate(overflow);
    expect(direct.value).toBeNull();
    expect(direct.issues).toContain(VALUE_NON_FINITE);
    expect(evaluation.value).toBeNull();
    expect(evaluation.issues).toContain(VALUE_NON_FINITE);
  });
});

/* ── R-02 · the on-step test is about the lattice, not the offset ──────── */

describe('[R-02] an off-step value at a large offset is refused', () => {
  const LOWER = 1e8;
  const STEP = 0.0001;
  const UPPER = 1e8 + 0.001;
  /** 0.3 of a step above Lower: not one of the lattice's numbers. */
  const OFF = 1e8 + 0.00003;

  it('rejects a value a third of a step above the nearest lattice point', () => {
    expect(isOnStep(LOWER, UPPER, STEP, OFF)).toBe(false);
    expect(nearestStepValue(LOWER, UPPER, STEP, OFF).onStep).toBe(false);
  });

  it('rejects it as a factor value and as a fixed value', () => {
    expect(validateFactorValue(discrete('X', LOWER, UPPER, STEP), OFF)).toBe('opt.issue.valueOffStep');
    const held = factor('X', { kind: 'discrete', lower: LOWER, upper: UPPER, step: STEP, fixed: true, fixedValue: OFF });
    expect(factorIssues(held)).toContain('opt.issue.fixedOffStep');
  });

  it('the optimiser refuses the fixed value instead of evaluating it', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [
        factor('A', { kind: 'discrete', lower: LOWER, upper: UPPER, step: STEP, fixed: true, fixedValue: OFF }),
        factor('B', { fixed: true, fixedValue: 0 }),
      ],
      { allowExtrapolation: true, maxEvaluations: 200, timeLimitMs: 1000 },
    );
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.fixedOffStep');
  });

  it('never lets the tolerance reach a neighbouring lattice point', () => {
    // Half a step from both neighbours: neither may claim it.
    const halfway = 1e8 + 0.00005;
    expect(isOnStep(LOWER, UPPER, STEP, halfway)).toBe(false);
    // A whole step above Lower is a lattice point, whatever the offset.
    expect(isOnStep(LOWER, UPPER, STEP, 1e8 + 0.0001)).toBe(true);
  });
});

/* ── R-02/R-05 · the real lattice of a large offset still works ────────── */

describe('[R-03] a real lattice point at a large offset is still accepted', () => {
  const LOWER = 1e8;
  const STEP = 0.0001;
  const UPPER = 1e8 + 0.001;

  it('accepts every lattice value it lists, and lists them exactly', () => {
    const axis = discreteAxis(LOWER, UPPER, STEP);
    expect(axis.values).toHaveLength(11);
    expect(axis.values[0]).toBe(LOWER);
    axis.values.forEach((value, index) => {
      expect(value).toBe(discreteValueAt(LOWER, STEP, index));
      expect(isOnStep(LOWER, UPPER, STEP, value)).toBe(true);
    });
  });

  it('keeps a legal discrete search and a legal fixed value', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [
        factor('A', { kind: 'discrete', lower: LOWER, upper: UPPER, step: STEP, fixed: true, fixedValue: discreteValueAt(LOWER, STEP, 7) }),
        factor('B', { fixed: true, fixedValue: 0 }),
      ],
      { allowExtrapolation: true, maxEvaluations: 200, timeLimitMs: 1000 },
    );
    expect(result.status).not.toBe('invalid');
    expect(result.issues).not.toContain('opt.issue.fixedOffStep');
  });
});

/* ── R-03 · CrossCheck compares the interval it claims to cover ────────── */

describe('[R-03] CrossCheck covers the confidence interval and the non-estimable list', () => {
  /** A covariance and df but no mse: a CI and no PI, so only the CI can differ. */
  function ciOnly(): StoredModel {
    return model(
      [numeric('A')],
      [['Constant', 1], ['A', 2]],
      { bounds: { A: { min: -1, max: 1 } }, covariance: [[0.04, 0], [0, 0.04]], df: 5 },
    );
  }

  it('fails when only the confidence bounds disagree', () => {
    const stored = ciOnly();
    // The adapter is compiled once per model: build it against df = 5, then let
    // the model carry df = 30 (a re-fit in place). The mean and the standard
    // error are identical; only the t basis — and so both CI bounds — differ.
    createPredictionAdapter(stored);
    (stored.residual as { df: number }).df = 30;
    const checked = crossCheck(stored, { A: 0.3 });
    expect(checked.ciHalf).not.toBeNull();
    expect(checked.delta.ci).toBeGreaterThan(0);
    expect(checked.consistent).toBe(false);
  });

  it('reports the bounds it compared, not a placeholder', () => {
    const sound = crossCheck(ciOnly(), { A: 0.3 });
    expect(sound.delta.ci).toBe(0);
    expect(sound.consistent).toBe(true);
    const scale = Math.max(1, Math.abs(sound.value ?? 0));
    expect(sound.delta.value).toBeLessThan(1e-12 * scale);
  });

  it('reports the non-estimable list it compares, alongside the numbers', () => {
    const sound = crossCheck(ciOnly(), { A: 0.3 });
    expect(sound.nonEstimable).toEqual([]);
    expect(sound.delta.nonEstimable).toBe(0);
    expect(sound.consistent).toBe(true);

    // An aliased coefficient: both paths must name it, and agree while doing so.
    const aliased = ciOnly();
    aliased.coefficients[1] = { ...aliased.coefficients[1], estimable: false };
    const guarded = crossCheck(aliased, { A: 0.3 });
    expect(guarded.nonEstimable).toEqual(['A']);
    expect(guarded.delta.nonEstimable).toBe(0);
    expect(guarded.value).toBeNull();
    expect(guarded.consistent).toBe(true);
  });
});

/* ── R-04 · a project's inner records are validated, not pruned ────────── */

describe('[R-04] a project with a damaged inner record is refused, not pruned', () => {
  const settings = { theme: 'light' as const, lang: 'en' as const };
  const sheet = DATASETS[0].build();
  const sound = () => buildProject({ worksheets: [sheet], activeSheetId: sheet.id, settings, outputs: [] }) as unknown as Record<string, unknown>;

  it('refuses a damaged figure instead of dropping it from the restore', () => {
    const file = sound();
    file.figures = [{ format: 'sigrun-layout' }];
    expect(() => parseProject(JSON.stringify(file))).toThrow('file.figureCorrupt');
  });

  it('keeps a sound figure', () => {
    const file = sound();
    const layout = createLayout('a4-landscape');
    file.figures = [layout];
    const restored = parseProject(JSON.stringify(file));
    expect(restored.figures).toHaveLength(1);
    expect(restored.figures?.[0].page.preset).toBe('a4-landscape');
  });

  it('refuses two worksheets that share an id', () => {
    const file = sound();
    const second = DATASETS[1].build();
    file.worksheets = [sheet, { ...second, id: sheet.id, name: 'Copy' }];
    expect(() => parseProject(JSON.stringify(file))).toThrow('file.worksheetDuplicate');
  });

  it('refuses two stored models that share an id', () => {
    const file = sound();
    const first = quadratic();
    file.models = [first, { ...quadratic(), id: first.id }];
    expect(() => parseProject(JSON.stringify(file))).toThrow('file.modelDuplicate');
  });

  it('refuses a stored model whose own schema is damaged', () => {
    const file = sound();
    const broken = JSON.parse(JSON.stringify(quadratic())) as Record<string, unknown>;
    broken.predictors = [{ id: '', kind: 'numeric' }];
    file.models = [broken];
    expect(() => parseProject(JSON.stringify(file))).toThrow('file.modelCorrupt');

    const coefficients = JSON.parse(JSON.stringify(quadratic())) as Record<string, unknown>;
    coefficients.coefficients = [{ label: 'A', value: 'not a number', estimable: true }];
    file.models = [coefficients];
    expect(() => parseProject(JSON.stringify(file))).toThrow('file.modelCorrupt');

    const covariance = JSON.parse(JSON.stringify(quadratic())) as Record<string, unknown>;
    covariance.covariance = [[1, 0], [0, 1]];
    file.models = [covariance];
    expect(() => parseProject(JSON.stringify(file))).toThrow('file.modelCorrupt');
  });

  it('refuses a damaged output card and a damaged custom style', () => {
    const file = sound();
    file.outputs = [{ id: 'out-1', blocks: 'not an array' }];
    expect(() => parseProject(JSON.stringify(file))).toThrow('file.outputCorrupt');

    const other = sound();
    other.customChartStyles = [{ id: 'style-1', name: 'Mine', base: 'no-such-preset' }];
    expect(() => parseProject(JSON.stringify(other))).toThrow('file.styleCorrupt');
  });

  it('still round-trips a sound project with every record kind', () => {
    const layout = createLayout('a4-portrait');
    const style = { id: 'style-1', name: 'Mine', base: 'sigrun-classic' as const, overrides: {} };
    const text = serializeProject({
      worksheets: [sheet],
      activeSheetId: sheet.id,
      settings,
      outputs: [{ id: 'out-1', titleKey: 'an.desc', createdAt: 1, collapsed: false, blocks: [{ type: 'table', headers: ['Mean'], rows: [[1.5]] }] }],
      customChartStyles: [style],
      models: [quadratic()],
      figures: [layout],
    });
    const restored = parseProject(text);
    expect(restored.outputs).toHaveLength(1);
    expect(restored.customChartStyles?.[0].id).toBe('style-1');
    expect(restored.models).toHaveLength(1);
    expect(restored.figures).toHaveLength(1);
  });
});

/* ── R-05 · a lattice with a single allowed value ──────────────────────── */

describe('[R-05] a lattice whose range is shorter than one step still has its one value', () => {
  it('lists Lower as the only candidate', () => {
    const axis = discreteAxis(0, 0.5, 1);
    expect(axis.values).toEqual([0]);
    expect(axis.count).toBe(1);
    expect(axis.truncated).toBe(false);
  });

  it('accepts Lower and refuses anything else', () => {
    expect(validateFactorValue(discrete('X', 0, 0.5, 1), 0)).toBeNull();
    expect(validateFactorValue(discrete('X', 0, 0.5, 1), 0.5)).toBe('opt.issue.valueOffStep');
  });

  it('the optimiser searches that one candidate instead of refusing the factor', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [discrete('A', 0, 0.5, 1), factor('B', { fixed: true, fixedValue: 0 })],
      { allowExtrapolation: true, maxEvaluations: 200, timeLimitMs: 1000 },
    );
    expect(result.status).not.toBe('invalid');
    expect(result.issues).toEqual([]);
    expect(result.solutions[0].settings.A).toBe(0);
  });

  it('the profiler draws the one position it has', () => {
    const stored = quadratic();
    const rows = profileCurves([stored], [responseFor(stored)], [discrete('A', 0, 0.5, 1), factor('B', { fixed: true, fixedValue: 0 })], {}, { resolution: 5 });
    expect(rows[0].curves[0].xs).toEqual([0]);
    expect(rows[0].curves[0].mean).toHaveLength(1);
    expect(Number.isFinite(rows[0].curves[0].mean[0])).toBe(true);
  });
});
