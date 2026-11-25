import { describe, expect, it } from 'vitest';
import { findAnalysis } from '../src/lib/analyses';
import { analyzeFactorial, analyzeRsm } from '../src/lib/doe';
import { lenthPse, saturatedReport } from '../src/lib/errorPooling';
import { fitGlm, type ModelFactor, type ModelTerm } from '../src/lib/glm';
import { makeWorksheet } from '../src/lib/datasets';
import type { Block, Worksheet } from '../src/types';

/** Unreplicated 2³: eight runs, seven effects, no residual df. */
function unreplicated() {
  const rows: [number, number, number][] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) rows.push([a, b, c]);
  const y = rows.map(([a, b, c]) => 10 + 3 * a + 2 * b + 1.5 * c + 1 * a * b - 0.5 * a * c + 0.75 * b * c + 0.25 * a * b * c);
  const factors: ModelFactor[] = [
    { name: 'A', kind: 'categorical', values: rows.map(([a]) => a) },
    { name: 'B', kind: 'categorical', values: rows.map(([, b]) => b) },
    { name: 'C', kind: 'categorical', values: rows.map(([, , c]) => c) },
  ];
  const terms: ModelTerm[] = [
    { name: 'A', factors: ['A'] },
    { name: 'B', factors: ['B'] },
    { name: 'C', factors: ['C'] },
    { name: 'A×B', factors: ['A', 'B'] },
    { name: 'A×C', factors: ['A', 'C'] },
    { name: 'B×C', factors: ['B', 'C'] },
    { name: 'A×B×C', factors: ['A', 'B', 'C'] },
  ];
  return { rows, y, factors, terms };
}

function run(id: string, sheet: Worksheet, values: Record<string, unknown>) {
  const def = findAnalysis(id);
  if (!def) throw new Error(`missing analysis ${id}`);
  return def.run({ lang: 'en', sheet, values });
}

function tables(blocks: Block[]) {
  return blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table');
}

function textLines(blocks: Block[]): string[] {
  return blocks
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .flatMap((b) => b.lines);
}

