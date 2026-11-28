/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — professional chart style system (WO-07)

   The app UI theme (light / dark) and a chart's own style are independent:
   a chart keeps its white engineering look on a dark app skin, exactly like a
   report figure pasted into a slide. Seven presets ship built in, and the user
   can store their own on top of any of them.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartAppearance, ChartStylePresetId, MarkerShape } from './chartConfig';
import { DEFAULT_CHART_PRESET } from './chartConfig';
import { STORAGE_KEY, namespacedKey } from '../config/storageNamespace';

export interface ResolvedChartStyle {
  id: string;
  label: string;
  fontFamily: string;
  titleFontFamily: string;
  monoFontFamily: string;
  chartBg: string;
  plotBg: string;
  axisColor: string;
  tickColor: string;
  labelColor: string;
  gridColor: string;
  guideColor: string;
  bandColor: string;
  alarmColor: string;
  surfaceColor: string;
  inkColor: string;
  series: string[];
  lineWidth: number;
  markerSize: number;
  axisWidth: number;
  tickLength: number;
  gridWidth: number;
  titleSize: number;
  fontSize: number;
  dashCycle: string[];
  markerCycle: MarkerShape[];
  legendBg: string;
  legendBorder: string;
  isDark: boolean;
}

const SANS = 'Inter, "Segoe UI", system-ui, -apple-system, "Malgun Gothic", sans-serif';
const SERIF = '"Source Serif 4", Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const CLASSIC_SERIES = [
  'var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)',
];

const BASE: Omit<ResolvedChartStyle, 'id' | 'label' | 'series'> = {
  fontFamily: SANS,
  titleFontFamily: SANS,
  monoFontFamily: MONO,
  chartBg: 'transparent',
  plotBg: 'transparent',
  axisColor: '#1f2937',
  tickColor: '#1f2937',
  labelColor: '#374151',
  gridColor: '#e5e7eb',
  guideColor: '#1f4e79',
  bandColor: 'rgba(31, 78, 121, 0.12)',
  alarmColor: '#c02626',
  surfaceColor: '#ffffff',
  inkColor: '#111827',
  lineWidth: 1.7,
  markerSize: 3.1,
  axisWidth: 1,
  tickLength: 4,
  gridWidth: 1,
  titleSize: 12.5,
  fontSize: 10.5,
  dashCycle: ['', '6 3', '2 3', '8 2 2 2'],
  markerCycle: ['circle', 'square', 'triangle', 'diamond', 'cross', 'circle'],
  legendBg: '#ffffff',
  legendBorder: '#e5e7eb',
  isDark: false,
};

