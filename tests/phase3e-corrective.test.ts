/* Stage 3E corrective review QA — fail-first suite (F-01 … F-15).

   Every test below states a rule the Phase 3E baseline (924721b) does not
   implement. The file is the contract the corrective report cites: it fails on
   the baseline and passes only when the correction is in place.

   The nine cases the work order names explicitly are marked `[R1]` … `[R9]`;
   the rest pin the remaining findings (F-04 … F-15) that the same work order
   lists. */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createStoredModel, type ModelVariable, type StoredModel, type StoredModelDraft } from '../src/lib/modelStore';
import {
  discreteAxis,
  discreteValueAt,
  isOnStep,
  nearestStepValue,
  relativeSlack,
  validateFactorValue,
} from '../src/lib/factorDomain';
import { createPredictionAdapter, crossCheck } from '../src/lib/predictionAdapter';
import { compileSurfaceEvaluator, modelSurface, predictStoredModel } from '../src/lib/modelPredictor';
import { buildProblem, evaluateCondition, localSteps, optimize } from '../src/lib/optimizer';
import { profileCurves } from '../src/lib/profiler';
import { buildProject, parseProject, serializeProject } from '../src/lib/project';
import type { FactorSettings, ResponseSettings } from '../src/lib/optimizationTypes';
import { DATASETS } from '../src/lib/datasets';

/* ── helpers ───────────────────────────────────────────────────────────── */

const NON_FINITE = 'model.value.nonFinite';

function numeric(name: string, center = 0, halfRange = 1, unit?: string): ModelVariable {
  return { id: `col-${name}`, name, kind: 'numeric', coding: { mode: 'coded', center, halfRange }, ...(unit ? { unit } : {}) };
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
  return createStoredModel(draft, 'qa');
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

/* ── R1 · F-01 — a non-finite weight is an error on every path ─────────── */

describe('[R1] polynomial overflow is refused identically on every prediction path', () => {
  it('the adapter refuses an infinite term weight instead of dropping the term', () => {
    const stored = quadratic();
    const adapter = createPredictionAdapter(stored);
    const evaluation = adapter.evaluate({ A: 1e160, B: 0 });
    expect(evaluation.value).toBeNull();
    expect(evaluation.issues).toContain(NON_FINITE);
  });

  it('the Model Manager path refuses the same point with the same code', () => {
    const direct = predictStoredModel(quadratic(), { A: 1e160, B: 0 });
    expect(direct.value).toBeNull();
    expect(direct.issues).toContain(NON_FINITE);
  });

  it('the surface node and the surface grid carry the same code, not a number', () => {
    const stored = quadratic();
    const evaluator = compileSurfaceEvaluator(stored, { xName: 'A', yName: 'B', mode: 'actual' });
    const node = evaluator.evaluate(1e160, 0);
    expect(node.value).toBeNull();
    expect(node.issues).toContain(NON_FINITE);
    const grid = modelSurface(stored, { xName: 'A', yName: 'B', xRange: [1e160, 1e160], yRange: [0, 0], resolution: 2, mode: 'actual' });
    expect(grid.z.flat().every((value) => Number.isNaN(value))).toBe(true);
  });

  it('a finite weight whose covariance product overflows fails the interval, not the mean', () => {
    // Round 2 (R-01) supersedes this assertion: ŷ = 1e308 is a number the model
    // really predicts, so the point keeps its mean and only the band is refused.
    const stored = quadratic();
    const adapter = createPredictionAdapter(stored);
    // A² = 1e308 is finite; w'Σw then overflows.
    const evaluation = adapter.evaluate({ A: 1e154, B: 0 });
    expect(evaluation.value).not.toBeNull();
    expect(evaluation.se).toBeNull();
    expect(evaluation.ci).toBeNull();
    expect(evaluation.pi).toBeNull();
    expect(evaluation.issues).toContain('model.interval.nonFinite');
    expect(evaluation.issues).not.toContain('model.covariance.negativeVariance');
    expect(evaluation.issues).not.toContain(NON_FINITE);
  });

  it('the optimiser reports the same code at a fixed overflowing condition', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [factor('A', { fixed: true, fixedValue: 1e160, lower: -1e160, upper: 1e160 }), factor('B')],
      { allowExtrapolation: true, maxEvaluations: 600, timeLimitMs: 2000 },
    );
    // No candidate can be evaluated, so the search reports the refusal itself
    // rather than an empty answer: the code is the one the other paths give.
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain(NON_FINITE);
    expect(result.warnings).toContain('opt.warn.noEvaluablePoint');
  });

  it('the profiler row reports the same code at a fixed overflowing condition', () => {
    const stored = quadratic();
    const rows = profileCurves(
      [stored],
      [responseFor(stored)],
      [factor('A', { fixed: true, fixedValue: 1e160, lower: -1e160, upper: 1e160 }), factor('B', { fixed: true, fixedValue: 0 })],
      {},
      { resolution: 5 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prediction?.value).toBeNull();
    expect(rows[0].prediction?.issues).toContain(NON_FINITE);
    expect(rows[0].issues).toContain(NON_FINITE);
  });
});

