/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — the multi-response optimiser (WO-05)

   Given several stored models that share their factors, a goal per response and
   a search space per factor, find the factor settings whose predictions are as
   desirable as possible for all responses at once.

   How it searches (and what it promises):

   · Grid Search walks a lattice over the space. It is impartial and cheap to
     trust, but a lattice never proves a maximum is global.
   · Multi-start Local Search samples seeded start points and refines each one
     with a bounded pattern search (coordinate moves, halving steps). Repeating
     the same seed repeats the same answer.
   · Bounded Optimization is the same refinement from one deliberate start (the
     centre of the space, or the best lattice point) and stays inside the
     bounds at every step.
   · Discrete / Categorical Enumeration tries every combination when the space
     is small enough, which is the only method here that can claim the best
     answer over a fully discrete space.

   The honest reporting rule: a grid or a local search has not proved global
   optimality, so the result says "best found" unless the space was enumerated
   completely or the local search converged to its tolerance. When the
   evaluation or time budget cuts the search short, the best point found so far
   is still reported and the status says `limit`.

   Everything is computed in the browser from the stored coefficients: no
   network, no external solver, and the same seed and settings give the same
   numbers on every run.
   ───────────────────────────────────────────────────────────────────────── */

import type { StoredModel } from './modelStore';
import { tInv } from './dist';
import { parseCoefficientLabel, toDesignValue, type ParsedToken } from './modelPredictor';
import {
  compositeDesirability,
  individualDesirability,
  participates,
  responseIssues,
  responseLimits,
  withinLimits,
} from './desirability';
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  type FactorSettings,
  type OptimizerResult,
  type OptimizerSettings,
  type OptimizerStatus,
  type ResponsePrediction,
  type ResponseSettings,
  type Solution,
} from './optimizationTypes';

/* ── a compiled evaluator for one stored model ────────────────────────── */

interface CompiledTerm {
  label: string;
  value: number;
  estimable: boolean;
  tokens: ParsedToken[];
}

export interface ModelEvaluation {
  value: number | null;
  se: number | null;
  ci: [number, number] | null;
  pi: [number, number] | null;
  nonEstimable: string[];
  issues: string[];
}

export interface PointEvaluator {
  model: StoredModel;
  responseName: string;
  /** Predictor names this model needs (to fill unheld factors). */
  predictors: string[];
  evaluate(point: Record<string, number | string>, alpha: number): ModelEvaluation;
  /** Default (centre / first level) value for a predictor. */
  defaultFor(name: string): number | string | undefined;
  /** Range the model was fitted on, in input units. */
  fittedRange(name: string): [number, number] | null;
}

/**
 * Predict at a point with the model's own coding, once its labels are parsed.
 *
 * This mirrors `predictStoredModel` exactly (same token parsing, same contrast
 * coding, same covariance form) but parses each coefficient label once instead
 * of once per candidate: an optimiser evaluates tens of thousands of points and
 * a 160k-node surface already showed why that matters.
 */
