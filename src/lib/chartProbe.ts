/* ─────────────────────────────────────────────────────────────────────────
   Statelia — chart probing for the hover / tap readout (WO-09)

   A plotted point carries its own `data-x` / `data-y` / `data-z`. Between the
   points, a contour plot interpolates the same grid it was drawn from, so the
   readout is the surface the reader is actually looking at.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec } from '../types';

export interface Probe {
  x: number;
  y: number;
  z?: number;
  label?: string;
  /** Where the value came from: a plotted element or the contour grid. */
  source: 'point' | 'grid';
}

function within(value: number, values: number[]): boolean {
  return values.length > 0 && value >= values[0] - 1e-12 && value <= values[values.length - 1] + 1e-12;
}

/** Bilinear interpolation inside a rectangular grid; `null` outside it. */
export function bilinearAt(xs: number[], ys: number[], z: number[][], x: number, y: number): number | null {
  if (xs.length < 2 || ys.length < 2 || !within(x, xs) || !within(y, ys)) return null;
  const find = (values: number[], value: number): number => {
    let lo = 0;
    let hi = values.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (values[mid] <= value) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const i = find(xs, x);
  const j = find(ys, y);
  const tx = (x - xs[i]) / (xs[i + 1] - xs[i] || 1);
  const ty = (y - ys[j]) / (ys[j + 1] - ys[j] || 1);
  const z00 = z[j]?.[i];
  const z10 = z[j]?.[i + 1];
  const z01 = z[j + 1]?.[i];
  const z11 = z[j + 1]?.[i + 1];
  if (![z00, z10, z01, z11].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return (z00 as number) * (1 - tx) * (1 - ty)
    + (z10 as number) * tx * (1 - ty)
    + (z01 as number) * (1 - tx) * ty
    + (z11 as number) * tx * ty;
}

/** Value of a contour surface at a data coordinate. */
export function probeContour(spec: Extract<ChartSpec, { kind: 'contour' }>, x: number, y: number): Probe | null {
  const value = bilinearAt(spec.xs, spec.ys, spec.z, x, y);
  if (value === null) return null;
  return { x, y, z: value, source: 'grid' };
}

/** Nearest plotted element to a data coordinate, within a pixel tolerance. */
export function nearestPoint<T extends { x: number; y: number }>(
  points: T[],
  x: number,
  y: number,
  options: { toleranceX: number; toleranceY: number },
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  points.forEach((point) => {
    const dx = Math.abs(point.x - x) / (options.toleranceX || 1);
    const dy = Math.abs(point.y - y) / (options.toleranceY || 1);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  });
  return bestDistance <= 1 ? best : null;
}

/** Plotted points a chart exposes for the readout, in data coordinates. */
export function chartPoints(spec: ChartSpec): { x: number; y: number; z?: number; label?: string }[] {
  switch (spec.kind) {
    case 'contour':
      return (spec.points ?? []).map((point) => ({ x: point.x, y: point.y, z: point.z, label: point.label }));
    case 'scatter':
      return spec.series?.length
        ? spec.series.flatMap((series) => series.points.map((point) => ({ x: point.x, y: point.y, label: series.label })))
        : spec.points.map((point, i) => ({ x: point.x, y: point.y, label: spec.pointLabels?.[i] }));
    case 'line':
      return spec.series.flatMap((series) => series.points.map((point) => ({ x: point.x, y: point.y, label: series.label })));
    case 'timeseries':
      return spec.values.map((value, i) => ({ x: i + 1, y: value }));
    case 'control':
      return spec.panel.points.map((value, i) => ({ x: i + 1, y: value }));
    default:
      return [];
  }
}
