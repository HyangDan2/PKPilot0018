/* ─────────────────────────────────────────────────────────────────────────
   Sigrún QA adapter — runs the SHIPPED TypeScript engine (src/lib) from Node.

   It performs no statistical calculation of its own: every op below calls the
   same exported function the browser UI calls, normalises the result into a
   flat JSON record and tags NaN / ±Infinity / null explicitly so the Python
   comparator never mistakes "undefined" for a number.

   Usage (from the repo root, after `node qa/adapters/sigrun/build.mjs`):

     node qa/adapters/sigrun/.build/cli.mjs qa/_run/request.json qa/_run/adapter.json

   The request is {"datasetsDir": "...", "cases": [...]}; the response is
   {"meta": {...}, "results": {"<case id>": {...}}}.
   ───────────────────────────────────────────────────────────────────────── */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { adNormality, anovaOneWay, pairedT, regress, summarize, tTest1, tTest2, tukeyHSD, type Alt } from '../../../src/lib/stats';
import {
  cChart,
  imrChart,
  npChart,
  pChart,
  uChart,
  xbarRCharts,
  xbarSCharts,
  c4Constant,
  nelsonRules,
  SpcValidationError,
  type SpcPanel,
} from '../../../src/lib/spc';
import { capability } from '../../../src/lib/capability';
import { capabilitySixpack } from '../../../src/lib/sixpack';
import { fitNonnormal, nonnormalCapability, type NonnormalDist } from '../../../src/lib/nonnormal';
import { gageRR, type GrrRow } from '../../../src/lib/gagerr';
import { fitGlm, type ModelFactor, type ModelTerm } from '../../../src/lib/glm';
import { evaluateFormula } from '../../../src/lib/calc';
import { makeWorksheet } from '../../../src/lib/datasets';
import { defaultValues, findAnalysis, type RunContext } from '../../../src/lib/analyses';
import { boxplotStats, histogramBins, histogramCurve } from '../../../src/lib/charts';
import { createStoredModel, draftFromRsmPayload, type ModelVariable, type StoredModel, type StoredModelDraft } from '../../../src/lib/modelStore';
import { axisActualValue, compileSurfaceEvaluator, designFromActual, modelSurface, predictStoredModel } from '../../../src/lib/modelPredictor';
import { buildRsmModel } from '../../../src/lib/doe';
import { buildModelSurface } from '../../../src/lib/chartConfigOps';
import { buildOverlaid, type ResponseSpec } from '../../../src/lib/feasible';
import { optimize, defaultFactorSettings, evaluateCondition } from '../../../src/lib/optimizer';
import { errorBarFor } from '../../../src/lib/seriesStats';
import { createPredictionAdapter } from '../../../src/lib/predictionAdapter';
import { curveAxis, normaliseValue, profileCurves } from '../../../src/lib/profiler';
import { factorAxisValues, factorIssues, validateFactorValue, discreteValueAt } from '../../../src/lib/factorDomain';
import type { FactorSettings, ResponseSettings } from '../../../src/lib/optimizationTypes';
import type { Block, ChartSpec, Worksheet } from '../../../src/types';
import { analyzeFactorial, analyzeRsm, boxBehnkenDesign, ccdDesign, factorialDesign } from '../../../src/lib/doe';
import { fitWithPooling } from '../../../src/lib/errorPooling';
import { compareFits } from '../../../src/lib/modelComparison';
import { applyHierarchy, buildTermCatalog, termName, termId } from '../../../src/lib/modelTerms';
import { fitLognormalReliability, fitWeibull, type WeibullInput } from '../../../src/lib/reliability';
import { solvePower, type PowerMethod, type PowerSpec } from '../../../src/lib/power';
import {
  chi2Cdf,
  fCdf,
  fInv,
  gammaCdf,
  gammaInv,
  gammaP,
  logGamma,
  lognormalCdf,
  lognormalInv,
  ncfCdf,
  nctCdf,
  normalCdf,
  normalInv,
  normalPdf,
  rangeCdf,
  rangeInv,
  tCdf,
  tInv,
  weibullCdf,
  weibullInv,
} from '../../../src/lib/dist';

/* ── JSON encoding ───────────────────────────────────────────────────── */

type Json = number | string | boolean | null | { __special: string };

function enc(value: unknown): Json {
  if (value === null || value === undefined) return { __special: 'null' };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { __special: 'NaN' };
    if (value === Infinity) return { __special: 'Infinity' };
    if (value === -Infinity) return { __special: '-Infinity' };
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}

class Bag {
  values: Record<string, Json> = {};
  put(key: string, value: unknown): void {
    this.values[key] = enc(value);
  }
  putAll(prefix: string, record: Record<string, number>): void {
    Object.entries(record).forEach(([k, v]) => this.put(`${prefix}${k}`, v));
  }
  array(prefix: string, values: number[]): void {
    values.forEach((v, i) => this.put(`${prefix}[${i}]`, v));
  }
}

/* ── dataset access ──────────────────────────────────────────────────── */

interface Dataset {
  name: string;
  columns: Record<string, (number | string | null)[]>;
}

function loadDataset(dir: string, name: string): Dataset {
  const raw = JSON.parse(readFileSync(`${dir}/${name}.json`, 'utf8')) as Dataset;
  return raw;
}

const nums = (ds: Dataset, column: string): number[] =>
  (ds.columns[column] ?? []).map((v) => (typeof v === 'number' ? v : NaN));

const rawNums = (ds: Dataset, column: string): (number | null)[] =>
  (ds.columns[column] ?? []).map((v) => (typeof v === 'number' ? v : null));

const texts = (ds: Dataset, column: string): (string | null)[] =>
  (ds.columns[column] ?? []).map((v) => (v === null || v === undefined ? null : String(v)));

/** A Worksheet whose columns mirror a QA dataset (ids C1…Cn in file order). */
function sheetFromDataset(ds: Dataset): Worksheet {
  const columns = Object.entries(ds.columns).map(([name, values]) => ({
    name,
    type: values.every((v) => typeof v === 'number' || v === null) ? ('numeric' as const) : ('text' as const),
    values: values as (number | string | null)[],
  }));
  return makeWorksheet(ds.name || 'QA', columns);
}

function panel(bag: Bag, prefix: string, p: SpcPanel): void {
  bag.put(`${prefix}.center`, p.center);
  if (Array.isArray(p.ucl)) bag.array(`${prefix}.ucl`, p.ucl);
  else bag.put(`${prefix}.ucl`, p.ucl);
  if (Array.isArray(p.lcl)) bag.array(`${prefix}.lcl`, p.lcl);
  else bag.put(`${prefix}.lcl`, p.lcl);
  if (Array.isArray(p.sigma)) bag.array(`${prefix}.sigma`, p.sigma);
  else bag.put(`${prefix}.sigma`, p.sigma);
  bag.array(`${prefix}.points`, p.points);
  const byRule: Record<number, number> = {};
  p.violations.forEach((v) => v.rules.forEach((r) => { byRule[r] = (byRule[r] ?? 0) + 1; }));
  for (let r = 1; r <= 8; r += 1) bag.put(`${prefix}.rule${r}_points`, byRule[r] ?? 0);
}

/* ── group helpers ───────────────────────────────────────────────────── */

function groupValues(values: (number | null)[], keys: (string | null)[]): { label: string; values: number[] }[] {
  const order: string[] = [];
  const map = new Map<string, number[]>();
  for (let i = 0; i < values.length; i += 1) {
    const key = keys[i];
    if (key === null || key === undefined || key === '') continue;
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    (map.get(key) as number[]).push(v);
  }
  return order.map((label) => ({ label, values: map.get(label) as number[] }));
}

/* ── ops ─────────────────────────────────────────────────────────────── */

type Op = (bag: Bag, ds: Dataset, args: Record<string, any>) => void;

/** A quadratic response fit stored exactly the way the Model Manager stores it. */
function storedQuadratic(ds: Dataset, response: string, factors: string[]): StoredModel {
  const sheet = sheetFromDataset(ds);
  const modelFactors: ModelFactor[] = factors.map((name) => ({ name, kind: 'numeric' as const, values: rawNums(ds, name) }));
  const analysis = analyzeRsm(rawNums(ds, response), modelFactors);
  const payload = buildRsmModel(analysis.glm, modelFactors as never, analysis.stationary);
  return createStoredModel(
    draftFromRsmPayload(payload, {
      response: { id: response, name: response },
      sheet,
      analysisId: 'rsmanalyze',
    }),
    response,
  );
}

/** A stored model built from an explicit coefficient/covariance spec (QA cases). */
function modelFromSpec(raw: Record<string, unknown>): StoredModel {
  const spec = raw as {
    kind?: StoredModel['kind'];
    response?: string;
    predictors: ModelVariable[];
    terms?: { label: string; factors: string[] }[];
    coefficients: { label: string; value: number; se?: number; estimable?: boolean }[];
    covariance?: number[][] | null;
    residual?: { mse?: number; df?: number; s?: number } | null;
    nonEstimable?: string[];
    factorBounds?: Record<string, { min: number; max: number }> | null;
  };
  const nonEstimable = new Set(spec.nonEstimable ?? []);
  const draft: StoredModelDraft = {
    format: 'sigrun-model',
    version: 1,
    kind: spec.kind ?? 'multiple',
    response: { id: '', name: spec.response ?? 'Y', kind: 'numeric' },
    predictors: spec.predictors,
    terms: spec.terms ?? [],
    coefficients: spec.coefficients.map((coefficient) => ({
      label: coefficient.label,
      value: coefficient.value,
      ...(coefficient.se !== undefined ? { se: coefficient.se } : {}),
      estimable: coefficient.estimable ?? !nonEstimable.has(coefficient.label),
    })),
    covariance: spec.covariance ?? null,
    residual: spec.residual ?? null,
    dof: null,
    factorBounds: spec.factorBounds ?? null,
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
  return createStoredModel(draft, 'qa');
}

/** The coded centre of a stored quadratic (design values 0 for every factor). */
function centrePoint(model: StoredModel): Record<string, number> {
  const point: Record<string, number> = {};
  model.predictors.forEach((predictor) => {
    if (predictor.kind !== 'numeric') return;
    point[predictor.name] = predictor.coding?.mode === 'coded'
      ? predictor.coding.center
      : 0;
  });
  return point;
}


/** Decode a JSON-safe special number marker ({__special: 'NaN'}) back to a number. */
function decodeSpecial(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeSpecial);
  if (value && typeof value === 'object' && '__special' in (value as Record<string, unknown>)) {
    const marker = (value as Record<string, unknown>).__special;
    if (marker === 'NaN') return Number.NaN;
    if (marker === 'Infinity') return Number.POSITIVE_INFINITY;
    if (marker === '-Infinity') return Number.NEGATIVE_INFINITY;
    return null;
  }
  return value;
}

