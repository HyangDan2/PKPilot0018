/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — the factor domain (Stage 3C correction)

   One module answers "which values may this factor take?" for the optimiser,
   the profiler and every other search, so a step means one thing everywhere.

   The rules it enforces:

   · A discrete factor's allowed values are exactly Lower + k × Step for an
     integer k ≥ 0, stopping at the last value not beyond Upper. The value is
     computed from the integer index in one multiply-add, not accumulated in a
     loop, so a 0.0001 step does not drift and 0.3 has no 0.30000000000000004.
   · A categorical factor's allowed values are its fitted levels and nothing
     else: no invented level, no numeric stand-in.
   · A fixed value is a value like any other: it must sit inside the range and
     on the step (or be a fitted level), and a value that breaks either is
     reported as an issue instead of being rounded into compliance.
   · A fitted-range domain is the intersection of the ranges the models were
     fitted on. Two ranges that do not overlap have no common domain at all,
     which is an explicit error, not an empty search.
   ───────────────────────────────────────────────────────────────────────── */

import type { FactorSettings } from './optimizationTypes';

/** Relative tolerance for "is this number on the lattice" questions. */
export const DOMAIN_EPS = 1e-9;

/** A step axis longer than this is sampled rather than listed in full. */
export const MAX_AXIS_POINTS = 20001;

/** Decimals needed to write a number without float noise (≤ 12). */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  const abs = Math.abs(value);
  for (let decimals = 0; decimals <= 12; decimals += 1) {
    const scaled = abs * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) <= 1e-9 * Math.max(1, scaled)) return decimals;
  }
  return 12;
}

/** Number of complete steps between lower and upper (k max), or −1 when unusable. */
export function discreteStepCount(lower: number, upper: number, step: number): number {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !Number.isFinite(step) || !(step > 0)) return -1;
  if (!(upper > lower)) return -1;
  const ratio = (upper - lower) / step;
  const kMax = Math.floor(ratio + DOMAIN_EPS);
  return kMax >= 0 ? kMax : -1;
}

/** The k-th allowed value: Lower + k × Step, with float noise removed. */
export function discreteValueAt(lower: number, step: number, k: number): number {
  const decimals = Math.max(decimalsOf(step), decimalsOf(lower));
  const scale = 10 ** decimals;
  const scaledStep = Math.round(step * scale);
  const scaledLower = Math.round(lower * scale);
  if (Number.isFinite(scaledStep) && scaledStep > 0 && Math.abs(step * scale - scaledStep) <= 1e-6) {
    return (scaledLower + k * scaledStep) / scale;
  }
  return Number((lower + k * step).toPrecision(15));
}

export interface DiscreteAxis {
  /** Allowed values, ascending, each exactly Lower + k × Step. */
  values: number[];
  /** Number of allowed values (`values.length` unless the axis was sampled). */
  count: number;
  /** Total steps between Lower and Upper. */
  steps: number;
  /** True when the full lattice was too long to list and was sampled. */
  truncated: boolean;
  lower: number;
  step: number;
}

/**
 * The discrete lattice for one factor.
 *
 * A very small step can describe more points than any search should list; the
 * axis is then sampled at even integer indices (every value handed out is still
 * an allowed value), and `truncated` says the listing is not exhaustive.
 */
export function discreteAxis(lower: number, upper: number, step: number, limit = MAX_AXIS_POINTS): DiscreteAxis {
  const steps = discreteStepCount(lower, upper, step);
  if (steps < 0) return { values: [], count: 0, steps: 0, truncated: false, lower, step };
  const count = steps + 1;
  if (count <= limit) {
    const values: number[] = [];
    for (let k = 0; k <= steps; k += 1) values.push(discreteValueAt(lower, step, k));
    return { values, count, steps, truncated: false, lower, step };
  }
  const stride = Math.ceil(steps / Math.max(1, limit - 1));
  const values: number[] = [];
  for (let k = 0; k < steps; k += stride) values.push(discreteValueAt(lower, step, k));
  values.push(discreteValueAt(lower, step, steps));
  return { values, count, steps, truncated: true, lower, step };
}

