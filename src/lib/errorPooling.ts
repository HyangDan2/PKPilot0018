/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — manual error pooling and saturated-design diagnostics
   (WO-3F-03 / WO-3F-06)

   Pooling is a refit, not arithmetic. The pooled terms leave the model, the
   design matrix is rebuilt without them, and every reported number (SSE, DFE,
   MSE, SE, F, P, R², predictions) comes from that fit. The additive identity

       SSE(new) = SSE(full) + Σ SS(pooled)
       DFE(new) = DFE(full) + Σ DF(pooled)

   is checked and reported: it holds exactly for orthogonal, estimable terms and
   fails (truthfully) for a non-orthogonal design, where the joint sum of squares
   is the difference of the two fits rather than the sum of the individual drops.

   A saturated fit keeps its estimable coefficients and loses only the tests:
   no error mean square exists, so F, t and p are unavailable rather than NaN
   printed as a number. Lenth's PSE is offered only for an unreplicated 2-level
   factorial, and is labelled as a pseudo standard error, not a residual SE.
   ───────────────────────────────────────────────────────────────────────── */

import { tInv } from './dist';
import { fitGlm, type GlmResult, type ModelFactor, type ModelTerm } from './glm';

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface PooledTerm {
  name: string;
  df: number;
  ss: number;
  estimable: boolean;
}

export interface PoolingCheck {
  sameRows: boolean;
  expectedDfe: number;
  actualDfe: number;
  dfOk: boolean;
  expectedSs: number;
  actualSs: number;
  ssOk: boolean;
  /** True when the additive identity held: the pooled terms are orthogonal. */
  additive: boolean;
  tolerance: number;
}

export interface PoolingResult {
  /** The model after the pooled terms were removed and the design rebuilt. */
  fit: GlmResult;
  /** The model before pooling, kept so nothing is silently overwritten. */
  full: GlmResult;
  pooled: PooledTerm[];
  checks: PoolingCheck;
  warnings: string[];
}

/**
 * Move `pooledNames` from the model to the error term and refit.
 *
 * The result never invents a number: a term that is aliased (df 0) is listed
 * with zero df and is not added twice; a name that is not in the model is a
 * warning, not a silent success.
 */
export function fitWithPooling(
  y: (number | null)[],
  factors: ModelFactor[],
  terms: ModelTerm[],
  pooledNames: string[],
  options: { allowZeroDf?: boolean } = {},
): PoolingResult {
  const wanted = new Set(pooledNames);
  const activeTerms = terms.filter((term) => !wanted.has(term.name));
  const warnings: string[] = [];
  if (!activeTerms.length) throw new Error('glm.noTerms');
  const full = fitGlm(y, factors, terms, { allowZeroDf: true });
  const fit = fitGlm(y, factors, activeTerms, { allowZeroDf: options.allowZeroDf ?? true });
  const present = new Set(terms.map((term) => term.name));
  pooledNames.forEach((name) => { if (!present.has(name)) warnings.push(`unknown-pooled-term:${name}`); });

  const pooled: PooledTerm[] = terms
    .filter((term) => wanted.has(term.name))
    .map((term) => {
      const row = full.terms.find((candidate) => candidate.name === term.name);
      const estimable = Boolean(row && row.df > 0);
      if (!estimable && row) warnings.push(`aliased-pooled-term:${term.name}`);
      return { name: term.name, df: row?.df ?? 0, ss: estimable ? (row?.ssAdj ?? 0) : 0, estimable };
    });

  const expectedDfe = full.dfe + pooled.reduce((sum, term) => sum + term.df, 0);
  const expectedSs = full.sse + pooled.reduce((sum, term) => sum + term.ss, 0);
  const actualSs = fit.sse;
  const tolerance = 1e-8 * Math.max(1, Math.abs(actualSs), Math.abs(expectedSs));
  const sameRows = full.design.rows.length === fit.design.rows.length
    && full.design.rows.every((row, i) => row === fit.design.rows[i]);
  const dfOk = expectedDfe === fit.dfe;
  const ssOk = Math.abs(expectedSs - actualSs) <= tolerance;
  if (!dfOk) warnings.push('df-identity-failed');
  if (!ssOk) warnings.push('ss-identity-failed');
  if (!sameRows) warnings.push('row-set-changed');

  return {
    fit,
    full,
    pooled,
    checks: {
      sameRows,
      expectedDfe,
      actualDfe: fit.dfe,
      dfOk,
      expectedSs,
      actualSs,
      ssOk,
      additive: dfOk && ssOk,
      tolerance,
    },
    warnings,
  };
}