/** Build a StoredModel from a case's record (no fitting involved). */
function storedFromJson(spec: Record<string, any>): StoredModel {
  return {
    format: 'sigrun-model',
    version: 1,
    id: String(spec.id),
    name: String(spec.name),
    kind: 'rsm',
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    response: { id: 'R', name: String(spec.response ?? spec.name), kind: 'numeric' },
    predictors: (spec.predictors as Record<string, any>[]).map((predictor) => ({
      id: String(predictor.id ?? ''),
      name: String(predictor.name),
      kind: predictor.kind === 'categorical' ? 'categorical' : 'numeric',
      ...(predictor.unit ? { unit: String(predictor.unit) } : {}),
      ...(predictor.coding ? { coding: predictor.coding } : {}),
      ...(predictor.levels ? { levels: predictor.levels } : {}),
    })),
    terms: [],
    coefficients: (spec.coefficients as Record<string, any>[]).map((coefficient) => ({
      label: String(coefficient.label),
      value: Number(coefficient.value),
      estimable: coefficient.estimable !== false,
    })),
    covariance: (decodeSpecial(spec.covariance ?? null) as number[][] | null),
    residual: spec.residual ?? null,
    dof: spec.dof ?? null,
    factorBounds: spec.factorBounds ?? null,
    categoricalLevels: null,
    training: null,
    diagnostics: {},
    source: {},
  };
}

const alt = (v: unknown): Alt => (v === 'less' || v === 'greater' ? v : 'two-sided');