/** The seven built-in presets. `DEFAULT_CHART_PRESET` keeps `engineering`. */
export const CHART_STYLE_PRESETS: Record<ChartStylePresetId, ResolvedChartStyle> = {
  'sigrun-classic': {
    ...BASE,
    id: 'sigrun-classic',
    label: 'Statelia Classic',
    fontFamily: SANS,
    chartBg: 'transparent',
    plotBg: 'transparent',
    axisColor: 'var(--chart-axis)',
    tickColor: 'var(--chart-axis)',
    labelColor: 'var(--chart-label)',
    gridColor: 'var(--chart-grid)',
    guideColor: 'var(--chart-guide)',
    bandColor: 'var(--chart-band)',
    alarmColor: 'var(--chart-alarm)',
    surfaceColor: 'var(--chart-surface)',
    inkColor: 'var(--text)',
    series: CLASSIC_SERIES,
    legendBg: 'var(--chart-surface)',
    legendBorder: 'var(--chart-grid)',
    lineWidth: 1.7,
    axisWidth: 1,
  },
  engineering: {
    ...BASE,
    id: 'engineering',
    label: 'Engineering',
    chartBg: '#ffffff',
    plotBg: '#ffffff',
    axisColor: '#1f2937',
    tickColor: '#1f2937',
    labelColor: '#374151',
    gridColor: '#e5e7eb',
    guideColor: '#1f4e79',
    bandColor: 'rgba(31, 78, 121, 0.12)',
    alarmColor: '#b91c1c',
    surfaceColor: '#ffffff',
    inkColor: '#111827',
    series: ['#1f4e79', '#2e75b6', '#c55a11', '#38761d', '#6b21a8', '#b45309'],
    legendBg: '#ffffff',
    legendBorder: '#e5e7eb',
  },
  scientific: {
    ...BASE,
    id: 'scientific',
    label: 'Scientific (publication)',
    fontFamily: SERIF,
    titleFontFamily: SERIF,
    chartBg: '#ffffff',
    plotBg: '#ffffff',
    axisColor: '#111827',
    tickColor: '#111827',
    labelColor: '#1f2937',
    gridColor: '#e8e8e8',
    guideColor: '#334155',
    bandColor: 'rgba(51, 65, 85, 0.10)',
    alarmColor: '#7f1d1d',
    surfaceColor: '#ffffff',
    inkColor: '#000000',
    series: ['#1a3a5c', '#8c3b2e', '#2f5d3a', '#6b4c7a', '#7a5c1e', '#3d5a6c'],
    lineWidth: 1.2,
    axisWidth: 1,
    tickLength: 3.5,
    gridWidth: 0.8,
    titleSize: 12,
    fontSize: 10,
    markerSize: 2.6,
    legendBorder: '#d4d4d4',
  },
  corporate: {
    ...BASE,
    id: 'corporate',
    label: 'Corporate (presentation)',
    chartBg: '#fdfcf8',
    plotBg: '#fdfcf8',
    axisColor: '#1f2937',
    tickColor: '#1f2937',
    labelColor: '#334155',
    gridColor: '#e7e2d8',
    guideColor: '#1d4ed8',
    bandColor: 'rgba(29, 78, 216, 0.10)',
    alarmColor: '#dc2626',
    surfaceColor: '#fdfcf8',
    inkColor: '#0f172a',
    series: ['#1d4ed8', '#0f766e', '#ea580c', '#7c3aed', '#be123c', '#0369a1'],
    lineWidth: 2.2,
    markerSize: 3.6,
    axisWidth: 1.4,
    titleSize: 14,
    fontSize: 11,
    legendBorder: '#ded8cb',
  },
  monochrome: {
    ...BASE,
    id: 'monochrome',
    label: 'Monochrome (B&W print)',
    chartBg: '#ffffff',
    plotBg: '#ffffff',
    axisColor: '#111111',
    tickColor: '#111111',
    labelColor: '#242424',
    gridColor: '#d9d9d9',
    guideColor: '#4b5563',
    bandColor: 'rgba(75, 85, 99, 0.12)',
    alarmColor: '#111111',
    surfaceColor: '#ffffff',
    inkColor: '#000000',
    // Greys alone are hard to tell apart in print: line dashes and marker
    // shapes carry the series identity as well.
    series: ['#111111', '#4b5563', '#6b7280', '#374151', '#9ca3af', '#1f2937'],
    dashCycle: ['', '7 3', '2 3', '10 2 2 2'],
    markerCycle: ['circle', 'square', 'triangle', 'diamond', 'cross', 'circle'],
    legendBorder: '#c7c7c7',
  },
  'high-contrast': {
    ...BASE,
    id: 'high-contrast',
    label: 'High contrast (accessible)',
    chartBg: '#ffffff',
    plotBg: '#ffffff',
    axisColor: '#000000',
    tickColor: '#000000',
    labelColor: '#000000',
    gridColor: '#d4d4d4',
    guideColor: '#000000',
    bandColor: 'rgba(0, 0, 0, 0.10)',
    alarmColor: '#000000',
    surfaceColor: '#ffffff',
    inkColor: '#000000',
    // Okabe–Ito: safe for the common colour-vision deficiencies.
    series: ['#0072b2', '#e69f00', '#009e73', '#d55e00', '#cc79a7', '#56b4e9'],
    lineWidth: 2.2,
    markerSize: 4,
    axisWidth: 1.6,
    gridWidth: 1.2,
    dashCycle: ['', '7 3', '2 3', '9 2 2 2'],
    markerCycle: ['circle', 'square', 'triangle', 'diamond', 'cross', 'circle'],
    legendBorder: '#000000',
  },
  dark: {
    ...BASE,
    id: 'dark',
    label: 'Dark presentation',
    chartBg: '#0f172a',
    plotBg: '#1e293b',
    axisColor: '#e2e8f0',
    tickColor: '#e2e8f0',
    labelColor: '#cbd5e1',
    gridColor: 'rgba(148, 163, 184, 0.22)',
    guideColor: '#93c5fd',
    bandColor: 'rgba(147, 197, 253, 0.16)',
    alarmColor: '#fb7185',
    surfaceColor: '#1e293b',
    inkColor: '#f8fafc',
    series: ['#7dd3fc', '#86efac', '#fcd34d', '#f9a8d4', '#c4b5fd', '#fdba74'],
    lineWidth: 1.8,
    markerSize: 3.3,
    axisWidth: 1.2,
    legendBg: 'rgba(30, 41, 59, 0.92)',
    legendBorder: 'rgba(148, 163, 184, 0.35)',
    isDark: true,
  },
};

