/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — original vs reduced model comparison (WO-3F-05)

   Pooling and model reduction produce a second fit; the first fit is never
   overwritten. This module turns the two fits into the comparison a reader
   needs: the usual fit statistics side by side, the retained and removed
   terms, the coefficient and ANOVA changes, and a partial F-test when the
   reduced model is genuinely nested inside the original one and a residual
   mean square exists to test against.

   Values the fits cannot define (predicted R² without PRESS, statistics of a
   saturated fit) are reported as unavailable with a reason, never as zero.
   ───────────────────────────────────────────────────────────────────────── */

import { fCdf } from './dist';
import type { GlmResult } from './glm';

export type MetricReason = 'model.cmp.notInferable' | 'model.cmp.pressUnavailable' | 'model.cmp.missing';

export interface ComparisonMetric {
  key: string;
  original: number | null;
  reduced: number | null;
  difference: number | null;
  reason?: MetricReason;
}

export interface PartialTest {
  df1: number;
  df2: number;
  f: number;
  p: number;
}

export type PartialReason = 'not-nested' | 'no-reduction' | 'no-error-df' | 'row-set-changed';

export interface CoefficientChange {
  label: string;
  original: number | null;
  reduced: number | null;
}

export interface AnovaChange {
  term: string;
  originalSs: number | null;
  reducedSs: number | null;
  state: 'retained' | 'removed';
}

export interface ModelComparison {
  original: GlmResult;
  reduced: GlmResult;
  retained: string[];
  removed: string[];
  nested: boolean;
  metrics: ComparisonMetric[];
  partial: PartialTest | null;
  partialReason: PartialReason | null;
  coefficients: CoefficientChange[];
  anova: AnovaChange[];
}

function metricValue(fit: GlmResult, key: string): { value: number | null; reason?: MetricReason } {
  switch (key) {
    case 'n': return { value: fit.n };
    case 'modelDf': return { value: fit.dfModel };
    case 'errorDf': return { value: fit.dfe };
    case 'modelSs': return { value: fit.ssModel };
    case 'errorSs': return { value: fit.sse };
    case 'errorMs': return Number.isFinite(fit.mse) ? { value: fit.mse } : { value: null, reason: 'model.cmp.notInferable' };
    case 's': return Number.isFinite(fit.s) ? { value: fit.s } : { value: null, reason: 'model.cmp.notInferable' };
    case 'r2': return Number.isFinite(fit.r2) ? { value: fit.r2 } : { value: null, reason: 'model.cmp.missing' };
    case 'r2adj': return Number.isFinite(fit.r2adj) ? { value: fit.r2adj } : { value: null, reason: 'model.cmp.notInferable' };
    case 'r2pred': return Number.isFinite(fit.r2pred) ? { value: fit.r2pred } : { value: null, reason: 'model.cmp.pressUnavailable' };
    default: return { value: null, reason: 'model.cmp.missing' };
  }
}

export const COMPARISON_METRICS = ['n', 'modelDf', 'errorDf', 'modelSs', 'errorSs', 'errorMs', 's', 'r2', 'r2adj', 'r2pred'] as const;

/**
 * Compare an original fit with a reduced one. `removedNames` is what left the
 * model; the reduced fit's own terms are read from the fit, so a caller cannot
 * claim a term was kept when the engine did not fit it.
 */
export function compareFits(original: GlmResult, reduced: GlmResult, removedNames: string[]): ModelComparison {
  const removed = [...new Set(removedNames)];
  const originalTerms = original.terms.map((term) => term.name);
  const reducedTerms = reduced.terms.map((term) => term.name);
  const retained = reducedTerms.filter((name) => !removed.includes(name));
  const nested = removed.every((name) => originalTerms.includes(name))
    && reducedTerms.every((name) => originalTerms.includes(name))
    && reducedTerms.every((name) => !removed.includes(name));
  const sameRows = original.design.rows.length === reduced.design.rows.length
    && original.design.rows.every((row, i) => row === reduced.design.rows[i]);

  const metrics: ComparisonMetric[] = COMPARISON_METRICS.map((key) => {
    const before = metricValue(original, key);
    const after = metricValue(reduced, key);
    const both = before.value != null && after.value != null;
    return {
      key,
      original: before.value,
      reduced: after.value,
      difference: both ? after.value! - before.value! : null,
      ...(before.value == null ? { reason: before.reason } : after.value == null ? { reason: after.reason } : {}),
    };
  });

  // Dropping terms moves df from the model to the error, so the reduction
  // gains (reduced − original) error df, not the other way round.
  const df1 = reduced.dfe - original.dfe;
  let partial: PartialTest | null = null;
  let partialReason: PartialReason | null = null;
  if (!nested) partialReason = 'not-nested';
  else if (!sameRows) partialReason = 'row-set-changed';
  else if (df1 <= 0) partialReason = 'no-reduction';
  else if (!reduced.inferable || !(reduced.mse > 0)) partialReason = 'no-error-df';
  else {
    const drop = reduced.sse - original.sse;
    const tolerance = 1e-8 * Math.max(1, Math.abs(reduced.sse), Math.abs(original.sse));
    const f = drop >= -tolerance ? Math.max(0, drop) / df1 / reduced.mse : NaN;
    if (isFinite(f)) partial = { df1, df2: reduced.dfe, f, p: 1 - fCdf(f, df1, reduced.dfe) };
    else partialReason = 'no-error-df';
  }

  const labels = [...original.labels];
  reduced.labels.forEach((label) => { if (!labels.includes(label)) labels.push(label); });
  const indexOf = (fit: GlmResult, label: string) => {
    const index = fit.labels.indexOf(label);
    return index >= 0 && Number.isFinite(fit.beta[index]) ? fit.beta[index] : null;
  };
  const coefficients: CoefficientChange[] = labels.map((label) => ({
    label,
    original: indexOf(original, label),
    reduced: indexOf(reduced, label),
  }));

  const anova: AnovaChange[] = originalTerms.map((term) => {
    const before = original.terms.find((entry) => entry.name === term)?.ssAdj ?? null;
    const after = reduced.terms.find((entry) => entry.name === term)?.ssAdj ?? null;
    return { term, originalSs: before, reducedSs: after, state: removed.includes(term) ? 'removed' : 'retained' };
  });

  return {
    original,
    reduced,
    retained,
    removed,
    nested,
    metrics,
    partial,
    partialReason,
    coefficients,
    anova,
  };
}
