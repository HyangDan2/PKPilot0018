/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — common chart configuration model (WO-01)

   The configuration is deliberately independent of the statistical results:
   an analysis produces the numbers, a chart config decides how those numbers
   are drawn. Every field is optional, so an old chart that carries no config
   renders exactly as it did before.
   ───────────────────────────────────────────────────────────────────────── */

/** The seven built-in professional styles (see chartStyles.ts). */
export type ChartStylePresetId =
  | 'sigrun-classic'
  | 'engineering'
  | 'scientific'
  | 'corporate'
  | 'monochrome'
  | 'high-contrast'
  | 'dark';

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'none';
/**
 * Axis transformations. `log10` and `ln` are the two logarithmic bases,
 * `symlog` maps sign(x)·log10(1+|x|/C) so zero and negative values keep a
 * finite, readable position, and `power` is sign(x)·|x|^p (p = 0.5 is the
 * square-root scale Minitab and Origin both offer).
 */
export type AxisScale = 'linear' | 'log10' | 'ln' | 'symlog' | 'power';
export type TickDirection = 'in' | 'out' | 'both' | 'none';
export type CrossAt = 'auto' | 'zero' | number;
export type LegendPosition = 'top-right' | 'top-left' | 'bottom' | 'right' | 'none';
export type ExportFormat = 'svg' | 'png';
export type PhysicalUnit = 'mm' | 'in';
export type ExportBackground = 'transparent' | 'white' | 'current';

/** The chart frame: everything that is drawn outside or behind the data. */
export interface ChartMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ChartAppearance {
  /** Chart style preset; the app UI theme is decoupled from this. */
  preset: ChartStylePresetId;
  /** Page background behind the whole frame; 'transparent' keeps the app surface. */
  chartBg: string;
  /** Plot-area background. */
  plotBg: string;
  fontFamily: string;
  fontSize: number;
  title: string;
  subtitle: string;
  titleVisible: boolean;
  axisColor: string;
  tickColor: string;
  labelColor: string;
  gridColor: string;
  borderWidth: number;
  width: number;
  height: number;
  /** width / height, used when an explicit width or height is missing. */
  aspectRatio: number;
  margins: ChartMargins;
}

/**
 * A break in an axis: the stretch between `from` and `to` is not drawn to
 * scale. It occupies `size` pixels so the reader can see that something was
 * omitted, and both remaining segments keep their own scale.
 */
export interface AxisBreakConfig {
  from: number;
  to: number;
  /** Pixel width reserved for the omitted stretch (4 … 60). */
  size: number;
}

export type DateAxisUnit = 'day' | 'week' | 'month' | 'year';
export type DateAxisFormat = 'date' | 'month-year' | 'year';

/**
 * A date/time axis for a numeric axis whose values count `unit`s from `epoch`
 * (milliseconds since 1970-01-01T00:00:00Z). `epoch` 0 with unit `day` is a
 * Julian-day-like axis, which is what a worksheet date serial turns into.
 */
export interface DateAxisConfig {
  epoch: number;
  unit: DateAxisUnit;
  format: DateAxisFormat;
}

/** Extra right-hand scale (the second Y axis of a scatter/line chart). */
export interface SecondaryAxisConfig {
  title: string;
  unit: string;
  min: number | null;
  max: number | null;
  decimals: number | null;
  showGrid: boolean;
}

