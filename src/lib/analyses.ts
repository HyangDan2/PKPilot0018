/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — analysis registry
   Each entry declares its dialog slots (Minitab style) and a pure run
   function that turns worksheet columns into output blocks.
   ───────────────────────────────────────────────────────────────────────── */

import type { Block, ChartSpec, Column, Lang, Worksheet } from '../types';
import { capability } from './capability';
import { evaluateFormula } from './calc';
import { histogramBins } from './charts';
import { fCdf, normalInv, normalPdf, tInv } from './dist';
import { analyzeFactorial, analyzeRsm, boxBehnkenDesign, ccdDesign, contourGrid, designWorksheet, factorialDesign } from './doe';
import { fmt, fmtInt, fmtP } from './format';
import { gageRR, type GrrRow } from './gagerr';
import { cellMeans, fitGlm, type ModelFactor, type ModelTerm } from './glm';
import { t } from './i18n';
import { nonnormalCapability, type NonnormalDist } from './nonnormal';
import { powerCurve, solvePower, type PowerMethod, type PowerSpec } from './power';
import { generateRandom } from './random';
import { fitLognormalReliability, fitWeibull, type LognormalReliability, type WeibullInput } from './reliability';
import { capabilitySixpack } from './sixpack';
import {
  cChart,
  imrChart,
  npChart,
  pChart,
  uChart,
  xbarRCharts,
  xbarSCharts,
  XBAR_CONSTANTS,
  SpcValidationError,
  type SpcIssue,
} from './spc';
import {
  adNormality,
  anovaOneWay,
  clean,
  mean,
  normalScores,
  pairedT,
  regress,
  stdev,
  summarize,
  tTest1,
  tTest2,
  tukeyHSD,
  type Alt,
} from './stats';

export type SlotKind = 'vars' | 'col' | 'num' | 'text' | 'select' | 'check';
export type SlotGroup = 'main' | 'options' | 'graphs';

export interface SlotDef {
  key: string;
  label: string;
  kind: SlotKind;
  group?: SlotGroup;
  required?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean | string[] | null;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface RunContext {
  lang: Lang;
  sheet: Worksheet;
  values: Record<string, unknown>;
}

export interface RunResult {
  blocks: Block[];
  subtitle?: string;
  titleText?: string;
  sheetPatch?: Worksheet;
  newSheet?: Worksheet;
  toastKey?: string;
  toastVars?: Record<string, string | number>;
}

export interface AnalysisDef {
  id: string;
  titleKey: string;
  slots: SlotDef[];
  run: (ctx: RunContext) => RunResult;
}

/* ── helpers ──────────────────────────────────────────────────────────── */

export function findColumn(sheet: Worksheet, ref: unknown): Column | undefined {
  if (typeof ref !== 'string') return undefined;
  return sheet.columns.find((c) => c.id.toLowerCase() === ref.toLowerCase());
}

function numValues(sheet: Worksheet, ref: unknown): (number | null)[] {
  const col = findColumn(sheet, ref);
  return col ? col.values.map((v) => (typeof v === 'number' ? v : null)) : [];
}

function textOf(col: Column, row: number): string {
  const v = col.values[row];
  return v === null || v === undefined || v === '' ? '(empty)' : String(v);
}

function rowCount(sheet: Worksheet): number {
  return Math.max(0, ...sheet.columns.map((c) => c.values.length));
}

interface GroupRow { keys: string[]; rows: number[] }

function buildGroups(sheet: Worksheet, byRefs: string[]): GroupRow[] {
  const rows = rowCount(sheet);
  const byCols = byRefs.map((ref) => findColumn(sheet, ref)).filter((c): c is Column => Boolean(c));
  if (!byCols.length) return [{ keys: [], rows: Array.from({ length: rows }, (_, i) => i) }];
  const map = new Map<string, GroupRow>();
  for (let r = 0; r < rows; r += 1) {
    const keys = byCols.map((c) => textOf(c, r));
    const key = keys.join('\u0001');
    const existing = map.get(key);
    if (existing) existing.rows.push(r);
    else map.set(key, { keys, rows: [r] });
  }
  return [...map.values()];
}

function valuesAt(col: Column | undefined, rows: number[]): (number | null)[] {
  if (!col) return [];
  return rows.map((r) => (typeof col.values[r] === 'number' ? (col.values[r] as number) : null));
}

function num(value: unknown, fallback: number): number {
  const v = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return isFinite(v) ? v : fallback;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function alt(value: unknown): Alt {
  return value === 'less' || value === 'greater' ? value : 'two-sided';
}

function conf(value: unknown): number {
  const v = num(value, 95);
  return Math.min(0.9999, Math.max(0.5, v > 1 ? v / 100 : v));
}

function labelOf(sheet: Worksheet, ref: unknown): string {
  const col = findColumn(sheet, ref);
  return col ? col.name || col.id : '—';
}

function altSymbol(a: Alt): string {
  return a === 'less' ? '<' : a === 'greater' ? '>' : '≠';
}

function tableTitle(key: string): string {
  return `@${key}`;
}

/* ── descriptive statistics ───────────────────────────────────────────── */

function runDescriptive(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const variableRefs = (values.variables as string[]) ?? [];
  const byRefs = (values.by as string[]) ?? [];
  const byCols = byRefs.map((ref) => findColumn(sheet, ref)).filter((c): c is Column => Boolean(c));
  const groups = buildGroups(sheet, byRefs);
  const headers = [
    '@th.variable',
    ...byCols.map((c) => c.name || c.id),
    '@th.n', '@th.nstar', '@th.mean', '@th.seMean', '@th.stdev', '@th.variance', '@th.coefVar',
    '@th.min', '@th.q1', '@th.median', '@th.q3', '@th.max', '@th.iqr', '@th.skew', '@th.kurt',
  ];
  const rows: (string | number)[][] = [];
  variableRefs.forEach((ref) => {
    const col = findColumn(sheet, ref);
    if (!col) return;
    groups.forEach((group) => {
      const summary = summarize(valuesAt(col, group.rows));
      rows.push([
        col.name || col.id,
        ...group.keys,
        fmtInt(summary.n),
        fmtInt(summary.nStar),
        fmt(summary.mean),
        fmt(summary.seMean),
        fmt(summary.stdev),
        fmt(summary.variance),
        fmt(summary.coefVar),
        fmt(summary.min),
        fmt(summary.q1),
        fmt(summary.median),
        fmt(summary.q3),
        fmt(summary.max),
        fmt(summary.iqr),
        fmt(summary.skewness),
        fmt(summary.kurtosis),
      ]);
    });
  });
  const vars = variableRefs.map((ref) => labelOf(sheet, ref)).join(', ');
  const by = byCols.map((c) => c.name || c.id).join(', ');
  return {
    subtitle: by ? t(lang, 'res.descriptiveBy', { vars, by }) : t(lang, 'res.descriptive', { vars }),
    blocks: [{ type: 'table', headers, rows, align: ['l', ...byCols.map(() => 'l' as const), ...Array(15).fill('r')] }],
  };
}

/* ── normality ────────────────────────────────────────────────────────── */

function runNormality(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const ref = values.variable;
  const col = findColumn(sheet, ref);
  const data = numValues(sheet, ref);
  const ad = adNormality(data);
  if (ad.n < 7) throw new Error('res.insufficient');
  if (!(ad.sd > 0) || !isFinite(ad.sd)) throw new Error('res.zeroVariance');
  const zs = ad.sorted.map((_, i) => normalInvLocal((i + 1 - 0.375) / (ad.n + 0.25)));
  const step = (Math.max(...ad.sorted) - Math.min(...ad.sorted)) / 40 || 1;
  const ci: { x: number; lo: number; hi: number }[] = [];
  const tCrit = 1.96;
  for (let i = 0; i <= 40; i += 1) {
    const x = Math.min(...ad.sorted) - step + i * step;
    const z = (x - ad.mean) / ad.sd;
    const margin = tCrit * Math.sqrt(1 / ad.n + (z * z) / (2 * (ad.n - 1)));
    ci.push({ x, lo: z - margin, hi: z + margin });
  }
  const chart: ChartSpec = {
    kind: 'normalprob',
    points: ad.sorted.map((x, i) => ({ x, y: zs[i] })),
    fit: { intercept: -ad.mean / ad.sd, slope: 1 / ad.sd },
    ci,
    xLabel: col ? col.name || col.id : 'Data',
    ad: ad.adAdj,
    p: ad.p,
  };
  const rows: (string | number)[][] = [
    [fmtInt(ad.n), fmt(ad.mean), fmt(ad.sd), fmt(ad.ad), fmt(ad.adAdj), fmtP(ad.p)],
  ];
  return {
    subtitle: col ? col.name || col.id : '',
    blocks: [
      { type: 'table', title: tableTitle('res.adTitle'), headers: ['@th.n', '@th.mean', '@th.stdev', '@th.ad', 'AD*', '@th.p'], rows, align: ['r', 'r', 'r', 'r', 'r', 'r'] },
      { type: 'chart', chart, caption: '@chart.normalprob' },
      { type: 'text', lines: [ad.p >= 0.05 ? t(lang, 'res.normal') : t(lang, 'res.notNormal')] },
    ],
  };
}

function normalInvLocal(p: number): number {
  // local copy keeps analyses free of a distribution import cycle
  let lo = -6;
  let hi = 6;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (normalCdfLocal(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function normalCdfLocal(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/* ── t tests ──────────────────────────────────────────────────────────── */

function runT1(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const ref = values.variable;
  const col = findColumn(sheet, ref);
  const data = numValues(sheet, ref);
  if (clean(data).length < 2) throw new Error('res.insufficient');
  if (!(stdev(clean(data)) > 0)) throw new Error('res.zeroVariance');
  const mu = num(values.hypMean, 0);
  const c = conf(values.confidence);
  const a = alt(values.alternative);
  const result = tTest1(data, mu, c, a);
  const level = `${(c * 100).toFixed(1)}%`;
  const rows: (string | number)[][] = [[
    fmtInt(result.n), fmt(result.mean), fmt(result.stdev), fmt(result.se),
    `${fmt(result.ci[0])}  ${fmt(result.ci[1])}`, fmt(result.difference), fmt(result.t), fmtP(result.p),
  ]];
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        `${t(lang, 'res.methodOne', { a: col?.name ?? 'X' })}`,
        `${t(lang, 'res.hypOne', { d: fmt(mu), alt: altSymbol(a) })}`,
        `${t(lang, 'res.method')}: μ = ${fmt(mu)}, ${level} confidence`,
      ],
    },
    {
      type: 'table',
      headers: ['@th.n', '@th.mean', '@th.stdev', '@th.seMean', `@th.ci ${level}`, '@th.diff', '@th.t', '@th.p'],
      rows,
      align: ['r', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
    },
    { type: 'text', lines: [result.p < 1 - c ? t(lang, 'res.reject') : t(lang, 'res.fail')] },
  ];
  if (bool(values.chart, true)) {
    blocks.push({
      type: 'chart',
      chart: { kind: 'histogram', values: clean(data), normal: true, xLabel: col?.name ?? 'Data', title: col?.name },
    });
  }
  return { subtitle: col?.name ?? '', blocks };
}

function runT2(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const refA = values.sample1;
  const refB = values.sample2;
  const colA = findColumn(sheet, refA);
  const colB = findColumn(sheet, refB);
  const a = numValues(sheet, refA);
  const b = numValues(sheet, refB);
  if (clean(a).length < 2 || clean(b).length < 2) throw new Error('res.insufficient');
  if (!(stdev(clean(a)) > 0) || !(stdev(clean(b)) > 0)) throw new Error('res.zeroVariance');
  const c = conf(values.confidence);
  const alpha = alt(values.alternative);
  const welch = bool(values.welch, true);
  const result = tTest2(a, b, { welch, conf: c, alt: alpha });
  const level = `${(c * 100).toFixed(1)}%`;
  const sampleRows: (string | number)[][] = [
    [colA?.name ?? 'A', fmtInt(result.n), fmt(result.mean), fmt(result.stdev), fmt(result.stdev ? result.stdev / Math.sqrt(result.n) : NaN)],
    [colB?.name ?? 'B', fmtInt(result.nB ?? 0), fmt(result.meanB), fmt(result.stdevB), fmt(result.stdevB ? result.stdevB / Math.sqrt(result.nB ?? 1) : NaN)],
  ];
  const diffRow: (string | number)[][] = [[
    fmt(result.difference), fmt(result.se), `${fmt(result.ci[0])}  ${fmt(result.ci[1])}`, fmt(result.df), fmt(result.t), fmtP(result.p),
  ]];
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        t(lang, 'res.methodTwo', { a: colA?.name ?? 'A', b: colB?.name ?? 'B' }),
        t(lang, 'res.hypTwo', { d: '0', alt: altSymbol(alpha) }),
        `${t(lang, 'res.method')}: ${welch ? t(lang, 'opt.welch') : t(lang, 'opt.eqVar')}, ${level} confidence`,
      ],
    },
    { type: 'table', headers: ['@th.variable', '@th.n', '@th.mean', '@th.stdev', '@th.seMean'], rows: sampleRows, align: ['l', 'r', 'r', 'r', 'r'] },
    { type: 'table', headers: ['@th.diff', '@th.seCoef', `@th.ci ${level}`, '@th.df', '@th.t', '@th.p'], rows: diffRow, align: ['r', 'r', 'r', 'r', 'r', 'r'] },
  ];
  if (result.varianceTest) {
    blocks.push({
      type: 'table',
      title: tableTitle('res.equalVarTest'),
      headers: ['@th.ratio', '@th.df', '@th.p'],
      rows: [[fmt(result.varianceTest.f), `${result.varianceTest.df1}, ${result.varianceTest.df2}`, fmtP(result.varianceTest.p)]],
      align: ['r', 'r', 'r'],
    });
  }
  blocks.push({ type: 'text', lines: [result.p < 1 - c ? t(lang, 'res.reject') : t(lang, 'res.fail')] });
  if (bool(values.chart, true)) {
    blocks.push({
      type: 'chart',
      chart: {
        kind: 'boxplot',
        groups: [
          { label: colA?.name ?? 'A', values: clean(a) },
          { label: colB?.name ?? 'B', values: clean(b) },
        ],
        yLabel: colA?.name ?? 'Value',
      },
    });
  }
  return { subtitle: `${colA?.name ?? ''} vs ${colB?.name ?? ''}`, blocks };
}

function runPaired(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const colA = findColumn(sheet, values.first);
  const colB = findColumn(sheet, values.second);
  const a = numValues(sheet, values.first);
  const b = numValues(sheet, values.second);
  if (clean(a).length < 2) throw new Error('res.insufficient');
  const c = conf(values.confidence);
  const alpha = alt(values.alternative);
  const testDiff = num(values.testDiff, 0);
  const result = pairedT(a, b, testDiff, c, alpha);
  const level = `${(c * 100).toFixed(1)}%`;
  // Paired rows only: a row missing either side is dropped as a pair.
  const pairedA: number[] = [];
  const pairedB: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) {
      pairedA.push(x);
      pairedB.push(y);
    }
  }
  if (result.n < 2) throw new Error('res.insufficientPairs');
  // Zero variance is refused only for the raw numbers it cannot produce: the
  // engine reports t and p as NaN (undefined) and the output states why, so a
  // constant-difference sample no longer poses as a significant result.
  const diffs = pairedA.map((x, i) => x - pairedB[i]);
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        `${t(lang, 'res.meanDifference')}: ${colA?.name ?? 'A'} − ${colB?.name ?? 'B'} = ${fmt(result.difference)}`,
        `${t(lang, 'res.testOfMu')}: μ_d = ${fmt(testDiff)} · ${t(lang, 'res.pairedMethod', { d: fmt(testDiff), alt: altSymbol(alpha) })}`,
        ...(!Number.isFinite(result.se) || result.se === 0 ? [t(lang, 'res.constantTest')] : []),
      ],
    },
    {
      type: 'table',
      headers: ['@th.variable', '@th.n', '@th.mean', '@th.stdev'],
      rows: [
        [colA?.name ?? 'A', fmtInt(result.n), fmt(result.mean), fmt(stdev(pairedA))],
        [colB?.name ?? 'B', fmtInt(result.n), fmt(result.meanB ?? NaN), fmt(stdev(pairedB))],
      ],
      align: ['l', 'r', 'r', 'r'],
      caption: '@res.pairedNote',
    },
    {
      type: 'table',
      headers: ['@th.n', `@th.meanDiff`, '@th.stdev', '@th.seMean', `@th.ci ${level}`, '@th.t', '@th.p'],
      rows: [[fmtInt(result.n), fmt(result.difference), fmt(result.stdev), fmt(result.se), `${fmt(result.ci[0])}  ${fmt(result.ci[1])}`, fmt(result.t), fmtP(result.p)]],
      align: ['r', 'r', 'r', 'r', 'r', 'r', 'r'],
      caption: t(lang, 'res.pairedCiNote', { d: fmt(testDiff) }),
    },
    { type: 'text', lines: [result.p < 1 - c ? t(lang, 'res.reject') : t(lang, 'res.fail')] },
  ];
  if (bool(values.chart, true) && diffs.length) {
    blocks.push({ type: 'chart', chart: { kind: 'histogram', values: diffs, normal: true, xLabel: `${colA?.name ?? 'A'} − ${colB?.name ?? 'B'}` } });
  }
  return { subtitle: `${colA?.name ?? ''} − ${colB?.name ?? ''}`, blocks };
}

/* ── ANOVA + Tukey ────────────────────────────────────────────────────── */

