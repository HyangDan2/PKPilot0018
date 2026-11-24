/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — project files (.sigrun.json) and CSV interchange
   Legacy .mpx.json projects still load; Minitab's native binary .mpx is
   explicitly rejected with an explanation.
   ───────────────────────────────────────────────────────────────────────── */

import type { Column, ColType, ProjectFile, Settings, OutputDoc, StoredModelFileEntry, Worksheet } from '../types';
import { PRODUCT } from '../config/product';
import { CHART_STYLE_IDS, type CustomChartStyle } from './chartStyles';
import { parseStoredModels, type StoredModel } from './modelStore';

import { basisAvailability } from './feasible';
import type { FeasibleBasis } from './chartConfig';
import type { ChartSpec } from '../types';
import type { LayoutDoc } from './graphLayout';

import { makeWorksheet, uid } from './datasets';

/** Schema version this build writes. */
export const CURRENT_PROJECT_VERSION = 2;
/** The oldest schema still read: 1 written by Phase 1/2, 0 = legacy .mpx.json. */
export const OLDEST_PROJECT_VERSION = 0;

export interface ProjectState {
  /** Schema version the restored project conforms to (after migration). */
  version?: number;
  /** The version the file itself stated (0 for a legacy .mpx.json). */
  originalVersion?: number;
  worksheets: Worksheet[];
  activeSheetId: string;
  settings: Settings;
  outputs: OutputDoc[];
  /** Optional: user chart styles saved with the project. */
  customChartStyles?: CustomChartStyle[];
  /** Optional: stored fitted models saved with the project. */
  models?: StoredModel[];
  /** Optional: figure layouts saved with the project. */
  figures?: LayoutDoc[];
}

export function buildProject(state: ProjectState): ProjectFile {
  return {
    format: 'sigrun-project',
    version: CURRENT_PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    app: PRODUCT.APP_NAME,
    worksheets: state.worksheets,
    activeSheetId: state.activeSheetId,
    settings: state.settings,
    outputs: state.outputs,
    ...(state.customChartStyles?.length ? { customChartStyles: state.customChartStyles } : {}),
    ...(state.models?.length ? { models: state.models as unknown as StoredModelFileEntry[] } : {}),
    ...(state.figures?.length ? { figures: state.figures as unknown as Record<string, unknown>[] } : {}),
  };
}

export function serializeProject(state: ProjectState): string {
  return JSON.stringify(buildProject(state), null, 2);
}

export function projectFileName(date = new Date()): string {
  // The file name follows the user's own calendar day, not UTC: at 08:00 in
  // Seoul a UTC stamp would still name yesterday's project.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${PRODUCT.EXPORT_FILE_PREFIX}-${y}-${m}-${d}.sigrun.json`;
}

/** The picker accepts new, legacy and plain JSON projects, plus a native .mpx
 *  so the file can be rejected with a readable explanation instead of failing
 *  silently outside the picker. */
export const PROJECT_ACCEPT = '.sigrun.json,.mpx.json,.json,.mpx,application/json';

/** Minitab's native project is a ZIP/binary container, not our JSON text. */
export function looksLikeMinitabBinary(name: string, head: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.mpx')) return true;
  return head.startsWith('PK\u0003\u0004') || head.startsWith('\u0000\u0000') || head.startsWith('MPX');
}

function isColumn(value: unknown): value is Column {
  if (!value || typeof value !== 'object') return false;
  const col = value as Partial<Column>;
  return typeof col.id === 'string' && typeof col.name === 'string' && Array.isArray(col.values) &&
    (col.type === 'numeric' || col.type === 'text' || col.type === 'date');
}

/**
 * A restored overlaid card must not keep a region computed under a basis its
 * models cannot answer. When the saved basis is unsupported the chart is
 * returned with a structured error and no region, instead of presenting a
 * mean-based picture under a "confidence interval" label.
 */
