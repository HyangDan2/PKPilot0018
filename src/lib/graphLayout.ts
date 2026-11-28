/* ─────────────────────────────────────────────────────────────────────────
   Statelia — graph layout editor model (Stage 3D, WO-07)

   A layout is a page with panels on it: charts taken from the output, text
   boxes, arrows, lines, rectangles, circles, highlight regions, figure labels
   (a), (b), (c) and inserted images. Everything is measured in millimetres, so
   the same document prints at A4, at a journal column width, or exports at any
   DPI without the numbers changing meaning.

   The module is pure: no DOM, no React, no renderer. The editor calls these
   operations, and the export builds the SVG from a `renderChart` callback the
   caller supplies — which is what makes the whole thing testable in Node.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec } from '../types';
import type { ChartConfig } from './chartConfig';
import { PRODUCT } from '../config/product';

export type PagePresetId =
  | 'a4-portrait'
  | 'a4-landscape'
  | 'presentation-16-9'
  | 'presentation-4-3'
  | 'single-column'
  | 'double-column'
  | 'custom';

export interface PagePreset {
  id: PagePresetId;
  widthMm: number;
  heightMm: number;
  /** Suggested outer margin in millimetres. */
  marginMm: number;
}

/** Print and slide sizes in millimetres (A4 = 210 × 297). */
export const PAGE_PRESETS: PagePreset[] = [
  { id: 'a4-portrait', widthMm: 210, heightMm: 297, marginMm: 15 },
  { id: 'a4-landscape', widthMm: 297, heightMm: 210, marginMm: 15 },
  { id: 'presentation-16-9', widthMm: 338.7, heightMm: 190.5, marginMm: 12 },
  { id: 'presentation-4-3', widthMm: 254, heightMm: 190.5, marginMm: 12 },
  { id: 'single-column', widthMm: 85, heightMm: 110, marginMm: 5 },
  { id: 'double-column', widthMm: 178, heightMm: 120, marginMm: 6 },
  { id: 'custom', widthMm: 200, heightMm: 200, marginMm: 10 },
];

export function pagePreset(id: PagePresetId): PagePreset {
  return PAGE_PRESETS.find((preset) => preset.id === id) ?? PAGE_PRESETS[0];
}

export type PanelKind = 'chart' | 'text' | 'arrow' | 'line' | 'rectangle' | 'circle' | 'highlight' | 'figure-label' | 'image';

export interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PanelBase extends PanelBox {
  id: string;
  kind: PanelKind;
  /** Stacking order: larger sits on top. */
  z: number;
  locked?: boolean;
}

/** Where a chart panel takes its picture from. */
export interface ChartPanelSource {
  outputId: string;
  blockIndex: number;
  chartIndex: number;
}

export interface ChartPanel extends PanelBase {
  kind: 'chart';
  source: ChartPanelSource;
  caption: string;
  /** A copy of the chart as it stood when it was placed on the page. */
  chart: ChartSpec;
  config?: ChartConfig;
  /**
   * A 3D surface is drawn by WebGL on screen and by a raster picture here, so
   * the editor tells the reader the figure exports that panel as an image.
   */
  raster: boolean;
}

export interface TextPanel extends PanelBase {
  kind: 'text';
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  align: 'left' | 'center' | 'right';
}

export interface FigureLabelPanel extends PanelBase {
  kind: 'figure-label';
  label: string;
  fontSize: number;
  bold: boolean;
}

export interface ShapePanel extends PanelBase {
  kind: 'arrow' | 'line' | 'rectangle' | 'circle' | 'highlight';
  color: string;
  width: number;
  dash: string;
  /** Fill for rectangle / circle / highlight (empty = none). */
  fill: string;
  opacity: number;
}

export interface ImagePanel extends PanelBase {
  kind: 'image';
  /** Data URL or a local file URL the reader inserted. */
  href: string;
  name: string;
  maintainAspect: boolean;
}

export type LayoutPanel = ChartPanel | TextPanel | FigureLabelPanel | ShapePanel | ImagePanel;

export interface LayoutDoc {
  format: 'sigrun-layout';
  version: 1;
  page: {
    preset: PagePresetId;
    widthMm: number;
    heightMm: number;
    marginMm: number;
    background: string;
  };
  grid: {
    enabled: boolean;
    sizeMm: number;
  };
  panels: LayoutPanel[];
  /** Next z value handed out, so a copy always lands on top. */
  zSeq: number;
  idSeq: number;
}

