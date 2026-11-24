/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — Stage 3B renderers (WO-03 / WO-04)

   `drawSurface` paints a 3-D surface as a static projection: this is the
   picture every export and print path produces, and the automatic fallback
   when WebGL is unavailable. `drawOverlaid` paints several responses with
   their specification limits and the joint feasible region.

   Both are pure SVG from the same geometry modules the interactive views use.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec, OverlaidResponseData } from '../types';
import { bandPolygons, marchingSquares, polygonsToPath, polylinesToPath, stitchSegments } from './contour';
import type { Box } from './charts';
import { surfaceSvgBody, surfaceExtent, surfaceColorbarSvg, type SurfacePaintStyle } from './surface3d';
import { defaultFeasibleConfig, defaultSurfaceViewConfig } from './chartConfig';
import type { FeasibleConfig, SurfaceViewConfig } from './chartConfig';
import { maskAreaRatio } from './feasible';

export function surfacePaintStyle(ctx: {
  style: { surfaceColor: string; plotBg: string; inkColor: string; labelColor: string; gridColor: string; alarmColor: string; fontFamily: string; monoFontFamily: string };
}): SurfacePaintStyle {
  return {
    surface: ctx.style.surfaceColor,
    plot: ctx.style.plotBg,
    ink: ctx.style.inkColor,
    label: ctx.style.labelColor,
    grid: ctx.style.gridColor,
    alarm: ctx.style.alarmColor,
    fontFamily: ctx.style.fontFamily,
    mono: ctx.style.monoFontFamily,
  };
}

export function surfaceOptions(ctx: { rawConfig: { surface?: Partial<SurfaceViewConfig> } }): SurfaceViewConfig {
  return { ...defaultSurfaceViewConfig(), ...(ctx.rawConfig.surface ?? {}) };
}

export interface SurfaceDrawInput {
  chart: Extract<ChartSpec, { kind: 'surface3d' }>;
  width: number;
  height: number;
  config: SurfaceViewConfig;
  style: SurfacePaintStyle;
  margins: { top: number; right: number; bottom: number; left: number };
  notice?: string;
  zLabel?: string;
  xRange?: [number, number];
  yRange?: [number, number];
}

/**
 * The surface picture: the projected mesh, a colourbar and, when the caller
 * needs it, the notice that this is a static projection.
 */
export function renderSurfacePicture(input: SurfaceDrawInput): string {
  const { chart, config, style, width, height } = input;
  const extent = surfaceExtent({ xs: chart.xs, ys: chart.ys, z: chart.z });
  const barReserve = config.colorbar ? 64 : 0;
  const paintWidth = width - barReserve;
  const finite = chart.z.reduce((count, row) => count + row.reduce((sum, value) => (Number.isFinite(value) ? sum + 1 : sum), 0), 0);
  const body = finite === 0 ? '' : surfaceSvgBody({
    grid: { xs: chart.xs, ys: chart.ys, z: chart.z },
    config,
    style,
    width: paintWidth,
    height,
    xLabel: chart.xLabel ?? 'X',
    yLabel: chart.yLabel ?? 'Y',
    zLabel: input.zLabel ?? chart.zLabel ?? 'Z',
    points: chart.points,
    xRange: input.xRange ?? chart.xRange,
    yRange: input.yRange ?? chart.yRange,
    fallbackNotice: input.notice,
  });
  let out = body;
  if (!body) {
    out = `<text x="${paintWidth / 2}" y="${height / 2}" text-anchor="middle" font-family="${style.mono}" font-size="9.5" fill="${style.label}">No finite surface to draw</text>`;
  }
  if (config.colorbar) {
    out += surfaceColorbarSvg(config, style, paintWidth + 22, height * 0.12, height * 0.62, extent.zMin, extent.zMax, input.zLabel ?? chart.zLabel ?? '', config.colormap);
  }
  if (input.notice) {
    const textWidth = 8 + input.notice.length * 4.4;
    out += `<g data-chart-role="surface-fallback" data-fallback="1">`
      + `<rect x="6" y="6" width="${textWidth.toFixed(0)}" height="15" rx="3" fill="${style.surface}" stroke="${style.alarm}" stroke-width="0.8" opacity="0.95"/>`
      + `<text x="12" y="16.5" font-family="${style.mono}" font-size="7.8" fill="${style.alarm}">${escapeXml(input.notice)}</text></g>`;
  }
  return out;
}

/* ── overlaid contour ─────────────────────────────────────────────────── */

