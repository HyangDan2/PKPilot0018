/* ─────────────────────────────────────────────────────────────────────────
   Statelia — overlaid contour and the joint feasible region (WO-04)

   Several fitted responses are evaluated on ONE factor grid, each with its own
   specification, and the points where every specification holds at once form
   the feasible region.

   Rules that shape the numbers this module reports:

   · One physical coordinate system. The grid is drawn in the display units of
     a named reference model, converted to actual (measured) units once, and
     each model then transforms that same physical value with ITS OWN coding
     (centre, half range, coded/actual). A model is never fed another model's
     coded values.
   · No silent substitution. An interval basis a model cannot answer is a
     structured error naming the model and the reason, never a quiet fall back
     to the mean. A non-finite weight, coefficient or covariance entry makes the
     point or the interval invalid instead of dropping a term.
   · The satisfied area is measured from the same marching-squares geometry the
     2-D contour draws, over the same grid, so "Feasible Area Ratio" and the
     tinted region cannot tell different stories. Convergence compares the
     answer with a DIFFERENT grid, and node convergence and area convergence are
     reported apart.
   · Extrapolation is judged for every model and every factor (both axes and
     the held values), against that model's own experimental bounds.
   ───────────────────────────────────────────────────────────────────────── */

import type { OverlaidResponseData } from '../types';
import type { FeasibleBasis } from './chartConfig';
import { bandPolygons, polygonArea } from './contour';
import {
  ModelInputError,
  axisActualValue,
  compileSurfaceEvaluator,
  designFromActual,
  intervalStatus,
  type CompiledSurfaceEvaluator,
  type InputMode,
} from './modelPredictor';
import type { ModelVariable, StoredModel } from './modelStore';
import { rangeSlack } from './factorDomain';

/** The colours responses take, in order; a design-system cycle, not a palette. */
export const OVERLAY_COLORS = ['#7c5cd6', '#1f8a70', '#c2410c', '#1d4ed8', '#a21caf', '#0f766e'];
export const OVERLAY_DASHES = ['', '6 3', '2 2', '9 3 3 3', '4 2', '1 3'];

/** The engine's own limits; the UI asks for less than this. */
export const MIN_GRID = 11;
export const MAX_GRID = 401;

export interface ResponseSpec {
  model: StoredModel;
  /** When present, the model it must belong to (guards a mis-zipped list). */
  modelId?: string;
  lsl: number | null;
  usl: number | null;
  target: number | null;
}

export interface OverlaidOptions {
  xName: string;
  yName: string;
  /** Held values for factors off both axes, in the display units of `mode`. */
  holdings?: Record<string, number | string>;
  xRange: [number, number];
  yRange: [number, number];
  resolution: number;
  mode?: InputMode;
  /** Model whose coding defines the display units (`mode`); models[0] by default. */
  referenceModelId?: string;
  basis?: FeasibleBasis;
  alpha?: number;
}

/** One factor of one model that lies outside that model's experimental range. */
export interface ExtrapolationDetail {
  model: string;
  factor: string;
  kind: 'axis' | 'holding';
  /** Actual-unit interval the axis was drawn over (axis) … */
  from?: number;
  to?: number;
  /** … or the actual value the factor was held at (holding). */
  value?: number;
  bound: { min: number; max: number };
}

/** How settled the grid answer is: two DIFFERENT grids, and their gap. */
export interface ConvergenceReport {
  /** |nodeRatio(grid) − nodeRatio(neighbour)|. */
  nodeDelta: number;
  /** |areaRatio(grid) − areaRatio(neighbour)|. */
  areaDelta: number;
  count: number;
  neighborCount: number;
  /** `refined` when the neighbour is finer, `coarsened` at Ultra (401 → 201). */
  direction: 'refined' | 'coarsened';
}

