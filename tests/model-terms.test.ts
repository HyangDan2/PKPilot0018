import { describe, expect, it } from 'vitest';
import {
  applyHierarchy,
  buildRsmCatalog,
  buildTermCatalog,
  defaultTermIds,
  formulaPreview,
  requiredLowerIds,
  resolveModelSelection,
  termId,
  termName,
  termsFromIds,
} from '../src/lib/modelTerms';
import type { ModelFactor } from '../src/lib/glm';

const factors: ModelFactor[] = [
  { name: 'A', kind: 'categorical', values: [] },
  { name: 'B', kind: 'categorical', values: [] },
  { name: 'C', kind: 'categorical', values: [] },
];

describe('term identity (WO-3F-02)', () => {
  it('identifies a term by its factors, not its display label', () => {
    expect(termId(['A', 'B'])).toBe('A|B');
    expect(termName(['A', 'B'])).toBe('A×B');
    expect(termId(['B', 'A'])).not.toBe(termId(['A', 'B']));
  });

  it('builds every interaction up to the requested order in model order', () => {
    const catalog = buildTermCatalog(factors, 2);
    expect(catalog.terms.map((term) => term.id)).toEqual(['A', 'B', 'C', 'A|B', 'A|C', 'B|C']);
    expect(catalog.terms.map((term) => term.order)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(buildTermCatalog(factors, 3).terms).toHaveLength(7);
  });

  it('defaults to every term the run can fit, mains only without interactions', () => {
    const order3 = buildTermCatalog(factors, 3);
    expect(defaultTermIds(order3, true)).toHaveLength(7);
    expect(defaultTermIds(order3, false)).toEqual(['A', 'B', 'C']);
    // The pre-3F GLM/factorial default: mains and 2-way interactions.
    expect(defaultTermIds(buildTermCatalog(factors, 2), true)).toHaveLength(6);
  });

  it('builds the RSM catalog as mains, squares, then 2-way interactions', () => {
    const catalog = buildRsmCatalog(factors.slice(0, 2));
    expect(catalog.terms.map((term) => term.id)).toEqual(['A', 'B', 'A²', 'B²', 'A|B']);
    expect(catalog.terms[2].name).toBe('A²');
  });

  it('reads terms back from ids without inventing unknown ones', () => {
    const catalog = buildTermCatalog(factors, 2);
    const terms = termsFromIds(catalog, ['B|C', 'A', 'nope']);
    expect(terms.map((term) => term.name)).toEqual(['B×C', 'A']);
  });
});

describe('hierarchy requirements (WO-3F-04)', () => {
  it('requires every lower-order subset', () => {
    const catalog = buildTermCatalog(factors, 3);
    expect(requiredLowerIds(catalog, 'A|B|C').sort()).toEqual(['A', 'A|B', 'A|C', 'B', 'B|C', 'C']);
  });

  it('treats a square factor’s lower term as its linear factor', () => {
    const catalog = buildRsmCatalog(factors.slice(0, 2));
    expect(requiredLowerIds(catalog, 'A²')).toEqual(['A']);
    expect(requiredLowerIds(catalog, 'A|B').sort()).toEqual(['A', 'B']);
  });

  it('strict mode reports violations and changes nothing', () => {
    const catalog = buildTermCatalog(factors, 2);
    const result = applyHierarchy(catalog, ['A|B'], 'strict');
    expect(result.selected).toEqual(['A|B']);
    expect(result.added).toEqual([]);
    expect(result.violations[0].termName).toBe('A×B');
    expect(result.violations[0].missing).toEqual(['A', 'B']);
  });

  it('auto mode adds the missing lower terms in catalog order and reports them', () => {
    const catalog = buildTermCatalog(factors, 2);
    const result = applyHierarchy(catalog, ['A|B'], 'auto');
    expect(result.selected).toEqual(['A', 'B', 'A|B']);
    expect(result.added).toEqual(['A', 'B']);
    expect(result.removed).toEqual([]);
  });

  it('unrestricted mode keeps the model and warns', () => {
    const catalog = buildTermCatalog(factors, 2);
    const result = applyHierarchy(catalog, ['A|B'], 'unrestricted');
    expect(result.selected).toEqual(['A|B']);
    expect(result.warnings).toEqual(['A×B']);
    expect(result.added).toEqual([]);
  });

  it('drops ids the catalog cannot build', () => {
    const catalog = buildTermCatalog(factors, 2);
    expect(applyHierarchy(catalog, ['A', 'X|Y'], 'strict').selected).toEqual(['A']);
  });
});

describe('formula and stored selections', () => {
  it('previews the model formula from stable ids', () => {
    const catalog = buildTermCatalog(factors, 2);
    expect(formulaPreview(catalog, ['A', 'B', 'A|B'])).toBe('Y = β0 + A + B + A×B');
    expect(formulaPreview(catalog, ['A', 'B', 'A|B'], 'Strength')).toBe('Strength = β0 + A + B + A×B');
  });

  it('falls back to the default model when stored ids cannot be built', () => {
    const catalog = buildTermCatalog(factors, 2);
    const resolved = resolveModelSelection(catalog, ['OLD|TERM'], [], 'strict');
    expect(resolved.hierarchy.selected).toEqual(['A', 'B', 'C', 'A|B', 'A|C', 'B|C']);
    expect(resolved.pooled).toEqual([]);
  });

  it('keeps only pooled terms that remain in the model', () => {
    const catalog = buildTermCatalog(factors, 2);
    const resolved = resolveModelSelection(catalog, ['A', 'B'], ['A|B', 'B'], 'strict');
    expect(resolved.terms.map((term) => term.name)).toEqual(['A', 'B']);
    expect(resolved.pooled.map((term) => term.name)).toEqual(['B']);
  });

  it('normalises unknown hierarchy modes to strict', () => {
    const catalog = buildTermCatalog(factors, 2);
    expect(resolveModelSelection(catalog, null, null, 'bogus').mode).toBe('strict');
    expect(resolveModelSelection(catalog, null, null, 'auto').mode).toBe('auto');
  });
});
