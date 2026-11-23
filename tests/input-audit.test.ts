import { describe, expect, it } from 'vitest';
import { ANALYSES, findAnalysis } from '../src/lib/analyses';
import { DATASETS, makeWorksheet } from '../src/lib/datasets';
import { DICT } from '../src/lib/i18n';
import type { Block, Worksheet } from '../src/types';

/* Stage 2 — analysis input-variable audit.
   Every registered analysis is run from one auditable fixture, then probed for
   the mistakes a dialog can let through: an empty required slot, a text or date
   column where a number is needed, a repeated column, a legacy bare-string list.
   A run may refuse such input with a message, but it may never crash or quietly
   return a table of NaN. */

const N = 24;
const A = Array.from({ length: N }, (_, i) => 40 + ((i * 7) % 13) + i * 0.1);
const B = A.map((v, i) => 2.2 * v + ((i % 5) - 2) * 0.8);
const C = Array.from({ length: N }, (_, i) => 5 + ((i * 11) % 17));
const D: (number | null)[] = A.map((v, i) => (i % 6 === 3 ? null : v * 0.5 + 1));
const E = Array.from({ length: N }, () => 5);
const F = Array.from({ length: N }, (_, i) => 1 + ((i * 3) % 9));
const G = Array.from({ length: N }, (_, i) => 2 + (i % 5));
const H = Array.from({ length: N }, (_, i) => 48 + (i % 3));
const TXT = Array.from({ length: N }, (_, i) => (i % 2 ? 'Line A' : 'Line B'));
const MACH = Array.from({ length: N }, (_, i) => `M${(i % 3) + 1}`);
const DATE = Array.from({ length: N }, (_, i) => `2026-03-${String((i % 28) + 1).padStart(2, '0')}`);
const SHORT = [1, 2, 3];

function auditSheet(): Worksheet {
  return makeWorksheet('audit', [
    { name: 'Measure', type: 'numeric', values: A },
    { name: 'Paired', type: 'numeric', values: B },
    { name: 'Other', type: 'numeric', values: C },
    { name: 'Gappy', type: 'numeric', values: D },
    { name: 'Flat', type: 'numeric', values: E },
    { name: 'Positive', type: 'numeric', values: F },
    { name: 'Defects', type: 'numeric', values: G },
    { name: 'LotSize', type: 'numeric', values: H },
    { name: 'Line', type: 'text', values: TXT },
    { name: 'Machine', type: 'text', values: MACH },
    { name: 'Date', type: 'date', values: DATE },
    { name: 'Short', type: 'numeric', values: SHORT },
  ]);
}

function sample(id: string): Worksheet {
  return DATASETS.find((d) => d.id === id)!.build();
}

interface Case {
  id: string;
  values: Record<string, unknown>;
  sheet?: string;
  /** numeric-only slots: a text column must be refused, not plotted */
  numeric?: string[];
}

