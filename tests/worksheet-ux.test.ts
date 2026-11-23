/* ─────────────────────────────────────────────────────────────────────────
   Stage 1 — worksheet structural edits: rows, columns, cells, type changes,
   sorting, find & replace, and the C-column identity rule.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import type { Worksheet } from '../src/types';
import { newColumnId, parseProject, serializeProject } from '../src/lib/project';
import {
  deleteCellsShiftUp,
  deleteColumns,
  deleteRows,
  duplicateColumn,
  findMatches,
  insertCellsShiftDown,
  insertColumn,
  insertRows,
  makeColumn,
  replaceAll,
  replaceOne,
  setColumnDescription,
  setColumnType,
  sortByColumn,
  valueRowCount,
} from '../src/lib/sheetOps';

function sheet(): Worksheet {
  return {
    id: 'ws-1',
    name: 'Test',
    columns: [
      { id: 'C1', name: 'Value', type: 'numeric', values: [30, 10, 20] },
      { id: 'C2', name: 'Label', type: 'text', values: ['c', 'a', 'b'] },
    ],
  };
}

describe('column identity', () => {
  it('gives every new column an id that was never used', () => {
    const ws = sheet();
    expect(newColumnId(ws)).toBe('C3');
    const withGap = { ...ws, columns: [...ws.columns, { id: 'C7', name: '', type: 'text' as const, values: [] }] };
    expect(newColumnId(withGap)).toBe('C8');
  });

  it('keeps existing ids when a column is inserted in the middle', () => {
    const result = insertColumn(sheet(), 1);
    expect(result.sheet.columns.map((c) => c.id)).toEqual(['C1', 'C3', 'C2']);
    expect(result.sheet.columns[0].values).toEqual([30, 10, 20]);
    expect(result.sheet.columns[2].values).toEqual(['c', 'a', 'b']);
    expect(result.index).toBe(1);
    expect(result.column.id).toBe('C3');
  });

  it('does not recycle the id of a deleted column', () => {
    const withoutC2 = deleteColumns(sheet(), 1, 1);
    expect(withoutC2?.columns.map((c) => c.id)).toEqual(['C1']);
    expect(newColumnId(withoutC2 as Worksheet)).toBe('C3');
  });

  it('refuses to delete every column', () => {
    expect(deleteColumns(sheet(), 0, 1)).toBeNull();
    expect(deleteColumns(sheet(), 5, 9)).toBeNull();
  });

  it('duplicates a column with a fresh id and a distinct name', () => {
    const result = duplicateColumn(sheet(), 0);
    expect(result?.sheet.columns.map((c) => c.id)).toEqual(['C1', 'C3', 'C2']);
    expect(result?.column.values).toEqual([30, 10, 20]);
    expect(result?.column.name).toBe('Value 2');
    expect(result?.column.id).not.toBe('C1');
  });

  it('creates a blank column at the sheet height', () => {
    const column = makeColumn(sheet());
    expect(column.values).toHaveLength(3);
    expect(column.values.every((v) => v === null)).toBe(true);
  });
});

describe('rows', () => {
  it('inserts rows without disturbing the cells around them', () => {
    const next = insertRows(sheet(), 1, 2);
    expect(next.columns[0].values).toEqual([30, null, null, 10, 20]);
    expect(next.columns[1].values).toEqual(['c', null, null, 'a', 'b']);
    expect(valueRowCount(next)).toBe(5);
  });

  it('deletes a run of rows', () => {
    const next = deleteRows(sheet(), 0, 1);
    expect(next.columns[0].values).toEqual([20]);
    expect(next.columns[1].values).toEqual(['b']);
  });

  it('leaves the input worksheet untouched', () => {
    const before = sheet();
    insertRows(before, 0, 1);
    deleteRows(before, 0, 0);
    expect(before.columns[0].values).toEqual([30, 10, 20]);
  });
});

describe('cell inserts and deletes', () => {
  it('shifts cells down inside the selected columns only', () => {
    const next = insertCellsShiftDown(sheet(), { r0: 1, c0: 0, r1: 1, c1: 0 });
    expect(next.columns[0].values.slice(0, 3)).toEqual([30, null, 10]);
    expect(next.columns[1].values).toEqual(['c', 'a', 'b']);
  });

  it('pulls cells up after a delete', () => {
    const next = deleteCellsShiftUp(sheet(), { r0: 0, c0: 1, r1: 0, c1: 1 });
    expect(next.columns[1].values).toEqual(['a', 'b']);
    expect(next.columns[0].values).toEqual([30, 10, 20]);
  });
});

describe('column properties', () => {
  it('parses text into numbers when the type becomes numeric', () => {
    const ws = sheet();
    ws.columns[1].values = ['1', '2', 'x'];
    ws.columns[1].type = 'text';
    const next = setColumnType(ws, 1, 'numeric');
    expect(next.columns[1].values).toEqual([1, 2, 'x']);
    expect(next.columns[1].type).toBe('numeric');
  });

  it('keeps every value as text when the type becomes text', () => {
    const next = setColumnType(sheet(), 0, 'text');
    expect(next.columns[0].values).toEqual(['30', '10', '20']);
  });

  it('stores and updates a column description', () => {
    const next = setColumnDescription(sheet(), 0, 'Thickness in mm');
    expect(next.columns[0].description).toBe('Thickness in mm');
    expect(setColumnDescription(next, 0, '').columns[0].description).toBe('');
  });
});

describe('sorting', () => {
  it('reorders whole rows by the chosen column', () => {
    const next = sortByColumn(sheet(), 0, 'asc');
    expect(next.columns[0].values).toEqual([10, 20, 30]);
    expect(next.columns[1].values).toEqual(['a', 'b', 'c']);
  });

  it('sorts descending and sinks blanks to the end', () => {
    const ws = sheet();
    ws.columns[0].values = [3, null, 1];
    const next = sortByColumn(ws, 0, 'desc');
    expect(next.columns[0].values).toEqual([3, 1, null]);
    expect(next.columns[1].values).toEqual(['c', 'b', 'a']);
  });

  it('sorts text columns alphabetically', () => {
    const next = sortByColumn(sheet(), 1, 'asc');
    expect(next.columns[1].values).toEqual(['a', 'b', 'c']);
    expect(next.columns[0].values).toEqual([10, 20, 30]);
  });

  it('ignores a column index that does not exist', () => {
    const ws = sheet();
    expect(sortByColumn(ws, 9, 'asc')).toBe(ws);
  });
});

describe('find & replace', () => {
  it('finds every matching cell in row-major order', () => {
    const ws = sheet();
    ws.columns[1].values = ['Alpha', 'alpha', 'Beta'];
    expect(findMatches(ws, 'alpha')).toEqual([{ row: 0, col: 1 }, { row: 1, col: 1 }]);
    expect(findMatches(ws, 'alpha', { caseSensitive: true })).toEqual([{ row: 1, col: 1 }]);
    expect(findMatches(ws, 'alph', { wholeCell: true })).toEqual([]);
  });

  it('replaces substrings and keeps numeric columns numeric', () => {
    const ws = sheet();
    ws.columns[1].values = ['Line 1', 'Line 2', 'Line 3'];
    const result = replaceAll(ws, 'Line', 'Cell');
    expect(result.count).toBe(3);
    expect(result.sheet.columns[1].values).toEqual(['Cell 1', 'Cell 2', 'Cell 3']);

    const numeric = sheet();
    numeric.columns[0].values = [10, 11, 12];
    const numbers = replaceAll(numeric, '1', '9');
    expect(numbers.sheet.columns[0].values).toEqual([90, 99, 92]);
  });

  it('returns the same count for a no-op query', () => {
    const result = replaceAll(sheet(), 'zzz', 'x');
    expect(result.count).toBe(0);
  });

  it('replaces one cell without touching its neighbours', () => {
    const ws = sheet();
    ws.columns[1].values = ['aa', 'aa', 'aa'];
    const next = replaceOne(ws, { row: 1, col: 1 }, 'aa', 'bb');
    expect(next.columns[1].values).toEqual(['aa', 'bb', 'aa']);
  });
});


describe('project files stay compatible', () => {
  it('round-trips column descriptions and the id sequence', () => {
    const ws = sheet();
    ws.columns[0].description = 'Thickness in mm';
    ws.columnSeq = 5;
    const text = serializeProject({ worksheets: [ws], activeSheetId: ws.id, settings: { theme: 'light', lang: 'en' }, outputs: [] });
    const parsed = parseProject(text);
    expect(parsed.worksheets[0].columns[0].description).toBe('Thickness in mm');
    expect(parsed.worksheets[0].columnSeq).toBe(5);
    expect(newColumnId(parsed.worksheets[0])).toBe('C6');
  });

  it('loads a legacy project with neither new field', () => {
    const legacy = JSON.stringify({
      format: 'sigrun-project',
      version: 1,
      worksheets: [{ id: 'ws-1', name: 'Old', columns: [{ id: 'C1', name: 'x', type: 'numeric', values: [1, 2] }] }],
      activeSheetId: 'ws-1',
      settings: { theme: 'light', lang: 'ko' },
      outputs: [],
    });
    const parsed = parseProject(legacy);
    expect(parsed.worksheets[0].columns[0].description).toBeUndefined();
    expect(newColumnId(parsed.worksheets[0])).toBe('C2');
    expect(parsed.settings.lang).toBe('ko');
  });
});
