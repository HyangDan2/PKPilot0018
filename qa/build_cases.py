#!/usr/bin/env python3
"""Builds the QA case files under qa/cases/.

Keeping the cases in a generator makes the field lists, tolerances and notes one
reviewable source instead of a dozen hand-edited JSON blobs. The generated JSON
is committed and is what the comparator reads.

Run: python3 qa/build_cases.py
"""

from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "cases")


def f(key, tol=None, kind=None):
    d = {"key": key}
    if tol:
        d["tol"] = tol
    if kind:
        d["kind"] = kind
    return d


def case(cid, title, op, dataset=None, args=None, fields=None, tol="default", verdict=None, expect=None, note=""):
    c = {"id": cid, "title": title, "op": op, "tolerance": tol}
    if dataset:
        c["dataset"] = dataset
    if args:
        c["args"] = args
    if fields:
        c["fields"] = fields
    if verdict:
        c["verdict"] = verdict
    if expect:
        c["expectError"] = expect
    if note:
        c["note"] = note
    return c


def write(name, area, cases):
    payload = {"area": area, "cases": cases}
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"  {name}: {len(cases)} cases")


# ── shared field sets ────────────────────────────────────────────────────
DESC = [f(k) for k in ("n", "n_star", "sum", "mean", "se_mean", "stdev", "variance", "coef_var",
                       "min", "q1", "median", "q3", "max", "iqr", "range", "skewness", "kurtosis")]
TTEST = [f(k) for k in ("mean", "difference", "se", "df", "t", "p", "ci_low", "ci_high", "n", "stdev")]
T2 = TTEST + [f(k) for k in ("mean_b", "n_b", "stdev_b", "f", "f_p")]
PAIRED = [f(k) for k in ("mean", "mean_b", "difference", "difference_vs_mu0", "se", "df", "t", "p",
                         "ci_low", "ci_high", "n", "stdev")]
ANOVA = [f(k) for k in ("df_between", "df_within", "ss_between", "ss_within", "ms_between", "ms_within",
                        "f", "p", "s_pooled")]
CAP = [f(k) for k in ("n", "mean", "sd_within", "sd_overall", "cp", "cpk", "cpl", "cpu", "pp", "ppk",
                      "ppl", "ppu", "cpm")]
CAP_PPM = [f("ppm_within", "ppm"), f("ppm_overall", "ppm"), f("ppm_observed"), f("sigma_level", "sigma_level")]
WEIB = [
    f("shape", "mle"), f("scale", "mle"), f("se_shape", "mle_se"), f("se_scale", "mle_se"),
    f("ci_shape_low", "mle_se"), f("ci_shape_high", "mle_se"), f("ci_scale_low", "mle_se"), f("ci_scale_high", "mle_se"),
    f("loglik", "mle"), f("mttf", "mle"), f("mttf_low", "mle_se"), f("mttf_high", "mle_se"),
    f("median", "mle"), f("b10", "mle"), f("b5", "mle"), f("b90", "mle"),
    f("n"), f("failures"), f("censored"), f("ad", "mle"), f("ad_adjusted", "mle"),
    f("ad_basis", kind="string"), f("ad_bootstrap_p", "bootstrap_p"),
    f("km_dev", "mle"), f("km_critical05"),
]
GLM_TERMS = lambda names: [
    f(f"term:{n}:{k}") for n in names for k in ("df", "ss_seq", "ss_adj", "ms_adj", "f", "p")
]
GLM = [f("n"), f("dfe"), f("sse"), f("mse"), f("s"), f("ss_total"), f("ss_model"), f("r2"), f("r2_adj"), f("rank")]

areas = {}

# ════════════════════════════════════════════════════════════════════════
# QA-A — 기초 통계 / basic statistics
# ════════════════════════════════════════════════════════════════════════
A = []
A.append(case("QA-A-01", "기술통계 전체 항목 (n=60 정규)", "desc", "balanced_normal",
              {"column": "x"}, DESC))
A.append(case("QA-A-02", "기술통계 결측 포함 (N* 7건)", "desc", "missing_values",
              {"column": "x"}, DESC))
A.append(case("QA-A-03", "소표본 n=6 사분위수·왜도 (type-6 quantile)", "desc", "small_sample",
              {"column": "a"}, [f(k) for k in ("n", "mean", "stdev", "se_mean", "q1", "median", "q3", "iqr", "skewness", "kurtosis")],
              note="n<4 이면 첨도 정의 불가 → 양쪽 모두 NaN이어야 한다."))
A.append(case("QA-A-04", "상수열 s=0, 왜도/변동계수 정의", "desc", "constant_zero",
              {"column": "flat"}, DESC, note="영분산에서는 왜도·첨도·CoefVar가 NaN."))
A.append(case("QA-A-05", "이상치 2건 포함 분포 모양", "desc", "outliers", {"column": "x"}, DESC))
A.append(case("QA-A-06", "대규모 8 000행 수치 안정성", "desc", "large_stability",
              {"column": "x"}, DESC))
A.append(case("QA-A-07", "정규성 AD (정규 데이터)", "normality", "balanced_normal", {"column": "x"},
              [f("n"), f("mean"), f("sd"), f("ad", "ad_erf"), f("ad_adjusted", "ad_erf"), f("p", "ad_erf")]))
A.append(case("QA-A-08", "정규성 AD (이상치 → p 극소)", "normality", "outliers", {"column": "x"},
              [f("ad", "ad_erf"), f("ad_adjusted", "ad_erf"), f("p", "ad_erf")]))
A.append(case("QA-A-09", "정규성 AD 소표본 n=6", "normality", "small_sample", {"column": "a"},
              [f("n"), f("ad", "ad_erf"), f("ad_adjusted", "ad_erf"), f("p", "ad_erf")]))
A.append(case("QA-A-10", "정규성 AD 상수열 → 정의 불가(NaN)", "normality", "constant_zero", {"column": "flat"},
              [f("n"), f("ad", "ad_erf"), f("p", "ad_erf")], note="s=0이면 A²·p는 NaN (n=12)."))
A.append(case("QA-A-11", "1표본 t (양측, μ0=100)", "t1", "balanced_normal", {"column": "x", "mu0": 100}, TTEST))
A.append(case("QA-A-12", "1표본 t 단측 less, 90% CI", "t1", "balanced_normal",
              {"column": "x", "mu0": 101, "alt": "less", "conf": 0.9}, TTEST))
A.append(case("QA-A-13", "1표본 t 단측 greater, 99% CI", "t1", "balanced_normal",
              {"column": "x", "mu0": 99, "alt": "greater", "conf": 0.99}, TTEST))
A.append(case("QA-A-14", "1표본 t 결측 포함", "t1", "missing_values", {"column": "x", "mu0": 20}, TTEST))
A.append(case("QA-A-15", "2표본 t Welch", "t2", "small_sample", {"column": "a", "column2": "b", "welch": True}, T2))
A.append(case("QA-A-16", "2표본 t 등분산(pooled)", "t2", "small_sample",
              {"column": "a", "column2": "b", "welch": False}, T2))
A.append(case("QA-A-17", "2표본 t 단측 greater 90%", "t2", "balanced_normal",
              {"column": "x", "column2": "y", "alt": "greater", "conf": 0.9}, T2,
              note="단측 구간의 반대쪽 한계는 ±∞ — 두 구현 모두 Infinity로 태그해야 한다."))
A.append(case("QA-A-18", "대응표본 t (차이 μ0=0)", "paired", "small_sample",
              {"column": "a", "column2": "b"}, PAIRED))
A.append(case("QA-A-19", "대응표본 t 차이 검정 μ0=0.5, 단측", "paired", "small_sample",
              {"column": "a", "column2": "b", "mu0": 0.5, "alt": "greater"}, PAIRED))
A.append(case("QA-A-20", "대응표본 t 결측쌍 제외 (n=34)", "paired", "missing_values",
              {"column": "x", "column2": "y"}, PAIRED, note="x·y 둘 다 있는 행만 짝이 된다."))
A.append(case("QA-A-21", "일원 ANOVA + Tukey HSD (3집단)", "anova", "balanced_normal",
              {"response": "x", "factor": "group"},
              ANOVA + [f("tukey_q", "studentized_range")] + [
                  f(f"tukey:{a}|{b}:{k}", "studentized_range" if k in ("ci_low", "ci_high", "p") else None)
                  for a, b in (("A", "B"), ("A", "C"), ("B", "C"))
                  for k in ("diff", "se", "ci_low", "ci_high", "p", "significant")]))