export interface StepSnap {
  /** Nearest allowed value. */
  value: number;
  /** Its integer index. */
  k: number;
  /** It lies inside [Lower, Upper]. */
  inside: boolean;
  /** The input was already an allowed value. */
  onStep: boolean;
}

/** Nearest allowed value to `value`, and where it sits. */
export function nearestStepValue(lower: number, upper: number, step: number, value: number): StepSnap {
  const steps = discreteStepCount(lower, upper, step);
  if (steps < 0 || !Number.isFinite(value)) {
    return { value: Number.isNaN(value) ? lower : value, k: 0, inside: false, onStep: false };
  }
  const ratio = (value - lower) / step;
  const k = Math.round(ratio);
  const clamped = Math.min(steps, Math.max(0, k));
  const snapped = discreteValueAt(lower, step, clamped);
  const tolerance = DOMAIN_EPS * Math.max(1, Math.abs(ratio));
  return {
    value: snapped,
    k: clamped,
    inside: value >= lower - DOMAIN_EPS * Math.max(1, Math.abs(lower)) && value <= upper + DOMAIN_EPS * Math.max(1, Math.abs(upper)),
    onStep: Math.abs(ratio - k) <= tolerance && k >= 0 && k <= steps,
  };
}

/** Is `value` exactly an allowed lattice value inside the range? */
export function isOnStep(lower: number, upper: number, step: number, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const snapped = nearestStepValue(lower, upper, step, value);
  if (!snapped.inside || !snapped.onStep) return false;
  return Math.abs(snapped.value - value) <= DOMAIN_EPS * Math.max(1, Math.abs(value));
}

export interface FactorAxis {
  values: (number | string)[];
  /** Number of values the factor really has (before any sampling). */
  count: number;
  /** The lattice was too long for the evaluation budget and was sampled. */
  truncated: boolean;
}

/**
 * The values a factor may be evaluated at.
 *
 * Continuous factors are sampled evenly (their allowed set is an interval, so
 * sampling is a search decision, not a constraint); discrete and categorical
 * factors are whatever the domain allows.
 */
export function factorAxisValues(factor: FactorSettings, continuousPoints = 21, limit = MAX_AXIS_POINTS): FactorAxis {
  if (factor.fixed) {
    return {
      values: [factor.kind === 'categorical' ? String(factor.fixedValue) : Number(factor.fixedValue)],
      count: 1,
      truncated: false,
    };
  }
  if (factor.kind === 'categorical') {
    const levels = factor.levels.slice();
    return { values: levels, count: levels.length, truncated: false };
  }
  if (factor.kind === 'discrete') {
    const axis = discreteAxis(factor.lower, factor.upper, factor.step, limit);
    return { values: axis.values, count: axis.count, truncated: axis.truncated };
  }
  const points = Math.max(2, Math.round(continuousPoints));
  const values = Array.from({ length: points }, (_, index) => factor.lower + ((factor.upper - factor.lower) * index) / (points - 1));
  return { values, count: points, truncated: false };
}

/** Number of values a factor contributes to a search space. */
export function factorAxisSize(factor: FactorSettings, continuousPoints = 21): number {
  if (factor.fixed) return 1;
  if (factor.kind === 'categorical') return Math.max(1, factor.levels.length);
  if (factor.kind === 'discrete') return Math.max(1, discreteStepCount(factor.lower, factor.upper, factor.step) + 1);
  return Math.max(2, Math.round(continuousPoints));
}