const ops: Record<string, Op> = {
  desc(bag, ds, args) {
    const s = summarize(rawNums(ds, args.column));
    bag.put('n', s.n);
    bag.put('n_star', s.nStar);
    bag.put('sum', s.sum);
    bag.put('mean', s.mean);
    bag.put('se_mean', s.seMean);
    bag.put('stdev', s.stdev);
    bag.put('variance', s.variance);
    bag.put('coef_var', s.coefVar);
    bag.put('min', s.min);
    bag.put('q1', s.q1);
    bag.put('median', s.median);
    bag.put('q3', s.q3);
    bag.put('max', s.max);
    bag.put('iqr', s.iqr);
    bag.put('range', s.range);
    bag.put('skewness', s.skewness);
    bag.put('kurtosis', s.kurtosis);
  },

  normality(bag, ds, args) {
    const r = adNormality(rawNums(ds, args.column));
    bag.put('n', r.n);
    bag.put('mean', r.mean);
    bag.put('sd', r.sd);
    bag.put('ad', r.ad);
    bag.put('ad_adjusted', r.adAdj);
    bag.put('p', r.p);
  },

  t1(bag, ds, args) {
    const r = tTest1(rawNums(ds, args.column), args.mu0 ?? 0, args.conf ?? 0.95, alt(args.alt));
    bag.put('mean', r.mean);
    bag.put('difference', r.difference);
    bag.put('se', r.se);
    bag.put('df', r.df);
    bag.put('t', r.t);
    bag.put('p', r.p);
    bag.put('ci_low', r.ci[0]);
    bag.put('ci_high', r.ci[1]);
    bag.put('n', r.n);
    bag.put('stdev', r.stdev);
  },

  t2(bag, ds, args) {
    const r = tTest2(rawNums(ds, args.column), rawNums(ds, args.column2), {
      welch: args.welch ?? true,
      conf: args.conf ?? 0.95,
      alt: alt(args.alt),
    });
    bag.put('mean', r.mean);
    bag.put('mean_b', r.meanB);
    bag.put('difference', r.difference);
    bag.put('se', r.se);
    bag.put('df', r.df);
    bag.put('t', r.t);
    bag.put('p', r.p);
    bag.put('ci_low', r.ci[0]);
    bag.put('ci_high', r.ci[1]);
    bag.put('n', r.n);
    bag.put('n_b', r.nB);
    bag.put('stdev', r.stdev);
    bag.put('stdev_b', r.stdevB);
    bag.put('f', r.varianceTest?.f);
    bag.put('f_p', r.varianceTest?.p);
  },

  paired(bag, ds, args) {
    const r = pairedT(rawNums(ds, args.column), rawNums(ds, args.column2), args.mu0 ?? 0, args.conf ?? 0.95, alt(args.alt));
    bag.put('mean', r.mean);
    bag.put('mean_b', r.meanB);
    bag.put('difference', r.difference);
    bag.put('difference_vs_mu0', r.differenceVsMu0);
    bag.put('se', r.se);
    bag.put('df', r.df);
    bag.put('t', r.t);
    bag.put('p', r.p);
    bag.put('ci_low', r.ci[0]);
    bag.put('ci_high', r.ci[1]);
    bag.put('n', r.n);
    bag.put('stdev', r.stdev);
  },

  anova(bag, ds, args) {
    const groups = groupValues(rawNums(ds, args.response), texts(ds, args.factor));
    const table = anovaOneWay(groups);
    bag.put('df_between', table.dfBetween);
    bag.put('df_within', table.dfWithin);
    bag.put('ss_between', table.ssBetween);
    bag.put('ss_within', table.ssWithin);
    bag.put('ms_between', table.msBetween);
    bag.put('ms_within', table.msWithin);
    bag.put('f', table.f);
    bag.put('p', table.p);
    bag.put('s_pooled', table.sPooled);
    const tukey = tukeyHSD(table, args.conf ?? 0.95);
    bag.put('tukey_q', tukey.q);
    tukey.pairs.forEach((pair) => {
      const key = `tukey:${pair.a}|${pair.b}`;
      bag.put(`${key}:diff`, pair.diff);
      bag.put(`${key}:se`, pair.se);
      bag.put(`${key}:ci_low`, pair.ciLow);
      bag.put(`${key}:ci_high`, pair.ciHigh);
      bag.put(`${key}:p`, pair.p);
      bag.put(`${key}:significant`, pair.significant ? 1 : 0);
    });
  },

  regression(bag, ds, args) {
    const predictors = (args.predictors as string[]).map((name) => ({ name, values: rawNums(ds, name) }));
    const r = regress(rawNums(ds, args.response), predictors, args.response);
    r.coefficients.forEach((c) => {
      bag.put(`coef:${c.term}`, c.coef);
      bag.put(`se:${c.term}`, c.se);
      bag.put(`t:${c.term}`, c.t);
      bag.put(`p:${c.term}`, c.p);
      if (!Number.isNaN(c.vif)) bag.put(`vif:${c.term}`, c.vif);
    });
    bag.put('r2', r.r2);
    bag.put('r2_adj', r.r2adj);
    bag.put('r2_pred', r.r2pred);
    bag.put('s', r.s);
    bag.put('n', r.n);
    bag.put('df_reg', r.anova.dfReg);
    bag.put('df_err', r.anova.dfErr);
    bag.put('ss_reg', r.anova.ssReg);
    bag.put('ss_err', r.anova.ssErr);
    bag.put('f', r.anova.f);
    bag.put('p', r.anova.p);
  },

  imr(bag, ds, args) {
    const r = imrChart(nums(ds, args.column));
    panel(bag, 'i', r.panels[0]);
    panel(bag, 'mr', r.panels[1]);
    bag.put('sigma_within', r.sigmaWithin);
    bag.put('out_of_control', r.outOfControl);
  },

  xbarr(bag, ds, args) {
    const r = xbarRCharts(rawNums(ds, args.column), args.subgroup ?? 5);
    panel(bag, 'xbar', r.panels[0]);
    panel(bag, 'r', r.panels[1]);
    bag.put('sigma_within', r.sigmaWithin);
    bag.put('out_of_control', r.outOfControl);
    bag.put('sg_size', r.subgroupSummary?.size);
    bag.put('sg_total', r.subgroupSummary?.total);
    bag.put('sg_used', r.subgroupSummary?.used);
    bag.put('sg_skipped', r.subgroupSummary?.skipped);
    bag.put('sg_leftover', r.subgroupSummary?.leftoverRows);
    bag.put('sg_missing', r.subgroupSummary?.missingSubgroups);
    bag.put('sg_varying', r.subgroupSummary?.varying ? 1 : 0);
  },

  xbars(bag, ds, args) {
    const r = args.groupIds
      ? xbarSCharts(rawNums(ds, args.column), { groupIds: texts(ds, args.groupIds) })
      : xbarSCharts(rawNums(ds, args.column), { size: args.subgroup ?? 5 });
    panel(bag, 'xbar', r.panels[0]);
    panel(bag, 's', r.panels[1]);
    bag.put('sigma_within', r.sigmaWithin);
    bag.put('out_of_control', r.outOfControl);
    bag.put('sg_used', r.subgroupSummary?.used);
    bag.put('sg_skipped', r.subgroupSummary?.skipped);
  },

  pchart(bag, ds, args) {
    const defects = nums(ds, args.column);
    const sizes = args.sizesColumn ? nums(ds, args.sizesColumn) : defects.map(() => args.sampleSize ?? 100);
    const r = pChart(defects, sizes);
    panel(bag, 'p', r.panels[0]);
    bag.put('sigma_within', r.sigmaWithin);
    bag.put('out_of_control', r.outOfControl);
  },

  npchart(bag, ds, args) {
    const r = npChart(nums(ds, args.column), args.sampleSize ?? 100);
    panel(bag, 'np', r.panels[0]);
    bag.put('out_of_control', r.outOfControl);
  },

  cchart(bag, ds, args) {
    const r = cChart(nums(ds, args.column));
    panel(bag, 'c', r.panels[0]);
    bag.put('out_of_control', r.outOfControl);
  },

  uchart(bag, ds, args) {
    const defects = nums(ds, args.column);
    const units = args.unitsColumn ? nums(ds, args.unitsColumn) : defects.map(() => args.unitSize ?? 1);
    const r = uChart(defects, units);
    panel(bag, 'u', r.panels[0]);
    bag.put('sigma_within', r.sigmaWithin);
    bag.put('out_of_control', r.outOfControl);
  },

  capability(bag, ds, args) {
    const r = capability(rawNums(ds, args.column), {
      lsl: args.lsl ?? null,
      usl: args.usl ?? null,
      target: args.target ?? null,
      subgroup: args.subgroup ?? 1,
      sigmaMethod: args.sigmaMethod ?? 'z_bench_shift',
    });
    bag.put('n', r.n);
    bag.put('mean', r.mean);
    bag.put('sd_within', r.sdWithin);
    bag.put('sd_overall', r.sdOverall);
    bag.put('cp', r.cp);
    bag.put('cpk', r.cpk);
    bag.put('cpl', r.cpl);
    bag.put('cpu', r.cpu);
    bag.put('pp', r.pp);
    bag.put('ppk', r.ppk);
    bag.put('ppl', r.ppl);
    bag.put('ppu', r.ppu);
    bag.put('cpm', r.cpm);
    bag.put('ppm_within', r.ppmWithin);
    bag.put('ppm_overall', r.ppmOverall);
    bag.put('ppm_observed', r.ppmObserved);
    bag.put('sigma_level', r.sigmaLevel);
  },

  sixpack(bag, ds, args) {
    const r = capabilitySixpack(rawNums(ds, args.column), {
      subgroup: args.subgroup ?? 1,
      lsl: args.lsl ?? null,
      usl: args.usl ?? null,
      target: args.target ?? null,
      sigmaMethod: args.sigmaMethod ?? 'z_bench_shift',
      lastCount: args.lastCount ?? 25,
    });
    bag.put('chart', r.chart);
    bag.put('sigma_basis', r.sigmaBasis);
    bag.put('subgroup', r.subgroup);
    bag.put('sigma_within', r.sigmaWithin);
    bag.put('sigma_overall', r.sigmaOverall);
    bag.put('cp', r.capability.cp);
    bag.put('cpk', r.capability.cpk);
    bag.put('pp', r.capability.pp);
    bag.put('ppk', r.capability.ppk);
    bag.put('ppm_within', r.capability.ppmWithin);
    bag.put('ppm_overall', r.capability.ppmOverall);
    bag.put('ad', r.ad.ad);
    bag.put('ad_adjusted', r.ad.adAdj);
    bag.put('ad_p', r.ad.p);
    panel(bag, 'primary', r.primary);
    panel(bag, 'secondary', r.secondary);
    bag.put('missing_subgroups', r.missingSubgroups);
    bag.put('says_within', r.says.within);
    bag.put('says_overall', r.says.overall);
  },

  capnonnormal(bag, ds, args) {
    const dist = (args.distribution ?? 'weibull') as NonnormalDist;
    if (args.specs === false) {
      const fit = fitNonnormal(rawNums(ds, args.column), dist);
      bag.put('n', fit.n);
      bag.put('excluded', fit.excluded);
      bag.put('shape', fit.params.shape);
      bag.put('scale', fit.params.scale);
      bag.put('loglik', fit.params.logLik);
      bag.put('ad', fit.ad);
      bag.put('ad_adjusted', fit.adAdjusted);
      bag.put('crit10', fit.critical[0]);
      bag.put('crit5', fit.critical[1]);
      bag.put('crit1', fit.critical[2]);
      return;
    }
    const r = nonnormalCapability(rawNums(ds, args.column), dist, {
      lsl: args.lsl ?? null,
      usl: args.usl ?? null,
      target: args.target ?? null,
    });
    bag.put('n', r.n);
    bag.put('excluded', r.excluded);
    bag.put('shape', r.fit.params.shape);
    bag.put('scale', r.fit.params.scale);
    bag.put('loglik', r.fit.params.logLik);
    bag.put('ad', r.fit.ad);
    bag.put('ad_adjusted', r.fit.adAdjusted);
    bag.put('median', r.median);
    bag.put('p00135', r.p00135);
    bag.put('p99865', r.p99865);
    bag.put('pp', r.pp);
    bag.put('ppk', r.ppk);
    bag.put('ppu', r.ppu);
    bag.put('ppl', r.ppl);
    bag.put('ppm', r.ppm);
    bag.put('observed_ppm', r.observedPpm);
  },

  gagerr(bag, ds, args) {
    const rows: GrrRow[] = [];
    const parts = texts(ds, args.part);
    const operators = texts(ds, args.operator);
    const measurements = rawNums(ds, args.measurement);
    for (let i = 0; i < measurements.length; i += 1) {
      const m = measurements[i];
      if (m === null || !Number.isFinite(m)) continue;
      rows.push({ part: String(parts[i] ?? ''), operator: String(operators[i] ?? ''), measurement: m });
    }
    const r = gageRR(rows, args.type ?? 'crossed', {
      tolerance: args.tolerance,
      studyVar: args.studyVar ?? 6,
      poolInteraction: args.poolInteraction ?? false,
      alpha: args.alpha ?? 0.05,
    });
    bag.put('parts', r.parts);
    bag.put('operators', r.operators);
    bag.put('replicates', r.replicates);
    bag.put('grr_variance', r.grrVariance);
    bag.put('total_variance', r.totalVariance);
    bag.put('ndc', r.ndc);
    r.anova.forEach((row) => {
      bag.put(`anova:${row.source}:df`, row.df);
      bag.put(`anova:${row.source}:ss`, row.ss);
      bag.put(`anova:${row.source}:ms`, row.ms);
      bag.put(`anova:${row.source}:f`, row.f);
      bag.put(`anova:${row.source}:p`, row.p);
    });
    r.components.forEach((c) => {
      bag.put(`comp:${c.name}:variance`, c.variance);
      bag.put(`comp:${c.name}:stdev`, c.stdev);
      bag.put(`comp:${c.name}:contribution`, c.contribution);
      bag.put(`comp:${c.name}:studyvar`, c.studyVar);
      bag.put(`comp:${c.name}:tolerance`, c.tolerance);
    });
    bag.put('note', r.note ?? '');
    bag.put('negative_components', r.negativeComponents.join(','));
  },

  weibull(bag, ds, args) {
    const rows: WeibullInput[] = [];
    const times = rawNums(ds, args.column);
    const censColumn = args.censorColumn ? rawNums(ds, args.censorColumn) : null;
    const censoredIsOne = args.censorCode !== '0=censored';
    for (let i = 0; i < times.length; i += 1) {
      const t = times[i];
      if (t === null || !Number.isFinite(t) || t <= 0) continue;
      let censored = false;
      if (censColumn) {
        const raw = censColumn[i];
        if (raw === null || !Number.isFinite(raw)) continue;
        censored = censoredIsOne ? raw === 1 : raw === 0;
      }
      rows.push({ time: t, censored });
    }
    const r = fitWeibull(rows, args.conf ?? 0.95);
    bag.put('shape', r.shape);
    bag.put('scale', r.scale);
    bag.put('se_shape', r.seShape);
    bag.put('se_scale', r.seScale);
    bag.put('ci_shape_low', r.ciShape[0]);
    bag.put('ci_shape_high', r.ciShape[1]);
    bag.put('ci_scale_low', r.ciScale[0]);
    bag.put('ci_scale_high', r.ciScale[1]);
    bag.put('loglik', r.logLik);
    bag.put('mttf', r.mttf);
    bag.put('mttf_low', r.mttfCi[0]);
    bag.put('mttf_high', r.mttfCi[1]);
    bag.put('median', r.median);
    bag.put('b10', r.b10);
    bag.put('b5', r.b5);
    bag.put('b90', r.b90);
    bag.put('n', r.n);
    bag.put('failures', r.failures);
    bag.put('censored', r.censored);
    bag.put('ad', r.ad);
    bag.put('ad_adjusted', r.adAdjusted);
    bag.put('ad_basis', r.adBasis);
    bag.put('ad_bootstrap_p', r.adBootstrapP);
    bag.put('ad_bootstrap_reps', r.adBootstrapReps);
    bag.put('km_dev', r.kmDev);
    bag.put('km_critical05', r.kmCritical05);
  },

  lognorm_rel(bag, ds, args) {
    const rows: WeibullInput[] = [];
    const times = rawNums(ds, args.column);
    const censColumn = args.censorColumn ? rawNums(ds, args.censorColumn) : null;
    for (let i = 0; i < times.length; i += 1) {
      const t = times[i];
      if (t === null || !Number.isFinite(t) || t <= 0) continue;
      let censored = false;
      if (censColumn) {
        const raw = censColumn[i];
        if (raw === null || !Number.isFinite(raw)) continue;
        censored = raw === 1;
      }
      rows.push({ time: t, censored });
    }
    const r = fitLognormalReliability(rows, args.conf ?? 0.95);
    bag.put('mu', r.mu);
    bag.put('sigma', r.sigma);
    bag.put('median', r.median);
    bag.put('mttf', r.mttf);
    bag.put('loglik', r.logLik);
    bag.put('n', r.n);
    bag.put('failures', r.failures);
    bag.put('censored', r.censored);
    bag.put('se_mu', r.seMu);
    bag.put('se_sigma', r.seSigma);
    bag.put('closed_form', r.closedForm ? 1 : 0);
  },

  glm(bag, ds, args) {
    const factors: ModelFactor[] = (args.factors as { name: string; column: string; kind: 'categorical' | 'numeric' }[])
      .map((f) => ({
        name: f.name,
        kind: f.kind,
        values: f.kind === 'numeric' ? rawNums(ds, f.column) : texts(ds, f.column),
      }));
    const terms: ModelTerm[] = (args.terms as string[][]).map((names) => ({ name: names.join('×'), factors: names }));
    const r = fitGlm(rawNums(ds, args.response), factors, terms);
    bag.put('n', r.n);
    bag.put('dfe', r.dfe);
    bag.put('sse', r.sse);
    bag.put('mse', r.mse);
    bag.put('s', r.s);
    bag.put('ss_total', r.ssTotal);
    bag.put('ss_model', r.ssModel);
    bag.put('r2', r.r2);
    bag.put('r2_adj', r.r2adj);
    bag.put('rank', r.rank);
    r.terms.forEach((t) => {
      bag.put(`term:${t.name}:df`, t.df);
      bag.put(`term:${t.name}:ss_seq`, t.ssSeq);
      bag.put(`term:${t.name}:ss_adj`, t.ssAdj);
      bag.put(`term:${t.name}:ms_adj`, t.msAdj);
      bag.put(`term:${t.name}:f`, t.f);
      bag.put(`term:${t.name}:p`, t.p);
    });
    bag.put('aliased', r.aliased.join(','));
    bag.put('aliased_count', r.aliased.length);
    // Fitted values and residuals are invariant across generalised inverses:
    // every least-squares solution projects y onto the same column space, so
    // they identify a rank-deficient fit where term-level SS cannot.
    r.fitted.forEach((v, i) => bag.put(`fitted[${i}]`, v));
    r.residuals.forEach((v, i) => bag.put(`residuals[${i}]`, v));
  },

  doecreate(bag, ds, args) {
    const design = args.design ?? 'factorial';
    const runs = design === 'ccd'
      ? ccdDesign(args.k ?? 2, args.centers ?? 5, args.randomize ?? true, args.seed ?? 20261122, args.alpha)
      : design === 'bbd'
        ? boxBehnkenDesign(args.centers ?? 3, args.randomize ?? true, args.seed ?? 20261122)
        : factorialDesign(args.k ?? 3, args.centers ?? 0, args.replicates ?? 1, args.randomize ?? true, args.seed ?? 20261122);
    bag.put('runs', runs.length);
    runs.forEach((run, i) => {
      bag.put(`run[${i}]:std`, run.std);
      bag.put(`run[${i}]:run`, run.run);
      run.levels.forEach((v, j) => bag.put(`run[${i}]:f${j}`, v));
    });
    const types: Record<string, number> = {};
    runs.forEach((r) => { types[r.ptType] = (types[r.ptType] ?? 0) + 1; });
    Object.entries(types).forEach(([k, v]) => bag.put(`ptype:${k}`, v));
  },

  doeanalyze(bag, ds, args) {
    const factors: ModelFactor[] = (args.factors as string[]).map((name) => ({
      name,
      kind: 'numeric',
      values: rawNums(ds, name),
    }));
    const r = analyzeFactorial(rawNums(ds, args.response), factors, args.order ?? 2);
    r.effects.forEach((e) => {
      bag.put(`effect:${e.term}`, e.effect);
      bag.put(`coef:${e.term}`, e.coef);
      bag.put(`se:${e.term}`, e.se);
      bag.put(`t:${e.term}`, e.t);
      bag.put(`p:${e.term}`, e.p);
    });
    bag.put('sse', r.glm.sse);
    bag.put('dfe', r.glm.dfe);
    bag.put('r2', r.glm.r2);
    bag.put('r2_adj', r.glm.r2adj);
    bag.put('s', r.glm.s);
  },

  rsmcreate(bag, ds, args) {
    const runs = args.design === 'bbd'
      ? boxBehnkenDesign(args.centers ?? 3, args.randomize ?? true, args.seed ?? 20261122)
      : ccdDesign(args.k ?? 2, args.centers ?? 5, args.randomize ?? true, args.seed ?? 20261122, args.alpha);
    bag.put('runs', runs.length);
    const types: Record<string, number> = {};
    runs.forEach((run, i) => {
      bag.put(`run[${i}]:std`, run.std);
      bag.put(`run[${i}]:run`, run.run);
      run.levels.forEach((v, j) => bag.put(`run[${i}]:f${j}`, v));
      types[run.ptType] = (types[run.ptType] ?? 0) + 1;
    });
    Object.entries(types).forEach(([k, v]) => bag.put(`ptype:${k}`, v));
  },

  rsmanalyze(bag, ds, args) {
    const factors: ModelFactor[] = (args.factors as string[]).map((name) => ({
      name,
      kind: 'numeric',
      values: rawNums(ds, name),
    }));
    const r = analyzeRsm(rawNums(ds, args.response), factors, { alpha: args.alpha });
    bag.put('linear:df', r.linear.df);
    bag.put('linear:ss', r.linear.ss);
    bag.put('square:df', r.square.df);
    bag.put('square:ss', r.square.ss);
    bag.put('interaction:df', r.interaction.df);
    bag.put('interaction:ss', r.interaction.ss);
    if (r.pureError) {
      bag.put('pure:df', r.pureError.df);
      bag.put('pure:ss', r.pureError.ss);
      bag.put('pure:ms', r.pureError.ms);
    }
    if (r.lackOfFit) {
      bag.put('lof:df', r.lackOfFit.df);
      bag.put('lof:ss', r.lackOfFit.ss);
      bag.put('lof:ms', r.lackOfFit.ms);
      bag.put('lof:f', r.lackOfFit.f);
      bag.put('lof:p', r.lackOfFit.p);
    }
    r.quadratic.forEach((q) => bag.put(`qcoef:${q.name}`, q.coef));
    bag.put('sse', r.glm.sse);
    bag.put('dfe', r.glm.dfe);
    bag.put('r2', r.glm.r2);
    if (r.stationary) {
      r.stationary.point.forEach((v, i) => bag.put(`stationary:x${i}`, v));
      bag.put('stationary:response', r.stationary.response);
      r.stationary.eigenvalues.forEach((v, i) => bag.put(`stationary:eigen${i}`, v));
      bag.put('stationary:kind', r.stationary.kind);
      bag.put('stationary:max_abs', r.stationary.maxAbs);
      bag.put('stationary:outside', r.stationary.outsideRegion ? 1 : 0);
    }
  },

  /**
   * Stage 3B — the 3D surface and the 2D contour must state the same number.
   *
   * The adapter fits the quadratic through the shipped engine, stores it the
   * way the Model Manager does, and then evaluates the SAME grid twice: once
   * through the compiled surface evaluator and once through `modelSurface`
   * (row-by-row design construction). `surface_contour_max_diff` is therefore
   * a measurement of the engine against itself, and the reference puts 0 there
   * to assert the two paths agree.
   */
  surface3d(bag, ds, args) {
    const model = storedQuadratic(ds, args.response, args.factors);
    const resolution = args.resolution ?? 21;
    const mode = (args.mode ?? 'actual') as 'actual' | 'coded';
    // The grid interval is part of the case: both engines must evaluate the
    // identical rectangle, not two "default" interpretations of it.
    const xIndex = args.xIndex ?? 0;
    const yIndex = args.yIndex ?? 1;
    const factorRanges = args.factorRanges ?? (args.xRange && args.yRange
      ? { [xIndex]: { min: args.xRange[0], max: args.xRange[1] }, [yIndex]: { min: args.yRange[0], max: args.yRange[1] } }
      : {});
    const surface = buildModelSurface(model, {
      xIndex,
      yIndex,
      unitMode: mode,
      resolution,
      holdings: args.holdings ?? {},
      factorRanges,
    });
    const contour = modelSurface(model, {
      xName: surface.xName,
      yName: surface.yName,
      mode,
      resolution,
      xRange: surface.xRange,
      yRange: surface.yRange,
      ...(args.holdings ? { holdings: args.holdings } : {}),
    });
    let maxDiff = 0;
    for (let j = 0; j < surface.z.length; j += 1) {
      for (let i = 0; i < surface.z[j].length; i += 1) {
        const a = surface.z[j][i];
        const b = contour.z[j][i];
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        maxDiff = Math.max(maxDiff, Math.abs(a - b));
      }
    }
    const flat = surface.z.flat().filter((value) => Number.isFinite(value));
    bag.put('surface_contour_max_diff', maxDiff);
    bag.put('grid_points', surface.xs.length);
    bag.put('z_min', flat.length ? Math.min(...flat) : Number.NaN);
    bag.put('z_max', flat.length ? Math.max(...flat) : Number.NaN);
    bag.put('x_min', surface.xRange[0]);
    bag.put('x_max', surface.xRange[1]);
    bag.put('y_min', surface.yRange[0]);
    bag.put('y_max', surface.yRange[1]);
    (args.probes ?? []).forEach((probe: [number, number], index: number) => {
      const [i, j] = probe;
      bag.put(`z[${index}]`, surface.z[j]?.[i]);
      bag.put(`z_contour[${index}]`, contour.z[j]?.[i]);
    });
    bag.put('coefficient_count', model.coefficients.length);
    const centre = predictStoredModel(model, centrePoint(model), { mode });
    bag.put('centre_value', centre.value);
    bag.put('centre_se', centre.se);
  },

  /**
   * Stage 3B — several responses judged on one grid.
   *
   * Every response is fitted independently, evaluated at the same (x, y), and
   * the joint mask is the AND of the per-response masks. `feasible_nodes` and
   * the probe flags are exact integers: the reference recomputes the same grid
   * from its own fit.
   */
  feasible(bag, ds, args) {
    const specsInput = args.responses as { name: string; lsl: number | null; usl: number | null; target: number | null }[];
    const models = specsInput.map((entry) => storedQuadratic(ds, entry.name, args.factors));
    const specs: ResponseSpec[] = specsInput.map((entry, index) => ({
      model: models[index],
      lsl: entry.lsl ?? null,
      usl: entry.usl ?? null,
      target: entry.target ?? null,
    }));
    const resolution = args.resolution ?? 21;
    const basis = (args.basis ?? 'mean') as 'mean' | 'confidence' | 'prediction';
    const result = buildOverlaid(models, specs, {
      xName: args.x,
      yName: args.y,
      xRange: args.xRange,
      yRange: args.yRange,
      resolution,
      mode: (args.mode ?? 'actual') as 'actual' | 'coded',
      basis,
      alpha: args.alpha ?? 0.05,
    });
    bag.put('feasible_nodes', result.feasibleNodes);
    bag.put('total_nodes', result.totalNodes);
    bag.put('node_ratio', result.nodeRatio);
    bag.put('area_ratio', result.areaRatio);
    bag.put('interval_blocked', result.intervalBlocked.join('|'));
    bag.put('convergence_delta', result.convergenceDelta);
    bag.put('narrow', result.narrowWarning ? 1 : 0);
    result.responses.forEach((response, index) => {
      bag.put(`response_${index}_node_ratio`, response.nodeRatio);
      bag.put(`response_${index}_area_ratio`, response.areaRatio);
    });
    const probes = (args.probes ?? []) as [number, number][];
    bag.put('probe_feasible', probes.map(([i, j]) => (result.feasible[j]?.[i] === 1 ? 1 : 0)).join(','));
    probes.forEach(([i, j], index) => {
      result.responses.forEach((response, r) => {
        bag.put(`z_${r}[${index}]`, response.z[j]?.[i]);
      });
    });
    bag.put('x_min', result.xs[0]);
    bag.put('x_max', result.xs[result.xs.length - 1]);
    bag.put('y_min', result.ys[0]);
    bag.put('y_max', result.ys[result.ys.length - 1]);
  },

  /**
   * QA-V (corrective): an overlay from explicit stored-model records.
   *
   * The models arrive as JSON (coding, coefficients, covariance, bounds) so
   * the case can state exactly the defect it probes — a missing covariance, a
   * different centre, an aliased term — which no single fitted dataset can.
   * Every number below is produced by the SHIPPED engine.
   */
  overlay(bag, _ds, args) {
    const models = (args.models as Record<string, any>[]).map((entry) => storedFromJson(entry));
    const responses = (args.responses as { name: string; lsl: number | null; usl: number | null; target: number | null }[] | undefined) ?? [];
    const specs: ResponseSpec[] = models.map((model, index) => ({
      model,
      modelId: model.id,
      lsl: responses[index]?.lsl ?? null,
      usl: responses[index]?.usl ?? null,
      target: responses[index]?.target ?? null,
    }));
    const result = buildOverlaid(models, specs, {
      xName: args.xName,
      yName: args.yName,
      holdings: args.holdings,
      xRange: args.xRange,
      yRange: args.yRange,
      resolution: args.resolution ?? 21,
      mode: args.mode ?? 'actual',
      referenceModelId: args.referenceModelId,
      basis: args.basis ?? 'mean',
      alpha: args.alpha ?? 0.05,
    });
    bag.put('feasible_nodes', result.feasibleNodes);
    bag.put('total_nodes', result.totalNodes);
    bag.put('node_ratio', result.nodeRatio);
    bag.put('area_ratio', result.areaRatio);
    bag.put('narrow', result.narrowWarning ? 1 : 0);
    bag.put('convergence_node_delta', result.convergence.nodeDelta);
    bag.put('convergence_area_delta', result.convergence.areaDelta);
    bag.put('convergence_neighbor_count', result.convergence.neighborCount);
    bag.put('convergence_direction', result.convergence.direction);
    bag.put('self_compare', result.convergence.neighborCount === result.convergence.count ? 1 : 0);
    bag.put('interval_blocked', result.intervalBlocked.join(','));
    result.responses.forEach((response, index) => bag.put(`response_${index}_node_ratio`, response.nodeRatio));
    const probes = (args.probes ?? []) as [number, number][];
    bag.put('probe_feasible', probes.map(([i, j]) => (result.feasible[j]?.[i] === 1 ? 1 : 0)).join(','));
    probes.forEach(([i, j], index) => {
      result.responses.forEach((response, r) => {
        const value = response.z[j]?.[i];
        bag.put(`z_${r}[${index}]`, value ?? null);
        bag.put(`zname:${response.name}[${index}]`, value ?? null);
      });
    });
    bag.put('extrapolated', result.extrapolated ? 1 : 0);
    bag.put('extrapolation_count', result.extrapolation.details.length);
    bag.put('extrapolation_details', result.extrapolation.details
      .map((entry) => `${entry.model}|${entry.factor}|${entry.kind}`)
      .sort()
      .join(','));
    bag.put('x_min', result.xs[0]);
    bag.put('x_max', result.xs[result.xs.length - 1]);
    bag.put('y_min', result.ys[0]);
    bag.put('y_max', result.ys[result.ys.length - 1]);
  },

  /**
   * QA-V: evaluate the same probes twice on ONE evaluator, in reverse order
   * first. A prediction that remembers a neighbour's state shows here as
   * `z_order` differing from `z_reverse`.
   */
  overlay_order(bag, _ds, args) {
    const models = (args.models as Record<string, any>[]).map((entry) => storedFromJson(entry));
    const responses = (args.responses as { name: string; lsl: number | null; usl: number | null; target: number | null }[] | undefined) ?? [];
    const specs: ResponseSpec[] = models.map((model, index) => ({
      model,
      modelId: model.id,
      lsl: responses[index]?.lsl ?? null,
      usl: responses[index]?.usl ?? null,
      target: responses[index]?.target ?? null,
    }));
    const mode = (args.mode ?? 'actual') as 'actual' | 'coded';
    const result = buildOverlaid(models, specs, {
      xName: args.xName,
      yName: args.yName,
      holdings: args.holdings,
      xRange: args.xRange,
      yRange: args.yRange,
      resolution: args.resolution ?? 21,
      mode,
      basis: args.basis ?? 'mean',
      alpha: args.alpha ?? 0.05,
    });
    const model = models[0];
    const refXPredictor = models[0].predictors.find((predictor) => predictor.name === args.xName);
    const refYPredictor = models[0].predictors.find((predictor) => predictor.name === args.yName);
    const xPredictor = model.predictors.find((predictor) => predictor.name === args.xName) as ModelVariable;
    const yPredictor = model.predictors.find((predictor) => predictor.name === args.yName) as ModelVariable;
    const holdings: Record<string, number> = {};
    model.predictors.forEach((predictor) => {
      if (predictor.name === args.xName || predictor.name === args.yName) return;
      const given = (args.holdings as Record<string, number> | undefined)?.[predictor.name];
      if (given === undefined) { holdings[predictor.name] = predictor.coding?.center ?? 0; return; }
      holdings[predictor.name] = mode === 'actual' || !refXPredictor
        ? given
        : axisActualValue(refXPredictor, given, 'coded');
    });
    const evaluator = compileSurfaceEvaluator(model, { xName: args.xName, yName: args.yName, holdings, mode: 'actual' });
    const probes = (args.probes ?? []) as [number, number][];
    const node = ([i, j]: [number, number]) => {
      const xActual = refXPredictor ? axisActualValue(refXPredictor, result.xs[i], mode) : result.xs[i];
      const yActual = refYPredictor ? axisActualValue(refYPredictor, result.ys[j], mode) : result.ys[j];
      return [designFromActual(xPredictor, xActual), designFromActual(yPredictor, yActual)] as [number, number];
    };
    const during: (number | null)[] = new Array(probes.length).fill(null);
    for (let k = probes.length - 1; k >= 0; k -= 1) {
      const [x, y] = node(probes[k]);
      const value = evaluator.value(x, y);
      during[k] = Number.isFinite(value) ? value : null;
    }
    const after = probes.map((probe) => {
      const [x, y] = node(probe);
      const value = evaluator.value(x, y);
      return Number.isFinite(value) ? value : null;
    });
    const same = during.every((value, index) => value === after[index]);
    bag.put('order_identical', same ? 1 : 0);
    bag.put('probe_feasible', probes.map(([i, j]) => (result.feasible[j]?.[i] === 1 ? 1 : 0)).join(','));
    bag.put('node_ratio', result.nodeRatio);
    after.forEach((value, index) => bag.put(`z_order[${index}]`, value));
    during.forEach((value, index) => bag.put(`z_reverse[${index}]`, value));
  },

  power(bag, ds, args) {
    const spec: PowerSpec = {
      method: args.method as PowerMethod,
      solveFor: args.solveFor ?? 'n',
      n: args.n,
      power: args.power,
      difference: args.difference,
      sd: args.sd ?? 1,
      alpha: args.alpha ?? 0.05,
      alternative: alt(args.alt),
      p1: args.p1,
      p2: args.p2,
      groups: args.groups,
    };
    const r = solvePower(spec);
    bag.put('n', r.n);
    bag.put('power', r.power);
    bag.put('difference', r.difference);
    bag.put('opposite_difference', r.oppositeDifference);
    bag.put('method', r.method);
  },

  dist(bag, ds, args) {
    const name = args.function as string;
    const a = args.args as number[];
    switch (name) {
      case 'normalCdf': bag.put('value', normalCdf(a[0], a[1] ?? 0, a[2] ?? 1)); break;
      case 'normalPdf': bag.put('value', normalPdf(a[0], a[1] ?? 0, a[2] ?? 1)); break;
      case 'normalInv': bag.put('value', normalInv(a[0])); break;
      case 'tCdf': bag.put('value', tCdf(a[0], a[1])); break;
      case 'tInv': bag.put('value', tInv(a[0], a[1])); break;
      case 'fCdf': bag.put('value', fCdf(a[0], a[1], a[2])); break;
      case 'fInv': bag.put('value', fInv(a[0], a[1], a[2])); break;
      case 'chi2Cdf': bag.put('value', chi2Cdf(a[0], a[1])); break;
      case 'gammaP': bag.put('value', gammaP(a[0], a[1])); break;
      case 'gammaCdf': bag.put('value', gammaCdf(a[0], a[1], a[2] ?? 1)); break;
      case 'gammaInv': bag.put('value', gammaInv(a[0], a[1], a[2] ?? 1)); break;
      case 'weibullCdf': bag.put('value', weibullCdf(a[0], a[1], a[2])); break;
      case 'weibullInv': bag.put('value', weibullInv(a[0], a[1], a[2])); break;
      case 'lognormalCdf': bag.put('value', lognormalCdf(a[0], a[1], a[2])); break;
      case 'lognormalInv': bag.put('value', lognormalInv(a[0], a[1], a[2])); break;
      case 'nctCdf': bag.put('value', nctCdf(a[0], a[1], a[2])); break;
      case 'ncfCdf': bag.put('value', ncfCdf(a[0], a[1], a[2], a[3])); break;
      case 'rangeCdf': bag.put('value', rangeCdf(a[0], a[1], a[2])); break;
      case 'rangeInv': bag.put('value', rangeInv(a[0], a[1], a[2])); break;
      case 'logGamma': bag.put('value', logGamma(a[0])); break;
      case 'c4': bag.put('value', c4Constant(a[0])); break;
      default: throw new Error(`unknown dist function ${name}`);
    }
  },

  /**
   * QA-X: the error-bar statistic the chart draws (Stage 3D, WO-08).
   * The op calls the shipped `errorBarFor`, so what is compared with SciPy is
   * exactly the number that reaches the SVG.
   */
  errorbars(bag, ds, args) {
    const values = args.values
      ? (args.values as number[]).map(Number)
      : nums(ds, String(args.column));
    const kind = String(args.stat ?? 'sd') as 'sd' | 'se' | 'ci';
    const stat = errorBarFor(values, kind, Number(args.conf ?? 0.95));
    bag.put('available', stat ? 1 : 0);
    bag.put('n', values.filter((value) => Number.isFinite(value)).length);
    if (!stat) return;
    bag.put('mean', stat.mean);
    bag.put('sd', stat.sd);
    bag.put('se', stat.se);
    bag.put('t_crit', stat.tCrit ?? NaN);
    bag.put('half', stat.half);
    bag.put('lower', stat.lower);
    bag.put('upper', stat.upper);
  },

  nelson(bag, ds, args) {
    const values = nums(ds, args.column);
    const flags = nelsonRules(values, args.center, args.sigma);
    flags.forEach((rules, i) => bag.put(`rules[${i}]`, rules.join(',') || ''));
    bag.put('flagged', flags.filter((r) => r.length).length);
  },

  calc(bag, ds, args) {
    const columns = (args.columns as string[]).map((name) => {
      const values = rawNums(ds, name);
      return { name, type: 'numeric' as const, values };
    });
    const sheet = makeWorksheet('QA', columns);
    const r = evaluateFormula(args.formula, sheet);
    bag.put('rows', r.rows);
    bag.put('constant', r.constant ? 1 : 0);
    bag.put('errors', r.errors);
    r.values.forEach((v, i) => bag.put(`value[${i}]`, v));
  },

  /** UI-layer analyses: recorded for the report, no engine calculation called. */
  ui(bag, ds, args) {
    bag.put('analysis', String(args.analysis));
    bag.put('engineFunction', 'analyses.ts run* (worksheet transform / chart spec only)');
  },

  /* ── QA-U: the shipped analysis runners and chart rules, verified ──────
     These ops call the SAME run functions the browser UI calls
     (findAnalysis(id).run) and read the numbers back out of the resulting
     chart specs / sheet patches, so what is verified here is what renders. */

  /** A Worksheet whose columns mirror a QA dataset, ids C1…Cn in file order. */
  sheet(bag, ds, args) {
    const sheet = sheetFromDataset(ds);
    const def = findAnalysis(String(args.analysis));
    if (!def) throw new Error(`unknown analysis ${args.analysis}`);
    const values: Record<string, unknown> = { ...defaultValues(def), ...(args.values as object ?? {}) };
    const result = def.run({ lang: 'en', sheet, values });
    const emit = String(args.emit);
    const chartOf = (kind: string): Extract<ChartSpec, { kind: never }> | ChartSpec =>
      (result.blocks.filter((b) => b.type === 'chart') as Extract<Block, { type: 'chart' }>[])
        .map((b) => b.chart)
        .find((c) => c.kind === kind) as ChartSpec;
    switch (emit) {
      case 'pareto': {
        const chart = chartOf('pareto') as Extract<ChartSpec, { kind: 'pareto' }>;
        const table = result.blocks.find((b) => b.type === 'table') as Extract<Block, { type: 'table' }>;
        bag.put('items', chart.items.length);
        bag.put('total', chart.items.reduce((a, b) => a + b.count, 0));
        chart.items.forEach((item, i) => {
          bag.put(`label[${i}]`, item.label);
          bag.put(`count[${i}]`, item.count);
          // Percent / cumulative come from the runner's own table strings.
          const row = table.rows[i] as (string | number)[];
          bag.put(`pct[${i}]`, typeof row[2] === 'string' ? Number.parseFloat(row[2]) : row[2]);
          bag.put(`cum[${i}]`, typeof row[3] === 'string' ? Number.parseFloat(row[3]) : row[3]);
        });
        break;
      }
      case 'histogram': {
        const chart = chartOf('histogram') as Extract<ChartSpec, { kind: 'histogram' }>;
        const data = chart.values.filter((v) => isFinite(v));
        bag.put('n', data.length);
        const bins = histogramBins(data, chart.bins);
        bag.put('bins', bins.length);
        bag.put('bin_lo0', bins[0].lo);
        bag.put('bin_hi_last', bins[bins.length - 1].hi);
        bins.forEach((b, i) => bag.put(`count[${i}]`, b.count));
        const curve = histogramCurve(data, chart.bins);
        bag.put('curve_mean', curve.mean);
        bag.put('curve_sd', curve.sd);
        const last = curve.points.length - 1;
        [0, Math.floor(last / 2), last].forEach((i) => {
          bag.put(`curve_x[${i}]`, curve.points[i].x);
          bag.put(`curve_y[${i}]`, curve.points[i].y);
        });
        break;
      }
      case 'boxplot': {
        const chart = chartOf('boxplot') as Extract<ChartSpec, { kind: 'boxplot' }>;
        bag.put('groups', chart.groups.length);
        chart.groups.forEach((group, gi) => {
          const s = boxplotStats(group.values);
          bag.put(`g[${gi}]_label`, group.label);
          bag.put(`g[${gi}]_n`, s.n);
          bag.put(`g[${gi}]_q1`, s.q1);
          bag.put(`g[${gi}]_median`, s.median);
          bag.put(`g[${gi}]_q3`, s.q3);
          bag.put(`g[${gi}]_iqr`, s.iqr);
          bag.put(`g[${gi}]_low_fence`, s.lowFence);
          bag.put(`g[${gi}]_high_fence`, s.highFence);
          bag.put(`g[${gi}]_whisker_low`, s.whiskerLow);
          bag.put(`g[${gi}]_whisker_high`, s.whiskerHigh);
          bag.put(`g[${gi}]_mean`, s.mean);
          bag.put(`g[${gi}]_outliers`, s.outliers.length);
          s.outliers.forEach((v, oi) => bag.put(`g[${gi}]_outlier[${oi}]`, v));
        });
        break;
      }
      case 'scatter': {
        const chart = chartOf('scatter') as Extract<ChartSpec, { kind: 'scatter' }>;
        bag.put('n', chart.points.length);
        bag.put('slope', chart.fit?.slope ?? NaN);
        bag.put('intercept', chart.fit?.intercept ?? NaN);
        bag.put('groups', chart.groups?.length ?? 0);
        (chart.groups ?? []).forEach((label, gi) => {
          bag.put(`g[${gi}]_label`, label);
          bag.put(`g[${gi}]_n`, chart.points.filter((p) => p.g === label).length);
        });
        break;
      }
      case 'timeseries': {
        const chart = chartOf('timeseries') as Extract<ChartSpec, { kind: 'timeseries' }>;
        const finite = chart.values.filter((v) => isFinite(v));
        bag.put('length', chart.values.length);
        bag.put('n', finite.length);
        bag.put('mean', finite.reduce((a, b) => a + b, 0) / finite.length);
        bag.put('min', Math.min(...finite));
        bag.put('max', Math.max(...finite));
        bag.put('lsl', chart.lsl);
        bag.put('usl', chart.usl);
        bag.put('target', chart.target);
        break;
      }
      case 'sheet': {
        const runOnce = (): Worksheet => {
          const r = def.run({ lang: 'en', sheet, values: { ...values } });
          if (!r.sheetPatch) throw new Error('no sheetPatch');
          return r.sheetPatch;
        };
        const patched = runOnce();
        (args.emitColumns as string[]).forEach((name) => {
          const col = patched.columns.find((c) => c.name === name);
          if (!col) throw new Error(`column ${name} missing after ${args.analysis}`);
          col.values.forEach((v, i) => bag.put(`${name}[${i}]`, v));
        });
        bag.put('columns', patched.columns.length);
        // Analysis-specific summaries of the patched sheet.
        const numeric = (name: string): number[] =>
          (patched.columns.find((c) => c.name === name)?.values ?? [])
            .map((v) => (typeof v === 'number' && isFinite(v) ? v : NaN));
        if (args.analysis === 'standardize') {
          const z = numeric('Std value').filter((v) => isFinite(v));
          bag.put('z_mean', z.reduce((a, b) => a + b, 0) / z.length);
          const m = z.reduce((a, b) => a + b, 0) / z.length;
          bag.put('z_sd', Math.sqrt(z.reduce((a, b) => a + (b - m) ** 2, 0) / (z.length - 1)));
        }
        if (args.analysis === 'recode') {
          const all = (patched.columns.find((c) => c.name === 'Recode code')?.values ?? []);
          const tallies: Record<string, number> = {};
          all.forEach((v) => {
            if (typeof v !== 'number' || !isFinite(v)) return;
            const key = String(v);
            tallies[key] = (tallies[key] ?? 0) + 1;
          });
          [10, 20, 30, 9].forEach((value) => bag.put(`count:${value}`, tallies[String(value)] ?? 0));
        }
        if (args.analysis === 'random') {
          const data = numeric('Random data');
          const finite = data.filter((v) => isFinite(v));
          bag.put('n', finite.length);
          bag.put('mean', finite.reduce((a, b) => a + b, 0) / finite.length);
          const m = finite.reduce((a, b) => a + b, 0) / finite.length;
          bag.put('sd', Math.sqrt(finite.reduce((a, b) => a + (b - m) ** 2, 0) / (finite.length - 1)));
          bag.put('all_finite', finite.length === data.length ? 1 : 0);
          if (Number(args.runs) >= 2) {
            const second = runOnce().columns.find((c) => c.name === 'Random data')?.values ?? [];
            let maxDiff = 0;
            for (let i = 0; i < Math.max(second.length, data.length); i += 1) {
              const a = typeof second[i] === 'number' ? (second[i] as number) : NaN;
              const b = data[i];
              if (isFinite(a) && isFinite(b)) maxDiff = Math.max(maxDiff, Math.abs(a - b));
              else if (isFinite(a) !== isFinite(b)) maxDiff = Infinity;
            }
            bag.put('repeat_max_diff', maxDiff);
          }
        }
        break;
      }
      default:
        throw new Error(`unknown emit ${emit}`);
    }
  },

  /**
   * Stage 3C — the multi-response optimiser against an independent solver.
   *
   * The models are either fitted here from the dataset (the same quadratic the
   * surface cases use) or handed over as an explicit coefficient list, and the
   * shipped optimiser searches them. The reference fits the same quadratics with
   * statsmodels and maximises the same composite with SciPy, so the composite,
   * the condition and the per-response desirabilities all have a second number.
   */
  optimize(bag, ds, args) {
    const factorSpecs: FactorSettings[] = (args.factors as {
      name: string; kind?: string; lower: number; upper: number; step?: number;
      fixed?: boolean; fixedValue?: number | string; levels?: string[];
      allowExtrapolation?: boolean;
    }[]).map((factor) => ({
      name: factor.name,
      kind: (factor.kind ?? 'continuous') as FactorSettings['kind'],
      lower: factor.lower,
      upper: factor.upper,
      step: factor.step ?? 0,
      fixed: Boolean(factor.fixed),
      fixedValue: factor.fixedValue ?? (factor.kind === 'categorical' ? (factor.levels?.[0] ?? '') : factor.lower),
      levels: factor.levels ?? [],
      ...(factor.allowExtrapolation ? { allowExtrapolation: true } : {}),
    }));
    const specs = args.responses as {
      modelId?: string; name: string; goal: ResponseSettings['goal']; lower?: number; upper?: number;
      target?: number; weight?: number; importance?: number;
    }[];
    let models: StoredModel[];
    if (args.mode === 'spec') {
      models = (args.models as Record<string, unknown>[]).map((spec) => modelFromSpec(spec));
    } else {
      const datasetFactors = (args.datasetFactors as string[]) ?? ['x', 'y'];
      models = specs.map((response) => storedQuadratic(ds, response.name, datasetFactors));
    }
    const responses: ResponseSettings[] = specs.map((response, index) => ({
      // A spec case names its models by position; only a case that deliberately
      // tests a bad id (honourModelIds) keeps the id it wrote.
      modelId: args.honourModelIds ? String(response.modelId ?? '') : models[index].id,
      name: response.name,
      goal: response.goal,
      lower: response.lower === undefined || response.lower === null ? null : Number(response.lower),
      upper: response.upper === undefined || response.upper === null ? null : Number(response.upper),
      target: response.target === undefined || response.target === null ? null : Number(response.target),
      // The QA case file carries NaN / Infinity as strings so the JSON stays
      // valid; they arrive here as the numbers the validator must reject.
      weight: response.weight === undefined ? 1 : Number(response.weight),
      importance: response.importance === undefined ? 1 : Number(response.importance),
    }));
    const result = optimize(models, responses, factorSpecs, {
      method: (args.method ?? 'multistart') as FactorSettings extends never ? never : any,
      seed: args.seed ?? 1,
      gridPoints: args.gridPoints ?? 41,
      maxEvaluations: args.maxEvaluations ?? 60000,
      topN: args.topN ?? 3,
      alpha: 0.05,
      timeLimitMs: args.timeLimitMs ?? 8000,
      allowExtrapolation: Boolean(args.allowExtrapolation),
      ...(args.autoFactorBounds ? {} : {}),
    });
    const best = result.solutions[0];
    bag.put('status', result.status);
    bag.put('issues', result.issues.slice().sort().join(','));
    bag.put('recommended', result.recommended ? 1 : 0);
    bag.put('stopped', result.search.stoppedBy);
    bag.put('exhaustive', result.search.exhaustive ? 1 : 0);
    bag.put('space', result.search.space);
    bag.put('evaluations', result.evaluations);
    bag.put('solutions', result.solutions.length);
    bag.put('composite', best ? best.composite : null);
    bag.put('compliant', best ? (best.compliantAll ? 1 : 0) : null);
    factorSpecs.forEach((factor) => {
      const value = best?.settings[factor.name];
      bag.put(`x:${factor.name}`, typeof value === 'number' ? value : value === undefined ? null : value);
    });
    // Model order invariance: the same run with the responses reversed must
    // produce the same condition and the same per-response prediction.
    if (args.checkOrderInvariance) {
      const reversed = optimize(models.slice().reverse(), responses.slice().reverse(), factorSpecs, {
        method: (args.method ?? 'multistart') as any,
        seed: args.seed ?? 1,
        gridPoints: args.gridPoints ?? 41,
        maxEvaluations: args.maxEvaluations ?? 60000,
        topN: args.topN ?? 3,
        alpha: 0.05,
        timeLimitMs: args.timeLimitMs ?? 8000,
        allowExtrapolation: Boolean(args.allowExtrapolation),
      });
      const other = reversed.solutions[0];
      bag.put('rev_status', reversed.status);
      bag.put('rev_composite', other ? other.composite : null);
      factorSpecs.forEach((factor) => {
        const value = other?.settings[factor.name];
        bag.put(`rev_x:${factor.name}`, typeof value === 'number' ? value : value === undefined ? null : value);
      });
      responses.forEach((response) => {
        const prediction = other?.responses.find((candidate) => candidate.modelId === response.modelId);
        bag.put(`rev_pred:${response.name}`, prediction ? prediction.value : null);
      });
    }
    responses.forEach((response) => {
      const prediction = best?.responses.find((candidate) => candidate.modelId === response.modelId);
      bag.put(`pred:${response.name}`, prediction ? prediction.value : null);
      bag.put(`d:${response.name}`, prediction ? prediction.desirability : null);
      bag.put(`se:${response.name}`, prediction ? prediction.se : null);
      bag.put(`ci_low:${response.name}`, prediction?.ci ? prediction.ci[0] : null);
      bag.put(`ci_high:${response.name}`, prediction?.ci ? prediction.ci[1] : null);
      bag.put(`pi_low:${response.name}`, prediction?.pi ? prediction.pi[0] : null);
      bag.put(`pi_high:${response.name}`, prediction?.pi ? prediction.pi[1] : null);
    });
  },

  /**
   * Stage 3C corrective QA — the factor domain itself.
   *
   * The shipped domain module answers "which values may this factor take?";
   * the reference recomputes Lower + k × Step in Python, so a snapping rule,
   * a float artefact or a fixed-value check has a second opinion.
   */
  domain(bag, _ds, args) {
    const factors = (args.factors as any[]).map((factor) => ({
      name: factor.name,
      kind: (factor.kind ?? 'continuous') as FactorSettings['kind'],
      lower: factor.lower ?? 0,
      upper: factor.upper ?? 0,
      step: factor.step ?? 0,
      fixed: Boolean(factor.fixed),
      fixedValue: factor.fixedValue ?? factor.lower ?? 0,
      levels: factor.levels ?? [],
    })) as FactorSettings[];
    factors.forEach((factor, index) => {
      const axis = factorAxisValues(factor, args.gridPoints ?? 21);
      const numeric = axis.values.filter((value): value is number => typeof value === 'number');
      bag.put(`count[${index}]`, axis.count);
      bag.put(`listed[${index}]`, axis.values.length);
      bag.put(`distinct[${index}]`, new Set(axis.values.map((value) => String(value))).size);
      if (numeric.length) {
        bag.put(`v_first[${index}]`, numeric[0]);
        bag.put(`v_second[${index}]`, numeric[1] ?? null);
        bag.put(`v_last[${index}]`, numeric[numeric.length - 1]);
      }
      const issues = factorIssues(factor);
      bag.put(`issues[${index}]`, issues.join(','));
    });
    (args.checks as any[] | undefined)?.forEach((check, index) => {
      const factor = factors.find((candidate) => candidate.name === check.factor) as FactorSettings;
      bag.put(`check[${index}]`, validateFactorValue(factor, check.value) === null ? 1 : 0);
    });
  },

  /** The profiler's curve axis for one factor (QA-W-30). */
  profileaxis(bag, _ds, args) {
    const factor = {
      name: 'x',
      kind: (args.factor.kind ?? 'discrete') as FactorSettings['kind'],
      lower: args.factor.lower,
      upper: args.factor.upper,
      step: args.factor.step ?? 0,
      fixed: Boolean(args.factor.fixed),
      fixedValue: args.factor.fixedValue ?? args.factor.lower,
      levels: args.factor.levels ?? [],
    } as FactorSettings;
    const axis = curveAxis(factor, args.resolution ?? 21);
    const numeric = axis.filter((value): value is number => typeof value === 'number');
    bag.put('n', axis.length);
    bag.put('distinct', new Set(axis.map((value) => String(value))).size);
    if (numeric.length) {
      bag.put('first', numeric[0]);
      bag.put('second', numeric[1] ?? null);
      bag.put('last', numeric[numeric.length - 1]);
    }
    bag.put('all_on_step', numeric.every((value) => validateFactorValue(factor, value) === null) ? 1 : 0);
  },

  /** Profiler prediction vs optimizer prediction at one condition (QA-W-31). */
  profilepoint(bag, _ds, args) {
    const model = modelFromSpec(args.model as Record<string, unknown>);
    const responses: ResponseSettings[] = (args.responses as any[]).map((response) => ({
      modelId: model.id,
      name: response.name,
      goal: response.goal ?? 'maximize',
      lower: response.lower ?? null,
      upper: response.upper ?? null,
      target: response.target ?? null,
      weight: response.weight ?? 1,
      importance: response.importance ?? 1,
    }));
    const factors: FactorSettings[] = (args.factors as any[]).map((factor) => ({
      name: factor.name,
      kind: (factor.kind ?? 'continuous') as FactorSettings['kind'],
      lower: factor.lower,
      upper: factor.upper,
      step: factor.step ?? 0,
      fixed: Boolean(factor.fixed),
      fixedValue: factor.fixedValue ?? factor.lower,
      levels: factor.levels ?? [],
    }));
    const rows = profileCurves([model], responses, factors, args.point ?? {}, { resolution: 11 });
    const prof = rows[0]?.prediction;
    const direct = evaluateCondition([model], responses, factors, args.point ?? {});
    bag.put('prof_value', prof?.value ?? null);
    bag.put('prof_se', prof?.se ?? null);
    bag.put('prof_ci_low', prof?.ci ? prof.ci[0] : null);
    bag.put('prof_ci_high', prof?.ci ? prof.ci[1] : null);
    bag.put('prof_pi_low', prof?.pi ? prof.pi[0] : null);
    bag.put('prof_pi_high', prof?.pi ? prof.pi[1] : null);
    bag.put('direct_value', direct?.responses[0]?.value ?? null);
    bag.put('direct_diff', prof && direct && prof.value !== null && direct.responses[0].value !== null
      ? Math.abs(prof.value - direct.responses[0].value)
      : null);
  },

  /**
   * Model Manager, contour, surface and the prediction adapter must agree at
   * the same actual condition (QA-W-32). The reference evaluates the model once.
   */
  predictionconsistency(bag, _ds, args) {
    const model = modelFromSpec(args.model as Record<string, unknown>);
    const point = (args.point ?? {}) as Record<string, number | string>;
    const xName = String(args.xName);
    const yName = String(args.yName);
    const adapter = createPredictionAdapter(model);
    const mine = adapter.evaluate(point, 0.05);
    const manager = predictStoredModel(model, point, { alpha: 0.05 });
    const xPredictor = model.predictors.find((predictor) => predictor.name === xName)!;
    const yPredictor = model.predictors.find((predictor) => predictor.name === yName)!;
    const holdings: Record<string, number | string> = {};
    model.predictors.forEach((predictor) => {
      if (predictor.name === xName || predictor.name === yName) return;
      holdings[predictor.name] = point[predictor.name];
    });
    const evaluator = compileSurfaceEvaluator(model, { xName, yName, holdings, mode: 'actual', alpha: 0.05 });
    const codedX = adapter.designValue(xName, Number(point[xName]));
    const codedY = adapter.designValue(yName, Number(point[yName]));
    void xPredictor;
    void yPredictor;
    const surface = evaluator.value(codedX, codedY);
    const grid = modelSurface(model, {
      xName,
      yName,
      holdings,
      resolution: 2,
      xRange: [Number(point[xName]), Number(point[xName]) + 1],
      yRange: [Number(point[yName]), Number(point[yName]) + 1],
      mode: 'actual',
    });
    bag.put('adapter_value', mine.value);
    bag.put('adapter_se', mine.se);
    bag.put('adapter_ci_low', mine.ci ? mine.ci[0] : null);
    bag.put('adapter_ci_high', mine.ci ? mine.ci[1] : null);
    bag.put('manager_value', manager.value);
    bag.put('manager_se', manager.se);
    bag.put('surface_value', Number.isFinite(surface) ? surface : null);
    bag.put('contour_value', Number.isFinite(grid.z[0][0]) ? grid.z[0][0] : null);
    bag.put('surface_diff', mine.value !== null && Number.isFinite(surface) ? Math.abs(mine.value - surface) : null);
    bag.put('contour_diff', mine.value !== null && Number.isFinite(grid.z[0][0]) ? Math.abs(mine.value - grid.z[0][0]) : null);
  },

  /* ── QA-J: stored-model prediction (WO-02) ──────────────────────────
     The model is handed over as data (coefficients, coding, covariance) and
     the SHIPPED predictor builds the design row and evaluates it. The Python
     side evaluates the same row with NumPy, so the coding transform, the
     contrast coding and the interval arithmetic are all checked. */

  modelpredict(bag, _ds, args) {
    const model = modelFromSpec(args.model as Record<string, unknown>);

    const points = (args.points as { mode?: 'actual' | 'coded'; values: Record<string, number | string> }[]) ?? [];
    let refused = 0;
    points.forEach((point, index) => {
      const result = predictStoredModel(model, point.values, { mode: point.mode ?? 'actual', alpha: 0.05 });
      if (result.nonEstimable.length) {
        refused += 1;
        bag.put(`nonestimable[${index}]`, result.nonEstimable.slice().sort().join(','));
      }
      bag.put(`pred[${index}]`, result.value);
      bag.put(`se[${index}]`, result.se);
      bag.put(`pi_low[${index}]`, result.pi ? result.pi[0] : null);
      bag.put(`pi_high[${index}]`, result.pi ? result.pi[1] : null);
      bag.put(`issues[${index}]`, result.issues.join(','));
    });
    bag.put('refused', refused);
    if (refused === points.length && points.length > 0) throw new Error('model.nonEstimable');
  },

  /* ── Stage 3F: model control (WO-3F-05/07/08) ───────────────────────
     The comparison, pooling and Lenth numbers must be reproducible from the
     data alone; the Python reference refits the same models with NumPy and
     statsmodels and recomputes every scalar below from its own fit. */

  pooling(bag, ds, args) {
    const factors: ModelFactor[] = (args.factors as string[]).map((name) => ({
      name,
      kind: 'numeric',
      values: rawNums(ds, name),
    }));
    const catalog = buildTermCatalog(factors, args.order ?? 2);
    const terms: ModelTerm[] = catalog.terms.map((term) => ({ name: term.name, factors: term.factors }));
    const pooledNames = ((args.pooled as string[][]) ?? []).map((names) => termName(names));
    const result = fitWithPooling(rawNums(ds, args.response), factors, terms, pooledNames, { allowZeroDf: true });
    const comparison = compareFits(result.full, result.fit, pooledNames);
    bag.put('full_sse', result.full.sse);
    bag.put('full_dfe', result.full.dfe);
    bag.put('full_mse', result.full.mse);
    bag.put('full_s', result.full.s);
    bag.put('full_r2', result.full.r2);
    bag.put('full_r2_adj', result.full.r2adj);
    bag.put('full_r2_pred', result.full.r2pred);
    bag.put('red_sse', result.fit.sse);
    bag.put('red_dfe', result.fit.dfe);
    bag.put('red_mse', result.fit.mse);
    bag.put('red_s', result.fit.s);
    bag.put('red_r2', result.fit.r2);
    bag.put('red_r2_adj', result.fit.r2adj);
    bag.put('red_r2_pred', result.fit.r2pred);
    comparison.metrics.forEach((metric) => {
      bag.put(`cmp:${metric.key}:difference`, metric.difference);
      bag.put(`cmp:${metric.key}:reason`, metric.reason ?? null);
    });
    bag.put('partial_df1', comparison.partial ? comparison.partial.df1 : null);
    bag.put('partial_df2', comparison.partial ? comparison.partial.df2 : null);
    bag.put('partial_f', comparison.partial ? comparison.partial.f : null);
    bag.put('partial_p', comparison.partial ? comparison.partial.p : null);
    bag.put('partial_reason', comparison.partialReason ?? null);
    bag.put('checks_expected_dfe', result.checks.expectedDfe);
    bag.put('checks_actual_dfe', result.checks.actualDfe);
    bag.put('checks_expected_ss', result.checks.expectedSs);
    bag.put('checks_actual_ss', result.checks.actualSs);
    bag.put('checks_additive', result.checks.additive ? 1 : 0);
  },

  lenth(bag, ds, args) {
    const factors: ModelFactor[] = (args.factors as string[]).map((name) => ({
      name,
      kind: 'numeric',
      values: rawNums(ds, name),
    }));
    const r = analyzeFactorial(rawNums(ds, args.response), factors, args.order ?? factors.length);
    const availability = r.saturated.lenth;
    bag.put('available', availability.available ? 1 : 0);
    if (!availability.available || !availability.result) {
      bag.put('reason', availability.reason ?? null);
      return;
    }
    const lenth = availability.result;
    bag.put('pse', lenth.pse);
    bag.put('me', lenth.me);
    bag.put('sme', lenth.sme);
    bag.put('pseudo_df', lenth.pseudoDf);
    bag.put('active_count', lenth.activeCount);
    lenth.effects.forEach((entry) => {
      bag.put(`effect:${entry.term}`, entry.effect);
      bag.put(`active:${entry.term}`, entry.active ? 1 : 0);
    });
  },

  hierarchy(bag, _ds, args) {
    const factors: ModelFactor[] = (args.factors as string[]).map((name) => ({
      name,
      kind: 'numeric',
      values: [],
    }));
    const catalog = buildTermCatalog(factors, args.order ?? 2);
    const selected = ((args.selected as string[][]) ?? []).map((names) => termId(names));
    const mode = (args.mode ?? 'strict') as 'strict' | 'auto' | 'unrestricted';
    const result = applyHierarchy(catalog, selected, mode);
    bag.put('refused', mode === 'strict' && result.violations.length > 0 ? 1 : 0);
    bag.put('selected_count', result.selected.length);
    bag.put('added_count', result.added.length);
    bag.put('violation_count', result.violations.length);
    const missing = result.violations.flatMap((violation) => violation.missing);
    bag.put('missing', missing.slice().sort().join(','));
    bag.put('selected', catalog.terms.filter((term) => result.selected.includes(term.id)).map((term) => term.name).join(','));
  },

  /** Deliberately failing guard: proves the comparator reports engine errors. */
  errorProbe(): void {
    throw new Error('qa.expectedError');
  },
};

