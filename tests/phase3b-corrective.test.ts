import { describe, expect, it } from 'vitest';
import type { ModelVariable, StoredModel } from '../src/lib/modelStore';
import {
  ModelInputError,
  compileSurfaceEvaluator,
  predictStoredModel,
  type PredictionResult,
} from '../src/lib/modelPredictor';
import {
  buildOverlaid,
  intervalAvailability,
  type ResponseSpec,
} from '../src/lib/feasible';
import { buildOverlaidChart, materializeOverlaid } from '../src/lib/chartConfigOps';
import { parseProject } from '../src/lib/project';
import type { ChartSpec } from '../src/types';

/* ─────────────────────────────────────────────────────────────────────────
   Phase 3B Corrective QA — one test block per defect (F-01 … F-08).

   Each block is written against the behaviour the corrected engine must have,
   so on the baseline commit (2c50f48) the block fails for the reason the
   defect states and after the fix it passes. Fixtures build `StoredModel`
   records directly: the point of these cases is the coding, the covariance and
   the limits, not how a fit produced them.
   ───────────────────────────────────────────────────────────────────────── */

const COLUMN_ID: Record<string, string> = { A: 'C1', B: 'C2', C: 'C3' };

interface ModelSpec {
  id?: string;
  name: string;
  response?: string;
  coding?: Record<string, { mode: 'coded' | 'actual'; center: number; halfRange: number }>;
  units?: Record<string, string>;
  ids?: Record<string, string>;
  coefficients: { label: string; value: number; estimable?: boolean }[];
  covariance?: number[][] | null;
  residual?: { mse?: number; df?: number } | null;
  bounds?: Record<string, [number, number]>;
}

function identityCovariance(size: number, diagonal = 0.04): number[][] {
  return Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i === j ? diagonal : 0)));
}

function model(spec: ModelSpec): StoredModel {
  const names = [...new Set(spec.coefficients.flatMap((coefficient) => (
    coefficient.label === 'Constant' ? [] : coefficient.label.split('×').map((part) => part.replace(/[²³]|\[.*\]$/g, ''))
  )))];
  const predictors: ModelVariable[] = names.map((name) => ({
    id: spec.ids?.[name] ?? COLUMN_ID[name] ?? name,
    name,
    kind: 'numeric',
    ...(spec.units?.[name] ? { unit: spec.units[name] } : {}),
    ...(spec.coding?.[name] ? { coding: spec.coding[name] } : {}),
  }));
  const size = spec.coefficients.length;
  return {
    format: 'sigrun-model',
    version: 1,
    id: spec.id ?? `m-${spec.name}`,
    name: spec.name,
    kind: 'rsm',
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    response: { id: 'R', name: spec.response ?? spec.name, kind: 'numeric' },
    predictors,
    terms: [],
    coefficients: spec.coefficients.map((coefficient) => ({
      label: coefficient.label,
      value: coefficient.value,
      estimable: coefficient.estimable ?? true,
    })),
    covariance: spec.covariance === undefined ? identityCovariance(size) : spec.covariance,
    residual: spec.residual === undefined ? { mse: 0.5, df: 10 } : spec.residual,
    dof: { model: size - 1, residual: 10, total: size + 9, rank: size },
    factorBounds: spec.bounds
      ? Object.fromEntries(Object.entries(spec.bounds).map(([key, [min, max]]) => [key, { min, max }]))
      : null,
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
}

function specOf(entry: StoredModel, lsl: number | null, usl: number | null, target: number | null = null): ResponseSpec {
  return { model: entry, lsl, usl, target };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof ModelInputError) return error.code;
    return (error as Error).message;
  }
  return 'no-throw';
}

/** A model that answers every question: unit covariance, df and mse. */
function healthy(name: string, response?: string, coefficients?: ModelSpec['coefficients']): StoredModel {
  return model({
    name,
    response,
    coefficients: coefficients ?? [
      { label: 'Constant', value: 10 },
      { label: 'A', value: 2 },
      { label: 'B', value: -1 },
      { label: 'A×B', value: 0.5 },
      { label: 'A²', value: 0 },
      { label: 'B²', value: -0.25 },
    ],
    coding: {
      A: { mode: 'coded', center: 0, halfRange: 1 },
      B: { mode: 'coded', center: 0, halfRange: 1 },
    },
    bounds: { A: [-1, 1], B: [-1, 1] },
  });
}

/* ── F-01: each model is evaluated in its own coding ──────────────────── */