A.append(case("QA-A-22", "일원 ANOVA 불균형 3집단 (12/9/6)", "anova", "unbalanced",
              {"response": "resp", "factor": "fa"}, ANOVA + [f("tukey_q", "studentized_range")]))
A.append(case("QA-A-23", "회귀 y ~ x (VIF·R²pred 포함)", "regression", "balanced_normal",
              {"response": "y", "predictors": ["x"]},
              [f(k) for k in ("coef:Constant", "se:Constant", "t:Constant", "p:Constant",
                              "coef:x", "se:x", "t:x", "p:x", "vif:x",
                              "r2", "r2_adj", "r2_pred", "s", "n", "df_reg", "df_err",
                              "ss_reg", "ss_err", "f", "p")]))
A.append(case("QA-A-24", "회귀 2예측변수 (DOE 설계, VIF=1)", "regression", "doe_2k3",
              {"response": "Y", "predictors": ["A", "B"]},
              [f(f"{k}:{t}") for t in ("Constant", "A", "B") for k in ("coef", "se", "t", "p")]
              + [f("vif:A"), f("vif:B"), f("r2"), f("r2_adj"), f("r2_pred"), f("s"), f("f"), f("p")]))

DIST_CASES = [
    ("QA-A-25", "normalCdf(1.96)", "normalCdf", [1.96], "prob"),
    ("QA-A-26", "normalCdf(-2.5, 10, 2)", "normalCdf", [-2.5, 10, 2], "prob"),
    ("QA-A-27", "normalInv(0.975)", "normalInv", [0.975], "normal_inv"),
    ("QA-A-28", "normalPdf(0.3)", "normalPdf", [0.3], "prob"),
    ("QA-A-47", "normalInv(0.001) 꼬리", "normalInv", [0.001], "normal_inv"),
    ("QA-A-48", "normalInv(0.9999) 꼬리", "normalInv", [0.9999], "normal_inv"),
    ("QA-A-29", "tCdf(2.1, 9)", "tCdf", [2.1, 9], "default"),
    ("QA-A-30", "tInv(0.95, 12)", "tInv", [0.95, 12], "default"),
    ("QA-A-31", "fCdf(2.5, 3, 20)", "fCdf", [2.5, 3, 20], "default"),
    ("QA-A-32", "fInv(0.95, 4, 12)", "fInv", [0.95, 4, 12], "default"),
    ("QA-A-33", "chi2Cdf(7.8, 5)", "chi2Cdf", [7.8, 5], "default"),
    ("QA-A-34", "gammaP(3.5, 2.2)", "gammaP", [3.5, 2.2], "default"),
    ("QA-A-35", "gammaInv(0.9, 2.5, 3)", "gammaInv", [0.9, 2.5, 3], "default"),
    ("QA-A-36", "weibullCdf(120, 1.7, 200)", "weibullCdf", [120, 1.7, 200], "default"),
    ("QA-A-37", "weibullInv(0.9, 1.7, 200)", "weibullInv", [0.9, 1.7, 200], "default"),
    ("QA-A-38", "lognormalCdf(150, 4.8, 0.4)", "lognormalCdf", [150, 4.8, 0.4], "default"),
    ("QA-A-39", "lognormalInv(0.05, 4.8, 0.4)", "lognormalInv", [0.05, 4.8, 0.4], "default"),
    ("QA-A-40", "nctCdf(1.5, 10, 2)", "nctCdf", [1.5, 10, 2], "nct_quad"),
    ("QA-A-41", "ncfCdf(2.0, 3, 20, 4)", "ncfCdf", [2.0, 3, 20, 4], "default"),
    ("QA-A-42", "studentized range CDF (q=3.5, k=4, df=18)", "rangeCdf", [3.5, 4, 18], "studentized_range"),
    ("QA-A-43", "studentized range 분위수 (0.95, k=3, df=9)", "rangeInv", [0.95, 3, 9], "studentized_range"),
    ("QA-A-44", "logGamma(7.5)", "logGamma", [7.5], "default"),
    ("QA-A-45", "c4(5) 관리도 상수", "c4", [5], "default"),
    ("QA-A-46", "nctCdf 대자유도 (df=254, ncp=4)", "nctCdf", [-1.969, 254, 4.0], "nct_quad",
     ),
]
for item in DIST_CASES:
    cid, title, fn, args, tol = item[:5]
    A.append(case(cid, title, "dist", None, {"function": fn, "args": args}, [f("value", tol)], tol=tol))

areas["QA-A-basic.json"] = ("QA-A", A)

# ════════════════════════════════════════════════════════════════════════
# QA-B — ANOVA / GLM
# ════════════════════════════════════════════════════════════════════════
B = []
B.append(case("QA-B-01", "일원 ANOVA 4집단 n=2000씩 (대규모)", "anova", "large_stability",
              {"response": "x", "factor": "group"},
              ANOVA + [f("tukey_q", "studentized_range")]))
B.append(case("QA-B-02", "GLM 2요인 + 교호작용, 불균형 Type I/III", "glm", "unbalanced",
              {"response": "resp",
               "factors": [{"name": "fa", "column": "fa", "kind": "categorical"},
                           {"name": "fb", "column": "fb", "kind": "categorical"}],
               "terms": [["fa"], ["fb"], ["fa", "fb"]]},
              GLM + GLM_TERMS(["fa", "fb", "fa×fb"]),
              note="Sum-to-zero 코딩의 Type III SS가 statsmodels C(f, Sum) anova_lm(typ=3)와 일치해야 한다."))
B.append(case("QA-B-03", "GLM 주효과만 (교호작용 제외) 불균형", "glm", "unbalanced",
              {"response": "resp",
               "factors": [{"name": "fa", "column": "fa", "kind": "categorical"},
                           {"name": "fb", "column": "fb", "kind": "categorical"}],
               "terms": [["fa"], ["fb"]]},
              GLM + GLM_TERMS(["fa", "fb"])))
B.append(case("QA-B-04", "GLM 숫자형 요인 3개 (2^3 DOE) Type I/III", "glm", "doe_2k3",
              {"response": "Y",
               "factors": [{"name": "A", "column": "A", "kind": "numeric"},
                           {"name": "B", "column": "B", "kind": "numeric"},
                           {"name": "C", "column": "C", "kind": "numeric"}],
               "terms": [["A"], ["B"], ["C"], ["A", "B"]]},
              GLM + GLM_TERMS(["A", "B", "C", "A×B"])))
B.append(case("QA-B-05", "GLM 결측 행 제외 후 적합", "glm", "missing_values",
              {"response": "y",
               "factors": [{"name": "group", "column": "group", "kind": "categorical"}],
               "terms": [["group"]]},
              GLM + GLM_TERMS(["group"])))
B.append(case("QA-B-06", "GLM 숫자형+범주형 혼합, 중심점에서 rank-deficient (모형 불변량 검증)", "glm", "doe_2k3",
              {"response": "Y",
               "factors": [{"name": "A", "column": "A", "kind": "numeric"},
                           {"name": "B", "column": "B", "kind": "categorical"}],
               "terms": [["A"], ["B"], ["A", "B"]]},
              GLM + [f("aliased_count")] + [f(f"fitted[{i}]") for i in range(10)] + [f(f"residuals[{i}]") for i in range(10)],
              note=(
                  "B를 범주형으로 선언하면 중심점(A=0, B=0) 때문에 설계 행렬이 rank-deficient가 된다: "
                  "유일 종속은 A − A·B[−1] + 2·A·B[0] = 0 (즉 A·B[0] = (A·B[−1] − A)/2). "
                  "rank-deficient 설계에서는 어느 열을 alias로 버릴지 일반화역행렬마다 다르다 — 엔진(열 피벗 QR)은 A 계열을, "
                  "statsmodels(pinv)은 A×B 쪽을 버려 term별 df·SS·F가 달라진다. 이는 계산 오류가 아니라 "
                  "alias 흡수 정책 차이이므로, 항 수준 검증은 여기서 하지 않고(QA-B-02~04가 full-rank 항 검증을 담당) "
                  "일반화역행렬에 무관한 모형 불변량(n, dfe, sse, mse, s, ss_total, ss_model, r2, r2_adj, rank, "
                  "aliased_count, fitted, residuals)으로 엄격 검증한다. UI는 res.glmAliased로 alias 열을 명시한다.")))

areas["QA-B-anova-glm.json"] = ("QA-B", B)

# ════════════════════════════════════════════════════════════════════════
# QA-C — SPC
# ════════════════════════════════════════════════════════════════════════
def panel_fields(prefix, idx_count=None, limit_tol="chart_constants"):
    keys = [f(f"{prefix}.center", limit_tol), f(f"{prefix}.ucl", limit_tol), f(f"{prefix}.lcl", limit_tol),
            f(f"{prefix}.sigma", limit_tol)]
    if idx_count:
        keys += [f(f"{prefix}.points[{i}]") for i in range(idx_count)]
    keys += [f(f"{prefix}.rule{r}_points") for r in range(1, 9)]
    return keys


