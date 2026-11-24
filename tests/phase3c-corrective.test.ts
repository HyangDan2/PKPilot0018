/* Stage 3C corrective QA — fail-first suite (F-3C-01 … F-3C-13).

   Every test in this file states a rule the baseline (c827471be2) does not
   implement, so this file fails on that baseline and passes only when the
   correction is in place. Numbers and codes here are the contract the report
   cites. */

import { describe, expect, it } from 'vitest';
import { createStoredModel, type ModelVariable, type StoredModel, type StoredModelDraft } from '../src/lib/modelStore';
import {
  discreteAxis,
  discreteValueAt,
  isOnStep,
  nearestStepValue,
  rangeIntersection,
  levelIntersection,
} from '../src/lib/factorDomain';
import { createPredictionAdapter } from '../src/lib/predictionAdapter';
import { predictStoredModel } from '../src/lib/modelPredictor';
import {
  compositeDesirability,
  individualDesirability,
  responseIssues,
} from '../src/lib/desirability';
import {
  buildProblem,
  defaultFactorSettings,
  evaluateCondition,
  optimize,
  optimizeAsync,
} from '../src/lib/optimizer';
import { centrePoint, curveAxis, normaliseValue, profileCurves } from '../src/lib/profiler';
import type { FactorSettings, ResponseSettings } from '../src/lib/optimizationTypes';

/* ── helpers ───────────────────────────────────────────────────────────── */

function model(
  predictors: ModelVariable[],
  coefficients: [string, number][],
  options: {
    response?: string;
    bounds?: Record<string, { min: number; max: number }> | null;
    covariance?: number[][] | null;
    df?: number | null;
    mse?: number | null;
    design?: { levels: Record<string, number>; y: number | null }[];
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
    ...(options.design ? { design: { points: options.design } } : {}),
    source: {},
  };
  return createStoredModel(draft, 'qa');
}

const numeric = (name: string, center = 0, halfRange = 1, unit?: string): ModelVariable => ({
  id: `col-${name}`,
  name,
  kind: 'numeric',
  coding: { mode: 'coded', center, halfRange },
  ...(unit ? { unit } : {}),
});

const goal = (overrides: Partial<ResponseSettings> & { modelId: string; name: string }): ResponseSettings => ({
  goal: 'maximize',
  lower: null,
  upper: null,
  target: null,
  weight: 1,
  importance: 1,
  ...overrides,
});

const factor = (name: string, lower: number, upper: number, overrides: Partial<FactorSettings> = {}): FactorSettings => ({
  name,
  kind: 'continuous',
  lower,
  upper,
  step: 0,
  fixed: false,
  fixedValue: (lower + upper) / 2,
  levels: [],
  ...overrides,
});

/** y = 10 + 6x − 2x² on a coded 0…5 axis — a single hump at x = 1.5. */
const hump = (): StoredModel => model(
  [numeric('x')],
  [['Constant', 10], ['x', 6], ['x²', -2]],
  { bounds: { x: { min: 0, max: 5 } }, df: 10, mse: 0.25 },
);

/* ── F-3C-02: discrete domain Lower + k × Step ─────────────────────────── */

