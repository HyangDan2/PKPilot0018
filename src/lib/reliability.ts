/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — reliability / survival analysis
   2-parameter Weibull MLE with right censoring. The scale is profiled out of
   the likelihood (η̂(β) = (Σ t^β / r)^{1/β} for r failures), which turns the
   fit into a one-dimensional maximisation that cannot diverge the way a raw
   two-parameter Newton step can. Standard errors come from the observed
   Fisher information at the optimum; every life percentile gets a Wald
   interval on the log scale through the delta method.
   ───────────────────────────────────────────────────────────────────────── */

import { logGamma, normalCdf, normalInv } from './dist';

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
  /** Anderson–Darling A², computed against the FITTED Weibull CDF (never the
   *  empirical plotting positions). With right censoring it uses the failure
   *  times only — see `adBasis`. */
  ad: number;
  /** Stephens' small-sample correction A* = A²(1 + 0.2/√n). */
  adAdjusted: number;
  band: 'above10' | 'between05and10' | 'between01and05' | 'below01';
  /** which observations the AD statistic was evaluated on */
  adBasis: 'complete' | 'failures';
  /** Parametric-bootstrap p-value of the failures-only A* under the fitted
   *  Weibull with the observed right-censoring pattern (NaN for complete data,
   *  where the tabulated critical values apply and no bootstrap is needed).
   *  (hits + 1) / (reps + 1), so it can never be exactly 0. */
  adBootstrapP: number;
  /** bootstrap replicates used for adBootstrapP (0 when not computed) */
  adBootstrapReps: number;
  /** largest |F̂_fitted(t) − F̂_Kaplan–Meier(t)| over the failure times */
  kmDev: number;
  /** 5 % Kolmogorov critical value 1.36/√k for that deviation (k = failures) */
  kmCritical05: number;
  kmBand: 'above05' | 'below05';
  points: WeibullPoint[];
  cov: { bb: number; ba: number; aa: number };
  /** confidence level the intervals were computed at */
  conf: number;
  /**
   * Confidence band on the fitted line in the transformed (extreme value)
   * scale w(x) = β(x − ln η). Var(w) = β²·cov.aa + (x−a)²·cov.bb − 2β(x−a)·cov.ba,
   * the delta method on w with respect to (β, a). `level` defaults to the
   * fit's own confidence level.
   */
  ciBand: (x: number, level?: number) => [number, number];
  /** convenience: the band at the fit's own confidence level */
  band95: (x: number) => [number, number];
}

const WEIBULL_AD_CRITICAL: [number, number, number] = [0.637, 0.757, 1.038];

/** Replicates of the censored-data AD bootstrap (fixed for reproducibility). */
export const WEIBULL_AD_BOOTSTRAP_REPS = 300;
/** Fixed seed — the same sample always reports the same bootstrap p-value. */
const WEIBULL_AD_BOOTSTRAP_SEED = 0x51e6_2f1a;

/** Mulberry32: 32-bit deterministic PRNG, enough for a bootstrap and reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Profile log-likelihood of the 2-parameter Weibull at a fixed shape. Uses
 * Σ(t/η)^β = r at the profiled scale, so one pass over the times is enough —
 * this is what keeps 300 bootstrap refits cheap.
 */
function profileLogLikFast(times: number[], logTimeSumFailed: number, failures: number, shape: number): number {
  let sumT = 0;
  for (let i = 0; i < times.length; i += 1) sumT += Math.pow(times[i], shape);
  if (!(sumT > 0) || !isFinite(sumT)) return -Infinity;
  const lnScale = Math.log(sumT / failures) / shape;
  return failures * Math.log(shape) - failures * shape * lnScale + (shape - 1) * logTimeSumFailed - failures;
}

/** Shape (and its profiled scale) of one bootstrap sample, golden-section on ln β. */
function profileFit(times: number[], logTimeSumFailed: number, failures: number): { shape: number; scale: number } | null {
  if (failures < 2 || times.length < 3) return null;
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = Math.log(0.02);
  let b = Math.log(200);
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = profileLogLikFast(times, logTimeSumFailed, failures, Math.exp(c));
  let fd = profileLogLikFast(times, logTimeSumFailed, failures, Math.exp(d));
  for (let i = 0; i < 70; i += 1) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = profileLogLikFast(times, logTimeSumFailed, failures, Math.exp(c));
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = profileLogLikFast(times, logTimeSumFailed, failures, Math.exp(d));
    }
  }
  const shape = Math.exp((a + b) / 2);
  let sumT = 0;
  for (let i = 0; i < times.length; i += 1) sumT += Math.pow(times[i], shape);
  if (!(sumT > 0) || !isFinite(sumT)) return null;
  return { shape, scale: Math.pow(sumT / failures, 1 / shape) };
}

