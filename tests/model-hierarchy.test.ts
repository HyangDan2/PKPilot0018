import { beforeEach, describe, expect, it } from 'vitest';
import { findAnalysis } from '../src/lib/analyses';
import { clearModelSettings, loadModelSettings, saveModelSettings } from '../src/lib/modelSettings';
import { makeWorksheet } from '../src/lib/datasets';
import type { Block, Worksheet } from '../src/types';

function run(id: string, sheet: Worksheet, values: Record<string, unknown>) {
  const def = findAnalysis(id);
  if (!def) throw new Error(`missing analysis ${id}`);
  return def.run({ lang: 'en', sheet, values });
}

function textLines(blocks: Block[]): string[] {
  return blocks
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .flatMap((b) => b.lines);
}

/** 2² factorial with two replicates; the interaction is strongly present. */
const cells: [number, number][] = [
  [-1, -1], [-1, -1], [-1, 1], [-1, 1], [1, -1], [1, -1], [1, 1], [1, 1],
];
const sheet = makeWorksheet('Hierarchy', [
  { name: 'A', type: 'numeric', values: cells.map(([a]) => a) },
  { name: 'B', type: 'numeric', values: cells.map(([, b]) => b) },
  { name: 'Y', type: 'numeric', values: cells.map(([a, b]) => 10 + 3 * a + 2 * b + 4 * a * b) },
]);

const base = { response: 'C3', factors: ['C1', 'C2'], order: '2' };

describe('hierarchy modes in a run (WO-3F-04)', () => {
  beforeEach(() => clearModelSettings('doeanalyze'));

  it('strict mode refuses an interaction without its main effects', () => {
    expect(() => run('doeanalyze', sheet, { ...base, terms: ['A|B'], hierarchy: 'strict' }))
      .toThrow(/model\.hierarchyViolation\|terms=.*A.*B/);
  });

  it('auto mode adds the lower terms and reports exactly what it added', () => {
    const result = run('doeanalyze', sheet, { ...base, terms: ['A|B'], hierarchy: 'auto' });
    const notes = textLines(result.blocks);
    expect(notes.some((line) => line.includes('lower-order terms'))).toBe(true);
    expect(notes.join('\n')).toContain('A, B');
    const anova = result.blocks.find((b): b is Extract<Block, { type: 'table' }> => b.type === 'table' && b.title === '@res.anovaTable');
    const sources = anova!.rows.map((row) => String(row[0]));
    expect(sources).toContain('A');
    expect(sources).toContain('B');
    expect(sources).toContain('A×B');
  });

  it('unrestricted mode fits the selection as chosen', () => {
    const result = run('doeanalyze', sheet, { ...base, terms: ['A|B'], hierarchy: 'unrestricted' });
    expect(textLines(result.blocks).some((line) => line.includes('lower-order terms'))).toBe(false);
    const anova = result.blocks.find((b): b is Extract<Block, { type: 'table' }> => b.type === 'table' && b.title === '@res.anovaTable');
    const sources = anova!.rows.map((row) => String(row[0]));
    expect(sources).toContain('A×B');
    expect(sources).not.toContain('A');
  });

  it('persists the selection and the mode for the next run', () => {
    run('doeanalyze', sheet, { ...base, terms: ['A', 'A|B'], hierarchy: 'auto' });
    const saved = loadModelSettings('doeanalyze');
    expect(saved).not.toBeNull();
    expect(saved!.terms).toEqual(['A', 'B', 'A|B']);
    expect(saved!.hierarchy).toBe('auto');
  });

  it('a stored selection from an older factor set falls back to the default model', () => {
    saveModelSettings('doeanalyze', { terms: ['Z|Q'], pooled: [], hierarchy: 'strict', order: 2 });
    const result = run('doeanalyze', sheet, { ...base, terms: ['Z|Q'], hierarchy: 'strict' });
    const anova = result.blocks.find((b): b is Extract<Block, { type: 'table' }> => b.type === 'table' && b.title === '@res.anovaTable');
    expect(anova!.rows.map((row) => String(row[0]))).toContain('A×B');
  });

  it('keeps GLM runs hierarchy-checked too', () => {
    expect(() => run('glm', sheet, { response: 'C3', factors: ['C1', 'C2'], interactions: false, terms: ['A|B'], hierarchy: 'strict' }))
      .toThrow(/model\.hierarchyViolation/);
  });
});

describe('model settings store (WO-3F-02)', () => {
  it('survives a round trip and rejects a corrupted record', () => {
    clearModelSettings('glm');
    expect(loadModelSettings('glm')).toBeNull();
    saveModelSettings('glm', { terms: ['A', 'B'], pooled: ['B'], hierarchy: 'auto', order: 2 });
    expect(loadModelSettings('glm')).toEqual({ terms: ['A', 'B'], pooled: ['B'], hierarchy: 'auto', order: 2 });
    localStorage.setItem('sigrun.modelSettings.v1', '{not json');
    expect(loadModelSettings('glm')).toBeNull();
    clearModelSettings('glm');
  });
});
