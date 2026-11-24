/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — interactive SVG charts

   Phase 1 engine:
   · every render call owns its context (no module-level width / clip counter)
   · one axis + tick engine for linear and log10 scales, with formatting that
     keeps micro measurements and large-offset variation readable
   · a professional style preset per chart (the app theme is separate)
   · semantic `data-chart-role` hooks and `data-chart-*` values for Phase 2 UI
   · contour plots from src/lib/contour.ts
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartBand, ChartSpec } from '../types';
import { normalInv, normalPdf } from './dist';
import { mean, stdev } from './stats';
import { fmt } from './format';
import {
  defaultBoxplotOptions,
  defaultCapabilityOptions,
  defaultChartAppearance,
  defaultContourConfig,
  defaultHistogramOptions,
  defaultLineBarParetoOptions,
  defaultProbplotOptions,
  defaultScatterOptions,
  defaultSpcOptions,
  mergeChartConfig,
} from './chartConfig';
import type {
  AxisConfig,
  AxisScale,
  BoxplotOptions,
  CapabilityOptions,
  ChartAppearance,
  ChartConfig,
  ContourConfig,
  HistogramOptions,
  HistogramType,
  LineBarParetoOptions,
  MarkerShape,
  ProbplotOptions,
  ScatterOptions,
  SpcOptions,
} from './chartConfig';
import {
  resolveChartStyle,
  resolveStandaloneSvg,
  seriesColor,
  seriesDash,
  seriesMarker,
  type ResolvedChartStyle,
} from './chartStyles';
import { sanitizeChartConfig } from './chartGuards';
import {
  bandColor,
  bandPolygons,
  computeContourLevels,
  contourPolylines,
  gridFiniteCells,
  gridZExtent,
  marchingSquares,
  stitchSegments,
  polygonsToPath,
  polylinesToPath,
  sampleColormap,
} from './contour';
import type { ContourGrid } from './contour';
import {
  feasibleOptions,
  overlaidLegendSvg,
  renderOverlaidPicture,
  renderSurfacePicture,
  surfaceOptions,
  surfacePaintStyle,
} from './chartStage3b';

const FS = 10.5;
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/* ── public surface ───────────────────────────────────────────────────── */

export interface RenderOptions {
  width?: number;
  height?: number;
  preset?: string;
  config?: ChartConfig;
}

export interface ChartWarning {
  code: string;
  message: string;
}

export interface Tick {
  value: number;
  label: string;
}

export interface TickOptions {
  count?: number;
  scale?: AxisScale;
  decimals?: number | null;
  scientific?: boolean;
  thousandsSep?: boolean;
  /** Explicit major step (overrides the nice-number rule). */
  step?: number | null;
}

export interface TickSet {
  ticks: Tick[];
  step: number;
  warning?: ChartWarning;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface RenderContext {
  readonly W: number;
  readonly H: number;
  readonly id: string;
  readonly style: ResolvedChartStyle;
  readonly config: ChartConfig;
  readonly appearance: ChartAppearance;
  readonly rawConfig: ChartConfig;
  defs: string[];
  clipCount: number;
  warnings: ChartWarning[];
}

/* ── utilities ────────────────────────────────────────────────────────── */

/** XML/SVG escape for text and attribute values. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function niceStep(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

function withThousands(text: string): string {
  const [intPart, rest] = text.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const digits = sign ? intPart.slice(1) : intPart;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${rest !== undefined ? `.${rest}` : ''}`;
}

/** Decimal places needed for a step to be represented exactly (0.25 → 2). */
function decimalsForStep(step: number): number {
  const abs = Math.abs(step);
  if (!isFinite(abs) || abs <= 0) return 0;
  if (abs >= 1) {
    // Steps like 2 or 5 need no decimals, 2.5 needs one.
    for (let d = 0; d <= 6; d += 1) {
      if (Math.abs(Number(abs.toFixed(d)) - abs) < 1e-12 * Math.max(1, abs)) return d;
    }
    return 0;
  }
  for (let d = 1; d <= 12; d += 1) {
    if (Math.abs(Number(abs.toFixed(d)) - abs) < 1e-12) return d;
  }
  return 12;
}

function scientific(value: number, step: number): string {
  if (value === 0) return '0';
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / 10 ** exponent;
  const stepMantissa = Math.abs(step) / 10 ** exponent;
  const decimals = Math.min(12, decimalsForStep(stepMantissa));
  const rounded = mantissa.toFixed(decimals);
  return `${rounded}e${exponent}`;
}

/**
 * Axis label formatter.
 *
 * The formatter looks at BOTH the magnitude and the tick step:
 *  - 1.2e-6 … 1.8e-6 (step 1e-7) becomes 1.2e-6 … 1.8e-6, never 0.0000
 *  - 1000000.001 … 1000000.005 (step 0.001) keeps its decimals, never 1.0M
 *  - a million-scale axis with a million-scale step may abbreviate to 1.0M
 */
export function formatTickValue(
  value: number,
  step: number,
  options: { decimals?: number | null; scientific?: boolean; thousandsSep?: boolean } = {},
): string {
  if (!isFinite(value)) return '';
  if (Math.abs(value) < 1e-12) return '0';
  const absValue = Math.abs(value);
  const absStep = Math.abs(step) || absValue || 1;
  const sep = options.thousandsSep === true;
  const fixed = (decimals: number) => {
    const text = value.toFixed(Math.max(0, Math.min(12, decimals)));
    const trimmed = text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return sep ? withThousands(trimmed) : trimmed;
  };
  if (options.scientific) return scientific(value, absStep);
  if (absValue >= 1e6 && absStep >= 1e5) {
    const scaledStep = absStep / 1e6;
    const decimals = options.decimals != null
      ? options.decimals
      : Math.max(1, Math.min(3, Math.ceil(-Math.log10(scaledStep) - 1e-9)));
    return `${(value / 1e6).toFixed(decimals)}M`;
  }
  if (absStep < 1e-4 || absValue < 1e-4) return scientific(value, absStep);
  const decimals = options.decimals != null ? options.decimals : decimalsForStep(absStep);
  return fixed(decimals);
}

function logLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e-3 && abs < 1e5) {
    return String(Number(value.toPrecision(6)));
  }
  return scientific(value, abs * 0.1);
}

function linearTicks(min: number, max: number, count: number, stepOverride?: number | null): { values: number[]; step: number } {
  if (!isFinite(min) || !isFinite(max)) return { values: [0], step: 1 };
  if (min === max) { min -= 0.5; max += 0.5; }
  if (min > max) [min, max] = [max, min];
  // A span beyond the double range (−1e308 … 1e308) is infinite: fall back to
  // the magnitude so the step stays a real number.
  const span = max - min;
  const raw = Number.isFinite(span) ? span / Math.max(1, count) : Math.max(Math.abs(min), Math.abs(max)) / Math.max(1, count);
  let step = stepOverride != null && stepOverride > 0 ? stepOverride : niceStep(raw);
  if (!isFinite(step) || step <= 0) step = 1;
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const values: number[] = [];
  const maxTicks = 64;
  for (let v = start; v <= end + step * 1e-6 && values.length < maxTicks; v += step) {
    if (!isFinite(v)) break;
    const rounded = Math.abs(v) < step * 1e-6 ? 0 : Number(v.toPrecision(14));
    if (!isFinite(rounded)) break;
    if (!values.length || Math.abs(rounded - values[values.length - 1]) > step * 1e-9) values.push(rounded);
  }
  if (values.length > maxTicks) values.length = maxTicks;
  return { values: values.length > 1 ? values : [min, max], step };
}

function logTicks(min: number, max: number, count: number): { values: number[]; step: number } {
  const lo = Math.log10(Math.max(min, Number.MIN_VALUE));
  const hi = Math.log10(Math.max(max, Number.MIN_VALUE));
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) {
    return { values: [min, max].filter((v) => v > 0), step: Math.max(min, 1) };
  }
  const decades = hi - lo;
  const values: number[] = [];
  const maxTicks = 64;
  if (decades >= 2) {
    const stride = Math.max(1, Math.ceil(decades / 12));
    for (let e = Math.floor(lo); e <= Math.ceil(hi) && values.length < maxTicks; e += stride) {
      values.push(Number((10 ** e).toPrecision(6)));
    }
    return { values, step: 10 ** (Math.floor(lo) + stride) - 10 ** Math.floor(lo) };
  }
  // Less than two decades: 1-2-5 multiples inside the range, or evenly spaced
  // log steps when only one multiple fits.
  const base = 10 ** Math.floor(lo);
  for (const m of [1, 2, 5]) {
    const v = m * base;
    if (v >= min * (1 - 1e-12) && v <= max * (1 + 1e-12)) values.push(Number(v.toPrecision(6)));
  }
  if (values.length < 2) {
    const n = Math.max(2, Math.min(8, count));
    values.length = 0;
    for (let i = 0; i < n; i += 1) values.push(Number((10 ** (lo + ((hi - lo) * i) / (n - 1))).toPrecision(6)));
  }
  return { values: [...new Set(values)].sort((a, b) => a - b), step: values[1] > values[0] ? values[1] - values[0] : 1 };
}

/** Unified tick computation for linear and log10 axes (bounded at 64 ticks). */
export function computeAxisTicks(min: number, max: number, options: TickOptions = {}): TickSet {
  const count = Math.max(2, Math.min(20, options.count ?? 5));
  const scale = options.scale ?? 'linear';
  if (scale === 'log10') {
    if (!(max > 0)) {
      return { ticks: [], step: 1, warning: { code: 'log-nonpositive', message: 'Log scale needs positive values.' } };
    }
    const lowPositive = min > 0 ? min : Number.MIN_VALUE;
    const { values } = logTicks(lowPositive, max, count);
    const ticks = values.map((value) => ({ value, label: logLabel(value) }));
    return {
      ticks,
      step: values.length > 1 ? values[1] - values[0] : 1,
      ...(min <= 0 ? { warning: { code: 'log-nonpositive', message: 'Non-positive values are not shown on a log axis.' } } : {}),
    };
  }
  const { values, step } = linearTicks(min, max, count, options.step);
  const labelOpts = { decimals: options.decimals ?? null, scientific: options.scientific, thousandsSep: options.thousandsSep };
  // Guarantee unique labels: raise the precision until neighbouring ticks
  // separate, so 1000000.001 and 1000000.002 never both print "1.0M".
  let baseDecimals = options.decimals ?? null;
  let labels = values.map((value) => formatTickValue(value, step, { ...labelOpts, decimals: baseDecimals }));
  let guard = 0;
  while (new Set(labels).size < labels.length && guard < 8) {
    baseDecimals = (baseDecimals ?? decimalsForStep(step)) + 1;
    labels = values.map((value) => formatTickValue(value, step, { ...labelOpts, decimals: baseDecimals }));
    guard += 1;
  }
  const seen = new Set<string>();
  const ticks: Tick[] = [];
  values.forEach((value, i) => {
    const label = labels[i];
    if (seen.has(label)) return;
    seen.add(label);
    ticks.push({ value, label });
  });
  return { ticks, step };
}

/** Backwards-compatible tick values (brackets the domain). */
export function ticks(min: number, max: number, count = 5): number[] {
  return computeAxisTicks(min, max, { count, scale: 'linear' }).ticks.map((tick) => tick.value);
}

export function mapScale(value: number, scale: AxisScale): number {
  if (scale === 'log10') return value > 0 ? Math.log10(value) : NaN;
  return value;
}

function extent(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return [0, 1];
  if (min === max) {
    const delta = Math.abs(min) * 0.05 || 0.5;
    return [min - delta, max + delta];
  }
  return [min, max];
}

