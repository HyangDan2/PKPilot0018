/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — general linear model engine
   One least-squares core shared by multi-way ANOVA, factorial DOE and
   response-surface analysis. Categorical factors use reference (treatment)
   coding with the first level as baseline; the adjusted (Type III) SS are the
   drop-term sums of squares in that parameterisation, which reproduces the
   SAS/Minitab tables (verified against statsmodels anova_lm typ=3).
   Type I SS are the sequential (model-order) sums of squares.

   Rank-deficient designs (aliased terms, empty cells) are handled by a
   rank-revealing elimination that leaves dependent columns at zero instead of
   failing: those terms are reported as aliased with df 0.
   ───────────────────────────────────────────────────────────────────────── */

import { fCdf } from './dist';
import { mean } from './stats';

export type FactorKind = 'categorical' | 'numeric';

export interface ModelFactor {
  name: string;
  kind: FactorKind;
  values: (number | string | null)[];
}

/** A model term is the interaction of the factors it names (one name = main effect). */
export interface ModelTerm {
  name: string;
  factors: string[];
}

/* ── small dense linear algebra ───────────────────────────────────────── */

export interface LstsqResult {
  beta: number[];
  /** rank of the design matrix (number of estimable columns) */
  rank: number;
  aliased: number[];
  /** (X'X)⁺ on the estimable columns, zeros elsewhere */
  xtxInv: number[][];
}

/** In-place Gauss-Jordan inverse of a small square matrix (null if singular). */
function invertSquare(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let c = 0; c < 2 * n; c += 1) M[col][c] /= pv;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n; c += 1) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

/**
 * Least squares through the normal equations with scaled columns and a
 * rank-revealing pivot order. Dependent columns are dropped (β = 0) instead of
 * producing NaN, so aliased DOE terms and empty ANOVA cells still fit.
 */
export function lstsq(X: number[][], y: number[]): LstsqResult {
  const n = X.length;
  const p = n ? X[0].length : 0;
  if (!n || !p) return { beta: new Array(p).fill(0), rank: 0, aliased: [], xtxInv: [] };
  const scale = new Array(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    let norm = 0;
    for (let i = 0; i < n; i += 1) norm += X[i][j] * X[i][j];
    norm = Math.sqrt(norm);
    scale[j] = norm > 0 ? norm : 1;
  }
  const xtx: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty: number[] = new Array(p).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < p; a += 1) {
      const xa = X[i][a] / scale[a];
      if (xa === 0) continue;
      xty[a] += xa * y[i];
      for (let b = a; b < p; b += 1) xtx[a][b] += xa * (X[i][b] / scale[b]);
    }
  }
  for (let a = 0; a < p; a += 1) for (let b = 0; b < a; b += 1) xtx[a][b] = xtx[b][a];
  const diagMax = Math.max(1, ...xtx.map((row, i) => Math.abs(row[i])));
  const tol = 1e-8 * diagMax;
  // Greedy pivot selection over the symmetric matrix, re-checking the residual
  // diagonal after each accepted column (Cholesky-style rank revelation).
  const retained: number[] = [];
  const work = xtx.map((row) => [...row]);
  const candidates = new Set(Array.from({ length: p }, (_, i) => i));
  while (candidates.size) {
    let best = -1;
    let bestValue = tol;
    candidates.forEach((j) => {
      if (Math.abs(work[j][j]) > bestValue) {
        bestValue = Math.abs(work[j][j]);
        best = j;
      }
    });
    if (best < 0) break;
    retained.push(best);
    candidates.delete(best);
    const pv = work[best][best];
    candidates.forEach((j) => {
      const f = work[j][best] / pv;
      for (const k of candidates) work[j][k] -= f * work[best][k];
    });
  }
  retained.sort((a, b) => a - b);
  const aliased = Array.from({ length: p }, (_, i) => i).filter((i) => !retained.includes(i));
  if (!retained.length) return { beta: new Array(p).fill(0), rank: 0, aliased, xtxInv: Array.from({ length: p }, () => new Array<number>(p).fill(0)) };
  const sub = retained.map((i) => retained.map((j) => xtx[i][j]));
  const inv = invertSquare(sub);
  const beta = new Array(p).fill(0);
  const xtxInv = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  if (!inv) return { beta, rank: 0, aliased: Array.from({ length: p }, (_, i) => i), xtxInv };
  retained.forEach((i, a) => {
    beta[i] = inv[a].reduce((sum, value, b) => sum + value * xty[retained[b]], 0) / scale[i];
    retained.forEach((j, b) => { xtxInv[i][j] = inv[a][b] / (scale[i] * scale[j]); });
  });
  return { beta, rank: retained.length, aliased, xtxInv };
}

/* ── design matrix ───────────────────────────────────────────────────── */

export interface DesignColumn {
  term: number;
  label: string;
}

