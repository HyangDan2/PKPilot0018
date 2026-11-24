/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — project files (.sigrun.json) and CSV interchange
   Legacy .mpx.json projects still load; Minitab's native binary .mpx is
   explicitly rejected with an explanation.
   ───────────────────────────────────────────────────────────────────────── */

import type { Column, ColType, ProjectFile, Settings, OutputDoc, StoredModelFileEntry, Worksheet } from '../types';
import type { CustomChartStyle } from './chartStyles';
import { parseStoredModels, type StoredModel } from './modelStore';
import type { LayoutDoc } from './graphLayout';
import { makeWorksheet, uid } from './datasets';

export interface ProjectState {
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
    version: 1,
    savedAt: new Date().toISOString(),
    app: 'HD2Lab Sigrún',
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
  return `sigrun-${y}-${m}-${d}.sigrun.json`;
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

export function parseProject(text: string): ProjectState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('file.error');
  }
  const file = data as Partial<ProjectFile>;
  if (!file || file.format !== 'sigrun-project' || !Array.isArray(file.worksheets)) throw new Error('file.error');
  const worksheets = file.worksheets.filter((ws): ws is Worksheet =>
    Boolean(ws) && typeof ws.id === 'string' && typeof ws.name === 'string' && Array.isArray(ws.columns) && ws.columns.every(isColumn),
  );
  if (!worksheets.length) throw new Error('file.error');
  const activeSheetId = worksheets.some((ws) => ws.id === file.activeSheetId) ? (file.activeSheetId as string) : worksheets[0].id;
  const settings: Settings = {
    theme: file.settings?.theme === 'dark' ? 'dark' : 'light',
    lang: file.settings?.lang === 'ko' ? 'ko' : 'en',
  };
  return {
    worksheets,
    activeSheetId,
    settings,
    outputs: Array.isArray(file.outputs) ? file.outputs : [],
    ...(Array.isArray(file.customChartStyles) ? { customChartStyles: file.customChartStyles } : {}),
    models: parseStoredModels(file.models),
    ...(Array.isArray(file.figures) ? { figures: (file.figures as unknown as LayoutDoc[]).filter((entry) => Boolean(entry) && entry.format === 'sigrun-layout') } : {}),
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