/** One axis: range, scale, ticks, grid and formatting. */
export interface AxisConfig {
  autoRange: boolean;
  min: number | null;
  max: number | null;
  majorInterval: number | null;
  minorInterval: number | null;
  /** Exactly this many major ticks (2 … 20); null keeps the nice-number rule. */
  tickCount: number | null;
  /** Explicit major tick values; an empty list keeps the computed ones. */
  tickValues: number[];
  /** Minor ticks between two major ticks (1 … 20). */
  minorTickCount: number | null;
  /** Compressed (omitted) stretch, or null for a continuous axis. */
  axisBreak: AxisBreakConfig | null;
  /** Exponent of the power scale. */
  power: number;
  /** C of the symmetrical-log transform (positive). */
  logConstant: number;
  /** Tick length in pixels; null keeps the preset length. */
  tickLength: number | null;
  /** Draw the axis line itself. */
  showAxisLine: boolean;
  /** Draw the tick labels (ticks themselves follow `tickDirection`). */
  showTickLabels: boolean;
  /** Date/time labels over a numeric axis, or null for plain numbers. */
  dateAxis: DateAxisConfig | null;
  /** Right-hand scale for series marked `secondary`. */
  secondary: SecondaryAxisConfig | null;
  scale: AxisScale;
  reverse: boolean;
  title: string;
  unit: string;
  decimals: number | null;
  scientific: boolean;
  thousandsSep: boolean;
  tickDirection: TickDirection;
  showMajorGrid: boolean;
  showMinorGrid: boolean;
  /** Extra fraction of the data range kept beyond the extremes (0 like Minitab). */
  axisMargin: number;
  crossAt: CrossAt;
  /** Probability-plot grid on the value axis (normal probability plots). */
  probGrid?: boolean;
  /** Staged control limits: draw limits per stage instead of one set. */
  stageMode?: boolean;
  /** Explicit category order for bar/Pareto charts. */
  categoryOrder?: string[];
}

export interface SeriesOverride {
  color?: string;
  lineWidth?: number;
  lineDash?: string;
  markerShape?: MarkerShape;
  markerSize?: number;
  visible?: boolean;
}

export interface SeriesStyle {
  lineWidth: number;
  lineDash: string;
  markerShape: MarkerShape;
  markerSize: number;
  /** Colour cycle, overriding the preset palette. */
  palette: string[];
  fillOpacity: number;
  /** Per-series overrides keyed by series index. */
  perSeries?: Record<number, SeriesOverride>;
}

export interface LegendConfig {
  visible: boolean;
  position: LegendPosition;
  fontSize: number;
  showBackground: boolean;
}

export interface GridConfig {
  majorX: boolean;
  majorY: boolean;
  minorX: boolean;
  minorY: boolean;
  color: string;
  width: number;
  dash: string;
}

export interface ReferenceLineConfig {
  id: string;
  axis: 'x' | 'y';
  value: number;
  label: string;
  color: string;
  width: number;
  dash: string;
  visible: boolean;
}

/** Export options for SVG/PNG (the PNG rasteriser is wired in Phase 2). */
export interface ExportConfig {
  format: ExportFormat;
  dpi: number;
  widthPx: number;
  heightPx: number;
  physicalWidth: number;
  physicalHeight: number;
  physicalUnit: PhysicalUnit;
  background: ExportBackground;
  includeTitle: boolean;
  includeLegend: boolean;
}

export type ContourResolution = 'draft' | 'standard' | 'high' | 'ultra';
export type ContourRenderMode = 'lines' | 'filled' | 'filled-lines' | 'heatmap-continuous' | 'heatmap-discrete';
export type ContourColormap =
  | 'viridis'
  | 'cividis'
  | 'plasma'
  | 'inferno'
  | 'turbo'
  | 'coolwarm'
  | 'rdbu'
  | 'grayscale'
  | 'sigrun-classic';
export type ContourLevelMode = 'auto' | 'manual' | 'custom';
export type ColorbarMode = 'continuous' | 'discrete';
export type ColorbarPosition = 'right' | 'bottom' | 'left';

/** One explicit stop of a user-defined colour map (value in data units). */
export interface ContourColorStop {
  value: number;
  color: string;
}

/** Per-level overrides for one contour band / line. */
export interface ContourLevelStyle {
  /** Band index from the bottom (0 = lowest band). */
  index: number;
  /** Fill colour of this band (overrides the palette). */
  color?: string;
  /** Stroke colour of this level's line. */
  lineColor?: string;
  lineWidth?: number;
  lineDash?: string;
  /** Print this level's value beside its line. */
  showLabel?: boolean;
}

