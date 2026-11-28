/* ─────────────────────────────────────────────────────────────────────────
   Statelia — the prediction adapter (Stage 3C, F-3C-03)

   Every prediction the optimiser and the profiler make passes through this
   module. It is the single engine on the Stage-3C side:

   · It reads and writes ACTUAL factor coordinates. Coded values are derived
     here (through the shared `designFromActual` transform) purely for display, so
     two models with different codings are each evaluated in their own space at
     the same actual condition.
   · It parses a coefficient label once (per model) and then multiplies the
     term out per point, and hands the weights to `sumDesignRow` — the same
     arithmetic `predictStoredModel` (Model Manager / contour / surface), the
     compiled surface evaluator and the optimiser use. A non-finite weight is an
     error here exactly as it is there; nothing is skipped to make a number.
     `crossCheck` compares the two paths point for point — value, interval and
     issue list — so they cannot drift apart silently, and QA-W-19 / QA-W-20
     assert the same equality from outside the app.
   · It separates what the model can answer by asking `intervalStatus` — the
     same rule the Model Manager and the overlay use: a confidence interval
     needs a usable covariance and residual df; a prediction interval
     additionally needs the residual variance (mse). A missing mse removes the
     PI and leaves the CI, and a covariance that fails the shared check never
     becomes a standard error.
   · It never invents a value. A missing input, an unknown level, an aliased
     coefficient or a non-finite variance returns null plus the reason.
   ───────────────────────────────────────────────────────────────────────── */

import { tInv } from './dist';
import {
  covarianceStatus,
  designFromActual,
  INTERVAL_NON_FINITE,
  intervalStatus,
  intervalIssues as intervalIssueList,
  parseCoefficientLabel,
  predictStoredModel,
  quadraticForm,
  sumDesignRow,
  type ParsedToken,
  type PredictionResult,
} from './modelPredictor';
import type { ModelVariable, StoredModel } from './modelStore';

/** A condition in the models' own (actual) units: factor name → value. */
export type ActualPoint = Record<string, number | string>;

export interface AdapterEvaluation {
  /** ŷ, or null when the condition cannot be evaluated. */
  value: number | null;
  /** Standard error of the fitted mean. */
  se: number | null;
  /** Confidence interval for the mean (needs covariance + residual df). */
  ci: [number, number] | null;
  /** Prediction interval for one future observation (also needs mse). */
  pi: [number, number] | null;
  /** Coefficients the row leans on that are not identified. */
  nonEstimable: string[];
  /** Input/structural problems that stopped the evaluation. */
  issues: string[];
}

export interface PredictionAdapter {
  model: StoredModel;
  responseName: string;
  /** Predictor names this model needs, in model order. */
  predictors: string[];
  /** Covariance and residual df are present. */
  supportsCi: boolean;
  /** The residual variance is present, so a PI can be stated. */
  supportsPi: boolean;
  /** Evaluate at actual coordinates. */
  evaluate(point: ActualPoint, alpha?: number): AdapterEvaluation;
  /** Input problems for a point, without evaluating (empty when usable). */
  validate(point: ActualPoint): string[];
  /** The actual-unit range the model was fitted on, when it is known. */
  fittedRange(name: string): [number, number] | null;
  /** The model's own definition of a predictor. */
  variable(name: string): ModelVariable | undefined;
  /** The coefficient-space (coded) value of an actual one, for display. */
  designValue(name: string, actual: number): number;
  /** Sum-to-zero contrast value for a categorical level (1 / −1 / 0). */
  contrast(name: string, level: string, value: string): number;
  /** The fitted levels of a categorical predictor. */
  levels(name: string): string[];
}

interface Term {
  label: string;
  value: number;
  estimable: boolean;
  tokens: ParsedToken[];
}

const adapterCache = new WeakMap<StoredModel, PredictionAdapter>();

