/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — overlaid contour and the joint feasible region (WO-04)

   Several fitted responses are evaluated on ONE factor grid, each with its own
   specification, and the points where every specification holds at once form
   the feasible region.

   Three rules shape the numbers this module reports:

   · The satisfied area is measured from the same marching-squares geometry the
     2-D contour draws, over the same grid, so "Feasible Area Ratio" and the
     tinted region on the plot cannot tell different stories. The value is a
     GRID APPROXIMATION — `convergenceDelta` states how much it moves when the
     grid is refined, and the UI says so.
   · A response whose model carries no covariance cannot answer an interval
     basis. That response is named in `intervalBlocked` and the option is
     disabled in the UI instead of being silently calculated from the mean.
   · Factors must be comparable: the same predictor name, the same column id and
     the same unit. A unit mismatch is reported, never papered over.
   ───────────────────────────────────────────────────────────────────────── */

import type { OverlaidResponseData } from '../types';
import type { FeasibleBasis } from './chartConfig';
import { bandPolygons, polygonArea } from './contour';
import {
  compileSurfaceEvaluator,
  toDesignValue,
  type CompiledSurfaceEvaluator,
  type InputMode,
} from './modelPredictor';
import type { ModelVariable, StoredModel } from './modelStore';

/** The colours responses take, in order; a design-system cycle, not a palette. */
export const OVERLAY_COLORS = ['#7c5cd6', '#1f8a70', '#c2410c', '#1d4ed8', '#a21caf', '#0f766e'];
export const OVERLAY_DASHES = ['', '6 3', '2 2', '9 3 3 3', '4 2', '1 3'];

export interface ResponseSpec {
  model: StoredModel;
  lsl: number | null;
  usl: number | null;
  target: number | null;
}

