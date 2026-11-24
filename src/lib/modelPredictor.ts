/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — prediction from a stored model (WO-02)

   A stored model is used in three ways: evaluate ŷ at a point a reader typed,
   evaluate a whole table, and draw a contour of two factors with the rest held.
   All three build the same design row from the stored coefficients, then use
   the stored covariance for the standard error.

   Two rules matter more than the arithmetic:

   · Compatibility is checked, not assumed. A predictor must match by name and
     id, a categorical value must be one of the fitted levels, and a numeric
     value must be convertible under the model's own coded/actual transform.
   · An unidentified coefficient is never multiplied by zero and reported as a
     plausible number. If the row leans on an aliased column, the prediction is
     non-estimable and says which terms.
   ───────────────────────────────────────────────────────────────────────── */

import { tInv } from './dist';
import type { ModelVariable, StoredModel } from './modelStore';
import { rangeSlack } from './factorDomain';

export type InputMode = 'actual' | 'coded';

/** A point the reader supplies: predictor name (or id) → value. */
export type PredictionPoint = Record<string, number | string | null>;

export interface PredictionResult {
  /** ŷ, or null when it cannot be estimated. */
  value: number | null;
  /** Standard error of the fitted mean, when the model carries a covariance. */
  se: number | null;
  /** 95 % (or `alpha`) confidence interval for the fitted mean. */
  ci: [number, number] | null;
  /** 95 % (or `alpha`) prediction interval for one future observation. */
  pi: [number, number] | null;
  /** Coefficient labels the row depends on that are not identifiable. */
  nonEstimable: string[];
  /** Validation problems (unknown level, missing value, …). */
  issues: string[];
}

export class ModelInputError extends Error {
  constructor(readonly code: string, readonly detail: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ModelInputError';
  }
}

/** 'A²×Machine[L1]' → the factors it multiplies and the level it contrasts. */
export interface ParsedToken {
  name: string;
  /** Exponent the term applies to the variable (1 for a plain factor). */
  power: number;
  level: string | null;
}

export function parseCoefficientLabel(label: string): ParsedToken[] {
  if (label === 'Constant') return [];
  return label.split('×').map((part) => {
    const levelMatch = /\[(.+)\]$/.exec(part);
    const level = levelMatch ? levelMatch[1] : null;
    let name = levelMatch ? part.slice(0, levelMatch.index) : part;
    let power = 1;
    for (;;) {
      if (name.endsWith('²')) { power *= 2; name = name.slice(0, -1); continue; }
      if (name.endsWith('³')) { power *= 3; name = name.slice(0, -1); continue; }
      break;
    }
    return { name, power, level };
  });
}

function predictorNamed(model: StoredModel, name: string): ModelVariable | undefined {
  return model.predictors.find((predictor) => predictor.name === name)
    ?? model.predictors.find((predictor) => predictor.id && predictor.id === name);
}

/** True when a coding transform can be inverted at all. */
function usableCoding(predictor: ModelVariable): boolean {
  const coding = predictor.coding;
  return Boolean(coding) && Number.isFinite(coding?.center) && Number.isFinite(coding?.halfRange) && coding?.halfRange !== 0;
}

/** The coded/actual conversion for one numeric predictor. */
export function toDesignValue(predictor: ModelVariable, value: number, mode: InputMode): number {
  const coding = predictor.coding;
  if (!coding) return value;
  if (!Number.isFinite(value)) throw new ModelInputError('model.valueMissing', { variable: predictor.name });
  if (coding.mode === 'coded') {
    // Coefficients read coded units.
    if (mode === 'coded') return value;
    if (!usableCoding(predictor)) throw new ModelInputError('model.coding', { variable: predictor.name });
    return (value - coding.center) / coding.halfRange;
  }
  // Coefficients read the measured value.
  if (mode === 'actual') return value;
  if (!usableCoding(predictor)) throw new ModelInputError('model.coding', { variable: predictor.name });
  return coding.center + coding.halfRange * value;
}

/**
 * The actual (physical) value an axis position stands for.
 *
 * This is the one place where the two unit systems meet: an axis is drawn in
 * `mode` units of the reference model, while every model transforms the SAME
 * physical value with its own coding. Going through actual units is what keeps
 * two models with different centres and half ranges in one coordinate system.
 */
export function axisActualValue(predictor: ModelVariable, value: number, mode: InputMode): number {
  if (mode === 'actual') return value;
  const coding = predictor.coding;
  if (!coding || !Number.isFinite(coding.center) || !Number.isFinite(coding.halfRange)) return value;
  return coding.center + coding.halfRange * value;
}

