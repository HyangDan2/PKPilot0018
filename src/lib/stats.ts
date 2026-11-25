/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — statistical engine
   Descriptive statistics, Anderson–Darling normality, t-tests, one-way
   ANOVA with Tukey HSD, and ordinary least squares regression with VIF.
   ───────────────────────────────────────────────────────────────────────── */

import { fCdf, normalCdf, normalInv, normalSf, rangeCdf, rangeInv, tCdf, tInv } from './dist';
import { lstsq } from './linalg';

export type Alt = 'two-sided' | 'less' | 'greater';

export function clean(values: (number | null)[]): number[] {
  return values.filter((v): v is number => typeof v === 'number' && isFinite(v));
}

export function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

export function variance(v: number[]): number {
  if (v.length < 2) return NaN;
  const m = mean(v);
  return v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1);
}

export function stdev(v: number[]): number {
  return Math.sqrt(variance(v));
}

/** Type-6 (Minitab / Excel R-7 style) quantile of an ascending array. */
export function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const h = (n + 1) * p;
  if (h <= 1) return sorted[0];
  if (h >= n) return sorted[n - 1];
  const lo = Math.floor(h);
  const frac = h - lo;
  return sorted[lo - 1] + frac * (sorted[lo] - sorted[lo - 1]);
}

export interface Summary {
  n: number;
  nStar: number;
  sum: number;
  mean: number;
  seMean: number;
  stdev: number;
  variance: number;
  coefVar: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
  range: number;
  skewness: number;
  kurtosis: number;
  sorted: number[];
}

export function summarize(raw: (number | null)[]): Summary {
  const v = clean(raw);
  const n = v.length;
  const sorted = [...v].sort((a, b) => a - b);
  const m = n ? mean(v) : NaN;
  const s = n > 1 ? stdev(v) : NaN;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  let skewness = NaN;
  let kurtosis = NaN;
  if (n > 2 && s > 0) {
    const m3 = v.reduce((a, b) => a + ((b - m) / s) ** 3, 0);
    skewness = (n / ((n - 1) * (n - 2))) * m3;
  }
  if (n > 3 && s > 0) {
    const m4 = v.reduce((a, b) => a + ((b - m) / s) ** 4, 0);
    kurtosis = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * m4 - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  }
  return {
    n,
    nStar: raw.length - n,
    sum: n ? v.reduce((a, b) => a + b, 0) : NaN,
    mean: m,
    seMean: n > 1 ? s / Math.sqrt(n) : NaN,
    stdev: s,
    variance: n > 1 ? s * s : NaN,
    coefVar: n > 1 && m !== 0 ? (s / Math.abs(m)) * 100 : NaN,
    min: n ? sorted[0] : NaN,
    q1,
    median: quantile(sorted, 0.5),
    q3,
    max: n ? sorted[n - 1] : NaN,
    iqr: n ? q3 - q1 : NaN,
    range: n ? sorted[n - 1] - sorted[0] : NaN,
    skewness,
    kurtosis,
    sorted,
  };
}

/** Two-sided p-value helper for a symmetric statistic distribution. */
function pFromCdf(stat: number, cdf: (t: number) => number, alt: Alt): number {
  if (alt === 'less') return Math.min(1, Math.max(0, cdf(stat)));
  if (alt === 'greater') return Math.min(1, Math.max(0, 1 - cdf(stat)));
  const p = cdf(-Math.abs(stat));
  return Math.min(1, Math.max(0, 2 * p));
}

/* ── Anderson–Darling normality ───────────────────────────────────────── */

export interface ADResult {
  n: number;
  mean: number;
  sd: number;
  ad: number;
  adAdj: number;
  p: number;
  sorted: number[];
  cdf: (x: number) => number;
}