const CASES: Case[] = [
  { id: 'desc', values: { variables: ['C1', 'C2'], by: ['C9'] }, numeric: ['variables'] },
  { id: 'normality', values: { variable: 'C1' }, numeric: ['variable'] },
  { id: 't1', values: { variable: 'C1', hypMean: 45, confidence: 95, alternative: 'two-sided', chart: true }, numeric: ['variable'] },
  { id: 't2', values: { sample1: 'C1', sample2: 'C2', confidence: 95, alternative: 'two-sided', welch: true, chart: false }, numeric: ['sample1', 'sample2'] },
  { id: 'paired', values: { first: 'C1', second: 'C2', testDiff: 0, confidence: 95, alternative: 'two-sided', chart: false }, numeric: ['first', 'second'] },
  { id: 'anova', values: { response: 'C1', factor: 'C9', confidence: 95 }, numeric: ['response'] },
  { id: 'regression', values: { response: 'C1', predictors: ['C2', 'C3'], fourInOne: false }, numeric: ['response', 'predictors'] },
  { id: 'imr', values: { variable: 'C1' }, numeric: ['variable'] },
  { id: 'xbarr', values: { variable: 'C1', subgroup: 4 }, numeric: ['variable'] },
  { id: 'pchart', values: { defects: 'C7', sizes: 'C8', sampleSize: 50 }, numeric: ['defects', 'sizes'] },
  { id: 'capability', values: { variable: 'C1', lsl: '40', usl: '60', target: '50', sigmaMethod: 'z_bench_shift', subgroup: 4 }, numeric: ['variable'] },
  { id: 'pareto', values: { category: 'C9' } },
  { id: 'histogram', values: { variable: 'C1', bins: 8, lsl: '', usl: '', target: '', normal: true }, numeric: ['variable'] },
  { id: 'boxplot', values: { variables: ['C1', 'C2'], by: ['C9'] }, numeric: ['variables'] },
  { id: 'scatter', values: { y: ['C1'], x: ['C2', 'C3'], by: [], mode: 'each', layout: 'individual', fit: true, stats: true }, numeric: ['y', 'x'] },
  { id: 'timeseries', values: { variable: 'C1', lsl: '40', usl: '60', target: '' }, numeric: ['variable'] },
  { id: 'calculator', values: { formula: 'C1 * 2', storeIn: 'Calc' } },
  { id: 'random', values: { distribution: 'normal', count: 12, mean: 0, sd: 1, min: 0, max: 10, seed: 7, storeIn: 'Rand' } },
  { id: 'sort', values: { column: 'C1', descending: false } },
  { id: 'standardize', values: { column: 'C1', storeIn: 'Std' }, numeric: ['column'] },
  { id: 'recode', values: { column: 'C1', mapping: '40=1, 50=2', fallback: '', storeIn: 'Rec' }, numeric: ['column'] },
  { id: 'gagerr', sheet: 'gagerr', values: { part: 'C1', operator: 'C2', measurement: 'C3', type: 'crossed', tolerance: '', studyVar: 6, poolInteraction: false, confidence: 95 }, numeric: ['measurement'] },
  { id: 'sixpack', values: { variable: 'C1', subgroup: 4, lsl: '40', usl: '60', target: '', sigmaMethod: 'z_bench_shift' }, numeric: ['variable'] },
  { id: 'capnonnormal', values: { variable: 'C6', distribution: 'weibull', lsl: '1', usl: '9' }, numeric: ['variable'] },
  { id: 'xbars', values: { variable: 'C1', subgroup: 4, groups: 'C10' }, numeric: ['variable'] },
  { id: 'npchart', values: { defectives: 'C7', sampleSize: 50 }, numeric: ['defectives'] },
  { id: 'cchart', values: { defects: 'C7' }, numeric: ['defects'] },
  { id: 'uchart', values: { defects: 'C7', unitSizes: 'C8', unitSize: 50 }, numeric: ['defects', 'unitSizes'] },
  { id: 'glm', values: { response: 'C1', factors: ['C9', 'C10'], interactions: true, confidence: 95 }, numeric: ['response'] },
  { id: 'doecreate', values: { factors: 3, replicates: 2, centers: 2, randomize: false, seed: 1 } },
  { id: 'doeanalyze', sheet: 'doe', values: { response: 'C7', factors: ['C4', 'C5', 'C6'], order: 'std' }, numeric: ['response', 'factors'] },
  { id: 'rsmcreate', values: { design: 'ccd', factors: 2, centers: 2, randomize: false, seed: 1 } },
  { id: 'rsmanalyze', sheet: 'rsm', values: { response: 'C6', factors: ['C4', 'C5'] }, numeric: ['response', 'factors'] },
  { id: 'weibull', sheet: 'weibull', values: { time: 'C1', censor: 'C2', censorCode: '1', confidence: 95 }, numeric: ['time'] },
  { id: 'power1t', values: { solveFor: 'power', difference: '1.5', sd: 4, n: '20', power: '80', alpha: 0.05, alternative: 'two-sided' } },
  { id: 'power2t', values: { solveFor: 'power', difference: '1.5', sd: 4, n: '20', power: '80', alpha: 0.05, alternative: 'two-sided' } },
  { id: 'powerpaired', values: { solveFor: 'power', difference: '1.5', sd: 4, n: '20', power: '80', alpha: 0.05, alternative: 'two-sided' } },
  { id: 'poweranova', values: { solveFor: 'power', difference: '1.5', sd: 4, groups: 3, n: '20', power: '80', alpha: 0.05 } },
  { id: 'powerprop1', values: { solveFor: 'power', p1: 0.1, p2: 0.2, n: '100', power: '80', alpha: 0.05, alternative: 'two-sided' } },
  { id: 'powerprop2', values: { solveFor: 'power', p1: 0.1, p2: 0.2, n: '40', power: '80', alpha: 0.05, alternative: 'two-sided' } },
];