export interface OverlaidResult {
  xs: number[];
  ys: number[];
  responses: OverlaidResponseData[];
  /** 1 where every response satisfies its spec. */
  feasible: number[][];
  feasibleNodes: number;
  totalNodes: number;
  /** Share of grid nodes that are feasible (exact for this grid). */
  nodeRatio: number;
  /** Share of the region's area that is feasible, from the drawn geometry. */
  areaRatio: number;
  /** |nodeRatio(neighbour) − nodeRatio(grid)| — kept for existing callers. */
  convergenceDelta: number;
  convergence: ConvergenceReport;
  /** Responses whose model cannot answer a confidence interval at all. */
  intervalBlocked: string[];
  /** Why each of those models is blocked. */
  intervalBlockReasons: { model: string; reasons: string[] }[];
  /** True when some model × factor reaches beyond that model's runs. */
  extrapolated: boolean;
  extrapolation: { details: ExtrapolationDetail[] };
  /** Set when no node is feasible — a narrow region may have been missed. */
  narrowWarning: boolean;
}

/** A factor the selected models have in common, with its validation state. */
export interface CommonFactor {
  name: string;
  id: string;
  unit: string;
  /** Per-model predictor reference, so a unit conflict can name the model. */
  variables: { model: string; predictor: ModelVariable }[];
}

export interface CommonFactorReport {
  factors: CommonFactor[];
  /** Human-readable problems (unit or id conflicts) that excluded a factor. */
  problems: string[];
}

/**
 * Numeric factors every model shares.
 *
 * Two models can both have a column called "Temperature" and still mean
 * different things: one in °C and one in °F, or two different worksheet
 * columns. Such a factor is reported as a problem and left out, because a
 * comparison drawn over mismatched units would be a picture of nothing.
 */
export function commonNumericFactors(models: StoredModel[]): CommonFactorReport {
  const problems: string[] = [];
  if (models.length < 2) return { factors: [], problems };
  const first = models[0];
  const factors: CommonFactor[] = [];
  first.predictors.filter((predictor) => predictor.kind === 'numeric').forEach((candidate) => {
    const variables: { model: string; predictor: ModelVariable }[] = [{ model: first.name, predictor: candidate }];
    for (let i = 1; i < models.length; i += 1) {
      const other = models[i].predictors.find((predictor) => predictor.kind === 'numeric' && predictor.name === candidate.name);
      if (!other) return;
      variables.push({ model: models[i].name, predictor: other });
    }
    if (variables.length !== models.length) return;
    const ids = variables.map((entry) => entry.predictor.id).filter(Boolean);
    if (new Set(ids).size > 1) {
      problems.push(`${candidate.name}: ${variables.map((entry) => `${entry.model} → ${entry.predictor.id || '—'}`).join(', ')}`);
      return;
    }
    const units = variables.map((entry) => (entry.predictor.unit ?? '').trim());
    if (new Set(units).size > 1) {
      problems.push(`${candidate.name}: ${variables.map((entry) => `${entry.model} → ${entry.predictor.unit || '—'}`).join(', ')}`);
      return;
    }
    factors.push({ name: candidate.name, id: ids[0] ?? '', unit: units[0] ?? '', variables });
  });
  return { factors, problems };
}

/** True when every model can state a confidence interval at all. */
export function intervalAvailability(models: StoredModel[]): {
  ok: boolean;
  blocked: string[];
  details?: { model: string; reasons: string[] }[];
} {
  const details = models
    .map((model) => ({ model: model.name, reasons: intervalStatus(model).ci ? [] : intervalStatus(model).reasons }))
    .filter((entry) => entry.reasons.length > 0);
  return {
    ok: details.length === 0,
    blocked: details.map((entry) => entry.model),
    ...(details.length ? { details } : {}),
  };
}

/** Which models can answer one basis, and why they cannot. */
export function basisAvailability(models: StoredModel[], basis: FeasibleBasis): {
  ok: boolean;
  blocked: { model: string; reasons: string[] }[];
} {
  if (basis === 'mean') return { ok: true, blocked: [] };
  const blocked = models
    .map((model) => {
      const status = intervalStatus(model);
      const available = basis === 'confidence' ? status.ci : status.pi;
      const reasons = available ? [] : status.reasons;
      return { model: model.name, reasons };
    })
    .filter((entry) => entry.reasons.length > 0);
  return { ok: blocked.length === 0, blocked };
}