/** A measured value in the units the coefficients read. */
export function designFromActual(predictor: ModelVariable, actual: number): number {
  return toDesignValue(predictor, actual, 'actual');
}

/** The actual-unit value that corresponds to a coded one (for display). */
export function toActualValue(predictor: ModelVariable, value: number, mode: InputMode): number {
  const coding = predictor.coding;
  if (!coding) return value;
  if (coding.mode === 'coded') {
    if (mode === 'actual') return value;
    return coding.center + coding.halfRange * value;
  }
  if (mode === 'actual') return value;
  return coding.center + coding.halfRange * value;
}

function readPointValue(point: PredictionPoint, predictor: ModelVariable): unknown {
  if (point[predictor.name] !== undefined) return point[predictor.name];
  if (predictor.id && point[predictor.id] !== undefined) return point[predictor.id];
  return undefined;
}

/** Categorical contrast: +1 for the level, −1 for the last level, else 0. */
function contrastFor(predictor: ModelVariable, level: string, value: string): number {
  const levels = predictor.levels ?? [];
  if (!levels.length) throw new ModelInputError('model.levelMissing', { variable: predictor.name });
  const last = levels[levels.length - 1];
  if (!levels.includes(value)) {
    throw new ModelInputError('model.levelUnknown', { variable: predictor.name, value, levels: levels.join(', ') });
  }
  if (value === level) return 1;
  if (value === last) return -1;
  return 0;
}

export interface DesignRow {
  values: number[];
  labels: string[];
}

/**
 * Build the design row for one point, in the coefficient order of the model.
 *
 * Every coefficient label is parsed into the factors it multiplies, so a square
 * term multiplies the predictor by itself and a categorical token becomes the
 * model's own sum-to-zero contrast. A label that cannot be parsed stops the
 * prediction instead of contributing a silent zero.
 */
export function designRow(model: StoredModel, point: PredictionPoint, mode: InputMode = 'actual'): DesignRow {
  const values: number[] = [];
  const labels: string[] = [];
  model.coefficients.forEach((coefficient) => {
    labels.push(coefficient.label);
    if (coefficient.label === 'Constant') {
      values.push(1);
      return;
    }
    let product = 1;
    parseCoefficientLabel(coefficient.label).forEach((token) => {
      const predictor = predictorNamed(model, token.name);
      if (!predictor) throw new ModelInputError('model.structure', { term: coefficient.label, variable: token.name });
      const raw = readPointValue(point, predictor);
      if (predictor.kind === 'categorical') {
        const text = raw === null || raw === undefined ? '' : String(raw);
        if (!text) throw new ModelInputError('model.valueMissing', { variable: predictor.name });
        if (!token.level) throw new ModelInputError('model.structure', { term: coefficient.label });
        product *= contrastFor(predictor, token.level, text);
        return;
      }
      const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
      if (!Number.isFinite(numeric)) throw new ModelInputError('model.valueMissing', { variable: predictor.name });
      const base = toDesignValue(predictor, numeric, mode);
      product *= token.power === 1 ? base : base ** token.power;
    });
    values.push(product);
  });
  return { values, labels };
}

/**
 * ŷ from a design row, with the refusal rules in one place.
 *
 * This is the arithmetic every prediction path shares: the Model Manager, the
 * contour and surface grids, the optimiser and the profiler all arrive here
 * with their own weights, so a non-finite weight (a polynomial overflow, a
 * broken transform) is refused identically everywhere instead of being skipped
 * by one path and refused by another.
 */
export interface DesignSum {
  value: number | null;
  nonEstimable: string[];
  issues: string[];
}

export function sumDesignRow(model: StoredModel, weights: number[]): DesignSum {
  const nonEstimable: string[] = [];
  let fit = 0;
  for (let index = 0; index < model.coefficients.length; index += 1) {
    const weight = weights[index];
    // Skipping a non-finite weight would return the rest of the sum as if it
    // were the prediction; the whole point is refused instead.
    if (!Number.isFinite(weight)) return { value: null, nonEstimable: [], issues: ['model.value.nonFinite'] };
    if (weight === 0) continue;
    const coefficient = model.coefficients[index];
    if (!coefficient.estimable) {
      if (!nonEstimable.includes(coefficient.label)) nonEstimable.push(coefficient.label);
      continue;
    }
    if (!Number.isFinite(coefficient.value)) return { value: null, nonEstimable: [], issues: ['model.coefficient.nonFinite'] };
    fit += weight * coefficient.value;
    if (!Number.isFinite(fit)) return { value: null, nonEstimable: [], issues: ['model.value.nonFinite'] };
  }
  if (nonEstimable.length) return { value: null, nonEstimable, issues: [] };
  return { value: fit, nonEstimable: [], issues: [] };
}