function runAnova(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const response = findColumn(sheet, values.response);
  const factor = findColumn(sheet, values.factor);
  if (!response || !factor) throw new Error('res.insufficient');
  const groupsMap = new Map<string, number[]>();
  const rows = rowCount(sheet);
  for (let r = 0; r < rows; r += 1) {
    const v = response.values[r];
    if (typeof v !== 'number') continue;
    const key = textOf(factor, r);
    const list = groupsMap.get(key) ?? [];
    list.push(v);
    groupsMap.set(key, list);
  }
  const groups = [...groupsMap.entries()].map(([label, values2]) => ({ label, values: values2 })).filter((g) => g.values.length > 0);
  if (groups.length < 2) throw new Error('res.insufficient');
  if (groups.some((g) => g.values.length < 2)) throw new Error('res.groupTooSmall');
  const table = anovaOneWay(groups);
  if (!(table.dfWithin >= 1) || !isFinite(table.msWithin)) throw new Error('res.groupTooSmall');
  const c = conf(values.confidence);
  const tukey = tukeyHSD(table, c);
  const level = `${(c * 100).toFixed(1)}%`;
  const tCrit = tQuantileLocal(1 - (1 - c) / 2, table.dfWithin);
  const meansRows: (string | number)[][] = groups
    .slice()
    .sort((x, y) => mean(y.values) - mean(x.values))
    .map((g) => {
      const m = mean(g.values);
      const half = tCrit * Math.sqrt(table.msWithin / g.values.length);
      return [g.label, fmtInt(g.values.length), fmt(m), fmt(stdev(g.values)), `${fmt(m - half)}  ${fmt(m + half)}`] as (string | number)[];
    });
  const anovaRows: (string | number)[][] = [];
  anovaRows.push(['@th.variable', fmtInt(table.dfBetween), fmt(table.ssBetween), fmt(table.msBetween), fmt(table.f), fmtP(table.p)]);
  anovaRows.push(['@th.error', fmtInt(table.dfWithin), fmt(table.ssWithin), fmt(table.msWithin), '', '']);
  anovaRows.push(['@th.total', fmtInt(table.dfBetween + table.dfWithin), fmt(table.ssBetween + table.ssWithin), '', '', '']);
  const pairRows: (string | number)[][] = tukey.pairs.map((p) => [
    `${p.a} - ${p.b}`,
    fmt(p.diff),
    fmt(p.se),
    `${fmt(p.ciLow)}  ${fmt(p.ciHigh)}`,
    fmtP(p.p),
    p.significant ? t(lang, 'yes') : t(lang, 'no'),
  ]);  const letterRows: (string | number)[][] = tukey.letters.map((l) => [l.label, fmtInt(groups.find((g) => g.label === l.label)?.values.length ?? 0), fmt(l.mean), l.letter]);
  const blocks: Block[] = [
    {
      type: 'table',
      title: tableTitle('res.anovaTable'),
      headers: ['@th.source', '@th.df', '@th.ss', '@th.ms', '@th.f', '@th.p'],
      rows: anovaRows,
      align: ['l', 'r', 'r', 'r', 'r', 'r'],
    },
    {
      type: 'table',
      title: tableTitle('res.modelSummary'),
      headers: ['@th.variable', '@th.n', '@th.mean', '@th.stdev', `@th.ci ${level}`],
      rows: meansRows,
      align: ['l', 'r', 'r', 'r', 'r'],
    },
    {
      type: 'table',
      title: t(lang, 'res.tukeyTitleLevel', { level }),
      headers: ['@th.group', '@th.diff', '@th.seCoef', `@th.ci ${level}`, '@th.p', '@th.value'],
      rows: pairRows,
      align: ['l', 'r', 'r', 'r', 'r', 'c'],
    },
    {
      type: 'table',
      title: t(lang, 'res.groupingLevel', { level }),
      headers: ['@th.level', '@th.n', '@th.mean', '@th.group'],
      rows: letterRows,
      align: ['l', 'r', 'r', 'c'],
      caption: t(lang, 'res.tukeyNoteLevel', { level }),
    },
    { type: 'text', lines: [table.p < 1 - c ? t(lang, 'res.anovaSig', { p: fmtP(table.p) }) : t(lang, 'res.anovaNotSig', { p: fmtP(table.p) })] },
    {
      type: 'chartgrid',
      charts: [
        {
          title: '@chart.interval',
          chart: {
            kind: 'interval',
            groups: groups.map((g) => {
              const m = mean(g.values);
              const half = tCrit * Math.sqrt(table.msWithin / g.values.length);
              return { label: g.label, mean: m, lo: m - half, hi: m + half, n: g.values.length };
            }),
            yLabel: response.name || response.id,
          },
        },
        { title: '@chart.boxplot', chart: { kind: 'boxplot', groups, yLabel: response.name || response.id } },
      ],
    },
  ];
  return { subtitle: `${response.name} vs ${factor.name}`, blocks };
}

function tQuantileLocal(p: number, df: number): number {
  let lo = -40;
  let hi = 40;
  for (let i = 0; i < 120; i += 1) {
    const mid = (lo + hi) / 2;
    if (tCdfLocal(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function tCdfLocal(tValue: number, df: number): number {
  const x = df / (df + tValue * tValue);
  const p = 0.5 * betaLocal(df / 2, 0.5, x);
  return tValue >= 0 ? 1 - p : p;
}

function betaLocal(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGammaLocal(a + b) - logGammaLocal(a) - logGammaLocal(b);
  const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * cfLocal(a, b, x)) / a;
  return 1 - (front * cfLocal(b, a, 1 - x)) / b;
}

function cfLocal(a: number, b: number, x: number): number {
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-13) break;
  }
  return h;
}

function logGammaLocal(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGammaLocal(1 - x);
  const z = x - 1;
  let a = c[0];
  const tValue = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(tValue) - tValue + Math.log(a);
}

/* ── regression ───────────────────────────────────────────────────────── */

function runRegression(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const response = findColumn(sheet, values.response);
  const predictorRefs = (values.predictors as string[]) ?? [];
  const predictors = predictorRefs
    .map((ref) => findColumn(sheet, ref))
    .filter((c): c is Column => Boolean(c))
    .map((c) => ({ name: c.name || c.id, values: c.values.map((v) => (typeof v === 'number' ? v : null)) }));
  if (!response) throw new Error('res.insufficient');
  if (!predictors.length) throw new Error('dlg.required');
  let result;
  try {
    result = regress(
      response.values.map((v) => (typeof v === 'number' ? v : null)),
      predictors,
      response.name || response.id,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'res.constantPredictor' || code === 'singular-matrix' || code === 'not-enough-data') throw new Error('res.singular');
    throw error;
  }
  const modelRows: (string | number)[][] = [
    ['S', fmt(result.s)],
    ['R²', `${(result.r2 * 100).toFixed(2)}%`],
    ['R²(adj)', `${(result.r2adj * 100).toFixed(2)}%`],
    ['R²(pred)', `${(result.r2pred * 100).toFixed(2)}%`],
    ['N', fmtInt(result.n)],
  ];
  const coefRows = result.coefficients.map((c) => [c.term, fmt(c.coef), fmt(c.se), fmt(c.t), fmtP(c.p), Number.isFinite(c.vif) ? fmt(c.vif, 2) : '—']);
  const anovaRows: (string | number)[][] = [
    ['@th.regression', fmtInt(result.anova.dfReg), fmt(result.anova.ssReg), fmt(result.anova.msReg), fmt(result.anova.f), fmtP(result.anova.p)],
    ['@th.error', fmtInt(result.anova.dfErr), fmt(result.anova.ssErr), fmt(result.anova.msErr), '', ''],
    ['@th.total', fmtInt(result.anova.dfReg + result.anova.dfErr), fmt(result.anova.ssTotal), '', '', ''],
  ];
  const equation = `${response.name || response.id} = ${fmt(result.coefficients[0].coef)}${result.coefficients
    .slice(1)
    .map((c) => ` ${c.coef >= 0 ? '+' : '−'} ${fmt(Math.abs(c.coef))} ${c.term}`)
    .join('')}`;
  const nRes = result.residuals.length;
  const sortedRes = [...result.residuals].sort((a, b) => a - b);
  const zs = sortedRes.map((_, i) => normalScores(nRes)[i]);
  const residMean = mean(result.residuals);
  const residSd = stdev(result.residuals) || 1;
  const blocks: Block[] = [
    { type: 'text', lines: [`${t(lang, 'res.equation')}: ${equation}`] },
    { type: 'table', title: tableTitle('res.modelSummary'), headers: ['@th.statistic', '@th.value'], rows: modelRows, align: ['l', 'r'] },
    { type: 'table', title: tableTitle('res.coefficients'), headers: ['@th.term', '@th.coef', '@th.seCoef', '@th.t', '@th.p', '@th.vif'], rows: coefRows, align: ['l', 'r', 'r', 'r', 'r', 'r'] },
    { type: 'table', title: tableTitle('res.anovaTable'), headers: ['@th.source', '@th.df', '@th.ss', '@th.ms', '@th.f', '@th.p'], rows: anovaRows, align: ['l', 'r', 'r', 'r', 'r', 'r'] },
  ];
  if (bool(values.fourInOne, true)) {
    blocks.push({
      type: 'chartgrid',
      charts: [
        {
          title: '@chart.normalprob',
          chart: {
            kind: 'normalprob',
            points: sortedRes.map((x, i) => ({ x, y: zs[i] })),
            fit: { intercept: -residMean / residSd, slope: 1 / residSd },
            xLabel: 'Residual',
          },
        },
        {
          title: '@chart.versusFits',
          chart: { kind: 'scatter', points: result.fits.map((f, i) => ({ x: f, y: result.residuals[i] })), xLabel: 'Fitted value', yLabel: 'Residual' },
        },
        { title: '@chart.residHist', chart: { kind: 'histogram', values: result.residuals, normal: true, xLabel: 'Residual' } },
        {
          title: '@chart.versusOrder',
          chart: { kind: 'timeseries', values: result.residuals, yLabel: 'Residual', xLabel: 'Observation order' },
        },
      ],
    });
  }
  return { subtitle: `${response.name} ← ${predictors.map((p) => p.name).join(' + ')}`, blocks };
}

/* ── control charts ───────────────────────────────────────────────────── */

function chartRows(panels: { titleKey: string; center: number; ucl: number | number[]; lcl: number | number[]; sigma: number | number[]; violations: { index: number; rules: number[] }[]; points: number[] }[]): (string | number)[][] {
  return panels.map((p) => [
    `@${p.titleKey.replace('@chart.', 'chart.')}`,
    fmt(p.center),
    Array.isArray(p.ucl) ? `${fmt(Math.min(...p.ucl))} – ${fmt(Math.max(...p.ucl))}` : fmt(p.ucl),
    Array.isArray(p.lcl) ? `${fmt(Math.min(...p.lcl))} – ${fmt(Math.max(...p.lcl))}` : fmt(p.lcl),
    Array.isArray(p.sigma) ? fmt(Math.max(...p.sigma)) : fmt(p.sigma),
    fmtInt(p.violations.length),
  ]);
}

function violationRows(panels: { titleKey: string; points: number[]; violations: { index: number; rules: number[] }[] }[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  panels.forEach((p) => {
    p.violations.forEach((v) => {
      rows.push([`@${p.titleKey.replace('@chart.', 'chart.')}`, fmtInt(v.index + 1), fmt(p.points[v.index]), v.rules.join(', ')]);
    });
  });
  return rows;
}

function runImr(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.variable);
  const data = clean(numValues(sheet, values.variable));
  if (data.length < 5) throw new Error('res.insufficient');
  const result = imrChart(data);
  const vRows = violationRows(result.panels);
  const blocks: Block[] = [
    { type: 'table', headers: ['@th.level', 'Center', 'UCL', 'LCL', 'Sigma', 'Signals'], rows: chartRows(result.panels), align: ['l', 'r', 'r', 'r', 'r', 'r'] },
    { type: 'chart', chart: { kind: 'control', panel: result.panels[0], yLabel: col?.name, xLabel: 'Observation' } },
    { type: 'chart', chart: { kind: 'control', panel: result.panels[1], yLabel: 'Moving range', xLabel: 'Observation' } },
  ];
  if (vRows.length) {
    blocks.splice(1, 0, { type: 'table', headers: ['@th.level', 'Point', 'Value', 'Rules'], rows: vRows, align: ['l', 'r', 'r', 'l'] });
  }
  blocks.push({
    type: 'text',
    lines: [
      result.rulesHit.length ? t(lang, 'res.rulesHit', { rules: result.rulesHit.join(', ') }) : t(lang, 'res.rulesNone'),
      t(lang, 'res.ooc', { n: result.outOfControl }),
      t(lang, 'res.controlNote'),
    ],
  });
  return { subtitle: col?.name ?? '', blocks };
}

function runXbarR(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.variable);
  const subgroup = Math.round(num(values.subgroup, 5));
  const data = numValues(sheet, values.variable);
  if (clean(data).length < (subgroup < 2 ? 5 : subgroup * 3)) throw new Error('res.insufficient');
  let result;
  try {
    result = xbarRCharts(data, subgroup);
  } catch (error) {
    if (error instanceof SpcValidationError) throw new Error(spcIssueText(lang, error.issues));
    throw error;
  }
  const vRows = violationRows(result.panels);
  const blocks: Block[] = [
    { type: 'table', headers: ['@th.level', 'Center', 'UCL', 'LCL', 'Sigma', 'Signals'], rows: chartRows(result.panels), align: ['l', 'r', 'r', 'r', 'r', 'r'] },
  ];
  if (vRows.length) blocks.push({ type: 'table', headers: ['@th.level', 'Point', 'Value', 'Rules'], rows: vRows, align: ['l', 'r', 'r', 'l'] });
  blocks.push(
    { type: 'chart', chart: { kind: 'control', panel: result.panels[0], yLabel: col?.name, xLabel: 'Subgroup' } },
    { type: 'chart', chart: { kind: 'control', panel: result.panels[1], yLabel: 'Range', xLabel: 'Subgroup' } },
    { type: 'text', lines: [result.rulesHit.length ? t(lang, 'res.rulesHit', { rules: result.rulesHit.join(', ') }) : t(lang, 'res.rulesNone')] },
  );
  const summary = result.subgroupSummary;
  if (summary) {
    blocks.push({
      type: 'text',
      lines: [
        t(lang, 'res.subgroupRule', {
          n: summary.size,
          total: summary.total,
          used: summary.used,
          skipped: summary.skipped,
          left: summary.leftoverRows,
        }),
        ...(summary.missingSubgroups && summary.missingSubgroups > 0
          ? [t(lang, 'res.subgroupMissing', { n: summary.missingSubgroups })]
          : []),
        ...(summary.varying ? [t(lang, 'res.subgroupVarying')] : []),
      ],
    });
  }
  return { subtitle: `${col?.name ?? ''} · n=${subgroup}`, blocks };
}

/** Readable text for a validated control-chart input problem. */
function spcIssueText(lang: Lang, issues: SpcIssue[]): string {
  const parts = issues.slice(0, 3).map((issue) => {
    const i = (issue.index ?? 0) + 1;
    switch (issue.code) {
      case 'empty': return t(lang, 'err.pEmpty');
      case 'length': return t(lang, 'err.pLength');
      case 'nonFinite': return t(lang, 'err.pNonFinite', { i });
      case 'nonInteger': return t(lang, 'err.pNonInteger', { i, d: fmt(issue.defect ?? NaN) });
      case 'negative': return t(lang, 'err.pNegative', { i, d: fmt(issue.defect ?? NaN) });
      case 'exceeds': return t(lang, 'err.pExceeds', { i, d: fmt(issue.defect ?? NaN), s: fmt(issue.size ?? NaN) });
      case 'size': return t(lang, 'err.pSize', { i, s: fmt(issue.size ?? NaN) });
      case 'sizeNonInteger': return t(lang, 'err.pSizeInteger', { i, s: fmt(issue.size ?? NaN) });
      case 'noGroups': return t(lang, 'err.xbarNoGroups');
      default: return t(lang, 'err.spcInvalid');
    }
  });
  if (issues.length > 3) parts.push(t(lang, 'err.moreIssues', { n: issues.length - 3 }));
  return parts.join(' ');
}

function runPChart(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const defectsCol = findColumn(sheet, values.defects);
  const sizesCol = findColumn(sheet, values.sizes);
  if (!defectsCol) throw new Error('dlg.required');
  const defects: number[] = [];
  const sizes: number[] = [];
  const rows = rowCount(sheet);
  const constant = num(values.sampleSize, 0);
  for (let r = 0; r < rows; r += 1) {
    const dv = defectsCol.values[r];
    const sv = sizesCol ? sizesCol.values[r] : constant;
    const dEmpty = dv === null || dv === undefined || dv === '';
    const sEmpty = sizesCol ? sv === null || sv === undefined || sv === '' : false;
    // A row left completely blank is a skipped row; anything else is checked.
    if (dEmpty && sEmpty) continue;
    defects.push(dEmpty ? NaN : Number(dv));
    sizes.push(sEmpty ? NaN : Number(sv));
  }
  if (defects.length < 3) throw new Error('res.insufficient');
  let result;
  try {
    result = pChart(defects, sizes);
  } catch (error) {
    if (error instanceof SpcValidationError) throw new Error(spcIssueText(lang, error.issues));
    throw error;
  }
  const vRows = violationRows(result.panels);
  const blocks: Block[] = [
    { type: 'table', headers: ['@th.level', 'Center', 'UCL', 'LCL', 'Sigma', 'Signals'], rows: chartRows(result.panels), align: ['l', 'r', 'r', 'r', 'r', 'r'] },
  ];
  if (vRows.length) blocks.push({ type: 'table', headers: ['@th.level', 'Point', 'Value', 'Rules'], rows: vRows, align: ['l', 'r', 'r', 'l'] });
  blocks.push(
    { type: 'chart', chart: { kind: 'control', panel: result.panels[0], yLabel: 'Proportion', xLabel: 'Sample' } },
    { type: 'text', lines: [result.rulesHit.length ? t(lang, 'res.rulesHit', { rules: result.rulesHit.join(', ') }) : t(lang, 'res.rulesNone'), t(lang, 'res.pchartNote')] },
  );
  return { subtitle: defectsCol?.name ?? '', blocks };
}

