/* ─────────────────────────────────────────────────────────────────────────
   Statelia — power and sample size
   Minitab's convention: give any two of sample size, power and effect and the
   third is solved for. t tests use the exact noncentral t, one-way ANOVA the
   noncentral F, and proportions the standard normal approximation (documented
   in the output so the difference from Minitab's exact method is visible).

   Direction is part of the hypothesis
   ────────────────────────────────────
   A one-sided test only gains power in the direction of its alternative. The
   effect (δ for a t test, p_a − p_0 or p_2 − p_1 for a proportions test) is
   therefore kept SIGNED everywhere: an effect pointing against the alternative
   gives power BELOW α instead of the mirrored high power that |δ| produced, and
   a sample-size request for such an effect is reported as unreachable rather
   than answered with an arbitrary large n.
   ───────────────────────────────────────────────────────────────────────── */

import { fInv, ncfCdf, nctCdf, normalCdf, normalInv, tInv } from './dist';
import type { Alt } from './stats';

export type PowerMethod = 'oneT' | 'twoT' | 'paired' | 'anova' | 'oneProp' | 'twoProp';

export interface PowerSpec {
  method: PowerMethod;
  solveFor: 'n' | 'power' | 'difference';
  n?: number;
  power?: number;
  /** signed effect: t tests δ, oneProp p_a − p_0, twoProp p_2 − p_1 */
  difference?: number;
  sd?: number;
  alpha: number;
  alternative: Alt;
  /** proportions test: baseline proportion p1 (oneProp: null value p0) */
  p1?: number;
  /** proportions test: comparison proportion p2 (two-prop) */
  p2?: number;
  /** one-way ANOVA: number of levels */
  groups?: number;
}

export interface PowerSolution {
  method: PowerMethod;
  n: number;
  power: number;
  /** signed effect that was solved for / evaluated */
  difference: number;
  alpha: number;
  alternative: Alt;
  /** For a two-sided test whose two directions reach the target with DIFFERENT
   *  minimum effect sizes (the proportion tests, where p₀ is not 0.5), the
   *  smallest effect in the opposite direction, signed the same way as
   *  `difference`. Present only when that opposite solution exists and its
   *  magnitude differs from the reported one. */
  oppositeDifference?: number;
  /** notes keys for the output block */
  notes: string[];
}

function tCritical(df: number, alpha: number, alt: Alt): number {
  return alt === 'two-sided' ? tInv(1 - alpha / 2, df) : tInv(1 - alpha, df);
}

/**
 * Exact power of the one-sample (groups = 1) or two-sample (groups = 2) t test.
 * `delta` is signed; ncp = δ√n/σ (one-sample, df = n−1) or δ√(n/2)/σ (two
 * samples of n, df = 2n−2).
 */
function powerOfT(n: number, delta: number, sd: number, alpha: number, alt: Alt, groups: 1 | 2): number {
  if (!(n >= 2) || !(sd > 0) || !isFinite(delta)) return NaN;
  const df = groups === 1 ? n - 1 : 2 * (n - 1);
  const ncp = groups === 1 ? (delta * Math.sqrt(n)) / sd : (delta * Math.sqrt(n / 2)) / sd;
  const crit = tCritical(df, alpha, alt);
  let power: number;
  if (alt === 'two-sided') {
    power = nctCdf(-crit, df, ncp) + (1 - nctCdf(crit, df, ncp));
  } else if (alt === 'greater') {
    power = 1 - nctCdf(crit, df, ncp);
  } else {
    power = nctCdf(-crit, df, ncp);
  }
  return Math.min(1, Math.max(0, power));
}

function powerOfAnova(n: number, delta: number, sd: number, k: number, alpha: number): number {
  if (!(n >= 2) || !(sd > 0) || !(k >= 2) || !isFinite(delta)) return NaN;
  const df1 = k - 1;
  const df2 = k * (n - 1);
  const ncp = (n * k * delta * delta) / (4 * sd * sd);
  const crit = fInv(1 - alpha, df1, df2);
  return Math.min(1, Math.max(0, 1 - ncfCdf(crit, df1, df2, ncp)));
}

/**
 * One-proportion power with the normal approximation. Under H₀ p̂ ~ N(p₀, SE₀²)
 * and under the alternative p̂ ~ N(p_a, SE_a²); with d = p_a − p₀:
 *   greater   : 1 − Φ((z_α SE₀ − d)/SE_a)
 *   less      :     Φ((−z_α SE₀ − d)/SE_a)
 *   two-sided : 1 − Φ((z_{α/2} SE₀ − d)/SE_a) + Φ((−z_{α/2} SE₀ − d)/SE_a)
 */
