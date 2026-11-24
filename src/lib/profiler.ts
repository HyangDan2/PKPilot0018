/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — the prediction profiler's curves (WO-06), Stage 3C corrected

   A profiler answers "what happens to every response if I move this one
   factor?" — one small conditional curve per (response, factor) pair. The
   curves are computed from the same prediction adapter the optimiser uses, so
   the profiler and the optimiser can never disagree about a prediction.

   Four properties matter and are the reason this lives in a module instead of
   inside the component:

   · Domain. A discrete factor is evaluated only at Lower + k × Step and a
     categorical one only at its fitted levels, so a curve is a curve over the
     conditions the model may be asked about — not over a continuous sweep that
     includes values nobody can set.
   · Holding. When one factor moves, every other factor stays exactly where the
     reader left it. A curve is therefore the model sliced along one axis at the
     current condition, not a marginal or an average.
   · One input policy. The current condition, the curve axes, the opening value
     and Reset all pass through `resolvePoint` / `normaliseFactorValue`, so the
     vertical line and the curve it crosses cannot sit at different values.
     A value that cannot be used (NaN, an unknown level) blocks the prediction
     instead of being quietly replaced by a valid one.
   · Honest blocks. A response whose model needs a factor that is not on the
     screen cannot be drawn: the row says so and shows nothing, rather than
     holding that factor at a centre the reader never chose.
   ───────────────────────────────────────────────────────────────────────── */

import type { StoredModel } from './modelStore';
import type { FactorSettings, ResponsePrediction, ResponseSettings, Solution } from './optimizationTypes';
import { createPredictionAdapter, type PredictionAdapter } from './predictionAdapter';
import { evaluateCondition, resolvePoint, scorePoint } from './optimizer';
import {
  discreteAxis,
  holdingValue,
  normaliseFactorValue,
  rangeSlack,
  validateFactorValue,
} from './factorDomain';

export interface ProfileCurve {
  /** Axis positions in the factor's input units. */
  xs: number[];
  /** Predicted mean at each position. */
  mean: number[];
  /** Confidence band for the mean, when the model carries covariance and df. */
  ci: { lo: number[]; hi: number[] } | null;
  /** Prediction band for one future observation (also needs a residual mse). */
  pi: { lo: number[]; hi: number[] } | null;
  /** The current value of this factor, for the vertical line. */
  current: number | null;
  /** Y limits to draw (finite only). */
  yMin: number;
  yMax: number;
  /** Why curve points could not be evaluated (i18n keys, unique). */
  issues: string[];
}

export interface ProfileRow {
  modelId: string;
  responseName: string;
  /** One entry per factor, in the order the caller passed them. */
  curves: ProfileCurve[];
  prediction: ResponsePrediction | null;
  /** The row cannot be evaluated (a needed factor is missing or unusable). */
  blocked: boolean;
  /** Why it is blocked, or what was clamped (i18n keys). */
  issues: string[];
  /** Which bands this model can actually answer. */
  interval: { ci: boolean; pi: boolean };
  /** The current condition is outside the region this model was fitted on. */
  extrapolated: boolean;
}

/** The compiled adapter for a model (one per model object). */
export function evaluatorFor(model: StoredModel): PredictionAdapter {
  return createPredictionAdapter(model);
}

/**
 * A factor's axis points: discrete values on the step, categorical levels, and
 * an even sample for a continuous factor.
 *
 * A discrete axis longer than the drawing resolution is sampled at even integer
 * indices — every position handed out is still an allowed value, and the curve
 * says how many points it skipped through `ProfileCurve.sampled`.
 */
export function curveAxis(factor: FactorSettings, resolution: number): (number | string)[] {
  if (factor.kind === 'categorical') return [...factor.levels];
  const count = Math.max(2, Math.round(resolution));
  if (factor.kind === 'discrete') {
    const axis = discreteAxis(factor.lower, factor.upper, factor.step, Math.max(2, count) * 4);
    if (axis.values.length <= Math.max(2, count) * 2) return axis.values;
    const stride = Math.ceil((axis.values.length - 1) / (count - 1));
    const values: number[] = [];
    for (let index = 0; index < axis.values.length - 1; index += stride) values.push(axis.values[index]);
    values.push(axis.values[axis.values.length - 1]);
    return values;
  }
  return Array.from({ length: count }, (_, index) => factor.lower + ((factor.upper - factor.lower) * index) / (count - 1));
}

function emptyCurve(current: number | null): ProfileCurve {
  return { xs: [], mean: [], ci: null, pi: null, current, yMin: Number.NaN, yMax: Number.NaN, issues: [] };
}

/**
 * Conditional curves for every (response, factor) pair at one condition.
 *
 * `point` supplies the current value of every factor; a factor missing from it
 * is read at the middle of its own domain (categorical: its first level), which
 * is what "no condition yet" means on first open. That is a documented default
 * for a factor on the screen — never a way to invent a value for one that is
 * not.
 */
