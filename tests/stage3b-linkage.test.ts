import { describe, expect, it } from 'vitest';
import { makeWorksheet } from '../src/lib/datasets';
import { analyzeRsm, buildRsmModel } from '../src/lib/doe';
import type { ModelFactor } from '../src/lib/glm';
import { createStoredModel, draftFromRsmPayload } from '../src/lib/modelStore';
import { predictStoredModel } from '../src/lib/modelPredictor';
import { defaultChartConfig, defaultSurfaceViewConfig, defaultFeasibleConfig } from '../src/lib/chartConfig';
import { sanitizeChartConfig, sanitizeFeasibleConfig, sanitizeSurfaceConfig } from '../src/lib/chartGuards';
import { mergeChartConfig } from '../src/lib/chartConfig';

/* Stage 3A left an RSM payload without (X'X)⁻¹, so a stored RSM model could
   only report a point prediction. Stage 3B carries the covariance and the
   degrees of freedom with the payload; this file proves the linkage end to
   end — fit → payload → stored model → SE and prediction interval. */

function fixture() {
  const sheet = makeWorksheet('RSM', [
    { name: 'A', type: 'numeric', values: [-1, 1, -1, 1, 0, 1.414, -1.414, 0, 0, 0] },
    { name: 'B', type: 'numeric', values: [-1, -1, 1, 1, 0, 0, 0, 1.414, -1.414, 0] },
    { name: 'Y', type: 'numeric', values: [12, 16, 13, 17.5, 15, 13.2, 12.2, 12.5, 12.4, 15.1] },
  ]);
  const factors: ModelFactor[] = [
    { name: 'A', kind: 'numeric', values: sheet.columns[0].values },
    { name: 'B', kind: 'numeric', values: sheet.columns[1].values },
  ];
  const analysis = analyzeRsm(sheet.columns[2].values.map((value) => (typeof value === 'number' ? value : null)), factors);
  return { sheet, factors, analysis };
}

describe('RSM payload carries its covariance (Stage 3A → 3B linkage)', () => {
  it('builds mse·(X\'X)⁻¹ and the degrees of freedom', () => {
    const { factors, analysis } = fixture();
    const model = buildRsmModel(analysis.glm, factors as never, analysis.stationary);
    expect(model.covariance).not.toBeNull();
    const covariance = model.covariance as number[][];
    expect(covariance.length).toBe(analysis.glm.labels.length);
    expect(covariance[0].length).toBe(analysis.glm.labels.length);
    expect(model.dfe).toBe(analysis.glm.dfe);
    expect(model.rank).toBe(analysis.glm.rank);
    // The diagonal is mse·[(X'X)⁻¹]_ii, i.e. the squared standard error.
    const index = analysis.glm.labels.indexOf('A');
    expect(Math.sqrt(covariance[index][index])).toBeCloseTo(analysis.glm.se[index], 10);
  });

  it('gives a stored RSM model a standard error and a prediction interval', () => {
    const { sheet, factors, analysis } = fixture();
    const payload = buildRsmModel(analysis.glm, factors as never, analysis.stationary);
    const model = createStoredModel(
      draftFromRsmPayload(payload, { response: { id: 'C3', name: 'Y' }, sheet, analysisId: 'rsmanalyze' }),
      'RSM fit',
    );
    expect(model.covariance).not.toBeNull();
    expect(model.dof?.residual).toBe(analysis.glm.dfe);
    expect(model.residual?.df).toBe(analysis.glm.dfe);
    const prediction = predictStoredModel(model, { A: 0, B: 0 }, { mode: 'coded' });
    expect(prediction.value).not.toBeNull();
    expect(prediction.se).not.toBeNull();
    expect(prediction.se as number).toBeGreaterThan(0);
    expect(prediction.pi).not.toBeNull();
    expect((prediction.pi as [number, number])[0]).toBeLessThan((prediction.pi as [number, number])[1]);
    // At the centre of a CCD the mean's SE is s/√n_centre; the interval must
    // straddle the fitted value symmetrically.
    const [lo, hi] = prediction.pi as [number, number];
    expect((lo + hi) / 2).toBeCloseTo(prediction.value as number, 10);
  });

  it('stores each coefficient SE from the covariance diagonal', () => {
    const { sheet, factors, analysis } = fixture();
    const payload = buildRsmModel(analysis.glm, factors as never, analysis.stationary);
    const model = createStoredModel(
      draftFromRsmPayload(payload, { response: { id: 'C3', name: 'Y' }, sheet }),
      'RSM fit',
    );
    model.coefficients.forEach((coefficient, index) => {
      expect(coefficient.se).toBeCloseTo(analysis.glm.se[index], 10);
    });
  });

  it('still says "not available" for a payload that carries no covariance', () => {
    const { sheet, factors, analysis } = fixture();
    const payload = buildRsmModel(analysis.glm, factors as never, analysis.stationary);
    const legacy = { ...payload, covariance: null, dfe: undefined, mse: undefined, rank: undefined };
    const model = createStoredModel(draftFromRsmPayload(legacy, { response: { id: 'C3', name: 'Y' }, sheet }), 'Old fit');
    expect(model.covariance).toBeNull();
    expect(model.dof).toBeNull();
    expect(predictStoredModel(model, { A: 0, B: 0 }, { mode: 'coded' }).se).toBeNull();
  });
});