export function compilePointEvaluator(model: StoredModel): PointEvaluator {
  const terms: CompiledTerm[] = model.coefficients.map((coefficient) => ({
    label: coefficient.label,
    value: coefficient.value,
    estimable: coefficient.estimable && Number.isFinite(coefficient.value),
    tokens: parseCoefficientLabel(coefficient.label),
  }));
  const predictorByName = new Map(model.predictors.map((predictor) => [predictor.name, predictor]));
  const covariance = model.covariance && model.covariance.length === model.coefficients.length ? model.covariance : null;
  const df = model.residual?.df && model.residual.df > 0 ? model.residual.df : null;
  const mse = model.residual?.mse ?? 0;
  const hasInterval = Boolean(covariance && df);

  const designValue = (name: string, raw: unknown): number => {
    const predictor = predictorByName.get(name);
    if (!predictor) throw new Error('model.structure');
    if (predictor.kind === 'categorical') return Number.NaN; // handled per token
    const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(numeric)) throw new Error('model.valueMissing');
    return toDesignValue(predictor, numeric, 'actual');
  };

  const contrast = (name: string, level: string, value: string): number => {
    const predictor = predictorByName.get(name);
    const levels = predictor?.levels ?? [];
    if (!levels.length) throw new Error('model.levelMissing');
    if (!levels.includes(value)) throw new Error('model.levelUnknown');
    if (value === level) return 1;
    if (value === levels[levels.length - 1]) return -1;
    return 0;
  };

  const row = (point: Record<string, number | string>): number[] => terms.map((term) => {
    if (!term.tokens.length) return 1;
    let product = 1;
    for (const token of term.tokens) {
      if (!predictorByName.has(token.name)) throw new Error('model.structure');
      const raw = point[token.name];
      const predictor = predictorByName.get(token.name)!;
      if (predictor.kind === 'categorical') {
        if (!token.level) throw new Error('model.structure');
        product *= contrast(token.name, token.level, String(raw ?? ''));
        continue;
      }
      const base = designValue(token.name, raw);
      product *= token.power === 1 ? base : base ** token.power;
    }
    return product;
  });

  return {
    model,
    responseName: model.response.name,
    predictors: model.predictors.map((predictor) => predictor.name),
    defaultFor(name: string) {
      const predictor = predictorByName.get(name);
      if (!predictor) return undefined;
      if (predictor.kind === 'categorical') return predictor.levels?.[0] ?? '';
      return predictor.coding?.center ?? 0;
    },
    fittedRange(name: string) {
      const bound = model.factorBounds?.[name];
      if (!bound || !Number.isFinite(bound.min) || !Number.isFinite(bound.max)) return null;
      return [bound.min, bound.max];
    },
    evaluate(point: Record<string, number | string>, alpha: number): ModelEvaluation {
      let weights: number[];
      try {
        weights = row(point);
      } catch (error) {
        return { value: null, se: null, ci: null, pi: null, nonEstimable: [], issues: [error instanceof Error ? error.message : 'model.predictFailed'] };
      }
      const nonEstimable: string[] = [];
      let fit = 0;
      for (let i = 0; i < terms.length; i += 1) {
        const weight = weights[i];
        if (!Number.isFinite(weight) || weight === 0) continue;
        const term = terms[i];
        if (!term.estimable) {
          if (!nonEstimable.includes(term.label)) nonEstimable.push(term.label);
          continue;
        }
        fit += weight * term.value;
      }
      if (nonEstimable.length) return { value: null, se: null, ci: null, pi: null, nonEstimable, issues: [] };
      let se: number | null = null;
      let ci: [number, number] | null = null;
      let pi: [number, number] | null = null;
      if (hasInterval && covariance) {
        let variance = 0;
        for (let i = 0; i < weights.length; i += 1) {
          const wi = weights[i];
          if (!Number.isFinite(wi) || wi === 0) continue;
          for (let j = 0; j < weights.length; j += 1) {
            const entry = covariance[i]?.[j];
            if (!Number.isFinite(entry)) continue;
            variance += wi * weights[j] * (entry as number);
          }
        }
        if (variance >= 0 && Number.isFinite(variance)) {
          se = Math.sqrt(variance);
          const half = tInv(1 - alpha / 2, df as number);
          const ciHalf = half * se;
          const piHalf = half * Math.sqrt(variance + Math.max(0, mse));
          if (Number.isFinite(ciHalf)) ci = [fit - ciHalf, fit + ciHalf];
          if (Number.isFinite(piHalf)) pi = [fit - piHalf, fit + piHalf];
        }
      }
      return { value: fit, se, ci, pi, nonEstimable, issues: [] };
    },
  };
}

/* ── the factor space ─────────────────────────────────────────────────── */

export interface CompiledFactor extends FactorSettings {
  /** Predictor name → the models that use it (their coding may differ). */
  usedBy: string[];
}

export interface Problem {
  evaluators: PointEvaluator[];
  factors: CompiledFactor[];
  responses: ResponseSettings[];
  /** Reasons the problem cannot be optimised (empty when it can). */
  issues: string[];
  /** Non-fatal remarks (i18n keys). */
  warnings: string[];
}

function predictorOf(model: StoredModel, name: string) {
  return model.predictors.find((predictor) => predictor.name === name);
}

/** Every factor name that appears in at least one model, in model order. */
export function sharedFactorNames(models: StoredModel[]): string[] {
  const names: string[] = [];
  models.forEach((model) => model.predictors.forEach((predictor) => {
    if (!names.includes(predictor.name)) names.push(predictor.name);
  }));
  return names;
}

