/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — reliability / survival analysis
   2-parameter Weibull MLE with right censoring. The scale is profiled out of
   the likelihood (η̂(β) = (Σ t^β / r)^{1/β} for r failures), which turns the
   fit into a one-dimensional maximisation that cannot diverge the way a raw
   two-parameter Newton step can. Standard errors come from the observed
   Fisher information at the optimum; every life percentile gets a Wald
   interval on the log scale through the delta method.
   ───────────────────────────────────────────────────────────────────────── */

import { logGamma, normalInv } from './dist';

export interface WeibullPoint {
  time: number;
  /** plotting position of the cumulative failure fraction (Benard / KM) */
  f: number;
  x: number;
  y: number;
}

export interface WeibullResult {
  shape: number;
  scale: number;
  seShape: number;
  seScale: number;
  ciShape: [number, number];
  ciScale: [number, number];
  logLik: number;
  n: number;
  failures: number;
  censored: number;
  mttf: number;
  mttfCi: [number, number];
  median: number;
  b90: number;
  b10: number;
  b5: number;
  percentile: (p: number) => number;
  survival: (t: number) => number;
  hazard: (t: number) => number;
  ad: number;
  adAdjusted: number;
  band: 'above10' | 'between05and10' | 'between01and05' | 'below01';
  points: WeibullPoint[];
  cov: { bb: number; ba: number; aa: number };
  /** 95 % band on the fitted line, in the transformed (extreme value) scale */
  band95: (x: number) => [number, number];
}

const WEIBULL_AD_CRITICAL: [number, number, number] = [0.637, 0.757, 1.038];

export interface WeibullInput {
  time: number;
  /** 0 = right-censored, 1 = failure (Minitab's default coding) */
  censored: boolean;
}

function logLikelihood(rows: WeibullInput[], shape: number, scale: number): number {
  let sum = 0;
  const logScale = Math.log(scale);
  for (const row of rows) {
    if (!(row.time > 0)) continue;
    sum -= Math.pow(row.time / scale, shape);
    if (!row.censored) {
      sum += Math.log(shape) - shape * logScale + (shape - 1) * Math.log(row.time);
    }
  }
  return sum;
}

/** Profile MLE of the scale for a fixed shape. */
function profileScale(rows: WeibullInput[], shape: number): number {
  const failures = rows.filter((r) => !r.censored).length;
  if (!failures) return NaN;
  let sum = 0;
  rows.forEach((row) => { if (row.time > 0) sum += Math.pow(row.time, shape); });
  return Math.pow(sum / failures, 1 / shape);
}