function pad([min, max]: [number, number], frac = 0.06): [number, number] {
  if (min === max) return [min - 0.5, max + 0.5];
  const span = max - min || 1;
  return [min - span * frac, max + span * frac];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function truncate(text: string, len: number): string {
  return text.length > len ? `${text.slice(0, len - 1)}…` : text;
}

function px(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '0';
}

/* ── context ──────────────────────────────────────────────────────────── */

const DEFAULT_HEIGHTS: Record<ChartSpec['kind'], number> = {
  histogram: 250,
  line: 250,
  bar: 240,
  contour: 300,
  probplot: 280,
  boxplot: 250,
  scatter: 260,
  timeseries: 250,
  normalprob: 280,
  control: 240,
  pareto: 270,
  capability: 300,
  interval: 240,
  surface3d: 380,
  overlaid: 320,
};

let renderSequence = 0;

function createContext(spec: ChartSpec, options: RenderOptions): RenderContext {
  renderSequence += 1;
  const raw = options.config ? mergeChartConfig(spec.config, options.config) : (spec.config ?? {});
  // Every hostile value (NaN, Infinity, a reversed range, an unknown preset)
  // becomes a sane default here, before any renderer multiplies it into a
  // coordinate.
  const config = sanitizeChartConfig(mergeChartConfig(undefined, raw));
  const appearance: ChartAppearance = { ...defaultChartAppearance(), ...(config.appearance ?? {}) };
  if (options.preset) appearance.preset = options.preset as ChartAppearance['preset'];
  const resolved = resolveChartStyle(appearance.preset, appearance);
  // A palette or line/marker default on the config overrides the preset for
  // every series; per-series overrides are applied by the renderers.
  const style: ResolvedChartStyle = {
    ...resolved,
    series: config.series?.palette?.length ? [...config.series.palette] : resolved.series,
    lineWidth: config.series?.lineWidth ?? resolved.lineWidth,
    markerSize: config.series?.markerSize ?? resolved.markerSize,
    axisWidth: raw.appearance?.borderWidth != null && Number.isFinite(raw.appearance.borderWidth)
      ? raw.appearance.borderWidth
      : resolved.axisWidth,
  };
  const width = options.width && options.width > 260 ? options.width : (appearance.width > 260 ? appearance.width : 560);
  const height = options.height && options.height > 80
    ? options.height
    : (appearance.height > 80 ? appearance.height : (spec.height ?? DEFAULT_HEIGHTS[spec.kind] ?? 250));
  return {
    W: Math.round(width),
    H: Math.round(height),
    id: `sigrun-${renderSequence}`,
    style,
    config,
    appearance,
    rawConfig: raw,
    defs: [],
    clipCount: 0,
    warnings: [],
  };
}

function nextClip(ctx: RenderContext, box: Box): string {
  ctx.clipCount += 1;
  const id = `sigrun-clip-${ctx.id}-${ctx.clipCount}`;
  ctx.defs.push(`<clipPath id="${id}"><rect x="${px(box.x)}" y="${px(box.y)}" width="${px(box.w)}" height="${px(box.h)}"/></clipPath>`);
  return id;
}

function emptyChart(ctx: RenderContext, label: string, message = 'No finite data to plot'): string {
  return `<title>${esc(label)}</title><text class="chart-empty" data-chart-role="chart-empty" x="${px(ctx.W / 2)}" y="${px(ctx.H / 2)}" text-anchor="middle" font-size="${FS + 1}" fill="${esc(ctx.style.labelColor)}">${esc(message)}</text>`;
}

/* ── primitives ───────────────────────────────────────────────────────── */

function openSvg(ctx: RenderContext, label: string, warnings: ChartWarning[]): string {
  const warningAttr = warnings.length ? ` data-warning="${esc(warnings.map((w) => w.code).join(' '))}"` : '';
  return `<svg class="chart-svg" data-chart-style="${esc(ctx.style.id)}"${warningAttr} width="100%" height="${ctx.H}" viewBox="0 0 ${ctx.W} ${ctx.H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">`;
}

function background(ctx: RenderContext): string {
  if (!ctx.style.chartBg || ctx.style.chartBg === 'transparent') return '';
  return `<rect data-chart-role="chart-bg" x="0" y="0" width="${ctx.W}" height="${ctx.H}" fill="${esc(ctx.style.chartBg)}"/>`;
}

function plotBackground(ctx: RenderContext, box: Box): string {
  if (!ctx.style.plotBg || ctx.style.plotBg === 'transparent' || ctx.style.plotBg === ctx.style.chartBg) return '';
  return `<rect data-chart-role="chart-plot-bg" x="${px(box.x)}" y="${px(box.y)}" width="${px(box.w)}" height="${px(box.h)}" fill="${esc(ctx.style.plotBg)}"/>`;
}

function titleBlock(ctx: RenderContext, spec: ChartSpec): string {
  const appearance = ctx.rawConfig.appearance;
  const show = ctx.appearance.titleVisible !== false;
  // A chart with no explicit title keeps the one the analysis gave it.
  const heading = appearance?.title || spec.title || '';
  const subtitle = appearance?.subtitle || spec.subtitle || '';
  if (!show || (!heading && !subtitle)) return '';
  let g = `<g data-chart-role="title">`;
  if (heading) {
    g += `<text x="${px(ctx.W / 2)}" y="13" text-anchor="middle" font-family="${esc(ctx.style.titleFontFamily)}" font-size="${ctx.style.titleSize}" font-weight="600" fill="${esc(ctx.style.inkColor)}">${esc(heading)}</text>`;
  }
  if (subtitle) {
    g += `<text x="${px(ctx.W / 2)}" y="${heading ? 26 : 13}" text-anchor="middle" font-size="${ctx.style.fontSize - 0.5}" fill="${esc(ctx.style.labelColor)}">${esc(subtitle)}</text>`;
  }
  return `${g}</g>`;
}

function warningBanner(ctx: RenderContext, warnings: ChartWarning[]): string {
  if (!warnings.length) return '';
  const message = warnings[0].message;
  const width = Math.min(ctx.W - 16, 12 + message.length * 5.1);
  const x = ctx.W - width - 8;
  return `<g data-chart-role="chart-warning" data-warning="${esc(warnings[0].code)}">`
    + `<rect x="${px(x)}" y="2" width="${px(width)}" height="15" rx="3" fill="${esc(ctx.style.surfaceColor)}" opacity="0.92" stroke="${esc(ctx.style.alarmColor)}" stroke-width="0.8"/>`
    + `<text x="${px(x + 6)}" y="13" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8.4" fill="${esc(ctx.style.alarmColor)}">${esc(truncate(message, 84))}</text>`
    + `</g>`;
}

function marker(shape: MarkerShape, cx: number, cy: number, r: number, fill: string, extra = ''): string {
  switch (shape) {
    case 'none': return '';
    case 'square':
      return `<rect x="${px(cx - r)}" y="${px(cy - r)}" width="${px(2 * r)}" height="${px(2 * r)}" fill="${esc(fill)}"${extra}/>`;
    case 'triangle':
      return `<polygon points="${px(cx)},${px(cy - r * 1.1)} ${px(cx + r)},${px(cy + r * 0.8)} ${px(cx - r)},${px(cy + r * 0.8)}" fill="${esc(fill)}"${extra}/>`;
    case 'diamond':
      return `<polygon points="${px(cx)},${px(cy - r * 1.2)} ${px(cx + r * 1.2)},${px(cy)} ${px(cx)},${px(cy + r * 1.2)} ${px(cx - r * 1.2)},${px(cy)}" fill="${esc(fill)}"${extra}/>`;
    case 'cross':
      return `<path d="M${px(cx - r)} ${px(cy - r)}L${px(cx + r)} ${px(cy + r)}M${px(cx + r)} ${px(cy - r)}L${px(cx - r)} ${px(cy + r)}" stroke="${esc(fill)}" stroke-width="1.6" fill="none"${extra}/>`;
    case 'circle':
    default:
      return `<circle cx="${px(cx)}" cy="${px(cy)}" r="${px(r)}" fill="${esc(fill)}"${extra}/>`;
  }
}

function specVLine(box: Box, x: number, label: string, color: string, slot = 0, dash = '4 3'): string {
  if (!isFinite(x)) return '';
  const xp = Math.min(box.x + box.w - 0.5, Math.max(box.x + 0.5, x));
  const anchor = xp > box.x + box.w - 70 ? 'end' : 'start';
  const dx = anchor === 'end' ? -3 : 3;
  const y = box.y + 8 + (slot % 3) * 10;
  return `<line class="spec-line" x1="${px(xp)}" y1="${px(box.y)}" x2="${px(xp)}" y2="${px(box.y + box.h)}" stroke="${esc(color)}" stroke-width="1.2" stroke-dasharray="${dash}" opacity="0.95"/>`
    + `<text x="${px(xp + dx)}" y="${px(y)}" text-anchor="${anchor}" font-family="${MONO_FONT}" font-size="8" fill="${esc(color)}">${esc(label)}</text>`;
}

function hLine(box: Box, yPos: number, label: string, color: string, dash = '4 3'): string {
  if (!isFinite(yPos)) return '';
  return `<line class="spec-line-h" x1="${px(box.x)}" y1="${px(yPos)}" x2="${px(box.x + box.w)}" y2="${px(yPos)}" stroke="${esc(color)}" stroke-width="1.2" stroke-dasharray="${dash}" opacity="0.9"/>`
    + (label ? `<text x="${px(box.x + box.w - 2)}" y="${px(yPos - 3)}" text-anchor="end" font-family="${MONO_FONT}" font-size="8" fill="${esc(color)}">${esc(label)}</text>` : '');
}

interface LegendEntry { label: string; color: string; dash?: string; shape?: MarkerShape }

interface LegendGeometry {
  position: string;
  fontSize: number;
  width: number;
  height: number;
  left: number;
  top: number;
  shown: LegendEntry[];
}

/**
 * Where the legend sits and how much of the frame it needs.
 *
 * `right` and `bottom` keep the legend out of the data area: the renderer takes
 * the same reserve out of its plot box before the axes are built, so a legend
 * never covers a point or a contour band again.
 */
function legendGeometry(ctx: RenderContext, box: Box, entries: LegendEntry[], options: { position?: string; fontSize?: number } = {}): LegendGeometry {
  const position = options.position ?? ctx.config.legend?.position ?? 'top-right';
  const shown = entries.slice(0, 10);
  const fontSize = options.fontSize ?? ctx.config.legend?.fontSize ?? 8.6;
  const longest = Math.max(0, ...shown.map((entry) => Math.min(24, entry.label.length)));
  const width = Math.min(Math.max(52, box.w * 0.68), 30 + longest * fontSize * 0.56);
  const rows = shown.length + (entries.length > shown.length ? 1 : 0);
  const height = rows * (fontSize + 3) + 5;
  if (position === 'right') {
    return { position, fontSize, width, height, left: box.x + box.w + 12, top: box.y + 2, shown };
  }
  if (position === 'bottom') {
    return { position, fontSize, width, height, left: box.x + Math.max(2, (box.w - width) / 2), top: box.y + box.h + 34, shown };
  }
  const top = position.startsWith('bottom') ? box.y + box.h - height - 6 : box.y + 6;
  const left = position.endsWith('left') ? box.x + 6 : box.x + box.w - width - 6;
  return { position, fontSize, width, height, left, top, shown };
}

/** Plot-box space a legend needs outside the data area (0 for inside corners). */
function legendReserve(ctx: RenderContext, entries: LegendEntry[], options: { fontSize?: number } = {}): { right: number; bottom: number } {
  const position = ctx.config.legend?.position ?? 'top-right';
  if (position === 'none' || ctx.config.legend?.visible === false || entries.length < 2) return { right: 0, bottom: 0 };
  const prose: Box = { x: 0, y: 0, w: 560, h: 300 };
  const geo = legendGeometry(ctx, prose, entries, options);
  if (position === 'right') return { right: geo.width + 22, bottom: 0 };
  if (position === 'bottom') return { right: 0, bottom: geo.height + 44 };
  return { right: 0, bottom: 0 };
}

function legendBlock(
  ctx: RenderContext,
  box: Box,
  entries: LegendEntry[],
  options: { position?: string; fontSize?: number } = {},
): string {
  const position = options.position ?? ctx.config.legend?.position ?? 'top-right';
  if (position === 'none' || ctx.config.legend?.visible === false || entries.length < 2) return '';
  const geo = legendGeometry(ctx, box, entries, options);
  const { shown, fontSize, width, height, left, top } = geo;
  const withBackground = ctx.config.legend?.showBackground !== false;
  let g = `<g data-chart-role="legend">`;
  if (withBackground) g += `<rect x="${px(left)}" y="${px(top)}" width="${px(width)}" height="${px(height)}" rx="3" fill="${esc(ctx.style.legendBg)}" opacity="0.88" stroke="${esc(ctx.style.legendBorder)}"/>`;
  shown.forEach((entry, i) => {
    const cy = top + 9 + i * (fontSize + 3);
    if (entry.shape && entry.shape !== 'none') {
      g += marker(entry.shape, left + 8, cy - 3, 3, entry.color);
    } else {
      g += `<line x1="${px(left + 4)}" y1="${px(cy - 3)}" x2="${px(left + 14)}" y2="${px(cy - 3)}" stroke="${esc(entry.color)}" stroke-width="2" ${entry.dash ? `stroke-dasharray="${dashString(entry.dash)}"` : ''}/>`;
    }
    g += `<text x="${px(left + 18)}" y="${px(cy)}" font-size="${fontSize}" fill="${esc(ctx.style.labelColor)}">${esc(truncate(entry.label, 24))}</text>`;
  });
  if (entries.length > shown.length) {
    g += `<text x="${px(left + 6)}" y="${px(top + 9 + shown.length * (fontSize + 3))}" font-size="${fontSize}" fill="${esc(ctx.style.labelColor)}">+${entries.length - shown.length} more</text>`;
  }
  return `${g}</g>`;
}

function seriesOverride(ctx: RenderContext, index: number): {
  color: string; lineWidth: number; lineDash: string; markerShape: MarkerShape; markerSize: number; visible: boolean;
} {
  const override = ctx.config.series?.perSeries?.[index] ?? {};
  return {
    color: override.color ?? seriesColor(ctx.style, index),
    lineWidth: override.lineWidth ?? ctx.style.lineWidth,
    lineDash: override.lineDash ?? seriesDash(ctx.style, index),
    markerShape: override.markerShape ?? seriesMarker(ctx.style, index),
    markerSize: override.markerSize ?? ctx.style.markerSize,
    visible: override.visible !== false,
  };
}

function dashString(dash: string): string {
  return dash.replace(/[^0-9 .]/g, '').trim();
}

function clipGroup(ctx: RenderContext, box: Box, content: string): string {
  if (!content) return '';
  const id = nextClip(ctx, box);
  return `<g data-chart-role="plot-content" clip-path="url(#${id})">${content}</g>`;
}

/* ── axis engine ──────────────────────────────────────────────────────── */

interface AxisInfo {
  cfg: AxisConfig;
  scale: AxisScale;
  min: number;
  max: number;
  ticks: Tick[];
  step: number;
  toPixel: (value: number) => number;
  warning?: ChartWarning;
}

function axisValues(values: number[], scale: AxisScale): number[] {
  return scale === 'log10' ? values.filter((v) => v > 0) : values.filter((v) => isFinite(v));
}

function makeAxis(
  values: number[],
  cfg: AxisConfig,
  pixels: [number, number],
  options: { pad?: number; reverse?: boolean } = {},
): AxisInfo {
  const scale = cfg.scale;
  const usable = axisValues(values, scale);
  let min: number;
  let max: number;
  if (cfg.min != null && cfg.max != null && isFinite(cfg.min) && isFinite(cfg.max) && cfg.max > cfg.min) {
    min = cfg.min;
    max = cfg.max;
  } else {
    const [rawMin, rawMax] = extent(usable.length ? usable : [0, 1]);
    const fraction = options.pad ?? 0;
    const [lo, hi] = fraction > 0 ? pad([rawMin, rawMax], fraction) : [rawMin, rawMax];
    min = cfg.min != null && isFinite(cfg.min) ? cfg.min : lo;
    max = cfg.max != null && isFinite(cfg.max) ? cfg.max : hi;
  }
  if (scale === 'log10') {
    if (!(min > 0)) {
      let smallest = Number.POSITIVE_INFINITY;
      for (const value of usable) if (value > 0 && value < smallest) smallest = value;
      min = Math.max(1e-12, smallest);
    }
    if (!isFinite(min) || min <= 0) min = 1;
    if (!(max > min)) max = min * 10;
  }
  if (!(max > min)) {
    const delta = Math.abs(min) * 0.05 || 0.5;
    min -= delta;
    max += delta;
  }
  const tickSet = computeAxisTicks(min, max, {
    count: 5,
    scale,
    decimals: cfg.decimals,
    scientific: cfg.scientific,
    thousandsSep: cfg.thousandsSep,
    step: cfg.majorInterval,
  });
  const reverse = options.reverse ?? cfg.reverse;
  const lo = mapScale(min, scale);
  const hi = mapScale(max, scale);
  const [p0, p1] = pixels;
  const toPixel = (value: number): number => {
    const mapped = mapScale(value, scale);
    const t = (mapped - lo) / (hi - lo || 1);
    return reverse ? p1 - t * (p1 - p0) : p0 + t * (p1 - p0);
  };
  return { cfg, scale, min, max, ticks: tickSet.ticks, step: tickSet.step, toPixel, warning: tickSet.warning };
}

function tickDirection(cfg: AxisConfig): 'in' | 'out' | 'both' | 'none' {
  return cfg.tickDirection ?? 'out';
}

function drawAxes(
  ctx: RenderContext,
  box: Box,
  x: AxisInfo,
  y: AxisInfo,
  options: {
    xTitle?: string;
    yTitle?: string;
    hideXLabels?: boolean;
    hideYLabels?: boolean;
    xCategoryLabels?: { value: number; label: string }[];
    yTitleText?: string;
  } = {},
): string {
  const style = ctx.style;
  const grid = ctx.config.grid ?? {};
  const dirX = tickDirection(x.cfg);
  const dirY = tickDirection(y.cfg);
  const fontSize = style.fontSize;
  const tickLen = style.tickLength;
  const mono = style.monoFontFamily;
  const xAxisPixel = axisLinePixel(x.cfg.crossAt, x.step, 'x', box, x.toPixel, y.min, y.max, y.toPixel);
  const yAxisPixel = axisLinePixel(y.cfg.crossAt, y.step, 'y', box, y.toPixel, x.min, x.max, x.toPixel);
  let gridSvg = '';
  const yMarks: string[] = [];
  const yLabels: string[] = [];
  const xMarks: string[] = [];
  const xLabels: string[] = [];

  const minorGrid = (cfg: AxisConfig, info: AxisInfo, axis: 'x' | 'y'): string => {
    if (!cfg.showMinorGrid) return '';
    let out = '';
    const interval = cfg.minorInterval;
    const values: number[] = [];
    if (interval && interval > 0) {
      for (let v = info.min; v <= info.max && values.length < 80; v += interval) values.push(v);
    } else {
      const per = 5;
      for (let i = 0; i < info.ticks.length - 1; i += 1) {
        for (let k = 1; k < per; k += 1) values.push(info.ticks[i].value + ((info.ticks[i + 1].value - info.ticks[i].value) * k) / per);
      }
    }
    values.forEach((v) => {
      const p = info.toPixel(v);
      if (!isFinite(p)) return;
      if (axis === 'y' && p >= box.y - 0.1 && p <= box.y + box.h + 0.1) {
        out += `<line data-chart-role="grid-minor" x1="${px(box.x)}" y1="${px(p)}" x2="${px(box.x + box.w)}" y2="${px(p)}" stroke="${esc(style.gridColor)}" stroke-width="0.6" opacity="0.7"/>`;
      } else if (axis === 'x' && p >= box.x - 0.1 && p <= box.x + box.w + 0.1) {
        out += `<line data-chart-role="grid-minor" x1="${px(p)}" y1="${px(box.y)}" x2="${px(p)}" y2="${px(box.y + box.h)}" stroke="${esc(style.gridColor)}" stroke-width="0.6" opacity="0.7"/>`;
      }
    });
    return out;
  };

  // Grids first, behind everything the renderer draws.
  if (y.cfg.showMajorGrid !== false && grid.majorY !== false) {
    y.ticks.forEach((tick) => {
      const p = y.toPixel(tick.value);
      if (p < box.y - 0.1 || p > box.y + box.h + 0.1) return;
      gridSvg += `<line data-chart-role="grid-major" x1="${px(box.x)}" y1="${px(p)}" x2="${px(box.x + box.w)}" y2="${px(p)}" stroke="${esc(grid.color || style.gridColor)}" stroke-width="${grid.width ?? style.gridWidth}"/>`;
    });
  }
  if (grid.majorX === true) {
    x.ticks.forEach((tick) => {
      const p = x.toPixel(tick.value);
      if (p < box.x - 0.1 || p > box.x + box.w + 0.1) return;
      gridSvg += `<line data-chart-role="grid-major" x1="${px(p)}" y1="${px(box.y)}" x2="${px(p)}" y2="${px(box.y + box.h)}" stroke="${esc(grid.color || style.gridColor)}" stroke-width="${grid.width ?? style.gridWidth}"/>`;
    });
  }
  gridSvg += minorGrid(y.cfg, y, 'y') + minorGrid(x.cfg, x, 'x');

  // Ticks and their labels.
  y.ticks.forEach((tick) => {
    const p = y.toPixel(tick.value);
    if (p < box.y - 0.1 || p > box.y + box.h + 0.1) return;
    if (dirY !== 'none') {
      const sign = dirY === 'in' ? 1 : -1;
      const x1 = box.x;
      const x2 = box.x + sign * tickLen;
      yMarks.push(`<line data-chart-role="tick-y" x1="${px(x1)}" y1="${px(p)}" x2="${px(x2)}" y2="${px(p)}" stroke="${esc(style.tickColor)}" stroke-width="${style.axisWidth}"/>`);
      if (dirY === 'both') yMarks.push(`<line data-chart-role="tick-y" x1="${px(box.x)}" y1="${px(p)}" x2="${px(box.x - tickLen)}" y2="${px(p)}" stroke="${esc(style.tickColor)}" stroke-width="${style.axisWidth}"/>`);
    }
    if (!options.hideYLabels) {
      yLabels.push(`<text x="${Number((box.x - 7).toFixed(1))}" y="${px(p + 3)}" text-anchor="end" font-family="${esc(mono)}" font-size="${fontSize}" fill="${esc(style.labelColor)}">${esc(tick.label)}</text>`);
    }
  });
  x.ticks.forEach((tick) => {
    const p = x.toPixel(tick.value);
    if (p < box.x - 0.1 || p > box.x + box.w + 0.1) return;
    if (dirX !== 'none') {
      const sign = dirX === 'in' ? -1 : 1;
      xMarks.push(`<line data-chart-role="tick-x" x1="${px(p)}" y1="${px(box.y + box.h)}" x2="${px(p)}" y2="${px(box.y + box.h + sign * tickLen)}" stroke="${esc(style.tickColor)}" stroke-width="${style.axisWidth}"/>`);
      if (dirX === 'both') xMarks.push(`<line data-chart-role="tick-x" x1="${px(p)}" y1="${px(box.y + box.h)}" x2="${px(p)}" y2="${px(box.y + box.h - tickLen)}" stroke="${esc(style.tickColor)}" stroke-width="${style.axisWidth}"/>`);
    }
    if (!options.hideXLabels) {
      xLabels.push(`<text x="${px(p)}" y="${px(box.y + box.h + 16)}" text-anchor="middle" font-family="${esc(mono)}" font-size="${fontSize}" fill="${esc(style.labelColor)}">${esc(tick.label)}</text>`);
    }
  });
  (options.xCategoryLabels ?? []).forEach((entry) => {
    xLabels.push(`<text x="${px(entry.value)}" y="${px(box.y + box.h + 15)}" text-anchor="middle" font-size="${fontSize - 0.5}" fill="${esc(style.labelColor)}">${esc(entry.label)}</text>`);
  });

  // Axis lines at auto / zero / explicit crossing.
  const axisSvg = `<line data-chart-role="axis-line-x" x1="${px(box.x)}" y1="${px(xAxisPixel)}" x2="${px(box.x + box.w)}" y2="${px(xAxisPixel)}" stroke="${esc(style.axisColor)}" stroke-width="${style.axisWidth}"/>`
    + `<line data-chart-role="axis-line-y" x1="${px(yAxisPixel)}" y1="${px(box.y)}" x2="${px(yAxisPixel)}" y2="${px(box.y + box.h)}" stroke="${esc(style.axisColor)}" stroke-width="${style.axisWidth}"/>`;

  let titles = '';
  const xTitle = x.cfg.title || options.xTitle || '';
  const yTitle = y.cfg.title || options.yTitle || options.yTitleText || '';
  const unitSuffix = (cfg: AxisConfig) => (cfg.unit ? ` (${cfg.unit})` : '');
  if (xTitle) {
    titles += `<text x="${px(box.x + box.w / 2)}" y="${px(box.y + box.h + 30)}" data-chart-role="axis-title-x" text-anchor="middle" font-size="${fontSize + 0.5}" fill="${esc(style.labelColor)}">${esc(xTitle + unitSuffix(x.cfg))}</text>`;
  }
  if (yTitle) {
    titles += `<text transform="translate(${px(box.x - 42)} ${px(box.y + box.h / 2)}) rotate(-90)" data-chart-role="axis-title-y" text-anchor="middle" font-size="${fontSize + 0.5}" fill="${esc(style.labelColor)}">${esc(yTitle + unitSuffix(y.cfg))}</text>`;
  }
  // The plot region carries the mapping from a pixel to a data value, which is
  // what the hover readout and the live contour probe need.
  const plotRegion = `<rect data-chart-role="plot" data-plot-box="${px(box.x)},${px(box.y)},${px(box.w)},${px(box.h)}"`
    + ` data-x-min="${esc(x.min)}" data-x-max="${esc(x.max)}" data-y-min="${esc(y.min)}" data-y-max="${esc(y.max)}"`
    + ` fill="none" pointer-events="none"/>`;
  return `<g data-chart-role="chart-grid">${plotRegion}${gridSvg}</g>`
    + `<g data-chart-role="axis-y">${yMarks.join('')}${yLabels.join('')}</g>`
    + `<g data-chart-role="axis-x">${xMarks.join('')}${xLabels.join('')}</g>`
    + axisSvg + titles;
}

function axisLinePixel(
  crossAt: AxisConfig['crossAt'],
  step: number | undefined,
  axis: 'x' | 'y',
  box: Box,
  toPixel: (v: number) => number,
  domainMin: number,
  domainMax: number,
  otherToPixel: (v: number) => number,
): number {
  if (crossAt === 'zero') {
    const p = toPixel(0);
    const lo = axis === 'x' ? box.y : box.x;
    const hi = axis === 'x' ? box.y + box.h : box.x + box.w;
    if (p >= lo && p <= hi) return p;
    return axis === 'x' ? box.y + box.h : box.x;
  }
  if (typeof crossAt === 'number' && isFinite(crossAt)) {
    const p = toPixel(crossAt);
    const lo = axis === 'x' ? box.y : box.x;
    const hi = axis === 'x' ? box.y + box.h : box.x + box.w;
    if (p >= lo && p <= hi) return p;
  }
  void step;
  void domainMin;
  void domainMax;
  void otherToPixel;
  return axis === 'x' ? box.y + box.h : box.x;
}

/* ── histogram ────────────────────────────────────────────────────────── */

export interface HistogramCurvePoint {
  x: number;
  y: number;
}

export function histogramCurve(
  values: number[],
  bins?: number,
  steps = 120,
): { mean: number; sd: number; binWidth: number; points: HistogramCurvePoint[] } {
  const finite = values.filter((v) => isFinite(v));
  const [min, max] = extent(finite);
  const rule = histogramBins(finite, bins);
  const binWidth = (max - min) / rule.length || 1;
  const m = mean(finite);
  const s = stdev(finite);
  const points: HistogramCurvePoint[] = [];
  if (!isFinite(m) || !isFinite(s) || !(s > 0)) return { mean: m, sd: s, binWidth, points };
  for (let i = 0; i <= steps; i += 1) {
    const x = min + ((max - min) * i) / steps;
    points.push({ x, y: normalPdf(x, m, s) * finite.length * binWidth });
  }
  return { mean: m, sd: s, binWidth, points };
}

export interface BoxplotStats {
  n: number;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  lowFence: number;
  highFence: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
  mean: number;
}

export function boxplotStats(raw: number[], rule: 'iqr' | 'minmax' | 'p5_95' = 'iqr'): BoxplotStats {
  const v = raw.filter((x) => isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (!n) {
    return { n: 0, q1: NaN, median: NaN, q3: NaN, iqr: NaN, lowFence: NaN, highFence: NaN, whiskerLow: NaN, whiskerHigh: NaN, outliers: [], mean: NaN };
  }
  const q1 = quantileOf(v, 0.25);
  const median = quantileOf(v, 0.5);
  const q3 = quantileOf(v, 0.75);
  const iqr = q3 - q1;
  if (rule === 'minmax') {
    return { n, q1, median, q3, iqr, lowFence: v[0], highFence: v[n - 1], whiskerLow: v[0], whiskerHigh: v[n - 1], outliers: [], mean: mean(v) };
  }
  if (rule === 'p5_95') {
    const p5 = quantileOf(v, 0.05);
    const p95 = quantileOf(v, 0.95);
    return { n, q1, median, q3, iqr, lowFence: p5, highFence: p95, whiskerLow: p5, whiskerHigh: p95, outliers: v.filter((x) => x < p5 || x > p95), mean: mean(v) };
  }
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inner = v.filter((x) => x >= lowFence && x <= highFence);
  return {
    n,
    q1,
    median,
    q3,
    iqr,
    lowFence,
    highFence,
    whiskerLow: inner.length ? inner[0] : q1,
    whiskerHigh: inner.length ? inner[inner.length - 1] : q3,
    outliers: v.filter((x) => x < lowFence || x > highFence),
    mean: mean(v),
  };
}

export function histogramBins(values: number[], binCount?: number): { lo: number; hi: number; count: number }[] {
  const [min, max] = extent(values);
  const n = values.length || 1;
  const bins = binCount && binCount > 0 ? Math.round(binCount) : Math.max(5, Math.min(20, Math.ceil(1 + Math.log2(n))));
  const width = (max - min) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ lo: min + i * width, hi: min + (i + 1) * width, count: 0 }));
  values.forEach((v) => {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
    out[idx].count += 1;
  });
  return out;
}