/* ── capability ───────────────────────────────────────────────────────── */

function runCapability(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.variable);
  const data = numValues(sheet, values.variable);
  if (clean(data).length < 5) throw new Error('res.insufficient');
  const lslValue = str(values.lsl).trim() === '' ? null : num(values.lsl, NaN);
  const uslValue = str(values.usl).trim() === '' ? null : num(values.usl, NaN);
  const targetValue = str(values.target).trim() === '' ? null : num(values.target, NaN);
  if (lslValue === null && uslValue === null) throw new Error('res.needSpec');
  const methodRaw = str(values.sigmaMethod);
  const sigmaMethod: 'z_bench_shift' | 'z_bench' | 'cpk_shift' =
    methodRaw === 'z_bench' || methodRaw === 'cpk_shift' ? methodRaw : 'z_bench_shift';
  const result = capability(data, {
    lsl: lslValue,
    usl: uslValue,
    target: targetValue,
    subgroup: Math.round(num(values.subgroup, 1)),
    sigmaMethod,
  });
  const dash = (v: number): string => (Number.isFinite(v) ? fmt(v) : '—');
  const sigmaLabel = result.sigmaMethod === 'cpk_shift'
    ? t(lang, 'res.sigmaLevelCpk')
    : result.sigmaMethod === 'z_bench'
      ? t(lang, 'res.sigmaLevelZ')
      : t(lang, 'res.sigmaLevelZShift');
  const statsRows: (string | number)[][] = [
    ['Mean', fmt(result.mean)],
    ['StDev (within)', fmt(result.sdWithin)],
    ['StDev (overall)', fmt(result.sdOverall)],
    ['Cp', dash(result.cp)],
    ['Cpk', dash(result.cpk)],
    ['Pp', dash(result.pp)],
    ['Ppk', dash(result.ppk)],
    ['CPL / CPU', `${dash(result.cpl)} / ${dash(result.cpu)}`],
    ['PPL / PPU', `${dash(result.ppl)} / ${dash(result.ppu)}`],
    ['Cpm', dash(result.cpm)],
    [sigmaLabel, dash(result.sigmaLevel)],
  ];
  const specRows: (string | number)[][] = [
    ['LSL', result.lsl === null ? '—' : fmt(result.lsl)],
    ['USL', result.usl === null ? '—' : fmt(result.usl)],
    ['Target', result.target === null ? '—' : fmt(result.target)],
    ['N', fmtInt(result.n)],
  ];
  // Continuous measurements have no defect opportunities, so no DPMO row:
  // only the expected (within/overall) and observed PPM belong here.
  const ppmRows: (string | number)[][] = [
    ['Expected PPM (within)', fmtInt(result.ppmWithin)],
    ['Expected PPM (overall)', fmtInt(result.ppmOverall)],
    ['Observed PPM', fmtInt(result.ppmObserved)],
    ['Observed below / above', `${fmtInt(result.observedBelow)} / ${fmtInt(result.observedAbove)}`],
  ];
  const notes: string[] = [t(lang, 'res.capabilityNote')];
  if (!Number.isFinite(result.cpm)) notes.push(t(lang, 'res.cpmTargetRequired'));
  if (result.lsl === null || result.usl === null) notes.push(t(lang, 'res.oneSidedNote'));
  return {
    subtitle: col?.name ?? '',
    blocks: [
      { type: 'table', title: tableTitle('res.specs'), headers: ['@th.variable', 'Value'], rows: specRows, align: ['l', 'r'] },
      { type: 'chart', chart: { kind: 'capability', result, xLabel: col?.name ?? 'Measurement' } },
      { type: 'table', title: tableTitle('res.capabilityStats'), headers: ['@th.statistic', 'Value'], rows: statsRows, align: ['l', 'r'] },
      { type: 'table', title: tableTitle('res.capabilityPpm'), headers: ['@th.statistic', 'Value'], rows: ppmRows, align: ['l', 'r'] },
      { type: 'text', lines: notes },
    ],
  };
}

/* ── pareto ───────────────────────────────────────────────────────────── */

function runPareto(ctx: RunContext): RunResult {
  const { sheet, values } = ctx;
  const col = findColumn(sheet, values.category);
  if (!col) throw new Error('dlg.required');
  const counts = new Map<string, number>();
  col.values.forEach((v) => {
    if (v === null || v === undefined || v === '') return;
    const key = String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  const items = [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  if (!items.length) throw new Error('res.insufficient');
  const total = items.reduce((a, b) => a + b.count, 0);
  let cumulative = 0;
  const rows = items.map((item) => {
    cumulative += item.count;
    return [item.label, fmtInt(item.count), `${((item.count / total) * 100).toFixed(1)}%`, `${((cumulative / total) * 100).toFixed(1)}%`] as (string | number)[];
  });
  return {
    subtitle: col.name || col.id,
    blocks: [
      { type: 'chart', chart: { kind: 'pareto', items } },
      { type: 'table', headers: ['@th.defect', '@th.count', '@th.percent', '@th.cumulative'], rows, align: ['l', 'r', 'r', 'r'] },
    ],
  };
}

/* ── graphs ───────────────────────────────────────────────────────────── */

function runHistogram(ctx: RunContext): RunResult {
  const { sheet, values } = ctx;
  const col = findColumn(sheet, values.variable);
  const data = clean(numValues(sheet, values.variable));
  if (!data.length) throw new Error('res.insufficient');
  const bins = Math.round(num(values.bins, 0));
  const s = summarize(data);
  return {
    subtitle: col?.name ?? '',
    blocks: [
      {
        type: 'chart',
        chart: {
          kind: 'histogram',
          values: data,
          bins: bins > 0 ? bins : undefined,
          normal: bool(values.normal, true),
          lsl: str(values.lsl).trim() === '' ? null : num(values.lsl, NaN),
          usl: str(values.usl).trim() === '' ? null : num(values.usl, NaN),
          target: str(values.target).trim() === '' ? null : num(values.target, NaN),
          xLabel: col?.name ?? 'Data',
        },
      },
      {
        type: 'table',
        headers: ['@th.n', '@th.mean', '@th.stdev', '@th.min', '@th.median', '@th.max'],
        rows: [[fmtInt(s.n), fmt(s.mean), fmt(s.stdev), fmt(s.min), fmt(s.median), fmt(s.max)]],
        align: ['r', 'r', 'r', 'r', 'r', 'r'],
      },
    ],
  };
}

function runBoxplot(ctx: RunContext): RunResult {
  const { sheet, values } = ctx;
  const refs = (values.variables as string[]) ?? [];
  const byRefs = (values.by as string[]) ?? [];
  const groups: { label: string; values: number[] }[] = [];
  if (byRefs.length) {
    const response = findColumn(sheet, refs[0]);
    const groupsRaw = buildGroups(sheet, byRefs);
    groupsRaw.forEach((g) => {
      groups.push({ label: g.keys.join(' / '), values: clean(valuesAt(response, g.rows)) });
    });
  } else {
    refs.forEach((ref) => {
      const col = findColumn(sheet, ref);
      if (col) groups.push({ label: col.name || col.id, values: clean(numValues(sheet, ref)) });
    });
  }
  const valid = groups.filter((g) => g.values.length);
  if (!valid.length) throw new Error('res.insufficient');
  const rows = valid.map((g) => {
    const s = summarize(g.values);
    return [g.label, fmtInt(s.n), fmt(s.min), fmt(s.q1), fmt(s.median), fmt(s.q3), fmt(s.max), fmt(s.iqr)] as (string | number)[];
  });
  return {
    subtitle: valid.map((g) => g.label).join(', '),
    blocks: [
      { type: 'chart', chart: { kind: 'boxplot', groups: valid, yLabel: 'Value' } },
      { type: 'table', headers: ['@th.variable', '@th.n', '@th.min', '@th.q1', '@th.median', '@th.q3', '@th.max', '@th.iqr'], rows, align: ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'] },
    ],
  };
}

function correlation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function runScatter(ctx: RunContext): RunResult {
  const { sheet, values } = ctx;
  const xCol = findColumn(sheet, values.x);
  const yCol = findColumn(sheet, values.y);
  if (!xCol || !yCol) throw new Error('dlg.required');
  const points: { x: number; y: number; g?: string }[] = [];
  const byRef = ((values.by as string[]) ?? [])[0];
  const byCol = findColumn(sheet, byRef);
  const rows = Math.min(xCol.values.length, yCol.values.length);
  for (let r = 0; r < rows; r += 1) {
    const x = xCol.values[r];
    const y = yCol.values[r];
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    points.push(byCol ? { x, y, g: String(byCol.values[r] ?? '') } : { x, y });
  }
  if (points.length < 2) throw new Error('res.insufficient');
  const xSpan = stdev(points.map((p) => p.x));
  const ySpan = stdev(points.map((p) => p.y));
  if (!(xSpan > 0)) throw new Error('res.constantPredictor');
  if (!(ySpan > 0)) throw new Error('res.zeroVariance');
  let reg;
  try {
    reg = regress(
      points.map((p) => p.y),
      [{ name: xCol.name || xCol.id, values: points.map((p) => p.x) }],
    );
  } catch {
    throw new Error('res.singular');
  }
  const r = correlation(points.map((p) => p.x), points.map((p) => p.y));
  const groups = byCol ? [...new Set(points.map((p) => p.g ?? ''))] : undefined;
  return {
    subtitle: `${yCol.name} vs ${xCol.name}`,
    blocks: [
      {
        type: 'chart',
        chart: {
          kind: 'scatter',
          points,
          fit: { intercept: reg.coefficients[0].coef, slope: reg.coefficients[1].coef },
          groups,
          xLabel: xCol.name || xCol.id,
          yLabel: yCol.name || yCol.id,
        },
      },
      {
        type: 'table',
        headers: ['R²', 'Pearson r', '@th.coef', '@th.p'],
        rows: [[`${(reg.r2 * 100).toFixed(1)}%`, fmt(r), `${fmt(reg.coefficients[1].coef)} x ${reg.coefficients[0].coef >= 0 ? '+' : '−'} ${fmt(Math.abs(reg.coefficients[0].coef))}`, fmtP(reg.coefficients[1].p)]],
        align: ['r', 'r', 'l', 'r'],
      },
      { type: 'text', lines: [`n = ${points.length}`] },
    ],
  };
}

function runTimeseries(ctx: RunContext): RunResult {
  const { sheet, values } = ctx;
  const col = findColumn(sheet, values.variable);
  const data = numValues(sheet, values.variable).map((v) => (typeof v === 'number' ? v : NaN));
  if (!clean(data).length) throw new Error('res.insufficient');
  const s = summarize(data);
  return {
    subtitle: col?.name ?? '',
    blocks: [
      {
        type: 'chart',
        chart: {
          kind: 'timeseries',
          values: data,
          yLabel: col?.name ?? 'Value',
          lsl: str(values.lsl).trim() === '' ? null : num(values.lsl, NaN),
          usl: str(values.usl).trim() === '' ? null : num(values.usl, NaN),
          target: str(values.target).trim() === '' ? null : num(values.target, NaN),
        },
      },
      { type: 'table', headers: ['@th.n', '@th.mean', '@th.stdev', '@th.min', '@th.max'], rows: [[fmtInt(s.n), fmt(s.mean), fmt(s.stdev), fmt(s.min), fmt(s.max)]], align: ['r', 'r', 'r', 'r', 'r'] },
    ],
  };
}

/* ── worksheet transforms ─────────────────────────────────────────────── */

function targetName(ctx: RunContext, fallback: string): string {
  const raw = str(ctx.values.storeIn).trim();
  if (raw) return raw;
  const base = fallback;
  let i = 1;
  let name = base;
  while (ctx.sheet.columns.some((c) => c.name === name)) {
    i += 1;
    name = `${base} ${i}`;
  }
  return name;
}

function withColumn(sheet: Worksheet, name: string, values: (number | string | null)[]): Worksheet {
  const rows = Math.max(rowCount(sheet), values.length);
  const used = new Set(sheet.columns.map((c) => c.id));
  let index = 1;
  while (used.has(`C${index}`)) index += 1;
  return {
    ...sheet,
    columns: [
      ...sheet.columns.map((c) => ({ ...c, values: Array.from({ length: rows }, (_, i) => c.values[i] ?? null) })),
      { id: `C${index}`, name, type: 'numeric', values: Array.from({ length: rows }, (_, i) => values[i] ?? null) },
    ],
  };
}

function runCalculator(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const formula = str(values.formula).trim();
  if (!formula) throw new Error('calc.emptyFormula');
  const outcome = evaluateFormula(formula, sheet);
  const name = targetName(ctx, 'Result');
  const patch = withColumn(sheet, name, outcome.values);
  const preview = outcome.values.slice(0, 8).map((v) => (v === null ? '*' : fmt(v))).join(', ');
  return {
    subtitle: `${name} = ${formula}`,
    sheetPatch: patch,
    blocks: [
      { type: 'text', lines: [outcome.constant ? t(lang, 'res.constant', { value: fmt(outcome.values[0] ?? NaN), n: outcome.rows }) : t(lang, 'res.calcStored', { col: name, errors: outcome.errors })] },
      { type: 'table', headers: ['@th.column', 'Rows', 'Preview'], rows: [[name, fmtInt(outcome.rows), preview]], align: ['l', 'r', 'l'] },
    ],
  };
}

function runRandom(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const count = Math.max(1, Math.min(5000, Math.round(num(values.count, 30))));
  const kind = (str(values.distribution) || 'normal') as 'normal' | 'uniform' | 'integer';
  const generated = generateRandom({
    kind,
    count,
    mean: num(values.mean, 0),
    sd: num(values.sd, 1),
    min: num(values.min, 0),
    max: num(values.max, 10),
    seed: Math.round(num(values.seed, 20261121)),
  });
  const name = targetName(ctx, `${kind === 'normal' ? 'Normal' : kind === 'uniform' ? 'Uniform' : 'Integer'} data`);
  const patch = withColumn(sheet, name, generated);
  return {
    subtitle: name,
    sheetPatch: patch,
    blocks: [
      { type: 'text', lines: [t(lang, 'res.generated', { n: count, col: name, dist: kind })] },
      { type: 'table', headers: ['@th.column', 'N', '@th.mean', '@th.stdev', '@th.min', '@th.max'], rows: [[name, fmtInt(count), fmt(mean(generated)), fmt(stdev(generated)), fmt(Math.min(...generated)), fmt(Math.max(...generated))]], align: ['l', 'r', 'r', 'r', 'r', 'r'] },
    ],
  };
}

function runSort(ctx: RunContext): RunResult {
  const { sheet, values } = ctx;
  const keyCol = findColumn(sheet, values.column);
  if (!keyCol) throw new Error('dlg.required');
  const rows = rowCount(sheet);
  const order = Array.from({ length: rows }, (_, i) => i).sort((a, b) => {
    const av = keyCol.values[a];
    const bv = keyCol.values[b];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return bool(values.descending) ? bv - av : av - bv;
    return String(av).localeCompare(String(bv));
  });
  const columns = sheet.columns.map((c) => ({ ...c, values: order.map((i) => c.values[i] ?? null) }));
  const sortedSheet: Worksheet = { ...sheet, id: sheet.id, columns };
  return {
    subtitle: keyCol.name || keyCol.id,
    sheetPatch: sortedSheet,
    blocks: [{ type: 'text', lines: [t(ctx.lang, 'res.sorted', { n: rows, col: keyCol.name || keyCol.id })] }],
  };
}

function runStandardize(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const data = numValues(sheet, values.column);
  const cleaned = clean(data);
  if (cleaned.length < 2) throw new Error('res.insufficient');
  const m = mean(cleaned);
  const s = stdev(cleaned);
  const z = data.map((v) => (typeof v === 'number' ? (v - m) / s : null));
  const name = targetName(ctx, `Std ${labelOf(sheet, values.column)}`);
  const patch = withColumn(sheet, name, z);
  return {
    subtitle: name,
    sheetPatch: patch,
    blocks: [
      { type: 'text', lines: [t(lang, 'res.standardized', { n: cleaned.length, col: name })] },
      { type: 'table', headers: ['@th.column', '@th.mean', '@th.stdev'], rows: [[name, fmt(m), fmt(s)]], align: ['l', 'r', 'r'] },
    ],
  };
}

function runRecode(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const data = numValues(sheet, values.column);
  const mapping = str(values.mapping)
    .split(',')
    .map((part) => part.split('='))
    .map(([from, to]) => [Number(from), Number(to)] as [number, number])
    .filter(([from, to]) => isFinite(from) && isFinite(to));
  const fallbackRaw = str(values.fallback).trim();
  const fallback = fallbackRaw === '' ? NaN : Number(fallbackRaw);
  const name = targetName(ctx, `Recode ${labelOf(sheet, values.column)}`);
  const recoded = data.map((v) => {
    if (typeof v !== 'number') return null;
    const hit = mapping.find(([from]) => Math.abs(from - v) < 1e-9);
    if (hit) return hit[1];
    return isFinite(fallback) ? fallback : v;
  });
  const patch = withColumn(sheet, name, recoded);
  return {
    subtitle: name,
    sheetPatch: patch,
    blocks: [
      { type: 'text', lines: [t(lang, 'res.recode', { n: clean(data).length, col: name })] },
      { type: 'table', headers: ['@th.value', 'New value'], rows: mapping.map(([from, to]) => [fmt(from), fmt(to)]), align: ['r', 'r'] },
    ],
  };
}

/* ── P2: Gage R&R ─────────────────────────────────────────────────────── */

interface CellStat { mean: number; range: number; n: number }

function cellStats(rows: GrrRow[]): Map<string, CellStat> {
  const map = new Map<string, number[]>();
  rows.forEach((row) => {
    const key = `${row.part}\u0001${row.operator}`;
    const list = map.get(key) ?? [];
    list.push(row.measurement);
    map.set(key, list);
  });
  const out = new Map<string, CellStat>();
  map.forEach((values, key) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    out.set(key, { mean, range: Math.max(...values) - Math.min(...values), n: values.length });
  });
  return out;
}

function runGageRR(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const partCol = findColumn(sheet, values.part);
  const opCol = findColumn(sheet, values.operator);
  const measCol = findColumn(sheet, values.measurement);
  if (!partCol || !opCol || !measCol) throw new Error('dlg.required');
  const rows: GrrRow[] = [];
  const count = rowCount(sheet);
  for (let r = 0; r < count; r += 1) {
    const measurement = measCol.values[r];
    if (typeof measurement !== 'number' || !isFinite(measurement)) continue;
    rows.push({ part: textOf(partCol, r), operator: textOf(opCol, r), measurement });
  }
  if (rows.length < 6) throw new Error('res.insufficient');
  const type = str(values.type) === 'nested' ? 'nested' : 'crossed';
  const toleranceRaw = str(values.tolerance).trim();
  const tolerance = toleranceRaw === '' ? NaN : Math.abs(num(toleranceRaw, NaN));
  const studyVar = num(values.studyVar, 6);
  const result = gageRR(rows, type, {
    tolerance: isFinite(tolerance) ? tolerance : undefined,
    studyVar,
    poolInteraction: bool(values.poolInteraction, false),
  });
  const level = `${(conf(values.confidence) * 100).toFixed(0)}%`;
  const anovaRows: (string | number)[][] = result.anova.map((row) => [
    `@grr.${row.source}`,
    fmtInt(row.df),
    fmt(row.ss),
    Number.isFinite(row.ms) ? fmt(row.ms) : '—',
    Number.isFinite(row.f) ? fmt(row.f) : '—',
    Number.isFinite(row.p) ? fmtP(row.p) : '—',
  ]);
  const compRows: (string | number)[][] = result.components.map((c) => [
    `@grr.${c.name}`,
    fmt(c.variance, 5),
    `${c.contribution.toFixed(2)}%`,
    fmt(c.stdev, 5),
    fmt(c.studyVar * c.stdev / 100, 5),
    `${c.studyVar.toFixed(2)}%`,
    Number.isFinite(c.tolerance) ? `${c.tolerance.toFixed(2)}%` : '—',
  ]);
  const grrPct = result.components.find((c) => c.name === 'grr')?.studyVar ?? NaN;
  const verdict = grrPct < 10 ? 'res.grrAcceptable' : grrPct < 30 ? 'res.grrMarginal' : 'res.grrUnacceptable';
  const cells = cellStats(rows);
  const parts = [...new Set(rows.map((r) => r.part))];
  const operators = [...new Set(rows.map((r) => r.operator))];
  const n = Number.isFinite(result.replicates) ? result.replicates : 1;
  const constants = XBAR_CONSTANTS[Math.max(2, Math.min(10, n))];
  const allRanges = [...cells.values()].map((c) => c.range);
  const rBar = mean(allRanges);
  const grand = mean([...cells.values()].map((c) => c.mean));
  const rSeries = operators.map((op, i) => ({
    label: op,
    color: i,
    points: parts.map((part, pi) => ({ x: pi, y: cells.get(`${part}\u0001${op}`)?.range ?? NaN })).filter((p) => isFinite(p.y)),
  }));
  const xbarSeries = operators.map((op, i) => ({
    label: op,
    color: i,
    points: parts.map((part, pi) => ({ x: pi, y: cells.get(`${part}\u0001${op}`)?.mean ?? NaN })).filter((p) => isFinite(p.y)),
  }));
  const interactionSeries = operators.map((op, i) => ({
    label: op,
    color: i,
    points: parts.map((part, pi) => ({ x: pi, y: cells.get(`${part}\u0001${op}`)?.mean ?? NaN })).filter((p) => isFinite(p.y)),
  }));
  const partGroups = parts.map((part) => ({
    label: part,
    values: rows.filter((r) => r.part === part).map((r) => r.measurement),
  }));
  const opGroups = operators.map((op) => ({
    label: op,
    values: rows.filter((r) => r.operator === op).map((r) => r.measurement),
  }));
  const compItems = [
    { label: t(lang, '@grr.repeat'), value: result.components.find((c) => c.name === 'repeat')?.contribution ?? 0, color: 0 },
    { label: t(lang, '@grr.reproducibility'), value: result.components.find((c) => c.name === 'reproducibility')?.contribution ?? 0, color: 1 },
    { label: t(lang, '@grr.partToPart'), value: result.components.find((c) => c.name === 'partToPart')?.contribution ?? 0, color: 2 },
    { label: t(lang, '@grr.grr'), value: result.components.find((c) => c.name === 'grr')?.contribution ?? 0, color: 3 },
  ];
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        `${t(lang, 'res.grrInfo', { type: t(lang, type === 'nested' ? '@grr.nested' : '@grr.crossed'), parts: result.parts, operators: result.operators, reps: result.replicates || '—', rows: rows.length })}`,
        `${t(lang, 'res.grrVerdict', { pct: grrPct.toFixed(1), verdict: t(lang, verdict) })}`,
        `${t(lang, 'res.grrNdc', { ndc: result.ndc })}`,
        toleranceRaw === '' ? t(lang, 'res.grrNoTolerance') : t(lang, 'res.grrTolerance', { tol: fmt(tolerance) }),
        result.note === 'interactionPooled' ? t(lang, 'res.grrPooled') : '',
        result.negativeComponents.length ? t(lang, 'res.grrNegative', { names: result.negativeComponents.join(', ') }) : '',
      ].filter(Boolean),
    },
    {
      type: 'table',
      title: tableTitle('res.grrAnova'),
      headers: ['@th.source', '@th.df', '@th.ss', '@th.ms', '@th.f', '@th.p'],
      rows: anovaRows,
      align: ['l', 'r', 'r', 'r', 'r', 'r'],
    },
    {
      type: 'table',
      title: t(lang, 'res.grrComponentsLevel', { level }),
      headers: ['@th.source', '@th.varComp', '@th.contribution', '@th.stdev', '@th.studyVar', '@th.pctStudyVar', '@th.pctTolerance'],
      rows: compRows,
      align: ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
      caption: t(lang, 'res.grrComponentNote', { mult: fmt(studyVar) }),
    },
    {
      type: 'chartgrid',
      charts: [
        { title: '@chart.components', chart: { kind: 'bar', items: compItems, yLabel: '% Contribution', decimals: 1, height: 220 } },
        {
          title: '@chart.rbyop',
          chart: {
            kind: 'line',
            series: rSeries,
            xLabels: parts.map((_, i) => `P${i + 1}`),
            yLabel: 'Range',
            refLines: Number.isFinite(rBar)
              ? [{ y: constants.D4 * rBar, label: `UCL ${fmt(constants.D4 * rBar, 3)}` }, { y: rBar, label: `R̄ ${fmt(rBar, 3)}` }, { y: constants.D3 * rBar, label: `LCL ${fmt(constants.D3 * rBar, 3)}` }]
              : undefined,
            height: 220,
          },
        },
        {
          title: '@chart.xbarbyop',
          chart: {
            kind: 'line',
            series: xbarSeries,
            xLabels: parts.map((_, i) => `P${i + 1}`),
            yLabel: 'Mean',
            refLines: Number.isFinite(rBar)
              ? [{ y: grand + constants.A2 * rBar, label: `UCL ${fmt(grand + constants.A2 * rBar, 3)}` }, { y: grand, label: `X̄ ${fmt(grand, 3)}` }, { y: grand - constants.A2 * rBar, label: `LCL ${fmt(grand - constants.A2 * rBar, 3)}` }]
              : undefined,
            height: 220,
          },
        },
        { title: '@chart.bypart', chart: { kind: 'boxplot', groups: partGroups, yLabel: 'Measurement', height: 220 } },
        { title: '@chart.byoperator', chart: { kind: 'boxplot', groups: opGroups, yLabel: 'Measurement', height: 220 } },
        { title: '@chart.interaction', chart: { kind: 'line', series: interactionSeries, xLabels: parts.map((_, i) => `P${i + 1}`), yLabel: 'Mean', height: 220 } },
      ],
    },
  ];
  return {
    subtitle: `${measCol.name || measCol.id} · ${type}`,
    blocks,
  };
}

