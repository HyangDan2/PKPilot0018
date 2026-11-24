/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — design of experiments and response surface methodology
   Standard-order 2^k designs (with centre points and replicates), central
   composite and Box–Behnken designs, factorial effect analysis and a full
   quadratic response-surface fit with the stationary point and a contour grid.
   Factor levels are coded −1 / 0 / +1 so effect = 2 × coded coefficient.
   ───────────────────────────────────────────────────────────────────────── */

import type { Column, Worksheet } from '../types';
import { makeWorksheet } from './datasets';
import type { ModelFactor } from './glm';
import { fitGlm, type GlmResult } from './glm';
import type { ModelFactor as Factor } from './glm';
import { mulberry32 } from './random';
import { mean } from './stats';

export type PointType = 'Factorial' | 'Center' | 'Axial' | 'Edge';

export interface DesignRun {
  std: number;
  run: number;
  ptType: PointType;
  /** coded factor levels, in factor order */
  levels: number[];
}

function shuffle(list: number[], seed: number): number[] {
  const rng = mulberry32(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function finish(stdRows: { levels: number[]; ptType: PointType }[], randomize: boolean, seed: number): DesignRun[] {
  const order = randomize ? shuffle(stdRows.map((_, i) => i), seed) : stdRows.map((_, i) => i);
  return stdRows.map((row, i) => ({ std: i + 1, run: 0, ptType: row.ptType, levels: row.levels }))
    .map((row, i) => {
      const runIndex = order.indexOf(i);
      return { ...row, run: runIndex + 1 };
    });
}

/** 2^k factorial design: factorial runs, then centre points, replicated r times. */
export function factorialDesign(k: number, centers: number, replicates: number, randomize: boolean, seed = 20261122): DesignRun[] {
  if (k < 2 || k > 6) throw new Error('doe.factorRange');
  const rows: { levels: number[]; ptType: PointType }[] = [];
  for (let rep = 0; rep < Math.max(1, replicates); rep += 1) {
    for (let row = 0; row < 2 ** k; row += 1) {
      const levels: number[] = [];
      for (let f = 0; f < k; f += 1) levels.push(((row >> (k - 1 - f)) & 1) === 0 ? -1 : 1);
      rows.push({ levels, ptType: 'Factorial' });
    }
    for (let c = 0; c < Math.max(0, centers); c += 1) rows.push({ levels: new Array(k).fill(0), ptType: 'Center' });
  }
  return finish(rows, randomize, seed);
}

/** Central composite design (rotatable, α = (2^k)^(1/4)). */
export function ccdDesign(k: number, centers: number, randomize: boolean, seed = 20261122, alpha?: number): DesignRun[] {
  if (k < 2 || k > 5) throw new Error('doe.factorRange');
  const a = alpha && isFinite(alpha) ? alpha : Math.pow(2, k) ** 0.25;
  const rows: { levels: number[]; ptType: PointType }[] = [];
  for (let row = 0; row < 2 ** k; row += 1) {
    const levels: number[] = [];
    for (let f = 0; f < k; f += 1) levels.push(((row >> (k - 1 - f)) & 1) === 0 ? -1 : 1);
    rows.push({ levels, ptType: 'Factorial' });
  }
  for (let f = 0; f < k; f += 1) {
    for (const sign of [-1, 1]) {
      const levels = new Array(k).fill(0);
      levels[f] = sign * a;
      rows.push({ levels, ptType: 'Axial' });
    }
  }
  for (let c = 0; c < Math.max(1, centers); c += 1) rows.push({ levels: new Array(k).fill(0), ptType: 'Center' });
  return finish(rows, randomize, seed);
}

/** Box–Behnken design for 3 factors (12 edge runs + centre points). */
export function boxBehnkenDesign(centers: number, randomize: boolean, seed = 20261122): DesignRun[] {
  const rows: { levels: number[]; ptType: PointType }[] = [];
  const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2]];
  pairs.forEach(([i, j]) => {
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([a, b]) => {
      const levels = [0, 0, 0];
      levels[i] = a;
      levels[j] = b;
      rows.push({ levels, ptType: 'Edge' });
    });
  });
  for (let c = 0; c < Math.max(1, centers); c += 1) rows.push({ levels: [0, 0, 0], ptType: 'Center' });
  return finish(rows, randomize, seed);
}

