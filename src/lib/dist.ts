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

/**
 * Complementary error function erfc(x) via Cody's rational Chebyshev
 * approximations (Math. Comp. 23, 1969) — ~15-digit relative accuracy across
 * the full IEEE 754 double range with no premature tail truncation.
 */
export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (!isFinite(x)) return x > 0 ? 0 : 2;
  const ax = Math.abs(x);
  if (ax > 27.3) return x > 0 ? 0 : 2;

  let res: number;
  if (ax <= 0.46875) {
    const a = [3.1611237438705656, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3, 1.85777706184603153e-1];
    const b = [2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3];
    const ysq = ax * ax;
    let num = a[4] * ysq;
    let den = ysq;
    for (let i = 0; i < 3; i += 1) {
      num = (num + a[i]) * ysq;
      den = (den + b[i]) * ysq;
    }
    const erfVal = (ax * (num + a[3])) / (den + b[3]);
    return x >= 0 ? 1 - erfVal : 1 + erfVal;
  } else if (ax <= 4.0) {
    const c = [
      5.64188496988670089e-1, 8.88314979438837594, 6.61191906371416295e1, 2.98635138197400131e2,
      8.8195222124176909e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3,
      2.15311535474403846e-8,
    ];
    const d = [
      1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3,
      3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3,
    ];
    let num = c[8] * ax;
    let den = ax;
    for (let i = 0; i < 7; i += 1) {
      num = (num + c[i]) * ax;
      den = (den + d[i]) * ax;
    }
    res = (num + c[7]) / (den + d[7]);
    const ysq = Math.trunc(ax * 16) / 16;
    const del = (ax - ysq) * (ax + ysq);
    res = Math.exp(-ysq * ysq) * Math.exp(-del) * res;
  } else {
    const p = [
      3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1,
      1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2,
    ];
    const q = [
      2.56852019228982242, 1.87295284992346047, 5.27905102951428412e-1,
      6.05183413124413191e-2, 2.33520497626869185e-3,
    ];
    const ysq = 1 / (ax * ax);
    let num = p[5] * ysq;
    let den = ysq;
    for (let i = 0; i < 4; i += 1) {
      num = (num + p[i]) * ysq;
      den = (den + q[i]) * ysq;
    }
    res = (ysq * (num + p[4])) / (den + q[4]);
    res = (0.56418958354775628695 - res) / ax;
    const ysq0 = Math.trunc(ax * 16) / 16;
    const del = (ax - ysq0) * (ax + ysq0);
    res = Math.exp(-ysq0 * ysq0) * Math.exp(-del) * res;
  }
  return x >= 0 ? res : 2 - res;
}

export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (!isFinite(x)) return Math.sign(x);
  if (Math.abs(x) <= 0.46875) {
    return x >= 0 ? 1 - erfc(x) : erfc(-x) - 1;
  }
  return x >= 0 ? 1 - erfc(x) : erfc(-x) - 1;
}

export function normalPdf(z: number, mean = 0, sd = 1): number {
  if (!(sd > 0) || Number.isNaN(z) || Number.isNaN(mean)) return NaN;
  const d = (z - mean) / sd;
  return Math.exp(-0.5 * d * d - LN_SQRT_2PI) / sd;
}

export function normalCdf(z: number, mean = 0, sd = 1): number {
  if (!(sd > 0) || Number.isNaN(z) || Number.isNaN(mean)) return NaN;
  return 0.5 * erfc(-((z - mean) / sd) / Math.SQRT2);
}

/** Independent upper-tail survival function P(Z > z) = 0.5 · erfc(z / √2),
 *  avoiding catastrophic cancellation in 1 − Φ(z) for extreme upper tails. */
export function normalSf(z: number, mean = 0, sd = 1): number {
  if (!(sd > 0) || Number.isNaN(z) || Number.isNaN(mean)) return NaN;
  return 0.5 * erfc(((z - mean) / sd) / Math.SQRT2);
}

