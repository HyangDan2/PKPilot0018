/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — general linear model engine
   One least-squares core shared by multi-way ANOVA, factorial DOE and
   response-surface analysis. Categorical factors use SUM-TO-ZERO (deviation)
   coding — level i = 1, last level = −1 — because the adjusted (Type III) SS
   are the drop-term sums of squares in that parameterisation, which reproduces
   the SAS/Minitab tables (verified against statsmodels anova_lm typ=3 with
   C(f, Sum)). Type I SS are the sequential (model-order) sums of squares.

   Least squares runs on a column-pivoted Householder QR of X itself, never on
   the normal equations X'X (whose condition number is the square of X's).
   Rank-deficient designs (aliased terms, empty cells) leave dependent columns
   at zero instead of failing: those terms are reported as aliased with df 0.
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

/** Inverse of a small upper-triangular matrix by back substitution. */
function invertUpper(R: number[][]): number[][] | null {
  const r = R.length;
  const inv = Array.from({ length: r }, () => new Array<number>(r).fill(0));
  for (let i = r - 1; i >= 0; i -= 1) {
    if (Math.abs(R[i][i]) < 1e-300) return null;
    inv[i][i] = 1 / R[i][i];
    for (let j = i + 1; j < r; j += 1) {
      let sum = 0;
      for (let k = i + 1; k <= j; k += 1) sum += R[i][k] * inv[k][j];
      inv[i][j] = -sum / R[i][i];
    }
  }
  return inv;
}

/**
 * Least squares by Householder QR with column pivoting.
 *
 * Forming X'X squares the condition number (κ(X'X) = κ(X)²) and destroys the
 * last digits of a nearly collinear polynomial / RSM / multi-factor design. The
 * QR factorisation works on X itself, pivots the largest remaining column into
 * each step (so the rank decision is made on residual column norms rather than
 * on a differenced Gram matrix), and returns
 *   · β from R z = Q'y (aliased columns set to 0),
 *   · rank and the aliased column list,
 *   · (X'X)⁻¹ on the estimable columns as R⁻¹R⁻ᵀ, zeros elsewhere.
 */