/** Turn runs into a worksheet with StdOrder / RunOrder / PtType, factors and a Y column.
 *  Rows follow the RUN order (the order the trials are made); StdOrder keeps the
 *  original standard-order number, so the two columns are always a permutation
 *  of each other that the run row can be read against. */
export function designWorksheet(runs: DesignRun[], names: string[], title: string): Worksheet {
  const ordered = [...runs].sort((a, b) => a.run - b.run);
  const std: number[] = [];
  const run: number[] = [];
  const pt: string[] = [];
  const factors: number[][] = names.map(() => []);
  ordered.forEach((entry) => {
    std.push(entry.std);
    run.push(entry.run);
    pt.push(entry.ptType);
    entry.levels.forEach((v, i) => factors[i].push(v));
  });
  const columns: Omit<Column, 'id'>[] = [
    { name: 'StdOrder', type: 'numeric', values: std },
    { name: 'RunOrder', type: 'numeric', values: run },
    { name: 'PtType', type: 'text', values: pt },
    ...names.map((name, i) => ({ name, type: 'numeric' as const, values: factors[i] })),
    // One empty Y cell per RUN — not per factor name.
    { name: 'Y', type: 'numeric', values: ordered.map(() => null) },
  ];
  return makeWorksheet(title, columns);
}

/* ── factorial analysis ──────────────────────────────────────────────── */

export interface EffectRow {
  term: string;
  effect: number;
  coef: number;
  se: number;
  t: number;
  p: number;
}

export interface FactorialAnalysis {
  glm: GlmResult;
  effects: EffectRow[];
  factorNames: string[];
}

/**
 * Analyze a 2-level factorial: main effects plus every interaction up to
 * `order`. Each 1-df term's effect is twice its coded coefficient.
 */
export function analyzeFactorial(y: (number | null)[], factors: ModelFactor[], order = 2): FactorialAnalysis {
  const names = factors.map((f) => f.name);
  const terms: { name: string; factors: string[] }[] = [];
  const combos: string[][] = [];
  const build = (start: number, current: string[]) => {
    for (let i = start; i < names.length; i += 1) {
      const next = [...current, names[i]];
      if (next.length <= order) {
        combos.push(next);
        build(i + 1, next);
      }
    }
  };
  build(0, []);
  combos.forEach((c) => terms.push({ name: c.join('×'), factors: c }));
  const glm = fitGlm(y, factors, terms);
  const effects: EffectRow[] = terms.map((term, ti) => {
    const start = glm.design.blockStart[ti];
    const coef = glm.beta[start] ?? 0;
    const se = glm.se[start] ?? NaN;
    const tValue = glm.t[start] ?? NaN;
    const pValue = glm.p[start] ?? NaN;
    return {
      term: term.name,
      effect: glm.design.blockSizes[ti] === 1 && term.factors.every((f) => factors.find((x) => x.name === f)?.kind === 'numeric') ? 2 * coef : 2 * coef,
      coef,
      se,
      t: tValue,
      p: pValue,
    };
  });
  return { glm, effects, factorNames: names };
}

/* ── response surface ────────────────────────────────────────────────── */

export interface RsmAnalysis {
  glm: GlmResult;
  factorNames: string[];
  linear: { df: number; ss: number };
  square: { df: number; ss: number };
  interaction: { df: number; ss: number };
  pureError?: { df: number; ss: number; ms: number };
  lackOfFit?: { df: number; ss: number; ms: number; f: number; p: number };
  stationary?: {
    point: number[];
    response: number;
    eigenvalues: number[];
    kind: 'maximum' | 'minimum' | 'saddle';
    /** max |x*| over the factors, in coded units */
    maxAbs: number;
    /** true when the stationary point lies outside the design region */
    outsideRegion: boolean;
  };
  quadratic: { name: string; coef: number }[];
}

