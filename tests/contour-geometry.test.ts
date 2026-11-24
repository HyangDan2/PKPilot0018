import { describe, expect, it } from 'vitest';
import {
  COLORMAP_IDS,
  bandColor,
  bandPolygons,
  computeContourLevels,
  contourPolylines,
  gridZExtent,
  marchingSquares,
  polygonArea,
  saddleValue,
  sampleColormap,
  stitchSegments,
} from '../src/lib/contour';
import type { ContourGrid } from '../src/lib/contour';

function gridOf(fn: (x: number, y: number) => number, n = 41, lo = -1, hi = 1): ContourGrid {
  const axis = Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  return { xs: axis, ys: [...axis], z: axis.map((y) => axis.map((x) => fn(x, y))) };
}

function near(a: number, b: number, tol = 1e-9): boolean {
  return Math.abs(a - b) <= tol;
}

describe('Marching Squares (WO-03)', () => {
  it('handles all sixteen cell cases with the right segment count', () => {
    const expected: Record<number, number> = {
      0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 6: 1, 7: 1, 8: 1, 9: 1, 10: 2, 11: 1, 12: 1, 13: 1, 14: 1, 15: 0,
    };
    for (let index = 0; index < 16; index += 1) {
      const z00 = index & 1 ? 2 : 0;
      const z10 = index & 2 ? 2 : 0;
      const z11 = index & 4 ? 2 : 0;
      const z01 = index & 8 ? 2 : 0;
      const grid: ContourGrid = { xs: [0, 1], ys: [0, 1], z: [[z00, z10], [z01, z11]] };
      const segments = marchingSquares(grid, 1);
      expect(segments.length, `case ${index}`).toBe(expected[index]);
      segments.forEach((segment) => {
        expect(Number.isFinite(segment.a.x) && Number.isFinite(segment.b.x)).toBe(true);
        expect(segment.a.x).toBeGreaterThanOrEqual(0);
        expect(segment.a.x).toBeLessThanOrEqual(1);
        expect(segment.a.y).toBeGreaterThanOrEqual(0);
        expect(segment.a.y).toBeLessThanOrEqual(1);
      });
    }
  });

  it('resolves both saddle cases with the asymptotic decider', () => {
    // Case 5: z00 and z11 are inside. Saddle value = 0 < 0.5 → the inside
    // corners are cut off separately (edges 3-0 and 1-2).
    const case5: ContourGrid = { xs: [0, 1], ys: [0, 1], z: [[1, -1], [-1, 1]] };
    expect(saddleValue(1, -1, 1, -1)).toBeCloseTo(0, 12);
    const segments5 = marchingSquares(case5, 0.5);
    expect(segments5).toHaveLength(2);
    // Each segment joins adjacent edges of one outside corner.
    const edgeOf = (x: number, y: number): string => {
      if (near(y, 0)) return 'bottom';
      if (near(x, 1)) return 'right';
      if (near(y, 1)) return 'top';
      if (near(x, 0)) return 'left';
      return 'inside';
    };
    const pairs = segments5.map((s) => [edgeOf(s.a.x, s.a.y), edgeOf(s.b.x, s.b.y)].sort().join('-')).sort();
    expect(pairs).toEqual(['bottom-left', 'right-top']);

    // Case 10 with a centre above the level joins z10/z01, so the two outside
    // corners (z00 and z11) are cut off instead.
    const case10: ContourGrid = { xs: [0, 1], ys: [0, 1], z: [[-1, 1], [1, -1]] };
    expect(saddleValue(-1, 1, -1, 1)).toBeCloseTo(0, 12);
    const segments10 = marchingSquares(case10, -0.5);
    expect(segments10).toHaveLength(2);
    const pairs10 = segments10.map((s) => [edgeOf(s.a.x, s.a.y), edgeOf(s.b.x, s.b.y)].sort().join('-')).sort();
    expect(pairs10).toEqual(['bottom-left', 'right-top']);
  });

  it('keeps exact vertex ties deterministic (no zero-length segments)', () => {
    const grid = gridOf((x, y) => x + y, 5);
    const segments = marchingSquares(grid, 0);
    expect(segments.length).toBeGreaterThan(0);
    segments.forEach((segment) => {
      const length = Math.hypot(segment.a.x - segment.b.x, segment.a.y - segment.b.y);
      expect(length).toBeGreaterThan(1e-9);
      expect(Number.isFinite(segment.a.x) && Number.isFinite(segment.b.y)).toBe(true);
      expect(Math.abs(segment.a.x + segment.a.y)).toBeLessThan(1e-6);
      expect(Math.abs(segment.b.x + segment.b.y)).toBeLessThan(1e-6);
    });
  });

  it('skips every cell that touches a non-finite value', () => {
    const grid = gridOf((x, y) => x + y, 5);
    const centre = Math.floor(grid.xs.length / 2);
    grid.z[centre][centre] = Number.NaN;
    const segments = marchingSquares(grid, 0);
    expect(segments.length).toBeGreaterThan(0);
    // The four cells around the missing vertex are masked: no endpoint may sit
    // strictly inside that block.
    segments.forEach((segment) => {
      [segment.a, segment.b].forEach((point) => {
        const insideBlock = Math.abs(point.x) < 0.5 - 1e-9 && Math.abs(point.y) < 0.5 - 1e-9;
        expect(insideBlock).toBe(false);
      });
    });
  });
});

