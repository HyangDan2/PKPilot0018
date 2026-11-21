import { useRef, useState } from 'react';
import type { Block, ChartSpec, Lang, OutputDoc } from '../types';
import { fmtTime } from '../lib/format';
import { resolveLabel, t } from '../lib/i18n';
import { downloadBlob, downloadFile } from '../lib/project';
import { inlineTheme, renderChart } from '../lib/charts';
import { IconChevronDown, IconDownload, IconPrinter, IconRerun, IconTrash, IconX } from './Icons';

interface Props {
  lang: Lang;
  outputs: OutputDoc[];
  focusedOutput: string | null;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleCollapse: (id: string) => void;
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

export function composeSvg(blocks: Block[], lang: Lang, title: string): string | null {
  const charts = chartsOf(blocks);
  if (!charts.length) return null;
  const width = 560;
  let y = 0;
  const parts: string[] = [];
  charts.forEach(({ chart, title: chartTitle }) => {
    const svg = renderChart(chart);
    const viewBox = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
    const h = viewBox ? Number(viewBox[2]) : 260;
    const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    const label = chartTitle ? resolveLabel(lang, chartTitle) : '';
    const header = label ? 20 : 0;
    parts.push(`<g transform="translate(0 ${y})"><text x="10" y="14" font-family="ui-monospace, Menlo, monospace" font-size="10" letter-spacing="1" fill="#7C7690">${label.toUpperCase()}</text><g transform="translate(0 ${header})">${inner}</g></g>`);
    y += h + header + 10;
  });
  const total = Math.max(60, y);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}"><title>${title}</title><rect width="${width}" height="${total}" fill="#FFFFFF"/>${parts.join('')}</svg>`;
  return inlineTheme(svg);
}

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

function replaceChart(block: Block, chartIndex: number, chart: ChartSpec): Block {
  if (block.type === 'chart') return { ...block, chart };
  if (block.type === 'chartgrid') return { ...block, charts: block.charts.map((item, i) => (i === chartIndex ? { ...item, chart } : item)) };
  return block;
}

export function OutputPanel({
  lang, outputs, focusedOutput, onFocus, onDelete, onToggleCollapse, onToast, onRerun, onReproduce, onUpdateBlocks,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [edit, setEdit] = useState<ChartEdit | null>(null);
  const [draft, setDraft] = useState({ title: '', xLabel: '', yLabel: '', bins: '', normal: false });

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
    <div className="output-scroll" ref={scrollRef} data-testid="output-panel">
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

function BlockView({
  block, lang, onEditChart,
}: { block: Block; lang: Lang; onEditChart: (chartIndex: number, chart: ChartSpec) => void }) {
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
          <div dangerouslySetInnerHTML={{ __html: renderChart(block.chart, compact ? 380 : undefined) }} />
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
              <div dangerouslySetInnerHTML={{ __html: renderChart(item.chart, compact ? 380 : undefined) }} />
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