export const GRID_SIZES = [1, 2, 5, 10] as const;
export const DEFAULT_PANEL = { w: 90, h: 70 };

let panelSequence = 0;

function nextId(doc: LayoutDoc, prefix: string): string {
  doc.idSeq += 1;
  panelSequence += 1;
  return `${prefix}-${doc.idSeq}-${panelSequence}`;
}

/** A new, empty document for a page preset. */
export function createLayout(preset: PagePresetId = 'a4-landscape', overrides: { widthMm?: number; heightMm?: number; marginMm?: number } = {}): LayoutDoc {
  const page = pagePreset(preset);
  return {
    format: 'sigrun-layout',
    version: 1,
    page: {
      preset,
      widthMm: overrides.widthMm ?? page.widthMm,
      heightMm: overrides.heightMm ?? page.heightMm,
      marginMm: overrides.marginMm ?? page.marginMm,
      background: '#ffffff',
    },
    grid: { enabled: true, sizeMm: 2 },
    panels: [],
    zSeq: 1,
    idSeq: 0,
  };
}

/** Change the page size, keeping the panels where they are. */
export function setPageSize(doc: LayoutDoc, preset: PagePresetId, size?: { widthMm?: number; heightMm?: number; marginMm?: number }): LayoutDoc {
  const page = pagePreset(preset);
  return {
    ...doc,
    page: {
      ...doc.page,
      preset,
      widthMm: Math.max(40, size?.widthMm ?? page.widthMm),
      heightMm: Math.max(40, size?.heightMm ?? page.heightMm),
      marginMm: Math.max(0, size?.marginMm ?? page.marginMm),
    },
  };
}

/** The area panels may occupy (page minus margins). */
export function contentBox(doc: LayoutDoc): PanelBox {
  const margin = Math.min(doc.page.marginMm, Math.min(doc.page.widthMm, doc.page.heightMm) / 3);
  return {
    x: margin,
    y: margin,
    w: doc.page.widthMm - margin * 2,
    h: doc.page.heightMm - margin * 2,
  };
}

/* ── geometry ─────────────────────────────────────────────────────────── */

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Snap a coordinate to the grid when snapping is on. */
export function snap(value: number, doc: LayoutDoc): number {
  if (!doc.grid.enabled || !(doc.grid.sizeMm > 0)) return round2(value);
  return round2(Math.round(value / doc.grid.sizeMm) * doc.grid.sizeMm);
}

export interface PanelLimits {
  box: PanelBox;
  grid: LayoutDoc['grid'];
}

export function clampPanel(panel: LayoutPanel, limits: PanelLimits): LayoutPanel {
  const { box, grid } = limits;
  const snapValue = (value: number) => (grid.enabled && grid.sizeMm > 0 ? round2(Math.round(value / grid.sizeMm) * grid.sizeMm) : round2(value));
  const w = Math.max(4, Math.min(box.w, panel.w));
  const h = Math.max(4, Math.min(box.h, panel.h));
  return {
    ...panel,
    w,
    h,
    x: Math.max(box.x, Math.min(box.x + box.w - w, snapValue(panel.x))),
    y: Math.max(box.y, Math.min(box.y + box.h - h, snapValue(panel.y))),
  };
}

/** Move panels by a delta, snapped and kept inside the page. */
export function movePanels(doc: LayoutDoc, ids: string[], dx: number, dy: number): LayoutDoc {
  const limits: PanelLimits = { box: contentBox(doc), grid: doc.grid };
  const wanted = new Set(ids);
  return {
    ...doc,
    panels: doc.panels.map((panel) => {
      if (!wanted.has(panel.id) || panel.locked) return panel;
      return clampPanel({ ...panel, x: panel.x + dx, y: panel.y + dy }, limits);
    }),
  };
}

export interface ResizeOptions {
  /** Snap the result to the grid. */
  snap?: boolean;
  /** Keep the box proportional (shift-drag). */
  aspect?: number | null;
  minimum?: number;
}

