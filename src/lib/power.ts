/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — power and sample size
   Minitab's convention: give any two of sample size, power and effect and the
   third is solved for. t tests use the exact noncentral t, one-way ANOVA the
   noncentral F, and proportions the standard normal approximation (documented
   in the output so the difference from Minitab's exact method is visible).
   ───────────────────────────────────────────────────────────────────────── */

import { fInv, ncfCdf, nctCdf, normalCdf, normalInv, tInv } from './dist';
import type { Alt } from './stats';

export type PowerMethod = 'oneT' | 'twoT' | 'paired' | 'anova' | 'oneProp' | 'twoProp';

export interface PowerSpec {
  method: PowerMethod;
  solveFor: 'n' | 'power' | 'difference';
  n?: number;
  power?: number;
  difference?: number;
  sd?: number;
  alpha: number;
  alternative: Alt;
  /** proportions test: baseline proportion p1 */
  p1?: number;
  /** proportions test: comparison proportion p2 (two-proportion) */
  p2?: number;
  /** one-way ANOVA: number of levels */
  groups?: number;
}

export interface PowerSolution {
  method: PowerMethod;
  n: number;
  power: number;
  difference: number;
  alpha: number;
  alternative: Alt;
  /** notes keys for the output block */
  notes: string[];
}

function tCritical(df: number, alpha: number, alt: Alt): number {
  return alt === 'two-sided' ? tInv(1 - alpha / 2, df) : tInv(1 - alpha, df);
}

function powerOfT(n: number, delta: number, sd: number, alpha: number, alt: Alt, groups: 1 | 2): number {
  if (!(n >= 2) || !(sd > 0)) return NaN;
  const df = groups === 1 ? n - 1 : 2 * (n - 1);
  const ncp = groups === 1 ? (delta * Math.sqrt(n)) / sd : (delta * Math.sqrt(n / 2)) / sd;
  if (alt === 'two-sided') {
    const crit = tCritical(df, alpha, alt);
    return Math.min(1, Math.max(0, nctCdf(-crit, df, ncp) + (1 - nctCdf(crit, df, ncp))));
  }
  const crit = tCritical(df, alpha, alt);
  // 'less' measures a negative difference; both are handled by |δ|.
  return Math.min(1, Math.max(0, 1 - nctCdf(crit, df, Math.abs(ncp))));
}

function powerOfAnova(n: number, delta: number, sd: number, k: number, alpha: number): number {
  if (!(n >= 2) || !(sd > 0) || !(k >= 2)) return NaN;
  const df1 = k - 1;
  const df2 = k * (n - 1);
  const ncp = (n * k * delta * delta) / (4 * sd * sd);
  const crit = fInv(1 - alpha, df1, df2);
  return Math.min(1, Math.max(0, 1 - ncfCdf(crit, df1, df2, ncp)));
}

function powerOfProp1(n: number, p0: number, pa: number, alpha: number, alt: Alt): number {
  if (!(n >= 1) || !(p0 > 0 && p0 < 1) || !(pa > 0 && pa < 1)) return NaN;
  const q0 = 1 - p0;
  const qa = 1 - pa;
  const z = alt === 'two-sided' ? normalInv(1 - alpha / 2) : normalInv(1 - alpha);
  const diff = Math.abs(pa - p0);
  const se = Math.sqrt(Math.max(1e-12, pa * qa / n));
  return Math.min(1, Math.max(0, normalCdf((diff - z * Math.sqrt((p0 * q0) / n)) / se)));
}

function powerOfProp2(n: number, p1: number, p2: number, alpha: number, alt: Alt): number {
  if (!(n >= 1) || !(p1 > 0 && p1 < 1) || !(p2 > 0 && p2 < 1)) return NaN;
  const z = alt === 'two-sided' ? normalInv(1 - alpha / 2) : normalInv(1 - alpha);
  const diff = Math.abs(p1 - p2);
  const pBar = (p1 + p2) / 2;
  const se = Math.sqrt(Math.max(1e-12, (p1 * (1 - p1) + p2 * (1 - p2)) / n));
  return Math.min(1, Math.max(0, normalCdf((diff - z * Math.sqrt((2 * pBar * (1 - pBar)) / n)) / se)));
}

function powerAt(spec: PowerSpec, n: number, difference: number): number {
  switch (spec.method) {
    case 'oneT':
    case 'paired':
      return powerOfT(n, difference, spec.sd ?? 1, spec.alpha, spec.alternative, 1);
    case 'twoT':
      return powerOfT(n, difference, spec.sd ?? 1, spec.alpha, spec.alternative, 2);
    case 'anova':
      return powerOfAnova(n, difference, spec.sd ?? 1, spec.groups ?? 2, spec.alpha);
    case 'oneProp': {
      const p0 = spec.p1 ?? 0.5;
      const d = Math.abs(difference);
      const pa = p0 + d <= 1 - 1e-9 ? p0 + d : p0 - d;
      return powerOfProp1(n, p0, pa, spec.alpha, spec.alternative);
    }
    case 'twoProp': {
      const p1 = spec.p1 ?? 0.5;
      const d = Math.abs(difference);
      const p2 = p1 + d <= 1 - 1e-9 ? p1 + d : p1 - d;
      return powerOfProp2(n, p1, p2, spec.alpha, spec.alternative);
    }
    default:
      return NaN;
  }
}

/** Smallest integer sample size whose power reaches the target. */
function solveN(spec: PowerSpec, difference: number, target: number): number {
  let hi = 4;
  for (let i = 0; i < 40 && powerAt(spec, hi, difference) < target; i += 1) hi *= 2;
  let lo = 2;
  if (powerAt(spec, lo, difference) >= target) return lo;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (powerAt(spec, mid, difference) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Difference that reaches the target power for a fixed sample size. */
function solveDifference(spec: PowerSpec, n: number, target: number): number {
  const upperBound = (): number => {
    switch (spec.method) {
      case 'oneProp':
      case 'twoProp': {
        const p = spec.p1 ?? 0.5;
        return Math.min(p, 1 - p) - 1e-6;
      }
      default:
        return Math.max(1, (spec.sd ?? 1) * 20);
    }
  };
  let lo = 1e-6;
  let hi = upperBound();
  if (powerAt(spec, n, hi) < target) return NaN;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (powerAt(spec, n, mid) < target) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-9 * Math.max(1, hi)) break;
  }
  return (lo + hi) / 2;
}

export function solvePower(spec: PowerSpec): PowerSolution {
  const alpha = spec.alpha;
  const target = spec.power ?? 0.9;
  const notes: string[] = [];
  if (spec.method === 'oneProp' || spec.method === 'twoProp') notes.push('power.propApprox');
  if (spec.method === 'anova') notes.push('power.anovaAssumption');
  if (spec.solveFor === 'n') {
    const difference = Math.abs(spec.difference ?? (spec.p2 !== undefined && spec.p1 !== undefined ? spec.p2 - spec.p1 : 1));
    const n = solveN(spec, difference, target);
    return { method: spec.method, n, power: powerAt(spec, n, difference), difference, alpha, alternative: spec.alternative, notes };
  }
  if (spec.solveFor === 'power') {
    const n = Math.max(2, Math.round(spec.n ?? 10));
    const difference = Math.abs(spec.difference ?? (spec.p2 !== undefined && spec.p1 !== undefined ? spec.p2 - spec.p1 : 1));
    return { method: spec.method, n, power: powerAt(spec, n, difference), difference, alpha, alternative: spec.alternative, notes };
  }
  const n = Math.max(2, Math.round(spec.n ?? 10));
  const difference = solveDifference(spec, n, target);
  return { method: spec.method, n, power: powerAt(spec, n, difference), difference, alpha, alternative: spec.alternative, notes };
}

/** Power curve over sample size (for the chart). */
export function powerCurve(spec: PowerSpec, difference: number, points = 30): { n: number; power: number }[] {
  const base = Math.max(2, Math.round(spec.n ?? 10));
  const maxN = Math.max(10, Math.ceil(base * 2.2), Math.ceil(solveN(spec, Math.abs(difference), spec.power ?? 0.9) * 1.4));
  const step = Math.max(1, Math.ceil(maxN / points));
  const out: { n: number; power: number }[] = [];
  for (let n = Math.max(2, step); n <= maxN; n += step) {
    const power = powerAt(spec, n, Math.abs(difference));
    if (isFinite(power)) out.push({ n, power });
  }
  return out;
}
