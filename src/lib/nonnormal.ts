/* ─────────────────────────────────────────────────────────────────────────
   Statelia — nonnormal distribution fitting and capability
   Maximum-likelihood fits for the 2-parameter Weibull, lognormal and gamma
   distributions, the Anderson–Darling goodness-of-fit statistic with the
   published critical values for estimated parameters, and the percentile
   form of the capability indices (Pp / Ppk / PPM).
   ───────────────────────────────────────────────────────────────────────── */

import {
  gammaCdf,
  gammaInv,
  gammaLogPdf,
  logGamma,
  lognormalCdf,
  lognormalInv,
  lognormalPdf,
  weibullCdf,
  weibullInv,
  weibullPdf,
} from './dist';
import { clean, mean } from './stats';

export type NonnormalDist = 'weibull' | 'lognormal' | 'gamma';

export interface FitParams {
  /** Weibull: shape; lognormal: σ of ln x; gamma: shape */
  shape: number;
  /** Weibull: scale; lognormal: μ of ln x; gamma: scale */
  scale: number;
  /** log-likelihood at the estimate */
  logLik: number;
}

export interface NonnormalFit {
  dist: NonnormalDist;
  params: FitParams;
  n: number;
  /** non-positive (≤ 0) observations left out of the fit — reported, never silent */
  excluded: number;
  ad: number;
  adAdjusted: number;
  /** critical values at 10 %, 5 %, 1 % for estimated parameters */
  critical: [number, number, number];
  band: 'above10' | 'between05and10' | 'between01and05' | 'below01';
  cdf: (x: number) => number;
  pdf: (x: number) => number;
  quantile: (p: number) => number;
}

/** AD critical values (estimated parameters) from D'Agostino & Stephens (1986). */
const AD_CRITICAL: Record<NonnormalDist, [number, number, number]> = {
  weibull: [0.637, 0.757, 1.038],
  lognormal: [0.631, 0.752, 1.035],
  gamma: [0.632, 0.759, 1.048],
};

function weibullLogLik(values: number[], shape: number): number {
  const n = values.length;
  const sumPow = values.reduce((a, t) => a + Math.pow(t, shape), 0);
  const logSum = values.reduce((a, t) => a + Math.log(t), 0);
  const logShape = Math.log(shape);
  // profile log-likelihood with η̂(shape) substituted
  return n * (logShape - Math.log(sumPow / n)) + (shape - 1) * logSum - n;
}

/** 1-D bounded maximizer (golden section) — stable for the profile likelihood. */
function maximize(fn: (x: number) => number, lo: number, hi: number): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = fn(c);
  let fd = fn(d);
  for (let i = 0; i < 220; i += 1) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = fn(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = fn(d);
    }
  }
  return (a + b) / 2;
}

function fitWeibull(values: number[]): FitParams {
  const logLikShape = (shape: number) => weibullLogLik(values, Math.max(1e-6, shape));
  // Search over a wide but finite shape range in log space.
  const lnShape = maximize((x) => logLikShape(Math.exp(x)), Math.log(0.05), Math.log(60));
  const shape = Math.exp(lnShape);
  const sumPow = values.reduce((a, t) => a + Math.pow(t, shape), 0);
  const scale = Math.pow(sumPow / values.length, 1 / shape);
  return { shape, scale, logLik: weibullLogLik(values, shape) };
}

function fitLognormal(values: number[]): FitParams {
  const logs = values.map((v) => Math.log(v));
  const mu = mean(logs);
  const sigma = Math.sqrt(logs.reduce((a, v) => a + (v - mu) ** 2, 0) / logs.length);
  const logLik = logs.reduce((a, v) => a + (-v - Math.log(sigma) - 0.5 * Math.log(2 * Math.PI) - ((v - mu) ** 2) / (2 * sigma * sigma)), 0);
  return { shape: sigma, scale: mu, logLik };
}

function fitGamma(values: number[]): FitParams {
  const m = mean(values);
  const logs = values.map((v) => Math.log(v));
  const s = Math.log(m) - mean(logs);
  // Minka's starting value, then Newton on ln a − ψ(a) = s.
  let shape = (3 - s + Math.sqrt((s - 3) ** 2 + 24 * s)) / (12 * s);
  if (!(shape > 0) || !isFinite(shape)) shape = 1;
  for (let i = 0; i < 80; i += 1) {
    const f = Math.log(shape) - digammaLocal(shape) - s;
    const df = 1 / shape - trigammaLocal(shape);
    const next = shape - f / df;
    if (!(next > 0) || !isFinite(next)) break;
    if (Math.abs(next - shape) < 1e-12 * shape) { shape = next; break; }
    shape = next;
  }
  const scale = m / shape;
  const logLik = values.reduce((a, v) => a + gammaLogPdf(v, shape, scale), 0);
  return { shape, scale, logLik };
}

/* Local digamma / trigamma keep this module independent of the distribution
   file's exported helpers where only these two are needed. */
function digammaLocal(x: number): number {
  let v = x;
  let r = 0;
  while (v < 6) { r -= 1 / v; v += 1; }
  const inv = 1 / v;
  const inv2 = inv * inv;
  r += Math.log(v) - 0.5 * inv - inv2 * (1 / 12 - inv2 * (1 / 120 - inv2 * (1 / 252 - inv2 * (1 / 240 - inv2 / 132))));
  return r;
}

