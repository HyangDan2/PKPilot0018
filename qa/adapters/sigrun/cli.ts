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
import { analyzeFactorial, analyzeRsm, boxBehnkenDesign, ccdDesign, factorialDesign } from '../../../src/lib/doe';
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