/** Resize one panel; `handle` names the corner or edge being dragged. */
export function resizePanel(
  doc: LayoutDoc,
  panel: LayoutPanel,
  handle: string,
  dx: number,
  dy: number,
  options: ResizeOptions = {},
): LayoutPanel {
  const box = contentBox(doc);
  const min = options.minimum ?? 6;
  let { x, y, w, h } = panel;
  const horizontal = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const vertical = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  if (horizontal > 0) w += dx;
  if (horizontal < 0) { w -= dx; x += dx; }
  if (vertical > 0) h += dy;
  if (vertical < 0) { h -= dy; y += dy; }
  if (options.aspect) {
    const ratio = options.aspect;
    if (horizontal !== 0) h = w / ratio;
    else if (vertical !== 0) w = h * ratio;
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  // Never let a resize push the panel outside the printable area.
  if (x < box.x) { w -= box.x - x; x = box.x; }
  if (y < box.y) { h -= box.y - y; y = box.y; }
  w = Math.min(w, box.x + box.w - x);
  h = Math.min(h, box.y + box.h - y);
  const snapOn = options.snap ?? doc.grid.enabled;
  const grid = { enabled: snapOn, sizeMm: doc.grid.sizeMm };
  return clampPanel({ ...panel, x, y, w: Math.max(min, w), h: Math.max(min, h) }, { box, grid });
}

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** Align panels to the first selected panel's edge (or the page centre). */
export function alignPanels(doc: LayoutDoc, ids: string[], mode: AlignMode): LayoutDoc {
  const chosen = doc.panels.filter((panel) => ids.includes(panel.id) && !panel.locked);
  if (chosen.length < 2) return doc;
  const reference = chosen[0];
  const page = contentBox(doc);
  const target = (panel: LayoutPanel): number => {
    switch (mode) {
      case 'left': return reference.x;
      case 'center': return reference.x + reference.w / 2 - panel.w / 2;
      case 'right': return reference.x + reference.w - panel.w;
      case 'top': return reference.y;
      case 'middle': return reference.y + reference.h / 2 - panel.h / 2;
      case 'bottom': return reference.y + reference.h - panel.h;
      default: return panel.y;
    }
  };
  return {
    ...doc,
    panels: doc.panels.map((panel) => {
      if (!ids.includes(panel.id) || panel.locked) return panel;
      const value = target(panel);
      if (mode === 'left' || mode === 'center' || mode === 'right') {
        return { ...panel, x: round2(Math.max(page.x, Math.min(page.x + page.w - panel.w, value))) };
      }
      return { ...panel, y: round2(Math.max(page.y, Math.min(page.y + page.h - panel.h, value))) };
    }),
  };
}

/**
 * Spread the selected panels so the gaps between them are equal. The two
 * outermost panels stay where they are (the ordinary "distribute spacing"
 * behaviour); fewer than three panels cannot be distributed.
 */
export function distributePanels(doc: LayoutDoc, ids: string[], axis: 'x' | 'y'): LayoutDoc {
  const chosen = doc.panels.filter((panel) => ids.includes(panel.id) && !panel.locked);
  if (chosen.length < 3) return doc;
  const sorted = [...chosen].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = axis === 'x' ? first.x : first.y;
  const end = axis === 'x' ? last.x + last.w : last.y + last.h;
  const totalSize = sorted.reduce((sum, panel) => sum + (axis === 'x' ? panel.w : panel.h), 0);
  const gap = (end - start - totalSize) / (sorted.length - 1);
  let cursor = start;
  const placed = new Map<string, number>();
  sorted.forEach((panel) => {
    placed.set(panel.id, round2(cursor));
    cursor += (axis === 'x' ? panel.w : panel.h) + gap;
  });
  return {
    ...doc,
    panels: doc.panels.map((panel) => {
      const value = placed.get(panel.id);
      if (value === undefined) return panel;
      return axis === 'x' ? { ...panel, x: value } : { ...panel, y: value };
    }),
  };
}

/** Make every selected panel the size of the first selected one. */
export function matchSize(doc: LayoutDoc, ids: string[]): LayoutDoc {
  const chosen = doc.panels.filter((panel) => ids.includes(panel.id) && !panel.locked);
  if (chosen.length < 2) return doc;
  const { w, h } = chosen[0];
  return {
    ...doc,
    panels: doc.panels.map((panel) => (ids.includes(panel.id) && !panel.locked ? { ...panel, w, h } : panel)),
  };
}

/* ── panels ───────────────────────────────────────────────────────────── */

/** Where a new panel of this size goes: the first free cell in reading order. */
export function findFreeSpot(doc: LayoutDoc, w: number, h: number): { x: number; y: number } {
  const box = contentBox(doc);
  const step = doc.grid.enabled && doc.grid.sizeMm > 0 ? doc.grid.sizeMm : 2;
  const overlaps = (x: number, y: number) => doc.panels.some((panel) => (
    x < panel.x + panel.w && x + w > panel.x && y < panel.y + panel.h && y + h > panel.y
  ));
  for (let y = box.y; y + h <= box.y + box.h + 1e-9; y += step) {
    for (let x = box.x; x + w <= box.x + box.w + 1e-9; x += step) {
      if (!overlaps(x, y)) return { x: round2(x), y: round2(y) };
    }
  }
  // The page is full: place it at the margin and let the reader move it.
  return { x: box.x, y: box.y };
}

export interface ChartPlacement {
  outputId: string;
  blockIndex: number;
  chartIndex: number;
  chart: ChartSpec;
  config?: ChartConfig;
  caption: string;
  size?: { w: number; h: number };
}

/** Add a chart from the output as a panel. */
export function addChartPanel(doc: LayoutDoc, placement: ChartPlacement): { doc: LayoutDoc; panel: ChartPanel } {
  const w = Math.max(20, placement.size?.w ?? DEFAULT_PANEL.w);
  const h = Math.max(20, placement.size?.h ?? DEFAULT_PANEL.h);
  const spot = findFreeSpot(doc, w, h);
  const panel: ChartPanel = {
    id: nextId(doc, 'chart'),
    kind: 'chart',
    x: spot.x,
    y: spot.y,
    w,
    h,
    z: doc.zSeq,
    source: { outputId: placement.outputId, blockIndex: placement.blockIndex, chartIndex: placement.chartIndex },
    caption: placement.caption,
    chart: placement.chart,
    ...(placement.config ? { config: placement.config } : {}),
    raster: placement.chart.kind === 'surface3d',
  };
  return {
    doc: { ...doc, panels: [...doc.panels, panel], zSeq: doc.zSeq + 1 },
    panel,
  };
}

/** Add an annotation panel, ready to be dragged into place. */
export function addPanel(doc: LayoutDoc, kind: Exclude<PanelKind, 'chart'>): { doc: LayoutDoc; panel: LayoutPanel } {
  const box = contentBox(doc);
  const base = { id: nextId(doc, kind), z: doc.zSeq, x: box.x, y: box.y };
  let panel: LayoutPanel;
  switch (kind) {
    case 'text':
      panel = { ...base, kind, w: Math.min(80, box.w), h: 12, text: '', fontSize: 10, color: '', bold: false, align: 'left' };
      break;
    case 'figure-label':
      panel = { ...base, kind, w: 12, h: 8, label: nextFigureLabel(doc), fontSize: 11, bold: true };
      break;
    case 'image':
      panel = { ...base, kind, w: Math.min(60, box.w), h: Math.min(45, box.h), href: '', name: '', maintainAspect: true };
      break;
    case 'circle':
      panel = { ...base, kind, w: 24, h: 24, color: '#8b6ce8', width: 1.2, dash: '', fill: '', opacity: 1 };
      break;
    case 'highlight':
      panel = { ...base, kind, w: 40, h: 20, color: '#f59e0b', width: 0, dash: '', fill: '#fde68a', opacity: 0.35 };
      break;
    case 'arrow':
    case 'line':
      panel = { ...base, kind, w: 40, h: 0.001 + 1, color: '#111827', width: 1.2, dash: '', fill: '', opacity: 1 };
      break;
    case 'rectangle':
    default:
      panel = { ...base, kind: 'rectangle', w: 40, h: 24, color: '#111827', width: 1.2, dash: '', fill: '', opacity: 1 };
      break;
  }
  const spot = findFreeSpot(doc, panel.w, panel.h);
  panel = { ...panel, x: spot.x, y: spot.y };
  return { doc: { ...doc, panels: [...doc.panels, panel], zSeq: doc.zSeq + 1 }, panel };
}

/** (a), (b), (c) … (z), (aa), (ab) … for the next figure label. */
export function nextFigureLabel(doc: LayoutDoc): string {
  const used = doc.panels.filter((panel): panel is FigureLabelPanel => panel.kind === 'figure-label').length;
  return figureLabelAt(used);
}

/** The label for a zero-based position. */
export function figureLabelAt(index: number): string {
  const position = Math.max(0, Math.floor(index));
  const letter = String.fromCharCode(97 + (position % 26));
  const repeat = Math.floor(position / 26);
  return `(${repeat ? letter.repeat(repeat + 1) : letter})`;
}

/** Renumber every figure label in reading order (top to bottom, left to right). */
export function relabelFigures(doc: LayoutDoc): LayoutDoc {
  const labels = doc.panels
    .filter((panel): panel is FigureLabelPanel => panel.kind === 'figure-label')
    .sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x));
  const order = new Map(labels.map((panel, index) => [panel.id, figureLabelAt(index)]));
  return {
    ...doc,
    panels: doc.panels.map((panel) => (panel.kind === 'figure-label' ? { ...panel, label: order.get(panel.id) ?? panel.label } : panel)),
  };
}

