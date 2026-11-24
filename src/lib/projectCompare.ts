/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — project round-trip comparison (WO-TQA-09, WO-FINAL-001 F-REL-05~08)

   A saved project is only "verified" when what comes back out of the file is
   the same data, not when the counts happen to agree. The comparison walks
   every record of both projects structurally — every table row, every chart
   data array, the whole 3-D grid, figure coordinates and sizes, model terms,
   coefficients, covariance and residual variance, variable coding, and the
   actual attributes of custom chart styles — with full numeric precision.

   Field order never matters; array order always does. A number is compared as
   a number (including -0, NaN and ±Infinity), so `null`, `0`, `"0"` and `""`
   are all different values. The only fields skipped are the ones on the
   explicit metadata list below, which are expected to change on every save.
   ───────────────────────────────────────────────────────────────────────── */

import type { OutputDoc, Settings, Worksheet } from '../types';
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
  /** A stable location inside the project, e.g. `sheet[0]/column[2]/values[7]`. */
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

/**
 * Fields expected to differ between two saves of the same project. Nothing else
 * is excluded: a field missing from this list is compared, however small.
 */
const EXCLUDED_METADATA = new Set(['savedAt']);

const MAX_MISMATCHES = 50;

function truncate(text: string): string {
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

/**
 * Canonical encoding of one value: type-tagged, object keys sorted, numbers at
 * their full round-trip precision. Two values are the same project data exactly
 * when their encodings are equal.
 */
export function canonicalValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  switch (typeof value) {
    case 'number':
      if (Number.isNaN(value)) return 'number:NaN';
      if (value === Infinity) return 'number:Infinity';
      if (value === -Infinity) return 'number:-Infinity';
      // `String(-0)` is "0": the sign of zero is part of the data.
      if (Object.is(value, -0)) return 'number:-0';
      return `number:${value}`;
    case 'string':
      return `string:${JSON.stringify(value)}`;
    case 'boolean':
      return `boolean:${value}`;
    case 'bigint':
      return `bigint:${value.toString()}`;
    default:
      break;
  }
  if (Array.isArray(value)) return `array:[${value.map(canonicalValue).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `object:{${keys.map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(',')}}`;
  }
  return `${typeof value}:${String(value)}`;
}

interface WalkBudget {
  left: number;
}

function report(list: ProjectMismatch[], budget: WalkBudget, mismatch: ProjectMismatch): void {
  if (budget.left <= 0) return;
  budget.left -= 1;
  list.push(mismatch);
}

function kindFor(path: string, base: ProjectMismatchKind): ProjectMismatchKind {
  if (base === 'outputs' || base === 'output-blocks') {
    if (path.includes('.chart') || path.includes('.charts[')) return 'charts';
    if (path.includes('.blocks')) return 'output-blocks';
    return 'outputs';
  }
  if (base === 'models' && path.includes('.coefficients')) return 'model-coefficients';
  if (base === 'worksheets' && (path.includes('.values[') || path.includes('.columns'))) return 'worksheet-data';
  return base;
}

const WORKSHEET_VALUE_PATH = /^worksheets\[(\d+)\]\.columns\[(\d+)\]\.values(?:\[(\d+)\])?$/;

/** Name the column and row a worksheet difference is in, not just its index. */
function humanizeWhere(where: string, sheets: Worksheet[]): string {
  const match = WORKSHEET_VALUE_PATH.exec(where);
  if (!match) return where;
  const column = sheets[Number(match[1])]?.columns[Number(match[2])];
  if (!column) return where;
  const head = `sheet[${match[1]}]/column[${match[2]}]/“${column.name}”`;
  return match[3] === undefined ? `${head}/values` : `${head}/row ${Number(match[3]) + 1}`;
}

/**
 * Structural difference walk: names the first place two values part ways instead
 * of comparing serialised substrings.
 */
function walk(expected: unknown, actual: unknown, path: string, base: ProjectMismatchKind, list: ProjectMismatch[], budget: WalkBudget): void {
  if (budget.left <= 0) return;
  if (canonicalValue(expected) === canonicalValue(actual)) return;

  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      report(list, budget, {
        kind: kindFor(path, base),
        where: path,
        detail: 'An array is compared against a non-array.',
        expected: truncate(canonicalValue(expected)),
        actual: truncate(canonicalValue(actual)),
      });
      return;
    }
    if (expected.length !== actual.length) {
      report(list, budget, {
        kind: kindFor(path, base),
        where: path,
        detail: 'The array length differs (order is part of the data).',
        expected: String(expected.length),
        actual: String(actual.length),
      });
    }
    const shared = Math.min(expected.length, actual.length);
    for (let index = 0; index < shared; index += 1) {
      walk(expected[index], actual[index], `${path}[${index}]`, base, list, budget);
      if (budget.left <= 0) return;
    }
    return;
  }

  const expectedObject = Boolean(expected) && typeof expected === 'object';
  const actualObject = Boolean(actual) && typeof actual === 'object';
  if (expectedObject || actualObject) {
    if (!expectedObject || !actualObject) {
      report(list, budget, {
        kind: kindFor(path, base),
        where: path,
        detail: 'An object is compared against a non-object.',
        expected: truncate(canonicalValue(expected)),
        actual: truncate(canonicalValue(actual)),
      });
      return;
    }
    const want = expected as Record<string, unknown>;
    const got = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const key of [...keys].sort()) {
      if (EXCLUDED_METADATA.has(key)) continue;
      const childPath = path ? `${path}.${key}` : key;
      const hasWant = Object.prototype.hasOwnProperty.call(want, key);
      const hasGot = Object.prototype.hasOwnProperty.call(got, key);
      if (hasWant && !hasGot) {
        report(list, budget, {
          kind: kindFor(childPath, base),
          where: childPath,
          detail: 'A field that the saved project has is missing.',
          expected: truncate(canonicalValue(want[key])),
        });
        continue;
      }
      if (!hasWant && hasGot) {
        report(list, budget, {
          kind: kindFor(childPath, base),
          where: childPath,
          detail: 'A field the saved project did not have is present.',
          actual: truncate(canonicalValue(got[key])),
        });
        continue;
      }
      walk(want[key], got[key], childPath, base, list, budget);
      if (budget.left <= 0) return;
    }
    return;
  }

  report(list, budget, {
    kind: kindFor(path, base),
    where: path,
    detail: 'The value differs.',
    expected: truncate(canonicalValue(expected)),
    actual: truncate(canonicalValue(actual)),
  });
}

const SECTIONS: { key: keyof ProjectComparable; kind: ProjectMismatchKind }[] = [
  { key: 'worksheets', kind: 'worksheets' },
  { key: 'activeSheetId', kind: 'active-sheet' },
  { key: 'settings', kind: 'settings' },
  { key: 'outputs', kind: 'outputs' },
  { key: 'models', kind: 'models' },
  { key: 'figures', kind: 'figures' },
  { key: 'customChartStyles', kind: 'custom-styles' },
];

/**
 * Compare what a project states with what came back from its own file. The
 * order of sheets, outputs, models and figures is part of the state, so a
 * reordering is reported rather than silently accepted.
 */
export function compareProjects(expected: ProjectComparable, actual: ProjectComparable): ProjectComparison {
  const mismatches: ProjectMismatch[] = [];
  const budget: WalkBudget = { left: MAX_MISMATCHES };
  const expectedSheets = expected.worksheets ?? [];
  const actualSheets = actual.worksheets ?? [];
  const counts = {
    worksheets: expectedSheets.length,
    columns: expectedSheets.reduce((sum, sheet) => sum + sheet.columns.length, 0),
    cells: expectedSheets.reduce((sum, sheet) => sum + sheet.columns.reduce((inner, column) => inner + column.values.length, 0), 0),
    outputs: (expected.outputs ?? []).length,
    models: (expected.models ?? []).length,
    figures: (expected.figures ?? []).length,
  };

  for (const section of SECTIONS) {
    walk(expected[section.key], actual[section.key], section.key, section.kind, mismatches, budget);
    if (budget.left <= 0) break;
  }
  for (const mismatch of mismatches) mismatch.where = humanizeWhere(mismatch.where, expectedSheets.length ? expectedSheets : actualSheets);
  return { ok: mismatches.length === 0, mismatches, counts };
}

/** One string that changes whenever any compared record changes. */
export function projectFingerprint(project: ProjectComparable): string {
  const text = canonicalValue({
    worksheets: project.worksheets ?? [],
    activeSheetId: project.activeSheetId ?? '',
    settings: project.settings ?? null,
    outputs: project.outputs ?? [],
    models: project.models ?? [],
    figures: project.figures ?? [],
    customChartStyles: project.customChartStyles ?? [],
  });
  // FNV-1a, 32-bit: enough to tell two projects apart, cheap on a 20k-row sheet.
  // It is an auxiliary change detector; compareProjects is the verification.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${text.length}`;
}
