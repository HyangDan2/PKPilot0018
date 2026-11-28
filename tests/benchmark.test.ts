/* ─────────────────────────────────────────────────────────────────────────
   Golden-reference benchmark suite
   Every expected value below is an independent reference, not a re-recording
   of this application's own output:

   · scipy.stats — t / F / Tukey / Weibull / lognormal / gamma fits, noncentral
     t and F (power), computed with SciPy 1.18.1 / NumPy 2.5.4 (Python 3.12).
   · statsmodels 0.15.0 — one-way ANOVA (OLS + anova_lm) cross-check and the
     regression R² / VIF values.
   · Montgomery, "Introduction to Statistical Quality Control" — S-chart
     constants c₄, A₃, B₃, B₄ (Table VI) and the Xbar-S limit formulas.
   · NIST/SEMATECH e-Handbook of Statistical Methods (§6.3.3 Gage R&R ANOVA,
     §5.5.2 Weibull MLE, §3.4.1 ANOVA) — the SS / variance-component algebra.
   · The Type III sums of squares for the unbalanced two-way design were
     produced by explicit full-versus-reduced model fits in NumPy (the
     definition of an adjusted SS), independently of this codebase.

   Reproduce the reference values with the Python recipe kept beside each block.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import { capability } from '../src/lib/capability';
import { analyzeFactorial, analyzeRsm } from '../src/lib/doe';
import { gageRR, type GrrRow } from '../src/lib/gagerr';
import { fitGlm, type ModelFactor } from '../src/lib/glm';
import { nonnormalCapability } from '../src/lib/nonnormal';
import { solvePower } from '../src/lib/power';
import { fitWeibull } from '../src/lib/reliability';
import { cChart, npChart, xbarSCharts, uChart } from '../src/lib/spc';
import { adNormality, anovaOneWay, pairedT, regress, summarize, tTest1, tTest2, tukeyHSD } from '../src/lib/stats';

/* ── shared reference datasets ────────────────────────────────────────── */

const A = [12.4, 11.8, 12.9, 12.1, 11.5, 12.6, 12.3, 11.9, 12.0, 12.7];
const A2 = [12.1, 11.6, 12.4, 11.9, 11.4, 12.2, 12.0, 11.7, 11.8, 12.3];
const B = [13.1, 12.6, 13.4, 12.9, 13.0, 13.5, 12.8, 13.2];
const G1 = [6.2, 5.8, 6.5, 6.1, 5.9, 6.4];
const G2 = [6.9, 7.2, 6.7, 7.0, 7.1, 6.8];
const G3 = [6.0, 5.6, 6.3, 5.9, 6.2, 5.7];
const X1 = [1.2, 2.4, 3.1, 4.6, 5.2, 6.0, 7.3, 8.1, 9.4, 10.2];
const X2 = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9];
const YREG = [4.1, 5.9, 7.2, 9.8, 11.4, 13.1, 15.6, 17.2, 19.9, 21.5];

describe('descriptive statistics (NumPy reference)', () => {
  it('matches mean, sample sd, median and type-6 quartiles', () => {
    // python: A=[…]; mean=12.22 sd(ddof=1)=0.43919117578668265 median=12.2
    //         numpy.quantile(A,[.25,.75],method="weibull") = 11.875, 12.625
    const s = summarize(A);
    expect(s.mean).toBeCloseTo(12.22, 10);
    expect(s.stdev).toBeCloseTo(0.43919117578668265, 10);
    expect(s.median).toBeCloseTo(12.2, 10);
    expect(s.q1).toBeCloseTo(11.875, 10);
    expect(s.q3).toBeCloseTo(12.625, 10);
  });
});

describe('Anderson–Darling normality (formula reference)', () => {
  it('matches A² computed with the estimated mean and sd', () => {
    // A² = −n − (1/n)·Σ(2i−1)[ln F(z_i) + ln(1 − F(z_{n+1−i}))]
    // python/scipy: norm.cdf with the sample mean & sd → A² = 0.12773545904308392
    const ad = adNormality(A);
    expect(ad.ad).toBeCloseTo(0.12773545904308392, 8);
    expect(ad.adAdj).toBeCloseTo(0.1401896662997846, 8);
  });
});

