/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — workspace layout presets and floating-panel geometry
   Kept free of React so the numbers can be unit-tested.
   ───────────────────────────────────────────────────────────────────────── */

export type LayoutPresetId = 'balanced' | 'sheet' | 'results' | 'focus';

export interface LayoutPreset {
  id: LayoutPresetId;
  /** interface string key for the menu entry */
  labelKey: string;
  /** navigator width in px (VS Code-like pane) */
  navWidth: number;
  /** output panel height as a percentage of the main column */
  outputHeight: number;
  /** the navigator pane is folded away in this preset */
  navHidden: boolean;
}

export const DEFAULT_NAV = 254;
export const DEFAULT_OUTPUT = 52;

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'balanced', labelKey: 'view.layout.balanced', navWidth: DEFAULT_NAV, outputHeight: DEFAULT_OUTPUT, navHidden: false },
  { id: 'sheet', labelKey: 'view.layout.sheet', navWidth: 236, outputHeight: 26, navHidden: false },
  { id: 'results', labelKey: 'view.layout.results', navWidth: 196, outputHeight: 78, navHidden: false },
  { id: 'focus', labelKey: 'view.layout.focus', navWidth: DEFAULT_NAV, outputHeight: 60, navHidden: true },
];

export type PanelId = 'navigator' | 'output' | 'worksheet';

export interface FloatRect { x: number; y: number; w: number; h: number }

/** The size a panel opens at the first time it is detached. */
export const DEFAULT_FLOAT_SIZES: Record<PanelId, { w: number; h: number }> = {
  navigator: { w: 306, h: 452 },
  output: { w: 780, h: 560 },
  worksheet: { w: 720, h: 540 },
};

/** A floating window never shrinks below this, whatever the drag distance. */
export const FLOAT_MIN: Record<PanelId, { w: number; h: number }> = {
  navigator: { w: 240, h: 240 },
  output: { w: 360, h: 240 },
  worksheet: { w: 340, h: 240 },
};

/** Space kept free between a floating window and the viewport edges. */
export const FLOAT_MARGIN = 8;

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function findPreset(id: string): LayoutPreset {
  return LAYOUT_PRESETS.find((preset) => preset.id === id) ?? LAYOUT_PRESETS[0];
}

export function clampNav(width: number): number {
  return Math.min(430, Math.max(180, Math.round(width)));
}

export function clampOutput(height: number): number {
  return Math.min(82, Math.max(18, Math.round(height)));
}

/**
 * Top-left start for a detached panel, kept inside a viewport of the given size.
 * `size` lets a panel reopen at the size the user last resized it to.
 */
export function floatRect(id: PanelId, viewportW: number, viewportH: number, size?: { w: number; h: number }): FloatRect {
  const base = size ?? DEFAULT_FLOAT_SIZES[id];
  const margin = FLOAT_MARGIN;
  const top = 56;
  const w = Math.max(240, Math.min(base.w, viewportW - margin * 2));
  const h = Math.max(200, Math.min(base.h, viewportH - top - margin * 2));
  const x = Math.min(Math.max(margin, Math.round((viewportW - w) / 2)), Math.max(margin, viewportW - w - margin));
  const y = Math.min(Math.max(top, Math.round((viewportH - h) / 2)), Math.max(top, viewportH - h - margin));
  return { x, y, w, h };
}

/** Keep a dragged panel on screen: at least a strip of its header stays reachable. */
export function clampFloatPosition(x: number, y: number, w: number, viewportW: number, viewportH: number): { x: number; y: number } {
  const minVisible = 96;
  return {
    x: Math.min(Math.max(-(w - minVisible), Math.round(x)), Math.max(0, viewportW - minVisible)),
    y: Math.min(Math.max(0, Math.round(y)), Math.max(0, viewportH - 44)),
  };
}

/** Clamp a requested floating-window size to the panel minimum and the viewport. */
export function clampFloatSize(
  id: PanelId,
  width: number,
  height: number,
  x: number,
  y: number,
  viewportW: number,
  viewportH: number,
): { w: number; h: number } {
  const min = FLOAT_MIN[id];
  const maxW = Math.max(min.w, viewportW - FLOAT_MARGIN - Math.max(0, x));
  const maxH = Math.max(min.h, viewportH - FLOAT_MARGIN - Math.max(0, y));
  return {
    w: Math.round(Math.min(Math.max(width, min.w), maxW)),
    h: Math.round(Math.min(Math.max(height, min.h), maxH)),
  };
}

/**
 * Apply one pointer-drag step on one edge or corner of a floating window.
 * The opposite edge stays put, the panel keeps its minimum size, and the
 * moving edge cannot leave the viewport.
 */
export function resizeFloatRect(
  id: PanelId,
  rect: FloatRect,
  dir: ResizeDir,
  dx: number,
  dy: number,
  viewportW: number,
  viewportH: number,
): FloatRect {
  const min = FLOAT_MIN[id];
  let { x, y, w, h } = rect;
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;

  if (dir.includes('e')) {
    w = Math.min(Math.max(rect.w + dx, min.w), Math.max(min.w, viewportW - FLOAT_MARGIN - rect.x));
  }
  if (dir.includes('s')) {
    h = Math.min(Math.max(rect.h + dy, min.h), Math.max(min.h, viewportH - FLOAT_MARGIN - rect.y));
  }
  if (dir.includes('w')) {
    w = Math.min(Math.max(rect.w - dx, min.w), Math.max(min.w, right - FLOAT_MARGIN));
    x = right - w;
  }
  if (dir.includes('n')) {
    h = Math.min(Math.max(rect.h - dy, min.h), Math.max(min.h, bottom - FLOAT_MARGIN));
    y = bottom - h;
  }

  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Bring a floating window fully back inside a viewport that changed size. */
export function fitFloatRect(rect: FloatRect, viewportW: number, viewportH: number): FloatRect {
  const margin = FLOAT_MARGIN;
  const capW = Math.max(240, viewportW - margin * 2);
  const capH = Math.max(180, viewportH - margin * 2);
  const w = Math.round(Math.min(rect.w, capW));
  const h = Math.round(Math.min(rect.h, capH));
  const x = Math.round(Math.min(Math.max(margin, rect.x), Math.max(margin, viewportW - w - margin)));
  const y = Math.round(Math.min(Math.max(margin, rect.y), Math.max(margin, viewportH - h - margin)));
  return { x, y, w, h };
}
