/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — probability distributions
   Normal, Student-t, F, and the studentized range (Tukey q).
   Implemented from series / continued-fraction / numeric quadrature so the
   statistical engine has no runtime dependencies.
   ───────────────────────────────────────────────────────────────────────── */

const LN_SQRT_2PI = 0.9189385332046727;

export function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9)
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i += 1) a += c[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 on |x| <= 3, continued fraction tail beyond.
  if (!isFinite(x)) return Math.sign(x);
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  if (ax > 6) return sign;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalPdf(z: number, mean = 0, sd = 1): number {
  const d = (z - mean) / sd;
  return Math.exp(-0.5 * d * d - LN_SQRT_2PI) / sd;
}

export function normalCdf(z: number, mean = 0, sd = 1): number {
  return 0.5 * (1 + erf((z - mean) / (sd * Math.SQRT2)));
}

/** Inverse standard normal CDF (Acklam) with one Halley refinement. */
export function normalInv(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return NaN;
  }
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Halley refinement
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

/** Regularized incomplete beta I_x(a,b) via continued fraction (Lentz). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

export function tPdf(t: number, df: number): number {
  const c = Math.exp(logGamma((df + 1) / 2) - logGamma(df / 2)) / Math.sqrt(df * Math.PI);
  return c * Math.pow(1 + (t * t) / df, -(df + 1) / 2);
}

export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const p = 0.5 * betai(df / 2, 0.5, x);
  return t >= 0 ? 1 - p : p;
}

export function tInv(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -400;
  let hi = 400;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

export function fCdf(f: number, d1: number, d2: number): number {
  if (f <= 0) return 0;
  return betai(d1 / 2, d2 / 2, (d1 * f) / (d1 * f + d2));
}

export function fInv(p: number, d1: number, d2: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 1e6;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (fCdf(mid, d1, d2) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-9 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

/* ── studentized range (Tukey q) ─────────────────────────────────────── */

function simpson(f: (x: number) => number, a: number, b: number, n: number): number {
  const steps = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / steps;
  let sum = f(a) + f(b);
  for (let i = 1; i < steps; i += 1) sum += (i % 2 === 0 ? 2 : 4) * f(a + i * h);
  return (sum * h) / 3;
}

/** CDF of the range of k standard normals, P(W <= w). */
export function rangeCdfInf(w: number, k: number): number {
  if (w <= 0) return 0;
  if (k <= 1) return 1;
  const lo = -6.5;
  const hi = 6.5 + w;
  const value = simpson((z) => {
    const inner = normalCdf(z) - normalCdf(z - w);
    return k * normalPdf(z) * Math.pow(Math.max(inner, 0), k - 1);
  }, lo, hi, 200);
  return Math.min(1, Math.max(0, value));
}

/** CDF of the studentized range statistic Q(k, df). */
export function rangeCdf(q: number, k: number, df: number): number {
  if (q <= 0) return 0;
  if (k <= 1) return 1;
  if (!isFinite(df) || df > 5000) return rangeCdfInf(q, k);
  const nu = df;
  const sd = Math.sqrt(2 * nu);
  const lo = Math.max(1e-3, nu - 9 * sd);
  const hi = nu + 9 * sd;
  const value = simpson((u) => {
    const s = Math.sqrt(u / nu);
    const logDensity = (nu / 2 - 1) * Math.log(u) - u / 2 - (nu / 2) * Math.LN2 - logGamma(nu / 2);
    return Math.exp(logDensity) * rangeCdfInf(q * s, k);
  }, lo, hi, 80);
  return Math.min(1, Math.max(0, value));
}

/** Quantile of the studentized range, i.e. Tukey's q_alpha(k, df). */
export function rangeInv(p: number, k: number, df: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  if (k <= 1) return 0;
  let lo = 0.01;
  let hi = 20;
  for (let i = 0; i < 90; i += 1) {
    const mid = (lo + hi) / 2;
    if (rangeCdf(mid, k, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  return (lo + hi) / 2;
}
