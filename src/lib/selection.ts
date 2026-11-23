/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — worksheet selection model

   The grid used to keep a single anchor cell plus one rectangle. That cannot
   express Shift-click extension, Ctrl-click multi-selection or whole rows and
   columns, so the model lives here on its own: every mouse gesture and key
   stroke below is a pure function of the previous selection, and the component
   only renders the result.

   Terms
     anchor      the fixed corner a Shift extension grows from
     activeCell  the cell with the focus ring; keys move from here
     ranges      one rectangle per selected block (non-contiguous is allowed)
     mode        what the selection means: a cell block, whole rows, whole
                 columns, or the entire sheet. Row and column modes ignore the
                 opposite axis when drawing, so a whole column stays selected
                 when blank rows are appended to the sheet.
   ───────────────────────────────────────────────────────────────────────── */

import type { Worksheet } from '../types';

export interface Cell { row: number; col: number }
export interface Range { r0: number; c0: number; r1: number; c1: number }
export type SelectionMode = 'cell' | 'range' | 'row' | 'column' | 'all';

export interface SelectionState {
  anchor: Cell;
  activeCell: Cell;
  ranges: Range[];
  mode: SelectionMode;
}

export interface GridSize { rows: number; cols: number }

type CellValue = number | string | null | undefined;

/** Structural view of a worksheet, so this module does not touch the editor. */
export interface ValueGrid {
  columns: { values: CellValue[] }[];
}

const EMPTY = (value: CellValue): boolean => value === null || value === undefined || value === '';

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function makeRange(a: Cell, b: Cell): Range {
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col),
  };
}

export function normalizeRange(r: Range): Range {
  return {
    r0: Math.min(r.r0, r.r1),
    c0: Math.min(r.c0, r.c1),
    r1: Math.max(r.r0, r.r1),
    c1: Math.max(r.c0, r.c1),
  };
}

export function clampCell(cell: Cell, size: GridSize): Cell {
  return {
    row: clampInt(cell.row, 0, Math.max(0, size.rows - 1)),
    col: clampInt(cell.col, 0, Math.max(0, size.cols - 1)),
  };
}

export function rangeContains(range: Range, row: number, col: number): boolean {
  const r = normalizeRange(range);
  return row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
}

export function rangeEquals(a: Range, b: Range): boolean {
  const ra = normalizeRange(a);
  const rb = normalizeRange(b);
  return ra.r0 === rb.r0 && ra.c0 === rb.c0 && ra.r1 === rb.r1 && ra.c1 === rb.c1;
}

export function rangeCellCount(r: Range): number {
  const n = normalizeRange(r);
  return (n.r1 - n.r0 + 1) * (n.c1 - n.c0 + 1);
}

export function createSelection(cell: Cell): SelectionState {
  return { anchor: { ...cell }, activeCell: { ...cell }, ranges: [makeRange(cell, cell)], mode: 'cell' };
}

export function clampSelection(state: SelectionState, size: GridSize): SelectionState {
  const activeCell = clampCell(state.activeCell, size);
  const anchor = clampCell(state.anchor, size);
  const ranges = state.ranges.length
    ? state.ranges.map((r) => normalizeRange({
      r0: clampInt(r.r0, 0, Math.max(0, size.rows - 1)),
      c0: clampInt(r.c0, 0, Math.max(0, size.cols - 1)),
      r1: clampInt(r.r1, 0, Math.max(0, size.rows - 1)),
      c1: clampInt(r.c1, 0, Math.max(0, size.cols - 1)),
    }))
    : [makeRange(activeCell, activeCell)];
  return { anchor, activeCell, ranges, mode: state.mode };
}

/** True when the cell is painted as selected, honouring row/column modes. */
export function coversCell(state: SelectionState, row: number, col: number, size?: GridSize): boolean {
  if (state.mode === 'all') {
    return !size || (row >= 0 && row < size.rows && col >= 0 && col < size.cols);
  }
  if (state.mode === 'row') {
    return state.ranges.some((r) => row >= normalizeRange(r).r0 && row <= normalizeRange(r).r1);
  }
  if (state.mode === 'column') {
    return state.ranges.some((r) => col >= normalizeRange(r).c0 && col <= normalizeRange(r).c1);
  }
  return state.ranges.some((r) => rangeContains(r, row, col));
}