/* ── R2 · F-02 — the lower bound keeps its decimals ────────────────────── */

describe('[R2] a discrete lattice keeps the reference value decimal part', () => {
  const LOWER = 100000000.01;
  const STEP = 0.1;

  it('the first lattice value is exactly Lower', () => {
    expect(discreteValueAt(LOWER, STEP, 0)).toBe(LOWER);
  });

  it('the lattice advances by exactly one step', () => {
    expect(discreteValueAt(LOWER, STEP, 1)).toBe(100000000.11);
    expect(discreteValueAt(LOWER, STEP, 5)).toBe(100000000.51);
  });

  it('the axis, the snap and the step count agree with Lower', () => {
    const axis = discreteAxis(LOWER, 100000000.51, STEP);
    expect(axis.count).toBe(6);
    expect(axis.values[0]).toBe(LOWER);
    expect(axis.values[5]).toBe(100000000.51);
    expect(nearestStepValue(LOWER, 100000000.51, STEP, 100000000.24).value).toBe(100000000.21);
    expect(isOnStep(LOWER, 100000000.51, STEP, 100000000.31)).toBe(true);
  });
});

/* ── R3 · F-02 — values outside the safe integer range are refused ─────── */

describe('[R3] a discrete domain beyond the safe integer range is refused', () => {
  it('the factor definition reports the safe-integer issue', () => {
    const huge = discrete('A', 0, 1e20, 1);
    expect(validateFactorValue(huge, 5)).not.toBeNull();
  });

  it('the optimiser refuses to search it', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [discrete('A', 0, 1e20, 1), factor('B')],
      { maxEvaluations: 100, timeLimitMs: 1000 },
    );
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.integerSafeRange');
  });

  it('a huge fixed value is refused for the same reason', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [discrete('A', 0, 1e20, 1), factor('B', { fixed: true, fixedValue: 0 })],
      { maxEvaluations: 100, timeLimitMs: 1000 },
    );
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.integerSafeRange');
  });
});

/* ── R4 · F-02 — a step below the float resolution is refused ──────────── */

describe('[R4] a large offset with a step below the representable resolution is refused', () => {
  it('the lattice itself never hands out the same value twice', () => {
    const axis = discreteAxis(1e15, 1e15 + 0.5, 0.1, 100);
    const strictlyIncreasing = axis.values.every((value, index) => index === 0 || value > axis.values[index - 1]);
    expect(strictlyIncreasing).toBe(true);
  });

  it('the factor definition reports the precision issue', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [discrete('A', 1e15, 1e15 + 0.5, 0.1), factor('B')],
      { maxEvaluations: 100, timeLimitMs: 1000, allowExtrapolation: true },
    );
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.stepBelowPrecision');
  });
});

/* ── R5 · F-03 — a fixed factor may not leave the fitted region ────────── */

