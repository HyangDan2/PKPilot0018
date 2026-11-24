/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — the factor domain (Stage 3C correction)

   One module answers "which values may this factor take?" for the optimiser,
   the profiler and every other search, so a step means one thing everywhere.

   The rules it enforces:

   · A discrete factor's allowed values are exactly Lower + k × Step for an
     integer k ≥ 0, stopping at the last value not beyond Upper. The value is
     computed from the integer index with decimal arithmetic (BigInt on the
     digits the two numbers are written with), so a 0.0001 step does not drift,
     0.3 has no 0.30000000000000004, and a lower bound of 100000000.01 keeps
     its cent.
   · A lattice a reader could not actually set is refused rather than offered:
     a domain beyond the safe integer range, a step below the resolution the
     numbers can carry at that magnitude, and a factor name used twice are
     issues, not search decisions.
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

/** Relative tolerance for "is this value inside this range" questions. */
export const DOMAIN_EPS = 1e-9;

/**
 * Relative tolerance for "is this value one of the lattice's own numbers".
 *
 * This has to be far finer than a step: a value that is 0.3 of a step away is
 * not on the lattice, however large the lattice's offset is. It only absorbs
 * the rounding of the arithmetic that produced the value (≈ 1e-16 relative) with
 * a wide margin.
 */
export const LATTICE_EPS = 1e-12;

/** The largest integer a double states exactly (9007199254740991). */
export const MAX_SAFE_MAGNITUDE = Number.MAX_SAFE_INTEGER;

/** A step axis longer than this is sampled rather than listed in full. */
export const MAX_AXIS_POINTS = 20001;

/**
 * The slack allowed around a range's limits (WO-FINAL-001 · F-REL-04, WO-07).
 *
 * A bounds question is answered at the resolution the numbers themselves can
 * carry — a few ULPs at this magnitude — plus a tiny share of the range's own
 * width. It is deliberately NOT proportional to the offset alone: at 1e8 the
 * spacing of adjacent doubles is ≈1.5e-8, so a 0.001-wide range still refuses
 * a value 0.05 past Upper, while an endpoint that one arithmetic step rounded
 * by an ULP is still the endpoint.
 *
 * `width × 1e-9` absorbs a bound that was rounded on its way into a data
 * column: a design limit such as 1.189207115002721 kept at full precision
 * against a column written with nine decimals (±1.189207115) differs in the
 * tenth significant digit, which is ≈1.1e-12 of the width. That share is
 * still far below anything a reader could choose to search — a range at 1e8
 * that is 0.001 wide gets 1e-12 of slack — so a physical excursion is never
 * adopted as an endpoint.
 */
export function rangeSlack(lower: number, upper: number, value = 0, ulps = 4): number {
  const magnitude = Math.max(
    Math.abs(Number.isFinite(lower) ? lower : 0),
    Math.abs(Number.isFinite(upper) ? upper : 0),
    Math.abs(Number.isFinite(value) ? value : 0),
  );
  const spacing = doubleSpacing(magnitude);
  const fromUlps = Number.isFinite(spacing) ? ulps * spacing : 0;
  const width = Number.isFinite(upper - lower) ? Math.abs(upper - lower) : 0;
  return Math.max(fromUlps, width * 1e-9);
}

/**
 * The slack allowed when asking whether a typed input changed when it was
 * snapped or clamped.
 *
 * This is a note in the report ("the value was moved"), not a bounds verdict:
 * every range question uses {@link rangeSlack}.
 */
export function relativeSlack(...values: number[]): number {
  let magnitude = 1;
  for (const value of values) if (Number.isFinite(value)) magnitude = Math.max(magnitude, Math.abs(value));
  return DOMAIN_EPS * magnitude;
}

/** How far from a lattice value a double may sit because of its own arithmetic. */
const LATTICE_ULPS = 4;

/**
 * The slack allowed when asking whether a value is one of the lattice's numbers.
 *
 * Two quantities decide it, and the offset is neither of them:
 *
 *  · the resolution of the double at this magnitude — the rounding of the
 *    arithmetic that produced the value, a few ULPs at most;
 *  · the step itself — a relative share of one step, and never more than a
 *    quarter of it, so the test can never reach a neighbouring lattice value.
 *
 * A tolerance proportional to the offset alone (1e-12 · 1e8 = 1e-4) is a whole
 * step at 1e8 with Step = 1e-4, and it accepted a value 0.3 of a step away.
 */
