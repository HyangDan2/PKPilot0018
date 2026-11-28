/* ─────────────────────────────────────────────────────────────────────────
   Statelia — configuration guards (WO-01/7)

   A chart configuration can arrive from three places that do not share a
   type checker: the properties drawer (a text field the reader typed into), a
   project file produced by an older build (or edited by hand), and an
   analysis that stored a partial config. Any of them can carry `NaN`, `±Infinity`,
   a reversed range, a zero interval or an unknown preset id.

   Every value that reaches the renderer passes these guards first. The rule is
   the same everywhere: an invalid value is *ignored and replaced by a sane
   default*, never clamped into a plausible-looking wrong number and never
   allowed to put `NaN` into an SVG coordinate.
   ───────────────────────────────────────────────────────────────────────── */

import type {
  AxisConfig,
  AxisScale,
  ChartAppearance,
  ChartConfig,
  ChartMargins,
  ChartStylePresetId,
  ColorbarMode,
  ColorbarPosition,
  ContourColormap,
  ContourConfig,
  ContourLevelMode,
  ContourRenderMode,
  ContourResolution,
  CrossAt,
  ExportBackground,
  ExportConfig,
  ExportFormat,
  GridConfig,
  LegendConfig,
  LegendPosition,
  MarkerShape,
  PhysicalUnit,
  ReferenceLineConfig,
  SeriesOverride,
  SeriesStyle,
  SurfaceCameraConfig,
  SurfaceViewConfig,
  SurfaceRenderMode,
  SurfaceProjection,
  SurfaceBackground,
  FeasibleConfig,
  FeasibleBasis,
  TickDirection,
  DateAxisUnit,
  DateAxisFormat,
  MaskedRegionStyle,
  ContourColorStop,
  ContourLevelStyle,
  ErrorBarKind,
  PointStyle,
  SeriesAdvancedConfig,
  ErrorBarConfig,
} from './chartConfig';
import {
  defaultAxisConfig,
  defaultChartAppearance,
  defaultChartConfig,
  defaultContourConfig,
  defaultExportConfig,
  defaultGridConfig,
  defaultFeasibleConfig,
  defaultSurfaceViewConfig,
  defaultLegendConfig,
  defaultSeriesStyle,
  defaultSeriesAdvancedConfig,
  mergeChartConfig,
} from './chartConfig';

/** Hard bounds: outside these a value cannot describe a chart at all. */
export const GUARD_LIMITS = {
  fontSize: [4, 48] as [number, number],
  borderWidth: [0, 8] as [number, number],
  lineWidth: [0, 12] as [number, number],
  markerSize: [0, 30] as [number, number],
  axisMargin: [0, 0.5] as [number, number],
  decimals: [0, 12] as [number, number],
  levelCount: [2, 50] as [number, number],
  legendFontSize: [4, 32] as [number, number],
  dpi: [24, 2400] as [number, number],
  physicalSize: [1, 5000] as [number, number],
  pixelSize: [0, 40000] as [number, number],
  chartWidth: [120, 4000] as [number, number],
  chartHeight: [60, 4000] as [number, number],
  aspectRatio: [0.2, 10] as [number, number],
  margin: [0, 500] as [number, number],
  palette: 32,
  colorCount: 64,
};