describe('t tests (scipy.stats reference)', () => {
  it('1-sample t against μ₀ = 12', () => {
    // scipy.stats.ttest_1samp(A, 12.0) → t=1.5840506904331586, p=0.14764260473224528
    const r = tTest1(A, 12);
    expect(r.t).toBeCloseTo(1.5840506904331586, 8);
    expect(r.p).toBeCloseTo(0.14764260473224528, 8);
    expect(r.df).toBe(9);
    expect(r.ci[0]).toBeCloseTo(11.905821559359621, 6);
    expect(r.ci[1]).toBeCloseTo(12.53417844064038, 6);
  });

  it('2-sample Welch and pooled t', () => {
    // scipy: ttest_ind(A,B,equal_var=False) → -4.808782208220829 (p 0.0002022148651616815)
    //        ttest_ind(A,B,equal_var=True)  → -4.610305382740147 (p 0.00028955643534722225)
    const welch = tTest2(A, B, { welch: true });
    expect(welch.t).toBeCloseTo(-4.808782208220829, 8);
    expect(welch.p).toBeCloseTo(0.0002022148651616815, 10);
    expect(welch.df).toBeCloseTo(15.722527515733903, 6);
    const pooled = tTest2(A, B, { welch: false });
    expect(pooled.t).toBeCloseTo(-4.610305382740147, 8);
    expect(pooled.p).toBeCloseTo(0.00028955643534722225, 10);
    expect(pooled.df).toBe(16);
  });

  it('paired t', () => {
    // scipy: ttest_rel(A, A2) → t=7.2029405759853775, p=5.067051815618785e-05
    const r = pairedT(A, A2);
    expect(r.t).toBeCloseTo(7.2029405759853775, 8);
    expect(r.p).toBeCloseTo(5.067051815618785e-05, 10);
    expect(r.difference).toBeCloseTo(0.28, 10);
  });
});

describe('one-way ANOVA and Tukey HSD (scipy.stats reference)', () => {
  it('matches the F ratio and sums of squares', () => {
    // scipy: f_oneway(G1,G2,G3) → F=27.243243243243235, p=1.0149199715018976e-05
    // SS_between = 3.36, SS_within = 0.925, MS_within = 0.061666666666666675
    const table = anovaOneWay([
      { label: 'G1', values: G1 },
      { label: 'G2', values: G2 },
      { label: 'G3', values: G3 },
    ]);
    expect(table.f).toBeCloseTo(27.243243243243235, 9);
    expect(table.p).toBeCloseTo(1.0149199715018976e-05, 12);
    expect(table.ssBetween).toBeCloseTo(3.36, 9);
    expect(table.ssWithin).toBeCloseTo(0.925, 9);
    expect(table.msWithin).toBeCloseTo(0.061666666666666675, 10);
  });

  it('matches scipy.stats.tukey_hsd pair probabilities', () => {
    // scipy: tukey_hsd(G1,G2,G3).pvalue[0,2] = 0.3682446746439141  (G1 vs G3)
    //        tukey_hsd(G1,G2,G3).pvalue[0,1] = 0.00014682640658780777 (G1 vs G2)
    const table = anovaOneWay([
      { label: 'G1', values: G1 },
      { label: 'G2', values: G2 },
      { label: 'G3', values: G3 },
    ]);
    const tukey = tukeyHSD(table);
    const p13 = tukey.pairs.find((p) => p.a === 'G1' && p.b === 'G3');
    const p12 = tukey.pairs.find((p) => p.a === 'G1' && p.b === 'G2');
    expect(p13?.p).toBeCloseTo(0.3682446746439141, 3);
    expect(p13?.diff).toBeCloseTo(0.2, 9);
    expect(p12?.p).toBeCloseTo(0.00014682640658780777, 6);
  });
});

