/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — chart configuration operations (WO-02 / WO-09)

   The properties drawer edits a full `ChartConfig`. These helpers are pure so
   the drawer, the context menu and the tests all change a chart the same way:
   a style pack copied from one chart, a config history for undo/redo, and the
   RSM re-slice that redraws a contour from the fitted model without re-running
   any statistics.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec } from '../types';
import type { ChartConfig, ContourConfig, RsmViewConfig } from './chartConfig';
import { defaultChartConfig, mergeChartConfig } from './chartConfig';
import { resolutionPoints } from './contour';
import { rsmPredictSurface, type RsmModelPayload, type RsmSurface } from './doe';
import { ModelInputError, axisActualValue, axisDesignValue, compileSurfaceEvaluator, factorDisplayRange, toActualValue, type InputMode } from './modelPredictor';
import type { StoredModel } from './modelStore';
import { buildOverlaid, commonNumericFactors, sharedDisplayRange, OVERLAY_COLORS, OVERLAY_DASHES, type OverlaidResult } from './feasible';
import { surfaceResolutionPoints } from './surface3d';

/** A fully populated config for a chart (an old chart's sparse config included). */
export function fullChartConfig(chart: ChartSpec): ChartConfig {
  return mergeChartConfig(chart.config, undefined);
}

/** Replace a chart's config, keeping the chart data untouched. */
export function withChartConfig<T extends ChartSpec>(chart: T, config: ChartConfig): T {
  return { ...chart, config };
}

/** The style-only blocks that travel between charts. */
export interface ChartStylePack {
  appearance: Pick<
    NonNullable<ChartConfig['appearance']>,
    'preset' | 'chartBg' | 'plotBg' | 'fontFamily' | 'fontSize' | 'axisColor' | 'tickColor' | 'labelColor' | 'gridColor' | 'borderWidth'
  >;
  series?: ChartConfig['series'];
  grid?: ChartConfig['grid'];
  legend?: ChartConfig['legend'];
  /** Colour, colourbar and line look; levels stay with the chart's own data. */
  contour?: Pick<
    ContourConfig,
    'colormap' | 'colorbarMode' | 'colorbarPosition' | 'colorbarTitle' | 'colorbarUnit' | 'showContourLabels' | 'lineWidth' | 'lineColor'
  >;
}

/** Take the style of a chart, leaving its title, size and statistics behind. */
export function packChartStyle(chart: ChartSpec): ChartStylePack {
  const cfg = fullChartConfig(chart);
  const a = cfg.appearance ?? {};
  const c = cfg.contour ?? {};
  return {
    appearance: {
      preset: a.preset ?? 'engineering',
      chartBg: a.chartBg ?? 'transparent',
      plotBg: a.plotBg ?? 'transparent',
      fontFamily: a.fontFamily ?? '',
      fontSize: a.fontSize ?? 10.5,
      axisColor: a.axisColor ?? '',
      tickColor: a.tickColor ?? '',
      labelColor: a.labelColor ?? '',
      gridColor: a.gridColor ?? '',
      borderWidth: a.borderWidth ?? 1,
    },
    series: { ...(cfg.series ?? {}) },
    grid: { ...(cfg.grid ?? {}) },
    legend: { ...(cfg.legend ?? {}) },
    contour: {
      colormap: c.colormap ?? 'sigrun-classic',
      colorbarMode: c.colorbarMode ?? 'discrete',
      colorbarPosition: c.colorbarPosition ?? 'right',
      colorbarTitle: c.colorbarTitle ?? '',
      colorbarUnit: c.colorbarUnit ?? '',
      showContourLabels: c.showContourLabels ?? false,
      lineWidth: c.lineWidth ?? 1,
      lineColor: c.lineColor ?? '',
    },
  };
}

