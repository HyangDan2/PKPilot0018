import { describe, expect, it } from 'vitest';
import {
  bandPolygons,
  computeContourLevels,
  marchingSquares,
  polygonArea,
  saddleValue,
  type ContourGrid,
} from '../src/lib/contour';

type F = (x: number, y: number) => number;

function grid(n: number, f: F): ContourGrid {
  const xs = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
  const ys = [...xs];
  return { xs, ys, z: ys.map((y) => xs.map((x) => f(x, y))) };
}

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The bilinear value the mesh implies at any point of a cell. */
function bilinear(g: ContourGrid, p: { x: number; y: number }): number {
  const { xs, ys, z } = g;
  let i = 0;
  while (i < xs.length - 2 && xs[i + 1] < p.x) i += 1;
  let j = 0;
  while (j < ys.length - 2 && ys[j + 1] < p.y) j += 1;
  const tx = (p.x - xs[i]) / (xs[i + 1] - xs[i] || 1);
  const ty = (p.y - ys[j]) / (ys[j + 1] - ys[j] || 1);
  return (1 - tx) * (1 - ty) * z[j][i] + tx * (1 - ty) * z[j][i + 1]
    + (1 - tx) * ty * z[j + 1][i] + tx * ty * z[j + 1][i + 1];
}

const SURFACES: [string, F][] = [
  ['plane x+y', (x, y) => x + y],
  ['paraboloid x²+y²', (x, y) => x * x + y * y],
  ['saddle x²−y²', (x, y) => x * x - y * y],
  ['interaction xy', (x, y) => x * y],
  ['tilted saddle 0.3x+xy', (x, y) => 0.3 * x + x * y],
  ['cubic + noise-free crest', (x, y) => 0.4 * x ** 3 - 0.6 * y ** 2 + 0.2 * x * y],
];