/** Inverse standard normal CDF (Acklam) with one erfc-based Halley refinement. */
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
  // Halley refinement using erfc directly so both lower and upper extreme tails
  // achieve ~15-digit accuracy without 1 - CDF cancellation.
  const e = p <= 0.5
    ? 0.5 * erfc(-x / Math.SQRT2) - p
    : (1 - p) - 0.5 * erfc(x / Math.SQRT2);
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  if (isFinite(u)) {
    x = x - u / (1 + (x * u) / 2);
  }
  return x;
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
  if (Number.isNaN(t) || !(df > 0)) return NaN;
  if (!isFinite(t)) return t > 0 ? 1 : 0;
  const x = df / (df + t * t);
  const p = 0.5 * betai(df / 2, 0.5, x);
  return t >= 0 ? 1 - p : p;
}

export function tInv(p: number, df: number): number {
  if (Number.isNaN(p) || !(df > 0)) return NaN;
  if (p < 0 || p > 1) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p === 0.5) return 0;
  // Symmetry: solve for upper tail p' >= 0.5, then restore sign.
  const sign = p < 0.5 ? -1 : 1;
  const target = p < 0.5 ? 1 - p : p;
  let lo = 0;
  let hi = Math.max(1, Math.abs(normalInv(target)));
  for (let i = 0; i < 80 && tCdf(hi, df) < target; i += 1) {
    hi *= 2;
    if (!isFinite(hi)) return sign * Infinity;
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < target) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-12 * Math.max(1, Math.abs(hi))) break;
  }
  return sign * ((lo + hi) / 2);
}

export function fCdf(f: number, d1: number, d2: number): number {
  if (Number.isNaN(f) || !(d1 > 0) || !(d2 > 0)) return NaN;
  if (f <= 0) return 0;
  if (!isFinite(f)) return 1;
  return betai(d1 / 2, d2 / 2, (d1 * f) / (d1 * f + d2));
}

export function fInv(p: number, d1: number, d2: number): number {
  if (Number.isNaN(p) || !(d1 > 0) || !(d2 > 0)) return NaN;
  if (p < 0 || p > 1) return NaN;
  if (p === 0) return 0;
  if (p === 1) return Infinity;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 120 && fCdf(hi, d1, d2) < p; i += 1) {
    hi *= 2;
    if (!isFinite(hi)) return Infinity;
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (fCdf(mid, d1, d2) < p) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-11 * Math.max(1, hi)) break;
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

/** CDF of the studentized range statistic Q(k, df).
 *  Integrates over s = √(u/ν) where u ~ χ²_ν, keeping the density finite at
 *  s = 0 even for ν = 1 (eliminating the u^{-1/2} singularity). */
export function rangeCdf(q: number, k: number, df: number): number {
  if (Number.isNaN(q) || Number.isNaN(k) || Number.isNaN(df) || !(df > 0)) return NaN;
  if (q <= 0) return 0;
  if (!isFinite(q)) return 1;
  if (k <= 1) return 1;
  if (!isFinite(df) || df > 5000) return rangeCdfInf(q, k);
  const nu = df;
  const halfNu = nu / 2;
  const logConst = Math.LN2 + halfNu * Math.log(halfNu) - logGamma(halfNu);
  const sWidth = 10 / Math.sqrt(2 * nu);
  const lo = Math.max(0, 1 - sWidth);
  const hi = 1 + sWidth;
  const integrand = (s: number): number => {
    if (s <= 0) return 0;
    const logDensity = logConst + (nu - 1) * Math.log(s) - halfNu * s * s;
    return Math.exp(logDensity) * rangeCdfInf(q * s, k);
  };
  // For large q and small df, rangeCdfInf(q*s, k) transitions sharply near
  // s ~ O(1/q). Split the interval so the transition region gets full resolution.
  const sSplit = 8 / Math.max(q, 1e-6);
  let value: number;
  if (sSplit > lo + 1e-6 && sSplit < hi - 1e-6) {
    value = simpson(integrand, lo, sSplit, 120) + simpson(integrand, sSplit, hi, 120);
  } else {
    value = simpson(integrand, lo, hi, 120);
  }
  return Math.min(1, Math.max(0, value));
}

