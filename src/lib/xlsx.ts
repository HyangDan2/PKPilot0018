/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — Excel (.xlsx) interchange
   Pure-browser OOXML through `read-excel-file` / `write-excel-file` (both ship
   a fflate-based writer/reader with no Node polyfills). A workbook's sheets
   become worksheets: the first row is the header, numbers / text / dates are
   typed per column, blank cells stay null and the column type is inferred from
   the values that are present.
   ───────────────────────────────────────────────────────────────────────── */

import readXlsxFile from 'read-excel-file/universal';
import writeXlsxFile from 'write-excel-file/universal';
import type { ColType, Column, Worksheet } from '../types';
import { makeWorksheet } from './datasets';

type Cell = string | number | boolean | Date | null;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Dates are stored as the user's local calendar day (no timezone shift). */
export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function columnType(values: Cell[]): ColType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (!present.length) return 'numeric';
  // A date column must be dates ALL the way down. A single Date cell in a
  // column of serial numbers used to force 'date', which turned every number
  // into an invalid date and lost the data; mixed content is kept as text so
  // nothing is reinterpreted.
  const dateLike = (v: Cell): boolean => v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()));
  if (present.every(dateLike)) return 'date';
  const numeric = present.every((v) => (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))));
  if (numeric) return 'numeric';
  return 'text';
}

function normalizeCell(value: Cell): number | string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return dateToIso(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return isFinite(value) ? value : null;
  const text = String(value);
  return text === '' ? null : text;
}

/** Excel sheet names: 31 chars max and no []:*?/\ characters. */
export function safeSheetName(name: string, used: Set<string>): string {
  const base = (name || 'Sheet').replace(/[[\]:*?/\\]/g, '-').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

export interface WorkbookSheet {
  name: string;
  rows: Cell[][];
}

/** Rows → worksheet with inferred column types. */
export interface ImportOptions {
  /** first row holds the column names (default true). With false the first row
   *  stays a data row and the columns are named C1, C2, … */
  header?: boolean;
}

export function rowsToWorksheet(rows: Cell[][], name: string, options: ImportOptions = {}): Worksheet {
  const width = rows.reduce((a, row) => Math.max(a, row.length), 0);
  if (!width) throw new Error('xlsx.empty');
  const useHeader = options.header !== false;
  const body = useHeader ? rows.slice(1) : rows;
  const header = useHeader ? rows[0] ?? [] : [];
  const columns: Omit<Column, 'id'>[] = [];
  for (let c = 0; c < width; c += 1) {
    const raw = body.map((row) => normalizeCell(row[c] ?? null));
    const headerText = header[c] === null || header[c] === undefined || header[c] === ''
      ? ''
      : header[c] instanceof Date ? dateToIso(header[c] as Date) : String(header[c]);
    const type = columnType(body.map((row) => row[c] ?? null));
    const values = raw.map((v) => {
      if (v === null) return null;
      if (type === 'numeric') {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
        return isFinite(n) ? n : null;
      }
      return v;
    });
    columns.push({ name: headerText || `C${c + 1}`, type, values });
  }
  return makeWorksheet(name, columns);
}

export function workbookToWorksheets(book: WorkbookSheet[], options: ImportOptions = {}): Worksheet[] {
  const sheets = book.filter((sheet) => sheet.rows.some((row) => row.some((cell) => cell !== null && cell !== '')));
  if (!sheets.length) throw new Error('xlsx.empty');
  return sheets.map((sheet) => rowsToWorksheet(sheet.rows, sheet.name, options));
}

/** Raw rows of every sheet, for the import preview dialog (no header assumption). */
export async function readXlsxRows(input: Blob | ArrayBuffer): Promise<WorkbookSheet[]> {
  const sheets = await readXlsxFile(input);
  return sheets.map((sheet) => ({
    name: sheet.sheet,
    rows: (sheet.data as Cell[][]).map((row) => row.map((cell) => cell ?? null)),
  })).filter((sheet) => sheet.rows.some((row) => row.some((cell) => cell !== null && cell !== '')));
}

/** Read every sheet of an .xlsx file (File / Blob / ArrayBuffer). */
export async function readXlsx(input: Blob | ArrayBuffer, options: ImportOptions = {}): Promise<Worksheet[]> {
  return workbookToWorksheets(await readXlsxRows(input), options);
}

/** yyyy-mm-dd → local Date (avoids the UTC shift of `new Date(string)`). */
function parseIsoDate(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Build an .xlsx workbook for one or more worksheets and return it as a Blob.
 * Numeric columns are written as numbers, date columns as real Excel dates and
 * everything else as text, so a re-import restores the column types.
 */
export async function writeXlsx(sheets: Worksheet[]): Promise<Blob> {
  if (!sheets.length) throw new Error('xlsx.empty');
  const used = new Set<string>();
  const payload = sheets.map((sheet) => {
    const count = sheet.columns.reduce((a, col) => Math.max(a, col.values.length), 0);
    const data: unknown[][] = [sheet.columns.map((col) => ({ value: col.name || col.id, fontWeight: 'bold' as const }))];
    for (let r = 0; r < count; r += 1) {
      data.push(sheet.columns.map((col) => {
        const raw = col.values[r];
        if (raw === null || raw === undefined || raw === '') return null;
        if (col.type === 'numeric') {
          const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
          return isFinite(value) ? { value, type: Number } : { value: String(raw), type: String };
        }
        if (col.type === 'date') {
          const date = parseIsoDate(String(raw));
          if (date) return { value: date, type: Date, format: 'yyyy-mm-dd' };
        }
        return { value: String(raw), type: String };
      }));
    }
    return { sheet: safeSheetName(sheet.name, used), data };
  });
  return writeXlsxFile(payload as never).toBlob();
}

/** File name for the exported workbook. */
export function xlsxFileName(sheets: Worksheet[]): string {
  const base = sheets.length === 1 ? sheets[0].name : 'Sigrun-workbook';
  return `${base.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Sigrun'}.xlsx`;
}

export const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
