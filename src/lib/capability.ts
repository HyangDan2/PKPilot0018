/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — process capability
   Cp / Cpk / Pp / Ppk with within (short-term) and overall (long-term)
   sigma, expected and observed PPM, and sigma level.
   ───────────────────────────────────────────────────────────────────────── */

import { normalCdf } from './dist';
import { clean, mean, stdev } from './stats';

export interface CapabilityOptions {
  lsl?: number | null;
  usl?: number | null;
  target?: number | null;
  subgroup?: number;
  /** overall sigma from a sample of consecutive individuals (moving range) */
  useMovingRange?: boolean;
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
}

export function movingRangeSigma(values: number[]): number {
  if (values.length < 2) return NaN;
  let sum = 0;
  for (let i = 1; i < values.length; i += 1) sum += Math.abs(values[i] - values[i - 1]);
  return sum / (values.length - 1) / 1.128;
}

export function withinSubgroupSigma(values: number[], subgroup: number): number {
  const n = Math.round(subgroup);
  if (n < 2) return movingRangeSigma(values);
  let ss = 0;
  let df = 0;
  for (let i = 0; i + n <= values.length; i += n) {
    const chunk = values.slice(i, i + n);
    const m = mean(chunk);
    ss += chunk.reduce((a, b) => a + (b - m) ** 2, 0);
    df += n - 1;
  }
  return df > 0 ? Math.sqrt(ss / df) : movingRangeSigma(values);
}

export function capability(raw: (number | null)[], options: CapabilityOptions = {}): CapabilityResult {
  const v = clean(raw);
  const n = v.length;
  const m = mean(v);
  const sdOverall = stdev(v);
  const subgroup = options.subgroup ?? 1;
  const sdWithin = options.useMovingRange === false && subgroup > 1 ? withinSubgroupSigma(v, subgroup) : movingRangeSigma(v);
  const lsl = typeof options.lsl === 'number' && isFinite(options.lsl) ? options.lsl : null;
  const usl = typeof options.usl === 'number' && isFinite(options.usl) ? options.usl : null;
  const target = typeof options.target === 'number' && isFinite(options.target) ? options.target : null;
  const tol = lsl !== null && usl !== null ? usl - lsl : NaN;
  const cp = tol / (6 * sdWithin);
  const pp = tol / (6 * sdOverall);
  const cpl = lsl !== null ? (m - lsl) / (3 * sdWithin) : NaN;
  const cpu = usl !== null ? (usl - m) / (3 * sdWithin) : NaN;
  const ppl = lsl !== null ? (m - lsl) / (3 * sdOverall) : NaN;
  const ppu = usl !== null ? (usl - m) / (3 * sdOverall) : NaN;
  const cpk = Math.min(cpl, cpu);
  const ppk = Math.min(ppl, ppu);
  const cpmTarget = target ?? (lsl !== null && usl !== null ? (lsl + usl) / 2 : m);
  const cpm = tol / (6 * Math.sqrt(sdWithin ** 2 + (m - cpmTarget) ** 2));

  const belowWithin = lsl !== null ? normalCdf((lsl - m) / sdWithin) : 0;
  const aboveWithin = usl !== null ? 1 - normalCdf((usl - m) / sdWithin) : 0;
  const belowOverall = lsl !== null ? normalCdf((lsl - m) / sdOverall) : 0;
  const aboveOverall = usl !== null ? 1 - normalCdf((usl - m) / sdOverall) : 0;
  const observedBelow = lsl !== null ? v.filter((x) => x < lsl).length : 0;
  const observedAbove = usl !== null ? v.filter((x) => x > usl).length : 0;

  const ppmWithin = (belowWithin + aboveWithin) * 1e6;
  const ppmOverall = (belowOverall + aboveOverall) * 1e6;
  const ppmObserved = ((observedBelow + observedAbove) / n) * 1e6;

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
    sigmaLevel: 3 * cpk + 1.5,
  };
}
