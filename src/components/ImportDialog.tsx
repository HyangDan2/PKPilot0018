import { useEffect, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { dateToIso } from '../lib/xlsx';
import { IconX } from './Icons';

export type PreviewCell = string | number | boolean | Date | null;

export interface PreviewSheet {
  name: string;
  rows: PreviewCell[][];
}

interface Props {
  lang: Lang;
  kind: 'csv' | 'xlsx';
  fileName: string;
  sheets: PreviewSheet[];
  /** true when the content looks like it already has a header row */
  autoHeader: boolean;
  onCancel: () => void;
  onConfirm: (header: boolean) => void;
}

function cellText(value: PreviewCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return dateToIso(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * Import confirmation: shows the first rows of the file as they would land in
 * the worksheet and lets the user say whether row 1 is a header. Without this
 * step a headerless CSV of text columns lost its first data row to the automatic
 * "first row is a header" guess, with nothing to undo it.
 */
export function ImportDialog({ lang, kind, fileName, sheets, autoHeader, onCancel, onConfirm }: Props) {
  const [header, setHeader] = useState(autoHeader);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const sheet = sheets[0];
  const rows = (sheet?.rows ?? []).slice(0, 7);
  const width = Math.min(8, rows.reduce((a, row) => Math.max(a, row.length), 0));
  const moreRows = (sheet?.rows.length ?? 0) > rows.length;
  const moreCols = (sheet?.rows ?? []).some((row) => row.length > width);
  const totalRows = sheet?.rows.length ?? 0;
  const dataRows = header ? Math.max(0, totalRows - 1) : totalRows;
  const dataCols = rows[0]?.length ?? 0;

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-label={t(lang, 'import.title')}>
        <div className="modal-head">
          <div>
            <h3>{t(lang, 'import.title')}</h3>
            <div className="modal-sub">{fileName}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={onCancel} aria-label={t(lang, 'close')}><IconX size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="muted">{t(lang, kind === 'csv' ? 'import.csvText' : 'import.xlsxText')}</p>
          <label className="check-row">
            <input type="checkbox" checked={header} onChange={(event) => setHeader(event.target.checked)} />
            <span>{t(lang, 'import.firstRowHeader')}</span>
          </label>
          <p className="muted small">
            {t(lang, 'import.summary', {
              rows: dataRows,
              cols: dataCols,
              sheets: sheets.length,
            })}
          </p>
          <div className="import-preview" role="table" aria-label={t(lang, 'import.preview')}>
            <table className="kbd-table">
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r} className={header && r === 0 ? 'preview-head-row' : undefined}>
                    <td className="preview-index">{r + 1}</td>
                    {Array.from({ length: width }, (_, c) => (
                      <td key={c} className={header && r === 0 ? 'preview-header-cell' : undefined}>
                        {cellText(row[c] ?? null)}
                      </td>
                    ))}
                    {moreCols && <td key="more">…</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {moreRows && <p className="muted small">{t(lang, 'import.moreRows', { n: totalRows - rows.length })}</p>}
          </div>
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>{t(lang, 'import.cancel')}</button>
          <button type="button" className="btn primary" onClick={() => onConfirm(header)}>{t(lang, 'import.confirm')}</button>
        </div>
      </div>
    </div>
  );
}