export function feasibleOptions(ctx: { rawConfig: { feasible?: Partial<FeasibleConfig> } }): FeasibleConfig {
  return { ...defaultFeasibleConfig(), ...(ctx.rawConfig.feasible ?? {}) };
}

/** The spec limits a response contributes as iso-lines, in draw order. */
function specLevels(response: OverlaidResponseData): { value: number; label: string; role: string }[] {
  const out: { value: number; label: string; role: string }[] = [];
  if (response.lsl != null) out.push({ value: response.lsl, label: `LSL ${fmtShort(response.lsl)}`, role: 'lsl' });
  if (response.usl != null) out.push({ value: response.usl, label: `USL ${fmtShort(response.usl)}`, role: 'usl' });
  if (response.target != null) out.push({ value: response.target, label: `T ${fmtShort(response.target)}`, role: 'target' });
  return out;
}

function fmtShort(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4;
  return value.toFixed(decimals);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface OverlaidDrawInput {
  chart: Extract<ChartSpec, { kind: 'overlaid' }>;
  box: Box;
  config: FeasibleConfig;
  style: SurfacePaintStyle;
  toPixel: { x: (value: number) => number; y: (value: number) => number };
  /** Axis labels for the factor pair. */
  xTitle: string;
  yTitle: string;
  /** Locale-independent labels supplied by the caller's i18n. */
  labels: { feasible: string; feasibleArea: string; gridNote: string; none: string; nonEstimable: string };
}

/**
 * The overlaid picture.
 *
 * Order matters: each response's own satisfied region goes down first, then the
 * joint feasible region on top (it is the intersection, so it must be the last
 * tint), then the limit lines, then the points and the legend.
 */
export function renderOverlaidPicture(input: OverlaidDrawInput): string {
  const { chart, box, config, style, toPixel } = input;
  const width = Math.abs(chart.xs[chart.xs.length - 1] - chart.xs[0]);
  const height = Math.abs(chart.ys[chart.ys.length - 1] - chart.ys[0]);
  let plot = '';
  if (config.showResponseRegions) {
    chart.responses.forEach((response) => {
      const bands = bandPolygons({ xs: chart.xs, ys: chart.ys, z: response.mask }, [0.5, 1.5]);
      const path = polygonsToPath(bands[0]?.polygons ?? [], toPixel.x, toPixel.y);
      if (!path) return;
      plot += `<path data-chart-role="overlay-region" data-response="${escapeXml(response.name)}" d="${path}" fill="${response.color}" opacity="0.13" stroke="none"/>`;
    });
  }
  if (config.showFeasible && chart.feasible) {
    const bands = bandPolygons({ xs: chart.xs, ys: chart.ys, z: chart.feasible.mask }, [0.5, 1.5]);
    const path = polygonsToPath(bands[0]?.polygons ?? [], toPixel.x, toPixel.y);
    if (path) {
      plot += `<defs><pattern id="sigrun-feasible-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
        + `<line x1="0" y1="0" x2="0" y2="6" stroke="${style.ink}" stroke-width="1" opacity="0.35"/></pattern></defs>`;
      plot += `<path data-chart-role="feasible-region" d="${path}" fill="#22c55e" opacity="0.26" stroke="#15803d" stroke-width="1.1"/>`;
      plot += `<path data-chart-role="feasible-hatch" d="${path}" fill="url(#sigrun-feasible-hatch)" opacity="0.5"/>`;
    }
  }
  if (config.hatchUnfeasible && chart.responses.length) {
    const outside = chart.responses[0].mask.map((row, j) => row.map((_, i) => (chart.feasible?.mask[j]?.[i] === 1 ? 0 : 1)));
    const bands = bandPolygons({ xs: chart.xs, ys: chart.ys, z: outside }, [0.5, 1.5]);
    const path = polygonsToPath(bands[0]?.polygons ?? [], toPixel.x, toPixel.y);
    if (path) plot += `<path data-chart-role="unfeasible-region" d="${path}" fill="none" stroke="${style.alarm}" stroke-width="0.6" stroke-dasharray="2 4" opacity="0.45"/>`;
  }
  if (config.showSpecLines) {
    chart.responses.forEach((response) => {
      specLevels(response).forEach((level) => {
        const lines = stitchSegments(marchingSquares({ xs: chart.xs, ys: chart.ys, z: response.z }, level.value), Math.max(width, height, 1));
        const path = polylinesToPath(lines, toPixel.x, toPixel.y);
        if (!path) return;
        const dash = level.role === 'target' ? '2 2' : response.dash;
        plot += `<path data-chart-role="spec-line" data-response="${escapeXml(response.name)}" data-kind="${level.role}" d="${path}" fill="none" stroke="${response.color}" stroke-width="${level.role === 'target' ? 1 : 1.5}"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity="0.95"/>`;
      });
    });
  }
  if (config.showPoints && chart.points?.length) {
    chart.points.forEach((point) => {
      const cx = toPixel.x(point.x);
      const cy = toPixel.y(point.y);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
      plot += `<circle data-chart-role="chart-point" data-x="${point.x}" data-y="${point.y}"${Number.isFinite(point.z) ? ` data-z="${point.z}"` : ''} cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="${style.surface}" stroke="${style.ink}" stroke-width="1"/>`;
    });
  }
  const ratio = chart.feasible?.areaRatio ?? maskAreaRatio(chart.xs, chart.ys, chart.feasible?.mask ?? []);
  const note = `${input.labels.feasibleArea} ${(ratio * 100).toFixed(1)}%`;
  plot += `<text data-chart-role="feasible-ratio" x="${(box.x + 5).toFixed(1)}" y="${(box.y + 13).toFixed(1)}" font-family="${style.mono}" font-size="8.2" fill="${style.ink}">${escapeXml(note)}</text>`;
  if (chart.feasible && chart.feasible.feasibleNodes === 0) {
    plot += `<text data-chart-role="feasible-warning" x="${(box.x + 5).toFixed(1)}" y="${(box.y + 25).toFixed(1)}" font-family="${style.mono}" font-size="8" fill="${style.alarm}">${escapeXml(input.labels.none)}</text>`;
  }
  return plot;
}

/** Legend rows for the overlaid plot: one per response, then the joint region. */
export function overlaidLegendSvg(input: {
  chart: Extract<ChartSpec, { kind: 'overlaid' }>;
  box: Box;
  style: SurfacePaintStyle;
  labels: { feasible: string; feasibleArea: string; gridNote: string; basis: string };
  basisLabel: string;
}): string {
  const { chart, box, style, labels } = input;
  const rows = chart.responses.length + 2;
  const width = Math.min(box.w - 8, 250);
  const height = 14 + rows * 12;
  const x = box.x + box.w - width - 4;
  const y = box.y + 4;
  let out = `<g data-chart-role="legend"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width}" height="${height}" rx="2" fill="${style.surface}" stroke="${style.grid}" opacity="0.92"/>`;
  chart.responses.forEach((response, index) => {
    const rowY = y + 12 + index * 12;
    out += `<line x1="${(x + 6).toFixed(1)}" y1="${rowY.toFixed(1)}" x2="${(x + 24).toFixed(1)}" y2="${rowY.toFixed(1)}" stroke="${response.color}" stroke-width="2"${response.dash ? ` stroke-dasharray="${response.dash}"` : ''}/>`;
    const spec = [
      response.lsl != null ? `LSL ${fmtShort(response.lsl)}` : '',
      response.usl != null ? `USL ${fmtShort(response.usl)}` : '',
      response.target != null ? `T ${fmtShort(response.target)}` : '',
    ].filter(Boolean).join(' · ') || '—';
    out += `<text x="${(x + 29).toFixed(1)}" y="${(rowY + 3).toFixed(1)}" font-family="${style.mono}" font-size="7.4" fill="${style.label}">${escapeXml(`${response.name}  ${spec}  (${(response.areaRatio * 100).toFixed(0)}%)`)}</text>`;
  });
  const feasibleY = y + 12 + chart.responses.length * 12;
  out += `<rect x="${(x + 6).toFixed(1)}" y="${(feasibleY - 4).toFixed(1)}" width="18" height="8" fill="#22c55e" opacity="0.35" stroke="#15803d" stroke-width="0.8"/>`;
  out += `<text x="${(x + 29).toFixed(1)}" y="${(feasibleY + 3).toFixed(1)}" font-family="${style.mono}" font-size="7.6" fill="${style.ink}">${escapeXml(`${labels.feasible}  ${(input.chart.feasible?.areaRatio ?? 0) * 100}%`)}</text>`;
  out += `<text x="${(x + 6).toFixed(1)}" y="${(feasibleY + 15).toFixed(1)}" font-family="${style.mono}" font-size="7" fill="${style.label}">${escapeXml(`${labels.basis}: ${input.basisLabel}`)}</text>`;
  out += '</g>';
  return out;
}