export function updatePanel(doc: LayoutDoc, id: string, patch: Partial<LayoutPanel>): LayoutDoc {
  return { ...doc, panels: doc.panels.map((panel) => (panel.id === id ? ({ ...panel, ...patch } as LayoutPanel) : panel)) };
}

export function removePanels(doc: LayoutDoc, ids: string[]): LayoutDoc {
  return { ...doc, panels: doc.panels.filter((panel) => !ids.includes(panel.id)) };
}

/** Copy panels; copies land 4 mm down-right and on top. */
export function duplicatePanels(doc: LayoutDoc, ids: string[]): { doc: LayoutDoc; ids: string[] } {
  const created: string[] = [];
  let z = doc.zSeq;
  const copies = doc.panels
    .filter((panel) => ids.includes(panel.id))
    .map((panel) => {
      const copy = {
        ...panel,
        id: nextId(doc, panel.kind),
        x: panel.x + 4,
        y: panel.y + 4,
        z: z++,
        locked: false,
      } as LayoutPanel;
      created.push(copy.id);
      return copy;
    });
  return { doc: { ...doc, panels: [...doc.panels, ...copies], zSeq: z }, ids: created };
}

export type LayerMove = 'front' | 'back' | 'forward' | 'backward';

/** Change the stacking order of the selected panels. */
export function reorderPanels(doc: LayoutDoc, ids: string[], move: LayerMove): LayoutDoc {
  const sorted = [...doc.panels].sort((a, b) => a.z - b.z);
  const targets = new Set(ids);
  let index = 0;
  if (move === 'front' || move === 'back') {
    const chosen = sorted.filter((panel) => targets.has(panel.id));
    const rest = sorted.filter((panel) => !targets.has(panel.id));
    const arranged = move === 'front' ? [...rest, ...chosen] : [...chosen, ...rest];
    return { ...doc, panels: arranged.map((panel) => ({ ...panel, z: index++ + 1 })) };
  }
  const working = [...sorted];
  if (move === 'forward') {
    for (let i = working.length - 2; i >= 0; i -= 1) {
      if (targets.has(working[i].id) && !targets.has(working[i + 1].id)) {
        [working[i], working[i + 1]] = [working[i + 1], working[i]];
      }
    }
  } else {
    for (let i = 1; i < working.length; i += 1) {
      if (targets.has(working[i].id) && !targets.has(working[i - 1].id)) {
        [working[i], working[i - 1]] = [working[i - 1], working[i]];
      }
    }
  }
  return { ...doc, panels: working.map((panel) => ({ ...panel, z: index++ + 1 })) };
}