/** A usable starting definition for one factor, from the models that fit it. */
export function defaultFactorSettings(models: StoredModel[], name: string): FactorSettings {
  const owners = models.filter((model) => predictorOf(model, name));
  const categorical = owners.length > 0 && owners.every((model) => predictorOf(model, name)?.kind === 'categorical');
  if (categorical) {
    const levels = [...new Set(owners.flatMap((model) => predictorOf(model, name)?.levels ?? []))];
    return { name, kind: 'categorical', lower: 0, upper: 0, step: 0, fixed: false, fixedValue: levels[0] ?? '', levels };
  }
  let lower = Number.POSITIVE_INFINITY;
  let upper = Number.NEGATIVE_INFINITY;
  owners.forEach((model) => {
    const bound = model.factorBounds?.[name];
    if (bound && Number.isFinite(bound.min) && Number.isFinite(bound.max)) {
      lower = Math.min(lower, bound.min);
      upper = Math.max(upper, bound.max);
      return;
    }
    const coding = predictorOf(model, name)?.coding;
    if (coding) {
      lower = Math.min(lower, coding.center - coding.halfRange);
      upper = Math.max(upper, coding.center + coding.halfRange);
    }
  });
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower === upper) {
    lower = -1;
    upper = 1;
  }
  const span = upper - lower;
  return {
    name,
    kind: 'continuous',
    lower,
    upper,
    step: niceStep(span / 20),
    fixed: false,
    fixedValue: (lower + upper) / 2,
    levels: [],
  };
}

/** A step that reads like a number a person would type (1, 2, 2.5, 5 × 10^k). */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exponent;
  const nice = base >= 5 ? 5 : base >= 2.5 ? 2.5 : base >= 2 ? 2 : 1;
  return nice * 10 ** exponent;
}

/**
 * Starting limits for every response, and where they come from.
 *
 * A designed fit keeps its runs, so the observed response range is the honest
 * scale for a desirability curve. A regression keeps no runs: there the range
 * the model predicts over the search space is used instead, over a coarse
 * lattice, and the window says so — a limit nobody stated is never presented as
 * data, only as a starting point the reader can replace.
 */
export function suggestResponseLimits(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
): ResponseSettings[] {
  const problem = buildProblem(models, responses, factors);
  const axes: Record<string, (number | string)[]> = {};
  problem.factors.forEach((factor) => {
    if (factor.fixed) return;
    const values = factor.kind === 'categorical'
      ? factor.levels
      : factorAxis(factor, Math.min(5, Math.max(2, Math.round(Math.cbrt(40)) + 2)));
    axes[factor.name] = values;
  });
  const names = Object.keys(axes);
  const base = fixedPoint(problem.evaluators, problem.factors);
  const samples: Record<string, number[]> = {};
  const walk = (index: number, chosen: Record<string, number | string>) => {
    if (index >= names.length) {
      const point = pointFrom(base, problem.factors, chosen);
      problem.evaluators.forEach((evaluator) => {
        const value = evaluator.evaluate(point, 0.05).value;
        if (value === null || !Number.isFinite(value)) return;
        (samples[evaluator.model.id] ??= []).push(value);
      });
      return;
    }
    for (const value of axes[names[index]]) {
      chosen[names[index]] = value;
      walk(index + 1, chosen);
    }
  };
  // 5 samples per axis keeps this under a few hundred evaluations for the
  // factor counts the optimiser accepts.
  if (names.length <= 4) walk(0, {});
  return responses.map((response) => {
    if (response.lower !== null && response.upper !== null) return response;
    const observed = (models.find((model) => model.id === response.modelId)?.design?.points ?? [])
      .map((point) => point.y)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const pool = observed.length ? observed : samples[response.modelId] ?? [];
    if (!pool.length) return response;
    const min = Math.min(...pool);
    const max = Math.max(...pool);
    if (!(max > min)) return response;
    return {
      ...response,
      lower: response.lower ?? min,
      upper: response.upper ?? max,
      target: response.goal === 'target' ? response.target ?? (min + max) / 2 : response.target,
    };
  });
}

/** A usable starting goal for a response: its observed range, maximised. */
export function defaultResponseSettings(model: StoredModel): ResponseSettings {
  const observed = (model.design?.points ?? [])
    .map((point) => point.y)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const min = observed.length ? Math.min(...observed) : null;
  const max = observed.length ? Math.max(...observed) : null;
  return {
    modelId: model.id,
    name: model.response.name,
    goal: 'maximize',
    lower: min,
    upper: max,
    target: null,
    weight: 1,
    importance: 1,
  };
}

