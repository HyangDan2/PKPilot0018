/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — chart interaction model (Stage 3D, WO-09)

   Everything the pointer does to a chart is arithmetic that can be tested
   without a browser: box zoom turns two pixels into a new domain, pan shifts
   that domain, the crosshair and data cursor map pixels back to values, and a
   selection is a set of plotted elements that resolves to worksheet rows.

   The rules that keep the selection honest:

   · A plotted element carries its own source rows (`data-row` for one row,
     `data-rows` for an aggregate). An element without either is not linked to
     the worksheet, and the UI says so instead of inventing a row.
   · Two charts are linked-selection compatible only when both name the same
     sheet and the same x/y column pair. A chart drawn from different columns
     never highlights rows in the other, because the rows would not mean the
     same thing.
   ───────────────────────────────────────────────────────────────────────── */

import type { AxisScale, ChartConfig } from './chartConfig';
import { mapScaleValue, unmapScaleValue } from './axisAdvanced';
import type { ChartSource } from '../types';

export interface PlotBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The data window a chart is drawn in. */
export interface Viewport {
  x: [number, number];
  y: [number, number];
}

export interface PlotRect extends PlotBox {
  /** Axis transforms, so a log or power axis zooms in its own coordinates. */
  xScale: AxisScale;
  yScale: AxisScale;
  power?: number;
  logConstant?: number;
}

const MIN_SPAN_FRACTION = 1e-6;

/** Value at a pixel position inside the plot area. */
export function pixelToValue(pixel: number, box: PlotBox, view: Viewport, axis: 'x' | 'y', scale: AxisScale, options: { power?: number; logConstant?: number } = {}): number {
  const [lo, hi] = axis === 'x' ? view.x : view.y;
  if (!(hi > lo)) return lo;
  if (axis === 'x') {
    const t = box.w ? (pixel - box.x) / box.w : 0;
    return unmapScaleValue(mapScaleValue(lo, scale, options) + t * (mapScaleValue(hi, scale, options) - mapScaleValue(lo, scale, options)), scale, options);
  }
  const t = box.h ? (pixel - box.y) / box.h : 0;
  // Screen y grows downwards, so the fraction runs from the top of the range.
  return unmapScaleValue(mapScaleValue(hi, scale, options) + t * (mapScaleValue(lo, scale, options) - mapScaleValue(hi, scale, options)), scale, options);
}

/** Axis fraction (0 … 1) of a data value along its pixel axis. */
export function valueToFraction(value: number, view: [number, number], scale: AxisScale, options: { power?: number; logConstant?: number } = {}): number {
  const lo = mapScaleValue(view[0], scale, options);
  const hi = mapScaleValue(view[1], scale, options);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi === lo) return 0;
  return (mapScaleValue(value, scale, options) - lo) / (hi - lo);
}

/**
 * The new domain for a dragged rectangle. A drag under ~6 px in either
 * direction is a click, not a zoom, and leaves the view untouched.
 */
export function boxZoom(
  view: Viewport,
  rect: PlotRect,
  from: { x: number; y: number },
  to: { x: number; y: number },
  minimum = 6,
): Viewport | null {
  if (Math.abs(to.x - from.x) < minimum || Math.abs(to.y - from.y) < minimum) return null;
  const opts = { power: rect.power, logConstant: rect.logConstant };
  const xa = pixelToValue(Math.min(from.x, to.x), rect, view, 'x', rect.xScale, opts);
  const xb = pixelToValue(Math.max(from.x, to.x), rect, view, 'x', rect.xScale, opts);
  // Screen y grows downwards, so the two corners come back in either order.
  const ya = pixelToValue(Math.min(from.y, to.y), rect, view, 'y', rect.yScale, opts);
  const yb = pixelToValue(Math.max(from.y, to.y), rect, view, 'y', rect.yScale, opts);
  if (![xa, xb, ya, yb].every(Number.isFinite)) return null;
  const x1 = Math.min(xa, xb);
  const x2 = Math.max(xa, xb);
  const y1 = Math.min(ya, yb);
  const y2 = Math.max(ya, yb);
  if (!(x2 > x1) || !(y2 > y1)) return null;
  // Keep a floor so a wild double-drag cannot divide the axis to nothing.
  const floorX = (mapScaleValue(view.x[1], rect.xScale, opts) - mapScaleValue(view.x[0], rect.xScale, opts)) * MIN_SPAN_FRACTION;
  const floorY = (mapScaleValue(view.y[1], rect.yScale, opts) - mapScaleValue(view.y[0], rect.yScale, opts)) * MIN_SPAN_FRACTION;
  if (Math.abs(mapScaleValue(x2, rect.xScale, opts) - mapScaleValue(x1, rect.xScale, opts)) < floorX) return null;
  if (Math.abs(mapScaleValue(y2, rect.yScale, opts) - mapScaleValue(y1, rect.yScale, opts)) < floorY) return null;
  return { x: [x1, x2], y: [y1, y2] };
}

/** Pan by a pixel delta, keeping the current span. */
export function panViewport(view: Viewport, rect: PlotRect, dxPixels: number, dyPixels: number): Viewport {
  const opts = { power: rect.power, logConstant: rect.logConstant };
  const shift = (range: [number, number], scale: AxisScale, delta: number, pixels: number): [number, number] => {
    const lo = mapScaleValue(range[0], scale, opts);
    const hi = mapScaleValue(range[1], scale, opts);
    const step = (hi - lo) * (pixels ? delta / pixels : 0);
    return [unmapScaleValue(lo - step, scale, opts), unmapScaleValue(hi - step, scale, opts)];
  };
  return {
    x: shift(view.x, rect.xScale, dxPixels, rect.w),
    y: shift(view.y, rect.yScale, -dyPixels, rect.h),
  };
}

