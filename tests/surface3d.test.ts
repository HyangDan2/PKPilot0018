import { describe, expect, it } from 'vitest';
import { makeWorksheet } from '../src/lib/datasets';
import { analyzeRsm, buildRsmModel } from '../src/lib/doe';
import { fitGlm, type ModelFactor } from '../src/lib/glm';
import {
  createStoredModel,
  draftFromGlm,
  draftFromRsmPayload,
  type StoredModel,
} from '../src/lib/modelStore';
import {
  buildSurfaceGeometry,
  cameraBasis,
  cameraMatrix,
  projectPoint,
  surfaceExtent,
  surfaceSvgBody,
  surfaceResolutionPoints,
  SURFACE_MAX_GRID,
} from '../src/lib/surface3d';
import { defaultSurfaceViewConfig } from '../src/lib/chartConfig';
import { buildModelSurface, materializeSurface } from '../src/lib/chartConfigOps';
import { modelSurface, predictStoredModel } from '../src/lib/modelPredictor';
import { renderChart } from '../src/lib/charts';
import type { ChartSpec } from '../src/types';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const DESIGN = {
  A: [-1, 1, -1, 1, 0, 1.414, -1.414, 0, 0, 0],
  B: [-1, -1, 1, 1, 0, 0, 0, 1.414, -1.414, 0],
};

function designSheet(response: string, values: number[]) {
  return makeWorksheet('Design', [
    { name: 'A', type: 'numeric', values: DESIGN.A },
    { name: 'B', type: 'numeric', values: DESIGN.B },
    { name: response, type: 'numeric', values },
  ]);
}

/** A stored RSM model carrying the Stage 3B covariance (buildRsmModel). */
function rsmStoredModel(y = [12, 16, 13, 17.5, 15, 13.2, 12.2, 12.5, 12.4, 15.1]): StoredModel {
  const sheet = designSheet('Y', y);
  const factors: ModelFactor[] = [
    { name: 'A', kind: 'numeric', values: sheet.columns[0].values },
    { name: 'B', kind: 'numeric', values: sheet.columns[1].values },
  ];
  const analysis = analyzeRsm(sheet.columns[2].values.map((value) => (typeof value === 'number' ? value : null)), factors);
  const payload = buildRsmModel(analysis.glm, factors as never, analysis.stationary);
  return createStoredModel(
    draftFromRsmPayload(payload, { response: { id: 'C3', name: 'Y' }, sheet, analysisId: 'rsmanalyze' }),
    'RSM fit',
  );
}

/** A stored quadratic with its (X'X)⁻¹ covariance, built through the GLM path. */
function quadraticModel(response: string, values: number[]): StoredModel {
  const sheet = designSheet(response, values);
  const factors: ModelFactor[] = [
    { name: 'A', kind: 'numeric', values: sheet.columns[0].values },
    { name: 'B', kind: 'numeric', values: sheet.columns[1].values },
  ];
  const terms = [
    { name: 'A', factors: ['A'] },
    { name: 'B', factors: ['B'] },
    { name: 'A×B', factors: ['A', 'B'] },
    { name: 'A²', factors: ['A²'] },
    { name: 'B²', factors: ['B²'] },
  ];
  const built: ModelFactor[] = [
    ...factors,
    { name: 'A²', kind: 'numeric', values: factors[0].values.map((value) => (typeof value === 'number' ? value * value : null)) },
    { name: 'B²', kind: 'numeric', values: factors[1].values.map((value) => (typeof value === 'number' ? value * value : null)) },
  ];
  const glm = fitGlm(sheet.columns[2].values.map((value) => (typeof value === 'number' ? value : null)), built, terms);
  return createStoredModel(
    draftFromGlm({
      glm,
      factors: built,
      terms,
      response: { id: 'C3', name: response, values: sheet.columns[2].values },
      kind: 'rsm',
      sheet,
    }),
    response,
  );
}

const STYLE = {
  surface: '#ffffff',
  plot: '#ffffff',
  ink: '#1f2937',
  label: '#4b5563',
  grid: '#e5e7eb',
  alarm: '#c02626',
  fontFamily: 'Inter, sans-serif',
  mono: 'ui-monospace, monospace',
};

function surfaceChart(model: StoredModel, overrides: Partial<Extract<ChartSpec, { kind: 'surface3d' }>> = {}): Extract<ChartSpec, { kind: 'surface3d' }> {
  const surface = buildModelSurface(model, { xIndex: 0, yIndex: 1, unitMode: 'coded', resolution: 21 });
  return {
    kind: 'surface3d',
    xs: surface.xs,
    ys: surface.ys,
    z: surface.z,
    xLabel: surface.xName,
    yLabel: surface.yName,
    zLabel: model.response.name,
    xRange: surface.xRange,
    yRange: surface.yRange,
    points: surface.points,
    model,
    ...overrides,
  };
}