/* ── input validation (F-08) ─────────────────────────────────────────── */

export interface ValidationProblem {
  code: string;
  detail?: Record<string, unknown>;
}

function fail(problems: ValidationProblem[]): void {
  if (!problems.length) return;
  throw new ModelInputError(problems[0].code, {
    problems,
    ...(problems[0].detail ?? {}),
  });
}

function numericPredictorOrNull(model: StoredModel, name: string): ModelVariable | null {
  return model.predictors.find((predictor) => predictor.name === name || (predictor.id && predictor.id === name)) ?? null;
}

function isFiniteRange(range: unknown): range is [number, number] {
  return Array.isArray(range) && range.length === 2
    && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] < range[1];
}

/**
 * Everything the engine refuses to guess.
 *
 * Returned as a list so a caller (and the QA) can see all of it; `buildOverlaid`
 * raises the first code with the whole list in its detail.
 */
export function validateOverlaidInput(models: StoredModel[], specs: ResponseSpec[], options: OverlaidOptions): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  if (!Array.isArray(models) || models.length < 2) problems.push({ code: 'feasible.minModels', detail: { models: models?.length ?? 0 } });
  if (!Array.isArray(specs) || specs.length !== models.length) {
    problems.push({ code: 'feasible.specMismatch', detail: { models: models.length, specs: specs?.length ?? 0 } });
  } else {
    specs.forEach((spec, index) => {
      if (!spec || spec.model !== models[index]) {
        if (!spec || spec.modelId !== models[index].id) {
          problems.push({ code: 'feasible.specMismatch', detail: { index, model: models[index]?.name } });
        }
      }
    });
  }
  const ids = models.map((model) => model.id);
  if (new Set(ids).size !== ids.length) problems.push({ code: 'feasible.model.duplicate', detail: { ids } });
  const responses = models.map((model) => model.response.name);
  if (new Set(responses).size !== responses.length) problems.push({ code: 'feasible.response.duplicate', detail: { responses } });

  if (options.xName === options.yName) problems.push({ code: 'feasible.factor.axis.duplicate', detail: { factor: options.xName } });

  const shared = models.length >= 2 ? commonNumericFactors(models) : { factors: [], problems: [] };
  const axisNames = [options.xName, options.yName];
  axisNames.forEach((name) => {
    const missingIn = models.filter((model) => {
      const predictor = numericPredictorOrNull(model, name);
      return !predictor || predictor.kind !== 'numeric';
    });
    if (missingIn.length) {
      problems.push({ code: 'feasible.factor.missing', detail: { factor: name, models: missingIn.map((model) => model.name) } });
      return;
    }
    if (!shared.factors.some((factor) => factor.name === name)) {
      const conflict = shared.problems.find((problem) => problem.startsWith(`${name}:`));
      problems.push(conflict
        ? { code: 'feasible.factor.conflict', detail: { factor: name, conflict } }
        : { code: 'feasible.factor.missing', detail: { factor: name } });
    }
  });

  if (!isFiniteRange(options.xRange)) problems.push({ code: 'feasible.range.invalid', detail: { axis: 'x', range: options.xRange } });
  if (!isFiniteRange(options.yRange)) problems.push({ code: 'feasible.range.invalid', detail: { axis: 'y', range: options.yRange } });

  const resolution = options.resolution;
  if (!(typeof resolution === 'number' && Number.isInteger(resolution) && resolution >= MIN_GRID && resolution <= MAX_GRID)) {
    problems.push({ code: 'feasible.resolution.invalid', detail: { resolution, allowed: [MIN_GRID, MAX_GRID] } });
  }

  specs.forEach((spec, index) => {
    if (!spec) return;
    const named = models[index]?.name ?? `#${index}`;
    const limits = [spec.lsl, spec.usl, spec.target];
    if (limits.some((value) => value != null && !Number.isFinite(value))) {
      problems.push({ code: 'feasible.spec.invalid', detail: { model: named, reason: 'nonFinite' } });
      return;
    }
    if (spec.lsl != null && spec.usl != null && spec.lsl > spec.usl) {
      problems.push({ code: 'feasible.spec.invalid', detail: { model: named, reason: 'lslAboveUsl', lsl: spec.lsl, usl: spec.usl } });
    }
  });

  const holdings = options.holdings ?? {};
  Object.entries(holdings).forEach(([name, value]) => {
    models.forEach((model) => {
      const predictor = model.predictors.find((entry) => entry.name === name);
      if (!predictor) return;
      if (predictor.kind === 'categorical') {
        const levels = predictor.levels ?? [];
        if (levels.length && !levels.includes(String(value))) {
          problems.push({ code: 'feasible.holding.invalid', detail: { model: model.name, factor: name, value, levels } });
        }
        return;
      }
      if (!Number.isFinite(typeof value === 'number' ? value : Number(value))) {
        problems.push({ code: 'feasible.holding.invalid', detail: { model: model.name, factor: name, value, reason: 'nonFinite' } });
      }
    });
  });

  const basis = options.basis ?? 'mean';
  if (basis !== 'mean' && basis !== 'confidence' && basis !== 'prediction') {
    problems.push({ code: 'feasible.basis.invalid', detail: { basis } });
  }
  const mode = options.mode ?? 'actual';
  if (mode !== 'actual' && mode !== 'coded') problems.push({ code: 'feasible.mode.invalid', detail: { mode } });
  const alpha = options.alpha ?? 0.05;
  if (!(typeof alpha === 'number' && Number.isFinite(alpha) && alpha > 0 && alpha < 1)) {
    problems.push({ code: 'feasible.alpha.invalid', detail: { alpha } });
  }
  if (options.referenceModelId && !models.some((model) => model.id === options.referenceModelId)) {
    problems.push({ code: 'feasible.reference.missing', detail: { modelId: options.referenceModelId } });
  }
  return problems;
}