function jacobiEigen(matrix: number[][], iterations = 100): number[] {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  for (let sweep = 0; sweep < iterations; sweep += 1) {
    let off = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) off += a[i][j] * a[i][j];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const tValue = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(tValue * tValue + 1);
        const s = tValue * c;
        for (let i = 0; i < n; i += 1) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = c * aip - s * aiq;
          a[i][q] = s * aip + c * aiq;
        }
        for (let i = 0; i < n; i += 1) {
          const api = a[p][i];
          const aqi = a[q][i];
          a[p][i] = c * api - s * aqi;
          a[q][i] = s * api + c * aqi;
        }
      }
    }
  }
  return a.map((row, i) => row[i]).sort((x, y) => y - x);
}

function invertSmall(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const M = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let c = 0; c < 2 * n; c += 1) M[col][c] /= pv;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

export function analyzeRsm(y: (number | null)[], factors: ModelFactor[], options: { alpha?: number } = {}): RsmAnalysis {
  const names = factors.map((f) => f.name);
  const squares: ModelFactor[] = factors.map((f) => ({
    name: `${f.name}²`,
    kind: 'numeric',
    values: f.values.map((v) => (typeof v === 'number' ? v * v : null)),
  }));
  const terms: { name: string; factors: string[] }[] = [];
  names.forEach((name) => terms.push({ name, factors: [name] }));
  squares.forEach((sq) => terms.push({ name: sq.name, factors: [sq.name] }));
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      terms.push({ name: `${names[i]}×${names[j]}`, factors: [names[i], names[j]] });
    }
  }
  const glm = fitGlm(y, [...factors, ...squares], terms);
  const blockSs = (predicate: (name: string) => boolean) => {
    const chosen = glm.terms.filter((tt) => predicate(tt.name));
    return { df: chosen.reduce((a, t) => a + t.df, 0), ss: chosen.reduce((a, t) => a + t.ssAdj, 0) };
  };
  const linear = blockSs((name) => names.includes(name));
  const square = blockSs((name) => name.endsWith('²'));
  const interaction = blockSs((name) => name.includes('×'));
  // Pure error / lack of fit from replicated treatment combinations.
  const cells = new Map<string, number[]>();
  glm.design.rows.forEach((row, i) => {
    const key = factors.map((f) => String(f.values[row] ?? '')).join('|');
    const list = cells.get(key) ?? [];
    list.push(glm.design.y[i]);
    cells.set(key, list);
  });
  let ssPure = 0;
  let dfPure = 0;
  cells.forEach((values) => {
    if (values.length < 2) return;
    const m = mean(values);
    ssPure += values.reduce((a, v) => a + (v - m) ** 2, 0);
    dfPure += values.length - 1;
  });
  const pureError = dfPure > 0 ? { df: dfPure, ss: ssPure, ms: ssPure / dfPure } : undefined;
  const lackDf = glm.dfe - dfPure;
  const lackOfFit = pureError && lackDf > 0
    ? (() => {
      const ss = glm.sse - ssPure;
      const ms = ss / lackDf;
      const f = pureError.ms > 0 ? ms / pureError.ms : NaN;
      return { df: lackDf, ss, ms, f, p: isFinite(f) ? 1 - fCdfLocal(f, lackDf, dfPure) : NaN };
    })()
    : undefined;
  // Stationary point of the full quadratic.
  const beta = glm.beta;
  const index = (label: string) => glm.design.labels.indexOf(label);
  const k = names.length;
  const b = names.map((name) => beta[index(name)] ?? 0);
  const B = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  names.forEach((name, i) => { B[i][i] = beta[index(`${name}²`)] ?? 0; });
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const value = beta[index(`${names[i]}×${names[j]}`)] ?? 0;
      B[i][j] = value / 2;
      B[j][i] = value / 2;
    }
  }
  const BInv = invertSmall(B);
  let stationary: RsmAnalysis['stationary'];
  if (BInv) {
    const point = new Array(k).fill(0);
    for (let i = 0; i < k; i += 1) {
      point[i] = -0.5 * BInv[i].reduce((a, v, j) => a + v * b[j], 0);
    }
    const intercept = beta[0] ?? 0;
    const response = intercept
      + b.reduce((a, v, i) => a + v * point[i], 0)
      + point.reduce((a, xi, i) => a + xi * B[i].reduce((s, v, j) => s + v * point[j], 0), 0);
    const eigenvalues = jacobiEigen(B);
    const kind: 'maximum' | 'minimum' | 'saddle' = eigenvalues.every((v) => v < -1e-9)
      ? 'maximum'
      : eigenvalues.every((v) => v > 1e-9)
        ? 'minimum'
        : 'saddle';
    // Stationary point outside the experimental region: the fitted optimum is an
    // extrapolation, so the reading must carry that warning.
    const maxAbs = Math.max(...point.map((v) => Math.abs(v)));
    const limit = options.alpha && isFinite(options.alpha) ? Math.abs(options.alpha) : 1;
    stationary = { point, response, eigenvalues, kind, maxAbs, outsideRegion: maxAbs > limit + 1e-9 };
  }
  return {
    glm,
    factorNames: names,
    linear,
    square,
    interaction,
    pureError,
    lackOfFit,
    stationary,
    quadratic: terms.map((term, ti) => ({ name: term.name, coef: beta[glm.design.blockStart[ti]] ?? 0 })),
  };
}