export function latticeTolerance(lower: number, upper: number, step: number, value: number): number {
  if (!Number.isFinite(step) || step === 0) return 0;
  const spacing = Math.max(
    doubleSpacing(value),
    Number.isFinite(lower) ? doubleSpacing(lower) : 0,
    Number.isFinite(upper) ? doubleSpacing(upper) : 0,
  );
  const fromDoubles = LATTICE_ULPS * (Number.isFinite(spacing) ? spacing : 0);
  const fromStep = Math.abs(step) * LATTICE_EPS;
  return Math.min(Math.abs(step) / 4, Math.max(fromDoubles, fromStep));
}

/** A decimal number split into an exact integer and a power of ten. */
interface DecimalParts {
  digits: bigint;
  exp: number;
}

/**
 * The shortest decimal this double round-trips through, as digits × 10^exp.
 *
 * 100000000.01 → 10000000001 × 10^-2, 0.1 → 1 × 10^-1, 1e-7 → 1 × 10^-7.
 * Reading the printed form (not a tolerance) is what keeps a cent a cent at
 * 1e8, where a relative tolerance of 1e-9 would call 0.01 "zero".
 */
function decimalParts(value: number): DecimalParts | null {
  if (!Number.isFinite(value)) return null;
  if (value === 0) return { digits: 0n, exp: 0 };
  const text = Math.abs(value).toString();
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] ?? '';
  const exponent = match[3] ? Number(match[3]) : 0;
  const digits = BigInt(whole + fraction);
  return { digits: value < 0 ? -digits : digits, exp: exponent - fraction.length };
}

/** digits × 10^exp back to the nearest double, without a lossy power of ten. */
function fromDecimal(digits: bigint, exp: number): number {
  if (exp === 0) return Number(digits);
  const text = digits.toString();
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  let written: string;
  if (exp >= 0) {
    written = body + '0'.repeat(exp);
  } else {
    const point = body.length + exp;
    written = point > 0 ? `${body.slice(0, point)}.${body.slice(point)}` : `0.${'0'.repeat(-point)}${body}`;
  }
  return Number(`${negative ? '-' : ''}${written}`);
}

/** Decimals needed to write a number as its shortest round-trip decimal. */
export function decimalsOf(value: number): number {
  const parts = decimalParts(value);
  if (!parts) return 0;
  return Math.max(0, Math.min(15, -parts.exp));
}

/** Number of complete steps between lower and upper (k max), or −1 when unusable. */
export function discreteStepCount(lower: number, upper: number, step: number): number {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !Number.isFinite(step) || !(step > 0)) return -1;
  if (!(upper > lower)) return -1;
  const l = decimalParts(lower);
  const u = decimalParts(upper);
  const s = decimalParts(step);
  if (l && u && s) {
    const exp = Math.min(l.exp, u.exp, s.exp);
    const scaledLower = l.digits * 10n ** BigInt(l.exp - exp);
    const scaledUpper = u.digits * 10n ** BigInt(u.exp - exp);
    const scaledStep = s.digits * 10n ** BigInt(s.exp - exp);
    if (scaledStep <= 0n) return -1;
    const count = (scaledUpper - scaledLower) / scaledStep;
    if (count < 0n) return -1;
    const asNumber = Number(count);
    return Number.isFinite(asNumber) ? asNumber : -1;
  }
  const ratio = (upper - lower) / step;
  const kMax = Math.floor(ratio + DOMAIN_EPS * Math.max(1, Math.abs(ratio)));
  return kMax >= 0 ? kMax : -1;
}

/** The k-th allowed value: Lower + k × Step, with float noise removed. */
export function discreteValueAt(lower: number, step: number, k: number): number {
  if (!Number.isFinite(lower) || !Number.isFinite(step) || !Number.isFinite(k)) return Number.NaN;
  const l = decimalParts(lower);
  const s = decimalParts(step);
  if (l && s && Number.isInteger(k) && Math.abs(k) <= MAX_SAFE_MAGNITUDE) {
    const exp = Math.min(l.exp, s.exp, 0);
    const scaledLower = l.digits * 10n ** BigInt(l.exp - exp);
    const scaledStep = s.digits * 10n ** BigInt(s.exp - exp);
    return fromDecimal(scaledLower + BigInt(k) * scaledStep, exp);
  }
  return Number((lower + k * step).toPrecision(15));
}

/**
 * Would this lattice hand out the same number twice?
 *
 * A step smaller than the spacing two doubles can have at this magnitude
 * (0.1 at 1e15, where the spacing is 0.125) does not describe a finer domain:
 * several indices collapse onto one value, so the search would enumerate
 * duplicates and the reader would be told about values that do not exist.
 */
