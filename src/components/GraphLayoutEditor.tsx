import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartSpec, Lang, OutputDoc } from '../types';
import type { ChartConfig } from '../lib/chartConfig';
import { renderChart, resolveStandaloneSvg } from '../lib/charts';
import { downloadBlob, downloadFile } from '../lib/project';
import { svgToPngWithConfig } from '../lib/chartExport';
import { t } from '../lib/i18n';
import { ChartCanvas } from './ChartFrame';
import {
  LayoutHistory,
  PAGE_PRESETS,
  addChartPanel,
  addPanel,
  alignPanels,
  contentBox,
  createLayout,
  distributePanels,
  duplicatePanels,
  figureFileName,
  layoutSvg,
  matchSize,
  movePanels,
  pageExportConfig,
  parseLayout,
  relabelFigures,
  removePanels,
  reorderPanels,
  resizePanel,
  serializeLayout,
  setPageSize,
  unifyChartStyle,
  updatePanel,
  type AlignMode,
  type LayoutDoc,
  type LayoutPanel,
  type PagePresetId,
  type PanelKind,
} from '../lib/graphLayout';
import { IconX } from './Icons';

interface Props {
  lang: Lang;
  outputs: OutputDoc[];
  initial?: LayoutDoc | null;
  onClose: () => void;
  onSave: (doc: LayoutDoc) => void;
  onToast: (message: string) => void;
}

interface ChartRef {
  outputId: string;
  blockIndex: number;
  chartIndex: number;
  chart: ChartSpec;
  config?: ChartConfig;
  caption: string;
  outputTitle: string;
}

