import { useEffect, useRef, useState } from 'react';
import type { Lang, Worksheet } from '../types';
import { fmt } from '../lib/format';
import { t } from '../lib/i18n';
import { IconPlus } from './Icons';
import {
  addExtend,
  clampCell,
  coversCell,
  createSelection,
  dataEdge,
  extendTo,
  lastUsedCell,
  rowEnd,
  selectAll,
  selectColumn,
  selectRow,
  stepActive,
  toggleSelection,
  type Cell,
  type GridSize,
  type Range,
  type SelectionState,
} from '../lib/selection';

export interface GridContextTarget {
  kind: 'cell' | 'row' | 'column' | 'empty';
  cell: Cell;
}

interface Props {
  lang: Lang;
  sheet: Worksheet;
  selection: SelectionState;
  onSelectionChange: (next: SelectionState) => void;
  onEdit: (row: number, col: number, value: string) => void;
  onPaste: (row: number, col: number, text: string, options?: { html?: string; target?: 'cell' | 'header' }) => void;
  onCopy: () => void;
  onCut: () => void;
  onClear: () => void;
  onAddColumn: () => void;
  onRenameColumn: (colIndex: number, name: string) => void;
  onContextMenu: (target: GridContextTarget, at: { x: number; y: number }) => void;
  /** Cells marked by Ctrl+X, drawn with a dashed frame until they are pasted. */
  cutRanges?: Range[];
  /** Worksheet rows a chart selection points at (Stage 3D, WO-09). */
  highlightRows?: number[];
}

/** Row pitch of .ws-cell (24px) plus its 1px border, used by the virtual window. */
const ROW_H = 25;
const OVERSCAN = 8;
const HEADER_H = 50;
const ROWHEAD_W = 46;
const COL_W = 118;
const ADDCOL_W = 46;

function typeSuffix(type: string): string {
  return type === 'text' ? '-T' : type === 'date' ? '-D' : '';
}

function cellText(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return fmt(value);
  return String(value);
}

function inAnyRange(ranges: Range[] | undefined, row: number, col: number): boolean {
  if (!ranges?.length) return false;
  return ranges.some((r) => row >= Math.min(r.r0, r.r1) && row <= Math.max(r.r0, r.r1)
    && col >= Math.min(r.c0, r.c1) && col <= Math.max(r.c0, r.c1));
}

