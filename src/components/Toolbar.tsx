import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { DATASETS } from '../lib/datasets';
import { IconChart, IconChevronDown, IconDownload, IconGrid, IconLayers, IconPlus, IconRerun, IconSigma, IconTable } from './Icons';
import { WORKSPACE_LAYOUTS, type WorkspaceLayout } from '../lib/workspace';

interface Props {
  lang: Lang;
  sheetName: string;
  sheetColumns: number;
  canRerun: boolean;
  workspaceLayout: WorkspaceLayout;
  onWorkspaceLayout: (id: WorkspaceLayout) => void;
  onSample: (id: string) => void;
  onSampleLibrary: () => void;
  onLearn: () => void;
  onAnalysis: (id: string) => void;
  onNewSheet: () => void;
  onRerun: () => void;
  onExportCsv: () => void;
}

interface Anchor { left: number; top: number; width: number }

export function Toolbar({
  lang, sheetName, sheetColumns, canRerun, workspaceLayout, onWorkspaceLayout, onSample, onSampleLibrary, onLearn, onAnalysis, onNewSheet, onRerun, onExportCsv,
}: Props) {
  const [sampleOpen, setSampleOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>({ left: 0, top: 0, width: 280 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /**
   * The toolbar scrolls horizontally (`overflow-x: auto`), and that clipping
   * context used to trap the dropdown behind the panels. The list is rendered
   * in a body-level portal with fixed coordinates, so no ancestor can clip or
   * under-stack it.
   */
  const measure = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(280, Math.min(360, window.innerWidth - 16));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    setAnchor({ left, top: rect.bottom + 6, width });
  };

  useEffect(() => {
    if (!sampleOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setSampleOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSampleOpen(false);
    };
    const onResize = () => { measure(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [sampleOpen]);

  const toggle = () => {
    if (!sampleOpen) measure();
    setSampleOpen((value) => !value);
  };

  return (
    <div className="toolbar" data-testid="toolbar">
      <button
        type="button"
        ref={buttonRef}
        className="tool-btn primary-sample"
        onClick={toggle}
        aria-expanded={sampleOpen}
        aria-haspopup="menu"
        data-testid="sample-button"
      >
        <IconLayers size={15} /><span>{t(lang, 'tb.sample')}</span><IconChevronDown size={12} />
      </button>

      {sampleOpen && createPortal(
        <div
          ref={menuRef}
          className="menu-pop sample-pop"
          style={{ position: 'fixed', left: anchor.left, top: anchor.top, minWidth: anchor.width, zIndex: 130 }}
          role="menu"
          data-testid="sample-menu"
        >
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
          <span className="menu-sep" />
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => { setSampleOpen(false); onSampleLibrary(); }}
            data-testid="sample-library-open"
          >
            <span className="mi-label">{t(lang, 'sample.library')}</span>
          </button>
        </div>,
        document.body,
      )}

      <button type="button" className="tool-btn accent" onClick={onLearn} data-testid="learn-sigrun">
        <IconLayers size={15} /><span>{t(lang, 'tut.learn')}</span>
      </button>

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

      <div className="ws-switch" role="group" aria-label={t(lang, 'view.workspace')} data-testid="ws-switch">
        {WORKSPACE_LAYOUTS.map((layout) => (
          <button
            key={layout.id}
            type="button"
            className="ws-switch-btn"
            aria-pressed={workspaceLayout === layout.id}
            onClick={() => onWorkspaceLayout(layout.id)}
            title={t(lang, layout.hintKey)}
            data-testid={`ws-layout-${layout.id}`}
          >
            <span className={`ws-icon ws-icon-${layout.id}`} aria-hidden />
            <span className="ws-switch-label">{t(lang, `ws.short.${layout.id}`)}</span>
          </button>
        ))}
      </div>

      <span className="tool-sep" />
      <span className="sheet-pill" title={sheetName}>
        <b>{sheetName}</b><span>{sheetColumns}</span>
      </span>
    </div>
  );
}