export function rowFullySelected(state: SelectionState, row: number, size: GridSize): boolean {
  if (state.mode === 'all') return true;
  if (size.cols <= 0) return false;
  for (let c = 0; c < size.cols; c += 1) if (!coversCell(state, row, c, size)) return false;
  return true;
}

export function columnFullySelected(state: SelectionState, col: number, size: GridSize): boolean {
  if (state.mode === 'all') return true;
  if (size.rows <= 0) return false;
  for (let r = 0; r < size.rows; r += 1) if (!coversCell(state, r, col, size)) return false;
  return true;
}

/** Shift-click: one rectangle from the anchor to the clicked cell. */
export function extendTo(state: SelectionState, cell: Cell): SelectionState {
  return {
    anchor: { ...state.anchor },
    activeCell: { ...cell },
    ranges: [makeRange(state.anchor, cell)],
    mode: 'range',
  };
}

/** Ctrl/Cmd+Shift+click: keep what is selected and add anchor→cell as well. */
export function addExtend(state: SelectionState, cell: Cell): SelectionState {
  const extra = makeRange(state.activeCell, cell);
  const ranges = state.ranges.some((r) => rangeEquals(r, extra)) ? state.ranges : [...state.ranges, extra];
  return { anchor: { ...state.anchor }, activeCell: { ...cell }, ranges, mode: 'range' };
}

/** Remove one cell from a rectangle, leaving the up-to-four remaining pieces. */
export function subtractCell(ranges: Range[], cell: Cell): Range[] {
  const out: Range[] = [];
  for (const raw of ranges) {
    const r = normalizeRange(raw);
    if (!rangeContains(r, cell.row, cell.col)) {
      out.push(r);
      continue;
    }
    if (cell.row > r.r0) out.push({ r0: r.r0, c0: r.c0, r1: cell.row - 1, c1: r.c1 });
    if (cell.row < r.r1) out.push({ r0: cell.row + 1, c0: r.c0, r1: r.r1, c1: r.c1 });
    if (cell.col > r.c0) out.push({ r0: cell.row, c0: r.c0, r1: cell.row, c1: cell.col - 1 });
    if (cell.col < r.c1) out.push({ r0: cell.row, c0: cell.col + 1, r1: cell.row, c1: r.c1 });
  }
  return out;
}

/**
 * Ctrl/Cmd+click. A selected cell leaves the selection (a range is split around
 * it); an unselected cell is added as its own block. The last cell is never
 * dropped — a grid with nothing selected has no place for the caret.
 */
export function toggleSelection(state: SelectionState, cell: Cell): SelectionState {
  const covered = state.ranges.some((r) => rangeContains(r, cell.row, cell.col));
  if (!covered) {
    return {
      anchor: { ...state.anchor },
      activeCell: { ...cell },
      ranges: [...state.ranges, makeRange(cell, cell)],
      mode: state.mode === 'all' ? 'cell' : state.mode,
    };
  }
  const remaining = subtractCell(state.ranges, cell);
  if (!remaining.length) return state;
  const mode = remaining.some((r) => rangeCellCount(r) > 1) ? state.mode : 'cell';
  return { anchor: { ...state.anchor }, activeCell: { ...cell }, ranges: remaining, mode };
}

export function selectRow(state: SelectionState, row: number, size: GridSize, extend = false): SelectionState {
  const r0 = extend ? Math.min(state.anchor.row, row) : row;
  const r1 = extend ? Math.max(state.anchor.row, row) : row;
  return {
    anchor: extend ? { ...state.anchor } : { row, col: 0 },
    activeCell: { row, col: extend ? state.activeCell.col : 0 },
    ranges: [{ r0, c0: 0, r1, c1: Math.max(0, size.cols - 1) }],
    mode: 'row',
  };
}

export function selectColumn(state: SelectionState, col: number, size: GridSize, extend = false): SelectionState {
  const c0 = extend ? Math.min(state.anchor.col, col) : col;
  const c1 = extend ? Math.max(state.anchor.col, col) : col;
  return {
    anchor: extend ? { ...state.anchor } : { row: 0, col },
    activeCell: { row: extend ? state.activeCell.row : 0, col },
    ranges: [{ r0: 0, c0, r1: Math.max(0, size.rows - 1), c1 }],
    mode: 'column',
  };
}