describe('F-01 model-specific factor transformation', () => {
  const centered = model({
    id: 'center-2',
    name: 'Centered',
    coding: { A: { mode: 'coded', center: 0, halfRange: 2 }, B: { mode: 'coded', center: 0, halfRange: 1 } },
    coefficients: [
      { label: 'Constant', value: 10 },
      { label: 'A', value: 2 },
      { label: 'B', value: 1 },
    ],
    bounds: { A: [-2, 2], B: [-1, 1] },
  });
  const shifted = model({
    id: 'shift-10',
    name: 'Shifted',
    coding: { A: { mode: 'coded', center: 10, halfRange: 5 }, B: { mode: 'coded', center: 0, halfRange: 1 } },
    coefficients: [
      { label: 'Constant', value: 100 },
      { label: 'A', value: 3 },
      { label: 'B', value: 2 },
    ],
    bounds: { A: [0, 20], B: [-1, 1] },
  });

  it('evaluates every model at the same actual coordinate with its own coding', () => {
    const result = buildOverlaid([centered, shifted], [
      specOf(centered, 0, 30),
      specOf(shifted, 0, 120),
    ], {
      xName: 'A', yName: 'B', xRange: [-2, 2], yRange: [-1, 1], resolution: 11, mode: 'actual', basis: 'mean',
    });
    const batch = result.xs;
    batch.forEach((x, i) => {
      const y = result.ys[4];
      const expected0 = predictStoredModel(centered, { A: x, B: y }, { mode: 'actual' }).value as number;
      const expected1 = predictStoredModel(shifted, { A: x, B: y }, { mode: 'actual' }).value as number;
      expect(result.responses[0].z[4][i]).toBeCloseTo(expected0, 9);
      expect(result.responses[1].z[4][i]).toBeCloseTo(expected1, 9);
    });
    // The shifted model reads A with center 10 / halfRange 5: actual 2 is coded −1.6.
    expect(result.responses[1].z[4][10]).toBeCloseTo(100 + 3 * -1.6 + 2 * result.ys[4], 9);
  });

  it('reads a coded display range with the stated reference model', () => {
    // Models in the reverse order, reference is the shifted one: coded ±1 must
    // mean actual 10 ± 5, not actual ± 1 of the first model in the array.
    const result = buildOverlaid([shifted, centered], [
      specOf(shifted, 0, 120),
      specOf(centered, 0, 30),
    ], {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 11, mode: 'coded',
      basis: 'mean', referenceModelId: 'shift-10',
    });
    expect(result.xs[0]).toBeCloseTo(-1, 12);
    const actualFirst = 10 + 5 * -1;
    expect(result.responses[0].z[5][0]).toBeCloseTo(100 + 3 * -1, 9);
    expect(result.responses[1].z[5][0]).toBeCloseTo(predictStoredModel(centered, { A: actualFirst, B: 0 }, { mode: 'actual' }).value as number, 9);
  });

  it('mixes an actual-coding model with a coded-coding model at one physical point', () => {
    const actual = model({
      id: 'actual-mode',
      name: 'Actual',
      coding: { A: { mode: 'actual', center: 0, halfRange: 1 }, B: { mode: 'actual', center: 0, halfRange: 1 } },
      coefficients: [{ label: 'Constant', value: 5 }, { label: 'A', value: 4 }, { label: 'B', value: 0 }],
      bounds: { A: [-2, 2], B: [-1, 1] },
    });
    const result = buildOverlaid([actual, centered], [
      specOf(actual, 0, 100),
      specOf(centered, 0, 100),
    ], {
      xName: 'A', yName: 'B', xRange: [-2, 2], yRange: [-1, 1], resolution: 11, mode: 'actual', basis: 'mean',
    });
    result.xs.forEach((x, i) => {
      // The actual-coding model reads A directly; the coded one reads (A − 0)/2.
      const held = result.ys[4];
      expect(result.responses[0].z[4][i]).toBeCloseTo(5 + 4 * x, 9);
      expect(result.responses[1].z[4][i]).toBeCloseTo(10 + 2 * (x / 2) + 1 * held, 9);
    });
  });
});

/* ── F-02: no silent fallback from an interval basis ──────────────────── */