C = []
C.append(case("QA-C-01", "I-MR (24개 개별값)", "imr", "subgroups", {"column": "v1"},
              [f("i.center"), f("i.ucl", "chart_constants"), f("i.lcl", "chart_constants"), f("i.sigma", "chart_constants"),
               f("i.points[0]"), f("i.points[23]"),
               f("mr.center"), f("mr.ucl", "chart_constants"), f("mr.lcl"), f("mr.sigma", "chart_constants"),
               f("mr.points[0]"), f("sigma_within", "chart_constants"), f("out_of_control")]
              + [f(f"i.rule{r}_points") for r in range(1, 9)] + [f(f"mr.rule{r}_points") for r in range(1, 9)]))
C.append(case("QA-C-02", "I-MR 이상치 포함 (규칙 1 검출)", "imr", "outliers", {"column": "x"},
              [f("i.center"), f("i.ucl", "chart_constants"), f("i.sigma", "chart_constants"),
               f("out_of_control"), f("i.rule1_points"), f("i.rule2_points"), f("i.rule8_points")]))
C.append(case("QA-C-03", "Xbar-R n=5, 결측 1개 부분군 (n_i 변화)", "xbarr", "subgroups",
              {"column": "v5", "subgroup": 5},
              [f("xbar.center"), f("sigma_within", "chart_constants"), f("sg_used"), f("sg_total"), f("sg_skipped"),
               f("sg_leftover"), f("sg_missing"), f("sg_varying")]
              + [f(f"xbar.ucl[{i}]", "chart_constants") for i in range(12)]
              + [f(f"r.ucl[{i}]", "chart_constants") for i in range(12)]
              + [f(f"xbar.points[{i}]") for i in range(12)] + [f(f"r.points[{i}]") for i in range(12)]
              + [f("out_of_control")] + [f(f"xbar.rule{r}_points") for r in range(1, 9)]
              + [f(f"r.rule{r}_points") for r in range(1, 9)]))
C.append(case("QA-C-04", "Xbar-R n=2 (Montgomery d2(2) 경계)", "xbarr", "subgroups",
              {"column": "vmix", "subgroup": 2},
              [f("xbar.center"), f("sigma_within", "chart_constants"), f("sg_used"), f("r.center", "chart_constants"),
               f("r.ucl[0]", "chart_constants"), f("r.sigma[0]", "chart_constants")]))
C.append(case("QA-C-05", "Xbar-R n=10 (표 상한)", "xbarr", "subgroups",
              {"column": "vmix", "subgroup": 10},
              [f("xbar.center"), f("sigma_within", "chart_constants"), f("sg_used"), f("sg_leftover"),
               f("r.ucl[0]", "chart_constants")]))
C.append(case("QA-C-06", "Xbar-S n=12 (c4 기반, R표 범위 밖)", "xbars", "subgroups",
              {"column": "v12", "subgroup": 12},
              [f("xbar.center"), f("s.center"), f("sigma_within"), f("sg_used")]
              + [f(f"xbar.ucl[{i}]") for i in range(3)] + [f(f"s.ucl[{i}]") for i in range(3)]
              + [f(f"s.points[{i}]") for i in range(3)]
              + [f("out_of_control")] + [f(f"xbar.rule{r}_points") for r in range(1, 9)]))
C.append(case("QA-C-07", "Xbar-S 그룹ID 방식 (n_i 2~6 가변)", "xbars", "subgroups",
              {"column": "vid", "groupIds": "sid"},
              [f("xbar.center"), f("s.center"), f("sigma_within"), f("sg_used"), f("sg_skipped")]
              + [f(f"xbar.ucl[{i}]") for i in range(8)] + [f(f"s.ucl[{i}]") for i in range(8)]
              + [f(f"s.sigma[{i}]") for i in range(8)]))
C.append(case("QA-C-08", "P chart 부분군 크기 열 (50/100 혼합)", "pchart", "attribute",
              {"column": "defectives", "sizesColumn": "sizes"},
              [f("p.center"), f("sigma_within")] + [f(f"p.ucl[{i}]") for i in range(20)]
              + [f(f"p.points[{i}]") for i in range(20)] + [f("out_of_control")]
              + [f(f"p.rule{r}_points") for r in range(1, 9)]))
C.append(case("QA-C-09", "P chart 고정 부분군 크기 100", "pchart", "attribute",
              {"column": "defectives", "sampleSize": 100},
              [f("p.center"), f("p.ucl[0]"), f("p.lcl[0]"), f("sigma_within")]))
C.append(case("QA-C-10", "NP chart (n=100)", "npchart", "attribute",
              {"column": "defectives", "sampleSize": 100},
              [f("np.center"), f("np.ucl"), f("np.lcl"), f("np.sigma"), f("out_of_control")]
              + [f(f"np.rule{r}_points") for r in range(1, 9)]))
C.append(case("QA-C-11", "C chart 결함수", "cchart", "attribute", {"column": "defects"},
              [f("c.center"), f("c.ucl"), f("c.lcl"), f("c.sigma"), f("out_of_control")]
              + [f(f"c.rule{r}_points") for r in range(1, 9)]))
C.append(case("QA-C-12", "U chart 단위 크기 열 (1~4)", "uchart", "attribute",
              {"column": "defects", "unitsColumn": "units"},
              [f("u.center")] + [f(f"u.ucl[{i}]") for i in range(20)] + [f(f"u.lcl[{i}]") for i in range(20)]
              + [f("sigma_within"), f("out_of_control")]))
C.append(case("QA-C-13", "U chart 고정 단위 크기 2", "uchart", "attribute",
              {"column": "defects", "unitSize": 2},
              [f("u.center"), f("u.ucl[0]"), f("u.lcl[0]"), f("u.sigma[0]")]))
C.append(case("QA-C-14", "Nelson 규칙 1~8 전수 (중심 10, σ 1)", "nelson", "nelson",
              {"column": "x", "center": 10, "sigma": 1},
              [f(f"rules[{i}]", kind="string") for i in range(56)] + [f("flagged")],
              note="각 규칙이 설계된 위치에서만 발화하는지 점별 규칙 목록을 문자열로 비교한다."))
C.append(case("QA-C-15", "P chart 결측 크기(0) → 엔진 검증 오류", "pchart", "attribute",
              {"column": "defects", "sampleSize": 0}, None, expect="spc.invalid",
              note="SpcValidationError는 'spc.invalid' 코드로 던져지고 issues에 size가 담긴다."))
C.append(case("QA-C-16", "Xbar-R 부분군 부족 → noGroups 오류", "xbarr", "tiny",
              {"column": "p3", "subgroup": 5}, None, expect="spc.invalid"))

areas["QA-C-spc.json"] = ("QA-C", C)

# ════════════════════════════════════════════════════════════════════════
# QA-D — Capability
# ════════════════════════════════════════════════════════════════════════
D = []
D.append(case("QA-D-01", "Cp/Cpk/Pp/Ppk 양측 규격 (이동범위 σ)", "capability", "balanced_normal",
              {"column": "x", "lsl": 85, "usl": 115}, CAP + CAP_PPM))
D.append(case("QA-D-02", "Cpm 목표값 지정", "capability", "balanced_normal",
              {"column": "x", "lsl": 85, "usl": 115, "target": 100}, CAP + CAP_PPM))
D.append(case("QA-D-03", "단측 규격 LSL만", "capability", "balanced_normal",
              {"column": "x", "lsl": 90}, CAP + CAP_PPM, note="Cp/Pp는 NaN, Cpk=Cpl."))
D.append(case("QA-D-04", "단측 규격 USL만", "capability", "balanced_normal",
              {"column": "x", "usl": 110}, CAP + CAP_PPM))
D.append(case("QA-D-05", "부분군 5의 풀링 within σ", "capability", "subgroups",
              {"column": "v5", "lsl": 85, "usl": 115, "subgroup": 5}, CAP + CAP_PPM))
D.append(case("QA-D-06", "시그마 수준 방식 z_bench", "capability", "balanced_normal",
              {"column": "x", "lsl": 85, "usl": 115, "sigmaMethod": "z_bench"}, [f("sigma_level", "sigma_level")]))
D.append(case("QA-D-07", "시그마 수준 방식 cpk_shift", "capability", "balanced_normal",
              {"column": "x", "lsl": 85, "usl": 115, "sigmaMethod": "cpk_shift"},
              [f("cpk"), f("sigma_level", "sigma_level")]))