/**
 * The interval remarks a prediction carries, from the shared basis rules.
 *
 * A missing covariance or residual df is the absence of a quantity rather than
 * a defect, so it is not repeated as an issue; a missing mse, a rank-deficient
 * fit or a covariance that fails its checks is stated — by every path alike.
 */
/**
 * The interval was asked for and could not be computed, while the mean is a
 * number. It is deliberately not `model.value.nonFinite`: the value is finite,
 * and a reader who sees that code beside a number would rightly distrust both.
 */
export const INTERVAL_NON_FINITE = 'model.interval.nonFinite';

/**
 * Is this code about the interval rather than about the mean?
 *
 * Every path answers two questions — ŷ, and the band around it — and they can
 * fail independently. This is the one place that says which codes belong to
 * the second question, so the optimiser does not call a mean unusable because
 * its confidence band overflowed, and the Model Manager does not hide ŷ behind
 * an interval remark.
 */
export function isIntervalIssue(code: string): boolean {
  return code.startsWith('model.covariance.')
    || code.startsWith('model.interval.')
    || code.startsWith('model.mse.')
    || code === 'model.df.missing'
    || code === 'model.rankDeficient';
}

/** The codes that stop the MEAN itself (everything that is not interval-only). */
export function meanIssues(issues: string[]): string[] {
  return issues.filter((code) => !isIntervalIssue(code));
}

export function intervalIssues(model: StoredModel): string[] {
  return intervalStatus(model).reasons.filter((reason) => reason !== 'model.covariance.missing' && reason !== 'model.df.missing');
}

/** Does this model's coefficient list look internally consistent? */
export function structureIssues(model: StoredModel): string[] {
  const issues: string[] = [];
  if (!model.coefficients.length) issues.push('model.structure.empty');
  model.coefficients.forEach((coefficient) => {
    if (coefficient.label === 'Constant') return;
    try {
      parseCoefficientLabel(coefficient.label).forEach((token) => {
        if (!predictorNamed(model, token.name)) issues.push(`model.structure.unknown:${token.name}`);
      });
    } catch {
      issues.push(`model.structure:${coefficient.label}`);
    }
  });
  return [...new Set(issues)];
}

export interface PredictionOptions {
  mode?: InputMode;
  /** 1 − confidence for the interval; 0.05 → a 95 % interval. */
  alpha?: number;
}

/**
 * ŷ at one point.
 *
 * `nonEstimable` is non-empty when the row depends on an aliased coefficient:
 * the least-squares solution sets that coefficient to zero, so a number would
 * be an artefact of the solver rather than a property of the model.
 */
export function predictStoredModel(model: StoredModel, point: PredictionPoint, options: PredictionOptions = {}): PredictionResult {
  const issues: string[] = [];
  const refused = (codes: string[], nonEstimable: string[] = []): PredictionResult => ({
    value: null, se: null, ci: null, pi: null, nonEstimable, issues: codes,
  });
  let design: DesignRow;
  try {
    design = designRow(model, point, options.mode ?? 'actual');
  } catch (error) {
    if (error instanceof ModelInputError) return refused([error.code]);
    return refused(['model.predictFailed']);
  }
  const summed = sumDesignRow(model, design.values);
  if (summed.value === null) {
    return refused([...issues, ...summed.issues], summed.nonEstimable);
  }
  const fit = summed.value;
  // Intervals: covariance and df gate a confidence interval, mse additionally
  // gates a prediction interval. A missing quantity is named, never filled in.
  const covarianceCheck = covarianceStatus(model);
  const intervals = intervalStatus(model);
  let se: number | null = null;
  let ci: [number, number] | null = null;
  let pi: [number, number] | null = null;
  issues.push(...intervalIssues(model));
  if (intervals.ci) {
    const variance = quadraticForm(covarianceCheck.matrix as number[][], design.values);
    if (!variance.ok) {
      // ŷ stays: it is a number, and only the band around it is unavailable.
      issues.push(variance.reason);
    } else {
      const alpha = Math.min(0.999, Math.max(1e-6, options.alpha ?? 0.05));
      const df = model.residual?.df as number;
      se = Math.sqrt(variance.value);
      const ciHalf = tInv(1 - alpha / 2, df) * se;
      if (Number.isFinite(ciHalf)) ci = [fit - ciHalf, fit + ciHalf];
      else issues.push(INTERVAL_NON_FINITE);
      if (intervals.pi) {
        const mse = model.residual?.mse as number;
        const half = tInv(1 - alpha / 2, df) * Math.sqrt(variance.value + mse);
        if (Number.isFinite(half)) pi = [fit - half, fit + half];
        else issues.push(INTERVAL_NON_FINITE);
      }
    }
  }
  return { value: fit, se, ci, pi, nonEstimable: [], issues };
}