// Kept as a literal so this module never depends on chartStyles at load time
// (chartStyles reaches back into chartConfig and the guard is imported from the
// renderer, which is the top of that chain). `tests/chart-guards.test.ts`
// asserts that this list and CHART_STYLE_IDS stay identical.
export const PRESET_IDS: string[] = [
  'sigrun-classic',
  'engineering',
  'scientific',
  'corporate',
  'monochrome',
  'high-contrast',
  'dark',
];
const AXIS_SCALES: AxisScale[] = ['linear', 'log10', 'ln', 'symlog', 'power'];
const DATE_UNITS: DateAxisUnit[] = ['day', 'week', 'month', 'year'];
const DATE_FORMATS: DateAxisFormat[] = ['date', 'month-year', 'year'];
const MASKED_STYLES: MaskedRegionStyle[] = ['blank', 'hatch', 'gray'];
const ERROR_BAR_KINDS: ErrorBarKind[] = ['none', 'sd', 'se', 'ci'];
const TICK_DIRECTIONS: TickDirection[] = ['in', 'out', 'both', 'none'];
const MARKER_SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'none'];
const LEGEND_POSITIONS: LegendPosition[] = ['top-right', 'top-left', 'bottom', 'right', 'none'];
const CONTOUR_RESOLUTION_IDS: ContourResolution[] = ['draft', 'standard', 'high', 'ultra'];
const CONTOUR_RENDER_MODES: ContourRenderMode[] = ['lines', 'filled', 'filled-lines', 'heatmap-continuous', 'heatmap-discrete'];
const COLORMAP_IDS: ContourColormap[] = ['viridis', 'cividis', 'plasma', 'inferno', 'turbo', 'coolwarm', 'rdbu', 'grayscale', 'sigrun-classic'];
const LEVEL_MODES: ContourLevelMode[] = ['auto', 'manual', 'custom'];
const COLORBAR_MODES: ColorbarMode[] = ['continuous', 'discrete'];
const COLORBAR_POSITIONS: ColorbarPosition[] = ['right', 'bottom', 'left'];
const EXPORT_FORMATS: ExportFormat[] = ['svg', 'png'];
const BACKGROUND_MODES: ExportBackground[] = ['transparent', 'white', 'current'];
const PHYSICAL_UNITS: PhysicalUnit[] = ['mm', 'in'];

/** A finite number, or null — the single predicate every guard starts from. */
export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function finiteOr(value: unknown, fallback: number): number {
  return finiteOrNull(value) ?? fallback;
}