/** Paste a style pack into a chart without touching its data or its title. */
export function applyStylePack<T extends ChartSpec>(chart: T, pack: ChartStylePack): T {
  const cfg = fullChartConfig(chart);
  const next: ChartConfig = {
    ...cfg,
    appearance: { ...(cfg.appearance ?? {}), ...pack.appearance },
    series: { ...(cfg.series ?? {}), ...(pack.series ?? {}) },
    grid: { ...(cfg.grid ?? {}), ...(pack.grid ?? {}) },
    legend: { ...(cfg.legend ?? {}), ...(pack.legend ?? {}) },
    contour: { ...(cfg.contour ?? {}), ...(pack.contour ?? {}) },
  };
  return withChartConfig(chart, next);
}

/** Reset a chart to the default config (Engineering preset, no overrides). */
export function resetChartConfig<T extends ChartSpec>(chart: T): T {
  const config = defaultChartConfig();
  if (chart.kind === 'contour') {
    // Keep the contour's own level/point look defaults; everything else resets.
    config.contour = { ...(config.contour ?? {}) };
  }
  return { ...chart, config };
}

/* ── config history ───────────────────────────────────────────────────── */

export interface ConfigHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  size: number;
}

/**
 * A small bounded undo stack for one chart editing session.
 *
 * The drawer pushes a snapshot on every committed field change, so Ctrl+Z walks
 * back through edits even though the chart itself lives in React state.
 */
export class ChartConfigHistory {
  private past: ChartConfig[] = [];

  private future: ChartConfig[] = [];

  constructor(private readonly limit = 50) {}

  push(previous: ChartConfig): void {
    this.past.push(snapshot(previous));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: ChartConfig): ChartConfig | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(snapshot(current));
    return previous;
  }

  redo(current: ChartConfig): ChartConfig | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(snapshot(current));
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  state(): ConfigHistoryState {
    return { canUndo: this.past.length > 0, canRedo: this.future.length > 0, size: this.past.length };
  }
}

function snapshot(config: ChartConfig): ChartConfig {
  return JSON.parse(JSON.stringify(config)) as ChartConfig;
}

/* ── RSM re-slice ─────────────────────────────────────────────────────── */

export interface RsmResliceOptions {
  resolution?: number;
  unitMode?: 'coded' | 'actual';
  xFactorIndex?: number;
  yFactorIndex?: number;
  holdingValues?: Record<number, number>;
  xRange?: [number, number];
  yRange?: [number, number];
}

/** The surface the RSM view options currently describe. */
export function resliceRsm(model: RsmModelPayload, view: Partial<RsmViewConfig> | undefined, contour?: Partial<ContourConfig>): RsmSurface {
  const v = view ?? {};
  const xFactorIndex = v.xFactorIndex ?? 0;
  const yFactorIndex = v.yFactorIndex ?? 1;
  const factorRanges = v.factorRanges ?? {};
  const xRange = factorRanges[xFactorIndex];
  const yRange = factorRanges[yFactorIndex];
  return rsmPredictSurface(model, {
    resolution: resolutionPoints(contour?.resolution),
    unitMode: v.unitMode ?? 'coded',
    xFactorIndex,
    yFactorIndex,
    holdingValues: v.holdingValues ?? {},
    ...(xRange && Number.isFinite(xRange.min) && Number.isFinite(xRange.max) && xRange.max > xRange.min
      ? { xRange: [xRange.min, xRange.max] as [number, number] }
      : {}),
    ...(yRange && Number.isFinite(yRange.min) && Number.isFinite(yRange.max) && yRange.max > yRange.min
      ? { yRange: [yRange.min, yRange.max] as [number, number] }
      : {}),
    includeDesignPoints: v.showExperimentalPoints !== false,
  });
}

/**
 * Redraw a fitted contour from its model and the current view options.
 *
 * Only the display grid is rebuilt; the coefficients, the design and every
 * statistic in the output stay exactly as the analysis produced them.
 */
