/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — workspace layouts (Stage 3)

   Three desktop arrangements, plus the phone/tablet tab layout that the
   stylesheet already owns:

     tri      [ Navigator ] [ Output ] [ Worksheet ]      ← default
     focus    [ Navigator ] [ Output ] [ Worksheet drawer ]
     classic  [ Navigator ] [ Output over Worksheet ]     ← the Phase 1 shell

   Kept free of React so widths, storage and the responsive fallbacks can be
   unit-tested without a browser.
   ───────────────────────────────────────────────────────────────────────── */

import { clampNav, clampOutput, findPreset, type LayoutPreset, type LayoutPresetId } from './layout';

export type WorkspaceLayout = 'tri' | 'focus' | 'classic';

/** What the app actually paints: the stored layout can fold back on a narrow screen. */
export type EffectiveLayout = WorkspaceLayout | 'mobile';

export interface WorkspaceState {
  layout: WorkspaceLayout;
  /** navigator width in px (tri & focus) */
  navW: number;
  /** output column width in px (tri) */
  outputW: number;
  /** output pane height in percent of the main column (classic) */
  outputH: number;
  /** worksheet drawer width in px (focus) */
  drawerW: number;
  /** focus mode: the worksheet drawer is slid in */
  drawerOpen: boolean;
}

export const WORKSPACE_KEY = 'sigrun.workspace.v1';

/** Each column keeps enough room for its own header and contents. */
export const MIN_OUTPUT_W = 320;
export const MIN_WORKSHEET_W = 340;
export const MIN_DRAWER_W = 320;
export const MAX_DRAWER_W = 960;

/** Width of the two vertical splitters in the three-panel arrangement. */
const TRIPLE_SPLITTERS = 10;

/** Below this width the stylesheet's tabbed phone/tablet shell takes over. */
export const MOBILE_MAX = 1024;

/** A three-panel desktop needs this much width; narrower desktops fold to classic. */
export const TRI_MIN = 1200;

export const WORKSPACE_LAYOUTS: { id: WorkspaceLayout; labelKey: string; hintKey: string }[] = [
  { id: 'tri', labelKey: 'ws.layout.tri', hintKey: 'ws.layout.tri.hint' },
  { id: 'focus', labelKey: 'ws.layout.focus', hintKey: 'ws.layout.focus.hint' },
  { id: 'classic', labelKey: 'ws.layout.classic', hintKey: 'ws.layout.classic.hint' },
];

export const DEFAULT_WORKSPACE: WorkspaceState = {
  layout: 'tri',
  navW: 254,
  outputW: 520,
  outputH: 52,
  drawerW: 460,
  drawerOpen: false,
};

/** How much of the space beside the navigator the output column takes in tri,
 *  so the four existing emphasis presets still mean something there. */
const PRESET_OUTPUT_SHARE: Record<LayoutPresetId, number> = {
  balanced: 0.46,
  sheet: 0.3,
  results: 0.58,
  focus: 0.5,
};

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max));
}

/** Largest output column that still leaves the worksheet its minimum width. */
export function maxOutputW(viewportW: number, navW: number): number {
  const available = Math.max(MIN_OUTPUT_W + MIN_WORKSHEET_W, viewportW - clampNav(navW) - TRIPLE_SPLITTERS);
  return Math.max(MIN_OUTPUT_W, available - MIN_WORKSHEET_W);
}

export function clampOutputW(width: number, viewportW: number, navW: number): number {
  return clampInt(width, MIN_OUTPUT_W, maxOutputW(viewportW, navW));
}

export function clampDrawerW(width: number, viewportW: number): number {
  const max = Math.max(MIN_DRAWER_W, Math.min(MAX_DRAWER_W, viewportW - 200));
  return clampInt(width, MIN_DRAWER_W, max);
}

/** The three column widths as they are painted, always summing to the viewport. */
export function triWidths(viewportW: number, navW: number, outputW: number): { nav: number; output: number; worksheet: number } {
  const nav = clampNav(navW);
  const output = clampOutputW(outputW, viewportW, nav);
  const worksheet = Math.max(MIN_WORKSHEET_W, viewportW - nav - TRIPLE_SPLITTERS - output);
  return { nav, output, worksheet };
}

export interface TriRects { nav: number; output: number; worksheet: number }

/** Width of the single splitter between two columns. */
export const SPLITTER_W = 5;

