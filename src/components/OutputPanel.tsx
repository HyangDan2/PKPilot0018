import { useEffect, useRef, useState } from 'react';
import type { Block, ChartSpec, Lang, OutputDoc } from '../types';
import { fmtTime } from '../lib/format';
import { resolveLabel, t } from '../lib/i18n';
import { downloadBlob, downloadFile } from '../lib/project';
import { inlineTheme, renderChart } from '../lib/charts';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { IconChevronDown, IconCopy, IconDownload, IconPrinter, IconRerun, IconTrash, IconX } from './Icons';

interface Props {
  lang: Lang;
  outputs: OutputDoc[];
  focusedOutput: string | null;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onCollapseAll: (collapsed: boolean) => void;
  onToast: (message: string) => void;
  onRerun: (output: OutputDoc) => void;
  onReproduce: (output: OutputDoc) => void;
  onUpdateBlocks: (id: string, blocks: Block[]) => void;
}

interface ChartEdit {
  outputId: string;
  blockIndex: number;
  chartIndex: number;
  chart: ChartSpec;
}

function chartsOf(blocks: Block[]): { chart: ChartSpec; title: string }[] {
  const out: { chart: ChartSpec; title: string }[] = [];
  blocks.forEach((block) => {
    if (block.type === 'chart') out.push({ chart: block.chart, title: block.caption ?? '' });
    if (block.type === 'chartgrid') out.push(...block.charts);
  });
  return out;
}

function tableCsv(blocks: Block[], lang: Lang): string {
  const lines: string[] = [];
  blocks.forEach((block) => {
    if (block.type !== 'table') return;
    if (block.title) lines.push(resolveLabel(lang, block.title));
    lines.push(block.headers.map((h) => `"${resolveLabel(lang, h).replace(/"/g, '""')}"`).join(','));
    block.rows.forEach((row) => {
      lines.push(row.map((cell) => {
        const text = typeof cell === 'string' ? resolveLabel(lang, cell) : String(cell);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      }).join(','));
    });
    lines.push('');
  });
  return lines.join('\r\n');
}

/** The card as plain text: titles, text lines and tab-separated tables. */
export function cardText(output: OutputDoc, lang: Lang): string {
  const lines: string[] = [t(lang, output.titleKey)];
  if (output.subtitle) lines.push(output.subtitle);
  output.blocks.forEach((block) => {
    if (block.type === 'text') {
      block.lines.forEach((line) => lines.push(resolveLabel(lang, line)));
      return;
    }
    if (block.type === 'chart') {
      if (block.caption) lines.push(`[${resolveLabel(lang, block.caption)}]`);
      return;
    }
    if (block.type === 'chartgrid') {
      block.charts.forEach((item) => { if (item.title) lines.push(`[${resolveLabel(lang, item.title)}]`); });
      return;
    }
    if (block.title) lines.push(resolveLabel(lang, block.title));
    lines.push(block.headers.map((header) => resolveLabel(lang, header)).join('\t'));
    block.rows.forEach((row) => {
      lines.push(row.map((cell) => (typeof cell === 'string' ? resolveLabel(lang, cell) : String(cell))).join('\t'));
    });
  });
  return lines.join('\n');
}

/** Clipboard text, with the textarea fallback older browsers still need. */
async function writeTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

const SVG_WIDTH = 560;

function escText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Split a rendered chart into its inner markup and its intrinsic height. */
function chartBody(svg: string): { inner: string; h: number } {
  const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  return {
    inner: svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''),
    h: viewBox ? Number(viewBox[2]) : 260,
  };
}

function captionMarkup(label: string): string {
  if (!label) return '';
  return `<text x="10" y="14" font-family="ui-monospace, Menlo, monospace" font-size="10" letter-spacing="1" fill="#7C7690">${escText(label.toUpperCase())}</text>`;
}