describe('[R5] a fixed factor outside the fitted region is refused while extrapolation is off', () => {
  const stored = quadratic();

  it('the optimiser refuses the condition', () => {
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [factor('A', { fixed: true, fixedValue: 3, lower: -5, upper: 5 }), factor('B')],
      { maxEvaluations: 500, timeLimitMs: 2000 },
    );
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.fixedExtrapolation');
  });

  it('the same condition is allowed when extrapolation is explicitly allowed', () => {
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [factor('A', { fixed: true, fixedValue: 3, lower: -5, upper: 5 }), factor('B')],
      { allowExtrapolation: true, maxEvaluations: 500, timeLimitMs: 2000 },
    );
    expect(result.status).not.toBe('invalid');
    expect(result.warnings).toContain('opt.warn.extrapolation');
  });

  it('a fixed value inside the fitted region is untouched', () => {
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [factor('A', { fixed: true, fixedValue: 0.5 }), factor('B')],
      { maxEvaluations: 500, timeLimitMs: 2000 },
    );
    expect(result.status).not.toBe('invalid');
  });
});

/* ── R6 · F-08 — duplicate factor definitions are refused ──────────────── */

describe('[R6] a duplicate factor name or identifier is refused', () => {
  it('two factors with the same name cannot be compiled into one problem', () => {
    const stored = quadratic();
    const problem = buildProblem([stored], [responseFor(stored)], [factor('A'), factor('A'), factor('B')]);
    expect(problem.issues).toContain('opt.issue.factorDuplicate');
  });

  it('the optimiser returns invalid rather than searching the merge', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [factor('A'), factor('A', { lower: -2, upper: 2 }), factor('B')],
      { maxEvaluations: 200, timeLimitMs: 1000 },
    );
    expect(result.status).toBe('invalid');
    expect(result.issues).toContain('opt.issue.factorDuplicate');
  });

  it('a stored model with two predictors of the same name is refused', () => {
    const duplicated = model(
      [numeric('A'), numeric('A')],
      [['Constant', 1], ['A', 2]],
      { bounds: { A: { min: -1, max: 1 } } },
    );
    const problem = buildProblem([duplicated], [responseFor(duplicated)], [factor('A')]);
    expect(problem.issues).toContain('opt.issue.factorDuplicate');
  });
});

/* ── R7 · F-04…F-06 — project version and damaged worksheets ───────────── */

describe('[R7] a project is restored only when its version and sheets are sound', () => {
  const sheet = DATASETS[0].build();
  const settings = { theme: 'light' as const, lang: 'en' as const };

  it('the writer stamps the current schema version', () => {
    const project = buildProject({ worksheets: [sheet], activeSheetId: sheet.id, settings, outputs: [] });
    expect(project.version).toBe(2);
  });

  it('a project from a newer schema version is refused instead of half-read', () => {
    const text = JSON.stringify({
      format: 'sigrun-project', version: 99, worksheets: [sheet], activeSheetId: sheet.id, settings, outputs: [],
    });
    expect(() => parseProject(text)).toThrow('file.versionNewer');
  });

  it('a non-numeric version is refused', () => {
    const text = JSON.stringify({
      format: 'sigrun-project', version: 'beta', worksheets: [sheet], activeSheetId: sheet.id, settings, outputs: [],
    });
    expect(() => parseProject(text)).toThrow('file.versionInvalid');
  });

  it('a version-1 project is migrated, not discarded', () => {
    const legacy = JSON.stringify({
      format: 'sigrun-project', version: 1, app: 'HD2Lab Sigrún', worksheets: [sheet], activeSheetId: sheet.id,
    });
    const restored = parseProject(legacy);
    expect(restored.version).toBe(2);
    expect(restored.worksheets).toHaveLength(1);
  });

  it('a project without a version is read as the legacy schema and migrated', () => {
    const legacy = JSON.stringify({ format: 'sigrun-project', worksheets: [sheet], activeSheetId: sheet.id });
    expect(parseProject(legacy).version).toBe(2);
  });

  it('a damaged worksheet stops the restore instead of vanishing silently', () => {
    const damaged = { ...sheet, columns: [{ ...sheet.columns[0], values: 'not an array' }] };
    const text = JSON.stringify({
      format: 'sigrun-project', version: 2, worksheets: [sheet, damaged], activeSheetId: sheet.id, settings, outputs: [],
    });
    expect(() => parseProject(text)).toThrow('file.worksheetCorrupt');
  });

  it('duplicate column identifiers stop the restore', () => {
    const column = sheet.columns[0];
    const duplicate = { ...sheet, columns: [column, { ...column, name: 'Copy' }] };
    const text = JSON.stringify({
      format: 'sigrun-project', version: 2, worksheets: [duplicate], activeSheetId: sheet.id, settings, outputs: [],
    });
    expect(() => parseProject(text)).toThrow('file.worksheetCorrupt');
  });

  it('a damaged stored model stops the restore', () => {
    const text = JSON.stringify({
      format: 'sigrun-project',
      version: 2,
      worksheets: [sheet],
      activeSheetId: sheet.id,
      settings,
      outputs: [],
      models: [{ format: 'sigrun-model', id: 'm1', predictors: 'nope' }],
    });
    expect(() => parseProject(text)).toThrow('file.modelCorrupt');
  });

  it('a sound project still round-trips', () => {
    const text = serializeProject({ worksheets: [sheet], activeSheetId: sheet.id, settings, outputs: [] });
    const restored = parseProject(text);
    expect(restored.worksheets[0].columns[0].values.slice(0, 3)).toEqual(sheet.columns[0].values.slice(0, 3));
  });
});