/** Apply one pointer drag on the navigator splitter, keeping every column legal. */
export function dragNav(viewportW: number, navW: number, outputW: number, dx: number): TriRects {
  const nav = clampNav(navW + dx);
  return triWidths(viewportW, nav, outputW);
}

/** Apply one pointer drag on the output/worksheet splitter. */
export function dragOutput(viewportW: number, navW: number, outputW: number, dx: number): TriRects {
  return triWidths(viewportW, navW, clampOutputW(outputW + dx, viewportW, navW));
}

/** What the shell should paint at this viewport width. */
export function resolveWorkspace(layout: WorkspaceLayout, viewportW: number): EffectiveLayout {
  const width = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : 1440;
  if (width < MOBILE_MAX) return 'mobile';
  if (layout === 'tri' && width < TRI_MIN) return 'classic';
  return layout;
}

/** Switch arrangement. Moving into focus opens the drawer, because that is
 *  where the worksheet just went; every width is remembered across switches. */
export function setWorkspaceLayout(state: WorkspaceState, layout: WorkspaceLayout, viewportW: number): WorkspaceState {
  const next: WorkspaceState = { ...state, layout };
  if (layout === 'focus' && state.layout !== 'focus') next.drawerOpen = true;
  if (layout === 'tri') next.outputW = clampOutputW(state.outputW, viewportW, state.navW);
  if (layout === 'focus') next.drawerW = clampDrawerW(state.drawerW, viewportW);
  return next;
}

/** The four "View ▸ Panel layout" presets, expressed in whichever shell is up. */
export function applyPresetToWorkspace(state: WorkspaceState, id: LayoutPresetId, viewportW: number): WorkspaceState {
  const preset: LayoutPreset = findPreset(id);
  const navW = clampNav(preset.navWidth);
  const usable = Math.max(MIN_OUTPUT_W + MIN_WORKSHEET_W, viewportW - navW - TRIPLE_SPLITTERS);
  const share = PRESET_OUTPUT_SHARE[preset.id] ?? PRESET_OUTPUT_SHARE.balanced;
  return {
    ...state,
    navW,
    outputH: clampOutput(preset.outputHeight),
    outputW: clampOutputW(usable * share, viewportW, navW),
  };
}

function isLayout(value: unknown): value is WorkspaceLayout {
  return value === 'tri' || value === 'focus' || value === 'classic';
}

/** Read a stored workspace, repairing anything missing or out of range. */
export function normalizeWorkspace(raw: unknown): WorkspaceState {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof WorkspaceState, unknown>>;
  const num = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return {
    layout: isLayout(source.layout) ? source.layout : DEFAULT_WORKSPACE.layout,
    navW: clampNav(num(source.navW, DEFAULT_WORKSPACE.navW)),
    outputW: clampOutputW(num(source.outputW, DEFAULT_WORKSPACE.outputW), 2400, DEFAULT_WORKSPACE.navW),
    outputH: clampOutput(num(source.outputH, DEFAULT_WORKSPACE.outputH)),
    drawerW: clampDrawerW(num(source.drawerW, DEFAULT_WORKSPACE.drawerW), 2400),
    drawerOpen: typeof source.drawerOpen === 'boolean' ? source.drawerOpen : DEFAULT_WORKSPACE.drawerOpen,
  };
}

/** Read + repair the saved workspace; a blocked or broken store keeps defaults. */
export function readWorkspace(storage?: Pick<Storage, 'getItem'> | null, key = WORKSPACE_KEY): WorkspaceState {
  try {
    const store = storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : storage;
    if (!store) return { ...DEFAULT_WORKSPACE };
    return normalizeWorkspace(JSON.parse(store.getItem(key) || 'null'));
  } catch {
    return { ...DEFAULT_WORKSPACE };
  }
}

export function serializeWorkspace(state: WorkspaceState): string {
  return JSON.stringify({
    layout: state.layout,
    navW: state.navW,
    outputW: state.outputW,
    outputH: state.outputH,
    drawerW: state.drawerW,
    drawerOpen: state.drawerOpen,
  });
}

/** Write the workspace; storage failures (private mode, quota) are not fatal. */
export function writeWorkspace(storage: Pick<Storage, 'setItem'> | null | undefined, state: WorkspaceState, key = WORKSPACE_KEY): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, serializeWorkspace(state));
    return true;
  } catch {
    return false;
  }
}
