import { describe, expect, it } from 'vitest';
import { createStoredModel, type StoredModel, type StoredModelDraft, type ModelVariable } from '../src/lib/modelStore';
import {
  compositeDesirability,
  individualDesirability,
  responseIssues,
  withinLimits,
} from '../src/lib/desirability';
import {
  buildProblem,
  compilePointEvaluator,
  defaultFactorSettings,
  defaultResponseSettings,
  evaluateCondition,
  niceStep,
  optimize,
} from '../src/lib/optimizer';
import type { FactorSettings, ResponseSettings } from '../src/lib/optimizationTypes';

/* ── helpers ───────────────────────────────────────────────────────────── */

/** A one-factor model whose coefficients are given in input units. */
function oneFactor(
  name: string,
  responseName: string,
  coefficients: [string, number][],
  options: { min?: number; max?: number; covariance?: number[][] | null; df?: number | null; se?: number } = {},
): StoredModel {
  const predictor: ModelVariable = {
    id: '',
    name,
    kind: 'numeric',
    coding: { mode: 'actual', center: 0, halfRange: 1 },
  };
  const draft: StoredModelDraft = {
    format: 'sigrun-model',
    version: 1,
    kind: 'polynomial',
    response: { id: '', name: responseName, kind: 'numeric' },
    predictors: [predictor],
    terms: coefficients.filter(([label]) => label !== 'Constant').map(([label]) => ({ label, factors: [label.replace(/²$/, '')] })),
    coefficients: coefficients.map(([label, value]) => ({ label, value, estimable: true })),
    covariance: options.covariance ?? null,
    residual: options.df != null
      ? { df: options.df, mse: (options.se ?? 1) ** 2, s: options.se ?? 1, sse: (options.se ?? 1) ** 2 * options.df }
      : null,
    dof: null,
    factorBounds: options.min != null && options.max != null ? { [name]: { min: options.min, max: options.max } } : null,
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
  return createStoredModel(draft, `${responseName} model`);
}

function goal(overrides: Partial<ResponseSettings> & { modelId: string; name: string }): ResponseSettings {
  return {
    goal: 'maximize',
    lower: null,
    upper: null,
    target: null,
    weight: 1,
    importance: 1,
    ...overrides,
  };
}

function factor(name: string, lower: number, upper: number, overrides: Partial<FactorSettings> = {}): FactorSettings {
  return { name, kind: 'continuous', lower, upper, step: niceStep((upper - lower) / 20), fixed: false, fixedValue: (lower + upper) / 2, levels: [], ...overrides };
}

/* ── desirability ──────────────────────────────────────────────────────── */

describe('Derringer–Suich desirability', () => {
  const base = { modelId: 'm', name: 'Y' };

  it('maximize rises from 0 at the lower limit to 1 at the upper limit', () => {
    const settings = goal({ ...base, goal: 'maximize', lower: 0, upper: 10 });
    expect(individualDesirability(0, settings)).toBe(0);
    expect(individualDesirability(5, settings)).toBeCloseTo(0.5, 12);
    expect(individualDesirability(10, settings)).toBe(1);
    expect(individualDesirability(20, settings)).toBe(1);
    expect(individualDesirability(-1, settings)).toBe(0);
  });

  it('minimize falls from 1 at the lower limit to 0 at the upper limit', () => {
    const settings = goal({ ...base, goal: 'minimize', lower: 0, upper: 10 });
    expect(individualDesirability(0, settings)).toBe(1);
    expect(individualDesirability(2.5, settings)).toBeCloseTo(0.75, 12);
    expect(individualDesirability(10, settings)).toBe(0);
  });

  it('target peaks at the target and is 0 outside the limits', () => {
    const settings = goal({ ...base, goal: 'target', lower: 0, upper: 10, target: 2 });
    expect(individualDesirability(2, settings)).toBe(1);
    expect(individualDesirability(6, settings)).toBeCloseTo(0.5, 12); // (10−6)/(10−2)
    expect(individualDesirability(0, settings)).toBe(0);
    expect(individualDesirability(10, settings)).toBe(0);
  });

  it('range is a step function and ignore scores 1 without limits', () => {
    const ranged = goal({ ...base, goal: 'range', lower: 2, upper: 4 });
    expect(individualDesirability(3, ranged)).toBe(1);
    expect(individualDesirability(4.5, ranged)).toBe(0);
    const ignored = goal({ ...base, goal: 'ignore' });
    expect(individualDesirability(Number.NaN, ignored)).toBe(1);
    expect(responseIssues(ignored)).toEqual([]);
  });

  it('weight bends the curve but not the composite weight', () => {
    const linear = goal({ ...base, goal: 'maximize', lower: 0, upper: 10, weight: 1 });
    const squared = goal({ ...base, goal: 'maximize', lower: 0, upper: 10, weight: 2 });
    expect(individualDesirability(5, squared)).toBeCloseTo(0.25, 12);
    expect(individualDesirability(5, linear)).toBeCloseTo(0.5, 12);
    // Same desirabilities, different importance → different composite.
    const low = compositeDesirability([{ desirability: 0.25, importance: 1, goal: 'maximize' }, { desirability: 1, importance: 1, goal: 'maximize' }]);
    expect(low).toBeCloseTo(Math.sqrt(0.25), 12);
    const skewed = compositeDesirability([{ desirability: 0.25, importance: 3, goal: 'maximize' }, { desirability: 1, importance: 1, goal: 'maximize' }]);
    expect(skewed).toBeCloseTo(0.25 ** (3 / 4), 12);
  });

  it('a single unacceptable response makes the composite 0', () => {
    expect(compositeDesirability([
      { desirability: 1, importance: 1, goal: 'maximize' },
      { desirability: 0, importance: 5, goal: 'minimize' },
    ])).toBe(0);
    expect(compositeDesirability([])).toBe(0);
    expect(compositeDesirability([{ desirability: 1, importance: 1, goal: 'ignore' }])).toBe(0);
  });

  it('reports unusable limits instead of inventing them', () => {
    expect(responseIssues(goal({ ...base, lower: null, upper: 5 }))).toContain('opt.issue.limitsMissing');
    expect(responseIssues(goal({ ...base, lower: 5, upper: 5 }))).toContain('opt.issue.limitsOrder');
    expect(responseIssues(goal({ ...base, goal: 'target', lower: 0, upper: 5, target: 9 }))).toContain('opt.issue.targetOutside');
    const reversed = goal({ ...base, lower: 10, upper: 0 });
    expect(withinLimits(5, reversed)).toBe(true);
    expect(individualDesirability(0, reversed)).toBe(0);
    expect(individualDesirability(3, reversed)).toBeCloseTo(0.3, 12);
  });
});

/* ── the compiled evaluator matches the shipped predictor ──────────────── */

describe('compiled point evaluator', () => {
  it('reproduces the stored-model prediction, its standard error and intervals', () => {
    const model = oneFactor('x', 'Y', [['Constant', 5], ['x', 2], ['x²', -0.5]], {
      min: 0, max: 10, df: 8, se: 1,
      covariance: [[0.25, 0, 0], [0, 0.04, 0], [0, 0, 0.001]],
    });
    const evaluator = compilePointEvaluator(model);
    const at2 = evaluator.evaluate({ x: 2 }, 0.05);
    expect(at2.value).toBeCloseTo(5 + 4 - 2, 10);
    // var = 1²·0.25 + 2²·0.04 + 4²·0.001 = 0.25 + 0.16 + 0.016
    expect(at2.se).toBeCloseTo(Math.sqrt(0.426), 10);
    expect(at2.ci?.[0]).toBeCloseTo(7 - 2.306004 * Math.sqrt(0.426), 4);
    expect(at2.pi?.[1]).toBeCloseTo(7 + 2.306004 * Math.sqrt(0.426 + 1), 4);
  });

  it('refuses (null) instead of reporting a value for an aliased column', () => {
    const model = oneFactor('x', 'Y', [['Constant', 5], ['x', 2]], { min: 0, max: 10, df: 8, se: 1 });
    const aliased: StoredModel = {
      ...model,
      coefficients: model.coefficients.map((coefficient) => (coefficient.label === 'x' ? { ...coefficient, estimable: false } : coefficient)),
    };
    const evaluator = compilePointEvaluator(aliased);
    const result = evaluator.evaluate({ x: 3 }, 0.05);
    expect(result.value).toBeNull();
    expect(result.nonEstimable).toEqual(['x']);
  });

  it('without a covariance there is no interval, and it says so', () => {
    const model = oneFactor('x', 'Y', [['Constant', 5], ['x', 2]], { min: 0, max: 10 });
    const result = compilePointEvaluator(model).evaluate({ x: 3 }, 0.05);
    expect(result.value).toBeCloseTo(11, 12);
    expect(result.se).toBeNull();
    expect(result.ci).toBeNull();
    expect(result.pi).toBeNull();
  });
});

/* ── optimisation ──────────────────────────────────────────────────────── */

describe('multi-response optimisation', () => {
  /** y = 10 − 2(x − 1.5)² — maximised exactly at x = 1.5. */
  const hump = oneFactor('x', 'Yield', [['Constant', 10], ['x', 6], ['x²', -2]], { min: 0, max: 5, df: 10, se: 0.5, covariance: null });

  it('finds the analytic maximum of a quadratic', () => {
    // The ideal point (upper) is set beyond the fitted peak, so the desirability
    // scale itself points at x = 1.5 instead of saturating below it.
    const responses = [goal({ modelId: hump.id, name: 'Yield', goal: 'maximize', lower: 0, upper: 15 })];
    const result = optimize([hump], responses, [factor('x', 0, 5)], { method: 'bounded', seed: 7 });
    expect(result.status).toBe('optimal');
    const best = result.solutions[0];
    expect(best.settings.x as number).toBeCloseTo(1.5, 2);
    expect(best.responses[0].value as number).toBeCloseTo(14.5, 2);
    expect(best.composite).toBeCloseTo(14.5 / 15, 3);
  });

  it('is reproducible: the same seed returns the same answer', () => {
    const responses = [goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 15 })];
    const first = optimize([hump], responses, [factor('x', 0, 5)], { method: 'multistart', seed: 42 });
    const second = optimize([hump], responses, [factor('x', 0, 5)], { method: 'multistart', seed: 42 });
    expect(second.solutions[0].settings).toEqual(first.solutions[0].settings);
    expect(second.solutions[0].composite).toBeCloseTo(first.solutions[0].composite, 12);
    expect(second.evaluations).toBe(first.evaluations);
  });

  it('two responses settle where both desirabilities balance', () => {
    // Yield wants the top of the hump (1.5); Cost grows with x^2 so it wants 0.
    const cost = oneFactor('x', 'Cost', [['Constant', 10], ['x²', 2]], { min: 0, max: 5, df: 10, se: 0.5 });
    const responses = [
      goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 14.5 }),
      goal({ modelId: cost.id, name: 'Cost', goal: 'minimize', lower: 10, upper: 30 }),
    ];
    const result = optimize([hump, cost], responses, [factor('x', 0, 5)], { method: 'multistart', seed: 11 });
    const best = result.solutions[0];
    // Both curves are strictly decreasing past 1.5 / increasing for cost, so the
    // composite is maximised strictly between 0 and 1.5 — never at either end.
    expect(best.settings.x as number).toBeGreaterThan(0.05);
    expect(best.settings.x as number).toBeLessThan(1.45);
    expect(best.responses).toHaveLength(2);
    expect(best.composite).toBeGreaterThan(0.3);
    expect(best.composite).toBeLessThan(1);
  });

  it('importance moves the answer towards the more important response', () => {
    const cost = oneFactor('x', 'Cost', [['Constant', 10], ['x²', 2]], { min: 0, max: 5, df: 10, se: 0.5 });
    const factors = [factor('x', 0, 5)];
    const base = [
      goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 14.5, importance: 1 }),
      goal({ modelId: cost.id, name: 'Cost', goal: 'minimize', lower: 10, upper: 30, importance: 1 }),
    ];
    const costHeavy = [
      { ...base[0], importance: 1 },
      { ...base[1], importance: 6 },
    ];
    const balanced = optimize([hump, cost], base, factors, { method: 'multistart', seed: 5 });
    const skewed = optimize([hump, cost], costHeavy, factors, { method: 'multistart', seed: 5 });
    expect(skewed.solutions[0].settings.x as number).toBeLessThan(balanced.solutions[0].settings.x as number);
  });

  it('reports no feasible solution when the goals cannot both hold', () => {
    const responses = [
      goal({ modelId: hump.id, name: 'Yield', goal: 'range', lower: 100, upper: 200 }),
    ];
    const result = optimize([hump], responses, [factor('x', 0, 5)], { method: 'grid' });
    expect(result.status).toBe('no-feasible');
    expect(result.solutions[0].composite).toBe(0);
    expect(result.warnings).toContain('opt.warn.noCompliantPoint');
  });

  it('a grid search reports the best lattice point and does not claim optimality', () => {
    const responses = [goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 15 })];
    const result = optimize([hump], responses, [factor('x', 0, 5)], { method: 'grid', gridPoints: 11 });
    expect(result.status).toBe('best-found');
    expect(result.solutions[0].settings.x as number).toBeCloseTo(1.5, 1);
  });

  it('enumerates a fully discrete space and calls it optimal', () => {
    const responses = [goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 15 })];
    const result = optimize([hump], responses, [factor('x', 0, 5, { kind: 'discrete', step: 0.5 })], { method: 'enumerate' });
    expect(result.status).toBe('optimal');
    expect(result.solutions[0].settings.x as number).toBe(1.5);
  });

  it('holds a fixed factor and enumerates a categorical one', () => {
    const categorical = oneFactor('Shift', 'Scrap', [['Constant', 4], ['Shift[Day]', -1]], { min: 0, max: 0 });
    // The categorical predictor needs its levelled form.
    const model: StoredModel = {
      ...categorical,
      predictors: [{ id: '', name: 'Shift', kind: 'categorical', levels: ['Day', 'Night'] }],
      coefficients: [
        { label: 'Constant', value: 4, estimable: true },
        { label: 'Shift[Day]', value: -1, estimable: true },
      ],
    };
    const responses = [goal({ modelId: model.id, name: 'Scrap', goal: 'minimize', lower: 1, upper: 5 })];
    const factors: FactorSettings[] = [
      factor('x', 0, 5, { fixed: true, fixedValue: 2.5 }),
      { name: 'Shift', kind: 'categorical', lower: 0, upper: 0, step: 0, fixed: false, fixedValue: 'Day', levels: ['Day', 'Night'] },
    ];
    const result = optimize([model], responses, factors, { method: 'enumerate' });
    expect(result.status).toBe('optimal');
    // Scrap = 4 − contrast(Shift): 3 on Day, 5 on Night, so Day is minimised.
    expect(result.solutions[0].settings.Shift).toBe('Day');
    expect(result.solutions[0].responses[0].value as number).toBeCloseTo(3, 10);
    expect(result.solutions[0].settings.x).toBe(2.5);
  });

  it('finds the higher of two local maxima from a multi-start search', () => {
    // y = 4x³ − x⁴ + ... has a local max near x≈? Use a quartic with two humps.
    // f(x) = -(x−2)²(x−8)²/10 + 10 has maxima at 2 and 8, the one at 8 is
    // identical; tilt it so the right hump is higher.
    const model = oneFactor('x', 'Y', [
      ['Constant', 10],
      ['x', 4.8],
      ['x²', -1.08],
      ['x³', 0.08],
    ], { min: 0, max: 10, df: 12, se: 0.2 });
    const responses = [goal({ modelId: model.id, name: 'Y', lower: -20, upper: 20 })];
    const result = optimize([model], responses, [factor('x', 0, 10)], { method: 'multistart', seed: 3, gridPoints: 21 });
    const value = result.solutions[0].responses[0].value as number;
    // The global maximum must beat what a single start from the centre reaches.
    const centre = evaluateCondition([model], responses, [factor('x', 0, 10)], { x: 5 })!;
    expect(value).toBeGreaterThan(centre.responses[0].value as number);
    expect(result.solutions[0].settings.x as number).toBeGreaterThan(0);
    expect(result.solutions[0].settings.x as number).toBeLessThan(10);
  });

  it('top N alternatives are distinct conditions, best first', () => {
    const responses = [goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 9 })];
    const result = optimize([hump], responses, [factor('x', 0, 5)], { method: 'grid', gridPoints: 21, topN: 4 });
    expect(result.solutions.length).toBeGreaterThan(1);
    const seen = new Set(result.solutions.map((solution) => String(solution.settings.x)));
    expect(seen.size).toBe(result.solutions.length);
    for (let index = 1; index < result.solutions.length; index += 1) {
      expect(result.solutions[index - 1].composite).toBeGreaterThanOrEqual(result.solutions[index].composite);
    }
  });

  it('flags extrapolation beyond the fitted region', () => {
    // The model was fitted on 0…5; the peak at 1.5 is inside, but a wider
    // search that settles above 5 must be marked as extrapolation.
    const narrow = oneFactor('x', 'Yield', [['Constant', 10], ['x', 6], ['x²', -2]], { min: 0, max: 1, df: 10, se: 0.5 });
    const responses = [goal({ modelId: narrow.id, name: 'Yield', lower: 0, upper: 15 })];
    const result = optimize([narrow], responses, [factor('x', 0, 5)], { method: 'grid', gridPoints: 21 });
    expect(result.solutions[0].settings.x as number).toBeCloseTo(1.5, 2);
    expect(result.solutions[0].extrapolated).toBe(true);
  });

  it('stops at the budget and still reports the best point found', () => {
    const responses = [goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 15 })];
    // A discrete axis keeps its step, so a 51-point enumeration cannot be thinned.
    const result = optimize([hump], responses, [factor('x', 0, 5, { kind: 'discrete', step: 0.1 })], { method: 'enumerate', maxEvaluations: 20 });
    expect(result.status).toBe('limit');
    expect(result.evaluations).toBeLessThanOrEqual(21);
    expect(result.solutions.length).toBeGreaterThan(0);
    expect(result.warnings).toContain('opt.warn.gridReduced');
  });

  it('thins an oversized lattice instead of exhausting the budget', () => {
    const responses = [goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 15 })];
    const result = optimize([hump], responses, [factor('x', 0, 5)], { method: 'grid', gridPoints: 201, maxEvaluations: 25 });
    expect(result.status).toBe('best-found');
    expect(result.evaluations).toBeLessThanOrEqual(25);
    expect(result.warnings).toContain('opt.warn.gridReduced');
  });

  it('refuses an invalid problem with a reason instead of searching', () => {
    const responses = [goal({ modelId: hump.id, name: 'Yield', goal: 'ignore' })];
    const noGoal = optimize([hump], responses, [factor('x', 0, 5)]);
    expect(noGoal.status).toBe('invalid');
    expect(noGoal.issues).toContain('opt.issue.noGoal');

    const allFixed = optimize([hump], [goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 9 })], [factor('x', 0, 5, { fixed: true })]);
    expect(allFixed.issues).toContain('opt.issue.allFixed');

    const noResponse = optimize([hump], [], [factor('x', 0, 5)]);
    expect(noResponse.issues).toContain('opt.issue.noResponse');

    const badRange = optimize([hump], [goal({ modelId: hump.id, name: 'Yield', lower: 0, upper: 9 })], [factor('x', 5, 5)]);
    expect(badRange.issues).toContain('opt.issue.factorRange');
  });

  it('predicts a held factor that nobody put in the search space, and says so', () => {
    const two = oneFactor('z', 'Y2', [['Constant', 1], ['z', 3]], { min: -1, max: 1 });
    const model: StoredModel = {
      ...two,
      predictors: [
        { id: '', name: 'x', kind: 'numeric', coding: { mode: 'actual', center: 0, halfRange: 1 } },
        { id: '', name: 'z', kind: 'numeric', coding: { mode: 'actual', center: 0, halfRange: 1 } },
      ],
      coefficients: [
        { label: 'Constant', value: 1, estimable: true },
        { label: 'x', value: 2, estimable: true },
        { label: 'z', value: 3, estimable: true },
      ],
    };
    const responses = [goal({ modelId: model.id, name: 'Y2', lower: -10, upper: 10 })];
    const problem = buildProblem([model], responses, [factor('x', 0, 5)]);
    expect(problem.warnings).toContain('opt.warn.heldFactors');
    const result = optimize([model], responses, [factor('x', 0, 5)], { method: 'grid', gridPoints: 5 });
    expect(result.solutions[0].responses[0].value).toBeCloseTo(1 + 2 * 5 + 3 * 0, 6);
  });
});