/** One chart as a self-contained, theme-inlined SVG document (for export and clipboard). */
export function chartSvgDoc(chart: ChartSpec, lang: Lang, caption?: string): string {
  const { inner, h } = chartBody(renderChart(chart));
  const label = caption ? resolveLabel(lang, caption) : '';
  const header = label ? 20 : 0;
  const total = h + header + 10;
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${total}" viewBox="0 0 ${SVG_WIDTH} ${total}">`
    + `<rect width="${SVG_WIDTH}" height="${total}" fill="#FFFFFF"/>`
    + `<g transform="translate(0 ${header})">${captionMarkup(label)}${inner}</g></svg>`;
  return inlineTheme(doc);
}

export function composeSvg(blocks: Block[], lang: Lang, title: string): string | null {
  const charts = chartsOf(blocks);
  if (!charts.length) return null;
  let y = 0;
  const parts: string[] = [];
  charts.forEach(({ chart, title: chartTitle }) => {
    const { inner, h } = chartBody(renderChart(chart));
    const label = chartTitle ? resolveLabel(lang, chartTitle) : '';
    const header = label ? 20 : 0;
    parts.push(`<g transform="translate(0 ${y})">${captionMarkup(label)}<g transform="translate(0 ${header})">${inner}</g></g>`);
    y += h + header + 10;
  });
  const total = Math.max(60, y);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${total}" viewBox="0 0 ${SVG_WIDTH} ${total}"><title>${escText(title)}</title><rect width="${SVG_WIDTH}" height="${total}" fill="#FFFFFF"/>${parts.join('')}</svg>`;
  return inlineTheme(svg);
}

type CopyOutcome = 'copied' | 'unsupported' | 'denied';

/** Rasterise a standalone SVG at 2× with a white background. */
async function svgToPng(svg: string, scale = 2): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const source = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('svg-load'));
    });
    image.src = url;
    await loaded;
    const width = image.naturalWidth || 560;
    const height = image.naturalHeight || 300;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/*
 * Clipboard images need two things this browser may not have: the async
 * ClipboardItem API and the permission to write to the clipboard. Both are
 * reported separately so the caller can fall back to a PNG download instead of
 * claiming a copy that never happened.
 */
async function writePngToClipboard(blob: Blob): Promise<CopyOutcome> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return 'unsupported';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    return 'denied';
  }
}

function replaceChart(block: Block, chartIndex: number, chart: ChartSpec): Block {
  if (block.type === 'chart') return { ...block, chart };
  if (block.type === 'chartgrid') return { ...block, charts: block.charts.map((item, i) => (i === chartIndex ? { ...item, chart } : item)) };
  return block;
}