export interface Design {
  X: number[][];
  y: number[];
  rows: number[];
  n: number;
  columns: DesignColumn[];
  levels: Record<string, string[]>;
  /** number of columns each term contributed */
  blockSizes: number[];
  /** column index where each term starts */
  blockStart: number[];
  labels: string[];
}

export function sortedLevels(values: (number | string | null)[]): string[] {
  const set = new Set<string>();
  values.forEach((v) => {
    if (v === null || v === undefined || v === '') return;
    set.add(String(v));
  });
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function numericOf(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (isFinite(n)) return n;
  }
  return null;
}

/**
 * Build a sum-to-zero design matrix. `terms` may be a subset of the factors
 * (used for lack-of-fit / reduced models).
 */
export function buildDesign(y: (number | null)[], factors: ModelFactor[], terms: ModelTerm[]): Design {
  if (!factors.length) throw new Error('glm.noFactors');
  if (!terms.length) throw new Error('glm.noTerms');
  const byName = new Map(factors.map((f) => [f.name, f]));
  const used = new Set<string>();
  terms.forEach((t) => t.factors.forEach((name) => used.add(name)));
  const rows: number[] = [];
  const yValues: number[] = [];
  for (let r = 0; r < y.length; r += 1) {
    const value = y[r];
    if (typeof value !== 'number' || !isFinite(value)) continue;
    let ok = true;
    used.forEach((name) => {
      const f = byName.get(name);
      if (!f) ok = false;
      else if (f.kind === 'numeric') {
        if (numericOf(f.values[r]) === null) ok = false;
      } else {
        const v = f.values[r];
        if (v === null || v === undefined || v === '') ok = false;
      }
    });
    if (!ok) continue;
    rows.push(r);
    yValues.push(value);
  }
  const n = rows.length;
  const levels: Record<string, string[]> = {};
  const factorColumns = new Map<string, { labels: string[]; values: number[][] }>();
  used.forEach((name) => {
    const f = byName.get(name);
    if (!f) return;
    if (f.kind === 'categorical') {
      const lv = sortedLevels(f.values);
      levels[name] = lv;
      // Reference (treatment) coding with the first level as the baseline:
      // dropping a term's own columns from this parameterisation reproduces the
      // SAS/Minitab Type III sums of squares (verified against statsmodels).
      const cols: number[][] = [];
      for (let j = 1; j < lv.length; j += 1) {
        cols.push(rows.map((r) => (String(f.values[r] ?? '') === lv[j] ? 1 : 0)));
      }
      factorColumns.set(name, { labels: lv.slice(1).map((l) => `${name}[${l}]`), values: cols });
    } else {
      factorColumns.set(name, { labels: [name], values: [rows.map((r) => numericOf(f.values[r]) ?? 0)] });
    }
  });
  const X: number[][] = Array.from({ length: n }, () => [1]);
  const columns: DesignColumn[] = [{ term: -1, label: 'Constant' }];
  const blockSizes: number[] = [];
  const blockStart: number[] = [];
  terms.forEach((term, ti) => {
    blockStart.push(X[0].length);
    let cols: { label: string; values: number[] }[] = [{ label: '1', values: new Array(n).fill(1) }];
    term.factors.forEach((name) => {
      const block = factorColumns.get(name);
      if (!block) return;
      const next: { label: string; values: number[] }[] = [];
      cols.forEach((left) => {
        block.values.forEach((right, k) => {
          next.push({
            label: left.label === '1' ? block.labels[k] : `${left.label}×${block.labels[k]}`,
            values: left.values.map((v, i) => v * right[i]),
          });
        });
      });
      cols = next;
    });
    cols.forEach((col) => {
      columns.push({ term: ti, label: col.label });
      for (let i = 0; i < n; i += 1) X[i].push(col.values[i]);
    });
    blockSizes.push(cols.length);
  });
  return { X, y: yValues, rows, n, columns, levels, blockSizes, blockStart, labels: columns.map((c) => c.label) };
}

/* ── model fit ───────────────────────────────────────────────────────── */

export interface TermTest {
  name: string;
  df: number;
  ssSeq: number;
  ssAdj: number;
  msAdj: number;
  f: number;
  p: number;
}

export interface GlmResult {
  n: number;
  /** residual degrees of freedom */
  dfe: number;
  sse: number;
  mse: number;
  s: number;
  ssTotal: number;
  ssModel: number;
  dfModel: number;
  r2: number;
  r2adj: number;
  terms: TermTest[];
  labels: string[];
  beta: number[];
  se: number[];
  t: number[];
  p: number[];
  fitted: number[];
  residuals: number[];
  rank: number;
  aliased: string[];
  design: Design;
}

function sse(X: number[][], y: number[], colLimit: number): number {
  if (colLimit <= 1) {
    const m = mean(y);
    return y.reduce((a, v) => a + (v - m) ** 2, 0);
  }
  const sub = X.map((row) => row.slice(0, colLimit));
  const fit = lstsq(sub, y);
  return y.reduce((a, v, i) => {
    const pred = sub[i].reduce((sum, x, j) => sum + x * fit.beta[j], 0);
    return a + (v - pred) ** 2;
  }, 0);
}