describe('F-02 interval basis is refused, never downgraded to the mean', () => {
  const first = healthy('Yield');
  const blocked = { ...healthy('Strength'), covariance: null, residual: { mse: 0.5, df: 10 } };

  it('throws a structured code naming the models that cannot answer', () => {
    let caught: ModelInputError | null = null;
    try {
      buildOverlaid([first, blocked], [specOf(first, 0, 30), specOf(blocked, 0, 30)], {
        xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'confidence',
      });
    } catch (error) {
      caught = error as ModelInputError;
    }
    expect(caught).toBeInstanceOf(ModelInputError);
    expect(caught?.code).toBe('feasible.basisUnsupported');
    const payload = caught?.detail as { basis: string; blocked: { model: string; reasons: string[] }[] };
    expect(payload.basis).toBe('confidence');
    expect(payload.blocked.map((entry) => entry.model)).toEqual(['Strength']);
    expect(payload.blocked[0].reasons.join(' ')).toContain('covariance');
  });

  it('still answers the mean basis for the same models', () => {
    const mean = buildOverlaid([first, blocked], [specOf(first, 0, 30), specOf(blocked, 0, 30)], {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'mean',
    });
    expect(mean.totalNodes).toBe(121);
    expect(mean.intervalBlocked).toEqual(['Strength']);
  });

  it('refuses a prediction basis when the residual variance is missing', () => {
    const noMse = { ...healthy('NoMse'), residual: { df: 10 } };
    expect(codeOf(() => buildOverlaid([first, noMse], [specOf(first, 0, 30), specOf(noMse, 0, 30)], {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'prediction',
    }))).toBe('feasible.basisUnsupported');
    // …but a confidence interval only needs the covariance and the df.
    const ci = buildOverlaid([first, noMse], [specOf(first, 0, 30), specOf(noMse, 0, 30)], {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'confidence',
    });
    expect(ci.intervalBlocked).toEqual([]);
  });

  it('reports the reason per model, not just the name', () => {
    const report = intervalAvailability([first, blocked]);
    expect(report.ok).toBe(false);
    expect(report.blocked).toEqual(['Strength']);
    expect(report.details?.[0]).toMatchObject({ model: 'Strength' });
    expect(report.details?.[0].reasons.length).toBeGreaterThan(0);
  });
});

/* ── F-03: one point's state never leaks into the next ────────────────── */

describe('F-03 prediction state is isolated per call', () => {
  const aliased = model({
    name: 'Aliased',
    coefficients: [
      { label: 'Constant', value: 5 },
      { label: 'A', value: 2 },
      { label: 'B', value: 0 },
      { label: 'A²', value: 3, estimable: false },
    ],
    coding: { A: { mode: 'coded', center: 0, halfRange: 1 }, B: { mode: 'coded', center: 0, halfRange: 1 } },
    bounds: { A: [-1, 1], B: [-1, 1] },
  });

  it('keeps an estimable node finite after a non-estimable one was evaluated', () => {
    const evaluator = compileSurfaceEvaluator(aliased, { xName: 'A', yName: 'B' });
    const first = evaluator.evaluate(1, 0);
    expect(first.nonEstimable).toEqual(['A²']);
    expect(first.value).toBeNull();
    const centre = evaluator.evaluate(0, 0);
    expect(centre.nonEstimable).toEqual([]);
    expect(centre.value).toBeCloseTo(5, 12);
    // Reversed order must give the same answers.
    const second = compileSurfaceEvaluator(aliased, { xName: 'A', yName: 'B' });
    expect(second.evaluate(0, 0).value).toBeCloseTo(5, 12);
    expect(second.evaluate(1, 0).value).toBeNull();
    expect(second.evaluate(0, 0).value).toBeCloseTo(5, 12);
  });

  it('fills only the nodes that actually lean on the aliased term with NaN', () => {
    const evaluator = compileSurfaceEvaluator(aliased, { xName: 'A', yName: 'B' });
    const resolution = 11;
    const xs = Array.from({ length: resolution }, (_, i) => -1 + (2 * i) / (resolution - 1));
    const z = xs.map((x) => xs.map((y) => evaluator.value(x, y)));
    const finite = z.flat().filter((value) => Number.isFinite(value));
    expect(finite).toHaveLength(resolution); // the x = 0 column only
    expect(finite.every((value) => Math.abs((value as number) - 5) < 1e-12)).toBe(true);
  });

  it('does not change a grid when the traversal order is reversed', () => {
    const evaluator = compileSurfaceEvaluator(aliased, { xName: 'A', yName: 'B' });
    const xs = [-1, -0.5, 0, 0.5, 1];
    const forward = xs.map((x) => xs.map((y) => evaluator.evaluate(x, y)));
    const backward = [...xs].reverse().map((x) => [...xs].reverse().map((y) => evaluator.evaluate(x, y)));
    backward.forEach((row, j) => row.forEach((node, i) => {
      const mirror = forward[xs.length - 1 - j][xs.length - 1 - i];
      expect(node.value).toBe(mirror.value);
      expect(node.nonEstimable).toEqual(mirror.nonEstimable);
    }));
  });

  it('collects the non-estimable terms of a whole grid separately from the per-node state', () => {
    const other = healthy('Other');
    const result = buildOverlaid([aliased, other], [specOf(aliased, 0, 100), specOf(other, 0, 100)], {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'mean',
    });
    expect(result.responses[0].nonEstimable).toEqual(['A²']);
    const finite = result.responses[0].z.flat().filter((value) => Number.isFinite(value));
    expect(finite).toHaveLength(11);
    // The healthy response is untouched by its neighbour's NaN.
    expect(result.responses[1].z.flat().every((value) => Number.isFinite(value))).toBe(true);
  });
});