/* ── R8 · F-09…F-11 — the tools run from a fresh checkout ──────────────── */

describe('[R8] the portable build and the E2E suite are reproducible from a fresh checkout', () => {
  const root = process.cwd();
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };

  it('declares the browser automation dependency used by the E2E suites', () => {
    const declared = pkg.devDependencies['playwright-core'] ?? pkg.devDependencies.playwright;
    expect(declared).toBeTruthy();
  });

  it('keeps no machine-specific absolute path in the tooling', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(path.join(root, 'tools'))) {
      if (!/\.(cjs|mjs|js)$/.test(name)) continue;
      const text = readFileSync(path.join(root, 'tools', name), 'utf8');
      if (/\/workspace\//.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('resolves the browser and its libraries through one documented helper', () => {
    const helper = path.join(root, 'tools', 'browser_env.cjs');
    expect(existsSync(helper)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(helper) as { resolveBrowser?: () => unknown; describeEnvironment?: () => string };
    expect(typeof loaded.resolveBrowser).toBe('function');
    expect(typeof loaded.describeEnvironment).toBe('function');
  });

  it('offers the portable build and the offline E2E as package scripts', () => {
    expect(pkg.scripts['build:portable']).toBeTruthy();
    expect(pkg.scripts['qa:portable']).toBeTruthy();
  });

  it('states the CI wiring for the portable build in the workflow or the patch note', () => {
    const candidates = [
      path.join(root, '.github', 'workflows', 'deploy.yml'),
      path.join(root, '.github', 'workflows', 'portable.yml'),
      path.join(root, 'docs', 'CI_PORTABLE_PATCH.md'),
    ].filter((file) => existsSync(file));
    const text = candidates.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(text).toContain('npm ci');
    expect(text).toContain('build:portable');
  });
});

/* ── R9 · F-01 — every path agrees point for point ─────────────────────── */