function restoreChartBasis(chart: ChartSpec): ChartSpec {
  if (chart.kind !== 'overlaid') return chart;
  const models = chart.models ?? [];
  const basis = (chart.feasible?.basis ?? chart.config?.feasible?.basis ?? 'mean') as FeasibleBasis;
  if (!models.length || basis === 'mean') return chart;
  const availability = basisAvailability(models, basis);
  if (availability.ok) return chart;
  return {
    ...chart,
    feasible: {
      mask: [],
      areaRatio: 0,
      nodeRatio: 0,
      feasibleNodes: 0,
      totalNodes: 0,
      basis,
      convergenceDelta: 0,
      perResponse: [],
      intervalBlocked: availability.blocked.map((entry) => entry.model),
      intervalBlockReasons: availability.blocked,
      error: { code: 'feasible.basisUnsupported', blocked: availability.blocked },
    },
  };
}

function restoreOutput(output: OutputDoc): OutputDoc {
  if (!output || !Array.isArray(output.blocks)) return output;
  let changed = false;
  const blocks = output.blocks.map((block) => {
    if (block.type !== 'chart' || !block.chart) return block;
    const next = restoreChartBasis(block.chart);
    if (next === block.chart) return block;
    changed = true;
    return { ...block, chart: next };
  });
  return changed ? { ...output, blocks } : output;
}

/**
 * Why one worksheet cannot be restored (null when it can).
 *
 * A sheet whose columns are not columns, or whose two columns share one id, is
 * not a sheet this build can hold: restoring the rest of the file around it
 * would silently delete the reader's data, so the restore stops and says so.
 */
function worksheetProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'worksheet';
  const sheet = value as Partial<Worksheet>;
  if (typeof sheet.id !== 'string' || !sheet.id) return 'worksheet.id';
  if (typeof sheet.name !== 'string') return 'worksheet.name';
  if (sheet.columnSeq !== undefined && (!Number.isInteger(sheet.columnSeq) || (sheet.columnSeq as number) < 0)) return 'worksheet.columnSeq';
  if (!Array.isArray(sheet.columns)) return 'worksheet.columns';
  const ids = new Set<string>();
  for (const column of sheet.columns) {
    const candidate = column as Partial<Column>;
    if (!isColumn(column)) return 'worksheet.column';
    if (candidate.description !== undefined && typeof candidate.description !== 'string') return 'worksheet.column';
    // A cell may be a number, text, a date or empty; anything else (an array, an
    // object) is a value no analysis can read.
    if (!(candidate.values ?? []).every((cell) => cell === null || typeof cell === 'number' || typeof cell === 'string')) return 'worksheet.value';
    if (ids.has(candidate.id as string)) return 'worksheet.columnId';
    ids.add(candidate.id as string);
  }
  return null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'number');

/** A point list `{x, y}`: both coordinates must be real numbers. */
function isPointList(value: unknown): boolean {
  return Array.isArray(value) && value.every((point) => isPlainObject(point) && Number.isFinite(point.x) && Number.isFinite(point.y));
}

/** A numeric grid with a consistent row width and at least one cell. */
function isGrid(value: unknown): boolean {
  if (!Array.isArray(value) || !value.length) return false;
  const width = (value[0] as unknown[])?.length;
  if (!width) return false;
  return value.every((row) => Array.isArray(row) && row.length === width && row.every((entry) => typeof entry === 'number'));
}

/** The chart kinds this build can draw; anything else would render as nothing. */
const CHART_KINDS = new Set([
  'histogram', 'line', 'bar', 'contour', 'probplot', 'boxplot', 'scatter',
  'timeseries', 'normalprob', 'control', 'pareto', 'capability', 'surface3d',
  'overlaid', 'interval',
]);

/**
 * The data a chart carries, validated by kind (F-REL-12).
 *
 * Only the arrays the renderer reads are checked for shape and type; optional
 * presentation fields stay optional. A grid must be rectangular and match its
 * axes, because a ragged surface would be drawn from different cells than the
 * file states.
 */
function chartProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'output.chart';
  const kind = value.kind;
  if (typeof kind !== 'string' || !CHART_KINDS.has(kind)) return 'output.chart.kind';
  switch (kind) {
    case 'histogram':
      if (!isNumberArray(value.values)) return 'output.chart.values';
      if (value.rows !== undefined && !(Array.isArray(value.rows) && value.rows.every((row) => row === null || Number.isFinite(row)))) return 'output.chart.rows';
      return null;
    case 'timeseries':
      if (!isNumberArray(value.values)) return 'output.chart.values';
      return null;
    case 'line':
      if (!Array.isArray(value.series) || !value.series.length) return 'output.chart.series';
      for (const series of value.series) {
        if (!isPlainObject(series) || !isPointList(series.points)) return 'output.chart.series';
      }
      return null;
    case 'bar':
      if (!Array.isArray(value.items) || value.items.some((item) => !isPlainObject(item) || typeof item.label !== 'string' || !Number.isFinite(item.value))) return 'output.chart.items';
      if (value.groups !== undefined && !(Array.isArray(value.groups) && value.groups.every((group) => isPlainObject(group) && isNumberArray(group.values)))) return 'output.chart.groups';
      return null;
    case 'contour':
    case 'surface3d':
      if (!isNumberArray(value.xs) || !isNumberArray(value.ys)) return 'output.chart.axes';
      if (!isGrid(value.z)) return 'output.chart.grid';
      if ((value.z as unknown[]).length !== (value.ys as unknown[]).length) return 'output.chart.grid';
      if ((value.z as unknown[][]).some((row) => row.length !== (value.xs as unknown[]).length)) return 'output.chart.grid';
      return null;
    case 'overlaid':
      if (!isNumberArray(value.xs) || !isNumberArray(value.ys)) return 'output.chart.axes';
      if (!Array.isArray(value.responses)) return 'output.chart.responses';
      for (const response of value.responses) {
        if (!isPlainObject(response) || typeof response.name !== 'string') return 'output.chart.responses';
        if (!isGrid(response.z) || !isGrid(response.mask)) return 'output.chart.grid';
      }
      return null;
    case 'probplot':
    case 'normalprob':
      if (!isPointList(value.points)) return 'output.chart.points';
      if (!isPlainObject(value.fit) || !Number.isFinite(value.fit.intercept) || !Number.isFinite(value.fit.slope)) return 'output.chart.fit';
      return null;
    case 'scatter':
      if (!isPointList(value.points)) return 'output.chart.points';
      if (value.series !== undefined && !(Array.isArray(value.series) && value.series.every((series) => isPlainObject(series) && isPointList(series.points)))) return 'output.chart.series';
      return null;
    case 'boxplot':
      if (!Array.isArray(value.groups) || value.groups.some((group) => !isPlainObject(group) || typeof group.label !== 'string' || !isNumberArray(group.values))) return 'output.chart.groups';
      return null;
    case 'pareto':
      if (!Array.isArray(value.items) || value.items.some((item) => !isPlainObject(item) || typeof item.label !== 'string' || !Number.isFinite(item.count))) return 'output.chart.items';
      return null;
    case 'capability':
      return isPlainObject(value.result) ? null : 'output.chart.result';
    case 'control':
      if (!isPlainObject(value.panel) || !isNumberArray(value.panel.points) || !Number.isFinite(value.panel.center)) return 'output.chart.panel';
      return null;
    case 'interval':
      if (!Array.isArray(value.groups) || value.groups.some((group) => !isPlainObject(group) || typeof group.label !== 'string' || !Number.isFinite(group.mean) || !Number.isFinite(group.lo) || !Number.isFinite(group.hi))) return 'output.chart.groups';
      return null;
    default:
      return 'output.chart.kind';
  }
}

/** Why one output block cannot be drawn (null when it can). */
function blockProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'output.block';
  if (value.type === 'table') {
    if (!Array.isArray(value.headers) || value.headers.some((header) => typeof header !== 'string')) return 'output.block';
    // Every row is part of the result table: a second or later row is data too.
    if (!Array.isArray(value.rows) || value.rows.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== 'string' && typeof cell !== 'number'))) return 'output.block.rows';
    return null;
  }
  if (value.type === 'chart') return chartProblem(value.chart);
  if (value.type === 'chartgrid') {
    if (!Array.isArray(value.charts) || !value.charts.length) return 'output.block.charts';
    for (const entry of value.charts) {
      if (!isPlainObject(entry) || typeof entry.title !== 'string') return 'output.block.charts';
      if (chartProblem(entry.chart)) return 'output.block.charts';
    }
    return null;
  }
  if (value.type === 'text') {
    if (!Array.isArray(value.lines) || value.lines.some((line) => typeof line !== 'string')) return 'output.block.lines';
    return null;
  }
  return 'output.block';
}

