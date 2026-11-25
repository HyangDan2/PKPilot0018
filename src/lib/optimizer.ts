/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — the multi-response optimiser (WO-05), Stage 3C corrected

   Given several stored models that share their factors, a goal per response and
   a search space per factor, find the factor settings whose predictions are as
   desirable as possible for all responses at once.

   What changed in the Stage 3C correction, and why it is written this way:

   · Predictions come from `predictionAdapter`, the same engine the profiler
     uses. This module contains no prediction arithmetic of its own.
   · A factor's domain is a domain, not a suggestion: discrete values are
     exactly Lower + k × Step, categorical values are fitted levels only, and a
     fixed value must be one of them. Every candidate is checked against the
     domain immediately before it is evaluated, so a search can never report a
     condition it was not allowed to try.
   · The default domain is the intersection of what the models were fitted on;
     an empty intersection is an error. Searching outside that region requires
     the reader to allow it explicitly, per factor or globally.
   · What the search proved is reported separately from what it found: a
     continuous lattice is never called globally optimal, a converged local
     search says so per basin, and a budget/time/cancel stop says `limit`.
   · Hard specifications decide the recommendation. A condition that misses a
     specification is reported with its desirability but never offered as the
     answer.
   · The search is a generator: `optimize` drains it synchronously (the QA
     adapter and tests), `optimizeAsync` yields to the host between chunks (the
     window), and an AbortSignal stops it mid-grid.

   Everything is computed in the browser from the stored coefficients: no
   network, no external solver, and the same seed and settings give the same
   numbers on every run.
   ───────────────────────────────────────────────────────────────────────── */

import type { ModelVariable, StoredModel } from './modelStore';
import { meanIssues } from './modelPredictor';
import {
  createPredictionAdapter,
  type ActualPoint,
  type AdapterEvaluation,
  type PredictionAdapter,
} from './predictionAdapter';
import {
  compositeDesirability,
  individualDesirability,
  limitsReversed,
  participates,
  responseIssues,
  responseLimits,
  withinLimits,
} from './desirability';
import {
  duplicateFactorNames,
  duplicatePredictorNames,
  factorAxisSize,
  factorAxisValues,
  factorIssues,
  holdingValue,
  levelIntersection,
  nearestStepValue,
  rangeIntersection,
  rangeSlack,
  relativeSlack,
  validateFactorValue,
} from './factorDomain';
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  type BasinReport,
  type FactorSettings,
  type OptimizerResult,
  type OptimizerSettings,
  type OptimizerStatus,
  type ResponsePrediction,
  type ResponseSettings,
  type SearchAxis,
  type SearchReport,
  type Solution,
} from './optimizationTypes';

/* ── the factor space ─────────────────────────────────────────────────── */

export interface CompiledFactor extends FactorSettings {
  /** Model ids that use this factor. */
  usedBy: string[];
  /** Actual-unit region the models were fitted on (negotiated across models). */
  fitted: [number, number] | null;
}

export interface Problem {
  adapters: PredictionAdapter[];
  factors: CompiledFactor[];
  responses: ResponseSettings[];
  /** Reasons the problem cannot be optimised (empty when it can). */
  issues: string[];
  /** Non-fatal remarks (i18n keys). */
  warnings: string[];
  /** Per-response definition problems, by model id. */
  responseIssues: Record<string, string[]>;
}

export interface ProblemOptions {
  /** Search outside the fitted region (a factor may also allow it individually). */
  allowExtrapolation?: boolean;
  /** Refuse a model variable that is not in the factor list (search) — the
      default for the optimiser. The profiler passes false: it shows the block. */
  requireAllFactors?: boolean;
  /** Cross-model unit / column / type checks (default true). */
  checkCompatibility?: boolean;
}

function predictorOf(model: StoredModel, name: string): ModelVariable | undefined {
  return model.predictors.find((predictor) => predictor.name === name);
}

function normaliseUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\s+/g, '');
}

/** Every factor name that appears in at least one model, in model order. */
export function sharedFactorNames(models: StoredModel[]): string[] {
  const names: string[] = [];
  models.forEach((model) => model.predictors.forEach((predictor) => {
    if (!names.includes(predictor.name)) names.push(predictor.name);
  }));
  return names;
}

/** A step that reads like a number a person would type (1, 2, 2.5, 5 × 10^k). */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const base = raw / 10 ** exponent;
  const nice = base >= 5 ? 5 : base >= 2.5 ? 2.5 : base >= 2 ? 2 : 1;
  return nice * 10 ** exponent;
}

/** The actual-unit fitted range of one predictor, from the model's own record. */
function fittedRangeOf(model: StoredModel, name: string): [number, number] | null {
  const bound = model.factorBounds?.[name];
  if (bound && Number.isFinite(bound.min) && Number.isFinite(bound.max) && bound.max > bound.min) return [bound.min, bound.max];
  const coding = predictorOf(model, name)?.coding;
  if (coding && Number.isFinite(coding.center) && Number.isFinite(coding.halfRange) && coding.halfRange > 0) {
    return [coding.center - coding.halfRange, coding.center + coding.halfRange];
  }
  return null;
}

/**
 * A usable starting definition for one factor, from the models that fit it.
 *
 * Numeric: the intersection of the fitted ranges (never the union — a search
 * that starts outside one model's data is not a search of that model).
 * Categorical: the levels every model fitted. When no intersection exists the
 * union is offered so the window can show something, and `buildProblem` reports
 * the empty domain instead of searching it.
 */
