/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — contour geometry engine (WO-03 / WO-04 / WO-05)

   Pure functions, no DOM and no dependency: Marching Squares over all sixteen
   cell cases with the asymptotic decider for the two saddle cases, segment
   stitching into continuous polylines, real interpolated band polygons for
   filled contours, and nine perceptual colour maps.

   Zero-dependency and offline: no Gaussian-blur imitation, no WebGL.
   ───────────────────────────────────────────────────────────────────────── */

import type { ContourColormap, ContourConfig, ContourLevelMode } from './chartConfig';

export interface Point {
  x: number;
  y: number;
}

export interface ContourGrid {
  xs: number[];
  ys: number[];
  /** z[j][i] is the value at (xs[i], ys[j]); row 0 is the smallest y. */
  z: number[][];
}

export interface ContourSegment {
  a: Point;
  b: Point;
}

export interface ContourPolyline {
  points: Point[];
  closed: boolean;
}

export interface ContourLevelSet {
  /** Interior iso-levels (lines), strictly increasing. */
  levels: number[];
  /** Band boundaries including zMin and zMax, strictly increasing. */
  boundaries: number[];
  min: number;
  max: number;
}

export interface ContourBand {
  lo: number;
  hi: number;
  /** Band index from the bottom (0 = lowest). */
  index: number;
  polygons: Point[][];
}

/** Non-finite extent helper: NaN cells are masked, not drawn. */
export function gridZExtent(grid: ContourGrid): { zMin: number; zMax: number } {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const row of grid.z) {
    for (const value of row) {
      if (!Number.isFinite(value)) continue;
      if (value < zMin) zMin = value;
      if (value > zMax) zMax = value;
    }
  }
  if (!Number.isFinite(zMin)) return { zMin: 0, zMax: 0 };
  return { zMin, zMax };
}

/** Number of cells that carry a finite value (an all-NaN grid is not a surface). */
export function gridFiniteCells(grid: ContourGrid): number {
  let count = 0;
  for (const row of grid.z) {
    for (const value of row) if (Number.isFinite(value)) count += 1;
  }
  return count;
}

/**
 * Compute the iso-lines and the band boundaries for a grid.
 *
 * Auto mode divides the fitted range into `levelCount` bands (2…50 — the old
 * engine stopped at 8). Manual mode uses a fixed interval; custom mode takes
 * the user's explicit values and keeps them strictly increasing.
 */
export function computeContourLevels(grid: ContourGrid, config?: Partial<ContourConfig>): ContourLevelSet {
  const extent = gridZExtent(grid);
  let zMin = config?.zMin != null && Number.isFinite(config.zMin) ? (config.zMin as number) : extent.zMin;
  let zMax = config?.zMax != null && Number.isFinite(config.zMax) ? (config.zMax as number) : extent.zMax;
  // A window whose lower limit is not below its upper one describes no bands.
  // Ignore the request and draw the data range instead of a blank frame.
  if (!(zMax > zMin)) {
    zMin = extent.zMin;
    zMax = extent.zMax;
  }
  const mode: ContourLevelMode = config?.levelMode ?? 'auto';
  const requested = config?.levelCount;
  // NaN / Infinity / a missing count all mean "the default number of bands".
  const count = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.max(2, Math.min(50, Math.round(requested)))
    : 10;
  if (!(zMax > zMin)) return { levels: [], boundaries: [], min: zMin, max: zMax };
  let boundaries: number[];
  if (mode === 'custom' && config?.customLevels?.length) {
    const inside = config.customLevels
      .filter((v) => Number.isFinite(v) && v > zMin && v < zMax)
      .sort((a, b) => a - b)
      .filter((v, i, list) => i === 0 || v > list[i - 1] + 1e-12);
    boundaries = [zMin, ...inside, zMax];
  } else if (mode === 'manual' && config?.levelInterval != null && Number.isFinite(config.levelInterval) && config.levelInterval > 0) {
    const step = config.levelInterval;
    const inside: number[] = [];
    const first = Math.ceil(zMin / step + 1e-9) * step;
    for (let v = first; v < zMax - 1e-12 && inside.length < 50; v += step) {
      if (v > zMin + 1e-12) inside.push(Number(v.toFixed(12)));
    }
    boundaries = [zMin, ...inside, zMax];
  } else {
    const bands = Math.min(count, 50);
    boundaries = Array.from({ length: bands + 1 }, (_, i) => zMin + ((zMax - zMin) * i) / bands);
  }
  boundaries = boundaries
    .filter((v, i, list) => Number.isFinite(v) && (i === 0 || v > list[i - 1]))
    .sort((a, b) => a - b);
  if (boundaries.length < 2) return { levels: [], boundaries: [], min: zMin, max: zMax };
  const levels = boundaries.slice(1, -1);
  return { levels, boundaries, min: zMin, max: zMax };
}