/* Resolve the engine commit for the report metadata. */
function commitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function main(): void {
  const [, , requestPath, outputPath] = process.argv;
  if (!requestPath) {
    console.error('usage: cli.mjs <request.json> <output.json>');
    process.exit(2);
  }
  const request = JSON.parse(readFileSync(requestPath, 'utf8')) as {
    datasetsDir: string;
    cases: { id: string; op: string; dataset?: string; args?: Record<string, unknown> }[];
  };
  const results: Record<string, unknown> = {};
  const cache = new Map<string, Dataset>();
  for (const c of request.cases) {
    const bag = new Bag();
    try {
      const op = ops[c.op];
      if (!op) throw new Error(`unknown op ${c.op}`);
      let ds: Dataset = { name: '', columns: {} };
      if (c.dataset) {
        if (!cache.has(c.dataset)) cache.set(c.dataset, loadDataset(request.datasetsDir, c.dataset));
        ds = cache.get(c.dataset) as Dataset;
      }
      op(bag, ds, (c.args ?? {}) as Record<string, any>);
      results[c.id] = { status: 'ok', values: bag.values };
    } catch (error) {
      const err = error as Error & { issues?: unknown };
      results[c.id] = {
        status: 'error',
        errorCode: err.message,
        errorMessage: err.issues ? JSON.stringify(err.issues) : String(err.message),
        failedOp: c.op,
        validationIssues: err instanceof SpcValidationError ? err.issues : undefined,
      };
    }
  }
  const payload = {
    meta: {
      adapter: 'qa/adapters/sigrun/cli.ts',
      engine: 'src/lib (shipped TypeScript)',
      node: process.version,
      commit: commitSha(),
      cases: request.cases.length,
      generatedAt: new Date().toISOString(),
    },
    results,
  };
  if (outputPath) writeFileSync(outputPath, JSON.stringify(payload, null, 1));
  else process.stdout.write(JSON.stringify(payload));
}

main();