export function WorksheetGrid({
  lang, sheet, selection, onSelectionChange, onEdit, onPaste, onCopy, onCut, onClear,
  onAddColumn, onRenameColumn, onContextMenu, cutRanges, highlightRows,
}: Props) {
  const [editing, setEditing] = useState<Cell | null>(null);
  const [draft, setDraft] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const skipBlurCommitRef = useRef(false);
  const dragRef = useRef<null | { kind: 'cell' | 'row' | 'column'; base: SelectionState }>(null);
  const maxLen = Math.max(0, ...sheet.columns.map((c) => c.values.length));
  const rows = Math.max(30, maxLen + 6);
  const size: GridSize = { rows, cols: sheet.columns.length };
  const cols = sheet.columns.length;

  useEffect(() => {
    setEditing(null);
  }, [sheet.id]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const measure = () => setViewport(node.clientHeight || 600);
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Virtual window: only the visible rows plus an overscan buffer are in the DOM,
  // with spacer rows keeping the scroll height of the full sheet.
  const extra = editing ? editing.row : -1;
  let first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  let last = Math.min(rows, first + Math.ceil(viewport / ROW_H) + OVERSCAN * 2);
  if (extra >= 0 && extra < first) first = Math.max(0, extra - OVERSCAN);
  if (extra >= 0 && extra >= last) last = Math.min(rows, extra + OVERSCAN);
  const topSpacer = first * ROW_H;
  const bottomSpacer = Math.max(0, (rows - last) * ROW_H);

  // Keep the active row inside the viewport when the keys move it.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const rowTop = HEADER_H + selection.activeCell.row * ROW_H;
    const rowBottom = rowTop + ROW_H;
    const viewTop = node.scrollTop + HEADER_H;
    const viewBottom = node.scrollTop + node.clientHeight;
    if (rowTop < viewTop) node.scrollTop = Math.max(0, rowTop - HEADER_H);
    else if (rowBottom > viewBottom) node.scrollTop = rowBottom - node.clientHeight;
  }, [selection.activeCell.row]);

  // Keep the active column reachable sideways — the + column at the far right
  // must scroll into view after a new column is added.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const colLeft = ROWHEAD_W + selection.activeCell.col * COL_W;
    const colRight = colLeft + COL_W + ADDCOL_W;
    const left = node.scrollLeft;
    const right = left + node.clientWidth;
    if (colLeft < left + ROWHEAD_W) node.scrollLeft = Math.max(0, colLeft - ROWHEAD_W);
    else if (colRight > right) node.scrollLeft = colRight - node.clientWidth + 2;
  }, [selection.activeCell.col, cols]);

  /* ── editing ───────────────────────────────────────────────────────── */

  const beginEdit = (row: number, col: number, initial?: string) => {
    if (col < 0 || col >= sheet.columns.length) return;
    const value = sheet.columns[col]?.values[row];
    setDraft(initial ?? (value === null || value === undefined ? '' : String(value)));
    setEditing({ row, col });
  };

  const commit = (next?: Cell) => {
    if (!editing) return;
    onEdit(editing.row, editing.col, draft);
    setEditing(null);
    if (next) onSelectionChange(createSelection(clampCell(next, size)));
    // Keep the keyboard on the grid after Enter/Tab: the next arrow or F2 must
    // reach it without another click.
    wrapRef.current?.focus();
  };

  /* ── mouse selection ───────────────────────────────────────────────── */

  const cellFromPoint = (x: number, y: number): Cell | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const cell = el?.closest<HTMLElement>('[data-cell]');
    if (cell) {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if (Number.isFinite(row) && Number.isFinite(col)) return { row, col };
    }
    // Dragging along a header: keep the other axis from the header it is over.
    const colHead = el?.closest<HTMLElement>('th[data-col]');
    if (colHead) return { row: 0, col: Number(colHead.dataset.col) };
    const rowHead = el?.closest<HTMLElement>('th[data-row]');
    if (rowHead) return { row: Number(rowHead.dataset.row), col: 0 };
    return null;
  };

  const endDrag = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
  };

  const onDragEnd = () => endDrag();

  const onDragMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    const node = wrapRef.current;
    if (!drag || !node) return;
    // Nudge the sheet when the pointer pushes past an edge, then re-hit-test.
    const rect = node.getBoundingClientRect();
    if (event.clientY < rect.top + HEADER_H + 10) node.scrollTop = Math.max(0, node.scrollTop - 12);
    else if (event.clientY > rect.bottom - 10) node.scrollTop += 12;
    if (event.clientX < rect.left + ROWHEAD_W) node.scrollLeft = Math.max(0, node.scrollLeft - 12);
    else if (event.clientX > rect.right - 10) node.scrollLeft += 12;
    const cell = cellFromPoint(event.clientX, event.clientY);
    if (!cell) return;
    if (drag.kind === 'cell') {
      if (event.ctrlKey || event.metaKey) onSelectionChange(addExtend(drag.base, cell));
      else onSelectionChange(extendTo(drag.base, cell));
    } else if (drag.kind === 'row') {
      onSelectionChange(selectRow(drag.base, cell.row, size, true));
    } else {
      onSelectionChange(selectColumn(drag.base, cell.col, size, true));
    }
  };

  const startDrag = (kind: 'cell' | 'row' | 'column', base: SelectionState) => {
    dragRef.current = { kind, base };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
  };

  const onCellMouseDown = (event: React.MouseEvent, row: number, col: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (editing) commit();
    wrapRef.current?.focus();
    const cell = { row, col };
    const additive = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;
    let next: SelectionState;
    if (additive && shift) next = addExtend(selection, cell);
    else if (additive) next = toggleSelection(selection, cell);
    else if (shift) next = extendTo(selection, cell);
    else next = createSelection(cell);
    onSelectionChange(next);
    // A plain press always re-anchors the drag at the pressed cell, even when
    // the cell was already inside the previous selection.
    const base = additive || shift ? selection : next;
    startDrag('cell', base);
  };

  const onRowHeadMouseDown = (event: React.MouseEvent, row: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (editing) commit();
    wrapRef.current?.focus();
    const next = selectRow(selection, row, size, event.shiftKey);
    onSelectionChange(next);
    startDrag('row', event.shiftKey ? selection : next);
  };

  const onColHeadMouseDown = (event: React.MouseEvent, col: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (editing) commit();
    wrapRef.current?.focus();
    const next = selectColumn(selection, col, size, event.shiftKey);
    onSelectionChange(next);
    startDrag('column', event.shiftKey ? selection : next);
  };

  const openContext = (event: React.MouseEvent, target: GridContextTarget) => {
    event.preventDefault();
    event.stopPropagation();
    wrapRef.current?.focus();
    onContextMenu(target, { x: event.clientX, y: event.clientY });
  };

  /* ── keyboard ──────────────────────────────────────────────────────── */

  const page = Math.max(1, Math.floor((viewport - HEADER_H) / ROW_H) - 1);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const { row, col } = selection.activeCell;
    const extend = event.shiftKey;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const code = event.code;

    if (mod && (key === 'a' || key === 'A' || code === 'KeyA')) { event.preventDefault(); onSelectionChange(selectAll(size)); return; }
    if (mod && (key === 'c' || key === 'C' || code === 'KeyC')) { event.preventDefault(); onCopy(); return; }
    if (mod && (key === 'x' || key === 'X' || code === 'KeyX')) { event.preventDefault(); onCut(); return; }
    // Ctrl/Cmd+V is left to the browser so the paste event carries the data.
    if (mod && (key === 'v' || key === 'V' || code === 'KeyV')) return;

    switch (key) {
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        event.preventDefault();
        const dRow = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
        const dCol = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
        if (mod) {
          const target = dataEdge(sheet, selection.activeCell, dRow, dCol, size);
          onSelectionChange(extend ? extendTo(selection, target) : createSelection(target));
        } else {
          onSelectionChange(stepActive(selection, dRow, dCol, size, extend));
        }
        return;
      }
      case 'PageDown': event.preventDefault(); onSelectionChange(stepActive(selection, page, 0, size, extend)); return;
      case 'PageUp': event.preventDefault(); onSelectionChange(stepActive(selection, -page, 0, size, extend)); return;
      case 'Home': {
        event.preventDefault();
        const target = mod ? { row: 0, col: 0 } : { row, col: 0 };
        onSelectionChange(extend ? extendTo(selection, target) : createSelection(target));
        return;
      }
      case 'End': {
        event.preventDefault();
        const target = mod ? lastUsedCell(sheet, size) : rowEnd(sheet, row, size);
        onSelectionChange(extend ? extendTo(selection, target) : createSelection(target));
        return;
      }
      case 'Tab': {
        event.preventDefault();
        onSelectionChange(stepActive(selection, 0, extend ? -1 : 1, size, false));
        return;
      }
      case 'Enter': {
        event.preventDefault();
        beginEdit(row, col);
        return;
      }
      case 'F2': event.preventDefault(); beginEdit(row, col); return;
      case 'Escape': {
        event.preventDefault();
        onSelectionChange(createSelection({ row, col }));
        wrapRef.current?.focus();
        return;
      }
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        onClear();
        return;
      default:
        if (key.length === 1 && !mod && !event.altKey) {
          event.preventDefault();
          beginEdit(row, col, key);
        }
    }
  };

  const isCut = (row: number, col: number) => inAnyRange(cutRanges, row, col);
  const highlighted = new Set(highlightRows ?? []);

  return (
    <div
      className="grid-wrap"
      ref={wrapRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(event) => setScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
      onCopy={(event) => {
        if (editing) return;
        event.preventDefault();
        onCopy();
      }}
      onCut={(event) => {
        if (editing) return;
        event.preventDefault();
        onCut();
      }}
      onPaste={(event) => {
        if (editing) return;
        const text = event.clipboardData.getData('text/plain');
        const html = event.clipboardData.getData('text/html');
        if (!text && !html) return;
        event.preventDefault();
        onPaste(selection.activeCell.row, selection.activeCell.col, text, { html, target: 'cell' });
      }}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('[data-cell], th')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const col = Math.max(0, Math.min(cols - 1, Math.floor((event.clientX - rect.left + event.currentTarget.scrollLeft - ROWHEAD_W) / COL_W)));
        openContext(event, { kind: 'empty', cell: { row: Math.min(rows - 1, maxLen), col } });
      }}
      data-testid="worksheet-grid"
    >
      <table className="ws-grid" style={{ width: `${ROWHEAD_W + cols * COL_W + ADDCOL_W}px` }}>
        <colgroup>
          <col style={{ width: ROWHEAD_W }} />
          {sheet.columns.map((col) => <col key={col.id} style={{ width: COL_W }} />)}
          <col style={{ width: ADDCOL_W }} />
        </colgroup>
        <thead>
          <tr>
            <th className="ws-corner">ROWS</th>
            {sheet.columns.map((col, index) => {
              const whole = coversCell(selection, 0, index, size) && selection.mode !== 'cell' && selection.mode !== 'range';
              return (
                <th
                  key={col.id}
                  className={`ws-colhead${selection.activeCell.col === index ? ' current' : ''}${whole ? ' sel' : ''}`}
                  data-col={index}
                  title={col.description || undefined}
                  onMouseDown={(event) => onColHeadMouseDown(event, index)}
                  onContextMenu={(event) => openContext(event, { kind: 'column', cell: { row: 0, col: index } })}
                  data-testid={`ws-colhead-${col.id}`}
                >
                  {col.id}<span className="ctype">{typeSuffix(col.type)}</span>
                </th>
              );
            })}
            <th className="ws-addcol-head" rowSpan={2} data-testid="ws-addcol-cell">
              <button
                type="button"
                className="ws-addcol-btn"
                title={t(lang, 'panel.addColumn')}
                aria-label={t(lang, 'panel.addColumn')}
                data-testid="add-column-head"
                onClick={onAddColumn}
              >
                <IconPlus size={14} />
              </button>
            </th>
          </tr>
          <tr>
            <th className="ws-namehead ghost">Name</th>
            {sheet.columns.map((col, index) => (
              <th
                key={col.id}
                className="ws-namehead"
                data-col={index}
                onMouseDown={(event) => onColHeadMouseDown(event, index)}
                onContextMenu={(event) => openContext(event, { kind: 'column', cell: { row: 0, col: index } })}
              >
                <input
                  value={col.name}
                  placeholder={col.id}
                  aria-label={`${col.id} name`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onChange={(event) => onRenameColumn(index, event.target.value)}
                  onPaste={(event) => {
                    const text = event.clipboardData.getData('text/plain');
                    const html = event.clipboardData.getData('text/html');
                    if (text.includes('\t') || text.includes('\n') || (!text && /<table[\s>]/i.test(html))) {
                      event.preventDefault();
                      event.stopPropagation();
                      (event.target as HTMLInputElement).blur();
                      onPaste(0, index, text, { html, target: 'header' });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                  }}
                  data-testid={`col-name-${col.id}`}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topSpacer > 0 && (
            <tr aria-hidden="true" className="ws-spacer" data-testid="grid-spacer-top">
              <td colSpan={Math.max(1, cols + 2)} style={{ height: topSpacer, padding: 0, border: 0 }} />
            </tr>
          )}
          {Array.from({ length: last - first }, (_, offset) => first + offset).map((row) => {
            const rowWhole = selection.mode === 'row' || selection.mode === 'all';
            return (
              <tr key={row} data-row={row + 1} className={highlighted.has(row) ? 'row-highlight' : undefined} data-highlight={highlighted.has(row) ? '1' : undefined}>
                <th
                  className={`ws-rownum${selection.activeCell.row === row ? ' current' : ''}${rowWhole && coversCell(selection, row, 0, size) ? ' sel' : ''}`}
                  data-row={row}
                  data-testid={`ws-rownum-${row + 1}`}
                  onMouseDown={(event) => onRowHeadMouseDown(event, row)}
                  onContextMenu={(event) => openContext(event, { kind: 'row', cell: { row, col: 0 } })}
                >{row + 1}</th>
                {sheet.columns.map((col, index) => {
                  const value = col.values[row];
                  const active = editing && editing.row === row && editing.col === index;
                  const selected = coversCell(selection, row, index, size);
                  const isActive = selection.activeCell.row === row && selection.activeCell.col === index;
                  return (
                    <td
                      key={col.id}
                      className={`ws-cell${selected ? ' sel' : ''}${value === null || value === undefined ? ' null' : ''}${typeof value === 'number' ? ' num' : ''}${active ? ' editing' : ''}${isActive ? ' active' : ''}${isCut(row, index) ? ' cut' : ''}`}
                      onMouseDown={(event) => onCellMouseDown(event, row, index)}
                      onDoubleClick={() => beginEdit(row, index)}
                      onContextMenu={(event) => openContext(event, { kind: 'cell', cell: { row, col: index } })}
                      title={value === null || value === undefined ? '' : String(value)}
                      data-cell={`${col.id}:${row + 1}`}
                      data-row={row}
                      data-col={index}
                    >
                      {active ? (
                        <input
                          className="cell-input"
                          autoFocus
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={() => {
                            if (skipBlurCommitRef.current) {
                              skipBlurCommitRef.current = false;
                              return;
                            }
                            commit();
                          }}
                          onPaste={(event) => {
                            const text = event.clipboardData.getData('text/plain');
                            const html = event.clipboardData.getData('text/html');
                            if (text.includes('\t') || text.includes('\n') || (!text && /<table[\s>]/i.test(html))) {
                              event.preventDefault();
                              event.stopPropagation();
                              skipBlurCommitRef.current = true;
                              setEditing(null);
                              onPaste(row, index, text, { html, target: 'cell' });
                              wrapRef.current?.focus();
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); skipBlurCommitRef.current = true; commit({ row: row + (event.shiftKey ? -1 : 1), col: index }); }
                            else if (event.key === 'Tab') { event.preventDefault(); skipBlurCommitRef.current = true; commit({ row, col: index + (event.shiftKey ? -1 : 1) }); }
                            else if (event.key === 'Escape') { event.preventDefault(); skipBlurCommitRef.current = true; setEditing(null); wrapRef.current?.focus(); }
                          }}
                          data-testid="cell-editor"
                        />
                      ) : (
                        cellText(value)
                      )}
                    </td>
                  );
                })}
                <td className="ws-addcol-gap" />
              </tr>
            );
          })}
          {bottomSpacer > 0 && (
            <tr aria-hidden="true" className="ws-spacer" data-testid="grid-spacer-bottom">
              <td colSpan={Math.max(1, cols + 2)} style={{ height: bottomSpacer, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
