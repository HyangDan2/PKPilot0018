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

export type InputMode = 'actual' | 'coded';

/** A point the reader supplies: predictor name (or id) → value. */
export type PredictionPoint = Record<string, number | string | null>;

export interface PredictionResult {
  /** ŷ, or null when it cannot be estimated. */
  value: number | null;
  /** Standard error of the fitted mean, when the model carries a covariance. */
  se: number | null;
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

/** The coded/actual conversion for one numeric predictor. */
export function toDesignValue(predictor: ModelVariable, value: number, mode: InputMode): number {
  const coding = predictor.coding;
  if (!coding) return value;
  if (coding.mode === 'coded') {
    // Coefficients read coded units.
    if (mode === 'coded') return value;
    if (!coding.halfRange) throw new ModelInputError('model.coding', { variable: predictor.name });
    return (value - coding.center) / coding.halfRange;
  }
  // Coefficients read the measured value.
  if (mode === 'actual') return value;
  return coding.center + coding.halfRange * value;
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
  let design: DesignRow;
  try {
    design = designRow(model, point, options.mode ?? 'actual');
  } catch (error) {
    if (error instanceof ModelInputError) return { value: null, se: null, pi: null, nonEstimable: [], issues: [error.code] };
    return { value: null, se: null, pi: null, nonEstimable: [], issues: ['model.predictFailed'] };
  }
  const nonEstimable: string[] = [];
  let fit = 0;
  model.coefficients.forEach((coefficient, index) => {
    const weight = design.values[index];
    if (!Number.isFinite(weight) || weight === 0) return;
    if (!coefficient.estimable || !Number.isFinite(coefficient.value)) {
      nonEstimable.push(coefficient.label);
      return;
    }
    fit += weight * coefficient.value;
  });
  if (nonEstimable.length) {
    return { value: null, se: null, pi: null, nonEstimable, issues };
  }
  let se: number | null = null;
  let pi: [number, number] | null = null;
  const covariance = model.covariance;
  const df = model.residual?.df;
  if (covariance && covariance.length === model.coefficients.length && df && df > 0) {
    let variance = 0;
    for (let i = 0; i < design.values.length; i += 1) {
      for (let j = 0; j < design.values.length; j += 1) {
        const entry = covariance[i]?.[j];
        if (!Number.isFinite(entry)) continue;
        variance += design.values[i] * design.values[j] * (entry as number);
      }
    }
    if (variance >= 0 && Number.isFinite(variance)) {
      se = Math.sqrt(variance);
      const alpha = Math.min(0.999, Math.max(1e-6, options.alpha ?? 0.05));
      const mse = model.residual?.mse ?? 0;
      const t = tInv(1 - alpha / 2, df);
      const half = t * Math.sqrt(variance + Math.max(0, mse));
      if (Number.isFinite(half)) pi = [fit - half, fit + half];
    }
  }
  return { value: fit, se, pi, nonEstimable, issues };
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

function displayRange(model: StoredModel, predictor: ModelVariable, mode: InputMode): [number, number] {
  const bound = model.factorBounds?.[predictor.name];
  const coding = predictor.coding;
  if (!bound) {
    if (coding) return mode === coding.mode ? [coding.center - coding.halfRange, coding.center + coding.halfRange] : [-1, 1];
    return [-1, 1];
  }
  if (mode === 'actual') {
    return coding?.mode === 'coded' ? [
      coding.center + coding.halfRange * bound.min,
      coding.center + coding.halfRange * bound.max,
    ] : [bound.min, bound.max];
  }
  // Coded display: normalise whatever the bounds are in.
  if (!coding) return [bound.min, bound.max];
  if (coding.mode === 'coded') return [bound.min, bound.max];
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
  const xRange = options.xRange ?? displayRange(model, xPredictor, mode);
  const yRange = options.yRange ?? displayRange(model, yPredictor, mode);
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
  const outOfRange = Boolean(
    (boundX && (xRange[0] < boundX.min - 1e-9 || xRange[1] > boundX.max + 1e-9))
    || (boundY && (yRange[0] < boundY.min - 1e-9 || yRange[1] > boundY.max + 1e-9)),
  );
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