function quantileOf(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n + 1) * p;
  if (h <= 1) return sorted[0];
  if (h >= n) return sorted[n - 1];
  const lo = Math.floor(h);
  return sorted[lo - 1] + (h - lo) * (sorted[lo] - sorted[lo - 1]);
}

function histogramOptions(ctx: RenderContext): HistogramOptions {
  return { ...defaultHistogramOptions(), ...(ctx.config.histogram ?? {}) };
}

function binnedCounts(
  values: number[],
  options: { binCount?: number | null; binWidth?: number | null; binStart?: number | null },
): { lo: number; hi: number; count: number }[] {
  const [min, max] = extent(values);
  const fallback = Math.max(5, Math.min(20, Math.ceil(1 + Math.log2(values.length || 1))));
  const count = options.binCount && options.binCount > 0 ? Math.round(options.binCount) : fallback;
  const width = options.binWidth && options.binWidth > 0 ? options.binWidth : (max - min) / count || 1;
  const start = options.binStart != null && isFinite(options.binStart)
    ? options.binStart
    : min;
  const bins = Math.max(1, Math.ceil((max - start) / width) + (start > min ? 1 : 0));
  const out = Array.from({ length: Math.min(200, bins) }, (_, i) => ({ lo: start + i * width, hi: start + (i + 1) * width, count: 0 }));
  values.forEach((v) => {
    const idx = Math.floor((v - start) / width);
    if (idx >= 0 && idx < out.length) out[idx].count += 1;
    else if (idx === out.length) out[out.length - 1].count += 1;
  });
  return out;
}

function drawHistogram(spec: Extract<ChartSpec, { kind: 'histogram' }>, ctx: RenderContext): string {
  const options = histogramOptions(ctx);
  const fitted = (spec.curves ?? []).filter((curve) => curve.points.length > 1);
  const h = ctx.H;
  const values = spec.values.filter((v) => isFinite(v));
  if (!values.length) return emptyChart(ctx, spec.title ?? 'Histogram');
  const bottom = fitted.length ? 56 : 42;
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 54,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 18,
    w: 0,
    h: 0,
  };
  box.w = ctx.W - box.x - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.right : 20);
  box.h = h - box.y - bottom;
  const bins = binnedCounts(values, {
    binCount: spec.bins ?? options.binCount,
    binWidth: spec.binWidth ?? options.binWidth,
    binStart: spec.binStart ?? options.binStart,
  });
  const binWidth = bins.length ? bins[0].hi - bins[0].lo : 1;
  const type: HistogramType = options.type;
  const scaleCount = (count: number) => (type === 'frequency' ? count : type === 'relative' ? count / values.length : count / (values.length * binWidth));
  const scaled = bins.map((bin) => ({ ...bin, value: scaleCount(bin.count) }));
  const maxCount = Math.max(1e-12, ...scaled.map((b) => b.value));
  const specs = [spec.lsl, spec.usl, spec.target].filter((v): v is number => typeof v === 'number' && isFinite(v));
  const curveX = (spec.curves ?? []).flatMap((curve) => curve.points.map((pt) => pt.x));
  const [rawMin, rawMax] = extent(values);
  const xMin = Math.min(rawMin, ...specs, ...curveX);
  const xMax = Math.max(rawMax, ...specs, ...curveX);
  const span = xMax - xMin || Math.max(Math.abs(xMax), 1) * 0.05;
  const padFraction = ctx.rawConfig.xAxis?.axisMargin ?? 0.04;
  const lo = xMin - span * padFraction;
  const hi = xMax + span * padFraction;
  const yMax = maxCount * 1.18;
  const xAxis = makeAxis([lo, hi], ctx.config.xAxis as AxisConfig, [box.x, box.x + box.w], { pad: 0 });
  if (ctx.rawConfig.xAxis?.min == null) { xAxis.min = lo; xAxis.max = hi; }
  xAxis.ticks = computeAxisTicks(xAxis.min, xAxis.max, { count: 6, scale: xAxis.scale, decimals: ctx.config.xAxis?.decimals, scientific: ctx.config.xAxis?.scientific, thousandsSep: ctx.config.xAxis?.thousandsSep }).ticks;
  const yAxis = makeAxis([0, yMax], ctx.config.yAxis as AxisConfig, [box.y + box.h, box.y], { pad: 0 });
  if (ctx.rawConfig.yAxis?.min == null) { yAxis.min = 0; yAxis.max = yMax; yAxis.ticks = computeAxisTicks(0, yMax, { count: 4, decimals: ctx.config.yAxis?.decimals, scientific: ctx.config.yAxis?.scientific, thousandsSep: ctx.config.yAxis?.thousandsSep }).ticks; }
  let g = plotBackground(ctx, box);
  g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.xLabel, yTitle: spec.yLabel ?? (type === 'frequency' ? 'Frequency' : type === 'relative' ? 'Proportion' : 'Density') });
  let plot = '';
  scaled.forEach((bin) => {
    if (bin.count <= 0) return;
    const loValue = xAxis.scale === 'log10' ? Math.max(bin.lo, Number.MIN_VALUE) : bin.lo;
    const hiValue = xAxis.scale === 'log10' ? Math.max(bin.hi, Number.MIN_VALUE) : bin.hi;
    const x0 = xAxis.toPixel(loValue);
    const x1 = xAxis.toPixel(hiValue);
    const y = yAxis.toPixel(bin.value);
    if (![x0, x1, y].every((v) => Number.isFinite(v))) return;
    const width = Math.max(0.8, x1 - x0 - 0.8);
    plot += `<rect class="chart-bar" data-point="1" data-chart-role="chart-bar" data-x="${esc((bin.lo + bin.hi) / 2)}" data-y="${esc(bin.value)}" x="${px(x0 + 0.4)}" y="${px(y)}" width="${px(width)}" height="${px(box.y + box.h - y)}" fill="${esc(seriesColor(ctx.style, 0))}" opacity="${ctx.config.series?.fillOpacity ?? 0.72}" rx="1.5"/>`;
  });
  if ((spec.normal || options.showFittedCurve) && values.length > 2) {
    const curve = histogramCurve(values, spec.bins ?? options.binCount ?? undefined);
    if (curve.points.length > 1) {
      // With an explicit bin width the curve must scale by that width, not by
      // the width the bin rule would have chosen.
      const widthRatio = binWidth && curve.binWidth ? binWidth / curve.binWidth : 1;
      const scaleCurve = (y: number) => widthRatio * (type === 'frequency' ? y : type === 'relative' ? y / values.length : y / (values.length * curve.binWidth));
      const points = curve.points.map((pt) => `${px(xAxis.toPixel(pt.x))},${px(yAxis.toPixel(Math.min(Math.max(yMax, 0), scaleCurve(pt.y))))}`);
      plot += `<polyline class="chart-curve" data-chart-role="chart-curve" points="${points.join(' ')}" fill="none" stroke="${esc(seriesColor(ctx.style, 0))}" stroke-width="2"/>`;
    }
  }
  (spec.curves ?? []).forEach((curve, index) => {
    if (curve.points.length < 2) return;
    const color = seriesColor(ctx.style, (curve.color ?? index + 1) % ctx.style.series.length);
    const points = curve.points.map((pt) => `${px(xAxis.toPixel(pt.x))},${px(yAxis.toPixel(clampNumber(pt.y, 0, yMax)))}`).join(' ');
    plot += `<polyline class="chart-curve" data-chart-role="chart-curve" points="${points}" fill="none" stroke="${esc(color)}" stroke-width="1.8" ${curve.dash ? `stroke-dasharray="${esc(curve.dash)}"` : ''}/>`;
  });
  g += clipGroup(ctx, box, plot);
  let legendX = box.x;
  const legendY = box.y + box.h + 40;
  spec.curves?.forEach((curve, index) => {
    if (!curve.label) return;
    const color = seriesColor(ctx.style, (curve.color ?? index + 1) % ctx.style.series.length);
    g += `<line x1="${px(legendX)}" y1="${px(legendY - 3)}" x2="${px(legendX + 14)}" y2="${px(legendY - 3)}" stroke="${esc(color)}" stroke-width="2" ${curve.dash ? `stroke-dasharray="${esc(curve.dash)}"` : ''}/>`;
    g += `<text x="${px(legendX + 18)}" y="${px(legendY)}" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${esc(curve.label)}</text>`;
    legendX += 22 + curve.label.length * 5.1;
  });
  const limits: { x: number; label: string; color: string }[] = [];
  if (options.showSpecLines) {
    if (spec.lsl != null && isFinite(spec.lsl)) limits.push({ x: xAxis.toPixel(spec.lsl), label: `LSL ${fmt(spec.lsl, 3)}`, color: seriesColor(ctx.style, 5) });
    if (spec.usl != null && isFinite(spec.usl)) limits.push({ x: xAxis.toPixel(spec.usl), label: `USL ${fmt(spec.usl, 3)}`, color: seriesColor(ctx.style, 5) });
    if (spec.target != null && isFinite(spec.target)) limits.push({ x: xAxis.toPixel(spec.target), label: `Target ${fmt(spec.target, 3)}`, color: seriesColor(ctx.style, 3) });
  }
  limits.sort((a, b) => a.x - b.x);
  limits.forEach((limit, i) => { g += specVLine(box, limit.x, limit.label, limit.color, i); });
  if (options.showMean) {
    const m = mean(values);
    g += specVLine(box, xAxis.toPixel(m), `Mean ${fmt(m, 3)}`, ctx.style.guideColor, limits.length, '6 4');
  }
  if (options.showMedian) {
    const med = quantileOf([...values].sort((a, b) => a - b), 0.5);
    g += specVLine(box, xAxis.toPixel(med), `Median ${fmt(med, 3)}`, ctx.style.inkColor, limits.length + 1, '2 3');
  }
  return g;
}

/* ── boxplot ──────────────────────────────────────────────────────────── */

function boxplotOptions(ctx: RenderContext): BoxplotOptions {
  return { ...defaultBoxplotOptions(), ...(ctx.config.boxplot ?? {}) };
}