export function adNormality(raw: (number | null)[]): ADResult {
  const v = clean(raw);
  const n = v.length;
  const m = mean(v);
  const s = stdev(v);
  const sorted = [...v].sort((a, b) => a - b);
  // A normality test needs at least three values and some variation; without
  // them every statistic below would be NaN/Infinity, so report that plainly.
  if (n < 3 || !isFinite(s) || s <= 0) {
    return { n, mean: m, sd: s, ad: NaN, adAdj: NaN, p: NaN, sorted, cdf: (x: number) => (s > 0 ? normalCdf(x, m, s) : NaN) };
  }
  let sum = 0;
  for (let i = 1; i <= n; i += 1) {
    const cdfLo = Math.max(1e-300, normalCdf(sorted[i - 1], m, s));
    const sfHi = Math.max(1e-300, normalSf(sorted[n - i], m, s));
    sum += (2 * i - 1) * (Math.log(cdfLo) + Math.log(sfHi));
  }
  const a2 = -n - sum / n;
  const adj = a2 * (1 + 0.75 / n + 2.25 / (n * n));
  // D'Agostino & Stephens (1986) / R nortest::ad.test piecewise p-value formula
  let p: number;
  if (adj < 0.2) p = 1 - Math.exp(-13.436 + 101.14 * adj - 223.73 * adj * adj);
  else if (adj < 0.34) p = 1 - Math.exp(-8.318 + 42.796 * adj - 59.938 * adj * adj);
  else if (adj < 0.6) p = Math.exp(0.9177 - 4.279 * adj - 1.38 * adj * adj);
  else p = Math.exp(1.2937 - 5.709 * adj + 0.0186 * adj * adj);
  p = Math.min(1, Math.max(0, p));
  return { n, mean: m, sd: s, ad: a2, adAdj: adj, p, sorted, cdf: (x: number) => normalCdf(x, m, s) };
}

/* ── t tests ──────────────────────────────────────────────────────────── */

export interface TTestResult {
  test: '1-sample' | '2-sample' | 'paired';
  mu0?: number;
  /** paired test: means computed on the rows that formed a valid pair */
  pairedCount?: number;
  mean: number;
  meanB?: number;
  /** observed difference of the means (paired: mean of A − B; 2-sample: x̄₁ − x̄₂) */
  difference: number;
  /** paired test: mean difference minus the hypothesized μ₀ (the tested quantity) */
  differenceVsMu0?: number;
  se: number;
  df: number;
  t: number;
  p: number;
  ci: [number, number];
  conf: number;
  alt: Alt;
  n: number;
  nB?: number;
  stdev: number;
  stdevB?: number;
  method?: 'welch' | 'pooled';
  varianceTest?: { f: number; p: number; df1: number; df2: number };
}

function ciMean(est: number, se: number, df: number, conf: number, alt: Alt): [number, number] {
  const alpha = 1 - conf;
  if (alt === 'two-sided') {
    const t = tInv(1 - alpha / 2, df);
    return [est - t * se, est + t * se];
  }
  const t = tInv(1 - alpha, df);
  return alt === 'less' ? [-Infinity, est + t * se] : [est - t * se, Infinity];
}

export function tTest1(raw: (number | null)[], mu0 = 0, conf = 0.95, alt: Alt = 'two-sided'): TTestResult {
  const v = clean(raw);
  const n = v.length;
  const m = mean(v);
  const s = stdev(v);
  const se = n > 1 ? s / Math.sqrt(n) : NaN;
  // se = 0 (a constant sample) leaves t undefined: the data carry no
  // information about variation around μ₀. The convention — NaN, never 0 or
  // ±∞ — is shared by tTest1 / tTest2 / pairedT and verified as QA-X-04/05/06.
  const t = isFinite(se) && se > 0 ? (m - mu0) / se : NaN;
  return {
    test: '1-sample',
    mu0,
    mean: m,
    difference: m - mu0,
    se,
    df: n - 1,
    t,
    p: pFromCdf(t, (x) => tCdf(x, n - 1), alt),
    ci: ciMean(m, se, n - 1, conf, alt),
    conf,
    alt,
    n,
    stdev: s,
  };
}

