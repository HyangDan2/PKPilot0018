import { describe, expect, it } from 'vitest';
import { makeWorksheet } from '../src/lib/datasets';
import { fitGlm, type ModelFactor } from '../src/lib/glm';
import { createStoredModel, draftFromGlm, type StoredModel } from '../src/lib/modelStore';
import {
  buildOverlaid,
  commonNumericFactors,
  intervalAvailability,
  maskAreaRatio,
  type ResponseSpec,
} from '../src/lib/feasible';
import { buildOverlaidChart, materializeOverlaid } from '../src/lib/chartConfigOps';
import { ModelInputError } from '../src/lib/modelPredictor';
import { renderChart } from '../src/lib/charts';
import type { ChartSpec } from '../src/types';

const DESIGN = {
  A: [-1, 1, -1, 1, 0, 1.414, -1.414, 0, 0, 0],
  B: [-1, -1, 1, 1, 0, 0, 0, 1.414, -1.414, 0],
};

function sheetFor(response: string, values: number[]) {
  return makeWorksheet('Design', [
    { name: 'A', type: 'numeric', values: DESIGN.A },
    { name: 'B', type: 'numeric', values: DESIGN.B },
    { name: response, type: 'numeric', values },
  ]);
}

function quadratic(response: string, values: number[], options: { unit?: string } = {}): StoredModel {
  const sheet = sheetFor(response, values);
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
  const model = createStoredModel(
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
  if (options.unit) model.predictors = model.predictors.map((predictor) => ({ ...predictor, unit: options.unit }));
  return model;
}

function withoutCovariance(model: StoredModel): StoredModel {
  return { ...model, covariance: null, dof: null, residual: model.residual ? { ...model.residual, df: undefined } : null };
}

const Y1 = [12, 16, 13, 17.5, 15, 13.2, 12.2, 12.5, 12.4, 15.1];
const Y2 = [40, 52, 44, 56, 48, 42, 41, 45, 44, 47];

/** Y1 rises with A; Y2 rises with B. Their specs cut different corners. */
function pair(): { first: StoredModel; second: StoredModel } {
  return { first: quadratic('Yield', Y1), second: quadratic('Strength', Y2) };
}

function specsFor(first: StoredModel, second: StoredModel): ResponseSpec[] {
  return [
    { model: first, lsl: 13, usl: 17, target: 15 },
    { model: second, lsl: 44, usl: 55, target: 50 },
  ];
}

/* ── shared factors ───────────────────────────────────────────────────── */

describe('overlaid contour — common factors (WO-04)', () => {
  it('finds the numeric factors two models share', () => {
    const { first, second } = pair();
    const report = commonNumericFactors([first, second]);
    expect(report.factors.map((factor) => factor.name).sort()).toEqual(['A', 'B']);
    expect(report.problems).toEqual([]);
  });

  it('refuses a factor whose unit differs between models', () => {
    const { first } = pair();
    const second = quadratic('Strength', Y2);
    second.predictors = second.predictors.map((predictor) => (predictor.name === 'A' ? { ...predictor, unit: '°F' } : predictor));
    first.predictors = first.predictors.map((predictor) => (predictor.name === 'A' ? { ...predictor, unit: '°C' } : predictor));
    const report = commonNumericFactors([first, second]);
    expect(report.factors.map((factor) => factor.name)).toEqual(['B']);
    expect(report.problems.join(' ')).toContain('°C');
    expect(report.problems.join(' ')).toContain('°F');
  });

  it('refuses a factor that points at two different columns', () => {
    const { first, second } = pair();
    second.predictors = second.predictors.map((predictor) => (predictor.name === 'B' ? { ...predictor, id: 'C99' } : predictor));
    first.predictors = first.predictors.map((predictor) => (predictor.name === 'B' ? { ...predictor, id: 'C2' } : predictor));
    const report = commonNumericFactors([first, second]);
    expect(report.factors.map((factor) => factor.name)).toEqual(['A']);
    expect(report.problems.length).toBe(1);
  });
});

/* ── area and satisfaction ────────────────────────────────────────────── */

describe('overlaid contour — feasible region (WO-04)', () => {
  it('measures a half-plane mask as half the area', () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = [0, 1, 2, 3, 4];
    const mask = ys.map(() => xs.map((x) => (x <= 2 ? 1 : 0)));
    // Marching squares over a node-valued 0/1 field places the boundary half a
    // cell past the last satisfied node: 2.5 of 4 units, not 2. That half-cell
    // bias is the reason the ratio is documented as a grid approximation.
    expect(maskAreaRatio(xs, ys, mask)).toBeCloseTo(0.625, 3);
  });

  it('never calls a node feasible that misses a specification', () => {
    const { first, second } = pair();
    const specs = specsFor(first, second);
    const result = buildOverlaid([first, second], specs, {
      xName: 'A',
      yName: 'B',
      xRange: [-1.4, 1.4],
      yRange: [-1.4, 1.4],
      resolution: 41,
      mode: 'coded',
      basis: 'mean',
    });
    let checked = 0;
    for (let j = 0; j < result.ys.length; j += 1) {
      for (let i = 0; i < result.xs.length; i += 1) {
        const feasible = result.feasible[j][i] === 1;
        const y1 = result.responses[0].z[j][i];
        const y2 = result.responses[1].z[j][i];
        const ok = y1 >= 13 && y1 <= 17 && y2 >= 44 && y2 <= 55;
        expect(feasible, `node ${i},${j}`).toBe(ok);
        checked += 1;
      }
    }
    expect(checked).toBe(41 * 41);
    expect(result.feasibleNodes).toBeGreaterThan(0);
    expect(result.feasibleNodes).toBeLessThan(result.totalNodes);
    expect(result.nodeRatio).toBeCloseTo(result.feasibleNodes / result.totalNodes, 12);
  });

  it('reports an area ratio close to the grid fraction and inside [0, 1]', () => {
    const { first, second } = pair();
    const result = buildOverlaid([first, second], specsFor(first, second), {
      xName: 'A',
      yName: 'B',
      xRange: [-1.4, 1.4],
      yRange: [-1.4, 1.4],
      resolution: 101,
      mode: 'coded',
      basis: 'mean',
    });
    expect(result.areaRatio).toBeGreaterThan(0);
    expect(result.areaRatio).toBeLessThan(1);
    // The filled geometry and the node count describe the same region; the two
    // definitions may differ by one cell row at the boundary.
    expect(Math.abs(result.areaRatio - result.nodeRatio)).toBeLessThan(0.05);
    expect(result.convergenceDelta).toBeLessThan(0.05);
  });

  it('turns a mean-based answer into an interval answer that is never larger', () => {
    const { first, second } = pair();
    const specs = specsFor(first, second);
    const mean = buildOverlaid([first, second], specs, {
      xName: 'A', yName: 'B', xRange: [-1.4, 1.4], yRange: [-1.4, 1.4], resolution: 61, mode: 'coded', basis: 'mean',
    });
    const confidence = buildOverlaid([first, second], specs, {
      xName: 'A', yName: 'B', xRange: [-1.4, 1.4], yRange: [-1.4, 1.4], resolution: 61, mode: 'coded', basis: 'confidence',
    });
    const prediction = buildOverlaid([first, second], specs, {
      xName: 'A', yName: 'B', xRange: [-1.4, 1.4], yRange: [-1.4, 1.4], resolution: 61, mode: 'coded', basis: 'prediction',
    });
    expect(mean.intervalBlocked).toEqual([]);
    expect(confidence.feasibleNodes).toBeLessThanOrEqual(mean.feasibleNodes);
    expect(prediction.feasibleNodes).toBeLessThanOrEqual(confidence.feasibleNodes);
    // A model that carries a covariance must make the interval basis differ
    // somewhere; otherwise the option would be a lie.
    expect(confidence.feasibleNodes).toBeLessThan(mean.feasibleNodes);
  });

  it('refuses the interval basis when a model has no covariance (no silent mean)', () => {
    const { first, second } = pair();
    const blocked = withoutCovariance(second);
    const specs: ResponseSpec[] = [
      { model: first, lsl: 13, usl: 17, target: 15 },
      { model: blocked, lsl: 44, usl: 55, target: 50 },
    ];
    // The basis is refused with a code naming the model: computing the mean
    // instead would draw a region the reader did not ask for under a label
    // that claims intervals.
    let caught: unknown = null;
    try {
      buildOverlaid([first, blocked], specs, {
        xName: 'A', yName: 'B', xRange: [-1.4, 1.4], yRange: [-1.4, 1.4], resolution: 31, mode: 'coded', basis: 'confidence',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ModelInputError);
    expect((caught as ModelInputError).code).toBe('feasible.basisUnsupported');
    expect((caught as ModelInputError).detail).toMatchObject({ basis: 'confidence' });
    const mean = buildOverlaid([first, blocked], specs, {
      xName: 'A', yName: 'B', xRange: [-1.4, 1.4], yRange: [-1.4, 1.4], resolution: 31, mode: 'coded', basis: 'mean',
    });
    expect(mean.intervalBlocked).toEqual(['Strength']);
  });

  it('warns when no node satisfies every specification', () => {
    const { first, second } = pair();
    const impossible: ResponseSpec[] = [
      { model: first, lsl: 1000, usl: 2000, target: 1500 },
      { model: second, lsl: 44, usl: 55, target: 50 },
    ];
    const result = buildOverlaid([first, second], impossible, {
      xName: 'A', yName: 'B', xRange: [-1.4, 1.4], yRange: [-1.4, 1.4], resolution: 21, mode: 'coded', basis: 'mean',
    });
    expect(result.feasibleNodes).toBe(0);
    expect(result.areaRatio).toBe(0);
    expect(result.narrowWarning).toBe(true);
  });

  it('reports which models can answer an interval at all', () => {
    const { first, second } = pair();
    expect(intervalAvailability([first, second])).toEqual({ ok: true, blocked: [] });
    const blocked = intervalAvailability([first, withoutCovariance(second)]);
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toEqual(['Strength']);
    // The reason travels with the name, so the drawer can say why.
    expect(blocked.details?.[0].reasons.length).toBeGreaterThan(0);
  });

  it('ignores a blank specification', () => {
    const { first, second } = pair();
    const loose: ResponseSpec[] = [
      { model: first, lsl: null, usl: null, target: null },
      { model: second, lsl: null, usl: null, target: null },
    ];
    const result = buildOverlaid([first, second], loose, {
      xName: 'A', yName: 'B', xRange: [-1.4, 1.4], yRange: [-1.4, 1.4], resolution: 21, mode: 'coded', basis: 'mean',
    });
    expect(result.feasibleNodes).toBe(result.totalNodes);
    expect(result.areaRatio).toBeCloseTo(1, 1);
  });
});

/* ── chart plumbing ───────────────────────────────────────────────────── */

describe('overlaid contour — chart (WO-04)', () => {
  function chart(): Extract<ChartSpec, { kind: 'overlaid' }> {
    const { first, second } = pair();
    const specs = specsFor(first, second);
    const result = buildOverlaid([first, second], specs, {
      xName: 'A', yName: 'B', xRange: [-1.4, 1.4], yRange: [-1.4, 1.4], resolution: 41, mode: 'coded', basis: 'mean',
    });
    return {
      kind: 'overlaid',
      xs: result.xs,
      ys: result.ys,
      responses: result.responses,
      xLabel: 'A',
      yLabel: 'B',
      xRange: [-1.4, 1.4],
      yRange: [-1.4, 1.4],
      points: [],
      models: [first, second],
      feasible: {
        mask: result.feasible,
        areaRatio: result.areaRatio,
        nodeRatio: result.nodeRatio,
        feasibleNodes: result.feasibleNodes,
        totalNodes: result.totalNodes,
        basis: 'mean',
        convergenceDelta: result.convergenceDelta,
        perResponse: result.responses.map((response) => ({ name: response.name, areaRatio: response.areaRatio, nodeRatio: response.nodeRatio })),
        intervalBlocked: result.intervalBlocked,
      },
    };
  }

  it('paints every response, its spec lines and the joint region', () => {
    const svg = renderChart(chart(), { width: 560 });
    expect(svg).toContain('data-chart-role="feasible-region"');
    expect(svg).toContain('data-chart-role="spec-line"');
    expect(svg.match(/data-chart-role="overlay-region"/g)?.length).toBe(2);
    expect(svg).toContain('data-chart-role="feasible-ratio"');
    expect(svg).toContain('data-chart-role="overlaid-grid-note"');
    expect(svg).not.toContain('NaN');
  });

  it('recomputes responses and the feasible region from the drawer config', () => {
    const before = chart();
    const settings = { rsm: { xFactorIndex: 0, yFactorIndex: 1, unitMode: 'coded' as const } };
    const loose = materializeOverlaid(before, {
      ...settings,
      feasible: {
        basis: 'mean',
        alpha: 0.05,
        resolution: 'draft',
        specs: [
          { name: 'Yield', lsl: 13, usl: 17, target: 15 },
          { name: 'Strength', lsl: 44, usl: 55, target: 50 },
        ],
      },
    });
    const tight = materializeOverlaid(before, {
      ...settings,
      feasible: {
        basis: 'mean',
        alpha: 0.05,
        resolution: 'draft',
        specs: [
          { name: 'Yield', lsl: 14, usl: 16, target: 15 },
          { name: 'Strength', lsl: 45, usl: 52, target: 50 },
        ],
      },
    });
    expect(loose.kind).toBe('overlaid');
    if (loose.kind !== 'overlaid' || tight.kind !== 'overlaid') return;
    expect(loose.xs.length).toBe(41);
    // Tighter limits cannot widen the feasible region.
    expect(tight.feasible?.feasibleNodes ?? 0).toBeLessThanOrEqual(loose.feasible?.feasibleNodes ?? 0);
    expect(tight.feasible?.feasibleNodes ?? 0).toBeGreaterThan(0);
    // A limit that is not a number is refused, and the card says so instead of
    // keeping a region computed under the old limits.
    const invalid = materializeOverlaid(before, {
      ...settings,
      feasible: {
        basis: 'mean',
        alpha: 0.05,
        resolution: 'draft',
        specs: [
          { name: 'Yield', lsl: 'oops' as unknown as number, usl: 16, target: 15 },
          { name: 'Strength', lsl: 45, usl: 52, target: 50 },
        ],
      },
    });
    expect(invalid.kind).toBe('overlaid');
    if (invalid.kind !== 'overlaid') return;
    expect(invalid.feasible?.error?.code).toBe('feasible.spec.invalid');
    expect(invalid.feasible?.feasibleNodes).toBe(0);
  });

  it('builds the same overlay through buildOverlaidChart with common factors', () => {
    const { first, second } = pair();
    const result = buildOverlaidChart([first, second], {
      xName: 'A',
      yName: 'B',
      unitMode: 'coded',
      resolution: 31,
      basis: 'mean',
      alpha: 0.05,
      specs: [
        { name: 'Yield', lsl: 13, usl: 17, target: 15 },
        { name: 'Strength', lsl: 44, usl: 55, target: 50 },
      ],
    });
    expect(result.xName).toBe('A');
    expect(result.responses.map((response) => response.name)).toEqual(['Yield', 'Strength']);
    expect(result.areaRatio).toBeGreaterThan(0);
  });

  it('keeps the chart unchanged when there are no models to re-evaluate', () => {
    const bare: Extract<ChartSpec, { kind: 'overlaid' }> = { ...chart(), models: [] };
    expect(materializeOverlaid(bare, {})).toBe(bare);
  });
});