/** Every chart currently in the output, in reading order. */
function chartLibrary(outputs: OutputDoc[], lang: Lang): ChartRef[] {
  const out: ChartRef[] = [];
  outputs.forEach((output) => {
    const title = t(lang, output.titleKey);
    output.blocks.forEach((block, blockIndex) => {
      if (block.type === 'chart') {
        out.push({ outputId: output.id, blockIndex, chartIndex: 0, chart: block.chart, config: block.chart.config, caption: block.caption ?? block.chart.title ?? '', outputTitle: title });
      }
      if (block.type === 'chartgrid') {
        block.charts.forEach((item, chartIndex) => {
          out.push({ outputId: output.id, blockIndex, chartIndex, chart: item.chart, config: item.chart.config, caption: item.title, outputTitle: title });
        });
      }
    });
  });
  return out;
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;

const ALIGN_BUTTONS: { mode: AlignMode; label: string; glyph: string }[] = [
  { mode: 'left', label: 'gl.alignLeft', glyph: '⇤' },
  { mode: 'center', label: 'gl.alignCenter', glyph: '↔' },
  { mode: 'right', label: 'gl.alignRight', glyph: '⇥' },
  { mode: 'top', label: 'gl.alignTop', glyph: '⤒' },
  { mode: 'middle', label: 'gl.alignMiddle', glyph: '↕' },
  { mode: 'bottom', label: 'gl.alignBottom', glyph: '⤓' },
];

const ANNOTATIONS: { kind: Exclude<PanelKind, 'chart' | 'image'>; label: string }[] = [
  { kind: 'text', label: 'gl.insertText' },
  { kind: 'arrow', label: 'gl.insertArrow' },
  { kind: 'line', label: 'gl.insertLine' },
  { kind: 'rectangle', label: 'gl.insertRect' },
  { kind: 'circle', label: 'gl.insertCircle' },
  { kind: 'highlight', label: 'gl.insertHighlight' },
  { kind: 'figure-label', label: 'gl.insertLabel' },
];

const PANEL_NAME: Record<PanelKind, string> = {
  chart: 'Chart',
  text: 'Text',
  arrow: 'Arrow',
  line: 'Line',
  rectangle: 'Rectangle',
  circle: 'Circle',
  highlight: 'Highlight',
  'figure-label': 'Label',
  image: 'Image',
};

export function GraphLayoutEditor({ lang, outputs, initial, onClose, onSave, onToast }: Props) {
  const historyRef = useRef<LayoutHistory | null>(null);
  if (!historyRef.current) historyRef.current = new LayoutHistory(initial ?? createLayout('a4-landscape'));
  const [doc, setDocState] = useState<LayoutDoc>(historyRef.current.state());
  const [selected, setSelected] = useState<string[]>([]);
  const [scale, setScale] = useState(2.4);
  const [stylePreset, setStylePreset] = useState('engineering');
  const [drag, setDrag] = useState<null | {
    kind: 'move' | 'resize';
    handle?: string;
    start: { x: number; y: number };
    base: LayoutDoc;
    id: string;
  }>(null);
  const [preview, setPreview] = useState<LayoutDoc | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);

  const view = preview ?? doc;
  const library = useMemo(() => chartLibrary(outputs, lang), [outputs, lang]);

  const commit = useCallback((next: LayoutDoc) => {
    const history = historyRef.current as LayoutHistory;
    const state = history.push(next);
    setDocState({ ...state });
  }, []);

  const replace = useCallback((next: LayoutDoc) => {
    const history = historyRef.current as LayoutHistory;
    setDocState({ ...history.reset(next) });
    setSelected([]);
  }, []);

  const doUndo = () => {
    const history = historyRef.current as LayoutHistory;
    setDocState({ ...history.undo() });
  };
  const doRedo = () => {
    const history = historyRef.current as LayoutHistory;
    setDocState({ ...history.redo() });
  };

  useEffect(() => {
    const fit = () => {
      const node = stageRef.current;
      if (!node) return;
      const width = node.clientWidth - 32;
      const height = node.clientHeight - 32;
      const next = Math.max(0.6, Math.min(width / view.page.widthMm, height / view.page.heightMm));
      setScale(Number(next.toFixed(2)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [view.page.widthMm, view.page.heightMm]);

  const selectedPanels = view.panels.filter((panel) => selected.includes(panel.id));

  const addChart = (entry: ChartRef) => {
    const { doc: next } = addChartPanel(doc, {
      outputId: entry.outputId,
      blockIndex: entry.blockIndex,
      chartIndex: entry.chartIndex,
      chart: entry.chart,
      config: entry.config,
      caption: entry.caption,
      size: entry.chart.kind === 'surface3d' ? { w: 110, h: 85 } : { w: 110, h: 78 },
    });
    commit(next);
    onToast(t(lang, 'gl.chartAdded', { name: entry.caption || entry.outputTitle }));
  };

  const insert = (kind: Exclude<PanelKind, 'chart' | 'image'>) => {
    const { doc: next, panel } = addPanel(doc, kind);
    commit(next);
    setSelected([panel.id]);
  };

  const onPointerDownPanel = (event: React.PointerEvent, panel: LayoutPanel, handle?: string) => {
    event.stopPropagation();
    if (panel.locked) return;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const nextSelection = additive
      ? (selected.includes(panel.id) ? selected.filter((id) => id !== panel.id) : [...selected, panel.id])
      : (selected.includes(panel.id) ? selected : [panel.id]);
    setSelected(nextSelection);
    setDrag({ kind: handle ? 'resize' : 'move', handle, start: { x: event.clientX, y: event.clientY }, base: doc, id: panel.id });
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag) return;
    const dxMm = (event.clientX - drag.start.x) / scale;
    const dyMm = (event.clientY - drag.start.y) / scale;
    if (drag.kind === 'move') {
      setPreview(movePanels(drag.base, selected.includes(drag.id) ? selected : [drag.id], dxMm, dyMm));
      return;
    }
    const panel = drag.base.panels.find((entry) => entry.id === drag.id);
    if (!panel) return;
    const resized = resizePanel(drag.base, panel, drag.handle ?? 'se', dxMm, dyMm, { snap: true });
    setPreview({ ...drag.base, panels: drag.base.panels.map((entry) => (entry.id === panel.id ? resized : entry)) });
  };

  const onPointerUp = () => {
    if (drag && preview) commit(preview);
    setDrag(null);
    setPreview(null);
  };

  const exportFigure = async (format: 'svg' | 'png', dpi = 300) => {
    const svg = layoutSvg(view, (panel) => ({ svg: resolveStandaloneSvg(renderChart(panel.chart, { width: 640, config: panel.config })) }));
    if (format === 'svg') {
      downloadFile(figureFileName(view, 'svg'), svg, 'image/svg+xml');
      onToast(t(lang, 'gl.exported'));
      return;
    }
    const raster = await svgToPngWithConfig(svg, pageExportConfig(view, 'png', dpi));
    if (!raster) {
      onToast(t(lang, 'gl.exportFailed'));
      return;
    }
    downloadBlob(figureFileName(view, 'png', dpi), raster.blob);
    onToast(t(lang, 'gl.exportedDpi', { dpi }));
  };

  const copyFigure = async () => {
    const svg = layoutSvg(view, (panel) => ({ svg: resolveStandaloneSvg(renderChart(panel.chart, { width: 640, config: panel.config })) }));
    const raster = await svgToPngWithConfig(svg, pageExportConfig(view, 'png', 300));
    if (!raster) {
      onToast(t(lang, 'gl.exportFailed'));
      return;
    }
    try {
      const item = new ClipboardItem({ 'image/png': raster.blob });
      await navigator.clipboard.write([item]);
      onToast(t(lang, 'gl.copied'));
    } catch {
      downloadBlob(figureFileName(view, 'png', 300), raster.blob);
      onToast(t(lang, 'gl.copyFallback'));
    }
  };

  const saveLayout = () => {
    onSave(view);
    downloadFile('sigrun-layout.sigrun.json', serializeLayout(view), 'application/json');
    onToast(t(lang, 'gl.saved'));
  };

  const loadLayout = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseLayout(String(reader.result ?? ''));
      if (!parsed) {
        onToast(t(lang, 'gl.loadFailed'));
        return;
      }
      replace(parsed);
      onToast(t(lang, 'gl.loaded', { n: parsed.panels.length }));
    };
    reader.readAsText(file);
  };

  const insertImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const href = String(reader.result ?? '');
      const { doc: next, panel } = addPanel(doc, 'image');
      commit(updatePanel(next, panel.id, { href, name: file.name } as Partial<LayoutPanel>));
      setSelected([panel.id]);
    };
    reader.readAsDataURL(file);
  };

  const patchSelected = (patch: Partial<LayoutPanel>) => {
    if (!selected.length) return;
    let next = doc;
    selected.forEach((id) => { next = updatePanel(next, id, patch); });
    commit(next);
  };

  const page = contentBox(view);

  return (
    <div className="gl-modal" role="dialog" aria-modal="true" aria-label={t(lang, 'gl.title')} data-testid="graph-layout">
      <header className="gl-head">
        <b>{t(lang, 'gl.title')}</b>
        <span className="gl-page-label" data-testid="gl-page-label">{view.page.preset} · {view.page.widthMm}×{view.page.heightMm} mm</span>
        <span className="spacer" />
        <button type="button" className="icon-btn" onClick={doUndo} data-testid="gl-undo" title={t(lang, 'edit.undo')}>↶</button>
        <button type="button" className="icon-btn" onClick={doRedo} data-testid="gl-redo" title={t(lang, 'edit.redo')}>↷</button>
        <button type="button" className="icon-btn" onClick={() => { onSave(view); onClose(); }} data-testid="gl-close" aria-label={t(lang, 'ct.close')}><IconX size={14} /></button>
      </header>

      <div className="gl-body">
        <aside className="gl-side">
          <section>
            <h4>{t(lang, 'gl.page')}</h4>
            <select
              className="cd-input"
              value={view.page.preset}
              onChange={(event) => commit(setPageSize(view, event.target.value as PagePresetId))}
              data-testid="gl-page-preset"
            >
              {PAGE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{t(lang, `gl.page.${preset.id}`)}</option>
              ))}
            </select>
            <label className="gl-check">
              <input type="checkbox" checked={view.grid.enabled} onChange={(event) => commit({ ...view, grid: { ...view.grid, enabled: event.target.checked } })} data-testid="gl-grid-toggle" />
              <span>{t(lang, 'gl.gridSnap')} · {view.grid.sizeMm} mm</span>
            </label>
            <input
              className="cd-input"
              type="range"
              min={1}
              max={10}
              value={view.grid.sizeMm}
              onChange={(event) => commit({ ...view, grid: { ...view.grid, sizeMm: Number(event.target.value) } })}
              aria-label={t(lang, 'gl.gridSnap')}
            />
          </section>

          <section>
            <h4>{t(lang, 'gl.charts')}</h4>
            {library.length === 0 && <p className="gl-hint">{t(lang, 'gl.noCharts')}</p>}
            <div className="gl-library">
              {library.map((entry, index) => (
                <button
                  key={`${entry.outputId}-${entry.blockIndex}-${entry.chartIndex}`}
                  type="button"
                  onClick={() => addChart(entry)}
                  data-testid={`gl-chart-${index}`}
                  title={`${entry.outputTitle} · ${entry.chart.kind}`}
                >
                  <span className="gl-kind">{entry.chart.kind}</span>
                  <span>{entry.caption || entry.outputTitle}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h4>{t(lang, 'gl.annotations')}</h4>
            <div className="gl-tools">
              {ANNOTATIONS.map((entry) => (
                <button key={entry.kind} type="button" onClick={() => insert(entry.kind)} data-testid={`gl-add-${entry.kind}`}>{t(lang, entry.label)}</button>
              ))}
              <button type="button" onClick={() => imageRef.current?.click()} data-testid="gl-add-image">{t(lang, 'gl.insertImage')}</button>
              <button type="button" onClick={() => commit(relabelFigures(view))} data-testid="gl-relabel">{t(lang, 'gl.relabel')}</button>
            </div>
          </section>

          <section>
            <h4>{t(lang, 'gl.arrange')}</h4>
            <div className="gl-tools">
              {ALIGN_BUTTONS.map((entry) => (
                <button key={entry.mode} type="button" title={t(lang, entry.label)} onClick={() => commit(alignPanels(view, selected, entry.mode))} data-testid={`gl-align-${entry.mode}`}>{entry.glyph}</button>
              ))}
              <button type="button" onClick={() => commit(distributePanels(view, selected, 'x'))} data-testid="gl-distribute-x">{t(lang, 'gl.distributeX')}</button>
              <button type="button" onClick={() => commit(distributePanels(view, selected, 'y'))} data-testid="gl-distribute-y">{t(lang, 'gl.distributeY')}</button>
              <button type="button" onClick={() => commit(matchSize(view, selected))} data-testid="gl-match-size">{t(lang, 'gl.matchSize')}</button>
              <button type="button" onClick={() => { const copy = duplicatePanels(view, selected); commit(copy.doc); setSelected(copy.ids); }} data-testid="gl-duplicate">{t(lang, 'gl.duplicate')}</button>
              <button type="button" onClick={() => commit(reorderPanels(view, selected, 'front'))} data-testid="gl-front">{t(lang, 'gl.front')}</button>
              <button type="button" onClick={() => commit(reorderPanels(view, selected, 'back'))} data-testid="gl-back">{t(lang, 'gl.back')}</button>
              <button type="button" onClick={() => commit(reorderPanels(view, selected, 'forward'))} data-testid="gl-forward">{t(lang, 'gl.forward')}</button>
              <button type="button" onClick={() => commit(reorderPanels(view, selected, 'backward'))} data-testid="gl-backward">{t(lang, 'gl.backward')}</button>
              <button type="button" className="danger" onClick={() => { commit(removePanels(view, selected)); setSelected([]); }} data-testid="gl-delete">{t(lang, 'gl.delete')}</button>
            </div>
          </section>

          <section>
            <h4>{t(lang, 'gl.style')}</h4>
            <div className="gl-row">
              <select className="cd-input" value={stylePreset} onChange={(event) => setStylePreset(event.target.value)} data-testid="gl-style-preset">
                {['sigrun-classic', 'engineering', 'scientific', 'corporate', 'monochrome', 'high-contrast', 'dark'].map((preset) => (
                  <option key={preset} value={preset}>{preset}</option>
                ))}
              </select>
              <button type="button" onClick={() => commit(unifyChartStyle(view, { preset: stylePreset }))} data-testid="gl-unify">{t(lang, 'gl.unify')}</button>
            </div>
          </section>

          <section>
            <h4>{t(lang, 'gl.output')}</h4>
            <div className="gl-tools">
              <button type="button" onClick={() => exportFigure('svg')} data-testid="gl-export-svg">SVG</button>
              {[150, 300, 600].map((dpi) => (
                <button key={dpi} type="button" onClick={() => void exportFigure('png', dpi)} data-testid={`gl-export-png-${dpi}`}>PNG {dpi}</button>
              ))}
              <button type="button" onClick={() => void copyFigure()} data-testid="gl-copy">{t(lang, 'gl.copy')}</button>
              <button type="button" onClick={saveLayout} data-testid="gl-save">{t(lang, 'gl.save')}</button>
              <button type="button" onClick={() => fileRef.current?.click()} data-testid="gl-load">{t(lang, 'gl.load')}</button>
            </div>
            <p className="gl-hint" data-testid="gl-raster-note">
              {view.panels.some((panel) => panel.kind === 'chart' && panel.raster) ? t(lang, 'gl.rasterNote') : t(lang, 'gl.vectorNote')}
            </p>
          </section>
        </aside>

        <div className="gl-stage" ref={stageRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
          <div
            className="gl-page"
            data-testid="gl-canvas"
            style={{ width: `${view.page.widthMm * scale}px`, height: `${view.page.heightMm * scale}px`, background: view.page.background }}
            onClick={(event) => { if (event.target === event.currentTarget) setSelected([]); }}
          >
            <div
              className="gl-margin"
              style={{ left: `${page.x * scale}px`, top: `${page.y * scale}px`, width: `${page.w * scale}px`, height: `${page.h * scale}px` }}
            />
            {[...view.panels].sort((a, b) => a.z - b.z).map((panel) => {
              const active = selected.includes(panel.id);
              return (
                <div
                  key={panel.id}
                  className={`gl-panel gl-${panel.kind}${active ? ' selected' : ''}`}
                  data-testid="gl-panel"
                  data-kind={panel.kind}
                  data-panel-id={panel.id}
                  style={{
                    left: `${panel.x * scale}px`,
                    top: `${panel.y * scale}px`,
                    width: `${panel.w * scale}px`,
                    height: `${panel.h * scale}px`,
                    zIndex: panel.z,
                  }}
                  onPointerDown={(event) => onPointerDownPanel(event, panel)}
                >
                  {panel.kind === 'chart' && (
                    <div className="gl-chart-body">
                      <ChartCanvas chart={panel.chart} config={panel.config} maxWidth={panel.w * scale} lang={lang} />
                      {panel.caption && <div className="gl-caption">{panel.caption}</div>}
                    </div>
                  )}
                  {panel.kind === 'text' && (
                    <div className="gl-text" style={{ fontSize: `${panel.fontSize * scale * 0.36}px`, color: panel.color || '#111827', fontWeight: panel.bold ? 700 : 400, textAlign: panel.align }}>
                      {panel.text || t(lang, 'gl.emptyText')}
                    </div>
                  )}
                  {panel.kind === 'figure-label' && (
                    <div className="gl-figure" style={{ fontSize: `${panel.fontSize * scale * 0.36}px`, fontWeight: panel.bold ? 700 : 400 }}>{panel.label}</div>
                  )}
                  {panel.kind === 'image' && (
                    panel.href
                      ? <img src={panel.href} alt={panel.name} style={{ width: '100%', height: '100%', objectFit: panel.maintainAspect ? 'contain' : 'fill' }} />
                      : <div className="gl-empty">{t(lang, 'gl.emptyImage')}</div>
                  )}
                  {(panel.kind === 'rectangle' || panel.kind === 'highlight') && (
                    <div style={{ width: '100%', height: '100%', background: panel.fill ? panel.fill : 'transparent', opacity: panel.fill ? panel.opacity : 1, border: panel.width ? `${Math.max(1, panel.width * scale * 0.36)}px ${panel.dash ? 'dashed' : 'solid'} ${panel.color}` : 'none' }} />
                  )}
                  {panel.kind === 'circle' && (
                    <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: panel.fill || 'transparent', border: `${Math.max(1, panel.width * scale * 0.36)}px ${panel.dash ? 'dashed' : 'solid'} ${panel.color}` }} />
                  )}
                  {(panel.kind === 'arrow' || panel.kind === 'line') && (
                    <div className="gl-line-box">
                      <div style={{ borderTop: `${Math.max(1, panel.width * scale * 0.36)}px ${panel.dash ? 'dashed' : 'solid'} ${panel.color}` }} />
                      {panel.kind === 'arrow' && <span className="gl-arrow-head" style={{ borderLeftColor: panel.color }} />}
                    </div>
                  )}
                  {active && HANDLES.map((handle) => (
                    <span
                      key={handle}
                      className={`gl-handle gl-${handle}`}
                      data-testid={`gl-handle-${handle}`}
                      onPointerDown={(event) => onPointerDownPanel(event, panel, handle)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="gl-inspector" data-testid="gl-inspector">
          <h4>{t(lang, 'gl.inspector')}</h4>
          {selectedPanels.length === 0 && <p className="gl-hint">{t(lang, 'gl.noSelection')}</p>}
          {selectedPanels.length > 1 && <p className="gl-hint">{t(lang, 'gl.multiSelection', { n: selectedPanels.length })}</p>}
          {selectedPanels.length === 1 && (() => {
            const panel = selectedPanels[0];
            return (
              <div className="gl-props">
                <div className="gl-prop-row"><b>{PANEL_NAME[panel.kind]}</b><span className="gl-hint">{panel.w.toFixed(1)}×{panel.h.toFixed(1)} mm</span></div>
                <label>{t(lang, 'gl.x')}<input className="cd-input" type="number" value={panel.x} onChange={(event) => commit(updatePanel(view, panel.id, { x: Number(event.target.value) }))} /></label>
                <label>{t(lang, 'gl.y')}<input className="cd-input" type="number" value={panel.y} onChange={(event) => commit(updatePanel(view, panel.id, { y: Number(event.target.value) }))} /></label>
                <label>{t(lang, 'gl.w')}<input className="cd-input" type="number" value={panel.w} onChange={(event) => commit(updatePanel(view, panel.id, { w: Math.max(4, Number(event.target.value)) }))} /></label>
                <label>{t(lang, 'gl.h')}<input className="cd-input" type="number" value={panel.h} onChange={(event) => commit(updatePanel(view, panel.id, { h: Math.max(4, Number(event.target.value)) }))} /></label>
                <label className="gl-check"><input type="checkbox" checked={Boolean(panel.locked)} onChange={(event) => commit(updatePanel(view, panel.id, { locked: event.target.checked }))} /><span>{t(lang, 'gl.locked')}</span></label>
                {panel.kind === 'chart' && (
                  <>
                    <label>{t(lang, 'gl.caption')}<input className="cd-input" value={panel.caption} onChange={(event) => patchSelected({ caption: event.target.value } as Partial<LayoutPanel>)} data-testid="gl-caption-input" /></label>
                    <p className="gl-hint">{panel.raster ? t(lang, 'gl.panelRaster') : t(lang, 'gl.panelVector')}</p>
                  </>
                )}
                {panel.kind === 'text' && (
                  <>
                    <label>{t(lang, 'gl.text')}<textarea className="cd-input" rows={3} value={panel.text} onChange={(event) => patchSelected({ text: event.target.value } as Partial<LayoutPanel>)} data-testid="gl-text-input" /></label>
                    <label>{t(lang, 'gl.fontSize')}<input className="cd-input" type="number" value={panel.fontSize} onChange={(event) => patchSelected({ fontSize: Number(event.target.value) } as Partial<LayoutPanel>)} /></label>
                    <label className="gl-check"><input type="checkbox" checked={panel.bold} onChange={(event) => patchSelected({ bold: event.target.checked } as Partial<LayoutPanel>)} /><span>{t(lang, 'gl.bold')}</span></label>
                  </>
                )}
                {panel.kind === 'figure-label' && (
                  <label>{t(lang, 'gl.label')}<input className="cd-input" value={panel.label} onChange={(event) => patchSelected({ label: event.target.value } as Partial<LayoutPanel>)} /></label>
                )}
                {(panel.kind === 'arrow' || panel.kind === 'line' || panel.kind === 'rectangle' || panel.kind === 'circle' || panel.kind === 'highlight') && (
                  <>
                    <label>{t(lang, 'gl.stroke')}<input className="cd-input" type="color" value={/^#[0-9a-f]{6}$/i.test(panel.color) ? panel.color : '#111827'} onChange={(event) => patchSelected({ color: event.target.value } as Partial<LayoutPanel>)} /></label>
                    <label>{t(lang, 'gl.fill')}<input className="cd-input" type="color" value={/^#[0-9a-f]{6}$/i.test(panel.fill || '') ? panel.fill : '#fde68a'} onChange={(event) => patchSelected({ fill: event.target.value } as Partial<LayoutPanel>)} /></label>
                    <label>{t(lang, 'gl.width')}<input className="cd-input" type="number" step={0.2} value={panel.width} onChange={(event) => patchSelected({ width: Number(event.target.value) } as Partial<LayoutPanel>)} /></label>
                    <label>{t(lang, 'gl.opacity')}<input className="cd-input" type="number" step={0.05} min={0} max={1} value={panel.opacity} onChange={(event) => patchSelected({ opacity: Number(event.target.value) } as Partial<LayoutPanel>)} /></label>
                  </>
                )}
              </div>
            );
          })()}
          <div className="gl-stats" data-testid="gl-stats">{t(lang, 'gl.stat', { n: view.panels.length })}</div>
        </aside>
      </div>

      <input ref={fileRef} type="file" accept=".json,.sigrun.json,application/json" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) loadLayout(file); event.target.value = ''; }} />
      <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) insertImage(file); event.target.value = ''; }} />
    </div>
  );
}