describe('multiple regression (statsmodels / NumPy reference)', () => {
  it('matches coefficients, R², R²(adj) and VIF', () => {
    // numpy.linalg.lstsq([1,x1,x2], y):
    //   β = [1.218266693874608, 1.8857446374341345, 0.09249120743256839]
    //   s = 0.26542330257221664, R² = 0.9984515663200053, R²(adj) = 0.9980091566971497
    //   VIF = 1/(1−R²_j) with R²_j from regressing x_j on the other predictor = 8.089177039695596
    const result = regress(YREG, [
      { name: 'x1', values: X1 },
      { name: 'x2', values: X2 },
    ]);
    expect(result.coefficients[0].coef).toBeCloseTo(1.218266693874608, 9);
    expect(result.coefficients[1].coef).toBeCloseTo(1.8857446374341345, 9);
    expect(result.coefficients[2].coef).toBeCloseTo(0.09249120743256839, 9);
    expect(result.s).toBeCloseTo(0.26542330257221664, 9);
    expect(result.r2).toBeCloseTo(0.9984515663200053, 9);
    expect(result.r2adj).toBeCloseTo(0.9980091566971497, 9);
    expect(result.coefficients[1].vif).toBeCloseTo(8.089177039695596, 8);
    expect(result.coefficients[2].vif).toBeCloseTo(8.089177039695596, 8);
    expect(result.anova.ssReg).toBeCloseTo(317.9878532931616, 7);
  });
});

describe('process capability (formula reference)', () => {
  it('matches Cp / Cpk / Pp / Ppk / Cpm / PPM / sigma level', () => {
    // python: pooled within-group sd over 5 subgroups of 4, overall sd(ddof=1),
    // LSL 9.5, USL 10.8, target 10.15 → the values below.
    const values = [10.1, 10.4, 9.9, 10.2, 10.3, 10.0, 10.5, 10.1, 9.8, 10.2, 10.0, 10.3, 10.4, 10.1, 10.2, 10.6, 10.0, 9.9, 10.1, 10.2];
    const result = capability(values, { lsl: 9.5, usl: 10.8, target: 10.15, subgroup: 4 });
    expect(result.mean).toBeCloseTo(10.165, 10);
    expect(result.sdWithin).toBeCloseTo(0.20371548787463356, 10);
    expect(result.sdOverall).toBeCloseTo(0.208440323404692, 10);
    expect(result.cp).toBeCloseTo(1.0635748362932689, 9);
    expect(result.cpk).toBeCloseTo(1.039030801609577, 9);
    expect(result.pp).toBeCloseTo(1.0394661797084392, 9);
    expect(result.ppk).toBeCloseTo(1.0154784986382435, 9);
    expect(result.cpm).toBeCloseTo(1.0367850575866226, 9);
    // The erf-based normal CDF is accurate to ~1e-7, so PPM agrees to ~0.1 ppm.
    expect(result.ppmOverall).toBeCloseTo(1868.335252021458, 0);
    expect(result.sigmaLevel).toBeCloseTo(4.39957658295868, 4);
  });
});