type Edge = 0 | 1 | 2 | 3;

/** The two edges a case's contour segment crosses (see the case table below). */
const CASE_EDGES: Record<number, [Edge, Edge] | 'saddle0' | 'saddle1'> = {
  0: [0, 0],
  1: [3, 0],
  2: [0, 1],
  3: [3, 1],
  4: [1, 2],
  5: 'saddle0',
  6: [0, 2],
  7: [3, 2],
  8: [2, 3],
  9: [0, 2],
  10: 'saddle1',
  11: [1, 2],
  12: [1, 3],
  13: [0, 1],
  14: [3, 0],
  15: [0, 0],
};

function crossing(p0: Point, v0: number, p1: Point, v1: number, level: number): Point {
  const dv = v1 - v0;
  const t = dv === 0 ? 0.5 : (level - v0) / dv;
  return { x: p0.x + t * (p1.x - p0.x), y: p0.y + t * (p1.y - p0.y) };
}

/**
 * Asymptotic decider: the value at a bilinear cell's saddle point. Comparing it
 * with the iso-level tells us whether the two above-level corners connect
 * through the middle of the cell or are split by the contour.
 */
export function saddleValue(z00: number, z10: number, z11: number, z01: number): number {
  const den = z00 + z11 - z10 - z01;
  if (Math.abs(den) < 1e-14) return (z00 + z10 + z11 + z01) / 4;
  return (z00 * z11 - z10 * z01) / den;
}

/**
 * Marching Squares over every cell of the grid at one level.
 *
 * Cells with a non-finite corner are skipped entirely (a mask in the data must
 * not leak a contour through missing values). Values that sit exactly on the
 * level are nudged by a relative epsilon so a vertex can never produce two
 * coincident crossings, which keeps the topology deterministic.
 */
