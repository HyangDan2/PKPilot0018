/* ─────────────────────────────────────────────────────────────────────────
   Statelia — Gage R&R (measurement systems analysis)
   Crossed study: every operator measures every part. Nested study: each
   operator measures its own set of parts and parts never meet another
   operator. ANOVA-based variance components, Minitab's %Study Var layout and
   the number of distinct categories (ndc).
   ───────────────────────────────────────────────────────────────────────── */

import { fCdf } from './dist';
import { mean } from './stats';

/** ndc = ⌊1.41·σ_part/σ_GRR⌋, capped so a near-zero GRR cannot print 1e12. */
function distinctCategories(varPart: number, varGrr: number): number {
  const sdPart = Math.sqrt(Math.max(0, varPart));
  const sdGrr = Math.sqrt(Math.max(0, varGrr));
  if (!(sdGrr > 1e-9)) return 999;
  return Math.min(999, Math.max(1, Math.floor((1.41 * sdPart) / sdGrr)));
}

export interface GrrRow {
  part: string;
  operator: string;
  measurement: number;
}

export interface AnovaRow {
  source: 'part' | 'operator' | 'interaction' | 'repeat' | 'partOperator' | 'total';
  df: number;
  ss: number;
  ms: number;
  f: number;
  p: number;
}

export interface VarianceComponent {
  name: 'repeat' | 'reproducibility' | 'interaction' | 'operator' | 'partToPart' | 'grr' | 'total';
  variance: number;
  stdev: number;
  contribution: number;
  studyVar: number;
  tolerance: number;
  /** true when the raw ANOVA estimate was negative and reported as zero */
  clamped: boolean;
}

export interface GrrResult {
  type: 'crossed' | 'nested';
  parts: number;
  operators: number;
  replicates: number;
  rows: number;
  anova: AnovaRow[];
  components: VarianceComponent[];
  grrVariance: number;
  totalVariance: number;
  studyVar: number;
  ndc: number;
  note?: 'interactionPooled' | 'unbalanced';
  /** components whose raw ANOVA estimate was negative (reported signed, additive) */
  negativeComponents: string[];
}

function component(
  name: VarianceComponent['name'],
  variance: number,
  total: number,
  studyVar: number,
  tol: number,
): VarianceComponent {
  // Minitab reports a negative variance component as a negative number and a
  // zero standard deviation; %Study Var uses the signed total so the components
  // stay additive.
  const v = variance;
  return {
    name,
    variance: v,
    stdev: Math.sqrt(Math.max(0, v)),
    contribution: total > 0 ? (v / total) * 100 : NaN,
    studyVar: total > 0 ? (Math.sqrt(Math.max(0, v)) / Math.sqrt(total)) * 100 : NaN,
    tolerance: tol > 0 ? (studyVar * Math.sqrt(Math.max(0, v)) / tol) * 100 : NaN,
    clamped: variance < 0,
  };
}

/**
 * Negative variance components: Minitab reports the raw (negative) estimate and
 * a zero standard deviation, keeping the components additive so that
 * total = GRR + part-to-part and the %Contribution column sums to 100 %. This
 * helper only names them for the output note; nothing is clamped or dropped.
 */
function negativeOf(values: Record<string, number>): string[] {
  return Object.entries(values).filter(([, v]) => v < 0).map(([name]) => name);
}

export interface GrrOptions {  /** tolerance width USL − LSL, optional */
  tolerance?: number;
  /** study-variation multiplier, default 6 */
  studyVar?: number;
  /** crossed only: pool a non-significant part×operator interaction into error */
  poolInteraction?: boolean;
  alpha?: number;
}