describe('F-3C-02 discrete factor constraint', () => {
  it('defines allowed values as Lower + k × Step and never beyond Upper', () => {
    const axis = discreteAxis(0, 1, 0.6);
    // 0, 0.6, then 1.2 > Upper — the step stops at the last value inside.
    expect(axis.values).toEqual([0, 0.6]);
    expect(axis.count).toBe(2);
    expect(axis.values).toHaveLength(2);
  });

  it('handles a negative lower bound with a non-integer step exactly', () => {
    const axis = discreteAxis(-1, 1, 0.3);
    expect(axis.values[0]).toBe(-1);
    expect(axis.values[axis.values.length - 1]).toBeCloseTo(0.8, 12);
    expect(axis.count).toBe(7);
    // Every value is the integer-index multiple, with no accumulated drift.
    axis.values.forEach((value, k) => expect(value).toBe(discreteValueAt(-1, 0.3, k)));
  });

  it('keeps a very small step precise instead of rounding values together', () => {
    const axis = discreteAxis(0, 0.001, 0.0001);
    expect(axis.values).toHaveLength(11);
    expect(axis.values[3]).toBe(0.0003);
    expect(new Set(axis.values).size).toBe(axis.values.length);
    expect(isOnStep(0, 0.001, 0.0001, 0.0003)).toBe(true);
    expect(isOnStep(0, 0.001, 0.0001, 0.00035)).toBe(false);
  });

  it('snaps to the nearest allowed value and reports whether it stayed inside', () => {
    const snapped = nearestStepValue(0, 1, 0.6, 0.7);
    expect(snapped.value).toBeCloseTo(0.6, 12);
    expect(snapped.inside).toBe(true);
    const outside = nearestStepValue(0, 1, 0.6, 5);
    expect(outside.inside).toBe(false);
  });

  it('refuses a fixed value that is not on the step or out of the range', () => {
    const offStep = optimize(
      [hump()],
      [goal({ modelId: hump().id, name: 'Y', lower: 0, upper: 18 })],
      [factor('x', 0, 5, { kind: 'discrete', step: 0.5, fixed: true, fixedValue: 1.2 })],
    );
    expect(offStep.status).toBe('invalid');
    expect(offStep.issues).toContain('opt.issue.fixedOffStep');
    const outside = optimize(
      [hump()],
      [goal({ modelId: hump().id, name: 'Y', lower: 0, upper: 18 })],
      [factor('x', 0, 5, { kind: 'discrete', step: 0.5, fixed: true, fixedValue: 7 })],
    );
    expect(outside.issues).toContain('opt.issue.fixedOutside');
  });
});

/* ── F-3C-03: one prediction engine ────────────────────────────────────── */

describe('F-3C-03 unified prediction engine', () => {
  const coded = model(
    [numeric('x', 0, 2), numeric('y', 10, 4)],
    [
      ['Constant', 12],
      ['x', 3],
      ['y', -1.5],
      ['x²', 0.8],
      ['x×y', 0.4],
    ],
    {
      bounds: { x: { min: -2, max: 2 }, y: { min: 6, max: 14 } },
      df: 8,
      mse: 0.36,
      covariance: [
        [0.04, 0, 0, 0, 0],
        [0, 0.02, 0, 0, 0],
        [0, 0, 0.03, 0, 0],
        [0, 0, 0, 0.01, 0],
        [0, 0, 0, 0, 0.005],
      ],
    },
  );

  it('the adapter reproduces the model manager prediction, SE, CI and PI exactly', () => {
    const adapter = createPredictionAdapter(coded);
    const points = [
      { x: 0, y: 10 },
      { x: 1.5, y: 7.25 },
      { x: -2, y: 14 },
      { x: 0.33, y: 11.7 },
    ];
    points.forEach((point) => {
      const mine = adapter.evaluate(point, 0.05);
      const shared = predictStoredModel(coded, point, { alpha: 0.05 });
      expect(mine.value).toBeCloseTo(shared.value as number, 12);
      expect(mine.se).toBeCloseTo(shared.se as number, 12);
      expect(mine.pi?.[0]).toBeCloseTo(shared.pi?.[0] as number, 12);
      expect(mine.pi?.[1]).toBeCloseTo(shared.pi?.[1] as number, 12);
      // CI = ŷ ± t·SE is the same interval the optimizer reports.
      expect(mine.ci?.[0]).toBeCloseTo((shared.value as number) - (mine.se as number) * 2.306004135, 5);
    });
  });

  it('the optimizer reports exactly the adapter prediction at the condition it chose', () => {
    const responses = [goal({ modelId: coded.id, name: 'Y', lower: 0, upper: 25 })];
    const factors = [factor('x', -2, 2), factor('y', 6, 14)];
    const result = optimize([coded], responses, factors, { method: 'multistart', seed: 4 });
    const best = result.solutions[0];
    const adapter = createPredictionAdapter(coded);
    const direct = adapter.evaluate(best.settings, 0.05);
    expect(best.responses[0].value).toBeCloseTo(direct.value as number, 12);
    expect(best.responses[0].se).toBeCloseTo(direct.se as number, 12);
    expect(best.responses[0].ci?.[0]).toBeCloseTo(direct.ci?.[0] as number, 12);
  });

  it('keeps no second prediction formula in the optimizer module', async () => {
    const source = await import('node:fs').then((fs) => fs.readFileSync('src/lib/optimizer.ts', 'utf8'));
    expect(source).not.toMatch(/compilePointEvaluator/);
    expect(source).not.toMatch(/tInv/);
  });
});