/**
 * Zoom around an anchor pixel (the pointer, or the middle of the plot).
 * `factor` < 1 zooms in. The anchor keeps the value under the pointer fixed.
 */
export function zoomViewport(view: Viewport, rect: PlotRect, factor: number, anchor?: { x: number; y: number }): Viewport {
  const opts = { power: rect.power, logConstant: rect.logConstant };
  const span = (range: [number, number], scale: AxisScale): number =>
    mapScaleValue(range[1], scale, opts) - mapScaleValue(range[0], scale, opts);
  const around = (range: [number, number], scale: AxisScale, t: number, k: number): [number, number] => {
    const lo = mapScaleValue(range[0], scale, opts);
    const hi = mapScaleValue(range[1], scale, opts);
    const pivot = lo + t * (hi - lo);
    return [unmapScaleValue(pivot - (pivot - lo) * k, scale, opts), unmapScaleValue(pivot + (hi - pivot) * k, scale, opts)];
  };
  const k = Math.min(4, Math.max(0.2, factor));
  const tx = anchor ? Math.min(1, Math.max(0, (anchor.x - rect.x) / (rect.w || 1))) : 0.5;
  const ty = anchor ? Math.min(1, Math.max(0, (anchor.y - rect.y) / (rect.h || 1))) : 0.5;
  const x = around(view.x, rect.xScale, tx, k);
  const y = around(view.y, rect.yScale, ty, k);
  if (![x[0], x[1], y[0], y[1]].every(Number.isFinite)) return view;
  if (span(view.x, rect.xScale) <= 0 || span(x, rect.xScale) <= 0) return view;
  return { x, y };
}

/** True when the view still shows `base` (nothing to reset). */
export function viewportIsBase(view: Viewport, base: Viewport): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-9 + 1e-12;
  return near(view.x[0], base.x[0]) && near(view.x[1], base.x[1]) && near(view.y[0], base.y[0]) && near(view.y[1], base.y[1]);
}

/** Axis config carrying a viewport, so the renderer draws the zoomed window. */
export function viewportConfig(base: Partial<ChartConfig> | undefined, view: Viewport | null): ChartConfig {
  const config: ChartConfig = { ...(base ?? {}) };
  if (!view) return config;
  config.xAxis = { ...(base?.xAxis ?? {}), min: view.x[0], max: view.x[1], autoRange: false };
  config.yAxis = { ...(base?.yAxis ?? {}), min: view.y[0], max: view.y[1], autoRange: false };
  return config;
}

/* ── selection ────────────────────────────────────────────────────────── */

export interface SelectableElement {
  /** Position of the element inside the SVG (its own document order). */
  index: number;
  /** Source rows this element stands for. */
  rows: number[];
}

/** Parse the `data-row` / `data-rows` attributes of one plotted element. */
export function rowsFromElement(element: Element | null): number[] {
  if (!element) return [];
  const many = element.getAttribute('data-rows');
  const one = element.getAttribute('data-row');
  const source = many ?? one;
  if (!source) return [];
  return source
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.round(value));
}

/** Add or remove rows from a selection, keeping worksheet order. */
export function toggleRows(selected: number[], rows: number[], additive: boolean): number[] {
  if (!rows.length) return selected;
  const set = new Set(additive ? selected : []);
  const allPresent = rows.every((row) => set.has(row));
  rows.forEach((row) => {
    if (allPresent) set.delete(row);
    else set.add(row);
  });
  return [...set].sort((a, b) => a - b);
}

/** Two charts may share a selection only when they read the same columns. */
export function selectionCompatible(a: ChartSource | undefined, b: ChartSource | undefined): boolean {
  if (!a || !b) return false;
  if (!a.sheetId || !b.sheetId || a.sheetId !== b.sheetId) return false;
  const pair = (source: ChartSource) => [source.xColumnId ?? '', source.yColumnId ?? ''].sort().join('|');
  if (!a.xColumnId && !a.yColumnId) return false;
  return pair(a) === pair(b);
}

/** Stable key of a chart's source, or null when it has none. */
export function sourceKey(source: ChartSource | undefined): string | null {
  if (!source || !source.sheetId) return null;
  return `${source.sheetId}:${source.xColumnId ?? ''}:${source.yColumnId ?? ''}`;
}

/** CSV of the selected worksheet rows (whole rows, in sheet column order). */
export function selectedRowsCsv(
  columns: { name: string; values: (number | string | null)[] }[],
  rows: number[],
): string {
  const escape = (value: number | string | null): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map((column) => escape(column.name)).join(',')];
  rows.forEach((row) => {
    lines.push(columns.map((column) => escape(column.values[row] ?? null)).join(','));
  });
  return lines.join('\r\n');
}

/* ── data cursor ──────────────────────────────────────────────────────── */

/** Nearest element to a pixel position, within `tolerance` px. */
export function nearestElement(
  positions: { index: number; x: number; y: number }[],
  point: { x: number; y: number },
  tolerance = 14,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  for (const entry of positions) {
    const distance = Math.hypot(entry.x - point.x, entry.y - point.y);
    if (distance > tolerance || distance >= bestDistance) continue;
    bestIndex = entry.index;
    bestDistance = distance;
  }
  return bestIndex;
}

/**
 * Next element for the keyboard data cursor: left/right walk the elements in
 * document order (which the renderers emit in x order for line and scatter
 * charts), and wrap around at the ends instead of dead-ending.
 */
export function stepElement(current: number | null, count: number, direction: 1 | -1): number | null {
  if (count <= 0) return null;
  if (current === null || current < 0 || current >= count) return direction > 0 ? 0 : count - 1;
  return (current + direction + count) % count;
}