/** Apply one chart style to every chart panel ("전체 스타일 통일"). */
export function unifyChartStyle(doc: LayoutDoc, style: { preset: string; fontSize?: number }): LayoutDoc {
  return {
    ...doc,
    panels: doc.panels.map((panel) => {
      if (panel.kind !== 'chart') return panel;
      const config: ChartConfig = {
        ...(panel.config ?? {}),
        appearance: {
          ...(panel.config?.appearance ?? {}),
          preset: style.preset as NonNullable<ChartConfig['appearance']>['preset'],
          ...(style.fontSize != null ? { fontSize: style.fontSize } : {}),
        },
      };
      return {
        ...panel,
        config,
        chart: { ...panel.chart, config: { ...(panel.chart.config ?? {}), appearance: config.appearance } },
      };
    }),
  };
}

/* ── undo / redo ──────────────────────────────────────────────────────── */

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A bounded history of whole documents: a layout edit is one step. */
export class LayoutHistory {
  private past: LayoutDoc[] = [];

  private future: LayoutDoc[] = [];

  constructor(private current: LayoutDoc, private limit = 60) {}

  state(): LayoutDoc {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Record a new document; identical documents do not create a step. */
  push(next: LayoutDoc): LayoutDoc {
    const before = JSON.stringify(this.current);
    if (JSON.stringify(next) === before) return this.current;
    this.past.push(clone(this.current));
    if (this.past.length > this.limit) this.past.shift();
    this.current = next;
    this.future = [];
    return this.current;
  }

  undo(): LayoutDoc {
    const previous = this.past.pop();
    if (!previous) return this.current;
    this.future.push(clone(this.current));
    this.current = previous;
    return this.current;
  }

  redo(): LayoutDoc {
    const next = this.future.pop();
    if (!next) return this.current;
    this.past.push(clone(this.current));
    this.current = next;
    return this.current;
  }

  reset(next: LayoutDoc): LayoutDoc {
    this.past = [];
    this.future = [];
    this.current = next;
    return this.current;
  }
}

/* ── serialisation ────────────────────────────────────────────────────── */

export function serializeLayout(doc: LayoutDoc): string {
  return JSON.stringify(doc, null, 1);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

const KINDS: PanelKind[] = ['chart', 'text', 'arrow', 'line', 'rectangle', 'circle', 'highlight', 'figure-label', 'image'];

/**
 * Parse a saved layout. A file from a newer version, or one whose panels are
 * not panels, is rejected with `null` rather than half-loaded.
 */
export function parseLayout(text: string): LayoutDoc | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (source.format !== 'sigrun-layout') return null;
  const page = (source.page ?? {}) as Record<string, unknown>;
  const grid = (source.grid ?? {}) as Record<string, unknown>;
  const panelsRaw = Array.isArray(source.panels) ? source.panels : [];
  const panels: LayoutPanel[] = [];
  panelsRaw.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const panel = entry as Record<string, unknown>;
    const kind = panel.kind as PanelKind;
    if (!KINDS.includes(kind)) return;
    const base = {
      id: textOr(panel.id, `panel-${panels.length}`),
      kind,
      x: numberOr(panel.x, 0),
      y: numberOr(panel.y, 0),
      w: Math.max(0.5, numberOr(panel.w, 20)),
      h: Math.max(0.5, numberOr(panel.h, 12)),
      z: numberOr(panel.z, panels.length + 1),
      ...(panel.locked === true ? { locked: true } : {}),
    };
    if (kind === 'chart') {
      const chart = panel.chart as ChartSpec | undefined;
      if (!chart || typeof chart !== 'object') return;
      const src = (panel.source ?? {}) as Record<string, unknown>;
      panels.push({
        ...base,
        kind: 'chart',
        source: {
          outputId: textOr(src.outputId, ''),
          blockIndex: numberOr(src.blockIndex, 0),
          chartIndex: numberOr(src.chartIndex, 0),
        },
        caption: textOr(panel.caption, ''),
        chart,
        ...(panel.config && typeof panel.config === 'object' ? { config: panel.config as ChartConfig } : {}),
        raster: panel.raster === true || chart.kind === 'surface3d',
      });
      return;
    }
    if (kind === 'text') {
      panels.push({
        ...base,
        kind: 'text',
        text: textOr(panel.text, ''),
        fontSize: numberOr(panel.fontSize, 10),
        color: textOr(panel.color, ''),
        bold: panel.bold === true,
        align: panel.align === 'center' || panel.align === 'right' ? panel.align : 'left',
      });
      return;
    }
    if (kind === 'figure-label') {
      panels.push({ ...base, kind: 'figure-label', label: textOr(panel.label, '(a)'), fontSize: numberOr(panel.fontSize, 11), bold: panel.bold !== false });
      return;
    }
    if (kind === 'image') {
      panels.push({
        ...base,
        kind: 'image',
        href: textOr(panel.href, ''),
        name: textOr(panel.name, ''),
        maintainAspect: panel.maintainAspect !== false,
      });
      return;
    }
    panels.push({
      ...base,
      kind,
      color: textOr(panel.color, '#111827'),
      width: numberOr(panel.width, 1.2),
      dash: textOr(panel.dash, ''),
      fill: textOr(panel.fill, ''),
      opacity: numberOr(panel.opacity, 1),
    });
  });
  return {
    format: 'sigrun-layout',
    version: 1,
    page: {
      preset: (textOr(page.preset, 'custom') as PagePresetId),
      widthMm: Math.max(40, numberOr(page.widthMm, 200)),
      heightMm: Math.max(40, numberOr(page.heightMm, 200)),
      marginMm: Math.max(0, numberOr(page.marginMm, 10)),
      background: textOr(page.background, '#ffffff'),
    },
    grid: { enabled: grid.enabled !== false, sizeMm: Math.max(0.5, numberOr(grid.sizeMm, 2)) },
    panels: panels.sort((a, b) => a.z - b.z),
    zSeq: numberOr(source.zSeq, panels.length + 1),
    idSeq: numberOr(source.idSeq, panels.length),
  };
}