export function gageRR(rows: GrrRow[], type: 'crossed' | 'nested', options: GrrOptions = {}): GrrResult {
  const studyVar = options.studyVar ?? 6;
  const alpha = options.alpha ?? 0.05;
  const tol = options.tolerance && isFinite(options.tolerance) ? Math.abs(options.tolerance) : NaN;
  const parts = [...new Set(rows.map((r) => r.part))];
  const operators = [...new Set(rows.map((r) => r.operator))];
  if (parts.length < 2) throw new Error('grr.needParts');
  if (operators.length < 2) throw new Error('grr.needOperators');
  const grand = mean(rows.map((r) => r.measurement));
  const ssTotal = rows.reduce((a, r) => a + (r.measurement - grand) ** 2, 0);

  const groupMean = (pick: (r: GrrRow) => string): Map<string, { m: number; n: number }> => {
    const map = new Map<string, number[]>();
    rows.forEach((r) => {
      const key = pick(r);
      const list = map.get(key) ?? [];
      list.push(r.measurement);
      map.set(key, list);
    });
    const out = new Map<string, { m: number; n: number }>();
    map.forEach((values, key) => out.set(key, { m: mean(values), n: values.length }));
    return out;
  };

  const partMeans = groupMean((r) => r.part);
  const opMeans = groupMean((r) => r.operator);
  const cellMeans = groupMean((r) => `${r.part}\u0001${r.operator}`);
  const cellCounts = new Map<string, number>();
  rows.forEach((r) => {
    const key = `${r.part}\u0001${r.operator}`;
    cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
  });
  const counts = [...cellCounts.values()];
  const balanced = counts.every((c) => c === counts[0]);
  const replicates = balanced && counts.length ? counts[0] : NaN;
  const p = parts.length;
  const o = operators.length;

  if (type === 'crossed') {
    if (cellCounts.size !== p * o) throw new Error('grr.missingCells');
    if (!balanced) throw new Error('grr.unbalanced');
    const n = replicates;
    // Crossed ANOVA needs repeatability degrees of freedom po(n−1); with a
    // single replicate per part × operator cell that is 0 (MS_error undefined),
    // so the study cannot be analysed instead of returning NaN components.
    if (!(n >= 2)) throw new Error('grr.needReplicates');
    const ssPart = o * n * parts.reduce((a, part) => a + ((partMeans.get(part)?.m ?? grand) - grand) ** 2, 0);
    const ssOper = p * n * operators.reduce((a, op) => a + ((opMeans.get(op)?.m ?? grand) - grand) ** 2, 0);
    const ssCell = n * [...cellMeans.values()].reduce((a, cell) => a + (cell.m - grand) ** 2, 0);
    let ssInt = ssCell - ssPart - ssOper;
    const ssRepeat = ssTotal - ssCell;
    const dfPart = p - 1;
    const dfOper = o - 1;
    const dfInt = dfPart * dfOper;
    const dfRepeat = p * o * (n - 1);
    let msInt = dfInt > 0 ? ssInt / dfInt : NaN;
    const msRepeat = ssRepeat / dfRepeat;
    const fPart = msInt > 0 ? (ssPart / dfPart) / msInt : NaN;
    const fOper = msInt > 0 ? (ssOper / dfOper) / msInt : NaN;
    const fInt = msRepeat > 0 ? msInt / msRepeat : NaN;
    const pPart = isFinite(fPart) ? 1 - fCdf(fPart, dfPart, dfInt) : NaN;
    const pOper = isFinite(fOper) ? 1 - fCdf(fOper, dfOper, dfInt) : NaN;
    const pInt = isFinite(fInt) ? 1 - fCdf(fInt, dfInt, dfRepeat) : NaN;
    const anova: AnovaRow[] = [
      { source: 'part', df: dfPart, ss: ssPart, ms: ssPart / dfPart, f: fPart, p: pPart },
      { source: 'operator', df: dfOper, ss: ssOper, ms: ssOper / dfOper, f: fOper, p: pOper },
      { source: 'interaction', df: dfInt, ss: ssInt, ms: msInt, f: fInt, p: pInt },
      { source: 'repeat', df: dfRepeat, ss: ssRepeat, ms: msRepeat, f: NaN, p: NaN },
      { source: 'total', df: dfPart + dfOper + dfInt + dfRepeat, ss: ssTotal, ms: NaN, f: NaN, p: NaN },
    ];
    let note: GrrResult['note'];
    if (options.poolInteraction && isFinite(pInt) && pInt > alpha && dfInt > 0) {
      // Pool the interaction into the error term, as Minitab does when the
      // interaction is not significant: recompute every estimate from the
      // pooled mean square so the components stay consistent.
      const pooledDf = dfInt + dfRepeat;
      const pooledSs = ssInt + ssRepeat;
      const pooledMs = pooledSs / pooledDf;
      ssInt = 0;
      msInt = NaN;
      anova[2] = { source: 'interaction', df: 0, ss: 0, ms: NaN, f: NaN, p: NaN };
      anova[3] = { source: 'repeat', df: pooledDf, ss: pooledSs, ms: pooledMs, f: NaN, p: NaN };
      anova[1] = { source: 'operator', df: dfOper, ss: ssOper, ms: ssOper / dfOper, f: (ssOper / dfOper) / pooledMs, p: 1 - fCdf((ssOper / dfOper) / pooledMs, dfOper, pooledDf) };
      anova[0] = { source: 'part', df: dfPart, ss: ssPart, ms: ssPart / dfPart, f: (ssPart / dfPart) / pooledMs, p: 1 - fCdf((ssPart / dfPart) / pooledMs, dfPart, pooledDf) };
      const varRepeat = pooledMs;
      const varOper = ((ssOper / dfOper) - pooledMs) / (p * n);
      const varPart = ((ssPart / dfPart) - pooledMs) / (o * n);
      const varGrr = varRepeat + Math.max(0, varOper);
      const varTotal = varGrr + Math.max(0, varPart);
      const components = [
        component('repeat', varRepeat, varTotal, studyVar, tol),
        component('reproducibility', varOper, varTotal, studyVar, tol),
        component('operator', varOper, varTotal, studyVar, tol),
        component('partToPart', varPart, varTotal, studyVar, tol),
        component('grr', varGrr, varTotal, studyVar, tol),
        component('total', varTotal, varTotal, studyVar, tol),
      ];
      return {
        type,
        parts: p,
        operators: o,
        replicates: n,
        rows: rows.length,
        anova,
        components,
        grrVariance: varGrr,
        totalVariance: varTotal,
        studyVar,
        ndc: distinctCategories(varPart, varGrr),
        note: 'interactionPooled',
        negativeComponents: negativeOf({ repeat: varRepeat, reproducibility: varOper, operator: varOper, partToPart: varPart, grr: varGrr, total: varTotal }),
      };
    }
    const varRepeat = msRepeat;
    const varInt = (msInt - msRepeat) / n;
    const varOper = (ssOper / dfOper - msInt) / (p * n);
    const varPart = (ssPart / dfPart - msInt) / (o * n);
    const varGrr = varRepeat + varInt + varOper;
    const varTotal = varGrr + varPart;
    const components = [
      component('repeat', varRepeat, varTotal, studyVar, tol),
      component('reproducibility', varInt + varOper, varTotal, studyVar, tol),
      component('interaction', varInt, varTotal, studyVar, tol),
      component('operator', varOper, varTotal, studyVar, tol),
      component('partToPart', varPart, varTotal, studyVar, tol),
      component('grr', varGrr, varTotal, studyVar, tol),
      component('total', varTotal, varTotal, studyVar, tol),
    ];
    const sdPart = Math.sqrt(Math.max(0, varPart));
    const sdGrr = Math.sqrt(Math.max(0, varGrr));
    return {
      type,
      parts: p,
      operators: o,
      replicates: n,
      rows: rows.length,
      anova,
      components,
      grrVariance: varGrr,
      totalVariance: varTotal,
      studyVar,
      ndc: distinctCategories(varPart, varGrr) || Math.max(1, Math.floor(1.41 * (sdPart / Math.max(1e-12, sdGrr)))),
      note,
      negativeComponents: negativeOf({ repeat: varRepeat, reproducibility: varInt + varOper, operator: varOper, partToPart: varPart, grr: varGrr, total: varTotal }),
    };
  }

  // Nested: part is nested within operator.
  const opPartMeans = groupMean((r) => `${r.operator}\u0001${r.part}`);
  const opPartCounts = new Map<string, number>();
  rows.forEach((r) => {
    const key = `${r.operator}\u0001${r.part}`;
    opPartCounts.set(key, (opPartCounts.get(key) ?? 0) + 1);
  });
  const partsPerOp = new Map<string, Set<string>>();
  rows.forEach((r) => {
    const set = partsPerOp.get(r.operator) ?? new Set<string>();
    set.add(r.part);
    partsPerOp.set(r.operator, set);
  });
  const partsCount = [...partsPerOp.values()].map((set) => set.size);
  // Nested designs must be balanced for the ANOVA estimators below: the same
  // number of parts under every operator, the same replicate count in every
  // operator × part cell, and at least two replicates. Anything else is refused
  // explicitly — averaging the counts with Math.round would fabricate SS/df.
  const sharedParts = (() => {
    const owners = new Map<string, Set<string>>();
    rows.forEach((r) => {
      const set = owners.get(r.part) ?? new Set<string>();
      set.add(r.operator);
      owners.set(r.part, set);
    });
    return [...owners.values()].some((set) => set.size > 1);
  })();
  if (sharedParts) throw new Error('grr.nestedPartShared');
  const cellCountsList = [...opPartCounts.values()];
  const balancedNested = cellCountsList.length === o * Math.max(...partsCount, 1)
    && partsCount.every((c) => c === partsCount[0])
    && cellCountsList.every((c) => c === cellCountsList[0])
    && !sharedParts;
  if (!balancedNested) throw new Error('grr.unbalancedNested');
  const partsPerOperator = partsCount[0];
  const n = cellCountsList[0];
  if (!(n >= 2)) throw new Error('grr.needReplicates');
  const ssOper = partsPerOperator * n * operators.reduce((a, op) => a + ((opMeans.get(op)?.m ?? grand) - grand) ** 2, 0);
  let ssPartOp = 0;
  operators.forEach((op) => {
    const opMean = opMeans.get(op)?.m ?? grand;
    [...(partsPerOp.get(op) ?? [])].forEach((part) => {
      const cell = opPartMeans.get(`${op}\u0001${part}`);
      if (cell) ssPartOp += cell.n * (cell.m - opMean) ** 2;
    });
  });
  const ssRepeat = ssTotal - ssOper - ssPartOp;
  const dfOper = o - 1;
  const dfPartOp = o * (partsPerOperator - 1);
  const dfRepeat = rows.length - o * partsPerOperator;
  const msPartOp = ssPartOp / dfPartOp;
  const msRepeat = ssRepeat / Math.max(1, dfRepeat);
  const fOper = msPartOp > 0 ? (ssOper / dfOper) / msPartOp : NaN;
  const fPart = msRepeat > 0 ? msPartOp / msRepeat : NaN;
  const anova: AnovaRow[] = [
    { source: 'operator', df: dfOper, ss: ssOper, ms: ssOper / dfOper, f: fOper, p: isFinite(fOper) ? 1 - fCdf(fOper, dfOper, dfPartOp) : NaN },
    { source: 'partOperator', df: dfPartOp, ss: ssPartOp, ms: msPartOp, f: fPart, p: isFinite(fPart) ? 1 - fCdf(fPart, dfPartOp, dfRepeat) : NaN },
    { source: 'repeat', df: dfRepeat, ss: ssRepeat, ms: msRepeat, f: NaN, p: NaN },
    { source: 'total', df: rows.length - 1, ss: ssTotal, ms: NaN, f: NaN, p: NaN },
  ];
  const varRepeat = msRepeat;
  const varPart = (msPartOp - msRepeat) / n;
  const varOper = (ssOper / dfOper - msPartOp) / (partsPerOperator * n);
  const varGrr = varRepeat + varOper;
  const varTotal = varGrr + varPart;
  const components = [
    component('repeat', varRepeat, varTotal, studyVar, tol),
    component('reproducibility', varOper, varTotal, studyVar, tol),
    component('operator', varOper, varTotal, studyVar, tol),
    component('partToPart', varPart, varTotal, studyVar, tol),
    component('grr', varGrr, varTotal, studyVar, tol),
    component('total', varTotal, varTotal, studyVar, tol),
  ];
  const sdPart = Math.sqrt(Math.max(0, varPart));
  const sdGrr = Math.sqrt(Math.max(0, varGrr));
  return {
    type,
    parts: partsPerOperator,
    operators: o,
    replicates: n,
    rows: rows.length,
    anova,
    components,
    grrVariance: varGrr,
    totalVariance: varTotal,
    studyVar,
    ndc: distinctCategories(varPart, varGrr) || Math.max(1, Math.floor(1.41 * (sdPart / Math.max(1e-12, sdGrr)))),
    negativeComponents: negativeOf({ repeat: varRepeat, reproducibility: varOper, operator: varOper, partToPart: varPart, grr: varGrr, total: varTotal }),
  };
}

/** %Tolerance with an explicit tolerance width (USL − LSL). */
export function percentTolerance(result: GrrResult, tolerance: number): number {
  if (!(tolerance > 0)) return NaN;
  return ((result.studyVar * Math.sqrt(Math.max(0, result.grrVariance))) / tolerance) * 100;
}