export function tTest2(
  rawA: (number | null)[],
  rawB: (number | null)[],
  options: { welch?: boolean; conf?: number; alt?: Alt } = {},
): TTestResult {
  const welch = options.welch ?? true;
  const conf = options.conf ?? 0.95;
  const alt = options.alt ?? 'two-sided';
  const a = clean(rawA);
  const b = clean(rawB);
  const n1 = a.length;
  const n2 = b.length;
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a);
  const vb = variance(b);
  const diff = ma - mb;
  let se: number;
  let df: number;
  if (welch) {
    const s1 = va / n1;
    const s2 = vb / n2;
    se = Math.sqrt(s1 + s2);
    const denom = s1 ** 2 / (n1 - 1) + s2 ** 2 / (n2 - 1);
    df = denom > 0 ? (se ** 4) / denom : NaN;
  } else {
    const sp2 = ((n1 - 1) * va + (n2 - 1) * vb) / (n1 + n2 - 2);
    se = Math.sqrt(sp2 * (1 / n1 + 1 / n2));
    df = n1 + n2 - 2;
  }
  const t = isFinite(se) && se > 0 ? diff / se : NaN;
  const f = vb > 0 ? va / vb : NaN;
  const pf = fCdf(f, n1 - 1, n2 - 1);
  return {
    test: '2-sample',
    mean: ma,
    meanB: mb,
    difference: diff,
    se,
    df,
    t,
    p: pFromCdf(t, (x) => tCdf(x, df), alt),
    ci: ciMean(diff, se, df, conf, alt),
    conf,
    alt,
    n: n1,
    nB: n2,
    stdev: Math.sqrt(va),
    stdevB: Math.sqrt(vb),
    method: welch ? 'welch' : 'pooled',
    varianceTest: n1 > 1 && n2 > 1 && vb > 0 && isFinite(f)
      ? { f, p: Math.min(1, 2 * Math.min(pf, 1 - pf)), df1: n1 - 1, df2: n2 - 1 }
      : undefined,
  };
}

/** Row-wise paired t on (A − B) with a hypothesized difference μ₀. */
export function pairedT(
  rawA: (number | null)[],
  rawB: (number | null)[],
  mu0 = 0,
  conf = 0.95,
  alt: Alt = 'two-sided',
): TTestResult {
  const len = Math.min(rawA.length, rawB.length);
  const diffs: number[] = [];
  const pairedA: number[] = [];
  const pairedB: number[] = [];
  for (let i = 0; i < len; i += 1) {
    const a = rawA[i];
    const b = rawB[i];
    if (typeof a === 'number' && typeof b === 'number' && isFinite(a) && isFinite(b)) {
      diffs.push(a - b);
      pairedA.push(a);
      pairedB.push(b);
    }
  }
  const n = diffs.length;
  const m = mean(diffs);
  const s = stdev(diffs);
  const se = s / Math.sqrt(n);
  // se = 0 leaves t undefined under every sign convention: the paired data
  // carry no information about variation around μ₀, so neither the t statistic
  // nor its p-value exists — not 0 (that would claim perfect agreement with
  // H₀) and not ±∞ (that would claim certainty about the direction). Same NaN
  // convention as tTest1/tTest2; the UI explains it with res.constantTest.
  const t = isFinite(se) && se > 0 ? (m - mu0) / se : NaN;
  return {
    test: 'paired',
    mu0,
    pairedCount: n,
    // Means over the paired rows only, so they line up with the differences.
    mean: mean(pairedA),
    meanB: mean(pairedB),
    // The interval describes the observed mean difference m; μ₀ only enters the
    // test statistic and p-value. Centring the interval on (m − μ₀) shifted it
    // away from the estimate it is supposed to bracket.
    difference: m,
    differenceVsMu0: m - mu0,
    se,
    df: n - 1,
    t,
    p: pFromCdf(t, (x) => tCdf(x, n - 1), alt),
    ci: ciMean(m, se, n - 1, conf, alt),
    conf,
    alt,
    n,
    nB: n,
    stdev: s,
    stdevB: s,
  };
}

/* ── one-way ANOVA + Tukey ────────────────────────────────────────────── */

export interface Group {
  label: string;
  values: number[];
}

export interface AnovaTable {
  dfBetween: number;
  dfWithin: number;
  ssBetween: number;
  ssWithin: number;
  msBetween: number;
  msWithin: number;
  f: number;
  p: number;
  groups: Group[];
  /** pooled within-group standard deviation */
  sPooled: number;
}

export function anovaOneWay(groups: Group[]): AnovaTable {
  const k = groups.length;
  const all = groups.flatMap((g) => g.values);
  const nTotal = all.length;
  const grand = mean(all);
  let ssBetween = 0;
  let ssWithin = 0;
  groups.forEach((g) => {
    const m = mean(g.values);
    ssBetween += g.values.length * (m - grand) ** 2;
    ssWithin += g.values.reduce((a, b) => a + (b - m) ** 2, 0);
  });
  const dfBetween = k - 1;
  const dfWithin = nTotal - k;
  const msBetween = dfBetween > 0 ? ssBetween / dfBetween : NaN;
  const msWithin = dfWithin > 0 ? ssWithin / dfWithin : NaN;
  const f = dfBetween > 0 && dfWithin > 0
    ? (msWithin > 0 ? msBetween / msWithin : msBetween > 0 ? Infinity : NaN)
    : NaN;
  const p = isFinite(f) ? 1 - fCdf(f, dfBetween, dfWithin) : f === Infinity ? 0 : NaN;
  return {
    dfBetween,
    dfWithin,
    ssBetween,
    ssWithin,
    msBetween,
    msWithin,
    f,
    p,
    groups,
    sPooled: msWithin >= 0 ? Math.sqrt(msWithin) : NaN,
  };
}