/* ── export ───────────────────────────────────────────────────────────── */

export interface LayoutRender {
  /** Inner markup of the chart and its intrinsic viewBox. */
  svg: string;
}

const escXml = (value: string | number): string => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function chartMarkup(panel: ChartPanel, rendered: LayoutRender | null): string {
  if (!rendered) {
    return `<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="none" stroke="#cbd5e1" stroke-dasharray="2 2"/>`
      + `<text x="${panel.x + panel.w / 2}" y="${panel.y + panel.h / 2}" text-anchor="middle" font-size="3" fill="#94a3b8">chart unavailable</text>`;
  }
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(rendered.svg);
  const vbW = box ? Number(box[1]) : 560;
  const vbH = box ? Number(box[2]) : 300;
  const body = rendered.svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const captionHeight = panel.caption ? Math.min(10, Math.max(4, panel.h * 0.09)) : 0;
  const chartH = Math.max(2, panel.h - captionHeight);
  const caption = panel.caption
    ? `<text x="${panel.x}" y="${panel.y + panel.h - 1}" font-size="${Math.min(4, Math.max(2.4, captionHeight * 0.55))}" fill="#334155">${escXml(panel.caption)}</text>`
    : '';
  return `<svg x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${chartH}" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet" data-panel="${panel.id}">${body}</svg>${caption}`;
}

