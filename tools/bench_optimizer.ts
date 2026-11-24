/* Stage 3C performance QA — the optimiser's cost, its chunking and its memory.
 *
 *   node_modules/.bin/vite-node tools/bench_optimizer.ts
 *
 * Prints, for the shapes the window can actually produce:
 *   · evaluations, wall time and time per evaluation for a 2-factor RSM search
 *     at 21 / 41 / 101 grid points per axis (automatic method);
 *   · the same search on a fully discrete space (complete enumeration);
 *   · the cost of one second of slider work in the profiler;
 *   · the number of host yields the asynchronous runner takes (so a long search
 *     cannot freeze the window) and the heap growth over 100 repeated runs
 *     (a leak would show as growth far beyond the run-to-run noise).
 *
 * The numbers recorded in docs/PHASE3_3C_CORRECTIVE_QA.md come from this tool.
 */

import { performance } from 'node:perf_hooks';
import { createStoredModel, type ModelVariable, type StoredModel, type StoredModelDraft } from '../src/lib/modelStore';
import { optimize, optimizeAsync } from '../src/lib/optimizer';
import { profileCurves } from '../src/lib/profiler';
import type { FactorSettings, ResponseSettings } from '../src/lib/optimizationTypes';

function model(predictors: ModelVariable[], coefficients: [string, number][], name: string): StoredModel {
  const draft: StoredModelDraft = {
    format: 'sigrun-model',
    version: 1,
    kind: 'rsm',
    response: { id: '', name, kind: 'numeric' },
    predictors,
    terms: coefficients.filter(([label]) => label !== 'Constant').map(([label]) => ({ label, factors: [] })),
    coefficients: coefficients.map(([label, value]) => ({ label, value, estimable: true })),
    covariance: Array.from({ length: coefficients.length }, (_, i) => Array.from({ length: coefficients.length }, (_, j) => (i === j ? 0.01 : 0))),
    residual: { df: 9, mse: 0.09, s: 0.3 },
    dof: null,
    factorBounds: {
      [predictors[0].name]: { min: -1.189207115, max: 1.189207115 },
      [predictors[1].name]: { min: -1.189207115, max: 1.189207115 },
    },
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
  return createStoredModel(draft, name);
}

const numeric = (name: string): ModelVariable => ({ id: `col-${name}`, name, kind: 'numeric', coding: { mode: 'coded', center: 0, halfRange: 1 } });
const Y1 = model([numeric('x'), numeric('y')], [['Constant', 60], ['x', 5], ['y', -4], ['x²', -6], ['y²', -5], ['x×y', 3]], 'Y1');
const Y2 = model([numeric('x'), numeric('y')], [['Constant', 30], ['x', 3], ['y', 6], ['x²', 4], ['y²', 2], ['x×y', -2]], 'Y2');
const RANGE = 1.189207115;
const factors: FactorSettings[] = [
  { name: 'x', kind: 'continuous', lower: -RANGE, upper: RANGE, step: 0.1, fixed: false, fixedValue: 0, levels: [] },
  { name: 'y', kind: 'continuous', lower: -RANGE, upper: RANGE, step: 0.1, fixed: false, fixedValue: 0, levels: [] },
];
const responses: ResponseSettings[] = [
  { modelId: Y1.id, name: 'Y1', goal: 'maximize', lower: 40, upper: 70, target: null, weight: 1, importance: 1 },
  { modelId: Y2.id, name: 'Y2', goal: 'minimize', lower: 20, upper: 50, target: null, weight: 1, importance: 1 },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const rows: { shape: string; evaluations: number; ms: number; perEvalUs: number; status: string; stopped: string }[] = [];

for (const gridPoints of [21, 41, 101]) {
  const runs: number[] = [];
  let last = optimize([Y1, Y2], responses, factors, { method: 'multistart', gridPoints });
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    last = optimize([Y1, Y2], responses, factors, { method: 'multistart', gridPoints });
    runs.push(performance.now() - started);
  }
  rows.push({
    shape: `multistart, grid ${gridPoints}`,
    evaluations: last.evaluations,
    ms: median(runs),
    perEvalUs: (median(runs) * 1000) / Math.max(1, last.evaluations),
    status: last.status,
    stopped: last.search.stoppedBy,
  });
}

for (const step of [0.2, 0.1, 0.05]) {
  const discrete: FactorSettings[] = factors.map((factor) => ({ ...factor, kind: 'discrete', step }));
  const runs: number[] = [];
  let last = optimize([Y1, Y2], responses, discrete, { method: 'enumerate' });
  for (let index = 0; index < 3; index += 1) {
    const started = performance.now();
    last = optimize([Y1, Y2], responses, discrete, { method: 'enumerate' });
    runs.push(performance.now() - started);
  }
  rows.push({
    shape: `enumerate, step ${step} (${last.search.combinations} combinations)`,
    evaluations: last.evaluations,
    ms: median(runs),
    perEvalUs: (median(runs) * 1000) / Math.max(1, last.evaluations),
    status: last.status,
    stopped: last.search.stoppedBy,
  });
}

/* Profiler: ten slider steps over a 5-response matrix at 21 points per curve. */
const many = Array.from({ length: 5 }, (_, index) => model(
  [numeric('x'), numeric('y')],
  [['Constant', 10 + index], ['x', 2], ['y', -1], ['x²', -0.4], ['y²', -0.2], ['x×y', 0.3]],
  `R${index}`,
));
const manyResponses: ResponseSettings[] = many.map((entry) => ({ modelId: entry.id, name: entry.response.name, goal: 'maximize', lower: 0, upper: 20, target: null, weight: 1, importance: 1 }));
const profilerStarted = performance.now();
for (let index = 0; index < 10; index += 1) {
  profileCurves(many, manyResponses, factors, { x: -1 + index * 0.2, y: 0.1 * index }, { resolution: 21 });
}
const profilerMs = performance.now() - profilerStarted;

/* Asynchronous runner: does it actually hand control back? */
const heartbeats: number[] = [];
let ticks = 0;
const timer = setInterval(() => { ticks += 1; heartbeats.push(performance.now()); }, 4);
const asyncStarted = performance.now();
const asyncResult = await optimizeAsync([Y1, Y2], responses, factors.map((factor) => ({ ...factor, kind: 'discrete', step: 0.05 })), {
  method: 'enumerate',
  chunkSize: 64,
});
const asyncMs = performance.now() - asyncStarted;
clearInterval(timer);

/* Memory: five batches of 100 runs. A leak grows every batch; allocation churn
   plateaus once the collector catches up, which is what the batches show. */
const batches: number[] = [];
for (let batch = 0; batch < 5; batch += 1) {
  for (let index = 0; index < 100; index += 1) {
    optimize([Y1, Y2], responses, factors, { method: 'multistart', gridPoints: 21 });
  }
  batches.push(process.memoryUsage().heapUsed / 1048576);
}

console.log(JSON.stringify({
  rows,
  profiler: { runs: 10, responses: 5, factors: 2, resolution: 21, ms: profilerMs },
  async: {
    evaluations: asyncResult.evaluations,
    ms: asyncMs,
    heartbeats: ticks,
    firstHeartbeatBeforeEnd: heartbeats.length > 0 && heartbeats[0] < asyncStarted + asyncMs,
    chunkSize: 64,
  },
  memory: {
    runsPerBatch: 100,
    heapAfterEachBatchMB: batches,
    lastBatchGrowthMB: batches[batches.length - 1] - batches[batches.length - 2],
  },
}, null, 1));