export function selectAll(size: GridSize): SelectionState {
  const cell = { row: 0, col: 0 };
  return { anchor: cell, activeCell: { ...cell }, ranges: [{ r0: 0, c0: 0, r1: Math.max(0, size.rows - 1), c1: Math.max(0, size.cols - 1) }], mode: 'all' };
}

/** Arrow keys, Tab, PageUp/Down and boundary jumps all land here. */
export function moveTo(state: SelectionState, target: Cell, size: GridSize, extend = false): SelectionState {
  const cell = clampCell(target, size);
  return extend ? extendTo(state, cell) : createSelection(cell);
}

export function stepActive(state: SelectionState, dRow: number, dCol: number, size: GridSize, extend = false): SelectionState {
  return moveTo(state, { row: state.activeCell.row + dRow, col: state.activeCell.col + dCol }, size, extend);
}

/** Used extent of the sheet: last row and column that hold a value. */
export function usedExtent(grid: ValueGrid, size: GridSize): { lastRow: number; lastCol: number } {
  let lastRow = -1;
  let lastCol = -1;
  grid.columns.forEach((column, col) => {
    for (let row = 0; row < column.values.length; row += 1) {
      if (!EMPTY(column.values[row])) {
        if (row > lastRow) lastRow = row;
        if (col > lastCol) lastCol = col;
      }
    }
  });
  return {
    lastRow: Math.min(lastRow, Math.max(0, size.rows - 1)),
    lastCol: Math.min(lastCol, Math.max(0, size.cols - 1)),
  };
}

export function lastUsedCell(grid: ValueGrid, size: GridSize): Cell {
  const used = usedExtent(grid, size);
  if (used.lastRow < 0 || used.lastCol < 0) return { row: 0, col: 0 };
  return { row: used.lastRow, col: used.lastCol };
}

export function rowEnd(grid: ValueGrid, row: number, size: GridSize): Cell {
  let col = 0;
  for (let c = 0; c < size.cols; c += 1) {
    if (!EMPTY(grid.columns[c]?.values[row])) col = c;
  }
  return { row, col };
}

/**
 * Ctrl/Cmd+Arrow — Excel's jump. If the neighbour holds a value, land on the
 * last cell of that contiguous block; if it is blank, skip to the next value or
 * to the edge of the sheet when there is none.
 */
export function dataEdge(grid: ValueGrid, from: Cell, dRow: number, dCol: number, size: GridSize): Cell {
  const rowStep = Math.sign(dRow);
  const colStep = Math.sign(dCol);
  if (!rowStep && !colStep) return { ...from };
  const maxRow = Math.max(0, size.rows - 1);
  const maxCol = Math.max(0, size.cols - 1);
  const at = (row: number, col: number): CellValue => grid.columns[col]?.values[row];
  let row = clampInt(from.row, 0, maxRow);
  let col = clampInt(from.col, 0, maxCol);

  const inside = (r: number, c: number) => r >= 0 && r <= maxRow && c >= 0 && c <= maxCol;

  // Step off the cell first; jumping from the very last cell stays put.
  if (!inside(row + rowStep, col + colStep)) return { row, col };
  row += rowStep;
  col += colStep;

  if (!EMPTY(at(row, col))) {
    while (inside(row + rowStep, col + colStep) && !EMPTY(at(row + rowStep, col + colStep))) {
      row += rowStep;
      col += colStep;
    }
    return { row, col };
  }
  while (inside(row, col) && EMPTY(at(row, col))) {
    if (!inside(row + rowStep, col + colStep)) return { row, col };
    row += rowStep;
    col += colStep;
  }
  return { row, col };
}

/** Normalized rectangle for the copy/paste and delete commands. */
export function primaryRange(state: SelectionState): Range {
  return normalizeRange(state.ranges[0] ?? makeRange(state.activeCell, state.activeCell));
}

/**
 * The one range a paste may land in. A multi-block selection has no single
 * top-left, so paste asks the caller to narrow the selection and says so.
 */
export function pasteRange(state: SelectionState): Range | null {
  if (state.ranges.length !== 1) return null;
  return normalizeRange(state.ranges[0]);
}

/** Clip a range to the sheet's used rows for row/column selections. An
 *  explicitly selected cell block keeps every row it covers, blanks included. */