export function clampValue(value: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

function boundedOr(value: unknown, limits: [number, number], fallback: number): number {
  const number = finiteOrNull(value);
  return number === null ? fallback : clampValue(number, limits);
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function textOr(value: unknown, fallback: string, maxLength = 200): string {
  if (typeof value !== 'string') return fallback;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

function colourOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  if (!text) return fallback;
  const ok = /^#(?:[0-9a-f]{3,8})$/i.test(text)
    || /^(?:rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(text)
    || ['transparent', 'none', 'currentColor'].includes(text);
  return ok ? text : fallback;
}

/* ── axis ─────────────────────────────────────────────────────────────── */

export interface AxisRangeWarning {
  code: 'range-reversed' | 'range-not-finite' | 'log-nonpositive-limit';
  message: string;
}

/**
 * Resolve a manual axis range. Returns `null` when the range cannot be used,
 * with the reason, so the caller silently falls back to the data extent rather
 * than drawing an inverted or NaN axis.
 */
export function resolveManualRange(min: unknown, max: unknown): { range: [number, number] | null; warning?: AxisRangeWarning } {
  const lo = finiteOrNull(min);
  const hi = finiteOrNull(max);
  if (lo === null && hi === null) return { range: null };
  if (lo !== null && hi !== null) {
    if (lo === hi) return { range: null, warning: { code: 'range-reversed', message: 'A manual range needs two different limits.' } };
    if (lo > hi) return { range: null, warning: { code: 'range-reversed', message: 'The minimum is above the maximum.' } };
    return { range: [lo, hi] };
  }
  // Only one limit is usable: keep it and let the data decide the other end.
  return { range: null };
}

export function sanitizeAxisConfig(patch?: Partial<AxisConfig>): AxisConfig {
  const base = defaultAxisConfig();
  const source = patch ?? {};
  const manual = resolveManualRange(source.min, source.max);
  const scale = oneOf(source.scale, AXIS_SCALES, base.scale);
  const cross = source.crossAt === 'auto' || source.crossAt === 'zero'
    ? source.crossAt
    : finiteOrNull(source.crossAt);
  return {
    autoRange: boolOr(source.autoRange, base.autoRange || manual.range === null),
    min: manual.range ? manual.range[0] : finiteOrNull(source.min),
    max: manual.range ? manual.range[1] : finiteOrNull(source.max),
    majorInterval: (() => {
      const value = finiteOrNull(source.majorInterval);
      return value !== null && value > 0 && Number.isFinite(value) ? value : null;
    })(),
    minorInterval: (() => {
      const value = finiteOrNull(source.minorInterval);
      return value !== null && value > 0 ? value : null;
    })(),
    scale,
    reverse: boolOr(source.reverse, base.reverse),
    title: textOr(source.title, base.title, 120),
    unit: textOr(source.unit, base.unit, 40),
    decimals: source.decimals === null || source.decimals === undefined
      ? null
      : Math.round(boundedOr(source.decimals, GUARD_LIMITS.decimals, 0)),
    scientific: boolOr(source.scientific, base.scientific),
    thousandsSep: boolOr(source.thousandsSep, base.thousandsSep),
    tickDirection: oneOf(source.tickDirection, TICK_DIRECTIONS, base.tickDirection),
    showMajorGrid: boolOr(source.showMajorGrid, base.showMajorGrid),
    showMinorGrid: boolOr(source.showMinorGrid, base.showMinorGrid),
    axisMargin: boundedOr(source.axisMargin, GUARD_LIMITS.axisMargin, base.axisMargin),
    crossAt: (cross ?? 'auto') as CrossAt,
    tickCount: (() => {
      const value = finiteOrNull(source.tickCount);
      return value === null ? null : Math.round(clampValue(value, [2, 20]));
    })(),
    tickValues: Array.isArray(source.tickValues)
      ? [...new Set(source.tickValues.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)))].sort((a, b) => a - b).slice(0, 50)
      : [],
    minorTickCount: (() => {
      const value = finiteOrNull(source.minorTickCount);
      return value === null ? null : Math.round(clampValue(value, [1, 20]));
    })(),
    axisBreak: (() => {
      const raw = source.axisBreak;
      if (!raw) return null;
      const from = finiteOrNull(raw.from);
      const to = finiteOrNull(raw.to);
      if (from === null || to === null || !(to > from)) return null;
      return { from, to, size: clampValue(finiteOr(raw.size, 10), [2, 60]) };
    })(),
    power: clampValue(finiteOr(source.power, 0.5), [0.05, 5]),
    logConstant: Math.abs(finiteOr(source.logConstant, 1)) < 1e-9 ? 1 : Math.abs(finiteOr(source.logConstant, 1)),
    tickLength: (() => {
      const value = finiteOrNull(source.tickLength);
      return value === null ? null : clampValue(value, [0, 40]);
    })(),
    showAxisLine: boolOr(source.showAxisLine, true),
    showTickLabels: boolOr(source.showTickLabels, true),
    dateAxis: (() => {
      const raw = source.dateAxis;
      if (!raw) return null;
      return {
        epoch: finiteOr(raw.epoch, 0),
        unit: oneOf(raw.unit, DATE_UNITS, 'day'),
        format: oneOf(raw.format, DATE_FORMATS, 'date'),
      };
    })(),
    secondary: (() => {
      const raw = source.secondary;
      if (!raw) return null;
      const lo = finiteOrNull(raw.min);
      const hi = finiteOrNull(raw.max);
      return {
        title: textOr(raw.title, '', 120),
        unit: textOr(raw.unit, '', 40),
        min: lo,
        max: lo !== null && hi !== null && hi <= lo ? null : hi,
        decimals: raw.decimals === null || raw.decimals === undefined ? null : Math.round(boundedOr(raw.decimals, GUARD_LIMITS.decimals, 0)),
        showGrid: boolOr(raw.showGrid, false),
      };
    })(),
    ...(source.probGrid === undefined ? {} : { probGrid: boolOr(source.probGrid, false) }),
    ...(source.stageMode === undefined ? {} : { stageMode: boolOr(source.stageMode, false) }),
    ...(Array.isArray(source.categoryOrder)
      ? { categoryOrder: source.categoryOrder.filter((v): v is string => typeof v === 'string').slice(0, 200) }
      : {}),
  };
}

/* ── appearance, series, legend, grid ─────────────────────────────────── */

export function sanitizeAppearance(patch?: Partial<ChartAppearance>): ChartAppearance {
  const base = defaultChartAppearance();
  const source = patch ?? {};
  const margins: ChartMargins = {
    top: boundedOr(source.margins?.top, GUARD_LIMITS.margin, base.margins.top),
    right: boundedOr(source.margins?.right, GUARD_LIMITS.margin, base.margins.right),
    bottom: boundedOr(source.margins?.bottom, GUARD_LIMITS.margin, base.margins.bottom),
    left: boundedOr(source.margins?.left, GUARD_LIMITS.margin, base.margins.left),
  };
  return {
    preset: oneOf(source.preset, PRESET_IDS, base.preset) as ChartStylePresetId,
    chartBg: source.chartBg === undefined ? base.chartBg : colourOr(source.chartBg, 'transparent'),
    plotBg: source.plotBg === undefined ? base.plotBg : colourOr(source.plotBg, 'transparent'),
    fontFamily: textOr(source.fontFamily, base.fontFamily, 120),
    fontSize: boundedOr(source.fontSize, GUARD_LIMITS.fontSize, base.fontSize),
    title: textOr(source.title, base.title, 200),
    subtitle: textOr(source.subtitle, base.subtitle, 200),
    titleVisible: boolOr(source.titleVisible, base.titleVisible),
    axisColor: colourOr(source.axisColor, ''),
    tickColor: colourOr(source.tickColor, ''),
    labelColor: colourOr(source.labelColor, ''),
    gridColor: colourOr(source.gridColor, ''),
    borderWidth: boundedOr(source.borderWidth, GUARD_LIMITS.borderWidth, base.borderWidth),
    width: boundedOr(source.width, GUARD_LIMITS.chartWidth, base.width),
    height: source.height === undefined || source.height === 0 ? 0 : boundedOr(source.height, GUARD_LIMITS.chartHeight, base.height),
    aspectRatio: boundedOr(source.aspectRatio, GUARD_LIMITS.aspectRatio, base.aspectRatio),
    margins,
  };
}

function sanitizeSeriesOverride(value: unknown): SeriesOverride | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const out: SeriesOverride = {};
  if (source.color !== undefined) out.color = colourOr(source.color, '');
  if (source.lineWidth !== undefined) out.lineWidth = boundedOr(source.lineWidth, GUARD_LIMITS.lineWidth, 1.7);
  if (source.lineDash !== undefined) out.lineDash = textOr(source.lineDash, '', 40);
  if (source.markerShape !== undefined) out.markerShape = oneOf(source.markerShape, MARKER_SHAPES, 'circle');
  if (source.markerSize !== undefined) out.markerSize = boundedOr(source.markerSize, GUARD_LIMITS.markerSize, 3.1);
  if (source.visible !== undefined) out.visible = boolOr(source.visible, true);
  return out;
}

