import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { DATASETS } from '../lib/datasets';
import { IconChart, IconChevronDown, IconDownload, IconGrid, IconLayers, IconPlus, IconRerun, IconSigma, IconTable } from './Icons';

interface Props {
  lang: Lang;
  sheetName: string;
  sheetColumns: number;
  canRerun: boolean;
  onSample: (id: string) => void;
  onAnalysis: (id: string) => void;
  onNewSheet: () => void;
  onRerun: () => void;
  onExportCsv: () => void;
}

export function Toolbar({ lang, sheetName, sheetColumns, canRerun, onSample, onAnalysis, onNewSheet, onRerun, onExportCsv }: Props) {
  const [sampleOpen, setSampleOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setSampleOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div className="toolbar" data-testid="toolbar">
      <div ref={ref} style={{ position: 'relative' }}>
        <button type="button" className="tool-btn" onClick={() => setSampleOpen((v) => !v)} aria-expanded={sampleOpen} data-testid="sample-button">
          <IconLayers size={15} /><span>{t(lang, 'tb.sample')}</span><IconChevronDown size={12} />
        </button>
        {sampleOpen && (
          <div className="menu-pop" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: 280 }} role="menu">
            <p className="mono-note" style={{ padding: '4px 8px 2px' }}>{t(lang, 'sample.load')}</p>
            {DATASETS.map((ds) => (
              <button
                key={ds.id}
                type="button"
                className="menu-item"
                role="menuitem"
                onClick={() => { setSampleOpen(false); onSample(ds.id); }}
                data-testid={`sample-${ds.id}`}
              >
                <span className="mi-label">{t(lang, ds.nameKey)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="tool-sep" />

      <button type="button" className="tool-btn" onClick={() => onAnalysis('desc')} data-testid="quick-desc">
        <IconSigma size={15} /><span>{t(lang, 'tb.desc')}</span>
      </button>
      <button type="button" className="tool-btn" onClick={() => onAnalysis('imr')} data-testid="quick-imr">
        <IconChart size={15} /><span>{t(lang, 'tb.imr')}</span>
      </button>
      <button type="button" className="tool-btn" onClick={() => onAnalysis('histogram')} data-testid="quick-hist">
        <IconTable size={15} /><span>{t(lang, 'tb.hist')}</span>
      </button>
      <button type="button" className="tool-btn" onClick={() => onAnalysis('capability')} data-testid="quick-capability">
        <IconGrid size={15} /><span>{t(lang, 'tb.capability')}</span>
      </button>

      <span className="tool-sep" />

      <button type="button" className="tool-btn accent" onClick={onRerun} disabled={!canRerun} title={t(lang, 'help.k.rerun')} data-testid="quick-rerun">
        <IconRerun size={15} /><span>{t(lang, 'tb.rerun')}</span><kbd>Ctrl+E</kbd>
      </button>

      <span className="tool-sep" />

      <button type="button" className="tool-btn" onClick={onNewSheet} data-testid="quick-newsheet">
        <IconPlus size={15} /><span>{t(lang, 'tb.newSheet')}</span>
      </button>
      <button type="button" className="tool-btn" onClick={onExportCsv} data-testid="quick-export">
        <IconDownload size={15} /><span>{t(lang, 'tb.export')}</span>
      </button>

      <span className="tool-sep" />
      <span className="sheet-pill" title={sheetName}>
        <b>{sheetName}</b><span>{sheetColumns}</span>
      </span>
    </div>
  );
}
