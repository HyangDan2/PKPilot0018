/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — analysis registry
   Each entry declares its dialog slots (Minitab style) and a pure run
   function that turns worksheet columns into output blocks.
   ───────────────────────────────────────────────────────────────────────── */

import type { Block, ChartSpec, Column, Lang, Worksheet } from '../types';
import { capability } from './capability';
import { evaluateFormula } from './calc';
import { fmt, fmtInt, fmtP } from './format';
import { t } from './i18n';
import { generateRandom } from './random';
import { imrChart, pChart, xbarRCharts, SpcValidationError, type SpcIssue } from './spc';
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
  if (!(result.stdev > 0)) throw new Error('res.zeroVariance');
  const diffs = pairedA.map((x, i) => x - pairedB[i]);
  const blocks: Block[] = [
    {
      type: 'text',
      lines: [
        `μ_d: mean of (${colA?.name ?? 'A'} − ${colB?.name ?? 'B'})`,
        `${t(lang, 'res.method')}: ${t(lang, 'res.pairedMethod', { d: fmt(testDiff), alt: altSymbol(alpha) })}`,
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
      headers: ['@th.n', '@th.diff', '@th.stdev', '@th.seMean', `@th.ci ${level}`, '@th.t', '@th.p'],
      rows: [[fmtInt(result.n), fmt(result.difference), fmt(result.stdev), fmt(result.se), `${fmt(result.ci[0])}  ${fmt(result.ci[1])}`, fmt(result.t), fmtP(result.p)]],
      align: ['r', 'r', 'r', 'r', 'r', 'r', 'r'],
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