export type MaskedRegionStyle = 'blank' | 'hatch' | 'gray';

export interface ContourConfig {
  resolution: ContourResolution;
  renderMode: ContourRenderMode;
  colormap: ContourColormap;
  zMin: number | null;
  zMax: number | null;
  levelMode: ContourLevelMode;
  levelCount: number;
  levelInterval: number | null;
  customLevels: number[];
  colorbarMode: ColorbarMode;
  colorbarTitle: string;
  colorbarUnit: string;
  colorbarPosition: ColorbarPosition;
  showContourLabels: boolean;
  lineWidth: number;
  lineColor: string;
  showPoints: boolean;
  targetValue: number | null;
  targetTolerance: number | null;
  specLsl: number | null;
  specUsl: number | null;
  showSpecRegion: boolean;
  /** User colour map: absolute stops, used instead of `colormap` when set. */
  customStops: ContourColorStop[];
  /** Per-level colour / line width / dash / label overrides. */
  levelStyles: ContourLevelStyle[];
  /** Colour for values below zMin / above zMax (empty = clamp to the palette). */
  underflowColor: string;
  overflowColor: string;
  /** How a masked (NaN) region is drawn. */
  maskedStyle: MaskedRegionStyle;
  labelFontSize: number;
  labelDecimals: number | null;
}

/* ── 3D surface (WO-03) ──────────────────────────────────────────────── */

export type SurfaceRenderMode = 'surface' | 'wireframe' | 'both';
export type SurfaceProjection = 'perspective' | 'orthographic';
export type SurfaceViewPreset = 'isometric' | 'top' | 'front' | 'side' | 'free';
export type SurfaceBackground = 'surface' | 'white' | 'dark';

/** Where the virtual camera stands; degrees, camera units, zoom and pan. */
export interface SurfaceCameraConfig {
  /** Rotation about the Z axis, degrees (0 = looking along −X towards the origin). */
  azimuth: number;
  /** Angle above the XY plane, degrees (2…89). */
  elevation: number;
  /** 0.4 … 3; 1 is the framed default. */
  zoom: number;
  /** Screen-space pan, in fractions of the plot box (−1 … 1). */
  panX: number;
  panY: number;
}

export interface SurfaceViewConfig {
  renderMode: SurfaceRenderMode;
  /** Colour map for the surface and its colourbar. */
  colormap: ContourColormap;
  /** Grid points per axis preset for the surface mesh. */
  resolution: ContourResolution;
  /** Surface fill opacity (0.1 … 1). */
  opacity: number;
  /** Draw a mesh line every N grid cells (1 = every cell). */
  meshDensity: number;
  meshLineWidth: number;
  lighting: boolean;
  lightAzimuth: number;
  lightElevation: number;
  /** Base brightness that reaches a face turned away from the light. */
  ambient: number;
  /** Extra brightness of a face turned towards the light. */
  diffuse: number;
  /** Project iso-lines onto the XY floor of the box. */
  showFloorContours: boolean;
  floorLevelCount: number;
  /** Vertical exaggeration of the Z axis. */
  zScale: number;
  colorbar: boolean;
  background: SurfaceBackground;
  showPoints: boolean;
  showAxes: boolean;
  projection: SurfaceProjection;
  camera: SurfaceCameraConfig;
}

/* ── overlaid contour (WO-04) ────────────────────────────────────────── */

/** Which prediction the specification limits are compared with. */
export type FeasibleBasis = 'mean' | 'confidence' | 'prediction';

