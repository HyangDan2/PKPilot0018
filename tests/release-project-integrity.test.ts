/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — project integrity (WO-FINAL-001 · WO-03, F-REL-05~08/12)

   The round-trip comparison must see the whole project, not its shape: every
   row of every table, every chart data array, the entire 3-D grid, figure
   coordinates, model covariance and residual variance, variable coding, and
   the real attributes of custom styles — at full numeric precision. The
   parser must refuse damaged projects by naming the damage, never by opening
   a silently smaller project.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import type { ChartSpec, OutputDoc, Settings, Worksheet } from '../src/types';
import type { LayoutDoc } from '../src/lib/graphLayout';
import type { StoredModel } from '../src/lib/modelStore';
import type { CustomChartStyle } from '../src/lib/chartStyles';
import { CHART_STYLE_IDS } from '../src/lib/chartStyles';
import { compareProjects, projectFingerprint } from '../src/lib/projectCompare';
import { parseProject, serializeProject, migrateWorksheet, type ProjectState } from '../src/lib/project';

const settings: Settings = { theme: 'light', lang: 'en' };

const worksheet = (): Worksheet => ({
  id: 'W1',
  name: 'Sheet 1',
  columnSeq: 2,
  columns: [
    { id: 'C1', name: 'X', type: 'numeric', description: 'factor', values: [1, 2, 3] },
    { id: 'C2', name: 'Y', type: 'numeric', values: [10.123456789012345, 20, 30] },
  ],
});

const scatter = (): ChartSpec => ({
  kind: 'scatter',
  points: [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 5 }],
  fit: { intercept: 0, slope: 1 },
}) as ChartSpec;

const surface = (): ChartSpec => ({
  kind: 'surface3d',
  xs: [-1, 0, 1],
  ys: [-1, 0, 1],
  z: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
}) as unknown as ChartSpec;

const output = (): OutputDoc => ({
  id: 'o1',
  titleKey: 'an.desc',
  createdAt: 1,
  collapsed: false,
  blocks: [
    { type: 'table', headers: ['Term', 'Coef', 'SE'], rows: [['A', 1.5, 0.2], ['B', 2.5, 0.3], ['C', 3.5, 0.4]] },
    { type: 'chart', chart: scatter() },
    { type: 'chart', chart: surface() },
  ],
});

const model = (): StoredModel => ({
  format: 'sigrun-model',
  version: 1,
  id: 'model-1',
  name: 'Fit',
  kind: 'multiple',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  response: { id: 'C2', name: 'Y', kind: 'numeric', coding: { mode: 'coded', center: 0, halfRange: 1 } },
  predictors: [{ id: 'C1', name: 'X', kind: 'numeric', coding: { mode: 'actual', center: 2, halfRange: 1 } }],
  terms: [{ label: 'Constant', factors: [] }, { label: 'X', factors: ['X'] }],
  coefficients: [
    { label: 'Constant', value: 10.123456789012345, estimable: true },
    { label: 'X', value: -2.5, estimable: true },
  ],
  covariance: [[0.04, 0.001], [0.001, 0.01]],
  residual: { sse: 0.5, df: 8, mse: 0.0625, s: 0.25 },
  dof: { model: 1, residual: 8, total: 9, rank: 2 },
  factorBounds: { X: { min: 1, max: 3 } },
  categoricalLevels: null,
  training: {
    sheetId: 'W1',
    sheetName: 'Sheet 1',
    rows: 3,
    fingerprint: 'abc123',
    columns: [{ id: 'C1', name: 'X', type: 'numeric' }, { id: 'C2', name: 'Y', type: 'numeric' }],
  },
  diagnostics: { n: 3, r2: 0.99, s: 0.25 },
  design: null,
  stationary: null,
  optimal: null,
  source: { analysisId: 'regress', outputId: 'o1' },
}) as StoredModel;

const style = (): CustomChartStyle => ({
  id: 's1',
  name: 'Mine',
  base: CHART_STYLE_IDS[0],
  overrides: { series: ['#111111', '#222222'], axisWidth: 1.2 },
});

const figure = (): LayoutDoc => ({
  format: 'sigrun-layout',
  version: 1,
  page: { preset: 'a4-landscape', widthMm: 297, heightMm: 210, marginMm: 15, background: '#ffffff' },
  grid: { enabled: true, sizeMm: 2 },
  panels: [
    { id: 'p1', kind: 'text', text: 'Figure 1', fontSize: 10, color: '#000000', bold: false, align: 'left', z: 1, x: 10, y: 10, w: 40, h: 10 },
    { id: 'p2', kind: 'rectangle', color: '#ff0000', width: 1, dash: '', fill: '', opacity: 1, z: 2, x: 20, y: 20, w: 30, h: 30 },
  ],
  zSeq: 1,
  idSeq: 2,
}) as LayoutDoc;