/** The distance between two neighbouring doubles at this magnitude. */
export function doubleSpacing(value: number): number {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude)) return Number.NaN;
  if (magnitude === 0) return 2 ** -1074;
  const exponent = Math.floor(Math.log2(magnitude));
  return 2 ** (exponent - 52);
}

export function latticeIsRepresentable(lower: number, upper: number, step: number, steps = discreteStepCount(lower, upper, step)): boolean {
  if (steps < 0) return false;
  const first = discreteValueAt(lower, step, 0);
  if (!Number.isFinite(first)) return false;
  // A range shorter than one step has exactly one allowed value (Lower). That
  // is a complete lattice, not a degenerate one: there is no second value to
  // compare it with, and there is nothing for it to collide with.
  if (steps === 0) return Number.isFinite(lower) && Number.isFinite(upper);
  const second = discreteValueAt(lower, step, 1);
  const last = discreteValueAt(lower, step, steps);
  if (!Number.isFinite(second) || !Number.isFinite(last)) return false;
  return second > first && last >= second;
}

/**
 * Every reason a discrete domain cannot be searched, as one verdict.
 *
 * The order matters: a range that is not a range is reported as such before
 * anything is asked about its lattice.
 */
export function discreteDomainIssue(lower: number, upper: number, step: number): string | null {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !(upper > lower)) return 'opt.issue.factorRange';
  if (!Number.isFinite(step) || !(step > 0)) return 'opt.issue.factorStep';
  if (Math.abs(lower) > MAX_SAFE_MAGNITUDE || Math.abs(upper) > MAX_SAFE_MAGNITUDE) return 'opt.issue.integerSafeRange';
  const steps = discreteStepCount(lower, upper, step);
  if (steps < 0) return 'opt.issue.factorRange';
  if (steps > MAX_SAFE_MAGNITUDE) return 'opt.issue.stepCount';
  // A step finer than the spacing between two doubles at this magnitude cannot
  // describe a finer domain: the values would not be Lower + k × Step.
  if (step < doubleSpacing(lower) || step < doubleSpacing(upper)) return 'opt.issue.stepBelowPrecision';
  if (!latticeIsRepresentable(lower, upper, step, steps)) return 'opt.issue.stepBelowPrecision';
  return null;
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
  // A lattice whose consecutive values would collapse onto one another is not
  // a list of allowed values; an empty axis says so instead of repeating one.
  if (!latticeIsRepresentable(lower, upper, step, steps)) return { values: [], count: 0, steps: 0, truncated: false, lower, step };
  const count = steps + 1;
  const distinct = (values: number[]): boolean => values.every((value, index) => index === 0 || value > values[index - 1]);
  if (count <= limit) {
    const values: number[] = [];
    for (let k = 0; k <= steps; k += 1) values.push(discreteValueAt(lower, step, k));
    if (!distinct(values)) return { values: [], count: 0, steps: 0, truncated: false, lower, step };
    return { values, count, steps, truncated: false, lower, step };
  }
  const stride = Math.ceil(steps / Math.max(1, limit - 1));
  const values: number[] = [];
  for (let k = 0; k < steps; k += stride) values.push(discreteValueAt(lower, step, k));
  values.push(discreteValueAt(lower, step, steps));
  if (!distinct(values)) return { values: [], count: 0, steps: 0, truncated: false, lower, step };
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
  // On-step is an absolute question at the lattice's own resolution: a value
  // 0.3 of a step away is off the lattice whatever the offset is.
  const onStep = Math.abs(snapped - value) <= latticeTolerance(lower, upper, step, value) && k >= 0 && k <= steps;
  return {
    value: snapped,
    k: clamped,
    inside: value >= lower - rangeSlack(lower, upper, value) && value <= upper + rangeSlack(lower, upper, value),
    onStep,
  };
}