/* ── covariance and interval conditions ──────────────────────────────── */

export interface CovarianceStatus {
  ok: boolean;
  /** Why the matrix cannot carry a variance, when it cannot. */
  reasons: string[];
  /** The matrix when it passed every check, else null. */
  matrix: number[][] | null;
}

/** Absolute floor for a negative variance that is only rounding noise. */
const NEGATIVE_VARIANCE_TOLERANCE = 1e-12;
/**
 * Relative tolerance for the same judgement.
 *
 * A covariance stored as mse·(X'X)⁻¹ can carry a tiny negative eigenvalue from
 * the inversion itself (the QA-J regression model has −2e-8 on a 0.86 diagonal,
 * i.e. 2e-8 relative). That is rounding, not an invalid matrix; a matrix whose
 * eigenvalues are genuinely negative is far below this bound and is refused.
 */
const PSD_RELATIVE_TOLERANCE = 1e-7;

function symmetricTolerance(value: number): number {
  return 1e-9 * (1 + Math.abs(value));
}

function choleskyPasses(matrix: number[][]): boolean {
  const n = matrix.length;
  const lower: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let scale = 0;
  for (let i = 0; i < n; i += 1) scale = Math.max(scale, Math.abs(matrix[i][i]));
  const tolerance = Math.max(NEGATIVE_VARIANCE_TOLERANCE, PSD_RELATIVE_TOLERANCE * Math.max(1, scale));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum < -tolerance) return false;
        lower[i][i] = Math.sqrt(Math.max(0, sum));
      } else if (lower[j][j] > 0) {
        lower[i][j] = sum / lower[j][j];
      } else if (Math.abs(sum) > tolerance) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Is this covariance usable as the variance of a linear combination?
 *
 * Size, finiteness, symmetry and positive semi-definiteness are checked; a
 * matrix that fails any of them cannot turn into a standard error, and the
 * caller is told which check failed instead of receiving a smaller number.
 */
export function covarianceStatus(model: StoredModel): CovarianceStatus {
  const size = model.coefficients.length;
  const covariance = model.covariance;
  if (!covariance) return { ok: false, reasons: ['model.covariance.missing'], matrix: null };
  if (!Array.isArray(covariance) || covariance.length !== size) return { ok: false, reasons: ['model.covariance.size'], matrix: null };
  const reasons = new Set<string>();
  for (let i = 0; i < size; i += 1) {
    const row = covariance[i];
    if (!Array.isArray(row) || row.length !== size) { reasons.add('model.covariance.size'); break; }
    for (let j = 0; j < size; j += 1) {
      const value = row[j];
      if (!Number.isFinite(value)) { reasons.add('model.covariance.nonFinite'); continue; }
      if (i !== j) {
        const mirror = covariance[j]?.[i];
        if (!Number.isFinite(mirror) || Math.abs(value - (mirror as number)) > symmetricTolerance(value)) reasons.add('model.covariance.asymmetric');
      } else if (value < -Math.max(NEGATIVE_VARIANCE_TOLERANCE, PSD_RELATIVE_TOLERANCE * Math.max(1, Math.abs(value)))) {
        reasons.add('model.covariance.negativeVariance');
      }
    }
  }
  if (reasons.size) return { ok: false, reasons: [...reasons], matrix: null };
  if (!choleskyPasses(covariance)) return { ok: false, reasons: ['model.covariance.notPsd'], matrix: null };
  return { ok: true, reasons: [], matrix: covariance };
}

/** True when a coefficient is unidentified: the fit is rank-deficient. */
export function isRankDeficient(model: StoredModel): boolean {
  if (model.coefficients.some((coefficient) => !coefficient.estimable)) return true;
  const rank = model.dof?.rank;
  return typeof rank === 'number' && Number.isFinite(rank) && rank < model.coefficients.length;
}

