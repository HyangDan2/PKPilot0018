import { describe, expect, it } from 'vitest';
import { findAnalysis, analysisTermCatalog, runModelSelection } from '../src/lib/analyses';
import { findSample } from '../src/samples/registry';
import { findTutorial } from '../src/tutorials/registry';
import { findPreset, resolvePreset } from '../src/tutorials/presets';
import { validateStep } from '../src/tutorials/validationRegistry';
import type { TutorialEvent, WorkspaceFacts } from '../src/tutorials/types';
import type { Block } from '../src/types';

function table(result: { blocks: Block[] }, title: string): (string | number)[][] {
  const block = result.blocks.find((entry) => entry.type === 'table' && entry.title === title);
  if (!block || block.type !== 'table') throw new Error(`missing table ${title}`);
  return block.rows;
}

function runPreset(id: string, overrides: Record<string, unknown> = {}) {
  const preset = findPreset(id);
  if (!preset) throw new Error(`missing preset ${id}`);
  const sheet = findSample(preset.sampleId)!.build();
  const { values } = resolvePreset(preset, sheet);
  const analysis = findAnalysis(preset.analysisId)!;
  return { sheet, preset, result: analysis.run({ lang: 'en', sheet, values: { ...values, ...overrides } }) };
}

describe('model-control practice samples (WO-3F-09)', () => {
  it('ships four deterministic samples with the columns the lesson names', () => {
    const pooled = findSample('doe-pooled')!.build();
    expect(pooled.columns.map((column) => column.name)).toEqual(['StdOrder', 'RunOrder', 'PtType', 'A', 'B', 'C', 'Y']);
    expect(pooled.columns[0].values).toHaveLength(16);

    const unreplicated = findSample('doe-unreplicated')!.build();
    expect(unreplicated.columns[0].values).toHaveLength(8);

    const unbalanced = findSample('glm-unbalanced')!.build();
    expect(unbalanced.columns.map((column) => column.name)).toEqual(['Machine', 'Shift', 'Strength']);
    const counts = new Map<string, number>();
    unbalanced.columns[0].values.forEach((machine, index) => {
      const key = `${machine}|${unbalanced.columns[1].values[index]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    expect([...counts.values()].sort((a, b) => a - b)).toEqual([3, 3, 4, 4, 5, 5]);

    const screening = findSample('doe-screening')!.build();
    expect(screening.columns[0].values).toHaveLength(8);
    screening.columns[3].values.forEach((a, index) => {
      const b = screening.columns[4].values[index] as number;
      const c = screening.columns[5].values[index] as number;
      const d = screening.columns[6].values[index] as number;
      expect(d).toBe((a as number) * b * c);
    });
  });

  it('pools B×C and shows the comparison with a functioning partial F-test', () => {
    const { result } = runPreset('preset-doeanalyze-pooled', {
      terms: ['A', 'B', 'C', 'A|B', 'A|C', 'B|C', 'A|B|C'],
      pooled: ['B|C'],
    });
    const comparison = table(result, '@res.modelComparison');
    const byMetric = Object.fromEntries(comparison.map((row) => [row[0], row]));
    expect(byMetric['Error df']).toEqual(['Error df', '8', '9', '+1']);
    expect(byMetric['Error MS']).toEqual(['Error MS', '0.3033', '0.3394', '+0.0361']);
    expect(byMetric['R²(pred)']?.[1]).toBe('98.55%');
    expect(byMetric['R²(pred)']?.[2]).toBe('98.55%');

    const partial = table(result, '@res.partialF');
    expect(partial[0]).toEqual(['DF (added / error)', '1 / 9']);
    expect(partial[1][1]).toBe('1.85');
    expect(partial[2][1]).toBe('0.207');

    const pooled = table(result, '@res.errorPooling');
    expect(pooled[0][0]).toBe('B×C');
    const checks = table(result, '@res.poolingChecks');
    expect(checks.map((row) => row[0])).toEqual(['DFE expected / actual', 'SSE expected / actual', 'Same rows', 'Additive']);
    expect(checks.find((row) => row[0] === 'Additive')?.[1]).toBe('✓');
    expect(result.blocks.some((block) => block.type === 'text' && block.lines.some((line) => line === 'Model formula: Y = β0 + A + B + C + A×B + A×C + A×B×C'))).toBe(true);
  });

  it('reports the saturated fit with Lenth instead of t-tests', () => {
    const { result } = runPreset('preset-doeanalyze-unreplicated');
    const lenth = table(result, '@res.lenth');
    expect(lenth[0]).toEqual(['A', '12', '12', 'active']);
    expect(lenth.filter((row) => row[3] === 'active')).toHaveLength(1);
    const caption = result.blocks.find((block) => block.type === 'text' && block.lines.some((line) => line.startsWith('PSE ')));
    // Lenth (1989): m = 7 -> d = 7/3, t(0.975, 7/3) = 3.764123 -> ME = 2.1 * 3.764123 = 7.905
    // (ADD-01: previous test pinned buggy floor(7/3)=2 -> ME 9.036.)
    expect(caption && caption.type === 'text' ? caption.lines.join(' ') : '').toContain('PSE 2.1 · ME 7.905');
    expect(result.blocks.some((block) => block.type === 'text' && block.lines.some((line) => line.includes('Error DF is 0')))).toBe(true);
  });

  it('shows an undefined R²(adj) as a dash, never as NaN%', () => {
    const { result } = runPreset('preset-doeanalyze-unreplicated');
    const summary = Object.fromEntries(table(result, '@res.modelSummary').map((row) => [row[0], row[1]]));
    // With error df 0 the adjusted R² has no value; the table must say so.
    expect(summary['R²(adj)']).toBe('—');
    expect(JSON.stringify(result.blocks)).not.toContain('NaN');
  });

  it('separates Type I and Type III sums of squares in the unbalanced study', () => {
    const { result } = runPreset('preset-glm-unbalanced');
    const anova = table(result, '@res.anovaTable');
    const machine = anova.find((row) => row[0] === 'Machine')!;
    expect(machine[2]).toBe('82.083');
    expect(machine[3]).toBe('68.511');
    const shift = anova.find((row) => row[0] === 'Shift')!;
    expect(shift[2]).toBe('23.675');
    expect(shift[3]).toBe('23.045');
  });

  it('lets strict hierarchy refuse an orphan interaction and auto add its parents', () => {
    const sheet = findSample('doe-screening')!.build();
    const values = {
      response: sheet.columns[7].id,
      factors: [3, 4, 5, 6].map((index) => sheet.columns[index].id),
      order: '2',
    };
    expect(() => runModelSelection('doeanalyze', sheet, { ...values, terms: ['A|B'], hierarchy: 'strict' }))
      .toThrow('model.hierarchyViolation|terms=A, B');
    const auto = runModelSelection('doeanalyze', sheet, { ...values, terms: ['A|B'], hierarchy: 'auto' });
    expect(auto.terms.map((term) => term.name)).toEqual(expect.arrayContaining(['A', 'B', 'A×B']));
    const catalog = analysisTermCatalog('doeanalyze', sheet, values)!;
    expect(catalog.terms.map((term) => term.id)).toEqual(expect.arrayContaining(['A|B', 'B|C']));
  });

  it('validates the newly loaded sample when an earlier worksheet has the same columns', () => {
    const pooled = findSample('doe-pooled')!.build();
    const unreplicated = findSample('doe-unreplicated')!.build();
    const events: TutorialEvent[] = [
      { id: 'load-pooled', type: 'sample-loaded', at: 1, payload: { sampleId: 'doe-pooled', sheetId: pooled.id } },
      { id: 'load-unreplicated', type: 'sample-loaded', at: 2, payload: { sampleId: 'doe-unreplicated', sheetId: unreplicated.id } },
    ];
    const facts: WorkspaceFacts = {
      worksheets: [pooled, unreplicated],
      activeSheetId: unreplicated.id,
      outputs: [],
      models: [],
      figures: [],
      events,
      practice: null,
    };
    const outcome = validateStep({ kind: 'sample-loaded', sampleId: 'doe-unreplicated', columns: ['A', 'B', 'C', 'Y'] }, facts);
    expect(outcome.status).toBe('pass');
    expect(outcome.evidence?.sheetId).toBe(unreplicated.id);
  });

  it('ships the ten-step reduction tutorial over the four samples', () => {
    const tutorial = findTutorial('tutorial-doe-reduction-001')!;
    expect(tutorial.steps).toHaveLength(10);
    expect(tutorial.sampleIds).toEqual(['doe-pooled', 'doe-unreplicated', 'glm-unbalanced', 'doe-screening']);
    expect(tutorial.helpIds).toEqual(expect.arrayContaining(['error-pooling', 'unreplicated-designs', 'model-hierarchy']));
    expect(tutorial.nextTutorialId).toBe('tutorial-rsm-001');
  });
});