/** A* = A²(1 + 0.2/√k) on the failure times against the fitted Weibull CDF. */
function failuresAdAdjusted(rows: WeibullInput[], shape: number, scale: number): number {
  const failed = rows.filter((r) => !r.censored);
  if (failed.length < 2) return NaN;
  const cdf = failed.map((r) => 1 - Math.exp(-Math.pow(r.time / scale, shape)));
  const ad = adStatistic(cdf);
  return ad * (1 + 0.2 / Math.sqrt(Math.max(1, failed.length)));
}

/**
 * Parametric-bootstrap null distribution of the censored-data A*.
 *
 * Under H₀ (the fitted Weibull is the truth) each replicate draws n lifetimes
 * from Weibull(shape, scale) and applies the SAME right-censoring mechanism the
 * sample shows: the failure/censoring share is kept, and each censoring time is
 * redrawn from the empirical distribution of the observed censoring times. A
 * replicate that happens to produce fewer than two failures has its two earliest
 * observations read as failures instead (a fit needs two), which keeps the failure
 * rate intact instead of dropping the replicate. The replicate is refitted and
 * its failures-only A* compared with the observed one; p = (hits + 1)/(B + 1).
 */
function bootstrapAdP(
  data: WeibullInput[],
  shape: number,
  scale: number,
  observedAdjusted: number,
  reps = WEIBULL_AD_BOOTSTRAP_REPS,
): number {
  const n = data.length;
  const censTimes = data.filter((r) => r.censored).map((r) => r.time);
  if (!censTimes.length || !(observedAdjusted >= 0)) return NaN;
  const censShare = censTimes.length / n;
  const rand = mulberry32(WEIBULL_AD_BOOTSTRAP_SEED);
  let hits = 0;
  for (let b = 0; b < reps; b += 1) {
    const sample: WeibullInput[] = [];
    for (let i = 0; i < n; i += 1) {
      const u = Math.min(1 - 1e-12, Math.max(1e-12, rand()));
      const life = scale * Math.pow(-Math.log(u), 1 / shape);
      const isCensored = censShare > 0 && rand() < censShare;
      if (isCensored) {
        const c = censTimes[Math.min(censTimes.length - 1, Math.floor(rand() * censTimes.length))];
        if (c < life) {
          sample.push({ time: c, censored: true });
          continue;
        }
      }
      sample.push({ time: life, censored: false });
    }
    let failed = sample.filter((r) => !r.censored);
    if (failed.length < 2) {
      const earliest = [...sample].sort((x, y) => x.time - y.time).slice(0, 2);
      earliest.forEach((row) => { row.censored = false; });
      failed = sample.filter((r) => !r.censored);
    }
    const times = sample.map((r) => r.time);
    const logTimeSumFailed = failed.reduce((acc, r) => acc + Math.log(r.time), 0);
    const fit = profileFit(times, logTimeSumFailed, failed.length);
    if (!fit) {
      hits += 1;
      continue;
    }
    const replicateAdjusted = failuresAdAdjusted(sample, fit.shape, fit.scale);
    if (!(replicateAdjusted < observedAdjusted)) hits += 1;
  }
  return (hits + 1) / (reps + 1);
}

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
  // MTTF = η·Γ(1 + 1/β). With g(β, a) = a + ln Γ(1 + 1/β):
  //   ∂g/∂a = 1,  ∂g/∂β = −ψ(1 + 1/β)/β²
  // so Var(ln MTTF) = cov.aa + (ψ/β²)² cov.bb − 2(ψ/β²) cov.ba.
  const gammaArg = 1 + 1 / shape;
  const mttf = scale * Math.exp(logGamma(gammaArg));
  const dGamma = derivativeLogGamma(gammaArg);
  const dMttfBeta = -dGamma / (shape * shape);
  const varLnMttf = cov.aa + dMttfBeta ** 2 * cov.bb + 2 * dMttfBeta * cov.ba;
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
  // Anderson–Darling is evaluated against the FITTED CDF F(t) = 1 − e^{−(t/η)^β},
  // not the empirical/KM plotting position: the plotting positions are the data
  // being tested and using them shrinks A² toward zero. Complete data use every
  // observation; with right censoring only the failure times can be ranked, so
  // the statistic is the failures-only approximation and the KM deviation below
  // carries the censoring information.
  const adSample = data.filter((r) => !r.censored);
  const adCdf = adSample.map((r) => 1 - Math.exp(-Math.pow(r.time / scale, shape)));
  const ad = adStatistic(adCdf);
  const adBasis: WeibullResult['adBasis'] = data.some((r) => r.censored) ? 'failures' : 'complete';
  const adN = adBasis === 'complete' ? n : nFail;
  const adAdjusted = ad * (1 + 0.2 / Math.sqrt(Math.max(1, adN)));
  // Kaplan–Meier sanity check: the parametric CDF must track the nonparametric
  // one. 1.36/√k is the asymptotic 5 % Kolmogorov bound (the fitted parameters
  // make it a little conservative; it is reported as guidance, not a p-value).
  const kmDev = points.length
    ? Math.max(...points.map((p) => Math.abs(p.f - (1 - Math.exp(-Math.pow(p.time / scale, shape))))))
    : NaN;
  const kmCritical05 = nFail > 0 ? 1.36 / Math.sqrt(nFail) : NaN;
  const band: WeibullResult['band'] = adAdjusted <= WEIBULL_AD_CRITICAL[0]
    ? 'above10'
    : adAdjusted <= WEIBULL_AD_CRITICAL[1]
      ? 'between05and10'
      : adAdjusted <= WEIBULL_AD_CRITICAL[2]
        ? 'between01and05'
        : 'below01';
  // The table's critical values are for COMPLETE data. With right censoring the
  // failures-only A* has no tabulated null distribution, so its p-value comes
  // from a parametric bootstrap that reproduces the censoring pattern instead.
  const adBootstrapReps = adBasis === 'failures' ? WEIBULL_AD_BOOTSTRAP_REPS : 0;
  const adBootstrapP = adBasis === 'failures'
    ? bootstrapAdP(data, shape, scale, adAdjusted, adBootstrapReps)
    : NaN;
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
    adBasis,
    adBootstrapP,
    adBootstrapReps,
    kmDev,
    kmCritical05,
    kmBand: kmDev <= kmCritical05 ? 'above05' : 'below05',
    points,
    cov,
    conf,
    // Delta method on w = β(x − a): ∂w/∂β = x − a, ∂w/∂a = −β.
    ciBand: (x: number, level = conf) => {
      const a = Math.log(scale);
      const dx = x - a;
      const w = shape * dx;
      const se = Math.sqrt(Math.max(0, shape * shape * cov.aa + dx * dx * cov.bb - 2 * shape * dx * cov.ba));
      const zc = level === conf ? z : normalInv((1 + Math.min(0.999999, Math.max(0.5, level))) / 2);
      return [w - zc * se, w + zc * se];
    },
    band95: (x: number) => {
      const a = Math.log(scale);
      const dx = x - a;
      const w = shape * dx;
      const se = Math.sqrt(Math.max(0, shape * shape * cov.aa + dx * dx * cov.bb - 2 * shape * dx * cov.ba));
      return [w - z * se, w + z * se];
    },
  };
}