export interface FeasibleConfig {
  basis: FeasibleBasis;
  /**
   * Specification limits per response, keyed by response name. The drawer edits
   * these; a response missing here keeps the limits the chart was built with.
   */
  specs: { name: string; lsl: number | null; usl: number | null; target: number | null }[];
  /** 1 − confidence for the interval bases (0.05 → 95 %). */
  alpha: number;
  /** Tint each response's own satisfied region. */
  showResponseRegions: boolean;
  /** Draw each response's LSL / USL / target iso-lines. */
  showSpecLines: boolean;
  /** Tint the joint feasible region. */
  showFeasible: boolean;
  /** Hatch the region where at least one response misses its spec. */
  hatchUnfeasible: boolean;
  showPoints: boolean;
  resolution: ContourResolution;
  colorbar: boolean;
  /** Print the feasible area ratio on the plot. */
  showRatio: boolean;
}

/** How a fitted response-surface model is viewed (factor pair, units, points). */
export interface RsmViewConfig {
  xFactorIndex: number;
  yFactorIndex: number;
  /** Holding values (in `unitMode`) for the factors that are not on the axes. */
  holdingValues: Record<number, number>;
  unitMode: 'coded' | 'actual';
  /** Display range per factor index, in the selected unit mode. */
  factorRanges: Record<number, { min: number; max: number }>;
  showExperimentalPoints: boolean;
  showStationaryPoint: boolean;
  showOptimalPoint: boolean;
}

/* ── per-chart option blocks (WO-08) ──────────────────────────────────── */

export type HistogramType = 'frequency' | 'relative' | 'density';

export interface ScatterOptions {
  showRegression: boolean;
  showMeanCi: boolean;
  showPredictionBand: boolean;
  showEquation: boolean;
  showR2: boolean;
  markerShape: MarkerShape;
  markerSize: number;
  showDataLabels: boolean;
  logX: boolean;
  logY: boolean;
}

export interface HistogramOptions {
  binCount: number | null;
  binWidth: number | null;
  binStart: number | null;
  type: HistogramType;
  showFittedCurve: boolean;
  showSpecLines: boolean;
  showMean: boolean;
  showMedian: boolean;
}

export type BoxWhiskerRule = 'iqr' | 'minmax' | 'p5_95';

export interface BoxplotOptions {
  orientation: 'vertical' | 'horizontal';
  showOutliers: boolean;
  whiskerRule: BoxWhiskerRule;
  showMean: boolean;
  showPoints: boolean;
  perGroupColor: boolean;
}

export interface SpcOptions {
  showLimits: boolean;
  showCenter: boolean;
  showViolations: boolean;
  showSpecLines: boolean;
  showStagedLimits: boolean;
  /** Show only observations [from, to] (1-based, inclusive). */
  observationWindow: { from: number; to: number } | null;
  showDataLabels: boolean;
}

export interface CapabilityOptions {
  showWithinCurve: boolean;
  showOverallCurve: boolean;
  showLsl: boolean;
  showUsl: boolean;
  showTarget: boolean;
  shadeOutOfSpec: boolean;
  binCount: number | null;
  binWidth: number | null;
  statsPlacement: 'below' | 'inside' | 'none';
}

export interface ProbplotOptions {
  showProbGrid: boolean;
  showCi: boolean;
  showFitLine: boolean;
  pointShape: MarkerShape;
  pointSize: number;
}

export interface LineBarParetoOptions {
  showMarkers: boolean;
  showLines: boolean;
  showDataLabels: boolean;
  showLegend: boolean;
  showRefLines: boolean;
  /** Secondary Y-axis series indices for line/bar charts. */
  secondarySeries: number[];
  perGroupColor: boolean;
}

/* ── advanced series options (Stage 3D, WO-08) ───────────────────────── */

export type ErrorBarKind = 'none' | 'sd' | 'se' | 'ci';

/**
 * Error bars computed from the series' own points.
 *
 * - `sd`  the sample standard deviation (n − 1 denominator)
 * - `se`  sd / √n
 * - `ci`  mean ± t(1 − conf/2, n − 1) · se   (two-sided, Student t)
 *
 * Every drawn value is a documented statistic, not an estimate read off the
 * picture: `tests/error-bars.test.ts` and `qa/cases/QA-X-stage3d-errorbars.json`
 * check it against SciPy.
 */