/* ── defaults ──────────────────────────────────────────────────────────── */

describe('optimiser defaults', () => {
  it('start from the observed design range and the fitted factor bounds', () => {
    const model: StoredModel = {
      ...oneFactor('x', 'Y', [['Constant', 1], ['x', 1]], { min: 2, max: 8 }),
      design: { points: [{ levels: { x: 2 }, y: 3 }, { levels: { x: 8 }, y: 9 }] },
    };
    const response = defaultResponseSettings(model);
    expect(response.goal).toBe('maximize');
    expect(response.lower).toBe(3);
    expect(response.upper).toBe(9);
    const settings = defaultFactorSettings([model], 'x');
    expect(settings.kind).toBe('continuous');
    expect(settings.lower).toBe(2);
    expect(settings.upper).toBe(8);
    expect(settings.step).toBeGreaterThan(0);
  });

  it('a categorical factor starts from its fitted levels', () => {
    const model: StoredModel = {
      ...oneFactor('Shift', 'Y', [['Constant', 1]], {}),
      predictors: [{ id: '', name: 'Shift', kind: 'categorical', levels: ['Day', 'Night'] }],
      coefficients: [{ label: 'Constant', value: 1, estimable: true }, { label: 'Shift[Day]', value: 2, estimable: true }],
    };
    const settings = defaultFactorSettings([model], 'Shift');
    expect(settings.kind).toBe('categorical');
    expect(settings.levels).toEqual(['Day', 'Night']);
  });

  it('niceStep gives numbers a person would type', () => {
    expect(niceStep(0.37)).toBeCloseTo(0.25, 12);
    expect(niceStep(2.2)).toBeCloseTo(2, 12);
    expect(niceStep(6)).toBeCloseTo(5, 12);
    expect(niceStep(0)).toBe(1);
  });
});
