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
export type AxisScale = 'linear' | 'log10';
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

/** One axis: range, scale, ticks, grid and formatting. */
export interface AxisConfig {
  autoRange: boolean;
  min: number | null;
  max: number | null;
  majorInterval: number | null;
  minorInterval: number | null;
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
