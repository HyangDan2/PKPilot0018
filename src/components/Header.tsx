import { useEffect, useRef, useState } from 'react';
import type { Lang, Settings } from '../types';
import { t } from '../lib/i18n';
import { IconCheck, IconDots, IconDownload, IconExternal, IconLayout, IconMoon, IconPlus, IconSun } from './Icons';
import type { LayoutPresetId } from '../lib/layout';
import { LAYOUT_PRESETS } from '../lib/layout';
import { WORKSPACE_LAYOUTS, type WorkspaceLayout } from '../lib/workspace';

/** The HD2Lab wordmark: the official dual-skew `.mark` (CSS), never an SVG logo. */
export function Brand({ lang }: { lang: Lang }) {
  return (
    <div className="brand" data-testid="brand" aria-label={`HD2Lab Sigrún — ${t(lang, 'brand.tag')}`}>
      <span className="brand-mark" aria-hidden><span className="mark" /></span>
      <span className="brand-name">HD2Lab</span>
      <span className="brand-div" aria-hidden />
      <span className="brand-app">Sigrún</span>
      <span className="brand-badge">STATISTICAL WORKSPACE</span>
    </div>
  );
}

interface ActionsProps {
  settings: Settings;
  onToggleTheme: () => void;
  onLang: (lang: Lang) => void;
  onHelp: () => void;
  onSaveProject: () => void;
  onOpenProject: () => void;
  onNewSheet: () => void;
  onResetLayout: () => void;
  onLayout: (id: LayoutPresetId) => void;
  workspaceLayout: WorkspaceLayout;
  onWorkspaceLayout: (id: WorkspaceLayout) => void;
}

/** Language, theme and the kebab portal menu — the right end of the single top bar. */
export function HeaderActions({
  settings, onToggleTheme, onLang, onHelp, onSaveProject, onOpenProject, onNewSheet, onResetLayout, onLayout,
  workspaceLayout, onWorkspaceLayout,
}: ActionsProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const lang = settings.lang;
  const dark = settings.theme === 'dark';

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="header-actions" ref={wrapRef} data-testid="header-actions">
      <div className="seg" role="group" aria-label={t(lang, 'view.language')}>
        <button type="button" aria-pressed={lang === 'ko'} onClick={() => onLang('ko')} title={t(lang, 'view.korean')} data-testid="lang-ko">KO</button>
        <button type="button" aria-pressed={lang === 'en'} onClick={() => onLang('en')} title={t(lang, 'view.english')} data-testid="lang-en">EN</button>
      </div>

      <button
        type="button"
        className="icon-btn"
        onClick={onToggleTheme}
        aria-label={dark ? t(lang, 'theme.toLight') : t(lang, 'theme.toDark')}
        title={dark ? t(lang, 'theme.toLight') : t(lang, 'theme.toDark')}
        data-testid="theme-toggle"
      >
        {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
      </button>

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className={`icon-btn menu-btn${open ? ' open' : ''}`}
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t(lang, 'nav.menu')}
          title={t(lang, 'nav.menu')}
          data-testid="menu-button"
        >
          <IconDots size={18} />
        </button>

        {open && (
          <div className="popover menu-pop" style={{ position: 'absolute', right: 0, left: 'auto', top: 'calc(100% + 8px)', minWidth: 262 }} role="menu">
            <button type="button" role="menuitem" className="menu-item" onClick={run(onHelp)}>
              <span className="mi-label">{t(lang, 'help.help')}</span>
              <span className="mi-kbd">?</span>
            </button>
            <span className="menu-sep" />
            <p className="mono-note" style={{ padding: '4px 8px 2px' }}>{t(lang, 'nav.workspace')}</p>
            <button type="button" role="menuitem" className="menu-item" onClick={run(onSaveProject)}>
              <span className="mi-label">{t(lang, 'file.save')}</span>
              <span className="mi-kbd"><IconDownload size={12} /></span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={run(onOpenProject)}>
              <span className="mi-label">{t(lang, 'file.open')}</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={run(onNewSheet)}>
              <span className="mi-label">{t(lang, 'data.newSheet')}</span>
              <span className="mi-kbd"><IconPlus size={12} /></span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={run(onResetLayout)}>
              <span className="mi-label">{t(lang, 'view.resetLayout')}</span>
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={run(onToggleTheme)}>
              <span className="mi-label">{dark ? t(lang, 'theme.toLight') : t(lang, 'theme.toDark')}</span>
            </button>
            <span className="menu-sep" />
            <p className="mono-note" style={{ padding: '4px 8px 2px' }}>{t(lang, 'view.workspace')}</p>
            {WORKSPACE_LAYOUTS.map((layout) => (
              <button key={layout.id} type="button" role="menuitem" className="menu-item" onClick={run(() => onWorkspaceLayout(layout.id))} data-testid={`kebab-ws-${layout.id}`}>
                <span className="mi-label">{t(lang, layout.labelKey)}</span>
                <span className="mi-kbd">{workspaceLayout === layout.id ? <IconCheck size={12} /> : <IconLayout size={12} />}</span>
              </button>
            ))}
            <span className="menu-sep" />
            <p className="mono-note" style={{ padding: '4px 8px 2px' }}>{t(lang, 'view.layout')}</p>
            {LAYOUT_PRESETS.map((preset) => (
              <button key={preset.id} type="button" role="menuitem" className="menu-item" onClick={run(() => onLayout(preset.id))} data-testid={`kebab-layout-${preset.id}`}>
                <span className="mi-label">{t(lang, preset.labelKey)}</span>
                <span className="mi-kbd"><IconLayout size={12} /></span>
              </button>
            ))}
            <span className="menu-sep" />
            <p className="mono-note" style={{ padding: '4px 8px 2px' }}>{t(lang, 'nav.navigation')}</p>
            <a className="menu-item" role="menuitem" href="https://hyangdan2.github.io/" target="_blank" rel="noopener noreferrer">
              <span className="mi-label">{t(lang, 'nav.webhq')}</span>
              <span className="mi-kbd"><IconExternal size={12} /></span>
            </a>
            <a className="menu-item" role="menuitem" href="https://hyangdan2.github.io/ApplicationHub/" target="_blank" rel="noopener noreferrer">
              <span className="mi-label">{t(lang, 'nav.apphub')}</span>
              <span className="mi-kbd"><IconExternal size={12} /></span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
