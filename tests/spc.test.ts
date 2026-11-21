import { describe, expect, it } from 'vitest';
import { XBAR_CONSTANTS, imrChart, nelsonRules, pChart, xbarRCharts } from '../src/lib/spc';
import { capability, movingRangeSigma } from '../src/lib/capability';

describe('Nelson rules', () => {
  it('flags a point beyond 3 sigma with rule 1', () => {
    const values = [10, 10.2, 9.9, 10.1, 10, 9.8, 10.3, 10, 9.9, 11.7, 10.1];
    const flags = nelsonRules(values, 10, 0.5);
    expect(flags[9]).toContain(1);
    expect(flags[0]).toHaveLength(0);
  });

  it('flags nine points on one side with rule 2', () => {
    const values = [10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 11];
    const flags = nelsonRules(values, 10, 1);
    expect(flags[11]).toContain(2);
    expect(flags[3]).not.toContain(2);
  });

  it('flags six steadily increasing points with rule 3', () => {
    const values = [1, 2, 3, 4, 5, 6, 7];
    const flags = nelsonRules(values, 4, 2);
    expect(flags[6]).toContain(3);
  });

  it('flags fourteen alternating points with rule 4', () => {
    const values = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1];
    const flags = nelsonRules(values, 1.5, 1);
    expect(flags[14]).toContain(4);
  });
});

describe('I-MR chart', () => {
  it('computes limits from the average moving range', () => {
    const values = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11];
    const result = imrChart(values);
    const iPanel = result.panels[0];
    expect(iPanel.center).toBeCloseTo(10.5, 6);
    expect(result.sigmaWithin).toBeCloseTo(1 / 1.128, 6);
    expect(iPanel.ucl as number).toBeCloseTo(10.5 + 3 / 1.128, 5);
    expect(result.panels[1].center).toBeCloseTo(1, 6);
  });

  it('returns no violations for stable data', () => {
    const values = [10.1, 9.9, 10.0, 10.05, 9.95, 10.02, 9.98, 10.01, 9.99, 10.0];
    const result = imrChart(values);
    expect(result.outOfControl).toBe(0);
  });
});

describe('Xbar-R chart', () => {
  it('uses the standard constants for n = 5', () => {
    expect(XBAR_CONSTANTS[5].A2).toBeCloseTo(0.577, 3);
    expect(XBAR_CONSTANTS[5].D4).toBeCloseTo(2.114, 3);
    expect(XBAR_CONSTANTS[5].d2).toBeCloseTo(2.326, 3);
  });

  it('builds Xbar and R panels from subgroups', () => {
    const values = Array.from({ length: 20 }, (_, i) => 10 + (i % 5) * 0.1);
    const result = xbarRCharts(values, 5);
    expect(result.panels).toHaveLength(2);
    expect(result.panels[0].points).toHaveLength(4);
    expect(result.panels[0].center).toBeCloseTo(10.2, 6);
    expect(result.panels[1].center).toBeCloseTo(0.4, 6);
  });
});

describe('P chart', () => {
  it('uses a pooled proportion and varying limits', () => {
    const defects = [4, 6, 5, 7, 3];
    const sizes = [100, 100, 100, 100, 100];
    const result = pChart(defects, sizes);
    const panel = result.panels[0];
    expect(panel.center).toBeCloseTo(25 / 500, 6);
    expect(Array.isArray(panel.ucl)).toBe(true);
    expect(panel.violations).toHaveLength(0);
  });
});

describe('process capability', () => {
  it('computes Cp/Cpk/Pp/Ppk from within and overall sigma', () => {
    const values = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, -1.2, 0.8, 0.3];
    const result = capability(values, { lsl: -3, usl: 3 });
    expect(result.sdWithin).toBeCloseTo(movingRangeSigma(values), 8);
    expect(result.cp).toBeCloseTo(6 / (6 * result.sdWithin), 6);
    expect(result.pp).toBeCloseTo(6 / (6 * result.sdOverall), 6);
    expect(result.cpk).toBeCloseTo(Math.min((result.mean + 3) / (3 * result.sdWithin), (3 - result.mean) / (3 * result.sdWithin)), 6);
    expect(result.ppmOverall).toBeGreaterThanOrEqual(0);
    expect(result.sigmaLevel).toBeCloseTo(3 * result.cpk + 1.5, 6);
  });

  it('handles one-sided specifications', () => {
    const result = capability([10, 10.2, 9.9, 10.1, 10.05], { usl: 10.6 });
    expect(Number.isNaN(result.cp)).toBe(true);
    expect(result.cpu).toBeGreaterThan(0);
    expect(result.cpl).toBeNaN();
  });

  it('counts observed and expected PPM', () => {
    const values = [10, 10, 10, 12.5, 10, 10];
    const result = capability(values, { lsl: 9, usl: 11 });
    expect(result.observedAbove).toBe(1);
    expect(result.ppmObserved).toBeCloseTo((1 / 6) * 1e6, 0);
    expect(result.ppmOverall).toBeGreaterThan(0);
  });
});