describe('control chart constants and limits (Montgomery Table VI)', () => {
  const subgroups = [
    [10.1, 10.4, 9.9, 10.2],
    [10.3, 10.0, 10.5, 10.1],
    [9.8, 10.2, 10.0, 10.3],
    [10.4, 10.1, 10.2, 10.6],
    [10.0, 9.9, 10.1, 10.2],
  ];

  it('Xbar-S uses the exact c₄ constant (n=4: 0.9213177319235613)', () => {
    // c₄(4) = √(2/3)·Γ(2)/Γ(1.5) = 0.9213177319235613 (Montgomery Table VI)
    // limits: X̄̄ ± A₃·S̄ with A₃ = 3/(c₄√n) = 1.6281028227561023
    //         grand = 10.165, S̄ = 0.2004945559205394 → UCL 10.491425752441462, LCL 9.83857424755854
    const result = xbarSCharts(subgroups.flat(), { size: 4 });
    expect(result.panels[0].center).toBeCloseTo(10.165, 10);
    expect((result.panels[0].ucl as number[])[0]).toBeCloseTo(10.491425752441462, 9);
    expect((result.panels[0].lcl as number[])[0]).toBeCloseTo(9.83857424755854, 9);
    expect(result.panels[1].center).toBeCloseTo(0.2004945559205394, 10);
    expect((result.panels[1].ucl as number[])[0]).toBeCloseTo(0.4543301027691403, 8);
  });

  it('NP chart limits', () => {
    // np̄ = Σd/15 = 3.93333…, p̄ = 0.0786667, σ = √(np̄(1−p̄)) = 1.90389…
    // UCL = min(n, np̄ + 3σ) = 9.64504, LCL clamped at 0
    const defectives = [4, 2, 5, 1, 6, 3, 2, 7, 2, 4, 9, 3, 4, 2, 5];
    const result = npChart(defectives, 50);
    expect(result.panels[0].center).toBeCloseTo(3.933333333333333, 10);
    expect(result.panels[0].sigma as number).toBeCloseTo(1.9036572987570823, 8);
    expect(result.panels[0].ucl as number).toBeCloseTo(9.64430522960458, 8);
    expect(result.panels[0].lcl as number).toBe(0);
  });

  it('C chart limits', () => {
    // c̄ = 11.93333…, UCL = c̄ + 3√c̄ = 22.296730459758624, LCL = 1.569936206908043
    const defects = [12, 9, 14, 7, 15, 11, 10, 16, 8, 13, 19, 9, 12, 10, 14];
    const result = cChart(defects);
    expect(result.panels[0].center).toBeCloseTo(11.933333333333334, 10);
    expect(result.panels[0].ucl as number).toBeCloseTo(22.296730459758624, 9);
    expect(result.panels[0].lcl as number).toBeCloseTo(1.569936206908043, 9);
  });

  it('U chart limits vary with the inspection unit', () => {
    // ū = 179/156 = 1.1474358974358974, limits u̅ ± 3√(u̅/nᵢ)
    const defects = [12, 9, 14, 7, 15, 11, 10, 16, 8, 13, 19, 9, 12, 10, 14];
    const units = [10, 10, 12, 10, 9, 11, 10, 12, 10, 9, 10, 11, 10, 10, 12];
    const result = uChart(defects, units);
    expect(result.panels[0].center).toBeCloseTo(1.1474358974358974, 10);
    expect((result.panels[0].ucl as number[])[0]).toBeCloseTo(2.1636505931042427, 9);
    expect((result.panels[0].ucl as number[])[2]).toBeCloseTo(2.0751087509122312, 9);
    expect((result.panels[0].lcl as number[])[4]).toBeCloseTo(0.07625155408695838, 9);
  });
});

describe('Gage R&R crossed ANOVA (NIST/SEMATECH §6.3.3 algebra)', () => {
  // 5 parts × 3 operators × 2 replicates. Expected values from an explicit
  // ANOVA of the same table in NumPy:
  //   SS_part 12.728, SS_operator 0.098667, SS_interaction 0.068,
  //   SS_repeat 0.18, F_part 374.3529, F_operator 5.80392, F_interaction 0.708333
  //   VarComp: repeat 0.012, interaction −0.00175, operator 0.0040833, part 0.5289167
  //   %StudyVar(GRR) 16.2433, %Contribution(part) 97.3616, ndc 8
  const cells: Record<string, number[][]> = {
    p1: [[10.1, 10.3], [10.2, 10.4], [10.0, 10.2]],
    p2: [[10.6, 10.5], [10.7, 10.8], [10.5, 10.6]],
    p3: [[11.0, 11.2], [11.1, 11.0], [10.9, 11.1]],
    p4: [[11.5, 11.4], [11.6, 11.7], [11.4, 11.5]],
    p5: [[12.0, 12.2], [12.1, 12.0], [11.9, 12.1]],
  };

  function rows(): GrrRow[] {
    const out: GrrRow[] = [];
    Object.entries(cells).forEach(([part, perOperator]) => {
      perOperator.forEach((values, op) => {
        values.forEach((measurement) => out.push({ part, operator: `Op${op + 1}`, measurement }));
      });
    });
    return out;
  }

  it('reproduces the ANOVA sums of squares and F ratios', () => {
    const result = gageRR(rows(), 'crossed');
    const part = result.anova.find((r) => r.source === 'part');
    const operator = result.anova.find((r) => r.source === 'operator');
    const interaction = result.anova.find((r) => r.source === 'interaction');
    const repeat = result.anova.find((r) => r.source === 'repeat');
    expect(part?.ss).toBeCloseTo(12.728, 9);
    expect(operator?.ss).toBeCloseTo(0.09866666666666744, 9);
    expect(interaction?.ss).toBeCloseTo(0.06800000000002528, 9);
    expect(repeat?.ss).toBeCloseTo(0.1800000000000015, 9);
    expect(part?.f).toBeCloseTo(374.35294117633055, 7);
    expect(operator?.f).toBeCloseTo(5.80392156862534, 7);
    expect(interaction?.f).toBeCloseTo(0.7083333333335908, 7);
    expect(interaction?.p).toBeCloseTo(0.681022923658178, 8);
  });

  it('reproduces the variance components, %Study Var and ndc', () => {
    const result = gageRR(rows(), 'crossed', { tolerance: 4 });
    const comp = (name: string) => result.components.find((c) => c.name === name);
    expect(comp('repeat')?.variance).toBeCloseTo(0.012000000000000099, 10);
    expect(comp('interaction')?.variance).toBeCloseTo(-0.0017499999999984698, 6);
    expect(comp('operator')?.variance).toBeCloseTo(0.004083333333333056, 10);
    expect(comp('partToPart')?.variance).toBeCloseTo(0.5289166666666648, 10);
    expect(comp('grr')?.studyVar).toBeCloseTo(16.243280083636623, 8);
    expect(comp('partToPart')?.contribution).toBeCloseTo(97.36155852124534, 8);
    expect(result.ndc).toBe(8);
    // %Tolerance uses the 6σ study variation against the 4-unit tolerance.
    expect(comp('grr')?.tolerance).toBeCloseTo((6 * Math.sqrt(0.012 - 0.00175 + 0.0040833333)) / 4 * 100, 4);
  });
});