export function materializeRsm<T extends ChartSpec>(chart: T, config?: ChartConfig): T {
  if (chart.kind !== 'contour' || !chart.rsmModel) return chart;
  const cfg = config ?? fullChartConfig(chart);
  const view = cfg.rsm ?? {};
  const contour = cfg.contour ?? {};
  const surface = resliceRsm(chart.rsmModel, view, contour);
  const points = surface.points.filter((point) => {
    if (point.kind === 'design') return view.showExperimentalPoints !== false;
    if (point.kind === 'stationary') return view.showStationaryPoint !== false;
    if (point.kind === 'optimal') return view.showOptimalPoint !== false;
    return true;
  });
  return {
    ...chart,
    xs: surface.grid.xs,
    ys: surface.grid.ys,
    z: surface.grid.z,
    xLabel: surface.xName,
    yLabel: surface.yName,
    xRange: surface.xRange,
    yRange: surface.yRange,
    points: points.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      label: point.label,
      kind: point.kind,
    })),
  };
}

/**
 * Redraw a chart from its own model(s) and a (possibly preview) config.
 *
 * One entry point for the drawer, the export buttons and the style clipboard:
 * the RSM contour re-slices its payload, the 3-D surface re-evaluates its
 * stored model, the overlaid contour re-judges every response on the new grid.
 */
export function materializeChart<T extends ChartSpec>(chart: T, config?: ChartConfig): T {
  if (chart.kind === 'surface3d') return materializeSurface(chart, config);
  if (chart.kind === 'overlaid') return materializeOverlaid(chart, config);
  return materializeRsm(chart, config);
}