/* ── geometry helpers ────────────────────────────────────────────────── */

/** The area a 0/1 mask covers, from the same band geometry the plot fills. */
export function maskAreaRatio(xs: number[], ys: number[], mask: number[][]): number {
  if (xs.length < 2 || ys.length < 2) return 0;
  const width = Math.abs(xs[xs.length - 1] - xs[0]);
  const height = Math.abs(ys[ys.length - 1] - ys[0]);
  if (!(width > 0) || !(height > 0)) return 0;
  const bands = bandPolygons({ xs, ys, z: mask }, [0.5, 1.5]);
  const area = (bands[0]?.polygons ?? []).reduce((sum, polygon) => sum + polygonArea(polygon), 0);
  return Math.min(1, area / (width * height));
}

interface GridEntry {
  evaluator: CompiledSurfaceEvaluator;
  spec: ResponseSpec;
  /** Design-space coordinates of the shared physical grid, per node index. */
  xDesign: number[];
  yDesign: number[];
}

interface GridComputation {
  xs: number[];
  ys: number[];
  masks: number[][][];
  values: number[][][] | null;
  feasible: number[][];
  feasibleNodes: number;
  nodeRatio: number;
  areaRatio: number;
  nonEstimable: string[][];
}

function computeGrid(
  entries: GridEntry[],
  xs: number[],
  ys: number[],
  basis: FeasibleBasis,
  storeValues: boolean,
): GridComputation {
  const count = xs.length;
  const masks: number[][][] = entries.map(() => []);
  const values: number[][][] | null = storeValues ? entries.map(() => []) : null;
  const nonEstimable: Set<string>[] = entries.map(() => new Set<string>());
  const feasible: number[][] = [];
  let feasibleNodes = 0;
  for (let j = 0; j < count; j += 1) {
    entries.forEach((entry, index) => {
      const maskRow: number[] = [];
      const valueRow: number[] | null = storeValues ? [] : null;
      for (let i = 0; i < count; i += 1) {
        const node = entry.evaluator.evaluate(entry.xDesign[i], entry.yDesign[j], basis !== 'mean');
        node.nonEstimable.forEach((label) => nonEstimable[index].add(label));
        let ok = false;
        if (node.value !== null) {
          let lo = node.value;
          let hi = node.value;
          if (basis !== 'mean') {
            const half = basis === 'confidence' ? node.ciHalf : node.piHalf;
            if (half != null) {
              lo = node.value - half;
              hi = node.value + half;
              ok = true;
            }
          } else {
            ok = true;
          }
          if (ok && entry.spec.lsl != null && lo < entry.spec.lsl) ok = false;
          if (ok && entry.spec.usl != null && hi > entry.spec.usl) ok = false;
        }
        maskRow.push(ok ? 1 : 0);
        if (valueRow) valueRow.push(node.value === null ? Number.NaN : node.value);
      }
      masks[index].push(maskRow);
      if (values && valueRow) values[index].push(valueRow);
    });
    const rowFeasible: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const ok = masks.every((mask) => mask[j][i] === 1);
      rowFeasible.push(ok ? 1 : 0);
      if (ok) feasibleNodes += 1;
    }
    feasible.push(rowFeasible);
  }
  return {
    xs,
    ys,
    masks,
    values,
    feasible,
    feasibleNodes,
    nodeRatio: feasibleNodes / (count * count),
    areaRatio: maskAreaRatio(xs, ys, feasible),
    nonEstimable: nonEstimable.map((set) => [...set].sort()),
  };
}

