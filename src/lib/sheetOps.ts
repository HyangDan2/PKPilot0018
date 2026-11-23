/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — worksheet structural edits

   Row/column/cell inserts, deletes, duplicate, type changes, sorting and
   find & replace. Every function returns a NEW worksheet and leaves the input
   untouched, so the caller can record one undo step per call.

   Column identity: a column keeps its `id` (`C1`, `C2` …) for its whole life.
   Inserting shifts the columns but never renames them, and a new column takes
   an id that has never been used, so an analysis that stored `C4` still reads
   the same data after columns are inserted or deleted around it.
   ───────────────────────────────────────────────────────────────────────── */

import type { Column, ColType, Worksheet } from '../types';
import type { Range } from './selection';
import { columnSequence, newColumnId, parseNumberCell } from './project';

type CellValue = number | string | null;

export function valueRowCount(ws: Worksheet): number {
  return Math.max(0, ...ws.columns.map((c) => c.values.length));
}

export function padValues(values: CellValue[], length: number): CellValue[] {
  return Array.from({ length: Math.max(values.length, length) }, (_, i) => values[i] ?? null);
}

function withColumns(ws: Worksheet, columns: Column[]): Worksheet {
  return { ...ws, columns };
}

/* ── rows ──────────────────────────────────────────────────────────────── */

export function insertRows(ws: Worksheet, at: number, count = 1): Worksheet {
  if (count <= 0) return ws;
  const row = Math.max(0, Math.trunc(at));
  return withColumns(ws, ws.columns.map((c) => {
    const values = padValues(c.values, row);
    values.splice(row, 0, ...Array.from({ length: count }, () => null));
    return { ...c, values };
  }));
}

/** Delete rows `from`..`to` (inclusive). A sheet never loses its row grid. */
export function deleteRows(ws: Worksheet, from: number, to: number): Worksheet {
  const r0 = Math.max(0, Math.min(from, to));
  const r1 = Math.max(from, to);
  if (r1 < r0) return ws;
  return withColumns(ws, ws.columns.map((c) => {
    const values = padValues(c.values, r1 + 1).slice();
    values.splice(r0, r1 - r0 + 1);
    return { ...c, values };
  }));
}

/* ── columns ───────────────────────────────────────────────────────────── */

export function makeColumn(ws: Worksheet, type: ColType = 'numeric', rows = valueRowCount(ws), name = ''): Column {
  const id = newColumnId(ws);
  return {
    id,
    name,
    type,
    values: Array.from({ length: Math.max(0, rows) }, () => null),
  };
}

/** Remember the new id in the sheet's sequence so it is never reused. */
function withColumnSequence(ws: Worksheet, columns: Column[]): Worksheet {
  return { ...ws, columns, columnSeq: columnSequence({ ...ws, columns }) };
}

export interface ColumnInsertResult { sheet: Worksheet; index: number; column: Column }

export function insertColumn(ws: Worksheet, at: number, type: ColType = 'numeric'): ColumnInsertResult {
  const index = Math.max(0, Math.min(ws.columns.length, Math.trunc(at)));
  const column = makeColumn(ws, type, valueRowCount(ws));
  const columns = ws.columns.slice();
  columns.splice(index, 0, column);
  return { sheet: withColumnSequence(ws, columns), index, column };
}

export function duplicateColumn(ws: Worksheet, at: number): ColumnInsertResult | null {
  const source = ws.columns[at];
  if (!source) return null;
  const index = at + 1;
  const column: Column = {
    ...source,
    id: newColumnId(ws),
    name: nextCopyName(ws, source.name || source.id),
    values: source.values.slice(),
    description: source.description,
  };
  const columns = ws.columns.slice();
  columns.splice(index, 0, column);
  return { sheet: withColumnSequence(ws, columns), index, column };
}

function nextCopyName(ws: Worksheet, base: string): string {
  const trimmed = base.trim() || 'Column';
  const taken = new Set(ws.columns.map((c) => c.name));
  if (!taken.has(trimmed)) return trimmed;
  let i = 2;
  while (taken.has(`${trimmed} ${i}`)) i += 1;
  return `${trimmed} ${i}`;
}

/** Delete columns `from`..`to`. Refused when it would leave no column at all. */
export function deleteColumns(ws: Worksheet, from: number, to: number): Worksheet | null {
  const c0 = Math.max(0, Math.min(from, to));
  const c1 = Math.min(ws.columns.length - 1, Math.max(from, to));
  if (c0 > c1) return null;
  if (c1 - c0 + 1 >= ws.columns.length) return null;
  const sequence = columnSequence(ws);
  const columns = ws.columns.slice();
  columns.splice(c0, c1 - c0 + 1);
  return { ...ws, columns, columnSeq: sequence };
}

/* ── cells (vertical shifts inside the selected columns) ───────────────── */

export function insertCellsShiftDown(ws: Worksheet, range: Range): Worksheet {
  const r0 = Math.min(range.r0, range.r1);
  const r1 = Math.max(range.r0, range.r1);
  const c0 = Math.min(range.c0, range.c1);
  const c1 = Math.max(range.c0, range.c1);
  const count = r1 - r0 + 1;
  return withColumns(ws, ws.columns.map((c, index) => {
    if (index < c0 || index > c1) return c;
    const values = padValues(c.values, r1 + 1);
    values.splice(r0, 0, ...Array.from({ length: count }, () => null));
    return { ...c, values };
  }));
}

