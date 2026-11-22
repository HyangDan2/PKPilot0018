/* ─────────────────────────────────────────────────────────────────────────
   P2 feature tests — behaviour and contracts around the golden numbers in
   benchmark.test.ts: study variants, chart rendering, workbook round-trips,
   design generation and the solvers' bracketing behaviour.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import { ANALYSES, defaultValues, findAnalysis } from '../src/lib/analyses';
import { renderChart } from '../src/lib/charts';
import { DATASETS } from '../src/lib/datasets';
import { analyzeFactorial, boxBehnkenDesign, ccdDesign, contourGrid, designWorksheet, factorialDesign } from '../src/lib/doe';
import { gageRR, type GrrRow } from '../src/lib/gagerr';
import { fitGlm } from '../src/lib/glm';
import { nonnormalCapability } from '../src/lib/nonnormal';
import { powerCurve, solvePower } from '../src/lib/power';
import { fitWeibull } from '../src/lib/reliability';
import { capabilitySixpack } from '../src/lib/sixpack';
import { cChart, c4Constant, npChart, pChart, uChart, xbarSCharts } from '../src/lib/spc';
import { readXlsx, safeSheetName, writeXlsx } from '../src/lib/xlsx';

function gageRows(nested = false): GrrRow[] {
  const out: GrrRow[] = [];
  [['A', 0], ['B', 0.4], ['C', -0.3]].forEach(([operator, offset], opIndex) => {
    for (let part = 0; part < 5; part += 1) {
      const partName = nested ? `P${opIndex * 5 + part + 1}` : `P${part + 1}`;
      for (let rep = 0; rep < 2; rep += 1) {
        out.push({
          part: String(partName),
          operator: String(operator),
          measurement: 10 + part * 0.6 + Number(offset) + rep * 0.05,
        });
      }
    }
  });
  return out;
}

describe('Gage R&R', () => {
  it('runs a crossed study with the six required panels of numbers', () => {
    const result = gageRR(gageRows(), 'crossed', { tolerance: 3 });
    expect(result.type).toBe('crossed');
    expect(result.components.map((c) => c.name)).toEqual([
      'repeat', 'reproducibility', 'interaction', 'operator', 'partToPart', 'grr', 'total',
    ]);
    result.components.forEach((c) => {
      expect(Number.isFinite(c.variance)).toBe(true);
      expect(c.stdev).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(c.studyVar)).toBe(true);
    });
    expect(result.ndc).toBeGreaterThanOrEqual(1);
    expect(result.ndc).toBeLessThanOrEqual(999);
  });

  it('runs a nested study and rejects a crossed table with missing cells', () => {
    const nested = gageRR(gageRows(true), 'nested');
    expect(nested.type).toBe('nested');
    expect(nested.anova.some((row) => row.source === 'partOperator')).toBe(true);
    const missing = gageRows().filter((_, index) => index !== 3);
    // An incomplete cell makes the design either unbalanced or missing a cell;
    // both are rejected with a readable reason instead of a wrong estimate.
    expect(() => gageRR(missing, 'crossed')).toThrow(/grr\.(missingCells|unbalanced)/);
  });

  it('pools a non-significant interaction into the error term on request', () => {
    const result = gageRR(gageRows(), 'crossed', { poolInteraction: true, alpha: 0.5 });
    const interaction = result.anova.find((row) => row.source === 'interaction');
    expect(interaction?.df).toBe(0);
    expect(result.note).toBe('interactionPooled');
  });
});

describe('Capability Sixpack', () => {
  const values = [10.1, 10.4, 9.9, 10.2, 10.3, 10.0, 10.5, 10.1, 9.8, 10.2, 10.0, 10.3, 10.4, 10.1, 10.2, 10.6, 10.0, 9.9, 10.1, 10.2];

  it('uses I-MR for individuals and Xbar-R for subgroups', () => {
    const individuals = capabilitySixpack(values, { lsl: 9.5, usl: 10.8, subgroup: 1 });
    expect(individuals.subgroup).toBe(1);
    expect(individuals.primary.key).toBe('i');
    expect(individuals.secondary.key).toBe('mr');
    expect(individuals.sigmaBasis).toBe('MRbar/d2');
    expect(individuals.capability.sdWithin).toBe(individuals.sigmaWithin);
    const grouped = capabilitySixpack(values, { lsl: 9.5, usl: 10.8, subgroup: 4 });
    expect(grouped.primary.key).toBe('xbar');
    expect(grouped.secondary.key).toBe('r');
    // The chart and Cp/Cpk now share ONE within sigma: R̄/d₂(4) = 0.46/2.059.
    // (The old expectation 0.20371548787463356 was the pooled within-subgroup s
    // the capability used while the limits were drawn on R̄/d₂ — the mismatch
    // this follow-up fixes. python: R̄ = 0.46, 0.46/2.059 = 0.2234094220495385.)
    expect(grouped.capability.sdWithin).toBeCloseTo(0.2234094220495385, 12);
    expect(grouped.capability.sdWithin).toBe(grouped.sigmaWithin);
    expect(grouped.sigmaBasis).toBe('Rbar/d2');
    expect(grouped.withinMethodLabel).toBe('R̄/d₂(4)');
    expect(grouped.sdWithinFromChart).toBe(true);
  });

  it('keeps the last panel to 25 points with re-indexed signals', () => {
    const many = Array.from({ length: 80 }, (_, i) => 10 + Math.sin(i / 3) * 0.3);
    const result = capabilitySixpack(many, { lsl: 9, usl: 11 });
    expect(result.last.points.length).toBe(25);
    result.last.violations.forEach((v) => {
      expect(v.index).toBeGreaterThanOrEqual(0);
      expect(v.index).toBeLessThan(25);
    });
  });
});

describe('nonnormal capability', () => {
  const values = [42, 58, 71, 84, 96, 103, 118, 126, 141, 155, 168, 183, 197, 214, 236, 258, 281, 305, 342, 388, 120, 175, 240, 300, 360];

  it('fits all three distributions with an AD verdict that reacts to fit quality', () => {
    (['weibull', 'lognormal', 'gamma'] as const).forEach((dist) => {
      const result = nonnormalCapability(values, dist, { lsl: 60, usl: 330 });
      expect(result.fit.params.shape).toBeGreaterThan(0);
      expect(result.fit.adAdjusted).toBeGreaterThan(0);
      expect(result.fit.critical).toHaveLength(3);
      expect(['above10', 'between05and10', 'between01and05', 'below01']).toContain(result.fit.band);
    });
    // A set that is clearly Weibull-shaped must not be declared a poor fit.
    const weibullish = Array.from({ length: 60 }, (_, i) => 100 * Math.pow(-Math.log(1 - (i + 0.5) / 60), 1 / 2.5));
    expect(nonnormalCapability(weibullish, 'weibull', { usl: 900 }).fit.band).toBe('above10');
  });

  it('supports one-sided specifications', () => {
    const lower = nonnormalCapability(values, 'weibull', { usl: 330 });
    expect(Number.isFinite(lower.ppk)).toBe(true);
    expect(Number.isNaN(lower.pp)).toBe(true);
  });
});

describe('Weibull reliability', () => {
  const times = [42, 58, 71, 84, 96, 103, 118, 126, 141, 155, 168, 183, 197, 214, 236, 258, 281, 305, 342, 388, 120, 175, 240, 300, 360];

  it('reports censoring counts, standard errors and monotone life percentiles', () => {
    const result = fitWeibull(times.map((time, i) => ({ time, censored: i >= 20 })));
    expect(result.failures).toBe(20);
    expect(result.censored).toBe(5);
    expect(result.seShape).toBeGreaterThan(0);
    expect(result.seScale).toBeGreaterThan(0);
    expect(result.ciShape[0]).toBeLessThan(result.shape);
    expect(result.ciShape[1]).toBeGreaterThan(result.shape);
    expect(result.b5).toBeLessThan(result.b10);
    expect(result.b10).toBeLessThan(result.median);
    expect(result.median).toBeLessThan(result.b90);
    expect(result.points).toHaveLength(20);
    expect(result.survival(0)).toBe(1);
    expect(result.survival(1e9)).toBeCloseTo(0, 3);
  });

  it('needs at least two failures', () => {
    expect(() => fitWeibull([{ time: 10, censored: true }, { time: 20, censored: true }, { time: 30, censored: false }])).toThrow('rel.needFailures');
  });
});

describe('GLM', () => {
  it('rejects a design with no residual degrees of freedom', () => {
    const rows = [
      { a: 'x', y: 1 },
      { a: 'y', y: 2 },
    ];
    expect(() => fitGlm(rows.map((r) => r.y), [{ name: 'A', kind: 'categorical', values: rows.map((r) => r.a) }], [{ name: 'A', factors: ['A'] }])).toThrow('glm.noDf');
  });

  it('labels categorical coefficients with sum-to-zero coding (last level = −1)', () => {
    const rows = [
      ...['a', 'a', 'a'].map((a, i) => ({ a, y: 10 + i })),
      ...['b', 'b', 'b'].map((a, i) => ({ a, y: 12 + i })),
    ];
    const glm = fitGlm(rows.map((r) => r.y), [{ name: 'F', kind: 'categorical', values: rows.map((r) => r.a) }], [{ name: 'F', factors: ['F'] }]);
    // L−1 = 1 contrast column; the LAST level is the implied −1 reference.
    expect(glm.labels).toEqual(['Constant', 'F[a]']);
    expect(glm.beta[1]).toBeCloseTo(-1, 10);
    // Predictions still reproduce both group means (11 and 13).
    expect(glm.fitted[0]).toBeCloseTo(11, 10);
    expect(glm.fitted[3]).toBeCloseTo(13, 10);
  });
});

describe('DOE design generation', () => {
  it('builds the standard order, centre points and a reproducible randomisation', () => {
    const standard = factorialDesign(3, 2, 1, false);
    expect(standard).toHaveLength(10);
    expect(standard[0].levels).toEqual([-1, -1, -1]);
    expect(standard[7].levels).toEqual([1, 1, 1]);
    expect(standard[8].ptType).toBe('Center');
    const random = factorialDesign(3, 2, 1, true, 42);
    expect(random.map((r) => r.run).sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(random.map((r) => r.std)).toEqual(standard.map((r) => r.std));
    expect(factorialDesign(3, 2, 1, true, 42).map((r) => r.run)).toEqual(random.map((r) => r.run));
  });

  it('builds CCD and Box–Behnken runs with the right axial distance', () => {
    const ccd = ccdDesign(2, 5, false);
    expect(ccd).toHaveLength(13);
    const axial = ccd.filter((r) => r.ptType === 'Axial');
    expect(axial).toHaveLength(4);
    expect(Math.abs(axial[0].levels.find((v) => v !== 0) ?? 0)).toBeCloseTo(Math.pow(2, 2) ** 0.25, 12);
    const bbd = boxBehnkenDesign(3, false);
    expect(bbd).toHaveLength(15);
    expect(bbd.filter((r) => r.ptType === 'Edge')).toHaveLength(12);
  });

  it('writes a design worksheet with StdOrder, RunOrder, PtType and a Y column', () => {
    const sheet = designWorksheet(factorialDesign(2, 1, 1, false), ['A', 'B'], 'Design');
    expect(sheet.columns.map((c) => c.name)).toEqual(['StdOrder', 'RunOrder', 'PtType', 'A', 'B', 'Y']);
    expect(sheet.columns[5].values.every((v) => v === null)).toBe(true);
  });

  it('produces a contour grid and design points for a quadratic fit', () => {
    const runs: [number, number, number][] = [
      [-1, -1, 70], [-1, 1, 72], [1, -1, 76], [1, 1, 74], [0, 0, 80], [0, 0, 80.4],
    ];
    const factors = [
      { name: 'A', kind: 'numeric' as const, values: runs.map((r) => r[0]) },
      { name: 'B', kind: 'numeric' as const, values: runs.map((r) => r[1]) },
    ];
    const analysis = analyzeFactorial(runs.map((r) => r[2]), factors, 2);
    const grid = contourGrid(analysis.glm, factors, 0, 1, 11);
    expect(grid.z).toHaveLength(11);
    expect(grid.z[0]).toHaveLength(11);
    expect(grid.points).toHaveLength(6);
    expect(grid.zMax).toBeGreaterThan(grid.zMin);
  });
});

describe('power and sample size', () => {
  it('power rises with sample size and the curve stays inside [0, 1]', () => {
    const spec = { method: 'oneT' as const, solveFor: 'power' as const, alpha: 0.05, alternative: 'two-sided' as const, sd: 1, n: 20 };
    const curve = powerCurve(spec, 0.5, 12);
    expect(curve.length).toBeGreaterThan(3);
    curve.forEach((point) => {
      expect(point.power).toBeGreaterThanOrEqual(0);
      expect(point.power).toBeLessThanOrEqual(1);
    });
    for (let i = 1; i < curve.length; i += 1) expect(curve[i].power).toBeGreaterThan(curve[i - 1].power);
  });

  it('one-sided power exceeds two-sided power for the same effect', () => {
    const two = solvePower({ method: 'oneT', solveFor: 'power', n: 20, difference: 0.5, sd: 1, alpha: 0.05, alternative: 'two-sided' });
    const one = solvePower({ method: 'oneT', solveFor: 'power', n: 20, difference: 0.5, sd: 1, alpha: 0.05, alternative: 'greater' });
    expect(one.power).toBeGreaterThan(two.power);
  });

  it('solves proportions with the normal approximation', () => {
    const result = solvePower({ method: 'twoProp', solveFor: 'n', p1: 0.4, p2: 0.6, power: 0.9, alpha: 0.05, alternative: 'two-sided' });
    expect(result.n).toBeGreaterThan(100);
    expect(result.power).toBeGreaterThanOrEqual(0.9);
    expect(result.notes).toContain('power.propApprox');
  });
});

describe('attribute and Xbar-S charts', () => {
  it('c₄ matches the tabulated values for n = 2…10', () => {
    const table = [0.7979, 0.8862, 0.9213, 0.94, 0.9515, 0.9594, 0.965, 0.9693, 0.9727];
    table.forEach((expected, index) => {
      expect(c4Constant(index + 2)).toBeCloseTo(expected, 4);
    });
  });

  it('validates attribute inputs instead of silently dropping rows', () => {
    expect(() => npChart([4, -1, 3], 50)).toThrow();
    expect(() => npChart([4, 60, 3], 50)).toThrow();
    expect(() => npChart([4, 2.5, 3], 50)).toThrow();
    expect(() => cChart([1, -2, 3])).toThrow();
    expect(() => uChart([1, 2, 3], [10, 0, 10])).toThrow();
    expect(() => uChart([1, 2, 3], [10, 10])).toThrow();
  });

  it('supports varying subgroup sizes through a group-id column', () => {
    const values = [10, 10.2, 10.1, 9.9, 10.3, 10.0, 10.4, 10.2, 9.8];
    const ids = ['a', 'a', 'a', 'b', 'b', 'c', 'c', 'c', 'c'];
    const result = xbarSCharts(values, { groupIds: ids });
    expect(result.panels[0].points).toHaveLength(3);
    expect((result.panels[0].ucl as number[])[0]).not.toBeCloseTo((result.panels[0].ucl as number[])[2], 6);
  });

  it('keeps the P chart behaviour unchanged', () => {
    const result = pChart([2, 3, 1], [100, 100, 100]);
    expect(result.panels[0].center).toBeCloseTo(0.02, 10);
  });
});

describe('Excel workbook round-trip', () => {
  it('restores every sheet with its column types and blanks', async () => {
    const sheet = { id: 's1', name: 'One', columns: [
      { id: 'C1', name: 'Val', type: 'numeric' as const, values: [1, 2, null, 4] },
      { id: 'C2', name: 'Name', type: 'text' as const, values: ['x', 'y', 'z', null] },
      { id: 'C3', name: 'Day', type: 'date' as const, values: ['2026-11-01', '2026-11-02', null, '2026-11-04'] },
    ] };
    const second = { id: 's2', name: 'Two', columns: [{ id: 'C1', name: 'A', type: 'numeric' as const, values: [10, 20] }] };
    const blob = await writeXlsx([sheet, second]);
    expect(blob.size).toBeGreaterThan(1000);
    const back = await readXlsx(blob);
    expect(back.map((ws) => ws.name)).toEqual(['One', 'Two']);
    expect(back[0].columns.map((c) => c.type)).toEqual(['numeric', 'text', 'date']);
    expect(back[0].columns[0].values).toEqual([1, 2, null, 4]);
    expect(back[0].columns[1].values).toEqual(['x', 'y', 'z', null]);
    expect(back[0].columns[2].values).toEqual(['2026-11-01', '2026-11-02', null, '2026-11-04']);
    expect(back[1].columns[0].values).toEqual([10, 20]);
  });

  it('sanitises sheet names and de-duplicates them', () => {
    const used = new Set<string>();
    expect(safeSheetName('a/b:c*d?', used)).toBe('a-b-c-d-');
    expect(safeSheetName('a-b-c-d-', used)).toBe('a-b-c-d- (2)');
    const long = 'x'.repeat(40);
    expect(safeSheetName(long, new Set()).length).toBe(31);
  });
});

describe('new chart kinds', () => {
  const cases = [
    { kind: 'line' as const, series: [{ label: 'S', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }], xLabels: ['a', 'b'] },
    { kind: 'bar' as const, items: [{ label: 'Cp', value: 1.2 }, { label: 'Cpk', value: 0.9 }] },
    { kind: 'contour' as const, xs: [-1, 0, 1], ys: [-1, 0, 1], z: [[1, 2, 3], [2, 3, 4], [3, 4, 5]] },
    { kind: 'probplot' as const, points: [{ x: 1, y: -1 }, { x: 2, y: 0 }, { x: 3, y: 1 }], fit: { intercept: -2, slope: 1 } },
  ];

  it('renders SVG for each kind without NaN coordinates', () => {
    cases.forEach((chart) => {
      const svg = renderChart(chart as never);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('</svg>');
      expect(svg).not.toContain('NaN');
    });
  });

  it('renders fitted curves on a histogram and a custom probability axis', () => {
    const histogram = renderChart({
      kind: 'histogram',
      values: [1, 2, 2, 3, 3, 3, 4],
      curves: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 4, y: 1 }], label: 'Fit' }],
    });
    expect(histogram).toContain('<polyline');
    const probplot = renderChart({
      kind: 'probplot',
      points: [{ x: Math.log(50), y: -1 }, { x: Math.log(100), y: 0 }],
      fit: { intercept: -10, slope: 2 },
      xTicks: [{ v: Math.log(50), label: '50' }, { v: Math.log(100), label: '100' }],
    });
    expect(probplot).toContain('>50<');
  });
});

describe('analysis registry', () => {
  const required = [
    'gagerr', 'sixpack', 'capnonnormal', 'xbars', 'npchart', 'cchart', 'uchart', 'glm',
    'doecreate', 'doeanalyze', 'rsmcreate', 'rsmanalyze', 'weibull',
    'power1t', 'power2t', 'powerpaired', 'poweranova', 'powerprop1', 'powerprop2',
  ];

  it('registers every P2 analysis with a runnable dialog', () => {
    required.forEach((id) => {
      const def = findAnalysis(id);
      expect(def, id).toBeTruthy();
      const values = defaultValues(def!);
      expect(Object.keys(values).length).toBeGreaterThan(0);
    });
    expect(ANALYSES.length).toBeGreaterThan(25);
  });

  it('runs the Gage R&R sample through the registry and returns six charts', () => {
    const sheet = DATASETS.find((d) => d.id === 'gagerr')!.build();
    const def = findAnalysis('gagerr')!;
    const values = {
      ...defaultValues(def),
      part: sheet.columns[0].id,
      operator: sheet.columns[1].id,
      measurement: sheet.columns[2].id,
      tolerance: '4',
    };
    const output = def.run({ lang: 'en', sheet, values });
    const grid = output.blocks.find((b) => b.type === 'chartgrid');
    expect(grid && grid.type === 'chartgrid' ? grid.charts.length : 0).toBe(6);
  });
});
