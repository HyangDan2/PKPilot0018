/* Sigrún — shared types */

import type { SpcPanel } from './lib/spc';
import type { CapabilityResult } from './lib/capability';

export type ColType = 'numeric' | 'text' | 'date';

export interface Column {
  id: string;
  name: string;
  type: ColType;
  values: (number | string | null)[];
}

export interface Worksheet {
  id: string;
  name: string;
  columns: Column[];
}

export interface ChartMargins { top?: number; right?: number; bottom?: number; left?: number }

interface ChartBase {
  height?: number;
  title?: string;
}

export type ChartSpec =
  | (ChartBase & {
      kind: 'histogram';
      values: number[];
      bins?: number;
      normal?: boolean;
      lsl?: number | null;
      usl?: number | null;
      target?: number | null;
      xLabel?: string;
      yLabel?: string;
    })
  | (ChartBase & { kind: 'boxplot'; groups: { label: string; values: number[] }[]; yLabel?: string })
  | (ChartBase & {
      kind: 'scatter';
      points: { x: number; y: number; g?: string }[];
      fit?: { intercept: number; slope: number } | null;
      groups?: string[];
      xLabel?: string;
      yLabel?: string;
    })
  | (ChartBase & {
      kind: 'timeseries';
      values: number[];
      lsl?: number | null;
      usl?: number | null;
      target?: number | null;
      yLabel?: string;
      xLabel?: string;
    })
  | (ChartBase & {
      kind: 'normalprob';
      points: { x: number; y: number }[];
      fit: { intercept: number; slope: number };
      ci?: { x: number; lo: number; hi: number }[];
      xLabel?: string;
      yLabel?: string;
      ad?: number;
      p?: number;
    })
  | (ChartBase & { kind: 'control'; panel: SpcPanel; yLabel?: string; xLabel?: string })
  | (ChartBase & { kind: 'pareto'; items: { label: string; count: number }[]; threshold?: number })
  | (ChartBase & { kind: 'capability'; result: CapabilityResult; xLabel?: string })
  | (ChartBase & {
      kind: 'interval';
      groups: { label: string; mean: number; lo: number; hi: number; n?: number }[];
      yLabel?: string;
    });

export type TableAlign = ('l' | 'r' | 'c')[];

export type Block =
  | {
      type: 'table';
      title?: string;
      headers: string[];
      rows: (string | number)[][];
      align?: TableAlign;
      caption?: string;
      groupRow?: number[];
      alarmRow?: number[];
    }
  | { type: 'chart'; chart: ChartSpec; caption?: string }
  | { type: 'chartgrid'; charts: { chart: ChartSpec; title: string }[]; caption?: string }
  | { type: 'text'; lines: string[] };

export interface DialogSnapshot {
  analysisId: string;
  values: Record<string, unknown>;
}

export interface OutputDoc {
  id: string;
  titleKey: string;
  titleText?: string;
  subtitle?: string;
  createdAt: number;
  collapsed: boolean;
  blocks: Block[];
  dialog?: DialogSnapshot;
  sheetId?: string;
}

export type Theme = 'light' | 'dark';
export type Lang = 'en' | 'ko';

export interface Settings {
  theme: Theme;
  lang: Lang;
}

export interface ProjectFile {
  format: 'sigrun-project';
  version: 1;
  savedAt: string;
  app: string;
  worksheets: Worksheet[];
  activeSheetId: string;
  settings: Settings;
  outputs: OutputDoc[];
}

export interface ColumnPayload {
  id: string;
  name: string;
  type: ColType;
  values: (number | string | null)[];
}