/**
 * Assemble a problem from models, goals and factor settings.
 *
 * The problems worth stating plainly are stated here rather than discovered
 * halfway through a search: no response takes part, a model is structurally
 * broken, a factor has no usable range, or a model needs a factor nobody
 * included in the search space (which would silently hold it).
 */
export function buildProblem(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
): Problem {
  const issues: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(models.map((model) => [model.id, model]));
  const chosen = responses
    .map((settings) => ({ settings, model: byId.get(settings.modelId) }))
    .filter((entry): entry is { settings: ResponseSettings; model: StoredModel } => Boolean(entry.model));
  if (!chosen.length) issues.push('opt.issue.noResponse');
  const evaluators = chosen.map((entry) => compilePointEvaluator(entry.model));
  const activeResponses = chosen.map((entry) => entry.settings);
  if (activeResponses.length && !activeResponses.some((settings) => participates(settings))) {
    // Nothing can be optimised. Name the actual reason when the responses have
    // one (a missing limit is more useful than "no goal"), and fall back to the
    // general code when they are merely all ignored.
    const reasons = activeResponses.flatMap((settings) => responseIssues(settings));
    issues.push(...(reasons.length ? reasons : ['opt.issue.noGoal']));
  }
  if (factors.length && !factors.some((factor) => !factor.fixed)) issues.push('opt.issue.allFixed');
  // A rank-deficient model cannot be optimised: probing it would report a value
  // wherever the unidentified columns happen to weigh zero and nothing
  // elsewhere, so the whole surface is an artefact of the solver.
  if (evaluators.some((evaluator) => evaluator.model.coefficients.some((coefficient) => !coefficient.estimable || !Number.isFinite(coefficient.value)))) {
    issues.push('opt.issue.nonEstimable');
  }
  const compiled: CompiledFactor[] = factors.map((factor) => {
    const owners = chosen.filter((entry) => predictorOf(entry.model, factor.name));
    if (!owners.length) warnings.push('opt.warn.factorUnused');
    const numeric = factor.kind !== 'categorical';
    if (numeric && !(factor.upper > factor.lower) && !factor.fixed) issues.push('opt.issue.factorRange');
    if (factor.kind === 'discrete' && !(factor.step > 0) && !factor.fixed) issues.push('opt.issue.factorStep');
    return {
      ...factor,
      levels: factor.kind === 'categorical' ? factor.levels : [],
      usedBy: owners.map((entry) => entry.model.id),
    };
  });
  // A model factor that is not in the search space would be held at its centre
  // in every candidate; that is a legal design, but the reader should know.
  const factorNames = new Set(compiled.map((factor) => factor.name));
  evaluators.forEach((evaluator) => {
    const missing = evaluator.predictors.filter((name) => !factorNames.has(name));
    if (missing.length && !warnings.includes('opt.warn.heldFactors')) warnings.push('opt.warn.heldFactors');
  });
  return { evaluators, factors: compiled, responses: activeResponses, issues: [...new Set(issues)], warnings: [...new Set(warnings)] };
}

/* ── scoring one candidate ────────────────────────────────────────────── */

interface Scored {
  solution: Solution;
  /** True when the point could be evaluated at all. */
  usable: boolean;
}

function fixedPoint(evaluators: PointEvaluator[], factors: CompiledFactor[]): Record<string, number | string> {
  const point: Record<string, number | string> = {};
  factors.forEach((factor) => {
    if (!factor.fixed) return;
    point[factor.name] = factor.kind === 'categorical' ? String(factor.fixedValue) : Number(factor.fixedValue);
  });
  // Every predictor of every model must have a value; a factor that is not in
  // the search space is held at the model's own centre.
  evaluators.forEach((evaluator) => {
    evaluator.predictors.forEach((name) => {
      if (point[name] !== undefined) return;
      if (factors.some((factor) => factor.name === name)) return;
      const fallback = evaluator.defaultFor(name);
      if (fallback !== undefined) point[name] = fallback;
    });
  });
  return point;
}

