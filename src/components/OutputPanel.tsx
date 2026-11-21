import { useRef } from 'react';
import type { Block, ChartSpec, Lang, OutputDoc } from '../types';
import { fmtTime } from '../lib/format';
import { resolveLabel, t } from '../lib/i18n';
import { downloadFile } from '../lib/project';
import { inlineTheme, renderChart } from '../lib/charts';
import { IconChevronDown, IconDownload, IconPrinter, IconTrash, IconX } from './Icons';

interface Props {
  lang: Lang;
  outputs: OutputDoc[];
  focusedOutput: string | null;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onToast: (message: string) => void;
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

export function OutputPanel({ lang, outputs, focusedOutput, onFocus, onDelete, onToggleCollapse, onToast }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const handleSvg = (output: OutputDoc) => {
    const svg = composeSvg(output.blocks, lang, t(lang, output.titleKey));
    if (!svg) {
      onToast(t(lang, 'card.noTable'));
      return;
    }
    downloadFile(`sigrun-${output.titleKey.replace('an.', '')}-${output.id}.svg`, svg, 'image/svg+xml');
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
              </div>
            </div>
            <div className="out-tools" onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => handleCsv(output)} title={t(lang, 'card.csv')} aria-label={t(lang, 'card.csv')} data-testid="card-csv">
                <IconDownload size={14} />
              </button>
              <button type="button" onClick={() => handleSvg(output)} title={t(lang, 'card.svg')} aria-label={t(lang, 'card.svg')} data-testid="card-svg">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 18V6M20 18V9M4 18h16" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="14" r="1.6" /></svg>
              </button>
              <button type="button" onClick={() => handlePrint(output)} title={t(lang, 'card.print')} aria-label={t(lang, 'card.print')} data-testid="card-print">
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
                <BlockView key={index} block={block} lang={lang} />
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
    </div>
  );
}

function BlockView({ block, lang }: { block: Block; lang: Lang }) {
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
        <div dangerouslySetInnerHTML={{ __html: renderChart(block.chart) }} />
      </div>
    );
  }
  if (block.type === 'chartgrid') {
    return (
      <div className="chart-grid">
        {block.charts.map((item, i) => (
          <div className="chart-card" key={i}>
            <h5>{resolveLabel(lang, item.title)}</h5>
            <div dangerouslySetInnerHTML={{ __html: renderChart(item.chart) }} />
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