/* ── F-3C-01 / F-3C-07: search status ─────────────────────────────────── */

describe('F-3C-01 / F-3C-07 optimizer status', () => {
  it('never calls a continuous lattice search global-optimal', () => {
    const m = hump();
    const result = optimize([m], [goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 })], [factor('x', 0, 5)], { method: 'grid', gridPoints: 21 });
    expect(result.status).not.toBe('global-optimal');
    expect(result.status).toBe('best-found');
  });

  it('reports a converged continuous local search as local-converged, not global-optimal', () => {
    const m = hump();
    const result = optimize([m], [goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 })], [factor('x', 0, 5)], { method: 'multistart', seed: 7 });
    expect(result.status).toBe('local-converged');
    expect(result.search.basins.length).toBeGreaterThan(0);
    expect(result.search.basins.every((basin) => basin.converged)).toBe(true);
  });

  it('calls a complete enumeration of a discrete space global-optimal', () => {
    const m = hump();
    const result = optimize([m], [goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 })], [factor('x', 0, 5, { kind: 'discrete', step: 0.5 })], { method: 'enumerate' });
    expect(result.status).toBe('global-optimal');
    expect(result.search.exhaustive).toBe(true);
    expect(result.search.space).toBe('discrete');
    expect(result.solutions[0].settings.x).toBe(1.5);
  });

  it('distinguishes an exhaustive empty space (infeasible) from an incomplete search', () => {
    const m = hump();
    const exhaustive = optimize([m], [goal({ modelId: m.id, name: 'Y', goal: 'range', lower: 100, upper: 200 })], [factor('x', 0, 5, { kind: 'discrete', step: 0.5 })], { method: 'enumerate' });
    expect(exhaustive.status).toBe('infeasible');
    expect(exhaustive.recommended).toBe(false);
    const partial = optimize([m], [goal({ modelId: m.id, name: 'Y', goal: 'range', lower: 100, upper: 200 })], [factor('x', 0, 5)], { method: 'grid', gridPoints: 11 });
    expect(partial.status).toBe('feasible-not-found');
    expect(partial.recommended).toBe(false);
  });

  it('records the stopping reason and the thinned axes', () => {
    const m = hump();
    const result = optimize([m], [goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 })], [factor('x', 0, 5)], { method: 'grid', gridPoints: 201, maxEvaluations: 25 });
    expect(result.status).toBe('limit');
    expect(result.search.stoppedBy).toBe('budget');
    expect(result.search.gridReduced).toBe(true);
    expect(result.evaluations).toBeLessThanOrEqual(25);
  });
});

/* ── F-3C-04: invalid responses ────────────────────────────────────────── */

describe('F-3C-04 invalid response handling', () => {
  const m = hump();

  it('stops when an active response has no limits instead of optimising around it', () => {
    const result = optimize([m], [goal({ modelId: m.id, name: 'Y', lower: 0 })], [factor('x', 0, 5)]);
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.limitsMissing');
    expect(result.evaluations).toBe(0);
  });

  it('lets an ignored response keep unusable limits without stopping the search', () => {
    const other = model([numeric('x')], [['Constant', 2], ['x', 1]], { response: 'Z', bounds: { x: { min: 0, max: 5 } } });
    const result = optimize(
      [m, other],
      [
        goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 }),
        goal({ modelId: other.id, name: 'Z', goal: 'ignore', lower: null, upper: null }),
      ],
      [factor('x', 0, 5)],
      { method: 'grid', gridPoints: 11 },
    );
    expect(result.status).not.toBe('invalid');
    expect(result.solutions[0].responses).toHaveLength(2);
  });

  it('names a missing model id and a duplicated response', () => {
    const missing = optimize([m], [goal({ modelId: 'nope', name: 'Y', lower: 0, upper: 18 })], [factor('x', 0, 5)]);
    expect(missing.status).toBe('invalid');
    expect(missing.issues).toContain('opt.issue.modelMissing');
    const duplicate = optimize(
      [m],
      [goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 }), goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 })],
      [factor('x', 0, 5)],
    );
    expect(duplicate.issues).toContain('opt.issue.responseDuplicate');
  });

  it('never reports a non-estimable response as in spec', () => {
    const broken: StoredModel = {
      ...m,
      coefficients: [
        { label: 'Constant', value: 10, estimable: true },
        { label: 'x', value: 2, estimable: false },
        { label: 'x²', value: -2, estimable: true },
      ],
    };
    const result = optimize([broken], [goal({ modelId: broken.id, name: 'Y', lower: 0, upper: 18 })], [factor('x', 0, 5)]);
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.nonEstimable');
  });
});