describe('contour geometry against analytical surfaces', () => {
  it('traces the plane Z = X + Y exactly', () => {
    const grid = gridOf((x, y) => x + y, 61);
    const lines = contourPolylines(grid, [-0.8, -0.2, 0, 0.35, 0.9]);
    lines.forEach((entry) => {
      expect(entry.lines.length).toBeGreaterThan(0);
      entry.lines.forEach((line) => {
        line.points.forEach((point) => {
          expect(Math.abs(point.x + point.y - entry.level)).toBeLessThan(1e-9);
        });
      });
    });
  });

  it('traces the paraboloid Z = X² + Y² as circles of radius √level', () => {
    const grid = gridOf((x, y) => x * x + y * y, 81);
    const lines = contourPolylines(grid, [0.25, 0.5, 1.0]);
    lines.forEach((entry) => {
      const radius = Math.sqrt(entry.level);
      expect(entry.lines.length).toBeGreaterThan(0);
      entry.lines.forEach((line) => {
        line.points.forEach((point) => {
          expect(Math.abs(Math.hypot(point.x, point.y) - radius)).toBeLessThan(0.02);
        });
      });
    });
  });

  it('traces the saddle Z = X² − Y² as the expected hyperbolas', () => {
    const grid = gridOf((x, y) => x * x - y * y, 81);
    const lines = contourPolylines(grid, [-0.5, 0, 0.5]);
    lines.forEach((entry) => {
      expect(entry.lines.length).toBeGreaterThan(0);
      entry.lines.forEach((line) => {
        line.points.forEach((point) => {
          expect(Math.abs(point.x * point.x - point.y * point.y - entry.level)).toBeLessThan(0.02);
        });
      });
    });
    // Level 0 is the pair of diagonals and must split into more than one line.
    const zero = lines.find((entry) => entry.level === 0)!;
    expect(zero.lines.length).toBeGreaterThanOrEqual(2);
  });

  it('traces the interaction Z = XY as hyperbolas that never cross the axes', () => {
    const grid = gridOf((x, y) => x * y, 81);
    const lines = contourPolylines(grid, [0.25]);
    lines[0].lines.forEach((line) => {
      line.points.forEach((point) => {
        expect(Math.abs(point.x * point.y - 0.25)).toBeLessThan(0.02);
      });
    });
  });

  it('produces no lines for a constant surface', () => {
    const grid = gridOf(() => 7, 11);
    expect(marchingSquares(grid, 7)).toHaveLength(0);
    expect(marchingSquares(grid, 6.5)).toHaveLength(0);
  });
});