/* ── F-04: a non-finite input never becomes a number ──────────────────── */

describe('F-04 non-finite values invalidate the prediction', () => {
  it('refuses to return a partial sum when a term overflows', () => {
    const overflow = model({
      name: 'Overflow',
      coefficients: [
        { label: 'Constant', value: 1 },
        { label: 'A', value: 1 },
        { label: 'A²', value: 1 },
        { label: 'B', value: 0 },
      ],
    });
    const result = predictStoredModel(overflow, { A: 1e200, B: 0 }, { mode: 'actual' });
    expect(result.value).toBeNull();
    expect(result.issues).toContain('model.value.nonFinite');
  });

  it('names a non-finite coefficient instead of calling it aliased', () => {
    const broken = model({
      name: 'Broken',
      coefficients: [
        { label: 'Constant', value: 1 },
        { label: 'A', value: Number.POSITIVE_INFINITY },
      ],
    });
    const result = predictStoredModel(broken, { A: 1 }, { mode: 'actual' });
    expect(result.value).toBeNull();
    expect(result.issues).toContain('model.coefficient.nonFinite');
    expect(result.nonEstimable).toEqual([]);
  });

  it('refuses a non-finite design weight', () => {
    const evaluator = compileSurfaceEvaluator(model({
      name: 'Cubic',
      coefficients: [
        { label: 'Constant', value: 0 },
        { label: 'A³', value: 1 },
        { label: 'B', value: 0 },
      ],
      coding: { A: { mode: 'coded', center: 0, halfRange: 1 }, B: { mode: 'coded', center: 0, halfRange: 1 } },
    }), { xName: 'A', yName: 'B' });
    expect(evaluator.evaluate(1e200, 0).value).toBeNull();
    expect(evaluator.evaluate(1e200, 0).issues).toContain('model.value.nonFinite');
  });

  it('will not compute a variance through a NaN covariance entry', () => {
    const bad = model({
      name: 'NaN covariance',
      coefficients: [{ label: 'Constant', value: 1 }, { label: 'A', value: 2 }],
      covariance: [[0.04, Number.NaN], [0, 0.04]],
    });
    const result = predictStoredModel(bad, { A: 1 }, { mode: 'actual' });
    expect(result.value).toBeCloseTo(3, 12);
    expect(result.se).toBeNull();
    expect(result.issues.join(' ')).toContain('model.covariance.nonFinite');
  });

  it('refuses an asymmetric covariance and a covariance of the wrong size', () => {
    const asymmetric = model({
      name: 'Asymmetric',
      coefficients: [{ label: 'Constant', value: 1 }, { label: 'A', value: 2 }],
      covariance: [[0.04, 0.01], [0.03, 0.04]],
    });
    expect(predictStoredModel(asymmetric, { A: 1 }, { mode: 'actual' }).se).toBeNull();
    expect(predictStoredModel(asymmetric, { A: 1 }, { mode: 'actual' }).issues.join(' ')).toContain('model.covariance.asymmetric');

    const wrongSize = model({
      name: 'Wrong size',
      coefficients: [{ label: 'Constant', value: 1 }, { label: 'A', value: 2 }, { label: 'B', value: 3 }],
      covariance: [[0.04, 0], [0, 0.04]],
    });
    expect(predictStoredModel(wrongSize, { A: 1, B: 1 }, { mode: 'actual' }).se).toBeNull();
    expect(predictStoredModel(wrongSize, { A: 1, B: 1 }, { mode: 'actual' }).issues.join(' ')).toContain('model.covariance.size');
  });

  it('tells a rounding-level negative variance from a real one', () => {
    const tiny = model({
      name: 'Tiny negative',
      coefficients: [{ label: 'Constant', value: 1 }, { label: 'A', value: 2 }],
      covariance: [[-1e-14, 0], [0, -1e-14]],
    });
    const clamped = predictStoredModel(tiny, { A: 1 }, { mode: 'actual' });
    expect(clamped.value).toBeCloseTo(3, 12);
    expect(clamped.se).toBe(0);

    const negative = model({
      name: 'Real negative',
      coefficients: [{ label: 'Constant', value: 1 }, { label: 'A', value: 2 }],
      covariance: [[-0.5, 0], [0, 0.04]],
    });
    const refused = predictStoredModel(negative, { A: 1 }, { mode: 'actual' });
    expect(refused.se).toBeNull();
    expect(refused.issues.join(' ')).toContain('model.covariance.negativeVariance');
  });

  it('never draws a non-finite node as a value on a surface', () => {
    const overflow = model({
      name: 'Overflow surface',
      coefficients: [{ label: 'Constant', value: 1 }, { label: 'A³', value: 1 }, { label: 'B', value: 0 }],
      coding: { A: { mode: 'coded', center: 0, halfRange: 1 }, B: { mode: 'coded', center: 0, halfRange: 1 } },
      bounds: { A: [-1e200, 1e200], B: [-1, 1] },
    });
    const other = healthy('Healthy');
    const result = buildOverlaid([overflow, other], [specOf(overflow, 0, 10), specOf(other, 0, 10)], {
      xName: 'A', yName: 'B', xRange: [-1e200, 1e200], yRange: [-1, 1], resolution: 11, mode: 'actual', basis: 'mean',
    });
    expect(result.responses[0].z.flat().every((value) => !Number.isFinite(value) || Math.abs(value) < 1e300)).toBe(true);
    expect(result.responses[0].z[0][0]).toBe(Number.NaN);
  });
});