/* ── F-3C-05: model compatibility ──────────────────────────────────────── */

describe('F-3C-05 model compatibility', () => {
  it('refuses to merge factors with different units', () => {
    const a = model([numeric('Temp', 0, 1, '°C')], [['Constant', 1], ['Temp', 1]], { response: 'A', bounds: { Temp: { min: 0, max: 10 } } });
    const b = model([numeric('Temp', 0, 1, '°F')], [['Constant', 1], ['Temp', 1]], { response: 'B', bounds: { Temp: { min: 0, max: 10 } } });
    const problem = buildProblem(
      [a, b],
      [goal({ modelId: a.id, name: 'A', lower: 0, upper: 10 }), goal({ modelId: b.id, name: 'B', lower: 0, upper: 10 })],
      [factor('Temp', 0, 10)],
    );
    expect(problem.issues).toContain('opt.issue.unitConflict');
  });

  it('refuses to merge a numeric factor with a categorical one of the same name', () => {
    const a = model([numeric('Shift')], [['Constant', 1], ['Shift', 1]], { response: 'A', bounds: { Shift: { min: 0, max: 1 } } });
    const b = model(
      [{ id: 'col-Shift', name: 'Shift', kind: 'categorical', levels: ['Day', 'Night'] }],
      [['Constant', 1], ['Shift[Day]', 1]],
      { response: 'B' },
    );
    const problem = buildProblem(
      [a, b],
      [goal({ modelId: a.id, name: 'A', lower: 0, upper: 10 }), goal({ modelId: b.id, name: 'B', lower: 0, upper: 10 })],
      [factor('Shift', 0, 1)],
    );
    expect(problem.issues).toContain('opt.issue.typeConflict');
  });

  it('predicts two different codings at the same actual coordinates independently', () => {
    const codedCentered = model([numeric('x', 10, 5)], [['Constant', 5], ['x', 2]], { response: 'A', bounds: { x: { min: 5, max: 15 } } });
    const codedRaw = model([{ id: 'col-x', name: 'x', kind: 'numeric', coding: { mode: 'actual', center: 0, halfRange: 1 } }], [['Constant', 3], ['x', 0.5]], { response: 'B', bounds: { x: { min: 5, max: 15 } } });
    const solution = evaluateCondition(
      [codedCentered, codedRaw],
      [goal({ modelId: codedCentered.id, name: 'A', lower: -100, upper: 100 }), goal({ modelId: codedRaw.id, name: 'B', lower: -100, upper: 100 })],
      [factor('x', 5, 15)],
      { x: 15 },
    )!;
    // A: coded (15−10)/5 = 1 → 5 + 2 = 7. B: measured 15 → 3 + 7.5 = 10.5.
    expect(solution.responses[0].value).toBeCloseTo(7, 10);
    expect(solution.responses[1].value).toBeCloseTo(10.5, 10);
  });

  it('reports an empty categorical level intersection', () => {
    const a = model([{ id: 'col-s', name: 'S', kind: 'categorical', levels: ['Day', 'Night'] }], [['Constant', 1], ['S[Day]', 1]], { response: 'A' });
    const b = model([{ id: 'col-s', name: 'S', kind: 'categorical', levels: ['Early', 'Late'] }], [['Constant', 1], ['S[Early]', 1]], { response: 'B' });
    const problem = buildProblem(
      [a, b],
      [goal({ modelId: a.id, name: 'A', lower: 0, upper: 10 }), goal({ modelId: b.id, name: 'B', lower: 0, upper: 10 })],
      [{ name: 'S', kind: 'categorical', lower: 0, upper: 0, step: 0, fixed: false, fixedValue: 'Day', levels: ['Day', 'Night', 'Early', 'Late'] }],
    );
    expect(problem.issues).toContain('opt.issue.levelIntersection');
  });
});

