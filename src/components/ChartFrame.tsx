import { useEffect, useRef, useState } from 'react';
import type { ChartSpec, Lang } from '../types';
import type { ChartConfig } from '../lib/chartConfig';
import { renderChart } from '../lib/charts';
import { fmt } from '../lib/format';
import { probeContour } from '../lib/chartProbe';
import { t } from '../lib/i18n';
import type { ChartDrawerTab } from './ChartPropertiesDrawer';
import { Surface3DView } from './Surface3DView';
import { defaultSurfaceViewConfig } from '../lib/chartConfig';
import type { SurfaceCameraConfig, SurfaceProjection } from '../lib/chartConfig';

const CHART_MIN_WIDTH = 280;
const CHART_MAX_WIDTH = 820;

export interface ChartEditRequest {
  tab: ChartDrawerTab;
  axis?: 'x' | 'y' | 'z' | 'y2';
}

interface Props {
  lang: Lang;
  chart: ChartSpec;
  caption?: string;
  config?: ChartConfig;
  onEdit: (request: ChartEditRequest) => void;
  onMenu: (event: React.MouseEvent) => void;
  onView: (mode: 'zoom' | 'full') => void;
  onCopyPng: () => void;
  onExport: () => void;
  testId?: string;
  /** Persist a change the chart makes itself (the 3D camera). */
  onChartChange?: (chart: ChartSpec) => void;
}

interface Tip {
  x: number;
  y: number;
  lines: string[];
}

/** Route a double-click on a chart region to the matching drawer tab. */
function tabFor(target: Element | null): ChartEditRequest {
  const role = target?.closest('[data-chart-role]')?.getAttribute('data-chart-role') ?? '';
  switch (role) {
    case 'axis-x': return { tab: 'scale', axis: 'x' };
    case 'axis-y': return { tab: 'scale', axis: 'y' };
    case 'axis-y2': return { tab: 'scale', axis: 'y2' };
    case 'colorbar': return { tab: 'scale', axis: 'z' };
    case 'title': return { tab: 'general' };
    case 'legend': return { tab: 'legend' };
    case 'plot':
    case 'plot-content':
    case 'chart-bar':
    case 'chart-point':
      return { tab: 'style' };
    default:
      return { tab: 'general' };
  }
}

/** Nearest plotted element under the pointer, if it carries its own values. */
function pointUnder(event: React.MouseEvent): { x: number; y: number; z?: number; label?: string } | null {
  const element = (event.target as Element | null)?.closest('[data-x][data-y]');
  if (!element) return null;
  const x = Number(element.getAttribute('data-x'));
  const y = Number(element.getAttribute('data-y'));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const zRaw = element.getAttribute('data-z');
  const z = zRaw != null ? Number(zRaw) : undefined;
  return { x, y, z: Number.isFinite(z) ? z : undefined, label: element.getAttribute('data-label') ?? undefined };
}

/** A pixel inside the plot area mapped back to data coordinates. */
function dataUnder(svg: SVGSVGElement, event: React.MouseEvent): { x: number; y: number } | null {
  const plot = svg.querySelector('[data-chart-role="plot"]');
  if (!plot) return null;
  const box = (plot.getAttribute('data-plot-box') ?? '').split(',').map(Number);
  if (box.length !== 4 || box.some((value) => !Number.isFinite(value))) return null;
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  if (!rect.width || !rect.height) return null;
  const scaleX = viewBox.width / rect.width;
  const scaleY = viewBox.height / rect.height;
  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;
  const [bx, by, bw, bh] = box;
  if (px < bx || px > bx + bw || py < by || py > by + bh) return null;
  const xMin = Number(plot.getAttribute('data-x-min'));
  const xMax = Number(plot.getAttribute('data-x-max'));
  const yMin = Number(plot.getAttribute('data-y-min'));
  const yMax = Number(plot.getAttribute('data-y-max'));
  if (![xMin, xMax, yMin, yMax].every((value) => Number.isFinite(value))) return null;
  return {
    x: xMin + ((px - bx) / (bw || 1)) * (xMax - xMin),
    y: yMin + ((py - by) / (bh || 1)) * (yMax - yMin),
  };
}

