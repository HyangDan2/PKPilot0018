import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartSource, ChartSpec, Lang } from '../types';
import type { ChartConfig } from '../lib/chartConfig';
import { renderChart } from '../lib/charts';
import { fmt } from '../lib/format';
import { probeContour } from '../lib/chartProbe';
import { t } from '../lib/i18n';
import type { ChartDrawerTab } from './ChartPropertiesDrawer';
import { Surface3DView } from './Surface3DView';
import { defaultSurfaceViewConfig } from '../lib/chartConfig';
import type { SurfaceCameraConfig, SurfaceProjection } from '../lib/chartConfig';
import {
  boxZoom,
  panViewport,
  rowsFromElement,
  stepElement,
  toggleRows,
  viewportConfig,
  viewportIsBase,
  zoomViewport,
  type PlotRect,
  type Viewport,
} from '../lib/chartInteraction';
import type { AxisScale } from '../lib/chartConfig';

const CHART_MIN_WIDTH = 280;
const CHART_MAX_WIDTH = 820;

export interface ChartEditRequest {
  tab: ChartDrawerTab;
  axis?: 'x' | 'y' | 'z' | 'y2';
}

type InteractiveMode = 'zoom' | 'pan' | 'select';

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
  /** Worksheet rows to paint as selected on this chart (linked selection). */
  highlightRows?: number[];
  /** Selection lifted to the app so the worksheet can highlight the rows. */
  onSelectRows?: (rows: number[], additive: boolean, source?: ChartSource) => void;
  onExportSelection?: (rows: number[], source?: ChartSource) => void;
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

/**
 * The topmost element of the chart under the pointer.
 *
 * The interaction layer covers the picture so it can capture drags and clicks,
 * which means the event target is the layer, not the point beneath it. The
 * browser still knows the whole stack, so the chart element is read from there
 * and hover, tap, selection and double-click keep working as before.
 */
