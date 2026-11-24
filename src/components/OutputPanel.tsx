import { useRef, useState } from 'react';
import type { Block, ChartSpec, Lang, OutputDoc } from '../types';
import { fmtTime } from '../lib/format';
import { resolveLabel, t } from '../lib/i18n';
import { downloadBlob, downloadFile } from '../lib/project';
import { inlineTheme, renderChart } from '../lib/charts';
import type { ChartConfig, ExportConfig } from '../lib/chartConfig';
import { defaultExportConfig } from '../lib/chartConfig';
import {
  applyStylePack,
  fullChartConfig,
  materializeChart,
  packChartStyle,
  resetChartConfig,
  withChartConfig,
  allPairSurfaces,
  type ChartStylePack,
} from '../lib/chartConfigOps';
import { batchSvgDocument, chartSvgDocument, exportFileName, svgToPngWithConfig } from '../lib/chartExport';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { ChartFrame, ChartViewer, type ChartEditRequest } from './ChartFrame';
import { ChartPropertiesDrawer, type ChartDrawerTab } from './ChartPropertiesDrawer';
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
  /** Hand this card's fitted model to the model store (WO-02). */
  onSaveModel: (output: OutputDoc) => void;
}

interface ChartTarget {
  outputId: string;
  blockIndex: number;
  chartIndex: number;
}

