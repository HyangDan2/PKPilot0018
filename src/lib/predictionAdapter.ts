/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — the prediction adapter (Stage 3C, F-3C-03)

   Every prediction the optimiser and the profiler make passes through this
   module. It is the single engine on the Stage-3C side:

   · It reads and writes ACTUAL factor coordinates. Coded values are derived
     here (through the shared `designFromActual` transform) purely for display, so
     two models with different codings are each evaluated in their own space at
     the same actual condition.
   · It parses a coefficient label once (per model) and then multiplies the
     term out per point — the same arithmetic as `predictStoredModel`, which is
     the Model Manager / contour / surface path. `crossCheck` compares the two
     point for point so the two paths cannot drift apart silently, and QA-W-19
     / QA-W-20 assert the same equality from outside the app.
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
  intervalStatus,
  parseCoefficientLabel,
  predictStoredModel,
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
  /** Interval problems that are real defects rather than an absent quantity. */
  const intervalIssues = intervals.ci
    ? []
    : intervals.reasons.filter((reason) => !['model.covariance.missing', 'model.df.missing', 'model.mse.missing'].includes(reason));

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
    const nonEstimable: string[] = [];
    let fit = 0;
    for (let index = 0; index < terms.length; index += 1) {
      const weight = weights[index];
      if (!Number.isFinite(weight) || weight === 0) continue;
      const term = terms[index];
      if (!term.estimable) {
        if (!nonEstimable.includes(term.label)) nonEstimable.push(term.label);
        continue;
      }
      fit += weight * term.value;
    }
    if (nonEstimable.length) {
      return { value: null, se: null, ci: null, pi: null, nonEstimable, issues: [] };
    }
    if (!Number.isFinite(fit)) {
      return { value: null, se: null, ci: null, pi: null, nonEstimable: [], issues: ['model.value.nonFinite'] };
    }
    let se: number | null = null;
    let ci: [number, number] | null = null;
    let pi: [number, number] | null = null;
    if (supportsCi && matrix && df) {
      let variance = 0;
      for (let i = 0; i < weights.length; i += 1) {
        const wi = weights[i];
        if (!Number.isFinite(wi) || wi === 0) continue;
        const row = matrix[i];
        if (!row) continue;
        for (let j = 0; j < weights.length; j += 1) {
          const entry = row[j];
          if (!Number.isFinite(entry)) continue;
          variance += wi * weights[j] * entry;
        }
      }
      if (variance >= 0 && Number.isFinite(variance)) {
        se = Math.sqrt(variance);
        const half = tInv(1 - Math.min(0.999, Math.max(1e-6, alpha)) / 2, df);
        const ciHalf = half * se;
        if (Number.isFinite(ciHalf)) ci = [fit - ciHalf, fit + ciHalf];
        if (supportsPi) {
          const piHalf = half * Math.sqrt(variance + Math.max(0, mse as number));
          if (Number.isFinite(piHalf)) pi = [fit - piHalf, fit + piHalf];
        }
      } else {
        return { value: fit, se: null, ci: null, pi: null, nonEstimable: [], issues: ['model.covariance.negativeVariance'] };
      }
    }
    return { value: fit, se, ci, pi, nonEstimable, issues: intervalIssues };
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
 * This is the guard that keeps the two paths one engine: any term, coding,
 * contrast or interval difference shows up as a non-zero delta. A test asserts
 * zero (1e-12 relative) over random points; the QA harness does the same from
 * Python's side of the fence.
 */
export interface CrossCheck {
  value: number | null;
  se: number | null;
  ciHalf: number | null;
  pi: [number, number] | null;
  delta: { value: number; se: number; pi: number };
  issues: string[];
}

export function crossCheck(model: StoredModel, point: ActualPoint, alpha = 0.05): CrossCheck {
  const adapter = createPredictionAdapter(model);
  const mine = adapter.evaluate(point, alpha);
  const shared: PredictionResult = predictStoredModel(model, point, { mode: 'actual', alpha });
  const delta = {
    value: mine.value === null || shared.value === null ? (mine.value === shared.value ? 0 : Number.POSITIVE_INFINITY) : Math.abs(mine.value - shared.value),
    se: mine.se === null || shared.se === null ? (mine.se === shared.se ? 0 : Number.POSITIVE_INFINITY) : Math.abs(mine.se - shared.se),
    pi: mine.pi === null || shared.pi === null
      ? (mine.pi === shared.pi ? 0 : Number.POSITIVE_INFINITY)
      : Math.max(Math.abs(mine.pi[0] - shared.pi[0]), Math.abs(mine.pi[1] - shared.pi[1])),
  };
  const ciHalf = mine.ci && mine.value !== null ? Math.abs((mine.ci[1] - mine.ci[0]) / 2) : null;
  return { value: mine.value, se: mine.se, ciHalf, pi: mine.pi, delta, issues: mine.issues };
}