const TEXT_REF = 'C9';
const DATE_REF = 'C11';

function defOf(id: string) {
  const def = findAnalysis(id);
  if (!def) throw new Error(`missing ${id}`);
  return def;
}

function runCase(c: Case, overrides?: Record<string, unknown>) {
  const def = defOf(c.id);
  const sheet = c.sheet ? sample(c.sheet) : auditSheet();
  return def.run({ lang: 'en', sheet, values: { ...c.values, ...(overrides ?? {}) } });
}

/** Every error a run raises has to be an interface message, not a JS crash. */
function expectMessage(fn: () => unknown) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected the run to refuse this input').toBeInstanceOf(Error);
  const message = (caught as Error).message;
  const key = message.split('|')[0];
  expect(key).toMatch(/^[a-zA-Z][\w.]*$/);
  expect(DICT.en[key], `no message for ${message}`).toBeTruthy();
  expect(DICT.ko[key], `no Korean message for ${message}`).toBeTruthy();
}

describe('input audit — registry covers every documented analysis', () => {
  it('has an audited case for each registered analysis', () => {
    const registered = ANALYSES.map((d) => d.id).sort();
    const audited = CASES.map((c) => c.id).sort();
    expect(audited).toEqual(registered);
  });

  it('labels every slot in both languages', () => {
    ANALYSES.forEach((def) => {
      def.slots.forEach((slot) => {
        expect(DICT.en[slot.label], `${def.id}.${slot.key} en label`).toBeTruthy();
        expect(DICT.ko[slot.label], `${def.id}.${slot.key} ko label`).toBeTruthy();
      });
      expect(DICT.en[def.titleKey]).toBeTruthy();
      expect(DICT.ko[def.titleKey]).toBeTruthy();
    });
  });
});

describe('input audit — every analysis runs from the audit fixture', () => {
  CASES.forEach((c) => {
    it(`${c.id} produces output`, () => {
      const result = runCase(c);
      const touched = result.blocks.length > 0 || result.newSheet || result.sheetPatch;
      expect(Boolean(touched), `${c.id} returned nothing`).toBe(true);
      const text = JSON.stringify(result.blocks);
      expect(text.includes('NaN') && !text.includes('NaN%'), `${c.id} printed NaN`).toBe(false);
    });
  });
});

describe('input audit — a required slot cannot be left empty', () => {
  CASES.forEach((c) => {
    const def = defOf(c.id);
    def.slots.filter((slot) => slot.required).forEach((slot) => {
      it(`${c.id}: ${slot.key} is required`, () => {
        const empty = slot.kind === 'vars' ? [] : '';
        expectMessage(() => runCase(c, { [slot.key]: empty }));
      });
    });
  });
});

describe('input audit — numeric slots refuse text and date columns', () => {
  CASES.forEach((c) => {
    (c.numeric ?? []).forEach((key) => {
      const slot = defOf(c.id).slots.find((s) => s.key === key);
      const isList = slot?.kind === 'vars';
      it(`${c.id}: ${key} refuses text`, () => {
        expectMessage(() => runCase(c, { [key]: isList ? [TEXT_REF] : TEXT_REF }));
      });
      it(`${c.id}: ${key} refuses a date`, () => {
        expectMessage(() => runCase(c, { [key]: isList ? [DATE_REF] : DATE_REF }));
      });
    });
  });
});

describe('input audit — list slots survive the values a project file can hold', () => {
  it('accepts a list slot saved as a bare string', () => {
    CASES.forEach((c) => {
      defOf(c.id).slots.filter((slot) => slot.kind === 'vars').forEach((slot) => {
        const current = c.values[slot.key];
        const single = Array.isArray(current) && current.length ? current[0] : 'C1';
        const def = defOf(c.id);
        const sheet = c.sheet ? sample(c.sheet) : auditSheet();
        // Either it runs with the one column the string names, or it refuses the
        // input with a message — never a crash on `.map` of a string.
        try {
          def.run({ lang: 'en', sheet, values: { ...c.values, [slot.key]: single } });
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message.split('|')[0]).toMatch(/^[a-zA-Z][\w.]*$/);
        }
      });
    });
  });

  it('never repeats a column inside one list slot', () => {
    const sheet = auditSheet();
    CASES.forEach((c) => {
      if (c.sheet) return;
      defOf(c.id).slots.filter((slot) => slot.kind === 'vars').forEach((slot) => {
        const current = c.values[slot.key];
        if (!Array.isArray(current) || !current.length) return;
        const doubled = [...current, current[0]];
        try {
          defOf(c.id).run({ lang: 'en', sheet, values: { ...c.values, [slot.key]: doubled } });
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message.split('|')[0]).toMatch(/^[a-zA-Z][\w.]*$/);
        }
      });
    });
  });
});