const project = () => ({
  worksheets: [worksheet()],
  activeSheetId: 'W1',
  settings,
  outputs: [output()],
  models: [model()],
  figures: [figure()],
  customChartStyles: [style()],
});

function firstMismatch(expected: ReturnType<typeof project>, actual: ReturnType<typeof project>) {
  const comparison = compareProjects(expected, actual);
  return { comparison, mismatch: comparison.mismatches[0] };
}

function chartAt(blocks: OutputDoc['blocks'], index: number): ChartSpec {
  const block = blocks[index];
  if (block.type !== 'chart') throw new Error('expected a chart block');
  return block.chart;
}

/* ── F-REL-05~08: the whole project is compared ───────────────────────── */

describe('project comparison sees every record', () => {
  it('16 — notices a change in the second row of a statistics table', () => {
    const actual = project();
    const table = actual.outputs[0].blocks[0];
    if (table.type !== 'table') throw new Error('table');
    table.rows[1][1] = 2.5001;
    const { comparison, mismatch } = firstMismatch(project(), actual);
    expect(comparison.ok).toBe(false);
    expect(mismatch.kind).toBe('output-blocks');
    expect(mismatch.where).toContain('rows[1]');
  });

  it('17 — notices a change in one chart data array', () => {
    const actual = project();
    const chart = chartAt(actual.outputs[0].blocks, 1);
    if (chart.kind !== 'scatter') throw new Error('scatter');
    chart.points[1].y = 3.0001;
    const { comparison, mismatch } = firstMismatch(project(), actual);
    expect(comparison.ok).toBe(false);
    expect(mismatch.kind).toBe('charts');
    expect(mismatch.where).toContain('points[1].y');
  });

  it('18 — notices a 3-D grid node that is not the centre', () => {
    const actual = project();
    const chart = chartAt(actual.outputs[0].blocks, 2);
    if (chart.kind !== 'surface3d') throw new Error('surface');
    chart.z[2][0] = 7.0001;
    const { comparison, mismatch } = firstMismatch(project(), actual);
    expect(comparison.ok).toBe(false);
    expect(mismatch.kind).toBe('charts');
    expect(mismatch.where).toContain('z[2][0]');
  });

  it('19 — notices a covariance change with every count agreeing', () => {
    const actual = project();
    actual.models[0].covariance![0][1] = 0.002;
    const { comparison, mismatch } = firstMismatch(project(), actual);
    expect(comparison.ok).toBe(false);
    expect(mismatch.where).toContain('covariance[0][1]');
  });

  it('20 — notices a coding or residual-variance change', () => {
    const coding = project();
    coding.models[0].predictors[0].coding = { mode: 'actual', center: 2, halfRange: 0.5 };
    expect(compareProjects(project(), coding).ok).toBe(false);

    const residual = project();
    residual.models[0].residual = { sse: 0.6, df: 8, mse: 0.075, s: 0.2739 };
    const comparison = compareProjects(project(), residual);
    expect(comparison.ok).toBe(false);
    expect(comparison.mismatches[0].where).toContain('residual');
  });

  it('21 — notices a figure coordinate change', () => {
    const actual = project();
    const panel = actual.figures[0].panels[0] as { x: number };
    panel.x = 11;
    const { comparison, mismatch } = firstMismatch(project(), actual);
    expect(comparison.ok).toBe(false);
    expect(mismatch.kind).toBe('figures');
    expect(mismatch.where).toContain('panels[0].x');
  });

  it('22 — notices a custom-style attribute change', () => {
    const actual = project();
    (actual.customChartStyles[0].overrides as Record<string, unknown>).series = ['#111111', '#333333'];
    const { comparison, mismatch } = firstMismatch(project(), actual);
    expect(comparison.ok).toBe(false);
    expect(mismatch.kind).toBe('custom-styles');
    expect(mismatch.where).toContain('overrides.series');
  });

  it('23 — compares numbers at full precision, including the 16th digit', () => {
    const actual = project();
    actual.worksheets[0].columns[1].values[0] = 10.123456789012346;
    const { comparison } = firstMismatch(project(), actual);
    expect(comparison.ok).toBe(false);
    // A toPrecision(15) comparison would call these equal.
    expect((10.123456789012345).toPrecision(15)).toBe((10.123456789012346).toPrecision(15));
  });

  it('23b — the same change hidden by toPrecision(15) is still a mismatch', () => {
    const actual = project();
    actual.worksheets[0].columns[1].values[0] = Number((10.123456789012345).toPrecision(15));
    expect(compareProjects(project(), actual).ok).toBe(false);
  });

  it('keeps null, zero and empty text apart', () => {
    const zero = project();
    zero.worksheets[0].columns[0].values[0] = 0;
    expect(compareProjects(project(), zero).ok).toBe(false);

    const empty = project();
    empty.worksheets[0].columns[0].values[0] = '';
    expect(compareProjects(project(), empty).ok).toBe(false);
  });

  it('preserves array order and ignores object key order', () => {
    const reordered = project();
    const [first, second] = reordered.outputs[0].blocks;
    reordered.outputs[0].blocks = [second, first, reordered.outputs[0].blocks[2]];
    expect(compareProjects(project(), reordered).ok).toBe(false);

    const shuffledKeys = {
      customChartStyles: project().customChartStyles,
      figures: project().figures,
      models: project().models,
      outputs: project().outputs,
      settings: project().settings,
      activeSheetId: project().activeSheetId,
      worksheets: project().worksheets,
    };
    expect(compareProjects(project(), shuffledKeys).ok).toBe(true);
    expect(projectFingerprint(shuffledKeys)).toBe(projectFingerprint(project()));
  });
});

