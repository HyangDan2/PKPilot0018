import { useState } from 'react';
import type { Lang, OutputDoc, Worksheet } from '../types';
import { t } from '../lib/i18n';
import { fmtTime } from '../lib/format';
import { IconChart, IconPlus, IconTable, IconTrash, IconX } from './Icons';

interface Props {
  lang: Lang;
  outputs: OutputDoc[];
  worksheets: Worksheet[];
  activeSheetId: string;
  focusedOutput: string | null;
  onSelectOutput: (id: string) => void;
  onDeleteOutput: (id: string) => void;
  onSelectSheet: (id: string) => void;
  onAddSheet: () => void;
  onRenameSheet: (id: string, name: string) => void;
  onDeleteSheet: (id: string) => void;
  onClose?: () => void;
}

export function Navigator({
  lang, outputs, worksheets, activeSheetId, focusedOutput,
  onSelectOutput, onDeleteOutput, onSelectSheet, onAddSheet, onRenameSheet, onDeleteSheet, onClose,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <aside className="navigator" data-testid="navigator">
      <div className="nav-section outputs">
        <div className="nav-head">
          <span className="mono-note">{t(lang, 'nav.output')}</span>
          <span className="panel-count">{outputs.length}</span>
          <span className="spacer" />
          {onClose && (
            <button type="button" className="nav-close" onClick={onClose} aria-label={t(lang, 'close')}><IconX size={14} /></button>
          )}
        </div>
        <div className="nav-list">
          {outputs.length === 0 && (
            <p className="nav-empty">{t(lang, 'nav.noOutput')}<br />{t(lang, 'nav.noOutputHint')}</p>
          )}
          {outputs.map((output) => (
            <div key={output.id} className="nav-sheet">
              <button
                type="button"
                className={`nav-item${focusedOutput === output.id ? ' current' : ''}`}
                onClick={() => onSelectOutput(output.id)}
                title={t(lang, output.titleKey)}
                data-testid={`nav-output-${output.id}`}
              >
                <span className="ni-kind">{output.blocks.some((b) => b.type === 'chart' || b.type === 'chartgrid') ? 'CHT' : 'TBL'}</span>
                <span className="ni-label">{t(lang, output.titleKey)}</span>
                <span className="ni-time">{fmtTime(output.createdAt).slice(0, 5)}</span>
              </button>
              <span className="sheet-actions">
                <button type="button" onClick={() => onDeleteOutput(output.id)} aria-label={t(lang, 'nav.deleteOutput')} title={t(lang, 'nav.deleteOutput')}>
                  <IconTrash size={12} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="nav-section sheets">
        <div className="nav-head">
          <span className="mono-note">{t(lang, 'nav.worksheets')}</span>
          <span className="spacer" />
          <button type="button" onClick={onAddSheet} aria-label={t(lang, 'nav.addSheet')} title={t(lang, 'nav.addSheet')} data-testid="nav-add-sheet">
            <IconPlus size={14} />
          </button>
        </div>
        <div className="nav-list">
          {worksheets.map((ws) => (
            <div key={ws.id} className="nav-sheet">
              {renaming === ws.id ? (
                <input
                  className="sheet-rename-input"
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => { onRenameSheet(ws.id, draft); setRenaming(null); }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { onRenameSheet(ws.id, draft); setRenaming(null); }
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={`nav-item${ws.id === activeSheetId ? ' current' : ''}`}
                  onClick={() => onSelectSheet(ws.id)}
                  onDoubleClick={() => { setDraft(ws.name); setRenaming(ws.id); }}
                  data-testid={`nav-sheet-${ws.id}`}
                >
                  <IconTable size={12} />
                  <span className="ni-label">{ws.name}</span>
                  <span className="ni-cols">{ws.columns.length}</span>
                </button>
              )}
              <span className="sheet-actions">
                <button
                  type="button"
                  onClick={() => { setDraft(ws.name); setRenaming(ws.id); }}
                  aria-label={t(lang, 'nav.rename')}
                  title={t(lang, 'nav.rename')}
                >
                  <IconChart size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSheet(ws.id)}
                  aria-label={t(lang, 'nav.delete')}
                  title={t(lang, 'nav.delete')}
                  data-testid={`nav-delete-sheet-${ws.id}`}
                >
                  <IconTrash size={12} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