D.append(case("QA-D-08", "Sixpack n=1 (I-MR 기반)", "sixpack", "subgroups",
              {"column": "v1", "lsl": 40, "usl": 60},
              [f("chart", kind="string"), f("sigma_basis", kind="string"), f("sigma_within", "chart_constants"),
               f("cp"), f("cpk"), f("pp"), f("ppk"), f("ppm_within", "ppm"), f("ppm_overall", "ppm"),
               f("ad", "ad_erf"), f("ad_p", "ad_erf"), f("primary.center"), f("primary.ucl", "chart_constants"),
               f("secondary.center"), f("secondary.ucl", "chart_constants"), f("says_within")]))
D.append(case("QA-D-09", "Sixpack n=5 (Xbar-R 기반, R̄/d2 공유)", "sixpack", "subgroups",
              {"column": "v5", "lsl": 85, "usl": 115, "subgroup": 5},
              [f("chart", kind="string"), f("sigma_basis", kind="string"), f("sigma_within", "chart_constants"),
               f("cp"), f("cpk"), f("ppm_within", "ppm"), f("ad", "ad_erf"),
               f("primary.center"), f("primary.ucl[0]", "chart_constants"),
               f("secondary.center"), f("secondary.ucl[0]", "chart_constants")]))
D.append(case("QA-D-10", "Sixpack n=12 (Xbar-S 기반, S̄/c4 공유)", "sixpack", "subgroups",
              {"column": "v12", "lsl": 5, "usl": 10, "subgroup": 12},
              [f("chart", kind="string"), f("sigma_basis", kind="string"), f("sigma_within"),
               f("cp"), f("cpk"), f("ppm_within", "ppm"), f("ad", "ad_erf"),
               f("primary.ucl[0]"), f("secondary.ucl[0]"), f("missing_subgroups")]))
D.append(case("QA-D-11", "Sixpack n=5 결측 부분군 포함", "sixpack", "subgroups",
              {"column": "v5", "lsl": 85, "usl": 115, "subgroup": 5},
              [f("sigma_within", "chart_constants"), f("missing_subgroups"), f("cp"), f("cpk")]))
D.append(case("QA-D-12", "비정규 능력 Weibull MLE", "capnonnormal", "balanced_normal",
              {"column": "x", "distribution": "weibull", "lsl": 80, "usl": 120},
              [f("n"), f("excluded"), f("shape", "mle"), f("scale", "mle"), f("loglik", "mle"),
               f("ad", "mle"), f("ad_adjusted", "mle"), f("median", "mle"), f("p00135", "mle"),
               f("p99865", "mle"), f("pp", "mle"), f("ppk", "mle"), f("ppl", "mle"), f("ppu", "mle"),
               f("ppm", "ppm"), f("observed_ppm")]))
D.append(case("QA-D-13", "비정규 능력 Lognormal", "capnonnormal", "large_stability",
              {"column": "x", "distribution": "lognormal", "lsl": 400, "usl": 620},
              [f("n"), f("shape", "mle"), f("scale", "mle"), f("ad", "mle"), f("pp", "mle"),
               f("ppk", "mle"), f("median", "mle"), f("ppm", "ppm")]))
D.append(case("QA-D-14", "비정규 능력 Gamma", "capnonnormal", "censored_mixed",
              {"column": "time", "distribution": "gamma", "lsl": 50, "usl": 400},
              [f("n"), f("shape", "mle"), f("scale", "mle"), f("ad", "mle"), f("pp", "mle"),
               f("ppk", "mle"), f("ppm", "ppm")]))
D.append(case("QA-D-15", "비정규 적합: 0·음수 제외 보고 (excluded=3)", "capnonnormal", "constant_zero",
              {"column": "negmix", "distribution": "weibull", "specs": False},
              [f("n"), f("excluded"), f("shape", "mle"), f("scale", "mle"), f("ad", "mle"),
               f("crit10"), f("crit5"), f("crit1")],
              note="(0,∞) 지지 밖 값은 조용히 버리지 않고 excluded로 보고해야 한다."))
D.append(case("QA-D-16", "비정규 적합 n<5 → res.insufficient (엔진 정의)", "capnonnormal", "tiny",
              {"column": "p3", "distribution": "weibull", "lsl": 0, "usl": 10}, None, expect="res.insufficient"))
D.append(case("QA-D-17", "Sixpack 상수열 → AD 정의 불가(NaN)", "sixpack", "constant_zero",
              {"column": "flat", "lsl": 4, "usl": 6},
              [f("cp"), f("cpk"), f("ad", "ad_erf"), f("ad_p", "ad_erf"), f("sigma_within")],
              note="s=0이면 Cp/Cpk·AD가 NaN — 0으로 나눈 값이 아니라 정의 불가."))

areas["QA-D-capability.json"] = ("QA-D", D)

# ════════════════════════════════════════════════════════════════════════
# QA-E — Gage R&R
# ════════════════════════════════════════════════════════════════════════
def grr_fields(pooled=False):
    out = [f("parts"), f("operators"), f("replicates"), f("grr_variance"), f("total_variance"), f("ndc")]
    sources = ("part", "operator", "interaction", "repeat") if not pooled else ("part", "operator", "repeat")
    for s in sources:
        out += [f(f"anova:{s}:df"), f(f"anova:{s}:ss"), f(f"anova:{s}:ms"), f(f"anova:{s}:f"), f(f"anova:{s}:p")]
    for name in (("repeat", "operator", "partToPart", "grr", "total") if pooled else
                 ("repeat", "reproducibility", "interaction", "operator", "partToPart", "grr", "total")):
        out += [f(f"comp:{name}:variance"), f(f"comp:{name}:stdev"), f(f"comp:{name}:contribution"),
                f(f"comp:{name}:studyvar")]
    return out


E = []
E.append(case("QA-E-01", "Crossed 균형 10×3×2 분산성분", "gagerr", "gage_crossed",
              {"part": "part", "operator": "operator", "measurement": "meas", "type": "crossed"},
              grr_fields() + [f("note", kind="string"), f("negative_components", kind="string")]))
E.append(case("QA-E-02", "Crossed 공차 %Tolerance 포함", "gagerr", "gage_crossed",
              {"part": "part", "operator": "operator", "measurement": "meas", "tolerance": 4.0},
              [f("comp:grr:variance"), f("comp:grr:tolerance"), f("comp:repeat:tolerance"),
               f("comp:partToPart:tolerance")]))
E.append(case("QA-E-03", "Crossed 교호작용 풀링 (poolInteraction)", "gagerr", "gage_crossed",
              {"part": "part", "operator": "operator", "measurement": "meas", "poolInteraction": True},
              grr_fields(pooled=True) + [f("note", kind="string")]))
E.append(case("QA-E-04", "Nested 3교대×4부품×3반복", "gagerr", "gage_nested",
              {"part": "part", "operator": "operator", "measurement": "meas", "type": "nested"},
              [f("parts"), f("operators"), f("replicates"), f("grr_variance"), f("total_variance"), f("ndc")]
              + [f(f"anova:{s}:{k}") for s in ("operator", "partOperator", "repeat") for k in ("df", "ss", "ms", "f", "p")]
              + [f(f"comp:{n}:{k}") for n in ("repeat", "reproducibility", "operator", "partToPart", "grr", "total")
                 for k in ("variance", "stdev", "contribution", "studyvar")]))
E.append(case("QA-E-05", "음수 분산성분 보고 (operator)", "gagerr", "gage_negative",
              {"part": "part", "operator": "operator", "measurement": "meas"},
              grr_fields() + [f("negative_components", kind="string"), f("note", kind="string")],
              note="Minitab처럼 음수 성분은 부호를 유지하고 stdev만 0 — clamped 값 비교가 아니다."))
E.append(case("QA-E-06", "불균형 Crossed → grr.unbalanced 거부", "gagerr", "gage_unbalanced",
              {"part": "part", "operator": "operator", "measurement": "meas"}, None, expect="grr.unbalanced"))
E.append(case("QA-E-07", "공유 부품을 Nested로 선언 → grr.nestedPartShared 거부", "gagerr", "gage_crossed",
              {"part": "part", "operator": "operator", "measurement": "meas", "type": "nested"}, None,
              expect="grr.nestedPartShared",
              note="Crossed 자료를 Nested로 분석하면 부품이 교대 간 공유되므로 Nested 가정 위반 — 명시적 거부."))

areas["QA-E-gagerr.json"] = ("QA-E", E)