function powerOfProp1(n: number, p0: number, pa: number, alpha: number, alt: Alt): number {
  if (!(n >= 1) || !(p0 > 0 && p0 < 1) || !(pa > 0 && pa < 1)) return NaN;
  const se0 = Math.sqrt((p0 * (1 - p0)) / n);
  const se1 = Math.sqrt((pa * (1 - pa)) / n);
  if (!(se1 > 0)) return NaN;
  const d = pa - p0;
  let power: number;
  if (alt === 'greater') {
    power = 1 - normalCdf((normalInv(1 - alpha) * se0 - d) / se1);
  } else if (alt === 'less') {
    power = normalCdf((-normalInv(1 - alpha) * se0 - d) / se1);
  } else {
    const z = normalInv(1 - alpha / 2);
    power = 1 - normalCdf((z * se0 - d) / se1) + normalCdf((-z * se0 - d) / se1);
  }
  return Math.min(1, Math.max(0, power));
}

/**
 * Two-proportion power, n per group, d = p₂ − p₁, pooled SE₀ and unpooled SE₁.
 * The two-sided case sums BOTH rejection tails, not just the upper one.
 */
function powerOfProp2(n: number, p1: number, p2: number, alpha: number, alt: Alt): number {
  if (!(n >= 1) || !(p1 > 0 && p1 < 1) || !(p2 > 0 && p2 < 1)) return NaN;
  const d = p2 - p1;
  const pBar = (p1 + p2) / 2;
  const se0 = Math.sqrt((2 * pBar * (1 - pBar)) / n);
  const se1 = Math.sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / n);
  if (!(se1 > 0)) return NaN;
  let power: number;
  if (alt === 'greater') {
    power = 1 - normalCdf((normalInv(1 - alpha) * se0 - d) / se1);
  } else if (alt === 'less') {
    power = normalCdf((-normalInv(1 - alpha) * se0 - d) / se1);
  } else {
    const z = normalInv(1 - alpha / 2);
    power = 1 - normalCdf((z * se0 - d) / se1) + normalCdf((-z * se0 - d) / se1);
  }
  return Math.min(1, Math.max(0, power));
}

/** Valid signed range of the effect for the current method and alternative. */
export function differenceRange(spec: PowerSpec): [number, number] {
  const eps = 1e-9;
  if (spec.method === 'oneProp') {
    const p0 = spec.p1 ?? 0.5;
    // p_a must stay inside (0, 1): d ∈ (−(p0−eps), 1−p0−eps).
    const lower = -(p0 - eps);
    const upper = 1 - p0 - eps;
    if (spec.alternative === 'greater') return [eps, upper];
    if (spec.alternative === 'less') return [lower, -eps];
    // Two-sided: a proportion can move either way but its valid effects are NOT
    // symmetric about zero — p₀ = 0.2 allows −0.2 … +0.8, and mirroring the
    // wider side (the old ±0.8) pushed p_a below 0 and made every two-sided
    // solve throw power.unreachable.
    return [lower, upper];
  }
  if (spec.method === 'twoProp') {
    const p1 = spec.p1 ?? 0.5;
    const lower = -(p1 - eps);
    const upper = 1 - p1 - eps;
    if (spec.alternative === 'greater') return [eps, upper];
    if (spec.alternative === 'less') return [lower, -eps];
    // Two-sided: the same asymmetric validity rule as oneProp (p₂ must stay in
    // (0, 1)), so the range is the true [lower, upper] and not its mirror.
    return [lower, upper];
  }
  const bound = Math.max(1, (spec.sd ?? 1) * 20);
  if (spec.alternative === 'greater') return [eps, bound];
  if (spec.alternative === 'less') return [-bound, -eps];
  return [-bound, bound];
}

/** Signed effect the tests/UI should evaluate: magnitudes point along the alternative. */
function signedMagnitude(spec: PowerSpec, magnitude: number): number {
  const m = Math.abs(magnitude);
  if (spec.alternative === 'greater') return m;
  if (spec.alternative === 'less') return -m;
  return m;
}

/** Power of the given signed effect at sample size n (exported for the tests). */
export function powerAt(spec: PowerSpec, n: number, difference: number): number {
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
      return powerOfProp1(n, p0, p0 + difference, spec.alpha, spec.alternative);
    }
    case 'twoProp': {
      const p1 = spec.p1 ?? 0.5;
      return powerOfProp2(n, p1, p1 + difference, spec.alpha, spec.alternative);
    }
    default:
      return NaN;
  }
}

