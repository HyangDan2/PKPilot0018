/* ─────────────────────────────────────────────────────────────────────────
   Statelia — the Derringer–Suich desirability function (WO-05)

   Every response is turned into a number between 0 and 1 that means the same
   thing for all of them: 0 = unacceptable, 1 = as good as the stated limits
   allow. That is what makes several different responses comparable enough to
   optimise together.

   Two numbers shape the answer and they are not interchangeable:

   · Weight (per response) bends one curve. With `maximize`, d = ((y − L) /
     (U − L))^weight, so weight 2 punishes leaving the good end and weight 0.5
     rewards leaving the bad end early. Weight never changes how much the
     response counts against the others.
   · Importance (per response) changes exactly that: the composite is the
     importance-weighted geometric mean,
         D = (Π dᵢ^Iᵢ)^(1 / Σ Iᵢ),
     so a response with importance 2 moves D twice as much as one with
     importance 1 for the same relative loss of desirability.

   A geometric mean is used (not an arithmetic one) on purpose: it is zero as
   soon as any single response is unacceptable, which is what "all responses
   must be in specification" means. `range` is a step function and `ignore`
   leaves the composite while still being predicted and reported.

   Stage 3C correction — validation is explicit, never corrective:

   · Limits are taken as stated. A reversed pair (upper first) is an error, not
     an invitation to swap them, because a reader who typed them that way is
     telling us something we should ask about.
   · Weight and importance must be finite and positive; NaN and ±Infinity are
     reported instead of being replaced by 1.
   · A target that sits exactly on a limit is defined here once: the peak of the
     curve is at the target, so d = 1 at that limit and falls to 0 at the other.
   · Desirability (soft, comparable) and the hard specification (acceptable or
     not) are separate verdicts. This module reports both; the optimiser only
     recommends a condition that meets every hard specification.
   ───────────────────────────────────────────────────────────────────────── */

import type { ResponseGoal, ResponseSettings } from './optimizationTypes';

export const WEIGHT_MIN = 0.1;
export const WEIGHT_MAX = 10;
export const IMPORTANCE_MIN = 0.1;
export const IMPORTANCE_MAX = 10;

/** Clamp a *validated finite* number into its documented range. */
const clamp = (value: number, lo: number, hi: number): number => (Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : lo);

export interface ResponseLimits {
  lower: number;
  upper: number;
  target: number | null;
}

/**
 * The limits a response is judged on, or null when they are not usable.
 *
 * `lower` must be below `upper`. Nothing is swapped: a reversed pair returns
 * null and `responseIssues` names the reason, so the reader can fix the input
 * rather than silently optimise a different interval.
 */
export function responseLimits(settings: ResponseSettings): ResponseLimits | null {
  const a = settings.lower;
  const b = settings.upper;
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === b) return null;
  if (a > b) return null;
  const target = settings.target !== null && Number.isFinite(settings.target) ? settings.target : null;
  return { lower: a, upper: b, target };
}

/** Did the reader state the two limits the wrong way round? */
export function limitsReversed(settings: ResponseSettings): boolean {
  const a = settings.lower;
  const b = settings.upper;
  return a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && a > b;
}

/** Problems with a response definition (i18n keys, empty when it is usable). */
export function responseIssues(settings: ResponseSettings): string[] {
  if (settings.goal === 'ignore') return [];
  const issues: string[] = [];
  if (limitsReversed(settings)) {
    issues.push('opt.issue.limitsReversed');
  } else {
    const limits = responseLimits(settings);
    if (!limits) {
      const missing = settings.lower === null || settings.upper === null;
      issues.push(missing ? 'opt.issue.limitsMissing' : 'opt.issue.limitsOrder');
      return issues;
    }
    if (settings.goal === 'target') {
      if (limits.target === null) issues.push('opt.issue.targetMissing');
      else if (limits.target < limits.lower || limits.target > limits.upper) issues.push('opt.issue.targetOutside');
    }
  }
  if (!(typeof settings.weight === 'number' && Number.isFinite(settings.weight) && settings.weight > 0)) issues.push('opt.issue.weight');
  if (!(typeof settings.importance === 'number' && Number.isFinite(settings.importance) && settings.importance > 0)) issues.push('opt.issue.importance');
  return [...new Set(issues)];
}

