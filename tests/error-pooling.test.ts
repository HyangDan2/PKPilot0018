import { describe, expect, it } from 'vitest';
import { analyzeFactorial } from '../src/lib/doe';
import { fitWithPooling } from '../src/lib/errorPooling';
import type { ModelFactor, ModelTerm } from '../src/lib/glm';

/** Full 2³ factorial, two replicates per cell. Orthogonal by construction. */
function replicates() {
  const A: number[] = [];
  const B: number[] = [];
  const C: number[] = [];
  const y: number[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const c of [-1, 1]) {
        for (const rep of [0, 1]) {
          A.push(a); B.push(b); C.push(c);
          // True model + a ±0.2 residual, so SSE = 16 × 0.04 = 0.64 exactly.
          y.push(10 + 3 * a + 2 * b + 1.5 * c + 1 * a * b - 0.5 * a * c + 0.75 * b * c + 0.25 * a * b * c
            + (rep === 0 ? 0.2 : -0.2));
        }
      }
    }
  }
  const factors: ModelFactor[] = [
    { name: 'A', kind: 'categorical', values: A },
    { name: 'B', kind: 'categorical', values: B },
    { name: 'C', kind: 'categorical', values: C },
  ];
  return { factors, y };
}

function allTerms(): ModelTerm[] {
  return [
    { name: 'A', factors: ['A'] },
    { name: 'B', factors: ['B'] },
    { name: 'C', factors: ['C'] },
    { name: 'A×B', factors: ['A', 'B'] },
    { name: 'A×C', factors: ['A', 'C'] },
    { name: 'B×C', factors: ['B', 'C'] },
    { name: 'A×B×C', factors: ['A', 'B', 'C'] },
  ];
}