/* ── F-05: extrapolation is judged for every model and every factor ───── */

describe('F-05 multi-model extrapolation detection', () => {
  const wide = model({
    id: 'wide',
    name: 'Wide',
    coefficients: [{ label: 'Constant', value: 10 }, { label: 'A', value: 1 }, { label: 'B', value: 0 }, { label: 'C', value: 0 }],
    coding: {
      A: { mode: 'coded', center: 0, halfRange: 1 },
      B: { mode: 'coded', center: 0, halfRange: 1 },
      C: { mode: 'coded', center: 0, halfRange: 1 },
    },
    bounds: { A: [-4, 4], B: [-1, 1], C: [-1, 1] },
  });
  const narrow = model({
    id: 'narrow',
    name: 'Narrow',
    coefficients: [{ label: 'Constant', value: 20 }, { label: 'A', value: 1 }, { label: 'B', value: 0 }, { label: 'C', value: 0 }],
    coding: {
      A: { mode: 'coded', center: 0, halfRange: 1 },
      B: { mode: 'coded', center: 0, halfRange: 1 },
      C: { mode: 'coded', center: 0, halfRange: 1 },
    },
    bounds: { A: [0, 2], B: [-1, 1], C: [-1, 1] },
  });

  it('flags a model whose own range is exceeded even when models[0] is not', () => {
    const result = buildOverlaid([wide, narrow], [specOf(wide, 0, 100), specOf(narrow, 0, 100)], {
      xName: 'A', yName: 'B', xRange: [0, 4], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'mean',
    });
    expect(result.extrapolated).toBe(true);
    const detail = result.extrapolation.details.find((entry) => entry.model === 'Narrow' && entry.factor === 'A');
    expect(detail).toBeTruthy();
    expect(detail?.kind).toBe('axis');
    expect(detail?.bound).toEqual({ min: 0, max: 2 });
  });

  it('flags a holding value outside the model’s own range', () => {
    const result = buildOverlaid([wide, narrow], [specOf(wide, 0, 100), specOf(narrow, 0, 100)], {
      xName: 'A', yName: 'B', xRange: [0, 1], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'mean',
      holdings: { C: 3 },
    });
    expect(result.extrapolated).toBe(true);
    expect(result.extrapolation.details.some((entry) => entry.kind === 'holding' && entry.factor === 'C')).toBe(true);
  });

  it('does not flag a range every model covers', () => {
    const result = buildOverlaid([wide, narrow], [specOf(wide, 0, 100), specOf(narrow, 0, 100)], {
      xName: 'A', yName: 'B', xRange: [0, 2], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'mean',
    });
    expect(result.extrapolated).toBe(false);
    expect(result.extrapolation.details).toEqual([]);
  });

  it('defaults the search range to the intersection of every model’s run range', () => {
    const chart = buildOverlaidChart([wide, narrow], {
      xName: 'A',
      yName: 'B',
      unitMode: 'coded',
      resolution: 11,
      basis: 'mean',
      alpha: 0.05,
      specs: [
        { name: 'Wide', lsl: 0, usl: 100, target: 50 },
        { name: 'Narrow', lsl: 0, usl: 100, target: 50 },
      ],
    });
    expect(chart.xRange).toEqual([0, 2]);
    expect(chart.rangeWarning).toBeUndefined();
  });
});

/* ── F-06: convergence compares two different grids ───────────────────── */