describe('[R9] Model Manager, contour, surface, optimiser and profiler agree', () => {
  it('agrees on the value, the interval and the error state at ordinary points', () => {
    const stored = quadratic();
    const adapter = createPredictionAdapter(stored);
    const evaluator = compileSurfaceEvaluator(stored, { xName: 'A', yName: 'B', mode: 'actual' });
    const factors = [factor('A'), factor('B')];
    const responses = [responseFor(stored)];
    for (const point of [{ A: 0, B: 0 }, { A: 0.3, B: -0.7 }, { A: -1, B: 1 }]) {
      const direct = predictStoredModel(stored, point);
      const mine = adapter.evaluate(point);
      const node = evaluator.evaluate(point.A, point.B);
      const optimised = evaluateCondition([stored], responses, factors, point, { allowExtrapolation: true });
      const profile = profileCurves([stored], responses, factors, point, { resolution: 5 });
      const value = direct.value as number;
      expect(mine.value).toBeCloseTo(value, 10);
      expect(node.value as number).toBeCloseTo(value, 10);
      expect(optimised?.responses[0].value as number).toBeCloseTo(value, 10);
      expect(profile[0].prediction?.value as number).toBeCloseTo(value, 10);
      expect(direct.issues).toEqual(mine.issues);
      expect(optimised?.responses[0].issues).toEqual(mine.issues);
      expect(profile[0].prediction?.issues).toEqual(mine.issues);
    }
  });

  it('agrees on the refusal at an overflowing point', () => {
    const stored = quadratic();
    const adapter = createPredictionAdapter(stored);
    const evaluator = compileSurfaceEvaluator(stored, { xName: 'A', yName: 'B', mode: 'actual' });
    const point = { A: 1e160, B: 0 };
    const direct = predictStoredModel(stored, point);
    const mine = adapter.evaluate(point);
    const node = evaluator.evaluate(point.A, point.B);
    const profile = profileCurves([stored], [responseFor(stored)], [factor('A', { fixed: true, fixedValue: 1e160, lower: -1e160, upper: 1e160 }), factor('B', { fixed: true, fixedValue: 0 })], {}, { resolution: 3 });
    for (const issues of [direct.issues, mine.issues, node.issues, profile[0].prediction?.issues ?? [], profile[0].issues]) {
      expect(issues).toContain(NON_FINITE);
    }
    expect(direct.value).toBeNull();
    expect(mine.value).toBeNull();
    expect(node.value).toBeNull();
    expect(profile[0].prediction?.value).toBeNull();
  });

  it('crossCheck reports a scope that covers the value, the interval and the issues', () => {
    const stored = quadratic();
    for (const point of [{ A: 0, B: 0 }, { A: 0.3, B: -0.7 }, { A: 1e160, B: 0 }]) {
      const checked = crossCheck(stored, point);
      expect(checked.delta.issues).toBe(0);
      expect(checked.consistent).toBe(true);
    }
  });

  it('crossCheck is not fooled when only one side can state an interval', () => {
    const noMse = model(
      [numeric('A')],
      [['Constant', 1], ['A', 2]],
      { bounds: { A: { min: -1, max: 1 } }, covariance: [[0.04, 0], [0, 0.04]], df: 5 },
    );
    const checked = crossCheck(noMse, { A: 0.2 });
    expect(checked.parallel).toBeNull();
    expect(checked.consistent).toBe(true);
  });
});

/* ── F-07 — one relative policy, and local steps on the lattice ────────── */

describe('[F-07] the step policy is relative and the local search stays on the lattice', () => {
  it('reports the slack the policy allows at a given magnitude', () => {
    expect(relativeSlackOf(1e8)).toBeCloseTo(0.1, 10);
    expect(relativeSlackOf(1)).toBeCloseTo(1e-9, 18);
  });

  it('quantises a discrete local step to a whole number of declared steps', () => {
    const steps = localSteps([factor('A', { kind: 'discrete', lower: 0, upper: 0.7, step: 0.1 })], { tolerance: 0.3 } as never);
    expect(steps.A).toBeGreaterThanOrEqual(0.1);
    expect(Math.round(steps.A / 0.1)).toBeCloseTo(steps.A / 0.1, 10);
  });

  it('never reports a discrete solution off its own lattice', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [discrete('A', -1, 1, 0.25), discrete('B', -1, 1, 0.5)],
      { maxEvaluations: 5000, timeLimitMs: 4000 },
    );
    expect(result.solutions.length).toBeGreaterThan(0);
    for (const solution of result.solutions) {
      expect(isOnStep(-1, 1, 0.25, solution.settings.A as number)).toBe(true);
      expect(isOnStep(-1, 1, 0.5, solution.settings.B as number)).toBe(true);
    }
  });

  function relativeSlackOf(magnitude: number): number {
    return relativeSlack(magnitude);
  }
});

/* ── F-12 · F-13 — the release artefacts are valid and reproducible ────── */