describe('Stage 3B configuration guards', () => {
  it('ships complete defaults for both new blocks', () => {
    const config = defaultChartConfig();
    expect(config.surface).toEqual(defaultSurfaceViewConfig());
    expect(config.feasible).toEqual(defaultFeasibleConfig());
    expect(config.surface?.camera?.zoom).toBe(1);
    expect(config.feasible?.basis).toBe('mean');
  });

  it('replaces hostile surface values instead of drawing them', () => {
    const clean = sanitizeSurfaceConfig({
      opacity: Number.NaN,
      meshDensity: 1e9,
      zScale: -3,
      lightAzimuth: Number.POSITIVE_INFINITY,
      camera: { azimuth: Number.NaN, elevation: 1000, zoom: 0, panX: 40, panY: -40 },
      projection: 'fisheye' as never,
      colormap: 'rainbow' as never,
    });
    expect(clean.opacity).toBe(defaultSurfaceViewConfig().opacity);
    expect(clean.meshDensity).toBe(40);
    expect(clean.zScale).toBe(0.2);
    expect(clean.lightAzimuth).toBe(defaultSurfaceViewConfig().lightAzimuth);
    expect(clean.camera.elevation).toBe(89);
    expect(clean.camera.zoom).toBe(0.4);
    expect(clean.camera.panX).toBe(1);
    expect(clean.camera.panY).toBe(-1);
    expect(clean.camera.azimuth).toBeGreaterThanOrEqual(0);
    expect(clean.projection).toBe('perspective');
    expect(clean.colormap).toBe('sigrun-classic');
  });

  it('wraps an azimuth instead of rejecting it', () => {
    expect(sanitizeSurfaceConfig({ camera: { ...defaultSurfaceViewConfig().camera, azimuth: -720 } }).camera.azimuth).toBe(0);
    expect(sanitizeSurfaceConfig({ camera: { ...defaultSurfaceViewConfig().camera, azimuth: 450 } }).camera.azimuth).toBe(90);
  });

  it('drops damaged specification entries and keeps valid ones', () => {
    const clean = sanitizeFeasibleConfig({
      basis: 'prediction',
      alpha: Number.NaN,
      specs: [
        { name: 'Yield', lsl: 12, usl: 18, target: 15 },
        { name: 42 as unknown as string, lsl: 1, usl: 2, target: 0 },
        { name: 'Bad', lsl: Number.NaN, usl: 'x' as unknown as number, target: null },
      ] as never,
    });
    expect(clean.basis).toBe('prediction');
    expect(clean.alpha).toBe(0.05);
    expect(clean.specs).toEqual([
      { name: 'Yield', lsl: 12, usl: 18, target: 15 },
      { name: 'Bad', lsl: null, usl: null, target: null },
    ]);
  });

  it('survives a partial config through the full sanitiser', () => {
    const merged = mergeChartConfig(undefined, { surface: { opacity: 0.5 } });
    const clean = sanitizeChartConfig(merged);
    expect(clean.surface?.opacity).toBe(0.5);
    expect(clean.surface?.camera?.elevation).toBe(defaultSurfaceViewConfig().camera.elevation);
    expect(clean.feasible?.specs).toEqual([]);
  });
});