export function defaultFactorSettings(models: StoredModel[], name: string): FactorSettings {
  const owners = models.filter((model) => predictorOf(model, name));
  const categorical = owners.length > 0 && owners.every((model) => predictorOf(model, name)?.kind === 'categorical');
  if (categorical) {
    const lists = owners.map((model) => predictorOf(model, name)?.levels ?? []);
    const levels = levelIntersection(lists);
    const union = [...new Set(lists.flat())];
    return {
      name,
      kind: 'categorical',
      lower: 0,
      upper: 0,
      step: 0,
      fixed: false,
      fixedValue: (levels[0] ?? union[0]) ?? '',
      levels: levels.length ? levels : union,
      domainSource: 'levels',
    };
  }
  const ranges = owners.map((model) => fittedRangeOf(model, name)).filter((range): range is [number, number] => Boolean(range));
  const intersection = rangeIntersection(ranges);
  const union = ranges.length
    ? [
      Math.min(...ranges.map(([a]) => a)),
      Math.max(...ranges.map(([, b]) => b)),
    ] as [number, number]
    : null;
  const lower = intersection ? intersection[0] : (union?.[0] ?? -1);
  const upper = intersection ? intersection[1] : (union?.[1] ?? 1);
  const span = upper - lower;
  return {
    name,
    kind: 'continuous',
    lower: lower === upper ? lower - 0.5 : lower,
    upper: lower === upper ? upper + 0.5 : upper,
    step: niceStep(Math.abs(span) / 20 || 0.1),
    fixed: false,
    fixedValue: (lower + upper) / 2,
    levels: [],
    domainSource: ranges.length ? (intersection ? 'intersection' : 'fitted') : 'stated',
  };
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
 * halfway through a search: a response that cannot take part, a model nobody
 * selected, a duplicate response, two models whose "temperature" is not the
 * same temperature, a factor whose fitted ranges do not overlap, a model
 * variable nobody included (which would otherwise be held at a value the
 * reader never chose), and a fixed value that is not in its own domain.
 */
export function buildProblem(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
  options: ProblemOptions = {},
): Problem {
  const allowExtrapolation = options.allowExtrapolation ?? false;
  const requireAllFactors = options.requireAllFactors ?? true;
  const checkCompatibility = options.checkCompatibility ?? true;
  const issues: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(models.map((model) => [model.id, model]));

  /* identifiers: a name used twice is not a domain, it is two of them */
  const duplicatedFactors = duplicateFactorNames(factors);
  if (duplicatedFactors.length) issues.push('opt.issue.factorDuplicate');

  /* responses */
  if (!responses.length) issues.push('opt.issue.noResponse');
  const seen = new Map<string, number>();
  responses.forEach((settings) => seen.set(settings.modelId, (seen.get(settings.modelId) ?? 0) + 1));
  if ([...seen.values()].some((count) => count > 1)) issues.push('opt.issue.responseDuplicate');
  const missingModel = responses.filter((settings) => !byId.has(settings.modelId));
  if (missingModel.length) issues.push('opt.issue.modelMissing');
  const chosen = responses
    .map((settings) => ({ settings, model: byId.get(settings.modelId) }))
    .filter((entry): entry is { settings: ResponseSettings; model: StoredModel } => Boolean(entry.model));

  /* per-response definition problems: every active response must be well posed */
  const responseProblems: Record<string, string[]> = {};
  let anyParticipates = false;
  let anyActive = false;
  chosen.forEach((entry) => {
    const problems = responseIssues(entry.settings);
    if (problems.length) {
      responseProblems[entry.settings.modelId] = problems;
      issues.push(...problems);
    }
    if (entry.settings.goal !== 'ignore') anyActive = true;
    if (participates(entry.settings)) anyParticipates = true;
  });
  if (anyActive && !anyParticipates && !issues.length) issues.push('opt.issue.noGoal');
  if (!anyActive && chosen.length) warnings.push('opt.warn.noGoal');
  if (responses.length && !responses.some((settings) => participates(settings)) && !issues.length && !anyActive) issues.push('opt.issue.noGoal');

  /* adapters */
  const adapters = chosen.map((entry) => createPredictionAdapter(entry.model));
  // Two predictors with one name would resolve every coefficient label to the
  // first of them, so the model is not one model: refuse it rather than search
  // a column the reader cannot name.
  if (adapters.some((adapter) => duplicatePredictorNames(adapter.model.predictors).length > 0)) {
    issues.push('opt.issue.factorDuplicate');
  }
  // A rank-deficient model cannot be optimised: probing it would report a value
  // wherever the unidentified columns happen to weigh zero and nothing
  // elsewhere, so the whole surface is an artefact of the solver.
  if (adapters.some((adapter) => adapter.model.coefficients.some((coefficient) => !coefficient.estimable || !Number.isFinite(coefficient.value)))) {
    issues.push('opt.issue.nonEstimable');
  }

  /* factors */
  const factorNames = new Set(factors.map((factor) => factor.name));
  const compiled: CompiledFactor[] = factors.map((factor) => {
    const owners = chosen.filter((entry) => predictorOf(entry.model, factor.name));
    if (!owners.length) warnings.push('opt.warn.factorUnused');
    issues.push(...factorIssues(factor));

    const predictors = owners.map((entry) => ({ model: entry.model, predictor: predictorOf(entry.model, factor.name) as ModelVariable }));
    let levels = factor.kind === 'categorical' ? factor.levels : [];
    let fitted: [number, number] | null = null;

    if (checkCompatibility && predictors.length) {
      const kinds = new Set(predictors.map((entry) => entry.predictor.kind));
      if (kinds.size > 1) issues.push('opt.issue.typeConflict');
      const ids = predictors.map((entry) => entry.predictor.id).filter(Boolean);
      if (new Set(ids).size > 1) issues.push('opt.issue.columnConflict');
      const units = predictors.map((entry) => (entry.predictor.unit ?? '').trim()).filter(Boolean);
      if (new Set(units.map(normaliseUnit)).size > 1) {
        issues.push('opt.issue.unitConflict');
        if (!warnings.includes('opt.warn.unitConflict')) warnings.push('opt.warn.unitConflict');
      }
      if (kinds.size === 1 && kinds.has('categorical')) {
        const lists = predictors.map((entry) => entry.predictor.levels ?? []);
        const shared = levelIntersection(lists);
        if (!shared.length) issues.push('opt.issue.levelIntersection');
        else {
          const outside = factor.levels.filter((level) => !shared.includes(level));
          // The search may only use levels every model fitted; when the reader's
          // list is wider (or empty) the intersection is what is searchable.
          levels = factor.levels.length === 0 || outside.length ? shared : factor.levels;
          if (outside.length) warnings.push('opt.warn.levelsNarrowed');
        }
      }
    }

    if (factor.kind !== 'categorical' && predictors.length) {
      const ranges = predictors.map((entry) => fittedRangeOf(entry.model, factor.name)).filter((range): range is [number, number] => Boolean(range));
      const intersection = rangeIntersection(ranges);
      if (ranges.length && !intersection) issues.push('opt.issue.rangeIntersection');
      fitted = intersection ?? (ranges.length === 1 ? ranges[0] : null);
      if (fitted) {
        const allowed = factor.allowExtrapolation === true || allowExtrapolation;
        if (factor.fixed) {
          // A fixed factor is not a free pass out of the fitted region: the
          // model is being asked a question its data did not cover, whichever
          // way the reader set the value.
          const value = Number(factor.fixedValue);
          // A value already outside the factor's own limits is refused as that
          // (`opt.issue.fixedOutside`); the fitted-region check is for a value
          // the limits allow but the models' data does not cover.
          const withinLimits = Number.isFinite(value)
            && value >= factor.lower - rangeSlack(factor.lower, factor.upper, value)
            && value <= factor.upper + rangeSlack(factor.lower, factor.upper, value);
          const outside = withinLimits
            && (value < fitted[0] - rangeSlack(fitted[0], fitted[1], value) || value > fitted[1] + rangeSlack(fitted[0], fitted[1], value));
          if (outside && !allowed) issues.push('opt.issue.fixedExtrapolation');
          if (outside && allowed && !warnings.includes('opt.warn.extrapolation')) warnings.push('opt.warn.extrapolation');
        } else {
          const outside = factor.lower < fitted[0] - rangeSlack(fitted[0], fitted[1], factor.lower)
            || factor.upper > fitted[1] + rangeSlack(fitted[0], fitted[1], factor.upper);
          if (outside && !allowed) issues.push('opt.issue.extrapolationNotAllowed');
          if (outside && allowed && !warnings.includes('opt.warn.extrapolation')) warnings.push('opt.warn.extrapolation');
        }
      }
    }

    return { ...factor, levels, usedBy: owners.map((entry) => entry.model.id), fitted };
  });

  /* a model variable nobody put in the search space is never held silently */
  adapters.forEach((adapter) => {
    const missing = adapter.predictors.filter((name) => !factorNames.has(name));
    if (missing.length && requireAllFactors) {
      issues.push('opt.issue.factorMissing');
      if (!warnings.includes('opt.warn.factorMissing')) warnings.push('opt.warn.factorMissing');
    }
  });

  return {
    adapters,
    factors: compiled,
    responses: chosen.map((entry) => entry.settings),
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
    responseIssues: responseProblems,
  };
}

/* ── the one input policy ─────────────────────────────────────────────── */

export interface ResolvedPoint {
  point: ActualPoint;
  /** Values that could not be used, by factor name. */
  issues: Record<string, string>;
  /** Values the reader typed that were snapped into the factor's domain. */
  snapped: string[];
}

/**
 * Complete and normalise a condition against the factor list.
 *
 * This is the single policy the optimiser's candidates and the profiler's
 * current point both go through: a fixed factor is read at its fixed value, a
 * missing factor at its holding value (the middle of its range), a discrete
 * value is snapped to Lower + k × Step, a typed value outside the range is
 * clamped, and a non-finite number is reported instead of being replaced.
 */
export function resolvePoint(factors: FactorSettings[], point: ActualPoint): ResolvedPoint {
  const out: ActualPoint = {};
  const issues: Record<string, string> = {};
  const snapped: string[] = [];
  factors.forEach((factor) => {
    if (factor.fixed) {
      out[factor.name] = factor.kind === 'categorical' ? String(factor.fixedValue) : Number(factor.fixedValue);
      return;
    }
    const raw = point[factor.name] === undefined ? holdingValue(factor) : point[factor.name];
    if (factor.kind === 'categorical') {
      const text = String(raw);
      if (!factor.levels.includes(text)) {
        if (raw === undefined || raw === null || raw === '') {
          out[factor.name] = factor.levels[0] ?? '';
          return;
        }
        issues[factor.name] = 'opt.issue.levelUnknown';
        out[factor.name] = text;
        return;
      }
      out[factor.name] = text;
      return;
    }
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(numeric)) {
      issues[factor.name] = 'opt.issue.valueMissing';
      out[factor.name] = Number.NaN;
      return;
    }
    const clamped = Math.min(factor.upper, Math.max(factor.lower, numeric));
    if (factor.kind === 'discrete') {
      // Snapping clamps the integer index into the domain, so the result is an
      // allowed value inside the range even when the input was outside it.
      const value = nearestStepValue(factor.lower, factor.upper, factor.step, clamped).value;
      if (Math.abs(value - numeric) > rangeSlack(factor.lower, factor.upper, numeric)) snapped.push(factor.name);
      out[factor.name] = value;
      return;
    }
    if (Math.abs(clamped - numeric) > rangeSlack(factor.lower, factor.upper, numeric)) snapped.push(factor.name);
    out[factor.name] = clamped;
  });
  return { point: out, issues, snapped };
}