describe('[F-12/F-13] the ZIP timestamp and the build manifest are sound', () => {
  it('clamps the ZIP timestamp into the DOS date range', async () => {
    const manifest = await import('../tools/build_manifest.mjs');
    const before = manifest.resolveBuildDate({ SOURCE_DATE_EPOCH: '0' }, new Date('2020-01-01T00:00:00Z'));
    expect(before.getUTCFullYear()).toBe(1980);
    const after = manifest.resolveBuildDate({ SOURCE_DATE_EPOCH: String(Date.UTC(2200, 0, 2) / 1000) }, new Date('2020-01-01T00:00:00Z'));
    expect(after.getUTCFullYear()).toBe(2107);
  });

  it('uses SOURCE_DATE_EPOCH so two builds of one commit can agree', async () => {
    const manifest = await import('../tools/build_manifest.mjs');
    const a = manifest.resolveBuildDate({ SOURCE_DATE_EPOCH: '1764000000' }, new Date('2026-11-24T00:00:00Z'));
    const b = manifest.resolveBuildDate({ SOURCE_DATE_EPOCH: '1764000000' }, new Date('2027-05-05T00:00:00Z'));
    expect(a.toISOString()).toBe(b.toISOString());
  });

  it('writes a manifest that names the version, the commit and the hashes', async () => {
    const manifest = await import('../tools/build_manifest.mjs');
    const info = manifest.buildManifest({
      version: '1.0.0',
      commit: 'abc1234',
      builtAt: new Date('2026-11-24T12:00:00Z'),
      file: 'sigrun-portable.html',
      bytes: 10,
      sha256: 'f'.repeat(64),
      zip: { file: 'sigrun-portable.zip', bytes: 5, sha256: 'e'.repeat(64) },
    });
    expect(info.version).toBe('1.0.0');
    expect(info.commit).toBe('abc1234');
    expect(info.builtAt).toBe('2026-11-24T12:00:00.000Z');
    expect(info.sha256).toHaveLength(64);
    expect(info.format).toContain('iife');
  });
});

/* ── F-15 — the About panel states the build it is ─────────────────────── */

describe('[F-15] the About panel states the real version', () => {
  it('reports the package version and the current stage', async () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string };
    const info = await import('../src/lib/appInfo');
    expect(info.APP_VERSION).toBe(pkg.version);
    expect(info.APP_PHASE).toBe('Phase 3');
    expect(info.aboutVersionLine('ko')).toContain(info.APP_VERSION);
    expect(info.aboutVersionLine('en')).toContain(info.APP_VERSION);
    expect(info.aboutVersionLine('ko')).toContain('Phase 3');
  });

  it('no longer claims Phase 1 in the About panel', () => {
    const source = readFileSync(path.join(process.cwd(), 'src', 'components', 'HelpModal.tsx'), 'utf8');
    expect(source).not.toContain("PHASE 1 ·");
    expect(source).toContain('aboutVersionLine');
  });
});

/* ── F-01/F-02 · input policy stays one policy ─────────────────────────── */

describe('[F-02] the discrete input policy is one policy', () => {
  it('snaps a typed value to the decimal lattice, not to a rounded base', () => {
    const snapped = nearestStepValue(100000000.01, 100000000.51, 0.1, 100000000.36);
    expect(snapped.value).toBe(100000000.31);
    // 100000000.36 is between two lattice points: it snaps, and is not on-step.
    expect(snapped.onStep).toBe(false);
    expect(nearestStepValue(100000000.01, 100000000.51, 0.1, 100000000.31).onStep).toBe(true);
  });

  it('accepts a fixed value that sits on a decimal lattice whose base has decimals', () => {
    const stored = quadratic();
    const result = optimize(
      [stored],
      [responseFor(stored)],
      [discrete('A', 100000000.01, 100000000.51, 0.1), factor('B', { fixed: true, fixedValue: 0 })],
      { maxEvaluations: 200, timeLimitMs: 1000, allowExtrapolation: true },
    );
    expect(result.issues).not.toContain('opt.issue.fixedOffStep');
  });
});