describe('F-06 grid convergence', () => {
  const curved = model({
    name: 'Curved',
    coefficients: [
      { label: 'Constant', value: 10 },
      { label: 'A', value: 2 },
      { label: 'B', value: 2 },
      { label: 'A²', value: 1 },
      { label: 'B²', value: 1 },
    ],
    coding: { A: { mode: 'coded', center: 0, halfRange: 1 }, B: { mode: 'coded', center: 0, halfRange: 1 } },
    bounds: { A: [-1, 1], B: [-1, 1] },
  });
  const other = model({
    name: 'Flat',
    coefficients: [{ label: 'Constant', value: 5 }, { label: 'A', value: 0 }, { label: 'B', value: 0 }],
    coding: { A: { mode: 'coded', center: 0, halfRange: 1 }, B: { mode: 'coded', center: 0, halfRange: 1 } },
    bounds: { A: [-1, 1], B: [-1, 1] },
  });
  const specs = [specOf(curved, 5, 11.5), specOf(other, 0, 10)];

  it('compares 401 with 201 instead of 401 with itself', () => {
    const ultra = buildOverlaid([curved, other], specs, {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 401, mode: 'coded', basis: 'mean',
    });
    expect(ultra.convergence.count).toBe(401);
    expect(ultra.convergence.neighborCount).toBe(201);
    expect(ultra.convergence.direction).toBe('coarsened');
    const half = buildOverlaid([curved, other], specs, {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 201, mode: 'coded', basis: 'mean',
    });
    expect(ultra.convergence.nodeDelta).toBeCloseTo(Math.abs(ultra.nodeRatio - half.nodeRatio), 12);
    expect(ultra.convergence.nodeDelta).toBeGreaterThan(0);
    expect(ultra.convergence.areaDelta).toBeCloseTo(Math.abs(ultra.areaRatio - half.areaRatio), 12);
    expect(ultra.convergenceDelta).toBe(ultra.convergence.nodeDelta);
  }, 120000);

  it('refines a coarse grid and states the direction', () => {
    const coarse = buildOverlaid([curved, other], specs, {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 101, mode: 'coded', basis: 'mean',
    });
    expect(coarse.convergence.neighborCount).toBe(202);
    expect(coarse.convergence.direction).toBe('refined');
    expect(coarse.convergence.nodeDelta).toBeGreaterThan(0);
  });
});

/* ── F-07: what each interval needs, stated and enforced ──────────────── */

describe('F-07 interval availability conditions', () => {
  const base = healthy('Base');

  it('needs a residual variance for a prediction interval and will not use 0', () => {
    const noMse = { ...base, residual: { df: 8 } };
    const evaluator = compileSurfaceEvaluator(noMse, { xName: 'A', yName: 'B' });
    expect(evaluator.ciHalf(0, 0)).toBeGreaterThan(0);
    expect(evaluator.piHalf(0, 0)).toBeNull();
    expect(evaluator.intervalStatus.pi).toBe(false);
    expect(evaluator.intervalStatus.reasons).toContain('model.mse.missing');
    const prediction: PredictionResult = predictStoredModel(noMse, { A: 0, B: 0 }, { mode: 'coded' });
    expect(prediction.se).toBeGreaterThan(0);
    expect(prediction.pi).toBeNull();
  });

  it('accepts a zero residual variance as a real value', () => {
    const exact = { ...base, residual: { mse: 0, df: 8 } };
    const evaluator = compileSurfaceEvaluator(exact, { xName: 'A', yName: 'B' });
    expect(evaluator.piHalf(0, 0)).toBeCloseTo(evaluator.ciHalf(0, 0) as number, 12);
    expect(predictStoredModel(exact, { A: 0, B: 0 }, { mode: 'coded' }).pi).not.toBeNull();
  });

  it('needs degrees of freedom and a usable covariance', () => {
    const noDf = { ...base, residual: { mse: 0.5 } };
    expect(compileSurfaceEvaluator(noDf, { xName: 'A', yName: 'B' }).ciHalf(0, 0)).toBeNull();
    expect(compileSurfaceEvaluator(noDf, { xName: 'A', yName: 'B' }).intervalStatus.reasons).toContain('model.df.missing');
    const zeroDf = { ...base, residual: { mse: 0.5, df: 0 } };
    expect(compileSurfaceEvaluator(zeroDf, { xName: 'A', yName: 'B' }).ciHalf(0, 0)).toBeNull();
    expect(intervalAvailability([base, noDf]).blocked).toEqual(['Base'.replace('Base', 'Base')]);
  });

  it('restricts the intervals of a rank-deficient fit and says why', () => {
    const rank = model({
      name: 'Rank deficient',
      coefficients: [
        { label: 'Constant', value: 1 },
        { label: 'A', value: 2 },
        { label: 'B', value: 0 },
        { label: 'A²', value: 0, estimable: false },
      ],
    });
    const evaluator = compileSurfaceEvaluator(rank, { xName: 'A', yName: 'B' });
    expect(evaluator.intervalStatus.ci).toBe(false);
    expect(evaluator.intervalStatus.reasons).toContain('model.rankDeficient');
    expect(evaluator.se(0, 0)).toBeNull();
    const prediction = predictStoredModel(rank, { A: 0, B: 0 }, { mode: 'coded' });
    expect(prediction.value).toBeCloseTo(1, 12);
    expect(prediction.se).toBeNull();
    expect(prediction.issues).toContain('model.rankDeficient');
  });

  it('rejects an alpha outside (0, 1)', () => {
    const second = healthy('B2');
    expect(codeOf(() => buildOverlaid([base, second], [specOf(base, 0, 30), specOf(second, 0, 30)], {
      xName: 'A', yName: 'B', xRange: [-1, 1], yRange: [-1, 1], resolution: 11, mode: 'coded', basis: 'mean', alpha: 1.2,
    }))).toBe('feasible.alpha.invalid');
  });
});