export function scorePoint(
  evaluators: PointEvaluator[],
  factors: CompiledFactor[],
  responses: ResponseSettings[],
  point: Record<string, number | string>,
  options: { alpha: number; factorsByModelBound?: boolean; origin?: Solution['origin'] } = { alpha: 0.05 },
): Scored {
  const predictions: ResponsePrediction[] = [];
  const entries: { desirability: number; importance: number; goal: ResponseSettings['goal'] }[] = [];
  let compliantAll = true;
  let usable = false;
  let extrapolated = false;
  evaluators.forEach((evaluator) => {
    const settings = responses.find((response) => response.modelId === evaluator.model.id);
    if (!settings) return;
    const evaluation = evaluator.evaluate(point, options.alpha);
    usable = usable || evaluation.value !== null;
    const desirability = individualDesirability(evaluation.value, settings);
    const compliant = withinLimits(evaluation.value, settings) && evaluation.nonEstimable.length === 0;
    predictions.push({
      modelId: evaluator.model.id,
      name: evaluator.responseName,
      goal: settings.goal,
      value: evaluation.value,
      se: evaluation.se,
      ci: evaluation.ci,
      pi: evaluation.pi,
      desirability,
      compliant,
      nonEstimable: evaluation.nonEstimable,
      issues: evaluation.issues,
    });
    if (participates(settings)) {
      entries.push({ desirability, importance: settings.importance, goal: settings.goal });
      if (!compliant) compliantAll = false;
    }
    factors.forEach((factor) => {
      const value = point[factor.name];
      if (typeof value !== 'number') return;
      const range = evaluator.fittedRange(factor.name);
      if (range && (value < range[0] - 1e-9 || value > range[1] + 1e-9)) extrapolated = true;
    });
  });
  const settings: Record<string, number | string> = {};
  const coded: Record<string, number> = {};
  factors.forEach((factor) => {
    const value = point[factor.name];
    if (value === undefined) return;
    settings[factor.name] = value;
    if (typeof value === 'number') {
      const model = evaluators.find((evaluator) => factor.usedBy.includes(evaluator.model.id));
      const predictor = model ? model.model.predictors.find((candidate) => candidate.name === factor.name) : undefined;
      coded[factor.name] = predictor ? toDesignValue(predictor, value, 'actual') : value;
    } else {
      coded[factor.name] = Number.NaN;
    }
  });
  return {
    usable,
    solution: {
      settings,
      coded,
      responses: predictions,
      composite: compositeDesirability(entries),
      compliantAll: compliantAll && entries.length > 0,
      extrapolated,
      origin: options.origin ?? 'grid',
    },
  };
}

/* ── axis values ──────────────────────────────────────────────────────── */

export function factorAxis(factor: CompiledFactor, gridPoints: number): (number | string)[] {
  if (factor.fixed) return [factor.kind === 'categorical' ? String(factor.fixedValue) : Number(factor.fixedValue)];
  if (factor.kind === 'categorical') return [...factor.levels];
  if (factor.kind === 'discrete') {
    const step = factor.step > 0 ? factor.step : (factor.upper - factor.lower) / 10 || 1;
    const values: number[] = [];
    for (let value = factor.lower; value <= factor.upper + step * 1e-9; value += step) values.push(roundTo(value, step));
    if (!values.length) values.push(factor.lower);
    return values;
  }
  const points = Math.max(2, Math.round(gridPoints));
  return Array.from({ length: points }, (_, index) => factor.lower + ((factor.upper - factor.lower) * index) / (points - 1));
}

function roundTo(value: number, step: number): number {
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(step)) + 2));
  return Number(value.toFixed(decimals));
}

function spaceSize(factors: CompiledFactor[], gridPoints: number): number {
  return factors.reduce((size, factor) => {
    if (factor.fixed) return size;
    if (factor.kind === 'categorical') return size * Math.max(1, factor.levels.length);
    if (factor.kind === 'discrete') return size * Math.max(1, factorAxis(factor, gridPoints).length);
    return size * Math.max(2, gridPoints);
  }, 1);
}

/* ── a seeded pseudo-random generator (reproducible starts) ───────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── the search ───────────────────────────────────────────────────────── */

interface SearchState {
  best: Scored | null;
  pool: Scored[];
  evaluations: number;
  iterations: number;
  limitReached: boolean;
  converged: boolean;
}

const better = (a: Scored, b: Scored): boolean => {
  // A compliant point beats a non-compliant one; within the same class the
  // composite decides, then the lower extrapolation.
  if (a.solution.compliantAll !== b.solution.compliantAll) return a.solution.compliantAll;
  if (a.solution.composite !== b.solution.composite) return a.solution.composite > b.solution.composite;
  return a.solution.extrapolated === false && b.solution.extrapolated === true;
};