/** A² = −n − (1/n) Σ (2i−1)[ln F(x_(i)) + ln(1 − F(x_(n+1−i)))]. */
function adStatistic(cdfValues: number[]): number {
  const n = cdfValues.length;
  if (!n) return NaN;
  const f = cdfValues.map((v) => Math.min(1 - 1e-12, Math.max(1e-12, v))).sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += (2 * (i + 1) - 1) * (Math.log(f[i]) + Math.log(1 - f[n - 1 - i]));
  }
  return -n - sum / n;
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

/** Lognormal parametric fit by maximum likelihood, right censoring included. */
export interface LognormalReliability {
  mu: number;
  sigma: number;
  median: number;
  /** E[T] = exp(μ + σ²/2) */
  mttf: number;
  logLik: number;
  n: number;
  failures: number;
  censored: number;
  /** share of the sample that is right-censored, in percent */
  censoredPct: number;
  seMu: number;
  seSigma: number;
  /** true when the closed-form complete-data MLE was used (no censoring) */
  closedForm: boolean;
}

/**
 * Lognormal MLE with right-censored observations. The likelihood is
 *
 *   Σ_fail [−ln(σ t_i) − ½ln(2π) − (ln t_i − μ)²/(2σ²)]
 * + Σ_cens  ln[1 − Φ((ln t_j − μ)/σ)]
 *
 * maximised over (μ, ln σ) by a deterministic Nelder–Mead simplex; with no
 * censoring it reduces to the closed-form (mean, population sd) of ln t.
 */
