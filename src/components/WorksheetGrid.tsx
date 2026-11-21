import { useEffect, useRef, useState } from 'react';
import type { Lang, Worksheet } from '../types';
import { fmt } from '../lib/format';
import { t } from '../lib/i18n';
import { IconPlus } from './Icons';

export interface GridCell { row: number; col: number }
export interface GridRange { r0: number; c0: number; r1: number; c1: number }

interface Props {
  lang: Lang;
  sheet: Worksheet;
  selection: GridCell;
  range: GridRange;
  onSelect: (cell: GridCell, extend: boolean) => void;
  onEdit: (row: number, col: number, value: string) => void;
  onPaste: (row: number, col: number, text: string) => void;
  onCopy: () => void;
  onClear: (range: GridRange) => void;
  onAddColumn: () => void;
  onRenameColumn: (colIndex: number, name: string) => void;
}

/** Row pitch of .ws-cell (24px) plus its 1px border, used by the virtual window. */
const ROW_H = 25;
const OVERSCAN = 8;
const HEADER_H = 50;

function typeSuffix(type: string): string {
  return type === 'text' ? '-T' : type === 'date' ? '-D' : '';
}

function cellText(value: number | string | null): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return fmt(value);
  return String(value);
}

export function WorksheetGrid({
  lang, sheet, selection, range, onSelect, onEdit, onPaste, onCopy, onClear, onAddColumn, onRenameColumn,
}: Props) {
  const [editing, setEditing] = useState<GridCell | null>(null);
  const [draft, setDraft] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const maxLen = Math.max(0, ...sheet.columns.map((c) => c.values.length));
  const rows = Math.max(30, maxLen + 6);

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

  // Keep the selected row inside the viewport when the arrow keys move it.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const rowTop = HEADER_H + selection.row * ROW_H;
    const rowBottom = rowTop + ROW_H;
    const viewTop = node.scrollTop + HEADER_H;
    const viewBottom = node.scrollTop + node.clientHeight;
    if (rowTop < viewTop) node.scrollTop = Math.max(0, rowTop - HEADER_H);
    else if (rowBottom > viewBottom) node.scrollTop = rowBottom - node.clientHeight;
  }, [selection.row]);

  const move = (row: number, col: number, extend: boolean) => {
    const r = Math.max(0, Math.min(rows - 1, row));
    const c = Math.max(0, Math.min(sheet.columns.length - 1, col));
    onSelect({ row: r, col: c }, extend);
  };

  const beginEdit = (row: number, col: number, initial?: string) => {
    const value = sheet.columns[col]?.values[row];
    setDraft(initial ?? (value === null || value === undefined ? '' : String(value)));
    setEditing({ row, col });
  };

  const commit = (next?: { row: number; col: number }) => {
    if (!editing) return;
    onEdit(editing.row, editing.col, draft);
    setEditing(null);
    if (next) move(next.row, next.col, false);
    else wrapRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const { row, col } = selection;
    const extend = event.shiftKey;
    const page = Math.max(1, Math.floor((viewport - HEADER_H) / ROW_H) - 1);
    switch (event.key) {
      case 'ArrowUp': event.preventDefault(); move(row - 1, col, extend); break;
      case 'ArrowDown': event.preventDefault(); move(row + 1, col, extend); break;
      case 'ArrowLeft': event.preventDefault(); move(row, col - 1, extend); break;
      case 'ArrowRight': event.preventDefault(); move(row, col + 1, extend); break;
      case 'PageDown': event.preventDefault(); move(row + page, col, false); break;
      case 'PageUp': event.preventDefault(); move(row - page, col, false); break;
      case 'Tab': event.preventDefault(); move(row, col + (event.shiftKey ? -1 : 1), false); break;
      case 'Enter': event.preventDefault(); beginEdit(row, col); break;
      case 'F2': event.preventDefault(); beginEdit(row, col); break;
      case 'Delete':
      case 'Backspace': event.preventDefault(); onClear(range); break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          beginEdit(row, col, event.key);
        }
    }
  };

  const isSelected = (row: number, col: number) => {
    const r0 = Math.min(range.r0, range.r1);
    const r1 = Math.max(range.r0, range.r1);
    const c0 = Math.min(range.c0, range.c1);
    const c1 = Math.max(range.c0, range.c1);
    return row >= r0 && row <= r1 && col >= c0 && col <= c1;
  };

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
      onPaste={(event) => {
        if (editing) return;
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        if (text) onPaste(selection.row, selection.col, text);
      }}
      data-testid="worksheet-grid"
    >
      <table className="ws-grid" style={{ width: `${46 + sheet.columns.length * 118}px` }}>
        <colgroup>
          <col style={{ width: 46 }} />
          {sheet.columns.map((col) => <col key={col.id} style={{ width: 118 }} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="ws-corner">ROWS</th>
            {sheet.columns.map((col, index) => (
              <th key={col.id} className={`ws-colhead${selection.col === index ? ' current' : ''}`}>
                {col.id}<span className="ctype">{typeSuffix(col.type)}</span>
              </th>
            ))}
          </tr>
          <tr>
            <th className="ws-namehead ghost">Name</th>
            {sheet.columns.map((col, index) => (
              <th key={col.id} className="ws-namehead">
                <input
                  value={col.name}
                  placeholder={col.id}
                  aria-label={`${col.id} name`}
                  onChange={(event) => onRenameColumn(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topSpacer > 0 && (
            <tr aria-hidden="true" className="ws-spacer" data-testid="grid-spacer-top">
              <td colSpan={Math.max(1, sheet.columns.length + 1)} style={{ height: topSpacer, padding: 0, border: 0 }} />
            </tr>
          )}
          {Array.from({ length: last - first }, (_, offset) => first + offset).map((row) => (
            <tr key={row} data-row={row + 1}>
              <th className={`ws-rownum${selection.row === row ? ' current' : ''}`}>{row + 1}</th>
              {sheet.columns.map((col, index) => {
                const value = col.values[row];
                const active = editing && editing.row === row && editing.col === index;
                return (
                  <td
                    key={col.id}
                    className={`ws-cell${isSelected(row, index) ? ' sel' : ''}${value === null || value === undefined ? ' null' : ''}${typeof value === 'number' ? ' num' : ''}${active ? ' editing' : ''}`}
                    onMouseDown={() => {
                      if (!(selection.row === row && selection.col === index)) move(row, index, false);
                    }}
                    onDoubleClick={() => beginEdit(row, index)}
                    title={value === null || value === undefined ? '' : String(value)}
                    data-cell={`${col.id}:${row + 1}`}
                  >
                    {active ? (
                      <input
                        className="cell-input"
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commit()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') { event.preventDefault(); commit({ row: row + 1, col: index }); }
                          else if (event.key === 'Tab') { event.preventDefault(); commit({ row, col: index + (event.shiftKey ? -1 : 1) }); }
                          else if (event.key === 'Escape') { event.preventDefault(); setEditing(null); wrapRef.current?.focus(); }
                        }}
                      />
                    ) : (
                      cellText(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {bottomSpacer > 0 && (
            <tr aria-hidden="true" className="ws-spacer" data-testid="grid-spacer-bottom">
              <td colSpan={Math.max(1, sheet.columns.length + 1)} style={{ height: bottomSpacer, padding: 0, border: 0 }} />
            </tr>
          )}
          <tr>
            <th className="ws-rownum" style={{ color: 'var(--text-secondary)' }}>+</th>
            <td className="ws-addcol" colSpan={Math.max(1, sheet.columns.length)} onClick={onAddColumn} title={t(lang, 'panel.addColumn')}>
              <IconPlus size={12} /> {t(lang, 'panel.addColumn')}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