/* ── F-3C-06: valid search domain ──────────────────────────────────────── */

describe('F-3C-06 valid search domain', () => {
  it('defaults a numeric factor to the intersection of the fitted ranges', () => {
    const wide = model([numeric('x')], [['Constant', 1], ['x', 1]], { bounds: { x: { min: 0, max: 10 } } });
    const narrow = model([numeric('x')], [['Constant', 1], ['x', 1]], { response: 'Z', bounds: { x: { min: 4, max: 6 } } });
    const settings = defaultFactorSettings([wide, narrow], 'x');
    expect(settings.lower).toBe(4);
    expect(settings.upper).toBe(6);
    expect(settings.domainSource).toBe('intersection');
    expect(rangeIntersection([[0, 10], [4, 6]])).toEqual([4, 6]);
    expect(rangeIntersection([[0, 1], [4, 6]])).toBeNull();
  });

  it('reports an empty fitted-range intersection instead of searching it', () => {
    const a = model([numeric('x')], [['Constant', 1], ['x', 1]], { response: 'A', bounds: { x: { min: 0, max: 1 } } });
    const b = model([numeric('x')], [['Constant', 1], ['x', 1]], { response: 'B', bounds: { x: { min: 4, max: 6 } } });
    const result = optimize(
      [a, b],
      [goal({ modelId: a.id, name: 'A', lower: 0, upper: 10 }), goal({ modelId: b.id, name: 'B', lower: 0, upper: 10 })],
      [factor('x', 0, 6)],
    );
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.rangeIntersection');
  });

  it('refuses extrapolation unless the reader allowed it', () => {
    // Fitted on 0…2; the searched range 4…8 lies entirely outside it.
    const m = model([numeric('x')], [['Constant', 10], ['x', 6], ['x²', -2]], { bounds: { x: { min: 0, max: 2 } }, df: 10, mse: 0.25 });
    const responses = [goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 })];
    const refused = optimize([m], responses, [factor('x', 4, 8)], { method: 'grid', gridPoints: 11 });
    expect(refused.status).toBe('invalid');
    expect(refused.issues).toContain('opt.issue.extrapolationNotAllowed');
    const allowed = optimize([m], responses, [factor('x', 4, 8, { allowExtrapolation: true })], { method: 'grid', gridPoints: 11 });
    expect(allowed.status).not.toBe('invalid');
    expect(allowed.solutions[0].extrapolated).toBe(true);
  });

  it('does not hold a model variable nobody put in the search space', () => {
    const two = model(
      [numeric('x'), numeric('z')],
      [['Constant', 1], ['x', 2], ['z', 3]],
      { bounds: { x: { min: 0, max: 5 }, z: { min: -1, max: 1 } } },
    );
    const result = optimize([two], [goal({ modelId: two.id, name: 'Y', lower: -10, upper: 10 })], [factor('x', 0, 5)]);
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.factorMissing');
  });

  it('intersects categorical levels across models', () => {
    expect(levelIntersection([['Day', 'Night'], ['Night', 'Late']])).toEqual(['Night']);
    expect(levelIntersection([['Day'], ['Night']])).toEqual([]);
  });
});

/* ── F-3C-08: desirability validation ──────────────────────────────────── */

