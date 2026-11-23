/* ─────────────────────────────────────────────────────────────────────────
   Stage 1 — worksheet selection model.

   The grid gestures are all pure functions, so each mouse and key rule can be
   asserted without a browser: Shift extension, Ctrl toggling and splitting,
   row/column modes, boundary jumps and the clipboard layout.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import type { Worksheet } from '../src/types';
import {
  addExtend,
  clampSelection,
  clipboardRanges,
  coversCell,
  createSelection,
  dataEdge,
  describeSelection,
  extendTo,
  gridSize,
  lastUsedCell,
  makeRange,
  moveTo,
  normalizeRange,
  pasteRange,
  primaryRange,
  rowEnd,
  selectAll,
  selectColumn,
  selectRow,
  selectedColumns,
  selectedRows,
  selectionBounds,
  selectionToText,
  stepActive,
  subtractCell,
  toggleSelection,
  usedExtent,
} from '../src/lib/selection';

function sheet(): Worksheet {
  return {
    id: 'ws-1',
    name: 'Test',
    columns: [
      { id: 'C1', name: 'Value', type: 'numeric', values: [10, 2, null, 4] },
      { id: 'C2', name: 'Label', type: 'text', values: ['a', 'b', 'c', 'd'] },
      { id: 'C3', name: 'Extra', type: 'numeric', values: [5, null, null, null] },
    ],
  };
}

describe('range helpers', () => {
  it('normalizes a rectangle drawn in any direction', () => {
    expect(makeRange({ row: 4, col: 3 }, { row: 1, col: 0 })).toEqual({ r0: 1, c0: 0, r1: 4, c1: 3 });
    expect(normalizeRange({ r0: 5, c0: 2, r1: 1, c1: 0 })).toEqual({ r0: 1, c0: 0, r1: 5, c1: 2 });
  });

  it('splits a rectangle around one deselected cell', () => {
    const pieces = subtractCell([{ r0: 0, c0: 0, r1: 2, c1: 2 }], { row: 1, col: 1 });
    expect(pieces).toHaveLength(4);
    expect(pieces.every((p) => !coversCell({ ...createSelection({ row: 0, col: 0 }), ranges: [p] }, 1, 1))).toBe(true);
    expect(pieces.reduce((n, p) => n + (p.r1 - p.r0 + 1) * (p.c1 - p.c0 + 1), 0)).toBe(8);
  });
});

describe('mouse selection gestures', () => {
  const size = { rows: 30, cols: 3 };

  it('selects a single cell on a plain click', () => {
    const state = createSelection({ row: 2, col: 1 });
    expect(state.ranges).toEqual([{ r0: 2, c0: 1, r1: 2, c1: 1 }]);
    expect(state.anchor).toEqual({ row: 2, col: 1 });
    expect(state.activeCell).toEqual({ row: 2, col: 1 });
    expect(state.mode).toBe('cell');
  });

  it('extends from the anchor with Shift+click', () => {
    let state = createSelection({ row: 1, col: 1 });
    state = extendTo(state, { row: 4, col: 2 });
    expect(state.ranges).toEqual([{ r0: 1, c0: 1, r1: 4, c1: 2 }]);
    expect(state.anchor).toEqual({ row: 1, col: 1 });
    expect(state.activeCell).toEqual({ row: 4, col: 2 });
    // A second Shift+click still grows from the same anchor, not the last click.
    state = extendTo(state, { row: 2, col: 0 });
    expect(state.ranges).toEqual([{ r0: 1, c0: 0, r1: 2, c1: 1 }]);
  });

  it('adds and removes non-adjacent cells with Ctrl+click', () => {
    let state = createSelection({ row: 0, col: 0 });
    state = toggleSelection(state, { row: 3, col: 2 });
    expect(state.ranges).toHaveLength(2);
    expect(coversCell(state, 0, 0, size)).toBe(true);
    expect(coversCell(state, 3, 2, size)).toBe(true);
    expect(coversCell(state, 2, 1, size)).toBe(false);
    // Clicking a selected cell takes it out again.
    state = toggleSelection(state, { row: 3, col: 2 });
    expect(state.ranges).toHaveLength(1);
    expect(coversCell(state, 3, 2, size)).toBe(false);
  });

  it('never drops the last selected cell', () => {
    const state = createSelection({ row: 1, col: 1 });
    const next = toggleSelection(state, { row: 1, col: 1 });
    expect(next.ranges).toHaveLength(1);
    expect(coversCell(next, 1, 1, size)).toBe(true);
  });

  it('keeps the selection and adds a range with Ctrl+Shift+click', () => {
    let state = createSelection({ row: 0, col: 0 });
    state = toggleSelection(state, { row: 4, col: 1 });
    const before = state.ranges.length;
    state = addExtend(state, { row: 2, col: 2 });
    expect(state.ranges.length).toBe(before + 1);
    expect(state.mode).toBe('range');
  });

  it('selects whole rows and whole columns, ignoring the other axis', () => {
    const rows = selectRow(createSelection({ row: 0, col: 0 }), 3, size);
    expect(rows.mode).toBe('row');
    expect(rows.ranges).toEqual([{ r0: 3, c0: 0, r1: 3, c1: 2 }]);
    expect(coversCell(rows, 3, 2, size)).toBe(true);
    expect(coversCell(rows, 2, 2, size)).toBe(false);

    const cols = selectColumn(createSelection({ row: 0, col: 0 }), 1, size);
    expect(cols.mode).toBe('column');
    // A column stays selected as rows are appended below the data.
    expect(coversCell(cols, 29, 1, size)).toBe(true);
    expect(coversCell(cols, 29, 0, size)).toBe(false);
  });

  it('extends rows and columns with Shift on a header', () => {
    let state = selectRow(createSelection({ row: 2, col: 0 }), 2, size);
    state = selectRow(state, 5, size, true);
    expect(state.ranges).toEqual([{ r0: 2, c0: 0, r1: 5, c1: 2 }]);

    let colState = selectColumn(createSelection({ row: 0, col: 1 }), 1, size);
    colState = selectColumn(colState, 2, size, true);
    expect(colState.ranges).toEqual([{ r0: 0, c0: 1, r1: 29, c1: 2 }]);
  });

  it('selects the entire sheet', () => {
    const all = selectAll(size);
    expect(all.mode).toBe('all');
    expect(coversCell(all, 10, 2, size)).toBe(true);
    expect(selectedRows(all)).toHaveLength(30);
    expect(selectedColumns(all)).toEqual([0, 1, 2]);
  });
});

describe('keyboard movement', () => {
  const size = { rows: 30, cols: 3 };

  it('moves the caret and clamps at the edges', () => {
    let state = createSelection({ row: 0, col: 0 });
    state = stepActive(state, -1, -1, size);
    expect(state.activeCell).toEqual({ row: 0, col: 0 });
    state = moveTo(state, { row: 99, col: 99 }, size);
    expect(state.activeCell).toEqual({ row: 29, col: 2 });
  });

  it('extends the range with Shift+arrow and collapses on the next plain arrow', () => {
    let state = createSelection({ row: 2, col: 1 });
    state = stepActive(state, 1, 0, size, true);
    state = stepActive(state, 1, 0, size, true);
    expect(state.ranges).toEqual([{ r0: 2, c0: 1, r1: 4, c1: 1 }]);
    state = stepActive(state, 1, 0, size, false);
    expect(state.ranges).toEqual([{ r0: 5, c0: 1, r1: 5, c1: 1 }]);
  });

  it('jumps to the edge of a data block with Ctrl+arrow', () => {
    const data = sheet();
    // C1 = 10, 2, blank, 4
    expect(dataEdge(data, { row: 0, col: 0 }, 1, 0, size)).toEqual({ row: 1, col: 0 });
    expect(dataEdge(data, { row: 1, col: 0 }, 1, 0, size)).toEqual({ row: 3, col: 0 });
    expect(dataEdge(data, { row: 3, col: 0 }, 1, 0, size)).toEqual({ row: 29, col: 0 });
    expect(dataEdge(data, { row: 3, col: 0 }, 0, 1, size)).toEqual({ row: 3, col: 1 });
    // Right from a blank cell skips to the next filled column.
    expect(dataEdge(data, { row: 2, col: 0 }, 0, 1, size)).toEqual({ row: 2, col: 1 });
  });

  it('jumps to the used extent for Ctrl+End and to the row end for End', () => {
    const data = sheet();
    expect(lastUsedCell(data, size)).toEqual({ row: 3, col: 2 });
    expect(rowEnd(data, 3, size)).toEqual({ row: 3, col: 1 });
    expect(rowEnd(data, 0, size)).toEqual({ row: 0, col: 2 });
    expect(usedExtent(data, size)).toEqual({ lastRow: 3, lastCol: 2 });
  });
});

describe('clipboard policy', () => {
  const size = { rows: 30, cols: 3 };

  it('copies one range as tab-separated rows', () => {
    const state = extendTo(createSelection({ row: 0, col: 0 }), { row: 1, col: 1 });
    expect(selectionToText(sheet(), state, size)).toBe('10\ta\n2\tb');
  });

  it('separates multiple blocks with one blank line', () => {
    let state = createSelection({ row: 0, col: 0 });
    state = toggleSelection(state, { row: 0, col: 1 });
    expect(selectionToText(sheet(), state, size)).toBe('10\n\na');
  });

  it('refuses paste into a multi-block selection but allows a single range', () => {
    const multi = toggleSelection(createSelection({ row: 0, col: 0 }), { row: 2, col: 1 });
    expect(pasteRange(multi)).toBeNull();
    const single = extendTo(createSelection({ row: 0, col: 0 }), { row: 2, col: 1 });
    expect(pasteRange(single)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 });
  });

  it('clips whole-column copies to the used rows', () => {
    const state = selectColumn(createSelection({ row: 0, col: 1 }), 1, size);
    expect(clipboardRanges(state, sheet(), size)).toEqual([{ r0: 0, c0: 1, r1: 3, c1: 1 }]);
    expect(selectionToText(sheet(), state, size)).toBe('a\nb\nc\nd');
  });

  it('reports the bounding box and a readable label', () => {
    const state = toggleSelection(createSelection({ row: 0, col: 0 }), { row: 3, col: 2 });
    expect(selectionBounds(state)).toEqual({ r0: 0, c0: 0, r1: 3, c1: 2 });
    expect(describeSelection(state, sheet())).toBe('C11, C34');
    expect(describeSelection(extendTo(createSelection({ row: 0, col: 0 }), { row: 2, col: 1 }), sheet())).toBe('C11:C23');
  });

  it('labels whole rows and whole columns the way the status bar shows them', () => {
    const colState = selectColumn(createSelection({ row: 0, col: 1 }), 1, size);
    expect(describeSelection(colState, sheet())).toBe('C2');
    const colRange = selectColumn(colState, 2, size, true);
    expect(describeSelection(colRange, sheet())).toBe('C2:C3');
    const rowState = selectRow(createSelection({ row: 1, col: 0 }), 1, size);
    expect(describeSelection(rowState, sheet())).toBe('2');
    const rowRange = selectRow(rowState, 3, size, true);
    expect(describeSelection(rowRange, sheet())).toBe('2:4');
  });

  it('keeps the primary range normalized', () => {
    expect(primaryRange(createSelection({ row: 1, col: 2 }))).toEqual({ r0: 1, c0: 2, r1: 1, c1: 2 });
  });
});

describe('selection survives structural edits', () => {
  it('pulls the selection back inside the sheet after columns are deleted', () => {
    const state = extendTo(createSelection({ row: 0, col: 0 }), { row: 2, col: 4 });
    const clamped = clampSelection(state, { rows: 30, cols: 2 });
    expect(clamped.ranges).toEqual([{ r0: 0, c0: 0, r1: 2, c1: 1 }]);
    expect(clamped.activeCell).toEqual({ row: 2, col: 1 });
  });

  it('derives the grid size from the worksheet with a 30-row floor', () => {
    expect(gridSize(sheet())).toEqual({ rows: 30, cols: 3 });
    const tall = sheet();
    tall.columns[0].values = Array.from({ length: 45 }, () => 1);
    expect(gridSize(tall)).toEqual({ rows: 51, cols: 3 });
  });

  it('moves the clicked cell even when it is already in the selection', () => {
    let state = extendTo(createSelection({ row: 0, col: 0 }), { row: 3, col: 1 });
    state = { ...state, activeCell: { row: 2, col: 1 } };
    expect(coversCell(state, 2, 1, { rows: 30, cols: 3 })).toBe(true);
    expect(state.ranges).toHaveLength(1);
  });
});

describe('explicit blocks and whole-sheet copies', () => {
  const size = { rows: 30, cols: 3 };

  it('keeps blank rows that were explicitly selected', () => {
    const state = extendTo(createSelection({ row: 0, col: 0 }), { row: 5, col: 0 });
    expect(selectionToText(sheet(), state, size).split('\n')).toHaveLength(6);
  });

  it('copies only the used part of the sheet for Select all', () => {
    const state = selectAll(size);
    expect(clipboardRanges(state, sheet(), size)).toEqual([{ r0: 0, c0: 0, r1: 3, c1: 2 }]);
  });
});
