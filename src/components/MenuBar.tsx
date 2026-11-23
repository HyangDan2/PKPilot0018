import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Lang } from '../types';
import { t } from '../lib/i18n';
import { DATASETS } from '../lib/datasets';
import { LAYOUT_PRESETS } from '../lib/layout';
import { IconCheck, IconChevron } from './Icons';

export type MenuAction =
  | 'new' | 'save' | 'open' | 'importCsv' | 'exportCsv' | 'importXlsx' | 'exportXlsx' | 'exportXlsxCurrent'
  | 'print' | 'undo' | 'redo' | 'copy' | 'paste'
  | 'clear' | 'insertRow' | 'deleteRow' | 'addColumn' | 'newSheet' | 'renameSheet' | 'deleteSheet'
  | 'help' | 'about' | 'theme' | 'langKo' | 'langEn' | 'resetLayout' | 'toggleNav'
  | 'layoutBalanced' | 'layoutSheet' | 'layoutResults' | 'layoutFocus';

interface MenuLeaf {
  labelKey: string;
  action?: MenuAction;
  analysis?: string;
  /** dialog values pre-selected when the analysis opens */
  preset?: Record<string, unknown>;
  sample?: string;
  kbd?: string;
  separatorBefore?: boolean;
  disabled?: boolean;
  /** menu shows a check mark (the active layout preset) */
  active?: boolean;
  children?: MenuLeaf[];
}

interface MenuDef {
  labelKey: string;
  items: MenuLeaf[];
}

interface Props {
  lang: Lang;
  canUndo: boolean;
  canRedo: boolean;
  navVisible: boolean;
  layoutPreset: string;
  /** wordmark rendered at the left end of the same bar as the menus */
  brand?: ReactNode;
  /** language · theme · kebab group rendered at the right end */
  actions?: ReactNode;
  onAction: (action: MenuAction) => void;
  onAnalysis: (id: string, preset?: Record<string, unknown>) => void;
  onSample: (id: string) => void;
}

const PRESET_ACTIONS: Record<string, MenuAction> = {
  balanced: 'layoutBalanced',
  sheet: 'layoutSheet',
  results: 'layoutResults',
  focus: 'layoutFocus',
};

