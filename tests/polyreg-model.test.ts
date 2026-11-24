import { describe, expect, it } from 'vitest';
import { findAnalysis, defaultValues } from '../src/lib/analyses';
import { makeWorksheet } from '../src/lib/datasets';
import { createStoredModel, refitStoredModel, type StoredModelDraft } from '../src/lib/modelStore';
import { predictStoredModel } from '../src/lib/modelPredictor';
import type { StoredModel } from '../src/lib/modelStore';

/** y = 3 + 2x + 0.5x² — an exact quadratic, so a correct fit predicts it exactly. */
function quadraticSheet(): ReturnType<typeof makeWorksheet> {
  const xs = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  return makeWorksheet('Quadratic', [
    { name: 'x', type: 'numeric', values: xs },
    { name: 'y', type: 'numeric', values: xs.map((x) => 3 + 2 * x + 0.5 * x * x) },
  ]);
}

function runPoly(sheet: ReturnType<typeof makeWorksheet>, degree: number) {
  const def = findAnalysis('polyreg');
  if (!def) throw new Error('polyreg analysis is not registered');
  const values = { ...defaultValues(def), response: 'C2', predictors: ['C1'], degree, fourInOne: false };
  return def.run({ lang: 'en', sheet, values });
}

describe('polynomial regression (WO-02 supported model)', () => {
  it('fits linear and squared terms and stores one input per variable', () => {
    const sheet = quadraticSheet();
    const result = runPoly(sheet, 2);
    const draft = result.modelDraft as StoredModelDraft;
    expect(draft).toBeDefined();
    expect(draft.kind).toBe('polynomial');
    expect(draft.coefficients.map((c) => c.label)).toEqual(['Constant', 'x', 'x²']);
    // The square is a derived term, not a second input the reader would type.
    expect(draft.predictors.map((p) => p.name)).toEqual(['x']);
    expect(draft.terms.map((term) => term.label)).toEqual(['x', 'x²']);
    const model = createStoredModel(draft, 'quadratic');
    const prediction = predictStoredModel(model, { x: 4 });
    expect(prediction.nonEstimable).toEqual([]);
    expect(prediction.value).toBeCloseTo(3 + 2 * 4 + 0.5 * 16, 8);
  });

  it('prints the equation and the coefficient table', () => {
    const result = runPoly(quadraticSheet(), 2);
    const text = JSON.stringify(result.blocks);
    expect(text).toContain('x²');
    expect(text).toContain('R²');
    expect(result.subtitle).toContain('degree 2');
  });

  it('adds the cubic term at degree 3', () => {
    const xs = [-3, -2, -1, 0, 1, 2, 3];
    const sheet = makeWorksheet('Cubic', [
      { name: 'x', type: 'numeric', values: xs },
      { name: 'y', type: 'numeric', values: xs.map((x) => 1 - x + 0.25 * x ** 3) },
    ]);
    const result = runPoly(sheet, 3);
    const draft = result.modelDraft as StoredModelDraft;
    expect(draft.coefficients.map((c) => c.label)).toEqual(['Constant', 'x', 'x²', 'x³']);
    const model = createStoredModel(draft, 'cubic');
    expect(predictStoredModel(model, { x: 2 }).value).toBeCloseTo(1 - 2 + 0.25 * 8, 8);
  });

  it('re-fits a polynomial model by rebuilding its derived square', () => {
    const sheet = quadraticSheet();
    const model: StoredModel = createStoredModel(runPoly(sheet, 2).modelDraft as StoredModelDraft, 'quadratic');
    const doubled = {
      ...sheet,
      columns: sheet.columns.map((column, index) => (index === 1
        ? { ...column, values: column.values.map((value) => (typeof value === 'number' ? value * 2 : value)) }
        : column)),
    };
    const refit = refitStoredModel(model, doubled);
    expect(refit.coefficients.find((c) => c.label === 'Constant')?.value).toBeCloseTo(6, 8);
    expect(refit.coefficients.find((c) => c.label === 'x²')?.value).toBeCloseTo(1, 8);
    expect(refit.predictors.map((p) => p.name)).toEqual(['x']);
  });

  it('explains a rank-deficient polynomial instead of inventing a value', () => {
    // A cubic through four points has no residual degrees of freedom.
    const xs = [0, 1, 2, 3];
    const sheet = makeWorksheet('Tiny', [
      { name: 'x', type: 'numeric', values: xs },
      { name: 'y', type: 'numeric', values: xs.map((x) => x ** 3) },
    ]);
    expect(() => runPoly(sheet, 3)).toThrow();
  });
});