/** Does this response take part in the composite at all? */
export function participates(settings: ResponseSettings): boolean {
  return settings.goal !== 'ignore' && responseIssues(settings).length === 0;
}

/**
 * The desirability of one predicted value.
 *
 * `value === null` (a prediction that leans on an unidentified column, or a
 * point the model cannot evaluate) scores 0: an unknown response cannot be
 * called good.
 *
 * Target boundaries: with `target = lower` the peak sits on the lower limit, so
 * d = 1 there and d = ((upper − y) / (upper − lower))^w above it; with
 * `target = upper` the mirror image holds. Values outside the limits score 0.
 */
export function individualDesirability(value: number | null, settings: ResponseSettings): number {
  if (settings.goal === 'ignore') return 1;
  if (value === null || !Number.isFinite(value)) return 0;
  const limits = responseLimits(settings);
  if (!limits) return 0;
  const { lower, upper, target } = limits;
  if (!(Number.isFinite(settings.weight) && settings.weight > 0)) return 0;
  const weight = clamp(settings.weight, WEIGHT_MIN, WEIGHT_MAX);
  const span = upper - lower;
  switch (settings.goal) {
    case 'maximize': {
      if (value <= lower) return 0;
      if (value >= upper) return 1;
      return Math.pow((value - lower) / span, weight);
    }
    case 'minimize': {
      if (value <= lower) return 1;
      if (value >= upper) return 0;
      return Math.pow((upper - value) / span, weight);
    }
    case 'target': {
      if (target === null) return value >= lower && value <= upper ? 1 : 0;
      if (value < lower || value > upper) return 0;
      if (value === target) return 1;
      if (value < target) {
        const head = target - lower;
        return head <= 0 ? 1 : Math.pow((value - lower) / head, weight);
      }
      const tail = upper - target;
      return tail <= 0 ? 1 : Math.pow((upper - value) / tail, weight);
    }
    case 'range':
      // "In range" is a step: the value is either acceptable or it is not.
      return value >= lower && value <= upper ? 1 : 0;
    default:
      return 1;
  }
}

/**
 * Is the predicted value acceptable for this goal? (the hard specification)
 *
 * The two limits do not mean the same thing under every goal, so the test is
 * goal-aware rather than a plain interval check:
 *
 * · maximize — `lower` is the point below which the response is unacceptable
 *   and `upper` is the ideal point; going past the ideal is still acceptable.
 * · minimize — mirrored: `upper` is the unacceptable end, `lower` the ideal.
 * · target / range — both ends are hard limits.
 */
export function withinLimits(value: number | null, settings: ResponseSettings): boolean {
  if (settings.goal === 'ignore') return true;
  if (value === null || !Number.isFinite(value)) return false;
  const limits = responseLimits(settings);
  if (!limits) return false;
  switch (settings.goal) {
    case 'maximize': return value >= limits.lower;
    case 'minimize': return value <= limits.upper;
    default: return value >= limits.lower && value <= limits.upper;
  }
}

export interface DesirabilityEntry {
  desirability: number;
  importance: number;
  goal: ResponseGoal;
}

/**
 * Composite desirability: the importance-weighted geometric mean.
 *
 * Returns 0 when any participating response is unacceptable (a geometric mean
 * of a zero is zero) and 1 when all of them sit at their best. Responses whose
 * goal is `ignore` do not enter the product; when nothing participates the
 * composite is 0, because there is no goal to be satisfied. A non-finite or
 * non-positive importance makes the composite unanswerable (0) rather than
 * being replaced by a neutral 1.
 */
export function compositeDesirability(entries: DesirabilityEntry[]): number {
  const active = entries.filter((entry) => entry.goal !== 'ignore');
  if (!active.length) return 0;
  let weightSum = 0;
  let logSum = 0;
  for (const entry of active) {
    if (!(typeof entry.importance === 'number' && Number.isFinite(entry.importance) && entry.importance > 0)) return 0;
    const importance = clamp(entry.importance, IMPORTANCE_MIN, IMPORTANCE_MAX);
    const d = Math.min(1, Math.max(0, Number.isFinite(entry.desirability) ? entry.desirability : 0));
    if (d <= 0) return 0;
    weightSum += importance;
    logSum += importance * Math.log(d);
  }
  if (weightSum <= 0) return 0;
  return Math.exp(logSum / weightSum);
}