export function fitLognormalReliability(rows: WeibullInput[], tolConf = 0.95): LognormalReliability {
  const data = rows.filter((r) => isFinite(r.time) && r.time > 0);
  const n = data.length;
  const failures = data.filter((r) => !r.censored).length;
  const censored = n - failures;
  if (n < 2 || failures < 2) throw new Error('rel.needFailures');
  const logT = data.map((r) => Math.log(r.time));
  const failLog = data.filter((r) => !r.censored).map((r) => Math.log(r.time));
  const completeCases = failures === n;
  const closedMu = failLog.reduce((a, b) => a + b, 0) / failLog.length;
  const closedSigma = Math.sqrt(failLog.reduce((a, v) => a + (v - closedMu) ** 2, 0) / failLog.length);

  const logLik = (mu: number, sigma: number): number => {
    if (!(sigma > 0) || !isFinite(sigma)) return -Infinity;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const z = (logT[i] - mu) / sigma;
      if (data[i].censored) {
        const tail = 1 - normalCdf(z);
        sum += Math.log(Math.max(1e-300, tail));
      } else {
        sum += -Math.log(sigma) - logT[i] - 0.5 * Math.log(2 * Math.PI) - 0.5 * z * z;
      }
    }
    return sum;
  };

  let mu = closedMu;
  let sigma = closedSigma > 1e-9 ? closedSigma : 1;
  let best = logLik(mu, sigma);
  if (!completeCases) {
    // Nelder–Mead on (μ, ln σ): no derivatives, no divergence on flat ridges.
    const objective = (p: number[]): number => -logLik(p[0], Math.exp(p[1]));
    let simplex = [
      [mu, Math.log(sigma)],
      [mu + 1, Math.log(sigma)],
      [mu, Math.log(sigma) + 1],
    ].map((p) => ({ p, f: objective(p) }));
    const stepOf = (scale: number) => scale;
    for (let iter = 0; iter < 4000; iter += 1) {
      simplex = simplex.slice().sort((a, b) => a.f - b.f);
      const [b, g, w] = simplex;
      const spread = Math.max(...simplex.map((s) => s.f)) - b.f;
      if (spread < 1e-13 && iter > 50) break;
      const centroid = [0, 1].map((k) => (b.p[k] + g.p[k]) / 2);
      const along = (factor: number) => centroid.map((c, k) => c + factor * (w.p[k] - c));
      const shrunk = (s: { p: number[]; f: number }) => ({ p: s.p.map((v, k) => b.p[k] + 0.5 * (v - b.p[k])), f: NaN });
      const r = along(-1);
      const fr = objective(r);
      let next: { p: number[]; f: number }[];
      if (fr < b.f) {
        const e = along(-2);
        const fe = objective(e);
        next = [b, fe < fr ? { p: e, f: fe } : { p: r, f: fr }, g];
      } else if (fr < g.f) {
        next = [b, { p: r, f: fr }, g];
      } else {
        const c = along(-0.5);
        const fc = objective(c);
        if (fc < w.f) {
          next = [b, g, { p: c, f: fc }];
        } else {
          const s1 = shrunk(g);
          s1.f = objective(s1.p);
          const s2 = shrunk(w);
          s2.f = objective(s2.p);
          next = [b, s1, s2];
          void stepOf;
        }
      }
      simplex = next;
    }
    simplex.sort((a, b) => a.f - b.f);
    mu = simplex[0].p[0];
    sigma = Math.exp(simplex[0].p[1]);
    best = logLik(mu, sigma);
  }

  // Observed information (numerical Hessian in μ, ln σ) for the standard errors.
  const h = 1e-5;
  const f = (q: number[]) => logLik(q[0], Math.exp(q[1]));
  const p0 = [mu, Math.log(sigma)];
  const hess: number[][] = [[0, 0], [0, 0]];
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      const plus = [...p0]; plus[i] += h; plus[j] += h;
      const minus = [...p0]; minus[i] -= h; minus[j] -= h;
      const mixed = [...p0]; mixed[i] += h; mixed[j] -= h;
      const other = [...p0]; other[i] -= h; other[j] += h;
      hess[i][j] = (f(plus) - f(mixed) - f(other) + f(minus)) / (4 * h * h);
    }
  }
  const det = hess[0][0] * hess[1][1] - hess[0][1] * hess[1][0];
  let seMu = NaN;
  let seSigma = NaN;
  if (Math.abs(det) > 1e-18) {
    const covMu = -hess[1][1] / det;
    const covLs = -hess[0][0] / det;
    seMu = Math.sqrt(Math.max(0, covMu));
    seSigma = sigma * Math.sqrt(Math.max(0, covLs));
  }
  void tolConf;
  return {
    mu,
    sigma,
    median: Math.exp(mu),
    mttf: Math.exp(mu + (sigma * sigma) / 2),
    logLik: best,
    n,
    failures,
    censored,
    censoredPct: n ? (censored / n) * 100 : NaN,
    seMu,
    seSigma,
    closedForm: completeCases,
  };
}
