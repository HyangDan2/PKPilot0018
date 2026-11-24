/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — the prediction profiler's curves (WO-06)

   A profiler answers "what happens to every response if I move this one
   factor?" — one small conditional curve per (response, factor) pair. The
   curves are computed from the same evaluators the optimiser uses, so the
   profiler and the optimiser can never disagree about a prediction.

   Two properties matter and are the reason this lives in a module instead of
   inside the component:

   · Holding. When one factor moves, every other factor stays exactly where the
     reader left it. A curve is therefore the model sliced along one axis at the
     current condition, not a marginal or an average.
   · Cost. The curves are recomputed on every slider move, so each model is
     compiled once (its coefficient labels parsed once) and each curve is one
     pass over the axis. No network, no worker, no cached stale numbers.
   ───────────────────────────────────────────────────────────────────────── */

import type { StoredModel } from './modelStore';
import type { FactorSettings, ResponseSettings, Solution } from './optimizationTypes';
import { compilePointEvaluator, evaluateCondition, type PointEvaluator } from './optimizer';

export interface ProfileCurve {
  /** Axis positions in the factor's input units. */
  xs: number[];
  /** Predicted mean at each position. */
  mean: number[];
  /** Confidence band for the mean, when the model carries covariance and df. */
  ci: { lo: number[]; hi: number[] } | null;
  /** Prediction band for one future observation. */
  pi: { lo: number[]; hi: number[] } | null;
  /** The current value of this factor, for the vertical line. */
  current: number | null;
  /** Y limits to draw (finite only). */
  yMin: number;
  yMax: number;
}

export interface ProfileRow {
  modelId: string;
  responseName: string;
  /** One entry per factor, in the order the caller passed them. */
  curves: ProfileCurve[];
  prediction: Solution['responses'][number] | null;
}

const evaluatorCache = new WeakMap<StoredModel, PointEvaluator>();

export function evaluatorFor(model: StoredModel): PointEvaluator {
  const cached = evaluatorCache.get(model);
  if (cached) return cached;
  const compiled = compilePointEvaluator(model);
  evaluatorCache.set(model, compiled);
  return compiled;
}

/** A factor's axis points: continuous factors are sampled, categorical ones are listed. */
export function curveAxis(factor: FactorSettings, resolution: number): (number | string)[] {
  if (factor.kind === 'categorical') return [...factor.levels];
  const count = Math.max(2, Math.round(resolution));
  return Array.from({ length: count }, (_, index) => factor.lower + ((factor.upper - factor.lower) * index) / (count - 1));
}

/**
 * Conditional curves for every (response, factor) pair at one condition.
 *
 * `point` supplies the current value of every factor; a factor missing from it
 * is read at the middle of its range (categorical: its first level), which is
 * what "no condition yet" means on first open.
 */
export function profileCurves(
  models: StoredModel[],
  responses: ResponseSettings[],
  factors: FactorSettings[],
  point: Record<string, number | string>,
  options: { resolution?: number; alpha?: number } = {},
): ProfileRow[] {
  const resolution = Math.max(3, Math.min(41, options.resolution ?? 21));
  const alpha = options.alpha ?? 0.05;
  const rows: ProfileRow[] = [];
  models.forEach((model) => {
    const settings = responses.find((response) => response.modelId === model.id);
    if (!settings) return;
    const evaluator = evaluatorFor(model);
    const current = evaluateCondition([model], [settings], factors, point, { alpha });
    const curves: ProfileCurve[] = factors.map((factor) => {
      if (!evaluator.predictors.includes(factor.name)) {
        // A factor this model does not use has no curve: the response cannot
        // move with it, and drawing a flat line would suggest that it might.
        return { xs: [], mean: [], ci: null, pi: null, current: null, yMin: Number.NaN, yMax: Number.NaN };
      }
      const axis = curveAxis(factor, resolution);
      const xs: number[] = [];
      const mean: number[] = [];
      const ciLo: number[] = [];
      const ciHi: number[] = [];
      const piLo: number[] = [];
      const piHi: number[] = [];
      let hasCi = false;
      let hasPi = false;
      axis.forEach((value) => {
        const candidate = { ...point, [factor.name]: value };
        const evaluation = evaluator.evaluate(candidate, alpha);
        if (typeof value === 'number') xs.push(value);
        else xs.push(xs.length);
        mean.push(evaluation.value === null ? Number.NaN : evaluation.value);
        if (evaluation.ci) { hasCi = true; ciLo.push(evaluation.ci[0]); ciHi.push(evaluation.ci[1]); } else { ciLo.push(Number.NaN); ciHi.push(Number.NaN); }
        if (evaluation.pi) { hasPi = true; piLo.push(evaluation.pi[0]); piHi.push(evaluation.pi[1]); } else { piLo.push(Number.NaN); piHi.push(Number.NaN); }
      });
      const band = [...(hasCi ? [...ciLo, ...ciHi] : []), ...(hasPi ? [...piLo, ...piHi] : [])];
      const finite = [...mean, ...band].filter((value) => Number.isFinite(value));
      const raw = point[factor.name];
      return {
        xs,
        mean,
        ci: hasCi ? { lo: ciLo, hi: ciHi } : null,
        pi: hasPi ? { lo: piLo, hi: piHi } : null,
        current: typeof raw === 'number' ? raw : (typeof raw === 'string' ? xs[Math.max(0, factor.levels.indexOf(raw))] ?? null : null),
        yMin: finite.length ? Math.min(...finite) : Number.NaN,
        yMax: finite.length ? Math.max(...finite) : Number.NaN,
      };
    });
    rows.push({
      modelId: model.id,
      responseName: model.response.name,
      curves,
      prediction: current ? current.responses[0] ?? null : null,
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
  return evaluateCondition(models, responses, factors, point, { alpha });
}

/** The starting condition: middle of every range, first level of a categorical. */
export function centrePoint(factors: FactorSettings[]): Record<string, number | string> {
  const point: Record<string, number | string> = {};
  factors.forEach((factor) => {
    if (factor.fixed) {
      point[factor.name] = factor.kind === 'categorical' ? String(factor.fixedValue) : Number(factor.fixedValue);
      return;
    }
    point[factor.name] = factor.kind === 'categorical' ? (factor.levels[0] ?? '') : (factor.lower + factor.upper) / 2;
  });
  return point;
}

/** Clamp a typed value into the factor's own space and snap it to its step. */
export function normaliseValue(factor: FactorSettings, value: number | string): number | string {
  if (factor.kind === 'categorical') {
    const levels = factor.levels;
    return levels.includes(String(value)) ? String(value) : (levels[0] ?? '');
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return factor.lower;
  const clamped = Math.min(factor.upper, Math.max(factor.lower, numeric));
  if (factor.kind === 'discrete' && factor.step > 0) {
    const snapped = factor.lower + Math.round((clamped - factor.lower) / factor.step) * factor.step;
    const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(factor.step)) + 2));
    return Number(snapped.toFixed(decimals));
  }
  return clamped;
}