describe('factorial DOE (NumPy OLS reference)', () => {
  // 2² with two centre points:
  //   (−1,−1) 18.2  (−1,+1) 22.4  (+1,−1) 26.1  (+1,+1) 32.0  (0,0) 24.2, 24.6
  // numpy lstsq → β = [24.583333333333343, 4.375, 2.525, 0.425] (coded)
  // effects = 2β → A 8.75, B 5.05, A×B 0.85; SSE 0.1808333, s 0.3006936
  const runs: [number, number, number][] = [
    [-1, -1, 18.2],
    [-1, 1, 22.4],
    [1, -1, 26.1],
    [1, 1, 32.0],
    [0, 0, 24.2],
    [0, 0, 24.6],
  ];

  it('matches coded coefficients and effects', () => {
    const factors: ModelFactor[] = [
      { name: 'A', kind: 'numeric', values: runs.map((r) => r[0]) },
      { name: 'B', kind: 'numeric', values: runs.map((r) => r[1]) },
    ];
    const analysis = analyzeFactorial(runs.map((r) => r[2]), factors, 2);
    const effect = (term: string) => analysis.effects.find((e) => e.term === term)?.effect;
    expect(effect('A')).toBeCloseTo(8.75, 9);
    expect(effect('B')).toBeCloseTo(5.05, 9);
    expect(effect('A×B')).toBeCloseTo(0.85, 9);
    expect(analysis.glm.beta[0]).toBeCloseTo(24.583333333333343, 9);
    expect(analysis.glm.sse).toBeCloseTo(0.1808333333333338, 9);
    expect(analysis.glm.s).toBeCloseTo(0.300693642544479, 9);
  });
});