function drawBoxplot(spec: Extract<ChartSpec, { kind: 'boxplot' }>, ctx: RenderContext): string {
  const options = boxplotOptions(ctx);
  const h = ctx.H;
  const values = spec.groups.flatMap((group) => group.values).filter((v) => isFinite(v));
  if (!values.length) return emptyChart(ctx, spec.title ?? 'Boxplot');
  const [rawMin, rawMax] = extent(values);
  const padFraction = ctx.rawConfig.yAxis?.axisMargin ?? 0.08;
  const yMin = rawMin - (rawMax - rawMin) * padFraction;
  const yMax = rawMax + (rawMax - rawMin) * padFraction;
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 54,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 18,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 74),
    h: h - 60,
  };
  const horizontal = options.orientation === 'horizontal';
  const valueValues = [yMin, yMax];
  const valueAxis = horizontal
    ? makeAxis(valueValues, ctx.config.xAxis as AxisConfig, [box.x, box.x + box.w], { pad: 0 })
    : makeAxis(valueValues, ctx.config.yAxis as AxisConfig, [box.y + box.h, box.y], { pad: 0 });
  if ((horizontal ? ctx.rawConfig.xAxis?.min : ctx.rawConfig.yAxis?.min) == null) {
    valueAxis.min = yMin;
    valueAxis.max = yMax;
    valueAxis.ticks = computeAxisTicks(yMin, yMax, { count: 5, decimals: valueAxis.cfg.decimals, scientific: valueAxis.cfg.scientific, thousandsSep: valueAxis.cfg.thousandsSep }).ticks;
  }
  const catAxis = makeAxis([0, 1], ctx.config.xAxis as AxisConfig, [box.x, box.x + box.w], { pad: 0, reverse: false });
  catAxis.ticks = [];
  let g = plotBackground(ctx, box);
  if (horizontal) {
    const xAxis = valueAxis;
    const yAxis = makeAxis([0, spec.groups.length], { ...(ctx.config.yAxis as AxisConfig) }, [box.y + box.h, box.y], { pad: 0 });
    g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.yLabel, hideYLabels: true, hideXLabels: false });
    const slot = box.h / Math.max(1, spec.groups.length);
    spec.groups.forEach((group, index) => {
      const v = [...group.values].filter((x) => isFinite(x)).sort((a, b) => a - b);
      if (!v.length) return;
      const stats = boxplotStats(v, options.whiskerRule);
      const color = seriesColor(ctx.style, options.perGroupColor ? (group.color ?? index) : 0);
      const cy = box.y + slot * (index + 0.5);
      const bw = Math.min(52, slot * 0.5);
      g += `<line class="chart-whisker" x1="${px(xAxis.toPixel(stats.whiskerLow))}" y1="${px(cy)}" x2="${px(xAxis.toPixel(stats.whiskerHigh))}" y2="${px(cy)}" stroke="${esc(ctx.style.axisColor)}" stroke-width="1.2"/>`;
      g += `<line class="chart-whisker" x1="${px(xAxis.toPixel(stats.whiskerLow))}" y1="${px(cy - bw / 4)}" x2="${px(xAxis.toPixel(stats.whiskerLow))}" y2="${px(cy + bw / 4)}" stroke="${esc(ctx.style.axisColor)}" stroke-width="1.2"/>`;
      g += `<line class="chart-whisker" x1="${px(xAxis.toPixel(stats.whiskerHigh))}" y1="${px(cy - bw / 4)}" x2="${px(xAxis.toPixel(stats.whiskerHigh))}" y2="${px(cy + bw / 4)}" stroke="${esc(ctx.style.axisColor)}" stroke-width="1.2"/>`;
      g += `<rect class="chart-box" data-chart-role="chart-box" x="${px(xAxis.toPixel(stats.q1))}" y="${px(cy - bw / 2)}" width="${px(Math.max(1, xAxis.toPixel(stats.q3) - xAxis.toPixel(stats.q1)))}" height="${px(bw)}" fill="${esc(color)}" opacity="0.18" stroke="${esc(color)}" stroke-width="1.4" rx="3"/>`;
      g += `<line class="chart-median" x1="${px(xAxis.toPixel(stats.median))}" y1="${px(cy - bw / 2)}" x2="${px(xAxis.toPixel(stats.median))}" y2="${px(cy + bw / 2)}" stroke="${esc(color)}" stroke-width="2.2"/>`;
      if (options.showMean) g += `<circle class="chart-mean" cx="${px(xAxis.toPixel(stats.mean))}" cy="${px(cy)}" r="2.4" fill="${esc(ctx.style.surfaceColor)}" stroke="${esc(color)}" stroke-width="1.4"/>`;
      if (options.showOutliers) stats.outliers.forEach((out) => {
        g += `<circle class="chart-outlier" cx="${px(xAxis.toPixel(out))}" cy="${px(cy)}" r="2.6" fill="none" stroke="${esc(ctx.style.alarmColor)}" stroke-width="1.2" opacity="0.85" data-point="1" data-chart-role="chart-outlier" data-x="${esc(out)}" data-y="${esc(out)}"><title>${esc(`Outlier ${fmt(out, 3)} · outside 1.5×IQR`)}</title></circle>`;
      });
      if (options.showPoints) v.forEach((point, pi) => {
        const jitter = ((Math.sin((index + 1) * 12.9898 + pi * 78.233) * 43758.5453) % 1) * (bw * 0.5);
        g += `<circle class="chart-point chart-point-jitter" cx="${px(xAxis.toPixel(point))}" cy="${px(cy + jitter)}" r="1.4" fill="${esc(color)}" opacity="0.45"/>`;
      });
      g += `<text x="${px(box.x - 7)}" y="${px(cy + 3)}" text-anchor="end" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${esc(truncate(group.label, 12))}</text>`;
    });
    return g;
  }
  const yAxis = valueAxis;
  g += drawAxes(ctx, box, catAxis, yAxis, { yTitle: spec.yLabel ?? 'Value', hideXLabels: true });
  let hasOutliers = false;
  const slot = box.w / Math.max(1, spec.groups.length);
  spec.groups.forEach((group, index) => {
    const v = [...group.values].filter((x) => isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return;
    const stats = boxplotStats(v, options.whiskerRule);
    const color = seriesColor(ctx.style, options.perGroupColor ? (group.color ?? index) : 0);
    const cx = box.x + slot * (index + 0.5);
    const bw = Math.min(52, slot * 0.5);
    g += `<line class="chart-whisker" data-chart-role="chart-whisker" x1="${px(cx)}" y1="${px(yAxis.toPixel(stats.whiskerHigh))}" x2="${px(cx)}" y2="${px(yAxis.toPixel(stats.whiskerLow))}" stroke="${esc(ctx.style.axisColor)}" stroke-width="1.2"/>`;
    g += `<line class="chart-whisker" x1="${px(cx - bw / 4)}" y1="${px(yAxis.toPixel(stats.whiskerHigh))}" x2="${px(cx + bw / 4)}" y2="${px(yAxis.toPixel(stats.whiskerHigh))}" stroke="${esc(ctx.style.axisColor)}" stroke-width="1.2"/>`;
    g += `<line class="chart-whisker" x1="${px(cx - bw / 4)}" y1="${px(yAxis.toPixel(stats.whiskerLow))}" x2="${px(cx + bw / 4)}" y2="${px(yAxis.toPixel(stats.whiskerLow))}" stroke="${esc(ctx.style.axisColor)}" stroke-width="1.2"/>`;
    g += `<rect class="chart-box" data-chart-role="chart-box" x="${px(cx - bw / 2)}" y="${px(yAxis.toPixel(stats.q3))}" width="${px(bw)}" height="${px(Math.max(1, yAxis.toPixel(stats.q1) - yAxis.toPixel(stats.q3)))}" fill="${esc(color)}" opacity="0.18" stroke="${esc(color)}" stroke-width="1.4" rx="3"/>`;
    g += `<line class="chart-median" data-chart-role="chart-median" x1="${px(cx - bw / 2)}" y1="${px(yAxis.toPixel(stats.median))}" x2="${px(cx + bw / 2)}" y2="${px(yAxis.toPixel(stats.median))}" stroke="${esc(color)}" stroke-width="2.2"/>`;
    if (options.showMean) g += `<circle class="chart-mean" cx="${px(cx)}" cy="${px(yAxis.toPixel(stats.mean))}" r="2.4" fill="${esc(ctx.style.surfaceColor)}" stroke="${esc(color)}" stroke-width="1.4"/>`;
    if (options.showOutliers && stats.outliers.length) hasOutliers = true;
    if (options.showOutliers) stats.outliers.forEach((out) => {
      g += `<circle class="chart-outlier" cx="${px(cx)}" cy="${px(yAxis.toPixel(out))}" r="2.6" fill="none" stroke="${esc(ctx.style.alarmColor)}" stroke-width="1.2" opacity="0.85" data-point="1" data-chart-role="chart-outlier" data-x="${esc(out)}" data-y="${esc(out)}"><title>${esc(`Outlier ${fmt(out, 3)} · outside 1.5×IQR`)}</title></circle>`;
    });
    if (options.showPoints) v.forEach((point, pi) => {
      const jitter = ((Math.sin((index + 1) * 12.9898 + pi * 78.233) * 43758.5453) % 1) * (bw * 0.55);
      g += `<circle class="chart-point chart-point-jitter" cx="${px(cx + jitter)}" cy="${px(yAxis.toPixel(point))}" r="1.4" fill="${esc(color)}" opacity="0.45"/>`;
    });
    g += `<text x="${px(cx)}" y="${px(box.y + box.h + 24)}" text-anchor="middle" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${esc(truncate(group.label, 12))}</text>`;
    g += `<text x="${px(cx)}" y="${px(box.y + box.h + 35)}" text-anchor="middle" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(ctx.style.labelColor)}">n=${v.length}</text>`;
  });
  if (hasOutliers) {
    g += `<circle cx="${px(ctx.W - 104)}" cy="9" r="2.8" fill="none" stroke="${esc(ctx.style.alarmColor)}" stroke-width="1.2"/>`;
    g += `<text x="${px(ctx.W - 97)}" y="12" font-size="8.5" fill="${esc(ctx.style.labelColor)}">Outlier · 1.5×IQR</text>`;
  }
  return g;
}

/* ── scatter ──────────────────────────────────────────────────────────── */

function scatterOptions(ctx: RenderContext): ScatterOptions {
  return { ...defaultScatterOptions(), ...(ctx.config.scatter ?? {}) };
}

function bandPolygon(bands: ChartBand[] | undefined, toX: (v: number) => number, toY: (v: number) => number): string {
  if (!bands || bands.length < 2) return '';
  const usable = bands.filter((b) => isFinite(toX(b.x)) && isFinite(toY(b.hi)) && isFinite(toY(b.lo)));
  if (usable.length < 2) return '';
  const upper = usable.map((b) => `${px(toX(b.x))},${px(toY(b.hi))}`);
  const lower = [...usable].reverse().map((b) => `${px(toX(b.x))},${px(toY(b.lo))}`);
  return `<polygon points="${upper.join(' ')} ${lower.join(' ')}"/>`;
}

function drawScatter(spec: Extract<ChartSpec, { kind: 'scatter' }>, ctx: RenderContext): string {
  const options = scatterOptions(ctx);
  const h = ctx.H;
  const series = spec.series && spec.series.length
    ? spec.series
    : spec.points.length
      ? [{ label: '', points: spec.points as { x: number; y: number }[], fit: spec.fit ?? null }]
      : [];
  const all = series.flatMap((s) => s.points);
  if (!all.length) return emptyChart(ctx, spec.title ?? 'Scatterplot');
  const groups = spec.groups ?? [];
  const multi = series.length > 1;
  const legendEntries: LegendEntry[] = spec.legend
    ? (multi
      ? series.map((s, i) => ({ label: s.label, color: seriesColor(ctx.style, i), shape: s.markerShape ?? seriesMarker(ctx.style, i) }))
      : groups.map((label, i) => ({ label, color: seriesColor(ctx.style, i), shape: options.markerShape })))
    : [];
  const reserve = legendReserve(ctx, legendEntries);
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 58,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 18,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 80) - reserve.right,
    h: h - 64 - reserve.bottom,
  };
  const xCfg = { ...(ctx.config.xAxis as AxisConfig), scale: (options.logX ? 'log10' : ctx.config.xAxis?.scale ?? 'linear') as AxisScale };
  const yCfg = { ...(ctx.config.yAxis as AxisConfig), scale: (options.logY ? 'log10' : ctx.config.yAxis?.scale ?? 'linear') as AxisScale };
  const xAxis = spec.xDomain
    ? makeAxis(spec.xDomain, { ...xCfg, min: spec.xDomain[0], max: spec.xDomain[1] }, [box.x, box.x + box.w], { pad: 0 })
    : makeAxis(all.map((p) => p.x), xCfg, [box.x, box.x + box.w], { pad: ctx.rawConfig.xAxis?.axisMargin ?? 0.05 });
  const yAxis = spec.yDomain
    ? makeAxis(spec.yDomain, { ...yCfg, min: spec.yDomain[0], max: spec.yDomain[1] }, [box.y + box.h, box.y], { pad: 0 })
    : makeAxis(all.map((p) => p.y), yCfg, [box.y + box.h, box.y], { pad: ctx.rawConfig.yAxis?.axisMargin ?? 0.08 });
  let g = plotBackground(ctx, box);
  g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.xLabel, yTitle: spec.yLabel });
  let plot = '';
  if (options.showPredictionBand) plot += `<g fill="${esc(ctx.style.bandColor)}" opacity="0.5">${bandPolygon(spec.bands?.individual, xAxis.toPixel, yAxis.toPixel)}</g>`;
  if (options.showMeanCi) plot += `<g fill="${esc(ctx.style.guideColor)}" opacity="0.22">${bandPolygon(spec.bands?.mean, xAxis.toPixel, yAxis.toPixel)}</g>`;
  series.forEach((s, si) => {
    const look = seriesOverride(ctx, si);
    if (!look.visible) return;
    const base = multi ? si : 0;
    const shape = s.markerShape ?? (multi ? look.markerShape : options.markerShape);
    s.points.forEach((p, pi) => {
      const grouped = !multi && 'g' in p && (p as { g?: string }).g;
      const idx = grouped ? groups.indexOf((p as { g?: string }).g ?? '') : base;
      const color = seriesColor(ctx.style, idx < 0 ? 0 : idx);
      const cx = xAxis.toPixel(p.x);
      const cy = yAxis.toPixel(p.y);
      if (!isFinite(cx) || !isFinite(cy)) return;
      plot += marker(shape, cx, cy, look.markerSize, color, ` opacity="0.82" class="chart-point" data-point="1" data-chart-role="chart-point" data-x="${esc(p.x)}" data-y="${esc(p.y)}"${grouped ? ` data-group="${esc((p as { g?: string }).g ?? '')}"` : ''}`);
      if (options.showDataLabels) {
        const label = s.labels?.[pi] ?? spec.pointLabels?.[pi] ?? fmt(p.y, 2);
        plot += `<text class="chart-point-label" x="${px(cx + 4)}" y="${px(cy - 4)}" font-size="7.6" fill="${esc(ctx.style.labelColor)}">${esc(label)}</text>`;
      }
    });
  });
  if (options.showRegression) {
    series.forEach((s, si) => {
      if (!s.fit) return;
      const color = multi ? seriesColor(ctx.style, si) : seriesColor(ctx.style, 4);
      const x1 = xAxis.min + (xAxis.max - xAxis.min) * 0.03;
      const x2 = xAxis.max - (xAxis.max - xAxis.min) * 0.03;
      const y1 = s.fit.intercept + s.fit.slope * x1;
      const y2 = s.fit.intercept + s.fit.slope * x2;
      plot += `<line class="chart-fit" data-chart-role="chart-fit" x1="${px(xAxis.toPixel(x1))}" y1="${px(yAxis.toPixel(y1))}" x2="${px(xAxis.toPixel(x2))}" y2="${px(yAxis.toPixel(y2))}" stroke="${esc(color)}" stroke-width="2" opacity="0.9"/>`;
    });
  }
  g += clipGroup(ctx, box, plot);
  if (spec.legend && legendEntries.length) {
    g += legendBlock(ctx, box, legendEntries);
  }
  const notes = [...(spec.notes ?? [])];
  if (options.showEquation) {
    const fit = series[0]?.fit;
    if (fit) notes.push(`y = ${fmt(fit.intercept, 4)} + ${fmt(fit.slope, 4)}x`);
  }
  if (notes.length) g += scatterNotes(ctx, box, notes);
  return g;
}

function scatterNotes(ctx: RenderContext, box: Box, notes: string[]): string {
  const width = Math.min(box.w * 0.66, 10 + Math.max(...notes.map((n) => n.length)) * 5.2);
  let g = `<rect x="${px(box.x + 6)}" y="${px(box.y + 5)}" width="${px(width)}" height="${px(notes.length * 10.6 + 5)}" rx="3" fill="${esc(ctx.style.surfaceColor)}" opacity="0.82" stroke="${esc(ctx.style.gridColor)}"/>`;
  notes.forEach((line, i) => {
    g += `<text x="${px(box.x + 11)}" y="${px(box.y + 14 + i * 10.6)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8.6" fill="${esc(ctx.style.labelColor)}">${esc(line)}</text>`;
  });
  return g;
}

/* ── time series ──────────────────────────────────────────────────────── */