# ════════════════════════════════════════════════════════════════════════
# QA-F — Reliability
# ════════════════════════════════════════════════════════════════════════
Fc = []
Fc.append(case("QA-F-01", "Weibull 완전데이터 MLE + AD + 신뢰구간", "weibull", "censored_mixed",
               {"column": "time"}, WEIB,
               note="censor 열을 주지 않으면 전부 고장으로 본다(40건 완전데이터)."))
Fc.append(case("QA-F-02", "Weibull 우측 중도절단 25/40", "weibull", "censored_mixed",
               {"column": "time", "censorColumn": "censor1"}, WEIB,
               note="AD는 고장 시각에 대해서만, A* 보정은 고장 수 k 기준, p는 모수적 부트스트랩."))
Fc.append(case("QA-F-03", "Weibull 중도절단 6/25 (80% 생존)", "weibull", "censored_heavy",
               {"column": "time", "censorColumn": "censor1"}, WEIB))
Fc.append(case("QA-F-04", "Weibull 고장 3/30 극한 (소수 고장)", "weibull", "censored_few",
               {"column": "time", "censorColumn": "censor1"}, WEIB,
               note="부트스트랩 반복 중 고장 2개 미만 보정이 개입하는 구간 — QA-F 실험 대상."))
Fc.append(case("QA-F-05", "Weibull 고장 2/20 최소 (추정 가능 경계)", "weibull", "censored_two",
               {"column": "time", "censorColumn": "censor1"}, WEIB))
Fc.append(case("QA-F-06", "Weibull 90% 신뢰수준", "weibull", "censored_mixed",
               {"column": "time", "censorColumn": "censor1", "conf": 0.9},
               [f("ci_shape_low", "mle_se"), f("ci_shape_high", "mle_se"), f("ci_scale_low", "mle_se"),
                f("ci_scale_high", "mle_se"), f("mttf_low", "mle_se"), f("mttf_high", "mle_se")]))
Fc.append(case("QA-F-07", "Weibull 99% 신뢰수준", "weibull", "censored_mixed",
               {"column": "time", "censorColumn": "censor1", "conf": 0.99},
               [f("ci_shape_low", "mle_se"), f("ci_scale_low", "mle_se"), f("mttf_low", "mle_se")]))
Fc.append(case("QA-F-08", "Lognormal 완전데이터 (폐형 MLE)", "lognorm_rel", "censored_mixed",
               {"column": "time"},
               [f("mu", "nelder_mead"), f("sigma", "nelder_mead"), f("median", "nelder_mead"),
                f("mttf", "nelder_mead"), f("loglik", "nelder_mead"), f("closed_form"), f("n"), f("failures")]))
Fc.append(case("QA-F-09", "Lognormal 중도절단 MLE", "lognorm_rel", "censored_mixed",
               {"column": "time", "censorColumn": "censor1"},
               [f("mu", "nelder_mead"), f("sigma", "nelder_mead"), f("mttf", "nelder_mead"),
                f("loglik", "nelder_mead"), f("censored"), f("closed_form"),
                f("se_mu", "mle_se"), f("se_sigma", "mle_se")]))
Fc.append(case("QA-F-12", "강한 비-Weibull(혼합) → 기각력 유지", "weibull", "censored_mixture",
               {"column": "time", "censorColumn": "censor1"}, WEIB,
               note="2봉 혼합 표본(15×~20, 15×~180, 150 상한) — 보정 후에도 총체적 위반은 기각되어야 한다(p≈0.002)."))
Fc.append(case("QA-F-10", "고장 1건 → rel.needFailures", "weibull", "censored_one",
               {"column": "time", "censorColumn": "censor1", "conf": 0.95}, None, expect="rel.needFailures"))
Fc.append(case("QA-F-11", "고장 1건 로그노말 → rel.needFailures", "lognorm_rel", "censored_one",
               {"column": "time", "censorColumn": "censor1"}, None, expect="rel.needFailures"))

areas["QA-F-reliability.json"] = ("QA-F", Fc)

# ════════════════════════════════════════════════════════════════════════
# QA-G — Power & sample size
# ════════════════════════════════════════════════════════════════════════
POW = [f("n"), f("power", "nct_quad"), f("difference")]
G = []
G.append(case("QA-G-01", "1표본 t 표본크기 (δ=0.5, 90%)", "power",
              None, {"method": "oneT", "solveFor": "n", "difference": 0.5, "sd": 1, "power": 0.9, "alpha": 0.05, "alt": "two-sided"}, POW))
G.append(case("QA-G-02", "1표본 t 검정력 (n=30, δ=0.4)", "power",
              None, {"method": "oneT", "solveFor": "power", "difference": 0.4, "sd": 1, "n": 30, "alpha": 0.05, "alt": "two-sided"}, POW))
G.append(case("QA-G-03", "1표본 t 효과크기 역산 (n=25, 80%)", "power",
              None, {"method": "oneT", "solveFor": "difference", "n": 25, "sd": 2, "power": 0.8, "alpha": 0.05, "alt": "two-sided"}, POW))
G.append(case("QA-G-04", "2표본 t 표본크기 (δ=0.5, 90%)", "power",
              None, {"method": "twoT", "solveFor": "n", "difference": 0.5, "sd": 1, "power": 0.9, "alpha": 0.05, "alt": "two-sided"}, POW,
              note="n은 그룹당 표본수. df=2(n−1)가 커지면 비중심 t 구적이 넘치던 구간(엔진 결함 F-01)을 지난다."))
G.append(case("QA-G-05", "2표본 t 검정력 (n=128, δ=0.5)", "power",
              None, {"method": "twoT", "solveFor": "power", "difference": 0.5, "sd": 1, "n": 128, "alpha": 0.05, "alt": "two-sided"}, POW,
              note="df=254 — 엔진의 nctCdf가 NaN을 내던 정확한 지점."))
G.append(case("QA-G-06", "2표본 t 단측 greater 80%", "power",
              None, {"method": "twoT", "solveFor": "n", "difference": 0.4, "sd": 1, "power": 0.8, "alpha": 0.05, "alt": "greater"}, POW))
G.append(case("QA-G-07", "대응 t 표본크기 (δ=0.3, 95%)", "power",
              None, {"method": "paired", "solveFor": "n", "difference": 0.3, "sd": 1, "power": 0.95, "alpha": 0.05, "alt": "two-sided"}, POW))
G.append(case("QA-G-08", "ANOVA 표본크기 (3집단, δ=1.0)", "power",
              None, {"method": "anova", "solveFor": "n", "difference": 1.0, "sd": 1, "groups": 3, "power": 0.9, "alpha": 0.05}, POW))
G.append(case("QA-G-09", "ANOVA 검정력 (4집단, n=20, δ=0.8)", "power",
              None, {"method": "anova", "solveFor": "power", "difference": 0.8, "sd": 1, "groups": 4, "n": 20, "alpha": 0.05}, POW))
G.append(case("QA-G-10", "1비율 표본크기 (0.5→0.6, 90%)", "power",
              None, {"method": "oneProp", "solveFor": "n", "p1": 0.5, "p2": 0.6, "power": 0.9, "alpha": 0.05, "alt": "two-sided"}, POW))
G.append(case("QA-G-11", "1비율 검정력 (n=200, 0.3→0.36)", "power",
              None, {"method": "oneProp", "solveFor": "power", "p1": 0.3, "p2": 0.36, "n": 200, "alpha": 0.05, "alt": "greater"},
              [f("n"), f("power", "prob"), f("difference")]))
G.append(case("QA-G-12", "1비율 양측 비대칭 효과 역산 (p0=0.2, n=100)", "power",
              None, {"method": "oneProp", "solveFor": "difference", "p1": 0.2, "n": 100, "power": 0.8, "alpha": 0.05, "alt": "two-sided"},
              [f("n"), f("power", "prob"), f("difference", "search_grid"), f("opposite_difference", "search_grid")],
              note="p0=0.2에서 위·아래 방향의 유효 범위가 비대칭(−0.2 vs +0.8) — 작은 |d|와 반대 방향 임계값을 함께 보고해야 한다."))
G.append(case("QA-G-13", "2비율 표본크기 (0.4→0.6, 90%)", "power",
              None, {"method": "twoProp", "solveFor": "n", "p1": 0.4, "p2": 0.6, "power": 0.9, "alpha": 0.05, "alt": "two-sided"},
              [f("n"), f("power", "prob"), f("difference")]))
G.append(case("QA-G-14", "2비율 검정력 (n=150, 0.5→0.58) 단측", "power",
              None, {"method": "twoProp", "solveFor": "power", "p1": 0.5, "p2": 0.58, "n": 150, "alpha": 0.05, "alt": "greater"},
              [f("n"), f("power", "prob"), f("difference")]))