export interface IntervalStatus {
  /** A confidence interval on the mean is defined. */
  ci: boolean;
  /** A prediction interval for one future observation is defined. */
  pi: boolean;
  reasons: string[];
}

/**
 * What each basis needs, in one place.
 *
 * CI: a usable covariance and df > 0 on an identified fit.
 * PI: the same, plus a finite residual variance (`mse`). A missing mse is a
 * missing quantity — substituting 0 would understate the interval by exactly
 * the residual variance.
 */
export function intervalStatus(model: StoredModel): IntervalStatus {
  const reasons: string[] = [];
  const covariance = covarianceStatus(model);
  if (!covariance.ok) reasons.push(...covariance.reasons);
  if (isRankDeficient(model)) reasons.push('model.rankDeficient');
  const df = model.residual?.df;
  if (!(typeof df === 'number' && Number.isFinite(df) && df > 0)) reasons.push('model.df.missing');
  const ci = reasons.length === 0;
  const mse = model.residual?.mse;
  const mseOk = typeof mse === 'number' && Number.isFinite(mse) && mse >= 0;
  const pi = ci && mseOk;
  const all = ci && !mseOk ? [...reasons, 'model.mse.missing'] : reasons;
  return { ci, pi, reasons: [...new Set(all)] };
}

interface QuadraticForm {
  ok: boolean;
  value: number;
  reason: string;
}

/** w'Σw with the documented negative-variance distinction. */
export function quadraticForm(covariance: number[][], weights: number[]): QuadraticForm {
  let sum = 0;
  let scale = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (!Number.isFinite(weights[i])) return { ok: false, value: Number.NaN, reason: 'model.value.nonFinite' };
    for (let j = 0; j < weights.length; j += 1) {
      const entry = covariance[i]?.[j];
      if (!Number.isFinite(entry)) return { ok: false, value: Number.NaN, reason: 'model.covariance.nonFinite' };
      const term = weights[i] * weights[j] * (entry as number);
      sum += term;
      scale += Math.abs(term);
    }
  }
  if (!Number.isFinite(sum)) return { ok: false, value: Number.NaN, reason: INTERVAL_NON_FINITE };
  const tolerance = Math.max(NEGATIVE_VARIANCE_TOLERANCE, PSD_RELATIVE_TOLERANCE * Math.max(scale, 1));
  if (sum < -tolerance) return { ok: false, value: Number.NaN, reason: 'model.covariance.negativeVariance' };
  return { ok: true, value: Math.max(0, sum), reason: '' };
}

/** ŷ for every row of a table (predictor name → values). */
export function predictTable(model: StoredModel, rows: PredictionPoint[], options: PredictionOptions = {}): PredictionResult[] {
  return rows.map((point) => predictStoredModel(model, point, options));
}

export interface SurfaceOptions {
  xName: string;
  yName: string;
  /** Values for the predictors that are not on an axis (in `mode` units). */
  holdings?: Record<string, number | string>;
  /** Display range per axis in `mode` units; defaults to the fitted bounds. */
  xRange?: [number, number];
  yRange?: [number, number];
  resolution?: number;
  mode?: InputMode;
}

export interface ModelSurface {
  xName: string;
  yName: string;
  xs: number[];
  ys: number[];
  /** z[j][i] at (xs[i], ys[j]); NaN where the model cannot predict. */
  z: number[][];
  xRange: [number, number];
  yRange: [number, number];
  outOfRange: boolean;
  nonEstimable: string[];
}

/**
 * The display range of one factor, in `mode` units.
 *
 * `factorBounds` are stored in ACTUAL units (see StoredModel). The coded display
 * therefore maps them through the model's own coding; it never reinterprets a
 * bound as if it were already coded, which used to shrink or grow the range a
 * second time depending on the coding mode.
 */
export function factorDisplayRange(model: StoredModel, predictor: ModelVariable, mode: InputMode): [number, number] {
  const bound = model.factorBounds?.[predictor.name];
  const coding = predictor.coding;
  if (!bound || !Number.isFinite(bound.min) || !Number.isFinite(bound.max)) {
    if (coding && usableCoding(predictor)) {
      const actual: [number, number] = [coding.center - coding.halfRange, coding.center + coding.halfRange];
      return mode === 'actual' ? actual : [(actual[0] - coding.center) / coding.halfRange, (actual[1] - coding.center) / coding.halfRange];
    }
    return [-1, 1];
  }
  if (mode === 'actual') return [bound.min, bound.max];
  if (!coding || !usableCoding(predictor)) return [bound.min, bound.max];
  return [(bound.min - coding.center) / coding.halfRange, (bound.max - coding.center) / coding.halfRange];
}