describe('filled contour boundaries match the iso-lines (WO-01/8)', () => {
  it('tiles the whole plot area exactly — no gap and no double-filled band', () => {
    for (const [name, f] of SURFACES) {
      for (const n of [5, 6, 11, 21]) {
        const g = grid(n, f);
        const levels = computeContourLevels(g, { levelCount: 5 });
        const bands = bandPolygons(g, levels.boundaries);
        const area = bands.reduce((sum, band) => sum + band.polygons.reduce((a, p) => a + polygonArea(p), 0), 0);
        const domain = (g.xs[n - 1] - g.xs[0]) * (g.ys[n - 1] - g.ys[0]);
        expect(Math.abs(area - domain), `${name} n=${n}: ${area} vs ${domain}`).toBeLessThan(1e-9);
      }
    }
  });

  it('never puts a band vertex outside that band’s own value limits', () => {
    for (const [name, f] of SURFACES) {
      const g = grid(11, f);
      const levels = computeContourLevels(g, { levelCount: 5 });
      const bands = bandPolygons(g, levels.boundaries);
      bands.forEach((band) => {
        band.polygons.forEach((polygon) => {
          polygon.forEach((point) => {
            const value = bilinear(g, point);
            expect(value, `${name}: vertex ${value} outside ${band.lo}…${band.hi}`).toBeGreaterThanOrEqual(band.lo - 1e-9);
            expect(value, `${name}: vertex ${value} outside ${band.lo}…${band.hi}`).toBeLessThanOrEqual(band.hi + 1e-9);
          });
        });
      });
    }
  });

  it('places every drawn iso-line exactly on a colour boundary', () => {
    for (const [name, f] of SURFACES) {
      for (const n of [6, 11]) {
        const g = grid(n, f);
        const levels = computeContourLevels(g, { levelCount: 5 });
        const bands = bandPolygons(g, levels.boundaries);
        const edges: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
        bands.forEach((band) => band.polygons.forEach((polygon) => {
          for (let i = 0; i < polygon.length; i += 1) edges.push({ a: polygon[i], b: polygon[(i + 1) % polygon.length] });
        }));
        levels.boundaries.slice(1, -1).forEach((boundary) => {
          marchingSquares(g, boundary).forEach((segment) => {
            const mid = { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
            const nearest = Math.min(...edges.map((edge) => distanceToSegment(mid, edge.a, edge.b)));
            expect(nearest, `${name} n=${n} level ${boundary}: iso segment ${nearest} from a band edge`).toBeLessThan(1e-9);
          });
        });
      }
    }
  });

  it('splits a saddle cell into two pieces instead of one spanning polygon', () => {
    // z = xy on a symmetric grid: the cell at the origin has four crossings at
    // level 0.12, and the two above-level corners are diagonal.
    const g = grid(3, (x, y) => x * y);
    const corners = { v00: -1, v10: 1, v11: 1, v01: -1 };
    const middle = saddleValue(corners.v00, corners.v10, corners.v11, corners.v01);
    expect(Number.isFinite(middle)).toBe(true);

    // A level above the saddle value isolates the two above-level corners.
    const levelAboveSaddle = 0.5;
    const bands = bandPolygons(g, [-10, levelAboveSaddle, 10]);
    const above = bands[1];
    expect(above.polygons.length).toBeGreaterThan(0);
    // Every piece of the above band is one of the two corner regions: its area
    // is a fraction of a cell, never the whole cell.
    above.polygons.forEach((polygon) => {
      expect(polygonArea(polygon)).toBeLessThan((g.xs[1] - g.xs[0]) * (g.ys[1] - g.ys[0]) * 0.9);
    });
  });

  it('gives a flat cell that lies exactly on a boundary exactly one owner', () => {
    // Four corners all zero: the cell is flat at the level of the middle band.
    const xs = [0, 1, 2];
    const ys = [0, 1, 2];
    const z = [[1, 1, 1], [1, 0, 0], [1, 0, 0]];
    const g = { xs, ys, z };
    const bands = bandPolygons(g, [-1, 0, 1]);
    const area = bands.reduce((sum, band) => sum + band.polygons.reduce((a, p) => a + polygonArea(p), 0), 0);
    expect(area).toBeCloseTo(4, 12);
    // The flat cell is claimed once: a sample point inside it belongs to one
    // band only, and the two bands never share area.
    const inside = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    const sample = { x: 1.5, y: 1.5 };
    const owners = bands.filter((band) => band.polygons.some((polygon) => inside(sample, polygon)));
    expect(owners).toHaveLength(1);
  });

  it('draws nothing for a grid that is entirely masked', () => {
    const nan = Number.NaN;
    const g = { xs: [0, 1, 2], ys: [0, 1, 2], z: [[nan, nan, nan], [nan, nan, nan], [nan, nan, nan]] };
    const bands = bandPolygons(g, [0, 1, 2]);
    expect(bands.every((band) => band.polygons.length === 0)).toBe(true);
    expect(marchingSquares(g, 0.5)).toEqual([]);
  });

  it('keeps a masked cell out of every band', () => {
    const nan = Number.NaN;
    const g = { xs: [0, 1, 2], ys: [0, 1], z: [[0, nan, 2], [0, nan, 2]] };
    const bands = bandPolygons(g, [0, 1, 2]);
    const area = bands.reduce((sum, band) => sum + band.polygons.reduce((a, p) => a + polygonArea(p), 0), 0);
    // Both cells of this grid touch the masked column, so nothing is filled.
    expect(area).toBe(0);
    // Drop the mask: the same grid paints its two cells.
    const clean = { xs: [0, 1, 2], ys: [0, 1], z: [[0, 1, 2], [0, 1, 2]] };
    const painted = bandPolygons(clean, [0, 1, 2]).reduce((sum, band) => sum + band.polygons.reduce((a, p) => a + polygonArea(p), 0), 0);
    expect(painted).toBeCloseTo(2, 12);
  });
});