G.append(case("QA-G-15", "2비율 효과크기 역산 (n=120)", "power",
              None, {"method": "twoProp", "solveFor": "difference", "p1": 0.35, "n": 120, "power": 0.8, "alpha": 0.05, "alt": "two-sided"},
              [f("difference", "search_grid"), f("opposite_difference", "search_grid"), f("power", "prob")]))
G.append(case("QA-G-16", "단측 대립가설에 반대방향 효과 → α 미만 검정력", "power",
              None, {"method": "oneT", "solveFor": "power", "difference": -0.4, "sd": 1, "n": 30, "alpha": 0.05, "alt": "greater"}, POW,
              note="부호를 무시하고 |δ| 검정력을 내면 0.68이 나온다 — 반대방향은 α 미만이어야 한다."))
G.append(case("QA-G-17", "단측 대립가설에 반대효과 → power.unreachable", "power",
              None, {"method": "oneProp", "solveFor": "n", "p1": 0.5, "p2": 0.45, "power": 0.9, "alpha": 0.05, "alt": "greater"},
              None, expect="power.unreachable",
              note="greater 검정에서 p₂<p₁은 검정력이 α를 넘을 수 없다 — 큰 n을 임의로 답하지 않고 거부해야 한다."))
G.append(case("QA-G-21", "실질적으로 달성 불가한 미세효과 (n 상한 1e7)", "power",
              None, {"method": "oneProp", "solveFor": "n", "p1": 0.5, "p2": 0.5001, "power": 0.999, "alpha": 0.05},
              None, expect="power.unreachable",
              note="수학적으로는 n≈3e8에서 도달하지만 엔진은 1e7 상한을 두고 unreachable로 답한다 — 정책 상한도 계약의 일부로 함께 검증."))
G.append(case("QA-G-18", "효과 0 → power.unreachable", "power",
              None, {"method": "oneT", "solveFor": "n", "difference": 0, "sd": 1, "power": 0.9, "alpha": 0.05},
              None, expect="power.unreachable"))
G.append(case("QA-G-19", "비율 범위 밖 (p2=0.05에서 −0.1)", "power",
              None, {"method": "oneProp", "solveFor": "n", "p1": 0.05, "p2": -0.05, "power": 0.8, "alpha": 0.05},
              None, expect="power.unreachable"))
G.append(case("QA-G-20", "목표 검정력 0.5 (α 이하 요구)", "power",
              None, {"method": "oneT", "solveFor": "n", "difference": 0.5, "sd": 1, "power": 0.03, "alpha": 0.05},
              None, expect="power.unreachable", note="target ≤ α 는 의미 없는 요구 — 명시적 거부."))

areas["QA-G-power.json"] = ("QA-G", G)

# ════════════════════════════════════════════════════════════════════════
# QA-H — DOE / RSM
# ════════════════════════════════════════════════════════════════════════
def design_fields(n_runs, k, ptypes=()):
    out = [f("runs")] + [f(f"run[{i}]:{key}") for i in range(n_runs) for key in ("std", "run")]
    out += [f(f"run[{i}]:f{j}") for i in range(n_runs) for j in range(k)]
    out += [f(f"ptype:{p}") for p in ptypes]
    return out


H = []
H.append(case("QA-H-01", "2^3 요인설계 표준·실행순서 (랜덤화)", "doecreate",
              None, {"k": 3, "centers": 2, "replicates": 1, "randomize": True, "seed": 20261122},
              design_fields(10, 3, ("Factorial", "Center")),
              note="표준순서는 조합 정의, 실행순서는 문서화된 mulberry32 셔플."))
H.append(case("QA-H-02", "2^2 반복 2회, 랜덤화 없음", "doecreate",
              None, {"k": 2, "replicates": 2, "centers": 0, "randomize": False}, design_fields(8, 2, ("Factorial",))))
H.append(case("QA-H-03", "2^4 설계 (16런 + 중심 3점)", "doecreate",
              None, {"k": 4, "centers": 3, "replicates": 1, "randomize": True, "seed": 7}, design_fields(19, 4, ("Factorial", "Center"))))
H.append(case("QA-H-04", "CCD k=2 (α=2^0.75, 중심 5점)", "rsmcreate",
              None, {"design": "ccd", "k": 2, "centers": 5, "randomize": True, "seed": 20261122},
              design_fields(13, 2, ("Factorial", "Axial", "Center"))))
H.append(case("QA-H-05", "Box-Behnken 3요인 (12 edge + 중심 3)", "rsmcreate",
              None, {"design": "bbd", "centers": 3, "randomize": True, "seed": 20261122},
              design_fields(15, 3, ("Edge", "Center"))))
H.append(case("QA-H-06", "요인분석 2^3 효과·계수·p", "doeanalyze", "doe_2k3",
              {"response": "Y", "factors": ["A", "B", "C"], "order": 2},
              [f(f"{k}:{t}") for t in ("A", "B", "C", "A×B", "A×C", "B×C") for k in ("effect", "coef", "se", "t", "p")]
              + [f("sse"), f("dfe"), f("r2"), f("r2_adj"), f("s")]))
H.append(case("QA-H-07", "요인분석 주효과만 (order 1)", "doeanalyze", "doe_2k3",
              {"response": "Y", "factors": ["A", "B", "C"], "order": 1},
              [f(f"{k}:{t}") for t in ("A", "B", "C") for k in ("effect", "coef", "se", "t", "p")]
              + [f("sse"), f("dfe"), f("r2")]))
H.append(case("QA-H-08", "RSM 2차 적합 + 정지점 (영역 내)", "rsmanalyze", "rsm_ccd",
              {"response": "Y", "factors": ["x", "y"]},
              [f("linear:df"), f("linear:ss"), f("square:df"), f("square:ss"), f("interaction:df"), f("interaction:ss"),
               f("pure:df"), f("pure:ss"), f("lof:df"), f("lof:ss"), f("lof:f"), f("lof:p"),
               f("qcoef:x"), f("qcoef:y"), f("qcoef:x²"), f("qcoef:y²"), f("qcoef:x×y"),
               f("stationary:x0"), f("stationary:x1"), f("stationary:response"),
               f("stationary:eigen0"), f("stationary:eigen1"), f("stationary:kind", kind="string"),
               f("stationary:max_abs"), f("stationary:outside"), f("sse"), f("dfe"), f("r2")]))
H.append(case("QA-H-09", "RSM 정지점 실험영역 밖 판별", "rsmanalyze", "rsm_outside",
              {"response": "Y", "factors": ["x", "y"]},
              [f("stationary:x0"), f("stationary:x1"), f("stationary:response"), f("stationary:max_abs"),
               f("stationary:outside"), f("stationary:kind", kind="string"), f("lof:p")],
              note="정지점 (2.08, 2.08) > α=1.1892 → outside=1, 외삽 경고."))
H.append(case("QA-H-10", "요인 수 범위 밖 (k=7) → 오류", "doecreate", None, {"k": 7}, None, expect="doe.factorRange"))

areas["QA-H-doe-rsm.json"] = ("QA-H", H)

# ════════════════════════════════════════════════════════════════════════
# QA-X — 경계·교차 확인
# ════════════════════════════════════════════════════════════════════════
X = []
X.append(case("QA-X-01", "Weibull n=2 → res.insufficient", "weibull", "tiny",
              {"column": "p2"}, None, expect="res.insufficient"))
X.append(case("QA-X-02", "상수 예측변수 → res.constantPredictor", "regression", "constant_zero",
              {"response": "zeros", "predictors": ["flat"]}, None, expect="res.constantPredictor"))
X.append(case("QA-X-03", "회귀 데이터 부족 → not-enough-data", "regression", "tiny",
              {"response": "y2", "predictors": ["x2"]}, None, expect="not-enough-data"))
X.append(case("QA-X-04", "t검정 상수열 s=0 (t 정의 경계)", "t1", "constant_zero",
              {"column": "flat", "mu0": 5}, [f("t"), f("p"), f("se"), f("mean"), f("ci_low"), f("ci_high")],
              note="se=0 규약(QA-X-04/05/06): t와 p는 정의 불가(NaN) — 0도 ±∞도 아니다. CI는 추정값의 축퇴구간 [m, m]. scipy ttest_1samp도 NaN을 낸다."))
X.append(case("QA-X-05", "2표본 상수열 → t NaN", "t2", "constant_zero",
              {"column": "flat", "column2": "zeros"}, [f("t"), f("p"), f("se"), f("df"), f("f")],
              note="분산 0 두 집단: se=0이면 t·p 정의 불가(NaN). scipy.stats.ttest_ind는 여기서 p=0.0을 내므로 참조 엔진이 같은 NaN 규약을 명시적으로 구현한다."))