describe('response surface (NumPy least squares reference)', () => {
  // 13-run CCD, quadratic in coded A, B. numpy lstsq gives
  //   β = [80.1000088, 2.0586609, 0.1685755, −0.975, −3.2192055, −3.7193565]
  //   stationary point (0.3227205, −0.0196374), response 80.4305397,
  //   eigenvalues (−4.0171807, −2.9213814) → maximum
  const runs: [number, number, number][] = [
    [-1, -1, 70.1], [-1, 1, 72.3], [1, -1, 75.9], [1, 1, 74.2],
    [-1.414, 0, 70.6], [1.414, 0, 76.8], [0, -1.414, 72.4], [0, 1.414, 73.0],
    [0, 0, 80.2], [0, 0, 79.8], [0, 0, 80.5], [0, 0, 79.9], [0, 0, 80.1],
  ];

  it('matches the quadratic fit, stationary point and eigenvalues', () => {
    const factors: ModelFactor[] = [
      { name: 'A', kind: 'numeric', values: runs.map((r) => r[0]) },
      { name: 'B', kind: 'numeric', values: runs.map((r) => r[1]) },
    ];
    const result = analyzeRsm(runs.map((r) => r[2]), factors);
    expect(result.glm.beta[1]).toBeCloseTo(2.0586608577895236, 6);
    expect(result.glm.beta[2]).toBeCloseTo(0.16857545489368117, 6);
    // Term order is linear (A, B), squares (A², B²), then the interaction.
    expect(result.glm.beta[3]).toBeCloseTo(-3.2192054952885103, 6);
    expect(result.glm.beta[4]).toBeCloseTo(-3.7193565409042835, 6);
    expect(result.glm.beta[5]).toBeCloseTo(-0.9749999999999913, 8);
    expect(result.glm.sse).toBeCloseTo(0.46876639226832856, 7);
    expect(result.stationary?.point[0]).toBeCloseTo(0.3227205182296207, 5);
    expect(result.stationary?.point[1]).toBeCloseTo(-0.019637408886952347, 5);
    expect(result.stationary?.response).toBeCloseTo(80.43053966507463, 5);
    // Eigenvalues are reported in descending order.
    expect(result.stationary?.eigenvalues[0]).toBeCloseTo(-2.9213813766403787, 5);
    expect(result.stationary?.eigenvalues[1]).toBeCloseTo(-4.017180659552415, 5);
    expect(result.stationary?.kind).toBe('maximum');
  });
});

describe('multi-factor ANOVA Type I / Type III (full-vs-reduced reference)', () => {
  // Unbalanced 3×2 design:
  //   A1B1 [10,11,12]  A1B2 [13,12]
  //   A2B1 [11,12,13,14]  A2B2 [15,16]
  //   A3B1 [9,10]  A3B2 [14,15,16]
  // Type I  : A 9.9375, B 41.18571428571428, A×B 9.814285714285717
  // Type III (SUM-TO-ZERO coding, SAS / Minitab — statsmodels C(f, Sum) + typ=3):
  //   A 14.314285714285669, B 41.379310344827566, A×B 9.814285714285685, SSE 10.5
  // (Treatment coding returns a different A/B split — 12.5 / 2.7 — which is NOT
  //  the Type III SS SAS and Minitab print for a model with interactions.)
  // R² 0.8530183727034121, s 1.02469507659596
  const cells: [string, string, number[]][] = [
    ['A1', 'B1', [10, 11, 12]],
    ['A1', 'B2', [13, 12]],
    ['A2', 'B1', [11, 12, 13, 14]],
    ['A2', 'B2', [15, 16]],
    ['A3', 'B1', [9, 10]],
    ['A3', 'B2', [14, 15, 16]],
  ];

  it('reproduces the sequential and adjusted sums of squares', () => {
    const rows: { a: string; b: string; y: number }[] = [];
    cells.forEach(([a, b, values]) => values.forEach((y) => rows.push({ a, b, y })));
    const factors: ModelFactor[] = [
      { name: 'A', kind: 'categorical', values: rows.map((r) => r.a) },
      { name: 'B', kind: 'categorical', values: rows.map((r) => r.b) },
    ];
    const glm = fitGlm(rows.map((r) => r.y), factors, [
      { name: 'A', factors: ['A'] },
      { name: 'B', factors: ['B'] },
      { name: 'A×B', factors: ['A', 'B'] },
    ]);
    const term = (name: string) => glm.terms.find((t) => t.name === name);
    expect(term('A')?.ssSeq).toBeCloseTo(9.9375, 9);
    expect(term('B')?.ssSeq).toBeCloseTo(41.18571428571428, 9);
    expect(term('A×B')?.ssSeq).toBeCloseTo(9.814285714285717, 9);
    expect(term('A')?.ssAdj).toBeCloseTo(14.314285714285669, 9);
    expect(term('B')?.ssAdj).toBeCloseTo(41.379310344827566, 9);
    expect(term('A×B')?.ssAdj).toBeCloseTo(9.814285714285685, 9);
    expect(glm.sse).toBeCloseTo(10.5, 9);
    expect(glm.r2).toBeCloseTo(0.8530183727034121, 9);
    expect(glm.s).toBeCloseTo(1.02469507659596, 9);
  });

  it('collapses to the one-way table when only one factor is in the model', () => {
    const rows: { a: string; y: number }[] = [];
    [G1, G2, G3].forEach((values, i) => values.forEach((y) => rows.push({ a: `G${i + 1}`, y })));
    const glm = fitGlm(rows.map((r) => r.y), [{ name: 'A', kind: 'categorical', values: rows.map((r) => r.a) }], [{ name: 'A', factors: ['A'] }]);
    const table = anovaOneWay([
      { label: 'G1', values: G1 },
      { label: 'G2', values: G2 },
      { label: 'G3', values: G3 },
    ]);
    expect(glm.terms[0].ssSeq).toBeCloseTo(table.ssBetween, 9);
    expect(glm.terms[0].f).toBeCloseTo(table.f, 9);
    expect(glm.terms[0].p).toBeCloseTo(table.p, 10);
  });
});