/** Why a candidate cannot be evaluated at all (empty when it can). */
export function candidateIssues(factors: CompiledFactor[], point: ActualPoint): string[] {
  const issues: string[] = [];
  factors.forEach((factor) => {
    if (factor.fixed) return;
    const problem = validateFactorValue(factor, point[factor.name]);
    if (problem) issues.push(`${problem}:${factor.name}`);
  });
  return issues;
}

/* ── scoring one candidate ────────────────────────────────────────────── */

interface Scored {
  solution: Solution;
  /** True when at least one response could be evaluated at all. */
  usable: boolean;
}

export function scorePoint(
  adapters: PredictionAdapter[],
  factors: (FactorSettings & { usedBy?: string[] })[],
  responses: ResponseSettings[],
  point: ActualPoint,
  options: { alpha?: number; origin?: Solution['origin'] } = {},
): Scored {
  const alpha = options.alpha ?? 0.05;
  const predictions: ResponsePrediction[] = [];
  const entries: { desirability: number; importance: number; goal: ResponseSettings['goal'] }[] = [];
  let compliantAll = true;
  let usable = false;
  let extrapolated = false;
  adapters.forEach((adapter) => {
    const settings = responses.find((response) => response.modelId === adapter.model.id);
    if (!settings) return;
    const evaluation: AdapterEvaluation = adapter.evaluate(point, alpha);
    if (evaluation.value !== null) usable = true;
    const desirability = individualDesirability(evaluation.value, settings);
    // Compliance is about the MEAN: a point whose interval could not be
    // computed still has a value the desirability can rank and the limits can
    // judge. The interval remark is carried in `issues` and shown beside it.
    const compliant = evaluation.nonEstimable.length === 0
      && meanIssues(evaluation.issues).length === 0
      && withinLimits(evaluation.value, settings);
    predictions.push({
      modelId: adapter.model.id,
      name: adapter.responseName,
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
      const range = adapter.fittedRange(factor.name);
      if (range && (value < range[0] - relativeSlack(range[0]) || value > range[1] + relativeSlack(range[1]))) extrapolated = true;
    });
  });
  const settingsOut: ActualPoint = {};
  const coded: Record<string, number> = {};
  factors.forEach((factor) => {
    const value = point[factor.name];
    if (value === undefined) return;
    settingsOut[factor.name] = value;
    if (typeof value === 'number') {
      const adapter = adapters.find((candidate) => (factor.usedBy ?? []).includes(candidate.model.id)) ?? adapters[0];
      coded[factor.name] = adapter ? adapter.designValue(factor.name, value) : value;
    } else {
      coded[factor.name] = Number.NaN;
    }
  });
  const compliant = compliantAll && entries.length > 0;
  return {
    usable,
    solution: {
      settings: settingsOut,
      coded,
      responses: predictions,
      composite: compositeDesirability(entries),
      compliantAll: compliant,
      extrapolated,
      recommended: compliant,
      origin: options.origin ?? 'grid',
    },
  };
}