export interface TukeyPair {
  a: string;
  b: string;
  diff: number;
  se: number;
  ciLow: number;
  ciHigh: number;
  p: number;
  significant: boolean;
}

export interface TukeyResult {
  q: number;
  pairs: TukeyPair[];
  letters: { label: string; mean: number; letter: string }[];
}

export function tukeyHSD(table: AnovaTable, conf = 0.95): TukeyResult {
  const k = table.groups.length;
  const q = rangeInv(conf, k, table.dfWithin);
  const pairs: TukeyPair[] = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const gi = table.groups[i];
      const gj = table.groups[j];
      const diff = mean(gi.values) - mean(gj.values);
      const se = Math.sqrt(table.msWithin * (1 / gi.values.length + 1 / gj.values.length));
      const half = (q / Math.SQRT2) * se;
      const p = 1 - rangeCdf(Math.SQRT2 * Math.abs(diff) / se, k, table.dfWithin);
      pairs.push({
        a: gi.label,
        b: gj.label,
        diff,
        se,
        ciLow: diff - half,
        ciHigh: diff + half,
        p: Math.min(1, Math.max(0, p)),
        significant: Math.abs(diff) > half,
      });
    }
  }
  return { q, pairs, letters: groupingLetters(table, conf) };
}

/** Compact-letter display via Piepho's insert-and-absorb algorithm:
 *  means sharing a letter are not significantly different; significantly
 *  different pairs share no letter. Supports overlapping multi-letter groups. */
export function groupingLetters(table: AnovaTable, conf = 0.95): { label: string; mean: number; letter: string }[] {
  const k = table.groups.length;
  if (k === 0) return [];
  const q = rangeInv(conf, k, table.dfWithin);
  const items = table.groups
    .map((g) => ({ label: g.label, mean: mean(g.values), n: g.values.length }))
    .sort((a, b) => b.mean - a.mean);
  const same = (i: number, j: number): boolean => {
    const a = items[i];
    const b = items[j];
    const se = Math.sqrt(table.msWithin * (1 / a.n + 1 / b.n));
    return Math.abs(a.mean - b.mean) <= (q / Math.SQRT2) * se;
  };
  // Insert-and-absorb: start with one clique containing all items, split on
  // every significant pair, and absorb any group that is a subset of another.
  let cliques: number[][] = [Array.from({ length: k }, (_, i) => i)];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      if (same(i, j)) continue;
      const next: number[][] = [];
      for (const c of cliques) {
        if (c.includes(i) && c.includes(j)) {
          next.push(c.filter((m) => m !== j));
          next.push(c.filter((m) => m !== i));
        } else {
          next.push(c);
        }
      }
      // Absorb subsets
      cliques = next.filter((c, ci) =>
        !next.some((other, oi) =>
          oi !== ci &&
          other.length >= c.length &&
          (other.length > c.length || oi < ci) &&
          c.every((m) => other.includes(m)),
        ),
      );
    }
  }
  cliques.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[a.length - 1] ?? 0) - (b[b.length - 1] ?? 0));
  const letterOf = (index: number): string => {
    let n = index;
    let s = '';
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  };
  const letters = new Array<string>(k).fill('');
  cliques.forEach((clique, bi) => {
    const letter = letterOf(bi);
    clique.forEach((idx) => {
      letters[idx] += letter;
    });
  });
  return items.map((item, idx) => ({ label: item.label, mean: item.mean, letter: letters[idx] }));
}

/* ── ordinary least squares regression ────────────────────────────────── */

export interface RegressionCoefficient {
  term: string;
  coef: number;
  se: number;
  t: number;
  p: number;
  vif: number;
}