function keepPool(pool: Scored[], candidate: Scored, topN: number): Scored[] {
  const key = (solution: Solution) => Object.entries(solution.settings)
    .map(([name, value]) => `${name}=${typeof value === 'number' ? (Math.abs(value) < 1 ? value.toExponential(3) : value.toPrecision(6)) : value}`)
    .join('|');
  const signature = key(candidate.solution);
  if (pool.some((entry) => key(entry.solution) === signature)) return pool;
  const next = [...pool, candidate].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  return next.slice(0, Math.max(1, topN));
}

function evaluateAt(
  state: SearchState,
  problem: Problem,
  point: Record<string, number | string>,
  settings: OptimizerSettings,
  origin: Solution['origin'],
  deadline: number,
): Scored {
  if (state.evaluations >= settings.maxEvaluations || Date.now() > deadline) {
    state.limitReached = true;
    return state.best ?? { usable: false, solution: emptySolution(origin) };
  }
  state.evaluations += 1;
  const scored = scorePoint(problem.evaluators, problem.factors, problem.responses, point, { alpha: settings.alpha, origin });
  if (!scored.usable) return scored;
  if (!state.best || better(scored, state.best)) state.best = scored;
  state.pool = keepPool(state.pool, scored, settings.topN);
  return scored;
}

function emptySolution(origin: Solution['origin']): Solution {
  return { settings: {}, coded: {}, responses: [], composite: 0, compliantAll: false, extrapolated: false, origin };
}

/** Build a full candidate point from per-factor values plus the held factors. */
function pointFrom(base: Record<string, number | string>, factors: CompiledFactor[], values: Record<string, number | string>): Record<string, number | string> {
  const point: Record<string, number | string> = { ...base };
  factors.forEach((factor) => {
    if (factor.fixed) return;
    const value = values[factor.name];
    if (value !== undefined) point[factor.name] = value;
  });
  return point;
}

function gridValues(factors: CompiledFactor[], gridPoints: number, budget: number): { values: Record<string, (number | string)[]>; reduced: boolean } {
  const values: Record<string, (number | string)[]> = {};
  factors.forEach((factor) => {
    if (factor.fixed) return;
    values[factor.name] = factorAxis(factor, gridPoints);
  });
  // When the lattice is larger than the budget, thin the continuous axes (discrete
  // ones keep their step: a step is a promise the reader made).
  let size = Object.values(values).reduce((acc, axis) => acc * axis.length, 1);
  let reduced = false;
  let guard = 0;
  while (size > budget && guard < 60) {
    guard += 1;
    let widest: string | null = null;
    let widestLength = 2;
    Object.entries(values).forEach(([name, axis]) => {
      const factor = factors.find((candidate) => candidate.name === name);
      if (!factor || factor.kind !== 'continuous') return;
      if (axis.length > widestLength) { widest = name; widestLength = axis.length; }
    });
    if (!widest) break;
    const factor = factors.find((candidate) => candidate.name === widest)!;
    const nextCount = Math.max(2, Math.floor(widestLength / 2));
    values[widest] = Array.from({ length: nextCount }, (_, index) => factor.lower + ((factor.upper - factor.lower) * index) / (nextCount - 1));
    size = Object.values(values).reduce((acc, axis) => acc * axis.length, 1);
    reduced = true;
  }
  return { values, reduced };
}

function enumerateGrid(
  state: SearchState,
  problem: Problem,
  settings: OptimizerSettings,
  deadline: number,
  origin: Solution['origin'],
): void {
  const base = fixedPoint(problem.evaluators, problem.factors);
  const { values } = gridValues(problem.factors, settings.gridPoints, settings.maxEvaluations);
  const names = Object.keys(values);
  const walk = (index: number, chosen: Record<string, number | string>) => {
    if (state.limitReached) return;
    if (index >= names.length) {
      evaluateAt(state, problem, pointFrom(base, problem.factors, chosen), settings, origin, deadline);
      return;
    }
    for (const value of values[names[index]]) {
      chosen[names[index]] = value;
      walk(index + 1, chosen);
      if (state.limitReached) return;
    }
    delete chosen[names[index]];
  };
  walk(0, {});
}

/** Steps a factor can take during the local refinement. */
function stepVector(factors: CompiledFactor[], settings: OptimizerSettings): Record<string, number> {
  const steps: Record<string, number> = {};
  factors.forEach((factor) => {
    if (factor.fixed || factor.kind === 'categorical') return;
    const span = factor.upper - factor.lower;
    const base = factor.kind === 'discrete' && factor.step > 0 ? factor.step : span / 4;
    steps[factor.name] = Math.max(base, span * settings.tolerance);
  });
  return steps;
}