function drawTimeseries(spec: Extract<ChartSpec, { kind: 'timeseries' }>, ctx: RenderContext): string {
  const options = { ...defaultLineBarParetoOptions(), ...(ctx.config.lineBarPareto ?? {}) };
  const h = ctx.H;
  const values = spec.values.filter((v) => isFinite(v));
  if (!values.length) return emptyChart(ctx, spec.title ?? 'Time series plot');
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 58,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 18,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 80),
    h: h - 62,
  };
  const refLines = [...(spec.lsl != null ? [{ y: spec.lsl, label: `LSL ${fmt(spec.lsl, 3)}` }] : []), ...(spec.usl != null ? [{ y: spec.usl, label: `USL ${fmt(spec.usl, 3)}` }] : []), ...(spec.target != null ? [{ y: spec.target, label: `Target ${fmt(spec.target, 3)}` }] : [])];
  const yValues = [...values, ...refLines.map((r) => r.y)];
  const xAxis = makeAxis([1, Math.max(2, values.length)], ctx.config.xAxis as AxisConfig, [box.x, box.x + box.w], { pad: 0 });
  const yAxis = makeAxis(yValues, ctx.config.yAxis as AxisConfig, [box.y + box.h, box.y], { pad: ctx.rawConfig.yAxis?.axisMargin ?? 0.1 });
  let g = plotBackground(ctx, box);
  g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.xLabel ?? 'Observation', yTitle: spec.yLabel });
  let plot = '';
  const tsPoints = values
    .map((v, i) => ({ v, i, x: xAxis.toPixel(i + 1), y: yAxis.toPixel(v) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (options.showLines !== false && tsPoints.length > 1) {
    const pts = tsPoints.map((p) => `${px(p.x)},${px(p.y)}`).join(' ');
    plot += `<polyline class="chart-series" data-chart-role="chart-series" points="${pts}" fill="none" stroke="${esc(seriesColor(ctx.style, 0))}" stroke-width="${ctx.config.series?.lineWidth ?? 1.6}" opacity="0.85"/>`;
  }
  if (options.showMarkers !== false) tsPoints.forEach((p) => {
    plot += marker('circle', p.x, p.y, 2.4, seriesColor(ctx.style, 0), ` class="chart-point" data-point="1" data-chart-role="chart-point" data-x="${p.i + 1}" data-y="${esc(p.v)}"`);
  });
  if (options.showDataLabels) tsPoints.forEach((p) => {
    plot += `<text x="${px(p.x + 3)}" y="${px(p.y - 4)}" font-size="7.4" fill="${esc(ctx.style.labelColor)}">${esc(fmt(p.v, 2))}</text>`;
  });
  g += clipGroup(ctx, box, plot);
  if (options.showRefLines !== false) {
    refLines.forEach((ref) => {
      g += hLine(box, yAxis.toPixel(ref.y), ref.label, ref.label.startsWith('Target') ? seriesColor(ctx.style, 3) : seriesColor(ctx.style, 5));
    });
  }
  (ctx.config.referenceLines ?? []).forEach((line) => {
    if (!line.visible) return;
    if (line.axis === 'y') g += hLine(box, yAxis.toPixel(line.value), line.label, line.color, line.dash);
    else g += specVLine(box, xAxis.toPixel(line.value), line.label, line.color);
  });
  return g;
}

/* ── probability plots ────────────────────────────────────────────────── */

function probplotOptions(ctx: RenderContext): ProbplotOptions {
  return { ...defaultProbplotOptions(), ...(ctx.config.probplot ?? {}) };
}

function drawNormalProb(spec: Extract<ChartSpec, { kind: 'normalprob' }>, ctx: RenderContext): string {
  const options = probplotOptions(ctx);
  const h = ctx.H;
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 58,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 18,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 80),
    h: h - 64,
  };
  if (!spec.points.length) return emptyChart(ctx, spec.title ?? 'Normal probability plot');
  const xs = spec.points.map((p) => p.x);
  const zs = spec.points.map((p) => p.y);
  const [xMin, xMax] = pad(extent(xs), 0.05);
  const zMin = Math.min(-2.6, ...zs) - 0.15;
  const zMax = Math.max(2.6, ...zs) + 0.15;
  const xAxis = makeAxis([xMin, xMax], { ...(ctx.config.xAxis as AxisConfig), min: xMin, max: xMax }, [box.x, box.x + box.w], { pad: 0 });
  const yAxis = makeAxis([zMin, zMax], { ...(ctx.config.yAxis as AxisConfig), min: zMin, max: zMax }, [box.y + box.h, box.y], { pad: 0 });
  let g = plotBackground(ctx, box);
  const probs = [1, 5, 10, 25, 50, 75, 90, 95, 99];
  if (options.showProbGrid) {
    probs.forEach((p) => {
      const yy = yAxis.toPixel(normalInv(p / 100));
      if (yy < box.y - 0.1 || yy > box.y + box.h + 0.1) return;
      g += `<line data-chart-role="prob-grid" x1="${px(box.x)}" y1="${px(yy)}" x2="${px(box.x + box.w)}" y2="${px(yy)}" stroke="${esc(p === 50 ? ctx.style.axisColor : ctx.style.gridColor)}" stroke-width="1" ${p === 50 ? '' : 'stroke-dasharray="3 3"'}/>`;
      g += `<text x="${px(box.x - 7)}" y="${px(yy + 3)}" text-anchor="end" font-family="${esc(ctx.style.monoFontFamily)}" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${p}</text>`;
    });
  }
  xAxis.ticks.forEach((tick) => {
    const xx = xAxis.toPixel(tick.value);
    if (xx < box.x - 0.1 || xx > box.x + box.w + 0.1) return;
    g += `<line x1="${px(xx)}" y1="${px(box.y + box.h)}" x2="${px(xx)}" y2="${px(box.y + box.h + 4)}" stroke="${esc(ctx.style.axisColor)}"/>`;
    g += `<text x="${px(xx)}" y="${px(box.y + box.h + 16)}" text-anchor="middle" font-family="${esc(ctx.style.monoFontFamily)}" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${esc(tick.label)}</text>`;
  });
  g += `<line x1="${px(box.x)}" y1="${px(box.y)}" x2="${px(box.x)}" y2="${px(box.y + box.h)}" stroke="${esc(ctx.style.axisColor)}"/>`;
  g += `<line x1="${px(box.x)}" y1="${px(box.y + box.h)}" x2="${px(box.x + box.w)}" y2="${px(box.y + box.h)}" stroke="${esc(ctx.style.axisColor)}"/>`;
  let plot = '';
  if (options.showCi && spec.ci && spec.ci.length > 1) {
    const upper = spec.ci.map((p) => `${px(xAxis.toPixel(p.x))},${px(yAxis.toPixel(p.hi))}`).join(' ');
    const lower = [...spec.ci].reverse().map((p) => `${px(xAxis.toPixel(p.x))},${px(yAxis.toPixel(p.lo))}`).join(' ');
    plot += `<polygon points="${upper} ${lower}" fill="${esc(ctx.style.bandColor)}" stroke="none"/>`;
  }
  if (options.showFitLine) {
    const fx1 = xMin + (xMax - xMin) * 0.02;
    const fx2 = xMax - (xMax - xMin) * 0.02;
    plot += `<line class="chart-fit" x1="${px(xAxis.toPixel(fx1))}" y1="${px(yAxis.toPixel(spec.fit.intercept + spec.fit.slope * fx1))}" x2="${px(xAxis.toPixel(fx2))}" y2="${px(yAxis.toPixel(spec.fit.intercept + spec.fit.slope * fx2))}" stroke="${esc(seriesColor(ctx.style, 4))}" stroke-width="2"/>`;
  }
  spec.points.forEach((p) => {
    const cx = xAxis.toPixel(p.x);
    const cy = yAxis.toPixel(p.y);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    plot += marker(options.pointShape, cx, cy, options.pointSize, seriesColor(ctx.style, 0), ` opacity="0.85" class="chart-point" data-point="1" data-chart-role="chart-point" data-x="${esc(p.x)}" data-y="${esc(p.y)}"`);
  });
  g += clipGroup(ctx, box, plot);
  g += `<text x="${px(box.x + box.w / 2)}" y="${px(box.y + box.h + 30)}" text-anchor="middle" font-size="${FS + 0.5}" fill="${esc(ctx.style.labelColor)}">${esc(spec.xLabel ?? 'Data')}</text>`;
  g += `<text transform="translate(${px(box.x - 42)} ${px(box.y + box.h / 2)}) rotate(-90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${esc(ctx.style.labelColor)}">Percent</text>`;
  if (spec.ad != null) g += `<text x="${px(box.x + box.w - 4)}" y="${px(box.y + 12)}" text-anchor="end" font-family="${esc(ctx.style.monoFontFamily)}" font-size="9" fill="${esc(ctx.style.labelColor)}">AD ${fmt(spec.ad, 3)} · P ${spec.p != null ? spec.p.toFixed(3) : '-'}</text>`;
  return g;
}

function drawProbplot(spec: Extract<ChartSpec, { kind: 'probplot' }>, ctx: RenderContext): string {
  const options = probplotOptions(ctx);
  const h = ctx.H;
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 62,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 22,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 84),
    h: h - 68,
  };
  if (!spec.points.length) return emptyChart(ctx, spec.title ?? 'Probability plot');
  const xs = spec.points.map((p) => p.x);
  const [xMin, xMax] = pad(extent(xs), 0.05);
  const yTicks = spec.yTicks && spec.yTicks.length
    ? spec.yTicks
    : [1, 5, 10, 25, 50, 75, 90, 95, 99].map((p) => ({ v: normalInv(p / 100), label: String(p) }));
  const yValues = yTicks.map((t) => t.v).concat(spec.points.map((p) => p.y));
  const yMin = Math.min(...yValues) - 0.25;
  const yMax = Math.max(...yValues) + 0.25;
  const xAxis = makeAxis([xMin, xMax], { ...(ctx.config.xAxis as AxisConfig), min: xMin, max: xMax }, [box.x, box.x + box.w], { pad: 0 });
  const yAxis = makeAxis([yMin, yMax], { ...(ctx.config.yAxis as AxisConfig), min: yMin, max: yMax }, [box.y + box.h, box.y], { pad: 0 });
  let g = plotBackground(ctx, box);
  if (options.showProbGrid) {
    yTicks.forEach((tick) => {
      const yy = yAxis.toPixel(tick.v);
      g += `<line x1="${px(box.x)}" y1="${px(yy)}" x2="${px(box.x + box.w)}" y2="${px(yy)}" stroke="${esc(tick.label === '50' ? ctx.style.axisColor : ctx.style.gridColor)}" stroke-width="1" ${tick.label === '50' ? '' : 'stroke-dasharray="3 3"'}/>`;
      g += `<text x="${px(box.x - 7)}" y="${px(yy + 3)}" text-anchor="end" font-family="${esc(ctx.style.monoFontFamily)}" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${esc(tick.label)}</text>`;
    });
  } else {
    yAxis.ticks.forEach((tick) => {
      const yy = yAxis.toPixel(tick.value);
      g += `<text x="${px(box.x - 7)}" y="${px(yy + 3)}" text-anchor="end" font-family="${esc(ctx.style.monoFontFamily)}" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${esc(tick.label)}</text>`;
    });
  }
  xAxis.ticks.forEach((tick) => {
    const xx = xAxis.toPixel(tick.value);
    if (xx < box.x - 0.1 || xx > box.x + box.w + 0.1) return;
    g += `<line x1="${px(xx)}" y1="${px(box.y + box.h)}" x2="${px(xx)}" y2="${px(box.y + box.h + 4)}" stroke="${esc(ctx.style.axisColor)}"/>`;
    g += `<text x="${px(xx)}" y="${px(box.y + box.h + 15)}" text-anchor="middle" font-family="${esc(ctx.style.monoFontFamily)}" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${esc(tick.label)}</text>`;
  });
  g += `<line x1="${px(box.x)}" y1="${px(box.y)}" x2="${px(box.x)}" y2="${px(box.y + box.h)}" stroke="${esc(ctx.style.axisColor)}"/>`;
  g += `<line x1="${px(box.x)}" y1="${px(box.y + box.h)}" x2="${px(box.x + box.w)}" y2="${px(box.y + box.h)}" stroke="${esc(ctx.style.axisColor)}"/>`;
  let plot = '';
  if (options.showCi && spec.ci && spec.ci.length > 1) {
    const upper = spec.ci.map((p) => `${px(xAxis.toPixel(p.x))},${px(yAxis.toPixel(p.hi))}`).join(' ');
    const lower = [...spec.ci].reverse().map((p) => `${px(xAxis.toPixel(p.x))},${px(yAxis.toPixel(p.lo))}`).join(' ');
    plot += `<polygon points="${upper} ${lower}" fill="${esc(ctx.style.bandColor)}" stroke="none"/>`;
  }
  if (options.showFitLine) {
    if (spec.curve && spec.curve.length > 1) {
      plot += `<polyline points="${spec.curve.map((p) => `${px(xAxis.toPixel(p.x))},${px(yAxis.toPixel(p.y))}`).join(' ')}" fill="none" stroke="${esc(seriesColor(ctx.style, 4))}" stroke-width="2"/>`;
    } else {
      const f1 = xMin + (xMax - xMin) * 0.02;
      const f2 = xMax - (xMax - xMin) * 0.02;
      plot += `<line x1="${px(xAxis.toPixel(f1))}" y1="${px(yAxis.toPixel(spec.fit.intercept + spec.fit.slope * f1))}" x2="${px(xAxis.toPixel(f2))}" y2="${px(yAxis.toPixel(spec.fit.intercept + spec.fit.slope * f2))}" stroke="${esc(seriesColor(ctx.style, 4))}" stroke-width="2"/>`;
    }
  }
  spec.points.forEach((p) => {
    const cx = xAxis.toPixel(p.x);
    const cy = yAxis.toPixel(p.y);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    plot += marker(options.pointShape, cx, cy, options.pointSize, seriesColor(ctx.style, 0), ` opacity="0.85" class="chart-point" data-point="1" data-chart-role="chart-point" data-x="${esc(p.x)}" data-y="${esc(p.y)}"`);
  });
  g += clipGroup(ctx, box, plot);
  if (spec.xLabel) g += `<text x="${px(box.x + box.w / 2)}" y="${px(box.y + box.h + 30)}" text-anchor="middle" font-size="${FS + 0.5}" fill="${esc(ctx.style.labelColor)}">${esc(spec.xLabel)}</text>`;
  if (spec.yLabel) g += `<text transform="translate(${px(box.x - 46)} ${px(box.y + box.h / 2)}) rotate(-90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${esc(ctx.style.labelColor)}">${esc(spec.yLabel)}</text>`;
  if (spec.note) g += `<text x="${px(box.x + box.w - 4)}" y="${px(box.y + 12)}" text-anchor="end" font-family="${esc(ctx.style.monoFontFamily)}" font-size="9" fill="${esc(ctx.style.labelColor)}">${esc(spec.note)}</text>`;
  return g;
}

/* ── control charts ───────────────────────────────────────────────────── */

function spcOptions(ctx: RenderContext): SpcOptions {
  return { ...defaultSpcOptions(), ...(ctx.config.spc ?? {}) };
}