export function ChartCanvas({ chart, config, maxWidth = CHART_MAX_WIDTH, onChartChange, lang = 'en' }: { chart: ChartSpec; config?: ChartConfig; maxWidth?: number; onChartChange?: (chart: ChartSpec) => void; lang?: Lang }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(560);

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

  const width = Math.max(CHART_MIN_WIDTH, Math.min(measured, maxWidth));
  if (chart.kind === 'surface3d') {
    const surface = { ...defaultSurfaceViewConfig(), ...((config ?? chart.config)?.surface ?? {}) };
    const wanted = (config ?? chart.config)?.appearance?.height ?? 0;
    const height = wanted > 140 ? Math.round(wanted) : 340;
    const commit = (camera: SurfaceCameraConfig, projection?: SurfaceProjection) => {
      if (!onChartChange) return;
      const base = config ?? chart.config ?? {};
      onChartChange({
        ...chart,
        config: {
          ...base,
          surface: { ...(base.surface ?? {}), camera, ...(projection ? { projection } : {}) },
        },
      });
    };
    return (
      <div ref={hostRef} className="chart-canvas surface3d-canvas-wrap" data-testid="chart-canvas">
        <Surface3DView
          lang={lang}
          chart={chart}
          config={surface}
          width={width}
          height={height}
          onViewChange={commit}
        />
      </div>
    );
  }
  const svg = renderChart(chart, { width, config });
  return <div ref={hostRef} className="chart-canvas" data-testid="chart-canvas" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function ChartFrame({ lang, chart, caption, config, onEdit, onMenu, onView, onCopyPng, onExport, testId, onChartChange }: Props) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const read = (event: React.MouseEvent): void => {
    const holder = holderRef.current;
    if (!holder) return;
    const rect = holder.getBoundingClientRect();
    const position = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const point = pointUnder(event);
    if (point) {
      const lines = [`x ${fmt(point.x, 4)}`, `y ${fmt(point.y, 4)}`];
      if (point.z != null && Number.isFinite(point.z)) lines.push(`z ${fmt(point.z, 4)}`);
      if (point.label) lines.push(point.label);
      setTip({ ...position, lines });
      return;
    }
    const svg = holder.querySelector('svg');
    if (!svg) {
      setTip(null);
      return;
    }
    const coords = dataUnder(svg, event);
    if (!coords) {
      setTip(null);
      return;
    }
    if (chart.kind === 'contour') {
      const probe = probeContour(chart, coords.x, coords.y);
      if (!probe) {
        setTip(null);
        return;
      }
      setTip({ ...position, lines: [`${chart.xLabel ?? 'X'} ${fmt(coords.x, 4)}`, `${chart.yLabel ?? 'Y'} ${fmt(coords.y, 4)}`, `Z ${fmt(probe.z ?? 0, 4)}`] });
      return;
    }
    setTip({ ...position, lines: [`x ${fmt(coords.x, 4)}`, `y ${fmt(coords.y, 4)}`] });
  };

  return (
    <div className="chart-frame" data-testid={testId ?? 'chart-frame'}>
      <div
        className="chart-holder"
        ref={holderRef}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onMenu(event);
        }}
        onMouseMove={read}
        onMouseLeave={() => setTip(null)}
        onDoubleClick={(event) => {
          event.preventDefault();
          onEdit(tabFor(event.target as Element | null));
        }}
        onClick={(event) => {
          // A tap on a point keeps its readout on touch screens.
          if (pointUnder(event)) read(event);
        }}
        title={t(lang, 'ct.tipHint')}
      >
        <ChartCanvas chart={chart} config={config} onChartChange={onChartChange} lang={lang} />
        <div className="chart-toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => onEdit({ tab: 'general' })} title={t(lang, 'ct.edit')} aria-label={t(lang, 'ct.edit')} data-testid="chart-edit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L20 8l-4-4L4 16z" /></svg>
          </button>
          <button type="button" onClick={() => onView('zoom')} title={t(lang, 'ct.zoom')} aria-label={t(lang, 'ct.zoom')} data-testid="chart-zoom">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5M8.5 11h5M11 8.5v5" /></svg>
          </button>
          <button type="button" onClick={() => onView('full')} title={t(lang, 'ct.fullscreen')} aria-label={t(lang, 'ct.fullscreen')} data-testid="chart-full">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
          <button type="button" onClick={onCopyPng} title={t(lang, 'ct.copyPng')} aria-label={t(lang, 'ct.copyPng')} data-testid="chart-copy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
          </button>
          <button type="button" onClick={onExport} title={t(lang, 'ct.export')} aria-label={t(lang, 'ct.export')} data-testid="chart-export">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v10M8 11l4 4 4-4M5 19h14" /></svg>
          </button>
        </div>
        {tip && (
          <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }} data-testid="chart-tip">
            {tip.lines.map((line, index) => <span key={index}>{line}</span>)}
          </div>
        )}
      </div>
      {caption && <div className="chart-caption">{caption}</div>}
    </div>
  );
}

/** Large single-chart view used by Zoom and Fullscreen. */
export function ChartViewer({ lang, chart, config, caption, mode, onClose, onEdit, onCopyPng, onChartChange }: {
  lang: Lang;
  chart: ChartSpec;
  config?: ChartConfig;
  caption?: string;
  mode: 'zoom' | 'full';
  onClose: () => void;
  onEdit: () => void;
  onCopyPng: () => void;
  onChartChange?: (chart: ChartSpec) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`chart-viewer ${mode}`} role="dialog" aria-modal="true" aria-label={caption ?? chart.title ?? chart.kind} data-testid="chart-viewer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="chart-viewer-panel">
        <header>
          <b>{caption || chart.title || chart.kind.toUpperCase()}</b>
          <span className="spacer" />
          <button type="button" className="icon-btn" onClick={onEdit} title={t(lang, 'ct.edit')} aria-label={t(lang, 'ct.edit')}>⚙</button>
          <button type="button" className="icon-btn" onClick={onCopyPng} title={t(lang, 'ct.copyPng')} aria-label={t(lang, 'ct.copyPng')}>⧉</button>
          <button type="button" className="icon-btn" onClick={onClose} title={t(lang, mode === 'full' ? 'ct.exitFullscreen' : 'ct.close')} aria-label={t(lang, 'ct.close')} data-testid="chart-viewer-close">✕</button>
        </header>
        <div className="chart-viewer-body">
          <ChartCanvas chart={chart} config={config} maxWidth={mode === 'full' ? 1600 : 1100} lang={lang} onChartChange={onChartChange} />
        </div>
      </div>
    </div>
  );
}