/** Reason string when the request cannot be satisfied; null when it can. */
function unreachableReason(spec: PowerSpec, difference: number, target?: number): string | null {
  if (!isFinite(difference)) return 'invalidEffect';
  if (difference === 0) return 'zeroEffect';
  if (!isFinite(spec.alpha) || !(spec.alpha > 0) || !(spec.alpha < 1)) return 'alpha';
  if (target !== undefined) {
    if (!isFinite(target) || !(target > spec.alpha)) return 'targetTooLow';
    if (!(target < 1)) return 'targetTooHigh';
  }
  if (spec.method === 'oneProp' || spec.method === 'twoProp') {
    const base = spec.p1 ?? 0.5;
    const pa = base + difference;
    if (!(base > 0 && base < 1) || !(pa > 0 && pa < 1)) return 'proportionRange';
  } else if (!(spec.sd ?? 1 > 0)) {
    return 'sd';
  }
  return null;
}

/** A one-sided alternative can never gain power from an effect pointing the other way. */
function againstAlternative(spec: PowerSpec, difference: number): boolean {
  if (spec.alternative === 'greater') return difference < 0;
  if (spec.alternative === 'less') return difference > 0;
  return false;
}

/** Smallest integer sample size whose power reaches the target. */
function solveN(spec: PowerSpec, difference: number, target: number): number {
  const fail = (): never => {
    throw new Error('power.unreachable');
  };
  if (unreachableReason(spec, difference, target) || againstAlternative(spec, difference)) fail();
  let hi = 4;
  for (let i = 0; i < 40 && powerAt(spec, hi, difference) < target; i += 1) hi *= 2;
  if (!(powerAt(spec, hi, difference) >= target)) fail();
  let lo = 2;
  if (powerAt(spec, lo, difference) >= target) return lo;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (powerAt(spec, mid, difference) >= target) hi = mid;
    else lo = mid;
  }
  // A cap on absurd requests (target 0.99999 with a tiny effect) is still an
  // honest failure instead of returning 2^40.
  if (!(powerAt(spec, hi, difference) >= target) || hi > 1e7) fail();
  return hi;
}

/** Grid points used to bracket the first crossing of the target on one side. */
const DIFFERENCE_GRID = 200;

/**
 * Smallest |effect| on ONE signed branch (sign +1 or −1) whose power reaches the
 * target, or null when that branch never gets there. The branch is scanned on a
 * fixed grid first and then bisected: the proportion power curve is not monotone
 * all the way to the edge of (0, 1) (as p_a → 0 or 1 the alternative SE collapses
 * and the power falls back to 0), so an endpoint-only test would both miss a
 * reachable interior solution and accept an unreachable branch.
 */
function solveBranch(spec: PowerSpec, n: number, bound: number, target: number, sign: 1 | -1): number | null {
  const at = (magnitude: number) => powerAt(spec, n, sign * magnitude);
  const eps = 1e-9;
  if (!(bound > eps)) return null;
  if (at(eps) >= target) return eps;
  let prev = eps;
  for (let i = 1; i <= DIFFERENCE_GRID; i += 1) {
    const magnitude = eps + ((bound - eps) * i) / DIFFERENCE_GRID;
    const power = at(magnitude);
    if (isFinite(power) && power >= target) {
      let a = prev;
      let b = magnitude;
      for (let k = 0; k < 200; k += 1) {
        const mid = (a + b) / 2;
        const pm = at(mid);
        if (isFinite(pm) && pm >= target) b = mid;
        else a = mid;
        if (Math.abs(b - a) <= 1e-13 * Math.max(1, Math.abs(b))) break;
      }
      return b;
    }
    prev = magnitude;
  }
  return null;
}

/**
 * Signed effect that reaches the target power at a fixed sample size, searched
 * only inside the direction and range the alternative allows (#17).
 *
 * A two-sided alternative has TWO admissible directions. Each is solved on its
 * own valid range (see differenceRange) and the smaller |d| is reported; when the
 * other direction also reaches the target with a different |d|, its signed
 * threshold comes back as `oppositeDifference`. Only when neither direction can
 * reach the target is the request power.unreachable.
 */
