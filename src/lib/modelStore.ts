/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — stored fitted models (WO-02)

   An analysis produces a fitted model; a reader wants to keep it and use it
   again from Contour, Surface, the Optimizer or any later prediction. This
   module is the storage layer: it turns the engine results into one portable
   record, names/duplicates/removes records, detects when the data behind a
   record has changed, re-fits a record from the worksheet, and moves the whole
   set in and out of a project file.

   What is stored is what the engine actually computed. Where an engine result
   does not carry a quantity (an RSM payload has no covariance matrix, a
   factorial analysis has no predicted R²), the field is stored as null and the
   UI says "not available" — a number is never invented to fill a gap.
   ───────────────────────────────────────────────────────────────────────── */

import type { Column, Worksheet } from '../types';
import { fitGlm, type GlmResult, type ModelFactor, type ModelTerm } from './glm';
import type { RsmModelPayload } from './doe';
import type { RegressionResult } from './stats';
import { uid } from './datasets';

export type StoredModelKind = 'linear' | 'multiple' | 'polynomial' | 'glm' | 'doe' | 'rsm';

export type ModelVariableKind = 'numeric' | 'categorical';

/** How the coefficients read a numeric predictor. */
export interface ModelCoding {
  /** 'coded' — coefficients consume coded units; 'actual' — the measured value. */
  mode: 'coded' | 'actual';
  /** Centre of the coding transform (actual units). */
  center: number;
  /** Half the coded span: coded = (actual − center) / halfRange. */
  halfRange: number;
}

export interface ModelVariable {
  /** Column id the variable was fitted from ('' when it is derived). */
  id: string;
  name: string;
  kind: ModelVariableKind;
  /** Unit as the caller stated it; absent when nobody stated one. */
  unit?: string;
  /** Categorical levels in the fitted (sorted) order; absent for numeric. */
  levels?: string[];
  /** Numeric coding; absent for categorical predictors. */
  coding?: ModelCoding;
}

export interface StoredModelTerm {
  label: string;
  factors: string[];
}

export interface StoredModelCoefficient {
  label: string;
  value: number;
  se?: number;
  /** false when the column was aliased: its value is not identified. */
  estimable: boolean;
}

/** Only the quantities the engine actually produced are present. */
export interface StoredModelResidual {
  sse?: number;
  df?: number;
  mse?: number;
  s?: number;
}

export interface StoredModelDof {
  model: number;
  residual: number;
  total: number;
  rank: number;
}

export interface StoredModelTraining {
  sheetId?: string;
  sheetName?: string;
  rows: number;
  /** FNV-1a hash of the referenced columns: detects a changed dataset. */
  fingerprint: string;
  columns: { id: string; name: string; type: string }[];
}

export interface StoredModelDiagnostics {
  n?: number;
  r2?: number;
  r2adj?: number;
  r2pred?: number;
  f?: number;
  p?: number;
  s?: number;
  aliased?: string[];
}

export interface StoredModel {
  format: 'sigrun-model';
  version: 1;
  id: string;
  name: string;
  kind: StoredModelKind;
  createdAt: string;
  updatedAt: string;
  response: ModelVariable;
  predictors: ModelVariable[];
  terms: StoredModelTerm[];
  coefficients: StoredModelCoefficient[];
  /** Covariance of the estimates (mse·(X'X)⁻¹) in coefficient order, or null. */
  covariance: number[][] | null;
  residual: StoredModelResidual | null;
  dof: StoredModelDof | null;
  /** Actual-unit bounds per numeric predictor (by name), or null when unknown. */
  factorBounds: Record<string, { min: number; max: number }> | null;
  categoricalLevels: Record<string, string[]> | null;
  training: StoredModelTraining | null;
  diagnostics: StoredModelDiagnostics;
  /**
   * The runs behind a designed fit (Stage 3B). Coded factor levels per run and
   * the observed response, kept so a 3-D surface can put the experiment points
   * on the plane it draws. Absent for a regression, whose rows are the sheet.
   */
  design?: { points: { levels: Record<string, number>; y: number | null }[] } | null;
  /** Stationary point of a fitted quadratic, in coded factor levels. */
  stationary?: { levels: Record<string, number>; response: number; kind: string } | null;
  /** Best operating point an optimiser chose, in coded factor levels. */
  optimal?: { levels: Record<string, number>; response: number } | null;
  /** Where it came from: analysis id, output card, chart. */
  source: { analysisId?: string; outputId?: string };
}