export function fitGlm(y: (number | null)[], factors: ModelFactor[], terms: ModelTerm[]): GlmResult {
  const design = buildDesign(y, factors, terms);
  const { X, y: ys, n, blockSizes, blockStart } = design;
  if (n < 2) throw new Error('glm.noData');
  const full = lstsq(X, ys);
  const fitted = X.map((row) => row.reduce((sum, x, j) => sum + x * full.beta[j], 0));
  const residuals = ys.map((v, i) => v - fitted[i]);
  const sseFull = residuals.reduce((a, r) => a + r * r, 0);
  const dfe = n - full.rank;
  if (dfe < 1) throw new Error('glm.noDf');
  const mse = sseFull / dfe;
  const grand = mean(ys);
  const ssTotal = ys.reduce((a, v) => a + (v - grand) ** 2, 0);
  const ssModel = ssTotal - sseFull;
  const dfModel = full.rank - 1;
  const r2 = ssTotal > 0 ? ssModel / ssTotal : 0;
  const r2adj = 1 - (1 - r2) * ((n - 1) / dfe);
  // Type I: sequential sums of squares, term by term in model order.
  const seqSs: number[] = [];
  let prev = ssTotal;
  terms.forEach((_, ti) => {
    const end = blockStart[ti] + blockSizes[ti];
    const cur = sse(X, ys, end);
    seqSs.push(Math.max(0, prev - cur));
    prev = cur;
  });
  const termTests: TermTest[] = terms.map((term, ti) => {
    const start = blockStart[ti];
    const end = start + blockSizes[ti];
    // Type III: drop this term's columns, keep everything else.
    const keep = X.map((row) => [...row.slice(0, start), ...row.slice(end)]);
    const reduced = lstsq(keep, ys);
    const fittedReduced = keep.map((row) => row.reduce((sum, x, j) => sum + x * reduced.beta[j], 0));
    const sseReduced = ys.reduce((a, v, i) => a + (v - fittedReduced[i]) ** 2, 0);
    const ssAdj = Math.max(0, sseReduced - sseFull);
    const df = full.rank - reduced.rank;
    const msAdj = df > 0 ? ssAdj / df : 0;
    const f = df > 0 && mse > 0 ? msAdj / mse : NaN;
    return {
      name: term.name,
      df,
      ssSeq: seqSs[ti],
      ssAdj,
      msAdj,
      f,
      p: isFinite(f) ? 1 - fCdf(f, df, dfe) : NaN,
    };
  });
  const se = full.xtxInv.map((row, i) => {
    const v = row[i];
    return isFinite(v) && v >= 0 ? Math.sqrt(mse * v) : NaN;
  });
  const t = full.beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  return {
    n,
    dfe,
    sse: sseFull,
    mse,
    s: Math.sqrt(mse),
    ssTotal,
    ssModel,
    dfModel,
    r2,
    r2adj,
    terms: termTests.map((tt, i) => ({ ...tt, name: terms[i].name })),
    labels: design.labels,
    beta: full.beta,
    se,
    t,
    p: t.map((value) => (isFinite(value) ? 2 * (1 - tCdfLocal(Math.abs(value), dfe)) : NaN)),
    fitted,
    residuals,
    rank: full.rank,
    aliased: full.aliased.map((idx) => design.labels[idx] ?? `#${idx}`),
    design,
  };
}

function tCdfLocal(tValue: number, df: number): number {
  // Student-t CDF through the incomplete beta function (kept local so GLM has
  // no dependency back on the whole statistics module).
  const x = df / (df + tValue * tValue);
  const p = 0.5 * betaLocal(df / 2, 0.5, x);
  return tValue >= 0 ? 1 - p : p;
}

function betaLocal(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGammaLocal(a + b) - logGammaLocal(a) - logGammaLocal(b) + a * Math.log(x) + b * Math.log(1 - x));
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
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Cell means for main-effects and interaction plots. */
export function cellMeans(
  y: (number | null)[],
  facets: ModelFactor[],
): { keys: string[]; rows: number[]; mean: number; n: number }[] {
  const map = new Map<string, number[]>();
  const rowsByKey = new Map<string, number[]>();
  for (let r = 0; r < y.length; r += 1) {
    const value = y[r];
    if (typeof value !== 'number' || !isFinite(value)) continue;
    const keys = facets.map((f) => String(f.values[r] ?? ''));
    if (keys.some((k) => k === '')) continue;
    const key = keys.join('\u0001');
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
    const rows = rowsByKey.get(key) ?? [];
    rows.push(r);
    rowsByKey.set(key, rows);
  }
  return [...map.entries()].map(([key, values]) => ({
    keys: key.split('\u0001'),
    rows: rowsByKey.get(key) ?? [],
    mean: mean(values),
    n: values.length,
  }));
}