function trigammaLocal(x: number): number {
  let v = x;
  let r = 0;
  while (v < 6) { r += 1 / (v * v); v += 1; }
  const inv = 1 / v;
  const inv2 = inv * inv;
  r += inv + 0.5 * inv2 + inv * inv2 * (1 / 6 - inv2 * (1 / 30 - inv2 * (1 / 42 - inv2 / 30)));
  return r;
}

export function fitNonnormal(raw: (number | null)[], dist: NonnormalDist): NonnormalFit {
  const all = clean(raw);
  const values = all.filter((v) => v > 0);
  const excluded = all.length - values.length;
  // A Weibull / lognormal / gamma support is (0, ∞): zero and negative values
  // cannot enter the likelihood. They are counted and reported to the user; a
  // sample with no usable value is an error, not an empty fit.
  if (!values.length) throw new Error('nonnormal.invalidData');
  if (values.length < 5) throw new Error('res.insufficient');
  const params = dist === 'weibull' ? fitWeibull(values)
    : dist === 'lognormal' ? fitLognormal(values)
      : fitGamma(values);
  const cdf = dist === 'weibull'
    ? (x: number) => weibullCdf(x, params.shape, params.scale)
    : dist === 'lognormal'
      ? (x: number) => lognormalCdf(x, params.scale, params.shape)
      : (x: number) => gammaCdf(x, params.shape, params.scale);
  const pdf = dist === 'weibull'
    ? (x: number) => weibullPdf(x, params.shape, params.scale)
    : dist === 'lognormal'
      ? (x: number) => lognormalPdf(x, params.scale, params.shape)
      : (x: number) => Math.exp(gammaLogPdf(x, params.shape, params.scale));
  const quantile = dist === 'weibull'
    ? (p: number) => weibullInv(p, params.shape, params.scale)
    : dist === 'lognormal'
      ? (p: number) => lognormalInv(p, params.scale, params.shape)
      : (p: number) => gammaInv(p, params.shape, params.scale);
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (let i = 1; i <= n; i += 1) {
    const hi = Math.min(1 - 1e-12, Math.max(1e-12, cdf(sorted[i - 1])));
    const lo = Math.min(1 - 1e-12, Math.max(1e-12, cdf(sorted[n - i])));
    sum += (2 * i - 1) * (Math.log(hi) + Math.log(1 - lo));
  }
  const ad = -n - sum / n;
  const adAdjusted = ad * (1 + 0.2 / Math.sqrt(n));
  const critical = AD_CRITICAL[dist];
  // Higher AD* means a worse fit: the critical values rise as alpha shrinks.
  const band: NonnormalFit['band'] = adAdjusted <= critical[0]
    ? 'above10'
    : adAdjusted <= critical[1]
      ? 'between05and10'
      : adAdjusted <= critical[2]
        ? 'between01and05'
        : 'below01';
  void logGamma;
  return { dist, params, n, excluded, ad, adAdjusted, critical, band, cdf, pdf, quantile };
}

export interface NonnormalCapability {
  fit: NonnormalFit;
  n: number;
  /** non-positive observations excluded from the fit (reported in the output) */
  excluded: number;
  lsl: number | null;
  usl: number | null;
  target: number | null;
  percentile: (p: number) => number;
  pp: number;
  ppk: number;
  ppu: number;
  ppl: number;
  ppm: number;
  observedPpm: number;
  median: number;
  p00135: number;
  p99865: number;
}

/** Capability from fitted percentiles: the ISO 22514-4 form for any distribution. */
export function nonnormalCapability(
  raw: (number | null)[],
  dist: NonnormalDist,
  specs: { lsl?: number | null; usl?: number | null; target?: number | null } = {},
): NonnormalCapability {
  const all = clean(raw);
  const fit = fitNonnormal(all, dist);
  const values = all.filter((v) => v > 0);
  const lsl = typeof specs.lsl === 'number' && isFinite(specs.lsl) ? specs.lsl : null;
  const usl = typeof specs.usl === 'number' && isFinite(specs.usl) ? specs.usl : null;
  const target = typeof specs.target === 'number' && isFinite(specs.target) ? specs.target : null;
  if (lsl === null && usl === null) throw new Error('res.needSpec');
  const median = fit.quantile(0.5);
  const p00135 = Math.max(1e-12, fit.quantile(0.00135));
  const p99865 = fit.quantile(0.99865);
  const spread = p99865 - p00135;
  const pp = lsl !== null && usl !== null && spread > 0 ? (usl - lsl) / spread : NaN;
  const ppu = usl !== null ? (usl - median) / Math.max(1e-12, p99865 - median) : NaN;
  const ppl = lsl !== null ? (median - lsl) / Math.max(1e-12, median - p00135) : NaN;
  const ppk = lsl !== null && usl !== null ? Math.min(ppl, ppu) : lsl !== null ? ppl : ppu;
  const below = lsl !== null ? fit.cdf(lsl) : 0;
  const above = usl !== null ? 1 - fit.cdf(usl) : 0;
  const observed = values.filter((v) => (lsl !== null && v < lsl) || (usl !== null && v > usl)).length;
  return {
    fit,
    n: values.length,
    excluded: fit.excluded,
    lsl,
    usl,
    target,
    percentile: fit.quantile,
    pp,
    ppk,
    ppu,
    ppl,
    ppm: (below + above) * 1e6,
    observedPpm: values.length ? (observed / values.length) * 1e6 : NaN,
    median,
    p00135,
    p99865,
  };
}
