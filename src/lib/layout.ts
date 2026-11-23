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

const FLOAT_SIZES: Record<PanelId, { w: number; h: number }> = {
  navigator: { w: 306, h: 452 },
  output: { w: 780, h: 460 },
  worksheet: { w: 720, h: 440 },
};

export function findPreset(id: string): LayoutPreset {
  return LAYOUT_PRESETS.find((preset) => preset.id === id) ?? LAYOUT_PRESETS[0];
}

export function clampNav(width: number): number {
  return Math.min(430, Math.max(180, Math.round(width)));
}

export function clampOutput(height: number): number {
  return Math.min(82, Math.max(18, Math.round(height)));
}

/** Top-left start for a detached panel, kept inside a viewport of the given size. */
export function floatRect(id: PanelId, viewportW: number, viewportH: number): FloatRect {
  const size = FLOAT_SIZES[id];
  const margin = 8;
  const top = 56;
  const w = Math.max(240, Math.min(size.w, viewportW - margin * 2));
  const h = Math.max(200, Math.min(size.h, viewportH - top - margin * 2));
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
