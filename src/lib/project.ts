/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — project files (.mpx.json) and CSV interchange
   ───────────────────────────────────────────────────────────────────────── */

import type { Column, ColType, ProjectFile, Settings, OutputDoc, Worksheet } from '../types';
import { makeWorksheet, uid } from './datasets';

export interface ProjectState {
  worksheets: Worksheet[];
  activeSheetId: string;
  settings: Settings;
  outputs: OutputDoc[];
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
  };
}

export function serializeProject(state: ProjectState): string {
  return JSON.stringify(buildProject(state), null, 2);
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
  return { worksheets, activeSheetId, settings, outputs: Array.isArray(file.outputs) ? file.outputs : [] };
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
  const firstLine = clean.split(/\r?\n/)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
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
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function inferType(values: string[]): ColType {
  const nonEmpty = values.filter((v) => v.trim() !== '');
  if (!nonEmpty.length) return 'text';
  if (nonEmpty.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))) return 'date';
  if (nonEmpty.every((v) => isFinite(Number(v.replace(/,/g, ''))))) return 'numeric';
  return 'text';
}

export function csvToWorksheet(text: string, name = 'Imported'): Worksheet {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('file.error');
  const width = Math.max(...rows.map((r) => r.length));
  const first = rows[0];
  const hasHeader = first.every((cell) => cell.trim() !== '' && !isFinite(Number(cell.replace(/,/g, ''))));
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

export function newColumnId(ws: Worksheet): string {
  const used = new Set(ws.columns.map((c) => c.id));
  let i = 1;
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