function drawControl(spec: Extract<ChartSpec, { kind: 'control' }>, ctx: RenderContext): string {
  const options = spcOptions(ctx);
  const h = ctx.H;
  const panel = spec.panel;
  const window = options.observationWindow;
  const from = window ? Math.max(1, Math.floor(window.from)) : 1;
  const to = window ? Math.min(panel.points.length, Math.floor(window.to)) : panel.points.length;
  const points = panel.points.slice(from - 1, to);
  const offset = from - 1;
  if (!points.length) return emptyChart(ctx, panel.key);
  const uclAt = (i: number) => (Array.isArray(panel.ucl) ? panel.ucl[Math.min(i, panel.ucl.length - 1)] : panel.ucl);
  const lclAt = (i: number) => (Array.isArray(panel.lcl) ? panel.lcl[Math.min(i, panel.lcl.length - 1)] : panel.lcl);
  const limits: number[] = [panel.center, ...points];
  points.forEach((_, i) => { limits.push(uclAt(i + offset), lclAt(i + offset)); });
  const finite = limits.filter((v) => isFinite(v));
  if (!finite.length) return emptyChart(ctx, panel.key);
  const [lo, hi] = pad(extent(finite), 0.08);
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 60,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 22,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 84),
    h: h - 66,
  };
  const xAxis = makeAxis([1, Math.max(2, points.length)], ctx.config.xAxis as AxisConfig, [box.x, box.x + box.w], { pad: 0 });
  const yAxis = makeAxis([lo, hi], { ...(ctx.config.yAxis as AxisConfig), min: lo, max: hi }, [box.y + box.h, box.y], { pad: 0 });
  let g = plotBackground(ctx, box);
  g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.xLabel ?? 'Observation', yTitle: spec.yLabel });
  let plot = '';
  if (options.showCenter) {
    plot += `<line class="chart-center" data-chart-role="chart-center" x1="${px(box.x)}" y1="${px(yAxis.toPixel(panel.center))}" x2="${px(box.x + box.w)}" y2="${px(yAxis.toPixel(panel.center))}" stroke="${esc(seriesColor(ctx.style, 0))}" stroke-width="1.4"/>`;
  }
  if (options.showLimits) {
    if (Array.isArray(panel.ucl) && options.showStagedLimits) {
      const up = points.map((_, i) => `${px(xAxis.toPixel(i + 1))},${px(yAxis.toPixel(clampNumber(uclAt(i + offset), lo, hi)))}`).join(' ');
      const down = points.map((_, i) => `${px(xAxis.toPixel(i + 1))},${px(yAxis.toPixel(clampNumber(lclAt(i + offset), lo, hi)))}`).join(' ');
      plot += `<polyline class="chart-ucl" data-chart-role="chart-limit-upper" points="${up}" fill="none" stroke="${esc(ctx.style.alarmColor)}" stroke-width="1.1" stroke-dasharray="5 3" opacity="0.8"/>`;
      plot += `<polyline class="chart-lcl" data-chart-role="chart-limit-lower" points="${down}" fill="none" stroke="${esc(ctx.style.alarmColor)}" stroke-width="1.1" stroke-dasharray="5 3" opacity="0.8"/>`;
    } else {
      const up = Array.isArray(panel.ucl) ? uclAt(offset) : (panel.ucl as number);
      const down = Array.isArray(panel.lcl) ? lclAt(offset) : (panel.lcl as number);
      plot += `<line class="chart-ucl" data-chart-role="chart-limit-upper" x1="${px(box.x)}" y1="${px(yAxis.toPixel(up))}" x2="${px(box.x + box.w)}" y2="${px(yAxis.toPixel(up))}" stroke="${esc(ctx.style.alarmColor)}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
      plot += `<text x="${px(box.x + box.w - 2)}" y="${px(yAxis.toPixel(up) - 3)}" text-anchor="end" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(ctx.style.alarmColor)}">UCL ${fmt(up, 3)}</text>`;
      plot += `<line class="chart-lcl" data-chart-role="chart-limit-lower" x1="${px(box.x)}" y1="${px(yAxis.toPixel(down))}" x2="${px(box.x + box.w)}" y2="${px(yAxis.toPixel(down))}" stroke="${esc(ctx.style.alarmColor)}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
      plot += `<text x="${px(box.x + box.w - 2)}" y="${px(yAxis.toPixel(down) + 9)}" text-anchor="end" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(ctx.style.alarmColor)}">LCL ${fmt(down, 3)}</text>`;
    }
  }
  const ptPixels = points.map((v, i) => ({ v, i, x: xAxis.toPixel(i + 1), y: yAxis.toPixel(v) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const pts = ptPixels.map((p) => `${px(p.x)},${px(p.y)}`).join(' ');
  if (ptPixels.length > 1) plot += `<polyline class="chart-series" data-chart-role="chart-series" points="${pts}" fill="none" stroke="${esc(ctx.style.axisColor)}" stroke-width="1.2"/>`;
  const flagged = new Map<number, number[]>();
  panel.violations.forEach((violation) => { if (violation.index >= offset && violation.index < offset + points.length) flagged.set(violation.index - offset, violation.rules); });
  ptPixels.forEach(({ v, i }) => {
    const rules = options.showViolations ? flagged.get(i) : undefined;
    const color = rules ? ctx.style.alarmColor : seriesColor(ctx.style, 0);
    plot += marker('circle', xAxis.toPixel(i + 1), yAxis.toPixel(v), rules ? 3.6 : 2.6, color, ` class="chart-point${rules ? ' chart-point-alarm' : ''}" data-point="1" data-chart-role="chart-point" data-x="${i + 1}" data-y="${esc(v)}"${rules ? ` data-violation="${esc(rules.join(','))}"` : ''}${rules ? ` stroke="${esc(ctx.style.surfaceColor)}" stroke-width="1.2"` : ''}`);
    if (rules) plot += `<text x="${px(xAxis.toPixel(i + 1))}" y="${px(yAxis.toPixel(v) - 7)}" text-anchor="middle" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(ctx.style.alarmColor)}">${rules.join(',')}</text>`;
    if (options.showDataLabels) plot += `<text x="${px(xAxis.toPixel(i + 1) + 3)}" y="${px(yAxis.toPixel(v) - 4)}" font-size="7.2" fill="${esc(ctx.style.labelColor)}">${esc(fmt(v, 2))}</text>`;
  });
  if (options.showSpecLines) {
    (spec.specLines ?? []).forEach((line) => {
      if (!isFinite(line.value)) return;
      plot += hLine(box, yAxis.toPixel(line.value), line.label ?? fmt(line.value, 3), ctx.style.guideColor);
    });
  }
  (ctx.config.referenceLines ?? []).forEach((line) => {
    if (!line.visible || line.axis !== 'y') return;
    plot += hLine(box, yAxis.toPixel(line.value), line.label, line.color, line.dash);
  });
  g += clipGroup(ctx, box, plot);
  return g;
}

/* ── Pareto / bar / line / interval ───────────────────────────────────── */

function lineBarOptions(ctx: RenderContext): LineBarParetoOptions {
  return { ...defaultLineBarParetoOptions(), ...(ctx.config.lineBarPareto ?? {}) };
}

function drawPareto(spec: Extract<ChartSpec, { kind: 'pareto' }>, ctx: RenderContext): string {
  const options = lineBarOptions(ctx);
  const h = ctx.H;
  if (!spec.items.length) return emptyChart(ctx, spec.title ?? 'Pareto chart');
  const order = ctx.config.xAxis?.categoryOrder;
  const items = [...spec.items].sort((a, b) => {
    if (order && order.length) {
      const ia = order.indexOf(a.label);
      const ib = order.indexOf(b.label);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
    }
    return b.count - a.count;
  });
  const total = items.reduce((a, b) => a + b.count, 0) || 1;
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 54,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 18,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 88),
    h: h - 78,
  };
  const maxCount = Math.max(1, ...items.map((i) => i.count));
  const yAxis = makeAxis([0, maxCount * 1.1], ctx.config.yAxis as AxisConfig, [box.y + box.h, box.y], { pad: 0 });
  const catAxis = makeAxis([0, items.length], ctx.config.xAxis as AxisConfig, [box.x, box.x + box.w], { pad: 0 });
  catAxis.ticks = [];
  let g = plotBackground(ctx, box);
  g += drawAxes(ctx, box, catAxis, yAxis, { yTitle: 'Count', hideXLabels: true });
  const rightX = box.x + box.w;
  [0, 20, 40, 60, 80, 100].forEach((p) => {
    const yy = box.y + box.h - (p / 100) * box.h;
    g += `<text x="${px(rightX + 8)}" y="${px(yy + 3)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${p}%</text>`;
  });
  const slot = box.w / Math.max(1, items.length);
  const barW = Math.min(58, slot * 0.7);
  let cumulative = 0;
  const linePts: string[] = [];
  items.forEach((item, i) => {
    const cx = box.x + slot * (i + 0.5);
    const y = yAxis.toPixel(item.count);
    cumulative += item.count;
    const pct = (cumulative / total) * 100;
    g += `<rect class="chart-bar" data-point="1" data-chart-role="chart-bar" data-x="${esc(i + 1)}" data-y="${esc(item.count)}" x="${px(cx - barW / 2)}" y="${px(y)}" width="${px(barW)}" height="${px(box.y + box.h - y)}" fill="${esc(seriesColor(ctx.style, options.perGroupColor ? i : 0))}" opacity="0.82" rx="2"/>`;
    if (options.showDataLabels) g += `<text x="${px(cx)}" y="${px(y - 4)}" text-anchor="middle" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${item.count}</text>`;
    if (items.length <= 6) {
      const maxChars = Math.max(4, Math.floor(slot / 6.2));
      g += `<text x="${px(cx)}" y="${px(box.y + box.h + 13)}" text-anchor="middle" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${esc(truncate(item.label, maxChars))}</text>`;
    } else {
      g += `<text transform="translate(${px(cx)} ${px(box.y + box.h + 12)}) rotate(-16)" text-anchor="end" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${esc(truncate(item.label, 11))}</text>`;
    }
    linePts.push(`${px(cx)},${px(box.y + box.h - (pct / 100) * box.h)}`);
  });
  const threshold = spec.threshold != null && isFinite(spec.threshold) ? spec.threshold : 80;
  const eighty = box.y + box.h - (threshold / 100) * box.h;
  g += `<line x1="${px(box.x)}" y1="${px(eighty)}" x2="${px(rightX)}" y2="${px(eighty)}" stroke="${esc(seriesColor(ctx.style, 3))}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
  g += `<text x="${px(box.x + 4)}" y="${px(eighty - 4)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(seriesColor(ctx.style, 3))}">${threshold}%</text>`;
  g += `<polyline points="${linePts.join(' ')}" fill="none" stroke="${esc(seriesColor(ctx.style, 4))}" stroke-width="1.8"/>`;
  linePts.forEach((pt) => {
    const [x, y] = pt.split(',');
    g += `<circle cx="${x}" cy="${y}" r="2.6" fill="${esc(seriesColor(ctx.style, 4))}"/>`;
  });
  return g;
}

function drawBar(spec: Extract<ChartSpec, { kind: 'bar' }>, ctx: RenderContext): string {
  const options = lineBarOptions(ctx);
  const h = ctx.H;
  const items = spec.items.filter((item) => isFinite(item.value));
  if (!items.length && !(spec.groups && spec.groups.length)) return emptyChart(ctx, spec.title ?? 'Bar chart');
  const groups = spec.groups ?? [];
  const legendEntries: LegendEntry[] = options.showLegend === false || (groups.length <= 1 && !(spec.lines ?? []).length)
    ? []
    : [
      ...groups.map((group, i) => ({ label: group.label, color: seriesColor(ctx.style, group.color ?? i), shape: 'square' as MarkerShape })),
      ...(spec.lines ?? []).map((line, i) => ({ label: line.label, color: seriesColor(ctx.style, line.color ?? i + 3) })),
    ];
  const reserve = legendReserve(ctx, legendEntries);
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 58,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 22,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 80) - reserve.right,
    h: h - 62 - reserve.bottom,
  };
  const values = [
    ...items.map((i) => i.value),
    ...groups.flatMap((g) => g.values.filter((v) => isFinite(v))),
    ...(spec.refLine ? [spec.refLine.y] : []),
  ];
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const yAxis = makeAxis([lo, hi === lo ? lo + 1 : hi], ctx.config.yAxis as AxisConfig, [box.y + box.h, box.y], { pad: ctx.rawConfig.yAxis?.axisMargin ?? 0.1 });
  const lineValues = (spec.lines ?? []).flatMap((line) => line.points.map((p) => p.y));
  const y2Axis = lineValues.length
    ? makeAxis(lineValues, { ...(ctx.config.yAxis as AxisConfig), min: null, max: null }, [box.y + box.h, box.y], { pad: ctx.rawConfig.yAxis?.axisMargin ?? 0.1 })
    : null;
  const catAxis = makeAxis([0, Math.max(1, items.length || groups[0]?.values.length || 1)], ctx.config.xAxis as AxisConfig, [box.x, box.x + box.w], { pad: 0 });
  catAxis.ticks = [];
  let g = plotBackground(ctx, box);
  g += drawAxes(ctx, box, catAxis, yAxis, { yTitle: spec.yLabel, hideXLabels: true });
  if (y2Axis) {
    let right = `<g data-chart-role="axis-y2">`;
    y2Axis.ticks.forEach((tick) => {
      const p = y2Axis.toPixel(tick.value);
      if (p < box.y - 0.1 || p > box.y + box.h + 0.1) return;
      right += `<text x="${px(box.x + box.w + 7)}" y="${px(p + 3)}" text-anchor="start" font-family="${esc(ctx.style.monoFontFamily)}" font-size="${ctx.style.fontSize}" fill="${esc(ctx.style.labelColor)}">${esc(tick.label)}</text>`;
    });
    if (spec.y2Label) right += `<text transform="translate(${px(box.x + box.w + 34)} ${px(box.y + box.h / 2)}) rotate(90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${esc(ctx.style.labelColor)}">${esc(spec.y2Label)}</text>`;
    g += `${right}</g>`;
  }
  const count = items.length || groups[0]?.values.length || 0;
  const slot = box.w / Math.max(1, count);
  const groupCount = groups.length || 1;
  const barW = Math.min(58, slot * (groupCount > 1 ? 0.8 / groupCount : 0.62));
  const zero = yAxis.toPixel(clampNumber(0, yAxis.min, yAxis.max));
  const drawBarAt = (cx: number, value: number, color: string, label?: string) => {
    const y = yAxis.toPixel(value);
    let out = `<rect class="chart-bar" data-point="1" data-chart-role="chart-bar" data-y="${esc(value)}" x="${px(cx - barW / 2)}" y="${px(Math.min(y, zero))}" width="${px(barW)}" height="${px(Math.max(1, Math.abs(zero - y)))}" fill="${esc(color)}" opacity="0.82" rx="2"/>`;
    if (options.showDataLabels) out += `<text x="${px(cx)}" y="${px(Math.min(y, zero) - 4)}" text-anchor="middle" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8.5" fill="${esc(ctx.style.inkColor)}">${esc(label ?? value.toFixed(spec.decimals ?? 2))}</text>`;
    return out;
  };
  if (groups.length) {
    groups.forEach((group, gi) => {
      group.values.forEach((value, i) => {
        if (!isFinite(value)) return;
        const cx = box.x + slot * (i + 0.5) - (groupCount * barW) / 2 + barW * (gi + 0.5);
        g += drawBarAt(cx, value, seriesColor(ctx.style, group.color ?? gi));
      });
    });
    items.forEach((item, i) => {
      const cx = box.x + slot * (i + 0.5);
      g += `<text x="${px(cx)}" y="${px(box.y + box.h + 13)}" text-anchor="middle" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${esc(truncate(item.label, Math.max(4, Math.floor(slot / 6.2))))}</text>`;
    });
  } else {
    items.forEach((item, index) => {
      const look = seriesOverride(ctx, index);
      if (!look.visible) return;
      const cx = box.x + slot * (index + 0.5);
      g += drawBarAt(cx, item.value, item.color != null ? seriesColor(ctx.style, item.color) : look.color);
      const maxChars = Math.max(4, Math.floor(slot / 6.2));
      if (items.length <= 6) g += `<text x="${px(cx)}" y="${px(box.y + box.h + 13)}" text-anchor="middle" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${esc(truncate(item.label, maxChars))}</text>`;
      else g += `<text transform="translate(${px(cx)} ${px(box.y + box.h + 12)}) rotate(-16)" text-anchor="end" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${esc(truncate(item.label, 11))}</text>`;
    });
  }
  if (spec.refLine) {
    g += hLine(box, yAxis.toPixel(spec.refLine.y), spec.refLine.label ?? '', seriesColor(ctx.style, 4));
  }
  if (spec.lines && spec.lines.length) {
    spec.lines.forEach((line, li) => {
      const axis = y2Axis ?? yAxis;
      const pts = line.points.map((p) => `${px(catAxis.toPixel(p.x))},${px(axis.toPixel(p.y))}`).join(' ');
      g += `<polyline class="chart-series-secondary" points="${pts}" fill="none" stroke="${esc(seriesColor(ctx.style, line.color ?? li + 3))}" stroke-width="1.7"/>`;
    });
  }
  if (legendEntries.length) {
    g += legendBlock(ctx, box, legendEntries);
  }
  return g;
}

function drawLine(spec: Extract<ChartSpec, { kind: 'line' }>, ctx: RenderContext): string {
  const options = lineBarOptions(ctx);
  const h = ctx.H;
  const all = spec.series.flatMap((s) => s.points);
  if (!all.length) return emptyChart(ctx, spec.title ?? 'Line plot');
  const legendEntries: LegendEntry[] = options.showLegend === false
    ? []
    : spec.series.filter((s) => s.label).map((s, i) => ({ label: s.label, color: seriesColor(ctx.style, s.color ?? i), dash: s.dash, shape: s.markerShape }));
  const reserve = legendReserve(ctx, legendEntries);
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 58,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 22,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 80) - reserve.right,
    h: h - 66 - reserve.bottom,
  };
  const primary = spec.series.filter((s) => s.axis !== 'secondary');
  const secondary = spec.series.filter((s) => s.axis === 'secondary');
  const ys = (primary.length ? primary : spec.series).flatMap((s) => s.points.map((p) => p.y))
    .concat((spec.refLines ?? []).map((r) => r.y))
    .concat((spec.markers ?? []).map((m) => m.y));
  const [xMin, xMax] = pad(extent(all.map((p) => p.x)), 0.04);
  const xAxis = makeAxis([xMin, xMax], ctx.rawConfig.xAxis?.min != null ? ctx.config.xAxis as AxisConfig : { ...(ctx.config.xAxis as AxisConfig), min: xMin, max: xMax }, [box.x, box.x + box.w], { pad: ctx.rawConfig.xAxis?.axisMargin ?? 0.04 });
  const yAxis = makeAxis(ys.length ? ys : [0, 1], ctx.rawConfig.yAxis?.min != null ? ctx.config.yAxis as AxisConfig : { ...(ctx.config.yAxis as AxisConfig) }, [box.y + box.h, box.y], { pad: ctx.rawConfig.yAxis?.axisMargin ?? 0.1 });
  const y2Values = secondary.flatMap((s) => s.points.map((p) => p.y));
  const y2Axis = secondary.length
    ? makeAxis(y2Values, { ...(ctx.config.yAxis as AxisConfig), min: null, max: null }, [box.y + box.h, box.y], { pad: ctx.rawConfig.yAxis?.axisMargin ?? 0.1 })
    : null;
  let g = plotBackground(ctx, box);
  const categoryLabels = spec.xLabels && spec.xLabels.length
    ? spec.xLabels.map((label, i) => ({ value: xAxis.toPixel(i), label })).filter((entry) => entry.value >= box.x - 0.1 && entry.value <= box.x + box.w + 0.1)
    : undefined;
  g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.xLabel, yTitle: spec.yLabel, hideXLabels: Boolean(categoryLabels), xCategoryLabels: categoryLabels });
  if (y2Axis) {
    let y2 = `<g data-chart-role="axis-y2">`;
    y2Axis.ticks.forEach((tick) => {
      const p = y2Axis.toPixel(tick.value);
      if (p < box.y - 0.1 || p > box.y + box.h + 0.1) return;
      y2 += `<text x="${px(box.x + box.w + 7)}" y="${px(p + 3)}" text-anchor="start" font-family="${esc(ctx.style.monoFontFamily)}" font-size="${ctx.style.fontSize}" fill="${esc(ctx.style.labelColor)}">${esc(tick.label)}</text>`;
    });
    g += `${y2}</g>`;
  }
  let plot = '';
  (options.showRefLines !== false ? spec.refLines ?? [] : []).forEach((ref) => {
    if (!isFinite(ref.y)) return;
    plot += hLine(box, yAxis.toPixel(ref.y), ref.label ?? '', ctx.style.alarmColor);
  });
  spec.series.forEach((series, index) => {
    const look = seriesOverride(ctx, index);
    if (!look.visible) return;
    const color = series.color != null ? seriesColor(ctx.style, series.color) : look.color;
    const axis = series.axis === 'secondary' && y2Axis ? y2Axis : yAxis;
    const points = [...series.points]
      .sort((a, b) => a.x - b.x)
      .map((p) => ({ p, x: xAxis.toPixel(p.x), y: axis.toPixel(p.y) }))
      .filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y));
    if (options.showLines !== false && series.showLine !== false && points.length > 1) {
      plot += `<polyline class="chart-series" data-chart-role="chart-series" points="${points.map((entry) => `${px(entry.x)},${px(entry.y)}`).join(' ')}" fill="none" stroke="${esc(color)}" stroke-width="${look.lineWidth}" stroke-dasharray="${esc(series.dash ?? look.lineDash)}" opacity="0.95"/>`;
    }
    if (options.showMarkers !== false && series.showMarkers !== false) points.forEach((entry) => {
      plot += marker(series.markerShape ?? look.markerShape, entry.x, entry.y, look.markerSize, color, ` class="chart-point" data-point="1" data-chart-role="chart-point" data-x="${esc(entry.p.x)}" data-y="${esc(entry.p.y)}"`);
    });
    if (options.showDataLabels) points.forEach((entry) => {
      plot += `<text x="${px(entry.x + 4)}" y="${px(entry.y - 5)}" font-size="7.6" fill="${esc(ctx.style.labelColor)}">${esc(fmt(entry.p.y, 2))}</text>`;
    });
  });
  (spec.markers ?? []).forEach((markerPoint) => {
    plot += marker('circle', xAxis.toPixel(markerPoint.x), yAxis.toPixel(markerPoint.y), 4.2, 'none', ` stroke="${esc(seriesColor(ctx.style, 4))}" stroke-width="1.8"`);
    if (markerPoint.label) plot += `<text x="${px(xAxis.toPixel(markerPoint.x) + 6)}" y="${px(yAxis.toPixel(markerPoint.y) - 6)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(seriesColor(ctx.style, 4))}">${esc(markerPoint.label)}</text>`;
  });
  g += clipGroup(ctx, box, plot);
  if (spec.xLabel) g += `<text x="${px(box.x + box.w / 2)}" y="${px(box.y + box.h + 30)}" text-anchor="middle" font-size="${FS + 0.5}" fill="${esc(ctx.style.labelColor)}">${esc(spec.xLabel)}</text>`;
  if (spec.yLabel) g += `<text transform="translate(${px(box.x - 42)} ${px(box.y + box.h / 2)}) rotate(-90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${esc(ctx.style.labelColor)}">${esc(spec.yLabel)}</text>`;
  if (spec.y2Label) g += `<text transform="translate(${px(box.x + box.w + 34)} ${px(box.y + box.h / 2)}) rotate(90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${esc(ctx.style.labelColor)}">${esc(spec.y2Label)}</text>`;
  if (legendEntries.length) {
    g += legendBlock(ctx, box, legendEntries);
  }
  return g;
}

