/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — multi-response optimisation: the vocabulary (WO-05 / WO-06)

   A response optimiser is a small contract between three things: what the
   reader wants from each response (its goal and limits), what each factor is
   allowed to do (its range, step, level list), and how hard the engine may
   look for an answer. These types are that contract; `desirability.ts` scores a
   point under it and `optimizer.ts` searches for the best one.

   Nothing here is derived from a particular model: a response is identified by
   the id of a stored model, and a factor by the predictor name that model uses,
   which is how several models with shared factors become one problem.
   ───────────────────────────────────────────────────────────────────────── */

/** What the reader wants a response to do. */
export type ResponseGoal = 'maximize' | 'minimize' | 'target' | 'range' | 'ignore';

export const RESPONSE_GOALS: ResponseGoal[] = ['maximize', 'minimize', 'target', 'range', 'ignore'];

/**
 * One response's goal and limits.
 *
 * `lower` / `upper` bound the acceptable region and give the desirability scale
 * its end points; `target` is the best point of a `target` goal (and is
 * optional otherwise). `weight` shapes a single desirability curve (the
 * Derringer–Suich exponent); `importance` weights this response inside the
 * composite. They are deliberately separate numbers: a response can matter a
 * lot overall while its own curve is almost linear.
 */
export interface ResponseSettings {
  /** Stored model id this response is predicted from. */
  modelId: string;
  /** Response name, copied for display and for the output card. */
  name: string;
  goal: ResponseGoal;
  lower: number | null;
  upper: number | null;
  target: number | null;
  /** Derringer–Suich shape exponent, 0.1 … 10 (1 = linear). */
  weight: number;
  /** Relative importance inside the composite, 0.1 … 10 (1 = neutral). */
  importance: number;
}

/** How a factor may move. */
export type FactorKind = 'continuous' | 'discrete' | 'categorical';

export const FACTOR_KINDS: FactorKind[] = ['continuous', 'discrete', 'categorical'];

/**
 * One factor's search space, in the model's own input units.
 *
 * A `fixed` factor is not searched: it is held at `fixedValue` and reported in
 * every solution. A categorical factor is enumerated over its fitted levels; a
 * discrete one steps from `lower` by `step`; a continuous one is gridded and
 * then refined locally.
 */
export interface FactorSettings {
  name: string;
  kind: FactorKind;
  lower: number;
  upper: number;
  /** Grid / enumeration step in input units (ignored while `kind` is categorical). */
  step: number;
  fixed: boolean;
  /** Value a fixed factor is held at (a level string for a categorical one). */
  fixedValue: number | string;
  /** Fitted levels of a categorical factor; the search never invents a new one. */
  levels: string[];
}

/** How the engine is allowed to look. */
export type OptimizerMethod = 'auto' | 'grid' | 'multistart' | 'bounded' | 'enumerate';

export const OPTIMIZER_METHODS: OptimizerMethod[] = ['auto', 'grid', 'multistart', 'bounded', 'enumerate'];

export interface OptimizerSettings {
  method: OptimizerMethod;
  /** Seeds the sampled start points: the same seed reproduces the same answer. */
  seed: number;
  /** Grid points per continuous factor (per axis, before the budget is applied). */
  gridPoints: number;
  /** Hard cap on model evaluations; the search stops and reports its best. */
  maxEvaluations: number;
  /** Wall-clock cap in milliseconds. */
  timeLimitMs: number;
  /** How many alternative conditions to report (best first). */
  topN: number;
  /** 1 − confidence for the reported intervals. */
  alpha: number;
  /** Local-search stop: the step size, as a fraction of the factor range. */
  tolerance: number;
}

export const DEFAULT_OPTIMIZER_SETTINGS: OptimizerSettings = {
  method: 'auto',
  seed: 20261124,
  gridPoints: 21,
  maxEvaluations: 60000,
  timeLimitMs: 4000,
  topN: 5,
  alpha: 0.05,
  tolerance: 1e-4,
};

/** A search that found nothing usable says why. */
export type OptimizerStatus =
  | 'optimal'        // a compliant point was found and the search converged
  | 'best-found'     // a compliant point was found but optimality is not claimed
  | 'no-feasible'    // no point satisfied every goal
  | 'invalid'        // the problem itself is not well posed
  | 'limit';         // the evaluation / time budget ran out (best so far reported)

/** One response's prediction at one candidate condition. */
export interface ResponsePrediction {
  modelId: string;
  name: string;
  goal: ResponseGoal;
  /** Predicted mean, or null when the row leans on an unidentified column. */
  value: number | null;
  se: number | null;
  /** Confidence interval for the mean. */
  ci: [number, number] | null;
  /** Prediction interval for one future observation. */
  pi: [number, number] | null;
  /** Individual (Derringer–Suich) desirability, 0 … 1. */
  desirability: number;
  /** Inside the stated limits. */
  compliant: boolean;
  nonEstimable: string[];
  issues: string[];
}

/** One candidate set of factor values and what it predicts. */
export interface Solution {
  /** Factor name → value, in the model's input units (a level for categorical). */
  settings: Record<string, number | string>;
  /** Factor name → the value the coefficient space sees (coded / contrast). */
  coded: Record<string, number>;
  responses: ResponsePrediction[];
  /** Composite desirability (weighted geometric mean), 0 … 1. */
  composite: number;
  /** Every response satisfies its limits. */
  compliantAll: boolean;
  /** At least one factor sits outside the region the models were fitted on. */
  extrapolated: boolean;
  /** How the search reached this point. */
  origin: 'grid' | 'local' | 'enumerated' | 'start';
}

export interface OptimizerResult {
  status: OptimizerStatus;
  method: OptimizerMethod;
  /** The method actually run when `auto` was asked for. */
  resolvedMethod: Exclude<OptimizerMethod, 'auto'>;
  seed: number;
  solutions: Solution[];
  evaluations: number;
  iterations: number;
  elapsedMs: number;
  /** Problems that stopped or narrowed the search (i18n keys). */
  warnings: string[];
  /** Why the problem is not well posed, when `status` is `invalid`. */
  issues: string[];
}

/** A point handed to the profiler: the current condition. */
export interface ProfilerPoint {
  settings: Record<string, number | string>;
  responses: ResponsePrediction[];
  composite: number;
  compliantAll: boolean;
  extrapolated: boolean;
}