function refine(
  state: SearchState,
  problem: Problem,
  settings: OptimizerSettings,
  deadline: number,
  start: Record<string, number | string>,
): void {
  const base = fixedPoint(problem.evaluators, problem.factors);
  const free = problem.factors.filter((factor) => !factor.fixed && factor.kind !== 'categorical');
  if (!free.length) {
    // A fully categorical / fixed space has nothing to refine continuously.
    evaluateAt(state, problem, pointFrom(base, problem.factors, start), settings, 'local', deadline);
    state.converged = true;
    return;
  }
  const steps = stepVector(problem.factors, settings);
  let current = { ...start };
  let currentScore = evaluateAt(state, problem, pointFrom(base, problem.factors, current), settings, 'local', deadline);
  let improved = true;
  let guard = 0;
  while (improved && !state.limitReached && guard < 400) {
    guard += 1;
    state.iterations += 1;
    improved = false;
    for (const factor of free) {
      const step = steps[factor.name];
      if (!(step > 0)) continue;
      for (const direction of [1, -1]) {
        const proposal = { ...current };
        const raw = Number(current[factor.name]) + direction * step;
        const clamped = Math.min(factor.upper, Math.max(factor.lower, raw));
        if (factor.kind === 'discrete' && factor.step > 0) {
          const snapped = factor.lower + Math.round((clamped - factor.lower) / factor.step) * factor.step;
          proposal[factor.name] = Number(snapped.toFixed(10));
        } else {
          proposal[factor.name] = clamped;
        }
        if (proposal[factor.name] === current[factor.name]) continue;
        const scored = evaluateAt(state, problem, pointFrom(base, problem.factors, proposal), settings, 'local', deadline);
        if (scored.usable && better(scored, currentScore)) {
          current = proposal;
          currentScore = scored;
          improved = true;
          break;
        }
        if (state.limitReached) break;
      }
      if (state.limitReached) break;
    }
    if (!improved) {
      // Shrink every step; the search has converged when all of them are at the
      // tolerance, which is when "optimal" may be claimed for this basin.
      let anyAbove = false;
      free.forEach((factor) => {
        const span = factor.upper - factor.lower;
        const next = steps[factor.name] / 2;
        steps[factor.name] = next;
        if (next > span * settings.tolerance) anyAbove = true;
      });
      improved = anyAbove;
      if (!anyAbove) state.converged = true;
    }
  }
}

function randomStart(factors: CompiledFactor[], random: () => number): Record<string, number | string> {
  const point: Record<string, number | string> = {};
  factors.forEach((factor) => {
    if (factor.fixed) return;
    if (factor.kind === 'categorical') {
      const levels = factor.levels;
      point[factor.name] = levels.length ? levels[Math.floor(random() * levels.length)] : '';
      return;
    }
    const value = factor.lower + (factor.upper - factor.lower) * random();
    if (factor.kind === 'discrete' && factor.step > 0) {
      point[factor.name] = Number((factor.lower + Math.round((value - factor.lower) / factor.step) * factor.step).toFixed(10));
    } else {
      point[factor.name] = value;
    }
  });
  return point;
}

function centreStart(factors: CompiledFactor[]): Record<string, number | string> {
  const point: Record<string, number | string> = {};
  factors.forEach((factor) => {
    if (factor.fixed) return;
    if (factor.kind === 'categorical') {
      point[factor.name] = factor.levels[0] ?? '';
      return;
    }
    point[factor.name] = (factor.lower + factor.upper) / 2;
  });
  return point;
}