const better = (a: Scored, b: Scored): boolean => {
  // A compliant point beats a non-compliant one; within compliant points the
  // composite decides; within non-compliant points prefer higher composite or
  // smaller constraint violation so local search can walk toward feasibility.
  if (a.solution.compliantAll !== b.solution.compliantAll) return a.solution.compliantAll;
  if (a.solution.composite !== b.solution.composite) return a.solution.composite > b.solution.composite;
  if (!a.solution.compliantAll && !b.solution.compliantAll) {
    const aSum = a.solution.responses.reduce((acc, r) => acc + (Number.isFinite(r.desirability) ? r.desirability : 0), 0);
    const bSum = b.solution.responses.reduce((acc, r) => acc + (Number.isFinite(r.desirability) ? r.desirability : 0), 0);
    if (aSum !== bSum) return aSum > bSum;
  }
  return a.solution.extrapolated === false && b.solution.extrapolated === true;
};

function signatureOf(solution: Solution): string {
  return Object.entries(solution.settings)
    .map(([name, value]) => `${name}=${typeof value === 'number' ? (Math.abs(value) < 1 ? value.toExponential(6) : value.toPrecision(10)) : value}`)
    .join('|');
}

function keepPool(pool: Scored[], candidate: Scored, topN: number): Scored[] {
  const signature = signatureOf(candidate.solution);
  if (pool.some((entry) => signatureOf(entry.solution) === signature)) return pool;
  const next = [...pool, candidate].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  return next.slice(0, Math.max(1, topN));
}

function emptySolution(origin: Solution['origin']): Solution {
  return { settings: {}, coded: {}, responses: [], composite: 0, compliantAll: false, extrapolated: false, recommended: false, origin };
}

/* ── the search ───────────────────────────────────────────────────────── */

type StopReason = 'complete' | 'budget' | 'time' | 'cancel';

interface SearchState {
  best: Scored | null;
  /** Why the most recent candidate could not be evaluated (empty when it could). */
  refusalIssues: string[];
  pool: Scored[];
  evaluations: number;
  iterations: number;
  rejected: number;
  stoppedBy: StopReason;
  basins: BasinReport[];
  /** Number of combinations the axes describe. */
  combinations: number;
  gridReduced: boolean;
  evaluatedPoints: number;
}

function reachedLimit(state: SearchState, settings: OptimizerSettings, deadline: number): boolean {
  if (state.stoppedBy !== 'complete') return true;
  if (settings.signal?.aborted) {
    state.stoppedBy = 'cancel';
    return true;
  }
  if (state.evaluations >= settings.maxEvaluations) {
    state.stoppedBy = 'budget';
    return true;
  }
  if (Date.now() > deadline) {
    state.stoppedBy = 'time';
    return true;
  }
  return false;
}