function buildAdapter(model: StoredModel): PredictionAdapter {
  const terms: Term[] = model.coefficients.map((coefficient) => ({
    label: coefficient.label,
    value: coefficient.value,
    estimable: coefficient.estimable !== false && Number.isFinite(coefficient.value),
    tokens: parseCoefficientLabel(coefficient.label),
  }));
  const byName = new Map(model.predictors.map((predictor) => [predictor.name, predictor]));
  // What a model can answer is decided by the shared rules in modelPredictor
  // (covariance validity, rank, df, mse), not by a second opinion here.
  const intervals = intervalStatus(model);
  const covariance = covarianceStatus(model);
  const matrix = covariance.ok ? covariance.matrix : null;
  const df = model.residual?.df && model.residual.df > 0 ? model.residual.df : null;
  const mse = model.residual?.mse;
  const supportsCi = intervals.ci && Boolean(matrix && df);
  const supportsPi = supportsCi && intervals.pi;
  /**
   * Interval remarks, from the shared basis rules — a missing covariance or df
   * is the absence of a quantity (not repeated), a missing mse, a rank-deficient
   * fit or an unusable covariance is stated, exactly as the Model Manager does.
   */
  const intervalIssues = intervalIssueList(model);

  const variable = (name: string): ModelVariable | undefined => byName.get(name);

  const contrast = (name: string, level: string, value: string): number => {
    const predictor = byName.get(name);
    const levels = predictor?.levels ?? [];
    if (!levels.length) throw new Error('model.levelMissing');
    if (!levels.includes(value)) throw new Error('model.levelUnknown');
    if (value === level) return 1;
    if (value === levels[levels.length - 1]) return -1;
    return 0;
  };

  const designBase = (name: string, raw: unknown): number => {
    const predictor = byName.get(name);
    if (!predictor) throw new Error('model.structure');
    const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(numeric)) throw new Error('model.valueMissing');
    return designFromActual(predictor, numeric);
  };

  const validate = (point: ActualPoint): string[] => {
    const issues: string[] = [];
    for (const predictor of model.predictors) {
      const raw = point[predictor.name];
      if (raw === undefined || raw === null || raw === '') {
        if (!issues.includes('model.valueMissing')) issues.push('model.valueMissing');
        continue;
      }
      if (predictor.kind === 'categorical') {
        if (!(predictor.levels ?? []).includes(String(raw)) && !issues.includes('model.levelUnknown')) issues.push('model.levelUnknown');
        continue;
      }
      const numeric = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(numeric) && !issues.includes('model.valueMissing')) issues.push('model.valueMissing');
    }
    return issues;
  };

  const evaluate = (point: ActualPoint, alpha = 0.05): AdapterEvaluation => {
    const issues = validate(point);
    if (issues.length) {
      return { value: null, se: null, ci: null, pi: null, nonEstimable: [], issues };
    }
    const weights: number[] = [];
    try {
      for (const term of terms) {
        let product = 1;
        for (const token of term.tokens) {
          const predictor = byName.get(token.name);
          if (!predictor) throw new Error('model.structure');
          const raw = point[token.name];
          if (predictor.kind === 'categorical') {
            if (!token.level) throw new Error('model.structure');
            product *= contrast(token.name, token.level, String(raw ?? ''));
            continue;
          }
          const base = designBase(token.name, raw);
          product *= token.power === 1 ? base : base ** token.power;
        }
        weights.push(product);
      }
    } catch (error) {
      return { value: null, se: null, ci: null, pi: null, nonEstimable: [], issues: [error instanceof Error ? error.message : 'model.predictFailed'] };
    }
    const summed = sumDesignRow(model, weights);
    if (summed.value === null) {
      return {
        value: null,
        se: null,
        ci: null,
        pi: null,
        nonEstimable: summed.nonEstimable,
        // The refusal states the sum's own reason, exactly as the Model Manager
        // does; interval remarks belong to a point that has a mean to band.
        issues: summed.issues,
      };
    }
    const fit = summed.value;
    let se: number | null = null;
    let ci: [number, number] | null = null;
    let pi: [number, number] | null = null;
    if (supportsCi && matrix && df) {
      // The same positive-definiteness distinction as the Model Manager: an
      // overflowing product is non-finite, not a negative variance.
      const form = quadraticForm(matrix, weights);
      if (!form.ok) {
        // ŷ is a number; only the band around it failed. Returning null here
        // made the optimiser and the profiler throw away a usable mean that the
        // Model Manager was still showing.
        return { value: fit, se: null, ci: null, pi: null, nonEstimable: [], issues: [...intervalIssues, form.reason] };
      }
      se = Math.sqrt(form.value);
      const half = tInv(1 - Math.min(0.999, Math.max(1e-6, alpha)) / 2, df);
      const ciHalf = half * se;
      const remarks = [...intervalIssues];
      if (Number.isFinite(ciHalf)) ci = [fit - ciHalf, fit + ciHalf];
      else remarks.push(INTERVAL_NON_FINITE);
      if (supportsPi) {
        const piHalf = half * Math.sqrt(form.value + Math.max(0, mse as number));
        if (Number.isFinite(piHalf)) pi = [fit - piHalf, fit + piHalf];
        else remarks.push(INTERVAL_NON_FINITE);
      }
      return { value: fit, se, ci, pi, nonEstimable: [], issues: [...new Set(remarks)] };
    }
    return { value: fit, se, ci, pi, nonEstimable: [], issues: intervalIssues };
  };

  return {
    model,
    responseName: model.response.name,
    predictors: model.predictors.map((predictor) => predictor.name),
    supportsCi,
    supportsPi,
    evaluate,
    validate,
    fittedRange(name: string) {
      const bound = model.factorBounds?.[name];
      if (!bound || !Number.isFinite(bound.min) || !Number.isFinite(bound.max)) return null;
      return [bound.min, bound.max];
    },
    variable,
    designValue(name: string, actual: number): number {
      const predictor = byName.get(name);
      if (!predictor) return Number.NaN;
      try {
        return designFromActual(predictor, actual);
      } catch {
        return Number.NaN;
      }
    },
    contrast,
    levels(name: string) {
      return [...(byName.get(name)?.levels ?? [])];
    },
  };
}