export const CHART_STYLE_IDS = Object.keys(CHART_STYLE_PRESETS) as ChartStylePresetId[];

/** A user style: a name plus any fields layered over one built-in preset. */
export interface CustomChartStyle {
  id: string;
  name: string;
  base: ChartStylePresetId;
  overrides: Partial<Omit<ResolvedChartStyle, 'id' | 'label'>>;
}

export const CUSTOM_STYLE_STORAGE_KEY = namespacedKey(STORAGE_KEY.chartStyles);

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadCustomStyles(): CustomChartStyle[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(CUSTOM_STYLE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CustomChartStyle => {
      if (!entry || typeof entry !== 'object') return false;
      const style = entry as Partial<CustomChartStyle>;
      return typeof style.id === 'string' && typeof style.name === 'string' && typeof style.base === 'string'
        && (CHART_STYLE_IDS as string[]).includes(style.base);
    });
  } catch {
    return [];
  }
}

/** Save (or replace) a custom style; returns the stored list. */
export function saveCustomStyle(style: CustomChartStyle): CustomChartStyle[] {
  const list = loadCustomStyles().filter((entry) => entry.id !== style.id);
  list.push(style);
  const store = storage();
  if (store) {
    try {
      store.setItem(CUSTOM_STYLE_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // A full or disabled store must not break chart rendering.
    }
  }
  return list;
}

/** Put a whole list back, as a practice session's restore needs (WO-TQA-02). */
export function writeCustomStyles(list: CustomChartStyle[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(CUSTOM_STYLE_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* a blocked store leaves the styles as they were */
  }
}

export function deleteCustomStyle(id: string): CustomChartStyle[] {  const list = loadCustomStyles().filter((entry) => entry.id !== id);
  const store = storage();
  if (store) {
    try {
      store.setItem(CUSTOM_STYLE_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  }
  return list;
}

/** Resolve a preset id (built-in or `custom:<id>`) into concrete colours. */
export function resolveChartStyle(preset?: string, appearance?: Partial<ChartAppearance>): ResolvedChartStyle {
  let style: ResolvedChartStyle;
  if (preset && preset.startsWith('custom:')) {
    const custom = loadCustomStyles().find((entry) => entry.id === preset.slice('custom:'.length));
    const base = CHART_STYLE_PRESETS[custom?.base ?? DEFAULT_CHART_PRESET];
    style = { ...base, ...(custom?.overrides ?? {}), id: preset, label: custom?.name ?? 'Custom' };
  } else {
    const known = (preset && preset in CHART_STYLE_PRESETS ? preset : DEFAULT_CHART_PRESET) as ChartStylePresetId;
    style = { ...CHART_STYLE_PRESETS[known] };
  }
  // Explicit appearance colours win over the preset (a user override).
  const a = appearance ?? {};
  const pick = (value: string | undefined, fallback: string) => (value && value.trim() ? value : fallback);
  return {
    ...style,
    fontFamily: pick(a.fontFamily, style.fontFamily),
    titleFontFamily: pick(a.fontFamily, style.titleFontFamily),
    chartBg: pick(a.chartBg, style.chartBg),
    plotBg: pick(a.plotBg, style.plotBg),
    axisColor: pick(a.axisColor, style.axisColor),
    tickColor: pick(a.tickColor, style.tickColor),
    labelColor: pick(a.labelColor, style.labelColor),
    gridColor: pick(a.gridColor, style.gridColor),
    fontSize: Number.isFinite(a.fontSize) ? (a.fontSize as number) : style.fontSize,
  };
}

/** Convenience: the palette colour of series `index` in a style. */
export function seriesColor(style: ResolvedChartStyle, index: number): string {
  if (!style.series.length) return style.inkColor;
  return style.series[((index % style.series.length) + style.series.length) % style.series.length];
}

/** Dash for series `index` when the style wants shapes/dashes to differ. */
export function seriesDash(style: ResolvedChartStyle, index: number): string {
  if (!style.dashCycle.length) return '';
  return style.dashCycle[index % style.dashCycle.length] ?? '';
}

export function seriesMarker(style: ResolvedChartStyle, index: number): MarkerShape {
  if (!style.markerCycle.length) return 'circle';
  return style.markerCycle[index % style.markerCycle.length] ?? 'circle';
}

/**
 * Replace every `var(--x)` in an SVG with a concrete value.
 *
 * In a browser the computed custom property is used, so a classic chart keeps
 * following the live app theme. Outside a DOM (SSR, tests, export pipeline) the
 * classic tokens fall back to their light-theme values, which guarantees that
 * an exported file never contains an unresolved variable.
 */
const CLASSIC_FALLBACK: Record<string, string> = {
  '--chart-1': '#8b6ce8',
  '--chart-2': '#10b981',
  '--chart-3': '#3b82f6',
  '--chart-4': '#f59e0b',
  '--chart-5': '#f43f5e',
  '--chart-6': '#14b8a6',
  '--chart-grid': '#efebf7',
  '--chart-axis': '#cfc7e2',
  '--chart-label': '#7c7690',
  '--chart-guide': '#8b6ce8',
  '--chart-band': 'rgba(139, 108, 232, 0.1)',
  '--chart-alarm': '#f43f5e',
  '--chart-surface': '#ffffff',
  '--text': '#1f2437',
  '--border': '#e4e0ef',
};

export function hasCssVariables(svg: string): boolean {
  return /var\(--/.test(svg);
}

export function resolveStandaloneSvg(svg: string, stylePreset?: string): string {
  // Only a Classic document carries `var(--…)`; a mixed composition must use
  // the live theme (or the Classic fallback) for those, not the first chart's
  // palette. An explicit preset still wins when the caller asks for one.
  const style = stylePreset ? resolveChartStyle(stylePreset) : null;
  let out = svg;
  // A styled (non-classic) chart already carries literal colours; this also
  // covers values an old project file stored as variables.
  out = out.replace(/var\((--[a-z0-9-]+)\)/gi, (_match, name: string) => {
    const fromPreset = style ? cssValueFor(style, name) : null;
    if (fromPreset) return fromPreset;
    if (typeof document !== 'undefined' && document?.documentElement) {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (value) return value;
    }
    return CLASSIC_FALLBACK[name] ?? '#6b7280';
  });
  return out;
}

function cssValueFor(style: ResolvedChartStyle, name: string): string | null {
  const map: Record<string, string> = {
    '--chart-1': style.series[0],
    '--chart-2': style.series[1],
    '--chart-3': style.series[2],
    '--chart-4': style.series[3],
    '--chart-5': style.series[4],
    '--chart-6': style.series[5],
    '--chart-grid': style.gridColor,
    '--chart-axis': style.axisColor,
    '--chart-label': style.labelColor,
    '--chart-guide': style.guideColor,
    '--chart-band': style.bandColor,
    '--chart-alarm': style.alarmColor,
    '--chart-surface': style.surfaceColor,
    '--text': style.inkColor,
  };
  const value = map[name];
  // A classic chart stores "var(--chart-1)" in its palette: returning that
  // would leave the export unresolved, so fall through to the literal token.
  return value && !/var\(--/.test(value) ? value : null;
}