function chartsOf(blocks: Block[]): { chart: ChartSpec; title: string; blockIndex: number; chartIndex: number }[] {
  const out: { chart: ChartSpec; title: string; blockIndex: number; chartIndex: number }[] = [];
  blocks.forEach((block, blockIndex) => {
    if (block.type === 'chart') out.push({ chart: block.chart, title: block.caption ?? '', blockIndex, chartIndex: 0 });
    if (block.type === 'chartgrid') block.charts.forEach((item, chartIndex) => out.push({ chart: item.chart, title: item.title, blockIndex, chartIndex }));
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

/** One chart as a self-contained, theme-inlined SVG document (page export). */
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

function chartAt(output: OutputDoc | undefined, target: ChartTarget): ChartSpec | null {
  if (!output) return null;
  const block = output.blocks[target.blockIndex];
  if (!block) return null;
  if (block.type === 'chart') return block.chart;
  if (block.type === 'chartgrid') return block.charts[target.chartIndex]?.chart ?? null;
  return null;
}

function captionAt(output: OutputDoc | undefined, target: ChartTarget): string {
  if (!output) return '';
  const block = output.blocks[target.blockIndex];
  if (!block) return '';
  if (block.type === 'chart') return block.caption ?? '';
  if (block.type === 'chartgrid') return block.charts[target.chartIndex]?.title ?? '';
  return '';
}

function blocksWithChart(output: OutputDoc, target: ChartTarget, chart: ChartSpec): Block[] {
  return output.blocks.map((block, index) => (index === target.blockIndex ? replaceChart(block, target.chartIndex, chart) : block));
}

export function OutputPanel({
  lang, outputs, focusedOutput, onFocus, onDelete, onToggleCollapse, onCollapseAll, onToast, onRerun, onReproduce, onUpdateBlocks, onSaveModel,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; outputId: string | null; target?: ChartTarget } | null>(null);
  const [drawer, setDrawer] = useState<{ target: ChartTarget; tab: ChartDrawerTab; axis?: 'x' | 'y' | 'z' | 'y2' } | null>(null);
  const [preview, setPreview] = useState<ChartConfig | null>(null);
  const [viewer, setViewer] = useState<{ target: ChartTarget; mode: 'zoom' | 'full' } | null>(null);
  const [styleClip, setStyleClip] = useState<ChartStylePack | null>(null);
  const [session, setSession] = useState(0);

  const findOutput = (id: string) => outputs.find((output) => output.id === id);
  const targetChart = drawer ? chartAt(findOutput(drawer.target.outputId), drawer.target) : null;
  const viewerOutput = viewer ? findOutput(viewer.target.outputId) : undefined;
  const viewerChart = viewer ? chartAt(viewerOutput, viewer.target) : null;

  /** Copy text blocks and tables of one card (or every card) to the clipboard. */
  const copyAsText = async (text: string) => {
    if (!text.trim()) {
      onToast(t(lang, 'toast.textCopyEmpty'));
      return;
    }
    const ok = await writeTextToClipboard(text);
    onToast(t(lang, ok ? 'toast.textCopied' : 'toast.textCopyFailed'));
  };

  const openDrawer = (target: ChartTarget, tab: ChartDrawerTab, axis?: 'x' | 'y' | 'z' | 'y2') => {
    const chart = chartAt(findOutput(target.outputId), target);
    if (!chart) return;
    setSession((value) => value + 1);
    setPreview(fullChartConfig(chart));
    setDrawer({ target, tab, axis });
  };

  const closeDrawer = () => {
    setDrawer(null);
    setPreview(null);
  };

  const commitChart = (target: ChartTarget, next: ChartSpec) => {
    const output = findOutput(target.outputId);
    if (!output) return;
    onUpdateBlocks(output.id, blocksWithChart(output, target, next));
  };

  const applyConfig = (config: ChartConfig) => {
    if (!drawer) return;
    const chart = chartAt(findOutput(drawer.target.outputId), drawer.target);
    if (!chart) return;
    const materialized = materializeChart(chart, config);
    commitChart(drawer.target, withChartConfig(materialized, config));
    onToast(t(lang, 'toast.cfgApplied'));
    closeDrawer();
  };

  const resetConfig = (config: ChartConfig) => {
    if (!drawer) return;
    const chart = chartAt(findOutput(drawer.target.outputId), drawer.target);
    if (!chart) return;
    const reset = withChartConfig(materializeChart(resetChartConfig(chart), config), config);
    commitChart(drawer.target, reset);
    onToast(t(lang, 'toast.styleReset'));
    setPreview(config);
  };

  const generatePairs = (config: ChartConfig) => {
    if (!drawer) return;
    const output = findOutput(drawer.target.outputId);
    const chart = chartAt(output, drawer.target);
    if (!output || !chart || chart.kind !== 'contour' || !chart.rsmModel) return;
    const surfaces = allPairSurfaces(chart.rsmModel, config.rsm, config.contour);
    if (!surfaces.length) return;
    const baseConfig = materializeChart(chart, config).config;
    const items = surfaces.map((surface) => ({
      title: `${surface.xName} × ${surface.yName}`,
      chart: {
        kind: 'contour' as const,
        xs: surface.grid.xs,
        ys: surface.grid.ys,
        z: surface.grid.z,
        xLabel: surface.xName,
        yLabel: surface.yName,
        xRange: surface.xRange,
        yRange: surface.yRange,
        points: surface.points,
        rsmModel: chart.rsmModel,
        title: `${surface.xName} × ${surface.yName}`,
        config: baseConfig,
      },
    }));
    const gridBlock: Block = { type: 'chartgrid', charts: items, caption: '@chart.grid.pairContours' };
    const blocks = [...output.blocks];
    blocks.splice(drawer.target.blockIndex + 1, 0, gridBlock);
    onUpdateBlocks(output.id, blocks);
    onToast(t(lang, 'toast.pairsAdded', { n: items.length }));
    closeDrawer();
  };

  /* ── export ─────────────────────────────────────────────────────────── */

  const downloadChart = async (chart: ChartSpec, config: ChartConfig, format: 'svg' | 'png', caption: string) => {
    const exportCfg: ExportConfig = { ...defaultExportConfig(), ...(config.export ?? {}), format };
    const { svg } = chartSvgDocument(chart, exportCfg, { caption: resolveLabel(lang, caption) });
    const name = exportFileName(chart, exportCfg, resolveLabel(lang, caption) || chart.title);
    if (format === 'svg') {
      downloadFile(name, svg, 'image/svg+xml');
      onToast(t(lang, 'toast.chartExported'));
      return;
    }
    const raster = await svgToPngWithConfig(svg, exportCfg);
    if (!raster) {
      onToast(t(lang, 'toast.chartExportFailed'));
      return;
    }
    downloadBlob(name, raster.blob);
    onToast(t(lang, 'toast.chartExported'));
  };

  const copyChartPng = async (chart: ChartSpec, config: ChartConfig, caption: string) => {
    const exportCfg: ExportConfig = { ...defaultExportConfig(), ...(config.export ?? {}), format: 'png' };
    const { svg } = chartSvgDocument(chart, exportCfg, { caption: resolveLabel(lang, caption) });
    const raster = await svgToPngWithConfig(svg, exportCfg);
    if (!raster) {
      onToast(t(lang, 'toast.chartExportFailed'));
      return;
    }
    const outcome = await writePngToClipboard(raster.blob);
    if (outcome === 'copied') {
      onToast(t(lang, 'toast.pngCopied'));
      return;
    }
    downloadBlob(exportFileName(chart, exportCfg, resolveLabel(lang, caption) || chart.title), raster.blob);
    onToast(t(lang, outcome === 'denied' ? 'card.copyDenied' : 'card.copyUnsupported'));
  };

  const batchExport = async (output: OutputDoc, config: ChartConfig, format: 'svg' | 'png') => {
    const entries = chartsOf(output.blocks).map((entry) => ({ chart: entry.chart, caption: resolveLabel(lang, entry.title) }));
    if (!entries.length) {
      onToast(t(lang, 'card.noChart'));
      return;
    }
    const exportCfg: ExportConfig = { ...defaultExportConfig(), ...(config.export ?? {}), format };
    const svg = batchSvgDocument(entries, exportCfg);
    const stem = `sigrun-${output.titleKey.replace('an.', '')}-${output.id}`;
    if (format === 'svg') {
      downloadFile(`${stem}-charts.svg`, svg, 'image/svg+xml');
      onToast(t(lang, 'toast.batchExported', { n: entries.length }));
      return;
    }
    const raster = await svgToPngWithConfig(svg, { ...exportCfg, background: exportCfg.background === 'transparent' ? 'transparent' : 'white' });
    if (!raster) {
      onToast(t(lang, 'toast.chartExportFailed'));
      return;
    }
    downloadBlob(`${stem}-charts.png`, raster.blob);
    onToast(t(lang, 'toast.batchExported', { n: entries.length }));
  };

  /* ── style clipboard ────────────────────────────────────────────────── */

  const copyStyleFrom = (config: ChartConfig) => {
    if (!drawer) return;
    const chart = chartAt(findOutput(drawer.target.outputId), drawer.target);
    if (!chart) return;
    setStyleClip(packChartStyle(withChartConfig(chart, config)));
    onToast(t(lang, 'toast.styleCopied'));
  };

  const pasteStyleTo = (config: ChartConfig) => {
    if (!styleClip || !drawer) return;
    const chart = chartAt(findOutput(drawer.target.outputId), drawer.target);
    if (!chart) return;
    const withStyle = withChartConfig(applyStylePack(materializeChart(chart, config), styleClip), { ...config, ...styleClip });
    commitChart(drawer.target, withStyle);
    onToast(t(lang, 'toast.stylePasted'));
    closeDrawer();
  };

  const applyStyleToAll = (config: ChartConfig) => {
    if (!drawer) return;
    const source = chartAt(findOutput(drawer.target.outputId), drawer.target);
    if (!source) return;
    const pack = packChartStyle(withChartConfig(source, config));
    let count = 0;
    outputs.forEach((output) => {
      const charts = chartsOf(output.blocks);
      if (!charts.length) return;
      const blocks = output.blocks.map((block) => {
        if (block.type === 'chart') {
          count += 1;
          return { ...block, chart: applyStylePack(block.chart, pack) };
        }
        if (block.type === 'chartgrid') {
          count += block.charts.length;
          return { ...block, charts: block.charts.map((item) => ({ ...item, chart: applyStylePack(item.chart, pack) })) };
        }
        return block;
      });
      onUpdateBlocks(output.id, blocks);
    });
    onToast(t(lang, 'toast.styleAppliedAll', { n: count }));
  };

  const resetStyleOf = (target: ChartTarget) => {
    const chart = chartAt(findOutput(target.outputId), target);
    if (!chart) return;
    commitChart(target, resetChartConfig(chart));
    onToast(t(lang, 'toast.styleReset'));
  };

  /* ── menus ──────────────────────────────────────────────────────────── */

  const cardMenuItems = (output: OutputDoc): ContextMenuItem[] => [
    { id: 'out-copy-text', label: t(lang, 'outctx.copyText'), onSelect: () => void copyAsText(cardText(output, lang)) },
    { id: 'out-copy-chart', label: t(lang, 'outctx.copyChart'), onSelect: () => void handleCopy(output) },
    { id: 'out-save-chart', label: t(lang, 'outctx.saveChart'), onSelect: () => void handlePng(output) },
    { id: 'out-csv', label: t(lang, 'outctx.csv'), onSelect: () => handleCsv(output) },
    { id: 'out-sep-1', label: '', separator: true },
    { id: 'out-rerun', label: t(lang, 'outctx.rerun'), onSelect: () => onRerun(output) },
    ...(output.model ? [{ id: 'out-save-model', label: t(lang, 'outctx.saveModel'), onSelect: () => onSaveModel(output) }] : []),
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

  const chartMenuItems = (target: ChartTarget): ContextMenuItem[] => {
    const output = findOutput(target.outputId);
    const chart = chartAt(output, target);
    const caption = captionAt(output, target);
    if (!chart) return [];
    return [
      { id: 'ch-scale', label: t(lang, 'cm.scale'), onSelect: () => openDrawer(target, 'scale') },
      { id: 'ch-appearance', label: t(lang, 'cm.appearance'), onSelect: () => openDrawer(target, 'style') },
      { id: 'ch-export', label: t(lang, 'cm.export'), onSelect: () => openDrawer(target, 'export') },
      { id: 'ch-props', label: t(lang, 'cm.properties'), onSelect: () => openDrawer(target, 'general') },
      { id: 'ch-sep-1', label: '', separator: true },
      { id: 'ch-zoom', label: t(lang, 'cm.zoom'), onSelect: () => setViewer({ target, mode: 'zoom' }) },
      { id: 'ch-full', label: t(lang, 'cm.fullscreen'), onSelect: () => setViewer({ target, mode: 'full' }) },
      { id: 'ch-sep-2', label: '', separator: true },
      { id: 'ch-copy-style', label: t(lang, 'cm.copyStyle'), onSelect: () => { setStyleClip(packChartStyle(chart)); onToast(t(lang, 'toast.styleCopied')); } },
      {
        id: 'ch-paste-style',
        label: t(lang, 'cm.pasteStyle'),
        disabled: !styleClip,
        onSelect: () => {
          if (!styleClip) return;
          commitChart(target, applyStylePack(chart, styleClip));
          onToast(t(lang, 'toast.stylePasted'));
        },
      },
      {
        id: 'ch-apply-all',
        label: t(lang, 'cm.applyAll'),
        onSelect: () => {
          const pack = packChartStyle(chart);
          let count = 0;
          outputs.forEach((doc) => {
            const charts = chartsOf(doc.blocks);
            if (!charts.length) return;
            count += charts.length;
            onUpdateBlocks(doc.id, doc.blocks.map((block) => {
              if (block.type === 'chart') return { ...block, chart: applyStylePack(block.chart, pack) };
              if (block.type === 'chartgrid') return { ...block, charts: block.charts.map((item) => ({ ...item, chart: applyStylePack(item.chart, pack) })) };
              return block;
            }));
          });
          onToast(t(lang, 'toast.styleAppliedAll', { n: count }));
        },
      },
      { id: 'ch-copy-png', label: t(lang, 'cm.copyPng'), onSelect: () => void copyChartPng(chart, fullChartConfig(chart), caption) },
      { id: 'ch-sep-3', label: '', separator: true },
      { id: 'ch-reset', label: t(lang, 'cm.reset'), danger: true, onSelect: () => resetStyleOf(target) },
    ];
  };

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

  const openChartMenu = (event: React.MouseEvent, target: ChartTarget) => {
    onFocus(target.outputId);
    setMenu({ x: event.clientX, y: event.clientY, outputId: target.outputId, target });
  };

  const openAreaMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (menu) return;
    setMenu({ x: event.clientX, y: event.clientY, outputId: null });
  };

  const menuOutput = menu?.outputId && !menu.target ? outputs.find((output) => output.id === menu.outputId) : undefined;

  /* ── card-level actions ─────────────────────────────────────────────── */

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

  const previewFor = (target: ChartTarget): ChartConfig | undefined =>
    (drawer && drawer.target.outputId === target.outputId && drawer.target.blockIndex === target.blockIndex && drawer.target.chartIndex === target.chartIndex ? preview ?? undefined : undefined);

  const chartForFrame = (target: ChartTarget, chart: ChartSpec): ChartSpec => {
    const cfg = previewFor(target);
    return cfg ? materializeChart(chart, cfg) : chart;
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
                {output.model && <span className="out-meta" data-testid="card-model-badge"> · {t(lang, 'card.hasModel')}</span>}
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
              {output.blocks.map((block, blockIndex) => (
                <BlockView
                  key={blockIndex}
                  block={block}
                  lang={lang}
                  outputId={output.id}
                  blockIndex={blockIndex}
                  previewFor={previewFor}
                  chartForFrame={chartForFrame}
                  onEdit={(target, request) => openDrawer(target, request.tab, request.axis)}
                  onMenu={openChartMenu}
                  onView={(target, mode) => setViewer({ target, mode })}
                  onCopyPng={(target, chart) => void copyChartPng(chart, fullChartConfig(chart), captionAt(output, target))}
                  onExport={(target) => openDrawer(target, 'export')}
                  onChartChange={commitChart}
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
          label={t(lang, menu.target ? 'cm.title' : 'outctx.title')}
          items={menu.target ? chartMenuItems(menu.target) : menuOutput ? cardMenuItems(menuOutput) : areaMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}

      {drawer && targetChart && (
        <ChartPropertiesDrawer
          key={`cd-${session}`}
          lang={lang}
          chart={targetChart}
          initialTab={drawer.tab}
          initialAxis={drawer.axis}
          onPreview={setPreview}
          onApply={applyConfig}
          onClose={closeDrawer}
          onReset={resetConfig}
          onExport={(config, format) => void downloadChart(materializeChart(targetChart, config), config, format, captionAt(findOutput(drawer.target.outputId), drawer.target))}
          onCopyPng={(config) => void copyChartPng(materializeChart(targetChart, config), config, captionAt(findOutput(drawer.target.outputId), drawer.target))}
          onBatchExport={(config, format) => {
            const output = findOutput(drawer.target.outputId);
            if (output) void batchExport(output, config, format);
          }}
          onGeneratePairs={generatePairs}
          styleClipboard={styleClip}
          onCopyStyle={copyStyleFrom}
          onPasteStyle={pasteStyleTo}
          onApplyAll={applyStyleToAll}
        />
      )}

      {viewer && viewerChart && (
        <ChartViewer
          lang={lang}
          chart={viewerChart}
          caption={captionAt(viewerOutput, viewer.target)}
          mode={viewer.mode}
          onClose={() => setViewer(null)}
          onEdit={() => { setViewer(null); openDrawer(viewer.target, 'general'); }}
          onCopyPng={() => void copyChartPng(viewerChart, fullChartConfig(viewerChart), captionAt(viewerOutput, viewer.target))}
          onChartChange={(next) => commitChart(viewer.target, next)}
        />
      )}
    </div>
  );
}

function BlockView({
  block, lang, outputId, blockIndex, previewFor, chartForFrame, onEdit, onMenu, onView, onCopyPng, onExport, onChartChange,
}: {
  block: Block;
  lang: Lang;
  outputId: string;
  blockIndex: number;
  previewFor: (target: ChartTarget) => ChartConfig | undefined;
  chartForFrame: (target: ChartTarget, chart: ChartSpec) => ChartSpec;
  onEdit: (target: ChartTarget, request: ChartEditRequest) => void;
  onMenu: (event: React.MouseEvent, target: ChartTarget) => void;
  onView: (target: ChartTarget, mode: 'zoom' | 'full') => void;
  onCopyPng: (target: ChartTarget, chart: ChartSpec) => void;
  onExport: (target: ChartTarget, chart: ChartSpec) => void;
  onChartChange: (target: ChartTarget, chart: ChartSpec) => void;
}) {
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
    const target: ChartTarget = { outputId, blockIndex, chartIndex: 0 };
    const chart = chartForFrame(target, block.chart);
    return (
      <div className="chart-card">
        {block.caption && <h5>{resolveLabel(lang, block.caption)}</h5>}
        <ChartFrame
          lang={lang}
          chart={chart}
          config={previewFor(target)}
          onChartChange={(next) => onChartChange(target, next)}
          onEdit={(request) => onEdit(target, request)}
          onMenu={(event) => onMenu(event, target)}
          onView={(mode) => onView(target, mode)}
          onCopyPng={() => onCopyPng(target, chart)}
          onExport={() => onExport(target, chart)}
        />
      </div>
    );
  }
  if (block.type === 'chartgrid') {
    return (
      <div className="chart-grid">
        {block.charts.map((item, i) => {
          const target: ChartTarget = { outputId, blockIndex, chartIndex: i };
          const chart = chartForFrame(target, item.chart);
          return (
            <div className="chart-card" key={i}>
              <h5>{resolveLabel(lang, item.title)}</h5>
              <ChartFrame
                lang={lang}
                chart={chart}
                config={previewFor(target)}
                onChartChange={(next) => onChartChange(target, next)}
                onEdit={(request) => onEdit(target, request)}
                onMenu={(event) => onMenu(event, target)}
                onView={(mode) => onView(target, mode)}
                onCopyPng={() => onCopyPng(target, chart)}
                onExport={() => onExport(target, chart)}
              />
            </div>
          );
        })}
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
