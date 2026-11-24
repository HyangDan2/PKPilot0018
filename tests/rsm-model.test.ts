import { describe, expect, it } from 'vitest';
import { findAnalysis } from '../src/lib/analyses';
import { renderChart } from '../src/lib/charts';
import { analyzeRsm, buildAllPairContours, buildRsmModel, predictRsmAt, rsmPredictSurface } from '../src/lib/doe';
import type { RsmModelPayload } from '../src/lib/doe';
import type { ModelFactor } from '../src/lib/glm';
import { makeWorksheet } from '../src/lib/datasets';
import type { Block, ChartSpec } from '../src/types';

/** A rotatable central composite design for two factors, exactly quadratic. */
function rsmData(): { factors: ModelFactor[]; y: number[] } {
  const design: [number, number][] = [
    [-1, -1], [-1, 1], [1, -1], [1, 1],
    [1.4142, 0], [-1.4142, 0], [0, 1.4142], [0, -1.4142],
    [0, 0], [0, 0], [0, 0], [0, 0], [0, 0],
  ];
  const y = design.map(([a, b]) => 50 + 2 * a - 3 * b + 0.5 * a * a + 0.8 * b * b + 0.6 * a * b);
  const factors: ModelFactor[] = [
    { name: 'A', kind: 'numeric', values: design.map((d) => d[0]) },
    { name: 'B', kind: 'numeric', values: design.map((d) => d[1]) },
  ];
  return { factors, y };
}

function manualModel(): RsmModelPayload {
  return {
    beta: [10, 2, 3, 0, 0, 0],
    labels: ['Constant', 'A', 'B', 'A²', 'B²', 'A×B'],
    factorNames: ['A', 'B'],
    designPoints: [{ levels: [0, 0], y: 10 }],
    codedBounds: [{ min: -1, max: 1 }, { min: -1, max: 1 }],
    actualTransform: [{ center: 70, halfRange: 10, low: 60, high: 80 }, { center: 0, halfRange: 1, low: -1, high: 1 }],
  };
}