export function sanitizeSeriesStyle(patch?: Partial<SeriesStyle>): SeriesStyle {
  const base = defaultSeriesStyle();
  const source = patch ?? {};
  const palette = Array.isArray(source.palette)
    ? source.palette.filter((c): c is string => typeof c === 'string' && Boolean(colourOr(c, ''))).slice(0, GUARD_LIMITS.palette)
    : [];
  const perSeries: Record<number, SeriesOverride> = {};
  if (source.perSeries && typeof source.perSeries === 'object') {
    Object.entries(source.perSeries).forEach(([key, value]) => {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > 64) return;
      const clean = sanitizeSeriesOverride(value);
      if (clean) perSeries[index] = clean;
    });
  }
  return {
    lineWidth: boundedOr(source.lineWidth, GUARD_LIMITS.lineWidth, base.lineWidth),
    lineDash: textOr(source.lineDash, base.lineDash, 40),
    markerShape: oneOf(source.markerShape, MARKER_SHAPES, base.markerShape),
    markerSize: boundedOr(source.markerSize, GUARD_LIMITS.markerSize, base.markerSize),
    palette,
    fillOpacity: boundedOr(source.fillOpacity, [0, 1], base.fillOpacity),
    ...(Object.keys(perSeries).length ? { perSeries } : {}),
  };
}

export function sanitizeLegendConfig(patch?: Partial<LegendConfig>): LegendConfig {
  const base = defaultLegendConfig();
  const source = patch ?? {};
  return {
    visible: boolOr(source.visible, base.visible),
    position: oneOf(source.position, LEGEND_POSITIONS, base.position),
    fontSize: boundedOr(source.fontSize, GUARD_LIMITS.legendFontSize, base.fontSize),
    showBackground: boolOr(source.showBackground, base.showBackground),
  };
}

export function sanitizeGridConfig(patch?: Partial<GridConfig>): GridConfig {
  const base = defaultGridConfig();
  const source = patch ?? {};
  return {
    majorX: boolOr(source.majorX, base.majorX),
    majorY: boolOr(source.majorY, base.majorY),
    minorX: boolOr(source.minorX, base.minorX),
    minorY: boolOr(source.minorY, base.minorY),
    color: colourOr(source.color, base.color),
    width: boundedOr(source.width, [0, 6], base.width),
    dash: textOr(source.dash, base.dash, 40),
  };
}