function* evaluateAt(
  state: SearchState,
  problem: Problem,
  settings: OptimizerSettings,
  point: ActualPoint,
  origin: Solution['origin'],
  deadline: number,
): Generator<void, Scored, void> {
  if (reachedLimit(state, settings, deadline)) {
    return state.best ?? { usable: false, solution: emptySolution(origin) };
  }
  const refused = candidateIssues(problem.factors, point);
  if (refused.length) {
    state.rejected += 1;
    return { usable: false, solution: emptySolution(origin) };
  }
  state.evaluations += 1;
  const scored = scorePoint(problem.adapters, problem.factors, problem.responses, point, { alpha: settings.alpha, origin });
  if (!scored.usable) {
    // Keep the reason beside the search: "no evaluable point" on its own does
    // not tell a reader that the model refused a non-finite prediction.
    state.refusalIssues = [...new Set(scored.solution.responses.flatMap((entry) => entry.issues))];
  }
  if (scored.usable) {
    if (!state.best || better(scored, state.best)) state.best = scored;
    state.pool = keepPool(state.pool, scored, settings.topN);
  }
  settings.onEvaluated?.(state.evaluations, scored.solution.composite);
  if (state.evaluations % Math.max(1, Math.round(settings.chunkSize)) === 0) yield;
  return scored;
}

/** Values held for every factor not being searched (fixed or out of the axis set). */
function basePoint(factors: CompiledFactor[]): ActualPoint {
  const point: ActualPoint = {};
  factors.forEach((factor) => {
    if (factor.fixed) point[factor.name] = factor.kind === 'categorical' ? String(factor.fixedValue) : Number(factor.fixedValue);
  });
  return point;
}

function pointFrom(base: ActualPoint, values: ActualPoint): ActualPoint {
  return { ...base, ...values };
}

interface AxisPlan {
  axes: { factor: CompiledFactor; values: (number | string)[]; count: number; reduced: boolean }[];
  combinations: number;
  gridReduced: boolean;
}

/** The search axes, thinned only where thinning is legitimate (continuous). */
function planAxes(factors: CompiledFactor[], settings: OptimizerSettings): AxisPlan {
  const free = factors.filter((factor) => !factor.fixed);
  const continuous = free.filter((factor) => factor.kind === 'continuous');
  let points = Math.max(2, Math.round(settings.gridPoints));
  const discreteCombinations = free
    .filter((factor) => factor.kind !== 'continuous')
    .reduce((size, factor) => size * factorAxisSize(factor, points), 1);
  let combinations = free.reduce((size, factor) => size * factorAxisSize(factor, points), 1);
  let reduced = false;
  // Thin the continuous axes until the lattice fits the budget; discrete steps
  // are promises and are never thinned by the planner (they are sampled only
  // when a single axis is longer than the whole budget).
  while (combinations > settings.maxEvaluations && points > 2 && continuous.length) {
    points = Math.max(2, Math.floor(points / 2));
    combinations = free.reduce((size, factor) => size * factorAxisSize(factor, points), 1);
    reduced = true;
  }
  void discreteCombinations;
  const axes = free.map((factor) => {
    const axis = factorAxisValues(factor, points);
    return { factor, values: axis.values, count: axis.count, reduced: axis.truncated || factor.kind === 'continuous' && points < Math.max(2, Math.round(settings.gridPoints)) };
  });
  return { axes, combinations, gridReduced: reduced };
}

function* walkLattice(
  state: SearchState,
  problem: Problem,
  settings: OptimizerSettings,
  plan: AxisPlan,
  origin: Solution['origin'],
  deadline: number,
): Generator<void, void, void> {
  const base = basePoint(problem.factors);
  const walk = function* (index: number, chosen: ActualPoint): Generator<void, void, void> {
    if (state.stoppedBy !== 'complete') return;
    if (index >= plan.axes.length) {
      state.evaluatedPoints += 1;
      yield* evaluateAt(state, problem, settings, pointFrom(base, chosen), origin, deadline);
      return;
    }
    const axis = plan.axes[index];
    for (const value of axis.values) {
      if (state.stoppedBy !== 'complete') return;
      chosen[axis.factor.name] = value;
      yield* walk(index + 1, chosen);
    }
    delete chosen[axis.factor.name];
  };
  yield* walk(0, {});
}

/**
 * The first local-search step per free factor.
 *
 * A continuous factor starts at a quarter of its range (never below the
 * tolerance). A discrete factor starts at a whole number of its declared steps:
 * halving `span × tolerance` on its own would put the probes between lattice
 * points, and a probe the domain then snaps is a probe the search did not make.
 */
export function localSteps(factors: (FactorSettings & { fixed: boolean })[], settings: { tolerance: number }): Record<string, number> {
  const steps: Record<string, number> = {};
  factors.forEach((factor) => {
    if (factor.fixed || factor.kind === 'categorical') return;
    const span = factor.upper - factor.lower;
    if (factor.kind === 'discrete' && factor.step > 0) {
      const target = Math.max(factor.step, span / 4);
      const multiple = Math.max(1, Math.round(target / factor.step));
      steps[factor.name] = multiple * factor.step;
      return;
    }
    steps[factor.name] = Math.max(span / 4, span * settings.tolerance);
  });
  return steps;
}

const stepVector = localSteps;

/** Half of a local step, kept on the discrete lattice (0 when it cannot shrink). */
function halveStep(factor: { kind: string; step: number }, step: number): number {
  if (factor.kind === 'discrete' && factor.step > 0) {
    const multiple = Math.max(1, Math.round(step / factor.step));
    if (multiple <= 1) return 0;
    return Math.max(1, Math.round(multiple / 2)) * factor.step;
  }
  return step / 2;
}