function chartElementAt(event: React.MouseEvent | MouseEvent, holder: HTMLElement | null, selector: string): Element | null {
  const direct = (event.target as Element | null)?.closest(selector);
  if (direct) return direct;
  if (!holder || typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  const stack = document.elementsFromPoint(event.clientX, event.clientY);
  for (const element of stack) {
    if (!holder.contains(element)) continue;
    const match = element.closest(selector);
    if (match && holder.contains(match)) return match;
  }
  return null;
}

/** Nearest plotted element under the pointer, if it carries its own values. */
function pointUnder(event: React.MouseEvent | MouseEvent, holder?: HTMLElement | null): { x: number; y: number; z?: number; label?: string; rows: number[] } | null {
  const element = chartElementAt(event, holder ?? null, '[data-x][data-y]');
  if (!element) return null;
  const x = Number(element.getAttribute('data-x'));
  const y = Number(element.getAttribute('data-y'));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const zRaw = element.getAttribute('data-z');
  const z = zRaw != null ? Number(zRaw) : undefined;
  return {
    x,
    y,
    z: Number.isFinite(z) ? z : undefined,
    label: element.getAttribute('data-label') ?? undefined,
    rows: rowsFromElement(element),
  };
}

/** A pixel inside the plot area mapped back to data coordinates. */
function dataUnder(svg: SVGSVGElement, event: { clientX: number; clientY: number }): { x: number; y: number } | null {
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
  const xScale = (plot.getAttribute('data-x-scale') ?? 'linear') as AxisScale;
  const yScale = (plot.getAttribute('data-y-scale') ?? 'linear') as AxisScale;
  const toValue = (fraction: number, lo: number, hi: number, axisScale: AxisScale): number => {
    if (axisScale === 'log10') return 10 ** (Math.log10(Math.max(lo, Number.MIN_VALUE)) + fraction * (Math.log10(Math.max(hi, Number.MIN_VALUE)) - Math.log10(Math.max(lo, Number.MIN_VALUE))));
    if (axisScale === 'ln') return Math.exp(Math.log(Math.max(lo, Number.MIN_VALUE)) + fraction * (Math.log(Math.max(hi, Number.MIN_VALUE)) - Math.log(Math.max(lo, Number.MIN_VALUE))));
    if (axisScale === 'symlog') {
      const m = (v: number) => Math.sign(v) * Math.log10(1 + Math.abs(v));
      const inLo = m(lo);
      const inHi = m(hi);
      const at = inLo + fraction * (inHi - inLo);
      return Math.sign(at) * (10 ** Math.abs(at) - 1);
    }
    if (axisScale === 'power') {
      const m = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
      const inLo = m(lo);
      const inHi = m(hi);
      const at = inLo + fraction * (inHi - inLo);
      return Math.sign(at) * at * at;
    }
    return lo + fraction * (hi - lo);
  };
  return {
    x: toValue((px - bx) / (bw || 1), xMin, xMax, xScale),
    y: toValue((py - by) / (bh || 1), yMax, yMin, yScale),
  };
}

/** The plot rectangle, the base viewport and the axis scales of a rendered chart. */
function plotGeometry(holder: HTMLElement): { rect: PlotRect; base: Viewport } | null {
  const svg = holder.querySelector('svg.chart-svg') as SVGSVGElement | null;
  const plot = svg?.querySelector('[data-chart-role="plot"]');
  if (!svg || !plot) return null;
  const box = (plot.getAttribute('data-plot-box') ?? '').split(',').map(Number);
  if (box.length !== 4 || box.some((value) => !Number.isFinite(value))) return null;
  const xMin = Number(plot.getAttribute('data-x-min'));
  const xMax = Number(plot.getAttribute('data-x-max'));
  const yMin = Number(plot.getAttribute('data-y-min'));
  const yMax = Number(plot.getAttribute('data-y-max'));
  if (![xMin, xMax, yMin, yMax].every((value) => Number.isFinite(value))) return null;
  return {
    rect: {
      x: box[0], y: box[1], w: box[2], h: box[3],
      xScale: (plot.getAttribute('data-x-scale') ?? 'linear') as AxisScale,
      yScale: (plot.getAttribute('data-y-scale') ?? 'linear') as AxisScale,
    },
    base: { x: [xMin, xMax], y: [yMin, yMax] },
  };
}

/** client → SVG user units. */
function clientToSvg(svg: SVGSVGElement, event: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const sx = rect.width ? viewBox.width / rect.width : 1;
  const sy = rect.height ? viewBox.height / rect.height : 1;
  return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
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
    const height = wanted > 140 ? Math.round(wanted) : 380;
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

export function ChartFrame({
  lang, chart, caption, config, onEdit, onMenu, onView, onCopyPng, onExport, testId, onChartChange,
  highlightRows, onSelectRows, onExportSelection,
}: Props) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | { kind: 'band' | 'pan'; start: { x: number; y: number }; moved: boolean }>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [pinned, setPinned] = useState<Tip | null>(null);
  const [view, setView] = useState<Viewport | null>(null);
  const [base, setBase] = useState<Viewport | null>(null);
  const [mode, setMode] = useState<InteractiveMode>('zoom');
  const [crosshair, setCrosshair] = useState(false);
  const [cross, setCross] = useState<{ x: number; y: number } | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [selectMessage, setSelectMessage] = useState('');

  const interactive = chart.kind !== 'surface3d';
  const renderConfig = useMemo(() => (view ? viewportConfig(config ?? chart.config, view) : config), [config, chart.config, view]);

  // Paint the selected rows on the chart after every render: the SVG is written
  // as markup, so the classes are applied once it exists.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const rows = highlightRows && highlightRows.length ? highlightRows : selectedRows;
    const wanted = new Set(rows);
    holder.querySelectorAll('[data-chart-role="chart-point"], [data-chart-role="chart-bar"], [data-chart-role="chart-box"]').forEach((element) => {
      const elementRows = rowsFromElement(element);
      const on = elementRows.length > 0 && elementRows.some((row) => wanted.has(row));
      element.classList.toggle('chart-selected', on);
    });
  });

  const read = (event: React.MouseEvent): void => {
    const holder = holderRef.current;
    if (!holder) return;
    const rect = holder.getBoundingClientRect();
    const position = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const point = pointUnder(event, holder);
    if (point) {
      const lines = [`x ${fmt(point.x, 4)}`, `y ${fmt(point.y, 4)}`];
      if (point.z != null && Number.isFinite(point.z)) lines.push(`z ${fmt(point.z, 4)}`);
      if (point.label) lines.push(point.label);
      if (point.rows.length) lines.push(t(lang, 'ct.rows', { rows: point.rows.slice(0, 8).join(', ') }));
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

  /* ── interaction ─────────────────────────────────────────────────────── */

  const geometry = useCallback(() => {
    const holder = holderRef.current;
    return holder ? plotGeometry(holder) : null;
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const holder = holderRef.current;
    const svg = holder?.querySelector('svg.chart-svg') as SVGSVGElement | null;
    if (!svg) return;
    if (event.button !== 0) return;
    const at = clientToSvg(svg, event);
    const point = pointUnder(event, holder);
    if (point && point.rows.length && (mode === 'select' || event.shiftKey)) {
      const next = toggleRows(selectedRows, point.rows, event.shiftKey || event.metaKey || event.ctrlKey);
      setSelectedRows(next);
      setSelectMessage(t(lang, 'ct.selectedRows', { n: next.length }));
      onSelectRows?.(next, true, chart.source);
      return;
    }
    if (mode === 'select') {
      // Nothing selectable under the pointer: clear, as a click on empty space does.
      if (!event.shiftKey) {
        setSelectedRows([]);
        onSelectRows?.([], false, chart.source);
      }
      return;
    }
    dragRef.current = { kind: mode === 'pan' ? 'pan' : 'band', start: at, moved: false };
    if (mode === 'pan') return;
    setBand({ x0: at.x, y0: at.y, x1: at.x, y1: at.y });
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const holder = holderRef.current;
    const svg = holder?.querySelector('svg.chart-svg') as SVGSVGElement | null;
    if (!svg) return;
    if (crosshair) {
      const at = clientToSvg(svg, event);
      setCross({ x: at.x, y: at.y });
    }
    const drag = dragRef.current;
    if (!drag) return;
    const at = clientToSvg(svg, event);
    if (Math.abs(at.x - drag.start.x) > 2 || Math.abs(at.y - drag.start.y) > 2) drag.moved = true;
    if (drag.kind === 'band') {
      setBand({ x0: drag.start.x, y0: drag.start.y, x1: at.x, y1: at.y });
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const currentBand = band;
    setBand(null);
    if (!drag) return;
    const geo = geometry();
    if (!geo) return;
    if (drag.kind === 'band' && currentBand) {
      const zoomed = boxZoom(view ?? geo.base, geo.rect, { x: currentBand.x0, y: currentBand.y0 }, { x: currentBand.x1, y: currentBand.y1 });
      if (zoomed) {
        setBase(geo.base);
        setView(zoomed);
      }
      return;
    }
    if (drag.kind === 'pan' && drag.moved) {
      const svg = holderRef.current?.querySelector('svg.chart-svg') as SVGSVGElement | null;
      if (!svg) return;
      const at = clientToSvg(svg, event);
      const current = view ?? geo.base;
      const panned = panViewport(current, geo.rect, at.x - drag.start.x, at.y - drag.start.y);
      setBase(geo.base);
      setView(panned);
    }
  };

  const zoomBy = (factor: number) => {
    const geo = geometry();
    if (!geo) return;
    setBase(geo.base);
    setView(zoomViewport(view ?? geo.base, geo.rect, factor));
  };

  const resetView = () => {
    setView(null);
    setBase(null);
  };

  /** Data cursor: walk the plotted elements with the arrow keys. */
  const stepCursor = (direction: 1 | -1) => {
    const holder = holderRef.current;
    const svg = holder?.querySelector('svg.chart-svg') as SVGSVGElement | null;
    if (!holder || !svg) return;
    const elements = [...holder.querySelectorAll('[data-point="1"]')] as SVGGraphicsElement[];
    if (!elements.length) return;
    const next = stepElement(cursor, elements.length, direction);
    if (next === null) return;
    setCursor(next);
    const element = elements[next];
    const box = element.getBoundingClientRect();
    const holderBox = holder.getBoundingClientRect();
    const rows = rowsFromElement(element);
    const lines = [`x ${element.getAttribute('data-x') ?? ''}`, `y ${element.getAttribute('data-y') ?? ''}`];
    const z = element.getAttribute('data-z');
    if (z) lines.push(`z ${z}`);
    if (rows.length) lines.push(t(lang, 'ct.rows', { rows: rows.slice(0, 8).join(', ') }));
    const tipAt = { x: box.left - holderBox.left, y: box.top - holderBox.top, lines };
    setTip(tipAt);
    if (rows.length) {
      setSelectedRows(rows);
      onSelectRows?.(rows, false, chart.source);
    }
  };

  const exportSelection = () => {
    if (selectedRows.length) onExportSelection?.(selectedRows, chart.source);
  };

  const pin = (event: React.MouseEvent) => {
    const holder = holderRef.current;
    const point = pointUnder(event, holder);
    if (!point) {
      if (!pinned) setPinned(null);
      return;
    }
    if (!holder) return;
    const rect = holder.getBoundingClientRect();
    const lines = [`x ${fmt(point.x, 4)}`, `y ${fmt(point.y, 4)}`];
    if (point.z != null) lines.push(`z ${fmt(point.z, 4)}`);
    if (point.label) lines.push(point.label);
    if (point.rows.length) lines.push(t(lang, 'ct.rows', { rows: point.rows.slice(0, 8).join(', ') }));
    setPinned({ x: event.clientX - rect.left, y: event.clientY - rect.top, lines });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinned(null);
        setCursor(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rowCount = highlightRows && highlightRows.length ? highlightRows.length : selectedRows.length;
  const activeTip = pinned ?? tip;

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
        onMouseLeave={() => { setTip(null); setCross(null); }}
        onDoubleClick={(event) => {
          event.preventDefault();
          const target = chartElementAt(event, holderRef.current, '[data-chart-role]') ?? (event.target as Element | null);
          onEdit(tabFor(target));
        }}
        onClick={(event) => {
          // A tap on a point keeps its readout on touch screens; a click with
          // nothing under it unpins.
          if (pointUnder(event, holderRef.current)) {
            read(event);
            pin(event);
          } else if (pinned) {
            setPinned(null);
          }
        }}
        title={t(lang, 'ct.tipHint')}
      >
        <ChartCanvas chart={chart} config={renderConfig} onChartChange={onChartChange} lang={lang} />
        {interactive && (
          <div
            className="chart-interaction"
            data-testid="chart-interaction"
            data-mode={mode}
            ref={overlayRef}
            tabIndex={0}
            role="application"
            aria-label={t(lang, 'ct.interaction')}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setCross(null)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') { event.preventDefault(); stepCursor(1); }
              if (event.key === 'ArrowLeft') { event.preventDefault(); stepCursor(-1); }
              if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(0.7); }
              if (event.key === '-') { event.preventDefault(); zoomBy(1 / 0.7); }
              if (event.key === '0') { event.preventDefault(); resetView(); }
            }}
          >
            {band && (
              <div
                className="chart-band"
                data-testid="chart-box"
                style={{
                  left: `${Math.min(band.x0, band.x1)}px`,
                  top: `${Math.min(band.y0, band.y1)}px`,
                  width: `${Math.abs(band.x1 - band.x0)}px`,
                  height: `${Math.abs(band.y1 - band.y0)}px`,
                }}
              />
            )}
            {crosshair && cross && (
              <>
                <div className="chart-crosshair-v" data-testid="chart-crosshair-x" style={{ left: `${cross.x}px` }} />
                <div className="chart-crosshair-h" data-testid="chart-crosshair-y" style={{ top: `${cross.y}px` }} />
              </>
            )}
          </div>
        )}
        {interactive && (
          <div className="chart-interaction-tools" onClick={(event) => event.stopPropagation()}>
            <button type="button" className={mode === 'zoom' ? 'active' : ''} onClick={() => setMode('zoom')} title={t(lang, 'ct.boxZoom')} aria-label={t(lang, 'ct.boxZoom')} data-testid="chart-mode-zoom">⤢</button>
            <button type="button" className={mode === 'pan' ? 'active' : ''} onClick={() => setMode('pan')} title={t(lang, 'ct.pan')} aria-label={t(lang, 'ct.pan')} data-testid="chart-mode-pan">✥</button>
            <button type="button" className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')} title={t(lang, 'ct.select')} aria-label={t(lang, 'ct.select')} data-testid="chart-mode-select">◎</button>
            <button type="button" className={crosshair ? 'active' : ''} onClick={() => setCrosshair((value) => !value)} title={t(lang, 'ct.crosshair')} aria-label={t(lang, 'ct.crosshair')} data-testid="chart-crosshair-toggle">✛</button>
            <button type="button" onClick={() => zoomBy(0.7)} title={t(lang, 'ct.zoomIn')} aria-label={t(lang, 'ct.zoomIn')} data-testid="chart-zoom-in">＋</button>
            <button type="button" onClick={() => zoomBy(1 / 0.7)} title={t(lang, 'ct.zoomOut')} aria-label={t(lang, 'ct.zoomOut')} data-testid="chart-zoom-out">－</button>
            <button type="button" onClick={resetView} disabled={!view || (base ? viewportIsBase(view, base) : true)} title={t(lang, 'ct.resetView')} aria-label={t(lang, 'ct.resetView')} data-testid="chart-reset-view">⟲</button>
            <button type="button" onClick={exportSelection} disabled={!selectedRows.length || !onExportSelection} title={t(lang, 'ct.exportSelection')} aria-label={t(lang, 'ct.exportSelection')} data-testid="chart-export-selection">⇩{selectedRows.length ? ` ${selectedRows.length}` : ''}</button>
            <span className="chart-selection-count" data-testid="chart-selection-count">{rowCount}</span>
          </div>
        )}
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
        {activeTip && (
          <div className={`chart-tip${pinned ? ' pinned' : ''}`} style={{ left: activeTip.x + 12, top: activeTip.y + 12 }} data-testid={pinned ? 'chart-tip-pinned' : 'chart-tip'}>
            {activeTip.lines.map((line, index) => <span key={index}>{line}</span>)}
          </div>
        )}
        {selectMessage && (
          <div className="chart-select-note" data-testid="chart-select-note">{selectMessage}</div>
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