/* ── P2: Capability Sixpack ───────────────────────────────────────────── */

function capabilitySummaryRows(result: ReturnType<typeof capability>): (string | number)[][] {
  const dash = (value: number): string => (Number.isFinite(value) ? fmt(value) : '—');
  return [
    ['Mean', fmt(result.mean)],
    ['StDev (within)', fmt(result.sdWithin)],
    ['StDev (overall)', fmt(result.sdOverall)],
    ['Cp', dash(result.cp)],
    ['Cpk', dash(result.cpk)],
    ['Pp', dash(result.pp)],
    ['Ppk', dash(result.ppk)],
    ['Cpm', dash(result.cpm)],
    ['Expected PPM (overall)', Number.isFinite(result.ppmOverall) ? fmtInt(result.ppmOverall) : '—'],
    ['Sigma level', dash(result.sigmaLevel)],
  ];
}

function normalProbChart(data: number[], xLabel: string, height = 220): ChartSpec {
  const ad = adNormality(data);
  const zs = ad.sorted.map((_, i) => normalScores(ad.n)[i]);
  const step = (Math.max(...ad.sorted) - Math.min(...ad.sorted)) / 40 || 1;
  const ci: { x: number; lo: number; hi: number }[] = [];
  for (let i = 0; i <= 40; i += 1) {
    const x = Math.min(...ad.sorted) - step + i * step;
    const z = (x - ad.mean) / ad.sd;
    const margin = 1.96 * Math.sqrt(1 / ad.n + (z * z) / (2 * (ad.n - 1)));
    ci.push({ x, lo: z - margin, hi: z + margin });
  }
  return {
    kind: 'normalprob',
    points: ad.sorted.map((x, i) => ({ x, y: zs[i] })),
    fit: { intercept: -ad.mean / ad.sd, slope: 1 / ad.sd },
    ci,
    xLabel,
    ad: ad.adAdj,
    p: ad.p,
    height,
  };
}

function runSixpack(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.variable);
  const data = numValues(sheet, values.variable);
  if (clean(data).length < 5) throw new Error('res.insufficient');
  const lslValue = str(values.lsl).trim() === '' ? null : num(values.lsl, NaN);
  const uslValue = str(values.usl).trim() === '' ? null : num(values.usl, NaN);
  const targetValue = str(values.target).trim() === '' ? null : num(values.target, NaN);
  if (lslValue === null && uslValue === null) throw new Error('res.needSpec');
  const methodRaw = str(values.sigmaMethod);
  const sigmaMethod = methodRaw === 'z_bench' || methodRaw === 'cpk_shift' ? methodRaw : 'z_bench_shift';
  const subgroup = Math.max(1, Math.round(num(values.subgroup, 1)));
  const result = capabilitySixpack(data, {
    subgroup,
    lsl: lslValue,
    usl: uslValue,
    target: targetValue,
    sigmaMethod,
  });
  const values2 = clean(data);
  let lo = Math.min(...values2);
  let hi = Math.max(...values2);
  [lslValue, uslValue, targetValue].forEach((v) => {
    if (v !== null && isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  });
  const bins = histogramBins(values2);
  const binWidth = bins.length ? bins[0].hi - bins[0].lo : 1;
  const curve = (m: number, s: number, color: number, label: string): { label: string; points: { x: number; y: number }[]; color: number; dash?: string } => {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i <= 90; i += 1) {
      const x = lo + ((hi - lo) * i) / 90;
      points.push({ x, y: normalPdf(x, m, s) * values2.length * binWidth });
    }
    return { label, points, color, dash: undefined };
  };
  const statsRows = capabilitySummaryRows(result.capability);
  const cap = result.capability;
  const chartLabel = result.chart === 'imr' ? t(lang, '@chart.ichart') : result.chart === 'xbar-r' ? t(lang, '@chart.xbarchart') : t(lang, '@chart.xbarschart');
  const indexItems = [
    { label: 'Cp', value: cap.cp, color: 0 },
    { label: 'Cpk', value: cap.cpk, color: 1 },
    { label: 'Pp', value: cap.pp, color: 2 },
    { label: 'Ppk', value: cap.ppk, color: 3 },
    { label: 'Cpm', value: cap.cpm, color: 4 },
  ].filter((item) => isFinite(item.value));
  const adResult = result.ad;
  // Subgroups 11+ keep their Xbar-S explanation; every size also says out loud
  // that the limits and the indices share the same chart estimate.
  const sigmaLine = t(lang, 'res.sixpackSigmaBasis', { method: result.withinMethodLabel });
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        t(lang, 'res.sixpackInfo', {
          chart: chartLabel,
          n: subgroup,
          rows: values2.length,
        }),
        subgroup > 10 ? t(lang, 'res.sixpackXbarS') : '',
        sigmaLine,
        result.missingSubgroups > 0 ? t(lang, 'res.sixpackMissing', { n: result.missingSubgroups }) : '',
        Number.isFinite(adResult.p)
          ? t(lang, adResult.p >= 0.05 ? 'res.normal' : 'res.notNormal')
          : t(lang, 'res.insufficient'),
      ].filter(Boolean),
    },
    {
      type: 'table',
      title: tableTitle('res.specs'),
      headers: ['@th.statistic', 'Value'],
      rows: [
        ['LSL', cap.lsl === null ? '—' : fmt(cap.lsl)],
        ['USL', cap.usl === null ? '—' : fmt(cap.usl)],
        ['Target', cap.target === null ? '—' : fmt(cap.target)],
        ['N', fmtInt(cap.n)],
        ['Subgroup size', fmtInt(subgroup)],
      ],
      align: ['l', 'r'],
    },
    {
      type: 'table',
      title: tableTitle('res.capabilityStats'),
      headers: ['@th.statistic', 'Value'],
      rows: statsRows,
      align: ['l', 'r'],
    },
    {
      // The three variability estimates and where each one comes from: the chart
      // limits and Cp/Cpk share one chart-based within sigma, Pp/Ppk use s (n−1).
      type: 'table',
      title: tableTitle('res.sigmaEstimate'),
      headers: ['@th.estimate', '@th.value', '@th.basis'],
      rows: [
        [t(lang, 'res.chartWithinSigma'), fmt(result.sigmaWithin, 6), result.withinMethodLabel],
        [t(lang, 'res.capabilityWithinSigma'), fmt(cap.sdWithin, 6), result.withinMethodLabel],
        [t(lang, 'res.overallSigma'), fmt(cap.sdOverall, 6), t(lang, 'res.overallSigmaBasis')],
      ],
      align: ['l', 'r', 'l'],
      caption: t(lang, 'res.sixpackSigmaNote', { method: result.withinMethodLabel }),
    },
    {
      type: 'chartgrid',
      charts: [
        { title: '@chart.location', chart: { kind: 'control', panel: result.primary, yLabel: col?.name ?? 'Value', xLabel: subgroup > 1 ? 'Subgroup' : 'Observation', height: 210 } },
        { title: '@chart.dispersion', chart: { kind: 'control', panel: result.secondary, yLabel: subgroup > 1 ? (result.chart === 'xbar-s' ? 'StDev' : 'Range') : 'Moving range', xLabel: subgroup > 1 ? 'Subgroup' : 'Observation', height: 210 } },
        { title: '@chart.last25', chart: { kind: 'control', panel: result.last, yLabel: col?.name ?? 'Value', xLabel: t(lang, 'res.lastRuns'), height: 210 } },
        {
          title: '@chart.caphist',
          chart: {
            kind: 'histogram',
            values: values2,
            lsl: cap.lsl,
            usl: cap.usl,
            target: cap.target,
            xLabel: col?.name ?? 'Measurement',
            height: 230,
            curves: [
              curve(cap.mean, cap.sdWithin, 1, t(lang, 'res.withinCurve')),
              curve(cap.mean, cap.sdOverall, 2, t(lang, 'res.overallCurve')),
            ],
          },
        },
        { title: '@chart.capprob', chart: normalProbChart(values2, col?.name ?? 'Measurement', 230) },
        { title: '@chart.capindices', chart: { kind: 'bar', items: indexItems, yLabel: 'Index', refLine: { y: 1.33, label: '1.33' }, decimals: 2, height: 230 } },
      ],
    },
    { type: 'text', lines: [t(lang, 'res.sixpackNote')] },
  ];
  return { subtitle: col?.name ?? '', blocks };
}

/* ── P2: Nonnormal capability ─────────────────────────────────────────── */

function logTicks(min: number, max: number): { v: number; label: string }[] {
  const out: { v: number; label: string }[] = [];
  const start = Math.floor(Math.log10(Math.max(1e-12, min)));
  const end = Math.ceil(Math.log10(Math.max(1e-11, max)));
  for (let e = start; e <= end; e += 1) {
    [1, 2, 5].forEach((m) => {
      const value = m * 10 ** e;
      if (value >= min && value <= max) {
        out.push({ v: Math.log(value), label: value >= 1000 ? `${value / 1000}k` : String(value) });
      }
    });
  }
  return out.slice(0, 9);
}