function* refine(
  state: SearchState,
  problem: Problem,
  settings: OptimizerSettings,
  deadline: number,
  start: ActualPoint,
  basin: number,
): Generator<void, void, void> {
  const base = basePoint(problem.factors);
  const free = problem.factors.filter((factor) => !factor.fixed && factor.kind !== 'categorical');
  const started = state.evaluations;
  if (!free.length) {
    const scored = yield* evaluateAt(state, problem, settings, pointFrom(base, start), 'local', deadline);
    state.basins.push({ start: basin, converged: true, iterations: 0, evaluations: state.evaluations - started, composite: scored.solution.composite });
    return;
  }
  const steps = stepVector(problem.factors, settings);
  let current = { ...start };
  let currentScore = yield* evaluateAt(state, problem, settings, pointFrom(base, current), 'local', deadline);
  let improved = true;
  let guard = 0;
  let converged = false;
  let localIterations = 0;
  while (improved && state.stoppedBy === 'complete' && guard < 400) {
    guard += 1;
    localIterations += 1;
    state.iterations += 1;
    improved = false;
    const prev = { ...current };
    for (const factor of free) {
      const step = steps[factor.name];
      if (!(step > 0)) continue;
      for (const direction of [1, -1]) {
        const proposal = { ...current };
        const raw = Number(current[factor.name]) + direction * step;
        const clamped = Math.min(factor.upper, Math.max(factor.lower, raw));
        proposal[factor.name] = factor.kind === 'discrete' && factor.step > 0
          ? nearestStepValue(factor.lower, factor.upper, factor.step, clamped).value
          : clamped;
        if (proposal[factor.name] === current[factor.name]) continue;
        const scored = yield* evaluateAt(state, problem, settings, pointFrom(base, proposal), 'local', deadline);
        if (scored.usable && better(scored, currentScore)) {
          current = proposal;
          currentScore = scored;
          improved = true;
          break;
        }
        if (state.stoppedBy !== 'complete') break;
      }
      if (state.stoppedBy !== 'complete') break;
    }
    // Hooke–Jeeves pattern move: when coordinate probing moved across ≥ 2 axes
    // (e.g. along an interaction ridge), test a diagonal step in the net move direction.
    if (improved && free.length >= 2 && state.stoppedBy === 'complete') {
      let movedAxes = 0;
      const pattern = { ...current };
      for (const factor of free) {
        const delta = Number(current[factor.name]) - Number(prev[factor.name]);
        if (delta === 0) continue;
        movedAxes += 1;
        const raw = Number(current[factor.name]) + delta;
        const clamped = Math.min(factor.upper, Math.max(factor.lower, raw));
        pattern[factor.name] = factor.kind === 'discrete' && factor.step > 0
          ? nearestStepValue(factor.lower, factor.upper, factor.step, clamped).value
          : clamped;
      }
      if (movedAxes >= 2) {
        const scored = yield* evaluateAt(state, problem, settings, pointFrom(base, pattern), 'local', deadline);
        if (scored.usable && better(scored, currentScore)) {
          current = pattern;
          currentScore = scored;
        }
      }
    }
    if (!improved && state.stoppedBy === 'complete') {
      // Shrink every step; the basin has converged when all of them are at the
      // tolerance. That is a statement about this basin, never about the world.
      let anyAbove = false;
      free.forEach((factor) => {
        const span = factor.upper - factor.lower;
        const next = halveStep(factor, steps[factor.name]);
        steps[factor.name] = next;
        // A discrete step that reached one lattice step has nothing finer to
        // search: that is convergence, not a reason to keep halving.
        if (next > 0 && next > span * settings.tolerance) anyAbove = true;
      });
      improved = anyAbove;
      if (!anyAbove) converged = true;
    }
  }
  if (state.stoppedBy !== 'complete') converged = false;
  state.basins.push({
    start: basin,
    converged,
    iterations: localIterations,
    evaluations: state.evaluations - started,
    composite: currentScore.solution.composite,
  });
}

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

function randomStart(factors: CompiledFactor[], random: () => number): ActualPoint {
  const point: ActualPoint = {};
  factors.forEach((factor) => {
    if (factor.fixed) return;
    if (factor.kind === 'categorical') {
      const levels = factor.levels;
      point[factor.name] = levels.length ? levels[Math.floor(random() * levels.length)] : '';
      return;
    }
    if (factor.kind === 'discrete') {
      const axis = factorAxisValues(factor, 2);
      const values = axis.values as number[];
      point[factor.name] = values[Math.min(values.length - 1, Math.floor(random() * values.length))];
      return;
    }
    point[factor.name] = factor.lower + (factor.upper - factor.lower) * random();
  });
  return point;
}

function centreStart(factors: CompiledFactor[]): ActualPoint {
  const point: ActualPoint = {};
  factors.forEach((factor) => {
    if (factor.fixed) return;
    point[factor.name] = holdingValue(factor);
  });
  return point;
}

