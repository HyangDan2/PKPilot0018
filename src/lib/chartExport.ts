/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — professional chart export (WO-10)

   One chart becomes a standalone document: no `var(--…)`, no page theme, an
   explicit pixel box and the physical size the author asked for. The PNG
   rasteriser multiplies the physical size by the requested DPI, so a 160 mm
   wide figure at 300 DPI is exactly 1890 px, not "about 2×".
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec } from '../types';
import { renderChart, resolveStandaloneSvg } from './charts';
import { defaultExportConfig } from './chartConfig';
import type { ChartConfig, ExportBackground, ExportConfig, ExportFormat, PhysicalUnit } from './chartConfig';

/** The DPI presets the drawer offers; a custom value is allowed too. */
export const EXPORT_DPI_PRESETS = [150, 300, 600] as const;

/** 1 inch is exactly 25.4 mm. */
export const MM_PER_INCH = 25.4;

export interface ExportSize {
  /** Pixel box written into the SVG and used for the canvas. */
  widthPx: number;
  heightPx: number;
  /** Physical size the pixel box represents at this DPI. */
  physicalWidth: number;
  physicalHeight: number;
  physicalUnit: PhysicalUnit;
  dpi: number;
  /** CSS-pixel box used for the internal viewBox (kept from the chart). */
  viewWidth: number;
  viewHeight: number;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** physical → exact pixels: `Math.round(physicalInches * dpi)`. */
export function physicalToPixels(physical: number, unit: PhysicalUnit, dpi: number): number {
  const inches = unit === 'in' ? physical : physical / MM_PER_INCH;
  return Math.max(1, Math.round(inches * Math.max(1, dpi)));
}

/** pixels → physical size in the requested unit. */
export function pixelsToPhysical(pixels: number, unit: PhysicalUnit, dpi: number): number {
  const inches = pixels / Math.max(1, dpi);
  return round2(unit === 'in' ? inches : inches * MM_PER_INCH);
}

export function normalizeExportConfig(config?: Partial<ExportConfig>): ExportConfig {
  return { ...defaultExportConfig(), ...(config ?? {}) };
}

/**
 * The exact output box for an export.
 *
 * When the author typed a pixel size, that size wins; otherwise the physical
 * size and the DPI decide it. The internal viewBox stays the chart's own
 * coordinate box, which keeps every stroke and font the same weight.
 */
export function resolveExportSize(config: Partial<ExportConfig> | undefined, viewWidth = 560, viewHeight = 300): ExportSize {
  const cfg = normalizeExportConfig(config);
  const dpi = finitePositive(cfg.dpi) ? Math.round(cfg.dpi) : 300;
  const unit = cfg.physicalUnit === 'in' ? 'in' : 'mm';
  let physicalWidth = finitePositive(cfg.physicalWidth) ? cfg.physicalWidth : 160;
  let physicalHeight = finitePositive(cfg.physicalHeight) ? cfg.physicalHeight : 100;
  let widthPx: number;
  let heightPx: number;
  if (finitePositive(cfg.widthPx) && finitePositive(cfg.heightPx)) {
    widthPx = Math.round(cfg.widthPx);
    heightPx = Math.round(cfg.heightPx);
    physicalWidth = pixelsToPhysical(widthPx, unit, dpi);
    physicalHeight = pixelsToPhysical(heightPx, unit, dpi);
  } else {
    widthPx = physicalToPixels(physicalWidth, unit, dpi);
    heightPx = physicalToPixels(physicalHeight, unit, dpi);
  }
  return {
    widthPx,
    heightPx,
    physicalWidth,
    physicalHeight,
    physicalUnit: unit,
    dpi,
    viewWidth: Math.max(1, Math.round(viewWidth)),
    viewHeight: Math.max(1, Math.round(viewHeight)),
  };
}

/** The chart's intrinsic SVG box (viewBox width / height). */
export function chartViewBox(svg: string): { width: number; height: number } {
  const match = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!match) return { width: 560, height: 300 };
  return { width: Number(match[1]) || 560, height: Number(match[2]) || 300 };
}

const BACKGROUND_FILL: Record<Exclude<ExportBackground, 'current'>, string> = {
  white: '#ffffff',
  transparent: 'none',
};

function backgroundRect(width: number, height: number, fill: string): string {
  return `<rect data-chart-role="chart-export-bg" x="0" y="0" width="${width}" height="${height}" fill="${fill}"/>`;
}

/**
 * Render one chart as a standalone SVG sized for export.
 *
 * Title and legend can be left out without touching the chart itself: the
 * override config is a copy, and `resolveStandaloneSvg` resolves any remaining
 * theme variable to a literal colour.
 */