export interface ErrorBarConfig {
  kind: ErrorBarKind;
  /** `point` uses each point's replicates; `series` uses all the series' values. */
  scope: 'point' | 'series';
  /** Two-sided confidence level for `ci` (0.5 … 0.999). */
  conf: number;
  /** Half-width of the end caps in pixels. */
  capWidth: number;
  color: string;
  /** Series indices the bars apply to; empty means every series. */
  series: number[];
}

/** Per-point override (individual point style). */
export interface PointStyle {
  shape?: MarkerShape;
  size?: number;
  color?: string;
}

export interface SeriesAdvancedConfig {
  /** Fill the area between the line and the x axis (or between two lines). */
  areaFill: boolean;
  areaOpacity: number;
  /** Vertical drop lines from each point to the x axis. */
  dropLines: boolean;
  dropLineColor: string;
  dropLineDash: string;
  errorBars: ErrorBarConfig;
  /** Display order of series indices (missing indices follow in order). */
  order: number[];
  /** Series indices drawn against the right-hand (secondary) scale. */
  secondarySeries: number[];
  /** Point overrides keyed by point index (one series: point order). */
  pointStyles: Record<number, PointStyle>;
}

export interface ChartConfig {
  appearance?: Partial<ChartAppearance>;
  xAxis?: Partial<AxisConfig>;
  yAxis?: Partial<AxisConfig>;
  series?: Partial<SeriesStyle>;
  legend?: Partial<LegendConfig>;
  grid?: Partial<GridConfig>;
  referenceLines?: ReferenceLineConfig[];
  export?: Partial<ExportConfig>;
  contour?: Partial<ContourConfig>;
  rsm?: Partial<RsmViewConfig>;
  surface?: Partial<SurfaceViewConfig>;
  feasible?: Partial<FeasibleConfig>;
  scatter?: Partial<ScatterOptions>;
  histogram?: Partial<HistogramOptions>;
  boxplot?: Partial<BoxplotOptions>;
  spc?: Partial<SpcOptions>;
  capability?: Partial<CapabilityOptions>;
  probplot?: Partial<ProbplotOptions>;
  lineBarPareto?: Partial<LineBarParetoOptions>;
  /**
   * Advanced series options. The error-bar block is itself partial here: a
   * drawer writes one field at a time and the guards fill the rest, exactly as
   * they do for every other block.
   */
  seriesAdvanced?: Partial<Omit<SeriesAdvancedConfig, 'errorBars'>> & { errorBars?: Partial<ErrorBarConfig> };
}

/* ── defaults ─────────────────────────────────────────────────────────── */

export const DEFAULT_CHART_PRESET: ChartStylePresetId = 'engineering';

export function defaultChartAppearance(): ChartAppearance {
  return {
    preset: DEFAULT_CHART_PRESET,
    chartBg: 'transparent',
    plotBg: 'transparent',
    fontFamily: '',
    fontSize: 10.5,
    title: '',
    subtitle: '',
    titleVisible: true,
    axisColor: '',
    tickColor: '',
    labelColor: '',
    gridColor: '',
    borderWidth: 1,
    width: 560,
    height: 0,
    aspectRatio: 1.6,
    margins: { top: 18, right: 20, bottom: 42, left: 54 },
  };
}

export function defaultAxisConfig(): AxisConfig {
  return {
    autoRange: true,
    min: null,
    max: null,
    majorInterval: null,
    minorInterval: null,
    scale: 'linear',
    reverse: false,
    title: '',
    unit: '',
    decimals: null,
    scientific: false,
    thousandsSep: false,
    tickDirection: 'out',
    showMajorGrid: true,
    showMinorGrid: false,
    axisMargin: 0.06,
    crossAt: 'auto',
    tickCount: null,
    tickValues: [],
    minorTickCount: null,
    axisBreak: null,
    power: 0.5,
    logConstant: 1,
    tickLength: null,
    showAxisLine: true,
    showTickLabels: true,
    dateAxis: null,
    secondary: null,
  };
}

