/* ─────────────────────────────────────────────────────────────────────────
   Statelia — process capability
   Cp / Cpk / Pp / Ppk with within (short-term) and overall (long-term)
   sigma, expected and observed PPM, Cpm and sigma level.

   Conventions
   · Cp / Pp need two-sided specifications; with one limit they are NaN.
   · Cpk / Ppk fall back to the single available side (Cpl/Ppl or Cpu/Ppu).
   · Cpm uses the OVERALL (sample, n−1) standard deviation and requires an
     explicit target; without a target it is NaN instead of guessing the
     midpoint of the specification limits.
   · Sigma level is derived from the chosen method (see SigmaMethod).
   · Within sigma is the average moving range for individuals, and the pooled
     within-subgroup standard deviation when a subgroup size above 1 is given.
   ───────────────────────────────────────────────────────────────────────── */

import { normalCdf, normalInv } from './dist';
import { clean, mean, stdev } from './stats';

export type SigmaMethod = 'z_bench_shift' | 'z_bench' | 'cpk_shift';

export interface CapabilityOptions {
  lsl?: number | null;
  usl?: number | null;
  target?: number | null;
  subgroup?: number;
  /** force the consecutive-individual (moving range) estimate even with subgroups */
  useMovingRange?: boolean;
  /** pre-computed within sigma (e.g. the S̄/c₄ estimate of an Xbar-S chart) */
  sdWithin?: number;
  /** how the reported sigma level (Z) is derived */
  sigmaMethod?: SigmaMethod;
}

export interface CapabilityResult {
  n: number;
  values: number[];
  mean: number;
  sdWithin: number;
  sdOverall: number;
  lsl: number | null;
  usl: number | null;
  target: number | null;
  cp: number;
  cpk: number;
  cpl: number;
  cpu: number;
  pp: number;
  ppk: number;
  ppl: number;
  ppu: number;
  cpm: number;
  ppmWithin: number;
  ppmOverall: number;
  ppmObserved: number;
  observedBelow: number;
  observedAbove: number;
  sigmaLevel: number;
  sigmaMethod: SigmaMethod;
}

/** Division that never returns ±Infinity: a non-positive or non-finite denominator is NaN. */
function ratio(numerator: number, denominator: number): number {
  if (!isFinite(numerator) || !isFinite(denominator) || denominator === 0) return NaN;
  return numerator / denominator;
}

export function movingRangeSigma(values: number[]): number {
  if (values.length < 2) return NaN;
  let sum = 0;
  for (let i = 1; i < values.length; i += 1) sum += Math.abs(values[i] - values[i - 1]);
  return ratio(sum / (values.length - 1), 1.128);
}

/**
 * Pooled within-subgroup sigma. Subgroup boundaries follow the ORIGINAL row
 * order — the array is sliced at [0..n-1], [n..2n-1], … and missing values are
 * removed only inside each slice, so a missing row never shifts later groups.
 * Subgroups with fewer than two valid values contribute no degrees of freedom.
 */
export function withinSubgroupSigma(values: (number | null)[], subgroup: number): number {
  const n = Math.round(subgroup);
  if (!isFinite(n) || n < 2) return movingRangeSigma(clean(values));
  let ss = 0;
  let df = 0;
  for (let start = 0; start < values.length; start += n) {
    const chunk = clean(values.slice(start, start + n));
    if (chunk.length < 2) continue;
    const m = mean(chunk);
    ss += chunk.reduce((a, b) => a + (b - m) ** 2, 0);
    df += chunk.length - 1;
  }
  if (df <= 0) return movingRangeSigma(clean(values));
  return Math.sqrt(ss / df);
}

