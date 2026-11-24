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