export function defaultSeriesStyle(): SeriesStyle {
  return { lineWidth: 1.7, lineDash: '', markerShape: 'circle', markerSize: 3.1, palette: [], fillOpacity: 0.72 };
}

export function defaultLegendConfig(): LegendConfig {
  return { visible: true, position: 'top-right', fontSize: 8.6, showBackground: true };
}

export function defaultGridConfig(): GridConfig {
  return { majorX: false, majorY: true, minorX: false, minorY: false, color: '', width: 1, dash: '' };
}

export function defaultExportConfig(): ExportConfig {
  return {
    format: 'svg',
    dpi: 300,
    widthPx: 0,
    heightPx: 0,
    physicalWidth: 160,
    physicalHeight: 100,
    physicalUnit: 'mm',
    background: 'current',
    includeTitle: true,
    includeLegend: true,
  };
}

export function defaultContourConfig(): ContourConfig {
  return {
    resolution: 'standard',
    renderMode: 'filled-lines',
    colormap: 'sigrun-classic',
    zMin: null,
    zMax: null,
    levelMode: 'auto',
    levelCount: 10,
    levelInterval: null,
    customLevels: [],
    colorbarMode: 'discrete',
    colorbarTitle: '',
    colorbarUnit: '',
    colorbarPosition: 'right',
    showContourLabels: false,
    lineWidth: 1,
    lineColor: '',
    showPoints: true,
    targetValue: null,
    targetTolerance: null,
    specLsl: null,
    specUsl: null,
    showSpecRegion: false,
    customStops: [],
    levelStyles: [],
    underflowColor: '',
    overflowColor: '',
    maskedStyle: 'blank',
    labelFontSize: 7.4,
    labelDecimals: null,
  };
}

export function defaultErrorBarConfig(): ErrorBarConfig {
  return { kind: 'none', scope: 'point', conf: 0.95, capWidth: 3, color: '', series: [] };
}

export function defaultSeriesAdvancedConfig(): SeriesAdvancedConfig {
  return {
    areaFill: false,
    areaOpacity: 0.22,
    dropLines: false,
    dropLineColor: '',
    dropLineDash: '',
    errorBars: defaultErrorBarConfig(),
    order: [],
    secondarySeries: [],
    pointStyles: {},
  };
}

export function defaultSurfaceViewConfig(): SurfaceViewConfig {
  return {
    renderMode: 'both',
    colormap: 'sigrun-classic',
    resolution: 'standard',
    opacity: 0.92,
    meshDensity: 8,
    meshLineWidth: 0.6,
    lighting: true,
    lightAzimuth: 135,
    lightElevation: 55,
    ambient: 0.52,
    diffuse: 0.52,
    showFloorContours: false,
    floorLevelCount: 8,
    zScale: 1,
    colorbar: true,
    background: 'surface',
    showPoints: true,
    showAxes: true,
    projection: 'perspective',
    camera: { azimuth: -55, elevation: 28, zoom: 1, panX: 0, panY: 0 },
  };
}

export function defaultFeasibleConfig(): FeasibleConfig {
  return {
    basis: 'mean',
    specs: [],
    alpha: 0.05,
    showResponseRegions: true,
    showSpecLines: true,
    showFeasible: true,
    hatchUnfeasible: false,
    showPoints: true,
    resolution: 'standard',
    colorbar: true,
    showRatio: true,
  };
}

export function defaultRsmViewConfig(): RsmViewConfig {
  return {
    xFactorIndex: 0,
    yFactorIndex: 1,
    holdingValues: {},
    unitMode: 'coded',
    factorRanges: {},
    showExperimentalPoints: true,
    showStationaryPoint: true,
    showOptimalPoint: false,
  };
}

