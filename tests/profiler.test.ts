import { describe, expect, it } from 'vitest';
import { createStoredModel, type ModelVariable, type StoredModel, type StoredModelDraft } from '../src/lib/modelStore';
import type { FactorSettings, ResponseSettings } from '../src/lib/optimizationTypes';
import { centrePoint, curveAxis, evaluatorFor, normaliseValue, profileCurves, profilePoint } from '../src/lib/profiler';

function model(name: string, response: string, coefficients: [string, number][], predictors: ModelVariable[], extra: Partial<StoredModelDraft> = {}): StoredModel {
  const draft: StoredModelDraft = {
    format: 'sigrun-model',
    version: 1,
    kind: 'polynomial',
    response: { id: '', name: response, kind: 'numeric' },
    predictors,
    terms: coefficients.filter(([label]) => label !== 'Constant').map(([label]) => ({ label, factors: [label.replace(/²$/, '')] })),
    coefficients: coefficients.map(([label, value]) => ({ label, value, estimable: true })),
    covariance: null,
    residual: null,
    dof: null,
    factorBounds: null,
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
    ...extra,
  };
  return createStoredModel(draft, name);
}

const numeric = (name: string): ModelVariable => ({ id: '', name, kind: 'numeric', coding: { mode: 'actual', center: 0, halfRange: 1 } });

const factors: FactorSettings[] = [
  { name: 'x', kind: 'continuous', lower: 0, upper: 10, step: 0.5, fixed: false, fixedValue: 5, levels: [] },
  { name: 'z', kind: 'continuous', lower: -2, upper: 2, step: 0.5, fixed: false, fixedValue: 0, levels: [] },
];

const goals: ResponseSettings[] = [
  { modelId: '', name: 'Y', goal: 'maximize', lower: 0, upper: 50, target: null, weight: 1, importance: 1 },
];