function panelMarkup(panel: LayoutPanel, render: (panel: ChartPanel) => LayoutRender | null): string {
  const group = (inner: string) => `<g data-panel="${panel.id}" data-kind="${panel.kind}">${inner}</g>`;
  if (panel.kind === 'chart') return group(chartMarkup(panel, render(panel)));
  if (panel.kind === 'text') {
    const anchor = panel.align === 'center' ? 'middle' : panel.align === 'right' ? 'end' : 'start';
    const x = panel.align === 'center' ? panel.x + panel.w / 2 : panel.align === 'right' ? panel.x + panel.w : panel.x;
    const lines = String(panel.text ?? '').split('\n');
    const lineHeight = panel.fontSize * 0.42;
    return group(lines.map((line, index) => (
      `<text x="${x}" y="${panel.y + lineHeight * (index + 0.9)}" font-size="${panel.fontSize * 0.36}" font-weight="${panel.bold ? 700 : 400}" fill="${escXml(panel.color || '#111827')}" text-anchor="${anchor}">${escXml(line)}</text>`
    )).join(''));
  }
  if (panel.kind === 'figure-label') {
    return group(`<text x="${panel.x}" y="${panel.y + panel.h * 0.8}" font-size="${panel.fontSize * 0.36}" font-weight="${panel.bold ? 700 : 400}" fill="#111827">${escXml(panel.label)}</text>`);
  }
  if (panel.kind === 'image') {
    if (!panel.href) {
      return group(`<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="none" stroke="#cbd5e1" stroke-dasharray="2 2"/>`);
    }
    return group(`<image x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" preserveAspectRatio="${panel.maintainAspect ? 'xMidYMid meet' : 'none'}" href="${escXml(panel.href)}"/>`);
  }
  if (panel.kind === 'arrow') {
    return group(`<line x1="${panel.x}" y1="${panel.y + panel.h / 2}" x2="${panel.x + panel.w}" y2="${panel.y + panel.h / 2}" stroke="${escXml(panel.color)}" stroke-width="${panel.width * 0.36}" ${panel.dash ? `stroke-dasharray="${escXml(panel.dash)}"` : ''} marker-end="url(#sigrun-arrow)"/>`);
  }
  if (panel.kind === 'line') {
    return group(`<line x1="${panel.x}" y1="${panel.y + panel.h / 2}" x2="${panel.x + panel.w}" y2="${panel.y + panel.h / 2}" stroke="${escXml(panel.color)}" stroke-width="${panel.width * 0.36}" ${panel.dash ? `stroke-dasharray="${escXml(panel.dash)}"` : ''}/>`);
  }
  if (panel.kind === 'rectangle') {
    return group(`<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="${panel.fill ? escXml(panel.fill) : 'none'}" fill-opacity="${panel.fill ? panel.opacity : 0}" stroke="${escXml(panel.color)}" stroke-width="${panel.width * 0.36}" ${panel.dash ? `stroke-dasharray="${escXml(panel.dash)}"` : ''}/>`);
  }
  if (panel.kind === 'circle') {
    return group(`<ellipse cx="${panel.x + panel.w / 2}" cy="${panel.y + panel.h / 2}" rx="${panel.w / 2}" ry="${panel.h / 2}" fill="${panel.fill ? escXml(panel.fill) : 'none'}" fill-opacity="${panel.fill ? panel.opacity : 0}" stroke="${escXml(panel.color)}" stroke-width="${panel.width * 0.36}" ${panel.dash ? `stroke-dasharray="${escXml(panel.dash)}"` : ''}/>`);
  }
  return group(`<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="${escXml(panel.fill || '#fde68a')}" fill-opacity="${panel.opacity}" stroke="none"/>`);
}