/* ── geometry ─────────────────────────────────────────────────────────── */

describe('3D surface geometry (WO-03)', () => {
  it('builds one vertex per grid node and two triangles per cell', () => {
    const xs = [0, 0.5, 1];
    const ys = [0, 1];
    const z = [[1, 2, 3], [4, 5, 6]];
    const geometry = buildSurfaceGeometry({ xs, ys, z }, { meshDensity: 1 });
    expect(geometry.nx).toBe(3);
    expect(geometry.ny).toBe(2);
    expect(geometry.vertices.length).toBe(3 * 2 * 9);
    expect(geometry.indices.length).toBe(2 * 2 * 3);
    expect(geometry.faces).toBe(2);
  });

  it('leaves a masked (NaN) cell out of the mesh', () => {
    const geometry = buildSurfaceGeometry(
      { xs: [0, 1, 2], ys: [0, 1], z: [[1, Number.NaN, 3], [4, 5, 6]] },
      {},
    );
    expect(geometry.faces).toBe(0);
    expect(geometry.indices.length).toBe(0);
  });

  it('keeps the vertex inside the normalised box and reports the real extent', () => {
    const geometry = buildSurfaceGeometry({ xs: [-2, 0, 2], ys: [5, 7], z: [[1, 2, 3], [4, 5, 6]] }, { zScale: 1 });
    const positions = [...geometry.vertices];
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(-1.0001);
    expect(Math.max(...positions)).toBeLessThanOrEqual(1.0001);
    expect(geometry.zMin).toBe(1);
    expect(geometry.zMax).toBe(6);
  });

  it('honours mesh density in the wireframe index count', () => {
    const xs = Array.from({ length: 21 }, (_, i) => i);
    const ys = Array.from({ length: 21 }, (_, i) => i);
    const z = ys.map((y) => xs.map((x) => x + y));
    const dense = buildSurfaceGeometry({ xs, ys, z }, { meshDensity: 1 });
    const sparse = buildSurfaceGeometry({ xs, ys, z }, { meshDensity: 5 });
    expect(dense.lines.length).toBeGreaterThan(sparse.lines.length);
  });

  it('caps the ultra grid at 401 points per axis', () => {
    expect(surfaceResolutionPoints('ultra')).toBe(401);
    expect(SURFACE_MAX_GRID).toBe(401);
    expect(surfaceResolutionPoints('draft')).toBe(41);
    expect(surfaceResolutionPoints('standard')).toBe(101);
    expect(surfaceResolutionPoints('high')).toBe(201);
    expect(surfaceResolutionPoints('unknown')).toBe(101);
  });

  it('builds an ultra mesh within the memory and time budget', () => {
    const n = SURFACE_MAX_GRID;
    const xs = Array.from({ length: n }, (_, i) => (i / (n - 1)) * 2 - 1);
    const ys = [...xs];
    const z = ys.map((y) => xs.map((x) => 3 + x * x + y * y + 0.3 * x * y));
    const started = performance.now();
    const geometry = buildSurfaceGeometry({ xs, ys, z }, { meshDensity: 8 });
    const elapsed = performance.now() - started;
    expect(geometry.faces).toBe((n - 1) * (n - 1));
    // 160 801 vertices · 9 floats = 5.8 MB of vertex data, plus indices.
    expect(geometry.vertices.byteLength).toBe(n * n * 9 * 4);
    expect(geometry.indices.byteLength).toBe((n - 1) * (n - 1) * 6 * 4);
    expect(elapsed, `ultra mesh took ${elapsed.toFixed(0)} ms`).toBeLessThan(4000);
  });
});

/* ── camera ───────────────────────────────────────────────────────────── */