/** A model variable's own schema: a name, a kind, and a usable coding. */
function variableProblem(value: unknown, code: string): boolean {
  if (!isPlainObject(value)) return true;
  if (typeof value.name !== 'string' || !value.name.trim()) return true;
  if (value.kind !== 'numeric' && value.kind !== 'categorical') return true;
  if (value.coding !== undefined && value.coding !== null) {
    if (!isPlainObject(value.coding)) return true;
    const coding = value.coding;
    if (coding.mode !== 'coded' && coding.mode !== 'actual') return true;
    if (!Number.isFinite(coding.center) || !Number.isFinite(coding.halfRange)) return true;
  }
  if (value.kind === 'categorical' && value.levels !== undefined) {
    if (!Array.isArray(value.levels) || value.levels.some((level) => typeof level !== 'string')) return true;
  }
  void code;
  return false;
}

/**
 * Why one stored model cannot be restored (null when it can).
 *
 * The record is checked down to its own schema — variables, coefficients and
 * the covariance shape — because a tolerant reader that dropped a damaged
 * coefficient (or a whole model) would change what the model predicts without
 * saying so, and the reader would be using a different model than the file
 * states.
 */
function modelProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'model';
  if (value.format !== 'sigrun-model') return 'model.format';
  if (value.version !== 1) return 'model.version';
  if (typeof value.id !== 'string' || !value.id) return 'model.id';
  if (typeof value.name !== 'string') return 'model.name';
  if (variableProblem(value.response, 'model.response')) return 'model.response';
  if (!Array.isArray(value.predictors) || value.predictors.length === 0) return 'model.predictors';
  if (value.predictors.some((predictor) => variableProblem(predictor, 'model.predictor'))) return 'model.predictor';
  const names = new Set<string>();
  for (const predictor of value.predictors as { name: string; id?: string }[]) {
    const key = predictor.name.trim();
    if (names.has(key)) return 'model.predictorDuplicate';
    names.add(key);
  }
  if (!Array.isArray(value.coefficients) || value.coefficients.length === 0) return 'model.coefficients';
  const labels = new Set<string>();
  for (const coefficient of value.coefficients as unknown[]) {
    if (!isPlainObject(coefficient)) return 'model.coefficient';
    if (typeof coefficient.label !== 'string' || !coefficient.label) return 'model.coefficient.label';
    if (typeof coefficient.value !== 'number' || !Number.isFinite(coefficient.value)) return 'model.coefficient.value';
    if (typeof coefficient.estimable !== 'boolean') return 'model.coefficient.estimable';
    if (labels.has(coefficient.label)) return 'model.coefficient.label';
    labels.add(coefficient.label);
  }
  const size = (value.coefficients as unknown[]).length;
  if (value.covariance !== undefined && value.covariance !== null) {
    if (!Array.isArray(value.covariance) || value.covariance.length !== size) return 'model.covariance';
    for (const row of value.covariance as unknown[]) {
      if (!Array.isArray(row) || row.length !== size) return 'model.covariance';
      if (row.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) return 'model.covariance';
    }
  }
  if (value.residual !== undefined && value.residual !== null) {
    if (!isPlainObject(value.residual)) return 'model.residual';
    const df = value.residual.df;
    if (df !== undefined && (typeof df !== 'number' || !Number.isFinite(df))) return 'model.residual';
  }
  if (value.factorBounds !== undefined && value.factorBounds !== null) {
    if (!isPlainObject(value.factorBounds)) return 'model.factorBounds';
    for (const bound of Object.values(value.factorBounds)) {
      if (!isPlainObject(bound) || !Number.isFinite(bound.min) || !Number.isFinite(bound.max)) return 'model.factorBounds';
    }
  }
  if (!Array.isArray(value.terms) || value.terms.some((term) => !isPlainObject(term) || typeof term.label !== 'string' || !Array.isArray(term.factors) || term.factors.some((factor) => typeof factor !== 'string'))) {
    return 'model.terms';
  }
  if (value.dof !== undefined && value.dof !== null) {
    const dof = value.dof;
    if (!isPlainObject(dof)) return 'model.dof';
    if (!['model', 'residual', 'total', 'rank'].every((key) => Number.isFinite(dof[key]))) return 'model.dof';
  }
  if (value.categoricalLevels !== undefined && value.categoricalLevels !== null) {
    if (!isPlainObject(value.categoricalLevels)) return 'model.categoricalLevels';
    for (const levels of Object.values(value.categoricalLevels)) {
      if (!Array.isArray(levels) || levels.some((level) => typeof level !== 'string')) return 'model.categoricalLevels';
    }
  }
  if (value.training !== undefined && value.training !== null) {
    if (!isPlainObject(value.training)) return 'model.training';
    if (!Number.isFinite(value.training.rows) || typeof value.training.fingerprint !== 'string') return 'model.training';
    if (!Array.isArray(value.training.columns) || value.training.columns.some((column) => !isPlainObject(column) || typeof column.id !== 'string' || typeof column.name !== 'string' || typeof column.type !== 'string')) {
      return 'model.training';
    }
  }
  if (value.diagnostics !== undefined && value.diagnostics !== null && !isPlainObject(value.diagnostics)) return 'model.diagnostics';
  const levelRecord = (levels: unknown): boolean => isPlainObject(levels) && Object.values(levels).every((level) => typeof level === 'number' && Number.isFinite(level));
  if (value.design !== undefined && value.design !== null) {
    if (!isPlainObject(value.design) || !Array.isArray(value.design.points)) return 'model.design';
    if (value.design.points.some((point) => !isPlainObject(point) || !levelRecord(point.levels) || !(point.y === null || Number.isFinite(point.y)))) return 'model.design';
  }
  if (value.stationary !== undefined && value.stationary !== null) {
    if (!isPlainObject(value.stationary) || !levelRecord(value.stationary.levels) || !Number.isFinite(value.stationary.response) || typeof value.stationary.kind !== 'string') return 'model.stationary';
  }
  if (value.optimal !== undefined && value.optimal !== null) {
    if (!isPlainObject(value.optimal) || !levelRecord(value.optimal.levels) || !Number.isFinite(value.optimal.response)) return 'model.optimal';
  }
  if (value.source !== undefined && value.source !== null) {
    if (!isPlainObject(value.source)) return 'model.source';
    if (value.source.analysisId !== undefined && typeof value.source.analysisId !== 'string') return 'model.source';
    if (value.source.outputId !== undefined && typeof value.source.outputId !== 'string') return 'model.source';
  }
  return null;
}