/** Predicted response of the fitted quadratic at coded point x. */
export function predictQuadratic(beta: number[], labels: string[], names: string[], x: number[]): number {
  const at = (label: string) => beta[labels.indexOf(label)] ?? 0;
  let value = beta[0] ?? 0;
  names.forEach((name, i) => { value += at(name) * x[i] + at(`${name}²`) * x[i] * x[i]; });
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) value += at(`${names[i]}×${names[j]}`) * x[i] * x[j];
  }
  return value;
}

export interface ContourGrid {
  xs: number[];
  ys: number[];
  z: number[][];
  xName: string;
  yName: string;
  /** design points in coded coordinates */
  points: { x: number; y: number; z: number }[];
  zMin: number;
  zMax: number;
}

/**
 * Contour grid over two factors with the remaining factors held at 0, plus the
 * actual design runs in coded coordinates so the plot can show where they sit.
 */
export function contourGrid(glm: GlmResult, factors: Factor[], xi = 0, yi = 1, resolution = 41): ContourGrid {
  const names = factors.map((f) => f.name);
  const span = Math.max(1.25, ...factors.flatMap((f) => f.values.map((v) => (typeof v === 'number' ? Math.abs(v) : 0))));
  const xs = Array.from({ length: resolution }, (_, i) => -span + (2 * span * i) / (resolution - 1));
  const ys = [...xs];
  const z: number[][] = ys.map((yv) => xs.map((xv) => {
    const point = new Array(names.length).fill(0);
    point[xi] = xv;
    point[yi] = yv;
    return predictQuadratic(glm.beta, glm.design.labels, names, point);
  }));
  const flat = z.flat().filter((v) => isFinite(v));
  const points = glm.design.rows.map((row, i) => {
    const xv = Number(factors[xi].values[row]);
    const yv = Number(factors[yi].values[row]);
    return { x: Number.isFinite(xv) ? xv : 0, y: Number.isFinite(yv) ? yv : 0, z: glm.design.y[i] };
  });
  return {
    xs,
    ys,
    z,
    xName: names[xi],
    yName: names[yi],
    points,
    zMin: flat.length ? extentOf(flat).min : 0,
    zMax: flat.length ? extentOf(flat).max : 1,
  };
}

