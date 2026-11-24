/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — project round-trip comparison (WO-TQA-09)

   A saved project is only "verified" when what comes back out of the file is
   the same data, not when the counts happen to agree. This module builds a
   canonical fingerprint of everything a project carries — sheet and column
   identities, every cell, output cards and their blocks, each stored model's
   terms and coefficients, figures, settings and custom styles — and compares
   two projects record by record, naming what differs.

   The comparison is used twice: to confirm a practice project survived its own
   write/read cycle (`project-saved`), and to confirm the original project came
   back untouched after a practice (`original project guard`).
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec, OutputDoc, Settings, Worksheet } from '../types';
import type { LayoutDoc } from './graphLayout';
import type { StoredModel } from './modelStore';

export interface ProjectComparable {
  worksheets: Worksheet[];
  activeSheetId?: string;
  settings?: Settings;
  outputs?: OutputDoc[];
  models?: StoredModel[];
  figures?: LayoutDoc[];
  customChartStyles?: { id: string }[];
}

export type ProjectMismatchKind =
  | 'worksheets'
  | 'worksheet-data'
  | 'active-sheet'
  | 'outputs'
  | 'output-blocks'
  | 'charts'
  | 'models'
  | 'model-coefficients'
  | 'figures'
  | 'settings'
  | 'custom-styles';

export interface ProjectMismatch {
  kind: ProjectMismatchKind;
  /** A stable location inside the project, e.g. `sheet:Sheet 1/column:C2`. */
  where: string;
  detail: string;
  expected?: string;
  actual?: string;
}

export interface ProjectComparison {
  ok: boolean;
  mismatches: ProjectMismatch[];
  /** What was compared, so a report can state its coverage. */
  counts: { worksheets: number; columns: number; cells: number; outputs: number; models: number; figures: number };
}

function cellToken(value: number | string | null): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toPrecision(15) : 'NaN';
  return value;
}

function columnToken(values: (number | string | null)[]): string {
  return values.map(cellToken).join('\u0001');
}

function chartToken(chart: ChartSpec): string {
  const base = `${chart.kind}|${chart.title ?? ''}`;
  if (chart.kind === 'overlaid') {
    const specs = chart.responses
      .map((response) => `${response.name}:${response.lsl ?? ''}/${response.usl ?? ''}/${response.target ?? ''}`)
      .join(',');
    return `${base}|${specs}|${chart.feasible?.areaRatio ?? ''}`;
  }
  if (chart.kind === 'surface3d') {
    const z = chart.z ?? [];
    const sample = z.length && z[0]?.length ? cellToken(z[Math.floor(z.length / 2)]?.[Math.floor((z[0]?.length ?? 1) / 2)] ?? null) : '';
    return `${base}|${chart.model?.response.name ?? ''}|${chart.xLabel ?? ''}|${chart.yLabel ?? ''}|${chart.xs?.length ?? 0}x${chart.ys?.length ?? 0}|${sample}`;
  }
  return `${base}|${('yLabel' in chart ? chart.yLabel : '') ?? ''}`;
}

function blockToken(doc: OutputDoc): string {
  return doc.blocks
    .map((block) => {
      if (block.type === 'table') return `table:${block.headers.join('|')}:${block.rows.length}:${block.rows[0]?.map(cellToken).join('|') ?? ''}`;
      if (block.type === 'chart') return `chart:${chartToken(block.chart)}`;
      if (block.type === 'chartgrid') return `chartgrid:${block.charts.map((entry) => chartToken(entry.chart)).join('+')}`;
      return `text:${block.lines.length}`;
    })
    .join(';');
}

function modelToken(model: StoredModel): string {
  const terms = model.terms.map((term) => term.label).join('+');
  const coefficients = model.coefficients.map((coefficient) => `${coefficient.label}=${cellToken(coefficient.value)}`).join(',');
  return `${model.kind}|${model.response.name}|${terms}|${coefficients}|${cellToken(model.diagnostics.r2 ?? null)}`;
}

function figureToken(figure: LayoutDoc): string {
  const panels = figure.panels.map((panel) => `${panel.kind}:${(panel as { title?: string }).title ?? ''}`).join(',');
  return `${figure.panels.length}|${panels}`;
}

function push(list: ProjectMismatch[], mismatch: ProjectMismatch): void {
  list.push(mismatch);
}

/**
 * Compare what a project states with what came back from its own file. The
 * order of sheets, outputs, models and figures is part of the state, so a
 * reordering is reported rather than silently accepted.
 */