/** Why one output card cannot be restored (null when it can). */
function outputProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'output';
  if (typeof value.id !== 'string' || !value.id) return 'output.id';
  if (typeof value.titleKey !== 'string') return 'output.titleKey';
  if (!Array.isArray(value.blocks)) return 'output.blocks';
  for (const block of value.blocks as unknown[]) {
    const problem = blockProblem(block);
    if (problem) return problem;
  }
  return null;
}

/** Why one figure layout cannot be restored (null when it can). */
function figureProblem(value: unknown, outputs: Map<string, OutputDoc>): string | null {
  if (!isPlainObject(value)) return 'figure';
  if (value.format !== 'sigrun-layout') return 'figure.format';
  if (value.version !== 1) return 'figure.version';
  if (!isPlainObject(value.page)) return 'figure.page';
  const page = value.page;
  if (typeof page.preset !== 'string') return 'figure.page';
  if (!Number.isFinite(page.widthMm) || !Number.isFinite(page.heightMm) || !Number.isFinite(page.marginMm)) return 'figure.page';
  if (!isPlainObject(value.grid) || typeof value.grid.enabled !== 'boolean' || !Number.isFinite(value.grid.sizeMm)) return 'figure.grid';
  if (!Number.isFinite(value.zSeq) || !Number.isFinite(value.idSeq)) return 'figure.sequence';
  if (!Array.isArray(value.panels)) return 'figure.panels';
  const panelIds = new Set<string>();
  for (const panel of value.panels as unknown[]) {
    if (!isPlainObject(panel)) return 'figure.panel';
    if (typeof panel.id !== 'string' || !panel.id) return 'figure.panel';
    if (typeof panel.kind !== 'string' || !panel.kind) return 'figure.panel';
    if (panelIds.has(panel.id)) return 'figure.panelDuplicate';
    panelIds.add(panel.id);
    // Where the panel sits and how big it is: both are part of the page.
    if (!Number.isFinite(panel.x) || !Number.isFinite(panel.y) || !Number.isFinite(panel.w) || !Number.isFinite(panel.h)) return 'figure.panelBox';
    if ((panel.w as number) <= 0 || (panel.h as number) <= 0) return 'figure.panelBox';
    if (!Number.isFinite(panel.z)) return 'figure.panelBox';
    if (panel.kind === 'chart') {
      const source = panel.source;
      if (!isPlainObject(source) || typeof source.outputId !== 'string' || !Number.isInteger(source.blockIndex) || !Number.isInteger(source.chartIndex)) return 'figure.panelSource';
      const output = outputs.get(source.outputId);
      if (!output) return 'figure.panelSource';
      const block = output.blocks[(source.blockIndex as number)];
      const charts = block?.type === 'chart' ? 1 : block?.type === 'chartgrid' ? block.charts.length : 0;
      if (!charts || (source.chartIndex as number) < 0 || (source.chartIndex as number) >= charts) return 'figure.panelSource';
    }
  }
  return null;
}