export function clipboardRanges(state: SelectionState, grid: ValueGrid, size: GridSize): Range[] {
  const used = usedExtent(grid, size);
  const lastRow = Math.max(0, used.lastRow);
  const lastCol = Math.max(0, used.lastCol);
  return state.ranges.map((raw) => {
    const r = normalizeRange(raw);
    let r0 = Math.min(r.r0, Math.max(0, size.rows - 1));
    let r1 = Math.min(r.r1, Math.max(0, size.rows - 1));
    let c1 = Math.min(r.c1, Math.max(0, size.cols - 1));
    if (state.mode === 'column') {
      r0 = 0;
      r1 = Math.min(r1, lastRow);
    } else if (state.mode === 'all') {
      r0 = 0;
      r1 = lastRow;
      c1 = lastCol;
    }
    return {
      r0,
      c0: Math.min(r.c0, Math.max(0, size.cols - 1)),
      r1: Math.max(r0, r1),
      c1,
    };
  });
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'number' ? String(value) : String(value);
}

/**
 * Clipboard text. Each block is tab-separated rows; blocks are separated by one
 * blank line, so a multi-block copy still pastes back as the same layout in
 * Excel, and the policy is visible in the copied text itself.
 */
export function selectionToText(grid: ValueGrid, state: SelectionState, size: GridSize): string {
  const ranges = clipboardRanges(state, grid, size);
  const blocks = ranges.map((r) => {
    const lines: string[] = [];
    for (let row = r.r0; row <= r.r1; row += 1) {
      const cells: string[] = [];
      for (let col = r.c0; col <= r.c1; col += 1) cells.push(cellText(grid.columns[col]?.values[row]));
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

export function selectionBounds(state: SelectionState): Range {
  const first = primaryRange(state);
  return state.ranges.reduce<Range>((acc, raw) => {
    const r = normalizeRange(raw);
    return {
      r0: Math.min(acc.r0, r.r0),
      c0: Math.min(acc.c0, r.c0),
      r1: Math.max(acc.r1, r.r1),
      c1: Math.max(acc.c1, r.c1),
    };
  }, first);
}

/** Row numbers covered by the selection, in order, without duplicates. */
export function selectedRows(state: SelectionState): number[] {
  const rows = new Set<number>();
  state.ranges.forEach((raw) => {
    const r = normalizeRange(raw);
    for (let row = r.r0; row <= r.r1; row += 1) rows.add(row);
  });
  return [...rows].sort((a, b) => a - b);
}

/** Column numbers covered by the selection, in order, without duplicates. */
export function selectedColumns(state: SelectionState): number[] {
  const cols = new Set<number>();
  state.ranges.forEach((raw) => {
    const r = normalizeRange(raw);
    for (let col = r.c0; col <= r.c1; col += 1) cols.add(col);
  });
  return [...cols].sort((a, b) => a - b);
}

/** Human-readable reference such as `C2:C6`, `C2` for a whole column or `2:4`
 *  for whole rows — the same shape Excel and Minitab show. */
export function describeSelection(state: SelectionState, grid: ValueGrid): string {
  const colName = (col: number) => (grid as unknown as { columns: { id?: string }[] }).columns[col]?.id ?? `C${col + 1}`;
  const label = (row: number, col: number) => `${colName(col)}${row + 1}`;
  if (state.mode === 'column') {
    return state.ranges.map((raw) => {
      const r = normalizeRange(raw);
      return r.c0 === r.c1 ? colName(r.c0) : `${colName(r.c0)}:${colName(r.c1)}`;
    }).join(', ');
  }
  if (state.mode === 'row') {
    return state.ranges.map((raw) => {
      const r = normalizeRange(raw);
      return r.r0 === r.r1 ? String(r.r0 + 1) : `${r.r0 + 1}:${r.r1 + 1}`;
    }).join(', ');
  }
  return state.ranges.map((raw) => {
    const r = normalizeRange(raw);
    const start = label(r.r0, r.c0);
    const end = label(r.r1, r.c1);
    return start === end ? start : `${start}:${end}`;
  }).join(', ');
}

/** Worksheet keeps its own shape; this is only a convenience for tests. */
export function gridSize(sheet: Worksheet, minimumRows = 30): GridSize {
  const maxLen = Math.max(0, ...sheet.columns.map((c) => c.values.length));
  return { rows: Math.max(minimumRows, maxLen + 6), cols: sheet.columns.length };
}