/* ── F-REL-12: schema validation ───────────────────────────────────────── */

function richProjectFile(): Record<string, unknown> {
  return JSON.parse(serializeProject(project() as unknown as ProjectState)) as Record<string, unknown>;
}

function parseFile(mutate: (file: Record<string, unknown>) => void): () => ProjectState {
  const file = richProjectFile();
  mutate(file);
  return () => parseProject(JSON.stringify(file));
}

function outputsOf(file: Record<string, unknown>): Array<Record<string, unknown>> {
  return file.outputs as Array<Record<string, unknown>>;
}

function blocksOf(file: Record<string, unknown>): Array<Record<string, unknown>> {
  return outputsOf(file)[0].blocks as Array<Record<string, unknown>>;
}

function figuresOf(file: Record<string, unknown>): Array<Record<string, unknown>> {
  return file.figures as Array<Record<string, unknown>>;
}

describe('project schema validation', () => {
  it('round-trips the rich project it was given', () => {
    const parsed = parseProject(serializeProject(project() as unknown as ProjectState));
    expect(parsed.models).toHaveLength(1);
    expect(parsed.figures).toHaveLength(1);
    expect(parsed.customChartStyles).toHaveLength(1);
    expect(parsed.worksheets[0].columns[1].values[0]).toBe(10.123456789012345);
    expect(parsed.models?.[0].covariance?.[0][1]).toBe(0.001);
    // A model's fitting range survives the file: the optimiser re-checks it.
    expect(parsed.models?.[0].factorBounds).toEqual({ X: { min: 1, max: 3 } });
    const comparison = compareProjects(project(), parsed);
    expect(comparison.mismatches).toEqual([]);
  });

  it('refuses an unsupported schema version', () => {
    expect(parseFile((file) => { file.version = 3; })).toThrow('file.versionNewer');
  });

  it('refuses an unknown block kind instead of dropping the card', () => {
    expect(parseFile((file) => { blocksOf(file)[0] = { type: 'video', src: 'x' }; })).toThrow('file.outputCorrupt');
  });

  it('refuses a corrupted table row', () => {
    expect(parseFile((file) => {
      (blocksOf(file)[0].rows as unknown[][])[1][1] = { value: 2.5 };
    })).toThrow('file.outputCorrupt');
  });

  it('refuses a ragged 3-D grid', () => {
    expect(parseFile((file) => {
      const chart = blocksOf(file)[2].chart as { z: number[][] };
      chart.z[1] = [4, 5];
    })).toThrow('file.outputCorrupt');
  });

  it('refuses a grid whose axes do not match it', () => {
    expect(parseFile((file) => {
      const chart = blocksOf(file)[2].chart as { xs: number[] };
      chart.xs = [-1, 0];
    })).toThrow('file.outputCorrupt');
  });

  it('refuses a figure panel without a position', () => {
    expect(parseFile((file) => {
      delete (figuresOf(file)[0].panels as Array<Record<string, unknown>>)[0].x;
    })).toThrow('file.figureCorrupt');
  });

  it('refuses duplicate panel ids inside one figure', () => {
    expect(parseFile((file) => {
      const panels = figuresOf(file)[0].panels as Array<Record<string, unknown>>;
      panels[1].id = panels[0].id;
    })).toThrow('file.figureCorrupt');
  });

  it('refuses a chart panel that points at an output card the file does not have', () => {
    expect(parseFile((file) => {
      const panels = figuresOf(file)[0].panels as Array<Record<string, unknown>>;
      panels[0] = {
        id: 'p1', kind: 'chart', z: 1, x: 1, y: 1, w: 30, h: 30,
        source: { outputId: 'missing', blockIndex: 0, chartIndex: 0 },
        caption: '', chart: { kind: 'scatter', points: [] }, raster: false,
      };
    })).toThrow('file.figureCorrupt');
  });

  it('refuses a custom style whose attribute is not a value', () => {
    expect(parseFile((file) => {
      (file.customChartStyles as Array<Record<string, unknown>>)[0].overrides = { series: [{ color: '#333' }] };
    })).toThrow('file.styleCorrupt');
  });

  it('refuses a model whose covariance does not fit its coefficients', () => {
    expect(parseFile((file) => {
      (file.models as Array<Record<string, unknown>>)[0].covariance = [[0.04, 0.001]];
    })).toThrow('file.modelCorrupt');
  });

  it('refuses a model without its terms', () => {
    expect(parseFile((file) => {
      delete (file.models as Array<Record<string, unknown>>)[0].terms;
    })).toThrow('file.modelCorrupt');
  });

  it('refuses a model with a non-finite coefficient', () => {
    // JSON cannot carry NaN, so the file states it as null.
    expect(parseFile((file) => {
      const coefficients = (file.models as Array<Record<string, unknown>>)[0].coefficients as Array<Record<string, unknown>>;
      coefficients[0].value = null;
    })).toThrow('file.modelCorrupt');
  });

  it('keeps an older project opening exactly as before', () => {
    const legacy = {
      format: 'sigrun-project',
      version: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      app: 'HD2Lab Sigrún',
      worksheets: [{ id: 'W1', name: 'Old', columns: [{ id: 'C1', name: 'X', type: 'numeric', values: [1, 2] }] }],
      activeSheetId: 'W1',
      settings: { theme: 'light', lang: 'en' },
    };
    const parsed = parseProject(JSON.stringify(legacy));
    expect(parsed.originalVersion).toBe(1);
    expect(parsed.worksheets[0].columnSeq).toBe(1);
  });

  it('24 — a refused import cannot have touched the current project', () => {
    // parseProject is pure: the refusal carries a code and no state. The caller
    // applies nothing until it resolves, so the open project is untouched.
    const current = project();
    const before = projectFingerprint(current);
    expect(parseFile((file) => { blocksOf(file)[2] = { type: 'chart', chart: { kind: 'surface3d', xs: [], ys: [], z: [] } }; })).toThrow();
    expect(projectFingerprint(current)).toBe(before);
    expect(parseProject(serializeProject(current as unknown as ProjectState)).worksheets[0].columns[1].values[0]).toBe(10.123456789012345);
  });

  it('25 — migrates a version-0 file to the current schema', () => {
    const legacy = {
      format: 'sigrun-project',
      worksheets: [{ id: 'W1', name: 'Legacy', columns: [{ id: 'C3', name: 'X', type: 'numeric', values: [1] }] }],
      settings: { theme: 'light', lang: 'en' },
    };
    const parsed = parseProject(JSON.stringify(legacy));
    expect(parsed.version).toBe(2);
    expect(parsed.originalVersion).toBe(0);
    expect(parsed.activeSheetId).toBe('W1');
    expect(parsed.worksheets[0].columnSeq).toBe(3);
  });

  it('26 — an undefined field and an absent field are the same saved record', () => {
    // A block object built in memory may carry a key whose value is undefined;
    // JSON cannot write that key. The round-trip check must not call the
    // dropped key data loss, while a real value still differs.
    const expected = project();
    const block = expected.outputs[0].blocks[0] as unknown as Record<string, unknown>;
    block.caption = undefined;
    const written = JSON.parse(JSON.stringify(expected));
    expect(compareProjects(expected, written).ok).toBe(true);

    const changed = JSON.parse(JSON.stringify(expected));
    (changed.outputs[0].blocks[0] as Record<string, unknown>).caption = '';
    expect(compareProjects(expected, changed).ok).toBe(false);
  });

  it('27 — the loader’s derived column sequence is not a round-trip difference', () => {
    // A sheet created before the v2 schema has no columnSeq; the loader derives
    // it from the column ids. The save check compares against the sheet as the
    // loader will hand it back, so the derived value is not reported as a loss.
    const live = project();
    delete (live.worksheets[0] as Partial<Worksheet>).columnSeq;
    const parsed = parseProject(serializeProject(live as unknown as ProjectState));
    expect(parsed.worksheets[0].columnSeq).toBe(2);
    expect(compareProjects({ worksheets: live.worksheets }, { worksheets: parsed.worksheets }).ok).toBe(false);
    expect(compareProjects(
      { worksheets: live.worksheets.map(migrateWorksheet) },
      { worksheets: parsed.worksheets },
    ).ok).toBe(true);
  });
});

/* ── the fingerprint is auxiliary, not the verification ───────────────── */

describe('fingerprint is an auxiliary detector', () => {
  it('changes for a 16th-digit edit that a truncated hash could miss', () => {
    const actual = project();
    actual.worksheets[0].columns[1].values[0] = 10.123456789012346;
    expect(projectFingerprint(actual)).not.toBe(projectFingerprint(project()));
    expect(compareProjects(project(), actual).ok).toBe(false);
  });
});