/** A model as an analysis hands it over, before it gets an id and a name. */
export type StoredModelDraft = Omit<StoredModel, 'id' | 'name' | 'createdAt' | 'updatedAt'>;

/* ── fingerprinting ───────────────────────────────────────────────────── */

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** A short, stable digest of the data a model was fitted on. */
export function fingerprintColumns(columns: { id: string; name: string; values: (number | string | null)[] }[]): string {
  const parts = columns.map((column) => {
    const cells = column.values.map((value) => (value === null || value === undefined ? '' : String(value)));
    return `${column.id}:${column.name}:${cells.join(',')}`;
  });
  return hashText(parts.join('|'));
}

export function trainingFromSheet(sheet: Worksheet | undefined, columnIds: string[], rows: number): StoredModelTraining | null {
  if (!sheet) return null;
  const columns = sheet.columns.filter((column) => columnIds.includes(column.id));
  if (!columns.length) return null;
  return {
    sheetId: sheet.id,
    sheetName: sheet.name,
    rows,
    fingerprint: fingerprintColumns(columns),
    columns: columns.map((column) => ({ id: column.id, name: column.name, type: column.type })),
  };
}

/* ── model construction ───────────────────────────────────────────────── */

function actualCoding(values: (number | string | null)[]): ModelCoding {
  const numbers = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const min = numbers.length ? Math.min(...numbers) : -1;
  const max = numbers.length ? Math.max(...numbers) : 1;
  const center = (min + max) / 2;
  const halfRange = (max - min) / 2 || 1;
  return { mode: 'actual', center, halfRange };
}

/** Terms for a set of main effects (the shape a multiple regression fits). */
export function mainEffectTerms(names: string[]): StoredModelTerm[] {
  return names.map((name) => ({ label: name, factors: [name] }));
}

function termsFromLabels(labels: string[]): StoredModelTerm[] {
  // Split a design label back into the factors the fit used: 'A×B', 'A²',
  // 'Machine[L1]'. A square keeps its own derived factor name ('A²') because
  // that is how the RSM engine fits it, which keeps a re-fit reproducible.
  return labels
    .filter((label) => label !== 'Constant')
    .map((label) => ({
      label,
      factors: label.split('×').map((part) => part.replace(/\[.*\]$/, '')),
    }));
}

function numericBounds(entries: { name: string; values: (number | string | null)[] }[]): Record<string, { min: number; max: number }> | null {
  const out: Record<string, { min: number; max: number }> = {};
  entries.forEach((entry) => {
    const numbers = entry.values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (numbers.length) out[entry.name] = { min: Math.min(...numbers), max: Math.max(...numbers) };
  });
  return Object.keys(out).length ? out : null;
}

function boundsByPredictor(predictors: ModelVariable[], factors: ModelFactor[]): Record<string, { min: number; max: number }> | null {
  return numericBounds(factors
    .filter((factor) => factor.kind === 'numeric' && predictors.some((predictor) => predictor.name === factor.name))
    .map((factor) => ({ name: factor.name, values: factor.values })));
}

/**
 * Recover the model terms from a fitted design.
 *
 * `fitGlm` reports which design columns each term contributed but not the term
 * names; the label of a block's first column is the term ('A×B', 'Machine[L1]').
 * Used where an analysis hands over a fit without repeating its term list.
 */
export function termsFromDesign(glm: GlmResult): ModelTerm[] {
  return glm.design.blockStart.map((start, index) => {
    const label = glm.labels[start] ?? `T${index + 1}`;
    const name = label.replace(/\[[^\]]*\]$/, '');
    return { name, factors: name.split('×').map((part) => part.replace(/\[[^\]]*\]$/, '')) };
  });
}