describe('3D camera (WO-03)', () => {
  const camera = { azimuth: -55, elevation: 28, zoom: 1, panX: 0, panY: 0 };

  it('puts the origin in the middle of the plot', () => {
    const basis = cameraBasis(camera, 'orthographic', 400, 300);
    const centre = projectPoint([0, 0, 0], basis, 'orthographic', camera);
    expect(centre.x).toBeCloseTo(200, 6);
    expect(centre.y).toBeCloseTo(150, 6);
  });

  it('rotating the azimuth moves a point along one screen axis', () => {
    const a = projectPoint([1, 0, 0], cameraBasis({ ...camera, azimuth: -55 }, 'orthographic', 400, 300), 'orthographic', camera);
    const b = projectPoint([1, 0, 0], cameraBasis({ ...camera, azimuth: 30 }, 'orthographic', 400, 300), 'orthographic', camera);
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(10);
  });

  it('zoom magnifies the projected offsets', () => {
    const base = cameraBasis({ ...camera, zoom: 1 }, 'orthographic', 400, 300);
    const zoomed = cameraBasis({ ...camera, zoom: 2 }, 'orthographic', 400, 300);
    const p1 = projectPoint([1, 1, 0], base, 'orthographic', camera);
    const p2 = projectPoint([1, 1, 0], zoomed, 'orthographic', camera);
    expect(Math.abs(p2.x - 200) / Math.abs(p1.x - 200)).toBeCloseTo(2, 5);
  });

  it('pan shifts the picture without changing its size', () => {
    const basis = cameraBasis(camera, 'orthographic', 400, 300);
    const plain = projectPoint([0.5, 0.5, 0], basis, 'orthographic', camera);
    const panned = projectPoint([0.5, 0.5, 0], basis, 'orthographic', { ...camera, panX: 0.5, panY: -0.5 });
    expect(panned.x - plain.x).toBeCloseTo(100, 6);
    expect(panned.y - plain.y).toBeCloseTo(75, 6);
  });

  it('the WebGL matrix reproduces the projected point', () => {
    const basis = cameraBasis(camera, 'perspective', 400, 300);
    const point: [number, number, number] = [0.6, -0.4, 0.3];
    const projected = projectPoint(point, basis, 'perspective', camera);
    const mvp = cameraMatrix(basis, 'perspective', camera, { width: 400, height: 300 });
    const clip = [
      mvp[0] * point[0] + mvp[4] * point[1] + mvp[8] * point[2] + mvp[12],
      mvp[1] * point[0] + mvp[5] * point[1] + mvp[9] * point[2] + mvp[13],
      mvp[3] * point[0] + mvp[7] * point[1] + mvp[11] * point[2] + mvp[15],
    ];
    const screenX = ((clip[0] / clip[2]) * 0.5 + 0.5) * 400;
    const screenY = (0.5 - (clip[1] / clip[2]) * 0.5) * 300;
    expect(screenX).toBeCloseTo(projected.x, 4);
    expect(screenY).toBeCloseTo(projected.y, 4);
  });

  it('keeps the depth buffer monotonic in the depth of the point', () => {
    const basis = cameraBasis(camera, 'perspective', 400, 300);
    const mvp = cameraMatrix(basis, 'perspective', camera, { width: 400, height: 300 });
    const depthOf = (point: [number, number, number]) => {
      const z = mvp[2] * point[0] + mvp[6] * point[1] + mvp[10] * point[2] + mvp[14];
      const w = mvp[3] * point[0] + mvp[7] * point[1] + mvp[11] * point[2] + mvp[15];
      return z / w;
    };
    // A point nearer the eye (towards the camera direction) must have a smaller
    // normalised depth than one behind it.
    const direction = basis.eye;
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    const near: [number, number, number] = [direction[0] / length * 0.8, direction[1] / length * 0.8, direction[2] / length * 0.8];
    const far: [number, number, number] = [-near[0], -near[1], -near[2]];
    expect(depthOf(near)).toBeLessThan(depthOf(far));
  });
});

/* ── 3D surface and the 2D contour must agree ─────────────────────────── */

describe('3D surface equals the 2D contour at every node (WO-03)', () => {
  it('agrees with modelSurface node for node on a stored RSM model', () => {
    const model = rsmStoredModel();
    for (const resolution of [11, 41, 101]) {
      const surface3d = buildModelSurface(model, { xIndex: 0, yIndex: 1, unitMode: 'coded', resolution });
      const contour = modelSurface(model, {
        xName: surface3d.xName,
        yName: surface3d.yName,
        mode: 'coded',
        resolution,
        xRange: surface3d.xRange,
        yRange: surface3d.yRange,
      });
      expect(contour.z.length).toBe(surface3d.z.length);
      let maxDiff = 0;
      for (let j = 0; j < contour.z.length; j += 1) {
        for (let i = 0; i < contour.z[j].length; i += 1) {
          const a = contour.z[j][i];
          const b = surface3d.z[j][i];
          if (!Number.isFinite(a) && !Number.isFinite(b)) continue;
          maxDiff = Math.max(maxDiff, Math.abs(a - b));
        }
      }
      expect(maxDiff, `resolution ${resolution}`).toBeLessThan(1e-10);
    }
  });

  it('agrees in actual units too, and with a held factor', () => {
    const model = rsmStoredModel();
    const surface3d = buildModelSurface(model, { xIndex: 0, yIndex: 1, unitMode: 'actual', resolution: 41 });
    const contour = modelSurface(model, {
      xName: surface3d.xName,
      yName: surface3d.yName,
      mode: 'actual',
      resolution: 41,
      xRange: surface3d.xRange,
      yRange: surface3d.yRange,
    });
    let maxDiff = 0;
    for (let j = 0; j < contour.z.length; j += 1) {
      for (let i = 0; i < contour.z[j].length; i += 1) {
        maxDiff = Math.max(maxDiff, Math.abs(contour.z[j][i] - surface3d.z[j][i]));
      }
    }
    expect(maxDiff).toBeLessThan(1e-10);
  });

  it('reports the same prediction as predictStoredModel at a probe point', () => {
    const model = quadraticModel('Y', [12, 16, 13, 17.5, 15, 13.2, 12.2, 12.5, 12.4, 15.1]);
    const surface = buildModelSurface(model, { xIndex: 0, yIndex: 1, unitMode: 'coded', resolution: 11 });
    const probe = 4;
    const point = { A: surface.xs[probe], B: surface.ys[probe] };
    const direct = predictStoredModel(model, point, { mode: 'coded' });
    // The grid point is not exactly the stored coordinate after a range change;
    // compare the value at the same node coordinates the grid used.
    expect(surface.z[probe][probe]).toBeCloseTo(direct.value as number, 8);
  });
});