export interface RegressionResult {
  coefficients: RegressionCoefficient[];
  anova: { dfReg: number; dfErr: number; ssReg: number; ssErr: number; ssTotal: number; msReg: number; msErr: number; f: number; p: number };
  r2: number;
  r2adj: number;
  r2pred: number;
  s: number;
  n: number;
  residuals: number[];
  fits: number[];
  order: number[];
  yName: string;
  xNames: string[];
  /** mse·(X'X)⁻¹ on the coefficient order — the covariance of the estimates. */
  covariance: number[][];
}

export function regress(
  yRaw: (number | null)[],
  predictors: { name: string; values: (number | null)[] }[],
  yName = 'Y',
): RegressionResult {
  const rows: { y: number; x: number[] }[] = [];
  for (let i = 0; i < yRaw.length; i += 1) {
    const y = yRaw[i];
    if (typeof y !== 'number' || !isFinite(y)) continue;
    const xs: number[] = [];
    let ok = true;
    for (const p of predictors) {
      const v = p.values[i];
      if (typeof v !== 'number' || !isFinite(v)) { ok = false; break; }
      xs.push(v);
    }
    if (ok) rows.push({ y, x: xs });
  }
  const n = rows.length;
  const k = predictors.length;
  if (n <= k + 1) throw new Error('not-enough-data');
  // A predictor that never changes makes the design singular; say so cleanly.
  const sxx: number[] = [];
  for (let j = 0; j < k; j += 1) {
    const col = rows.map((r) => r.x[j]);
    const sd = stdev(col);
    if (sd === 0 || !isFinite(sd)) throw new Error('res.constantPredictor');
    const mu = mean(col);
    sxx.push(col.reduce((acc, v) => acc + (v - mu) * (v - mu), 0));
  }
  const X = rows.map((r) => [1, ...r.x]);
  const ys = rows.map((r) => r.y);
  const p = k + 1;
  // Shared column-pivoted Householder QR solver (never forms X'X).
  const qr = lstsq(X, ys);
  if (qr.rank < p) throw new Error('singular-matrix');
  const beta = qr.beta;
  const inv = qr.xtxInv;
  const fits = X.map((row) => row.reduce((a, b, i) => a + b * beta[i], 0));
  const residuals = ys.map((y, i) => y - fits[i]);
  const ybar = mean(ys);
  const ssTotal = ys.reduce((a, y) => a + (y - ybar) ** 2, 0);
  const ssErr = residuals.reduce((a, r) => a + r * r, 0);
  const ssReg = ssTotal - ssErr;
  const dfReg = k;
  const dfErr = n - p;
  const msErr = ssErr / dfErr;
  const msReg = ssReg / dfReg;
  const f = msErr > 0 ? msReg / msErr : NaN;
  const r2 = ssTotal > 0 ? ssReg / ssTotal : 0;
  const r2adj = 1 - (1 - r2) * ((n - 1) / dfErr);
  // predicted R² using PRESS (undefined when any observation has leverage h_ii = 1)
  let press = 0;
  let pressOk = true;
  for (let i = 0; i < n; i += 1) {
    const h = X[i].reduce((a, xi, a1) => a + xi * X[i].reduce((b, xj, b1) => b + xj * inv[a1][b1], 0), 0);
    if (1 - h <= 1e-9) { pressOk = false; break; }
    const e = residuals[i] / (1 - h);
    press += e * e;
  }
  const r2pred = !pressOk ? NaN : ssTotal > 0 ? 1 - press / ssTotal : 0;
  const s = Math.sqrt(msErr);
  const se0 = Math.sqrt(Math.max(0, msErr * inv[0][0]));
  const t0 = se0 > 0 ? beta[0] / se0 : NaN;
  const coefficients: RegressionCoefficient[] = [
    { term: 'Constant', coef: beta[0], se: se0, t: t0, p: isFinite(t0) ? 2 * (1 - tCdf(Math.abs(t0), dfErr)) : NaN, vif: NaN },
  ];
  // Exact O(1) VIF per predictor from the QR-computed (X'X)⁻¹ on the exact fitted rows:
  //   VIF_j = Sxx_j * [(X'X)⁻¹]_{j+1, j+1}
  for (let j = 0; j < k; j += 1) {
    const se = Math.sqrt(Math.max(0, msErr * inv[j + 1][j + 1]));
    const coef = beta[j + 1];
    const t = se > 0 ? coef / se : NaN;
    const vif = k === 1 ? 1 : sxx[j] * inv[j + 1][j + 1];
    coefficients.push({
      term: predictors[j].name,
      coef,
      se,
      t,
      p: isFinite(t) ? 2 * (1 - tCdf(Math.abs(t), dfErr)) : NaN,
      vif: isFinite(vif) ? Math.max(1, vif) : NaN,
    });
  }
  const covariance = inv.map((row) => row.map((value) => value * msErr));
  return {
    coefficients,
    covariance,
    anova: { dfReg, dfErr, ssReg, ssErr, ssTotal, msReg, msErr, f, p: isFinite(f) ? 1 - fCdf(f, dfReg, dfErr) : NaN },
    r2,
    r2adj,
    r2pred,
    s,
    n,
    residuals,
    fits,
    order: residuals.map((_, i) => i + 1),
    yName,
    xNames: predictors.map((pr) => pr.name),
  };
}