/** True when the view currently reaches outside the experimental region. */
export function rsmViewIsExtrapolated(model: RsmModelPayload, view: Partial<RsmViewConfig> | undefined): boolean {
  const v = view ?? {};
  const xi = v.xFactorIndex ?? 0;
  const yi = v.yFactorIndex ?? 1;
  const ranges = v.factorRanges ?? {};
  const outside = (index: number) => {
    const bound = model.codedBounds[index];
    const range = ranges[index];
    if (!bound || !range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return false;
    const toCoded = (value: number) => {
      const t = model.actualTransform[index];
      return (v.unitMode ?? 'coded') === 'actual' && t && t.halfRange ? (value - t.center) / t.halfRange : value;
    };
    const lo = Math.min(toCoded(range.min), toCoded(range.max));
    const hi = Math.max(toCoded(range.min), toCoded(range.max));
    return lo < bound.min - 1e-9 || hi > bound.max + 1e-9;
  };
  return outside(xi) || outside(yi) || Boolean(model.stationary?.outsideRegion);
}

/** Every factor pair of a model, ready to become its own contour block. */
export function allPairSurfaces(model: RsmModelPayload, view: Partial<RsmViewConfig> | undefined, contour?: Partial<ContourConfig>): RsmSurface[] {
  const v = view ?? {};
  const out: RsmSurface[] = [];
  for (let i = 0; i < model.factorNames.length; i += 1) {
    for (let j = i + 1; j < model.factorNames.length; j += 1) {
      out.push(
        rsmPredictSurface(model, {
          xFactorIndex: i,
          yFactorIndex: j,
          resolution: resolutionPoints(contour?.resolution),
          unitMode: v.unitMode ?? 'coded',
          holdingValues: v.holdingValues ?? {},
        }),
      );
    }
  }
  return out;
}

/** Number of factor pairs `C(k, 2)` a model offers. */
export function factorPairCount(model: RsmModelPayload): number {
  const k = model.factorNames.length;
  return k < 2 ? 0 : (k * (k - 1)) / 2;
}

/** Chart kinds that draw a Z colourbar. */
export function hasColorAxis(chart: ChartSpec): boolean {
  return chart.kind === 'contour';
}

/** Chart kinds that can carry a second Y axis. */
export function hasSecondaryY(chart: ChartSpec): boolean {
  return chart.kind === 'line' || chart.kind === 'bar';
}


/* ── Stage 3B: a surface from a stored model ───────────────────────────── */

export interface ModelSurfaceBuild {
  xs: number[];
  ys: number[];
  z: number[][];
  xName: string;
  yName: string;
  xRange: [number, number];
  yRange: [number, number];
  points: { x: number; y: number; z?: number; label?: string; kind?: 'design' | 'stationary' | 'optimal' }[];
  nonEstimable: string[];
  extrapolated: boolean;
}

export interface ModelSurfaceBuildOptions {
  result: { xName: string; yName: string; xs: number[]; ys: number[]; z: number[][]; xRange: [number, number]; yRange: [number, number]; nonEstimable: string[]; outOfRange: boolean };
  points?: ModelSurfaceBuild['points'];
}

/** Numeric factors of a stored model, in the order the drawer indexes them. */
export function numericFactors(model: StoredModel): StoredModel['predictors'] {
  return model.predictors.filter((predictor) => predictor.kind === 'numeric');
}

export interface SurfaceSliceOptions {
  xIndex: number;
  yIndex: number;
  holdings?: Record<number, number>;
  factorRanges?: Record<number, { min: number; max: number }>;
  unitMode: InputMode;
  resolution: number;
}

/**
 * Evaluate a stored model on a factor grid — the arithmetic behind the 3D
 * surface. It uses the compiled evaluator (one label parse, two powers per
 * term), which the QA compares node for node with `modelSurface`'s row-by-row
 * path.
 */
export function buildModelSurface(model: StoredModel, options: SurfaceSliceOptions): ModelSurfaceBuild {
  const numeric = numericFactors(model);
  if (numeric.length < 2) throw new Error('model.surface.numericOnly');
  const clamp = (value: number, fallback: number) => (Number.isInteger(value) && value >= 0 && value < numeric.length ? value : fallback);
  const xi = clamp(options.xIndex, 0);
  const yi = clamp(options.yIndex, xi === 1 ? 0 : 1);
  const xPredictor = numeric[xi];
  const yPredictor = numeric[yi];
  const holdings: Record<string, number> = {};
  numeric.forEach((predictor, index) => {
    if (index === xi || index === yi) return;
    const given = options.holdings?.[index];
    holdings[predictor.name] = given !== undefined && Number.isFinite(given)
      ? given
      : (options.unitMode === 'coded' ? 0 : (predictor.coding?.center ?? 0));
  });
  const evaluator = compileSurfaceEvaluator(model, {
    xName: xPredictor.name,
    yName: yPredictor.name,
    holdings,
    mode: options.unitMode,
  });
  const fallbackX = factorDisplayRange(model, xPredictor, options.unitMode);
  const fallbackY = factorDisplayRange(model, yPredictor, options.unitMode);
  const rangeOf = (index: number, fallback: [number, number]): [number, number] => {
    const range = options.factorRanges?.[index];
    return range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min
      ? [range.min, range.max]
      : fallback;
  };
  const xRange = rangeOf(xi, fallbackX);
  const yRange = rangeOf(yi, fallbackY);
  const resolution = Math.max(2, Math.min(401, Math.round(options.resolution)));
  const xs = Array.from({ length: resolution }, (_, i) => xRange[0] + ((xRange[1] - xRange[0]) * i) / (resolution - 1));
  const ys = Array.from({ length: resolution }, (_, i) => yRange[0] + ((yRange[1] - yRange[0]) * i) / (resolution - 1));
  const xCoded = xs.map((value) => axisDesignValue(xPredictor, value, options.unitMode));
  const yCoded = ys.map((value) => axisDesignValue(yPredictor, value, options.unitMode));
  const nonEstimableTerms = new Set<string>();
  const z: number[][] = ys.map((_, j) => xs.map((__, i) => {
    const node = evaluator.evaluate(xCoded[i], yCoded[j]);
    node.nonEstimable.forEach((label) => nonEstimableTerms.add(label));
    return node.value === null ? Number.NaN : node.value;
  }));
  // Stored design levels are coded; they are drawn in the unit the reader chose.
  const display = (predictor: StoredModel['predictors'][number], codedValue: number | undefined) => {
    const coded = codedValue ?? 0;
    return options.unitMode === 'coded' ? coded : toActualValue(predictor, coded, 'coded');
  };
  const points: ModelSurfaceBuild['points'] = [];
  model.design?.points?.forEach((run) => {
    const xValue = display(xPredictor, run.levels[xPredictor.name]);
    const yValue = display(yPredictor, run.levels[yPredictor.name]);
    points.push({ x: xValue, y: yValue, ...(run.y != null ? { z: run.y } : {}), kind: 'design' });
  });
  if (model.stationary) {
    points.push({
      x: display(xPredictor, model.stationary.levels[xPredictor.name]),
      y: display(yPredictor, model.stationary.levels[yPredictor.name]),
      z: model.stationary.response,
      kind: 'stationary',
      label: 'Stationary',
    });
  }
  if (model.optimal) {
    points.push({
      x: display(xPredictor, model.optimal.levels[xPredictor.name]),
      y: display(yPredictor, model.optimal.levels[yPredictor.name]),
      z: model.optimal.response,
      kind: 'optimal',
      label: 'Optimal',
    });
  }
  // `factorBounds` are stored in ACTUAL units; a range drawn in coded units is
  // converted through the model's own coding before it is compared with them.
  const outside = (range: [number, number], bound: { min: number; max: number } | undefined, predictor: StoredModel['predictors'][number]) => {
    if (!bound || !Number.isFinite(bound.min) || !Number.isFinite(bound.max)) return false;
    const lo = Math.min(axisActualValue(predictor, range[0], options.unitMode), axisActualValue(predictor, range[1], options.unitMode));
    const hi = Math.max(axisActualValue(predictor, range[0], options.unitMode), axisActualValue(predictor, range[1], options.unitMode));
    return lo < bound.min - 1e-9 || hi > bound.max + 1e-9;
  };
  return {
    xs,
    ys,
    z,
    xName: xPredictor.name,
    yName: yPredictor.name,
    xRange,
    yRange,
    points: points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    nonEstimable: [...nonEstimableTerms],
    extrapolated: outside(xRange, model.factorBounds?.[xPredictor.name], xPredictor)
      || outside(yRange, model.factorBounds?.[yPredictor.name], yPredictor),
  };
}

/**
 * Redraw a 3D surface card from its stored model and the current view options.
 * Only the display grid changes; the model, its coefficients and every number
 * in the card stay exactly as the analysis produced them.
 */
export function materializeSurface<T extends ChartSpec>(chart: T, config?: ChartConfig): T {
  if (chart.kind !== 'surface3d' || !chart.model) return chart;
  const cfg = config ?? fullChartConfig(chart);
  const view = cfg.rsm ?? {};
  const numeric = numericFactors(chart.model);
  if (numeric.length < 2) return chart;
  try {
    const surface = buildModelSurface(chart.model, {
      xIndex: view.xFactorIndex ?? 0,
      yIndex: view.yFactorIndex ?? 1,
      holdings: view.holdingValues ?? {},
      factorRanges: view.factorRanges ?? {},
      unitMode: view.unitMode ?? 'actual',
      resolution: surfaceResolutionPoints(cfg.surface?.resolution),
    });
    return {
      ...chart,
      xs: surface.xs,
      ys: surface.ys,
      z: surface.z,
      xLabel: surface.xName,
      yLabel: surface.yName,
      zLabel: chart.zLabel,
      xRange: surface.xRange,
      yRange: surface.yRange,
      points: view.showExperimentalPoints === false && view.showStationaryPoint === false && view.showOptimalPoint !== true
        ? []
        : surface.points.filter((point) => {
          if (point.kind === 'design') return view.showExperimentalPoints !== false;
          if (point.kind === 'stationary') return view.showStationaryPoint !== false;
          if (point.kind === 'optimal') return view.showOptimalPoint === true;
          return true;
        }),
      nonEstimable: surface.nonEstimable,
      extrapolated: surface.extrapolated,
    };
  } catch {
    return chart;
  }
}

/* ── Stage 3B: overlaid contour from several stored models ─────────────── */

export interface OverlaidSliceOptions {
  xName: string;
  yName: string;
  holdings?: Record<number, number>;
  factorRanges?: Record<number, { min: number; max: number }>;
  unitMode: InputMode;
  resolution: number;
  basis: 'mean' | 'confidence' | 'prediction';
  alpha: number;
  specs: { name: string; lsl: number | null; usl: number | null; target: number | null }[];
}

/** Evaluate every model on one grid and keep the specs the chart already had. */
export function buildOverlaidChart(
  models: StoredModel[],
  options: OverlaidSliceOptions,
): OverlaidResult & { xName: string; yName: string; xRange: [number, number]; yRange: [number, number]; rangeWarning?: string } {
  const shared = commonNumericFactors(models);
  const factors = shared.factors;
  const xFactor = factors.find((factor) => factor.name === options.xName) ?? factors[0];
  const yFactor = factors.find((factor) => factor.name === options.yName && factor.name !== xFactor?.name) ?? factors[1];
  if (!xFactor || !yFactor) throw new ModelInputError('feasible.factor.missing', { x: options.xName, y: options.yName, problems: shared.problems });
  const xIndex = factors.indexOf(xFactor);
  const yIndex = factors.indexOf(yFactor);
  const holdings: Record<string, number> = {};
  factors.forEach((factor, index) => {
    if (index === xIndex || index === yIndex) return;
    const given = options.holdings?.[index];
    // An axis-free factor is held where the models were coded around unless the
    // reader said otherwise: 0 in coded units, the centre in actual units.
    holdings[factor.name] = given !== undefined && Number.isFinite(given)
      ? given
      : (options.unitMode === 'coded' ? 0 : (factor.variables[0]?.predictor.coding?.center ?? 0));
  });
  let rangeWarning: string | undefined;
  const rangeOf = (index: number): [number, number] => {
    const factor = factors[index];
    const range = options.factorRanges?.[index];
    if (range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max > range.min) return [range.min, range.max];
    // Default: the part of the factor every model was actually run over.
    const sharedRange = factor ? sharedDisplayRange(models, factor.name, options.unitMode) : { range: null };
    if ('warning' in sharedRange && sharedRange.warning) rangeWarning = sharedRange.warning;
    if (sharedRange.range) return sharedRange.range;
    const predictor = factor?.variables[0]?.predictor;
    return predictor ? factorDisplayRange(models[0], predictor, options.unitMode) : [-1, 1];
  };
  // Specs line up with the models by position when they describe every model;
  // otherwise they are matched by response name and a duplicate is refused.
  const specFor = (model: StoredModel, index: number) => {
    const entry = options.specs.length === models.length
      ? options.specs[index]
      : options.specs.find((candidate) => candidate.name === model.response.name);
    return {
      model,
      lsl: entry?.lsl ?? null,
      usl: entry?.usl ?? null,
      target: entry?.target ?? null,
    };
  };
  const specs = models.map((model, index) => specFor(model, index));
  const xRange = rangeOf(xIndex);
  const yRange = rangeOf(yIndex);
  const result = buildOverlaid(models, specs, {
    xName: xFactor.name,
    yName: yFactor.name,
    holdings,
    xRange,
    yRange,
    resolution: options.resolution,
    mode: options.unitMode,
    referenceModelId: models[0].id,
    basis: options.basis,
    alpha: options.alpha,
  });
  return { ...result, xName: xFactor.name, yName: yFactor.name, xRange, yRange, ...(rangeWarning ? { rangeWarning } : {}) };
}

/** Recompute an overlaid contour from the models and the drawer's options. */
export function materializeOverlaid<T extends ChartSpec>(chart: T, config?: ChartConfig): T {
  if (chart.kind !== 'overlaid' || !chart.models?.length) return chart;
  const cfg = config ?? fullChartConfig(chart);
  const feasible = cfg.feasible ?? {};
  const view = cfg.rsm ?? {};
  // The drawer selects a factor by its index in the common-factor list; the
  // chart's own labels are the fallback for a card built before the drawer ran.
  const factors = commonNumericFactors(chart.models).factors;
  const xName = factors[view.xFactorIndex ?? 0]?.name ?? chart.xLabel ?? '';
  const yName = factors[view.yFactorIndex ?? 1]?.name ?? chart.yLabel ?? '';
  try {
    const result = buildOverlaidChart(chart.models, {
      xName,
      yName,
      holdings: view.holdingValues ?? {},
      factorRanges: view.factorRanges ?? {},
      unitMode: view.unitMode ?? 'actual',
      resolution: resolutionPoints(feasible.resolution),
      basis: feasible.basis ?? 'mean',
      alpha: feasible.alpha ?? 0.05,
      specs: feasible.specs?.length
        ? feasible.specs
        : chart.responses.map((response) => ({ name: response.name, lsl: response.lsl, usl: response.usl, target: response.target })),
    });
    const responses = result.responses.map((response, index) => ({
      ...response,
      color: chart.responses[index]?.color ?? OVERLAY_COLORS[index % OVERLAY_COLORS.length],
      dash: chart.responses[index]?.dash ?? OVERLAY_DASHES[index % OVERLAY_DASHES.length],
    }));
    const points = (view.showExperimentalPoints === false ? [] : (chart.points ?? []));
    return {
      ...chart,
      xs: result.xs,
      ys: result.ys,
      responses,
      xLabel: result.xName,
      yLabel: result.yName,
      xRange: result.xRange,
      yRange: result.yRange,
      points,
      feasible: {
        mask: result.feasible,
        areaRatio: result.areaRatio,
        nodeRatio: result.nodeRatio,
        feasibleNodes: result.feasibleNodes,
        totalNodes: result.totalNodes,
        basis: feasible.basis ?? 'mean',
        convergenceDelta: result.convergenceDelta,
        nodeConvergenceDelta: result.convergence.nodeDelta,
        areaConvergenceDelta: result.convergence.areaDelta,
        convergenceNeighborCount: result.convergence.neighborCount,
        convergenceDirection: result.convergence.direction,
        perResponse: result.responses.map((response) => ({ name: response.name, areaRatio: response.areaRatio, nodeRatio: response.nodeRatio })),
        intervalBlocked: result.intervalBlocked,
        intervalBlockReasons: result.intervalBlockReasons,
        ...(result.rangeWarning ? { rangeWarning: result.rangeWarning } : {}),
      },
      extrapolated: result.extrapolated,
      extrapolationDetails: result.extrapolation.details,
    };
  } catch (error) {
    // A refused basis (or any other structured input error) is kept on the
    // card: the drawer shows it and the region is not replaced by a mean-based
    // picture nobody asked for.
    if (error instanceof ModelInputError) {
      return {
        ...chart,
        feasible: {
          mask: [],
          areaRatio: 0,
          nodeRatio: 0,
          feasibleNodes: 0,
          totalNodes: 0,
          basis: feasible.basis ?? 'mean',
          convergenceDelta: 0,
          perResponse: [],
          intervalBlocked: chart.feasible?.intervalBlocked ?? [],
          error: { code: error.code, blocked: (error.detail as { blocked?: { model: string; reasons: string[] }[] })?.blocked ?? [] },
        },
      };
    }
    return chart;
  }
}
