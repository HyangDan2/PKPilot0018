import { useEffect, useState } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { IconX } from './Icons';

interface Props {
  lang: Lang;
  initial: 'help' | 'about';
  onClose: () => void;
}

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Ctrl + E', label: 'help.k.rerun' },
  { keys: 'Ctrl + Z', label: 'help.k.undo' },
  { keys: 'Ctrl + Shift + Z', label: 'help.k.redo' },
  { keys: 'Shift + Click', label: 'help.k.select' },
  { keys: 'Ctrl + Click', label: 'help.k.select' },
  { keys: 'Ctrl + A', label: 'help.k.select' },
  { keys: 'Ctrl + C', label: 'help.k.copy' },
  { keys: 'Ctrl + X', label: 'help.k.cut' },
  { keys: 'Ctrl + V', label: 'help.k.paste' },
  { keys: 'Ctrl + Arrow', label: 'help.k.boundary' },
  { keys: 'F2 / Enter', label: 'help.k.edit' },
  { keys: 'Right-click', label: 'help.k.menu' },
  { keys: 'Delete', label: 'help.k.delete' },
  { keys: 'Esc', label: 'help.k.escape' },
];

export function HelpModal({ lang, initial, onClose }: Props) {
  const [tab, setTab] = useState<'help' | 'about'>(initial);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal narrow" role="dialog" aria-modal="true" aria-label={t(lang, 'help.title')}>
        <div className="modal-head">
          <div>
            <h3>{tab === 'help' ? t(lang, 'help.title') : t(lang, 'about.title')}</h3>
            <div className="modal-sub">HD2LAB · SIGRÚN</div>
          </div>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t(lang, 'close')}><IconX size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="dlg-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'help'} onClick={() => setTab('help')}>{t(lang, 'help.help')}</button>
            <button type="button" role="tab" aria-selected={tab === 'about'} onClick={() => setTab('about')}>{t(lang, 'about.title')}</button>
          </div>

          {tab === 'help' ? (
            <div className="help-body">
              <section className="help-sec">
                <h4>{t(lang, 'help.overview')}</h4>
                <p>{t(lang, 'help.overviewText')}</p>
              </section>
              <section className="help-sec">
                <h4>{t(lang, 'help.analyses')}</h4>
                <p>{t(lang, 'help.analysesList')}</p>
              </section>
              <section className="help-sec">
                <h4>{t(lang, 'help.data')}</h4>
                <p>{t(lang, 'help.dataText')}</p>
              </section>
              <section className="help-sec">
                <h4>{t(lang, 'help.shortcuts')}</h4>
                <table className="kbd-table">
                  <tbody>
                    {SHORTCUTS.map((row) => (
                      <tr key={row.keys}>
                        <td><kbd>{row.keys}</kbd></td>
                        <td>{t(lang, row.label)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <section className="help-sec">
                <h4>{t(lang, 'help.privacy')}</h4>
                <p>{t(lang, 'help.privacyText')}</p>
              </section>
            </div>
          ) : (
            <div className="help-body">
              <p>{t(lang, 'about.text')}</p>
              <p className="mono-note">PHASE 1 · {new Date().getFullYear()}</p>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>{t(lang, 'close')}</button>
        </div>
      </div>
    </div>
  );
}
