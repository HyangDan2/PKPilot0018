import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartSpec, Lang } from '../types';
import { t } from '../lib/i18n';
import type { SurfaceCameraConfig, SurfaceProjection, SurfaceViewConfig } from '../lib/chartConfig';
import { defaultSurfaceViewConfig } from '../lib/chartConfig';
import { renderChart } from '../lib/charts';
import {
  buildSurfaceGeometry,
  cameraBasis,
  cameraMatrix,
  lightDirection,
  projectPoint,
  surfaceColorbarSvg,
  surfaceExtent,
  surfaceSvgBody,
  SURFACE_VIEW_PRESETS,
  type SurfaceGeometry,
} from '../lib/surface3d';
import { createSurfaceGl, type SurfaceGlRenderer } from '../lib/surfaceGl';
import { marchingSquares, stitchSegments } from '../lib/contour';
import { resolveChartStyle } from '../lib/chartStyles';
import { mergeChartConfig } from '../lib/chartConfig';
import { sanitizeChartConfig } from '../lib/chartGuards';

/* ─────────────────────────────────────────────────────────────────────────
   The 3D surface view (WO-03).

   The canvas draws the surface through WebGL; an SVG layer above it draws the
   box, the tick labels, the experiment points and the colourbar with exactly
   the same camera. When WebGL is missing — a headless browser, a driver that
   refuses the context, a lost context — the whole picture is rendered as the
   static SVG projection instead and the reader is told so.
   ───────────────────────────────────────────────────────────────────────── */

type SurfaceChart = Extract<ChartSpec, { kind: 'surface3d' }>;

interface Props {
  lang: Lang;
  chart: SurfaceChart;
  config?: SurfaceViewConfig;
  width: number;
  height: number;
  /** Persist a camera/view change back to the chart so it survives a re-render. */
  onViewChange?: (camera: SurfaceCameraConfig, projection?: SurfaceProjection) => void;
}

type Renderer = 'webgl' | 'static';

/**
 * Is WebGL usable here? A test hook and `?webgl=off` force the fallback.
 *
 * The answer is cached: a browser has a small budget of live WebGL contexts,
 * and probing once per mounted surface (plus one real context for the drawing)
 * would exhaust it after a handful of card re-applies — the very moment the
 * reader would see the picture drop to the static projection for no reason.
 */
let webglSupport: boolean | null = null;

export function webglAvailable(): boolean {
  if (webglSupport !== null) return webglSupport;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const scope = window as unknown as { __SIGRUN_DISABLE_WEBGL__?: boolean };
  if (scope.__SIGRUN_DISABLE_WEBGL__) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('webgl') === 'off') return false;
  } catch {
    /* a sandboxed location has no query string */
  }
  try {
    const probe = document.createElement('canvas');
    const context = probe.getContext('webgl') ?? probe.getContext('experimental-webgl');
    webglSupport = Boolean(context);
    return webglSupport;
  } catch {
    webglSupport = false;
    return false;
  }
}

function clampCamera(camera: SurfaceCameraConfig): SurfaceCameraConfig {
  return {
    azimuth: ((camera.azimuth % 360) + 360) % 360,
    elevation: Math.max(2, Math.min(89, camera.elevation)),
    zoom: Math.max(0.4, Math.min(3, camera.zoom)),
    panX: Math.max(-1, Math.min(1, camera.panX)),
    panY: Math.max(-1, Math.min(1, camera.panY)),
  };
}

interface PointerState {
  id: number;
  x: number;
  y: number;
}