function runNonnormal(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.variable);
  const data = numValues(sheet, values.variable);
  const validCount = clean(data).filter((v) => v > 0).length;
  // Weibull / lognormal / gamma live on (0, ∞): a zero or negative value cannot
  // be fitted, so it is excluded AND counted, never dropped in silence.
  if (!validCount) throw new Error('nonnormal.invalidData');
  if (validCount < 5) throw new Error('res.insufficient');
  const raw = str(values.distribution);
  const dist: NonnormalDist = raw === 'lognormal' || raw === 'gamma' ? raw : 'weibull';
  const lslValue = str(values.lsl).trim() === '' ? null : num(values.lsl, NaN);
  const uslValue = str(values.usl).trim() === '' ? null : num(values.usl, NaN);
  const targetValue = str(values.target).trim() === '' ? null : num(values.target, NaN);
  const result = nonnormalCapability(data, dist, { lsl: lslValue, usl: uslValue, target: targetValue });
  const fit = result.fit;
  const shapeLabel = dist === 'lognormal' ? 'σ (ln)' : 'Shape';
  const scaleLabel = dist === 'lognormal' ? 'μ (ln)' : 'Scale';
  const bandText = {
    above10: t(lang, 'res.adAbove10'),
    between05and10: t(lang, 'res.ad0510'),
    between01and05: t(lang, 'res.ad0105'),
    below01: t(lang, 'res.adBelow01'),
  }[fit.band];
  const fitRows: (string | number)[][] = [
    [shapeLabel, fmt(fit.params.shape, 5)],
    [scaleLabel, fmt(fit.params.scale, 5)],
    ['N', fmtInt(fit.n)],
    ...(result.excluded > 0 ? [[t(lang, 'res.excludedCount'), fmtInt(result.excluded)] as (string | number)[]] : []),
    ['Log-likelihood', fmt(fit.params.logLik, 3)],
    ['AD', fmt(fit.ad, 4)],
    ['AD*', fmt(fit.adAdjusted, 4)],
    [t(lang, 'res.adCritical'), fit.critical.map((v) => fmt(v, 3)).join(' / ')],
    [t(lang, 'res.adConclusion'), bandText],
  ];
  const capRows: (string | number)[][] = [
    ['LSL', result.lsl === null ? '—' : fmt(result.lsl)],
    ['USL', result.usl === null ? '—' : fmt(result.usl)],
    ['P0.135', fmt(result.p00135, 4)],
    ['P50', fmt(result.median, 4)],
    ['P99.865', fmt(result.p99865, 4)],
    ['Pp', Number.isFinite(result.pp) ? fmt(result.pp) : '—'],
    ['Ppk', Number.isFinite(result.ppk) ? fmt(result.ppk) : '—'],
    ['PPL / PPU', `${Number.isFinite(result.ppl) ? fmt(result.ppl) : '—'} / ${Number.isFinite(result.ppu) ? fmt(result.ppu) : '—'}`],
    ['Expected PPM', fmtInt(result.ppm)],
    ['Observed PPM', fmtInt(result.observedPpm)],
  ];
  const sorted = clean(data).filter((v) => v > 0).sort((a, b) => a - b);
  const n = sorted.length;
  const points = sorted.map((t, i) => {
    const f = Math.min(1 - 1e-9, Math.max(1e-9, (i + 1 - 0.3) / (n + 0.4)));
    const y = normalInv(f);
    return { x: dist === 'gamma' ? t : Math.log(t), y };
  });
  const curve: { x: number; y: number }[] = [];
  const xLo = dist === 'gamma' ? sorted[0] : Math.log(sorted[0]);
  const xHi = dist === 'gamma' ? sorted[n - 1] : Math.log(sorted[n - 1]);
  for (let i = 0; i <= 80; i += 1) {
    const x = xLo + ((xHi - xLo) * i) / 80;
    const time = dist === 'gamma' ? x : Math.exp(x);
    const f = Math.min(1 - 1e-9, Math.max(1e-9, fit.cdf(time)));
    curve.push({ x, y: normalInv(f) });
  }
  const binWidth = histogramBins(sorted).length ? histogramBins(sorted)[0].hi - histogramBins(sorted)[0].lo : 1;
  const pdfPoints: { x: number; y: number }[] = [];
  const lo = Math.min(sorted[0], result.lsl ?? sorted[0]);
  const hi = Math.max(sorted[n - 1], result.usl ?? sorted[n - 1]);
  for (let i = 0; i <= 100; i += 1) {
    const x = lo + ((hi - lo) * i) / 100;
    pdfPoints.push({ x, y: fit.pdf(x) * n * binWidth });
  }
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        t(lang, 'res.nonnormalInfo', { dist: t(lang, `dist.${dist}`), n }),
        t(lang, 'res.nonnormalMethod'),
        ...(result.excluded > 0 ? [t(lang, 'res.excludedWarning', { n: result.excluded })] : []),
      ],
    },
    { type: 'table', title: tableTitle('res.distributionFit'), headers: ['@th.parameter', '@th.estimate'], rows: fitRows, align: ['l', 'r'] },
    { type: 'table', title: tableTitle('res.capabilityStats'), headers: ['@th.statistic', 'Value'], rows: capRows, align: ['l', 'r'] },
    {
      type: 'chartgrid',
      charts: [
        {
          title: '@chart.distpdf',
          chart: {
            kind: 'histogram',
            values: sorted,
            lsl: result.lsl,
            usl: result.usl,
            target: result.target,
            xLabel: col?.name ?? 'Measurement',
            curves: [{ label: t(lang, `dist.${dist}`), points: pdfPoints, color: 1 }],
            height: 240,
          },
        },
        {
          title: '@chart.probplot',
          chart: {
            kind: 'probplot',
            points,
            fit: { intercept: 0, slope: 0 },
            curve,
            xLabel: dist === 'gamma' ? (col?.name ?? 'Measurement') : `ln(${col?.name ?? 'Measurement'})`,
            yLabel: t(lang, 'res.percent'),
            xTicks: dist === 'gamma' ? undefined : logTicks(sorted[0], sorted[n - 1]),
            note: `AD* ${fmt(fit.adAdjusted, 3)}`,
            height: 240,
          },
        },
      ],
    },
    { type: 'text', lines: [t(lang, 'res.nonnormalNote')] },
  ];
  return { subtitle: `${col?.name ?? ''} · ${t(lang, `dist.${dist}`)}`, blocks };
}

/* ── P2: Xbar-S, NP, C, U charts ──────────────────────────────────────── */

function runXbarS(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.variable);
  const groupCol = findColumn(sheet, values.groups);
  const data = numValues(sheet, values.variable);
  const size = Math.max(2, Math.round(num(values.subgroup, 5)));
  if (clean(data).length < size * 2) throw new Error('res.insufficient');
  let result;
  try {
    result = groupCol
      ? xbarSCharts(data, { groupIds: groupCol.values.map((v) => (v === null || v === undefined || v === '' ? null : String(v))) })
      : xbarSCharts(data, { size });
  } catch (error) {
    if (error instanceof SpcValidationError) throw new Error(spcIssueText(lang, error.issues));
    throw error;
  }
  const vRows = violationRows(result.panels);
  const blocks: Block[] = [
    { type: 'table', headers: ['@th.level', 'Center', 'UCL', 'LCL', 'Sigma', 'Signals'], rows: chartRows(result.panels), align: ['l', 'r', 'r', 'r', 'r', 'r'] },
  ];
  if (vRows.length) blocks.push({ type: 'table', headers: ['@th.level', 'Point', 'Value', 'Rules'], rows: vRows, align: ['l', 'r', 'r', 'l'] });
  blocks.push(
    { type: 'chart', chart: { kind: 'control', panel: result.panels[0], yLabel: col?.name, xLabel: 'Subgroup' } },
    { type: 'chart', chart: { kind: 'control', panel: result.panels[1], yLabel: 'StdDev', xLabel: 'Subgroup' } },
    { type: 'text', lines: [result.rulesHit.length ? t(lang, 'res.rulesHit', { rules: result.rulesHit.join(', ') }) : t(lang, 'res.rulesNone')] },
  );
  const summary = result.subgroupSummary;
  if (summary) {
    blocks.push({
      type: 'text',
      lines: [t(lang, 'res.subgroupRule', { n: summary.size, total: summary.total, used: summary.used, skipped: summary.skipped, left: summary.leftoverRows })],
    });
  }
  return { subtitle: `${col?.name ?? ''} · n=${groupCol ? 'varying' : size}`, blocks };
}

function countRows(col: Column | undefined): number[] {
  if (!col) return [];
  const out: number[] = [];
  col.values.forEach((v) => {
    if (v === null || v === undefined || v === '') return;
    const n = typeof v === 'number' ? v : Number(v);
    out.push(Number.isFinite(n) ? n : NaN);
  });
  return out;
}

function runNpChart(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.defectives);
  if (!col) throw new Error('dlg.required');
  const counts = countRows(col);
  const size = Math.round(num(values.sampleSize, 100));
  let result;
  try {
    result = npChart(counts, size);
  } catch (error) {
    if (error instanceof SpcValidationError) throw new Error(spcIssueText(lang, error.issues));
    throw error;
  }
  const vRows = violationRows(result.panels);
  const blocks: Block[] = [
    { type: 'table', headers: ['@th.level', 'Center', 'UCL', 'LCL', 'Sigma', 'Signals'], rows: chartRows(result.panels), align: ['l', 'r', 'r', 'r', 'r', 'r'] },
  ];
  if (vRows.length) blocks.push({ type: 'table', headers: ['@th.level', 'Point', 'Value', 'Rules'], rows: vRows, align: ['l', 'r', 'r', 'l'] });
  blocks.push(
    { type: 'chart', chart: { kind: 'control', panel: result.panels[0], yLabel: 'Defectives', xLabel: 'Sample' } },
    { type: 'text', lines: [result.rulesHit.length ? t(lang, 'res.rulesHit', { rules: result.rulesHit.join(', ') }) : t(lang, 'res.rulesNone'), t(lang, 'res.attrNote')] },
  );
  return { subtitle: `${col.name || col.id} · n=${size}`, blocks };
}

function runCChart(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.defects);
  if (!col) throw new Error('dlg.required');
  const counts = countRows(col);
  let result;
  try {
    result = cChart(counts);
  } catch (error) {
    if (error instanceof SpcValidationError) throw new Error(spcIssueText(lang, error.issues));
    throw error;
  }
  const vRows = violationRows(result.panels);
  const blocks: Block[] = [
    { type: 'table', headers: ['@th.level', 'Center', 'UCL', 'LCL', 'Sigma', 'Signals'], rows: chartRows(result.panels), align: ['l', 'r', 'r', 'r', 'r', 'r'] },
  ];
  if (vRows.length) blocks.push({ type: 'table', headers: ['@th.level', 'Point', 'Value', 'Rules'], rows: vRows, align: ['l', 'r', 'r', 'l'] });
  blocks.push(
    { type: 'chart', chart: { kind: 'control', panel: result.panels[0], yLabel: 'Defects', xLabel: 'Sample' } },
    { type: 'text', lines: [result.rulesHit.length ? t(lang, 'res.rulesHit', { rules: result.rulesHit.join(', ') }) : t(lang, 'res.rulesNone'), t(lang, 'res.attrNote')] },
  );
  return { subtitle: col.name || col.id, blocks };
}

function runUChart(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const col = findColumn(sheet, values.defects);
  const sizeCol = findColumn(sheet, values.unitSizes);
  if (!col) throw new Error('dlg.required');
  const counts = countRows(col);
  const constSize = Math.round(num(values.unitSize, 1));
  const sizes = sizeCol ? countRows(sizeCol) : counts.map(() => constSize);
  let result;
  try {
    result = uChart(counts, sizes);
  } catch (error) {
    if (error instanceof SpcValidationError) throw new Error(spcIssueText(lang, error.issues));
    throw error;
  }
  const vRows = violationRows(result.panels);
  const blocks: Block[] = [
    { type: 'table', headers: ['@th.level', 'Center', 'UCL', 'LCL', 'Sigma', 'Signals'], rows: chartRows(result.panels), align: ['l', 'r', 'r', 'r', 'r', 'r'] },
  ];
  if (vRows.length) blocks.push({ type: 'table', headers: ['@th.level', 'Point', 'Value', 'Rules'], rows: vRows, align: ['l', 'r', 'r', 'l'] });
  blocks.push(
    { type: 'chart', chart: { kind: 'control', panel: result.panels[0], yLabel: 'Defects per unit', xLabel: 'Sample' } },
    { type: 'text', lines: [result.rulesHit.length ? t(lang, 'res.rulesHit', { rules: result.rulesHit.join(', ') }) : t(lang, 'res.rulesNone'), t(lang, 'res.attrNote')] },
  );
  return { subtitle: col.name || col.id, blocks };
}

/* ── P2: Weibull reliability ──────────────────────────────────────────── */

function runWeibull(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const timeCol = findColumn(sheet, values.time);
  const censorCol = findColumn(sheet, values.censor);
  if (!timeCol) throw new Error('dlg.required');
  const censoredIsOne = str(values.censorCode) !== '0=censored';
  const rows: WeibullInput[] = [];
  const total = rowCount(sheet);
  for (let r = 0; r < total; r += 1) {
    const time = timeCol.values[r];
    if (typeof time !== 'number' || !isFinite(time) || time <= 0) continue;
    let censored = false;
    if (censorCol) {
      const raw = censorCol.values[r];
      if (raw === null || raw === undefined || raw === '') continue;
      const code = typeof raw === 'number' ? raw : Number(raw);
      if (!isFinite(code)) continue;
      censored = censoredIsOne ? code === 1 : code === 0;
    }
    rows.push({ time, censored });
  }
  const result = fitWeibull(rows, conf(values.confidence));
  // Lognormal alternative on the same right-censored sample, for comparison.
  let lognormal: LognormalReliability | null = null;
  try {
    lognormal = fitLognormalReliability(rows);
  } catch {
    lognormal = null;
  }
  const z = normalInv((1 + conf(values.confidence)) / 2);
  const bandText = {
    above10: t(lang, 'res.adAbove10'),
    between05and10: t(lang, 'res.ad0510'),
    between01and05: t(lang, 'res.ad0105'),
    below01: t(lang, 'res.adBelow01'),
  }[result.band];
  const estimateRows: (string | number)[][] = [
    [t(lang, 'res.shape'), fmt(result.shape, 5), fmt(result.seShape, 5), `${fmt(result.ciShape[0], 4)}  ${fmt(result.ciShape[1], 4)}`],
    [t(lang, 'res.scale'), fmt(result.scale, 5), fmt(result.seScale, 5), `${fmt(result.ciScale[0], 4)}  ${fmt(result.ciScale[1], 4)}`],
    ['MTTF', fmt(result.mttf, 5), Number.isFinite(result.mttfCi[0]) ? fmt((result.mttfCi[1] - result.mttfCi[0]) / 2, 5) : '—', `${fmt(result.mttfCi[0], 4)}  ${fmt(result.mttfCi[1], 4)}`],
    ['B50 (median)', fmt(result.median, 5), '—', '—'],
    ['B10', fmt(result.b10, 5), '—', '—'],
    ['B5', fmt(result.b5, 5), '—', '—'],
    ['B90', fmt(result.b90, 5), '—', '—'],
  ];
  const xLo = Math.min(...result.points.map((p) => p.x));
  const xHi = Math.max(...result.points.map((p) => p.x));
  const ticks = logTicks(Math.exp(xLo), Math.exp(xHi));
  const bandLevel = conf(values.confidence);
  const ciPoints: { x: number; lo: number; hi: number }[] = [];
  for (let i = 0; i <= 30; i += 1) {
    const x = xLo + ((xHi - xLo) * i) / 30;
    const band = result.ciBand(x, bandLevel);
    ciPoints.push({ x, lo: band[0], hi: band[1] });
  }
  const maxTime = Math.max(...rows.map((r) => r.time));
  const survivalPoints: { x: number; y: number }[] = [];
  const hazardPoints: { x: number; y: number }[] = [];
  for (let i = 0; i <= 60; i += 1) {
    const t = (maxTime * 2.2 * i) / 60;
    survivalPoints.push({ x: t, y: result.survival(t) });
    hazardPoints.push({ x: t, y: result.hazard(t) });
  }
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        t(lang, 'res.weibullInfo', { n: result.n, failures: result.failures, censored: result.censored }),
        t(lang, 'res.weibullMethod'),
      ],
    },
    {
      type: 'table',
      title: t(lang, 'res.distributionFitLevel', { level: `${(conf(values.confidence) * 100).toFixed(0)}%` }),
      headers: ['@th.parameter', '@th.estimate', '@th.seCoef', `@th.ci`],
      rows: estimateRows,
      align: ['l', 'r', 'r', 'r'],
    },
    {
      // Complete data: the tabulated AD* critical values apply, so the band and
      // its p-range are reported. Right-censored data: A²/A* are computed on the
      // failure times only and the complete-data critical values are NOT valid
      // there, so they and the p-range verdict are withheld; the p-value comes
      // from the censoring-aware parametric bootstrap and the KM deviation.
      type: 'table',
      title: tableTitle('res.adTest'),
      headers: ['@th.statistic', '@th.value'],
      rows: result.adBasis === 'complete'
        ? [
          ['AD', fmt(result.ad, 4)],
          ['AD*', fmt(result.adAdjusted, 4)],
          [t(lang, 'res.adCritical'), '0.637 / 0.757 / 1.038'],
          [t(lang, 'res.adConclusion'), bandText],
          [t(lang, 'res.adBasis'), t(lang, 'res.adBasisComplete')],
          ['Log-likelihood', fmt(result.logLik, 3)],
        ]
        : [
          [t(lang, 'res.adFailuresRef'), fmt(result.ad, 4)],
          [t(lang, 'res.adStarFailuresRef'), fmt(result.adAdjusted, 4)],
          [t(lang, 'res.adBootstrapP', { reps: fmtInt(result.adBootstrapReps) }), fmt(result.adBootstrapP, 4)],
          [t(lang, 'res.kmDev'), `${fmt(result.kmDev, 4)}  (${t(lang, 'res.kmCritical')} ${fmt(result.kmCritical05, 4)})`],
          [t(lang, 'res.adBasis'), t(lang, 'res.adBasisFailures')],
          ['Log-likelihood', fmt(result.logLik, 3)],
        ],
      align: ['l', 'r'],
      caption: result.adBasis === 'failures' ? t(lang, 'res.adCensoredNote') : undefined,
    },
    {
      type: 'chart',
      chart: {
        kind: 'probplot',
        points: result.points.map((p) => ({ x: p.x, y: p.y })),
        fit: { intercept: -result.shape * Math.log(result.scale), slope: result.shape },
        ci: ciPoints,
        xLabel: `ln(${timeCol.name || timeCol.id})`,
        yLabel: t(lang, 'res.percent'),
        xTicks: ticks,
        note: `β = ${fmt(result.shape, 3)}   η = ${fmt(result.scale, 3)}   ${(bandLevel * 100).toFixed(0)}% band`,
        height: 300,
      },
    },
    ...(lognormal
      ? [{
        type: 'table' as const,
        title: tableTitle('res.lognormalFit'),
        headers: ['@th.parameter', '@th.estimate'],
        rows: [
          ['μ (ln)', fmt(lognormal.mu, 5)],
          ['σ (ln)', fmt(lognormal.sigma, 5)],
          [t(lang, 'res.medianLife'), fmt(lognormal.median, 5)],
          ['MTTF', fmt(lognormal.mttf, 5)],
          [t(lang, 'res.failuresCount'), fmtInt(lognormal.failures)],
          [t(lang, 'res.censoredCount'), `${fmtInt(lognormal.censored)}  (${fmt(lognormal.censoredPct, 1)}%)`],
          ['Log-likelihood', fmt(lognormal.logLik, 3)],
        ],
        caption: t(lang, 'res.lognormalFitNote'),
      }]
      : []),
    {
      type: 'chartgrid',
      charts: [
        {
          title: '@chart.survival',
          chart: {
            kind: 'line',
            series: [{ label: 'R(t)', points: survivalPoints }],
            xLabel: timeCol.name || 'Time',
            yLabel: 'Survival',
            height: 230,
          },
        },
        {
          title: '@chart.hazard',
          chart: { kind: 'line', series: [{ label: 'h(t)', points: hazardPoints }], xLabel: timeCol.name || 'Time', yLabel: 'Hazard', height: 230 },
        },
      ],
    },
    { type: 'text', lines: [t(lang, 'res.weibullNote', { z: fmt(z, 3) })] },
  ];
  return { subtitle: timeCol.name || timeCol.id, blocks };
}