/* ── static painting ──────────────────────────────────────────────────── */

describe('static surface projection (WO-03 fallback and export)', () => {
  it('paints the faces, the axis labels and the experiment points', () => {
    const chart = surfaceChart(rsmStoredModel());
    const config = defaultSurfaceViewConfig();
    const svg = surfaceSvgBody({
      grid: { xs: chart.xs, ys: chart.ys, z: chart.z },
      config,
      style: STYLE,
      width: 420,
      height: 320,
      xLabel: 'A',
      yLabel: 'B',
      zLabel: 'Y',
      points: chart.points,
    });
    expect(svg).toContain('data-chart-role="surface-faces"');
    expect(svg).toContain('data-chart-role="surface-mesh"');
    expect(svg).toContain('data-chart-role="surface-axes"');
    expect(svg).toContain('data-chart-role="chart-point"');
    expect(svg).not.toContain('NaN');
  });

  it('omits the faces in wireframe mode and the frame in frameOnly mode', () => {
    const chart = surfaceChart(rsmStoredModel());
    const config = { ...defaultSurfaceViewConfig(), renderMode: 'wireframe' as const };
    const wire = surfaceSvgBody({ grid: { xs: chart.xs, ys: chart.ys, z: chart.z }, config, style: STYLE, width: 400, height: 300, xLabel: 'A', yLabel: 'B', zLabel: 'Y' });
    expect(wire).not.toContain('data-chart-role="surface-faces"');
    expect(wire).toContain('data-chart-role="surface-mesh"');
    const frame = surfaceSvgBody({ grid: { xs: chart.xs, ys: chart.ys, z: chart.z }, config: defaultSurfaceViewConfig(), style: STYLE, width: 400, height: 300, xLabel: 'A', yLabel: 'B', zLabel: 'Y', frameOnly: true });
    expect(frame).not.toContain('data-chart-role="surface-faces"');
    expect(frame).toContain('data-chart-role="surface-axes"');
  });

  it('renders through renderChart for export', () => {
    const chart = surfaceChart(rsmStoredModel());
    const svg = renderChart(chart, { width: 520 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('data-chart-role="surface3d"');
    expect(svg).toContain('data-chart-role="surface-faces"');
  });

  it('says there is nothing to draw for an all-NaN grid', () => {
    const chart: Extract<ChartSpec, { kind: 'surface3d' }> = {
      kind: 'surface3d',
      xs: [0, 1],
      ys: [0, 1],
      z: [[Number.NaN, Number.NaN], [Number.NaN, Number.NaN]],
    };
    const svg = renderChart(chart, { width: 400 });
    expect(svg).toContain('No finite surface');
  });

  it('reports the exact extent of a masked grid', () => {
    expect(surfaceExtent({ xs: [0, 1], ys: [0, 1], z: [[1, Number.NaN], [3, 5]] })).toEqual({ zMin: 1, zMax: 5 });
  });
});

/* ── re-slicing from the drawer ───────────────────────────────────────── */

describe('surface re-slicing (WO-03 drawer)', () => {
  it('changes the factor pair, the resolution and the unit mode without refitting', () => {
    const model = rsmStoredModel();
    const chart = surfaceChart(model);
    const next = materializeSurface(chart, {
      ...{},
      surface: { resolution: 'draft', renderMode: 'surface' },
      rsm: { xFactorIndex: 1, yFactorIndex: 0, unitMode: 'actual' },
    });
    expect(next.kind).toBe('surface3d');
    if (next.kind !== 'surface3d') return;
    expect(next.xs.length).toBe(41);
    expect(next.xLabel).toBe('B');
    expect(next.yLabel).toBe('A');
  });

  it('keeps the chart unchanged when it has no stored model', () => {
    const chart: Extract<ChartSpec, { kind: 'surface3d' }> = { kind: 'surface3d', xs: [0, 1], ys: [0, 1], z: [[1, 2], [3, 4]] };
    expect(materializeSurface(chart, {})).toBe(chart);
  });
});