/** Response statistics for the legend (min/max of the finite predictions). */
function extentOfGrid(z: number[][]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const row of z) {
    for (const value of row) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

function linspace(range: [number, number], count: number): number[] {
  return Array.from({ length: count }, (_, i) => range[0] + ((range[1] - range[0]) * i) / (count - 1));
}

/* ── the overlay ─────────────────────────────────────────────────────── */

/**
 * Build the overlaid contour: every response on one grid, the joint feasible
 * region, and the area ratios with their convergence statement.
 */
export function buildOverlaid(models: StoredModel[], specs: ResponseSpec[], options: OverlaidOptions): OverlaidResult {
  fail(validateOverlaidInput(models, specs, options));
  const basis = options.basis ?? 'mean';
  const mode = options.mode ?? 'actual';
  const alpha = options.alpha ?? 0.05;
  const reference = (options.referenceModelId && models.find((model) => model.id === options.referenceModelId)) || models[0];
  const xRef = numericPredictorOrNull(reference, options.xName) as ModelVariable;
  const yRef = numericPredictorOrNull(reference, options.yName) as ModelVariable;
  if (!xRef || !yRef) throw new ModelInputError('feasible.factor.missing', { factor: !xRef ? options.xName : options.yName });
  if (basis !== 'mean') {
    const availability = basisAvailability(models, basis);
    if (!availability.ok) throw new ModelInputError('feasible.basisUnsupported', { basis, blocked: availability.blocked });
  }

  const count = Math.round(options.resolution);
  const holdingActual = (name: string, value: number): number => {
    const ref = numericPredictorOrNull(reference, name);
    if (mode === 'actual' || !ref?.coding) return value;
    return axisActualValue(ref, value, 'coded');
  };
  // The display grid and every model's design coordinates for it. Rebuilt for
  // each resolution: a design array belongs to the grid that produced it.
  const entriesFor = (rangeX: [number, number], rangeY: [number, number], size: number) => {
    const xs = linspace(rangeX, size);
    const ys = linspace(rangeY, size);
    const xActual = xs.map((value) => axisActualValue(xRef, value, mode));
    const yActual = ys.map((value) => axisActualValue(yRef, value, mode));
    const entries: GridEntry[] = models.map((model, index) => {
      const xPredictor = numericPredictorOrNull(model, options.xName) as ModelVariable;
      const yPredictor = numericPredictorOrNull(model, options.yName) as ModelVariable;
      const holdings: Record<string, number | string> = {};
      model.predictors.forEach((predictor) => {
        if (predictor.name === xPredictor.name || predictor.name === yPredictor.name) return;
        const given = options.holdings?.[predictor.name];
        if (predictor.kind === 'categorical') {
          holdings[predictor.name] = given === undefined || given === null ? (predictor.levels?.[0] ?? '') : String(given);
          return;
        }
        // Held values arrive in display units; each model is fed actual units
        // and applies its own coding, so the physical point is shared.
        holdings[predictor.name] = given === undefined || given === null
          ? (predictor.coding?.center ?? 0)
          : holdingActual(predictor.name, Number(given));
      });
      const evaluator = compileSurfaceEvaluator(model, {
        xName: xPredictor.name,
        yName: yPredictor.name,
        holdings,
        mode: 'actual',
        alpha,
      });
      return {
        evaluator,
        spec: specs[index],
        xDesign: xActual.map((value) => designFromActual(xPredictor, value)),
        yDesign: yActual.map((value) => designFromActual(yPredictor, value)),
      };
    });
    return { xs, ys, xActual, yActual, entries };
  };
  const mainGrid = entriesFor(options.xRange, options.yRange, count);
  const xs = mainGrid.xs;
  const ys = mainGrid.ys;
  const entries = mainGrid.entries;
  const grid = computeGrid(entries, xs, ys, basis, true);
  const neighborCount = count >= MAX_GRID ? Math.max(MIN_GRID, Math.round(count / 2)) : Math.min(MAX_GRID, count * 2);
  const neighborGrid = entriesFor(options.xRange, options.yRange, neighborCount);
  const neighbor = computeGrid(neighborGrid.entries, neighborGrid.xs, neighborGrid.ys, basis, false);
  const direction: ConvergenceReport['direction'] = neighborCount < count ? 'coarsened' : 'refined';

  const responses: OverlaidResponseData[] = entries.map((entry, index) => {
    const z = (grid.values as number[][][])[index];
    const mask = grid.masks[index];
    const extent = extentOfGrid(z);
    return {
      name: entry.spec.model.response.name,
      lsl: entry.spec.lsl,
      usl: entry.spec.usl,
      target: entry.spec.target,
      color: OVERLAY_COLORS[index % OVERLAY_COLORS.length],
      dash: OVERLAY_DASHES[index % OVERLAY_DASHES.length],
      z,
      mask,
      areaRatio: maskAreaRatio(grid.xs, grid.ys, mask),
      nodeRatio: mask.flat().reduce((sum, value) => sum + value, 0) / (mask.length * mask[0].length),
      zMin: extent.min,
      zMax: extent.max,
      ...(grid.nonEstimable[index].length ? { nonEstimable: grid.nonEstimable[index] } : {}),
    };
  });

  const availability = intervalAvailability(models);
  const extrapolation = extrapolationOf(models, options, mainGrid.xActual, mainGrid.yActual, holdingActual);
  const totalNodes = grid.xs.length * grid.ys.length;

  return {
    xs: grid.xs,
    ys: grid.ys,
    responses,
    feasible: grid.feasible,
    feasibleNodes: grid.feasibleNodes,
    totalNodes,
    nodeRatio: grid.feasibleNodes / totalNodes,
    areaRatio: grid.areaRatio,
    convergenceDelta: Math.abs(neighbor.nodeRatio - grid.nodeRatio),
    convergence: {
      nodeDelta: Math.abs(neighbor.nodeRatio - grid.nodeRatio),
      areaDelta: Math.abs(neighbor.areaRatio - grid.areaRatio),
      count,
      neighborCount,
      direction,
    },
    intervalBlocked: availability.blocked,
    intervalBlockReasons: availability.details ?? [],
    extrapolated: extrapolation.details.length > 0,
    extrapolation,
    narrowWarning: grid.feasibleNodes === 0,
  };
}

/** Every model × every factor outside that model's own experimental range. */
function extrapolationOf(
  models: StoredModel[],
  options: OverlaidOptions,
  xActual: number[],
  yActual: number[],
  holdingActual: (name: string, value: number) => number,
): { details: ExtrapolationDetail[] } {
  const details: ExtrapolationDetail[] = [];
  // The allowance is the doubles' own rounding at this magnitude plus a tiny
  // share of the range's width — never a share of the offset (F-REL-04). A
  // narrow range at 1e8 must still flag an axis drawn 0.05 beyond it.
  const outside = (bound: { min: number; max: number } | undefined, lo: number, hi: number): boolean => {
    if (!bound || !Number.isFinite(bound.min) || !Number.isFinite(bound.max)) return false;
    const slack = rangeSlack(bound.min, bound.max, Math.max(Math.abs(lo), Math.abs(hi)));
    return lo < bound.min - slack || hi > bound.max + slack;
  };
  const xLo = Math.min(xActual[0], xActual[xActual.length - 1]);
  const xHi = Math.max(xActual[0], xActual[xActual.length - 1]);
  const yLo = Math.min(yActual[0], yActual[yActual.length - 1]);
  const yHi = Math.max(yActual[0], yActual[yActual.length - 1]);
  models.forEach((model) => {
    const xBound = model.factorBounds?.[options.xName];
    const yBound = model.factorBounds?.[options.yName];
    if (xBound && outside(xBound, xLo, xHi)) {
      details.push({ model: model.name, factor: options.xName, kind: 'axis', from: xLo, to: xHi, bound: { ...xBound } });
    }
    if (yBound && outside(yBound, yLo, yHi)) {
      details.push({ model: model.name, factor: options.yName, kind: 'axis', from: yLo, to: yHi, bound: { ...yBound } });
    }
    model.predictors.forEach((predictor) => {
      if (predictor.kind !== 'numeric') return;
      if (predictor.name === options.xName || predictor.name === options.yName) return;
      const bound = model.factorBounds?.[predictor.name];
      if (!bound) return;
      const given = options.holdings?.[predictor.name];
      const value = given === undefined || given === null ? (predictor.coding?.center ?? 0) : holdingActual(predictor.name, Number(given));
      if (outside(bound, value, value)) {
        details.push({ model: model.name, factor: predictor.name, kind: 'holding', value, bound: { ...bound } });
      }
    });
  });
  return { details };
}

/**
 * The display range shared by every model: the intersection of their
 * experimental bounds. An empty intersection keeps the first model's range and
 * says so, instead of drawing a region no model was fitted for.
 */
export function sharedDisplayRange(
  models: StoredModel[],
  name: string,
  mode: InputMode,
): { range: [number, number] | null; warning?: string } {
  const bounds = models
    .map((model) => model.factorBounds?.[name])
    .filter((bound): bound is { min: number; max: number } => Boolean(bound) && Number.isFinite(bound?.min) && Number.isFinite(bound?.max));
  if (!bounds.length || bounds.length !== models.length) return { range: null };
  const lo = Math.max(...bounds.map((bound) => bound.min));
  const hi = Math.min(...bounds.map((bound) => bound.max));
  if (!(lo < hi)) return { range: null, warning: `feasible.range.noIntersection:${name}` };
  const reference = models[0];
  const predictor = reference.predictors.find((entry) => entry.name === name);
  if (!predictor) return { range: [lo, hi] };
  const toDisplay = (value: number) => {
    if (mode === 'actual') return value;
    const coding = predictor.coding;
    if (!coding || !Number.isFinite(coding.center) || !Number.isFinite(coding.halfRange) || coding.halfRange === 0) return value;
    return (value - coding.center) / coding.halfRange;
  };
  return { range: [toDisplay(lo), toDisplay(hi)] };
}