/** Is `value` exactly an allowed lattice value inside the range? */
export function isOnStep(lower: number, upper: number, step: number, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const snapped = nearestStepValue(lower, upper, step, value);
  return snapped.inside && snapped.onStep;
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

/**
 * Every problem with a factor definition itself (i18n keys).
 *
 * A domain a reader could not search is reported here, once, so the optimiser
 * and the window state the same reason instead of discovering it mid-search.
 */
export function factorIssues(factor: FactorSettings): string[] {
  const issues: string[] = [];
  const hasRange = Number.isFinite(factor.lower) && Number.isFinite(factor.upper) && factor.upper > factor.lower;
  if (factor.kind === 'categorical') {
    if (!factor.levels.length) issues.push('opt.issue.levelMissing');
  } else {
    if (factor.kind === 'discrete' && (!(factor.step > 0) || !Number.isFinite(factor.step))) issues.push('opt.issue.factorStep');
    // A fixed factor carries no range: only its fixed value is used, and that
    // value is checked against the limits below.
    if (!factor.fixed && !hasRange) issues.push('opt.issue.factorRange');
    if (factor.kind === 'discrete' && factor.step > 0 && Number.isFinite(factor.step) && hasRange) {
      const domain = discreteDomainIssue(factor.lower, factor.upper, factor.step);
      if (domain) issues.push(domain);
    }
  }
  if (factor.fixed) {
    if (factor.kind === 'categorical') {
      if (!factor.levels.includes(String(factor.fixedValue))) issues.push('opt.issue.fixedOffStep');
    } else {
      const value = Number(factor.fixedValue);
      if (!Number.isFinite(value)) issues.push('opt.issue.fixedOffStep');
      else if (value < factor.lower - rangeSlack(factor.lower, factor.upper, value) || value > factor.upper + rangeSlack(factor.lower, factor.upper, value)) {
        issues.push('opt.issue.fixedOutside');
      } else if (factor.kind === 'discrete' && hasRange && !isOnStep(factor.lower, factor.upper, factor.step, value)) {
        issues.push('opt.issue.fixedOffStep');
      }
    }
  }
  return [...new Set(issues)];
}

/**
 * Duplicate factor definitions in one problem.
 *
 * Two entries with the same name would be merged into one search axis by a
 * `Set`, so the reader would quietly search neither of the ranges they typed.
 * A stored model whose predictors repeat a name has the same problem one level
 * deeper: every coefficient label would resolve to the first of them.
 */
export function duplicateFactorNames(factors: FactorSettings[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  factors.forEach((factor) => {
    const key = factor.name.trim();
    if (seen.has(key)) duplicates.push(key);
    else seen.add(key);
  });
  return duplicates;
}

/** Predictor names a stored model repeats (empty when its identifiers are unique). */
export function duplicatePredictorNames(predictors: { name: string; id?: string }[]): string[] {
  const byName = new Set<string>();
  const byId = new Set<string>();
  const duplicates: string[] = [];
  predictors.forEach((predictor) => {
    const name = predictor.name.trim();
    const id = predictor.id?.trim();
    if (byName.has(name) || (id ? byId.has(id) : false)) duplicates.push(name);
    byName.add(name);
    if (id) byId.add(id);
  });
  return [...new Set(duplicates)];
}

/** Is one candidate value allowed for this factor? (i18n key or null) */
export function validateFactorValue(factor: FactorSettings, value: number | string): string | null {
  if (factor.kind === 'categorical') {
    const levels = factor.levels;
    return typeof value === 'string' && levels.includes(value) ? null : 'opt.issue.levelUnknown';
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 'opt.issue.valueMissing';
  if (factor.kind === 'discrete' && factor.step > 0 && Number.isFinite(factor.step)
    && Number.isFinite(factor.lower) && Number.isFinite(factor.upper) && factor.upper > factor.lower) {
    // The domain itself comes first: a lattice that cannot be searched is not
    // made searchable by picking a value on it.
    const domain = discreteDomainIssue(factor.lower, factor.upper, factor.step);
    if (domain) return domain;
  }
  const slack = rangeSlack(factor.lower, factor.upper, numeric);
  if (numeric < factor.lower - slack || numeric > factor.upper + slack) return 'opt.issue.valueOutside';
  if (factor.kind === 'discrete' && !isOnStep(factor.lower, factor.upper, factor.step, numeric)) return 'opt.issue.valueOffStep';
  return null;
}

/**
 * The intersection of several closed ranges, or null when they do not overlap.
 *
 * Near-touch policy (Q-03): two ranges whose bounds differ only by the rounding
 * of their own doubles (at most a few ULPs, plus a 1e-9 share of the gap) are
 * one point, reported as `[b, b]` with `b` the shared bound. A gap wider than
 * that rounding is no intersection, and an inverted interval (`lower > upper`)
 * is never returned.
 */
export function rangeIntersection(ranges: [number, number][]): [number, number] | null {
  const usable = ranges.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]);
  if (!usable.length) return null;
  const lower = Math.max(...usable.map(([a]) => a));
  const upper = Math.min(...usable.map(([, b]) => b));
  if (upper >= lower) return [lower, upper];
  const slack = rangeSlack(lower, upper);
  if (lower - upper <= slack) return [upper, upper];
  return null;
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
