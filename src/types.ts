/* Sigrún — shared types */

import type { SpcPanel } from './lib/spc';
import type { CapabilityResult } from './lib/capability';
import type { ChartConfig } from './lib/chartConfig';
import type { RsmModelPayload } from './lib/doe';
import type { MarkerShape } from './lib/chartConfig';
import type { CustomChartStyle } from './lib/chartStyles';
import type { StoredModelDraft } from './lib/modelStore';

export type ColType = 'numeric' | 'text' | 'date';

export interface Column {
  id: string;
  name: string;
  type: ColType;
  values: (number | string | null)[];
  /** Optional note shown on the column header (Minitab's column description). */
  description?: string;
}

export interface Worksheet {
  id: string;
  name: string;
  columns: Column[];
  /** Highest C-number ever handed out on this sheet; keeps ids from being reused. */
  columnSeq?: number;
}

export interface ChartMargins { top?: number; right?: number; bottom?: number; left?: number }

/** A fitted mean-CI / prediction band, one point per x. */
export interface ChartBand {
  x: number;
  lo: number;
  hi: number;
}

interface ChartBase {
  height?: number;
  title?: string;
  subtitle?: string;
  /** Optional professional appearance / options; absent means legacy defaults. */
  config?: ChartConfig;
}

export type ChartSpec =
  | (ChartBase & {
      kind: 'histogram';
      values: number[];
      bins?: number;
      /** Optional explicit bin origin and width (histogram options). */
      binStart?: number;
      binWidth?: number;
      normal?: boolean;
      lsl?: number | null;
      usl?: number | null;
      target?: number | null;
      xLabel?: string;
      yLabel?: string;
      /** fitted density curves, already scaled to the frequency axis */
      curves?: { label?: string; points: { x: number; y: number }[]; color?: number; dash?: string }[];
    })
  | (ChartBase & {
      kind: 'line';
      series: { label: string; points: { x: number; y: number }[]; color?: number; dash?: string; markerShape?: MarkerShape; axis?: 'primary' | 'secondary'; showMarkers?: boolean; showLine?: boolean }[];
      xLabels?: string[];
      xLabel?: string;
      yLabel?: string;
      /** Secondary Y-axis title for series marked `axis: 'secondary'`. */
      y2Label?: string;
      refLines?: { y: number; label?: string }[];
      markers?: { x: number; y: number; label?: string }[];
    })
  | (ChartBase & {
      kind: 'bar';
      items: { label: string; value: number; color?: number; group?: string }[];
      yLabel?: string;
      xLabel?: string;
      refLine?: { y: number; label?: string };
      decimals?: number;
      /** Grouped series: each group draws its own bar inside every category. */
      groups?: { label: string; values: number[]; color?: number }[];
      /** Secondary Y-axis series (line overlay on a bar chart). */
      lines?: { label: string; points: { x: number; y: number }[]; color?: number }[];
      y2Label?: string;
    })
  | (ChartBase & {
      kind: 'contour';
      xs: number[];
      ys: number[];
      z: number[][];
      xLabel?: string;
      yLabel?: string;
      points?: { x: number; y: number; z?: number; label?: string; kind?: 'design' | 'stationary' | 'optimal' }[];
      levels?: number;
      /** Fitted RSM model carried with the plot so the UI can re-slice it. */
      rsmModel?: RsmModelPayload;
      /** Display range actually used, for the axis and the extrapolation badge. */
      xRange?: [number, number];
      yRange?: [number, number];
    })
  | (ChartBase & {
      kind: 'probplot';
      points: { x: number; y: number }[];
      fit: { intercept: number; slope: number };
      /** fitted curve when the distribution has no linearising scale (gamma) */
      curve?: { x: number; y: number }[];
      xLabel?: string;
      yLabel?: string;
      xTicks?: { v: number; label: string }[];
      yTicks?: { v: number; label: string }[];
      ci?: { x: number; lo: number; hi: number }[];
      note?: string;
    })
  | (ChartBase & {
      kind: 'boxplot';
      groups: { label: string; values: number[]; color?: number }[];
      yLabel?: string;
      xLabel?: string;
    })
  | (ChartBase & {
      kind: 'scatter';
      points: { x: number; y: number; g?: string }[];
      fit?: { intercept: number; slope: number } | null;
      groups?: string[];
      xLabel?: string;
      yLabel?: string;
      /** Several X-Y combinations drawn in one frame (overlaid layout). */
      series?: {
        label: string;
        points: { x: number; y: number }[];
        fit?: { intercept: number; slope: number } | null;
        markerShape?: MarkerShape;
        labels?: string[];
      }[];
      /** Fixed axis range so every panel of a grid can share one scale. */
      xDomain?: [number, number];
      yDomain?: [number, number];
      /** Statistics written inside the plot (Pearson r, R², regression equation). */
      notes?: string[];
      /** Draw a legend for the series or the By groups. */
      legend?: boolean;
      /** Mean confidence and individual prediction bands for the fitted line. */
      bands?: { mean?: ChartBand[]; individual?: ChartBand[] };
      /** Labels printed beside each point when the option is on. */
      pointLabels?: string[];
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
  | (ChartBase & {
      kind: 'control';
      panel: SpcPanel;
      yLabel?: string;
      xLabel?: string;
      /** Specification limits overlaid on a control chart when the option is on. */
      specLines?: { value: number; label?: string }[];
    })
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

/**
 * Everything needed to reproduce an analysis after the worksheet has changed:
 * the options, the referenced column data at run time, the sheet identity and
 * the engine version.
 */
export interface AnalysisMeta {
  engine: string;
  analysisId: string;
  values: Record<string, unknown>;
  sheetId: string;
  sheetName: string;
  ranAt: number;
  rowCount: number;
  columns: ColumnPayload[];
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
  meta?: AnalysisMeta;
  /** A fitted model this card can hand to the model store (WO-02). */
  model?: StoredModelDraft;
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
  /** User chart styles travel with the project when one was saved. */
  customChartStyles?: CustomChartStyle[];
  /** Stored fitted models travel with the project (WO-02). */
  models?: StoredModelFileEntry[];
}

/** A stored model as written into a project file (no runtime import needed). */
export type StoredModelFileEntry = Record<string, unknown>;

export interface ColumnPayload {
  id: string;
  name: string;
  type: ColType;
  values: (number | string | null)[];
}