export function defaultScatterOptions(): ScatterOptions {
  return {
    showRegression: true,
    showMeanCi: false,
    showPredictionBand: false,
    showEquation: false,
    showR2: true,
    markerShape: 'circle',
    markerSize: 3.1,
    showDataLabels: false,
    logX: false,
    logY: false,
  };
}

export function defaultHistogramOptions(): HistogramOptions {
  return {
    binCount: null,
    binWidth: null,
    binStart: null,
    type: 'frequency',
    showFittedCurve: false,
    showSpecLines: true,
    showMean: false,
    showMedian: false,
  };
}

export function defaultBoxplotOptions(): BoxplotOptions {
  return {
    orientation: 'vertical',
    showOutliers: true,
    whiskerRule: 'iqr',
    showMean: true,
    showPoints: false,
    perGroupColor: true,
  };
}

export function defaultSpcOptions(): SpcOptions {
  return {
    showLimits: true,
    showCenter: true,
    showViolations: true,
    showSpecLines: false,
    showStagedLimits: true,
    observationWindow: null,
    showDataLabels: false,
  };
}

export function defaultCapabilityOptions(): CapabilityOptions {
  return {
    showWithinCurve: true,
    showOverallCurve: false,
    showLsl: true,
    showUsl: true,
    showTarget: true,
    shadeOutOfSpec: true,
    binCount: null,
    binWidth: null,
    statsPlacement: 'below',
  };
}

export function defaultProbplotOptions(): ProbplotOptions {
  return { showProbGrid: true, showCi: true, showFitLine: true, pointShape: 'circle', pointSize: 2.7 };
}

export function defaultLineBarParetoOptions(): LineBarParetoOptions {
  return {
    showMarkers: true,
    showLines: true,
    showDataLabels: false,
    showLegend: true,
    showRefLines: true,
    secondarySeries: [],
    perGroupColor: true,
  };
}

/** A fully populated config, used as the merge target for partial overrides. */
export function defaultChartConfig(preset: ChartStylePresetId = DEFAULT_CHART_PRESET): ChartConfig {
  return {
    appearance: { ...defaultChartAppearance(), preset },
    xAxis: defaultAxisConfig(),
    yAxis: defaultAxisConfig(),
    series: defaultSeriesStyle(),
    legend: defaultLegendConfig(),
    grid: defaultGridConfig(),
    referenceLines: [],
    export: defaultExportConfig(),
    contour: defaultContourConfig(),
    rsm: defaultRsmViewConfig(),
    surface: defaultSurfaceViewConfig(),
    feasible: defaultFeasibleConfig(),
    scatter: defaultScatterOptions(),
    histogram: defaultHistogramOptions(),
    boxplot: defaultBoxplotOptions(),
    spc: defaultSpcOptions(),
    capability: defaultCapabilityOptions(),
    probplot: defaultProbplotOptions(),
    lineBarPareto: defaultLineBarParetoOptions(),
    seriesAdvanced: defaultSeriesAdvancedConfig(),
  };
}

/** One shallow merge per block: callers may pass any subset of the fields. */
export function mergeChartConfig(base: ChartConfig | undefined, override: ChartConfig | undefined): ChartConfig {
  const merged = defaultChartConfig(override?.appearance?.preset ?? base?.appearance?.preset ?? DEFAULT_CHART_PRESET);
  const apply = (source: ChartConfig | undefined) => {
    if (!source) return;
    (Object.keys(source) as (keyof ChartConfig)[]).forEach((key) => {
      const value = source[key];
      if (value === undefined) return;
      if (key === 'referenceLines') {
        merged.referenceLines = value as ReferenceLineConfig[];
        return;
      }
      if (value && typeof value === 'object') {
        (merged as Record<string, unknown>)[key] = {
          ...((merged as Record<string, unknown>)[key] as object),
          ...(value as object),
        };
      } else {
        (merged as Record<string, unknown>)[key] = value;
      }
    });
  };
  apply(base);
  apply(override);
  return merged;
}

/** True for a finite number (config values frequently come back as NaN/null). */
export function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