/** Two-sided normal-plot positions (Blom) used for residual probability plots. */
export function normalScores(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i <= n; i += 1) out.push(normalInv((i - 0.375) / (n + 0.25)));
  return out;
}

/* ── regression confidence / prediction bands ─────────────────────────── */

export interface RegressionBandPoint {
  x: number;
  lo: number;
  hi: number;
}

export interface RegressionBands {
  n: number;
  df: number;
  intercept: number;
  slope: number;
  /** residual standard deviation */
  s: number;
  sxx: number;
  xbar: number;
  r2: number;
  /** two-sided t critical value used for the bands */
  tCrit: number;
  mean: RegressionBandPoint[];
  individual: RegressionBandPoint[];
}

/**
 * Exact OLS mean-response confidence band and individual prediction band:
 *
 *   ŷ(x0) ± t(1−α/2, n−2) · s · √(1/n + (x0 − x̄)² / Sxx)      (mean)
 *   ŷ(x0) ± t(1−α/2, n−2) · s · √(1 + 1/n + (x0 − x̄)² / Sxx)  (individual)
 *
 * The bands are evaluated on a grid from the smallest to the largest observed
 * x (inclusive), which is what a scatterplot draws.
 */
export function regressionBands(
  xRaw: (number | null)[],
  yRaw: (number | null)[],
  confidence = 0.95,
  steps = 60,
): RegressionBands {
  const rows: { x: number; y: number }[] = [];
  const length = Math.min(xRaw.length, yRaw.length);
  for (let i = 0; i < length; i += 1) {
    const x = xRaw[i];
    const y = yRaw[i];
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) rows.push({ x, y });
  }
  const empty: RegressionBands = {
    n: 0, df: 0, intercept: NaN, slope: NaN, s: NaN, sxx: NaN, xbar: NaN, r2: NaN, tCrit: NaN, mean: [], individual: [],
  };
  const n = rows.length;
  if (n < 3) return { ...empty, n };
  const xbar = mean(rows.map((r) => r.x));
  const ybar = mean(rows.map((r) => r.y));
  const sxx = rows.reduce((a, r) => a + (r.x - xbar) ** 2, 0);
  if (!(sxx > 0)) return { ...empty, n, xbar };
  const sxy = rows.reduce((a, r) => a + (r.x - xbar) * (r.y - ybar), 0);
  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;
  const df = n - 2;
  const sse = rows.reduce((a, r) => a + (r.y - (intercept + slope * r.x)) ** 2, 0);
  const sst = rows.reduce((a, r) => a + (r.y - ybar) ** 2, 0);
  const s = Math.sqrt(sse / df);
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const alpha = Math.max(1e-6, Math.min(0.999999, 1 - confidence));
  const tCrit = tInv(1 - alpha / 2, df);
  const count = Math.max(2, Math.round(steps));
  const xs = rows.map((r) => r.x);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const pointAt = (x0: number, mode: 'mean' | 'individual'): RegressionBandPoint => {
    const fit = intercept + slope * x0;
    const leverage = 1 / n + ((x0 - xbar) ** 2) / sxx;
    const se = s * Math.sqrt((mode === 'individual' ? 1 : 0) + leverage);
    return { x: x0, lo: fit - tCrit * se, hi: fit + tCrit * se };
  };
  const grid = min === max ? [min - 0.5, max + 0.5] : Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
  return {
    n,
    df,
    intercept,
    slope,
    s,
    sxx,
    xbar,
    r2,
    tCrit,
    mean: grid.map((x0) => pointAt(x0, 'mean')),
    individual: grid.map((x0) => pointAt(x0, 'individual')),
  };
}
