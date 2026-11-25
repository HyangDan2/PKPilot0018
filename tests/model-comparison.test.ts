import { describe, expect, it } from 'vitest';
import { fCdf } from '../src/lib/dist';
import { fitWithPooling } from '../src/lib/errorPooling';
import { fitGlm, type ModelFactor, type ModelTerm } from '../src/lib/glm';
import { compareFits } from '../src/lib/modelComparison';

/** Full 2³ factorial, two replicates per cell: an exactly orthogonal design. */
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

describe('original vs reduced model comparison (WO-3F-05)', () => {
  it('puts the fit statistics side by side without overwriting the original', () => {
    const { factors, y } = replicates();
    const pooling = fitWithPooling(y, factors, allTerms(), ['B×C'], { allowZeroDf: true });
    const comparison = compareFits(pooling.full, pooling.fit, ['B×C']);
    expect(comparison.original.sse).toBe(pooling.full.sse);
    expect(comparison.reduced.sse).toBe(pooling.fit.sse);
    expect(comparison.removed).toEqual(['B×C']);
    expect(comparison.retained).toEqual(['A', 'B', 'C', 'A×B', 'A×C', 'A×B×C']);
    expect(comparison.nested).toBe(true);
    const byKey = Object.fromEntries(comparison.metrics.map((metric) => [metric.key, metric]));
    expect(byKey.n.original).toBe(16);
    expect(byKey.n.reduced).toBe(16);
    expect(byKey.modelDf.original).toBe(7);
    expect(byKey.modelDf.reduced).toBe(6);
    expect(byKey.modelDf.difference).toBe(-1);
    expect(byKey.errorDf.original).toBe(8);
    expect(byKey.errorDf.reduced).toBe(9);
    expect(byKey.errorDf.difference).toBe(1);
    expect(byKey.errorSs.reduced! - byKey.errorSs.original!).toBeCloseTo(9, 9);
    expect(byKey.s.reduced!).toBeGreaterThan(byKey.s.original!);
    expect(byKey.r2.difference!).toBeLessThan(0);
  });

  it('runs the partial F-test for a nested reduced model', () => {
    const { factors, y } = replicates();
    const pooling = fitWithPooling(y, factors, allTerms(), ['B×C'], { allowZeroDf: true });
    const comparison = compareFits(pooling.full, pooling.fit, ['B×C']);
    expect(comparison.partial).not.toBeNull();
    const { df1, df2, f, p } = comparison.partial!;
    expect(df1).toBe(1);
    expect(df2).toBe(9);
    const expected = (pooling.fit.sse - pooling.full.sse) / pooling.fit.mse;
    expect(f).toBeCloseTo(expected, 9);
    expect(p).toBeCloseTo(1 - fCdf(expected, 1, 9), 12);
    // SS(B×C) = 9 in this orthogonal design, so the test sees a real effect.
    expect(f).toBeGreaterThan(8);
  });

  it('reports why the partial F-test does not apply', () => {
    const { factors, y } = replicates();
    const ab = fitGlm(y, factors, allTerms().slice(0, 4));
    const bc = fitGlm(y, factors, [allTerms()[1], allTerms()[2], allTerms()[5]]);
    const notNested = compareFits(ab, bc, ['A']);
    expect(notNested.nested).toBe(false);
    expect(notNested.partial).toBeNull();
    expect(notNested.partialReason).toBe('not-nested');

    const same = compareFits(ab, ab, []);
    expect(same.partial).toBeNull();
    expect(same.partialReason).toBe('no-reduction');
  });

  it('marks predicted R² unavailable on a saturated fit instead of printing NaN', () => {
    const rows: [number, number, number][] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) rows.push([a, b, c]);
    const y = rows.map(([a, b, c]) => 10 + 3 * a + 2 * b + c + a * b);
    const factors: ModelFactor[] = (['A', 'B', 'C'] as const).map((name, index) => ({
      name,
      kind: 'categorical',
      values: rows.map((row) => row[index]),
    }));
    const saturated = fitGlm(y, factors, allTerms(), { allowZeroDf: true });
    expect(saturated.dfe).toBe(0);
    const reduced = fitGlm(y, factors, allTerms().slice(0, 6), { allowZeroDf: true });
    const comparison = compareFits(saturated, reduced, ['A×B×C']);
    const byKey = Object.fromEntries(comparison.metrics.map((metric) => [metric.key, metric]));
    expect(byKey.r2adj.original).toBeNull();
    expect(byKey.r2adj.reason).toBe('model.cmp.notInferable');
    expect(byKey.r2pred.original).toBeNull();
    expect(byKey.r2pred.reason).toBe('model.cmp.pressUnavailable');
    expect(byKey.r2pred.difference).toBeNull();
  });

  it('lists coefficient and ANOVA changes, including removed terms', () => {
    const { factors, y } = replicates();
    const pooling = fitWithPooling(y, factors, allTerms(), ['B×C'], { allowZeroDf: true });
    const comparison = compareFits(pooling.full, pooling.fit, ['B×C']);
    // Coefficient labels carry the coded level, e.g. 'B[-1]×C[-1]'.
    const removedRow = comparison.coefficients.find(
      (entry) => entry.label.replace(/\[[^\]]*\]/g, '') === 'B×C',
    );
    expect(removedRow).toBeDefined();
    expect(removedRow!.original).toBeCloseTo(0.75, 9);
    expect(removedRow!.reduced).toBeNull();
    const anovaRow = comparison.anova.find((entry) => entry.term === 'B×C');
    expect(anovaRow!.state).toBe('removed');
    expect(anovaRow!.reducedSs).toBeNull();
    expect(anovaRow!.originalSs).toBeCloseTo(9, 9);
  });
});