export interface LenthPse {
  /** Pseudo standard error: 1.5 × median of the "inactive" |effects|. */
  pse: number;
  /** Margin of error at (1 − α) (t_{1−α/2, d} × PSE). */
  me: number;
  /** Simultaneous margin of error (t_{γ, d} × PSE, γ = [1 + (1 − α)^(1/m)] / 2; SME ≥ ME). */
  sme: number;
  /** Pseudo degrees of freedom, d = m / 3 (Lenth 1989). */
  pseudoDf: number;
  /** Effects used in the median (|effect| < 2.5 s0). */
  activeCount: number;
  effects: { term: string; effect: number; abs: number; active: boolean }[];
}

export interface LenthAvailability {
  available: boolean;
  reason?: 'not-saturated' | 'too-few-effects' | 'degenerate' | 'replicated';
  result?: LenthPse;
}

/**
 * Lenth's PSE for an unreplicated 2-level factorial (Lenth 1989). Effects must
 * all have one degree of freedom; a design with genuine replicates has a
 * residual SE and no need for a pseudo error, so it is refused rather than
 * substituted.
 */
export function lenthPse(
  effects: { term: string; effect: number }[],
  options: { replicated?: boolean; saturated?: boolean; alpha?: number } = {},
): LenthAvailability {
  if (options.replicated) return { available: false, reason: 'replicated' };
  if (!options.saturated) return { available: false, reason: 'not-saturated' };
  const usable = effects.filter((entry) => Number.isFinite(entry.effect));
  const m = usable.length;
  if (m < 3) return { available: false, reason: 'too-few-effects' };
  const abs = usable.map((entry) => Math.abs(entry.effect));
  const s0 = 1.5 * median(abs);
  if (!(s0 > 0)) return { available: false, reason: 'degenerate' };
  const selected = abs.filter((value) => value < 2.5 * s0);
  if (selected.length < 2) return { available: false, reason: 'degenerate' };
  const pse = 1.5 * median(selected);
  if (!(pse > 0)) return { available: false, reason: 'degenerate' };
  const alpha = options.alpha ?? 0.05;
  const pseudoDf = m / 3;
  const tMe = tInv(1 - alpha / 2, pseudoDf);
  const gamma = (1 + Math.pow(1 - alpha, 1 / m)) / 2;
  const tSme = tInv(gamma, pseudoDf);
  const me = tMe * pse;
  const sme = tSme * pse;
  return {
    available: true,
    result: {
      pse,
      me,
      sme,
      pseudoDf,
      activeCount: selected.length,
      effects: usable.map((entry) => ({
        term: entry.term,
        effect: entry.effect,
        abs: Math.abs(entry.effect),
        active: Math.abs(entry.effect) >= 2.5 * s0,
      })),
    },
  };
}

export interface SaturatedReport {
  /** True when no residual df remains to estimate error. */
  saturated: boolean;
  errorDf: number;
  inferable: boolean;
  /** Terms with df > 0: their coefficients are estimable. */
  estimable: { name: string; df: number; ss: number; coef?: number }[];
  aliased: string[];
  reason: 'ok' | 'no-error-df' | 'no-data';
  lenth: LenthAvailability;
}

/** What can and cannot be said about a fit, without turning NaN into a result. */
export function saturatedReport(
  fit: GlmResult,
  effects?: { term: string; effect: number }[],
  options: { replicated?: boolean } = {},
): SaturatedReport {
  const saturated = fit.dfe === 0;
  return {
    saturated,
    errorDf: fit.dfe,
    inferable: fit.inferable,
    estimable: fit.terms.filter((term) => term.df > 0).map((term) => ({ name: term.name, df: term.df, ss: term.ssAdj })),
    aliased: fit.aliased,
    reason: fit.n === 0 ? 'no-data' : saturated ? 'no-error-df' : 'ok',
    lenth: effects ? lenthPse(effects, { replicated: options.replicated, saturated }) : { available: false, reason: 'too-few-effects' },
  };
}
