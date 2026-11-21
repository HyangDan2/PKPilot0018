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
  onScrollToRow?: number | null;
}

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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const maxLen = Math.max(0, ...sheet.columns.map((c) => c.values.length));
  const rows = Math.max(30, maxLen + 6);

  useEffect(() => {
    setEditing(null);
  }, [sheet.id]);

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
    switch (event.key) {
      case 'ArrowUp': event.preventDefault(); move(row - 1, col, extend); break;
      case 'ArrowDown': event.preventDefault(); move(row + 1, col, extend); break;
      case 'ArrowLeft': event.preventDefault(); move(row, col - 1, extend); break;
      case 'ArrowRight': event.preventDefault(); move(row, col + 1, extend); break;
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
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              <th className={`ws-rownum${selection.row === row ? ' current' : ''}`}>{row + 1}</th>
              {sheet.columns.map((col, index) => {
                const value = col.values[row];
                const active = editing && editing.row === row && editing.col === index;
                return (
                  <td
                    key={col.id}
                    className={`ws-cell${isSelected(row, index) ? ' sel' : ''}${value === null || value === undefined ? ' null' : ''}${active ? ' editing' : ''}`}
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