/* ── P2: general linear model (multi-factor ANOVA) ────────────────────── */

function factorFromColumn(col: Column): ModelFactor {
  return {
    name: col.name || col.id,
    kind: col.type === 'numeric' ? 'numeric' : 'categorical',
    values: col.values,
  };
}

function levelsOf(factor: ModelFactor, levels: Record<string, string[]>): string[] {
  if (factor.kind === 'categorical') return levels[factor.name] ?? [];
  const unique = [...new Set(factor.values.filter((v): v is number => typeof v === 'number' && isFinite(v)))].sort((a, b) => a - b);
  return unique.map((v) => String(v));
}

function mainEffectChart(factor: ModelFactor, y: (number | null)[], levels: Record<string, string[]>, grand: number, title: string, lang: Lang): { title: string; chart: ChartSpec } {
  const lv = levelsOf(factor, levels);
  const cells = cellMeans(y, [factor]);
  const points = lv.map((level, index) => {
    const cell = cells.find((c) => c.keys[0] === level);
    return { x: index, y: cell ? cell.mean : NaN };
  }).filter((p) => isFinite(p.y));
  return {
    title,
    chart: {
      kind: 'line',
      series: [{ label: factor.name, points }],
      xLabels: lv,
      yLabel: t(lang, 'res.mean'),
      refLines: isFinite(grand) ? [{ y: grand }] : undefined,
      height: 220,
    },
  };
}

function interactionChart(a: ModelFactor, b: ModelFactor, y: (number | null)[], levels: Record<string, string[]>, lang: Lang): { title: string; chart: ChartSpec } {
  const aLevels = levelsOf(a, levels);
  const bLevels = levelsOf(b, levels);
  const cells = cellMeans(y, [a, b]);
  const series = bLevels.map((bLevel, index) => ({
    label: bLevel,
    color: index,
    points: aLevels.map((aLevel, ai) => {
      const cell = cells.find((c) => c.keys[0] === aLevel && c.keys[1] === bLevel);
      return { x: ai, y: cell ? cell.mean : NaN };
    }).filter((p) => isFinite(p.y)),
  })).filter((s) => s.points.length);
  return {
    title: `${a.name} × ${b.name}`,
    chart: { kind: 'line', series, xLabels: aLevels, xLabel: a.name, yLabel: t(lang, 'res.mean'), height: 220 },
  };
}

function runGlm(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const response = findColumn(sheet, values.response);
  const refs = (values.factors as string[]) ?? [];
  const columns = refs.map((ref) => findColumn(sheet, ref)).filter((c): c is Column => Boolean(c));
  if (!response) throw new Error('dlg.required');
  if (columns.length < 2) throw new Error('res.needFactors');
  const factors = columns.map(factorFromColumn);
  const yValues = response.values.map((v) => (typeof v === 'number' ? v : null));
  const terms: ModelTerm[] = factors.map((f) => ({ name: f.name, factors: [f.name] }));
  if (bool(values.interactions, true)) {
    for (let i = 0; i < factors.length; i += 1) {
      for (let j = i + 1; j < factors.length; j += 1) {
        terms.push({ name: `${factors[i].name}×${factors[j].name}`, factors: [factors[i].name, factors[j].name] });
      }
    }
  }
  let glm;
  try {
    glm = fitGlm(yValues, factors, terms);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'glm.noDf' || code === 'glm.noData') throw new Error('res.groupTooSmall');
    throw error;
  }
  const anovaRows: (string | number)[][] = glm.terms.map((term) => [
    term.name,
    fmtInt(term.df),
    fmt(term.ssSeq),
    fmt(term.ssAdj),
    Number.isFinite(term.msAdj) ? fmt(term.msAdj) : '—',
    Number.isFinite(term.f) ? fmt(term.f) : '—',
    Number.isFinite(term.p) ? fmtP(term.p) : '—',
  ]);
  anovaRows.push([t(lang, '@th.error'), fmtInt(glm.dfe), fmt(glm.sse), fmt(glm.sse), fmt(glm.mse), '—', '—']);
  anovaRows.push([t(lang, '@th.total'), fmtInt(glm.dfe + glm.rank - 1), fmt(glm.ssTotal), '—', '—', '—', '—']);
  const coefRows = glm.labels.map((label, i) => [
    label,
    fmt(glm.beta[i], 5),
    Number.isFinite(glm.se[i]) ? fmt(glm.se[i], 5) : '—',
    Number.isFinite(glm.t[i]) ? fmt(glm.t[i], 3) : '—',
    Number.isFinite(glm.p[i]) ? fmtP(glm.p[i]) : '—',
  ]);
  const grand = mean(clean(yValues));
  const charts: { title: string; chart: ChartSpec }[] = factors.map((factor) => mainEffectChart(factor, yValues, glm.design.levels, grand, factor.name, lang));
  if (bool(values.interactions, true)) {
    for (let i = 0; i < factors.length; i += 1) {
      for (let j = i + 1; j < factors.length; j += 1) charts.push(interactionChart(factors[i], factors[j], yValues, glm.design.levels, lang));
    }
  }
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        t(lang, 'res.glmInfo', { response: response.name || response.id, factors: factors.map((f) => f.name).join(', '), n: glm.n }),
        t(lang, 'res.glmTypeNote'),
        glm.aliased.length ? t(lang, 'res.glmAliased', { terms: glm.aliased.join(', ') }) : '',
        glm.aliased.length ? t(lang, 'res.glmAliasedNote') : '',
      ].filter(Boolean),
    },
    {
      type: 'table',
      title: tableTitle('res.anovaTable'),
      headers: ['@th.source', '@th.df', '@th.ssTypeI', '@th.ssTypeIII', '@th.ms', '@th.f', '@th.p'],
      rows: anovaRows,
      align: ['l', 'r', 'r', 'r', 'r', 'r', 'r'],
    },
    {
      type: 'table',
      title: tableTitle('res.modelSummary'),
      headers: ['@th.statistic', '@th.value'],
      rows: [
        ['S', fmt(glm.s)],
        ['R²', `${(glm.r2 * 100).toFixed(2)}%`],
        ['R²(adj)', `${(glm.r2adj * 100).toFixed(2)}%`],
        ['N', fmtInt(glm.n)],
      ],
      align: ['l', 'r'],
    },
    {
      type: 'table',
      title: tableTitle('res.coefficients'),
      headers: ['@th.term', '@th.coef', '@th.seCoef', '@th.t', '@th.p'],
      rows: coefRows,
      align: ['l', 'r', 'r', 'r', 'r'],
      caption: t(lang, 'res.glmCodingNote'),
    },
    { type: 'chartgrid', charts },
  ];
  return { subtitle: `${response.name || response.id} · ${factors.map((f) => f.name).join(' × ')}`, blocks };
}

/* ── P2: DOE ──────────────────────────────────────────────────────────── */

function designTable(runs: { std: number; run: number; ptType: string; levels: number[] }[], names: string[]): Block {
  // Shown in RUN order, matching the worksheet the design was written to.
  const ordered = [...runs].sort((a, b) => a.run - b.run);
  return {
    type: 'table',
    title: tableTitle('res.designMatrix'),
    headers: ['StdOrder', 'RunOrder', 'PtType', ...names],
    rows: ordered.map((run) => [fmtInt(run.std), fmtInt(run.run), run.ptType, ...run.levels.map((v) => fmt(v, 2))]),
    align: ['r', 'r', 'l', ...names.map(() => ('r' as const))],
  };
}

function runDoeCreate(ctx: RunContext): RunResult {
  const { values, lang } = ctx;
  const k = Math.round(num(values.factors, 3));
  const centers = Math.max(0, Math.round(num(values.centers, 0)));
  const replicates = Math.max(1, Math.round(num(values.replicates, 1)));
  const randomize = bool(values.randomize, true);
  const seed = Math.round(num(values.seed, 20261122));
  const runs = factorialDesign(k, centers, replicates, randomize, seed);
  const names = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, k);
  const sheet = designWorksheet(runs, names, `2^${k} Design`);
  return {
    subtitle: `2^${k} · ${runs.length} runs`,
    newSheet: sheet,
    blocks: [
      {
        type: 'text',
        lines: [
          t(lang, 'res.designCreated', { k, runs: runs.length, centers, replicates, order: randomize ? t(lang, 'res.randomOrder') : t(lang, 'res.standardOrder') }),
          t(lang, 'res.designCodedNote'),
          t(lang, 'res.designYNote'),
        ],
      },
      designTable(runs, names),
    ],
  };
}

function runDoeAnalyze(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const response = findColumn(sheet, values.response);
  const refs = (values.factors as string[]) ?? [];
  const columns = refs.map((ref) => findColumn(sheet, ref)).filter((c): c is Column => Boolean(c));
  if (!response) throw new Error('dlg.required');
  if (columns.length < 2) throw new Error('res.needFactors');
  const order = Math.max(1, Math.min(3, Math.round(num(values.order, 2))));
  const factors = columns.map(factorFromColumn);
  const yValues = response.values.map((v) => (typeof v === 'number' ? v : null));
  let analysis;
  try {
    analysis = analyzeFactorial(yValues, factors, order);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'glm.noDf' || code === 'glm.noData') throw new Error('res.doeNoDf');
    throw error;
  }
  const glm = analysis.glm;
  const effectRows = analysis.effects.map((e) => [
    e.term,
    fmt(e.effect, 4),
    fmt(e.coef, 4),
    Number.isFinite(e.se) ? fmt(e.se, 4) : '—',
    Number.isFinite(e.t) ? fmt(e.t, 3) : '—',
    Number.isFinite(e.p) ? fmtP(e.p) : '—',
  ]);
  const anovaRows: (string | number)[][] = glm.terms.map((term) => [
    term.name,
    fmtInt(term.df),
    fmt(term.ssSeq),
    fmt(term.ssAdj),
    Number.isFinite(term.msAdj) ? fmt(term.msAdj) : '—',
    Number.isFinite(term.f) ? fmt(term.f) : '—',
    Number.isFinite(term.p) ? fmtP(term.p) : '—',
  ]);
  anovaRows.push([t(lang, '@th.error'), fmtInt(glm.dfe), fmt(glm.sse), fmt(glm.sse), fmt(glm.mse), '—', '—']);
  anovaRows.push([t(lang, '@th.total'), fmtInt(glm.dfe + glm.rank - 1), fmt(glm.ssTotal), '—', '—', '—', '—']);
  const tCrit = tInv(1 - 0.025, glm.dfe);
  const paretoItems = analysis.effects
    .filter((e) => isFinite(e.t))
    .map((e) => ({ label: e.term, value: Math.abs(e.t) }))
    .sort((a, b) => b.value - a.value);
  const halfNormal = analysis.effects
    .filter((e) => isFinite(e.effect))
    .map((e) => Math.abs(e.effect))
    .sort((a, b) => a - b)
    .map((value, i, arr) => ({ x: value, y: normalInv(0.5 + 0.5 * ((i + 1 - 0.375) / (arr.length + 0.25))) }));
  const grand = mean(clean(yValues));
  const charts: { title: string; chart: ChartSpec }[] = [
    { title: '@chart.paretoEffects', chart: { kind: 'bar', items: paretoItems, yLabel: '|t|', refLine: { y: tCrit, label: `t ${fmt(tCrit, 2)}` }, decimals: 2, height: 240 } },
    {
      title: '@chart.halfNormal',
      chart: {
        kind: 'probplot',
        points: halfNormal,
        fit: { intercept: 0, slope: 0 },
        curve: halfNormal.length > 1 ? [{ x: 0, y: 0 }, { x: Math.max(...halfNormal.map((p) => p.x)), y: normalInv(0.5 + 0.5 * (halfNormal.length - 0.375) / (halfNormal.length + 0.25)) }] : undefined,
        xLabel: '|Effect|',
        yLabel: t(lang, 'res.percent'),
        yTicks: [10, 30, 50, 70, 90].map((p) => ({ v: normalInv(0.5 + 0.5 * p / 100), label: String(p) })),
        height: 240,
      },
    },
    ...factors.map((factor) => mainEffectChart(factor, yValues, glm.design.levels, grand, factor.name, lang)),
  ];
  for (let i = 0; i < factors.length; i += 1) {
    for (let j = i + 1; j < factors.length; j += 1) charts.push(interactionChart(factors[i], factors[j], yValues, glm.design.levels, lang));
  }
  return {
    subtitle: `${response.name || response.id} · 2^${factors.length}`,
    blocks: [
      { type: 'text', lines: [t(lang, 'res.doeAnalysisInfo', { response: response.name || response.id, order, n: glm.n }), t(lang, 'res.effectNote')] },
      { type: 'table', title: tableTitle('res.effectsTable'), headers: ['@th.term', '@th.effect', '@th.coef', '@th.seCoef', '@th.t', '@th.p'], rows: effectRows, align: ['l', 'r', 'r', 'r', 'r', 'r'] },
      { type: 'table', title: tableTitle('res.anovaTable'), headers: ['@th.source', '@th.df', '@th.ssTypeI', '@th.ssTypeIII', '@th.ms', '@th.f', '@th.p'], rows: anovaRows, align: ['l', 'r', 'r', 'r', 'r', 'r', 'r'] },
      {
        type: 'table',
        title: tableTitle('res.modelSummary'),
        headers: ['@th.statistic', '@th.value'],
        rows: [['S', fmt(glm.s)], ['R²', `${(glm.r2 * 100).toFixed(2)}%`], ['R²(adj)', `${(glm.r2adj * 100).toFixed(2)}%`], ['N', fmtInt(glm.n)]],
        align: ['l', 'r'],
      },
      { type: 'chartgrid', charts },
    ],
  };
}

function runRsmCreate(ctx: RunContext): RunResult {
  const { values, lang } = ctx;
  const kind = str(values.design) === 'bbd' ? 'bbd' : 'ccd';
  const centers = Math.max(1, Math.round(num(values.centers, 5)));
  const randomize = bool(values.randomize, true);
  const seed = Math.round(num(values.seed, 20261122));
  const runs = kind === 'bbd'
    ? boxBehnkenDesign(centers, randomize, seed)
    : ccdDesign(Math.max(2, Math.min(5, Math.round(num(values.factors, 2)))), centers, randomize, seed);
  const k = runs[0]?.levels.length ?? 2;
  const names = ['A', 'B', 'C', 'D', 'E'].slice(0, k);
  const sheet = designWorksheet(runs, names, kind === 'bbd' ? 'Box-Behnken' : 'CCD');
  return {
    subtitle: `${kind.toUpperCase()} · ${runs.length} runs`,
    newSheet: sheet,
    blocks: [
      {
        type: 'text',
        lines: [
          t(lang, 'res.rsmCreated', { design: kind === 'bbd' ? 'Box–Behnken' : 'Central composite', runs: runs.length, centers, order: randomize ? t(lang, 'res.randomOrder') : t(lang, 'res.standardOrder') }),
          t(lang, 'res.designCodedNote'),
          t(lang, 'res.designYNote'),
        ],
      },
      designTable(runs, names),
    ],
  };
}