/** The adapter for a model (compiled once per model object). */
export function createPredictionAdapter(model: StoredModel): PredictionAdapter {
  const cached = adapterCache.get(model);
  if (cached) return cached;
  const adapter = buildAdapter(model);
  adapterCache.set(model, adapter);
  return adapter;
}

/**
 * Compare the adapter with the Model Manager path at one point.
 *
 * This is the guard that keeps the two paths one engine. Its scope is what the
 * two paths can disagree about, so a match here is a claim about all of it:
 *
 * · `value`, `se`, `ci` (half-width) and `pi` — the numbers themselves;
 * · `issues` — how many issue codes one list has that the other does not, so a
 *   path that refuses a point for a different reason is caught even when both
 *   values are null;
 * · `consistent` — the single answer, with a 1e-12 relative tolerance, and
 *   `parallel` — the prediction interval both sides state, or null when either
 *   is silent (a silent PI beside a stated one is a difference, not a match).
 */
export interface CrossCheck {
  value: number | null;
  se: number | null;
  ciHalf: number | null;
  pi: [number, number] | null;
  /** Coefficients this path says are not identifiable (the adapter's list). */
  nonEstimable: string[];
  delta: { value: number; se: number; ci: number; pi: number; issues: number; nonEstimable: number };
  parallel: [number, number] | null;
  consistent: boolean;
  issues: string[];
}

/** Absolute difference of two optional numbers; both absent counts as zero. */
function numberDelta(a: number | null, b: number | null): number {
  if (a === null || b === null) return a === b ? 0 : Number.POSITIVE_INFINITY;
  const difference = Math.abs(a - b);
  return Number.isFinite(difference) ? difference : Number.POSITIVE_INFINITY;
}

function intervalDelta(a: [number, number] | null, b: [number, number] | null): number {
  if (a === null || b === null) return a === b ? 0 : Number.POSITIVE_INFINITY;
  return Math.max(numberDelta(a[0], b[0]), numberDelta(a[1], b[1]));
}

/** How many issue codes one list has that the other does not. */
function issueDelta(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let count = 0;
  left.forEach((code) => { if (!right.has(code)) count += 1; });
  right.forEach((code) => { if (!left.has(code)) count += 1; });
  return count;
}

/** How many coefficients one side calls non-estimable that the other does not. */
function labelDelta(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  let count = 0;
  left.forEach((label) => { if (!right.has(label)) count += 1; });
  right.forEach((label) => { if (!left.has(label)) count += 1; });
  return count;
}

export function crossCheck(model: StoredModel, point: ActualPoint, alpha = 0.05): CrossCheck {
  const adapter = createPredictionAdapter(model);
  const mine = adapter.evaluate(point, alpha);
  const shared: PredictionResult = predictStoredModel(model, point, { mode: 'actual', alpha });
  const scale = Math.max(1, Math.abs(mine.value ?? 0), Math.abs(shared.value ?? 0));
  const tolerance = 1e-12 * scale;
  const ciHalf = mine.ci && mine.value !== null ? Math.abs((mine.ci[1] - mine.ci[0]) / 2) : null;
  const delta = {
    value: numberDelta(mine.value, shared.value),
    se: numberDelta(mine.se, shared.se),
    // Both bounds, not a placeholder: a CI that differs in either end is a
    // difference between the two paths, whatever the value and the error say.
    ci: intervalDelta(mine.ci, shared.ci),
    pi: intervalDelta(mine.pi, shared.pi),
    issues: issueDelta(mine.issues, shared.issues),
    nonEstimable: labelDelta(mine.nonEstimable, shared.nonEstimable),
  };
  const consistent = delta.value <= tolerance
    && delta.se <= tolerance
    && delta.ci <= tolerance
    && delta.pi <= tolerance
    && delta.issues === 0
    && delta.nonEstimable === 0
    && (mine.value === null) === (shared.value === null)
    && (mine.ci === null) === (shared.ci === null)
    && (mine.pi === null) === (shared.pi === null);
  return {
    value: mine.value,
    se: mine.se,
    ciHalf,
    pi: mine.pi,
    nonEstimable: mine.nonEstimable,
    delta,
    parallel: mine.pi !== null && shared.pi !== null ? shared.pi : null,
    consistent,
    issues: mine.issues,
  };
}