describe('Weibull MLE with right censoring (scipy.stats.weibull_min reference)', () => {
  // 20 failure times + 5 right-censored times, fitted with a Nelder–Mead
  // maximisation of the censored likelihood in SciPy:
  //   shape 1.9011539632984158, scale 237.87201602846025
  //   MTTF 211.0748104260446, B10 72.82416484187354, B50 196.16346790807896
  //   B5 49.87006847009987, B90 368.8650220733207
  const times = [42, 58, 71, 84, 96, 103, 118, 126, 141, 155, 168, 183, 197, 214, 236, 258, 281, 305, 342, 388, 120, 175, 240, 300, 360];
  const censored = times.map((_, i) => i >= 20);

  it('matches the censored MLE and the life percentiles', () => {
    const result = fitWeibull(times.map((time, i) => ({ time, censored: censored[i] })));
    expect(result.shape).toBeCloseTo(1.9011539632984158, 6);
    expect(result.scale).toBeCloseTo(237.87201602846025, 4);
    expect(result.mttf).toBeCloseTo(211.0748104260446, 4);
    expect(result.b10).toBeCloseTo(72.82416484187354, 4);
    expect(result.median).toBeCloseTo(196.16346790807896, 4);
    expect(result.b5).toBeCloseTo(49.87006847009987, 4);
    expect(result.b90).toBeCloseTo(368.8650220733207, 4);
    expect(result.failures).toBe(20);
    expect(result.censored).toBe(5);
  });

  it('reduces to the complete-data MLE when nothing is censored', () => {
    // scipy.stats.weibull_min.fit(times[:20], floc=0) → shape 1.1578632685, scale 124.8955317
    const complete = [24, 29, 31, 37, 41, 44, 48, 52, 58, 63, 71, 86, 94, 112, 133, 158, 196, 255, 342, 480];
    const result = fitWeibull(complete.map((time) => ({ time, censored: false })));
    expect(result.shape).toBeCloseTo(1.1578632685145558, 6);
    expect(result.scale).toBeCloseTo(124.89553167601156, 4);
  });
});