function buildMenus(canUndo: boolean, canRedo: boolean, navVisible: boolean, layoutPreset: string): MenuDef[] {
  return [
    {
      labelKey: 'menu.file',
      items: [
        { labelKey: 'file.new', action: 'new' },
        { labelKey: 'file.open', action: 'open' },
        { labelKey: 'file.save', action: 'save', kbd: 'JSON' },
        { labelKey: 'file.importCsv', action: 'importCsv' },
        { labelKey: 'file.exportCsv', action: 'exportCsv' },
        { labelKey: 'file.importXlsx', action: 'importXlsx' },
        { labelKey: 'file.exportXlsx', action: 'exportXlsx' },
        { labelKey: 'file.exportXlsxCurrent', action: 'exportXlsxCurrent' },
        { labelKey: 'file.print', action: 'print', separatorBefore: true, kbd: 'PDF' },
        {
          labelKey: 'file.samples',
          separatorBefore: true,
          children: DATASETS.map((ds) => ({ labelKey: ds.nameKey, sample: ds.id })),
        },
        { labelKey: 'file.help', action: 'help', separatorBefore: true, kbd: '?' },
      ],
    },
    {
      labelKey: 'menu.edit',
      items: [
        { labelKey: 'edit.undo', action: 'undo', kbd: '⌘Z', disabled: !canUndo },
        { labelKey: 'edit.redo', action: 'redo', kbd: '⇧⌘Z', disabled: !canRedo },
        { labelKey: 'edit.copy', action: 'copy', separatorBefore: true, kbd: '⌘C' },
        { labelKey: 'edit.paste', action: 'paste', kbd: '⌘V' },
        { labelKey: 'edit.clear', action: 'clear', kbd: 'Del' },
        { labelKey: 'edit.insertRow', action: 'insertRow', separatorBefore: true },
        { labelKey: 'edit.deleteRow', action: 'deleteRow' },
      ],
    },
    {
      labelKey: 'menu.data',
      items: [
        { labelKey: 'data.sort', analysis: 'sort' },
        { labelKey: 'data.standardize', analysis: 'standardize' },
        { labelKey: 'data.recode', analysis: 'recode' },
        { labelKey: 'edit.addColumn', action: 'addColumn', separatorBefore: true },
        { labelKey: 'data.newSheet', action: 'newSheet' },
        { labelKey: 'data.renameSheet', action: 'renameSheet' },
        { labelKey: 'data.deleteSheet', action: 'deleteSheet' },
      ],
    },
    {
      labelKey: 'menu.calc',
      items: [
        { labelKey: 'calc.calculator', analysis: 'calculator', kbd: 'ƒ' },
        { labelKey: 'calc.random', analysis: 'random' },
      ],
    },
    {
      labelKey: 'menu.stat',
      items: [
        {
          labelKey: 'stat.basic',
          children: [
            { labelKey: 'stat.desc', analysis: 'desc' },
            { labelKey: 'stat.normality', analysis: 'normality' },
            { labelKey: 'stat.t1', analysis: 't1' },
            { labelKey: 'stat.t2', analysis: 't2' },
            { labelKey: 'stat.paired', analysis: 'paired' },
          ],
        },
        {
          labelKey: 'stat.anova',
          children: [
            { labelKey: 'stat.anova1', analysis: 'anova' },
            { labelKey: 'stat.glm', analysis: 'glm' },
          ],
        },
        { labelKey: 'stat.regression', children: [{ labelKey: 'stat.fitRegression', analysis: 'regression' }] },
        {
          labelKey: 'stat.control',
          children: [
            { labelKey: 'stat.imr', analysis: 'imr' },
            { labelKey: 'stat.xbarr', analysis: 'xbarr' },
            { labelKey: 'stat.xbars', analysis: 'xbars' },
            { labelKey: 'stat.pchart', analysis: 'pchart' },
            { labelKey: 'stat.np', analysis: 'npchart' },
            { labelKey: 'stat.c', analysis: 'cchart' },
            { labelKey: 'stat.u', analysis: 'uchart' },
          ],
        },
        {
          labelKey: 'stat.quality',
          children: [
            { labelKey: 'stat.capability', analysis: 'capability' },
            { labelKey: 'stat.sixpack', analysis: 'sixpack' },
            { labelKey: 'stat.nonnormal', analysis: 'capnonnormal' },
            { labelKey: 'stat.gagerrCrossed', analysis: 'gagerr', preset: { type: 'crossed' } },
            { labelKey: 'stat.gagerrNested', analysis: 'gagerr', preset: { type: 'nested' } },
            { labelKey: 'stat.pareto', analysis: 'pareto' },
          ],
        },
        {
          labelKey: 'stat.doe',
          children: [
            { labelKey: 'stat.doeCreate', analysis: 'doecreate' },
            { labelKey: 'stat.doeAnalyze', analysis: 'doeanalyze' },
            { labelKey: 'stat.rsmCreate', analysis: 'rsmcreate' },
            { labelKey: 'stat.rsmAnalyze', analysis: 'rsmanalyze' },
          ],
        },
        {
          labelKey: 'stat.reliability',
          children: [{ labelKey: 'stat.weibull', analysis: 'weibull' }],
        },
        {
          labelKey: 'stat.power',
          children: [
            { labelKey: 'stat.power1t', analysis: 'power1t' },
            { labelKey: 'stat.power2t', analysis: 'power2t' },
            { labelKey: 'stat.powerPaired', analysis: 'powerpaired' },
            { labelKey: 'stat.powerAnova', analysis: 'poweranova' },
            { labelKey: 'stat.powerProp1', analysis: 'powerprop1' },
            { labelKey: 'stat.powerProp2', analysis: 'powerprop2' },
          ],
        },
      ],
    },
    {
      labelKey: 'menu.graph',
      items: [
        { labelKey: 'graph.histogram', analysis: 'histogram' },
        { labelKey: 'graph.boxplot', analysis: 'boxplot' },
        { labelKey: 'graph.scatter', analysis: 'scatter' },
        { labelKey: 'graph.timeseries', analysis: 'timeseries' },
      ],
    },
    {
      labelKey: 'menu.view',
      items: [
        { labelKey: 'view.theme', action: 'theme' },
        {
          labelKey: 'view.language',
          children: [
            { labelKey: 'view.english', action: 'langEn' },
            { labelKey: 'view.korean', action: 'langKo' },
          ],
        },
        { labelKey: navVisible ? 'view.hideNavigator' : 'view.showNavigator', action: 'toggleNav', separatorBefore: true },
        {
          labelKey: 'view.layout',
          children: LAYOUT_PRESETS.map((preset) => ({
            labelKey: preset.labelKey,
            action: PRESET_ACTIONS[preset.id],
            active: preset.id === layoutPreset,
          })),
        },
        { labelKey: 'view.resetLayout', action: 'resetLayout', separatorBefore: true },
      ],
    },
    {
      labelKey: 'menu.help',
      items: [
        { labelKey: 'help.help', action: 'help', kbd: '?' },
        { labelKey: 'help.about', action: 'about', separatorBefore: true },
      ],
    },
  ];
}