export function marchingSquares(grid: ContourGrid, level: number): ContourSegment[] {
  const { xs, ys, z } = grid;
  if (!Number.isFinite(level) || xs.length < 2 || ys.length < 2) return [];
  const segments: ContourSegment[] = [];
  const span = Math.max(
    ...z.map((row) => row.reduce((best, v) => (Number.isFinite(v) ? Math.max(best, Math.abs(v)) : best), 0)),
    1e-12,
  );
  const tie = span * 1e-12;
  const adjust = (v: number) => (Math.abs(v - level) <= tie ? level + tie : v);
  for (let j = 0; j < ys.length - 1; j += 1) {
    for (let i = 0; i < xs.length - 1; i += 1) {
      const raw00 = z[j]?.[i];
      const raw10 = z[j]?.[i + 1];
      const raw11 = z[j + 1]?.[i + 1];
      const raw01 = z[j + 1]?.[i];
      if (![raw00, raw10, raw11, raw01].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const z00 = adjust(raw00);
      const z10 = adjust(raw10);
      const z11 = adjust(raw11);
      const z01 = adjust(raw01);
      const index = (z00 >= level ? 1 : 0) | (z10 >= level ? 2 : 0) | (z11 >= level ? 4 : 0) | (z01 >= level ? 8 : 0);
      if (index === 0 || index === 15) continue;
      const p00 = { x: xs[i], y: ys[j] };
      const p10 = { x: xs[i + 1], y: ys[j] };
      const p11 = { x: xs[i + 1], y: ys[j + 1] };
      const p01 = { x: xs[i], y: ys[j + 1] };
      const c0 = crossing(p00, z00, p10, z10, level); // bottom edge
      const c1 = crossing(p10, z10, p11, z11, level); // right edge
      const c2 = crossing(p11, z11, p01, z01, level); // top edge
      const c3 = crossing(p01, z01, p00, z00, level); // left edge
      const edges: Point[] = [c0, c1, c2, c3];
      const spec = CASE_EDGES[index];
      if (spec === 'saddle0' || spec === 'saddle1') {
        const mid = saddleValue(z00, z10, z11, z01);
        // case 5: z00 and z11 are above the level. A centre above the level
        // joins them, so the two outside corners are each cut off separately.
        const centreAbove = mid >= level;
        const aroundZeroth = index === 5 ? !centreAbove : centreAbove;
        const pairs: [Edge, Edge][] = aroundZeroth
          ? [[3, 0], [1, 2]] // cut off z00 then z11 (or the mirrored pair)
          : [[0, 1], [2, 3]]; // cut off z10 then z01
        pairs.forEach(([e1, e2]) => {
          segments.push({ a: edges[e1], b: edges[e2] });
        });
        continue;
      }
      const [e1, e2] = spec;
      const a = edges[e1];
      const b = edges[e2];
      // A segment that only grazes a corner carries no direction and would
      // break stitching; drop it relative to the cell size.
      const cellSize = Math.hypot(xs[i + 1] - xs[i], ys[j + 1] - ys[j]) || 1;
      if (Math.hypot(a.x - b.x, a.y - b.y) < cellSize * 1e-9) continue;
      segments.push({ a, b });
    }
  }
  return segments;
}

function pointKey(p: Point, eps: number): string {
  return `${Math.round(p.x / eps)},${Math.round(p.y / eps)}`;
}

/** Stitch cell segments into continuous open polylines and closed loops. */
export function stitchSegments(segments: ContourSegment[], spanHint?: number): ContourPolyline[] {
  if (!segments.length) return [];
  let span = spanHint ?? 0;
  if (!span) {
    let lo = Infinity;
    let hi = -Infinity;
    segments.forEach((s) => {
      [s.a.x, s.b.x].forEach((x) => { lo = Math.min(lo, x); hi = Math.max(hi, x); });
      [s.a.y, s.b.y].forEach((y) => { lo = Math.min(lo, y); hi = Math.max(hi, y); });
    });
    span = Number.isFinite(lo) && Number.isFinite(hi) ? Math.max(hi - lo, 1e-9) : 1;
  }
  const eps = Math.max(span * 1e-9, 1e-14);
  const at: Map<string, number[]> = new Map();
  segments.forEach((segment, index) => {
    [segment.a, segment.b].forEach((point) => {
      const key = pointKey(point, eps);
      const list = at.get(key) ?? [];
      list.push(index);
      at.set(key, list);
    });
  });
  const used = new Array<boolean>(segments.length).fill(false);
  const lines: ContourPolyline[] = [];
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue;
    used[start] = true;
    let points: Point[] = [segments[start].a, segments[start].b];
    // Extend at the tail.
    for (;;) {
      const tail = points[points.length - 1];
      const candidates = at.get(pointKey(tail, eps)) ?? [];
      const next = candidates.find((index) => !used[index]);
      if (next === undefined) break;
      used[next] = true;
      const segment = segments[next];
      points.push(pointKey(segment.a, eps) === pointKey(tail, eps) ? segment.b : segment.a);
    }
    // Extend at the head.
    for (;;) {
      const head = points[0];
      const candidates = at.get(pointKey(head, eps)) ?? [];
      const next = candidates.find((index) => !used[index]);
      if (next === undefined) break;
      used[next] = true;
      const segment = segments[next];
      const other = pointKey(segment.a, eps) === pointKey(head, eps) ? segment.b : segment.a;
      points = [other, ...points];
    }
    const closed = points.length > 2 && pointKey(points[0], eps) === pointKey(points[points.length - 1], eps);
    lines.push({ points: closed ? dedupeEnd(points, eps) : points, closed });
  }
  return lines;
}