export interface GlmModelInput {
  glm: GlmResult;
  factors: ModelFactor[];
  terms: ModelTerm[];
  response: { id: string; name: string; values: (number | string | null)[] };
  kind: StoredModelKind;
  /** Coded designs (DOE/RSM) keep their coefficient space explicit. */
  codingMode?: 'coded' | 'actual';
  sheet?: Worksheet;
  analysisId?: string;
}

/** One fitted general linear model (GLM, DOE, RSM) becomes a stored record. */
/** A variable derived from another one (A² is A squared, never an input). */
export function isDerivedFactorName(name: string): { base: string; power: number } | null {
  let power = 1;
  let base = name;
  for (;;) {
    if (base.endsWith('²')) { power *= 2; base = base.slice(0, -1); continue; }
    if (base.endsWith('³')) { power *= 3; base = base.slice(0, -1); continue; }
    break;
  }
  return power > 1 && base ? { base, power } : null;
}

export function draftFromGlm(input: GlmModelInput): StoredModelDraft {
  const { glm, terms, response, kind } = input;
  const aliased = new Set(glm.aliased);
  const mode = input.codingMode ?? 'actual';
  // Interaction/squared terms are fitted through derived factors; they are
  // model structure, not variables a reader types a value into.
  const names = new Set(input.factors.map((factor) => factor.name));
  const factors = input.factors.filter((factor) => {
    const derived = isDerivedFactorName(factor.name);
    return !(derived && names.has(derived.base));
  });
  const predictors = factors.map((factor) => {
    const column = input.sheet?.columns.find((c) => c.id === factor.name || c.name === factor.name);
    const name = factor.name;
    if (factor.kind === 'categorical') {
      const levels = glm.design.levels[name] ?? [];
      return {
        id: column?.id ?? '',
        name,
        kind: 'categorical' as const,
        levels,
      };
    }
    const values = factor.values;
    const base = actualCoding(values);
    const coding: ModelCoding = mode === 'coded'
      ? { ...base, mode: 'coded' }
      : base;
    return {
      id: column?.id ?? '',
      name,
      kind: 'numeric' as const,
      coding,
    };
  });
  const covariance = glm.dfe > 0 && glm.xtxInv?.length
    ? glm.xtxInv.map((row) => row.map((value) => (Number.isFinite(value) ? value * glm.mse : 0)))
    : null;
  const coefficients: StoredModelCoefficient[] = glm.labels.map((label, index) => ({
    label,
    value: glm.beta[index],
    ...(Number.isFinite(glm.se[index]) ? { se: glm.se[index] } : {}),
    estimable: !aliased.has(label) && Number.isFinite(glm.beta[index]),
  }));
  // The response column is part of the fitted data too: if it changes, the
  // model is stale, not merely the predictors.
  const columnIds = [
    ...factors.map((factor) => input.sheet?.columns.find((c) => c.id === factor.name || c.name === factor.name)?.id),
    input.sheet?.columns.find((c) => c.id === response.id || c.name === response.name)?.id,
  ].filter((id): id is string => Boolean(id));
  return {
    format: 'sigrun-model',
    version: 1,
    kind,
    response: { id: response.id, name: response.name, kind: 'numeric' },
    predictors,
    terms: terms.map((term) => ({ label: term.name, factors: [...term.factors] })),
    coefficients,
    covariance,
    residual: glm.dfe > 0
      ? { sse: glm.sse, df: glm.dfe, mse: glm.mse, s: glm.s }
      : null,
    dof: { model: glm.dfModel, residual: glm.dfe, total: glm.dfe + glm.rank - 1, rank: glm.rank },
    factorBounds: boundsByPredictor(predictors, factors),
    categoricalLevels: Object.keys(glm.design.levels).length ? { ...glm.design.levels } : null,
    training: trainingFromSheet(input.sheet, columnIds, glm.n),
    diagnostics: {
      n: glm.n,
      r2: glm.r2,
      r2adj: glm.r2adj,
      ...(Number.isFinite(glm.s) ? { s: glm.s } : {}),
      ...(glm.aliased.length ? { aliased: [...glm.aliased] } : {}),
    },
    source: { ...(input.analysisId ? { analysisId: input.analysisId } : {}) },
  };
}