export function chartSvgDocument(
  chart: ChartSpec,
  config?: Partial<ExportConfig>,
  options: { caption?: string; width?: number } = {},
): { svg: string; size: ExportSize } {
  const cfg = normalizeExportConfig(config);
  const background = cfg.background;
  const mergedOverride: ChartConfig = {};
  if (!cfg.includeTitle) mergedOverride.appearance = { titleVisible: false };
  if (!cfg.includeLegend) mergedOverride.legend = { visible: false };
  if (background !== 'current') {
    mergedOverride.appearance = {
      ...(mergedOverride.appearance ?? {}),
      chartBg: background === 'white' ? '#ffffff' : 'transparent',
      plotBg: background === 'white' ? '#ffffff' : 'transparent',
    };
  }
  const svg = renderChart(chart, { width: options.width, config: mergedOverride });
  const box = chartViewBox(svg);
  const size = resolveExportSize(cfg, box.width, box.height);
  let body = svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  if (background === 'transparent') {
    // The renderer writes a chart background only when one is configured; a
    // white engineering page still has to go.
    body = body.replace(/<rect data-chart-role="chart-bg"[^>]*\/>/g, '')
      .replace(/<rect data-chart-role="chart-plot-bg"[^>]*\/>/g, '');
  }
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" class="chart-svg chart-export" width="${size.widthPx}" height="${size.heightPx}" viewBox="0 0 ${box.width} ${box.height}" role="img" aria-label="${(options.caption ?? chart.title ?? chart.kind).replace(/"/g, '&quot;')}">`
    + (background === 'white' ? backgroundRect(box.width, box.height, BACKGROUND_FILL.white) : '')
    + body
    + '</svg>';
  return { svg: resolveStandaloneSvg(doc), size };
}

/** Same name the gap doc uses, scoped to the exported document. */
export function resolveStandaloneExport(chart: ChartSpec, config?: Partial<ExportConfig>, options: { caption?: string; width?: number } = {}): string {
  return chartSvgDocument(chart, config, options).svg;
}

export interface ExportFile {
  name: string;
  type: string;
  data: string | Blob;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'chart';
}

export function exportFileName(chart: ChartSpec, config: Partial<ExportConfig> | undefined, caption?: string): string {
  const cfg = normalizeExportConfig(config);
  const stem = slug(caption || chart.title || chart.kind);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  return cfg.format === 'png'
    ? `sigrun-${stem}-${cfg.dpi}dpi-${stamp}.png`
    : `sigrun-${stem}-${stamp}.svg`;
}

/** One chart's file, ready to hand to a download helper. */
export function buildChartFile(
  chart: ChartSpec,
  config?: Partial<ExportConfig>,
  options: { caption?: string; width?: number } = {},
): ExportFile {
  const cfg = normalizeExportConfig(config);
  const { svg } = chartSvgDocument(chart, cfg, options);
  return {
    name: exportFileName(chart, cfg, options.caption),
    type: 'image/svg+xml;charset=utf-8',
    data: svg,
  };
}

export interface BatchEntry {
  chart: ChartSpec;
  caption?: string;
}

/** Several charts stacked into one SVG, each export-sized and theme-free. */
export function batchSvgDocument(entries: BatchEntry[], config?: Partial<ExportConfig>): string {
  const cfg = normalizeExportConfig(config);
  const parts: string[] = [];
  let y = 0;
  let width = 0;
  entries.forEach((entry) => {
    const { svg } = chartSvgDocument(entry.chart, { ...cfg, background: 'transparent' }, { caption: entry.caption });
    const box = chartViewBox(svg);
    const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    parts.push(`<g transform="translate(0 ${y})">${inner}</g>`);
    y += box.height + 8;
    width = Math.max(width, box.width);
  });
  const height = Math.max(1, y);
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + (cfg.background === 'white' ? backgroundRect(width, height, '#ffffff') : '')
    + parts.join('')
    + '</svg>';
  return resolveStandaloneSvg(doc);
}

/* ── rasteriser ───────────────────────────────────────────────────────── */

/**
 * Rasterise an SVG document at the requested DPI.
 *
 * The canvas is exactly the export box; the SVG is drawn into it once, so the
 * PNG has no browser zoom factor baked in. A canvas-less environment (tests,
 * SSR) returns `null` instead of pretending a file was produced.
 */
export async function svgToPngWithConfig(
  svg: string,
  config?: Partial<ExportConfig>,
): Promise<{ blob: Blob; size: ExportSize } | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  const cfg = normalizeExportConfig(config);
  const box = chartViewBox(svg);
  const size = resolveExportSize(cfg, box.width, box.height);
  const sized = svg.replace(/^<svg([^>]*?)width="[^"]*"/, `<svg$1width="${box.width}"`)
    .replace(/^<svg([^>]*?)height="[^"]*"/, `<svg$1height="${box.height}"`);
  const source = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('svg-load-timeout')), 4000);
      image.onload = () => { clearTimeout(timer); resolve(); };
      image.onerror = () => { clearTimeout(timer); reject(new Error('svg-load')); };
    });
    image.src = url;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = size.widthPx;
    canvas.height = size.heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (cfg.background === 'white' || cfg.background === 'current') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, 0, 0, size.widthPx, size.heightPx);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((result) => resolve(result), 'image/png'));
    return blob ? { blob, size } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Format tag used by the drawer's format switch. */
export function isRasterFormat(format: ExportFormat): boolean {
  return format === 'png';
}