/**
 * The whole figure as one SVG document, in millimetres.
 *
 * A 3D surface panel is declared as a raster source: the figure says so in
 * `data-raster`, and the editor shows the reader the same warning. Vector
 * panels stay vector.
 */
export function layoutSvg(doc: LayoutDoc, render: (panel: ChartPanel) => LayoutRender | null): string {
  const panels = [...doc.panels].sort((a, b) => a.z - b.z);
  const rasterIds = panels.filter((panel): panel is ChartPanel => panel.kind === 'chart' && panel.raster).map((panel) => panel.id);
  const body = panels.map((panel) => panelMarkup(panel, render)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="sigrun-figure" width="${doc.page.widthMm}mm" height="${doc.page.heightMm}mm" viewBox="0 0 ${doc.page.widthMm} ${doc.page.heightMm}"`
    + ` data-page="${doc.page.preset}" data-panels="${panels.length}"${rasterIds.length ? ` data-raster="${rasterIds.join(' ')}"` : ''}>`
    + `<defs><marker id="sigrun-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>`
    + `<rect data-chart-role="figure-page" x="0" y="0" width="${doc.page.widthMm}" height="${doc.page.heightMm}" fill="${escXml(doc.page.background)}"/>`
    + body
    + '</svg>';
}

/** File name stem for an exported figure. */
export function figureFileName(doc: LayoutDoc, format: 'svg' | 'png', dpi?: number): string {
  return `${PRODUCT.EXPORT_FILE_PREFIX}-figure-${doc.page.preset}${dpi ? `-${dpi}dpi` : ''}.${format}`;
}

/** Physical size of the page in the export config's terms. */
export function pageExportConfig(doc: LayoutDoc, format: 'svg' | 'png', dpi = 300) {
  return {
    format,
    dpi,
    widthPx: 0,
    heightPx: 0,
    physicalWidth: doc.page.widthMm,
    physicalHeight: doc.page.heightMm,
    physicalUnit: 'mm' as const,
    background: 'white' as const,
    includeTitle: true,
    includeLegend: true,
  };
}