export function lstsq(X: number[][], y: number[]): LstsqResult {
  const n = X.length;
  const p = n ? X[0].length : 0;
  if (!n || !p) return { beta: new Array(p).fill(0), rank: 0, aliased: [], xtxInv: [] };
  // Column scaling keeps the pivoting decision scale-free.
  const scale = new Array(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    let norm = 0;
    for (let i = 0; i < n; i += 1) norm += X[i][j] * X[i][j];
    norm = Math.sqrt(norm);
    scale[j] = norm > 0 ? norm : 1;
  }
  const A: number[][] = X.map((row) => row.map((v, j) => v / scale[j]));
  const b: number[] = [...y];
  const perm = Array.from({ length: p }, (_, i) => i);
  const minDim = Math.min(n, p);
  const tol = 1e-10;
  let rank = 0;
  for (let k = 0; k < minDim; k += 1) {
    let best = -1;
    let bestNorm = 0;
    for (let j = k; j < p; j += 1) {
      let norm = 0;
      for (let i = k; i < n; i += 1) norm += A[i][j] * A[i][j];
      norm = Math.sqrt(norm);
      if (norm > bestNorm) { bestNorm = norm; best = j; }
    }
    if (best < 0 || bestNorm <= tol) break;
    if (best !== k) {
      for (let i = 0; i < n; i += 1) {
        const tmp = A[i][k];
        A[i][k] = A[i][best];
        A[i][best] = tmp;
      }
      const tmp = perm[k];
      perm[k] = perm[best];
      perm[best] = tmp;
    }
    // Householder reflection zeroing A[k+1.., k].
    const v = new Array<number>(n).fill(0);
    let vtv = 0;
    for (let i = k; i < n; i += 1) { v[i] = A[i][k]; vtv += v[i] * v[i]; }
    const alpha = A[k][k] >= 0 ? -Math.sqrt(vtv) : Math.sqrt(vtv);
    v[k] -= alpha;
    vtv = 0;
    for (let i = k; i < n; i += 1) vtv += v[i] * v[i];
    if (vtv > 0) {
      for (let j = k; j < p; j += 1) {
        let s = 0;
        for (let i = k; i < n; i += 1) s += v[i] * A[i][j];
        const f = (2 * s) / vtv;
        if (f === 0) continue;
        for (let i = k; i < n; i += 1) A[i][j] -= f * v[i];
      }
      let sb = 0;
      for (let i = k; i < n; i += 1) sb += v[i] * b[i];
      const fb = (2 * sb) / vtv;
      if (fb !== 0) for (let i = k; i < n; i += 1) b[i] -= fb * v[i];
    }
    A[k][k] = alpha;
    for (let i = k + 1; i < n; i += 1) A[i][k] = 0;
    rank += 1;
  }
  const beta = new Array(p).fill(0);
  const xtxInv = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  if (!rank) {
    return { beta, rank: 0, aliased: Array.from({ length: p }, (_, i) => i), xtxInv };
  }
  const R = Array.from({ length: rank }, (_, i) => Array.from({ length: rank }, (_, j) => (j >= i ? A[i][j] : 0)));
  const z = new Array<number>(rank).fill(0);
  for (let i = rank - 1; i >= 0; i -= 1) {
    let sum = b[i];
    for (let j = i + 1; j < rank; j += 1) sum -= R[i][j] * z[j];
    z[i] = Math.abs(R[i][i]) > 1e-300 ? sum / R[i][i] : 0;
  }
  for (let i = 0; i < rank; i += 1) beta[perm[i]] = z[i] / scale[perm[i]];
  const rInv = invertUpper(R);
  if (rInv) {
    for (let i = 0; i < rank; i += 1) {
      for (let j = 0; j < rank; j += 1) {
        let sum = 0;
        for (let k = 0; k < rank; k += 1) sum += rInv[i][k] * rInv[j][k];
        xtxInv[perm[i]][perm[j]] = sum / (scale[perm[i]] * scale[perm[j]]);
      }
    }
  }
  const retained = perm.slice(0, rank).sort((a, b2) => a - b2);
  const aliased = Array.from({ length: p }, (_, i) => i).filter((i) => !retained.includes(i));
  return { beta, rank, aliased, xtxInv };
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
      // Sum-to-zero (deviation / effects) coding: L−1 columns where level i gets
      // 1, the LAST level gets −1 and every other level 0. These contrasts are
      // orthogonal to the intercept, so dropping a term's block and refitting
      // yields the SAS / Minitab Type III (adjusted) sum of squares. Treatment
      // (dummy) coding gives different adjusted SS once interactions are present.
      const cols: number[][] = [];
      const last = lv[lv.length - 1];
      for (let j = 0; j < lv.length - 1; j += 1) {
        cols.push(rows.map((r) => {
          const value = String(f.values[r] ?? '');
          return value === lv[j] ? 1 : value === last ? -1 : 0;
        }));
      }
      factorColumns.set(name, { labels: lv.slice(0, -1).map((l) => `${name}[${l}]`), values: cols });
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
  /** False when there is no residual df (or no residual SS): estimable, not inferable. */
  inferable: boolean;
  sse: number;
  mse: number;
  s: number;
  ssTotal: number;
  ssModel: number;
  dfModel: number;
  r2: number;
  r2adj: number;
  /** Predicted R² (1 − PRESS/SS_total): NaN when it cannot be defined. */
  r2pred: number;
  /** Leave-one-out prediction error sum of squares. */
  press: number;
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
  /** (X'X)⁻¹ on the estimable columns (zeros elsewhere): mse·this is the covariance. */
  xtxInv: number[][];
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
export interface GlmOptions {
  /**
   * A saturated design (dfe = 0) still has estimable coefficients; it has no
   * error mean square to test them against. With this option the fit is
   * returned with `inferable: false` and NaN inference instead of throwing.
   * The default stays strict so every existing caller keeps its guard.
   */
  allowZeroDf?: boolean;
}

export function fitGlm(y: (number | null)[], factors: ModelFactor[], terms: ModelTerm[], options: GlmOptions = {}): GlmResult {
  const design = buildDesign(y, factors, terms);
  const { X, y: ys, n, blockSizes, blockStart } = design;
  if (n < 2) throw new Error('glm.noData');
  const full = lstsq(X, ys);
  const fitted = X.map((row) => row.reduce((sum, x, j) => sum + x * full.beta[j], 0));
  const residuals = ys.map((v, i) => v - fitted[i]);
  const sseFull = residuals.reduce((a, r) => a + r * r, 0);
  const dfe = n - full.rank;
  if (dfe < 1 && !options.allowZeroDf) throw new Error('glm.noDf');
  const inferable = dfe > 0;
  const mse = inferable ? sseFull / dfe : NaN;
  const grand = mean(ys);
  const ssTotal = ys.reduce((a, v) => a + (v - grand) ** 2, 0);
  const ssModel = ssTotal - sseFull;
  const dfModel = full.rank - 1;
  const r2 = ssTotal > 0 ? ssModel / ssTotal : 0;
  const r2adj = inferable ? 1 - (1 - r2) * ((n - 1) / dfe) : NaN;
  // PRESS from the leave-one-out residual e_i / (1 − h_ii), with h_ii the
  // leverage x_i' (X'X)⁻¹ x_i. A leverage of 1 makes the LOO prediction
  // undefined, so PRESS (and predicted R²) become unavailable rather than huge.
  let press = NaN;
  if (inferable) {
    let total = 0;
    let defined = true;
    for (let i = 0; i < n; i += 1) {
      const row = X[i];
      let h = 0;
      for (let a = 0; a < row.length; a += 1) {
        const inv = full.xtxInv[a];
        let s = 0;
        for (let b = 0; b < row.length; b += 1) s += (inv[b] ?? 0) * row[b];
        h += row[a] * s;
      }
      if (!(h < 1 - 1e-9)) { defined = false; break; }
      total += (residuals[i] / (1 - h)) ** 2;
    }
    if (defined) press = total;
  }
  const r2pred = ssTotal > 0 && isFinite(press) ? 1 - press / ssTotal : NaN;
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
    inferable,
    sse: sseFull,
    mse,
    s: Math.sqrt(mse),
    ssTotal,
    ssModel,
    dfModel,
    r2,
    r2adj,
    r2pred,
    press,
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
    xtxInv: full.xtxInv,
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