describe('prediction profiler curves', () => {
  const y = model('y', 'Y', [['Constant', 3], ['x', 2], ['z', -4], ['x×z', 1]], [numeric('x'), numeric('z')], {
    covariance: [[0.04, 0, 0, 0], [0, 0.01, 0, 0], [0, 0, 0.01, 0], [0, 0, 0, 0.0025]],
    residual: { df: 12, mse: 0.25, s: 0.5 },
  });
  const responses: ResponseSettings[] = [{ ...goals[0], modelId: y.id }];

  it('walks the factor range with the requested number of points', () => {
    expect(curveAxis(factors[0], 21)).toHaveLength(21);
    expect(curveAxis(factors[0], 21)[0]).toBe(0);
    expect(curveAxis(factors[0], 21)[20]).toBe(10);
    const categorical = curveAxis({ ...factors[0], kind: 'categorical', levels: ['Day', 'Night'] }, 21);
    expect(categorical).toEqual(['Day', 'Night']);
  });

  it('draws one curve per response × factor and holds the other factors still', () => {
    const rows = profileCurves([y], responses, factors, { x: 4, z: 1 }, { resolution: 11 });
    expect(rows).toHaveLength(1);
    expect(rows[0].curves).toHaveLength(2);
    // y = 3 + 2x − 4z + xz at x=4, z=1 → 3 + 8 − 4 + 4 = 11
    const atX = rows[0].curves[0];
    const index = atX.xs.indexOf(4);
    expect(atX.mean[index]).toBeCloseTo(11, 10);
    // Moving z alone changes the x-curve (that is the holding rule, not a bug).
    const other = profileCurves([y], responses, factors, { x: 4, z: 0 }, { resolution: 11 });
    expect(other[0].curves[0].mean[index]).toBeCloseTo(3 + 8, 10);
  });

  it('marks the current value on every curve', () => {
    const rows = profileCurves([y], responses, factors, { x: 2.5, z: -1 }, { resolution: 11 });
    expect(rows[0].curves[0].current).toBe(2.5);
    expect(rows[0].curves[1].current).toBe(-1);
  });

  it('agrees with the single-point prediction at the current value', () => {
    const point = { x: 6, z: 0.5 };
    const rows = profileCurves([y], responses, factors, point, { resolution: 21 });
    const single = profilePoint([y], responses, factors, point);
    const curve = rows[0].curves[0];
    const index = curve.xs.indexOf(6);
    expect(curve.mean[index]).toBeCloseTo(single!.responses[0].value as number, 10);
    expect(rows[0].prediction?.value).toBeCloseTo(single!.responses[0].value as number, 10);
    expect(rows[0].prediction?.desirability).toBeCloseTo(single!.responses[0].desirability, 12);
  });

  it('draws confidence and prediction bands when the model has covariance and df', () => {
    const rows = profileCurves([y], responses, factors, { x: 5, z: 0 }, { resolution: 9 });
    const curve = rows[0].curves[0];
    expect(curve.ci).not.toBeNull();
    expect(curve.pi).not.toBeNull();
    curve.mean.forEach((value, index) => {
      expect(curve.ci!.lo[index]).toBeLessThan(value);
      expect(curve.pi!.lo[index]).toBeLessThanOrEqual(curve.ci!.lo[index]);
      expect(curve.pi!.hi[index]).toBeGreaterThanOrEqual(curve.ci!.hi[index]);
    });
  });

  it('has no band without a covariance, and says so by returning null', () => {
    const plain = model('plain', 'Y2', [['Constant', 1], ['x', 1]], [numeric('x')]);
    const rows = profileCurves([plain], [{ ...goals[0], modelId: plain.id, name: 'Y2' }], factors, { x: 1, z: 0 }, { resolution: 5 });
    expect(rows[0].curves[0].ci).toBeNull();
    expect(rows[0].curves[0].pi).toBeNull();
    // The factor this model does not use gets no curve at all.
    expect(rows[0].curves[1].xs).toHaveLength(0);
  });

  it('lays the axis over a categorical level list without inventing a value', () => {
    const shift: ModelVariable = { id: '', name: 'Shift', kind: 'categorical', levels: ['Day', 'Night'] };
    const scrap = model('scrap', 'Scrap', [['Constant', 4], ['Shift[Day]', -1]], [shift]);
    const factor: FactorSettings = { name: 'Shift', kind: 'categorical', lower: 0, upper: 0, step: 0, fixed: false, fixedValue: 'Day', levels: ['Day', 'Night'] };
    const rows = profileCurves([scrap], [{ ...goals[0], modelId: scrap.id, name: 'Scrap' }], [factor], { Shift: 'Night' }, { resolution: 5 });
    expect(rows[0].curves[0].xs).toEqual([0, 1]);
    expect(rows[0].curves[0].mean).toEqual([3, 5]); // Day −1 → 3, Night +1 → 5
    expect(rows[0].prediction?.value).toBeCloseTo(5, 10);
  });

  it('compiles a model once and reuses the evaluator', () => {
    expect(evaluatorFor(y)).toBe(evaluatorFor(y));
  });

  it('recomputes a full matrix quickly enough for a slider', () => {
    const many = Array.from({ length: 5 }, (_, index) => model(`m${index}`, `R${index}`, [['Constant', 1], ['x', 1], ['z', 1]], [numeric('x'), numeric('z')]));
    const settings = many.map((entry) => ({ ...goals[0], modelId: entry.id, name: entry.response.name }));
    const started = Date.now();
    for (let i = 0; i < 10; i += 1) profileCurves(many, settings, factors, { x: i, z: 0.1 * i }, { resolution: 21 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('profiler inputs', () => {
  it('clamps typed values into the factor space and snaps discrete ones to the step', () => {
    expect(normaliseValue(factors[0], 12)).toBe(10);
    expect(normaliseValue(factors[0], -3)).toBe(0);
    const discrete: FactorSettings = { ...factors[0], kind: 'discrete', step: 0.5 };
    expect(normaliseValue(discrete, 3.2)).toBe(3);
    expect(normaliseValue(discrete, 3.3)).toBe(3.5);
    const categorical: FactorSettings = { ...factors[0], kind: 'categorical', levels: ['Day', 'Night'] };
    expect(normaliseValue(categorical, 'Night')).toBe('Night');
    expect(normaliseValue(categorical, 'Evening')).toBe('Day');
  });

  it('starts at the centre of every range and the first level of a categorical', () => {
    const point = centrePoint([...factors, { name: 'Shift', kind: 'categorical', lower: 0, upper: 0, step: 0, fixed: false, fixedValue: 'Night', levels: ['Day', 'Night'] }]);
    expect(point.x).toBe(5);
    expect(point.z).toBe(0);
    expect(point.Shift).toBe('Day');
  });
});