function drawInterval(spec: Extract<ChartSpec, { kind: 'interval' }>, ctx: RenderContext): string {
  const h = ctx.H;
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 62,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 18,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 86),
    h: h - 64,
  };
  const all = spec.groups.flatMap((g) => [g.lo, g.hi, g.mean]).filter((v) => isFinite(v));
  if (!all.length) return emptyChart(ctx, 'Interval plot');
  const yAxis = makeAxis(all, ctx.config.yAxis as AxisConfig, [box.y + box.h, box.y], { pad: ctx.rawConfig.yAxis?.axisMargin ?? 0.12 });
  const catAxis = makeAxis([0, spec.groups.length], ctx.config.xAxis as AxisConfig, [box.x, box.x + box.w], { pad: 0 });
  catAxis.ticks = [];
  let g = plotBackground(ctx, box);
  g += drawAxes(ctx, box, catAxis, yAxis, { yTitle: spec.yLabel, hideXLabels: true });
  const slot = box.w / Math.max(1, spec.groups.length);
  spec.groups.forEach((group, i) => {
    const cx = box.x + slot * (i + 0.5);
    const color = seriesColor(ctx.style, i);
    g += `<line x1="${px(cx)}" y1="${px(yAxis.toPixel(group.lo))}" x2="${px(cx)}" y2="${px(yAxis.toPixel(group.hi))}" stroke="${esc(color)}" stroke-width="1.6"/>`;
    g += `<line x1="${px(cx - 9)}" y1="${px(yAxis.toPixel(group.lo))}" x2="${px(cx + 9)}" y2="${px(yAxis.toPixel(group.lo))}" stroke="${esc(color)}" stroke-width="1.6"/>`;
    g += `<line x1="${px(cx - 9)}" y1="${px(yAxis.toPixel(group.hi))}" x2="${px(cx + 9)}" y2="${px(yAxis.toPixel(group.hi))}" stroke="${esc(color)}" stroke-width="1.6"/>`;
    g += `<circle cx="${px(cx)}" cy="${px(yAxis.toPixel(group.mean))}" r="3.6" fill="${esc(color)}"/>`;
    g += `<text x="${px(cx)}" y="${px(box.y + box.h + 30)}" text-anchor="middle" font-size="${FS}" fill="${esc(ctx.style.labelColor)}">${esc(truncate(group.label, 12))}</text>`;
  });
  return g;
}

/* ── capability ───────────────────────────────────────────────────────── */

function capabilityOptions(ctx: RenderContext): CapabilityOptions {
  return { ...defaultCapabilityOptions(), ...(ctx.config.capability ?? {}) };
}

function drawCapability(spec: Extract<ChartSpec, { kind: 'capability' }>, ctx: RenderContext): string {
  const options = capabilityOptions(ctx);
  const r = spec.result;
  const values = r.values.filter((v) => isFinite(v));
  const h = ctx.H;
  if (!values.length || !isFinite(r.mean)) return emptyChart(ctx, 'Process capability', 'Not enough valid data for a capability plot');
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 54,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 18,
    w: ctx.W - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left + ctx.appearance.margins.right : 74),
    h: h - 96,
  };
  const specs = [r.lsl, r.usl, r.target].filter((v): v is number => typeof v === 'number' && isFinite(v));
  const [vMin, vMax] = extent(values);
  const overallSd = isFinite(r.sdOverall) && r.sdOverall > 0 ? r.sdOverall : (vMax - vMin) / 6 || 1;
  const lo = Math.min(vMin, r.mean - 3.8 * overallSd, ...specs);
  const hi = Math.max(vMax, r.mean + 3.8 * overallSd, ...specs);
  const binCount = options.binCount && options.binCount > 0 ? Math.round(options.binCount) : Math.max(8, Math.min(22, Math.ceil(Math.sqrt(values.length)) + 4));
  const binWidth = options.binWidth && options.binWidth > 0 ? options.binWidth : (hi - lo) / binCount || 1;
  const bins = Math.max(1, Math.ceil((hi - lo) / binWidth));
  const counts = new Array<number>(bins).fill(0);
  values.forEach((v) => {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / binWidth)));
    counts[idx] += 1;
  });
  const maxCount = Math.max(1, ...counts);
  const withinSd = isFinite(r.sdWithin) && r.sdWithin > 0 ? r.sdWithin : overallSd;
  const peak = normalPdf(r.mean, r.mean, withinSd) * values.length * binWidth;
  const yMax = Math.max(maxCount, isFinite(peak) ? peak : 0) * 1.16 || 1;
  const xAxis = makeAxis([lo, hi], { ...(ctx.config.xAxis as AxisConfig), min: lo, max: hi }, [box.x, box.x + box.w], { pad: 0 });
  const yAxis = makeAxis([0, yMax], { ...(ctx.config.yAxis as AxisConfig), min: 0, max: yMax }, [box.y + box.h, box.y], { pad: 0 });
  let g = plotBackground(ctx, box);
  if (options.shadeOutOfSpec) {
    if (r.lsl != null && isFinite(r.lsl)) {
      const x0 = box.x;
      const x1 = xAxis.toPixel(r.lsl);
      if (x1 > x0) g += `<rect data-chart-role="chart-defect" x="${px(x0)}" y="${px(box.y)}" width="${px(x1 - x0)}" height="${px(box.h)}" fill="${esc(ctx.style.alarmColor)}" opacity="0.06"/>`;
    }
    if (r.usl != null && isFinite(r.usl)) {
      const x0 = xAxis.toPixel(r.usl);
      const x1 = box.x + box.w;
      if (x1 > x0) g += `<rect data-chart-role="chart-defect" x="${px(x0)}" y="${px(box.y)}" width="${px(x1 - x0)}" height="${px(box.h)}" fill="${esc(ctx.style.alarmColor)}" opacity="0.06"/>`;
    }
  }
  g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.xLabel ?? 'Measurement', yTitle: 'Frequency' });
  counts.forEach((count, i) => {
    if (!count) return;
    const binLo = lo + i * binWidth;
    const binHi = binLo + binWidth;
    const y = yAxis.toPixel(count);
    g += `<rect class="chart-bar" data-point="1" data-chart-role="chart-bar" data-x="${esc(binLo + binWidth / 2)}" data-y="${esc(count)}" x="${px(xAxis.toPixel(binLo) + 0.4)}" y="${px(y)}" width="${px(Math.max(0.8, xAxis.toPixel(binHi) - xAxis.toPixel(binLo) - 0.8))}" height="${px(box.y + box.h - y)}" fill="${esc(seriesColor(ctx.style, 0))}" opacity="0.3" rx="1.5"/>`;
  });
  const drawCurve = (sd: number, dash: string, color: string, opacity: number) => {
    const curve: string[] = [];
    for (let i = 0; i <= 160; i += 1) {
      const xv = lo + ((hi - lo) * i) / 160;
      const yv = normalPdf(xv, r.mean, sd) * values.length * binWidth;
      curve.push(`${px(xAxis.toPixel(xv))},${px(yAxis.toPixel(Math.min(yMax, yv)))}`);
    }
    return `<polyline class="chart-curve" data-chart-role="chart-curve" points="${curve.join(' ')}" fill="none" stroke="${esc(color)}" stroke-width="2" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="${opacity}"/>`;
  };
  if (options.showWithinCurve) g += drawCurve(withinSd, '', seriesColor(ctx.style, 0), 1);
  if (options.showOverallCurve) g += drawCurve(overallSd, '5 3', seriesColor(ctx.style, 4), 0.9);
  const limits: { x: number; label: string; color: string; dash: string }[] = [];
  if (options.showLsl && r.lsl !== null) limits.push({ x: xAxis.toPixel(r.lsl), label: `LSL ${fmt(r.lsl, 3)}`, color: ctx.style.alarmColor, dash: '4 3' });
  if (options.showUsl && r.usl !== null) limits.push({ x: xAxis.toPixel(r.usl), label: `USL ${fmt(r.usl, 3)}`, color: ctx.style.alarmColor, dash: '4 3' });
  if (options.showTarget && r.target !== null) limits.push({ x: xAxis.toPixel(r.target), label: `Target ${fmt(r.target, 3)}`, color: seriesColor(ctx.style, 3), dash: '4 3' });
  limits.sort((a, b) => a.x - b.x);
  limits.forEach((limit, i) => { g += specVLine(box, limit.x, limit.label, limit.color, i, limit.dash); });
  g += specVLine(box, xAxis.toPixel(r.mean), `μ ${fmt(r.mean, 3)}`, seriesColor(ctx.style, 4), limits.length, '6 4');
  const stats = [
    `Cp ${fmt(r.cp, 3)}`, `Cpk ${fmt(r.cpk, 3)}`, `Pp ${fmt(r.pp, 3)}`, `Ppk ${fmt(r.ppk, 3)}`, `Cpm ${fmt(r.cpm, 3)}`, `PPM ${fmt(r.ppmOverall, 0)}`,
  ];
  if (options.statsPlacement === 'below') {
    g += `<text x="${px(box.x)}" y="${px(box.y + box.h + 46)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="9" fill="${esc(ctx.style.labelColor)}">${esc(stats.join('   '))}</text>`;
    g += `<text x="${px(box.x)}" y="${px(box.y + box.h + 58)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="9" fill="${esc(ctx.style.labelColor)}">Within σ ${fmt(r.sdWithin, 4)}   Overall σ ${fmt(r.sdOverall, 4)}   n ${r.n}</text>`;
  } else if (options.statsPlacement === 'inside') {
    g += `<text x="${px(box.x + 4)}" y="${px(box.y + 12)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8.6" fill="${esc(ctx.style.labelColor)}">${esc(stats.join('  '))}</text>`;
  }
  return g;
}

/* ── contour ──────────────────────────────────────────────────────────── */

function contourOptions(ctx: RenderContext): ContourConfig {
  return { ...defaultContourConfig(), ...(ctx.config.contour ?? {}) };
}

function colorbar(
  ctx: RenderContext,
  cfg: ContourConfig,
  box: Box,
  zMin: number,
  zMax: number,
  count: number,
): { svg: string; reserve: number } {
  if (cfg.colorbarPosition === 'bottom') {
    const barW = Math.min(box.w, 320);
    const left = box.x + (box.w - barW) / 2;
    const top = box.y + box.h + 46;
    const height = 12;
    let svg = `<g data-chart-role="colorbar">`;
    if (cfg.colorbarMode === 'continuous') {
      const id = `sigrun-gradient-${ctx.id}`;
      const stops = Array.from({ length: 11 }, (_, i) => `<stop offset="${(i * 10).toFixed(0)}%" stop-color="${sampleColormap(cfg.colormap, i / 10)}"/>`).join('');
      ctx.defs.push(`<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient>`);
      svg += `<rect x="${px(left)}" y="${px(top)}" width="${px(barW)}" height="${height}" fill="url(#${id})" stroke="${esc(ctx.style.gridColor)}"/>`;
    } else {
      const bandW = barW / Math.max(1, count);
      for (let i = 0; i < count; i += 1) {
        svg += `<rect x="${px(left + i * bandW)}" y="${px(top)}" width="${px(bandW + 0.4)}" height="${height}" fill="${bandColor(cfg.colormap, i, count)}"/>`;
      }
      svg += `<rect x="${px(left)}" y="${px(top)}" width="${px(barW)}" height="${height}" fill="none" stroke="${esc(ctx.style.gridColor)}"/>`;
    }
    const ticks = computeAxisTicks(zMin, zMax, { count: 4 }).ticks.filter((tick) => tick.value >= zMin - 1e-9 && tick.value <= zMax + 1e-9);
    ticks.forEach((tick) => {
      const x = left + ((tick.value - zMin) / (zMax - zMin || 1)) * barW;
      svg += `<text x="${px(x)}" y="${px(top + height + 10)}" text-anchor="middle" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(ctx.style.labelColor)}">${esc(tick.label)}</text>`;
    });
    const title = [cfg.colorbarTitle, cfg.colorbarUnit].filter(Boolean).join(' · ');
    if (title) svg += `<text x="${px(left + barW / 2)}" y="${px(top - 4)}" text-anchor="middle" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${esc(title)}</text>`;
    return { svg: `${svg}</g>`, reserve: 0 };
  }
  const onLeft = cfg.colorbarPosition === 'left';
  const width = 13;
  const left = onLeft ? box.x - 42 : box.x + box.w + 14;
  const top = box.y;
  const height = box.h;
  let svg = `<g data-chart-role="colorbar">`;
  if (cfg.colorbarMode === 'continuous') {
    const id = `sigrun-gradient-${ctx.id}`;
    const stops = Array.from({ length: 11 }, (_, i) => `<stop offset="${(i * 10).toFixed(0)}%" stop-color="${sampleColormap(cfg.colormap, i / 10)}"/>`).join('');
    ctx.defs.push(`<linearGradient id="${id}" x1="0" x2="0" y1="1" y2="0">${stops}</linearGradient>`);
    svg += `<rect x="${px(left)}" y="${px(top)}" width="${width}" height="${height}" fill="url(#${id})" stroke="${esc(ctx.style.gridColor)}"/>`;
  } else {
    const bandH = height / Math.max(1, count);
    for (let i = 0; i < count; i += 1) {
      svg += `<rect x="${px(left)}" y="${px(top + height - (i + 1) * bandH)}" width="${width}" height="${px(bandH + 0.4)}" fill="${bandColor(cfg.colormap, i, count)}"/>`;
    }
    svg += `<rect x="${px(left)}" y="${px(top)}" width="${width}" height="${height}" fill="none" stroke="${esc(ctx.style.gridColor)}"/>`;
  }
  // A nice-number step can overshoot the data range; a tick outside the bar
  // would be drawn outside the frame, so only ticks inside it are labelled.
  const ticks = computeAxisTicks(zMin, zMax, { count: 4 }).ticks.filter((tick) => tick.value >= zMin - 1e-9 && tick.value <= zMax + 1e-9);
  ticks.forEach((tick) => {
    const y = top + height - ((tick.value - zMin) / (zMax - zMin || 1)) * height;
    const tx = onLeft ? left - 4 : left + width + 4;
    svg += `<text x="${px(tx)}" y="${px(y + 3)}" text-anchor="${onLeft ? 'end' : 'start'}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(ctx.style.labelColor)}">${esc(tick.label)}</text>`;
  });
  const title = [cfg.colorbarTitle, cfg.colorbarUnit].filter(Boolean).join(' · ');
  if (title) {
    const tx = onLeft ? left - 4 : left + width + 4;
    svg += `<text transform="translate(${px(tx)} ${px(top - 6)})" text-anchor="${onLeft ? 'end' : 'start'}" font-size="8.5" fill="${esc(ctx.style.labelColor)}">${esc(title)}</text>`;
  }
  return { svg: `${svg}</g>`, reserve: 42 + 14 };
}