export function OutputPanel({
  lang, outputs, focusedOutput, onFocus, onDelete, onToggleCollapse, onCollapseAll, onToast, onRerun, onReproduce, onUpdateBlocks,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [edit, setEdit] = useState<ChartEdit | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; outputId: string | null } | null>(null);
  const [draft, setDraft] = useState({ title: '', xLabel: '', yLabel: '', bins: '', normal: false });

  /** Copy text blocks and tables of one card (or every card) to the clipboard. */
  const copyAsText = async (text: string) => {
    if (!text.trim()) {
      onToast(t(lang, 'toast.textCopyEmpty'));
      return;
    }
    const ok = await writeTextToClipboard(text);
    onToast(t(lang, ok ? 'toast.textCopied' : 'toast.textCopyFailed'));
  };

  const cardMenuItems = (output: OutputDoc): ContextMenuItem[] => [
    { id: 'out-copy-text', label: t(lang, 'outctx.copyText'), onSelect: () => void copyAsText(cardText(output, lang)) },
    { id: 'out-copy-chart', label: t(lang, 'outctx.copyChart'), onSelect: () => void handleCopy(output) },
    { id: 'out-save-chart', label: t(lang, 'outctx.saveChart'), onSelect: () => void handlePng(output) },
    { id: 'out-csv', label: t(lang, 'outctx.csv'), onSelect: () => handleCsv(output) },
    { id: 'out-sep-1', label: '', separator: true },
    { id: 'out-rerun', label: t(lang, 'outctx.rerun'), onSelect: () => onRerun(output) },
    { id: 'out-reproduce', label: t(lang, 'outctx.reproduce'), onSelect: () => onReproduce(output) },
    { id: 'out-sep-2', label: '', separator: true },
    {
      id: 'out-collapse',
      label: t(lang, output.collapsed ? 'outctx.expand' : 'outctx.collapse'),
      onSelect: () => onToggleCollapse(output.id),
    },
    { id: 'out-sep-3', label: '', separator: true },
    { id: 'out-delete', label: t(lang, 'outctx.delete'), danger: true, onSelect: () => onDelete(output.id) },
  ];

  const areaMenuItems = (): ContextMenuItem[] => [
    {
      id: 'area-copy-all',
      label: t(lang, 'outctx.copyAll'),
      disabled: outputs.length === 0,
      onSelect: () => void copyAsText(outputs.map((output) => cardText(output, lang)).join('\n\n')),
    },
    { id: 'area-sep-1', label: '', separator: true },
    { id: 'area-collapse-all', label: t(lang, 'outctx.collapseAll'), disabled: !outputs.some((o) => !o.collapsed), onSelect: () => onCollapseAll(true) },
    { id: 'area-expand-all', label: t(lang, 'outctx.expandAll'), disabled: !outputs.some((o) => o.collapsed), onSelect: () => onCollapseAll(false) },
  ];

  const openCardMenu = (event: React.MouseEvent, output: OutputDoc) => {
    event.preventDefault();
    event.stopPropagation();
    onFocus(output.id);
    setMenu({ x: event.clientX, y: event.clientY, outputId: output.id });
  };

  const openAreaMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, outputId: null });
  };

  const menuOutput = menu?.outputId ? outputs.find((output) => output.id === menu.outputId) : undefined;

  const openEditor = (output: OutputDoc, blockIndex: number, chartIndex: number, chart: ChartSpec) => {
    setEdit({ outputId: output.id, blockIndex, chartIndex, chart });
    setDraft({
      title: chart.title ?? '',
      xLabel: ('xLabel' in chart ? chart.xLabel : '') ?? '',
      yLabel: ('yLabel' in chart ? chart.yLabel : '') ?? '',
      bins: chart.kind === 'histogram' && chart.bins ? String(chart.bins) : '',
      normal: chart.kind === 'histogram' ? Boolean(chart.normal) : false,
    });
  };

  const applyEdit = () => {
    if (!edit) return;
    const output = outputs.find((o) => o.id === edit.outputId);
    if (!output) {
      setEdit(null);
      return;
    }
    const chart = edit.chart;
    const next: ChartSpec = { ...chart, title: draft.title.trim() || undefined };
    if ('xLabel' in next) next.xLabel = draft.xLabel.trim() || undefined;
    if ('yLabel' in next) next.yLabel = draft.yLabel.trim() || undefined;
    if (next.kind === 'histogram') {
      next.normal = draft.normal;
      const bins = Number(draft.bins);
      next.bins = Number.isFinite(bins) && bins >= 2 ? Math.round(bins) : undefined;
    }
    onUpdateBlocks(output.id, output.blocks.map((block, index) => (index === edit.blockIndex ? replaceChart(block, edit.chartIndex, next) : block)));
    setEdit(null);
  };

  const handleSvg = (output: OutputDoc) => {
    const svg = composeSvg(output.blocks, lang, t(lang, output.titleKey));
    if (!svg) {
      onToast(t(lang, 'card.noTable'));
      return;
    }
    downloadFile(`sigrun-${output.titleKey.replace('an.', '')}-${output.id}.svg`, svg, 'image/svg+xml');
  };

  const handlePng = async (output: OutputDoc) => {
    const svg = composeSvg(output.blocks, lang, t(lang, output.titleKey));
    if (!svg) {
      onToast(t(lang, 'card.noTable'));
      return;
    }
    const blob = await svgToPng(svg, 2);
    if (!blob) {
      onToast(t(lang, 'card.pngFailed'));
      return;
    }
    downloadBlob(`sigrun-${output.titleKey.replace('an.', '')}-${output.id}.png`, blob);
    onToast(t(lang, 'card.pngSaved'));
  };

  const copyPng = async (svg: string, fileName: string) => {
    const blob = await svgToPng(svg, 2);
    if (!blob) {
      onToast(t(lang, 'card.pngFailed'));
      return;
    }
    const outcome = await writePngToClipboard(blob);
    if (outcome === 'copied') {
      onToast(t(lang, 'card.copied'));
      return;
    }
    // Never let a blocked copy look like a success: hand over the same PNG.
    downloadBlob(fileName, blob);
    onToast(t(lang, outcome === 'denied' ? 'card.copyDenied' : 'card.copyUnsupported'));
  };

  const handleCopy = async (output: OutputDoc) => {
    const svg = composeSvg(output.blocks, lang, t(lang, output.titleKey));
    if (!svg) {
      onToast(t(lang, 'card.noChart'));
      return;
    }
    await copyPng(svg, `sigrun-${output.titleKey.replace('an.', '')}-${output.id}.png`);
  };

  const handleCopyOne = async (chart: ChartSpec, caption?: string) => {
    await copyPng(chartSvgDoc(chart, lang, caption), `sigrun-chart-${Date.now()}.png`);
  };

  const handleCsv = (output: OutputDoc) => {
    const csv = tableCsv(output.blocks, lang);
    if (!csv.trim()) {
      onToast(t(lang, 'card.noTable'));
      return;
    }
    downloadFile(`sigrun-${output.titleKey.replace('an.', '')}-${output.id}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const handlePrint = (output: OutputDoc) => {
    const node = document.getElementById(`card-${output.id}`);
    if (!node) return;
    document.body.classList.add('printing-one');
    node.classList.add('print-target');
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-one');
      node.classList.remove('print-target');
    }, 400);
  };

  return (
    <div className="output-scroll" ref={scrollRef} data-testid="output-panel" onContextMenu={openAreaMenu}>
      {outputs.length === 0 && (
        <div className="out-empty">
          <b>{t(lang, 'out.emptyTitle')}</b>
          <p>{t(lang, 'out.emptyBody')}</p>
        </div>
      )}

      {outputs.map((output) => (
        <article
          key={output.id}
          id={`card-${output.id}`}
          className={`out-card${output.collapsed ? ' collapsed' : ''}${focusedOutput === output.id ? ' focused' : ''}`}
          onClick={() => onFocus(output.id)}
          onContextMenu={(event) => openCardMenu(event, output)}
          data-testid="out-card"
        >
          <div className="out-head">
            <button
              type="button"
              className="out-caret"
              onClick={(event) => { event.stopPropagation(); onToggleCollapse(output.id); }}
              aria-label={output.collapsed ? t(lang, 'card.expand') : t(lang, 'card.collapse')}
              title={output.collapsed ? t(lang, 'card.expand') : t(lang, 'card.collapse')}
            >
              <IconChevronDown size={14} />
            </button>
            <div className="out-titles">
              <div className="out-title">{t(lang, output.titleKey)}</div>
              <div className="out-sub">
                {output.subtitle ? `${output.subtitle} · ` : ''}{fmtTime(output.createdAt)}
                {output.meta && <span className="out-meta"> · {output.meta.sheetName} · {t(lang, 'card.snapshot')}</span>}
              </div>
            </div>
            <div className="out-tools" onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => onRerun(output)} title={t(lang, 'card.rerun')} aria-label={t(lang, 'card.rerun')} data-testid="card-rerun">
                <IconRerun size={14} />
              </button>
              <button type="button" onClick={() => onReproduce(output)} title={t(lang, 'card.reproduce')} aria-label={t(lang, 'card.reproduce')} data-testid="card-reproduce">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /></svg>
              </button>
              <button type="button" onClick={() => void handleCopy(output)} title={t(lang, 'card.copy')} aria-label={t(lang, 'card.copy')} data-testid="card-copy">
                <IconCopy size={14} />
              </button>
              <button type="button" onClick={() => handleCsv(output)} title={t(lang, 'card.csv')} aria-label={t(lang, 'card.csv')} data-testid="card-csv">
                <IconDownload size={14} />
              </button>
              <button type="button" onClick={() => handleSvg(output)} title={t(lang, 'card.svg')} aria-label={t(lang, 'card.svg')} data-testid="card-svg">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 18V6M20 18V9M4 18h16" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="14" r="1.6" /></svg>
              </button>
              <button type="button" onClick={() => void handlePng(output)} title={t(lang, 'card.png')} aria-label={t(lang, 'card.png')} data-testid="card-png">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l5-4 4 3 3-2 6 4" /></svg>
              </button>
              <button type="button" onClick={() => handlePrint(output)} title={t(lang, 'card.pdf')} aria-label={t(lang, 'card.pdf')} data-testid="card-pdf">
                <IconPrinter size={14} />
              </button>
              <button type="button" onClick={() => onDelete(output.id)} title={t(lang, 'card.delete')} aria-label={t(lang, 'card.delete')} data-testid="card-delete">
                <IconTrash size={14} />
              </button>
            </div>
          </div>

          {!output.collapsed && (
            <div className="out-body">
              {output.blocks.map((block, index) => (
                <BlockView
                  key={index}
                  block={block}
                  lang={lang}
                  onEditChart={(chartIndex, chart) => openEditor(output, index, chartIndex, chart)}
                  onCopyChart={(chart, caption) => void handleCopyOne(chart, caption)}
                />
              ))}
            </div>
          )}
        </article>
      ))}

      {outputs.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 10px' }}>
          <span className="mono-note">SIGRÚN · {outputs.length} · {t(lang, 'panel.cards', { n: outputs.length })}</span>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={t(lang, 'outctx.title')}
          items={menuOutput ? cardMenuItems(menuOutput) : areaMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}

      {edit && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setEdit(null); }}>
          <div className="modal chart-edit-modal" role="dialog" aria-modal="true" aria-label={t(lang, 'card.editChart')} data-testid="chart-edit-modal">
            <div className="modal-head">
              <div>
                <h3>{t(lang, 'card.editChart')}</h3>
                <div className="modal-sub">{edit.chart.kind.toUpperCase()}</div>
              </div>
              <span className="spacer" />
              <button type="button" className="icon-btn" onClick={() => setEdit(null)} aria-label={t(lang, 'dlg.cancel')}><IconX size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="slot">
                <span className="slot-label">{t(lang, 'chart.title')}</span>
                <input className="text-input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} data-testid="chart-title" />
              </div>
              {'xLabel' in edit.chart && (
                <div className="slot">
                  <span className="slot-label">{t(lang, 'chart.xLabel')}</span>
                  <input className="text-input" value={draft.xLabel} onChange={(e) => setDraft({ ...draft, xLabel: e.target.value })} data-testid="chart-xlabel" />
                </div>
              )}
              {'yLabel' in edit.chart && (
                <div className="slot">
                  <span className="slot-label">{t(lang, 'chart.yLabel')}</span>
                  <input className="text-input" value={draft.yLabel} onChange={(e) => setDraft({ ...draft, yLabel: e.target.value })} data-testid="chart-ylabel" />
                </div>
              )}
              {edit.chart.kind === 'histogram' && (
                <>
                  <div className="slot">
                    <span className="slot-label">{t(lang, 'slot.bins')}</span>
                    <input className="num-input" type="number" min={2} max={50} value={draft.bins} onChange={(e) => setDraft({ ...draft, bins: e.target.value })} data-testid="chart-bins" />
                  </div>
                  <label className="check-row">
                    <input type="checkbox" checked={draft.normal} onChange={(e) => setDraft({ ...draft, normal: e.target.checked })} data-testid="chart-normal" />
                    {t(lang, 'opt.normalCurve')}
                  </label>
                </>
              )}
            </div>
            <div className="modal-foot">
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setEdit(null)}>{t(lang, 'dlg.cancel')}</button>
              <button type="button" className="btn primary" onClick={applyEdit} data-testid="chart-edit-ok">{t(lang, 'dlg.ok')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CHART_MIN_WIDTH = 280;
const CHART_MAX_WIDTH = 780;

/**
 * Renders a chart at the width its card actually has. A ResizeObserver feeds
 * the measured width back in, so widening or narrowing a floating output
 * window redraws the chart at that width instead of stretching a fixed SVG.
 */
function ChartCanvas({ chart, compact }: { chart: ChartSpec; compact: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(compact ? 380 : 560);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = Math.round(node.clientWidth);
      if (next > 0) setMeasured((prev) => (Math.abs(prev - next) >= 1 ? next : prev));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(node);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);

  const width = Math.max(CHART_MIN_WIDTH, Math.min(measured, CHART_MAX_WIDTH));
  return <div ref={hostRef} className="chart-canvas" dangerouslySetInnerHTML={{ __html: renderChart(chart, width) }} />;
}

function BlockView({
  block, lang, onEditChart, onCopyChart,
}: {
  block: Block;
  lang: Lang;
  onEditChart: (chartIndex: number, chart: ChartSpec) => void;
  onCopyChart: (chart: ChartSpec, caption?: string) => void;
}) {
  const compact = typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
  if (block.type === 'text') {
    return (
      <div className="out-text">
        {block.lines.map((line, i) => (
          <div key={i}>{resolveLabel(lang, line)}</div>
        ))}
      </div>
    );
  }
  if (block.type === 'chart') {
    return (
      <div className="chart-card">
        {block.caption && <h5>{resolveLabel(lang, block.caption)}</h5>}
        <div className="chart-holder">
          <ChartCanvas chart={block.chart} compact={compact} />
          <button
            type="button"
            className="chart-copy-btn"
            onClick={() => onCopyChart(block.chart, block.caption)}
            title={t(lang, 'card.copyOne')}
            aria-label={t(lang, 'card.copyOne')}
            data-testid="chart-copy"
          >
            <IconCopy size={13} />
          </button>
          <button
            type="button"
            className="chart-edit-btn"
            onClick={() => onEditChart(0, block.chart)}
            title={t(lang, 'card.editChart')}
            aria-label={t(lang, 'card.editChart')}
            data-testid="chart-edit"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L20 8l-4-4L4 16z" /></svg>
          </button>
        </div>
      </div>
    );
  }
  if (block.type === 'chartgrid') {
    return (
      <div className="chart-grid">
        {block.charts.map((item, i) => (
          <div className="chart-card" key={i}>
            <h5>{resolveLabel(lang, item.title)}</h5>
            <div className="chart-holder">
              <ChartCanvas chart={item.chart} compact={compact} />
              <button
                type="button"
                className="chart-copy-btn"
                onClick={() => onCopyChart(item.chart, item.title)}
                title={t(lang, 'card.copyOne')}
                aria-label={t(lang, 'card.copyOne')}
                data-testid={`chart-copy-${i}`}
              >
                <IconCopy size={13} />
              </button>
              <button
                type="button"
                className="chart-edit-btn"
                onClick={() => onEditChart(i, item.chart)}
                title={t(lang, 'card.editChart')}
                aria-label={t(lang, 'card.editChart')}
                data-testid={`chart-edit-${i}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L20 8l-4-4L4 16z" /></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      {block.title && <div className="out-block-title">{resolveLabel(lang, block.title)}</div>}
      <div className="table-scroll">
        <table className="stat-table">
          <thead>
            <tr>
              {block.headers.map((header, i) => (
                <th key={i} className={block.align?.[i] === 'r' ? 'al-r' : block.align?.[i] === 'c' ? 'al-c' : ''}>
                  {resolveLabel(lang, header)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={block.alarmRow?.includes(rowIndex) ? 'alarm' : block.groupRow?.includes(rowIndex) ? 'group-row' : ''}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={block.align?.[cellIndex] === 'r' ? 'al-r' : block.align?.[cellIndex] === 'c' ? 'al-c' : ''}>
                    {typeof cell === 'string' ? resolveLabel(lang, cell) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.caption && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-secondary)' }}>{resolveLabel(lang, block.caption)}</p>}
    </div>
  );
}

export function PrintClose() {
  return <IconX size={12} />;
}