/**
 * A two-factor surface from a stored model — the entry point a later Contour or
 * Surface stage uses. Predictions the model cannot make stay NaN, so the
 * contour engine masks them instead of drawing an invented plane.
 */
export function modelSurface(model: StoredModel, options: SurfaceOptions): ModelSurface {
  const mode = options.mode ?? 'actual';
  const xPredictor = predictorNamed(model, options.xName);
  const yPredictor = predictorNamed(model, options.yName);
  if (!xPredictor || !yPredictor) throw new ModelInputError('model.structure.surface', { x: options.xName, y: options.yName });
  if (xPredictor.kind !== 'numeric' || yPredictor.kind !== 'numeric') throw new ModelInputError('model.surface.numericOnly');
  const xRange = options.xRange ?? factorDisplayRange(model, xPredictor, mode);
  const yRange = options.yRange ?? factorDisplayRange(model, yPredictor, mode);
  const resolution = Math.max(2, Math.min(201, Math.round(options.resolution ?? 41)));
  const xs = Array.from({ length: resolution }, (_, i) => xRange[0] + ((xRange[1] - xRange[0]) * i) / (resolution - 1));
  const ys = Array.from({ length: resolution }, (_, i) => yRange[0] + ((yRange[1] - yRange[0]) * i) / (resolution - 1));
  const holdings: PredictionPoint = { ...(options.holdings ?? {}) };
  model.predictors.forEach((predictor) => {
    if (predictor.name === xPredictor.name || predictor.name === yPredictor.name) return;
    if (holdings[predictor.name] !== undefined) return;
    if (predictor.kind === 'categorical') {
      holdings[predictor.name] = predictor.levels?.[0] ?? '';
      return;
    }
    // Hold every other factor at its coded centre, which is its mid-range value.
    holdings[predictor.name] = mode === 'coded' ? 0 : (predictor.coding?.center ?? 0);
  });
  const nonEstimable = new Set<string>();
  const z: number[][] = ys.map((y) => xs.map((x) => {
    const result = predictStoredModel(model, { ...holdings, [xPredictor.name]: x, [yPredictor.name]: y }, { mode });
    result.nonEstimable.forEach((label) => nonEstimable.add(label));
    return result.value ?? Number.NaN;
  }));
  const boundX = model.factorBounds?.[xPredictor.name];
  const boundY = model.factorBounds?.[yPredictor.name];
  const outside = (bound: { min: number; max: number } | undefined, range: [number, number]): boolean => {
    if (!bound || !Number.isFinite(bound.min) || !Number.isFinite(bound.max)) return false;
    const slack = rangeSlack(bound.min, bound.max, Math.max(Math.abs(range[0]), Math.abs(range[1])));
    return range[0] < bound.min - slack || range[1] > bound.max + slack;
  };
  const outOfRange = outside(boundX, xRange) || outside(boundY, yRange);
  return {
    xName: xPredictor.name,
    yName: yPredictor.name,
    xs,
    ys,
    z,
    xRange,
    yRange,
    outOfRange,
    nonEstimable: [...nonEstimable],
  };
}

/**
 * A model compiled for repeated surface evaluation (Stage 3B).
 *
 * `modelSurface` builds a full design row per node, which is correct but does
 * string work per cell: a 401×401 grid would parse every coefficient label
 * 160 801 times. This evaluator parses the labels once, multiplies the held
 * factors into a constant per term, and leaves only the two axis factors as
 * powers — the same arithmetic, in the same order per term, so it can be
 * cross-checked against `modelSurface` node for node.
 */
export interface NodeEvaluation {
  /** ŷ, or null when this point cannot be estimated. */
  value: number | null;
  /** Terms this point leans on that are not identified (empty when estimable). */
  nonEstimable: string[];
  /** Standard error of the mean at this point, or null. */
  se: number | null;
  ciHalf: number | null;
  piHalf: number | null;
  /** Structural problems of this point (overflow, unusable covariance, …). */
  issues: string[];
}