function runRsmAnalyze(ctx: RunContext): RunResult {
  const { sheet, values, lang } = ctx;
  const response = findColumn(sheet, values.response);
  const refs = (values.factors as string[]) ?? [];
  const columns = refs.map((ref) => findColumn(sheet, ref)).filter((c): c is Column => Boolean(c));
  if (!response) throw new Error('dlg.required');
  if (columns.length < 2) throw new Error('res.needFactors');
  const factors = columns.map(factorFromColumn);
  const yValues = response.values.map((v) => (typeof v === 'number' ? v : null));
  let analysis;
  try {
    analysis = analyzeRsm(yValues, factors);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'glm.noDf' || code === 'glm.noData') throw new Error('res.doeNoDf');
    throw error;
  }
  const glm = analysis.glm;
  const modelF = isFinite(glm.mse) && glm.mse > 0 ? (glm.ssModel / Math.max(1, glm.dfModel)) / glm.mse : NaN;
  const modelP = isFinite(modelF) ? fmtP(1 - fCdf(modelF, glm.dfModel, glm.dfe)) : '—';
  const anovaRows: (string | number)[][] = [
    [t(lang, 'res.model'), fmtInt(glm.dfModel), fmt(glm.ssModel), fmt(glm.ssModel), fmt(glm.ssModel / Math.max(1, glm.dfModel)), isFinite(modelF) ? fmt(modelF) : '—', modelP],
    [t(lang, 'res.linear'), fmtInt(analysis.linear.df), fmt(analysis.linear.ss), fmt(analysis.linear.ss), '—', '—', '—'],
    [t(lang, 'res.square'), fmtInt(analysis.square.df), fmt(analysis.square.ss), fmt(analysis.square.ss), '—', '—', '—'],
    [t(lang, 'res.interactionTerm'), fmtInt(analysis.interaction.df), fmt(analysis.interaction.ss), fmt(analysis.interaction.ss), '—', '—', '—'],
    [t(lang, '@th.error'), fmtInt(glm.dfe), fmt(glm.sse), fmt(glm.sse), fmt(glm.mse), '—', '—'],
    [t(lang, 'res.total'), fmtInt(glm.dfe + glm.rank - 1), fmt(glm.ssTotal), '—', '—', '—', '—'],
  ];
  if (analysis.pureError) {
    anovaRows.splice(5, 0, [
      t(lang, 'res.lackOfFit'),
      fmtInt(analysis.lackOfFit?.df ?? 0),
      fmt(analysis.lackOfFit?.ss ?? 0),
      fmt(analysis.lackOfFit?.ss ?? 0),
      fmt(analysis.lackOfFit?.ms ?? 0),
      Number.isFinite(analysis.lackOfFit?.f ?? NaN) ? fmt(analysis.lackOfFit?.f ?? 0) : '—',
      Number.isFinite(analysis.lackOfFit?.p ?? NaN) ? fmtP(analysis.lackOfFit?.p ?? 0) : '—',
    ]);
    anovaRows.splice(6, 0, [t(lang, 'res.pureError'), fmtInt(analysis.pureError.df), fmt(analysis.pureError.ss), fmt(analysis.pureError.ss), fmt(analysis.pureError.ms), '—', '—']);
  }
  const coefRows = glm.labels.map((label, i) => [
    label,
    fmt(glm.beta[i], 5),
    Number.isFinite(glm.se[i]) ? fmt(glm.se[i], 5) : t(lang, 'res.aliased'),
    Number.isFinite(glm.t[i]) ? fmt(glm.t[i], 3) : '—',
    Number.isFinite(glm.p[i]) ? fmtP(glm.p[i]) : '—',
  ]);
  const grid = contourGrid(glm, factors, 0, 1, 41);
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        t(lang, 'res.rsmInfo', { response: response.name || response.id, factors: factors.map((f) => f.name).join(', '), n: glm.n }),
        t(lang, 'res.rsmModelNote'),
        ...(glm.aliased.length ? [t(lang, 'res.aliasNote', { terms: glm.aliased.join(', ') })] : []),
      ],
    },
    { type: 'table', title: tableTitle('res.anovaTable'), headers: ['@th.source', '@th.df', '@th.ssTypeI', '@th.ssTypeIII', '@th.ms', '@th.f', '@th.p'], rows: anovaRows, align: ['l', 'r', 'r', 'r', 'r', 'r', 'r'] },
    {
      type: 'table',
      title: tableTitle('res.modelSummary'),
      headers: ['@th.statistic', '@th.value'],
      rows: [['S', fmt(glm.s)], ['R²', `${(glm.r2 * 100).toFixed(2)}%`], ['R²(adj)', `${(glm.r2adj * 100).toFixed(2)}%`], ['N', fmtInt(glm.n)]],
      align: ['l', 'r'],
    },
    { type: 'table', title: tableTitle('res.coefficients'), headers: ['@th.term', '@th.coef', '@th.seCoef', '@th.t', '@th.p'], rows: coefRows, align: ['l', 'r', 'r', 'r', 'r'] },
    {
      type: 'table',
      title: tableTitle('res.stationary'),
      headers: ['@th.parameter', '@th.value'],
      rows: analysis.stationary
        ? ([
          ...analysis.stationary.point.map((v, i) => [factors[i].name, fmt(v, 4)] as (string | number)[]),
          [t(lang, 'res.predictedResponse'), fmt(analysis.stationary.response, 4)],
          [t(lang, 'res.stationaryKind'), t(lang, `res.stationary_${analysis.stationary.kind}`)],
          [t(lang, 'res.eigenvalues'), analysis.stationary.eigenvalues.map((v) => fmt(v, 4)).join(', ')],
          ...(analysis.stationary.outsideRegion
            ? [[t(lang, 'res.stationaryOutside'), t(lang, 'res.stationaryOutsideValue', { x: fmt(analysis.stationary.maxAbs, 3) })] as (string | number)[]]
            : []),
        ] as (string | number)[][])
        : [[t(lang, 'res.stationaryKind'), t(lang, 'res.stationaryNone')]],
      align: ['l', 'r'],
      caption: analysis.stationary?.outsideRegion ? t(lang, 'res.stationaryOutsideWarn') : t(lang, 'res.stationaryNote'),
    },
    {
      type: 'chart',
      chart: {
        kind: 'contour',
        xs: grid.xs,
        ys: grid.ys,
        z: grid.z,
        xLabel: factors[0].name,
        yLabel: factors[1].name,
        points: grid.points,
        height: 300,
      },
      caption: t(lang, 'res.contourNote'),
    },
  ];
  return { subtitle: `${response.name || response.id} · RSM`, blocks };
}

/* ── P2: power and sample size ────────────────────────────────────────── */

function runPowerAnalysis(ctx: RunContext, method: PowerMethod): RunResult {
  const { values, lang } = ctx;
  const solveRaw = str(values.solveFor);
  const solveFor: PowerSpec['solveFor'] = solveRaw === 'power' ? 'power' : solveRaw === 'difference' ? 'difference' : 'n';
  const alphaRaw = num(values.alpha, 5);
  const alpha = alphaRaw > 1 ? alphaRaw / 100 : alphaRaw;
  const isProp = method === 'oneProp' || method === 'twoProp';
  const p1 = Math.min(0.9999, Math.max(0.0001, num(values.p1, 0.5)));
  const p2 = Math.min(0.9999, Math.max(0.0001, num(values.p2, 0.6)));
  const spec: PowerSpec = {
    method,
    solveFor,
    alpha: Math.min(0.5, Math.max(1e-6, alpha)),
    alternative: alt(values.alternative),
    sd: Math.max(1e-9, num(values.sd, 1)),
    groups: Math.max(2, Math.round(num(values.groups, 3))),
    p1,
    p2,
  };
  const nText = str(values.n).trim();
  if (nText !== '') spec.n = Math.max(2, Math.round(Number(nText)));
  const powerText = str(values.power).trim();
  const targetPower = powerText === '' ? 0.9 : Math.min(0.9999, Math.max(0.01, Number(powerText) / 100));
  spec.power = targetPower;
  const diffText = str(values.difference).trim();
  const baseDifference = isProp ? p2 - p1 : num(values.difference, 1);
  if (solveFor !== 'difference') {
    // The SIGN is evidence about the alternative: a negative δ under 'greater'
    // must not be silently mirrored into the high-power positive case.
    if (diffText !== '') spec.difference = Number(diffText);
    else if (isProp) spec.difference = baseDifference;
    else if (diffText === '') throw new Error('res.powerNeedDifference');
  }
  if (solveFor === 'n' && spec.difference === undefined) throw new Error('res.powerNeedDifference');
  if (solveFor === 'power' && spec.n === undefined) throw new Error('res.powerNeedN');
  if (solveFor === 'difference' && spec.n === undefined) throw new Error('res.powerNeedN');
  let solution;
  try {
    solution = solvePower(spec);
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'power.unreachable') throw new Error('res.powerUnreachable');
    throw new Error('res.powerFailed');
  }
  const difference = solution.difference;
  const curve = powerCurve({ ...spec, n: solution.n, power: targetPower }, difference, 30);
  const rows: (string | number)[][] = [
    [fmtInt(solution.n), `${(solution.power * 100).toFixed(2)}%`, fmt(difference, 4), `${(solution.alpha * 100).toFixed(2)}%`],
  ];
  const notes: string[] = [t(lang, 'res.powerMethod', { method: t(lang, `power.${method}`) })];
  if (isProp) {
    notes.push(t(lang, 'res.powerPropApprox'));
    const comparison = p1 + difference;
    notes.push(t(lang, 'res.powerProportions', { p1: fmt(p1, 3), p2: fmt(comparison, 3) }));
  }
  if (solution.power < alpha + 1e-12 && solveFor === 'power') notes.push(t(lang, 'res.powerBelowAlpha'));
  if (solution.oppositeDifference !== undefined && solveFor === 'difference') {
    // p₀ away from 0.5 leaves the two directions of a two-sided test unequal: the
    // table shows the smaller |d|, and the other direction's threshold is here.
    const opposite = p1 + solution.oppositeDifference;
    notes.push(t(lang, 'res.powerOppositeDifference', {
      difference: `${solution.oppositeDifference > 0 ? '+' : ''}${fmt(solution.oppositeDifference, 4)}`,
      p: fmt(opposite, 3),
      power: `${(solution.power * 100).toFixed(1)}%`,
    }));
  }
  if (method === 'anova') notes.push(t(lang, 'res.powerAnovaAssumption', { groups: spec.groups ?? 2 }));
  if (method === 'twoT') notes.push(t(lang, 'res.powerTwoSampleNote'));
  if (method === 'paired') notes.push(t(lang, 'res.powerPairedNote'));
  if (solveFor === 'n') notes.push(t(lang, 'res.powerSolvedN'));
  if (solveFor === 'power') notes.push(t(lang, 'res.powerSolvedPower'));
  if (solveFor === 'difference') notes.push(t(lang, 'res.powerSolvedDifference'));
  return {
    subtitle: t(lang, `power.${method}`),
    blocks: [
      { type: 'text', lines: notes },
      {
        type: 'table',
        title: tableTitle('res.powerTable'),
        headers: ['@th.n', '@th.power', '@th.difference', '@th.alpha'],
        rows,
        align: ['r', 'r', 'r', 'r'],
      },
      {
        type: 'chart',
        chart: {
          kind: 'line',
          series: [{ label: t(lang, '@th.power'), points: curve.map((p) => ({ x: p.n, y: p.power })) }],
          xLabel: t(lang, 'res.sampleSizeAxis'),
          yLabel: t(lang, '@th.power'),
          refLines: [{ y: targetPower, label: `${(targetPower * 100).toFixed(0)}%` }],
          markers: solveFor === 'n' ? [{ x: solution.n, y: solution.power, label: `n ${solution.n}` }] : undefined,
          height: 250,
        },
      },
    ],
  };
}

/* ── registry ─────────────────────────────────────────────────────────── */

const confidenceSlot: SlotDef = { key: 'confidence', label: 'slot.confidence', kind: 'num', group: 'options', defaultValue: 95, min: 50, max: 99.99, step: 0.1 };
const altSlot: SlotDef = {
  key: 'alternative',
  label: 'slot.alternative',
  kind: 'select',
  group: 'options',
  defaultValue: 'two-sided',
  options: [
    { value: 'two-sided', label: 'alt.two-sided' },
    { value: 'less', label: 'alt.less' },
    { value: 'greater', label: 'alt.greater' },
  ],
};