export function MenuBar({
  lang, canUndo, canRedo, navVisible, layoutPreset, brand, actions, onAction, onAnalysis, onSample,
}: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const menus = buildMenus(canUndo, canRedo, navVisible, layoutPreset);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(null);
        setSub(null);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(null);
        setSub(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const close = () => {
    setOpen(null);
    setSub(null);
  };

  const pick = (leaf: MenuLeaf) => {
    if (leaf.disabled) return;
    if (leaf.children) return;
    close();
    if (leaf.analysis) onAnalysis(leaf.analysis, leaf.preset);
    else if (leaf.sample) onSample(leaf.sample);
    else if (leaf.action) onAction(leaf.action);
  };

  return (
    <div className="menubar" ref={ref} data-testid="menubar">
      {brand}
      <div className="menubar-menus" role="menubar" aria-label={t(lang, 'nav.menu')}>
      {menus.map((menu, index) => (
        <div className="menu-root" key={menu.labelKey}>
          <button
            type="button"
            className={`menu-btn${open === index ? ' open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open === index}
            onClick={() => {
              setOpen(index);
              setSub(null);
            }}
            onMouseEnter={() => {
              if (open !== null && open !== index) {
                setOpen(index);
                setSub(null);
              }
            }}
            data-testid={`menu-${menu.labelKey.replace('menu.', '')}`}
          >
            {t(lang, menu.labelKey)}
          </button>

          {open === index && (
            <div className="menu-pop" role="menu">
              {menu.items.map((item, itemIndex) => (
                <div
                  className="menu-row"
                  key={`${item.labelKey}-${itemIndex}`}
                  onMouseEnter={() => setSub(item.children ? item.labelKey : null)}
                >
                  {item.separatorBefore && <span className="menu-sep" />}
                  <button
                    type="button"
                    role="menuitem"
                    className={`menu-item${sub === item.labelKey && item.children ? ' active' : ''}`}
                    disabled={item.disabled}
                    data-testid={item.analysis || item.action || item.sample ? `menu-item-${item.analysis ?? item.action ?? item.sample}` : undefined}
                    onClick={() => (item.children ? setSub(item.labelKey) : pick(item))}
                  >
                    <span className="mi-label">{t(lang, item.labelKey)}</span>
                    {item.active && <span className="mi-check"><IconCheck size={11} /></span>}
                    {item.kbd && <span className="mi-kbd">{item.kbd}</span>}
                    {item.children && <span className="mi-arrow"><IconChevron size={12} /></span>}
                  </button>

                  {item.children && sub === item.labelKey && (
                    <div className="submenu" role="menu">
                      {item.children.map((child, childIndex) => (
                        <div key={`${child.labelKey}-${childIndex}`}>
                          {child.separatorBefore && <span className="menu-sep" />}
                          <button
                            type="button"
                            role="menuitem"
                            className="menu-item"
                            onClick={() => pick(child)}
                            data-testid={`menu-item-${child.analysis ?? child.action ?? child.sample ?? ''}`}
                          >
                            <span className="mi-label">{t(lang, child.labelKey)}</span>
                            {child.active && <span className="mi-check"><IconCheck size={11} /></span>}
                            {child.kbd && <span className="mi-kbd">{child.kbd}</span>}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      </div>
      <span className="header-spacer" />
      {actions}
    </div>
  );
}