/* ── contour ──────────────────────────────────────────────────────────── */

export function sanitizeContourConfig(patch?: Partial<ContourConfig>): ContourConfig {
  const base = defaultContourConfig();
  const source = patch ?? {};
  let zMin = finiteOrNull(source.zMin);
  let zMax = finiteOrNull(source.zMax);
  // A reversed or equal z window cannot describe bands: use the data range.
  if (zMin !== null && zMax !== null && zMin >= zMax) {
    zMin = null;
    zMax = null;
  }
  let lsl = finiteOrNull(source.specLsl);
  let usl = finiteOrNull(source.specUsl);
  if (lsl !== null && usl !== null && lsl >= usl) {
    lsl = null;
    usl = null;
  }
  const customLevels = Array.isArray(source.customLevels)
    ? [...new Set(source.customLevels.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)))].sort((a, b) => a - b).slice(0, GUARD_LIMITS.levelCount[1])
    : [];
  const levelCount = Math.round(boundedOr(source.levelCount, GUARD_LIMITS.levelCount, base.levelCount));
  return {
    resolution: oneOf(source.resolution, CONTOUR_RESOLUTION_IDS, base.resolution),
    renderMode: oneOf(source.renderMode, CONTOUR_RENDER_MODES, base.renderMode),
    colormap: oneOf(source.colormap, COLORMAP_IDS, base.colormap),
    zMin,
    zMax,
    levelMode: oneOf(source.levelMode, LEVEL_MODES, base.levelMode),
    levelCount,
    levelInterval: (() => {
      const value = finiteOrNull(source.levelInterval);
      return value !== null && value > 0 ? value : null;
    })(),
    customLevels,
    colorbarMode: oneOf(source.colorbarMode, COLORBAR_MODES, base.colorbarMode),
    colorbarTitle: textOr(source.colorbarTitle, base.colorbarTitle, 80),
    colorbarUnit: textOr(source.colorbarUnit, base.colorbarUnit, 40),
    colorbarPosition: oneOf(source.colorbarPosition, COLORBAR_POSITIONS, base.colorbarPosition),
    showContourLabels: boolOr(source.showContourLabels, base.showContourLabels),
    lineWidth: boundedOr(source.lineWidth, [0, 8], base.lineWidth),
    lineColor: colourOr(source.lineColor, ''),
    showPoints: boolOr(source.showPoints, base.showPoints),
    targetValue: finiteOrNull(source.targetValue),
    targetTolerance: (() => {
      const value = finiteOrNull(source.targetTolerance);
      return value !== null && value > 0 ? value : null;
    })(),
    specLsl: lsl,
    specUsl: usl,
    showSpecRegion: boolOr(source.showSpecRegion, base.showSpecRegion),
    customStops: sanitizeColorStops(source.customStops),
    levelStyles: sanitizeLevelStyles(source.levelStyles),
    underflowColor: source.underflowColor === undefined ? '' : colourOr(source.underflowColor, ''),
    overflowColor: source.overflowColor === undefined ? '' : colourOr(source.overflowColor, ''),
    maskedStyle: oneOf(source.maskedStyle, MASKED_STYLES, base.maskedStyle),
    labelFontSize: boundedOr(source.labelFontSize, [4, 24], base.labelFontSize),
    labelDecimals: source.labelDecimals === null || source.labelDecimals === undefined
      ? null
      : Math.round(boundedOr(source.labelDecimals, [0, 8], 2)),
  };
}

function sanitizeColorStops(value: unknown): ContourColorStop[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is ContourColorStop => Boolean(entry) && typeof entry === 'object')
    .map((entry) => ({ value: finiteOrNull(entry.value), color: colourOr(entry.color, '') }))
    .filter((entry): entry is ContourColorStop => entry.value !== null && Boolean(entry.color))
    .sort((a, b) => a.value - b.value)
    .slice(0, 20);
}