describe('nonnormal capability by fitted percentiles (scipy reference)', () => {
  // Same 25 times as above; fits with floc=0 in SciPy, LSL 60, USL 330:
  //   Weibull   shape 2.0966534, scale 215.6662936 → Pp 0.5177009, Ppk 0.4258707, PPM 153305.84
  //   Lognormal σ 0.5807761, μ(ln) 4.0987 → Pp 0.2977773, Ppk 0.2153934, PPM 155784.39
  //   Gamma     shape 3.4762229, scale 54.7835991 → Pp 0.4313807, Ppk 0.3343324, PPM 150062.00
  const values = [42, 58, 71, 84, 96, 103, 118, 126, 141, 155, 168, 183, 197, 214, 236, 258, 281, 305, 342, 388, 120, 175, 240, 300, 360];

  it('Weibull fit and percentile indices', () => {
    const result = nonnormalCapability(values, 'weibull', { lsl: 60, usl: 330 });
    expect(result.fit.params.shape).toBeCloseTo(2.0966534197322946, 4);
    expect(result.fit.params.scale).toBeCloseTo(215.66629361020824, 3);
    expect(result.pp).toBeCloseTo(0.5177009109238854, 4);
    expect(result.ppk).toBeCloseTo(0.4258706811296548, 4);
    expect(result.ppm).toBeCloseTo(153305.84397198333, 1);
    expect(result.p00135).toBeCloseTo(9.230671290966287, 4);
    expect(result.p99865).toBeCloseTo(530.7673236375111, 3);
  });

  it('lognormal fit and percentile indices', () => {
    const result = nonnormalCapability(values, 'lognormal', { lsl: 60, usl: 330 });
    expect(result.fit.params.shape).toBeCloseTo(0.5807760500435688, 6);
    expect(result.fit.params.scale).toBeCloseTo(5.098661798314366, 6);
    expect(result.pp).toBeCloseTo(0.2977772668290824, 4);
    expect(result.ppk).toBeCloseTo(0.21539336438820322, 4);
    expect(result.ppm).toBeCloseTo(155784.38768973824, 1);
  });

  it('gamma fit and percentile indices', () => {
    const result = nonnormalCapability(values, 'gamma', { lsl: 60, usl: 330 });
    expect(result.fit.params.shape).toBeCloseTo(3.476222868085823, 4);
    expect(result.fit.params.scale).toBeCloseTo(54.78359910360566, 3);
    expect(result.pp).toBeCloseTo(0.43138071641599735, 4);
    expect(result.ppk).toBeCloseTo(0.3343324449466802, 4);
    expect(result.ppm).toBeCloseTo(150061.9989656775, 1);
  });
});

describe('power and sample size (scipy noncentral t / F reference)', () => {
  it('1-sample t: n=20, δ=0.5, σ=1, α=0.05 two-sided', () => {
    // scipy: nct.cdf(-t.ppf(0.975,19),19,0.5·√20) + 1 − nct.cdf(…,19,0.5·√20) = 0.5645044184390209
    const result = solvePower({ method: 'oneT', solveFor: 'power', n: 20, difference: 0.5, sd: 1, alpha: 0.05, alternative: 'two-sided' });
    expect(result.power).toBeCloseTo(0.5645044184390209, 7);
  });

  it('2-sample t: n=20 per group, δ=0.5, σ=1', () => {
    // scipy: df=38, ncp=0.5·√(20/2) → 0.337939028925041
    const result = solvePower({ method: 'twoT', solveFor: 'power', n: 20, difference: 0.5, sd: 1, alpha: 0.05, alternative: 'two-sided' });
    expect(result.power).toBeCloseTo(0.337939028925041, 7);
  });

  it('one-way ANOVA: n=8 per level, 3 levels, δ=2, σ=1', () => {
    // scipy: 1 − ncf.cdf(F.ppf(0.95,2,21), 2, 21, ncp = 8·3·4/4) = 0.9876763526558214
    const result = solvePower({ method: 'anova', solveFor: 'power', n: 8, difference: 2, sd: 1, groups: 3, alpha: 0.05, alternative: 'two-sided' });
    expect(result.power).toBeCloseTo(0.9876763526558214, 7);
  });

  it('solves the smallest sample size that reaches 90 % power', () => {
    // The power at n=43 is 0.8951… and at n=44 is 0.9000305… (scipy), so n = 44.
    const result = solvePower({ method: 'oneT', solveFor: 'n', difference: 0.5, sd: 1, power: 0.9, alpha: 0.05, alternative: 'two-sided' });
    expect(result.n).toBe(44);
    expect(result.power).toBeGreaterThanOrEqual(0.9);
  });

  it('solves the difference that reaches 90 % power at n=30', () => {
    const result = solvePower({ method: 'oneT', solveFor: 'difference', n: 30, sd: 1, power: 0.9, alpha: 0.05, alternative: 'two-sided' });
    // Round-trip: the solved difference must reproduce the target power.
    const check = solvePower({ method: 'oneT', solveFor: 'power', n: 30, difference: result.difference, sd: 1, alpha: 0.05, alternative: 'two-sided' });
    expect(check.power).toBeCloseTo(0.9, 4);
  });
});
