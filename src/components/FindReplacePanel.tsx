import { useEffect, useMemo, useRef, useState } from 'react';
import type { Lang, Worksheet } from '../types';
import { t } from '../lib/i18n';
import { findMatches, type FindMatch, type FindOptions } from '../lib/sheetOps';
import type { Cell } from '../lib/selection';

interface Props {
  lang: Lang;
  sheet: Worksheet;
  onSelect: (cell: Cell) => void;
  onReplaceAll: (query: string, replacement: string, options: FindOptions) => number;
  onReplaceOne: (match: FindMatch, query: string, replacement: string, options: FindOptions) => void;
  onClose: () => void;
  /** Text to search for when the panel opens from a cell's context menu. */
  initialQuery?: string;
}

/**
 * Find & replace as a small panel rather than a modal: the worksheet stays
 * visible and clickable while you step through matches.
 */
export function FindReplacePanel({ lang, sheet, onSelect, onReplaceAll, onReplaceOne, onClose, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const [index, setIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const options: FindOptions = useMemo(() => ({ caseSensitive, wholeCell }), [caseSensitive, wholeCell]);
  const matches = useMemo(() => findMatches(sheet, query, options), [sheet, query, options]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setIndex(-1);
  }, [query, caseSensitive, wholeCell]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const findNext = (backwards = false) => {
    if (!query.trim() || !matches.length) return;
    const next = index < 0
      ? 0
      : (index + (backwards ? -1 : 1) + matches.length) % matches.length;
    setIndex(next);
    onSelect(matches[next]);
  };

  const replaceCurrent = () => {
    if (!query.trim()) return;
    const target = matches[index] ?? matches[0];
    if (!target) return;
    onReplaceOne(target, query, replacement, options);
    if (!matches[index]) setIndex(0);
  };

  const status = !query.trim()
    ? ''
    : matches.length
      ? t(lang, 'find.count', { i: Math.max(0, index) + (index >= 0 ? 1 : 0), n: matches.length })
      : t(lang, 'find.none');

  return (
    <div className="find-panel" role="dialog" aria-label={t(lang, 'find.title')} data-testid="find-panel">
      <div className="find-head">
        <span className="find-title">{t(lang, 'find.title')}</span>
        <span className="spacer" />
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')} data-testid="find-close">×</button>
      </div>
      <div className="find-row">
        <label className="find-label" htmlFor="find-input">{t(lang, 'find.find')}</label>
        <input
          id="find-input"
          ref={inputRef}
          className="text-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); findNext(event.shiftKey); }
          }}
          data-testid="find-input"
        />
      </div>
      <div className="find-row">
        <label className="find-label" htmlFor="replace-input">{t(lang, 'find.replace')}</label>
        <input
          id="replace-input"
          className="text-input"
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); replaceCurrent(); }
          }}
          data-testid="replace-input"
        />
      </div>
      <div className="find-opts">
        <label className="check">
          <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} data-testid="find-case" />
          {t(lang, 'find.case')}
        </label>
        <label className="check">
          <input type="checkbox" checked={wholeCell} onChange={(event) => setWholeCell(event.target.checked)} data-testid="find-whole" />
          {t(lang, 'find.whole')}
        </label>
      </div>
      <div className="find-foot">
        <span className="find-status" data-testid="find-status">{status}</span>
        <span className="spacer" />
        <button type="button" className="btn ghost sm" onClick={() => findNext(true)} disabled={!matches.length} data-testid="find-prev">{t(lang, 'find.prev')}</button>
        <button type="button" className="btn ghost sm" onClick={() => findNext(false)} disabled={!matches.length} data-testid="find-next">{t(lang, 'find.next')}</button>
        <button type="button" className="btn ghost sm" onClick={replaceCurrent} disabled={!matches.length} data-testid="replace-one">{t(lang, 'find.replaceOne')}</button>
        <button type="button" className="btn primary sm" onClick={() => onReplaceAll(query, replacement, options)} disabled={!matches.length} data-testid="replace-all">{t(lang, 'find.replaceAll')}</button>
      </div>
    </div>
  );
}