function dedupeEnd(points: Point[], eps: number): Point[] {
  // A closed loop repeats its first point at the end before closing the path;
  // dropping the duplicate keeps the drawn path clean.
  if (points.length > 2 && pointKey(points[0], eps) === pointKey(points[points.length - 1], eps)) {
    return points.slice(0, -1);
  }
  return points;
}

/** All iso-lines of a grid, stitched into polylines per level. */
export function contourPolylines(grid: ContourGrid, levels: number[]): { level: number; lines: ContourPolyline[] }[] {
  const dx = Math.abs((grid.xs[grid.xs.length - 1] ?? 0) - (grid.xs[0] ?? 0));
  const dy = Math.abs((grid.ys[grid.ys.length - 1] ?? 0) - (grid.ys[0] ?? 0));
  const span = Math.max(dx, dy);
  const hint = span > 0 ? span : 1;
  return levels.map((level) => ({ level, lines: stitchSegments(marchingSquares(grid, level), hint) }));
}

function clipHalfPlane(poly: { p: Point; v: number }[], threshold: number, keepAbove: boolean, strict = false): { p: Point; v: number }[] {
  if (poly.length < 2) return [];
  // `strict` makes a value exactly on the lower limit belong to the band above
  // it, so two neighbouring bands can never both claim the same corner.
  const inside = (v: number) => (keepAbove ? (strict ? v > threshold : v >= threshold) : v <= threshold);
  const out: { p: Point; v: number }[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const current = poly[i];
    const next = poly[(i + 1) % poly.length];
    const cIn = inside(current.v);
    const nIn = inside(next.v);
    if (cIn) out.push(current);
    if (cIn !== nIn) {
      const t = (threshold - current.v) / (next.v - current.v || 1);
      out.push({
        p: { x: current.p.x + t * (next.p.x - current.p.x), y: current.p.y + t * (next.p.y - current.p.y) },
        v: threshold,
      });
    }
  }
  return out;
}

/* ── cell decomposition shared by bands and iso-lines ─────────────────── */

interface Corner { p: Point; v: number }

function signedArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function asCcw(points: Point[]): Point[] {
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

/** Sutherland–Hodgman of a subject polygon by the half-plane left of a→b. */
function clipByDirectedEdge(subject: Point[], a: Point, b: Point): Point[] {
  if (subject.length < 3) return [];
  const side = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const out: Point[] = [];
  for (let i = 0; i < subject.length; i += 1) {
    const current = subject[i];
    const next = subject[(i + 1) % subject.length];
    const c = side(current);
    const n = side(next);
    if (c >= -1e-15) out.push(current);
    if ((c > 1e-15 && n < -1e-15) || (c < -1e-15 && n > 1e-15)) {
      const t = c / (c - n);
      out.push({ x: current.x + t * (next.x - current.x), y: current.y + t * (next.y - current.y) });
    }
  }
  return out;
}

/** Drop repeated and collinear-in-the-limit vertices a clip can leave behind. */
function cleanPolygon(points: Point[], eps: number): Point[] {
  const out: Point[] = [];
  points.forEach((point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const last = out[out.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) <= eps) return;
    out.push(point);
  });
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= eps) out.pop();
    else break;
  }
  return out;
}

/** Intersection of two convex polygons (both are cell pieces). */
function intersectConvex(subject: Point[], clip: Point[]): Point[] {
  let out = asCcw(subject);
  const ccw = asCcw(clip);
  for (let i = 0; i < ccw.length && out.length >= 3; i += 1) {
    out = clipByDirectedEdge(out, ccw[i], ccw[(i + 1) % ccw.length]);
  }
  return out.length >= 3 ? out : [];
}

/**
 * The part of one cell where z ≥ level, as one or two polygons.
 *
 * A bilinear cell whose four edges are all crossed by the level is a saddle:
 * the above-level corners are either joined through the middle or separated by
 * two branches. `saddleValue` decides which, with exactly the same comparison
 * `marchingSquares` makes, so a filled band and the iso-line drawn on top of it
 * can never disagree about the cell.
 */