export function profileCurves(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
  point: Record<string, number | string>,
  options: { resolution?: number; alpha?: number; requireAllFactors?: boolean } = {},
): ProfileRow[] {
  const resolution = Math.max(3, Math.min(41, options.resolution ?? 21));
  const alpha = options.alpha ?? 0.05;
  const resolved = resolvePoint(factors, point);
  const rows: ProfileRow[] = [];
  models.forEach((model) => {
    const settings = responses.find((response) => response.modelId === model.id);
    if (!settings) return;
    const adapter = evaluatorFor(model);
    const missing = adapter.predictors.filter((name) => !factors.some((factor) => factor.name === name));
    const badFactor = factors.find((factor) => adapter.predictors.includes(factor.name) && resolved.issues[factor.name]);
    if (missing.length || badFactor) {
      const issues = missing.length ? ['opt.issue.factorMissing'] : [resolved.issues[badFactor!.name]];
      rows.push({
        modelId: model.id,
        responseName: model.response.name,
        curves: factors.map(() => emptyCurve(null)),
        prediction: null,
        blocked: true,
        issues: [...new Set(issues)],
        interval: { ci: false, pi: false },
        extrapolated: false,
      });
      return;
    }
    const scored = scorePoint([adapter], factors as never, [settings], resolved.point, { alpha, origin: 'start' });
    const prediction = scored.solution.responses[0] ?? null;
    const curves: ProfileCurve[] = factors.map((factor) => {
      if (!adapter.predictors.includes(factor.name)) {
        // A factor this model does not use has no curve: the response cannot
        // move with it, and drawing a flat line would suggest that it might.
        return emptyCurve(null);
      }
      const axis = curveAxis(factor, resolution);
      const numericAxis = axis.map((value, index) => (typeof value === 'number' ? value : index));
      const xs: number[] = [];
      const mean: number[] = [];
      const ciLo: number[] = [];
      const ciHi: number[] = [];
      const piLo: number[] = [];
      const piHi: number[] = [];
      let hasCi = false;
      let hasPi = false;
      const curveIssues = new Set<string>();
      axis.forEach((value, index) => {
        // Every axis value is resolved through the same policy as the current
        // condition, so an illegal lattice point cannot slip into a curve.
        const resolvedValue = resolvePoint([factor], { [factor.name]: value }).point[factor.name];
        const candidate = { ...resolved.point, [factor.name]: resolvedValue };
        const evaluation = adapter.evaluate(candidate, alpha);
        evaluation.issues.forEach((code) => curveIssues.add(code));
        xs.push(typeof value === 'number' ? value : numericAxis[index]);
        mean.push(evaluation.value === null ? Number.NaN : evaluation.value);
        if (evaluation.ci) {
          hasCi = true;
          ciLo.push(evaluation.ci[0]);
          ciHi.push(evaluation.ci[1]);
        } else {
          ciLo.push(Number.NaN);
          ciHi.push(Number.NaN);
        }
        if (evaluation.pi) {
          hasPi = true;
          piLo.push(evaluation.pi[0]);
          piHi.push(evaluation.pi[1]);
        } else {
          piLo.push(Number.NaN);
          piHi.push(Number.NaN);
        }
      });
      const band = [...(hasCi ? [...ciLo, ...ciHi] : []), ...(hasPi ? [...piLo, ...piHi] : [])];
      const finite = [...mean, ...band].filter((value) => Number.isFinite(value));
      const raw = resolved.point[factor.name];
      return {
        xs,
        mean,
        ci: hasCi ? { lo: ciLo, hi: ciHi } : null,
        pi: hasPi ? { lo: piLo, hi: piHi } : null,
        current: typeof raw === 'number' ? raw : (typeof raw === 'string' ? xs[Math.max(0, factor.levels.indexOf(raw))] ?? null : null),
        yMin: finite.length ? Math.min(...finite) : Number.NaN,
        yMax: finite.length ? Math.max(...finite) : Number.NaN,
        issues: [...curveIssues],
      };
    });
    let extrapolated = false;
    factors.forEach((factor) => {
      const value = resolved.point[factor.name];
      if (typeof value !== 'number') return;
      const range = adapter.fittedRange(factor.name);
      if (range && (value < range[0] - rangeSlack(range[0], range[1], value) || value > range[1] + rangeSlack(range[0], range[1], value))) extrapolated = true;
    });
    const anyCi = curves.some((curve) => curve.ci !== null);
    const anyPi = curves.some((curve) => curve.pi !== null);
    // The row states what the current condition could not answer, with the same
    // codes the optimiser and the Model Manager return for the same point.
    const rowIssues = new Set<string>(prediction?.issues ?? []);
    curves.forEach((curve) => curve.issues.forEach((code) => rowIssues.add(code)));
    rows.push({
      modelId: model.id,
      responseName: model.response.name,
      curves,
      prediction,
      blocked: false,
      issues: [...rowIssues],
      interval: { ci: anyCi, pi: anyPi },
      extrapolated,
    });
  });
  return rows;
}

/** The current condition scored once, for the numeric readout beside the curves. */
export function profilePoint(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
  point: Record<string, number | string>,
  alpha = 0.05,
): Solution | null {
  return evaluateCondition(models, responses, factors, point, { alpha, requireAllFactors: false, allowExtrapolation: true });
}

/** Is one factor's current value usable? (i18n key or null) */
export function factorValueIssue(factor: FactorSettings, value: number | string | undefined): string | null {
  if (value === undefined) return null;
  return validateFactorValue(factor, value);
}

/** The starting condition: the middle of every domain, the first level of a categorical. */
export function centrePoint(factors: FactorSettings[]): Record<string, number | string> {
  const point: Record<string, number | string> = {};
  factors.forEach((factor) => {
    point[factor.name] = holdingValue(factor);
  });
  return point;
}

/** Clamp a typed value into the factor's domain and snap it to its step. */
export function normaliseValue(factor: FactorSettings, value: number | string): number | string {
  return normaliseFactorValue(factor, value);
}