describe('manual error pooling (WO-3F-03)', () => {
  it('refits the reduced model and keeps the full model for comparison', () => {
    const { factors, y } = replicates();
    const pooling = fitWithPooling(y, factors, allTerms(), ['B×C'], { allowZeroDf: true });
    expect(pooling.full.terms.map((term) => term.name)).toContain('B×C');
    expect(pooling.fit.terms.map((term) => term.name)).not.toContain('B×C');
    expect(pooling.fit.dfe).toBe(pooling.full.dfe + 1);
    expect(pooling.fit.sse).toBeGreaterThan(pooling.full.sse);
  });

  it('verifies SSE and DFE additivity on an orthogonal design', () => {
    const { factors, y } = replicates();
    const pooling = fitWithPooling(y, factors, allTerms(), ['B×C'], { allowZeroDf: true });
    // Orthogonal coding: SS(B×C) = n · coef² = 16 · 0.75² = 9.
    expect(pooling.pooled[0].ss).toBeCloseTo(9, 9);
    expect(pooling.checks.expectedSs).toBeCloseTo(0.64 + 9, 9);
    expect(pooling.checks.actualSs).toBeCloseTo(0.64 + 9, 9);
    expect(pooling.checks.expectedDfe).toBe(9);
    expect(pooling.checks.actualDfe).toBe(9);
    expect(pooling.checks.dfOk).toBe(true);
    expect(pooling.checks.ssOk).toBe(true);
    expect(pooling.checks.additive).toBe(true);
    expect(pooling.checks.sameRows).toBe(true);
    expect(pooling.warnings).toEqual([]);
  });

  it('adds two pooled terms on an orthogonal design', () => {
    const { factors, y } = replicates();
    const pooling = fitWithPooling(y, factors, allTerms(), ['A×C', 'B×C'], { allowZeroDf: true });
    // SS(A×C) = 16 · 0.5² = 4, SS(B×C) = 16 · 0.75² = 9.
    expect(pooling.checks.expectedSs).toBeCloseTo(0.64 + 4 + 9, 9);
    expect(pooling.checks.expectedDfe).toBe(10);
    expect(pooling.checks.additive).toBe(true);
  });

  it('reports non-additivity truthfully for non-orthogonal terms', () => {
    const cells: { a: string; b: string; y: number }[] = [
      { a: 'L1', b: 'B1', y: 11 }, { a: 'L1', b: 'B1', y: 12 }, { a: 'L1', b: 'B1', y: 13 }, { a: 'L1', b: 'B2', y: 15 },
      { a: 'L2', b: 'B1', y: 12 }, { a: 'L2', b: 'B1', y: 14 }, { a: 'L2', b: 'B2', y: 16 }, { a: 'L2', b: 'B2', y: 18 }, { a: 'L2', b: 'B2', y: 17 },
      { a: 'L3', b: 'B1', y: 13 }, { a: 'L3', b: 'B2', y: 17 }, { a: 'L3', b: 'B2', y: 19 },
    ];
    const factors: ModelFactor[] = [
      { name: 'A', kind: 'categorical', values: cells.map((cell) => cell.a) },
      { name: 'B', kind: 'categorical', values: cells.map((cell) => cell.b) },
    ];
    const terms: ModelTerm[] = [
      { name: 'A', factors: ['A'] },
      { name: 'B', factors: ['B'] },
      { name: 'A×B', factors: ['A', 'B'] },
    ];
    const pooling = fitWithPooling(cells.map((cell) => cell.y), factors, terms, ['A', 'B'], { allowZeroDf: true });
    // The DFE identity always holds; the SS sum is the part that may fail.
    expect(pooling.checks.dfOk).toBe(true);
    expect(pooling.checks.additive).toBe(false);
    expect(pooling.checks.ssOk).toBe(false);
    expect(pooling.warnings).toContain('ss-identity-failed');
    // The reported numbers still come from the refit, never from a sum.
    expect(pooling.fit.sse).toBe(pooling.checks.actualSs);
    expect(pooling.fit.dfe).toBe(pooling.checks.actualDfe);
  });

  it('warns about unknown pooled terms without double counting', () => {
    const { factors, y } = replicates();
    const terms = allTerms().filter((term) => term.name !== 'A×B×C');
    const pooling = fitWithPooling(y, factors, terms, ['A×B×C'], { allowZeroDf: true });
    expect(pooling.warnings).toContain('unknown-pooled-term:A×B×C');
    expect(pooling.pooled).toEqual([]);
    expect(pooling.checks.expectedSs).toBeCloseTo(pooling.full.sse, 9);
  });

  it('refuses to pool every term away', () => {
    const { factors, y } = replicates();
    expect(() => fitWithPooling(y, factors, allTerms(), allTerms().map((term) => term.name), { allowZeroDf: true }))
      .toThrow('glm.noTerms');
  });

  it('exposes the pooled report on the factorial analysis', () => {
    const { factors, y } = replicates();
    const analysis = analyzeFactorial(y, factors, 3, { pooled: ['B×C'] });
    expect(analysis.pooling).toBeDefined();
    expect(analysis.pooling!.pooled[0].name).toBe('B×C');
    expect(analysis.effects.map((effect) => effect.term)).not.toContain('B×C');
    expect(analysis.pooling!.checks.additive).toBe(true);
  });

  it('keeps the model when no pooling is requested', () => {
    const { factors, y } = replicates();
    const analysis = analyzeFactorial(y, factors, 3);
    expect(analysis.pooling).toBeUndefined();
    expect(analysis.effects).toHaveLength(7);
  });

  it('reports coefficients and tests from the refit, not from the full model', () => {
    const { factors, y } = replicates();
    const pooling = fitWithPooling(y, factors, allTerms(), ['B×C'], { allowZeroDf: true });
    const fullStart = pooling.full.design.blockStart[2];
    const reducedStart = pooling.fit.design.blockStart[2];
    expect(pooling.fit.beta[reducedStart]).toBeCloseTo(pooling.full.beta[fullStart], 9);
    // Orthogonal: the estimate is unchanged but the error df grows.
    expect(pooling.fit.se[reducedStart]).toBeGreaterThan(pooling.full.se[fullStart]);
  });
});