export interface CompiledSurfaceEvaluator {
  xName: string;
  yName: string;
  /** Design-space (coded / contrast) values the non-axis factors are held at. */
  resolvedHoldings: PredictionPoint;
  /** Coefficient labels that are not identified in this fit (a model fact). */
  nonEstimable: string[];
  /** What each interval basis can answer for this model, and why not. */
  intervalStatus: IntervalStatus;
  /**
   * Every quantity of one point in one call. Nothing is remembered between
   * calls: the same (x, y) always returns the same node, whatever order the
   * grid is walked in.
   */
  evaluate(xCoded: number, yCoded: number, withVariance?: boolean): NodeEvaluation;
  /** ŷ at design-space (x, y) values, NaN when this point is not estimable. */
  value(xCoded: number, yCoded: number): number;
  /** Standard error of the fitted mean, or null without a usable covariance. */
  se(xCoded: number, yCoded: number): number | null;
  /** 1 − α/2 t half-width for a confidence interval on the mean. */
  ciHalf(xCoded: number, yCoded: number): number | null;
  /** 1 − α/2 t half-width for a prediction interval (needs df and mse). */
  piHalf(xCoded: number, yCoded: number): number | null;
  /** True when a confidence interval on the mean is defined. */
  hasInterval: boolean;
}

interface CompiledTerm {
  label: string;
  value: number;
  estimable: boolean;
  /** Product of every factor in the term that is not on an axis. */
  constantPart: number;
  xPower: number;
  yPower: number;
}

/** Default holding for a factor that is not on either axis. */
export function defaultHoldingValue(predictor: ModelVariable, mode: InputMode): number | string {
  if (predictor.kind === 'categorical') return predictor.levels?.[0] ?? '';
  return mode === 'coded' ? 0 : (predictor.coding?.center ?? 0);
}

export function compileSurfaceEvaluator(
  model: StoredModel,
  options: { xName: string; yName: string; holdings?: Record<string, number | string>; mode?: InputMode; alpha?: number },
): CompiledSurfaceEvaluator {
  const mode = options.mode ?? 'actual';
  const xPredictor = predictorNamed(model, options.xName);
  const yPredictor = predictorNamed(model, options.yName);
  if (!xPredictor || !yPredictor) throw new ModelInputError('model.structure.surface', { x: options.xName, y: options.yName });
  if (xPredictor.kind !== 'numeric' || yPredictor.kind !== 'numeric') throw new ModelInputError('model.surface.numericOnly');
  const resolvedHoldings: PredictionPoint = {};
  model.predictors.forEach((predictor) => {
    if (predictor.name === xPredictor.name || predictor.name === yPredictor.name) return;
    const given = options.holdings?.[predictor.name];
    resolvedHoldings[predictor.name] = given === undefined || given === null
      ? defaultHoldingValue(predictor, mode)
      : given;
  });
  const designOf = (predictor: ModelVariable): number => {
    const held = resolvedHoldings[predictor.name];
    const numeric = typeof held === 'number' ? held : Number(held);
    if (!Number.isFinite(numeric)) throw new ModelInputError('model.valueMissing', { variable: predictor.name });
    return toDesignValue(predictor, numeric, mode);
  };
  const terms: CompiledTerm[] = [];
  model.coefficients.forEach((coefficient) => {
    if (coefficient.label === 'Constant') {
      terms.push({ label: coefficient.label, value: coefficient.value, estimable: coefficient.estimable, constantPart: 1, xPower: 0, yPower: 0 });
      return;
    }
    let constantPart = 1;
    let xPower = 0;
    let yPower = 0;
    parseCoefficientLabel(coefficient.label).forEach((token) => {
      const predictor = predictorNamed(model, token.name);
      if (!predictor) throw new ModelInputError('model.structure', { term: coefficient.label, variable: token.name });
      if (predictor.name === xPredictor.name) { xPower += token.power; return; }
      if (predictor.name === yPredictor.name) { yPower += token.power; return; }
      if (predictor.kind === 'categorical') {
        if (!token.level) throw new ModelInputError('model.structure', { term: coefficient.label });
        const text = String(resolvedHoldings[predictor.name] ?? '');
        constantPart *= contrastFor(predictor, token.level, text);
        return;
      }
      constantPart *= designOf(predictor) ** token.power;
    });
    terms.push({ label: coefficient.label, value: coefficient.value, estimable: coefficient.estimable, constantPart, xPower, yPower });
  });
  const covarianceCheck = covarianceStatus(model);
  const intervals = intervalStatus(model);
  const df = model.residual?.df as number | undefined;
  const mse = model.residual?.mse;
  const alpha = Math.min(0.999, Math.max(1e-6, options.alpha ?? 0.05));
  const weight = (term: CompiledTerm, x: number, y: number): number => term.constantPart
    * (term.xPower === 0 ? 1 : x ** term.xPower)
    * (term.yPower === 0 ? 1 : y ** term.yPower);
  const nonEstimable = model.coefficients.filter((coefficient) => !coefficient.estimable).map((coefficient) => coefficient.label);
  const evaluate = (x: number, y: number, withVariance = true): NodeEvaluation => {
    const issues: string[] = [];
    const weights = new Array<number>(terms.length);
    for (let i = 0; i < terms.length; i += 1) {
      const w = weight(terms[i], x, y);
      if (!Number.isFinite(w)) {
        return { value: null, nonEstimable: [], se: null, ciHalf: null, piHalf: null, issues: ['model.value.nonFinite'] };
      }
      weights[i] = w;
    }
    const summed = sumDesignRow(model, weights);
    if (summed.value === null) {
      return { value: null, nonEstimable: summed.nonEstimable, se: null, ciHalf: null, piHalf: null, issues: [...issues, ...summed.issues] };
    }
    const fit = summed.value;
    let se: number | null = null;
    let ciHalf: number | null = null;
    let piHalf: number | null = null;
    if (!withVariance) return { value: fit, nonEstimable: [], se, ciHalf, piHalf, issues };
    if (intervals.ci) {
      const form = quadraticForm(covarianceCheck.matrix as number[][], weights);
      if (!form.ok) {
        issues.push(form.reason);
      } else {
        se = Math.sqrt(form.value);
        const wideCi = tInv(1 - alpha / 2, df as number) * se;
        if (Number.isFinite(wideCi)) ciHalf = wideCi;
        else issues.push(INTERVAL_NON_FINITE);
        if (intervals.pi && typeof mse === 'number') {
          const half = tInv(1 - alpha / 2, df as number) * Math.sqrt(form.value + mse);
          if (Number.isFinite(half)) piHalf = half;
          else issues.push(INTERVAL_NON_FINITE);
        }
      }
    }
    return { value: fit, nonEstimable: [], se, ciHalf, piHalf, issues: [...new Set([...issues, ...intervalIssues(model)])] };
  };
  return {
    xName: xPredictor.name,
    yName: yPredictor.name,
    resolvedHoldings,
    nonEstimable,
    intervalStatus: intervals,
    evaluate,
    value(x, y) {
      const node = evaluate(x, y);
      return node.value === null ? Number.NaN : node.value;
    },
    se(x, y) {
      return evaluate(x, y).se;
    },
    ciHalf(x, y) {
      return evaluate(x, y).ciHalf;
    },
    piHalf(x, y) {
      return evaluate(x, y).piHalf;
    },
    hasInterval: intervals.ci,
  };
}