export function capability(raw: (number | null)[], options: CapabilityOptions = {}): CapabilityResult {
  const v = clean(raw);
  const n = v.length;
  const m = mean(v);
  const sdOverall = stdev(v);
  const subgroup = options.subgroup ?? 1;
  // Subgroups asked for by the caller give the pooled within-subgroup sigma;
  // individuals (subgroup 1) always use the moving-range estimate. A caller
  // that already owns the within-sigma estimator for the SAME subgroups (the
  // Xbar-S Sixpack: S̄/c₄) passes it in so the chart and the indices cannot
  // disagree about which variability they describe.
  const override = options.sdWithin;
  const sdWithin = typeof override === 'number' && isFinite(override) && override > 0
    ? override
    : options.useMovingRange === true || !(subgroup > 1)
      ? movingRangeSigma(v)
      : withinSubgroupSigma(raw, subgroup);
  const lsl = typeof options.lsl === 'number' && isFinite(options.lsl) ? options.lsl : null;
  const usl = typeof options.usl === 'number' && isFinite(options.usl) ? options.usl : null;
  const target = typeof options.target === 'number' && isFinite(options.target) ? options.target : null;
  const twoSided = lsl !== null && usl !== null;
  const tol = twoSided ? (usl as number) - (lsl as number) : NaN;

  const cp = twoSided ? ratio(tol, 6 * sdWithin) : NaN;
  const pp = twoSided ? ratio(tol, 6 * sdOverall) : NaN;
  const cpl = lsl !== null ? ratio(m - lsl, 3 * sdWithin) : NaN;
  const cpu = usl !== null ? ratio((usl as number) - m, 3 * sdWithin) : NaN;
  const ppl = lsl !== null ? ratio(m - lsl, 3 * sdOverall) : NaN;
  const ppu = usl !== null ? ratio((usl as number) - m, 3 * sdOverall) : NaN;

  // One-sided specifications report the single available index, never NaN.
  const cpk = lsl !== null && usl !== null ? Math.min(cpl, cpu) : lsl !== null ? cpl : usl !== null ? cpu : NaN;
  const ppk = lsl !== null && usl !== null ? Math.min(ppl, ppu) : lsl !== null ? ppl : usl !== null ? ppu : NaN;

  // Cpm: overall sigma, and only with an explicit target and two-sided tolerance.
  const cpm = twoSided && target !== null
    ? ratio(tol, 6 * Math.sqrt(sdOverall ** 2 + (m - target) ** 2))
    : NaN;

  const withinOk = isFinite(sdWithin) && sdWithin > 0;
  const overallOk = isFinite(sdOverall) && sdOverall > 0;
  const belowWithin = lsl !== null && withinOk ? normalCdf((lsl - m) / sdWithin) : 0;
  const aboveWithin = usl !== null && withinOk ? 1 - normalCdf((usl - m) / sdWithin) : 0;
  const belowOverall = lsl !== null && overallOk ? normalCdf((lsl - m) / sdOverall) : 0;
  const aboveOverall = usl !== null && overallOk ? 1 - normalCdf((usl - m) / sdOverall) : 0;
  const observedBelow = lsl !== null ? v.filter((x) => x < lsl).length : 0;
  const observedAbove = usl !== null ? v.filter((x) => x > usl).length : 0;

  const ppmWithin = withinOk ? (belowWithin + aboveWithin) * 1e6 : NaN;
  const ppmOverall = overallOk ? (belowOverall + aboveOverall) * 1e6 : NaN;
  const ppmObserved = n > 0 ? ((observedBelow + observedAbove) / n) * 1e6 : NaN;

  const sigmaMethod: SigmaMethod = options.sigmaMethod ?? 'z_bench_shift';
  const sigmaLevel = sigmaLevelOf(sigmaMethod, ppmOverall, cpk);

  return {
    n,
    values: v,
    mean: m,
    sdWithin,
    sdOverall,
    lsl,
    usl,
    target,
    cp,
    cpk,
    cpl,
    cpu,
    pp,
    ppk,
    ppl,
    ppu,
    cpm,
    ppmWithin,
    ppmOverall,
    ppmObserved,
    observedBelow,
    observedAbove,
    sigmaLevel,
    sigmaMethod,
  };
}

/**
 * Z.bench is the standard-normal quantile of the observed/expected total
 * defect rate. `z_bench_shift` adds the classic 1.5σ long-term shift,
 * `z_bench` reports the unshifted value, `cpk_shift` uses the short-term
 * approximation 3 × Cpk + 1.5.
 */
export function sigmaLevelOf(method: SigmaMethod, ppmOverall: number, cpk: number): number {
  if (method === 'cpk_shift') return isFinite(cpk) ? 3 * cpk + 1.5 : NaN;
  if (!isFinite(ppmOverall)) return NaN;
  const p = Math.min(1 - 1e-12, Math.max(1e-12, ppmOverall / 1e6));
  const z = normalInv(1 - p);
  if (!isFinite(z)) return NaN;
  return method === 'z_bench' ? z : z + 1.5;
}