export function Surface3DView({ lang, chart, config, width, height, onViewChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<SurfaceGlRenderer | null>(null);
  const geometryRef = useRef<SurfaceGeometry | null>(null);
  /** The geometry inputs the live GL buffers were filled from (mount builds once). */
  const builtFor = useRef<unknown[] | null>(null);
  const [renderer, setRenderer] = useState<Renderer>('webgl');
  const [camera, setCamera] = useState<SurfaceCameraConfig>(config?.camera ?? defaultSurfaceViewConfig().camera);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef<Map<number, PointerState>>(new Map());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const commitTimer = useRef<number | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const view = useMemo<SurfaceViewConfig>(() => {
    const base = { ...defaultSurfaceViewConfig(), ...(config ?? {}) };
    return { ...base, camera };
  }, [config, camera]);

  const resolved = useMemo(() => {
    const merged = sanitizeChartConfig(mergeChartConfig(chart.config, { ...(chart.config ?? {}), surface: view }));
    return resolveChartStyle(merged.appearance?.preset, merged.appearance);
  }, [chart.config, view]);

  const style = useMemo(() => ({
    surface: resolved.surfaceColor,
    plot: resolved.plotBg,
    ink: resolved.inkColor,
    label: resolved.labelColor,
    grid: resolved.gridColor,
    alarm: resolved.alarmColor,
    fontFamily: resolved.fontFamily,
    mono: resolved.monoFontFamily,
  }), [resolved]);

  const extent = useMemo(() => surfaceExtent({ xs: chart.xs, ys: chart.ys, z: chart.z }), [chart.xs, chart.ys, chart.z]);
  // A narrow card cannot spare a column for the colourbar; a wide one can keep
  // the box centred and put the bar beside it instead of at the far edge.
  const barWidth = view.colorbar && width < 640 ? 60 : 0;
  const paintWidth = Math.max(180, width - barWidth);
  const barX = Math.min(paintWidth - 46, paintWidth / 2 + 250);
  const paintHeight = Math.max(150, height - 6);

  /* ── WebGL setup ─────────────────────────────────────────────────────── */
  // One context per canvas, created once. A new grid (a resolution change, a
  // new factor pair) re-uploads the buffers instead of building a second
  // context: browsers cap the number of live contexts, and a card that is
  // re-applied a few times would otherwise exhaust them and silently fall back.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    if (!webglAvailable()) {
      setRenderer('static');
      return undefined;
    }
    const geometry = buildSurfaceGeometry({ xs: chart.xs, ys: chart.ys, z: chart.z }, {
      colormap: view.colormap,
      zScale: view.zScale,
      meshDensity: view.meshDensity,
      includeLines: view.renderMode !== 'surface',
    });
    geometryRef.current = geometry;
    const rendererGl = createSurfaceGl(canvas, geometry);
    if (!rendererGl) {
      setRenderer('static');
      return undefined;
    }
    glRef.current = rendererGl;
    builtFor.current = [chart.xs, chart.ys, chart.z, view.colormap, view.zScale, view.meshDensity, view.renderMode];
    setRenderer('webgl');
    const onLost = (event: Event) => {
      event.preventDefault();
      glRef.current = null;
      setRenderer('static');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      rendererGl.dispose();
      glRef.current = null;
      geometryRef.current = null;
      builtFor.current = null;
    };
    // Mount only: geometry changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const rendererGl = glRef.current;
    if (!rendererGl) return;
    const inputs: unknown[] = [chart.xs, chart.ys, chart.z, view.colormap, view.zScale, view.meshDensity, view.renderMode];
    // The mount effect already uploaded exactly this geometry; re-uploading the
    // same 160k-vertex grid on every mount would be work for no new pixels.
    if (builtFor.current && builtFor.current.length === inputs.length && builtFor.current.every((value, index) => value === inputs[index])) {
      draw();
      return;
    }
    const geometry = buildSurfaceGeometry({ xs: chart.xs, ys: chart.ys, z: chart.z }, {
      colormap: view.colormap,
      zScale: view.zScale,
      meshDensity: view.meshDensity,
      includeLines: view.renderMode !== 'surface',
    });
    if (!rendererGl.setGeometry(geometry)) {
      rendererGl.dispose();
      glRef.current = null;
      builtFor.current = null;
      setRenderer('static');
      return;
    }
    builtFor.current = inputs;
    geometryRef.current = geometry;
    draw();
    // `draw` is stable per frame; including it would re-upload on every camera move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.xs, chart.ys, chart.z, view.colormap, view.zScale, view.meshDensity, view.renderMode]);

  /* ── floor lines (world-space pairs) ─────────────────────────────────── */
  const floorLines = useMemo<Float32Array | null>(() => {
    if (!view.showFloorContours) return null;
    const levels = Math.max(2, Math.min(20, Math.round(view.floorLevelCount)));
    if (!(extent.zMax > extent.zMin)) return null;
    const pairs: number[] = [];
    const zFloor = -0.45 * view.zScale;
    const toWorld = (x: number, y: number) => {
      const nx = chart.xs.length > 1 ? ((x - chart.xs[0]) / (chart.xs[chart.xs.length - 1] - chart.xs[0])) * 2 - 1 : 0;
      const ny = chart.ys.length > 1 ? ((y - chart.ys[0]) / (chart.ys[chart.ys.length - 1] - chart.ys[0])) * 2 - 1 : 0;
      return [nx, ny] as const;
    };
    for (let i = 1; i < levels; i += 1) {
      const level = extent.zMin + ((extent.zMax - extent.zMin) * i) / levels;
      stitchSegments(marchingSquares({ xs: chart.xs, ys: chart.ys, z: chart.z }, level), 2).forEach((line) => {
        for (let k = 0; k < line.points.length - 1; k += 1) {
          const a = toWorld(line.points[k].x, line.points[k].y);
          const b = toWorld(line.points[k + 1].x, line.points[k + 1].y);
          pairs.push(a[0], a[1], zFloor + 0.002, b[0], b[1], zFloor + 0.002);
        }
      });
    }
    return pairs.length ? new Float32Array(pairs) : null;
  }, [view.showFloorContours, view.floorLevelCount, view.zScale, chart.xs, chart.ys, chart.z, extent]);

  /* ── draw ────────────────────────────────────────────────────────────── */
  const draw = useCallback(() => {
    const gl = glRef.current;
    const geometry = geometryRef.current;
    if (!gl || !geometry || renderer !== 'webgl' || !gl.alive) return;
    const dpr = Math.min(2, Math.max(1, Math.round((window.devicePixelRatio || 1) * 10) / 10));
    gl.resize(paintWidth, paintHeight, dpr);
    const basis = cameraBasis(view.camera, view.projection, paintWidth, paintHeight);
    const mvp = cameraMatrix(basis, view.projection, view.camera, { width: paintWidth, height: paintHeight });
    gl.draw({
      mvp,
      opacity: view.opacity,
      renderMode: view.renderMode,
      light: lightDirection(view),
      ambient: view.ambient,
      diffuse: view.diffuse,
      meshColor: hexUnit(resolved.inkColor),
      meshWidth: Math.max(1, view.meshLineWidth),
      background: null,
      floorLines,
      floorColor: hexUnit(resolved.inkColor),
    });
  }, [renderer, paintWidth, paintHeight, view, resolved, floorLines]);

  useEffect(() => { draw(); }, [draw]);

  /* ── static SVG behind the overlay when WebGL is unavailable ─────────── */
  const staticSvg = useMemo(() => {
    if (renderer === 'webgl') return '';
    return renderChart(chart, { width: paintWidth, height: paintHeight, config: mergeChartConfig(chart.config, { surface: view }) });
  }, [renderer, chart, paintWidth, paintHeight, view]);

  /* ── frame (box, labels, points, colourbar) ──────────────────────────── */
  const overlay = useMemo(() => {
    if (renderer !== 'webgl') return '';
    return surfaceSvgBody({
      grid: { xs: chart.xs, ys: chart.ys, z: chart.z },
      config: view,
      style,
      width: paintWidth,
      height: paintHeight,
      xLabel: chart.xLabel ?? 'X',
      yLabel: chart.yLabel ?? 'Y',
      zLabel: chart.zLabel ?? '',
      points: chart.points,
      xRange: chart.xRange,
      yRange: chart.yRange,
      frameOnly: true,
    });
  }, [renderer, view, style, paintWidth, paintHeight, chart]);

  const colorbar = useMemo(() => (renderer === 'webgl' && view.colorbar
    ? surfaceColorbarSvg(view, style, barX, paintHeight * 0.14, paintHeight * 0.6, extent.zMin, extent.zMax, chart.zLabel ?? '', view.colormap)
    : ''), [view, style, paintWidth, paintHeight, extent, chart.zLabel, renderer]);

  /* ── interaction ─────────────────────────────────────────────────────── */
  const commit = useCallback((next: SurfaceCameraConfig, projection?: SurfaceProjection) => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      onViewChange?.(clampCamera(next), projection);
    }, 220);
  }, [onViewChange]);

  const update = useCallback((mutate: (current: SurfaceCameraConfig) => SurfaceCameraConfig, projection?: SurfaceProjection) => {
    const next = clampCamera(mutate(cameraRef.current));
    cameraRef.current = next;
    setCamera(next);
    commit(next, projection);
  }, [commit]);

  useEffect(() => () => {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 1 || event.button === 2) event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
    setDragging(true);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: cameraRef.current.zoom };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      // Two-finger gesture: the distance changes the zoom, the midpoint pans.
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const ratio = distance / pinch.current.distance;
      update((current) => ({ ...current, zoom: current.zoom * ratio }), undefined);
      pinch.current = { distance, zoom: cameraRef.current.zoom };
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    if (event.shiftKey || event.button === 1 || event.buttons === 4) {
      update((current) => ({
        ...current,
        panX: current.panX + (dx / paintWidth) * 2,
        panY: current.panY - (dy / paintHeight) * 2,
      }));
      return;
    }
    update((current) => ({
      ...current,
      azimuth: current.azimuth - dx * 0.45,
      elevation: current.elevation + dy * 0.35,
    }));
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  // React's own wheel listener is passive at the root, so the zoom listener is
  // attached directly to the stage with `passive: false` — otherwise the page
  // scrolls away while the wheel zooms the surface.
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      update((current) => ({ ...current, zoom: current.zoom * factor }));
    };
    node.addEventListener('wheel', handler, { passive: false });
    return () => node.removeEventListener('wheel', handler);
  }, [update]);

  const setPreset = (preset: keyof typeof SURFACE_VIEW_PRESETS) => {
    const target = SURFACE_VIEW_PRESETS[preset];
    update((current) => ({ ...current, azimuth: target.azimuth, elevation: target.elevation, panX: 0, panY: 0 }));
  };

  const reset = () => update(() => ({ ...defaultSurfaceViewConfig().camera }));
  const toggleProjection = () => {
    const next: SurfaceProjection = view.projection === 'perspective' ? 'orthographic' : 'perspective';
    onViewChange?.(clampCamera(camera), next);
  };

  return (
    <div
      className={`surface3d${dragging ? ' dragging' : ''}`}
      data-testid="surface3d"
      data-renderer={renderer}
      data-render-mode={view.renderMode}
      data-projection={view.projection}
      data-azimuth={view.camera.azimuth.toFixed(1)}
      data-elevation={view.camera.elevation.toFixed(1)}
      data-zoom={view.camera.zoom.toFixed(3)}
      style={{ width: paintWidth, marginInline: 'auto', position: 'relative' }}
    >
      <div
        ref={stageRef}
        className="surface3d-stage"
        style={{ position: 'relative', width: paintWidth, height: paintHeight, cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onContextMenu={(event) => event.preventDefault()}
      >
        {renderer === 'webgl' ? (
          <>
            <canvas
              ref={canvasRef}
              data-testid="surface3d-canvas"
              style={{ position: 'absolute', inset: 0, width: paintWidth, height: paintHeight, display: 'block' }}
            />
            <div
              data-testid="surface3d-overlay"
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              dangerouslySetInnerHTML={{ __html: `<svg width="${paintWidth}" height="${paintHeight}" viewBox="0 0 ${paintWidth} ${paintHeight}" fill="none" font-family="${style.mono}">${overlay}</svg>` }}
            />
          </>
        ) : (
          <div
            data-testid="surface3d-static"
            style={{ position: 'absolute', inset: 0 }}
            dangerouslySetInnerHTML={{ __html: staticSvg }}
          />
        )}
        {renderer === 'webgl' && colorbar && (
          <div
            data-testid="surface3d-colorbar"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            dangerouslySetInnerHTML={{ __html: `<svg width="${paintWidth}" height="${paintHeight}" viewBox="0 0 ${paintWidth} ${paintHeight}">${colorbar}</svg>` }}
          />
        )}
        <div className="surface3d-badge" data-testid="surface3d-badge" data-kind={renderer}>
          {renderer === 'webgl' ? t(lang, 'surface.badge.webgl') : t(lang, 'surface.badge.static')}
        </div>
        {renderer === 'static' && (
          <div className="surface3d-notice" data-testid="surface3d-fallback" role="status">
            {t(lang, 'surface.fallback.notice')}
          </div>
        )}
        {(chart.extrapolated || (chart.nonEstimable?.length ?? 0) > 0) && (
          <div className="surface3d-warning" data-testid="surface3d-warning" role="status">
            {chart.nonEstimable?.length ? t(lang, 'surface.warn.nonEstimable', { terms: chart.nonEstimable.join(', ') }) : t(lang, 'surface.warn.extrapolated')}
          </div>
        )}
      </div>
      <div className="surface3d-tools" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="btn ghost" onClick={reset} data-testid="surface-reset">{t(lang, 'surface.tool.reset')}</button>
        <button type="button" className="btn ghost" onClick={() => setPreset('isometric')} data-testid="surface-view-iso">{t(lang, 'surface.tool.iso')}</button>
        <button type="button" className="btn ghost" onClick={() => setPreset('top')} data-testid="surface-view-top">{t(lang, 'surface.tool.top')}</button>
        <button type="button" className="btn ghost" onClick={() => setPreset('front')} data-testid="surface-view-front">{t(lang, 'surface.tool.front')}</button>
        <button type="button" className="btn ghost" onClick={() => setPreset('side')} data-testid="surface-view-side">{t(lang, 'surface.tool.side')}</button>
        <button type="button" className="btn ghost" onClick={toggleProjection} data-testid="surface-projection">
          {view.projection === 'perspective' ? t(lang, 'surface.tool.ortho') : t(lang, 'surface.tool.persp')}
        </button>
        <span className="mono-note" data-testid="surface3d-resolution">{chart.xs.length}×{chart.ys.length}</span>
      </div>
    </div>
  );
}

function hexUnit(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((char) => char + char).join('') : clean;
  if (full.length !== 6) return [0.2, 0.2, 0.2];
  const part = (offset: number) => parseInt(full.slice(offset, offset + 2), 16) / 255;
  return [part(0), part(2), part(4)];
}

/** Purely for tests and diagnostics: where a point lands in the current view. */
export function projectForTest(
  chart: SurfaceChart,
  view: SurfaceViewConfig,
  width: number,
  height: number,
  point: [number, number, number],
): { x: number; y: number } {
  const basis = cameraBasis(view.camera, view.projection, width, height);
  const projected = projectPoint(point, basis, view.projection, view.camera);
  void chart;
  return { x: projected.x, y: projected.y };
}