describe('F-3C-08 desirability validation', () => {
  const base = { modelId: 'm', name: 'Y' } as const;

  it('refuses reversed limits instead of swapping them', () => {
    const reversed = goal({ ...base, lower: 10, upper: 2 });
    expect(responseIssues(reversed)).toContain('opt.issue.limitsReversed');
    expect(individualDesirability(5, reversed)).toBe(0);
  });

  it('defines Target = Lower and Target = Upper mathematically', () => {
    const atLower = goal({ ...base, goal: 'target', lower: 0, upper: 10, target: 0 });
    expect(individualDesirability(0, atLower)).toBe(1);
    expect(individualDesirability(5, atLower)).toBeCloseTo(0.5, 12);
    expect(individualDesirability(10, atLower)).toBe(0);
    const atUpper = goal({ ...base, goal: 'target', lower: 0, upper: 10, target: 10 });
    expect(individualDesirability(10, atUpper)).toBe(1);
    expect(individualDesirability(5, atUpper)).toBeCloseTo(0.5, 12);
    expect(individualDesirability(0, atUpper)).toBe(0);
  });

  it('refuses non-finite weight or importance', () => {
    expect(responseIssues(goal({ ...base, lower: 0, upper: 1, weight: Number.NaN }))).toContain('opt.issue.weight');
    expect(responseIssues(goal({ ...base, lower: 0, upper: 1, weight: Number.POSITIVE_INFINITY }))).toContain('opt.issue.weight');
    expect(responseIssues(goal({ ...base, lower: 0, upper: 1, importance: Number.NaN }))).toContain('opt.issue.importance');
    expect(compositeDesirability([{ desirability: 0.5, importance: Number.NaN, goal: 'maximize' }])).toBe(0);
  });

  it('keeps desirability and the hard specification apart', () => {
    const m = hump();
    // The whole fitted response range is far below the requested window.
    const result = optimize([m], [goal({ modelId: m.id, name: 'Y', goal: 'maximize', lower: 100, upper: 200 })], [factor('x', 0, 5)], { method: 'grid', gridPoints: 21 });
    expect(result.recommended).toBe(false);
    expect(result.solutions[0].recommended).toBe(false);
    expect(result.status).toBe('feasible-not-found');
  });

  it('treats an all-ignore problem as invalid', () => {
    const m = hump();
    const result = optimize([m], [goal({ modelId: m.id, name: 'Y', goal: 'ignore' })], [factor('x', 0, 5)]);
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.noGoal');
  });
});

/* ── F-3C-09 … F-3C-13: profiler ───────────────────────────────────────── */