export function deleteCellsShiftUp(ws: Worksheet, range: Range): Worksheet {
  const r0 = Math.min(range.r0, range.r1);
  const r1 = Math.max(range.r0, range.r1);
  const c0 = Math.min(range.c0, range.c1);
  const c1 = Math.max(range.c0, range.c1);
  return withColumns(ws, ws.columns.map((c, index) => {
    if (index < c0 || index > c1) return c;
    const values = padValues(c.values, r1 + 1).slice();
    values.splice(r0, r1 - r0 + 1);
    return { ...c, values };
  }));
}

/* ── column properties ─────────────────────────────────────────────────── */

/** Values are kept meaningful: switching to numeric parses what it can, and
 *  switching to text keeps the displayed value instead of dropping it. */
export function coerceColumn(values: CellValue[], type: ColType): CellValue[] {
  return values.map((value) => {
    if (value === null || value === undefined || value === '') return null;
    if (type === 'numeric') {
      if (typeof value === 'number') return value;
      const parsed = parseNumberCell(String(value));
      // Keep text that is not a number instead of silently blanking the cell.
      return parsed !== null ? parsed : String(value);
    }
    if (type === 'date') return typeof value === 'string' ? value : String(value);
    return typeof value === 'string' ? value : String(value);
  });
}

export function setColumnType(ws: Worksheet, index: number, type: ColType): Worksheet {
  const column = ws.columns[index];
  if (!column || column.type === type) return ws;
  return withColumns(ws, ws.columns.map((c, i) => (i === index ? { ...c, type, values: coerceColumn(c.values, type) } : c)));
}

export function setColumnName(ws: Worksheet, index: number, name: string): Worksheet {
  return withColumns(ws, ws.columns.map((c, i) => (i === index ? { ...c, name } : c)));
}

export function setColumnDescription(ws: Worksheet, index: number, description: string): Worksheet {
  return withColumns(ws, ws.columns.map((c, i) => (i === index ? { ...c, description } : c)));
}

/** Sort every row of the sheet by one column. Blanks always sink to the end. */
export function sortByColumn(ws: Worksheet, index: number, direction: 'asc' | 'desc'): Worksheet {
  const column = ws.columns[index];
  if (!column) return ws;
  const rows = valueRowCount(ws);
  const sign = direction === 'asc' ? 1 : -1;
  const numeric = column.type === 'numeric';
  const key = (row: number): CellValue => column.values[row] ?? null;
  const filled: number[] = [];
  const blanks: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    const value = key(row);
    if (value === null || value === undefined || value === '') blanks.push(row);
    else filled.push(row);
  }
  filled.sort((a, b) => {
    const va = key(a);
    const vb = key(b);
    if (numeric) {
      const na = typeof va === 'number' ? va : Number(va);
      const nb = typeof vb === 'number' ? vb : Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return (na - nb) * sign;
    }
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * sign;
  });
  const order = [...filled, ...blanks];
  return withColumns(ws, ws.columns.map((c) => ({
    ...c,
    values: order.map((row) => c.values[row] ?? null),
  })));
}

/* ── find & replace ────────────────────────────────────────────────────── */

export interface FindMatch { row: number; col: number }
export interface FindOptions { caseSensitive?: boolean; wholeCell?: boolean }

function textOf(value: CellValue): string {
  return value === null || value === undefined ? '' : String(value);
}

export function findMatches(ws: Worksheet, query: string, options: FindOptions = {}): FindMatch[] {
  const needle = options.caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];
  const out: FindMatch[] = [];
  const rows = valueRowCount(ws);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < ws.columns.length; col += 1) {
      const text = textOf(ws.columns[col].values[row]);
      if (!text) continue;
      const hay = options.caseSensitive ? text : text.toLowerCase();
      const hit = options.wholeCell ? hay === needle : hay.includes(needle);
      if (hit) out.push({ row, col });
    }
  }
  return out;
}

function replaceInCell(value: CellValue, type: ColType, query: string, replacement: string, options: FindOptions): CellValue {
  const text = textOf(value);
  if (!text) return value;
  const flags = options.caseSensitive ? 'g' : 'gi';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const next = options.wholeCell
    ? (options.caseSensitive
      ? (text === query ? replacement : text)
      : (text.toLowerCase() === query.toLowerCase() ? replacement : text))
    : text.replace(new RegExp(escaped, flags), replacement);
  if (next === text) return value;
  if (type === 'numeric') {
    const parsed = parseNumberCell(next);
    return parsed !== null ? parsed : next.trim() === '' ? null : next;
  }
  return next.trim() === '' ? null : next;
}

export function replaceOne(ws: Worksheet, cell: FindMatch, query: string, replacement: string, options: FindOptions = {}): Worksheet {
  const column = ws.columns[cell.col];
  if (!column) return ws;
  return withColumns(ws, ws.columns.map((c, index) => {
    if (index !== cell.col) return c;
    const values = c.values.slice();
    values[cell.row] = replaceInCell(values[cell.row] ?? null, c.type, query, replacement, options);
    return { ...c, values };
  }));
}

export function replaceAll(ws: Worksheet, query: string, replacement: string, options: FindOptions = {}): { sheet: Worksheet; count: number } {
  let count = 0;
  const columns = ws.columns.map((c) => {
    const values = c.values.map((value) => {
      const before = value;
      const after = replaceInCell(value, c.type, query, replacement, options);
      if (after !== before) count += 1;
      return after;
    });
    return { ...c, values };
  });
  return { sheet: withColumns(ws, columns), count };
}