export const ANALYSES: AnalysisDef[] = [
  {
    id: 'desc',
    titleKey: 'an.desc',
    slots: [
      { key: 'variables', label: 'slot.variables', kind: 'vars', required: true },
      { key: 'by', label: 'slot.by', kind: 'vars' },
    ],
    run: runDescriptive,
  },
  {
    id: 'normality',
    titleKey: 'an.normality',
    slots: [{ key: 'variable', label: 'slot.variable', kind: 'col', required: true }],
    run: runNormality,
  },
  {
    id: 't1',
    titleKey: 'an.t1',
    slots: [
      { key: 'variable', label: 'slot.variable', kind: 'col', required: true },
      { key: 'hypMean', label: 'slot.hypMean', kind: 'num', defaultValue: 0 },
      confidenceSlot,
      altSlot,
      { key: 'chart', label: 'opt.normalCurve', kind: 'check', group: 'graphs', defaultValue: true },
    ],
    run: runT1,
  },
  {
    id: 't2',
    titleKey: 'an.t2',
    slots: [
      { key: 'sample1', label: 'slot.variable', kind: 'col', required: true },
      { key: 'sample2', label: 'slot.column2', kind: 'col', required: true },
      confidenceSlot,
      altSlot,
      { key: 'welch', label: 'opt.welch', kind: 'check', group: 'options', defaultValue: true },
      { key: 'chart', label: 'opt.boxplot', kind: 'check', group: 'graphs', defaultValue: true },
    ],
    run: runT2,
  },
  {
    id: 'paired',
    titleKey: 'an.paired',
    slots: [
      { key: 'first', label: 'slot.variable', kind: 'col', required: true },
      { key: 'second', label: 'slot.column2', kind: 'col', required: true },
      { key: 'testDiff', label: 'slot.testDiff', kind: 'num', group: 'options', defaultValue: 0 },
      confidenceSlot,
      altSlot,
      { key: 'chart', label: 'opt.normalCurve', kind: 'check', group: 'graphs', defaultValue: true },
    ],
    run: runPaired,
  },
  {
    id: 'anova',
    titleKey: 'an.anova',
    slots: [
      { key: 'response', label: 'slot.response', kind: 'col', required: true },
      { key: 'factor', label: 'slot.variable', kind: 'col', required: true },
      confidenceSlot,
    ],
    run: runAnova,
  },
  {
    id: 'regression',
    titleKey: 'an.regression',
    slots: [
      { key: 'response', label: 'slot.response', kind: 'col', required: true },
      { key: 'predictors', label: 'slot.predictors', kind: 'vars', required: true },
      { key: 'fourInOne', label: 'opt.fourInOne', kind: 'check', group: 'graphs', defaultValue: true },
    ],
    run: runRegression,
  },
  {
    id: 'imr',
    titleKey: 'an.imr',
    slots: [{ key: 'variable', label: 'slot.variable', kind: 'col', required: true }],
    run: runImr,
  },
  {
    id: 'xbarr',
    titleKey: 'an.xbarr',
    slots: [
      { key: 'variable', label: 'slot.variable', kind: 'col', required: true },
      { key: 'subgroup', label: 'slot.subgroup', kind: 'num', group: 'options', defaultValue: 5, min: 2, max: 10, step: 1 },
    ],
    run: runXbarR,
  },
  {
    id: 'pchart',
    titleKey: 'an.pchart',
    slots: [
      { key: 'defects', label: 'slot.defects', kind: 'col', required: true },
      { key: 'sizes', label: 'slot.sampleSize', kind: 'col' },
      { key: 'sampleSize', label: 'slot.subgroup', kind: 'num', group: 'options', defaultValue: 100, min: 1, step: 1 },
    ],
    run: runPChart,
  },
  {
    id: 'capability',
    titleKey: 'an.capability',
    slots: [
      { key: 'variable', label: 'slot.variable', kind: 'col', required: true },
      { key: 'lsl', label: 'slot.lsl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'usl', label: 'slot.usl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'target', label: 'slot.target', kind: 'text', group: 'options', defaultValue: '' },
      {
        key: 'sigmaMethod',
        label: 'slot.sigmaMethod',
        kind: 'select',
        group: 'options',
        defaultValue: 'z_bench_shift',
        options: [
          { value: 'z_bench_shift', label: 'sigma.zBenchShift' },
          { value: 'z_bench', label: 'sigma.zBench' },
          { value: 'cpk_shift', label: 'sigma.cpkShift' },
        ],
      },
      { key: 'subgroup', label: 'slot.subgroup', kind: 'num', group: 'options', defaultValue: 1, min: 1, max: 10, step: 1 },
    ],
    run: runCapability,
  },
  {
    id: 'pareto',
    titleKey: 'an.pareto',
    slots: [{ key: 'category', label: 'slot.variable', kind: 'col', required: true }],
    run: runPareto,
  },
  {
    id: 'histogram',
    titleKey: 'an.histogram',
    slots: [
      { key: 'variable', label: 'slot.variable', kind: 'col', required: true },
      { key: 'bins', label: 'slot.bins', kind: 'num', group: 'options', defaultValue: 0, min: 0, max: 50, step: 1 },
      { key: 'lsl', label: 'slot.lsl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'usl', label: 'slot.usl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'target', label: 'slot.target', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'normal', label: 'opt.normalCurve', kind: 'check', group: 'graphs', defaultValue: true },
    ],
    run: runHistogram,
  },
  {
    id: 'boxplot',
    titleKey: 'an.boxplot',
    slots: [
      { key: 'variables', label: 'slot.variables', kind: 'vars', required: true },
      { key: 'by', label: 'slot.by', kind: 'vars' },
    ],
    run: runBoxplot,
  },
  {
    id: 'scatter',
    titleKey: 'an.scatter',
    slots: [
      { key: 'y', label: 'slot.response', kind: 'col', required: true },
      { key: 'x', label: 'slot.variable', kind: 'col', required: true },
      { key: 'by', label: 'slot.by', kind: 'vars' },
    ],
    run: runScatter,
  },
  {
    id: 'timeseries',
    titleKey: 'an.timeseries',
    slots: [
      { key: 'variable', label: 'slot.variable', kind: 'col', required: true },
      { key: 'lsl', label: 'slot.lsl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'usl', label: 'slot.usl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'target', label: 'slot.target', kind: 'text', group: 'options', defaultValue: '' },
    ],
    run: runTimeseries,
  },
  {
    id: 'calculator',
    titleKey: 'an.calculator',
    slots: [
      { key: 'formula', label: 'slot.formula', kind: 'text', required: true, defaultValue: 'C1 * 2 + 1' },
      { key: 'storeIn', label: 'slot.storeIn', kind: 'text', defaultValue: 'Result' },
    ],
    run: runCalculator,
  },
  {
    id: 'random',
    titleKey: 'an.random',
    slots: [
      {
        key: 'distribution',
        label: 'slot.distribution',
        kind: 'select',
        defaultValue: 'normal',
        options: [
          { value: 'normal', label: 'rand.normal' },
          { value: 'uniform', label: 'rand.uniform' },
          { value: 'integer', label: 'rand.integer' },
        ],
      },
      { key: 'count', label: 'slot.count', kind: 'num', defaultValue: 30, min: 1, max: 5000, step: 1 },
      { key: 'mean', label: 'slot.mean', kind: 'num', group: 'options', defaultValue: 0 },
      { key: 'sd', label: 'slot.sd', kind: 'num', group: 'options', defaultValue: 1, min: 0 },
      { key: 'min', label: 'slot.min', kind: 'num', group: 'options', defaultValue: 0 },
      { key: 'max', label: 'slot.max', kind: 'num', group: 'options', defaultValue: 10 },
      { key: 'seed', label: 'slot.seed', kind: 'num', group: 'options', defaultValue: 20261121 },
      { key: 'storeIn', label: 'slot.storeIn', kind: 'text', group: 'options', defaultValue: 'Random data' },
    ],
    run: runRandom,
  },
  {
    id: 'sort',
    titleKey: 'an.sort',
    slots: [
      { key: 'column', label: 'slot.sortBy', kind: 'col', required: true },
      { key: 'descending', label: 'opt.descending', kind: 'check', group: 'options', defaultValue: false },
    ],
    run: runSort,
  },
  {
    id: 'standardize',
    titleKey: 'an.standardize',
    slots: [
      { key: 'column', label: 'slot.column', kind: 'col', required: true },
      { key: 'storeIn', label: 'slot.storeIn', kind: 'text', group: 'options', defaultValue: '' },
    ],
    run: runStandardize,
  },
  {
    id: 'recode',
    titleKey: 'an.recode',
    slots: [
      { key: 'column', label: 'slot.column', kind: 'col', required: true },
      { key: 'mapping', label: 'slot.mapping', kind: 'text', defaultValue: '1=10, 2=20' },
      { key: 'fallback', label: 'slot.fallback', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'storeIn', label: 'slot.storeIn', kind: 'text', group: 'options', defaultValue: '' },
    ],
    run: runRecode,
  },

  /* ── P2 analyses ──────────────────────────────────────────────────── */
  {
    id: 'gagerr',
    titleKey: 'an.gagerr',
    slots: [
      { key: 'part', label: 'slot.part', kind: 'col', required: true },
      { key: 'operator', label: 'slot.operator', kind: 'col', required: true },
      { key: 'measurement', label: 'slot.measurement', kind: 'col', required: true },
      {
        key: 'type',
        label: 'slot.grrType',
        kind: 'select',
        group: 'options',
        defaultValue: 'crossed',
        options: [
          { value: 'crossed', label: 'grr.crossed' },
          { value: 'nested', label: 'grr.nested' },
        ],
      },
      { key: 'tolerance', label: 'slot.tolerance', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'studyVar', label: 'slot.studyVar', kind: 'num', group: 'options', defaultValue: 6, min: 1, max: 12, step: 0.5 },
      { key: 'poolInteraction', label: 'opt.poolInteraction', kind: 'check', group: 'options', defaultValue: false },
      confidenceSlot,
    ],
    run: runGageRR,
  },
  {
    id: 'sixpack',
    titleKey: 'an.sixpack',
    slots: [
      { key: 'variable', label: 'slot.variable', kind: 'col', required: true },
      // Above 10 the Sixpack switches to Xbar-S (exact c₄ constants), so the
      // input is no longer capped at the Xbar-R table's range.
      { key: 'subgroup', label: 'slot.subgroup', kind: 'num', group: 'options', defaultValue: 1, min: 1, max: 25, step: 1 },
      { key: 'lsl', label: 'slot.lsl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'usl', label: 'slot.usl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'target', label: 'slot.target', kind: 'text', group: 'options', defaultValue: '' },
      {
        key: 'sigmaMethod',
        label: 'slot.sigmaMethod',
        kind: 'select',
        group: 'options',
        defaultValue: 'z_bench_shift',
        options: [
          { value: 'z_bench_shift', label: 'sigma.zBenchShift' },
          { value: 'z_bench', label: 'sigma.zBench' },
          { value: 'cpk_shift', label: 'sigma.cpkShift' },
        ],
      },
    ],
    run: runSixpack,
  },
  {
    id: 'capnonnormal',
    titleKey: 'an.capnonnormal',
    slots: [
      { key: 'variable', label: 'slot.variable', kind: 'col', required: true },
      {
        key: 'distribution',
        label: 'slot.distribution',
        kind: 'select',
        defaultValue: 'weibull',
        options: [
          { value: 'weibull', label: 'dist.weibull' },
          { value: 'lognormal', label: 'dist.lognormal' },
          { value: 'gamma', label: 'dist.gamma' },
        ],
      },
      { key: 'lsl', label: 'slot.lsl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'usl', label: 'slot.usl', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'target', label: 'slot.target', kind: 'text', group: 'options', defaultValue: '' },
    ],
    run: runNonnormal,
  },
  {
    id: 'xbars',
    titleKey: 'an.xbars',
    slots: [
      { key: 'variable', label: 'slot.variable', kind: 'col', required: true },
      { key: 'subgroup', label: 'slot.subgroup', kind: 'num', group: 'options', defaultValue: 5, min: 2, max: 25, step: 1 },
      { key: 'groups', label: 'slot.subgroupId', kind: 'col', group: 'options' },
    ],
    run: runXbarS,
  },
  {
    id: 'npchart',
    titleKey: 'an.npchart',
    slots: [
      { key: 'defectives', label: 'slot.defectives', kind: 'col', required: true },
      { key: 'sampleSize', label: 'slot.subgroup', kind: 'num', defaultValue: 100, min: 1, step: 1 },
    ],
    run: runNpChart,
  },
  {
    id: 'cchart',
    titleKey: 'an.cchart',
    slots: [{ key: 'defects', label: 'slot.defectCounts', kind: 'col', required: true }],
    run: runCChart,
  },
  {
    id: 'uchart',
    titleKey: 'an.uchart',
    slots: [
      { key: 'defects', label: 'slot.defectCounts', kind: 'col', required: true },
      { key: 'unitSizes', label: 'slot.unitSizes', kind: 'col' },
      { key: 'unitSize', label: 'slot.unitSize', kind: 'num', group: 'options', defaultValue: 1, min: 1, step: 1 },
    ],
    run: runUChart,
  },
  {
    id: 'glm',
    titleKey: 'an.glm',
    slots: [
      { key: 'response', label: 'slot.response', kind: 'col', required: true },
      { key: 'factors', label: 'slot.factors', kind: 'vars', required: true },
      { key: 'interactions', label: 'opt.interactions', kind: 'check', group: 'options', defaultValue: true },
      confidenceSlot,
    ],
    run: runGlm,
  },
  {
    id: 'doecreate',
    titleKey: 'an.doecreate',
    slots: [
      { key: 'factors', label: 'slot.factorCount', kind: 'num', defaultValue: 3, min: 2, max: 6, step: 1 },
      { key: 'replicates', label: 'slot.replicates', kind: 'num', defaultValue: 1, min: 1, max: 5, step: 1 },
      { key: 'centers', label: 'slot.centers', kind: 'num', group: 'options', defaultValue: 0, min: 0, max: 20, step: 1 },
      { key: 'randomize', label: 'opt.randomize', kind: 'check', group: 'options', defaultValue: true },
      { key: 'seed', label: 'slot.seed', kind: 'num', group: 'options', defaultValue: 20261122 },
    ],
    run: runDoeCreate,
  },
  {
    id: 'doeanalyze',
    titleKey: 'an.doeanalyze',
    slots: [
      { key: 'response', label: 'slot.response', kind: 'col', required: true },
      { key: 'factors', label: 'slot.factors', kind: 'vars', required: true },
      {
        key: 'order',
        label: 'slot.modelOrder',
        kind: 'select',
        group: 'options',
        defaultValue: '2',
        options: [
          { value: '1', label: 'doe.order1' },
          { value: '2', label: 'doe.order2' },
          { value: '3', label: 'doe.order3' },
        ],
      },
    ],
    run: runDoeAnalyze,
  },
  {
    id: 'rsmcreate',
    titleKey: 'an.rsmcreate',
    slots: [
      {
        key: 'design',
        label: 'slot.rsmDesign',
        kind: 'select',
        defaultValue: 'ccd',
        options: [
          { value: 'ccd', label: 'doe.ccd' },
          { value: 'bbd', label: 'doe.bbd' },
        ],
      },
      { key: 'factors', label: 'slot.factorCount', kind: 'num', group: 'options', defaultValue: 2, min: 2, max: 5, step: 1 },
      { key: 'centers', label: 'slot.centers', kind: 'num', group: 'options', defaultValue: 5, min: 1, max: 20, step: 1 },
      { key: 'randomize', label: 'opt.randomize', kind: 'check', group: 'options', defaultValue: true },
      { key: 'seed', label: 'slot.seed', kind: 'num', group: 'options', defaultValue: 20261122 },
    ],
    run: runRsmCreate,
  },
  {
    id: 'rsmanalyze',
    titleKey: 'an.rsmanalyze',
    slots: [
      { key: 'response', label: 'slot.response', kind: 'col', required: true },
      { key: 'factors', label: 'slot.factors', kind: 'vars', required: true },
    ],
    run: runRsmAnalyze,
  },
  {
    id: 'weibull',
    titleKey: 'an.weibull',
    slots: [
      { key: 'time', label: 'slot.failureTime', kind: 'col', required: true },
      { key: 'censor', label: 'slot.censoring', kind: 'col' },
      {
        key: 'censorCode',
        label: 'slot.censorCode',
        kind: 'select',
        group: 'options',
        defaultValue: '1=censored',
        options: [
          { value: '1=censored', label: 'opt.censor1' },
          { value: '0=censored', label: 'opt.censor0' },
        ],
      },
      confidenceSlot,
    ],
    run: runWeibull,
  },

  {
    id: 'power1t',
    titleKey: 'an.power1t',
    slots: [
      { key: 'solveFor', label: 'slot.solveFor', kind: 'select', defaultValue: 'n', options: [{ value: 'n', label: 'power.solveN' }, { value: 'power', label: 'power.solvePower' }, { value: 'difference', label: 'power.solveDifference' }] },
      { key: 'difference', label: 'slot.difference', kind: 'text', defaultValue: '' },
      { key: 'sd', label: 'slot.stdev', kind: 'num', defaultValue: 1, min: 0.0001, step: 0.1 },
      { key: 'n', label: 'slot.n', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'power', label: 'slot.power', kind: 'text', group: 'options', defaultValue: '90' },
      { key: 'alpha', label: 'slot.alpha', kind: 'num', group: 'options', defaultValue: 5, min: 0.001, max: 50, step: 0.1 },
      altSlot,
    ],
    run: (ctx) => runPowerAnalysis(ctx, 'oneT'),
  },
  {
    id: 'power2t',
    titleKey: 'an.power2t',
    slots: [
      { key: 'solveFor', label: 'slot.solveFor', kind: 'select', defaultValue: 'n', options: [{ value: 'n', label: 'power.solveN' }, { value: 'power', label: 'power.solvePower' }, { value: 'difference', label: 'power.solveDifference' }] },
      { key: 'difference', label: 'slot.difference', kind: 'text', defaultValue: '' },
      { key: 'sd', label: 'slot.stdev', kind: 'num', defaultValue: 1, min: 0.0001, step: 0.1 },
      { key: 'n', label: 'slot.n', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'power', label: 'slot.power', kind: 'text', group: 'options', defaultValue: '90' },
      { key: 'alpha', label: 'slot.alpha', kind: 'num', group: 'options', defaultValue: 5, min: 0.001, max: 50, step: 0.1 },
      altSlot,
    ],
    run: (ctx) => runPowerAnalysis(ctx, 'twoT'),
  },
  {
    id: 'powerpaired',
    titleKey: 'an.powerpaired',
    slots: [
      { key: 'solveFor', label: 'slot.solveFor', kind: 'select', defaultValue: 'n', options: [{ value: 'n', label: 'power.solveN' }, { value: 'power', label: 'power.solvePower' }, { value: 'difference', label: 'power.solveDifference' }] },
      { key: 'difference', label: 'slot.difference', kind: 'text', defaultValue: '' },
      { key: 'sd', label: 'slot.stdevDiff', kind: 'num', defaultValue: 1, min: 0.0001, step: 0.1 },
      { key: 'n', label: 'slot.n', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'power', label: 'slot.power', kind: 'text', group: 'options', defaultValue: '90' },
      { key: 'alpha', label: 'slot.alpha', kind: 'num', group: 'options', defaultValue: 5, min: 0.001, max: 50, step: 0.1 },
      altSlot,
    ],
    run: (ctx) => runPowerAnalysis(ctx, 'paired'),
  },
  {
    id: 'poweranova',
    titleKey: 'an.poweranova',
    slots: [
      { key: 'solveFor', label: 'slot.solveFor', kind: 'select', defaultValue: 'n', options: [{ value: 'n', label: 'power.solveN' }, { value: 'power', label: 'power.solvePower' }, { value: 'difference', label: 'power.solveDifference' }] },
      { key: 'difference', label: 'slot.difference', kind: 'text', defaultValue: '' },
      { key: 'sd', label: 'slot.stdev', kind: 'num', defaultValue: 1, min: 0.0001, step: 0.1 },
      { key: 'groups', label: 'slot.groups', kind: 'num', defaultValue: 3, min: 2, max: 20, step: 1 },
      { key: 'n', label: 'slot.n', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'power', label: 'slot.power', kind: 'text', group: 'options', defaultValue: '90' },
      { key: 'alpha', label: 'slot.alpha', kind: 'num', group: 'options', defaultValue: 5, min: 0.001, max: 50, step: 0.1 },
    ],
    run: (ctx) => runPowerAnalysis(ctx, 'anova'),
  },
  {
    id: 'powerprop1',
    titleKey: 'an.powerprop1',
    slots: [
      { key: 'solveFor', label: 'slot.solveFor', kind: 'select', defaultValue: 'n', options: [{ value: 'n', label: 'power.solveN' }, { value: 'power', label: 'power.solvePower' }, { value: 'difference', label: 'power.solveDifference' }] },
      { key: 'p1', label: 'slot.p1', kind: 'num', defaultValue: 0.5, min: 0.0001, max: 0.9999, step: 0.01 },
      { key: 'p2', label: 'slot.p2', kind: 'num', defaultValue: 0.6, min: 0.0001, max: 0.9999, step: 0.01 },
      { key: 'n', label: 'slot.n', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'power', label: 'slot.power', kind: 'text', group: 'options', defaultValue: '90' },
      { key: 'alpha', label: 'slot.alpha', kind: 'num', group: 'options', defaultValue: 5, min: 0.001, max: 50, step: 0.1 },
      altSlot,
    ],
    run: (ctx) => runPowerAnalysis(ctx, 'oneProp'),
  },
  {
    id: 'powerprop2',
    titleKey: 'an.powerprop2',
    slots: [
      { key: 'solveFor', label: 'slot.solveFor', kind: 'select', defaultValue: 'n', options: [{ value: 'n', label: 'power.solveN' }, { value: 'power', label: 'power.solvePower' }, { value: 'difference', label: 'power.solveDifference' }] },
      { key: 'p1', label: 'slot.p1', kind: 'num', defaultValue: 0.4, min: 0.0001, max: 0.9999, step: 0.01 },
      { key: 'p2', label: 'slot.p2', kind: 'num', defaultValue: 0.6, min: 0.0001, max: 0.9999, step: 0.01 },
      { key: 'n', label: 'slot.n', kind: 'text', group: 'options', defaultValue: '' },
      { key: 'power', label: 'slot.power', kind: 'text', group: 'options', defaultValue: '90' },
      { key: 'alpha', label: 'slot.alpha', kind: 'num', group: 'options', defaultValue: 5, min: 0.001, max: 50, step: 0.1 },
      altSlot,
    ],
    run: (ctx) => runPowerAnalysis(ctx, 'twoProp'),
  },
];

export function findAnalysis(id: string): AnalysisDef | undefined {
  return ANALYSES.find((a) => a.id === id);
}

export function defaultValues(def: AnalysisDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  def.slots.forEach((slot) => {
    if (slot.kind === 'vars') out[slot.key] = slot.defaultValue ?? [];
    else if (slot.kind === 'check') out[slot.key] = slot.defaultValue ?? false;
    else out[slot.key] = slot.defaultValue ?? (slot.kind === 'num' ? 0 : '');
  });
  return out;
}

