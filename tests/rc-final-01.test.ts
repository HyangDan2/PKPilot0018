import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeFactorial } from '../src/lib/doe';
import { findAnalysis } from '../src/lib/analyses';
import { makeWorksheet } from '../src/lib/datasets';
import { createStoredModel, refitStoredModel } from '../src/lib/modelStore';
import { predictStoredModel } from '../src/lib/modelPredictor';
import { buildTermCatalog, resolveModelSelection } from '../src/lib/modelTerms';
import { clearModelSettings, loadModelSettings, saveModelSettings } from '../src/lib/modelSettings';
import type { ModelFactor } from '../src/lib/glm';

describe('WO-RC-FINAL-01 · RC-02: DOE Factor Coding', () => {
  // 2^3 replicated factorial (16 runs) with known coded effects:
  // Y = 50 + 6*A - 4*B + 2*C + 3*A*B (plus small replicate noise)
  const codedA = [-1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1];
  const codedB = [-1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1];
  const codedC = [-1, -1, -1, -1, 1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1, 1];
  const noise  = [0.2, -0.1, 0.1, -0.2, 0.15, -0.15, 0.05, -0.05, -0.2, 0.1, -0.1, 0.2, -0.15, 0.15, -0.05, 0.05];
  const y = codedA.map((a, i) => 50 + 6 * a - 4 * codedB[i] + 2 * codedC[i] + 3 * a * codedB[i] + noise[i]);

  function makeFactors(mapA: (x: number) => number, mapB: (x: number) => number, mapC: (x: number) => number): ModelFactor[] {
    return [
      { name: 'A', kind: 'numeric', values: codedA.map(mapA) },
      { name: 'B', kind: 'numeric', values: codedB.map(mapB) },
      { name: 'C', kind: 'numeric', values: codedC.map(mapC) },
    ];
  }

  it('produces identical effects, coefficients, t, p, and R² for -1/+1, 0/1, and 30/50 encodings', () => {
    const resCoded = analyzeFactorial(y, makeFactors((x) => x, (x) => x, (x) => x), 2);
    const resZeroOne = analyzeFactorial(y, makeFactors((x) => (x + 1) / 2, (x) => (x + 1) / 2, (x) => (x + 1) / 2), 2);
    const resActual = analyzeFactorial(y, makeFactors((x) => 40 + 10 * x, (x) => 150 + 50 * x, (x) => 5 + 2.5 * x), 2);

    expect(resActual.codings.every((c) => c.isTwoLevel && !c.hasCenterPoints)).toBe(true);
    expect(resActual.codings[0].center).toBeCloseTo(40, 10);
    expect(resActual.codings[0].halfRange).toBeCloseTo(10, 10);

    for (const alt of [resZeroOne, resActual]) {
      expect(alt.glm.r2).toBeCloseTo(resCoded.glm.r2, 10);
      expect(alt.glm.sse).toBeCloseTo(resCoded.glm.sse, 10);
      expect(alt.effects.length).toBe(resCoded.effects.length);
      for (let i = 0; i < resCoded.effects.length; i += 1) {
        expect(alt.effects[i].effect).toBeCloseTo(resCoded.effects[i].effect, 10);
        expect(alt.effects[i].coef).toBeCloseTo(resCoded.effects[i].coef, 10);
        expect(alt.effects[i].se).toBeCloseTo(resCoded.effects[i].se, 10);
        expect(alt.effects[i].t).toBeCloseTo(resCoded.effects[i].t, 10);
        expect(alt.effects[i].p).toBeCloseTo(resCoded.effects[i].p, 10);
      }
    }
    // Sanity check exact known effects (2 * coded coef)
    expect(resActual.effects.find((e) => e.term === 'A')!.effect).toBeCloseTo(12, 8);
    expect(resActual.effects.find((e) => e.term === 'B')!.effect).toBeCloseTo(-8, 8);
    expect(resActual.effects.find((e) => e.term === 'A×B')!.effect).toBeCloseTo(6, 8);
  });

  it('produces identical Lenth PSE/ME/SME on unreplicated saturated designs regardless of input scale', () => {
    const y8 = y.slice(0, 8);
    const fCoded: ModelFactor[] = [
      { name: 'A', kind: 'numeric', values: codedA.slice(0, 8) },
      { name: 'B', kind: 'numeric', values: codedB.slice(0, 8) },
      { name: 'C', kind: 'numeric', values: codedC.slice(0, 8) },
    ];
    const fActual: ModelFactor[] = [
      { name: 'A', kind: 'numeric', values: codedA.slice(0, 8).map((x) => 40 + 10 * x) },
      { name: 'B', kind: 'numeric', values: codedB.slice(0, 8).map((x) => 150 + 50 * x) },
      { name: 'C', kind: 'numeric', values: codedC.slice(0, 8).map((x) => 5 + 2.5 * x) },
    ];
    const r1 = analyzeFactorial(y8, fCoded, 3);
    const r2 = analyzeFactorial(y8, fActual, 3);
    expect(r2.saturated?.lenth.available).toBe(true);
    expect(r2.saturated?.lenth.result?.pse).toBeCloseTo(r1.saturated!.lenth.result!.pse, 10);
    expect(r2.saturated?.lenth.result?.me).toBeCloseTo(r1.saturated!.lenth.result!.me, 10);
    expect(r2.saturated?.lenth.result?.sme).toBeCloseTo(r1.saturated!.lenth.result!.sme, 10);
  });

  it('recognizes 2-level designs with center points as valid 2-level coded designs', () => {
    const aWithCenter = [...codedA.slice(0, 8), 0, 0];
    const bWithCenter = [...codedB.slice(0, 8), 0, 0];
    const yWithCenter = [...y.slice(0, 8), 50.1, 49.9];
    const resCoded = analyzeFactorial(yWithCenter, [
      { name: 'A', kind: 'numeric', values: aWithCenter },
      { name: 'B', kind: 'numeric', values: bWithCenter },
    ], 2);
    const resActual = analyzeFactorial(yWithCenter, [
      { name: 'A', kind: 'numeric', values: aWithCenter.map((x) => 40 + 10 * x) },
      { name: 'B', kind: 'numeric', values: bWithCenter.map((x) => 150 + 50 * x) },
    ], 2);
    expect(resActual.codings[0].isTwoLevel).toBe(true);
    expect(resActual.codings[0].hasCenterPoints).toBe(true);
    expect(resActual.effects[0].effect).toBeCloseTo(resCoded.effects[0].effect, 10);
  });

  it('flags non-center 3+ level factors as non-two-level and does not emit bogus 2*coef effects', () => {
    const fMulti: ModelFactor[] = [
      { name: 'A', kind: 'numeric', values: [10, 20, 50, 10, 20, 50, 10, 20] },
      { name: 'B', kind: 'numeric', values: [-1, -1, -1, 1, 1, 1, -1, 1] },
    ];
    const res = analyzeFactorial([1, 2, 5, 3, 4, 7, 1.2, 4.1], fMulti, 2);
    expect(res.codings[0].isTwoLevel).toBe(false);
    expect(res.codings[1].isTwoLevel).toBe(true);
    expect(Number.isNaN(res.effects.find((e) => e.term === 'A')!.effect)).toBe(true);
    expect(Number.isNaN(res.effects.find((e) => e.term === 'A×B')!.effect)).toBe(true);
    expect(Number.isFinite(res.effects.find((e) => e.term === 'B')!.effect)).toBe(true);
  });

  it('stores actual-unit coding on DOE StoredModel and predicts/refits accurately in actual units', () => {
    const sheet = makeWorksheet('ActualDOE', [
      { name: 'Temp', type: 'numeric', values: codedA.map((x) => 40 + 10 * x) },
      { name: 'Press', type: 'numeric', values: codedB.map((x) => 150 + 50 * x) },
      { name: 'Time', type: 'numeric', values: codedC.map((x) => 5 + 2.5 * x) },
      { name: 'Yield', type: 'numeric', values: y },
    ]);
    const def = findAnalysis('doeanalyze')!;
    const out = def.run({ lang: 'en', sheet, values: { response: 'C4', factors: ['C1', 'C2', 'C3'], order: '2' } });
    expect(out.modelDraft).toBeDefined();
    const stored = createStoredModel(out.modelDraft!, 'ActualDOE');

    // Predict at actual corner (Temp=50 -> +1, Press=200 -> +1, Time=7.5 -> +1):
    // True mean = 50 + 6(1) - 4(1) + 2(1) + 3(1)(1) = 57.0
    const predCorner = predictStoredModel(stored, { Temp: 50, Press: 200, Time: 7.5 }, { mode: 'actual' });
    expect(predCorner.value).toBeCloseTo(57.0, 6);

    // Predict at center (Temp=40 -> 0, Press=150 -> 0, Time=5.0 -> 0): true mean = 50.0
    const predCenter = predictStoredModel(stored, { Temp: 40, Press: 150, Time: 5.0 }, { mode: 'actual' });
    expect(predCenter.value).toBeCloseTo(50.0, 6);

    // Refit against shifted response (+10) preserves actual bounds & coding
    const shifted = {
      ...sheet,
      columns: sheet.columns.map((c) => (c.name === 'Yield' ? { ...c, values: y.map((v) => v + 10) } : c)),
    };
    const refit = refitStoredModel(stored, shifted);
    expect(refit.factorBounds?.Temp).toEqual({ min: 30, max: 50 });
    expect(predictStoredModel(refit, { Temp: 50, Press: 200, Time: 7.5 }, { mode: 'actual' }).value).toBeCloseTo(67.0, 6);
  });
});