/* ── F-08: the engine validates its own input ─────────────────────────── */

describe('F-08 engine input validation', () => {
  const first = healthy('Yield');
  const second = healthy('Strength', 'Strength');
  const ok = {
    xName: 'A', yName: 'B', xRange: [-1, 1] as [number, number], yRange: [-1, 1] as [number, number],
    resolution: 11, mode: 'coded' as const, basis: 'mean' as const,
  };
  const specs = [specOf(first, 0, 30), specOf(second, 0, 30)];

  it('needs at least two models', () => {
    expect(codeOf(() => buildOverlaid([first], [specOf(first, 0, 30)], ok))).toBe('feasible.minModels');
  });

  it('rejects a spec list that does not line up with the models', () => {
    expect(codeOf(() => buildOverlaid([first, second], [specOf(first, 0, 30)], ok))).toBe('feasible.specMismatch');
    const swapped = [specOf(second, 0, 30), specOf(first, 0, 30)];
    expect(codeOf(() => buildOverlaid([first, second], swapped, ok))).toBe('feasible.specMismatch');
  });

  it('rejects duplicate model ids and duplicate response names', () => {
    const twin = { ...second, id: first.id };
    expect(codeOf(() => buildOverlaid([first, twin], [specOf(first, 0, 30), specOf(twin, 0, 30)], ok))).toBe('feasible.model.duplicate');
    const sameResponse = healthy('Yield2', 'Yield');
    expect(codeOf(() => buildOverlaid([first, sameResponse], [specOf(first, 0, 30), specOf(sameResponse, 0, 30)], ok))).toBe('feasible.response.duplicate');
  });

  it('rejects conflicting factor ids or units', () => {
    const otherId = { ...second, predictors: second.predictors.map((p) => (p.name === 'A' ? { ...p, id: 'C99' } : p)) };
    expect(codeOf(() => buildOverlaid([first, otherId], [specOf(first, 0, 30), specOf(otherId, 0, 30)], ok))).toBe('feasible.factor.conflict');
    const otherUnit = { ...second, predictors: second.predictors.map((p) => (p.name === 'A' ? { ...p, unit: '°F' } : p)) };
    const unitFirst = { ...first, predictors: first.predictors.map((p) => (p.name === 'A' ? { ...p, unit: '°C' } : p)) };
    expect(codeOf(() => buildOverlaid([unitFirst, otherUnit], [specOf(unitFirst, 0, 30), specOf(otherUnit, 0, 30)], ok))).toBe('feasible.factor.conflict');
  });

  it('rejects a missing axis factor and the same factor on both axes', () => {
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, xName: 'C' }))).toBe('feasible.factor.missing');
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, xName: 'A', yName: 'A' }))).toBe('feasible.factor.axis.duplicate');
  });

  it('rejects an unusable range or resolution', () => {
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, xRange: [1, 1] }))).toBe('feasible.range.invalid');
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, xRange: [Number.NaN, 1] }))).toBe('feasible.range.invalid');
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, resolution: 0 }))).toBe('feasible.resolution.invalid');
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, resolution: 2.5 }))).toBe('feasible.resolution.invalid');
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, resolution: 5000 }))).toBe('feasible.resolution.invalid');
  });

  it('rejects an impossible or non-finite specification', () => {
    const inverted = [specOf(first, 30, 10), specOf(second, 0, 30)];
    expect(codeOf(() => buildOverlaid([first, second], inverted, ok))).toBe('feasible.spec.invalid');
    const infinite = [specOf(first, 0, Number.POSITIVE_INFINITY), specOf(second, 0, 30)];
    expect(codeOf(() => buildOverlaid([first, second], infinite, ok))).toBe('feasible.spec.invalid');
  });

  it('rejects a holding value the model does not know', () => {
    const categorical = model({
      name: 'Categorical',
      coefficients: [
        { label: 'Constant', value: 1 },
        { label: 'A', value: 2 },
        { label: 'B', value: 0 },
        { label: 'Machine[L1]', value: 1 },
      ],
      coding: { A: { mode: 'coded', center: 0, halfRange: 1 }, B: { mode: 'coded', center: 0, halfRange: 1 } },
    });
    categorical.predictors.push({ id: 'C9', name: 'Machine', kind: 'categorical', levels: ['L1', 'L2'] });
    const plain = healthy('Plain');
    expect(codeOf(() => buildOverlaid([categorical, plain], [specOf(categorical, 0, 30), specOf(plain, 0, 30)], {
      ...ok, holdings: { Machine: 'L9' },
    }))).toBe('feasible.holding.invalid');
  });

  it('rejects an unknown basis and an unknown unit mode', () => {
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, basis: 'confidence99' as never }))).toBe('feasible.basis.invalid');
    expect(codeOf(() => buildOverlaid([first, second], specs, { ...ok, mode: 'both' as never }))).toBe('feasible.mode.invalid');
  });
});