describe('saturated fits stay estimable but not inferable (WO-3F-06)', () => {
  it('fitGlm keeps the strict guard by default', () => {
    const { y, factors, terms } = unreplicated();
    expect(() => fitGlm(y, factors, terms)).toThrow('glm.noDf');
  });

  it('allows zero residual df on request without inventing tests', () => {
    const { y, factors, terms } = unreplicated();
    const fit = fitGlm(y, factors, terms, { allowZeroDf: true });
    expect(fit.dfe).toBe(0);
    expect(fit.inferable).toBe(false);
    expect(Number.isNaN(fit.mse)).toBe(true);
    expect(Number.isNaN(fit.s)).toBe(true);
    expect(Number.isNaN(fit.r2adj)).toBe(true);
    expect(fit.beta.every((value) => Number.isFinite(value))).toBe(true);
    expect(fit.terms.every((term) => Number.isNaN(term.f) || term.df === 0)).toBe(true);
  });

  it('reports the design state and the estimable terms', () => {
    const { y, factors, terms } = unreplicated();
    const fit = fitGlm(y, factors, terms, { allowZeroDf: true });
    const report = saturatedReport(fit);
    expect(report.saturated).toBe(true);
    expect(report.errorDf).toBe(0);
    expect(report.inferable).toBe(false);
    expect(report.reason).toBe('no-error-df');
    expect(report.estimable.map((term) => term.name)).toEqual(terms.map((term) => term.name));
    expect(report.aliased).toEqual([]);
  });

  it('offers Lenth PSE only when the conditions hold', () => {
    const { y, factors } = unreplicated();
    const saturated = analyzeFactorial(y, factors, 3, { allowZeroDf: true });
    expect(saturated.saturated?.saturated).toBe(true);
    // Deviation coding fixes the sign convention, not the magnitude: the seven
    // effects are ±{6, 4, 3, 2, 1, 1.5, 0.5}.
    const magnitudes = saturated.effects.map((entry) => Math.round(Math.abs(entry.effect) * 1000) / 1000).sort((a, b) => a - b);
    expect(magnitudes).toEqual([0.5, 1, 1.5, 2, 3, 4, 6]);
    expect(saturated.saturated?.lenth.available).toBe(true);
    const lenth = saturated.saturated!.lenth.result!;
    // Effects are [6, 4, 3, 2, −1, 1.5, 0.5]; s0 = 1.5 × median = 3;
    // the inactive set is every effect (all < 7.5), so PSE = 1.5 × 2 = 3.
    // Lenth (1989): m = 7 effects, d = m/3 = 7/3 (fractional), PSE = 3.
    // SciPy 1.18.1: t(0.975, 7/3) = 3.764123072 -> ME = 11.292369216;
    // gamma = (1 + 0.95^(1/7))/2 -> t(gamma, 7/3) = 9.008307114 -> SME = 27.024921342.
    // (ADD-01: previous test pinned buggy floor(selected/3)=2 and SME = ME/2.)
    expect(lenth.pse).toBeCloseTo(3, 9);
    expect(lenth.pseudoDf).toBeCloseTo(7 / 3, 9);
    expect(lenth.me).toBeCloseTo(11.292369216, 4);
    expect(lenth.sme).toBeCloseTo(27.024921342, 3);
    expect(lenth.sme).toBeGreaterThan(lenth.me);
    expect(lenth.activeCount).toBe(7);
    expect(lenth.effects.every((entry) => entry.active === false)).toBe(true);
  });

  it('reports the effect spread used by the pseudo error', () => {
    const lenth = lenthPse(
      [{ term: 'A', effect: 8 }, { term: 'B', effect: 0.2 }, { term: 'C', effect: 0.3 }, { term: 'D', effect: 0.1 }, { term: 'E', effect: 1.2 }],
      { saturated: true },
    );
    expect(lenth.available).toBe(true);
    expect(lenth.result!.pse).toBeCloseTo(0.3, 9);
    // Lenth (1989): m = 5 effects -> d = m/3 = 5/3 (ADD-01: replaced buggy floor=1)
    expect(lenth.result!.pseudoDf).toBeCloseTo(5 / 3, 9);
    expect(lenth.result!.effects.find((entry) => entry.term === 'A')!.active).toBe(true);
    expect(lenth.result!.effects.find((entry) => entry.term === 'E')!.active).toBe(true);
  });

  it('refuses Lenth when a residual error exists or the design is not saturated', () => {
    const replicated = lenthPse([{ term: 'A', effect: 2 }, { term: 'B', effect: 1 }, { term: 'C', effect: 0.5 }], { saturated: true, replicated: true });
    expect(replicated.available).toBe(false);
    expect(replicated.reason).toBe('replicated');
    const notSaturated = lenthPse([{ term: 'A', effect: 2 }, { term: 'B', effect: 1 }, { term: 'C', effect: 0.5 }], { saturated: false });
    expect(notSaturated.available).toBe(false);
    expect(notSaturated.reason).toBe('not-saturated');
    const tooFew = lenthPse([{ term: 'A', effect: 2 }, { term: 'B', effect: 1 }], { saturated: true });
    expect(tooFew.reason).toBe('too-few-effects');
  });

  it('presents the saturated DOE output instead of failing the run', () => {
    const { rows, y } = unreplicated();
    const sheet = makeWorksheet('Unreplicated', [
      { name: 'A', type: 'numeric', values: rows.map(([a]) => a) },
      { name: 'B', type: 'numeric', values: rows.map(([, b]) => b) },
      { name: 'C', type: 'numeric', values: rows.map(([, , c]) => c) },
      { name: 'Y', type: 'numeric', values: y },
    ]);
    const result = run('doeanalyze', sheet, { response: 'C4', factors: ['C1', 'C2', 'C3'], order: '3' });
    const notes = textLines(result.blocks).join('\n');
    expect(notes).toContain('Error DF is 0');
    expect(notes).toContain('Lenth');
    const lenth = tables(result.blocks).find((table) => table.title === '@res.lenth');
    expect(lenth).toBeDefined();
    expect(lenth!.rows).toHaveLength(7);
  });

  it('presents a saturated GLM without a fabricated p-value', () => {
    const sheet = makeWorksheet('Two rows', [
      { name: 'A', type: 'text', values: ['Low', 'High'] },
      { name: 'Y', type: 'numeric', values: [1, 2] },
    ]);
    const result = run('glm', sheet, { response: 'C2', factors: ['C1'], interactions: false });
    expect(textLines(result.blocks).join('\n')).toContain('Error DF is 0');
    const coef = tables(result.blocks).find((table) => table.title === '@res.coefficients');
    for (const row of coef!.rows) expect(String(row[4])).toBe('—');
  });

  it('flags an incomplete quadratic when a square term is pooled', () => {
    const design: [number, number][] = [
      [-1, -1], [-1, 1], [1, -1], [1, 1],
      [1.4142, 0], [-1.4142, 0], [0, 1.4142], [0, -1.4142],
      [0, 0], [0, 0], [0, 0],
    ];
    const y = design.map(([a, b]) => 50 + 2 * a - 3 * b + 0.5 * a * a + 0.8 * b * b + 0.6 * a * b);
    const factors: ModelFactor[] = [
      { name: 'A', kind: 'numeric', values: design.map(([a]) => a) },
      { name: 'B', kind: 'numeric', values: design.map(([, b]) => b) },
    ];
    const terms: ModelTerm[] = [
      { name: 'A', factors: ['A'] },
      { name: 'B', factors: ['B'] },
      { name: 'A²', factors: ['A²'] },
      { name: 'B²', factors: ['B²'] },
      { name: 'A×B', factors: ['A', 'B'] },
    ];
    const pooled = analyzeRsm(y, factors, { terms, pooled: ['A²'], allowZeroDf: true });
    expect(pooled.incompleteQuadratic).toBe(true);
    expect(pooled.stationary).toBeUndefined();
    expect(pooled.pooling?.pooled[0].name).toBe('A²');
    expect(pooled.glm.dfe).toBeGreaterThan(0);
  });
});
