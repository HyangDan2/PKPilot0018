import { describe, expect, it } from 'vitest';
import { XBAR_CONSTANTS, imrChart, nelsonRules, pChart, SpcValidationError, xbarRCharts } from '../src/lib/spc';
import { capability, movingRangeSigma, withinSubgroupSigma } from '../src/lib/capability';
import { normalInv } from '../src/lib/dist';

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

  it('keeps subgroup boundaries in row order when values are missing', () => {
    const values: (number | null)[] = [10, 12, null, 16, 11, 13, 15, 17];
    const result = xbarRCharts(values, 2);
    // (10,12) · (null,16 → skipped) · (11,13) · (15,17): later groups never shift.
    expect(result.panels[0].points.map((v) => Math.round(v))).toEqual([11, 12, 16]);
    expect(result.subgroupSummary).toEqual({ size: 2, total: 4, used: 3, skipped: 1, leftoverRows: 0 });
    expect(result.panels[1].points.map((v) => Math.round(v))).toEqual([2, 2, 2]);
  });

  it('reports the trailing rows that did not fill a subgroup', () => {
    const values = [1, 2, 3, 4, 5, 6, 7];
    const result = xbarRCharts(values, 2);
    expect(result.subgroupSummary?.leftoverRows).toBe(1);
    expect(result.subgroupSummary?.used).toBe(3);
  });

  it('refuses a column with no usable subgroup', () => {
    expect(() => xbarRCharts([null, null, null, null], 2)).toThrow(SpcValidationError);
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

  it('names the sample and the problem for every invalid input', () => {
    const codes = (run: () => unknown): string[] => {
      try {
        run();
        return [];
      } catch (error) {
        return error instanceof SpcValidationError ? error.issues.map((i) => i.code) : ['unexpected'];
      }
    };
    expect(codes(() => pChart([4.5, 6], [100, 100]))).toEqual(['nonInteger']);
    expect(codes(() => pChart([-1, 6], [100, 100]))).toEqual(['negative']);
    expect(codes(() => pChart([120, 6], [100, 100]))).toEqual(['exceeds']);
    expect(codes(() => pChart([4, 6], [100, 0]))).toEqual(['size']);
    expect(codes(() => pChart([4, 6], [100, Number.NaN]))).toEqual(['size']);
    expect(codes(() => pChart([4, 6], [100, 100.5]))).toEqual(['sizeNonInteger']);
    expect(codes(() => pChart([4, 6, 5], [100, 100]))).toEqual(['length']);
    expect(codes(() => pChart([], []))).toEqual(['empty']);
    expect(codes(() => pChart([Number.NaN, 6], [100, 100]))).toEqual(['nonFinite']);
  });

  it('keeps a flat centre line when p̄ is 0 or 1', () => {
    const zero = pChart([0, 0, 0], [100, 100, 100]);
    expect(zero.panels[0].center).toBe(0);
    expect(zero.panels[0].ucl).toEqual([0, 0, 0]);
    expect(zero.panels[0].lcl).toEqual([0, 0, 0]);
    expect(zero.panels[0].violations).toHaveLength(0);
    const all = pChart([100, 100, 100], [100, 100, 100]);
    expect(all.panels[0].center).toBe(1);
    expect(all.panels[0].ucl).toEqual([1, 1, 1]);
    expect(zero.panels[0].points.every((p) => Number.isFinite(p))).toBe(true);
  });

  it('clamps limits to the 0–1 range', () => {
    const result = pChart([1, 0, 2, 0], [4, 4, 4, 4]);
    const panel = result.panels[0] as { ucl: number[]; lcl: number[] };
    expect(Math.max(...panel.ucl)).toBeLessThanOrEqual(1);
    expect(Math.min(...panel.lcl)).toBeGreaterThanOrEqual(0);
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
    // Default method: Z.bench from the overall defect rate plus the classic 1.5σ shift.
    const zBench = normalInv(1 - result.ppmOverall / 1e6);
    expect(result.sigmaMethod).toBe('z_bench_shift');
    expect(result.sigmaLevel).toBeCloseTo(zBench + 1.5, 6);
  });

  it('reports the sigma level with the method the dialog selected', () => {
    const values = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, -1.2, 0.8, 0.3];
    const shifted = capability(values, { lsl: -3, usl: 3, sigmaMethod: 'z_bench_shift' });
    const plain = capability(values, { lsl: -3, usl: 3, sigmaMethod: 'z_bench' });
    const cpk = capability(values, { lsl: -3, usl: 3, sigmaMethod: 'cpk_shift' });
    expect(plain.sigmaLevel).toBeCloseTo(normalInv(1 - plain.ppmOverall / 1e6), 6);
    expect(shifted.sigmaLevel).toBeCloseTo(plain.sigmaLevel + 1.5, 6);
    expect(cpk.sigmaLevel).toBeCloseTo(3 * cpk.cpk + 1.5, 6);
    expect(cpk.sigmaMethod).toBe('cpk_shift');
  });

  it('computes Cpm from the overall sigma only when a target is given', () => {
    const values = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5, -1.2, 0.8, 0.3];
    const result = capability(values, { lsl: -3, usl: 3, target: 0.2 });
    const expected = 6 / (6 * Math.sqrt(result.sdOverall ** 2 + (result.mean - 0.2) ** 2));
    expect(result.cpm).toBeCloseTo(expected, 8);
    const noTarget = capability(values, { lsl: -3, usl: 3 });
    expect(noTarget.cpm).toBeNaN();
    // A target entered as the midpoint is a real target and then equals Pp.
    const atMean = capability(values, { lsl: -3, usl: 3, target: noTarget.mean });
    expect(atMean.cpm).toBeCloseTo(atMean.pp, 8);
  });

  it('keeps Cpk/Ppk/sigma level finite for a single specification limit', () => {
    const low = capability([10, 10.2, 9.9, 10.1, 10.05, 10.3], { lsl: 9.5 });
    expect(low.cpk).toBeCloseTo(low.cpl, 8);
    expect(low.ppk).toBeCloseTo(low.ppl, 8);
    expect(Number.isFinite(low.cpk)).toBe(true);
    expect(Number.isFinite(low.sigmaLevel)).toBe(true);
    expect(low.cp).toBeNaN();
    const high = capability([10, 10.2, 9.9, 10.1, 10.05, 10.3], { usl: 10.8 });
    expect(high.cpk).toBeCloseTo(high.cpu, 8);
    expect(Number.isFinite(high.ppk)).toBe(true);
    expect(Number.isFinite(high.sigmaLevel)).toBe(true);
  });

  it('uses pooled within-subgroup sigma in row order when subgroups are asked for', () => {
    const values = [1, 3, null, 5, 7, 9];
    // Fixed slices: (1,3) · (null,5 → 1 valid, no df) · (7,9) → pooled sd √2
    expect(withinSubgroupSigma(values, 2)).toBeCloseTo(Math.SQRT2, 8);
    const result = capability(values, { lsl: 0, usl: 10, subgroup: 2 });
    expect(result.sdWithin).toBeCloseTo(Math.SQRT2, 8);
    // Individuals fall back to the moving-range estimate.
    const individuals = capability(values, { lsl: 0, usl: 10 });
    expect(individuals.sdWithin).toBeCloseTo(movingRangeSigma([1, 3, 5, 7, 9]), 8);
  });

  it('handles degenerate capability input without Infinity', () => {
    const single = capability([10], { lsl: 9, usl: 11 });
    expect(single.n).toBe(1);
    expect(Number.isNaN(single.sdOverall)).toBe(true);
    expect(single.cp).toBeNaN();
    const constant = capability([10, 10, 10, 10, 10], { lsl: 9, usl: 11 });
    expect(constant.sdOverall).toBe(0);
    expect(Number.isNaN(constant.cp)).toBe(true);
    expect(constant.ppmObserved).toBe(0);
    expect(Number.isFinite(constant.sigmaLevel)).toBe(false);
    const empty = capability([], { lsl: 9, usl: 11 });
    expect(empty.n).toBe(0);
    expect(empty.cp).toBeNaN();
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