function drawContour(spec: Extract<ChartSpec, { kind: 'contour' }>, ctx: RenderContext): string {
  const cfg = contourOptions(ctx);
  const h = ctx.H;
  if (spec.xs.length < 2 || spec.ys.length < 2) return emptyChart(ctx, spec.title ?? 'Contour plot');
  const grid: ContourGrid = { xs: spec.xs, ys: spec.ys, z: spec.z };
  // An all-NaN grid is not a constant surface: say there is nothing to draw
  // instead of colouring the frame and claiming "Constant surface 0".
  if (gridFiniteCells(grid) === 0) return emptyChart(ctx, spec.title ?? 'Contour plot', 'No finite values to contour');
  const extentZ = gridZExtent(grid);
  const levelSet = computeContourLevels(grid, {
    ...cfg,
    ...(spec.levels != null && ctx.rawConfig.contour?.levelCount == null ? { levelCount: spec.levels } : {}),
  });
  const xRange: [number, number] = spec.xRange ?? [spec.xs[0], spec.xs[spec.xs.length - 1]];
  const yRange: [number, number] = spec.yRange ?? [spec.ys[0], spec.ys[spec.ys.length - 1]];
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 58,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 22,
    w: 0,
    // A bottom colourbar needs its own 40 px strip inside the frame.
    h: h - 62 - (cfg.colorbarPosition === 'bottom' ? 40 : 0),
  };
  const barReserve = cfg.colorbarPosition === 'bottom' ? 0 : 58;
  box.w = ctx.W - box.x - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.right : 20) - barReserve;
  const xAxis = makeAxis([xRange[0], xRange[1]], { ...(ctx.config.xAxis as AxisConfig), min: xRange[0], max: xRange[1] }, [box.x, box.x + box.w], { pad: 0 });
  const yAxis = makeAxis([yRange[0], yRange[1]], { ...(ctx.config.yAxis as AxisConfig), min: yRange[0], max: yRange[1] }, [box.y + box.h, box.y], { pad: 0 });
  const bar = colorbar(ctx, cfg, box, levelSet.min || extentZ.zMin, levelSet.max || extentZ.zMax, Math.max(2, levelSet.boundaries.length - 1));
  let g = plotBackground(ctx, box);
  const extentVal = { ...extentZ };
  const bands = Math.max(2, levelSet.boundaries.length - 1);
  let plot = '';
  const mode = cfg.renderMode;
  if (extentZ.zMax - extentZ.zMin < 1e-12) {
    // A constant surface has no iso-lines: fill the frame with the mid colour
    // and say so, instead of drawing an empty plot.
    plot += `<rect data-chart-role="chart-contour-band" x="${px(box.x)}" y="${px(box.y)}" width="${px(box.w)}" height="${px(box.h)}" fill="${sampleColormap(cfg.colormap, 0.5)}"/>`;
    plot += `<text x="${px(box.x + box.w / 2)}" y="${px(box.y + box.h / 2)}" text-anchor="middle" font-size="9" fill="${esc(ctx.style.labelColor)}">Constant surface ${fmt(extentZ.zMin, 4)}</text>`;
  } else if (mode !== 'lines') {
    const continuous = mode === 'heatmap-continuous';
    const bandSet = continuous
      ? computeContourLevels(grid, { levelCount: 48 })
      : levelSet;
    const polygons = bandPolygons(grid, bandSet.boundaries);
    polygons.forEach((band) => {
      const path = polygonsToPath(band.polygons, xAxis.toPixel, yAxis.toPixel);
      if (!path) return;
      const count = Math.max(1, bandSet.boundaries.length - 1);
      plot += `<path class="chart-contour-band" data-chart-role="chart-contour-band" data-band="${band.index}" d="${path}" fill="${bandColor(cfg.colormap, band.index, count)}" stroke="none"/>`;
    });
    if (continuous) {
      // A continuous heat map draws no interior boundary lines.
    }
  }
  if (mode === 'lines' || mode === 'filled-lines') {
    const lines = contourPolylines(grid, levelSet.levels);
    lines.forEach((entry) => {
      const path = polylinesToPath(entry.lines, xAxis.toPixel, yAxis.toPixel);
      if (!path) return;
      const strong = cfg.targetValue != null && Math.abs(entry.level - cfg.targetValue) <= Math.max(1e-9, (levelSet.max - levelSet.min) * 1e-9);
      plot += `<path class="chart-contour-line" data-chart-role="chart-contour-line" data-level="${esc(entry.level)}" d="${path}" fill="none" stroke="${esc(cfg.lineColor || ctx.style.axisColor)}" stroke-width="${strong ? cfg.lineWidth + 1.4 : cfg.lineWidth}" opacity="0.8"/>`;
      if (cfg.showContourLabels) {
        entry.lines.forEach((line) => {
          const mid = line.points[Math.floor(line.points.length / 2)];
          if (!mid) return;
          plot += `<text class="chart-contour-label" data-chart-role="chart-contour-label" x="${px(xAxis.toPixel(mid.x))}" y="${px(yAxis.toPixel(mid.y) - 3)}" text-anchor="middle" font-family="${esc(ctx.style.monoFontFamily)}" font-size="7.4" fill="${esc(ctx.style.labelColor)}">${esc(formatTickValue(entry.level, (levelSet.max - levelSet.min) / Math.max(2, bands)))}</text>`;
        });
      }
    });
  }
  if (cfg.targetValue != null && isFinite(cfg.targetValue)) {
    // Highlight the exact target iso-line even when it is not one of the
    // regular levels (Minitab's "define the contour values" behaviour).
    const targetLines = stitchSegments(marchingSquares(grid, cfg.targetValue), Math.max(
      Math.abs(xRange[1] - xRange[0]), Math.abs(yRange[1] - yRange[0]), 1,
    ));
    const path = polylinesToPath(targetLines, xAxis.toPixel, yAxis.toPixel);
    if (path) plot += `<path class="chart-target-line" data-chart-role="chart-target-line" data-value="${esc(cfg.targetValue)}" d="${path}" fill="none" stroke="${esc(ctx.style.alarmColor)}" stroke-width="${cfg.lineWidth + 0.8}" stroke-dasharray="6 3" opacity="0.95"/>`;
  }
  if (cfg.showSpecRegion && cfg.specLsl != null && cfg.specUsl != null && cfg.specUsl > cfg.specLsl) {
    const region = bandPolygons(grid, [cfg.specLsl, cfg.specUsl]);
    const path = polygonsToPath(region[0]?.polygons ?? [], xAxis.toPixel, yAxis.toPixel);
    if (path) plot += `<path data-chart-role="chart-spec-region" d="${path}" fill="${esc(ctx.style.guideColor)}" opacity="0.16"/>`;
  }
  if (cfg.targetValue != null && cfg.targetTolerance != null && cfg.targetTolerance > 0) {
    const region = bandPolygons(grid, [cfg.targetValue - cfg.targetTolerance, cfg.targetValue + cfg.targetTolerance]);
    const path = polygonsToPath(region[0]?.polygons ?? [], xAxis.toPixel, yAxis.toPixel);
    if (path) plot += `<path data-chart-role="chart-target-region" d="${path}" fill="${esc(ctx.style.alarmColor)}" opacity="0.12"/>`;
  }
  if (cfg.showPoints) {
    (spec.points ?? []).forEach((point) => {
      const cx = xAxis.toPixel(point.x);
      const cy = yAxis.toPixel(point.y);
      if (point.kind === 'stationary' || point.kind === 'optimal') {
        const shape = point.kind === 'stationary' ? 'diamond' : 'cross';
        plot += marker(shape, cx, cy, 5, ctx.style.inkColor, ` data-point="1" data-chart-role="chart-point" data-kind="${point.kind}" data-x="${esc(point.x)}" data-y="${esc(point.y)}"${point.z != null && Number.isFinite(point.z) ? ` data-z="${esc(point.z)}"` : ''}${point.label ? ` data-label="${esc(point.label)}"` : ''}`);
        if (point.label) plot += `<text x="${px(cx + 7)}" y="${px(cy - 6)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(ctx.style.inkColor)}">${esc(point.label)}</text>`;
      } else {
        plot += marker('circle', cx, cy, 2.6, ctx.style.surfaceColor, ` stroke="${esc(ctx.style.inkColor)}" stroke-width="1" data-point="1" data-chart-role="chart-point" data-x="${esc(point.x)}" data-y="${esc(point.y)}"${point.z != null && Number.isFinite(point.z) ? ` data-z="${esc(point.z)}"` : ''}${point.label ? ` data-label="${esc(point.label)}"` : ''}`);
      }
    });
  }
  g += clipGroup(ctx, box, plot);
  // Grid lines, ticks and the frame sit above the filled bands: a contour plot
  // keeps its scale readable instead of hiding it under the colour fill.
  g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.xLabel, yTitle: spec.yLabel });
  g += bar.svg;
  const rangeOutside = Boolean(
    spec.rsmModel && spec.rsmModel.codedBounds.some((bound, i) => {
      const range = i === (ctx.config.rsm?.xFactorIndex ?? 0) ? xRange : i === (ctx.config.rsm?.yFactorIndex ?? 1) ? yRange : null;
      return range ? Math.min(range[0], range[1]) < bound.min - 1e-9 || Math.max(range[0], range[1]) > bound.max + 1e-9 : false;
    }),
  );
  const stationaryOutside = Boolean(spec.rsmModel?.stationary?.outsideRegion);
  if (rangeOutside || stationaryOutside) {
    const message = rangeOutside ? 'Outside design region' : 'Stationary point outside region';
    const width = 8 + message.length * 4.6;
    g += `<g data-chart-role="chart-warning" data-warning="rsm-extrapolation"><rect x="${px(box.x + 4)}" y="${px(box.y + 4)}" width="${px(width)}" height="14" rx="3" fill="${esc(ctx.style.surfaceColor)}" opacity="0.9" stroke="${esc(ctx.style.alarmColor)}" stroke-width="0.8"/><text x="${px(box.x + 8)}" y="${px(box.y + 14)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="7.8" fill="${esc(ctx.style.alarmColor)}">${esc(message)}</text></g>`;
  }
  const rangeText = `${fmt(levelSet.min || extentVal.zMin, 3)} – ${fmt(levelSet.max || extentVal.zMax, 3)}`;
  g += `<text x="${px(box.x + 4)}" y="${px(box.y - 4)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="8" fill="${esc(ctx.style.labelColor)}">${esc(rangeText)}</text>`;
  return g;
}


/* ── 3D surface (WO-03) ───────────────────────────────────────────────── */

function drawSurface(spec: Extract<ChartSpec, { kind: 'surface3d' }>, ctx: RenderContext): string {
  const config = surfaceOptions(ctx);
  const margins = { top: 18, right: 20, bottom: 42, left: 54, ...(ctx.rawConfig.appearance?.margins ?? {}) };
  const width = Math.max(200, ctx.W - margins.left - margins.right);
  const height = Math.max(160, ctx.H - margins.top - margins.bottom);
  const body = renderSurfacePicture({
    chart: spec,
    width,
    height,
    config,
    style: surfacePaintStyle(ctx),
    margins,
    zLabel: spec.zLabel ?? '',
  });
  let out = `<g data-chart-role="surface3d" data-projection="${config.projection}" data-render-mode="${config.renderMode}">`;
  out += `<g transform="translate(${margins.left.toFixed(1)} ${margins.top.toFixed(1)})">${body}</g>`;
  out += '</g>';
  if (spec.nonEstimable?.length) {
    out += `<text data-chart-role="surface-warning" x="${margins.left}" y="${(margins.top + 12).toFixed(1)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="7.8" fill="${esc(ctx.style.alarmColor)}">${esc(`Non-estimable: ${spec.nonEstimable.join(', ')}`)}</text>`;
  }
  if (spec.extrapolated) {
    out += `<text data-chart-role="surface-warning" x="${margins.left}" y="${(ctx.H - 6).toFixed(1)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="7.8" fill="${esc(ctx.style.alarmColor)}">Outside design region</text>`;
  }
  return out;
}

/* ── overlaid contour (WO-04) ─────────────────────────────────────────── */

/** Names the drawer and the renderer share for the overlaid plot's labels. */
export interface OverlaidLabels {
  feasible: string;
  feasibleArea: string;
  gridNote: string;
  none: string;
  nonEstimable: string;
  basis: string;
  basisMean: string;
  basisConfidence: string;
  basisPrediction: string;
}

const OVERLAID_LABELS: OverlaidLabels = {
  feasible: 'Feasible',
  feasibleArea: 'Feasible area',
  gridNote: 'Grid approximation',
  none: 'No grid node satisfies every spec',
  nonEstimable: 'Non-estimable',
  basis: 'Basis',
  basisMean: 'predicted mean',
  basisConfidence: 'confidence interval',
  basisPrediction: 'prediction interval',
};

function drawOverlaid(spec: Extract<ChartSpec, { kind: 'overlaid' }>, ctx: RenderContext): string {
  const config = feasibleOptions(ctx);
  if (spec.xs.length < 2 || spec.ys.length < 2) return emptyChart(ctx, spec.title ?? 'Overlaid contour');
  const labels = (ctx.rawConfig as { overlaidLabels?: OverlaidLabels }).overlaidLabels ?? OVERLAID_LABELS;
  const xRange = spec.xRange ?? [spec.xs[0], spec.xs[spec.xs.length - 1]];
  const yRange = spec.yRange ?? [spec.ys[0], spec.ys[spec.ys.length - 1]];
  const box: Box = {
    x: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.left : 58,
    y: ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.top : 22,
    w: 0,
    h: ctx.H - 62,
  };
  box.w = ctx.W - box.x - (ctx.rawConfig.appearance?.margins ? ctx.appearance.margins.right : 20) - 8;
  const xAxis = makeAxis([xRange[0], xRange[1]], { ...(ctx.config.xAxis as AxisConfig), min: xRange[0], max: xRange[1] }, [box.x, box.x + box.w], { pad: 0 });
  const yAxis = makeAxis([yRange[0], yRange[1]], { ...(ctx.config.yAxis as AxisConfig), min: yRange[0], max: yRange[1] }, [box.y + box.h, box.y], { pad: 0 });
  let plot = plotBackground(ctx, box);
  plot += renderOverlaidPicture({
    chart: spec,
    box,
    config,
    style: surfacePaintStyle(ctx),
    toPixel: { x: xAxis.toPixel, y: yAxis.toPixel },
    xTitle: spec.xLabel ?? 'X',
    yTitle: spec.yLabel ?? 'Y',
    labels,
  });
  plot += overlaidLegendSvg({
    chart: spec,
    box,
    style: surfacePaintStyle(ctx),
    labels,
    basisLabel: config.basis === 'confidence' ? labels.basisConfidence : config.basis === 'prediction' ? labels.basisPrediction : labels.basisMean,
  });
  let g = clipGroup(ctx, box, plot);
  g += drawAxes(ctx, box, xAxis, yAxis, { xTitle: spec.xLabel, yTitle: spec.yLabel });
  const gridNote = `${labels.gridNote} · ${spec.xs.length}×${spec.ys.length}`;
  g += `<text data-chart-role="overlaid-grid-note" x="${box.x.toFixed(1)}" y="${(box.y - 4).toFixed(1)}" font-family="${esc(ctx.style.monoFontFamily)}" font-size="7.6" fill="${esc(ctx.style.labelColor)}">${esc(gridNote)}</text>`;
  return g;
}

/* ── warnings ─────────────────────────────────────────────────────────── */

function numericValues(spec: ChartSpec): { x: number[]; y: number[] } {
  switch (spec.kind) {
    case 'scatter': {
      const points = spec.series?.length ? spec.series.flatMap((s) => s.points) : spec.points;
      const bands = [...(spec.bands?.mean ?? []), ...(spec.bands?.individual ?? [])].flatMap((b) => [b.lo, b.hi]);
      return { x: points.map((p) => p.x), y: points.map((p) => p.y).concat(bands) };
    }
    case 'line':
      return { x: spec.series.flatMap((s) => s.points.map((p) => p.x)), y: spec.series.flatMap((s) => s.points.map((p) => p.y)) };
    case 'bar':
      return { x: spec.items.map((_, i) => i + 1), y: spec.items.map((i) => i.value) };
    case 'histogram':
      return { x: spec.values, y: [] };
    case 'timeseries':
      return { x: spec.values.map((_, i) => i + 1), y: spec.values };
    case 'contour':
    case 'surface3d':
      return { x: spec.xs, y: spec.ys.concat(spec.z.flat().filter((value) => Number.isFinite(value))) };
    case 'overlaid':
      return { x: spec.xs, y: spec.ys };
    case 'normalprob':
    case 'probplot':
      return { x: spec.points.map((p) => p.x), y: spec.points.map((p) => p.y) };
    case 'control':
      return { x: spec.panel.points.map((_, i) => i + 1), y: spec.panel.points };
    default:
      return { x: [], y: [] };
  }
}

/** Diagnostics a renderer can show without drawing: e.g. a log axis with zeros. */
export function getChartWarnings(spec: ChartSpec, override?: ChartConfig): ChartWarning[] {
  const config = mergeChartConfig(spec.config, override);
  const warnings: ChartWarning[] = [];
  const { x, y } = numericValues(spec);
  const scatter = spec.kind === 'scatter' ? { ...defaultScatterOptions(), ...(config.scatter ?? {}) } : null;
  const xScale: AxisScale = scatter?.logX ? 'log10' : config.xAxis?.scale ?? 'linear';
  const yScale: AxisScale = scatter?.logY ? 'log10' : config.yAxis?.scale ?? 'linear';
  const check = (scale: AxisScale, values: number[], axis: string) => {
    if (scale !== 'log10') return;
    const nonPositive = values.filter((v) => isFinite(v) && v <= 0);
    if (nonPositive.length) {
      warnings.push({
        code: 'log-nonpositive',
        message: `Log ${axis} axis: ${nonPositive.length} non-positive value${nonPositive.length === 1 ? '' : 's'} not shown`,
      });
    }
  };
  check(xScale, x, 'X');
  check(yScale, y, 'Y');
  if (spec.kind === 'contour' && spec.rsmModel) {
    const rsm = { ...(config.rsm ?? {}) };
    const xb = spec.rsmModel.codedBounds[rsm.xFactorIndex ?? 0];
    const yb = spec.rsmModel.codedBounds[rsm.yFactorIndex ?? 1];
    const xr = spec.xRange;
    const yr = spec.yRange;
    const outside = (range: [number, number] | undefined, bound: { min: number; max: number } | undefined) =>
      Boolean(range && bound && (Math.min(range[0], range[1]) < bound.min - 1e-9 || Math.max(range[0], range[1]) > bound.max + 1e-9));
    if (outside(xr, xb) || outside(yr, yb)) {
      warnings.push({ code: 'rsm-extrapolation', message: 'Contour view reaches outside the experimental region' });
    } else if (spec.rsmModel.stationary?.outsideRegion) {
      warnings.push({ code: 'rsm-extrapolation', message: 'Stationary point lies outside the experimental region' });
    }
  }
  return warnings;
}

/* ── dispatch & export ────────────────────────────────────────────────── */

function renderBody(spec: ChartSpec, ctx: RenderContext): string {
  switch (spec.kind) {
    case 'histogram': return drawHistogram(spec, ctx);
    case 'boxplot': return drawBoxplot(spec, ctx);
    case 'scatter': return drawScatter(spec, ctx);
    case 'timeseries': return drawTimeseries(spec, ctx);
    case 'normalprob': return drawNormalProb(spec, ctx);
    case 'control': return drawControl(spec, ctx);
    case 'pareto': return drawPareto(spec, ctx);
    case 'capability': return drawCapability(spec, ctx);
    case 'interval': return drawInterval(spec, ctx);
    case 'line': return drawLine(spec, ctx);
    case 'bar': return drawBar(spec, ctx);
    case 'contour': return drawContour(spec, ctx);
    case 'surface3d': return drawSurface(spec, ctx);
    case 'overlaid': return drawOverlaid(spec, ctx);
    case 'probplot': return drawProbplot(spec, ctx);
    default: return '';
  }
}

/**
 * Render a chart to a standalone SVG string.
 *
 * `widthOrOptions` accepts the historical numeric width or a render options
 * object (width, height, preset, config).
 */
export function renderChart(spec: ChartSpec, widthOrOptions?: number | RenderOptions): string {
  const options: RenderOptions = typeof widthOrOptions === 'number' ? { width: widthOrOptions } : (widthOrOptions ?? {});
  const ctx = createContext(spec, options);
  const warnings = getChartWarnings(spec, options.config);
  const body = renderBody(spec, ctx);
  const label = spec.title ?? spec.kind;
  const defs = ctx.defs.length ? `<defs>${ctx.defs.join('')}</defs>` : '';
  return openSvg(ctx, label, warnings)
    + background(ctx)
    + titleBlock(ctx, spec)
    + warningBanner(ctx, warnings)
    + defs
    + body
    + '</svg>';
}

/** Replace CSS variables with concrete colours (export never keeps a var()). */
export function inlineTheme(svg: string): string {
  return resolveStandaloneSvg(svg);
}

export { resolveStandaloneSvg };
