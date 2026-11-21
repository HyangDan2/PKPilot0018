import { describe, expect, it } from 'vitest';
import { evaluateFormula, formulaColumns } from '../src/lib/calc';
import type { Worksheet } from '../src/types';

function sheet(): Worksheet {
  return {
    id: 'ws',
    name: 'Test',
    columns: [
      { id: 'C1', name: 'A', type: 'numeric', values: [1, 2, 3] },
      { id: 'C2', name: 'B', type: 'numeric', values: [4, 5, 6] },
      { id: 'C3', name: 'Label', type: 'text', values: ['x', null, 'z'] },
    ],
  };
}

describe('formula parser', () => {
  it('evaluates row-wise arithmetic', () => {
    const out = evaluateFormula('C1 * 2 + 1', sheet());
    expect(out.values).toEqual([3, 5, 7]);
    expect(out.constant).toBe(false);
  });

  it('respects operator precedence and parentheses', () => {
    expect(evaluateFormula('1 + 2 * 3 ^ 2', sheet()).values[0]).toBe(19);
    expect(evaluateFormula('(1 + 2) * 3', sheet()).values[0]).toBe(9);
    expect(evaluateFormula('-C1 + 10', sheet()).values).toEqual([9, 8, 7]);
  });

  it('supports aggregate functions as constants', () => {
    const mean = evaluateFormula('MEAN(C1)', sheet());
    expect(mean.constant).toBe(true);
    expect(mean.values).toEqual([2, 2, 2]);
    expect(evaluateFormula('SUM(C2)', sheet()).values[0]).toBe(15);
    expect(evaluateFormula('STDEV(C2)', sheet()).values[0]).toBeCloseTo(1, 8);
    expect(evaluateFormula('N(C2)', sheet()).values[0]).toBe(3);
    expect(evaluateFormula('MAX(C1) - MIN(C1)', sheet()).values[0]).toBe(2);
  });

  it('supports nested numeric functions', () => {
    const out = evaluateFormula('ROUND(SQRT(C2) + LN(C1), 3)', sheet());
    expect(out.values[0]).toBeCloseTo(2, 3);
    expect(evaluateFormula('ABS(-C1)', sheet()).values).toEqual([1, 2, 3]);
  });

  it('returns null for rows without a result', () => {
    const out = evaluateFormula('1 / (C1 - 1)', sheet());
    expect(out.values[0]).toBeNull();
    expect(out.errors).toBe(1);
  });

  it('throws on unknown columns and malformed input', () => {
    expect(() => evaluateFormula('C9 + 1', sheet())).toThrow('formula.unknownColumn');
    expect(() => evaluateFormula('C1 +', sheet())).toThrow();
    expect(() => evaluateFormula('', sheet())).toThrow('formula.empty');
    expect(() => evaluateFormula('NOPE(C1)', sheet())).toThrow('formula.unknownFunction');
  });

  it('lists the columns a formula refers to', () => {
    expect(formulaColumns('C1 + 2 * C2', sheet())).toEqual(['C1', 'C2']);
  });
});