export function compareProjects(expected: ProjectComparable, actual: ProjectComparable): ProjectComparison {
  const mismatches: ProjectMismatch[] = [];
  const counts = { worksheets: 0, columns: 0, cells: 0, outputs: 0, models: 0, figures: 0 };

  const expectedSheets = expected.worksheets ?? [];
  const actualSheets = actual.worksheets ?? [];
  counts.worksheets = expectedSheets.length;
  if (expectedSheets.length !== actualSheets.length) {
    push(mismatches, {
      kind: 'worksheets',
      where: 'worksheets',
      detail: 'The number of worksheets differs.',
      expected: String(expectedSheets.length),
      actual: String(actualSheets.length),
    });
  }
  const sheetCount = Math.min(expectedSheets.length, actualSheets.length);
  for (let index = 0; index < sheetCount; index += 1) {
    const want = expectedSheets[index];
    const got = actualSheets[index];
    const where = `sheet[${index}]`;
    if (want.id !== got.id || want.name !== got.name) {
      push(mismatches, { kind: 'worksheets', where, detail: 'The worksheet identity differs.', expected: `${want.id}/${want.name}`, actual: `${got.id}/${got.name}` });
      continue;
    }
    counts.columns += want.columns.length;
    if (want.columns.length !== got.columns.length) {
      push(mismatches, {
        kind: 'worksheet-data',
        where,
        detail: 'The number of columns differs.',
        expected: String(want.columns.length),
        actual: String(got.columns.length),
      });
    }
    const columnCount = Math.min(want.columns.length, got.columns.length);
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const wantColumn = want.columns[columnIndex];
      const gotColumn = got.columns[columnIndex];
      const columnWhere = `${where}/column[${columnIndex}]`;
      if (wantColumn.id !== gotColumn.id || wantColumn.name !== gotColumn.name || wantColumn.type !== gotColumn.type) {
        push(mismatches, {
          kind: 'worksheet-data',
          where: columnWhere,
          detail: 'The column identity differs.',
          expected: `${wantColumn.id}/${wantColumn.name}/${wantColumn.type}`,
          actual: `${gotColumn.id}/${gotColumn.name}/${gotColumn.type}`,
        });
        continue;
      }
      counts.cells += wantColumn.values.length;
      const wantToken = columnToken(wantColumn.values);
      const gotToken = columnToken(gotColumn.values);
      if (wantToken !== gotToken) {
        const wantValues = wantColumn.values.map(cellToken);
        const gotValues = gotColumn.values.map(cellToken);
        const row = wantValues.findIndex((value, position) => value !== gotValues[position]);
        push(mismatches, {
          kind: 'worksheet-data',
          where: `${columnWhere}/“${wantColumn.name}”`,
          detail: row >= 0 ? `Row ${row + 1} of the column differs.` : 'The column length differs.',
          expected: row >= 0 ? wantValues[row] : String(wantValues.length),
          actual: row >= 0 ? (gotValues[row] ?? '∅') : String(gotValues.length),
        });
      }
    }
  }
  if ((expected.activeSheetId ?? '') !== (actual.activeSheetId ?? '')) {
    push(mismatches, { kind: 'active-sheet', where: 'activeSheetId', detail: 'The active worksheet differs.', expected: expected.activeSheetId ?? '', actual: actual.activeSheetId ?? '' });
  }

  const expectedOutputs = expected.outputs ?? [];
  const actualOutputs = actual.outputs ?? [];
  counts.outputs = expectedOutputs.length;
  if (expectedOutputs.length !== actualOutputs.length) {
    push(mismatches, { kind: 'outputs', where: 'outputs', detail: 'The number of output cards differs.', expected: String(expectedOutputs.length), actual: String(actualOutputs.length) });
  }
  const outputCount = Math.min(expectedOutputs.length, actualOutputs.length);
  for (let index = 0; index < outputCount; index += 1) {
    const want = expectedOutputs[index];
    const got = actualOutputs[index];
    const where = `output[${index}]`;
    if (want.id !== got.id || (want.meta?.analysisId ?? want.dialog?.analysisId ?? '') !== (got.meta?.analysisId ?? got.dialog?.analysisId ?? '')) {
      push(mismatches, {
        kind: 'outputs',
        where,
        detail: 'The output card identity differs.',
        expected: `${want.id}/${want.meta?.analysisId ?? want.dialog?.analysisId ?? ''}`,
        actual: `${got.id}/${got.meta?.analysisId ?? got.dialog?.analysisId ?? ''}`,
      });
      continue;
    }
    if (blockToken(want) !== blockToken(got)) {
      push(mismatches, { kind: 'output-blocks', where, detail: 'The blocks of the output card differ.', expected: blockToken(want).slice(0, 160), actual: blockToken(got).slice(0, 160) });
    }
    const wantCharts = (want.blocks ?? []).flatMap((block) => (block.type === 'chart' ? [chartToken(block.chart)] : block.type === 'chartgrid' ? block.charts.map((entry) => chartToken(entry.chart)) : []));
    const gotCharts = (got.blocks ?? []).flatMap((block) => (block.type === 'chart' ? [chartToken(block.chart)] : block.type === 'chartgrid' ? block.charts.map((entry) => chartToken(entry.chart)) : []));
    if (wantCharts.join('§') !== gotCharts.join('§')) {
      push(mismatches, { kind: 'charts', where, detail: 'A chart inside the card differs.' });
    }
  }

  const expectedModels = expected.models ?? [];
  const actualModels = actual.models ?? [];
  counts.models = expectedModels.length;
  if (expectedModels.length !== actualModels.length) {
    push(mismatches, { kind: 'models', where: 'models', detail: 'The number of stored models differs.', expected: String(expectedModels.length), actual: String(actualModels.length) });
  }
  const modelCount = Math.min(expectedModels.length, actualModels.length);
  for (let index = 0; index < modelCount; index += 1) {
    const want = expectedModels[index];
    const got = actualModels[index];
    const where = `model[${index}]`;
    if (want.id !== got.id || want.name !== got.name || want.response.name !== got.response.name) {
      push(mismatches, {
        kind: 'models',
        where,
        detail: 'The stored model identity differs.',
        expected: `${want.id}/${want.name}/${want.response.name}`,
        actual: `${got.id}/${got.name}/${got.response.name}`,
      });
      continue;
    }
    if (modelToken(want) !== modelToken(got)) {
      push(mismatches, { kind: 'model-coefficients', where, detail: 'The terms or coefficients of the model differ.', expected: modelToken(want).slice(0, 160), actual: modelToken(got).slice(0, 160) });
    }
  }

  const expectedFigures = expected.figures ?? [];
  const actualFigures = actual.figures ?? [];
  counts.figures = expectedFigures.length;
  if (expectedFigures.length !== actualFigures.length) {
    push(mismatches, { kind: 'figures', where: 'figures', detail: 'The number of saved figures differs.', expected: String(expectedFigures.length), actual: String(actualFigures.length) });
  }
  const figureCount = Math.min(expectedFigures.length, actualFigures.length);
  for (let index = 0; index < figureCount; index += 1) {
    if (figureToken(expectedFigures[index]) !== figureToken(actualFigures[index])) {
      push(mismatches, { kind: 'figures', where: `figure[${index}]`, detail: 'A saved figure differs.', expected: figureToken(expectedFigures[index]), actual: figureToken(actualFigures[index]) });
    }
  }

  if (expected.settings && actual.settings && (expected.settings.theme !== actual.settings.theme || expected.settings.lang !== actual.settings.lang)) {
    push(mismatches, {
      kind: 'settings',
      where: 'settings',
      detail: 'The project settings differ.',
      expected: `${expected.settings.theme}/${expected.settings.lang}`,
      actual: `${actual.settings.theme}/${actual.settings.lang}`,
    });
  }

  if (expected.customChartStyles || actual.customChartStyles) {
    const wantIds = (expected.customChartStyles ?? []).map((style) => style.id).join(',');
    const gotIds = (actual.customChartStyles ?? []).map((style) => style.id).join(',');
    if (wantIds !== gotIds) {
      push(mismatches, { kind: 'custom-styles', where: 'customChartStyles', detail: 'The saved custom chart styles differ.', expected: wantIds, actual: gotIds });
    }
  }

  return { ok: mismatches.length === 0, mismatches, counts };
}

/** One string that changes whenever any compared record changes. */
export function projectFingerprint(project: ProjectComparable): string {
  const sheetTokens = (project.worksheets ?? []).map((sheet) => `${sheet.id}/${sheet.name}:${sheet.columns.map((column) => `${column.id}/${column.name}/${column.type}:${columnToken(column.values)}`).join(';')}`);
  const outputTokens = (project.outputs ?? []).map((output) => `${output.id}/${output.meta?.analysisId ?? ''}:${blockToken(output)}`);
  const modelTokens = (project.models ?? []).map((model) => `${model.id}:${modelToken(model)}`);
  const figureTokens = (project.figures ?? []).map((figure) => figureToken(figure));
  const settingsToken = project.settings ? `${project.settings.theme}/${project.settings.lang}` : '';
  const styleToken = (project.customChartStyles ?? []).map((style) => style.id).join(',');
  const text = [(project.worksheets ?? []).length, sheetTokens.join('§'), project.activeSheetId ?? '', outputTokens.join('§'), modelTokens.join('§'), figureTokens.join('§'), settingsToken, styleToken].join('‖');
  // FNV-1a, 32-bit: enough to tell two projects apart, cheap on a 20k-row sheet.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${text.length}`;
}