describe('F-3C-09 … F-3C-13 prediction profiler', () => {
  const m = hump();
  const responses = (id: string): ResponseSettings[] => [goal({ modelId: id, name: 'Y', lower: 0, upper: 18 })];

  it('evaluates a discrete factor only at Lower + k × Step', () => {
    const discrete = factor('x', 0, 5, { kind: 'discrete', step: 0.6 });
    const axis = curveAxis(discrete, 21);
    expect(axis).toEqual([0, 0.6, 1.2, 1.8, 2.4, 3, 3.6, 4.2, 4.8]);
    const rows = profileCurves([m], responses(m.id), [discrete], { x: 1.2 }, { resolution: 21 });
    expect(rows[0].curves[0].xs).toEqual(axis);
  });

  it('evaluates a categorical factor only at fitted levels', () => {
    const scrap = model(
      [{ id: 'col-s', name: 'S', kind: 'categorical', levels: ['Day', 'Night'] }],
      [['Constant', 4], ['S[Day]', -1]],
      { response: 'Scrap' },
    );
    const categorical: FactorSettings = { name: 'S', kind: 'categorical', lower: 0, upper: 0, step: 0, fixed: false, fixedValue: 'Day', levels: ['Day', 'Night'] };
    const rows = profileCurves([scrap], responses(scrap.id), [categorical], { S: 'Night' }, { resolution: 11 });
    expect(rows[0].curves[0].xs).toEqual([0, 1]);
    expect(rows[0].curves[0].mean).toEqual([3, 5]);
  });

  it('applies the same constraints to the opening and reset values', () => {
    const discrete = factor('x', 0, 5, { kind: 'discrete', step: 0.6 });
    const centre = centrePoint([discrete]);
    expect(centre.x).toBe(2.4);
    expect(normaliseValue(discrete, 1.1)).toBe(1.2);
    const fixed = factor('x', 0, 5, { fixed: true, fixedValue: 2.4 });
    expect(centrePoint([fixed]).x).toBe(2.4);
  });

  it('holds the current condition and the curves to one input policy', () => {
    const discrete = factor('x', 0, 5, { kind: 'discrete', step: 0.6 });
    const rows = profileCurves([m], responses(m.id), [discrete], { x: 1.1 }, { resolution: 21 });
    expect(rows[0].curves[0].current).toBe(1.2);
    expect(rows[0].prediction?.value).toBeCloseTo(10 + 6 * 1.2 - 2 * 1.44, 10);
  });

  it('returns no prediction when the input fails validation', () => {
    const rows = profileCurves([m], responses(m.id), [factor('x', 0, 5)], { x: Number.NaN }, { resolution: 11 });
    expect(rows[0].prediction).toBeNull();
    expect(rows[0].issues.length).toBeGreaterThan(0);
  });

  it('separates CI from PI when the residual variance is missing', () => {
    const noMse = model([numeric('x')], [['Constant', 10], ['x', 2]], {
      bounds: { x: { min: 0, max: 5 } },
      df: 9,
      covariance: [[0.04, 0], [0, 0.01]],
    });
    const rows = profileCurves([noMse], responses(noMse.id), [factor('x', 0, 5)], { x: 1 }, { resolution: 9 });
    expect(rows[0].curves[0].ci).not.toBeNull();
    expect(rows[0].curves[0].pi).toBeNull();
    expect(rows[0].interval).toEqual({ ci: true, pi: false });
  });

  it('refuses to draw a curve for a response that needs a factor outside the list', () => {
    const two = model(
      [numeric('x'), numeric('z')],
      [['Constant', 1], ['x', 2], ['z', 3]],
      { bounds: { x: { min: 0, max: 5 }, z: { min: -1, max: 1 } } },
    );
    const rows = profileCurves([two], responses(two.id), [factor('x', 0, 5)], { x: 1 }, { resolution: 9 });
    expect(rows[0].blocked).toBe(true);
    expect(rows[0].prediction).toBeNull();
    expect(rows[0].issues.length).toBeGreaterThan(0);
  });

  it('agrees with the optimizer at the same condition', () => {
    const factors = [factor('x', 0, 5), factor('z', -1, 1, { fixed: true, fixedValue: 0.5 })];
    const two = model(
      [numeric('x'), numeric('z')],
      [['Constant', 1], ['x', 2], ['x²', -0.3], ['z', 3]],
      { bounds: { x: { min: 0, max: 5 }, z: { min: -1, max: 1 } }, df: 6, mse: 0.16, covariance: [[0.01, 0, 0, 0], [0, 0.008, 0, 0], [0, 0, 0.004, 0], [0, 0, 0, 0.02]] },
    );
    const point = { x: 2.5, z: 0.5 };
    const rows = profileCurves([two], responses(two.id), factors, point, { resolution: 11 });
    const direct = evaluateCondition([two], responses(two.id), factors, point)!;
    expect(rows[0].prediction?.value).toBeCloseTo(direct.responses[0].value as number, 12);
    expect(rows[0].prediction?.se).toBeCloseTo(direct.responses[0].se as number, 12);
    expect(rows[0].prediction?.ci?.[1]).toBeCloseTo(direct.responses[0].ci?.[1] as number, 12);
  });
});

/* ── execution control ─────────────────────────────────────────────────── */

describe('execution control', () => {
  it('honours an abort signal and says the search was cancelled', () => {
    const m = hump();
    const controller = new AbortController();
    let seen = 0;
    const result = optimize(
      [m],
      [goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 })],
      [factor('x', 0, 5)],
      {
        method: 'grid',
        gridPoints: 201,
        signal: controller.signal,
        onEvaluated: () => { seen += 1; if (seen === 5) controller.abort(); },
      },
    );
    expect(result.search.stoppedBy).toBe('cancel');
    expect(result.status).toBe('limit');
    expect(result.warnings).toContain('opt.warn.cancelled');
    expect(result.evaluations).toBeLessThan(50);
  });

  it('runs the same search asynchronously in chunks', async () => {
    const m = hump();
    const responses = [goal({ modelId: m.id, name: 'Y', lower: 0, upper: 18 })];
    const factors = [factor('x', 0, 5)];
    const sync = optimize([m], responses, factors, { method: 'multistart', seed: 12 });
    const async = await optimizeAsync([m], responses, factors, { method: 'multistart', seed: 12, chunkSize: 8 });
    expect(async.solutions[0].settings.x).toBeCloseTo(sync.solutions[0].settings.x as number, 12);
    expect(async.evaluations).toBe(sync.evaluations);
    expect(async.status).toBe(sync.status);
  });
});