function sanitizeLevelStyles(value: unknown): ContourLevelStyle[] {
  if (!Array.isArray(value)) return [];
  const out: ContourLevelStyle[] = [];
  value
    .filter((entry): entry is ContourLevelStyle => Boolean(entry) && typeof entry === 'object')
    .forEach((entry) => {
      const index = finiteOrNull(entry.index);
      if (index === null) return;
      const clean: ContourLevelStyle = { index: Math.round(clampValue(index, [0, 50])) };
      if (entry.color !== undefined) clean.color = colourOr(entry.color, '');
      if (entry.lineColor !== undefined) clean.lineColor = colourOr(entry.lineColor, '');
      if (entry.lineWidth !== undefined) clean.lineWidth = clampValue(finiteOr(entry.lineWidth, 1), [0, 8]);
      if (entry.lineDash !== undefined) clean.lineDash = textOr(entry.lineDash, '', 40);
      if (entry.showLabel !== undefined) clean.showLabel = boolOr(entry.showLabel, true);
      const existing = out.findIndex((item) => item.index === clean.index);
      if (existing >= 0) out[existing] = clean;
      else out.push(clean);
    });
  return out.slice(0, 51);
}

/* ── advanced series (Stage 3D) ──────────────────────────────────────── */

export function sanitizeSeriesAdvanced(
  patch?: Partial<Omit<SeriesAdvancedConfig, 'errorBars'>> & { errorBars?: Partial<ErrorBarConfig> },
): SeriesAdvancedConfig {
  const base = defaultSeriesAdvancedConfig();
  const source = patch ?? {};
  const bars: Partial<ErrorBarConfig> = source.errorBars ?? {};
  const order = Array.isArray(source.order)
    ? source.order.filter((index): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= 64).slice(0, 65)
    : [];
  const pointStyles: Record<number, PointStyle> = {};
  if (source.pointStyles && typeof source.pointStyles === 'object') {
    Object.entries(source.pointStyles).forEach(([key, value]) => {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > 5000) return;
      if (!value || typeof value !== 'object') return;
      const clean: PointStyle = {};
      if (value.shape !== undefined) clean.shape = oneOf(value.shape, MARKER_SHAPES, 'circle');
      if (value.size !== undefined) clean.size = boundedOr(value.size, GUARD_LIMITS.markerSize, 3.1);
      if (value.color !== undefined) clean.color = colourOr(value.color, '');
      pointStyles[index] = clean;
    });
  }
  return {
    areaFill: boolOr(source.areaFill, base.areaFill),
    areaOpacity: boundedOr(source.areaOpacity, [0, 1], base.areaOpacity),
    dropLines: boolOr(source.dropLines, base.dropLines),
    dropLineColor: colourOr(source.dropLineColor, ''),
    dropLineDash: textOr(source.dropLineDash, '', 40),
    errorBars: {
      kind: oneOf(bars.kind, ERROR_BAR_KINDS, base.errorBars.kind),
      scope: bars.scope === 'series' ? 'series' : 'point',
      conf: boundedOr(bars.conf, [0.5, 0.999], base.errorBars.conf),
      capWidth: boundedOr(bars.capWidth, [0, 20], base.errorBars.capWidth),
      color: colourOr(bars.color, ''),
      series: Array.isArray(bars.series) ? bars.series.filter((index: unknown): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= 64).slice(0, 65) : [],
    },
    order,
    secondarySeries: Array.isArray(source.secondarySeries)
      ? source.secondarySeries.filter((index): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= 64).slice(0, 65)
      : [],
    pointStyles,
  };
}

/* ── 3D surface / overlaid contour (Stage 3B) ───────────────────────── */

const SURFACE_RENDER_MODES: SurfaceRenderMode[] = ['surface', 'wireframe', 'both'];
const SURFACE_PROJECTIONS: SurfaceProjection[] = ['perspective', 'orthographic'];
const SURFACE_BACKGROUNDS: SurfaceBackground[] = ['surface', 'white', 'dark'];
const FEASIBLE_BASES: FeasibleBasis[] = ['mean', 'confidence', 'prediction'];

/**
 * A camera can be dragged past any sane angle while a pointer is down; the
 * stored view still has to describe a place in the room. Elevation stops just
 * short of the poles so the up vector never becomes degenerate.
 */