function* searchCore(
  state: SearchState,
  problem: Problem,
  settings: OptimizerSettings,
  deadline: number,
  method: Exclude<OptimizerSettings['method'], 'auto'>,
): Generator<void, void, void> {
  const plan = planAxes(problem.factors, settings);
  state.combinations = plan.combinations;
  state.gridReduced = plan.gridReduced;
  if (method === 'enumerate' || method === 'grid') {
    yield* walkLattice(state, problem, settings, plan, method === 'enumerate' ? 'enumerated' : 'grid', deadline);
    return;
  }
  if (method === 'bounded') {
    yield* walkLattice(state, problem, settings, plan, 'grid', deadline);
    const start = state.best ? { ...state.best.solution.settings } : centreStart(problem.factors);
    yield* refine(state, problem, settings, deadline, start, 0);
    return;
  }
  // Multi-start: cap the coarse lattice to ≤45% of maxEvaluations so local
  // refinement basins ALWAYS retain budget even with 5+ continuous factors.
  const coarseBudget = Math.max(20, Math.floor(settings.maxEvaluations * 0.45));
  const coarse = planAxes(problem.factors, {
    ...settings,
    gridPoints: Math.max(3, Math.min(settings.gridPoints, 9)),
    maxEvaluations: coarseBudget,
  });
  state.combinations = coarse.combinations;
  state.gridReduced = coarse.gridReduced;
  yield* walkLattice(state, problem, settings, coarse, 'grid', deadline);
  const random = mulberry32(settings.seed);
  const starts = Math.max(3, Math.min(12, 2 + problem.factors.length * 2));
  for (let index = 0; index < starts; index += 1) {
    if (state.stoppedBy !== 'complete') break;
    const start = index === 0 && state.best ? { ...state.best.solution.settings } : randomStart(problem.factors, random);
    yield* refine(state, problem, settings, deadline, start, index + 1);
  }
}

/* ── the public entry points ──────────────────────────────────────────── */

function resolveMethod(problem: Problem, settings: OptimizerSettings): Exclude<OptimizerSettings['method'], 'auto'> {
  if (settings.method !== 'auto') return settings.method;
  const allDiscrete = problem.factors.every((factor) => factor.fixed || factor.kind !== 'continuous');
  const size = problem.factors.reduce((total, factor) => total * factorAxisSize(factor, settings.gridPoints), 1);
  if (allDiscrete) return 'enumerate';
  if (size <= Math.min(settings.maxEvaluations / 2, 400)) return 'enumerate';
  return 'multistart';
}

function finish(
  problem: Problem,
  settings: OptimizerSettings,
  state: SearchState,
  method: Exclude<OptimizerSettings['method'], 'auto'>,
  started: number,
): OptimizerResult {
  // A solution outside its own factor domain is not a solution (F-REL-04):
  // every candidate passed `candidateIssues` when it was scored, and the pool
  // is checked once more before it is handed back.
  const eligible = (state.pool.length ? state.pool : state.best ? [state.best] : [])
    .filter((entry) => entry.usable && candidateIssues(problem.factors, entry.solution.settings).length === 0);
  const solutions = eligible;
  const best = solutions[0] ?? null;
  const allDiscrete = problem.factors.every((factor) => factor.fixed || factor.kind !== 'continuous');
  // A search that used its whole evaluation budget before finishing did not
  // complete; an exhaustive discrete search that finishes on the exact last
  // evaluation still completed every combination.
  const finishedExhaustive = allDiscrete && !state.gridReduced && state.evaluatedPoints >= state.combinations;
  if (state.stoppedBy === 'complete' && state.evaluations >= settings.maxEvaluations && !finishedExhaustive) {
    state.stoppedBy = 'budget';
  }
  const exhaustive = allDiscrete
    && state.stoppedBy === 'complete'
    && !state.gridReduced
    && state.evaluatedPoints >= state.combinations
    && state.rejected === 0;
  const axes: SearchAxis[] = problem.factors.map((factor) => {
    const size = factorAxisSize(factor, settings.gridPoints);
    return {
      name: factor.name,
      kind: factor.kind,
      count: size,
      reduced: factor.kind === 'continuous' ? state.gridReduced : Boolean(factorAxisValues(factor, settings.gridPoints).truncated),
      source: factor.domainSource,
    };
  });
  const report: SearchReport = {
    space: allDiscrete ? 'discrete' : problem.factors.some((factor) => factor.kind === 'continuous') && problem.factors.some((factor) => factor.kind !== 'continuous') ? 'mixed' : 'continuous',
    axes,
    combinations: state.combinations,
    exhaustive,
    evaluated: state.evaluations,
    rejected: state.rejected,
    stoppedBy: state.stoppedBy,
    gridReduced: state.gridReduced,
    basins: state.basins,
  };
  const warnings = [...problem.warnings];
  const issues: string[] = best && best.usable ? [] : [...state.refusalIssues];
  let status: OptimizerStatus;
  if (!best || !best.usable) {
    status = 'invalid';
    warnings.push('opt.warn.noEvaluablePoint');
  } else if (!best.solution.compliantAll) {
    if (state.stoppedBy !== 'complete') status = 'limit';
    else status = exhaustive ? 'infeasible' : 'feasible-not-found';
    warnings.push(exhaustive ? 'opt.warn.noCompliantPoint' : 'opt.warn.noCompliantFound');
  } else if (state.stoppedBy !== 'complete') {
    status = 'limit';
  } else if (exhaustive) {
    status = 'global-optimal';
  } else if ((method === 'bounded' || method === 'multistart') && state.basins.length > 0 && state.basins.every((basin) => basin.converged)) {
    status = 'local-converged';
  } else {
    status = 'best-found';
  }
  if (state.gridReduced) warnings.push('opt.warn.gridReduced');
  if (state.stoppedBy === 'budget') warnings.push('opt.warn.budgetReached');
  if (state.stoppedBy === 'time') warnings.push('opt.warn.timeReached');
  if (state.stoppedBy === 'cancel') warnings.push('opt.warn.cancelled');
  if (state.rejected > 0) warnings.push('opt.warn.candidatesRejected');
  return {
    status,
    method: settings.method,
    resolvedMethod: method,
    seed: settings.seed,
    solutions: solutions.map((entry) => entry.solution),
    evaluations: state.evaluations,
    iterations: state.iterations,
    elapsedMs: Date.now() - started,
    recommended: Boolean(best && best.usable && best.solution.compliantAll && status !== 'invalid'),
    search: report,
    warnings: [...new Set(warnings)],
    issues,
    responseIssues: problem.responseIssues,
  };
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
  const problem = buildProblem(models, responses, factors, {
    allowExtrapolation: settings.allowExtrapolation,
    requireAllFactors: true,
    checkCompatibility: true,
  });
  if (problem.issues.length) {
    return invalidResult(problem, settings, started);
  }
  const method = resolveMethod(problem, settings);
  const state: SearchState = {
    best: null,
    refusalIssues: [],
    pool: [],
    evaluations: 0,
    iterations: 0,
    rejected: 0,
    stoppedBy: 'complete',
    basins: [],
    combinations: 0,
    gridReduced: false,
    evaluatedPoints: 0,
  };
  const driver = searchCore(state, problem, settings, deadline, method);
  for (const _ of driver) { /* synchronous drain: nothing to do between chunks */ }
  return finish(problem, settings, state, method, started);
}