export interface OverlaidOptions {
  xName: string;
  yName: string;
  holdings?: Record<string, number | string>;
  xRange: [number, number];
  yRange: [number, number];
  resolution: number;
  mode?: InputMode;
  basis?: FeasibleBasis;
  alpha?: number;
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
  /** |nodeRatio(2× grid) − nodeRatio(grid)|: how settled the answer is. */
  convergenceDelta: number;
  /** Responses whose model cannot answer the interval basis at all. */
  intervalBlocked: string[];
  /** True when at least one axis span reaches beyond the fitted region. */
  extrapolated: boolean;
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

/** True when every model can state an interval at all. */
export function intervalAvailability(models: StoredModel[]): { ok: boolean; blocked: string[] } {
  const blocked = models
    .filter((model) => !model.covariance || !model.residual?.df || model.residual.df <= 0)
    .map((model) => model.name);
  return { ok: blocked.length === 0, blocked };
}

function numericPredictor(model: StoredModel, name: string): ModelVariable {
  const predictor = model.predictors.find((entry) => entry.name === name || (entry.id && entry.id === name));
  if (!predictor) throw new Error('model.structure.surface');
  if (predictor.kind !== 'numeric') throw new Error('model.surface.numericOnly');
  return predictor;
}

/** Node-by-node satisfaction for one response, on a grid of design values. */
function satisfyAt(
  evaluator: CompiledSurfaceEvaluator,
  xCoded: number,
  yCoded: number,
  spec: ResponseSpec,
  basis: FeasibleBasis,
): boolean {
  const value = evaluator.value(xCoded, yCoded);
  if (!Number.isFinite(value)) return false;
  let lo = value;
  let hi = value;
  if (basis !== 'mean') {
    const half = basis === 'confidence' ? evaluator.ciHalf(xCoded, yCoded) : evaluator.piHalf(xCoded, yCoded);
    if (half == null) return false;
    lo = value - half;
    hi = value + half;
  }
  if (spec.lsl != null && lo < spec.lsl) return false;
  if (spec.usl != null && hi > spec.usl) return false;
  return true;
}

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

interface GridComputation {
  xs: number[];
  ys: number[];
  masks: number[][][];
  values: number[][][];
  feasible: number[][];
  feasibleNodes: number;
  nodeRatio: number;
}

function computeGrid(
  evaluators: { evaluator: CompiledSurfaceEvaluator; spec: ResponseSpec }[],
  xAxis: { predictor: ModelVariable; range: [number, number] },
  yAxis: { predictor: ModelVariable; range: [number, number] },
  resolution: number,
  mode: InputMode,
  basis: FeasibleBasis,
): GridComputation {
  const count = Math.max(11, Math.min(401, Math.round(resolution)));
  const xs = Array.from({ length: count }, (_, i) => xAxis.range[0] + ((xAxis.range[1] - xAxis.range[0]) * i) / (count - 1));
  const ys = Array.from({ length: count }, (_, i) => yAxis.range[0] + ((yAxis.range[1] - yAxis.range[0]) * i) / (count - 1));
  const xCoded = xs.map((value) => toDesignValue(xAxis.predictor, value, mode));
  const yCoded = ys.map((value) => toDesignValue(yAxis.predictor, value, mode));
  const masks: number[][][] = evaluators.map(() => []);
  const values: number[][][] = evaluators.map(() => []);
  const feasible: number[][] = [];
  let feasibleNodes = 0;
  for (let j = 0; j < count; j += 1) {
    const rowFeasible: number[] = [];
    evaluators.forEach((entry, index) => {
      const maskRow: number[] = [];
      const valueRow: number[] = [];
      for (let i = 0; i < count; i += 1) {
        valueRow.push(entry.evaluator.value(xCoded[i], yCoded[j]));
        maskRow.push(satisfyAt(entry.evaluator, xCoded[i], yCoded[j], entry.spec, basis) ? 1 : 0);
      }
      masks[index].push(maskRow);
      values[index].push(valueRow);
    });
    for (let i = 0; i < count; i += 1) {
      const ok = evaluators.every((_, index) => masks[index][j][i] === 1);
      rowFeasible.push(ok ? 1 : 0);
      if (ok) feasibleNodes += 1;
    }
    feasible.push(rowFeasible);
  }
  return { xs, ys, masks, values, feasible, feasibleNodes, nodeRatio: feasibleNodes / (count * count) };
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

/**
 * Build the overlaid contour: every response on one grid, the joint feasible
 * region, and the area ratios with their convergence statement.
 */
export function buildOverlaid(models: StoredModel[], specs: ResponseSpec[], options: OverlaidOptions): OverlaidResult {
  if (models.length !== specs.length) throw new Error('feasible.mismatch');
  const basis = options.basis ?? 'mean';
  const mode = options.mode ?? 'actual';
  const alpha = options.alpha ?? 0.05;
  const xAxis = { predictor: numericPredictor(models[0], options.xName), range: options.xRange };
  const yAxis = { predictor: numericPredictor(models[0], options.yName), range: options.yRange };
  const evaluators = models.map((model, index) => ({
    model,
    spec: specs[index],
    evaluator: compileSurfaceEvaluator(model, {
      xName: options.xName,
      yName: options.yName,
      holdings: options.holdings,
      mode,
      alpha,
    }),
  }));
  const interval = intervalAvailability(models);
  const effectiveBasis: FeasibleBasis = basis !== 'mean' && !interval.ok ? 'mean' : basis;
  const grid = computeGrid(
    evaluators.map((entry) => ({ evaluator: entry.evaluator, spec: entry.spec })),
    xAxis,
    yAxis,
    options.resolution,
    mode,
    effectiveBasis,
  );
  const responses: OverlaidResponseData[] = evaluators.map((entry, index) => {
    const z = grid.values[index];
    const mask = grid.masks[index];
    const extent = extentOfGrid(z);
    return {
      name: entry.model.response.name,
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
      ...(entry.evaluator.nonEstimable.length ? { nonEstimable: [...entry.evaluator.nonEstimable] } : {}),
    };
  });
  // Convergence: the same judgement on a grid twice as fine (capped at Ultra).
  const fineResolution = Math.min(401, Math.max(21, Math.round(options.resolution) * 2));
  const fine = computeGrid(
    evaluators.map((entry) => ({ evaluator: entry.evaluator, spec: entry.spec })),
    xAxis,
    yAxis,
    fineResolution,
    mode,
    effectiveBasis,
  );
  // Outside the fitted region is a warning, not a correction: the overlay may
  // legitimately be explored there, but the figure must say so.
  const boundX = models[0].factorBounds?.[xAxis.predictor.name];
  const boundY = models[0].factorBounds?.[yAxis.predictor.name];
  const outside = (range: [number, number], bound: { min: number; max: number } | undefined) => Boolean(
    bound && (Math.min(range[0], range[1]) < bound.min - 1e-9 || Math.max(range[0], range[1]) > bound.max + 1e-9),
  );
  const feasibleNodes = grid.feasibleNodes;
  const totalNodes = grid.xs.length * grid.ys.length;
  return {
    xs: grid.xs,
    ys: grid.ys,
    responses,
    feasible: grid.feasible,
    feasibleNodes,
    totalNodes,
    nodeRatio: feasibleNodes / totalNodes,
    areaRatio: maskAreaRatio(grid.xs, grid.ys, grid.feasible),
    convergenceDelta: Math.abs(fine.nodeRatio - grid.nodeRatio),
    intervalBlocked: interval.blocked,
    extrapolated: outside(options.xRange, boundX) || outside(options.yRange, boundY),
    narrowWarning: feasibleNodes === 0,
  };
}
