/* ─────────────────────────────────────────────────────────────────────────
   Statelia — error-bar statistics (Stage 3D, WO-08)

   An error bar is a statistic, so it is defined once, here, and drawn from
   this module by every renderer. Nothing is estimated from the picture.

   For a point with n replicate values x₁ … xₙ:

       mean  x̄ = Σxᵢ / n
       sd    s  = √( Σ(xᵢ − x̄)² / (n − 1) )            (sample, n − 1)
       se    SE = s / √n
       ci    x̄ ± t(1 − α/2, n − 1) · SE                  (two-sided Student t)

   `sd` needs n ≥ 2, `se` needs n ≥ 2 and `ci` needs n ≥ 2 with a finite
   t quantile; a single value has no spread, so the bar is not drawn rather
   than drawn at zero width and read as "no variation".

   The independent check lives in `tests/error-bars.test.ts` and in
   `qa/cases/QA-X-stage3d-errorbars.json`, which compares the shipped
   TypeScript against SciPy's `t.ppf` / `numpy.std(ddof=1)`.
   ───────────────────────────────────────────────────────────────────────── */

import { mean, stdev } from './stats';
import { tInv } from './dist';

export type ErrorBarStatistic = 'sd' | 'se' | 'ci';

export interface ErrorBarValue {
  /** Number of replicates the statistic was computed from. */
  n: number;
  mean: number;
  sd: number;
  se: number;
  /** Half-width of the interval actually drawn. */
  half: number;
  lower: number;
  upper: number;
  /** Two-sided confidence level used for `ci` (undefined for sd / se). */
  conf?: number;
  /** Upper critical value of the Student t used for `ci`. */
  tCrit?: number;
}

function finiteValues(values: number[]): number[] {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value));
}

/**
 * The error bar for one point (or one pooled series).
 *
 * Returns `null` when the statistic cannot be computed — never a placeholder
 * bar. `kind` must be one of the three documented statistics; anything else is
 * treated as "no bars".
 */
export function errorBarFor(
  values: number[],
  kind: ErrorBarStatistic,
  conf = 0.95,
): ErrorBarValue | null {
  const clean = finiteValues(values);
  const n = clean.length;
  if (kind !== 'sd' && kind !== 'se' && kind !== 'ci') return null;
  if (n < 2) return null;
  const m = mean(clean);
  const sd = stdev(clean);
  if (!Number.isFinite(m) || !Number.isFinite(sd)) return null;
  const se = sd / Math.sqrt(n);
  if (kind === 'sd') {
    return { n, mean: m, sd, se, half: sd, lower: m - sd, upper: m + sd };
  }
  if (kind === 'se') {
    return { n, mean: m, sd, se, half: se, lower: m - se, upper: m + se };
  }
  const level = Math.min(0.999, Math.max(0.5, Number.isFinite(conf) ? conf : 0.95));
  const alpha = 1 - level;
  const tCrit = tInv(1 - alpha / 2, n - 1);
  if (!Number.isFinite(tCrit)) return null;
  const half = tCrit * se;
  return { n, mean: m, sd, se, half, lower: m - half, upper: m + half, conf: level, tCrit };
}

/** Name used in the plot annotation and in the report. */
export function errorBarLabel(stat: ErrorBarValue, kind: ErrorBarStatistic): string {
  if (kind === 'sd') return `Mean ± SD (n=${stat.n})`;
  if (kind === 'se') return `Mean ± SE (n=${stat.n})`;
  return `Mean ± ${((stat.conf ?? 0.95) * 100).toFixed(0)}% CI (n=${stat.n}, t=${stat.tCrit?.toFixed(3) ?? '—'})`;
}

/** The largest half-width any drawn bar needs, so the axis can include it. */
export function errorBarExtent(values: ErrorBarValue[]): { min: number; max: number } | null {
  if (!values.length) return null;
  let min = Infinity;
  let max = -Infinity;
  values.forEach((value) => {
    if (value.lower < min) min = value.lower;
    if (value.upper > max) max = value.upper;
  });
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