/** Why one custom chart style cannot be restored (null when it can). */
function styleProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'style';
  if (typeof value.id !== 'string' || !value.id) return 'style.id';
  if (typeof value.name !== 'string' || !value.name) return 'style.name';
  if (typeof value.base !== 'string' || !(CHART_STYLE_IDS as string[]).includes(value.base)) return 'style.base';
  if (value.overrides !== undefined) {
    if (!isPlainObject(value.overrides)) return 'style.overrides';
    const isScalar = (entry: unknown): boolean =>
      typeof entry === 'number' ? Number.isFinite(entry) : typeof entry === 'string' || typeof entry === 'boolean';
    for (const entry of Object.values(value.overrides)) {
      // Style attributes are scalars or scalar lists (e.g. a palette); a nested
      // object would reach the renderer as an unknown value and be ignored.
      const ok = isScalar(entry) || (Array.isArray(entry) && entry.every(isScalar));
      if (!ok) return 'style.overrides';
    }
  }
  return null;
}

/**
 * A worksheet written by an older schema, brought up to the current one.
 *
 * The only thing version 2 adds is the column sequence: a restored sheet that
 * has forgotten how many columns it has ever used would hand out an id that an
 * analysis already refers to (see `columnSequence`). Deriving it from the ids
 * the sheet does carry is a migration, not a guess.
 */
export function migrateWorksheet(sheet: Worksheet): Worksheet {
  const columns = sheet.columns.map((column) => ({
    ...column,
    values: Array.isArray(column.values) ? column.values : [],
  }));
  const columnSeq = Number.isFinite(sheet.columnSeq) ? sheet.columnSeq : columnSequence({ ...sheet, columns });
  return { ...sheet, columns, columnSeq };
}

/**
 * Read a project, or refuse it with the reason.
 *
 * The version is checked before anything is restored: a file from a newer build
 * is not "mostly readable", and a version that is not a number is not a guess
 * to make. A damaged worksheet or model stops the restore (the current
 * workspace is left as it was) rather than being dropped from the file.
 */