describe('RSM model payload (WO-06)', () => {
  it('predicts the fitted quadratic exactly at any coded point', () => {
    const { factors, y } = rsmData();
    const analysis = analyzeRsm(y, factors);
    const model = buildRsmModel(analysis.glm, factors, analysis.stationary);
    expect(model.factorNames).toEqual(['A', 'B']);
    expect(model.designPoints).toHaveLength(y.length);
    expect(model.stationary?.kind).toBe('minimum');
    // The coefficients were generated from this exact polynomial.
    expect(predictRsmAt(model, [0, 0])).toBeCloseTo(50, 6);
    expect(predictRsmAt(model, [1, 1])).toBeCloseTo(50 + 2 - 3 + 0.5 + 0.8 + 0.6, 6);
    expect(predictRsmAt(model, [-1, 1])).toBeCloseTo(50 - 2 - 3 + 0.5 + 0.8 - 0.6, 6);
  });

  it('slices any factor pair with the other factors held at chosen values', () => {
    const model = manualModel();
    const surface = rsmPredictSurface(model, { xFactorIndex: 0, yFactorIndex: 1, resolution: 11 });
    expect(surface.grid.xs).toHaveLength(11);
    expect(surface.grid.z[5][5]).toBeCloseTo(10, 9); // centre
    expect(surface.grid.z[5][0]).toBeCloseTo(10 - 2, 9); // A = -1, B = 0
    expect(surface.grid.z[5][10]).toBeCloseTo(10 + 2, 9); // A = +1
    expect(surface.points.some((p) => p.kind === 'design')).toBe(true);
    expect(surface.extrapolated).toBe(false);

    // Holding a factor that is NOT on the axes shifts the whole surface.
    const model3: RsmModelPayload = {
      beta: [10, 0, 0, 4, 0, 0, 0, 0, 0, 0],
      labels: ['Constant', 'A', 'B', 'C', 'A²', 'B²', 'C²', 'A×B', 'A×C', 'B×C'],
      factorNames: ['A', 'B', 'C'],
      designPoints: [],
      codedBounds: [{ min: -1, max: 1 }, { min: -1, max: 1 }, { min: -1, max: 1 }],
      actualTransform: [0, 1, 2].map(() => ({ center: 0, halfRange: 1, low: -1, high: 1 })),
    };
    const held = rsmPredictSurface(model3, { xFactorIndex: 0, yFactorIndex: 1, resolution: 11, holdingValues: { 2: 0.5 } });
    expect(held.grid.z[5][5]).toBeCloseTo(12, 9);
    const heldLow = rsmPredictSurface(model3, { xFactorIndex: 0, yFactorIndex: 1, resolution: 11, holdingValues: { 2: -1 } });
    expect(heldLow.grid.z[5][5]).toBeCloseTo(6, 9);
  });

  it('maps coded values to actual units and flags extrapolation', () => {
    const model = manualModel();
    const actual = rsmPredictSurface(model, { xFactorIndex: 0, yFactorIndex: 1, unitMode: 'actual', resolution: 5 });
    expect(actual.xRange).toEqual([60, 80]);
    expect(actual.grid.xs[0]).toBe(60);
    expect(actual.grid.xs[4]).toBe(80);
    expect(actual.grid.z[2][0]).toBeCloseTo(10 - 2, 9); // actual 60 → coded −1
    expect(actual.points[0].x).toBe(70);

    const beyond = rsmPredictSurface(model, { xFactorIndex: 0, yFactorIndex: 1, unitMode: 'actual', xRange: [50, 90] });
    expect(beyond.extrapolated).toBe(true);
  });

  it('builds every factor-pair contour for a three-factor model', () => {
    const model: RsmModelPayload = {
      beta: [1, 1, 1, 1, 0, 0, 0, 0, 0, 0],
      labels: ['Constant', 'A', 'B', 'C', 'A²', 'B²', 'C²', 'A×B', 'A×C', 'B×C'],
      factorNames: ['A', 'B', 'C'],
      designPoints: [],
      codedBounds: [{ min: -1, max: 1 }, { min: -1, max: 1 }, { min: -1, max: 1 }],
      actualTransform: [0, 1, 2].map(() => ({ center: 0, halfRange: 1, low: -1, high: 1 })),
    };
    const pairs = buildAllPairContours(model, 11);
    expect(pairs).toHaveLength(3);
    expect(pairs.map((p) => `${p.xName}${p.yName}`)).toEqual(['AB', 'AC', 'BC']);
  });

  it('carries the model and a resolved surface into the RSM analysis output', () => {
    const { factors, y } = rsmData();
    const sheet = makeWorksheet('RSM', [
      { name: 'A', type: 'numeric', values: factors[0].values },
      { name: 'B', type: 'numeric', values: factors[1].values },
      { name: 'Y', type: 'numeric', values: y },
    ]);
    const def = findAnalysis('rsmanalyze');
    expect(def).toBeDefined();
    const result = def!.run({ lang: 'en', sheet, values: { response: 'C3', factors: ['C1', 'C2'], confidence: 95 } });
    const chart = result.blocks
      .filter((b): b is Extract<Block, { type: 'chart' }> => b.type === 'chart')
      .map((b) => b.chart as Extract<ChartSpec, { kind: 'contour' }>)[0];
    expect(chart).toBeDefined();
    expect(chart.rsmModel?.factorNames).toEqual(['A', 'B']);
    expect(chart.xs).toHaveLength(101);
    expect(chart.ys).toHaveLength(101);
    expect(chart.xRange).toEqual([-1.4142, 1.4142]);
    expect(chart.points?.some((p) => p.kind === 'stationary')).toBe(true);
    expect(chart.config?.contour?.renderMode).toBe('filled-lines');
    expect(chart.config?.contour?.levelCount).toBe(10);
    const svg = renderChart(chart);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('data-chart-role="colorbar"');
    expect(svg).toContain('data-chart-role="chart-contour-line"');
  });
});