X.append(case("QA-X-06", "대응표본 상수 차이 → t NaN (0/±∞ 규약 폐지)", "paired", "constant_zero",
              {"column": "flat", "column2": "zeros", "mu0": 5},
              [f("t"), f("p"), f("se"), f("df"), f("mean"), f("mean_b"), f("difference"), f("difference_vs_mu0"), f("stdev")],
              note="모든 차이가 5로 동일: 이전 규약은 |m−μ₀|≤1e-12이면 t=0, 아니면 ±∞였지만 상수 자료는 방향에 대한 근거도 없으므로 t·p 모두 NaN으로 통일. m−μ₀=0인 경계(정확히 일치)에서도 NaN."))

areas["QA-X-edge.json"] = ("QA-X", X)

os.makedirs(OUT, exist_ok=True)
print("building cases →", OUT)
for name, (area, cases) in areas.items():
    write(name, area, cases)
print("total:", sum(len(v[1]) for v in areas.values()))

# ════════════════════════════════════════════════════════════════════════
# QA-I — 계산기(수식 엔진)
# ════════════════════════════════════════════════════════════════════════
I = []
I.append(case("QA-I-01", "수식 C1 * 2 + 1", "calc", "balanced_normal",
              {"columns": ["x"], "formula": "C1 * 2 + 1"},
              [f("rows"), f("errors")] + [f(f"value[{i}]") for i in (0, 29, 59)]))
I.append(case("QA-I-02", "수식 (C1 - MEAN(C1)) / STDEV(C1)", "calc", "balanced_normal",
              {"columns": ["x"], "formula": "(C1 - MEAN(C1)) / STDEV(C1)"},
              [f("rows"), f("errors")] + [f(f"value[{i}]") for i in (0, 17, 59)]))
I.append(case("QA-I-03", "수식 ROUND(C1 / 3, 2) — 결측 행은 오류 카운트", "calc", "missing_values",
              {"columns": ["x"], "formula": "ROUND(C1 / 3, 2)"},
              [f("rows"), f("errors")] + [f(f"value[{i}]") for i in (0, 7)]))
I.append(case("QA-I-04", "두 열 합 C1 + C2", "calc", "balanced_normal",
              {"columns": ["x", "y"], "formula": "C1 + C2"},
              [f("rows"), f("errors")] + [f(f"value[{i}]") for i in (0, 41, 59)]))
areas["QA-I-calc.json"] = ("QA-I", I)

# ════════════════════════════════════════════════════════════════════════
# QA-U — 차트 규칙과 시트 변환 (출하 러너를 실제로 호출해 검증)
# ════════════════════════════════════════════════════════════════════════
# Each case drives the SAME run function the browser UI calls
# (findAnalysis(id).run) through the adapter, and the Python reference
# re-derives the same quantities from the documented rules. The chart/bin
# visualisation rules are part of the app's contract, so the reference
# implements those rules independently (source: charts.ts doc comments)
# instead of leaving the cases UNVERIFIED.
CH = "charts"
U = []
U.append(case("QA-U-01", "파레토 차트 (정렬·빈도·누적%)", "sheet", CH,
              {"analysis": "pareto", "emit": "pareto", "values": {"category": "C2"}},
              [f("items"), f("total")]
              + [f(f"label[{i}]", kind="string") for i in range(9)]
              + [f(f"count[{i}]") for i in range(9)]
              + [f(f"pct[{i}]") for i in range(9)]
              + [f(f"cum[{i}]") for i in range(9)],
              note="빈도·내림 정렬은 불변 검증, %·누적%는 러너 표의 표시 규칙(소수 1자리 반올림)을 양쪽이 같은 규칙으로 계산해 비교한다. 결측 5행은 세지 않는다."))
U.append(case("QA-U-02", "히스토그램 (빈 경계·도수 합·정규곡선)", "sheet", CH,
              {"analysis": "histogram", "emit": "histogram", "values": {"variable": "C6", "bins": 0, "normal": True}},
              [f("n"), f("bins"), f("bin_lo0"), f("bin_hi_last")]
              + [f(f"count[{i}]") for i in range(7)]
              + [f("curve_mean"), f("curve_sd")]
              + [f(f"curve_x[{i}]") for i in (0, 60, 120)]
              + [f(f"curve_y[{i}]") for i in (0, 60, 120)],
              note="빈 규칙(자동: max(5, min(20, ceil(1+log2 n)))=7)과 도수 합=n은 문서화된 시각화 규칙을 독립 구현해 검증한다. 정규곡선은 n·binWidth·φ(x; m, s), 121점 격자."))
U.append(case("QA-U-03", "상자그림 (사분위·수염·이상치)", "sheet", CH,
              {"analysis": "boxplot", "emit": "boxplot", "values": {"variables": ["C6"]}},
              [f("groups"), f("g[0]_label", kind="string"), f("g[0]_n"), f("g[0]_q1"), f("g[0]_median"),
               f("g[0]_q3"), f("g[0]_iqr"), f("g[0]_low_fence"), f("g[0]_high_fence"),
               f("g[0]_whisker_low"), f("g[0]_whisker_high"), f("g[0]_mean"), f("g[0]_outliers"),
               f("g[0]_outlier[0]"), f("g[0]_outlier[1]")],
              note="사분위는 type-6(h=(n+1)p, QA-A-01과 동일), 수염은 1.5·IQR 울타리 안쪽의 극값, 울타리 밖은 이상치로 나열한다."))
U.append(case("QA-U-04", "산점도 (적합선 기울기·절편·군별 매핑)", "sheet", CH,
              {"analysis": "scatter", "emit": "scatter", "values": {"y": "C5", "x": "C4", "by": ["C3"]}},
              [f("n"), f("slope"), f("intercept"), f("groups")]
              + [f(f"g[{i}]_label", kind="string") for i in range(3)]
              + [f(f"g[{i}]_n") for i in range(3)],
              note="적합선은 최소제곱 회귀(QA-A-23과 동일 정의, scipy linregress로 검증), 군별 매핑은 x·y가 모두 수치인 행의 by 라벨 첫등장 순."))
U.append(case("QA-U-05", "시계열 plot (규격선·시퀀스 값)", "sheet", CH,
              {"analysis": "timeseries", "emit": "timeseries",
               "values": {"variable": "C6", "lsl": "40", "usl": "60", "target": "50"}},
              [f("length"), f("n"), f("mean"), f("min"), f("max"), f("lsl"), f("usl"), f("target")],
              note="유한값 시퀀스 통계와 규격선(LSL/USL/Target)의 값·존재 여부를 검증한다. 결측은 선에서 건너뛰지만 length는 원본 길이."))
U.append(case("QA-U-06", "정렬 (열 전체 행 이동·결측 마지막)", "sheet", CH,
              {"analysis": "sort", "emit": "sheet", "emitColumns": ["value", "id"],
               "values": {"column": "C6", "descending": False}},
              [f("columns")] + [f(f"value[{i}]") for i in range(60)] + [f(f"id[{i}]") for i in range(60)],
              note="오름차순·결측 마지막·안정 정렬. id 열이 함께 이동해 행 무결성을 검증한다."))
U.append(case("QA-U-07", "표준화 (Z 점수 저장·결측 보존)", "sheet", CH,
              {"analysis": "standardize", "emit": "sheet", "emitColumns": ["Std value"],
               "values": {"column": "C6", "storeIn": ""}},
              [f("columns"), f("z_mean"), f("z_sd")] + [f(f"Std value[{i}]") for i in range(60)],
              note="z=(x−m)/s(표본 표준편차)를 새 열로 저장하고 결측은 null로 보존한다. z의 평균≈0·표준편차≈1도 함께 검증."))
U.append(case("QA-U-08", "코드 변환 (1=10, 2=20, 3=30·미매핑 보존)", "sheet", CH,
              {"analysis": "recode", "emit": "sheet", "emitColumns": ["Recode code"],
               "values": {"column": "C7", "mapping": "1=10, 2=20, 3=30", "fallback": ""}},
              [f("columns"), f("count:10"), f("count:20"), f("count:30"), f("count:9")]
              + [f(f"Recode code[{i}]") for i in range(60)],
              note="매핑 1→10·2→20·3→30, fallback 미지정이면 미매핑 값(9)을 보존하고 결측은 null로 유지한다."))
