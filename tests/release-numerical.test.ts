/* WO-FINAL-001 · WO-02 / WO-07 (Numerical Accuracy, items 11–15)

   The domain policy is one policy: the optimiser, the profiler and the overlaid
   contour must answer "is this value inside the factor's range?" the same way,
   the answer must not grow with the offset a narrow range happens to sit at,
   and a candidate outside its range must never be handed back as a solution. */

import { describe, expect, it } from 'vitest';
import { createStoredModel, type StoredModel, type ModelVariable, type StoredModelDraft } from '../src/lib/modelStore';
import {
  factorIssues,
  isOnStep,
  rangeIntersection,
  validateFactorValue,
} from '../src/lib/factorDomain';
import { buildProblem, defaultResponseSettings, optimize } from '../src/lib/optimizer';
import type { ResponseSettings } from '../src/lib/optimizationTypes';
import { profileCurves } from '../src/lib/profiler';
import { buildOverlaid } from '../src/lib/feasible';
import { modelSurface } from '../src/lib/modelPredictor';
import type { FactorSettings } from '../src/lib/optimizationTypes';

/* ── helpers ───────────────────────────────────────────────────────────── */

function model(
  bounds: { min: number; max: number },
  response = 'Y',
): StoredModel {
  const predictor: ModelVariable = {
    id: 'C1',
    name: 'A',
    kind: 'numeric',
    coding: { mode: 'actual', center: (bounds.min + bounds.max) / 2, halfRange: (bounds.max - bounds.min) / 2 },
  };
  const draft: StoredModelDraft = {
    format: 'sigrun-model',
    version: 1,
    kind: 'polynomial',
    response: { id: 'C2', name: response, kind: 'numeric' },
    predictors: [predictor],
    terms: [{ label: 'A', factors: ['A'] }],
    coefficients: [
      { label: 'Constant', value: 10, estimable: true },
      { label: 'A', value: 1, estimable: true },
    ],
    covariance: null,
    residual: null,
    dof: null,
    factorBounds: { A: { min: bounds.min, max: bounds.max } },
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
  return createStoredModel(draft, `${response} model`);
}

function twoFactorModel(boundsA: { min: number; max: number }, boundsB: { min: number; max: number }, response: string): StoredModel {
  const numeric = (id: string, name: string, bounds: { min: number; max: number }): ModelVariable => ({
    id,
    name,
    kind: 'numeric',
    coding: { mode: 'actual', center: (bounds.min + bounds.max) / 2, halfRange: (bounds.max - bounds.min) / 2 },
  });
  const draft: StoredModelDraft = {
    format: 'sigrun-model',
    version: 1,
    kind: 'polynomial',
    response: { id: 'C3', name: response, kind: 'numeric' },
    predictors: [numeric('C1', 'A', boundsA), numeric('C2', 'B', boundsB)],
    terms: [{ label: 'A', factors: ['A'] }, { label: 'B', factors: ['B'] }],
    coefficients: [
      { label: 'Constant', value: 10, estimable: true },
      { label: 'A', value: 1, estimable: true },
      { label: 'B', value: 1, estimable: true },
    ],
    covariance: null,
    residual: null,
    dof: null,
    factorBounds: { A: boundsA, B: boundsB },
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
  return createStoredModel(draft, `${response} model`);
}

function goal(model: StoredModel): ResponseSettings {
  return { ...defaultResponseSettings(model), goal: 'maximize', lower: 0, upper: 20, target: 10 };
}

function factor(overrides: Partial<FactorSettings> & Pick<FactorSettings, 'lower' | 'upper'>): FactorSettings {
  return {
    name: 'A',
    kind: 'continuous',
    step: (overrides.upper - overrides.lower) / 20,
    fixed: false,
    fixedValue: (overrides.lower + overrides.upper) / 2,
    levels: [],
    ...overrides,
  };
}

const OFFSET = 100000000;
const NARROW_LOWER = OFFSET;
const NARROW_UPPER = OFFSET + 0.001;
const OUTSIDE = OFFSET + 0.05;

/* ── 11 · a large offset with a narrow continuous range ────────────────── */

describe('WO-02 F-REL-04 · a narrow range at a large offset', () => {
  it('refuses a value 0.05 beyond a 0.001-wide range that sits at 1e8', () => {
    const settings = factor({ kind: 'continuous', lower: NARROW_LOWER, upper: NARROW_UPPER });
    expect(validateFactorValue(settings, OUTSIDE)).toBe('opt.issue.valueOutside');
    expect(validateFactorValue(settings, NARROW_UPPER + 0.0005)).toBe('opt.issue.valueOutside');
    expect(validateFactorValue(settings, NARROW_LOWER - 0.0005)).toBe('opt.issue.valueOutside');
  });

  it('accepts the endpoints and the middle of the same range', () => {
    const settings = factor({ kind: 'continuous', lower: NARROW_LOWER, upper: NARROW_UPPER });
    expect(validateFactorValue(settings, NARROW_LOWER)).toBeNull();
    expect(validateFactorValue(settings, NARROW_UPPER)).toBeNull();
    expect(validateFactorValue(settings, OFFSET + 0.0005)).toBeNull();
    // One ULP of arithmetic noise at an endpoint is still the endpoint.
    expect(validateFactorValue(settings, NARROW_UPPER + 1e-13)).toBeNull();
  });

  it('answers OUTSIDE (not merely off-step) for a discrete range as well', () => {
    const settings = factor({ kind: 'discrete', lower: NARROW_LOWER, upper: NARROW_UPPER, step: 0.0001 });
    expect(validateFactorValue(settings, OUTSIDE)).toBe('opt.issue.valueOutside');
    expect(isOnStep(NARROW_LOWER, NARROW_UPPER, 0.0001, OUTSIDE)).toBe(false);
  });

  it('does not call two disjoint narrow ranges an intersection', () => {
    expect(rangeIntersection([[NARROW_LOWER, NARROW_UPPER], [OFFSET + 0.05, OFFSET + 0.1]])).toBeNull();
    const overlap = rangeIntersection([[NARROW_LOWER, NARROW_UPPER], [OFFSET + 0.0005, OFFSET + 0.2]]);
    expect(overlap?.[0]).toBe(OFFSET + 0.0005);
    expect(overlap?.[1]).toBe(NARROW_UPPER);
  });

  it('does not call a design limit rounded into the data an extrapolation', () => {
    // The CCD axial point is 2^(1/4) = 1.189207115002721; the column that
    // carries it in the dataset is written with nine decimals. Searching the
    // design's own range must not be refused: the difference is the column's
    // rounding (≈1.1e-12 of the width), not a value the data never covered.
    const fitted = model({ min: -1.189207115, max: 1.189207115 });
    const axial = 1.189207115002721;
    const problem = buildProblem(
      [fitted],
      [goal(fitted)],
      [factor({ lower: -axial, upper: axial })],
      { allowExtrapolation: false },
    );
    expect(problem.issues).not.toContain('opt.issue.extrapolationNotAllowed');
    // A limit a reader could have meant is still a real excursion.
    const beyond = buildProblem(
      [fitted],
      [goal(fitted)],
      [factor({ lower: -1.189208115, upper: axial })],
      { allowExtrapolation: false },
    );
    expect(beyond.issues).toContain('opt.issue.extrapolationNotAllowed');
  });
});

/* ── 12 · fitted ranges that do not overlap ────────────────────────────── */

describe('WO-02 · fitted ranges with no real intersection', () => {
  it('reports the empty intersection instead of a searchable range', () => {
    const first = model({ min: NARROW_LOWER, max: NARROW_UPPER });
    const second = model({ min: OFFSET + 0.05, max: OFFSET + 0.1 }, 'Z');
    const problem = buildProblem(
      [first, second],
      [goal(first), goal(second)],
      [factor({ lower: NARROW_LOWER, upper: NARROW_UPPER })],
      { allowExtrapolation: true },
    );
    expect(problem.issues).toContain('opt.issue.rangeIntersection');
  });
});

/* ── 13 · a fixed value outside its range or its fitted data ───────────── */

describe('WO-02 · fixed values are validated like every other value', () => {
  it('refuses a fixed value outside the narrow range at 1e8', () => {
    const held = factor({ lower: NARROW_LOWER, upper: NARROW_UPPER, fixed: true, fixedValue: OUTSIDE });
    expect(factorIssues(held)).toContain('opt.issue.fixedOutside');
  });

  it('refuses a fixed value the limits allow but the model never saw', () => {
    const fitted = model({ min: NARROW_LOWER, max: NARROW_UPPER });
    const problem = buildProblem(
      [fitted],
      [goal(fitted)],
      [factor({ lower: NARROW_LOWER, upper: OFFSET + 0.1, fixed: true, fixedValue: OUTSIDE })],
      { allowExtrapolation: false },
    );
    expect(problem.issues).toContain('opt.issue.fixedExtrapolation');
  });
});

/* ── 14 · discrete step boundaries ─────────────────────────────────────── */

describe('WO-02 · discrete lattice boundaries', () => {
  it('accepts the last step below Upper and refuses Upper off the lattice', () => {
    expect(isOnStep(0, 1, 0.3, 0)).toBe(true);
    expect(isOnStep(0, 1, 0.3, 0.9)).toBe(true);
    expect(isOnStep(0, 1, 0.3, 0.6)).toBe(true);
    expect(isOnStep(0, 1, 0.3, 1)).toBe(false);
    expect(isOnStep(0, 1, 0.3, -0.3)).toBe(false);
  });

  it('rejects NaN, Infinity, a reversed range and a non-positive step', () => {
    expect(validateFactorValue(factor({ lower: 0, upper: 1 }), Number.NaN)).toBe('opt.issue.valueMissing');
    expect(validateFactorValue(factor({ lower: 0, upper: 1 }), Number.POSITIVE_INFINITY)).toBe('opt.issue.valueMissing');
    expect(factorIssues(factor({ lower: 1, upper: 0 }))).toContain('opt.issue.factorRange');
    expect(factorIssues(factor({ kind: 'discrete', lower: 0, upper: 1, step: 0 }))).toContain('opt.issue.factorStep');
    expect(factorIssues(factor({ kind: 'discrete', lower: 0, upper: 1, step: -1 }))).toContain('opt.issue.factorStep');
  });

  it('never returns an off-lattice solution as an optimum', () => {
    const fitted = model({ min: -1, max: 1 });
    const result = optimize(
      [fitted],
      [goal(fitted)],
      [factor({ kind: 'discrete', lower: -1, upper: 1, step: 0.25 })],
      { maxEvaluations: 2000, timeLimitMs: 3000 },
    );
    expect(result.solutions.length).toBeGreaterThan(0);
    result.solutions.forEach((solution) => {
      expect(validateFactorValue(factor({ kind: 'discrete', lower: -1, upper: 1, step: 0.25 }), solution.settings.A as number)).toBeNull();
    });
  });
});

/* ── 15 · optimiser / profiler / contour agree about one condition ─────── */

describe('WO-02 · one physical condition, one verdict', () => {
  const fitted = model({ min: 0, max: 100 });
  /* Limits wider than the data: the condition is legal for the factor but the
     model was never fitted there, which is exactly what must be flagged. */
  const settings = factor({ lower: 0, upper: 150 });

  it('flags a contour range beyond the data the same way the surface does', () => {
    const surfaceModel = twoFactorModel({ min: 0, max: 100 }, { min: 0, max: 100 }, 'Y');
    const surface = modelSurface(surfaceModel, { xName: 'A', yName: 'B', xRange: [0, 150], yRange: [0, 100], resolution: 11 });
    expect(surface.outOfRange).toBe(true);
    const inside = modelSurface(surfaceModel, { xName: 'A', yName: 'B', xRange: [0, 100], yRange: [0, 100], resolution: 11 });
    expect(inside.outOfRange).toBe(false);
  });

  it('flags the same condition in the profiler and the optimiser condition check', () => {
    const responses = [goal(fitted)];
    const rows = profileCurves([fitted], responses, [settings], { A: 120 });
    expect(rows[0].extrapolated).toBe(true);
    const inside = profileCurves([fitted], responses, [settings], { A: 100 });
    expect(inside[0].extrapolated).toBe(false);
  });

  it('the overlaid contour marks the same out-of-range axis', () => {
    const first = twoFactorModel({ min: 0, max: 100 }, { min: 0, max: 100 }, 'Y');
    const second = twoFactorModel({ min: 0, max: 100 }, { min: 0, max: 100 }, 'Z');
    const common = { xName: 'A', yName: 'B', resolution: 11, holdings: {} };
    const specs = [
      { model: first, lsl: null, usl: null, target: null },
      { model: second, lsl: null, usl: null, target: null },
    ];
    const outside = buildOverlaid([first, second], specs, { ...common, xRange: [0, 150], yRange: [0, 100] });
    expect(outside.extrapolated).toBe(true);
    const inside = buildOverlaid([first, second], specs, { ...common, xRange: [0, 100], yRange: [0, 100] });
    expect(inside.extrapolated).toBe(false);
  });
});