export function sanitizeSurfaceConfig(patch?: Partial<SurfaceViewConfig>): SurfaceViewConfig {
  const base = defaultSurfaceViewConfig();
  const source = patch ?? {};
  const camera: Partial<SurfaceCameraConfig> = source.camera ?? {};
  return {
    renderMode: oneOf(source.renderMode, SURFACE_RENDER_MODES, base.renderMode),
    colormap: oneOf(source.colormap, COLORMAP_IDS, base.colormap),
    resolution: oneOf(source.resolution, CONTOUR_RESOLUTION_IDS, base.resolution),
    opacity: boundedOr(source.opacity, [0.1, 1], base.opacity),
    meshDensity: Math.round(boundedOr(source.meshDensity, [1, 40], base.meshDensity)),
    meshLineWidth: boundedOr(source.meshLineWidth, [0, 6], base.meshLineWidth),
    lighting: boolOr(source.lighting, base.lighting),
    lightAzimuth: ((boundedOr(source.lightAzimuth, [-360, 360], base.lightAzimuth) % 360) + 360) % 360,
    lightElevation: boundedOr(source.lightElevation, [-90, 90], base.lightElevation),
    ambient: boundedOr(source.ambient, [0, 1], base.ambient),
    diffuse: boundedOr(source.diffuse, [0, 2], base.diffuse),
    showFloorContours: boolOr(source.showFloorContours, base.showFloorContours),
    floorLevelCount: Math.round(boundedOr(source.floorLevelCount, [2, 20], base.floorLevelCount)),
    zScale: boundedOr(source.zScale, [0.2, 4], base.zScale),
    colorbar: boolOr(source.colorbar, base.colorbar),
    background: oneOf(source.background, SURFACE_BACKGROUNDS, base.background),
    showPoints: boolOr(source.showPoints, base.showPoints),
    showAxes: boolOr(source.showAxes, base.showAxes),
    projection: oneOf(source.projection, SURFACE_PROJECTIONS, base.projection),
    camera: {
      azimuth: ((boundedOr(camera.azimuth, [-3600, 3600], base.camera.azimuth) % 360) + 360) % 360,
      elevation: boundedOr(camera.elevation, [2, 89], base.camera.elevation),
      zoom: boundedOr(camera.zoom, [0.4, 3], base.camera.zoom),
      panX: boundedOr(camera.panX, [-1, 1], base.camera.panX),
      panY: boundedOr(camera.panY, [-1, 1], base.camera.panY),
    },
  };
}

export function sanitizeFeasibleConfig(patch?: Partial<FeasibleConfig>): FeasibleConfig {
  const base = defaultFeasibleConfig();
  const source = patch ?? {};
  return {
    basis: oneOf(source.basis, FEASIBLE_BASES, base.basis),
    specs: Array.isArray(source.specs)
      ? source.specs
        .filter((entry): entry is { name: string; lsl: number | null; usl: number | null; target: number | null } => Boolean(entry) && typeof entry.name === 'string')
        .map((entry) => ({
          name: entry.name.slice(0, 80),
          lsl: finiteOrNull(entry.lsl),
          usl: finiteOrNull(entry.usl),
          target: finiteOrNull(entry.target),
        }))
        .slice(0, 12)
      : [],
    alpha: boundedOr(source.alpha, [0.001, 0.5], base.alpha),
    showResponseRegions: boolOr(source.showResponseRegions, base.showResponseRegions),
    showSpecLines: boolOr(source.showSpecLines, base.showSpecLines),
    showFeasible: boolOr(source.showFeasible, base.showFeasible),
    hatchUnfeasible: boolOr(source.hatchUnfeasible, base.hatchUnfeasible),
    showPoints: boolOr(source.showPoints, base.showPoints),
    resolution: oneOf(source.resolution, CONTOUR_RESOLUTION_IDS, base.resolution),
    colorbar: boolOr(source.colorbar, base.colorbar),
    showRatio: boolOr(source.showRatio, base.showRatio),
  };
}

/* ── export ───────────────────────────────────────────────────────────── */

export function sanitizeExportConfig(patch?: Partial<ExportConfig>): ExportConfig {
  const base = defaultExportConfig();
  const source = patch ?? {};
  return {
    format: oneOf(source.format, EXPORT_FORMATS, base.format),
    dpi: Math.round(boundedOr(source.dpi, GUARD_LIMITS.dpi, base.dpi)),
    widthPx: Math.round(boundedOr(source.widthPx, GUARD_LIMITS.pixelSize, base.widthPx)),
    heightPx: Math.round(boundedOr(source.heightPx, GUARD_LIMITS.pixelSize, base.heightPx)),
    physicalWidth: boundedOr(source.physicalWidth, GUARD_LIMITS.physicalSize, base.physicalWidth),
    physicalHeight: boundedOr(source.physicalHeight, GUARD_LIMITS.physicalSize, base.physicalHeight),
    physicalUnit: oneOf(source.physicalUnit, PHYSICAL_UNITS, base.physicalUnit),
    background: oneOf(source.background, BACKGROUND_MODES, base.background),
    includeTitle: boolOr(source.includeTitle, base.includeTitle),
    includeLegend: boolOr(source.includeLegend, base.includeLegend),
  };
}