/** Problems with a factor definition itself (i18n keys). */
export function factorIssues(factor: FactorSettings): string[] {
  const issues: string[] = [];
  if (factor.kind === 'categorical') {
    if (!factor.levels.length) issues.push('opt.issue.levelMissing');
  } else {
    if (factor.kind === 'discrete' && (!(factor.step > 0) || !Number.isFinite(factor.step))) issues.push('opt.issue.factorStep');
    // A fixed factor carries no range: only its fixed value is used, and that
    // value is checked against the limits below.
    if (!factor.fixed && (!Number.isFinite(factor.lower) || !Number.isFinite(factor.upper) || !(factor.upper > factor.lower))) {
      issues.push('opt.issue.factorRange');
    }
  }
  if (factor.fixed) {
    if (factor.kind === 'categorical') {
      if (!factor.levels.includes(String(factor.fixedValue))) issues.push('opt.issue.fixedOffStep');
    } else {
      const value = Number(factor.fixedValue);
      if (!Number.isFinite(value)) issues.push('opt.issue.fixedOffStep');
      else if (value < factor.lower - DOMAIN_EPS * Math.max(1, Math.abs(factor.lower)) || value > factor.upper + DOMAIN_EPS * Math.max(1, Math.abs(factor.upper))) {
        issues.push('opt.issue.fixedOutside');
      } else if (factor.kind === 'discrete' && !isOnStep(factor.lower, factor.upper, factor.step, value)) {
        issues.push('opt.issue.fixedOffStep');
      }
    }
  }
  return [...new Set(issues)];
}

/** Is one candidate value allowed for this factor? (i18n key or null) */
export function validateFactorValue(factor: FactorSettings, value: number | string): string | null {
  if (factor.kind === 'categorical') {
    const levels = factor.levels;
    return typeof value === 'string' && levels.includes(value) ? null : 'opt.issue.levelUnknown';
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 'opt.issue.valueMissing';
  const slack = DOMAIN_EPS * Math.max(1, Math.abs(factor.lower), Math.abs(factor.upper));
  if (numeric < factor.lower - slack || numeric > factor.upper + slack) return 'opt.issue.valueOutside';
  if (factor.kind === 'discrete' && !isOnStep(factor.lower, factor.upper, factor.step, numeric)) return 'opt.issue.valueOffStep';
  return null;
}

/** The intersection of several closed ranges, or null when they do not overlap. */
export function rangeIntersection(ranges: [number, number][]): [number, number] | null {
  const usable = ranges.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]);
  if (!usable.length) return null;
  const lower = Math.max(...usable.map(([a]) => a));
  const upper = Math.min(...usable.map(([, b]) => b));
  const slack = DOMAIN_EPS * Math.max(1, Math.abs(lower), Math.abs(upper));
  return upper >= lower - slack ? [lower, upper] : null;
}

/** The levels every model fitted, in the first model's order. */
export function levelIntersection(lists: string[][]): string[] {
  const usable = lists.filter((list) => list.length > 0);
  if (!usable.length) return [];
  const [first, ...rest] = usable;
  return [...new Set(first)].filter((level) => rest.every((list) => list.includes(level)));
}

/** Normalise one factor value into its own domain (the one input policy). */
export function normaliseFactorValue(factor: FactorSettings, value: number | string): number | string {
  if (factor.kind === 'categorical') {
    const levels = factor.levels;
    return levels.includes(String(value)) ? String(value) : (levels[0] ?? '');
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return factor.lower;
  const clamped = Math.min(factor.upper, Math.max(factor.lower, numeric));
  if (factor.kind === 'discrete') {
    const snapped = nearestStepValue(factor.lower, factor.upper, factor.step, clamped);
    return snapped.inside ? snapped.value : (clamped <= factor.lower ? discreteValueAt(factor.lower, factor.step, 0) : discreteValueAt(factor.lower, factor.step, Math.max(0, discreteStepCount(factor.lower, factor.upper, factor.step))));
  }
  return clamped;
}

/** The value a factor is held at: its fixed value, or the middle of its range. */
export function holdingValue(factor: FactorSettings): number | string {
  if (factor.fixed) return factor.kind === 'categorical' ? String(factor.fixedValue) : Number(factor.fixedValue);
  if (factor.kind === 'categorical') return factor.levels[0] ?? '';
  if (factor.kind === 'discrete') {
    const steps = discreteStepCount(factor.lower, factor.upper, factor.step);
    return steps < 0 ? factor.lower : discreteValueAt(factor.lower, factor.step, Math.floor(steps / 2));
  }
  return (factor.lower + factor.upper) / 2;
}