export interface RegressionModelOptions {
  result: RegressionResult;
  predictors: { column?: Column; name: string; values: (number | string | null)[] }[];
  response: { id: string; name: string };
  sheet?: Worksheet;
  analysisId?: string;
}

/** A linear / multiple / polynomial regression becomes a stored record. */
export function draftFromRegression(options: RegressionModelOptions): StoredModelDraft {
  const { result } = options;
  const predictors: ModelVariable[] = options.predictors.map((predictor) => {
    const coding = actualCoding(predictor.values);
    return {
      id: predictor.column?.id ?? '',
      name: predictor.name,
      kind: 'numeric',
      coding,
    };
  });
  const aliased = new Set<string>();
  const coefficients: StoredModelCoefficient[] = result.coefficients.map((coefficient) => {
    const estimable = Number.isFinite(coefficient.coef) && Number.isFinite(coefficient.se);
    if (!estimable) aliased.add(coefficient.term);
    return {
      label: coefficient.term,
      value: coefficient.coef,
      ...(Number.isFinite(coefficient.se) ? { se: coefficient.se } : {}),
      estimable,
    };
  });
  const columnIds = [
    ...options.predictors.map((predictor) => predictor.column?.id),
    options.sheet?.columns.find((c) => c.id === options.response.id || c.name === options.response.name)?.id,
  ].filter((id): id is string => Boolean(id));
  return {
    format: 'sigrun-model',
    version: 1,
    kind: result.xNames.length === 1 ? 'linear' : 'multiple',
    response: { id: options.response.id, name: options.response.name, kind: 'numeric' },
    predictors,
    terms: mainEffectTerms(result.xNames),
    coefficients,
    covariance: result.covariance?.length ? result.covariance.map((row) => [...row]) : null,
    residual: result.anova.dfErr > 0
      ? { sse: result.anova.ssErr, df: result.anova.dfErr, mse: result.anova.msErr, s: result.s }
      : null,
    dof: {
      model: result.anova.dfReg,
      residual: result.anova.dfErr,
      total: result.anova.dfReg + result.anova.dfErr,
      rank: result.anova.dfReg + 1,
    },
    factorBounds: numericBounds(options.predictors.map((predictor) => ({ name: predictor.name, values: predictor.values }))),
    categoricalLevels: null,
    training: trainingFromSheet(options.sheet, columnIds, result.n),
    diagnostics: {
      n: result.n,
      r2: result.r2,
      r2adj: result.r2adj,
      r2pred: result.r2pred,
      f: result.anova.f,
      p: result.anova.p,
      s: result.s,
      ...(aliased.size ? { aliased: [...aliased] } : {}),
    },
    source: { ...(options.analysisId ? { analysisId: options.analysisId } : {}) },
  };
}