/* ── F-02 (UI / restore): the same rule everywhere ────────────────────── */

describe('F-02 a stored or restored card keeps the refusal', () => {
  const first = healthy('Yield');
  const blocked = { ...healthy('Strength'), covariance: null };

  it('materializes a refused basis as an error, not as a mean region', () => {
    const chart: Extract<ChartSpec, { kind: 'overlaid' }> = {
      kind: 'overlaid',
      xs: [-1, 0, 1],
      ys: [-1, 0, 1],
      responses: [
        { name: 'Yield', lsl: 0, usl: 30, target: null, color: '#000', dash: '', z: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], mask: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], areaRatio: 1, nodeRatio: 1, zMin: 0, zMax: 0 },
        { name: 'Strength', lsl: 0, usl: 30, target: null, color: '#111', dash: '', z: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], mask: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], areaRatio: 1, nodeRatio: 1, zMin: 0, zMax: 0 },
      ],
      xLabel: 'A',
      yLabel: 'B',
      models: [first, blocked],
      feasible: {
        mask: [[1]], areaRatio: 1, nodeRatio: 1, feasibleNodes: 1, totalNodes: 1, basis: 'confidence',
        convergenceDelta: 0, perResponse: [], intervalBlocked: ['Strength'],
      },
      config: {
        feasible: {
          basis: 'confidence' as const,
          specs: [
            { name: 'Yield', lsl: 0, usl: 30, target: null },
            { name: 'Strength', lsl: 0, usl: 30, target: null },
          ],
          alpha: 0.05,
        },
        rsm: { xFactorIndex: 0, yFactorIndex: 1, unitMode: 'coded' as const },
      },
    };
    const after = materializeOverlaid(chart);
    expect(after.kind).toBe('overlaid');
    if (after.kind !== 'overlaid') return;
    expect(after.feasible?.error?.code).toBe('feasible.basisUnsupported');
    expect(after.feasible?.feasibleNodes).toBe(0);
    expect(after.feasible?.error?.blocked?.map((entry) => entry.model)).toEqual(['Strength']);
  });

  it('refuses a saved confidence basis when a restored model lost its covariance', () => {
    const project = {
      format: 'sigrun-project',
      version: 1,
      savedAt: '2026-11-24T00:00:00.000Z',
      app: 'HD2Lab Sigrún',
      worksheets: [{ id: 'W1', name: 'Sheet', columns: [{ id: 'C1', name: 'A', type: 'numeric', values: [1, 2] }] }],
      activeSheetId: 'W1',
      settings: { theme: 'light', lang: 'ko' },
      outputs: [{
        id: 'out1',
        titleKey: 'an.modeloverlaid',
        titleText: 'Yield · Strength',
        createdAt: 0,
        blocks: [{
          type: 'chart',
          chart: {
            kind: 'overlaid',
            xs: [-1, 0, 1],
            ys: [-1, 0, 1],
            responses: [],
            models: [first, blocked],
            feasible: {
              mask: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], areaRatio: 1, nodeRatio: 1, feasibleNodes: 9, totalNodes: 9,
              basis: 'confidence', convergenceDelta: 0, perResponse: [], intervalBlocked: [],
            },
            config: { feasible: { basis: 'confidence', specs: [], alpha: 0.05 } },
          },
        }],
      }],
    };
    const restored = parseProject(JSON.stringify(project));
    const chart = restored.outputs[0].blocks[0];
    expect(chart.type).toBe('chart');
    if (chart.type !== 'chart' || chart.chart.kind !== 'overlaid') return;
    expect(chart.chart.feasible?.error?.code).toBe('feasible.basisUnsupported');
    expect(chart.chart.feasible?.mask).toEqual([]);
    expect(chart.chart.feasible?.intervalBlocked).toEqual(['Strength']);
  });
});