/** The public entry point: optimise, or say precisely why it cannot. */
export function optimize(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
  options: Partial<OptimizerSettings> = {},
): OptimizerResult {
  const settings: OptimizerSettings = { ...DEFAULT_OPTIMIZER_SETTINGS, ...options };
  const started = Date.now();
  const deadline = started + Math.max(50, settings.timeLimitMs);
  const problem = buildProblem(models, responses, factors);
  const baseResult: Omit<OptimizerResult, 'status' | 'solutions' | 'issues' | 'warnings' | 'elapsedMs'> = {
    method: settings.method,
    resolvedMethod: settings.method === 'auto' ? 'multistart' : settings.method,
    seed: settings.seed,
    evaluations: 0,
    iterations: 0,
  };
  if (problem.issues.length) {
    return {
      ...baseResult,
      status: 'invalid',
      solutions: [],
      issues: problem.issues,
      warnings: problem.warnings,
      elapsedMs: Date.now() - started,
    };
  }
  const state: SearchState = { best: null, pool: [], evaluations: 0, iterations: 0, limitReached: false, converged: false };
  const size = spaceSize(problem.factors, settings.gridPoints);
  let method = settings.method;
  const warnings = [...problem.warnings];
  if (method === 'auto') {
    const allDiscreteOrCategorical = problem.factors.every((factor) => factor.fixed || factor.kind !== 'continuous');
    if (size <= settings.maxEvaluations / 2 && (allDiscreteOrCategorical || size <= 400)) method = 'enumerate';
    else method = 'multistart';
    baseResult.resolvedMethod = method as Exclude<OptimizerSettings['method'], 'auto'>;
  }
  if (method === 'enumerate' || method === 'grid') {
    if (size > settings.maxEvaluations) warnings.push('opt.warn.gridReduced');
    enumerateGrid(state, problem, settings, deadline, method === 'enumerate' ? 'enumerated' : 'grid');
    if (method === 'enumerate' && !state.limitReached) state.converged = true;
  } else if (method === 'bounded') {
    enumerateGrid(state, problem, { ...settings, gridPoints: Math.max(3, Math.min(settings.gridPoints, 9)) }, deadline, 'grid');
    refine(state, problem, settings, deadline, state.best ? { ...state.best.solution.settings } : centreStart(problem.factors));
  } else {
    // Multi-start: a coarse lattice first (so a good basin is not missed), then
    // seeded random starts refined locally.
    enumerateGrid(state, problem, { ...settings, gridPoints: Math.max(3, Math.min(settings.gridPoints, 9)) }, deadline, 'grid');
    const random = mulberry32(settings.seed);
    const starts = Math.max(3, Math.min(12, 2 + problem.factors.length * 2));
    for (let index = 0; index < starts; index += 1) {
      if (state.limitReached) break;
      const start = index === 0 && state.best ? { ...state.best.solution.settings } : randomStart(problem.factors, random);
      refine(state, problem, settings, deadline, start);
    }
  }
  const solutions = state.pool.length
    ? state.pool
    : state.best
      ? [state.best]
      : [];
  const best = solutions[0];
  let status: OptimizerStatus;
  if (!best || !best.usable) status = 'invalid';
  else if (best.solution.composite <= 0) status = 'no-feasible';
  else if (state.limitReached) status = 'limit';
  else if (method === 'enumerate' && state.converged) status = 'optimal';
  else if ((method === 'bounded' || method === 'multistart') && state.converged) status = 'optimal';
  else status = 'best-found';
  if (status === 'invalid') warnings.push('opt.warn.noEvaluablePoint');
  if (status === 'no-feasible') warnings.push('opt.warn.noCompliantPoint');
  return {
    ...baseResult,
    status,
    solutions: solutions.map((entry) => entry.solution),
    evaluations: state.evaluations,
    iterations: state.iterations,
    issues: [],
    warnings: [...new Set(warnings)],
    elapsedMs: Date.now() - started,
  };
}

/** Evaluate one condition (the profiler's live point) with the same scoring. */
export function evaluateCondition(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
  point: Record<string, number | string>,
  options: { alpha?: number } = {},
): Solution | null {
  const problem = buildProblem(models, responses, factors);
  if (!problem.evaluators.length) return null;
  const base = fixedPoint(problem.evaluators, problem.factors);
  const full = pointFrom(base, problem.factors, point);
  return scorePoint(problem.evaluators, problem.factors, problem.responses, full, { alpha: options.alpha ?? 0.05, origin: 'start' }).solution;
}

/** Why a response definition cannot take part (i18n keys, empty when it can). */
export function responseProblems(responses: ResponseSettings[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  responses.forEach((settings) => {
    const issues = responseIssues(settings);
    if (issues.length) out[settings.modelId] = issues;
  });
  return out;
}

/** The limits as [lower, upper], for the UI to draw spec lines. */
export function limitsOf(settings: ResponseSettings): [number, number] | null {
  const limits = responseLimits(settings);
  return limits ? [limits.lower, limits.upper] : null;
}