/** An RSM payload (already fitted) becomes a stored record without refitting. */
export function draftFromRsmPayload(
  model: RsmModelPayload,
  options: { response: { id: string; name: string }; factors?: ModelVariable[]; sheet?: Worksheet; analysisId?: string } = { response: { id: '', name: 'Y' } },
): StoredModelDraft {
  const predictors: ModelVariable[] = model.factorNames.map((name, index) => {
    const transform = model.actualTransform[index];
    const bounds = model.codedBounds[index];
    const column = options.sheet?.columns.find((c) => c.name === name || c.id === name);
    return {
      id: column?.id ?? '',
      name,
      kind: 'numeric',
      coding: transform
        ? { mode: 'coded', center: transform.center, halfRange: transform.halfRange || 1 }
        : { mode: 'coded', center: 0, halfRange: 1 },
      ...(bounds ? {} : {}),
    };
  });
  const labels = model.labels;
  const bounds = model.codedBounds.map((bound, index) => {
    const transform = model.actualTransform[index];
    return transform
      ? { min: transform.center + (transform.halfRange || 1) * bound.min, max: transform.center + (transform.halfRange || 1) * bound.max }
      : { min: bound.min, max: bound.max };
  });
  return {
    format: 'sigrun-model',
    version: 1,
    kind: 'rsm',
    response: { id: options.response.id, name: options.response.name, kind: 'numeric' },
    predictors,
    terms: termsFromLabels(labels),
    coefficients: labels.map((label, index) => ({
      label,
      value: model.beta[index],
      // A payload fitted before Stage 3B carries no covariance and therefore no
      // SE; a payload fitted now states it from the covariance diagonal rather
      // than from a second, possibly different, computation.
      ...(model.covariance?.[index]?.[index] != null && Number.isFinite(model.covariance[index][index])
        ? { se: Math.sqrt(Math.max(0, model.covariance[index][index])) }
        : {}),
      estimable: Number.isFinite(model.beta[index]),
    })),
    covariance: model.covariance && model.covariance.length === labels.length
      ? model.covariance.map((row) => [...row])
      : null,
    residual: model.s != null
      ? (() => {
        // mse is s² by definition; a payload fitted before Stage 3B carries
        // only s, and the identity keeps its residual block complete.
        const mse = model.mse ?? model.s * model.s;
        return {
          sse: model.dfe != null ? mse * model.dfe : undefined,
          ...(model.dfe != null ? { df: model.dfe } : {}),
          mse,
          s: model.s,
        };
      })()
      : null,
    dof: model.dfe != null && model.dfe > 0
      ? {
        model: model.dfModel ?? Math.max(0, (model.rank ?? labels.length) - 1),
        residual: model.dfe,
        total: model.dfe + (model.rank ?? labels.length) - 1,
        rank: model.rank ?? labels.length,
      }
      : null,
    factorBounds: Object.fromEntries(model.factorNames.map((name, index) => [name, bounds[index]])),
    categoricalLevels: null,
    training: options.sheet
      ? {
        sheetId: options.sheet.id,
        sheetName: options.sheet.name,
        rows: model.n ?? model.designPoints.length,
        fingerprint: fingerprintColumns(options.sheet.columns.filter((c) => model.factorNames.includes(c.name) || model.factorNames.includes(c.id))),
        columns: options.sheet.columns
          .filter((c) => model.factorNames.includes(c.name) || model.factorNames.includes(c.id))
          .map((c) => ({ id: c.id, name: c.name, type: c.type })),
      }
      : null,
    diagnostics: {
      ...(model.n != null ? { n: model.n } : {}),
      ...(model.r2 != null ? { r2: model.r2 } : {}),
      ...(model.s != null ? { s: model.s } : {}),
    },
    design: {
      points: model.designPoints.map((point) => ({
        levels: Object.fromEntries(model.factorNames.map((name, index) => [name, point.levels[index] ?? 0])),
        y: point.y,
      })),
    },
    stationary: model.stationary
      ? {
        levels: Object.fromEntries(model.factorNames.map((name, index) => [name, model.stationary?.point[index] ?? 0])),
        response: model.stationary.response,
        kind: model.stationary.kind,
      }
      : null,
    optimal: model.optimal
      ? {
        levels: Object.fromEntries(model.factorNames.map((name, index) => [name, model.optimal?.point[index] ?? 0])),
        response: model.optimal.response,
      }
      : null,
    source: { ...(options.analysisId ? { analysisId: options.analysisId } : {}) },
  };
}

let modelSequence = 0;