export function parseProject(text: string): ProjectState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('file.error');
  }
  const file = data as Partial<ProjectFile> & { version?: unknown };
  if (!file || file.format !== 'sigrun-project' || !Array.isArray(file.worksheets)) throw new Error('file.error');

  const rawVersion = file.version;
  let version: number;
  if (rawVersion === undefined || rawVersion === null) {
    version = OLDEST_PROJECT_VERSION; // legacy .mpx.json, written before versions existed
  } else if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion) || rawVersion < OLDEST_PROJECT_VERSION) {
    throw new Error('file.versionInvalid');
  } else if (rawVersion > CURRENT_PROJECT_VERSION) {
    throw new Error('file.versionNewer');
  } else {
    version = rawVersion;
  }

  if (!file.worksheets.length) throw new Error('file.error');
  const problems = file.worksheets.map((sheet) => worksheetProblem(sheet));
  if (problems.some(Boolean)) throw new Error('file.worksheetCorrupt');
  // Two sheets with one id would be one sheet after the restore: the reader's
  // second dataset would replace the first without a word.
  const sheetIds = new Set<string>();
  for (const sheet of file.worksheets as Worksheet[]) {
    if (sheetIds.has(sheet.id)) throw new Error('file.worksheetDuplicate');
    sheetIds.add(sheet.id);
  }

  const rawModels = file.models === undefined ? [] : file.models;
  if (!Array.isArray(rawModels)) throw new Error('file.modelCorrupt');
  if (rawModels.some((entry) => modelProblem(entry) !== null)) throw new Error('file.modelCorrupt');
  const modelIds = new Set<string>();
  for (const entry of rawModels as { id: string }[]) {
    if (modelIds.has(entry.id)) throw new Error('file.modelDuplicate');
    modelIds.add(entry.id);
  }

  const rawOutputs = file.outputs === undefined ? [] : file.outputs;
  if (!Array.isArray(rawOutputs)) throw new Error('file.outputCorrupt');
  if (rawOutputs.some((entry) => outputProblem(entry) !== null)) throw new Error('file.outputCorrupt');
  const outputIds = new Set<string>();
  for (const entry of rawOutputs as { id: string }[]) {
    if (outputIds.has(entry.id)) throw new Error('file.outputDuplicate');
    outputIds.add(entry.id);
  }
  const outputsById = new Map((rawOutputs as OutputDoc[]).map((output) => [output.id, output]));

  const rawStyles = file.customChartStyles === undefined ? [] : file.customChartStyles;
  if (!Array.isArray(rawStyles)) throw new Error('file.styleCorrupt');
  if ((rawStyles as unknown[]).some((entry) => styleProblem(entry) !== null)) throw new Error('file.styleCorrupt');
  const styleIds = new Set<string>();
  for (const entry of rawStyles as CustomChartStyle[]) {
    if (styleIds.has(entry.id)) throw new Error('file.styleDuplicate');
    styleIds.add(entry.id);
  }

  // A figure is validated, never filtered: dropping a damaged layout would
  // leave the reader with a project that opens and silently lacks a page.
  const rawFigures = file.figures === undefined ? [] : file.figures;
  if (!Array.isArray(rawFigures)) throw new Error('file.figureCorrupt');
  if ((rawFigures as unknown[]).some((entry) => figureProblem(entry, outputsById) !== null)) throw new Error('file.figureCorrupt');

  const worksheets = (file.worksheets as Worksheet[]).map(migrateWorksheet);
  const activeSheetId = worksheets.some((ws) => ws.id === file.activeSheetId) ? (file.activeSheetId as string) : worksheets[0].id;
  const settings: Settings = {
    theme: file.settings?.theme === 'dark' ? 'dark' : 'light',
    lang: file.settings?.lang === 'ko' ? 'ko' : 'en',
  };
  return {
    version: CURRENT_PROJECT_VERSION,
    originalVersion: version,
    worksheets,
    activeSheetId,
    settings,
    outputs: (rawOutputs as OutputDoc[]).map(restoreOutput),
    ...(rawStyles.length ? { customChartStyles: rawStyles as CustomChartStyle[] } : {}),
    models: parseStoredModels(rawModels),
    ...(rawFigures.length ? { figures: rawFigures as unknown as LayoutDoc[] } : {}),
  };
}

export function worksheetToCsv(ws: Worksheet): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows: string[] = [];
  const maxRows = Math.max(0, ...ws.columns.map((c) => c.values.length));
  rows.push(ws.columns.map((c) => escape(c.name || c.id)).join(','));
  for (let r = 0; r < maxRows; r += 1) {
    rows.push(ws.columns.map((c) => escape(c.values[r] ?? null)).join(','));
  }
  return rows.join('\r\n');
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(clean);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  // Drop trailing blank rows only; a blank row in the middle still holds its place.
  while (rows.length && rows[rows.length - 1].every((cell) => cell.trim() === '')) rows.pop();
  return rows;
}