describe('segment stitching', () => {
  it('joins cell segments into one closed loop and reduces the node count', () => {
    const grid = gridOf((x, y) => x * x + y * y, 81);
    const segments = marchingSquares(grid, 1);
    const lines = stitchSegments(segments, 2);
    expect(lines.length).toBeLessThan(segments.length);
    const closed = lines.filter((line) => line.closed);
    expect(closed.length).toBeGreaterThanOrEqual(1);
    const loop = closed.sort((a, b) => b.points.length - a.points.length)[0];
    expect(loop.points.length).toBeGreaterThan(50);
    // The loop closes: the first point is not repeated at the end.
    const first = loop.points[0];
    const last = loop.points[loop.points.length - 1];
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(1e-9);
  });
});

describe('filled bands (WO-04)', () => {
  it('clips band polygons exactly to [lo, hi] and covers the whole plot', () => {
    const grid = gridOf((x, y) => x + y, 41);
    const bands = bandPolygons(grid, [-2, 0, 2]);
    expect(bands).toHaveLength(2);
    let total = 0;
    bands.forEach((band) => {
      band.polygons.forEach((polygon) => {
        polygon.forEach((point) => {
          const value = point.x + point.y;
          expect(value).toBeGreaterThanOrEqual(band.lo - 1e-9);
          expect(value).toBeLessThanOrEqual(band.hi + 1e-9);
        });
        total += polygonArea(polygon);
      });
    });
    expect(total).toBeGreaterThan(3.999);
    expect(total).toBeLessThan(4.001);
    // Whole cells are merged into row runs: far fewer polygons than cells.
    const polygonCount = bands.reduce((a, band) => a + band.polygons.length, 0);
    expect(polygonCount).toBeLessThan(700);
  });

  it('masks missing cells out of the filled bands too', () => {
    const grid = gridOf((x, y) => x + y, 11);
    grid.z[5][5] = Number.NaN;
    const bands = bandPolygons(grid, [-0.25, 0.25]);
    bands.forEach((band) => {
      band.polygons.forEach((polygon) => {
        polygon.forEach((point) => {
          expect(Number.isFinite(point.x + point.y)).toBe(true);
        });
      });
    });
  });
});

describe('levels and colour maps (WO-05)', () => {
  const grid = gridOf((x, y) => x + y + 1.5, 11); // −0.5 … 3.5
  const extent = gridZExtent(grid);

  it('computes auto, manual and custom bands (up to 50)', () => {
    expect(extent.zMin).toBeCloseTo(-0.5, 9);
    expect(extent.zMax).toBeCloseTo(3.5, 9);

    const auto = computeContourLevels(grid, { levelCount: 10 });
    expect(auto.boundaries).toHaveLength(11);
    expect(auto.levels).toHaveLength(9);

    const manual = computeContourLevels(grid, { levelMode: 'manual', levelInterval: 0.5 });
    manual.boundaries.forEach((v, i) => { if (i) expect(v - manual.boundaries[i - 1]).toBeCloseTo(0.5, 6); });

    const custom = computeContourLevels(grid, { levelMode: 'custom', customLevels: [1, 2] });
    expect(custom.boundaries).toEqual([-0.5, 1, 2, 3.5]);

    const capped = computeContourLevels(grid, { levelCount: 1000 });
    expect(capped.boundaries.length).toBeLessThanOrEqual(51);
  });

  it('offers nine colour maps with interpolated samples', () => {
    expect(COLORMAP_IDS).toHaveLength(9);
    expect(sampleColormap('viridis', 0)).toBe('#440154');
    expect(sampleColormap('viridis', 1)).toBe('#fde725');
    expect(sampleColormap('viridis', -1)).toBe('#440154');
    expect(sampleColormap('turbo', 2)).toBe('#7a0402');
    expect(bandColor('grayscale', 0, 3)).not.toBe(bandColor('grayscale', 1, 3));
    const mid = sampleColormap('coolwarm', 0.5);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
  });
});