/** Materialise a draft into a named, dated record. */
export function createStoredModel(draft: StoredModelDraft, name: string): StoredModel {
  modelSequence += 1;
  const now = new Date().toISOString();
  return {
    ...draft,
    id: `mdl-${Date.now().toString(36)}-${modelSequence.toString(36)}`,
    name: name.trim() || defaultModelName(draft),
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultModelName(draft: StoredModelDraft): string {
  const predictors = draft.predictors.map((predictor) => predictor.name).join(', ');
  return `${draft.response.name} ← ${predictors || 'model'}`;
}

/* ── collection operations ────────────────────────────────────────────── */

export function renameStoredModel(models: StoredModel[], id: string, name: string): StoredModel[] {
  const trimmed = name.trim();
  if (!trimmed) return models;
  return models.map((model) => (model.id === id ? { ...model, name: trimmed, updatedAt: new Date().toISOString() } : model));
}

export function duplicateStoredModel(models: StoredModel[], id: string): StoredModel[] {
  const source = models.find((model) => model.id === id);
  if (!source) return models;
  modelSequence += 1;
  const now = new Date().toISOString();
  const copy: StoredModel = {
    ...JSON.parse(JSON.stringify(source)) as StoredModel,
    id: `mdl-${Date.now().toString(36)}-${modelSequence.toString(36)}`,
    name: copyName(models, source.name),
    createdAt: now,
    updatedAt: now,
  };
  return [...models, copy];
}

function copyName(models: StoredModel[], base: string): string {
  const names = new Set(models.map((model) => model.name));
  const first = `${base} (copy)`;
  if (!names.has(first)) return first;
  let i = 2;
  while (names.has(`${base} (copy ${i})`)) i += 1;
  return `${base} (copy ${i})`;
}

export function deleteStoredModel(models: StoredModel[], id: string): StoredModel[] {
  return models.filter((model) => model.id !== id);
}

/** Merge two sets (a project opened on top of a session); the newer copy wins. */
export function mergeStoredModels(current: StoredModel[], incoming: StoredModel[]): StoredModel[] {
  const byId = new Map(current.map((model) => [model.id, model]));
  incoming.forEach((model) => {
    const existing = byId.get(model.id);
    if (!existing || (model.updatedAt ?? '') >= (existing.updatedAt ?? '')) byId.set(model.id, model);
  });
  return [...byId.values()];
}

export function uniqueModelName(models: StoredModel[], base: string): string {
  const names = new Set(models.map((model) => model.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} (${i})`)) i += 1;
  return `${base} (${i})`;
}

/* ── staleness and re-fitting ─────────────────────────────────────────── */

export type ModelStaleness = 'fresh' | 'stale' | 'missing-data' | 'untracked';

export interface StalenessReport {
  state: ModelStaleness;
  /** Human-readable reason for the manager panel. */
  detail: { code: string; missing?: string[] };
}

/** Is the data behind this model still exactly the data it was fitted on? */
export function modelStaleness(model: StoredModel, worksheets: Worksheet[]): StalenessReport {
  const training = model.training;
  if (!training || !training.columns.length) return { state: 'untracked', detail: { code: 'model.track.untracked' } };
  const sheet = worksheets.find((ws) => ws.id === training.sheetId);
  if (!sheet) return { state: 'missing-data', detail: { code: 'model.track.missingSheet' } };
  const missing = training.columns.filter((column) => !sheet.columns.some((c) => c.id === column.id));
  if (missing.length) return { state: 'missing-data', detail: { code: 'model.track.missingColumn', missing: missing.map((column) => column.name) } };
  const columns = sheet.columns.filter((column) => training.columns.some((c) => c.id === column.id));
  const fingerprint = fingerprintColumns(columns);
  return fingerprint === training.fingerprint
    ? { state: 'fresh', detail: { code: 'model.track.fresh' } }
    : { state: 'stale', detail: { code: 'model.track.stale' } };
}

export class ModelRefitError extends Error {
  constructor(readonly code: string, readonly detail?: Record<string, unknown>) {
    super(code);
    this.name = 'ModelRefitError';
  }
}

/**
 * Re-fit a stored model against a worksheet.
 *
 * The terms and the response are the model's own; the values are read from the
 * sheet by column id. A model whose columns are gone cannot be re-fitted, and
 * says which ones are missing instead of fitting something else.
 */
export function refitStoredModel(model: StoredModel, sheet: Worksheet | undefined, analysisId?: string): StoredModel {
  if (!sheet) throw new ModelRefitError('model.track.missingSheet');
  const findColumn = (variable: ModelVariable): Column | undefined => {
    const byId = variable.id ? sheet.columns.find((column) => column.id === variable.id) : undefined;
    return byId ?? sheet.columns.find((column) => column.name === variable.name);
  };
  const responseColumn = findColumn(model.response);
  if (!responseColumn) throw new ModelRefitError('model.track.missingColumn', { missing: model.response.name });
  const factors: ModelFactor[] = [];
  model.predictors.forEach((predictor) => {
    const column = findColumn(predictor);
    if (!column) throw new ModelRefitError('model.track.missingColumn', { missing: predictor.name });
    factors.push({
      name: predictor.name,
      kind: predictor.kind,
      values: predictor.kind === 'numeric'
        ? column.values.map((value) => (typeof value === 'number' ? value : null))
        : column.values.map((value) => (value === null || value === undefined ? null : String(value))),
    });
  });
  // Rebuild any derived factor (A² from A) a term refers to.
  model.terms.forEach((term) => term.factors.forEach((name) => {
    if (factors.some((factor) => factor.name === name)) return;
    const derived = isDerivedFactorName(name);
    const base = derived ? factors.find((factor) => factor.name === derived.base) : undefined;
    if (!derived || !base) throw new ModelRefitError('model.structure', { variable: name });
    if (base.kind !== 'numeric') throw new ModelRefitError('model.structure', { variable: name });
    factors.push({
      name,
      kind: 'numeric',
      values: base.values.map((value) => (typeof value === 'number' ? value ** derived.power : null)),
    });
  }));
  const terms: ModelTerm[] = model.terms.map((term) => ({ name: term.label, factors: [...term.factors] }));
  let glm: GlmResult;
  try {
    glm = fitGlm(
      responseColumn.values.map((value) => (typeof value === 'number' ? value : null)),
      factors,
      terms,
    );
  } catch (error) {
    throw new ModelRefitError(error instanceof Error ? error.message : 'model.refitFailed');
  }
  const draft = draftFromGlm({
    glm,
    factors,
    terms,
    response: { id: responseColumn.id, name: responseColumn.name || responseColumn.id, values: responseColumn.values },
    kind: model.kind,
    codingMode: model.predictors[0]?.coding?.mode ?? 'actual',
    sheet,
    analysisId: analysisId ?? model.source.analysisId,
  });
  return {
    ...model,
    predictors: model.predictors.map((predictor) => {
      const refit = draft.predictors.find((candidate) => candidate.name === predictor.name);
      return refit ? { ...predictor, id: refit.id || predictor.id, coding: refit.coding ?? predictor.coding } : predictor;
    }),
    coefficients: draft.coefficients,
    covariance: draft.covariance,
    residual: draft.residual,
    dof: draft.dof,
    factorBounds: draft.factorBounds,
    categoricalLevels: draft.categoricalLevels,
    training: draft.training ?? model.training,
    diagnostics: { ...draft.diagnostics, r2pred: model.diagnostics.r2pred, f: model.diagnostics.f, p: model.diagnostics.p },
    updatedAt: new Date().toISOString(),
  };
}

/* ── project interchange ──────────────────────────────────────────────── */

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

/** Tolerant reader: a damaged entry is dropped, never turned into a wrong model. */
export function parseStoredModels(raw: unknown): StoredModel[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredModel[] = [];
  raw.forEach((entry) => {
    if (!isObject(entry)) return;
    const candidate = entry as unknown as StoredModel;
    if (candidate.format !== 'sigrun-model' || typeof candidate.id !== 'string' || !Array.isArray(candidate.predictors)) return;
    if (!Array.isArray(candidate.coefficients) || !isObject(candidate.response)) return;
    out.push({
      ...candidate,
      name: typeof candidate.name === 'string' && candidate.name ? candidate.name : defaultModelName(candidate),
      terms: Array.isArray(candidate.terms) ? candidate.terms : [],
      coefficients: candidate.coefficients.filter((coefficient) => isObject(coefficient) && typeof coefficient.label === 'string'),
      covariance: Array.isArray(candidate.covariance) ? candidate.covariance : null,
      residual: isObject(candidate.residual) ? candidate.residual : null,
      dof: isObject(candidate.dof) ? candidate.dof : null,
      // factorBounds is a name → {min,max} record, not a list: reading it as an
      // array dropped every stored model's fitting range on a project load.
      factorBounds: isObject(candidate.factorBounds) ? candidate.factorBounds as Record<string, { min: number; max: number }> : null,
      categoricalLevels: isObject(candidate.categoricalLevels) ? candidate.categoricalLevels as Record<string, string[]> : null,
      training: isObject(candidate.training) ? candidate.training as unknown as StoredModelTraining : null,
      diagnostics: isObject(candidate.diagnostics) ? candidate.diagnostics : {},
      design: isObject(candidate.design) ? candidate.design as unknown as StoredModel['design'] : null,
      stationary: isObject(candidate.stationary) ? candidate.stationary as unknown as StoredModel['stationary'] : null,
      optimal: isObject(candidate.optimal) ? candidate.optimal as unknown as StoredModel['optimal'] : null,
      source: isObject(candidate.source) ? candidate.source : {},
    });
  });
  return out;
}

/** Comparison rows for several selected models. */
export interface ModelComparisonRow {
  key: string;
  label: string;
  values: Record<string, string>;
}

export function compareStoredModels(models: StoredModel[]): ModelComparisonRow[] {
  const rows: { key: string; label: string; pick: (model: StoredModel) => string }[] = [
    { key: 'kind', label: 'model.cmp.kind', pick: (model) => model.kind },
    { key: 'response', label: 'model.cmp.response', pick: (model) => model.response.name },
    { key: 'predictors', label: 'model.cmp.predictors', pick: (model) => model.predictors.map((p) => p.name).join(', ') },
    { key: 'terms', label: 'model.cmp.terms', pick: (model) => String(model.terms.length + 1) },
    { key: 'n', label: 'model.cmp.n', pick: (model) => (model.diagnostics.n != null ? String(model.diagnostics.n) : '—') },
    { key: 'dfe', label: 'model.cmp.dfe', pick: (model) => (model.dof ? String(model.dof.residual) : '—') },
    { key: 's', label: 'model.cmp.s', pick: (model) => (model.diagnostics.s != null ? model.diagnostics.s.toFixed(4) : '—') },
    { key: 'r2', label: 'model.cmp.r2', pick: (model) => (model.diagnostics.r2 != null ? `${(model.diagnostics.r2 * 100).toFixed(2)}%` : '—') },
    { key: 'r2adj', label: 'model.cmp.r2adj', pick: (model) => (model.diagnostics.r2adj != null ? `${(model.diagnostics.r2adj * 100).toFixed(2)}%` : '—') },
    { key: 'r2pred', label: 'model.cmp.r2pred', pick: (model) => (model.diagnostics.r2pred != null ? `${(model.diagnostics.r2pred * 100).toFixed(2)}%` : '—') },
    { key: 'aliased', label: 'model.cmp.aliased', pick: (model) => (model.diagnostics.aliased?.length ? model.diagnostics.aliased.join(', ') : '—') },
    { key: 'covariance', label: 'model.cmp.covariance', pick: (model) => (model.covariance ? 'model.cmp.available' : 'model.cmp.unavailable') },
    { key: 'updated', label: 'model.cmp.updated', pick: (model) => model.updatedAt.slice(0, 16).replace('T', ' ') },
  ];
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    values: Object.fromEntries(models.map((model) => [model.id, row.pick(model)])),
  }));
}

/** A fresh id for a model created outside `createStoredModel` (tests, imports). */
export function modelId(): string {
  return uid('mdl');
}