describe('input audit — slots are wired to the run', () => {
  /** Each optional column slot has to change the output when it is filled. */
  const WRIRED: { id: string; key: string; value: unknown }[] = [
    { id: 'pchart', key: 'sizes', value: 'C8' },
    { id: 'uchart', key: 'unitSizes', value: 'C8' },
    { id: 'xbars', key: 'groups', value: 'C10' },
    { id: 'desc', key: 'by', value: ['C10'] },
    { id: 'boxplot', key: 'by', value: ['C10'] },
    { id: 'scatter', key: 'by', value: ['C10'] },
  ];

  WRIRED.forEach((probe) => {
    it(`${probe.id}.${probe.key} changes the result`, () => {
      const c = CASES.find((entry) => entry.id === probe.id)!;
      const def = defOf(probe.id);
      const sheet = c.sheet ? sample(c.sheet) : auditSheet();
      const off = def.run({ lang: 'en', sheet, values: { ...c.values, [probe.key]: '' } });
      const on = def.run({ lang: 'en', sheet, values: { ...c.values, [probe.key]: probe.value } });
      expect(JSON.stringify(on.blocks)).not.toEqual(JSON.stringify(off.blocks));
    });
  });

  it('weibull.censor splits failures from right-censored rows', () => {
    // The shipped sample has no censored row, so the probe brings its own data.
    const times = Array.from({ length: 20 }, (_, i) => 10 + i * 3);
    const censored = times.map((_, i) => (i % 4 === 0 ? 1 : 0));
    const life = makeWorksheet('Life', [
      { name: 'Time', type: 'numeric', values: times },
      { name: 'Censored', type: 'numeric', values: censored },
    ]);
    const def = defOf('weibull');
    const off = def.run({ lang: 'en', sheet: life, values: { time: 'C1', censor: '', censorCode: '1', confidence: 95 } });
    const on = def.run({ lang: 'en', sheet: life, values: { time: 'C1', censor: 'C2', censorCode: '1', confidence: 95 } });
    expect(JSON.stringify(on.blocks)).not.toEqual(JSON.stringify(off.blocks));
    expect(JSON.stringify(on.blocks)).toContain('5 right-censored');
  });
});

describe('input audit — a short column is refused or answered, never half-printed', () => {
  const numericCases = CASES.filter((c) => (c.numeric ?? []).length);
  numericCases.forEach((c) => {
    (c.numeric ?? []).forEach((key) => {
      const slot = defOf(c.id).slots.find((s) => s.key === key)!;
      it(`${c.id}: ${key} with a 3-row column`, () => {
        const def = defOf(c.id);
        const sheet = c.sheet ? sample(c.sheet) : auditSheet();
        const value = slot.kind === 'vars' ? ['C12'] : 'C12';
        let caught: unknown;
        try {
          def.run({ lang: 'en', sheet, values: { ...c.values, [key]: value } });
        } catch (error) {
          caught = error;
        }
        if (caught) {
          // Either an interface key, or a sentence the validator already wrote
          // in the user's language ("Sample 4: the value is not a number").
          // Never a JS crash.
          const message = (caught as Error).message;
          expect(message.length).toBeGreaterThan(0);
          expect(message).not.toMatch(/is not a function|Cannot read|undefined is not|null is not|Cannot convert/);
        } else {
          // Plotting three points is allowed; a table cell of NaN is not.
          const result = def.run({ lang: 'en', sheet, values: { ...c.values, [key]: value } });
          (result.blocks as Block[]).filter((b) => b.type === 'table').forEach((block) => {
            const table = block as Extract<Block, { type: 'table' }>;
            table.rows.forEach((row) => row.forEach((cell) => {
              expect(cell === null || cell === undefined, `null cell in ${c.id}`).toBe(false);
              expect(String(cell)).not.toBe('NaN');
            }));
          });
        }
      });
    });
  });
});