/**
 * The same search, yielding to the host between chunks.
 *
 * The window uses this so a 60 000-evaluation search cannot freeze the page:
 * every `chunkSize` evaluations control returns to the event loop, the buttons
 * keep painting, and an AbortSignal is honoured at the next chunk boundary.
 */
export async function optimizeAsync(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
  options: Partial<OptimizerSettings> = {},
): Promise<OptimizerResult> {
  const settings: OptimizerSettings = { ...DEFAULT_OPTIMIZER_SETTINGS, ...options };
  const started = Date.now();
  const deadline = started + Math.max(50, settings.timeLimitMs);
  const problem = buildProblem(models, responses, factors, {
    allowExtrapolation: settings.allowExtrapolation,
    requireAllFactors: true,
    checkCompatibility: true,
  });
  if (problem.issues.length) return invalidResult(problem, settings, started);
  const method = resolveMethod(problem, settings);
  const state: SearchState = {
    best: null,
    refusalIssues: [],
    pool: [],
    evaluations: 0,
    iterations: 0,
    rejected: 0,
    stoppedBy: 'complete',
    basins: [],
    combinations: 0,
    gridReduced: false,
    evaluatedPoints: 0,
  };
  const driver = searchCore(state, problem, settings, deadline, method);
  for (const _ of driver) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  }
  return finish(problem, settings, state, method, started);
}

function invalidResult(problem: Problem, settings: OptimizerSettings, started: number): OptimizerResult {
  return {
    status: 'invalid',
    method: settings.method,
    resolvedMethod: resolveMethod(problem, settings),
    seed: settings.seed,
    solutions: [],
    evaluations: 0,
    iterations: 0,
    elapsedMs: Date.now() - started,
    recommended: false,
    search: {
      space: 'continuous',
      axes: [],
      combinations: 0,
      exhaustive: false,
      evaluated: 0,
      rejected: 0,
      stoppedBy: 'complete',
      gridReduced: false,
      basins: [],
    },
    warnings: problem.warnings,
    issues: problem.issues,
    responseIssues: problem.responseIssues,
  };
}

/* ── conditions outside a search ──────────────────────────────────────── */

/**
 * Evaluate one condition (the profiler's live point) with the same scoring.
 *
 * The profiler passes `requireAllFactors: false` and `allowExtrapolation:
 * true`: it displays any condition the reader can type, flags the extrapolated
 * ones, and blocks a response whose model needs a factor that is not on screen.
 */
export function evaluateCondition(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
  point: ActualPoint,
  options: { alpha?: number; requireAllFactors?: boolean; allowExtrapolation?: boolean } = {},
): Solution | null {
  const problem = buildProblem(models, responses, factors, {
    allowExtrapolation: options.allowExtrapolation ?? true,
    requireAllFactors: options.requireAllFactors ?? false,
    checkCompatibility: false,
  });
  if (!problem.adapters.length) return null;
  const compiled = problem.factors;
  const resolved = resolvePoint(compiled, point);
  return scorePoint(problem.adapters, compiled, problem.responses, resolved.point, { alpha: options.alpha ?? 0.05, origin: 'start' }).solution;
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

/** A response's limits as the UI shows them, including a reversed pair. */
export function limitsReversedPair(settings: ResponseSettings): boolean {
  return limitsReversed(settings);
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
  const problem = buildProblem(models, responses, factors, { allowExtrapolation: true, requireAllFactors: false, checkCompatibility: false });
  const axes: Record<string, (number | string)[]> = {};
  problem.factors.forEach((factor) => {
    if (factor.fixed) return;
    axes[factor.name] = factorAxisValues(factor, Math.min(5, Math.max(2, Math.round(Math.cbrt(40)) + 2))).values;
  });
  const names = Object.keys(axes);
  const base = basePoint(problem.factors);
  const samples: Record<string, number[]> = {};
  // A suggested specification is a starting point, not an analysis: the
  // sampling is capped so opening the window never runs an unbounded search.
  let sampled = 0;
  const SAMPLE_CAP = 600;
  const walk = (index: number, chosen: ActualPoint) => {
    if (sampled >= SAMPLE_CAP) return;
    if (index >= names.length) {
      sampled += 1;
      const point = pointFrom(base, chosen);
      const resolved = resolvePoint(problem.factors, point).point;
      problem.adapters.forEach((adapter) => {
        const value = adapter.evaluate(resolved, 0.05).value;
        if (value === null || !Number.isFinite(value)) return;
        (samples[adapter.model.id] ??= []).push(value);
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

/** The axis a factor may be evaluated at (kept for callers that draw an axis). */
export function factorAxis(factor: CompiledFactor | FactorSettings, gridPoints: number): (number | string)[] {
  return factorAxisValues(factor, gridPoints).values;
}