function fCdfLocal(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0;
  const x = (d1 * f) / (d1 * f + d2);
  return betaLocal(d1 / 2, d2 / 2, x);
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

/* ── RSM model payload: re-slice one fitted surface without refitting ──── */

/** Coded ↔ actual transform for one factor. */
export interface RsmFactorTransform {
  center: number;
  halfRange: number;
  low: number;
  high: number;
}

export interface RsmDesignPoint {
  /** Factor levels exactly as fitted (coded for a standard Sigrún design). */
  levels: number[];
  /** Observed response, or null for a row that did not enter the fit. */
  y: number | null;
  predicted?: number;
}

/**
 * Everything a contour view needs to re-slice the fitted surface: the
 * coefficients, the term labels, the design points and the coded region. It is
 * carried on the `contour` ChartSpec so the Phase 2 drawer can change factor
 * pair, holdings and units without re-running the analysis.
 */
export interface RsmModelPayload {
  beta: number[];
  labels: string[];
  factorNames: string[];
  designPoints: RsmDesignPoint[];
  stationary?: {
    point: number[];
    response: number;
    eigenvalues: number[];
    kind: 'maximum' | 'minimum' | 'saddle';
    maxAbs: number;
    outsideRegion: boolean;
  };
  /** Optional best operating point chosen by an optimiser. */
  optimal?: { point: number[]; response: number };
  /** Coded extent of each factor in the fitted design (e.g. ±1.682 for a CCD). */
  codedBounds: { min: number; max: number }[];
  /** Coded→actual transform; identity when a factor spans -1…1. */
  actualTransform: RsmFactorTransform[];
  s?: number;
  r2?: number;
  n?: number;
  /**
   * Covariance of the estimates, mse·(X'X)⁻¹ in coefficient order (Stage 3B).
   * Carried so an RSM stored model can show a standard error and a prediction
   * interval instead of "not available"; null when the fit had no residual
   * degrees of freedom and therefore no covariance.
   */
  covariance?: number[][] | null;
  /** Residual degrees of freedom and (X'X)⁻¹ rank, absent when unknown. */
  dfe?: number;
  mse?: number;
  rank?: number;
  dfModel?: number;
}

/** min/max over a whole grid without spreading 160k arguments onto the stack. */
function extentOf(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** Build the payload from a fitted quadratic and its analysis. */
export function buildRsmModel(
  glm: GlmResult,
  factors: Factor[],
  stationary?: RsmAnalysis['stationary'],
): RsmModelPayload {
  const factorNames = factors.map((f) => f.name);
  const designPoints: RsmDesignPoint[] = glm.design.rows.map((row, i) => {
    const levels = factorNames.map((_, fi) => Number(factors[fi].values[row]));
    const y = Number(glm.design.y[i]);
    return {
      levels: levels.map((v) => (Number.isFinite(v) ? v : 0)),
      y: Number.isFinite(y) ? y : null,
      predicted: predictQuadratic(glm.beta, glm.design.labels, factorNames, levels.map((v) => (Number.isFinite(v) ? v : 0))),
    };
  });
  const codedBounds = factors.map((f) => {
    const values = f.values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const min = values.length ? Math.min(...values) : -1;
    const max = values.length ? Math.max(...values) : 1;
    return { min, max };
  });
  const actualTransform = codedBounds.map(({ min, max }) => {
    const center = (min + max) / 2;
    const halfRange = (max - min) / 2 || 1;
    return { center, halfRange, low: center - halfRange, high: center + halfRange };
  });
  return {
    beta: [...glm.beta],
    labels: [...glm.design.labels],
    factorNames,
    designPoints,
    stationary,
    codedBounds,
    actualTransform,
    s: glm.s,
    r2: glm.r2,
    n: glm.n,
    // The covariance of the estimates travels with the payload: without it an
    // RSM stored model could only ever report a point prediction.
    covariance: glm.dfe > 0 && glm.xtxInv?.length
      ? glm.xtxInv.map((row) => row.map((value) => (Number.isFinite(value) ? value * glm.mse : 0)))
      : null,
    dfe: glm.dfe,
    mse: glm.mse,
    rank: glm.rank,
    dfModel: glm.dfModel,
  };
}

/** Predicted response at a point given in the model's own (coded) levels. */
export function predictRsmAt(model: RsmModelPayload, point: number[]): number {
  return predictQuadratic(model.beta, model.labels, model.factorNames, point);
}

export function codedToActual(model: RsmModelPayload, factor: number, coded: number): number {
  const t = model.actualTransform[factor];
  return t ? t.center + t.halfRange * coded : coded;
}

export function actualToCoded(model: RsmModelPayload, factor: number, actual: number): number {
  const t = model.actualTransform[factor];
  return t && t.halfRange ? (actual - t.center) / t.halfRange : actual;
}

export interface RsmSurfaceOptions {
  xFactorIndex?: number;
  yFactorIndex?: number;
  /** Holding values for the factors not on either axis, in the requested unit mode. */
  holdingValues?: Record<number, number>;
  /** Display range in the chosen unit mode. */
  xRange?: [number, number];
  yRange?: [number, number];
  unitMode?: 'coded' | 'actual';
  resolution?: number;
  includeDesignPoints?: boolean;
}

export interface RsmSurface {
  grid: ContourGrid;
  xFactorIndex: number;
  yFactorIndex: number;
  xName: string;
  yName: string;
  xRange: [number, number];
  yRange: [number, number];
  unitMode: 'coded' | 'actual';
  /** Display points: design runs plus the stationary / optimal marker. */
  points: { x: number; y: number; z?: number; label?: string; kind: 'design' | 'stationary' | 'optimal' }[];
  zMin: number;
  zMax: number;
  /** True when the displayed range reaches beyond the experimental region. */
  extrapolated: boolean;
}

/**
 * Predict the fitted surface over any factor pair with the remaining factors
 * held at chosen values — the operation behind the RSM view drawer.
 */
export function rsmPredictSurface(model: RsmModelPayload, options: RsmSurfaceOptions = {}): RsmSurface {
  const k = model.factorNames.length;
  const xi = clampIndex(options.xFactorIndex ?? 0, k);
  const yi = clampIndex(options.yFactorIndex ?? (k > 1 ? 1 : 0), k);
  const resolution = Math.max(2, Math.min(601, Math.round(options.resolution ?? 101)));
  const unitMode = options.unitMode ?? 'coded';
  const boundsOf = (f: number) => model.codedBounds[f] ?? { min: -1, max: 1 };
  const toDisplay = (f: number, coded: number) => (unitMode === 'actual' ? codedToActual(model, f, coded) : coded);
  const toCoded = (f: number, display: number) => (unitMode === 'actual' ? actualToCoded(model, f, display) : display);
  const fallbackRange = (f: number): [number, number] => {
    const b = boundsOf(f);
    return [toDisplay(f, b.min), toDisplay(f, b.max)];
  };
  const xRange = options.xRange ?? fallbackRange(xi);
  const yRange = options.yRange ?? fallbackRange(yi);
  const xs = Array.from({ length: resolution }, (_, i) => xRange[0] + ((xRange[1] - xRange[0]) * i) / (resolution - 1));
  const ys = Array.from({ length: resolution }, (_, i) => yRange[0] + ((yRange[1] - yRange[0]) * i) / (resolution - 1));
  const holding = options.holdingValues ?? {};
  const basePoint = (): number[] => {
    const point = new Array(k).fill(0);
    Object.entries(holding).forEach(([index, value]) => {
      const f = Number(index);
      if (Number.isInteger(f) && f >= 0 && f < k && Number.isFinite(value)) point[f] = toCoded(f, value);
    });
    return point;
  };
  const z: number[][] = ys.map((yv) => {
    const yCoded = toCoded(yi, yv);
    return xs.map((xv) => {
      const point = basePoint();
      point[xi] = toCoded(xi, xv);
      point[yi] = yCoded;
      return predictRsmAt(model, point);
    });
  });
  const flat = z.flat().filter((v) => Number.isFinite(v));
  const points: RsmSurface['points'] = [];
  if (options.includeDesignPoints !== false) {
    model.designPoints.forEach((dp) => {
      const xv = toDisplay(xi, dp.levels[xi] ?? 0);
      const yv = toDisplay(yi, dp.levels[yi] ?? 0);
      const response = dp.y ?? dp.predicted;
      points.push({ x: xv, y: yv, z: response, kind: 'design' });
    });
  }
  if (model.stationary) {
    points.push({
      x: toDisplay(xi, model.stationary.point[xi] ?? 0),
      y: toDisplay(yi, model.stationary.point[yi] ?? 0),
      z: model.stationary.response,
      kind: 'stationary',
      label: 'Stationary',
    });
  }
  if (model.optimal) {
    points.push({
      x: toDisplay(xi, model.optimal.point[xi] ?? 0),
      y: toDisplay(yi, model.optimal.point[yi] ?? 0),
      z: model.optimal.response,
      kind: 'optimal',
      label: 'Optimal',
    });
  }
  const xb = boundsOf(xi);
  const yb = boundsOf(yi);
  const codedXRange: [number, number] = [toCoded(xi, xRange[0]), toCoded(xi, xRange[1])];
  const codedYRange: [number, number] = [toCoded(yi, yRange[0]), toCoded(yi, yRange[1])];
  const outside = (range: [number, number], b: { min: number; max: number }) =>
    Math.min(range[0], range[1]) < b.min - 1e-9 || Math.max(range[0], range[1]) > b.max + 1e-9;
  const extrapolated = outside(codedXRange, xb) || outside(codedYRange, yb) || Boolean(model.stationary?.outsideRegion);
  const gridExtent = extentOf(flat);
  const gridZMin = flat.length ? gridExtent.min : 0;
  const gridZMax = flat.length ? gridExtent.max : 1;
  return {
    grid: {
      xs,
      ys,
      z,
      xName: model.factorNames[xi] ?? `X${xi + 1}`,
      yName: model.factorNames[yi] ?? `Y${yi + 1}`,
      points: points.map((point) => ({ x: point.x, y: point.y, z: point.z ?? 0 })),
      zMin: gridZMin,
      zMax: gridZMax,
    },
    xFactorIndex: xi,
    yFactorIndex: yi,
    xName: model.factorNames[xi] ?? `X${xi + 1}`,
    yName: model.factorNames[yi] ?? `Y${yi + 1}`,
    xRange,
    yRange,
    unitMode,
    points,
    zMin: flat.length ? extentOf(flat).min : 0,
    zMax: flat.length ? extentOf(flat).max : 1,
    extrapolated,
  };
}

function clampIndex(value: number, k: number): number {
  if (!Number.isInteger(value) || k <= 0) return 0;
  return Math.max(0, Math.min(k - 1, value));
}

/** Every factor pair of the model, each as a ready-to-render surface. */
export function buildAllPairContours(
  model: RsmModelPayload,
  resolution = 101,
  unitMode: 'coded' | 'actual' = 'coded',
): RsmSurface[] {
  const out: RsmSurface[] = [];
  for (let i = 0; i < model.factorNames.length; i += 1) {
    for (let j = i + 1; j < model.factorNames.length; j += 1) {
      out.push(rsmPredictSurface(model, { xFactorIndex: i, yFactorIndex: j, resolution, unitMode }));
    }
  }
  return out;
}