/** Quantile of the studentized range, i.e. Tukey's q_alpha(k, df). */
export function rangeInv(p: number, k: number, df: number): number {
  if (Number.isNaN(p) || Number.isNaN(k) || Number.isNaN(df) || !(df > 0)) return NaN;
  if (p < 0 || p > 1) return NaN;
  if (p === 0) return 0;
  if (p === 1) return Infinity;
  if (k <= 1) return 0;
  let lo = 0;
  let hi = 4;
  for (let i = 0; i < 60 && rangeCdf(hi, k, df) < p; i += 1) {
    hi *= 2;
    if (!isFinite(hi)) return Infinity;
  }
  for (let i = 0; i < 120; i += 1) {
    const mid = (lo + hi) / 2;
    if (rangeCdf(mid, k, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo <= 1e-7 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

/* ── additional distributions (P2) ─────────────────────────────────────
   Gamma (with incomplete-gamma P), chi-square, Weibull, lognormal and the
   noncentral t / F distributions used by the power-and-sample-size engine.
   ──────────────────────────────────────────────────────────────────── */

/** Digamma ψ(x) — asymptotic series with recurrence for x < 6. */
export function digamma(x: number): number {
  let v = x;
  let result = 0;
  while (v < 6) {
    result -= 1 / v;
    v += 1;
  }
  const inv = 1 / v;
  const inv2 = inv * inv;
  result += Math.log(v) - 0.5 * inv - inv2 * (1 / 12 - inv2 * (1 / 120 - inv2 * (1 / 252 - inv2 * (1 / 240 - inv2 / 132))));
  return result;
}

/** Trigamma ψ'(x). */
export function trigamma(x: number): number {
  let v = x;
  let result = 0;
  while (v < 6) {
    result += 1 / (v * v);
    v += 1;
  }
  const inv = 1 / v;
  const inv2 = inv * inv;
  result += inv + 0.5 * inv2 + inv * inv2 * (1 / 6 - inv2 * (1 / 30 - inv2 * (1 / 42 - inv2 / 30)));
  return result;
}

/** Regularized lower incomplete gamma P(a, x) (series / continued fraction). */
export function gammaP(a: number, x: number): number {
  if (!(x > 0) || !(a > 0)) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    let n = a;
    for (let i = 1; i < 500; i += 1) {
      n += 1;
      term *= x / n;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return Math.min(1, (sum * Math.exp(-x + a * Math.log(x) - logGamma(a))));
  }
  // Lentz continued fraction for Q(a, x), then P = 1 - Q.
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
  return Math.min(1, Math.max(0, 1 - q));
}

export function gammaPdf(x: number, shape: number, scale = 1): number {
  if (!(x > 0) || !(shape > 0) || !(scale > 0)) return 0;
  return Math.exp((shape - 1) * Math.log(x) - x / scale - logGamma(shape) - shape * Math.log(scale));
}

export function gammaCdf(x: number, shape: number, scale = 1): number {
  if (x <= 0) return 0;
  return gammaP(shape, x / scale);
}

/** Gamma quantile by bisection on the CDF (monotone, cheap enough). */
export function gammaInv(p: number, shape: number, scale = 1): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = Math.max(1, shape) * scale;
  while (gammaCdf(hi, shape, scale) < p && hi < 1e12) hi *= 2;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (gammaCdf(mid, shape, scale) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

export function chi2Cdf(x: number, df: number): number {
  if (x <= 0) return 0;
  return gammaP(df / 2, x / 2);
}

export function weibullPdf(x: number, shape: number, scale: number): number {
  if (!(x >= 0) || !(shape > 0) || !(scale > 0)) return 0;
  return (shape / scale) * Math.pow(x / scale, shape - 1) * Math.exp(-Math.pow(x / scale, shape));
}

export function weibullCdf(x: number, shape: number, scale: number): number {
  if (x <= 0) return 0;
  return 1 - Math.exp(-Math.pow(x / scale, shape));
}

export function weibullInv(p: number, shape: number, scale: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  return scale * Math.pow(-Math.log(1 - p), 1 / shape);
}

export function lognormalPdf(x: number, mu: number, sigma: number): number {
  if (!(x > 0) || !(sigma > 0)) return 0;
  const z = (Math.log(x) - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI));
}

export function lognormalCdf(x: number, mu: number, sigma: number): number {
  if (x <= 0) return 0;
  return normalCdf(Math.log(x), mu, sigma);
}

export function lognormalInv(p: number, mu: number, sigma: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  return Math.exp(mu + sigma * normalInv(p));
}

export function gammaLogPdf(x: number, shape: number, scale = 1): number {
  if (!(x > 0) || !(shape > 0) || !(scale > 0)) return -Infinity;
  return (shape - 1) * Math.log(x) - x / scale - logGamma(shape) - shape * Math.log(scale);
}

/**
 * CDF of the noncentral t distribution.
 *   P(T ≤ t) = E[ Φ(t·√(Y/ν) − δ) ],  Y ~ χ²_ν
 * evaluated by Simpson quadrature over u = √Y (which keeps the density
 * finite at the origin for every ν ≥ 1).
 */
export function nctCdf(t: number, df: number, ncp: number): number {
  if (!isFinite(df) || df <= 0 || Number.isNaN(t) || Number.isNaN(ncp)) return NaN;
  if (!isFinite(t)) return t > 0 ? 1 : 0;
  if (!isFinite(ncp)) return ncp > 0 ? 1 : 0;
  if (Math.abs(ncp) < 1e-12) return tCdf(t, df);
  const root = Math.sqrt(df);
  // Center the quadrature window around the mode √(df - 1) with half-width 12
  // (since χ_ν has constant SD ≈ 1/√2 regardless of df), keeping high accuracy
  // even for df = 1e6..1e8.
  const uCenter = df > 1 ? Math.sqrt(df - 1) : 0;
  const lo = Math.max(0, uCenter - 12);
  const hi = uCenter + 12;
  const steps = 800;
  const h = (hi - lo) / steps;
  const logNorm = -0.5 * df * Math.LN2 - logGamma(df / 2);
  const density = (u: number): number => {
    if (u <= 0) return df === 1 ? Math.sqrt(2 / Math.PI) : 0;
    return 2 * Math.exp((df - 1) * Math.log(u) - 0.5 * u * u + logNorm);
  };
  let sum = 0;
  for (let i = 0; i <= steps; i += 1) {
    const u = lo + i * h;
    const weight = i === 0 || i === steps ? 1 : i % 2 === 1 ? 4 : 2;
    sum += weight * normalCdf((t * u) / root - ncp) * density(u);
  }
  const value = (sum * h) / 3;
  return Math.min(1, Math.max(0, value));
}

/** CDF of the noncentral F distribution (mode-centered Poisson mixture of
 *  incomplete betas — avoids underflow and truncation for arbitrarily large ncp). */
export function ncfCdf(f: number, df1: number, df2: number, ncp: number): number {
  if (Number.isNaN(f) || !(df1 > 0) || !(df2 > 0) || Number.isNaN(ncp) || ncp < 0) return NaN;
  if (f <= 0) return 0;
  if (!isFinite(f)) return 1;
  if (ncp === 0) return fCdf(f, df1, df2);
  const x = (df1 * f) / (df1 * f + df2);
  const half = ncp / 2;
  const k0 = Math.floor(half);
  const w0 = Math.exp(-half + (k0 > 0 ? k0 * Math.log(half) : 0) - logGamma(k0 + 1));
  let sum = w0 * betai(df1 / 2 + k0, df2 / 2, x);
  const MAX_STEPS = 5000;
  // Expand upward from mode k0
  let w = w0;
  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const j = k0 + step;
    w *= half / j;
    if (w === 0) break;
    const term = w * betai(df1 / 2 + j, df2 / 2, x);
    sum += term;
    if (w < 1e-16 && term <= 1e-16 * sum) break;
  }
  // Expand downward from mode k0
  w = w0;
  for (let step = 1; step <= MAX_STEPS && k0 - step >= 0; step += 1) {
    const j = k0 - step;
    w *= (j + 1) / half;
    if (w === 0) break;
    const term = w * betai(df1 / 2 + j, df2 / 2, x);
    sum += term;
    if (w < 1e-16 && term <= 1e-16 * sum) break;
  }
  return Math.min(1, Math.max(0, sum));
}

/** Inverse standard normal folded: z for a two-sided tail probability. */
export function zTwoSided(alpha: number): number {
  return normalInv(1 - alpha / 2);
}