/* ── whole config ─────────────────────────────────────────────────────── */

function sanitizeReferenceLines(lines: unknown): ReferenceLineConfig[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((line): line is ReferenceLineConfig => Boolean(line) && typeof line === 'object')
    .filter((line) => (line.axis === 'x' || line.axis === 'y') && finiteOrNull(line.value) !== null)
    .slice(0, 40)
    .map((line, index) => ({
      id: textOr(line.id, `ref-${index}`, 60),
      axis: line.axis,
      value: finiteOrNull(line.value) as number,
      label: textOr(line.label, '', 60),
      color: colourOr(line.color, ''),
      width: boundedOr(line.width, [0.5, 6], 1),
      dash: textOr(line.dash, '', 40),
      visible: boolOr(line.visible, true),
    }));
}

/**
 * The one entry point the renderer uses: merge a (possibly partial, possibly
 * hostile) config over the defaults and validate every value that has a range.
 */
export function sanitizeChartConfig(config?: ChartConfig): ChartConfig {
  const merged = mergeChartConfig(undefined, config);
  const defaults = defaultChartConfig();
  return {
    appearance: sanitizeAppearance(merged.appearance),
    xAxis: sanitizeAxisConfig(merged.xAxis),
    yAxis: sanitizeAxisConfig(merged.yAxis),
    series: sanitizeSeriesStyle(merged.series),
    legend: sanitizeLegendConfig(merged.legend),
    grid: sanitizeGridConfig(merged.grid),
    referenceLines: sanitizeReferenceLines(merged.referenceLines),
    export: sanitizeExportConfig(merged.export),
    contour: sanitizeContourConfig(merged.contour),
    rsm: { ...(defaults.rsm ?? {}), ...(merged.rsm ?? {}) },
    surface: sanitizeSurfaceConfig(merged.surface),
    feasible: sanitizeFeasibleConfig(merged.feasible),
    scatter: { ...(defaults.scatter ?? {}), ...(merged.scatter ?? {}) },
    histogram: { ...(defaults.histogram ?? {}), ...(merged.histogram ?? {}) },
    boxplot: { ...(defaults.boxplot ?? {}), ...(merged.boxplot ?? {}) },
    spc: { ...(defaults.spc ?? {}), ...(merged.spc ?? {}) },
    capability: { ...(defaults.capability ?? {}), ...(merged.capability ?? {}) },
    probplot: { ...(defaults.probplot ?? {}), ...(merged.probplot ?? {}) },
    lineBarPareto: { ...(defaults.lineBarPareto ?? {}), ...(merged.lineBarPareto ?? {}) },
    seriesAdvanced: sanitizeSeriesAdvanced(merged.seriesAdvanced),
  };
}

/** True when the config would have produced a NaN / Infinity coordinate. */
export function hasNonFiniteConfig(config: ChartConfig | undefined): boolean {
  if (!config) return false;
  const axisBad = (axis?: Partial<AxisConfig>) => Boolean(axis) && (
    (finiteOrNull(axis?.min) === null && axis?.min != null)
    || (finiteOrNull(axis?.max) === null && axis?.max != null)
    || (axis?.majorInterval != null && !(Number.isFinite(axis.majorInterval) && axis.majorInterval > 0))
    || (axis?.axisMargin != null && !Number.isFinite(axis.axisMargin))
  );
  const contourBad = Boolean(config.contour) && (
    (config.contour?.zMin != null && finiteOrNull(config.contour.zMin) === null)
    || (config.contour?.zMax != null && finiteOrNull(config.contour.zMax) === null)
    || (config.contour?.levelCount != null && finiteOrNull(config.contour.levelCount) === null)
  );
  return axisBad(config.xAxis) || axisBad(config.yAxis) || contourBad;
}