/** Coded value of an axis position, whether the axis is shown coded or actual. */
export function axisDesignValue(predictor: ModelVariable, value: number, mode: InputMode): number {
  try {
    return toDesignValue(predictor, value, mode);
  } catch {
    return Number.NaN;
  }
}

/**
 * Are a model's variables still compatible with a worksheet?
 *
 * A predictor that lost its column, changed type or lost a level cannot be fed
 * from that sheet; the manager shows this instead of predicting from columns
 * that merely happen to sit in the same position.
 */
export interface CompatibilityReport {
  ok: boolean;
  problems: { variable: string; code: string; detail?: string }[];
}

export function checkCompatibility(model: StoredModel, columns: { id: string; name: string; type: string; values: (number | string | null)[] }[]): CompatibilityReport {
  const problems: CompatibilityReport['problems'] = [];
  const lookup = (variable: ModelVariable) => (variable.id ? columns.find((column) => column.id === variable.id) : undefined)
    ?? columns.find((column) => column.name === variable.name);
  [model.response, ...model.predictors].forEach((variable) => {
    const column = lookup(variable);
    if (!column) {
      problems.push({ variable: variable.name, code: 'model.compat.missing' });
      return;
    }
    if (variable.kind === 'numeric' && column.type === 'text') {
      problems.push({ variable: variable.name, code: 'model.compat.type', detail: column.name });
      return;
    }
    if (variable.kind === 'categorical') {
      const levels = new Set(column.values.filter((v) => v !== null && v !== undefined && v !== '').map((v) => String(v)));
      const missing = (variable.levels ?? []).filter((level) => !levels.has(level));
      if (missing.length) problems.push({ variable: variable.name, code: 'model.compat.levels', detail: missing.join(', ') });
    }
  });
  return { ok: problems.length === 0, problems };
}