/** Tell TSV, semicolon and comma apart by counting separators outside quotes. */
export function detectDelimiter(text: string): string {
  let inQuotes = false;
  let firstRecord = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
    } else if (ch === '\n' && !inQuotes) {
      break;
    } else if (!inQuotes) {
      firstRecord += ch;
    }
  }
  const count = (needle: string) => firstRecord.split(needle).length - 1;
  if (count('\t') > 0) return '\t';
  if (count(';') > count(',')) return ';';
  return ',';
}

/** Parse a clipboard/CSV cell into a number when it really is one. */
export function parseNumberCell(raw: string): number | null {
  const text = raw.trim();
  if (!text || !/^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(text)) return null;
  const value = Number(text.replace(/,/g, ''));
  return isFinite(value) ? value : null;
}

function inferType(values: string[]): ColType {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  if (!nonEmpty.length) return 'text';
  if (nonEmpty.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))) return 'date';
  if (nonEmpty.every((v) => isFinite(Number(v.replace(/,/g, ''))))) return 'numeric';
  return 'text';
}

export interface CsvImportOptions {
  /** true = first row is the header, false = it is data (C1, C2… names),
   *  undefined = auto-detect from the content (the legacy behaviour) */
  header?: boolean;
}

export function csvToWorksheet(text: string, name = 'Imported', options: CsvImportOptions = {}): Worksheet {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('file.error');
  const width = Math.max(...rows.map((r) => r.length));
  const first = rows[0];
  // Auto-detect only when the caller does not say: a first row is treated as a
  // header when every cell is non-empty and non-numeric. The import dialog
  // always passes an explicit choice so a headerless text file keeps row 1.
  const hasHeader = options.header === undefined
    ? first.every((cell) => cell.trim() !== '' && !isFinite(Number(cell.replace(/,/g, ''))))
    : options.header;
  const names = hasHeader ? first : new Array(width).fill('');
  const body = hasHeader ? rows.slice(1) : rows;
  const columns = Array.from({ length: width }, (_, c) => {
    const raw = body.map((row) => (row[c] ?? '').trim());
    const type = inferType(raw);
    return {
      name: (names[c] ?? '').trim() || `C${c + 1}`,
      type,
      values: raw.map((v) => (v === '' ? null : type === 'numeric' ? Number(v.replace(/,/g, '')) : v)),
    };
  });
  const ws = makeWorksheet(name, columns);
  return ws;
}

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

/** Highest column number this sheet has ever used (the sequence survives a
 *  delete, so an id is never handed out twice). */
export function columnSequence(ws: Worksheet): number {
  let highest = Number.isFinite(ws.columnSeq) ? Number(ws.columnSeq) : 0;
  for (const column of ws.columns) {
    const match = /^C(\d+)$/.exec(column.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

/**
 * Next free column identifier. Ids are never reused: after C3 is deleted a new
 * column becomes C4+ rather than C3, so an analysis that stored "C3" cannot
 * silently start reading a different column.
 */
export function newColumnId(ws: Worksheet): string {
  const used = new Set(ws.columns.map((c) => c.id));
  let i = columnSequence(ws) + 1;
  while (used.has(`C${i}`)) i += 1;
  return `C${i}`;
}

export function duplicateNameGuard(ws: Worksheet, name: string): string {
  const trimmed = name.trim() || 'Column';
  if (!ws.columns.some((c) => c.name === trimmed)) return trimmed;
  let i = 2;
  while (ws.columns.some((c) => c.name === `${trimmed} ${i}`)) i += 1;
  return `${trimmed} ${i}`;
}

export function sheetWithColumn(ws: Worksheet, name: string, type: ColType, values: (number | string | null)[]): Worksheet {
  const rows = Math.max(ws.columns[0]?.values.length ?? 0, values.length);
  const columns: Column[] = ws.columns.map((c) => ({
    ...c,
    values: Array.from({ length: rows }, (_, i) => c.values[i] ?? null),
  }));
  columns.push({ id: newColumnId(ws), name: duplicateNameGuard(ws, name), type, values: Array.from({ length: rows }, (_, i) => values[i] ?? null) });
  return { ...ws, id: ws.id, columns };
}

export function uniqueSheetName(worksheets: Worksheet[], base = 'Worksheet'): string {
  let i = 1;
  const names = new Set(worksheets.map((w) => w.name));
  while (names.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

export function makeOutputId(): string {
  return uid('out');
}