U.append(case("QA-U-09", "난수 생성 (시드 결정성·길이·모멘트)", "sheet", CH,
              {"analysis": "random", "emit": "sheet", "emitColumns": ["Random data"], "runs": 2,
               "values": {"distribution": "normal", "count": 5000, "mean": 10, "sd": 2,
                          "min": 0, "max": 10, "seed": 20261121, "storeIn": "Random data"}},
              [f("columns"), f("n"), f("mean", "moment_mean"), f("sd", "moment_sd"),
               f("repeat_max_diff"), f("all_finite")],
              note=(
                  "생성기 자체가 대상이라 독립 기준값은 모평균/모표준편차(10/2)뿐이다. 허용오차는 표본오차에서 온다: "
                  "n=5000 정규 표본의 평균 표준오차 σ/√n=0.0283 → 4σ=0.113, s의 표준오차≈σ/√(2n)=0.02 → 4σ=0.08. "
                  "동일 시드 재실행 차이(repeat_max_diff)와 유한성은 정확 일치로 검증하고, 결정성 회귀테스트와 E2E도 함께 둔다.")))
areas["QA-U-charts-transforms.json"] = ("QA-U", U)

# ════════════════════════════════════════════════════════════════════════
# QA-V — Stage 3B: 3D 표면과 중첩 등고선
# ════════════════════════════════════════════════════════════════════════
ALPHA_CCD = 2 ** 0.25
RANGE_CCD = [-ALPHA_CCD, ALPHA_CCD]

V = []
SURFACE_PROBES = [[0, 0], [10, 10], [20, 20], [40, 40], [25, 40]]
V.append(case(
    "QA-V-01", "3D 표면 = 2D 등고선 (41×41, coded, 실험점 5개 지점)", "surface3d", "rsm_ccd",
    {
        "response": "Y", "factors": ["x", "y"], "resolution": 41, "mode": "coded",
        "xRange": RANGE_CCD, "yRange": RANGE_CCD, "probes": SURFACE_PROBES,
    },
    [f("surface_contour_max_diff", "exact_zero"), f("grid_points"),
     f("z_min"), f("z_max"), f("x_min"), f("x_max"), f("y_min"), f("y_max"),
     f("coefficient_count"), f("centre_value"), f("centre_se")]
    + [f(f"z[{i}]") for i in range(len(SURFACE_PROBES))]
    + [f(f"z_contour[{i}]") for i in range(len(SURFACE_PROBES))],
    note=(
        "독립 기준은 statsmodels 2차 적합의 격자 예측값이다. 어댑터의 두 경로(컴파일 평가기와 modelSurface의 행별 설계행렬)는 "
        "같은 산술을 쓰므로 그 차이(surface_contour_max_diff)는 정확히 0이어야 한다 — exact_zero 클래스가 이를 강제한다."
    ),
))
V.append(case(
    "QA-V-02", "3D 표면 21×21 격자 + 중심 SE (정지점 부근)", "surface3d", "rsm_outside",
    {
        "response": "Y", "factors": ["x", "y"], "resolution": 21, "mode": "coded",
        "xRange": RANGE_CCD, "yRange": RANGE_CCD, "probes": [[0, 20], [20, 20], [20, 0], [10, 10]],
    },
    [f("surface_contour_max_diff", "exact_zero"), f("grid_points"), f("z_min"), f("z_max"),
     f("centre_value"), f("centre_se")]
    + [f(f"z[{i}]") for i in range(4)] + [f(f"z_contour[{i}]") for i in range(4)],
    note="영역 밖 정지점을 가진 표면에서도 격자 예측과 2D 경로가 일치하는지 확인한다.",
))
V.append(case(
    "QA-V-03", "중첩 등고선 — 두 반응 동시 만족 영역 (예측 평균 기준)", "feasible", "rsm_two",
    {
        "factors": ["x", "y"], "x": "x", "y": "y", "resolution": 21, "mode": "coded", "basis": "mean",
        "alpha": 0.05, "xRange": RANGE_CCD, "yRange": RANGE_CCD,
        "responses": [
            {"name": "Y1", "lsl": 50.0, "usl": 62.0, "target": 58.0},
            {"name": "Y2", "lsl": 28.0, "usl": 46.0, "target": 36.0},
        ],
        "probes": [[0, 0], [10, 10], [20, 20], [5, 15], [15, 5]],
    },
    [f("node_ratio", "feasible_area"), f("area_ratio_fine", "feasible_area"),
     f("feasible_nodes", "grid_count"), f("total_nodes"), f("narrow"),
     f("probe_feasible", kind="string"),
     f("response_0_node_ratio", "feasible_area"), f("response_1_node_ratio", "feasible_area")]
    + [f(f"z_{r}[{i}]") for r in (0, 1) for i in range(5)],
    note=(
        "독립 기준은 statsmodels로 두 반응을 따로 적합해 같은 격자에서 규격을 판정한 것이다. 만족 비율은 격자 근사이므로 "
        "feasible_area 클래스(4배 격자 구적과 폴리곤 면적의 반 셀 편향)를 쓴다. probe_feasible은 정확 일치."
    ),
))
V.append(case(
    "QA-V-04", "중첩 등고선 — 신뢰구간 기준 (구간이 규격 안에)", "feasible", "rsm_two",
    {
        "factors": ["x", "y"], "x": "x", "y": "y", "resolution": 21, "mode": "coded", "basis": "confidence",
        "alpha": 0.05, "xRange": RANGE_CCD, "yRange": RANGE_CCD,
        "responses": [
            {"name": "Y1", "lsl": 50.0, "usl": 62.0, "target": 58.0},
            {"name": "Y2", "lsl": 28.0, "usl": 46.0, "target": 36.0},
        ],
        "probes": [[20, 20], [10, 10], [30, 30]],
    },
    [f("node_ratio", "feasible_area"), f("area_ratio_fine", "feasible_area"),
     f("probe_feasible", kind="string"), f("interval_blocked", kind="string"),
     f("response_0_node_ratio", "feasible_area"), f("response_1_node_ratio", "feasible_area")],
    note=(
        "구간 기준은 ŷ±t·SE 전체가 규격 안에 들어야 만족이다. 어댑터가 공분산을 저장하므로(RsmModelPayload) "
        "비활성 목록(interval_blocked)은 비어 있어야 한다. 기준 엔진은 statsmodels cov_params로 같은 t를 계산한다."
    ),
))
V.append(case(
    "QA-V-05", "중첩 등고선 — 예측구간 기준", "feasible", "rsm_two",
    {
        "factors": ["x", "y"], "x": "x", "y": "y", "resolution": 21, "mode": "coded", "basis": "prediction",
        "alpha": 0.05, "xRange": RANGE_CCD, "yRange": RANGE_CCD,
        "responses": [
            {"name": "Y1", "lsl": 50.0, "usl": 62.0, "target": 58.0},
            {"name": "Y2", "lsl": 28.0, "usl": 46.0, "target": 36.0},
        ],
        "probes": [[20, 20], [10, 10], [30, 30]],
    },
    [f("node_ratio", "feasible_area"), f("area_ratio_fine", "feasible_area"),
     f("probe_feasible", kind="string"),
     f("response_0_node_ratio", "feasible_area"), f("response_1_node_ratio", "feasible_area")],
    note="예측구간은 ŷ±t·√(SE²+mse) 전체가 규격 안에 들어야 하므로 신뢰구간보다 항상 좁거나 같다(QA-V-04와 대조).",
))
V.append(case(
    "QA-V-06", "중첩 등고선 — 만족 영역이 없는 규격", "feasible", "rsm_two",
    {
        "factors": ["x", "y"], "x": "x", "y": "y", "resolution": 11, "mode": "coded", "basis": "mean",
        "alpha": 0.05, "xRange": RANGE_CCD, "yRange": RANGE_CCD,
        "responses": [
            {"name": "Y1", "lsl": 1000.0, "usl": 2000.0, "target": 1500.0},
            {"name": "Y2", "lsl": 28.0, "usl": 46.0, "target": 36.0},
        ],
        "probes": [[0, 0], [10, 10]],
    },
    [f("feasible_nodes"), f("node_ratio"), f("narrow", kind="number"),
     f("probe_feasible", kind="string"), f("area_ratio_fine")],
    note="만족 격자점 0 → narrow=1 경고. 면적비 0.",
))
areas["QA-V-stage3b-surface.json"] = ("QA-V", V)

for name, (area, cases) in [
    ("QA-I-calc.json", areas["QA-I-calc.json"]),
    ("QA-U-charts-transforms.json", areas["QA-U-charts-transforms.json"]),
    ("QA-V-stage3b-surface.json", areas["QA-V-stage3b-surface.json"]),
]:
    write(name, area, cases)
print("total:", sum(len(v[1]) for v in areas.values()))