function cellRegions(corners: Corner[], level: number, tie = 0): { above: Point[][]; below: Point[][]; saddle: boolean } {
  const [c00, c10, c11, c01] = corners;
  const quad = [c00.p, c10.p, c11.p, c01.p];
  // A corner sitting exactly on the level is nudged just above it, with the
  // same rule `marchingSquares` uses, so a degenerate cell (level through a
  // grid node) cannot produce a zero-width piece or a double-covered region.
  const nudge = (v: number) => (tie > 0 && Math.abs(v - level) <= tie ? level + tie : v);
  const above = corners.map((corner) => nudge(corner.v) >= level);
  const index = above.reduce((acc, flag, i) => acc | (flag ? 1 << i : 0), 0);
  if (index === 0) return { above: [], below: [quad], saddle: false };
  if (index === 15) return { above: [quad], below: [], saddle: false };
  const crossings: Point[] = [
    crossing(c00.p, nudge(c00.v), c10.p, nudge(c10.v), level), // edge 0: bottom
    crossing(c10.p, nudge(c10.v), c11.p, nudge(c11.v), level), // edge 1: right
    crossing(c11.p, nudge(c11.v), c01.p, nudge(c01.v), level), // edge 2: top
    crossing(c01.p, nudge(c01.v), c00.p, nudge(c00.v), level), // edge 3: left
  ];
  const values = corners.map((corner) => ({ p: corner.p, v: nudge(corner.v) }));
  if (index !== 5 && index !== 10) {
    const up = clipHalfPlane(values, level, true).map((entry) => entry.p);
    const down = clipHalfPlane(values, level, false).map((entry) => entry.p);
    return {
      above: up.length >= 3 ? [up] : [],
      below: down.length >= 3 ? [down] : [],
      saddle: false,
    };
  }
  // Saddle: `saddleValue` decides whether the above-level corners join through
  // the middle. The two sides of the split are complementary by construction,
  // so a level that lands exactly on the saddle value cannot double count.
  const centreAbove = saddleValue(nudge(c00.v), nudge(c10.v), nudge(c11.v), nudge(c01.v)) >= level;
  const octagon: Point[] = [quad[0], crossings[0], quad[1], crossings[1], quad[2], crossings[2], quad[3], crossings[3]];
  const cornerTriangle = (k: number): Point[] => [quad[k], crossings[k], crossings[(k + 3) % 4]];
  const hexagon = (removed: number[]): Point[] => octagon.filter((point) => !removed.some((k) => quad[k] === point));
  const cornersWith = (flag: boolean): number[] => above.reduce<number[]>((acc, value, k) => (value === flag ? [...acc, k] : acc), []);
  if (centreAbove) {
    return { above: [hexagon(cornersWith(false))], below: cornersWith(false).map((k) => cornerTriangle(k)), saddle: true };
  }
  return { above: cornersWith(true).map((k) => cornerTriangle(k)), below: [hexagon(cornersWith(true))], saddle: true };
}

/**
 * Interpolated band polygons for filled contours.
 *
 * Each cell's quad is clipped against `z >= lo` and `z <= hi` with
 * Sutherland–Hodgman; the crossings sit on the exact interpolated position of
 * the cell edge, so a band boundary follows the data instead of a blurred
 * rectangle. Cells that lie wholly inside a band are merged row-wise into one
 * rectangle — otherwise a 101×101 surface would emit forty thousand four-point
 * sub-paths and produce a multi-megabyte SVG.
 */