function maximize1D(fn: (x: number) => number, lo: number, hi: number): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = fn(c);
  let fd = fn(d);
  for (let i = 0; i < 260; i += 1) {
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

export function fitWeibull(rows: WeibullInput[], conf = 0.95): WeibullResult {
  const data = rows.filter((r) => isFinite(r.time) && r.time > 0);
  const n = data.length;
  const failures = data.filter((r) => !r.censored).length;
  if (n < 3) throw new Error('res.insufficient');
  if (failures < 2) throw new Error('rel.needFailures');
  const profile = (lnShape: number): number => {
    const shape = Math.exp(lnShape);
    const scale = profileScale(data, shape);
    if (!(scale > 0) || !isFinite(scale)) return -Infinity;
    return logLikelihood(data, shape, scale);
  };
  const lnShape = maximize1D(profile, Math.log(0.02), Math.log(200));
  let shape = Math.exp(lnShape);
  let scale = profileScale(data, shape);
  let logLik = logLikelihood(data, shape, scale);
  // One Newton polishing step on (β, ln η) keeps the Hessian consistent with
  // the reported estimate to full precision.
  for (let iter = 0; iter < 8; iter += 1) {
    const a = Math.log(scale);
    let gb = 0;
    let ga = 0;
    let hbb = 0;
    let hba = 0;
    let haa = 0;
    data.forEach((row) => {
      const r = Math.exp(shape * (Math.log(row.time) - a));
      const z = Math.log(row.time) - a;
      if (!row.censored) {
        gb += 1 / shape + z;
        ga -= shape;
        hbb -= 1 / (shape * shape);
        hba -= 1;
      }
      gb -= r * z;
      ga += shape * r;
      hbb -= r * z * z;
      hba += shape * r * z + r;
      haa -= shape * shape * r;
    });
    const det = hbb * haa - hba * hba;
    if (!(Math.abs(det) > 1e-18)) break;
    const deltaShape = (haa * gb - hba * ga) / det;
    const deltaA = (hbb * ga - hba * gb) / det;
    let step = 1;
    let improved = false;
    for (let s = 0; s < 30; s += 1) {
      const trialShape = shape - step * deltaShape;
      const trialScale = Math.exp(a - step * deltaA);
      if (!(trialShape > 0) || !(trialScale > 0)) {
        step /= 2;
        continue;
      }
      const trial = logLikelihood(data, trialShape, trialScale);
      if (trial >= logLik) {
        shape = trialShape;
        scale = trialScale;
        logLik = trial;
        improved = true;
        break;
      }
      step /= 2;
    }
    if (!improved) break;
  }
  const a = Math.log(scale);
  let hbb = 0;
  let hba = 0;
  let haa = 0;
  data.forEach((row) => {
    const r = Math.exp(shape * (Math.log(row.time) - a));
    const z = Math.log(row.time) - a;
    if (!row.censored) hbb -= 1 / (shape * shape);
    hbb -= r * z * z;
    hba += shape * r * z + r;
    if (!row.censored) hba -= 1;
    haa -= shape * shape * r;
  });
  const det = hbb * haa - hba * hba;
  // Covariance = (−H)⁻¹ in (β, ln η).
  const cov: { bb: number; ba: number; aa: number } = Math.abs(det) > 1e-18
    ? { bb: -haa / det, ba: hba / det, aa: -hbb / det }
    : { bb: NaN, ba: NaN, aa: NaN };
  const seShape = Math.sqrt(Math.max(0, cov.bb));
  const seScale = scale * Math.sqrt(Math.max(0, cov.aa));
  const z = normalInv((1 + conf) / 2);
  const shapeLo = shape * Math.exp(-z * (seShape / shape));
  const shapeHi = shape * Math.exp(z * (seShape / shape));
  const scaleLo = scale * Math.exp(-z * (seScale / scale));
  const scaleHi = scale * Math.exp(z * (seScale / scale));
  const percentile = (p: number): number => (p <= 0 ? 0 : p >= 1 ? Infinity : scale * Math.pow(-Math.log(1 - p), 1 / shape));
  // Γ(1+1/β) with its own delta-method variance.
  const gammaArg = 1 + 1 / shape;
  const mttf = scale * Math.exp(logGamma(gammaArg));
  const dGamma = derivativeLogGamma(gammaArg);
  const varLnMttf = cov.aa + (dGamma / (shape * shape)) ** 2 * cov.bb + 2 * (dGamma / shape) * cov.ba;
  const seLnMttf = Math.sqrt(Math.max(0, varLnMttf));
  const mttfLo = mttf * Math.exp(-z * seLnMttf);
  const mttfHi = mttf * Math.exp(z * seLnMttf);
  const median = percentile(0.5);
  // Plotting positions: Benard for complete data, Kaplan–Meier with censoring.
  const sorted = [...data].sort((x, y) => x.time - y.time);
  const points: WeibullPoint[] = [];
  let atRisk = sorted.length;
  let survival = 1;
  sorted.forEach((row) => {
    if (row.censored) {
      atRisk -= 1;
      return;
    }
    survival *= 1 - 1 / Math.max(1, atRisk);
    atRisk -= 1;
    const f = Math.min(1 - 1e-9, Math.max(1e-9, 1 - survival));
    points.push({ time: row.time, f, x: Math.log(row.time), y: Math.log(-Math.log(1 - f)) });
  });
  const nFail = points.length;
  const ad = points.length
    ? -nFail - (1 / nFail) * points.reduce((acc, point, i) => {
      const hi = Math.min(1 - 1e-12, Math.max(1e-12, point.f));
      const lo = Math.min(1 - 1e-12, Math.max(1e-12, points[nFail - 1 - i].f));
      return acc + (2 * (i + 1) - 1) * (Math.log(hi) + Math.log(1 - lo));
    }, 0)
    : NaN;
  const adAdjusted = ad * (1 + 0.2 / Math.sqrt(Math.max(1, nFail)));
  const band: WeibullResult['band'] = adAdjusted <= WEIBULL_AD_CRITICAL[0]
    ? 'above10'
    : adAdjusted <= WEIBULL_AD_CRITICAL[1]
      ? 'between05and10'
      : adAdjusted <= WEIBULL_AD_CRITICAL[2]
        ? 'between01and05'
        : 'below01';
  return {
    shape,
    scale,
    seShape,
    seScale,
    ciShape: [shapeLo, shapeHi],
    ciScale: [scaleLo, scaleHi],
    logLik,
    n,
    failures,
    censored: n - failures,
    mttf,
    mttfCi: [mttfLo, mttfHi],
    median,
    b90: percentile(0.9),
    b10: percentile(0.1),
    b5: percentile(0.05),
    percentile,
    survival: (t: number) => (t <= 0 ? 1 : Math.exp(-Math.pow(t / scale, shape))),
    hazard: (t: number) => (t <= 0 ? 0 : (shape / scale) * Math.pow(t / scale, shape - 1)),
    ad,
    adAdjusted,
    band,
    points,
    cov,
    band95: (x: number) => {
      const w = shape * (x - Math.log(scale));
      const se = Math.sqrt(Math.max(0, cov.aa + (x - Math.log(scale)) ** 2 * cov.bb - 2 * (x - Math.log(scale)) * cov.ba));
      return [w - z * se, w + z * se];
    },
  };
}

function derivativeLogGamma(x: number): number {
  // d/dx ln Γ(x) — digamma, tabulated through the same asymptotic series.
  let v = x;
  let r = 0;
  while (v < 6) { r -= 1 / v; v += 1; }
  const inv = 1 / v;
  const inv2 = inv * inv;
  r += Math.log(v) - 0.5 * inv - inv2 * (1 / 12 - inv2 * (1 / 120 - inv2 * (1 / 252)));
  return r;
}

/** Lognormal parametric fit (MLE on ln t, right censoring ignored for the mean). */
export function fitLognormalReliability(rows: WeibullInput[]): { mu: number; sigma: number; median: number } {
  const logs = rows.filter((r) => !r.censored && r.time > 0).map((r) => Math.log(r.time));
  if (logs.length < 2) throw new Error('rel.needFailures');
  const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
  const sigma = Math.sqrt(logs.reduce((a, b) => a + (b - mu) ** 2, 0) / logs.length);
  return { mu, sigma, median: Math.exp(mu) };
}