function solveDifference(spec: PowerSpec, n: number, target: number): { difference: number; oppositeDifference?: number } {
  const [lo0, hi0] = differenceRange(spec);
  const positiveBound = hi0;
  const negativeBound = -lo0;
  if (spec.alternative !== 'two-sided') {
    // One-sided: only the direction of the alternative is admissible, and both
    // ends of its range must be a valid effect.
    const at = (d: number) => powerAt(spec, n, d);
    if (!isFinite(at(lo0)) || !isFinite(at(hi0))) throw new Error('power.unreachable');
    const sign: 1 | -1 = spec.alternative === 'greater' ? 1 : -1;
    const bound = sign > 0 ? positiveBound : negativeBound;
    const magnitude = solveBranch(spec, n, bound, target, sign);
    if (magnitude === null) throw new Error('power.unreachable');
    return { difference: sign * magnitude };
  }
  const positive = solveBranch(spec, n, positiveBound, target, 1);
  const negative = solveBranch(spec, n, negativeBound, target, -1);
  if (positive === null && negative === null) throw new Error('power.unreachable');
  if (positive === null) return { difference: -(negative as number) };
  if (negative === null) return { difference: positive };
  // Both directions work. Report the smaller |d| and expose the other one when
  // it is genuinely different — a symmetric t test gives the same |d| twice, and
  // repeating its mirror as "the opposite direction" would be noise.
  const symmetric = Math.abs(positive - negative) <= 1e-9 * Math.max(positive, negative, 1);
  if (symmetric) return { difference: positive };
  return positive <= negative
    ? { difference: positive, oppositeDifference: -negative }
    : { difference: -negative, oppositeDifference: positive };
}

export function solvePower(spec: PowerSpec): PowerSolution {
  const alpha = spec.alpha;
  const target = spec.power ?? 0.9;
  const notes: string[] = [];
  if (spec.method === 'oneProp' || spec.method === 'twoProp') notes.push('power.propApprox');
  if (spec.method === 'anova') notes.push('power.anovaAssumption');
  const raw = spec.difference ?? (spec.p2 !== undefined && spec.p1 !== undefined ? spec.p2 - spec.p1 : undefined);
  if (raw === undefined && spec.solveFor !== 'difference') throw new Error('power.needDifference');
  const difference = raw !== undefined && isFinite(raw) ? raw : NaN;
  if (spec.solveFor === 'n') {
    const n = solveN(spec, difference, target);
    return { method: spec.method, n, power: powerAt(spec, n, difference), difference, alpha, alternative: spec.alternative, notes };
  }
  if (spec.solveFor === 'power') {
    const reason = unreachableReason(spec, difference);
    const n = Math.max(2, Math.round(spec.n ?? 10));
    // An effect pointing against the alternative is a VALID request: its power
    // is reported and lands below α — that is the answer, not an error.
    const power = powerAt(spec, n, difference);
    if (reason || !isFinite(power)) throw new Error('power.unreachable');
    return { method: spec.method, n, power, difference, alpha, alternative: spec.alternative, notes };
  }
  const n = Math.max(2, Math.round(spec.n ?? 10));
  const solved = solveDifference(spec, n, target);
  const solvedDifference = solved.difference;
  return {
    method: spec.method,
    n,
    power: powerAt(spec, n, solvedDifference),
    difference: solvedDifference,
    alpha,
    alternative: spec.alternative,
    ...(solved.oppositeDifference !== undefined ? { oppositeDifference: solved.oppositeDifference } : {}),
    notes,
  };
}

/** Power curve over sample size (for the chart), at a fixed signed effect. */
export function powerCurve(spec: PowerSpec, difference: number, points = 30): { n: number; power: number }[] {
  const base = Math.max(2, Math.round(spec.n ?? 10));
  let maxN = Math.max(10, Math.ceil(base * 2.2));
  try {
    maxN = Math.max(maxN, Math.ceil(solveN(spec, difference, spec.power ?? 0.9) * 1.4));
  } catch {
    // An unreachable request still gets a curve of the range it can reach.
    maxN = Math.max(maxN, base * 3);
  }
  const step = Math.max(1, Math.ceil(maxN / points));
  const out: { n: number; power: number }[] = [];
  for (let n = Math.max(2, step); n <= maxN; n += step) {
    const power = powerAt(spec, n, difference);
    if (isFinite(power)) out.push({ n, power });
  }
  return out;
}

/** Fill in the effect for the reporting UI without losing its sign. */
export function withSignedEffect(spec: PowerSpec, difference: number): PowerSpec {
  return { ...spec, difference: signedMagnitude(spec, difference) };
}