export function bandPolygons(
  grid: ContourGrid,
  boundaries: number[],
  _options: { maxPolygonsPerBand?: number } = {},
): ContourBand[] {
  const { xs, ys, z } = grid;
  if (boundaries.length < 2 || xs.length < 2 || ys.length < 2) return [];
  let span = 1e-12;
  for (const row of z) {
    for (const value of row) if (Number.isFinite(value)) span = Math.max(span, Math.abs(value));
  }
  const tie = span * 1e-12;
  const bands: ContourBand[] = [];
  for (let b = 0; b < boundaries.length - 1; b += 1) {
    bands.push({ lo: boundaries[b], hi: boundaries[b + 1], index: b, polygons: [] });
  }
  // Full cells per band, keyed by row -> cell indices (merged into runs).
  const full: Map<number, number[]>[] = bands.map(() => new Map<number, number[]>());
  for (let j = 0; j < ys.length - 1; j += 1) {
    for (let i = 0; i < xs.length - 1; i += 1) {
      const v00 = z[j]?.[i];
      const v10 = z[j]?.[i + 1];
      const v11 = z[j + 1]?.[i + 1];
      const v01 = z[j + 1]?.[i];
      if (![v00, v10, v11, v01].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const cellMin = Math.min(v00, v10, v11, v01);
      const cellMax = Math.max(v00, v10, v11, v01);
      const p00 = { x: xs[i], y: ys[j] };
      const p10 = { x: xs[i + 1], y: ys[j] };
      const p11 = { x: xs[i + 1], y: ys[j + 1] };
      const p01 = { x: xs[i], y: ys[j + 1] };
      const quad = [
        { p: p00, v: v00 },
        { p: p10, v: v10 },
        { p: p11, v: v11 },
        { p: p01, v: v01 },
      ];
      for (const band of bands) {
        if (cellMax < band.lo - tie || cellMin > band.hi + tie) continue;
        // A cell within the tie of its band limits counts as wholly inside it;
        // the `break` below gives such a (near-flat) cell exactly one owner.
        if (cellMin >= band.lo - tie && cellMax <= band.hi + tie) {
          // Whole cell inside one band: remember it for a run.
          let rowMap = full[band.index].get(j);
          if (!rowMap) { rowMap = []; full[band.index].set(j, rowMap); }
          rowMap.push(i);
          // A cell that lies wholly in one band belongs to that band alone: a
          // flat cell exactly on a boundary would otherwise be claimed by both
          // neighbours and colour twice.
          break;
        }
        // A partially covered cell is decomposed by the SAME rule the iso-lines
        // use: the region above the lower boundary intersected with the region
        // below the upper one. A saddle cell therefore splits into two pieces
        // instead of one polygon that spills into its neighbour's band.
        const corners: Corner[] = [
          { p: p00, v: v00 },
          { p: p10, v: v10 },
          { p: p11, v: v11 },
          { p: p01, v: v01 },
        ];
        const lower = cellRegions(corners, band.lo, tie);
        if (!lower.above.length) continue;
        const upper = cellRegions(corners, band.hi, tie);
        if (!upper.below.length) continue;
        const cellDiagonal = Math.hypot(xs[i + 1] - xs[i], ys[j + 1] - ys[j]) || 1;
        const eps = cellDiagonal * 1e-9;
        if (!lower.saddle && !upper.saddle) {
          // Neither boundary is a saddle inside this cell: the band is the cell
          // clipped by the two levels, which is exact and numerically stable.
          const clipped = clipHalfPlane(clipHalfPlane(quad, band.lo, true, true), band.hi, false);
          if (clipped.length < 3) continue;
          const polygon = cleanPolygon(clipped.map((entry) => entry.p), eps);
          if (polygon.length >= 3 && polygonArea(polygon) > 1e-15) band.polygons.push(asCcw(polygon));
          continue;
        }
        lower.above.forEach((pieceAbove) => {
          upper.below.forEach((pieceBelow) => {
            const polygon = cleanPolygon(intersectConvex(pieceAbove, pieceBelow), eps);
            if (polygon.length < 3) return;
            if (polygonArea(polygon) < 1e-15) return;
            band.polygons.push(asCcw(polygon));
          });
        });
      }
    }
  }
  // Merge each row's consecutive full cells into one rectangle polygon.
  bands.forEach((band) => {
    const rows = [...(full[band.index].entries())].sort((a, b) => a[0] - b[0]);
    rows.forEach(([j, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      let start = sorted[0];
      let previous = sorted[0];
      const flush = (from: number, to: number) => {
        const x0 = xs[from];
        const x1 = xs[to + 1];
        const y0 = ys[j];
        const y1 = ys[j + 1];
        band.polygons.push([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
      };
      for (let k = 1; k < sorted.length; k += 1) {
        if (sorted[k] === previous + 1) { previous = sorted[k]; continue; }
        flush(start, previous);
        start = sorted[k];
        previous = sorted[k];
      }
      flush(start, previous);
    });
  });
  return bands;
}

export function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** SVG path for a list of polygons — one `M…Z` sub-path per polygon. */
export function polygonsToPath(
  polygons: Point[][],
  toX: (value: number) => number,
  toY: (value: number) => number,
  decimals = 1,
): string {
  const f = (v: number) => Number(v.toFixed(decimals));
  return polygons
    .filter((polygon) => polygon.length >= 3)
    .map((polygon) => `M${f(toX(polygon[0].x))} ${f(toY(polygon[0].y))}${polygon.slice(1).map((p) => `L${f(toX(p.x))} ${f(toY(p.y))}`).join('')}Z`)
    .join('');
}

/** SVG path for stitched contour polylines at one level. */
export function polylinesToPath(
  lines: ContourPolyline[],
  toX: (value: number) => number,
  toY: (value: number) => number,
  decimals = 1,
): string {
  const f = (v: number) => Number(v.toFixed(decimals));
  return lines
    .filter((line) => line.points.length > 1)
    .map((line) => {
      const head = `M${f(toX(line.points[0].x))} ${f(toY(line.points[0].y))}`;
      const body = line.points.slice(1).map((p) => `L${f(toX(p.x))} ${f(toY(p.y))}`).join('');
      return `${head}${body}${line.closed ? 'Z' : ''}`;
    })
    .join('');
}

/* ── colour maps ──────────────────────────────────────────────────────── */

/**
 * Perceptual anchor tables (sRGB). Interpolating anchors rather than sampling a
 * bitmap keeps the LUT dependency-free and identical in every browser.
 */
export const COLORMAPS: Record<ContourColormap, string[]> = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  cividis: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838'],
  plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  inferno: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'],
  turbo: [
    '#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b',
    '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0402',
  ],
  coolwarm: ['#3b4cc0', '#6788ee', '#9abbff', '#c9d7f0', '#ddddd5', '#f2cbb7', '#f7ac8e', '#ee8468', '#b40426'],
  rdbu: ['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f'],
  grayscale: ['#f7f7f7', '#d9d9d9', '#bdbdbd', '#969696', '#737373', '#525252', '#252525'],
  'sigrun-classic': ['#f6f3ff', '#e2d9ff', '#c9b8fb', '#a78bfa', '#8b6ce8', '#6d4ecb', '#45308f'],
};

export const COLORMAP_IDS = Object.keys(COLORMAPS) as ContourColormap[];

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Sample a colour map at t ∈ [0, 1]. */
export function sampleColormap(name: ContourColormap | undefined, t: number): string {
  const table = COLORMAPS[name ?? 'sigrun-classic'] ?? COLORMAPS['sigrun-classic'];
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  if (table.length === 1) return table[0];
  const pos = x * (table.length - 1);
  const index = Math.min(table.length - 2, Math.floor(pos));
  const frac = pos - index;
  const a = parseHex(table[index]);
  const b = parseHex(table[index + 1]);
  return toHex(a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac);
}

/** Discrete colour for band `index` among `count` bands. */
export function bandColor(name: ContourColormap | undefined, index: number, count: number): string {
  if (count <= 1) return sampleColormap(name, 0.5);
  return sampleColormap(name, (index + 0.5) / count);
}

/** Resolution presets in grid points per axis (WO-04). */
export const CONTOUR_RESOLUTIONS = { draft: 41, standard: 101, high: 201, ultra: 401 } as const;

export function resolutionPoints(resolution: string | undefined): number {
  switch (resolution) {
    case 'draft': return CONTOUR_RESOLUTIONS.draft;
    case 'high': return CONTOUR_RESOLUTIONS.high;
    case 'ultra': return CONTOUR_RESOLUTIONS.ultra;
    case 'standard':
    default: return CONTOUR_RESOLUTIONS.standard;
  }
}

/**
 * Estimate where a 1-D value sits inside a band list; used for colourbars and
 * for the target/spec region tint.
 */
export function bandIndex(value: number, boundaries: number[]): number {
  if (boundaries.length < 2) return -1;
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    if (value >= boundaries[i] && value <= boundaries[i + 1]) return i;
  }
  return value < boundaries[0] ? -1 : boundaries.length - 2;
}
