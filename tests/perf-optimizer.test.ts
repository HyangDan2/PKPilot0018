/* Stage 3C performance QA (F-3C execution control).
 *
 * These are budget assertions, not benchmarks: each threshold is wide enough to
 * survive a slow CI machine and still fail if the search stops yielding, if an
 * evaluation becomes an order of magnitude more expensive, or if repeated runs
 * accumulate memory. The measured numbers are printed by
 * `node_modules/.bin/vite-node tools/bench_optimizer.ts` and recorded in
 * docs/PHASE3_3C_CORRECTIVE_QA.md.
 */

import { describe, expect, it } from 'vitest';
import { createStoredModel, type ModelVariable, type StoredModel, type StoredModelDraft } from '../src/lib/modelStore';
import { optimize, optimizeAsync } from '../src/lib/optimizer';
import { profileCurves } from '../src/lib/profiler';
import type { FactorSettings, ResponseSettings } from '../src/lib/optimizationTypes';

function rsm(response: string, coefficients: [string, number][], predictors: string[]): StoredModel {
  const variables: ModelVariable[] = predictors.map((name) => ({ id: `col-${name}`, name, kind: 'numeric', coding: { mode: 'coded', center: 0, halfRange: 1 } }));
  const draft: StoredModelDraft = {
    format: 'sigrun-model',
    version: 1,
    kind: 'rsm',
    response: { id: '', name: response, kind: 'numeric' },
    predictors: variables,
    terms: coefficients.filter(([label]) => label !== 'Constant').map(([label]) => ({ label, factors: [] })),
    coefficients: coefficients.map(([label, value]) => ({ label, value, estimable: true })),
    covariance: Array.from({ length: coefficients.length }, (_, i) => Array.from({ length: coefficients.length }, (_, j) => (i === j ? 0.01 : 0))),
    residual: { df: 9, mse: 0.09, s: 0.3 },
    dof: null,
    factorBounds: Object.fromEntries(predictors.map((name) => [name, { min: -1.189207115, max: 1.189207115 }])),
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
  return createStoredModel(draft, response);
}

const y1 = rsm('Y1', [['Constant', 60], ['x', 5], ['y', -4], ['x²', -6], ['y²', -5], ['x×y', 3]], ['x', 'y']);
const y2 = rsm('Y2', [['Constant', 30], ['x', 3], ['y', 6], ['x²', 4], ['y²', 2], ['x×y', -2]], ['x', 'y']);
const RANGE = 1.189207115;
const factors: FactorSettings[] = [
  { name: 'x', kind: 'continuous', lower: -RANGE, upper: RANGE, step: 0.1, fixed: false, fixedValue: 0, levels: [] },
  { name: 'y', kind: 'continuous', lower: -RANGE, upper: RANGE, step: 0.1, fixed: false, fixedValue: 0, levels: [] },
];
const responses: ResponseSettings[] = [
  { modelId: y1.id, name: 'Y1', goal: 'maximize', lower: 40, upper: 70, target: null, weight: 1, importance: 1 },
  { modelId: y2.id, name: 'Y2', goal: 'minimize', lower: 20, upper: 50, target: null, weight: 1, importance: 1 },
];

describe('optimiser performance and execution control', () => {
  it('finishes a two-factor multi-start search in a few tens of milliseconds', () => {
    const started = Date.now();
    const result = optimize([y1, y2], responses, factors, { method: 'multistart', gridPoints: 21 });
    const elapsed = Date.now() - started;
    expect(result.evaluations).toBeGreaterThan(100);
    // 600 evaluations of two six-term models; measured ≈ 17 ms locally.
    expect(elapsed).toBeLessThan(2000);
    expect(result.search.stoppedBy).toBe('complete');
  });

  it('enumerates a 2 304-combination discrete space well inside the UI budget', () => {
    const discrete = factors.map((factor) => ({ ...factor, kind: 'discrete' as const, step: 0.05 }));
    const started = Date.now();
    const result = optimize([y1, y2], responses, discrete, { method: 'enumerate' });
    const elapsed = Date.now() - started;
    expect(result.search.combinations).toBe(2304);
    expect(result.evaluations).toBe(2304);
    expect(result.status).toBe('global-optimal');
    expect(elapsed).toBeLessThan(4000);
  });

  it('stops at the evaluation budget instead of running past it', () => {
    const discrete = factors.map((factor) => ({ ...factor, kind: 'discrete' as const, step: 0.05 }));
    const result = optimize([y1, y2], responses, discrete, { method: 'enumerate', maxEvaluations: 500 });
    expect(result.evaluations).toBe(500);
    expect(result.search.stoppedBy).toBe('budget');
    expect(result.status).toBe('limit');
  });

  it('stops at the time limit and says so', () => {
    const discrete = factors.map((factor) => ({ ...factor, kind: 'discrete' as const, step: 0.02 }));
    const started = Date.now();
    const result = optimize([y1, y2], responses, discrete, { method: 'enumerate', maxEvaluations: 1_000_000, timeLimitMs: 120 });
    const elapsed = Date.now() - started;
    expect(result.search.stoppedBy).toBe('time');
    expect(elapsed).toBeLessThan(3000);
  });

  it('yields to the host between chunks so the window keeps painting', async () => {
    const discrete = factors.map((factor) => ({ ...factor, kind: 'discrete' as const, step: 0.05 }));
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 2);
    const result = await optimizeAsync([y1, y2], responses, discrete, { method: 'enumerate', chunkSize: 64 });
    clearInterval(timer);
    expect(result.evaluations).toBe(2304);
    // 2304 / 64 = 36 chunk boundaries; most of them must have let the timer run.
    expect(ticks).toBeGreaterThan(3);
  });

  it('does not accumulate memory across repeated runs', () => {
    const measure = () => {
      const before = process.memoryUsage().heapUsed;
      for (let index = 0; index < 60; index += 1) optimize([y1, y2], responses, factors, { method: 'multistart', gridPoints: 21 });
      return (process.memoryUsage().heapUsed - before) / 1048576;
    };
    measure(); // warm-up (JIT, caches)
    const growth = measure();
    // 60 runs of a ~600-evaluation search allocate far less than the 40 MB a
    // retained per-run buffer (solutions, pools, basins) would need.
    expect(growth).toBeLessThan(40);
  });

  it('keeps a five-response profiler matrix under a slider frame budget', () => {
    const many = Array.from({ length: 5 }, (_, index) => rsm(`R${index}`, [['Constant', 10 + index], ['x', 2], ['y', -1], ['x²', -0.4], ['y²', -0.2], ['x×y', 0.3]], ['x', 'y']));
    const manyResponses: ResponseSettings[] = many.map((entry) => ({ modelId: entry.id, name: entry.response.name, goal: 'maximize', lower: 0, upper: 20, target: null, weight: 1, importance: 1 }));
    const started = Date.now();
    for (let index = 0; index < 10; index += 1) {
      profileCurves(many, manyResponses, factors, { x: -1 + index * 0.2, y: 0.1 * index }, { resolution: 21 });
    }
    const elapsed = Date.now() - started;
    // 10 redraws of 10 curves × 21 points; measured ≈ 54 ms locally.
    expect(elapsed).toBeLessThan(1500);
  });
});