describe('WO-RC-FINAL-01 · RC-03: Hierarchy Engine Validation with Pooling', () => {
  const codedA = [-1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1];
  const codedB = [-1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1];
  const codedC = [-1, -1, -1, -1, 1, 1, 1, 1, -1, -1, -1, -1, 1, 1, 1, 1];
  const y = codedA.map((a, i) => 10 + 3 * a + 2 * codedB[i] + codedC[i] + 4 * a * codedB[i]);
  const sheet = makeWorksheet('PoolHier', [
    { name: 'A', type: 'numeric', values: codedA },
    { name: 'B', type: 'numeric', values: codedB },
    { name: 'C', type: 'numeric', values: codedC },
    { name: 'Y', type: 'numeric', values: y },
  ]);

  beforeEach(() => clearModelSettings('doeanalyze'));

  it('resolveModelSelection detects pooling a lower-order term while higher-order interaction remains', () => {
    const catalog = buildTermCatalog([
      { name: 'A', kind: 'numeric', values: codedA },
      { name: 'B', kind: 'numeric', values: codedB },
      { name: 'C', kind: 'numeric', values: codedC },
    ], 3);
    const allIds = catalog.terms.map((t) => t.id);

    // Strict: pooling B|C while A|B|C stays -> violation!
    const strict = resolveModelSelection(catalog, allIds, ['B|C'], 'strict', true);
    expect(strict.hierarchy.violations.length).toBeGreaterThan(0);
    expect(strict.hierarchy.violations[0].missing).toContain('B×C');

    // Auto: restores B|C and removes it from pooled
    const auto = resolveModelSelection(catalog, allIds, ['B|C'], 'auto', true);
    expect(auto.pooled.map((p) => p.name)).not.toContain('B×C');
    expect(auto.terms.map((t) => t.name)).toContain('B×C');

    // Unrestricted: allows pooling B|C but still reports the violation
    const unres = resolveModelSelection(catalog, allIds, ['B|C'], 'unrestricted', true);
    expect(unres.pooled.map((p) => p.name)).toContain('B×C');
    expect(unres.hierarchy.violations.length).toBeGreaterThan(0);
  });

  it('blocks non-hierarchical pooled runs in strict mode across analysis execution', () => {
    const def = findAnalysis('doeanalyze')!;
    expect(() => def.run({
      lang: 'en',
      sheet,
      values: {
        response: 'C4',
        factors: ['C1', 'C2', 'C3'],
        order: '3',
        terms: ['A', 'B', 'C', 'A|B', 'A|C', 'B|C', 'A|B|C'],
        pooled: ['B|C'],
        hierarchy: 'strict',
      },
    })).toThrow(/model\.hierarchyViolation/);

    // Pooling A|B|C and B|C together is hierarchical and succeeds
    const valid = def.run({
      lang: 'en',
      sheet,
      values: {
        response: 'C4',
        factors: ['C1', 'C2', 'C3'],
        order: '3',
        terms: ['A', 'B', 'C', 'A|B', 'A|C', 'B|C', 'A|B|C'],
        pooled: ['A|B|C', 'B|C'],
        hierarchy: 'strict',
      },
    });
    expect(valid.modelDraft).toBeDefined();
    const saved = loadModelSettings('doeanalyze');
    expect(saved?.pooled).toEqual(['A|B|C', 'B|C']);
  });

  it('enforces hierarchy when restoring previously saved pooled settings', () => {
    saveModelSettings('doeanalyze', {
      terms: ['A', 'B', 'A|B'],
      pooled: ['A'],
      hierarchy: 'strict',
      order: 2,
    });
    const restored = loadModelSettings('doeanalyze')!;
    const def = findAnalysis('doeanalyze')!;
    expect(() => def.run({
      lang: 'en',
      sheet,
      values: {
        response: 'C4',
        factors: ['C1', 'C2'],
        order: String(restored.order),
        terms: restored.terms,
        pooled: restored.pooled,
        hierarchy: restored.hierarchy,
      },
    })).toThrow(/model\.hierarchyViolation/);
  });
});
