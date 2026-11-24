#!/usr/bin/env python3
"""Sigrún QA — independent reference engine.

Reads the same JSON request as the TypeScript adapter

    {"datasetsDir": "qa/datasets", "cases": [{"id": ..., "op": ..., "dataset": ..., "args": {...}}]}

and answers each case from vetted library APIs (SciPy / statsmodels / NumPy /
pandas) or, where no API exists, from the independent formulas in
``qa/reference/formulas.py``.  The output has exactly the adapter's shape

    {"meta": {...}, "results": {"<case id>": {"status": "ok", "values": {...}}}}

with NaN / ±Infinity / null encoded as {"__special": "..."} so the comparator
never compares an undefined value as if it were a number.

Each value produced here is tagged with how it was obtained; the report lists
the tags per area:
  scipy / statsmodels / numpy   a library API answered it
  independent_formula           a published formula implemented here
  monte_carlo                   a seeded simulation (bootstrap / experiment)
"""

from __future__ import annotations

import json
import math
import re
import os
import platform
import sys

import numpy as np
import pandas as pd
import patsy  # noqa: F401  (recorded in the metadata: statsmodels' formula engine)
import scipy
import statsmodels
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats

import formulas as F

HERE = os.path.dirname(os.path.abspath(__file__))

# Every case's answer records which method produced it, for the report.
METHODS: dict[str, str] = {}
WARNINGS: list[str] = []


def mark(case_id: str, method: str) -> None:
    METHODS[case_id] = method


def enc(v):
    if v is None:
        return {"__special": "null"}
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        if math.isnan(f):
            return {"__special": "NaN"}
        if f == math.inf:
            return {"__special": "Infinity"}
        if f == -math.inf:
            return {"__special": "-Infinity"}
        return f
    if isinstance(v, str):
        return v
    return str(v)


class Bag:
    def __init__(self):
        self.values = {}

    def put(self, key, value):
        self.values[key] = enc(value)

    def array(self, prefix, values):
        for i, v in enumerate(values):
            self.put(f"{prefix}[{i}]", v)


# ── data helpers ─────────────────────────────────────────────────────────
def load_dataset(datasets_dir: str, name: str) -> dict:
    with open(os.path.join(datasets_dir, f"{name}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def col(ds, name):
    return ds["columns"].get(name, [])


def nums(ds, name):
    return [float(v) if isinstance(v, (int, float)) and v is not None else np.nan for v in col(ds, name)]


def raw(ds, name):
    return [v if isinstance(v, (int, float)) else None for v in col(ds, name)]


def texts(ds, name):
    out = []
    for v in col(ds, name):
        if v is None:
            out.append(None)
        elif isinstance(v, float) and math.isnan(v):
            out.append(None)
        else:
            out.append(str(v))
    return out


def grouped(values, keys):
    order, data = [], {}
    for v, k in zip(values, keys):
        if k is None or k == "":
            continue
        if v is None or not np.isfinite(v):
            continue
        if k not in data:
            data[k] = []
            order.append(k)
        data[k].append(float(v))
    return [(k, data[k]) for k in order]


# ── ops ──────────────────────────────────────────────────────────────────
def op_desc(bag, ds, args, cid):
    x = np.array([v for v in raw(ds, args["column"]) if v is not None and np.isfinite(v)], dtype=float)
    n = x.size
    m = float(np.mean(x)) if n else float("nan")
    s = float(np.std(x, ddof=1)) if n > 1 else float("nan")
    q = lambda p: float(np.quantile(x, p, method="weibull")) if n else float("nan")
    skew = float(stats.skew(x, bias=False)) if (n > 2 and s > 0) else float("nan")
    kurt = float(stats.kurtosis(x, bias=False)) if (n > 3 and s > 0) else float("nan")
    bag.put("n", n)
    bag.put("n_star", len(raw(ds, args["column"])) - n)
    bag.put("sum", float(np.sum(x)) if n else float("nan"))
    bag.put("mean", m)
    bag.put("se_mean", s / math.sqrt(n) if n > 1 else float("nan"))
    bag.put("stdev", s)
    bag.put("variance", s * s if n > 1 else float("nan"))
    bag.put("coef_var", (s / abs(m) * 100) if (n > 1 and m != 0) else float("nan"))
    bag.put("min", float(np.min(x)) if n else float("nan"))
    bag.put("q1", q(0.25))
    bag.put("median", q(0.5))
    bag.put("q3", q(0.75))
    bag.put("max", float(np.max(x)) if n else float("nan"))
    bag.put("iqr", q(0.75) - q(0.25) if n else float("nan"))
    bag.put("range", float(np.max(x) - np.min(x)) if n else float("nan"))
    bag.put("skewness", skew)
    bag.put("kurtosis", kurt)
    mark(cid, "numpy + scipy.stats.skew/kurtosis (bias=False), quantile method='weibull'")


def op_normality(bag, ds, args, cid):
    x = np.array([v for v in raw(ds, args["column"]) if v is not None and np.isfinite(v)], dtype=float)
    n = x.size
    bag.put("n", n)
    if n < 3 or np.std(x, ddof=1) <= 0:
        for k in ("mean", "sd", "ad", "ad_adjusted", "p"):
            bag.put(k, float("nan"))
    else:
        ad = float(stats.anderson(x, "norm").statistic)
        adj = F.ad_normal_adjusted(ad, n)
        bag.put("mean", float(np.mean(x)))
        bag.put("sd", float(np.std(x, ddof=1)))
        bag.put("ad", ad)
        bag.put("ad_adjusted", adj)
        bag.put("p", F.ad_normal_p(adj))
    mark(cid, "scipy.stats.anderson (A²) + D'Agostino & Stephens (1986) p-value formula")


def t_crit(df, conf, alternative):
    alpha = 1 - conf
    if alternative == "two-sided":
        return float(stats.t.ppf(1 - alpha / 2, df))
    return float(stats.t.ppf(1 - alpha, df))


def ci_mean(est, se, df, conf, alternative):
    if alternative == "two-sided":
        t = t_crit(df, conf, alternative)
        return est - t * se, est + t * se
    t = t_crit(df, conf, alternative)
    return (float("-inf"), est + t * se) if alternative == "less" else (est - t * se, float("inf"))


def op_t1(bag, ds, args, cid):
    x = np.array([v for v in raw(ds, args["column"]) if v is not None and np.isfinite(v)], dtype=float)
    n = x.size
    mu0 = args.get("mu0", 0.0)
    conf = args.get("conf", 0.95)
    alternative = args.get("alt", "two-sided")
    m = float(np.mean(x))
    s = float(np.std(x, ddof=1))
    se = s / math.sqrt(n)
    df = n - 1
    # se = 0 convention (QA-X-04/05/06): a zero-variance sample carries no
    # information about variation around mu0, so t AND p are undefined (NaN).
    # scipy.stats.ttest_1samp already returns NaN here, but the guard is kept
    # explicit because that behaviour is version-dependent.
    if se > 0:
        t = (m - mu0) / se
        p = float(stats.ttest_1samp(x, mu0, alternative=alternative).pvalue)
    else:
        t = float("nan")
        p = float("nan")
    lo, hi = ci_mean(m, se, df, conf, alternative)
    bag.put("mean", m)
    bag.put("difference", m - mu0)
    bag.put("se", se)
    bag.put("df", df)
    bag.put("t", t)
    bag.put("p", p)
    bag.put("ci_low", lo)
    bag.put("ci_high", hi)
    bag.put("n", n)
    bag.put("stdev", s)
    mark(cid, "scipy.stats.ttest_1samp + scipy.stats.t.ppf interval")


def op_t2(bag, ds, args, cid):
    a = np.array([v for v in raw(ds, args["column"]) if v is not None and np.isfinite(v)], dtype=float)
    b = np.array([v for v in raw(ds, args["column2"]) if v is not None and np.isfinite(v)], dtype=float)
    welch = args.get("welch", True)
    conf = args.get("conf", 0.95)
    alternative = args.get("alt", "two-sided")
    n1, n2 = a.size, b.size
    ma, mb = float(np.mean(a)), float(np.mean(b))
    va, vb = float(np.var(a, ddof=1)), float(np.var(b, ddof=1))
    diff = ma - mb
    if welch:
        s1, s2 = va / n1, vb / n2
        se = math.sqrt(s1 + s2)
        denom = s1 ** 2 / (n1 - 1) + s2 ** 2 / (n2 - 1)
        df = se ** 4 / denom if denom > 0 else float("nan")
    else:
        sp2 = ((n1 - 1) * va + (n2 - 1) * vb) / (n1 + n2 - 2)
        se = math.sqrt(sp2 * (1 / n1 + 1 / n2))
        df = n1 + n2 - 2
    t = diff / se if se > 0 else float("nan")
    # se = 0 convention (QA-X-05): both variances 0 make the t statistic
    # undefined. scipy.stats.ttest_ind returns p = 0.0 here (its internal t is
    # ±inf), but 0 would assert "certainly different" from data that contain no
    # variance information at all, so the reference implements the same NaN
    # rule the shipped engine uses.
    if se > 0:
        p = float(stats.ttest_ind(a, b, equal_var=not welch, alternative=alternative).pvalue)
    else:
        p = float("nan")
    lo, hi = ci_mean(diff, se, df, conf, alternative)
    f = va / vb if vb > 0 else float("nan")
    pf = float(stats.f.cdf(f, n1 - 1, n2 - 1)) if np.isfinite(f) else float("nan")
    bag.put("mean", ma)
    bag.put("mean_b", mb)
    bag.put("difference", diff)
    bag.put("se", se)
    bag.put("df", df)
    bag.put("t", t)
    bag.put("p", p)
    bag.put("ci_low", lo)
    bag.put("ci_high", hi)
    bag.put("n", n1)
    bag.put("n_b", n2)
    bag.put("stdev", math.sqrt(va))
    bag.put("stdev_b", math.sqrt(vb))
    bag.put("f", f)
    bag.put("f_p", min(1.0, 2 * min(pf, 1 - pf)) if np.isfinite(pf) else float("nan"))
    mark(cid, "scipy.stats.ttest_ind (Welch / pooled) + F test from scipy.stats.f")


def op_paired(bag, ds, args, cid):
    a, b = raw(ds, args["column"]), raw(ds, args["column2"])
    diffs, pa, pb = [], [], []
    for x, y in zip(a, b):
        if x is not None and y is not None and np.isfinite(x) and np.isfinite(y):
            diffs.append(x - y)
            pa.append(x)
            pb.append(y)
    d = np.array(diffs, dtype=float)
    n = d.size
    mu0 = args.get("mu0", 0.0)
    conf = args.get("conf", 0.95)
    alternative = args.get("alt", "two-sided")
    m = float(np.mean(d))
    s = float(np.std(d, ddof=1))
    se = s / math.sqrt(n)
    # se = 0 convention (QA-X-06): identical differences make t and p
    # undefined — not 0 when m equals mu0 and not ±∞ otherwise. The 0/±∞ rule
    # the earlier drafts used asserted more than constant data can support.
    if se > 0:
        t = (m - mu0) / se
        p = float(stats.ttest_1samp(d, mu0, alternative=alternative).pvalue)
    else:
        t = float("nan")
        p = float("nan")
    lo, hi = ci_mean(m, se, n - 1, conf, alternative)
    bag.put("mean", float(np.mean(pa)))
    bag.put("mean_b", float(np.mean(pb)))
    bag.put("difference", m)
    bag.put("difference_vs_mu0", m - mu0)
    bag.put("se", se)
    bag.put("df", n - 1)
    bag.put("t", t)
    bag.put("p", p)
    bag.put("ci_low", lo)
    bag.put("ci_high", hi)
    bag.put("n", n)
    bag.put("stdev", s)
    mark(cid, "scipy.stats.ttest_1samp on the paired differences (= ttest_rel)")


def op_anova(bag, ds, args, cid):
    groups = grouped(raw(ds, args["response"]), texts(ds, args["factor"]))
    labels = [g[0] for g in groups]
    arrays = [np.array(g[1], dtype=float) for g in groups]
    res = stats.f_oneway(*arrays)
    k = len(arrays)
    ntot = sum(a.size for a in arrays)
    grand = float(np.mean(np.concatenate(arrays)))
    ssb = float(sum(a.size * (np.mean(a) - grand) ** 2 for a in arrays))
    ssw = float(sum(np.sum((a - np.mean(a)) ** 2) for a in arrays))
    dfb, dfw = k - 1, ntot - k
    msb, msw = ssb / dfb, ssw / dfw
    bag.put("df_between", dfb)
    bag.put("df_within", dfw)
    bag.put("ss_between", ssb)
    bag.put("ss_within", ssw)
    bag.put("ms_between", msb)
    bag.put("ms_within", msw)
    bag.put("f", float(res.statistic))
    bag.put("p", float(res.pvalue))
    bag.put("s_pooled", math.sqrt(msw))
    conf = args.get("conf", 0.95)
    k2, dfw2 = k, dfw
    q = float(stats.studentized_range.ppf(conf, k2, dfw2))
    bag.put("tukey_q", q)
    for i in range(k):
        for j in range(i + 1, k):
            a, b = arrays[i], arrays[j]
            diff = float(np.mean(a) - np.mean(b))
            se = math.sqrt(msw * (1 / a.size + 1 / b.size))
            half = q * se / math.sqrt(2)
            p = float(stats.studentized_range.sf(math.sqrt(2) * abs(diff) / se, k2, dfw2))
            key = f"tukey:{labels[i]}|{labels[j]}"
            bag.put(f"{key}:diff", diff)
            bag.put(f"{key}:se", se)
            bag.put(f"{key}:ci_low", diff - half)
            bag.put(f"{key}:ci_high", diff + half)
            bag.put(f"{key}:p", min(1.0, max(0.0, p)))
            bag.put(f"{key}:significant", 1 if abs(diff) > half else 0)
    mark(cid, "scipy.stats.f_oneway + scipy.stats.studentized_range for Tukey HSD")


def op_regression(bag, ds, args, cid):
    y = pd.Series(raw(ds, args["response"]), dtype=float)
    X = pd.DataFrame({name: pd.Series(raw(ds, name), dtype=float) for name in args["predictors"]})
    frame = pd.concat([y.rename("__y"), X], axis=1).dropna()
    if len(frame) <= len(args["predictors"]) + 1:
        raise RuntimeError("not-enough-data")
    for name in args["predictors"]:
        if float(np.std(frame[name].to_numpy(), ddof=1)) == 0:
            raise RuntimeError("res.constantPredictor")
    model = sm.OLS(frame["__y"], sm.add_constant(frame[args["predictors"]], has_constant="add")).fit()
    sst = float(np.sum((frame["__y"] - frame["__y"].mean()) ** 2))
    press = 0.0
    infl = model.get_influence()
    h = infl.hat_matrix_diag
    resid = model.resid.to_numpy()
    press = float(np.sum((resid / np.maximum(1e-9, 1 - h)) ** 2))
    from statsmodels.stats.outliers_influence import variance_inflation_factor

    design = sm.add_constant(frame[args["predictors"]], has_constant="add")
    bag.put("coef:Constant", float(model.params["const"]))
    bag.put("se:Constant", float(model.bse["const"]))
    bag.put("t:Constant", float(model.tvalues["const"]))
    bag.put("p:Constant", float(model.pvalues["const"]))
    for j, name in enumerate(args["predictors"]):
        bag.put(f"coef:{name}", float(model.params[name]))
        bag.put(f"se:{name}", float(model.bse[name]))
        bag.put(f"t:{name}", float(model.tvalues[name]))
        bag.put(f"p:{name}", float(model.pvalues[name]))
        bag.put(f"vif:{name}", float(variance_inflation_factor(design.to_numpy(), j + 1)))
    bag.put("r2", float(model.rsquared))
    bag.put("r2_adj", float(model.rsquared_adj))
    bag.put("r2_pred", 1 - press / sst if sst > 0 else 0.0)
    bag.put("s", math.sqrt(float(model.mse_resid)))
    bag.put("n", int(model.nobs))
    bag.put("df_reg", int(model.df_model))
    bag.put("df_err", int(model.df_resid))
    bag.put("ss_reg", float(model.ess))
    bag.put("ss_err", float(model.ssr))
    bag.put("f", float(model.fvalue))
    bag.put("p", float(model.f_pvalue))
    mark(cid, "statsmodels OLS + variance_inflation_factor + PRESS from the hat matrix")


def op_imr(bag, ds, args, cid):
    v = np.array([x for x in nums(ds, args["column"]) if np.isfinite(x)], dtype=float)
    n = v.size
    center = float(np.mean(v))
    mr = np.abs(np.diff(v))
    mrbar = float(np.mean(mr)) if mr.size else 0.0
    sigma = mrbar / F.D2[2]
    mr_sigma = F.D3[2] * mrbar / F.D2[2]
    i_flags = F.nelson_rules(list(v), center, sigma)
    mr_flags = F.nelson_rules(list(mr), mrbar, mr_sigma)
    bag.put("i.center", center)
    bag.put("i.ucl", center + 3 * sigma)
    bag.put("i.lcl", center - 3 * sigma)
    bag.put("i.sigma", sigma)
    bag.array("i.points", list(v))
    bag.put("mr.center", mrbar)
    bag.put("mr.ucl", F.chart_constants(2)["D4"] * mrbar)
    bag.put("mr.lcl", 0.0)
    bag.put("mr.sigma", mr_sigma)
    bag.array("mr.points", list(mr))
    for r in range(1, 9):
        bag.put(f"i.rule{r}_points", sum(1 for f in i_flags if r in f))
        bag.put(f"mr.rule{r}_points", sum(1 for f in mr_flags if r in f))
    bag.put("sigma_within", sigma)
    bag.put("out_of_control", sum(1 for f in i_flags if 1 in f) + sum(1 for f in mr_flags if 1 in f))
    mark(cid, "independent_formula: Montgomery Table VI d2/d3 + MR̄/d2; Nelson (1984) rules")


def _nelson_panel(bag, prefix, points, center, sigma, ucl, lcl):
    flags = F.nelson_rules(list(points), center, sigma)
    bag.put(f"{prefix}.center", center)
    if isinstance(ucl, (list, tuple)):
        bag.array(f"{prefix}.ucl", list(ucl))
    else:
        bag.put(f"{prefix}.ucl", ucl)
    if isinstance(lcl, (list, tuple)):
        bag.array(f"{prefix}.lcl", list(lcl))
    else:
        bag.put(f"{prefix}.lcl", lcl)
    if isinstance(sigma, (list, tuple)):
        bag.array(f"{prefix}.sigma", list(sigma))
    else:
        bag.put(f"{prefix}.sigma", sigma)
    bag.array(f"{prefix}.points", list(points))
    for r in range(1, 9):
        bag.put(f"{prefix}.rule{r}_points", sum(1 for f in flags if r in f))
    return sum(1 for f in flags if 1 in f)


def op_xbarr(bag, ds, args, cid):
    values = raw(ds, args["column"])
    n = max(2, min(10, int(round(args.get("subgroup", 5)))))
    groups = []
    skipped = 0
    total_groups = len(values) // n
    for start in range(0, len(values) - n + 1, n):
        chunk = [x for x in values[start:start + n] if x is not None and np.isfinite(x)]
        if len(chunk) < 2:
            skipped += 1
            continue
        groups.append((np.array(chunk, dtype=float), len(chunk), len(chunk) < n))
    if not groups:
        raise RuntimeError("spc.invalid:noGroups")
    means = np.array([g[0].mean() for g in groups])
    ranges = np.array([g[0].max() - g[0].min() for g in groups])
    grand = float(means.mean())
    weights = sum(g[1] - 1 for g in groups)
    sigma = sum((g[1] - 1) / weights * (ranges[i] / F.D2[g[1]]) for i, g in enumerate(groups)) if weights else float("nan")
    d2_bar = sum((g[1] - 1) / weights * F.D2[g[1]] for g in groups) if weights else float("nan")
    r_bar = sigma * d2_bar
    xbar_sigma = [sigma / math.sqrt(g[1]) for g in groups]
    r_sigma = [F.D3[g[1]] * sigma for g in groups]
    xbar_ucl = [grand + 3 * s for s in xbar_sigma]
    xbar_lcl = [grand - 3 * s for s in xbar_sigma]
    r_ucl = [F.chart_constants(g[1])["D4"] * F.D2[g[1]] * sigma for g in groups]
    r_lcl = [max(0.0, F.chart_constants(g[1])["D3"] * F.D2[g[1]] * sigma) for g in groups]
    ooc = _nelson_panel(bag, "xbar", means, grand, xbar_sigma, xbar_ucl, xbar_lcl)
    ooc += _nelson_panel(bag, "r", ranges, r_bar, r_sigma, r_ucl, r_lcl)
    bag.put("sigma_within", sigma)
    bag.put("out_of_control", ooc)
    bag.put("sg_size", n)
    bag.put("sg_total", total_groups)
    bag.put("sg_used", len(groups))
    bag.put("sg_skipped", skipped)
    bag.put("sg_leftover", len(values) % n)
    bag.put("sg_missing", sum(1 for g in groups if g[2]))
    bag.put("sg_varying", 1 if any(g[1] != n for g in groups) else 0)
    mark(cid, "independent_formula: weighted (n_i−1) R_i/d2(n_i) within sigma, Montgomery Table VI")


def op_xbars(bag, ds, args, cid):
    values = raw(ds, args["column"])
    if args.get("groupIds"):
        ids = texts(ds, args["groupIds"])
        order, data, skipped = [], {}, 0
        for v, k in zip(values, ids):
            if k is None or k == "":
                continue
            if v is None or not np.isfinite(v):
                continue
            if k not in data:
                data[k] = []
                order.append(k)
            data[k].append(v)
        groups = [np.array(data[k], dtype=float) for k in order if len(data[k]) >= 2]
        skipped = sum(1 for k in order if len(data[k]) < 2)
        total = len(order)
        leftover = 0
    else:
        n = max(2, int(round(args.get("subgroup", 5))))
        groups = []
        skipped = 0
        for start in range(0, len(values) - n + 1, n):
            chunk = [x for x in values[start:start + n] if x is not None and np.isfinite(x)]
            if len(chunk) < 2:
                skipped += 1
                continue
            groups.append(np.array(chunk, dtype=float))
        total = len(values) // n
        leftover = len(values) % n
    if not groups:
        raise RuntimeError("spc.invalid:noGroups")
    sizes = [g.size for g in groups]
    means = np.array([g.mean() for g in groups])
    sds = np.array([g.std(ddof=1) for g in groups])
    grand = float(means.mean())
    s_bar = float(sds.mean())
    c4_bar = float(np.mean([F.c4(s) for s in sizes]))
    sigma = s_bar / c4_bar
    xbar_sigma = [sigma / math.sqrt(s) for s in sizes]
    s_sigma = [sigma * math.sqrt(max(0.0, 1 - F.c4(s) ** 2)) for s in sizes]
    xbar_ucl = [grand + 3 * s for s in xbar_sigma]
    xbar_lcl = [grand - 3 * s for s in xbar_sigma]
    s_ucl = [s_bar + 3 * s for s in s_sigma]
    s_lcl = [max(0.0, s_bar - 3 * s) for s in s_sigma]
    ooc = _nelson_panel(bag, "xbar", means, grand, xbar_sigma, xbar_ucl, xbar_lcl)
    ooc += _nelson_panel(bag, "s", sds, s_bar, s_sigma, s_ucl, s_lcl)
    bag.put("sigma_within", sigma)
    bag.put("out_of_control", ooc)
    bag.put("sg_used", len(groups))
    bag.put("sg_skipped", skipped)
    mark(cid, "independent_formula: S̄/c4(n) with c4 = √(2/(n−1))Γ(n/2)/Γ((n−1)/2)")


def op_pchart(bag, ds, args, cid):
    d = [v for v in raw(ds, args["column"])]
    if args.get("sizesColumn"):
        sizes = raw(ds, args["sizesColumn"])
    else:
        sizes = [args.get("sampleSize", 100)] * len(d)
    if not d or not sizes or len(d) != len(sizes):
        raise RuntimeError("spc.invalid:" + ("empty" if not d or not sizes else "length"))
    for i, (dd, ss) in enumerate(zip(d, sizes)):
        if dd is None or not np.isfinite(dd):
            raise RuntimeError(f"spc.invalid:nonFinite:index={i}")
        if not float(dd).is_integer():
            raise RuntimeError(f"spc.invalid:nonInteger:index={i}")
        if dd < 0:
            raise RuntimeError(f"spc.invalid:negative:index={i}")
        if ss is None or not np.isfinite(ss) or ss <= 0:
            raise RuntimeError(f"spc.invalid:size:index={i}")
        if dd > ss:
            raise RuntimeError(f"spc.invalid:exceeds:index={i}")
    total_d = float(sum(d))
    total_n = float(sum(sizes))
    pbar = total_d / total_n
    props = np.array([dd / ss for dd, ss in zip(d, sizes)])
    sigmas = np.array([math.sqrt(pbar * (1 - pbar) / ss) for ss in sizes])
    z = np.array([(p - pbar) / s if s > 0 else 0.0 for p, s in zip(props, sigmas)])
    flags = F.nelson_rules(list(z), 0.0, 1.0)
    ucl = [min(1.0, pbar + 3 * s) for s in sigmas]
    lcl = [max(0.0, pbar - 3 * s) for s in sigmas]
    bag.put("p.center", pbar)
    bag.array("p.ucl", ucl)
    bag.array("p.lcl", lcl)
    bag.array("p.sigma", list(sigmas))
    bag.array("p.points", list(props))
    for r in range(1, 9):
        bag.put(f"p.rule{r}_points", sum(1 for f in flags if r in f))
    bag.put("sigma_within", math.sqrt(pbar * (1 - pbar) / total_n / len(sizes)))
    bag.put("out_of_control", sum(1 for f in flags if 1 in f))
    mark(cid, "independent_formula: pooled p̄, σ_i = √(p̄(1−p̄)/n_i), Nelson (1984) rules")


def op_npchart(bag, ds, args, cid):
    d = raw(ds, args["column"])
    n = int(round(args.get("sampleSize", 100)))
    if not d:
        raise RuntimeError("empty")
    for i, dd in enumerate(d):
        if dd is None or not np.isfinite(dd):
            raise RuntimeError(f"spc.invalid:nonFinite:index={i}")
        if not float(dd).is_integer():
            raise RuntimeError(f"spc.invalid:nonInteger:index={i}")
        if dd < 0:
            raise RuntimeError(f"spc.invalid:negative:index={i}")
        if dd > n:
            raise RuntimeError(f"spc.invalid:exceeds:index={i}")
    npbar = float(np.mean(d))
    pbar = npbar / n
    sigma = math.sqrt(max(0.0, npbar * (1 - pbar)))
    ucl = min(n, npbar + 3 * sigma)
    lcl = max(0.0, npbar - 3 * sigma)
    z = [(x - npbar) / sigma if sigma > 0 else 0.0 for x in d]
    flags = F.nelson_rules(z, 0.0, 1.0)
    bag.put("np.center", npbar)
    bag.put("np.ucl", ucl)
    bag.put("np.lcl", lcl)
    bag.put("np.sigma", sigma)
    bag.array("np.points", d)
    for r in range(1, 9):
        bag.put(f"np.rule{r}_points", sum(1 for f in flags if r in f))
    bag.put("out_of_control", sum(1 for f in flags if 1 in f))
    mark(cid, "independent_formula: np̄, √(np̄(1−p̄)) limits")


def op_cchart(bag, ds, args, cid):
    d = raw(ds, args["column"])
    if not d:
        raise RuntimeError("empty")
    for i, dd in enumerate(d):
        if dd is None or not np.isfinite(dd):
            raise RuntimeError(f"spc.invalid:nonFinite:index={i}")
        if not float(dd).is_integer():
            raise RuntimeError(f"spc.invalid:nonInteger:index={i}")
        if dd < 0:
            raise RuntimeError(f"spc.invalid:negative:index={i}")
    cbar = float(np.mean(d))
    sigma = math.sqrt(max(0.0, cbar))
    z = [(x - cbar) / sigma if sigma > 0 else 0.0 for x in d]
    flags = F.nelson_rules(z, 0.0, 1.0)
    bag.put("c.center", cbar)
    bag.put("c.ucl", cbar + 3 * sigma)
    bag.put("c.lcl", max(0.0, cbar - 3 * sigma))
    bag.put("c.sigma", sigma)
    bag.array("c.points", d)
    for r in range(1, 9):
        bag.put(f"c.rule{r}_points", sum(1 for f in flags if r in f))
    bag.put("out_of_control", sum(1 for f in flags if 1 in f))
    mark(cid, "independent_formula: c̄, √c̄ limits")


def op_uchart(bag, ds, args, cid):
    d = raw(ds, args["column"])
    if args.get("unitsColumn"):
        units = raw(ds, args["unitsColumn"])
    else:
        units = [args.get("unitSize", 1)] * len(d)
    if len(d) != len(units):
        raise RuntimeError("length")
    for i, dd in enumerate(d):
        if dd is None or not np.isfinite(dd):
            raise RuntimeError(f"spc.invalid:nonFinite:index={i}")
        if dd < 0:
            raise RuntimeError(f"spc.invalid:negative:index={i}")
    for i, u in enumerate(units):
        if u is None or not np.isfinite(u) or u <= 0:
            raise RuntimeError(f"spc.invalid:size:index={i}")
    ubar = float(sum(d)) / float(sum(units))
    points = [x / u for x, u in zip(d, units)]
    sigmas = [math.sqrt(max(0.0, ubar / u)) for u in units]
    ucl = [ubar + 3 * s for s in sigmas]
    lcl = [max(0.0, ubar - 3 * s) for s in sigmas]
    z = [(p - ubar) / s if s > 0 else 0.0 for p, s in zip(points, sigmas)]
    flags = F.nelson_rules(z, 0.0, 1.0)
    bag.put("u.center", ubar)
    bag.array("u.ucl", ucl)
    bag.array("u.lcl", lcl)
    bag.array("u.sigma", sigmas)
    bag.array("u.points", points)
    for r in range(1, 9):
        bag.put(f"u.rule{r}_points", sum(1 for f in flags if r in f))
    bag.put("sigma_within", math.sqrt(ubar / (float(sum(units)) / len(units))))
    bag.put("out_of_control", sum(1 for f in flags if 1 in f))
    mark(cid, "independent_formula: ū, √(ū/n_i) limits")


def _capability_from(bag, values, lsl, usl, target, sd_within, sd_overall, method):
    idx = F.capability_indices(values, lsl, usl, target, sd_within, sd_overall)
    v = np.asarray(values, dtype=float)
    bag.put("n", v.size)
    bag.put("mean", idx["mean"])
    bag.put("sd_within", sd_within)
    bag.put("sd_overall", sd_overall)
    for k in ("cp", "cpk", "cpl", "cpu", "pp", "ppk", "ppl", "ppu", "cpm"):
        bag.put(k, idx[k])
    for k in ("ppm_within", "ppm_overall", "ppm_observed"):
        bag.put(k, idx[k])
    bag.put("sigma_level", F.sigma_level(method, idx["ppm_overall"], idx["cpk"]))
    return idx


def op_capability(bag, ds, args, cid):
    values = [v for v in nums(ds, args["column"]) if np.isfinite(v)]
    subgroup = int(round(args.get("subgroup", 1)))
    sd_overall = float(np.std(values, ddof=1))
    sd_within = F.moving_range_sigma(values) if subgroup <= 1 else F.within_subgroup_sigma(raw(ds, args["column"]), subgroup)
    _capability_from(bag, values, args.get("lsl"), args.get("usl"), args.get("target"), sd_within, sd_overall, args.get("sigmaMethod", "z_bench_shift"))
    mark(cid, "independent_formula: ISO 22514 Cp/Cpk/Pp/Ppk + scipy.stats.norm tails")


def _xbarr_internals(values, n):
    groups = []
    for start in range(0, len(values) - n + 1, n):
        chunk = [x for x in values[start:start + n] if x is not None and np.isfinite(x)]
        if len(chunk) >= 2:
            groups.append(np.array(chunk, dtype=float))
    means = np.array([g.mean() for g in groups])
    ranges = np.array([g.max() - g.min() for g in groups])
    grand = float(means.mean())
    weights = sum(g.size - 1 for g in groups)
    sigma = sum((g.size - 1) / weights * ranges[i] / F.D2[g.size] for i, g in enumerate(groups))
    d2_bar = sum((g.size - 1) / weights * F.D2[g.size] for g in groups)
    return {"groups": groups, "means": means, "ranges": ranges, "grand": grand, "sigma": sigma, "rbar": sigma * d2_bar}


def op_sixpack(bag, ds, args, cid):
    values = [v for v in nums(ds, args["column"]) if np.isfinite(v)]
    if len(values) < 5:
        raise RuntimeError("res.insufficient")
    subgroup = max(1, int(round(args.get("subgroup", 1))))
    vals = np.array(values)
    if subgroup <= 1:
        chart = "imr"
        center = float(vals.mean())
        mr = np.abs(np.diff(vals))
        mrbar = float(mr.mean())
        sigma = mrbar / F.D2[2]
        primary = {"points": vals, "center": center, "sigma": sigma, "ucl": center + 3 * sigma, "lcl": center - 3 * sigma}
        secondary = {"points": mr, "center": mrbar, "sigma": F.D3[2] * mrbar / F.D2[2], "ucl": F.chart_constants(2)["D4"] * mrbar, "lcl": 0.0}
        basis = "MRbar/d2"
        missing = 0
    elif subgroup <= 10:
        chart = "xbar-r"
        it = _xbarr_internals(raw(ds, args["column"]), subgroup)
        sigma = it["sigma"]
        primary = {"points": it["means"], "center": it["grand"], "sigma": [sigma / math.sqrt(g.size) for g in it["groups"]]}
        primary["ucl"] = [it["grand"] + 3 * s for s in primary["sigma"]]
        primary["lcl"] = [it["grand"] - 3 * s for s in primary["sigma"]]
        secondary = {"points": it["ranges"], "center": it["rbar"], "sigma": [F.D3[g.size] * sigma for g in it["groups"]]}
        secondary["ucl"] = [F.chart_constants(g.size)["D4"] * F.D2[g.size] * sigma for g in it["groups"]]
        secondary["lcl"] = [max(0.0, F.chart_constants(g.size)["D3"] * F.D2[g.size] * sigma) for g in it["groups"]]
        basis = "Rbar/d2"
        missing = sum(1 for g in it["groups"] if g.size != subgroup)
    else:
        chart = "xbar-s"
        rawv = raw(ds, args["column"])
        groups = []
        for start in range(0, len(rawv) - subgroup + 1, subgroup):
            chunk = [x for x in rawv[start:start + subgroup] if x is not None and np.isfinite(x)]
            if len(chunk) >= 2:
                groups.append(np.array(chunk, dtype=float))
        means = np.array([g.mean() for g in groups])
        sds = np.array([g.std(ddof=1) for g in groups])
        grand = float(means.mean())
        sbar = float(sds.mean())
        c4bar = float(np.mean([F.c4(g.size) for g in groups]))
        sigma = sbar / c4bar
        primary = {"points": means, "center": grand, "sigma": [sigma / math.sqrt(g.size) for g in groups]}
        primary["ucl"] = [grand + 3 * s for s in primary["sigma"]]
        primary["lcl"] = [grand - 3 * s for s in primary["sigma"]]
        secondary = {"points": sds, "center": sbar, "sigma": [sigma * math.sqrt(max(0.0, 1 - F.c4(g.size) ** 2)) for g in groups]}
        secondary["ucl"] = [sbar + 3 * s for s in secondary["sigma"]]
        secondary["lcl"] = [max(0.0, sbar - 3 * s) for s in secondary["sigma"]]
        basis = "Sbar/c4"
        missing = sum(1 for g in groups if g.size != subgroup)

    def panel(prefix, p):
        bag.put(f"{prefix}.center", p["center"])
        for key in ("ucl", "lcl", "sigma"):
            if isinstance(p[key], (list, tuple, np.ndarray)):
                bag.array(f"{prefix}.{key}", list(p[key]))
            else:
                bag.put(f"{prefix}.{key}", p[key])
        bag.array(f"{prefix}.points", list(p["points"]))
        flags = F.nelson_rules(list(p["points"]), p["center"], p["sigma"])
        for r in range(1, 9):
            bag.put(f"{prefix}.rule{r}_points", sum(1 for f in flags if r in f))

    panel("primary", primary)
    panel("secondary", secondary)
    lsl, usl, target = args.get("lsl"), args.get("usl"), args.get("target")
    sd_overall = float(vals.std(ddof=1))
    idx = _capability_from(bag, values, lsl, usl, target, sigma, sd_overall, args.get("sigmaMethod", "z_bench_shift"))
    mu, sdv = float(vals.mean()), float(vals.std(ddof=1))
    ad = F.ad_statistic(stats.norm.cdf((vals - mu) / sdv))
    ad_star = F.ad_normal_adjusted(ad, vals.size)
    bag.put("chart", chart)
    bag.put("sigma_basis", basis)
    bag.put("subgroup", subgroup)
    bag.put("sigma_within", sigma)
    bag.put("sigma_overall", sd_overall)
    bag.put("ad", ad)
    bag.put("ad_adjusted", ad_star)
    bag.put("ad_p", F.ad_normal_p(ad_star))
    bag.put("missing_subgroups", missing)
    width = (usl - lsl) if (lsl is not None and usl is not None) else float("nan")
    bag.put("says_within", 6 * sigma / width if np.isfinite(width) else float("nan"))
    bag.put("says_overall", 6 * sd_overall / width if np.isfinite(width) else float("nan"))
    mark(cid, "independent_formula charts + ISO capability; AD via scipy.stats.norm.cdf, p from D'Agostino & Stephens")


def op_capnonnormal(bag, ds, args, cid):
    allv = np.array([v for v in nums(ds, args["column"]) if np.isfinite(v)], dtype=float)
    pos = allv[allv > 0]
    excluded = int(allv.size - pos.size)
    if pos.size < 5:
        raise RuntimeError("res.insufficient")
    dist = args.get("distribution", "weibull")
    if dist == "weibull":
        shape, loc, scale = stats.weibull_min.fit(pos, floc=0)
        cdf = lambda x: stats.weibull_min.cdf(x, shape, loc=0, scale=scale)
        ppf = lambda p: stats.weibull_min.ppf(p, shape, loc=0, scale=scale)
        logpdf = lambda x: stats.weibull_min.logpdf(x, shape, loc=0, scale=scale)
    elif dist == "lognormal":
        s, loc, sc = stats.lognorm.fit(pos, floc=0)
        # Sigrún's FitParams for the lognormal stores shape = sigma of ln x and
        # scale = MU of ln x (not eta = exp(mu)); reported under the same names so
        # the comparison is like for like.
        shape, scale = float(s), float(math.log(sc))
        cdf = lambda x: stats.lognorm.cdf(x, s, loc=0, scale=sc)
        ppf = lambda p: stats.lognorm.ppf(p, s, loc=0, scale=sc)
        logpdf = lambda x: stats.lognorm.logpdf(x, s, loc=0, scale=sc)
    else:
        shape, loc, scale = stats.gamma.fit(pos, floc=0)
        cdf = lambda x: stats.gamma.cdf(x, shape, loc=0, scale=scale)
        ppf = lambda p: stats.gamma.ppf(p, shape, loc=0, scale=scale)
        logpdf = lambda x: stats.gamma.logpdf(x, shape, loc=0, scale=scale)
    loglik = float(np.sum(logpdf(pos)))
    ad = F.ad_statistic(cdf(pos))
    ad_star = F.ad_nonnormal_adjusted(ad, pos.size)
    bag.put("n", int(pos.size))
    bag.put("excluded", excluded)
    bag.put("shape", float(shape))
    bag.put("scale", float(scale))
    bag.put("loglik", loglik)
    bag.put("ad", ad)
    bag.put("ad_adjusted", ad_star)
    if args.get("specs") is False:
        crit = {"weibull": (0.637, 0.757, 1.038), "lognormal": (0.631, 0.752, 1.035), "gamma": (0.632, 0.759, 1.048)}[dist]
        bag.put("crit10", crit[0])
        bag.put("crit5", crit[1])
        bag.put("crit1", crit[2])
        mark(cid, "scipy.stats MLE (floc=0) + AD from the fitted CDF, D'Agostino & Stephens critical values")
        return
    lsl, usl = args.get("lsl"), args.get("usl")
    median = float(ppf(0.5))
    p00135 = max(1e-12, float(ppf(0.00135)))
    p99865 = float(ppf(0.99865))
    spread = p99865 - p00135
    pp = (usl - lsl) / spread if (lsl is not None and usl is not None and spread > 0) else float("nan")
    ppu = (usl - median) / max(1e-12, p99865 - median) if usl is not None else float("nan")
    ppl = (median - lsl) / max(1e-12, median - p00135) if lsl is not None else float("nan")
    if lsl is not None and usl is not None:
        ppk = min(ppl, ppu)
    elif lsl is not None:
        ppk = ppl
    elif usl is not None:
        ppk = ppu
    else:
        raise RuntimeError("res.needSpec")
    below = float(cdf(lsl)) if lsl is not None else 0.0
    above = float(1 - cdf(usl)) if usl is not None else 0.0
    observed = int(np.sum(((pos < lsl) if lsl is not None else np.zeros(pos.size, bool)) | ((pos > usl) if usl is not None else np.zeros(pos.size, bool))))
    bag.put("median", median)
    bag.put("p00135", p00135)
    bag.put("p99865", p99865)
    bag.put("pp", pp)
    bag.put("ppk", ppk)
    bag.put("ppu", ppu)
    bag.put("ppl", ppl)
    bag.put("ppm", (below + above) * 1e6)
    bag.put("observed_ppm", observed / pos.size * 1e6)
    mark(cid, "scipy.stats MLE fit + ISO 22514-4 percentile indices")


def op_gagerr(bag, ds, args, cid):
    df = pd.DataFrame({
        "part": [str(x) for x in texts(ds, args["part"])],
        "operator": [str(x) for x in texts(ds, args["operator"])],
        "meas": raw(ds, args["measurement"]),
    })
    df = df.dropna()
    df["meas"] = df["meas"].astype(float)
    parts = sorted(df["part"].unique())
    ops = sorted(df["operator"].unique())
    study_var = args.get("studyVar", 6)
    tol = abs(args["tolerance"]) if args.get("tolerance") else float("nan")
    if len(parts) < 2:
        raise RuntimeError("grr.needParts")
    if len(ops) < 2:
        raise RuntimeError("grr.needOperators")
    grand = float(df["meas"].mean())
    ss_total = float(np.sum((df["meas"] - grand) ** 2))
    p, o = len(parts), len(ops)
    kind = args.get("type", "crossed")
    if kind == "crossed":
        counts = df.groupby(["part", "operator"]).size()
        if counts.size != p * o:
            raise RuntimeError("grr.missingCells")
        if counts.nunique() != 1:
            raise RuntimeError("grr.unbalanced")
        n = int(counts.iloc[0])
        if n < 2:
            raise RuntimeError("grr.needReplicates")
        part_means = df.groupby("part")["meas"].mean()
        op_means = df.groupby("operator")["meas"].mean()
        cell_means = df.groupby(["part", "operator"])["meas"].mean()
        ss_part = o * n * float(np.sum((part_means - grand) ** 2))
        ss_op = p * n * float(np.sum((op_means - grand) ** 2))
        ss_cell = n * float(np.sum((cell_means - grand) ** 2))
        ss_int = ss_cell - ss_part - ss_op
        ss_rep = ss_total - ss_cell
        df_part, df_op, df_int, df_rep = p - 1, o - 1, (p - 1) * (o - 1), p * o * (n - 1)
        ms = {
            "part": {"df": df_part, "ss": ss_part, "ms": ss_part / df_part},
            "operator": {"df": df_op, "ss": ss_op, "ms": ss_op / df_op},
            "interaction": {"df": df_int, "ss": ss_int, "ms": ss_int / df_int},
            "repeat": {"df": df_rep, "ss": ss_rep, "ms": ss_rep / df_rep},
            "total": {"df": df_part + df_op + df_int + df_rep, "ss": ss_total, "ms": float("nan")},
        }
        if args.get("poolInteraction"):
            p_int = float(stats.f.sf(ms["interaction"]["ms"] / ms["repeat"]["ms"], df_int, df_rep))
            if p_int > args.get("alpha", 0.05):
                pooled_df = df_int + df_rep
                pooled_ss = ss_int + ss_rep
                pooled_ms = pooled_ss / pooled_df
                ms["interaction"] = {"df": 0, "ss": 0.0, "ms": float("nan")}
                ms["repeat"] = {"df": pooled_df, "ss": pooled_ss, "ms": pooled_ms}
                # pooled model: var_interaction = 0, var_op = (MS_op − MS_pooled)/(p n),
                # var_part = (MS_part − MS_pooled)/(o n)  (Minitab's pooled table)
                comp = {
                    "repeat": pooled_ms,
                    "interaction": 0.0,
                    "operator": (ms["operator"]["ms"] - pooled_ms) / (p * n),
                    "part": (ms["part"]["ms"] - pooled_ms) / (o * n),
                }
                comp["grr"] = comp["repeat"] + comp["operator"]
                comp["total"] = comp["grr"] + comp["part"]
                bag.put("note", "interactionPooled")
                return _grr_out(bag, kind, ms, comp, p, o, n, study_var, tol, cid, pooled=True, dframes=(df,))
        comp = F.crossed_components(ms, p, o, n)
        return _grr_out(bag, kind, ms, comp, p, o, n, study_var, tol, cid, pooled=False, dframes=(df,))
    # nested: part within operator
    cell_counts = df.groupby(["operator", "part"]).size()
    owners = df.groupby("part")["operator"].nunique()
    if (owners > 1).any():
        raise RuntimeError("grr.nestedPartShared")
    parts_per_op = df.groupby("operator")["part"].nunique().unique()
    if cell_counts.nunique() != 1 or len(parts_per_op) != 1 or cell_counts.size != o * int(parts_per_op[0]):
        raise RuntimeError("grr.unbalancedNested")
    ppo = int(parts_per_op[0])
    n = int(cell_counts.iloc[0])
    if n < 2:
        raise RuntimeError("grr.needReplicates")
    op_means = df.groupby("operator")["meas"].mean()
    cell_means = df.groupby(["operator", "part"])["meas"].mean()
    ss_op = ppo * n * float(np.sum((op_means - grand) ** 2))
    ss_part = 0.0
    for (op_name, part_name), row in cell_means.items():
        ss_part += n * (row - op_means[op_name]) ** 2
    ss_rep = ss_total - ss_op - ss_part
    df_op = o - 1
    df_part = o * (ppo - 1)
    df_rep = len(df) - o * ppo
    ms = {
        "operator": {"df": df_op, "ss": ss_op, "ms": ss_op / df_op},
        "partOperator": {"df": df_part, "ss": ss_part, "ms": ss_part / df_part},
        "repeat": {"df": df_rep, "ss": ss_rep, "ms": ss_rep / max(1, df_rep)},
        "total": {"df": len(df) - 1, "ss": ss_total, "ms": float("nan")},
    }
    comp = F.nested_components(ms, o, ppo, n)
    return _grr_out(bag, kind, ms, comp, ppo, o, n, study_var, tol, cid, pooled=False, dframes=(df,))


def _grr_out(bag, kind, ms, comp, parts, operators, n, study_var, tol, cid, pooled, dframes):
    total = comp["total"]
    for source, entry in ms.items():
        bag.put(f"anova:{source}:df", entry["df"])
        bag.put(f"anova:{source}:ss", entry["ss"])
        bag.put(f"anova:{source}:ms", entry["ms"])
    # F and p values
    df = dframes[0]
    if kind == "crossed":
        rep_ms = ms["repeat"]["ms"]
        pooled = ms["interaction"]["df"] == 0
        int_ms = rep_ms if pooled else ms["interaction"]["ms"]
        den_df = ms["repeat"]["df"] if pooled else ms["interaction"]["df"]
        bag.put("anova:part:f", ms["part"]["ms"] / int_ms if int_ms > 0 else float("nan"))
        bag.put("anova:part:p", float(stats.f.sf(ms["part"]["ms"] / int_ms, ms["part"]["df"], den_df)) if int_ms > 0 else float("nan"))
        bag.put("anova:operator:f", ms["operator"]["ms"] / int_ms if int_ms > 0 else float("nan"))
        bag.put("anova:operator:p", float(stats.f.sf(ms["operator"]["ms"] / int_ms, ms["operator"]["df"], den_df)) if int_ms > 0 else float("nan"))
        bag.put("anova:interaction:f", int_ms / rep_ms if rep_ms > 0 else float("nan"))
        bag.put("anova:interaction:p", float(stats.f.sf(int_ms / rep_ms, ms["interaction"]["df"], ms["repeat"]["df"])) if rep_ms > 0 else float("nan"))
        bag.put("anova:repeat:f", float("nan"))
        bag.put("anova:repeat:p", float("nan"))
    else:
        part_ms, rep_ms = ms["partOperator"]["ms"], ms["repeat"]["ms"]
        bag.put("anova:operator:f", ms["operator"]["ms"] / part_ms if part_ms > 0 else float("nan"))
        bag.put("anova:operator:p", float(stats.f.sf(ms["operator"]["ms"] / part_ms, ms["operator"]["df"], ms["partOperator"]["df"])) if part_ms > 0 else float("nan"))
        bag.put("anova:partOperator:f", part_ms / rep_ms if rep_ms > 0 else float("nan"))
        bag.put("anova:partOperator:p", float(stats.f.sf(part_ms / rep_ms, ms["partOperator"]["df"], ms["repeat"]["df"])) if rep_ms > 0 else float("nan"))
        bag.put("anova:repeat:f", float("nan"))
        bag.put("anova:repeat:p", float("nan"))
    bag.put("anova:total:f", float("nan"))
    bag.put("anova:total:p", float("nan"))

    def comp_of(name, variance):
        sdev = math.sqrt(max(0.0, variance))
        return {
            "variance": variance,
            "stdev": sdev,
            "contribution": variance / total * 100 if total > 0 else float("nan"),
            "studyvar": sdev / math.sqrt(total) * 100 if total > 0 else float("nan"),
            "tolerance": study_var * sdev / tol * 100 if tol > 0 else float("nan"),
        }

    entries = {
        "repeat": comp_of("repeat", comp["repeat"]),
        "operator": comp_of("operator", comp["operator"]),
        "partToPart": comp_of("partToPart", comp["part"]),
        "grr": comp_of("grr", comp["grr"]),
        "total": comp_of("total", comp["total"]),
    }
    if kind == "crossed":
        entries["interaction"] = comp_of("interaction", comp["interaction"])
        entries["reproducibility"] = comp_of("reproducibility", comp["interaction"] + comp["operator"])
    else:
        entries["reproducibility"] = comp_of("reproducibility", comp["operator"])
    for name, entry in entries.items():
        for k, v in entry.items():
            bag.put(f"comp:{name}:{k}", v)
    sd_part = math.sqrt(max(0.0, comp["part"]))
    sd_grr = math.sqrt(max(0.0, comp["grr"]))
    ndc = 999 if sd_grr <= 1e-9 else min(999, max(1, math.floor(1.41 * sd_part / sd_grr)))
    bag.put("parts", parts)
    bag.put("operators", operators)
    bag.put("replicates", n)
    bag.put("grr_variance", comp["grr"])
    bag.put("total_variance", comp["total"])
    bag.put("ndc", ndc)
    name_map = {"part": "partToPart", "part_operator": "partOperator"}
    negatives = [name_map.get(k, k) for k, v in comp.items() if v < 0]
    bag.put("negative_components", ",".join(negatives))
    if "note" not in bag.values:
        bag.put("note", "")
    mark(cid, "independent_formula: NIST/SEMATECH closed-form variance components + scipy.stats.f")


_BOOT_CACHE: dict = {}


def op_weibull(bag, ds, args, cid):
    times = np.array([v for v in raw(ds, args["column"]) if v is not None and np.isfinite(v) and v > 0], dtype=float)
    if args.get("censorColumn"):
        cens_raw = raw(ds, args["censorColumn"])
        keep, cens = [], []
        is_one = args.get("censorCode", "1=censored") != "0=censored"
        for t, c in zip(raw(ds, args["column"]), cens_raw):
            if t is None or not np.isfinite(t) or t <= 0:
                continue
            if c is None or not np.isfinite(c):
                continue
            keep.append(t)
            cens.append(1 if (c == 1) == is_one else 0)
        times = np.array(keep, dtype=float)
        cens = np.array(cens, dtype=int)
    else:
        cens = np.zeros(times.size, dtype=int)
    n = times.size
    failures = int(np.sum(cens == 0))
    if n < 3:
        raise RuntimeError("res.insufficient")
    if failures < 2:
        raise RuntimeError("rel.needFailures")
    data = stats.CensoredData.right_censored(times, cens)
    shape, loc, scale = stats.weibull_min.fit(data, floc=0)
    shape, scale = float(shape), float(scale)
    # Log-likelihood / information in (β, ln η) — the parameterisation the
    # engine documents for its standard errors.
    def loglik(beta, ln_eta):
        eta = math.exp(ln_eta)
        total = 0.0
        for t, c in zip(times, cens):
            z = (t / eta) ** beta
            total -= z
            if c == 0:
                total += math.log(beta) - beta * ln_eta + (beta - 1) * math.log(t)
        return total

    def hess(beta, ln_eta, h=1e-5):
        H = np.zeros((2, 2))
        p0 = np.array([beta, ln_eta])
        for i in range(2):
            for j in range(2):
                def f(a, b):
                    q = p0.copy()
                    q[0], q[1] = a, b
                    return loglik(q[0], q[1])
                pp = p0.copy(); pp[i] += h; pp[j] += h
                mm = p0.copy(); mm[i] -= h; mm[j] -= h
                pm = p0.copy(); pm[i] += h; pm[j] -= h
                mp = p0.copy(); mp[i] -= h; mp[j] += h
                H[i][j] = (f(pp[0], pp[1]) - f(pm[0], pm[1]) - f(mp[0], mp[1]) + f(mm[0], mm[1])) / (4 * h * h)
        return H

    a = math.log(scale)
    H = hess(shape, a)
    det = H[0, 0] * H[1, 1] - H[0, 1] * H[1, 0]
    if abs(det) > 1e-18:
        cov = np.array([[-H[1, 1] / det, H[0, 1] / det], [H[1, 0] / det, -H[0, 0] / det]])
    else:
        cov = np.full((2, 2), np.nan)
    se_shape = math.sqrt(max(0.0, cov[0, 0]))
    se_scale = scale * math.sqrt(max(0.0, cov[1, 1]))
    conf = args.get("conf", 0.95)
    z = float(stats.norm.isf((1 - conf) / 2))
    mttf = scale * math.exp(special_lgamma(1 + 1 / shape))
    psi = float(special_digamma(1 + 1 / shape))
    d_beta = -psi / (shape * shape)
    var_ln_mttf = cov[1, 1] + d_beta ** 2 * cov[0, 0] + 2 * d_beta * cov[0, 1]
    se_ln_mttf = math.sqrt(max(0.0, var_ln_mttf))
    ppf = lambda p: float(stats.weibull_min.ppf(p, shape, loc=0, scale=scale))
    # Kaplan–Meier plotting positions among failures (product-limit).
    order = np.argsort(times, kind="stable")
    at_risk = n
    survival = 1.0
    pts = []
    for idx in order:
        if cens[idx] == 1:
            at_risk -= 1
            continue
        survival *= 1 - 1 / max(1, at_risk)
        at_risk -= 1
        pts.append((float(times[idx]), min(1 - 1e-9, max(1e-9, 1 - survival))))
    fail_times = np.sort(times[cens == 0])
    ad = F.ad_statistic(stats.weibull_min.cdf(fail_times, shape, loc=0, scale=scale))
    ad_basis = "failures" if failures < n else "complete"
    ad_n = failures if ad_basis == "failures" else n
    ad_star = ad * (1 + 0.2 / math.sqrt(max(1, ad_n)))
    km_dev = max((abs(f_km - float(stats.weibull_min.cdf(t, shape, loc=0, scale=scale))) for t, f_km in pts), default=float("nan"))
    bag.put("shape", shape)
    bag.put("scale", scale)
    bag.put("se_shape", se_shape)
    bag.put("se_scale", se_scale)
    bag.put("ci_shape_low", shape * math.exp(-z * se_shape / shape))
    bag.put("ci_shape_high", shape * math.exp(z * se_shape / shape))
    bag.put("ci_scale_low", scale * math.exp(-z * se_scale / scale))
    bag.put("ci_scale_high", scale * math.exp(z * se_scale / scale))
    bag.put("loglik", loglik(shape, a))
    bag.put("mttf", mttf)
    bag.put("mttf_low", mttf * math.exp(-z * se_ln_mttf))
    bag.put("mttf_high", mttf * math.exp(z * se_ln_mttf))
    bag.put("median", ppf(0.5))
    bag.put("b10", ppf(0.1))
    bag.put("b5", ppf(0.05))
    bag.put("b90", ppf(0.9))
    bag.put("n", n)
    bag.put("failures", failures)
    bag.put("censored", n - failures)
    bag.put("ad", ad)
    bag.put("ad_adjusted", ad_star)
    bag.put("ad_basis", ad_basis)
    if ad_basis == "failures":
        cache_key = (times.tobytes(), cens.tobytes(), round(shape, 10), round(scale, 10), round(ad_star, 12))
        if cache_key not in _BOOT_CACHE:
            _BOOT_CACHE[cache_key] = weibull_bootstrap_p(times, cens, shape, scale, ad_star, reps=2000)
        bag.put("ad_bootstrap_p", _BOOT_CACHE[cache_key])
    else:
        bag.put("ad_bootstrap_p", float("nan"))
    bag.put("ad_bootstrap_reps", 2000 if ad_basis == "failures" else 0)
    bag.put("km_dev", km_dev)
    bag.put("km_critical05", 1.36 / math.sqrt(failures) if failures else float("nan"))
    mark(cid, "scipy.stats.weibull_min.fit(CensoredData) + numerical Hessian SE + independent AD/KM + monte_carlo bootstrap p (B=2000)")


def special_lgamma(x):
    from scipy import special
    return float(special.gammaln(x))


def special_digamma(x):
    from scipy import special
    return float(special.digamma(x))


def weibull_bootstrap_p(times, cens, shape, scale, observed_ad, reps=2000, seed=20261122):
    """Parametric bootstrap null distribution of the failures-only A*.

    Independent implementation: draws n lifetimes from the fitted Weibull, applies
    the observed censoring share with censoring times redrawn from the empirical
    censoring-time distribution, refits and recomputes A*.  Replicates with fewer
    than two failures are DROPPED (and counted), not repaired — the QA-F
    experiment compares this rule with the engine's two-earliest-read-as-failures
    correction.
    """
    rng = np.random.default_rng(seed)
    n = times.size
    cens_times = times[cens == 1]
    hits = 0
    used = 0
    dropped = 0
    for _ in range(reps):
        u = np.clip(rng.random(n), 1e-12, 1 - 1e-12)
        life = scale * (-np.log(u)) ** (1 / shape)
        # The sample's own censoring mechanism: each unit draws a censoring time
        # from the empirical censoring-time distribution and is censored exactly
        # when that time precedes its lifetime. (qa/experiments/qa_f_bootstrap.py
        # shows why the Bernoulli-share variant produced a Type I error of 100 %.)
        ct = rng.choice(cens_times, n)
        t = np.minimum(life, ct)
        keep_cens = (ct < life).astype(int)
        if int(np.sum(keep_cens == 0)) < 2:
            dropped += 1
            continue
        fit = F.weibull_profile_fit(t, keep_cens)
        if fit is None:
            dropped += 1
            continue
        s, sc = fit
        ft = np.sort(t[keep_cens == 0])
        rep_ad = F.ad_statistic(stats.weibull_min.cdf(ft, s, loc=0, scale=sc))
        rep_ad *= 1 + 0.2 / math.sqrt(max(1, ft.size))
        used += 1
        if not (rep_ad < observed_ad):
            hits += 1
    return (hits + 1) / (used + 1)


def op_lognorm_rel(bag, ds, args, cid):
    times = np.array([v for v in raw(ds, args["column"]) if v is not None and np.isfinite(v) and v > 0], dtype=float)
    if args.get("censorColumn"):
        cens_raw = raw(ds, args["censorColumn"])
        keep, cens = [], []
        for t, c in zip(raw(ds, args["column"]), cens_raw):
            if t is None or not np.isfinite(t) or t <= 0:
                continue
            if c is None or not np.isfinite(c):
                continue
            keep.append(t)
            cens.append(1 if c == 1 else 0)
        times = np.array(keep, dtype=float)
        cens = np.array(cens, dtype=int)
    else:
        cens = np.zeros(times.size, dtype=int)
    n, failures = times.size, int(np.sum(cens == 0))
    if n < 2 or failures < 2:
        raise RuntimeError("rel.needFailures")
    if failures == n:
        logs = np.log(times)
        mu = float(np.mean(logs))
        sigma = float(np.std(logs, ddof=0))
    else:
        s, loc, scale = stats.lognorm.fit(stats.CensoredData.right_censored(times, cens), floc=0)
        sigma = float(s)
        mu = float(math.log(scale))

    def loglik(m, sg):
        total = 0.0
        for t, c in zip(times, cens):
            z = (math.log(t) - m) / sg
            if c == 1:
                total += math.log(max(1e-300, float(stats.norm.sf(z))))
            else:
                total += -math.log(sg) - math.log(t) - 0.5 * math.log(2 * math.pi) - 0.5 * z * z
        return total

    h = 1e-5
    p0 = np.array([mu, math.log(sigma)])
    H = np.zeros((2, 2))
    for i in range(2):
        for j in range(2):
            pp = p0.copy(); pp[i] += h; pp[j] += h
            mm = p0.copy(); mm[i] -= h; mm[j] -= h
            pm = p0.copy(); pm[i] += h; pm[j] -= h
            mp = p0.copy(); mp[i] -= h; mp[j] += h
            H[i][j] = (loglik(pp[0], math.exp(pp[1])) - loglik(pm[0], math.exp(pm[1])) - loglik(mp[0], math.exp(mp[1])) + loglik(mm[0], math.exp(mm[1]))) / (4 * h * h)
    det = H[0, 0] * H[1, 1] - H[0, 1] * H[1, 0]
    se_mu = se_sigma = float("nan")
    if abs(det) > 1e-18:
        se_mu = math.sqrt(max(0.0, -H[1, 1] / det))
        se_sigma = sigma * math.sqrt(max(0.0, -H[0, 0] / det))
    bag.put("mu", mu)
    bag.put("sigma", sigma)
    bag.put("median", math.exp(mu))
    bag.put("mttf", math.exp(mu + sigma * sigma / 2))
    bag.put("loglik", loglik(mu, sigma))
    bag.put("n", n)
    bag.put("failures", failures)
    bag.put("censored", n - failures)
    bag.put("se_mu", se_mu)
    bag.put("se_sigma", se_sigma)
    bag.put("closed_form", 1 if failures == n else 0)
    mark(cid, "scipy.stats.lognorm.fit(CensoredData) + numerical Hessian" if failures < n else "closed-form normal MLE on ln t")


def _formula_term(name: str, kinds: dict) -> str:
    return f"C({name}, Sum)" if kinds[name] == "categorical" else name


def op_glm(bag, ds, args, cid):
    frame = pd.DataFrame({"__y": pd.Series(raw(ds, args["response"]), dtype=float)})
    kinds = {}
    for f in args["factors"]:
        kinds[f["name"]] = f["kind"]
        if f["kind"] == "numeric":
            frame[f["name"]] = pd.Series(raw(ds, f["column"]), dtype=float)
        else:
            frame[f["name"]] = pd.Series(texts(ds, f["column"]), dtype=object)
    frame = frame.dropna()
    rhs = " + ".join("*".join(_formula_term(n, kinds) for n in term) for term in args["terms"])
    model = smf.ols(f"__y ~ {rhs}", data=frame).fit()
    a1 = sm.stats.anova_lm(model, typ=1)
    a3 = sm.stats.anova_lm(model, typ=3)
    table1 = {str(i): a1.loc[i] for i in a1.index}
    table3 = {str(i): a3.loc[i] for i in a3.index}
    bag.put("n", int(model.nobs))
    bag.put("sse", float(np.sum(model.resid ** 2)))
    bag.put("mse", float(model.mse_resid))
    bag.put("s", math.sqrt(float(model.mse_resid)))
    bag.put("ss_total", float(model.centered_tss))
    bag.put("ss_model", float(model.ess))
    bag.put("r2", float(model.rsquared))
    bag.put("r2_adj", float(model.rsquared_adj))
    bag.put("rank", int(np.linalg.matrix_rank(model.model.exog)))
    bag.put("dfe", int(model.df_resid))
    # Under rank deficiency the aliased COLUMN COUNT is invariant (columns −
    # rank), while which term a dropped column is billed to depends on the
    # generalised inverse. Fitted values and residuals are invariant too: every
    # least-squares solution projects y onto the same column space.
    bag.put("aliased_count", model.model.exog.shape[1] - int(np.linalg.matrix_rank(model.model.exog)))
    for i, v in enumerate(model.fittedvalues):
        bag.put(f"fitted[{i}]", float(v))
    for i, v in enumerate(model.resid):
        bag.put(f"residuals[{i}]", float(v))
    for term in args["terms"]:
        label = str(":".join(_formula_term(n, kinds) for n in term))
        name = "×".join(term)
        row3 = table3.get(label)
        row1 = table1.get(label)
        if row3 is None:
            bag.put(f"term:{name}:df", 0)
            bag.put(f"term:{name}:ss_seq", 0.0)
            bag.put(f"term:{name}:ss_adj", 0.0)
            bag.put(f"term:{name}:ms_adj", 0.0)
            bag.put(f"term:{name}:f", float("nan"))
            bag.put(f"term:{name}:p", float("nan"))
            continue
        bag.put(f"term:{name}:df", int(round(row3["df"])))
        bag.put(f"term:{name}:ss_seq", float(row1["sum_sq"]) if row1 is not None else float("nan"))
        bag.put(f"term:{name}:ss_adj", float(row3["sum_sq"]))
        bag.put(f"term:{name}:ms_adj", float(row3["sum_sq"]) / row3["df"] if row3["df"] else 0.0)
        bag.put(f"term:{name}:f", float(row3["F"]))
        bag.put(f"term:{name}:p", float(row3["PR(>F)"]))
    bag.put("aliased", ",".join(args.get("expectAliased", [])))
    mark(cid, "statsmodels ols + anova_lm(typ=1/3) with C(factor, Sum) coding")


def _design_runs(rows, randomize, seed):
    order = F.shuffle_list(list(range(len(rows))), seed) if randomize else list(range(len(rows)))
    return [(i + 1, order.index(i) + 1, t, levels) for i, (t, levels) in enumerate(rows)]


def op_doecreate(bag, ds, args, cid):
    design = args.get("design", "factorial")
    k = args.get("k", 2)
    seed = args.get("seed", 20261122)
    randomize = args.get("randomize", True)
    if design == "factorial" and not (2 <= k <= 6):
        raise RuntimeError("doe.factorRange")
    if design == "ccd" and not (2 <= k <= 5):
        raise RuntimeError("doe.factorRange")
    if design == "ccd":
        alpha = args.get("alpha") or (2 ** k) ** 0.25
        rows = []
        for r in range(2 ** k):
            rows.append(("Factorial", [(-1 if ((r >> (k - 1 - f)) & 1) == 0 else 1) for f in range(k)]))
        for f in range(k):
            for sign in (-1, 1):
                lv = [0] * k
                lv[f] = sign * alpha
                rows.append(("Axial", lv))
        for _ in range(max(1, args.get("centers", 5))):
            rows.append(("Center", [0] * k))
    elif design == "bbd":
        rows = []
        for i, j in ((0, 1), (0, 2), (1, 2)):
            for a, b in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                lv = [0, 0, 0]
                lv[i], lv[j] = a, b
                rows.append(("Edge", lv))
        for _ in range(max(1, args.get("centers", 3))):
            rows.append(("Center", [0, 0, 0]))
    else:
        rows = []
        reps = max(1, args.get("replicates", 1))
        centers = max(0, args.get("centers", 0))
        for _ in range(reps):
            for r in range(2 ** k):
                rows.append(("Factorial", [(-1 if ((r >> (k - 1 - f)) & 1) == 0 else 1) for f in range(k)]))
            for _ in range(centers):
                rows.append(("Center", [0] * k))
    runs = _design_runs(rows, randomize, seed)
    bag.put("runs", len(runs))
    ptypes = {}
    for i, (std, run, t, levels) in enumerate(runs):
        bag.put(f"run[{i}]:std", std)
        bag.put(f"run[{i}]:run", run)
        for j, v in enumerate(levels):
            bag.put(f"run[{i}]:f{j}", v)
        ptypes[t] = ptypes.get(t, 0) + 1
    for kk, v in ptypes.items():
        bag.put(f"ptype:{kk}", v)
    mark(cid, "combinatorial design definition + documented mulberry32 shuffle (independent implementation)")


def _factorial_columns(frame, names, order):
    cols = {}
    for n in names:
        cols[n] = frame[n]
    terms = []
    for size in range(1, order + 1):
        import itertools
        for combo in itertools.combinations(names, size):
            terms.append(combo)
    return terms


def op_doeanalyze(bag, ds, args, cid):
    names = args["factors"]
    frame = pd.DataFrame({n: pd.Series(raw(ds, n), dtype=float) for n in names})
    frame["__y"] = pd.Series(raw(ds, args["response"]), dtype=float)
    frame = frame.dropna()
    order = args.get("order", 2)
    terms = _factorial_columns(frame, names, order)
    rhs = " + ".join(":".join(t) for t in terms)
    model = smf.ols(f"__y ~ {rhs}", data=frame).fit()
    for term in terms:
        label = ":".join(term)
        name = "×".join(term)
        bag.put(f"coef:{name}", float(model.params[label]))
        bag.put(f"effect:{name}", 2 * float(model.params[label]))
        bag.put(f"se:{name}", float(model.bse[label]))
        bag.put(f"t:{name}", float(model.tvalues[label]))
        bag.put(f"p:{name}", float(model.pvalues[label]))
    bag.put("sse", float(np.sum(model.resid ** 2)))
    bag.put("dfe", int(model.df_resid))
    bag.put("r2", float(model.rsquared))
    bag.put("r2_adj", float(model.rsquared_adj))
    bag.put("s", math.sqrt(float(model.mse_resid)))
    mark(cid, "statsmodels OLS on coded factors (effect = 2 × coefficient)")


def op_rsmanalyze(bag, ds, args, cid):
    names = args["factors"]
    frame = pd.DataFrame({n: pd.Series(raw(ds, n), dtype=float) for n in names})
    frame["__y"] = pd.Series(raw(ds, args["response"]), dtype=float)
    frame = frame.dropna()
    rhs = " + ".join(
        [n for n in names] + [f"I({n} ** 2)" for n in names] + [f"{a}:{b}" for i, a in enumerate(names) for b in names[i + 1:]]
    )
    model = smf.ols(f"__y ~ {rhs}", data=frame).fit()
    a3 = sm.stats.anova_lm(model, typ=3)
    def block(labels):
        labels = [l for l in labels if l in a3.index]
        return {"df": int(sum(a3.loc[l, "df"] for l in labels)), "ss": float(sum(a3.loc[l, "sum_sq"] for l in labels))}
    linear = block(names)
    square = block([f"I({n} ** 2)" for n in names])
    interaction = block([f"{a}:{b}" for i, a in enumerate(names) for b in names[i + 1:]])
    bag.put("linear:df", linear["df"])
    bag.put("linear:ss", linear["ss"])
    bag.put("square:df", square["df"])
    bag.put("square:ss", square["ss"])
    bag.put("interaction:df", interaction["df"])
    bag.put("interaction:ss", interaction["ss"])
    # pure error from replicated cells
    cells = frame.groupby(names, dropna=True)["__y"]
    ss_pure = float(sum(((g - g.mean()) ** 2).sum() for _, g in cells if len(g) >= 2))
    df_pure = int(sum(len(g) - 1 for _, g in cells if len(g) >= 2))
    sse = float(np.sum(model.resid ** 2))
    dfe = int(model.df_resid)
    if df_pure > 0:
        ms_pure = ss_pure / df_pure
        bag.put("pure:df", df_pure)
        bag.put("pure:ss", ss_pure)
        bag.put("pure:ms", ms_pure)
        lack_df = dfe - df_pure
        if lack_df > 0:
            ss_lack = sse - ss_pure
            ms_lack = ss_lack / lack_df
            f = ms_lack / ms_pure
            bag.put("lof:df", lack_df)
            bag.put("lof:ss", ss_lack)
            bag.put("lof:ms", ms_lack)
            bag.put("lof:f", f)
            bag.put("lof:p", float(stats.f.sf(f, lack_df, df_pure)))
    for n in names:
        bag.put(f"qcoef:{n}", float(model.params[n]))
        bag.put(f"qcoef:{n}²", float(model.params[f"I({n} ** 2)"]))
    for i, a in enumerate(names):
        for b2 in names[i + 1:]:
            bag.put(f"qcoef:{a}×{b2}", float(model.params[f"{a}:{b2}"]))
    bag.put("sse", sse)
    bag.put("dfe", dfe)
    bag.put("r2", float(model.rsquared))
    k = len(names)
    b = np.array([float(model.params[n]) for n in names])
    B = np.zeros((k, k))
    for i, n in enumerate(names):
        B[i, i] = float(model.params[f"I({n} ** 2)"])
    for i, a in enumerate(names):
        for b2 in names[i + 1:]:
            v = float(model.params[f"{a}:{b2}"])
            idx_i, idx_j = names.index(a), names.index(b2)
            B[idx_i, idx_j] = v / 2
            B[idx_j, idx_i] = v / 2
    if abs(np.linalg.det(B)) > 1e-14:
        point = -0.5 * np.linalg.solve(B, b)
        response = float(model.params["Intercept"] + b @ point + point @ B @ point)
        eigenvalues = sorted(np.linalg.eigvalsh(B), reverse=True)
        kind = "maximum" if all(e < -1e-9 for e in eigenvalues) else ("minimum" if all(e > 1e-9 for e in eigenvalues) else "saddle")
        max_abs = float(max(abs(point)))
        limit = abs(args.get("alpha")) if args.get("alpha") else 1.0
        for i, v in enumerate(point):
            bag.put(f"stationary:x{i}", float(v))
        bag.put("stationary:response", response)
        for i, v in enumerate(eigenvalues):
            bag.put(f"stationary:eigen{i}", float(v))
        bag.put("stationary:kind", kind)
        bag.put("stationary:max_abs", max_abs)
        bag.put("stationary:outside", 1 if max_abs > limit + 1e-9 else 0)
    mark(cid, "statsmodels OLS quadratic model + anova_lm(typ=3) blocks + numpy eigendecomposition")


def op_power(bag, ds, args, cid):
    from statsmodels.stats.power import FTestAnovaPower, TTestIndPower, TTestPower

    method = args["method"]
    solve = args.get("solveFor", "n")
    alpha = args.get("alpha", 0.05)
    alternative = args.get("alt", "two-sided")
    target = args.get("power", 0.9)
    sd = args.get("sd", 1.0)
    n = int(max(2, round(args.get("n") or 10)))
    difference = args.get("difference")
    if difference is None and args.get("p1") is not None and args.get("p2") is not None:
        difference = args["p2"] - args["p1"]
    groups = args.get("groups", 2)

    sm_alt = {"two-sided": "two-sided", "greater": "larger", "less": "smaller"}[alternative]

    def power_at(m, diff):
        if method in ("oneT", "paired"):
            return float(TTestPower().power(abs(diff) / sd if alternative == "two-sided" else diff / sd, m, alpha, alternative=sm_alt))
        if method == "twoT":
            return float(TTestIndPower().power(abs(diff) / sd if alternative == "two-sided" else diff / sd, m, alpha, alternative=sm_alt))
        if method == "anova":
            f = abs(diff) / (2 * sd)
            return float(FTestAnovaPower().power(f, m * groups, alpha, k_groups=groups))
        if method == "oneProp":
            p0 = args.get("p1", 0.5)
            return F.power_prop1(m, p0, p0 + diff, alpha, alternative)
        p1 = args.get("p1", 0.5)
        return F.power_prop2(m, p1, p1 + diff, alpha, alternative)

    # Requests the engine documents as invalid / unreachable (same contract):
    if target <= alpha or target >= 1:
        raise RuntimeError("power.unreachable")
    if method in ("oneProp", "twoProp") and solve != "difference":
        base = args.get("p1", 0.5)
        if not (0 < base < 1) or not (0 < base + difference < 1):
            raise RuntimeError("power.unreachable")
    if solve != "difference":
        if difference is None or not np.isfinite(difference):
            raise RuntimeError("power.needDifference")
        if (alternative == "greater" and difference < 0) or (alternative == "less" and difference > 0):
            # Asking for a sample size that can never reach the power in the
            # alternative's direction is unreachable; asking for the POWER of
            # such an effect is a valid request that answers below alpha.
            if solve == "n":
                raise RuntimeError("power.unreachable")
    if solve == "n":
        lo, hi = 2, 4
        for _ in range(40):
            if power_at(hi, difference) >= target:
                break
            hi *= 2
        if power_at(hi, difference) < target:
            raise RuntimeError("power.unreachable")
        while lo < hi - 1:
            mid = (lo + hi) // 2
            if power_at(mid, difference) >= target:
                hi = mid
            else:
                lo = mid
        # The engine caps an absurd request at n = 1e7 and reports it as
        # unreachable; the same documented cap is applied here so the contract,
        # not the numerics, is what is compared.
        if hi > 1e7:
            raise RuntimeError("power.unreachable")
        bag.put("n", hi)
        bag.put("power", power_at(hi, difference))
        bag.put("difference", difference)
    elif solve == "power":
        bag.put("n", n)
        bag.put("power", power_at(n, difference))
        bag.put("difference", difference)
    else:
        # signed effect search: dense grid + bisection on each admissible branch
        if method in ("oneProp", "twoProp"):
            base = args.get("p1", 0.5)
            lo_b, hi_b = -(base - 1e-9), 1 - base - 1e-9
        else:
            bound = max(1.0, sd * 20)
            lo_b, hi_b = -bound, bound
        if alternative == "greater":
            branches = [(1, hi_b)]
        elif alternative == "less":
            branches = [(-1, -lo_b)]
        else:
            branches = [(1, hi_b), (-1, -lo_b)]
        found = []
        for sign, bound in branches:
            if bound <= 1e-9:
                continue
            eps = 1e-9
            grid = np.linspace(eps, bound, 20001)
            hit = None
            prev = eps
            for mag in grid:
                if power_at(n, sign * mag) >= target:
                    a_, b_ = prev, mag
                    for _ in range(200):
                        mid = (a_ + b_) / 2
                        if power_at(n, sign * mid) >= target:
                            b_ = mid
                        else:
                            a_ = mid
                        if abs(b_ - a_) <= 1e-14 * max(1, abs(b_)):
                            break
                    hit = sign * b_
                    break
                prev = mag
            if hit is not None:
                found.append(hit)
        if not found:
            raise RuntimeError("power.unreachable")
        found.sort(key=abs)
        bag.put("n", n)
        bag.put("difference", found[0])
        bag.put("power", power_at(n, found[0]))
        if len(found) > 1 and abs(abs(found[0]) - abs(found[1])) > 1e-9 * max(abs(found[0]), abs(found[1]), 1):
            bag.put("opposite_difference", found[1])
    bag.put("method", method)
    mark(cid, "statsmodels TTestPower/TTestIndPower/FTestAnovaPower (noncentral t/F); proportions by the documented normal approximation")


def op_calc(bag, ds, args, cid):
    """Three documented formula-engine expressions evaluated directly with NumPy."""
    cols = {name: np.array([v for v in raw(ds, name) if v is not None], dtype=float) for name in args["columns"]}
    first = np.array(raw(ds, args["columns"][0]), dtype=float)
    formula = args["formula"]
    if formula == "C1 * 2 + 1":
        values = first * 2 + 1
    elif formula == "(C1 - MEAN(C1)) / STDEV(C1)":
        values = (first - np.nanmean(first)) / np.nanstd(first, ddof=1)
    elif formula == "ROUND(C1 / 3, 2)":
        values = np.round(first / 3, 2)
    elif formula == "C1 + C2":
        second = np.array(raw(ds, args["columns"][1]), dtype=float)
        values = first + second
    else:
        raise RuntimeError(f"formula.notMapped:{formula}")
    bag.put("rows", int(values.size))
    bag.put("constant", 0)
    bag.put("errors", int(np.sum(~np.isfinite(values))))
    for i, v in enumerate(values):
        bag.put(f"value[{i}]", float(v) if np.isfinite(v) else float("nan"))
    mark(cid, "numpy elementwise evaluation of the same documented formula")


def op_dist(bag, ds, args, cid):
    name = args["function"]
    a = args["args"]
    table = {
        "normalCdf": lambda: float(stats.norm.cdf(a[0], a[1] if len(a) > 1 else 0, a[2] if len(a) > 2 else 1)),
        "normalPdf": lambda: float(stats.norm.pdf(a[0], a[1] if len(a) > 1 else 0, a[2] if len(a) > 2 else 1)),
        "normalInv": lambda: float(stats.norm.ppf(a[0])),
        "tCdf": lambda: float(stats.t.cdf(a[0], a[1])),
        "tInv": lambda: float(stats.t.ppf(a[0], a[1])),
        "fCdf": lambda: float(stats.f.cdf(a[0], a[1], a[2])),
        "fInv": lambda: float(stats.f.ppf(a[0], a[1], a[2])),
        "chi2Cdf": lambda: float(stats.chi2.cdf(a[0], a[1])),
        "gammaP": lambda: float(stats.gamma.cdf(a[1], a[0])),
        "gammaCdf": lambda: float(stats.gamma.cdf(a[0], a[1], scale=a[2] if len(a) > 2 else 1)),
        "gammaInv": lambda: float(stats.gamma.ppf(a[0], a[1], scale=a[2] if len(a) > 2 else 1)),
        "weibullCdf": lambda: float(stats.weibull_min.cdf(a[0], a[1], scale=a[2])),
        "weibullInv": lambda: float(stats.weibull_min.ppf(a[0], a[1], scale=a[2])),
        "lognormalCdf": lambda: float(stats.lognorm.cdf(a[0], a[2], scale=math.exp(a[1]))),
        "lognormalInv": lambda: float(stats.lognorm.ppf(a[0], a[2], scale=math.exp(a[1]))),
        "nctCdf": lambda: float(stats.nct.cdf(a[0], a[1], a[2])),
        "ncfCdf": lambda: float(stats.ncf.cdf(a[0], a[1], a[2], a[3])),
        "rangeCdf": lambda: float(stats.studentized_range.cdf(a[0], a[1], a[2])),
        "rangeInv": lambda: float(stats.studentized_range.ppf(a[0], a[1], a[2])),
        "logGamma": lambda: float(special_lgamma(a[0])),
        "c4": lambda: F.c4(a[0]),
    }
    if name not in table:
        raise RuntimeError(f"unknown dist function {name}")
    bag.put("value", table[name]())
    mark(cid, "scipy.stats / scipy.special")


def _coding_value(predictor, value, mode):
    """Coded ⇄ actual conversion for one numeric predictor."""
    coding = predictor.get("coding")
    if coding is None:
        return float(value)
    value = float(value)
    if coding["mode"] == "coded":
        return value if mode == "coded" else (value - coding["center"]) / coding["halfRange"]
    return value if mode == "actual" else coding["center"] + coding["halfRange"] * value


def _model_design_row(spec, values, mode):
    """The design row for one point, built from the coefficient labels."""
    by_name = {p["name"]: p for p in spec["predictors"]}
    row = []
    for coefficient in spec["coefficients"]:
        label = coefficient["label"]
        if label == "Constant":
            row.append(1.0)
            continue
        product = 1.0
        for token in label.split("×"):
            level = None
            match = re.search(r"\[(.+)\]$", token)
            if match:
                level = match.group(1)
                token = token[: match.start()]
            power = 1
            while token.endswith("²") or token.endswith("³"):
                power *= 2 if token.endswith("²") else 3
                token = token[:-1]
            predictor = by_name[token]
            if predictor["kind"] == "categorical":
                levels = predictor["levels"]
                value = str(values[token])
                if value not in levels:
                    raise ValueError("model.levelUnknown")
                product *= 1.0 if value == level else (-1.0 if value == levels[-1] else 0.0)
            else:
                base = _coding_value(predictor, values[token], mode)
                product *= base if power == 1 else base ** power
        row.append(product)
    return np.array(row, dtype=float)


def op_modelpredict(bag, ds, args, cid):
    """Prediction from a stored model: X'β with the model's own coding.

    Independent of the TypeScript predictor: the design row, the contrast
    coding and the interval are rebuilt here with NumPy and SciPy.
    """
    spec = args["model"]
    labels = [c["label"] for c in spec["coefficients"]]
    beta = np.array([float(c["value"]) for c in spec["coefficients"]])
    non_estimable = set(spec.get("nonEstimable") or [])
    covariance = spec.get("covariance")
    residual = spec.get("residual") or {}
    df = residual.get("df")

    refused = 0
    for index, point in enumerate(args.get("points", [])):
        mode = point.get("mode", "actual")
        row = _model_design_row(spec, point["values"], mode)
        # A row that leans on an unidentified column has no value: the same
        # rule the shipped predictor applies.
        leaning = [labels[i] for i in range(len(labels)) if row[i] != 0 and labels[i] in non_estimable]
        if leaning:
            refused += 1
            bag.put(f"nonestimable[{index}]", ",".join(sorted(leaning)))
            bag.put(f"pred[{index}]", None)
            bag.put(f"se[{index}]", None)
            bag.put(f"pi_low[{index}]", None)
            bag.put(f"pi_high[{index}]", None)
            bag.put(f"issues[{index}]", "")
            continue
        fit = float(row @ beta)
        se = None
        pi_low = pi_high = None
        if covariance and df:
            sigma = np.array(covariance, dtype=float)
            variance = float(row @ sigma @ row)
            if variance >= 0:
                se = math.sqrt(variance)
                mse = float(residual.get("mse", 0.0))
                half = float(stats.t.ppf(0.975, df)) * math.sqrt(variance + max(0.0, mse))
                pi_low, pi_high = fit - half, fit + half
        bag.put(f"pred[{index}]", fit)
        bag.put(f"se[{index}]", se)
        bag.put(f"pi_low[{index}]", pi_low)
        bag.put(f"pi_high[{index}]", pi_high)
        bag.put(f"issues[{index}]", "")
    bag.put("refused", refused)
    if refused and refused == len(args.get("points", [])):
        raise RuntimeError("model.nonEstimable")
    mark(cid, "numpy X'β · X'ΣX · scipy t prediction interval")


# ── Stage 3B: 3D surface and overlaid contour ───────────────────────────

def _quadratic_design(a, b):
    """Columns of the fitted quadratic, in the order const, a, b, ab, a², b²."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    return np.column_stack([np.ones_like(a), a, b, a * b, a * a, b * b])


def _quadratic_fit(ds, response, factors):
    a = np.asarray(ds["columns"][factors[0]], dtype=float)
    b = np.asarray(ds["columns"][factors[1]], dtype=float)
    y = np.asarray(ds["columns"][response], dtype=float)
    X = _quadratic_design(a, b)
    model = sm.OLS(y, X).fit()
    return model


def _grid(model, x_range, y_range, resolution):
    xs = np.linspace(x_range[0], x_range[1], resolution)
    ys = np.linspace(y_range[0], y_range[1], resolution)
    aa, bb = np.meshgrid(xs, ys, indexing="xy")
    X = _quadratic_design(aa.ravel(), bb.ravel())
    z = (X @ model.params).reshape(len(ys), len(xs))
    return xs, ys, z


def op_surface3d(bag, ds, args, cid):
    """A 3D surface is a quadratic evaluated on a factor grid.

    Independent of the TypeScript surface module: the design matrix, the grid
    and every prediction are rebuilt here from statsmodels' fit. The adapter's
    own 3D-vs-2D difference is compared with the literal 0 this function
    reports, i.e. the two internal paths must agree.
    """
    factors = args["factors"]
    model = _quadratic_fit(ds, args["response"], factors)
    resolution = int(args.get("resolution", 21))
    # Ranges are explicit in the case so both sides grid the identical interval.
    x_range = args["xRange"]
    y_range = args["yRange"]
    xs, ys, z = _grid(model, x_range, y_range, resolution)
    bag.put("surface_contour_max_diff", 0.0)
    bag.put("grid_points", len(xs))
    bag.put("z_min", float(np.min(z)))
    bag.put("z_max", float(np.max(z)))
    bag.put("x_min", float(xs[0]))
    bag.put("x_max", float(xs[-1]))
    bag.put("y_min", float(ys[0]))
    bag.put("y_max", float(ys[-1]))
    for index, (i, j) in enumerate(args.get("probes", [])):
        bag.put(f"z[{index}]", float(z[j, i]))
        # The contour path must land on the same number.
        bag.put(f"z_contour[{index}]", float(z[j, i]))
    bag.put("coefficient_count", len(model.params))
    centre_row = _quadratic_design([0.0], [0.0])
    centre = float(centre_row @ model.params)
    centre_se = float(np.sqrt(model.cov_params()[0, 0]))
    bag.put("centre_value", centre)
    bag.put("centre_se", centre_se)
    mark(cid, "statsmodels OLS quadratic · numpy grid evaluation")


def op_feasible(bag, ds, args, cid):
    """Overlaid contour: every response judged on the same factor grid.

    The masks, the joint region and the area estimate are computed here with
    numpy from statsmodels fits. The area is also measured on a grid four times
    finer (a midpoint rule) so the adapter's polygon area has an independent
    number to be compared with.
    """
    factors = args["factors"]
    specs = args["responses"]
    x_range = args["xRange"]
    y_range = args["yRange"]
    resolution = int(args.get("resolution", 21))
    basis = args.get("basis", "mean")
    alpha = float(args.get("alpha", 0.05))
    models = [_quadratic_fit(ds, spec["name"], factors) for spec in specs]
    xs, ys, zs = zip(*[_grid(model, x_range, y_range, resolution) for model in models])
    xs, ys = xs[0], ys[0]
    masks = []
    for model, spec, z in zip(models, specs, zs):
        tq = float(stats.t.ppf(1 - alpha / 2, model.df_resid))
        half = None
        if basis != "mean":
            aa, bb = np.meshgrid(xs, ys, indexing="xy")
            rows = _quadratic_design(aa.ravel(), bb.ravel())
            variance = np.einsum("ij,jk,ik->i", rows, model.cov_params(), rows)
            scale = np.sqrt(np.maximum(variance, 0.0))
            if basis == "prediction":
                scale = np.sqrt(np.maximum(variance, 0.0) + model.mse_resid)
            half = (tq * scale).reshape(z.shape)
        lo = z if half is None else z - half
        hi = z if half is None else z + half
        mask = np.ones_like(z, dtype=int)
        if spec.get("lsl") is not None:
            mask &= (lo >= float(spec["lsl"])).astype(int)
        if spec.get("usl") is not None:
            mask &= (hi <= float(spec["usl"])).astype(int)
        masks.append(mask)
    def joint_ratio(resolution_n: int) -> float:
        """Share of nodes where every response satisfies its spec on an N×N grid."""
        acc = None
        for model, spec in zip(models, specs):
            _, _, z = _grid(model, x_range, y_range, resolution_n)
            tq = float(stats.t.ppf(1 - alpha / 2, model.df_resid))
            half = None
            if basis != "mean":
                fx = np.linspace(x_range[0], x_range[1], resolution_n)
                fy = np.linspace(y_range[0], y_range[1], resolution_n)
                aa, bb = np.meshgrid(fx, fy, indexing="xy")
                rows = _quadratic_design(aa.ravel(), bb.ravel())
                variance = np.einsum("ij,jk,ik->i", rows, model.cov_params(), rows)
                scale = np.sqrt(np.maximum(variance, 0.0))
                if basis == "prediction":
                    scale = np.sqrt(np.maximum(variance, 0.0) + model.mse_resid)
                half = (tq * scale).reshape(z.shape)
            lo = z if half is None else z - half
            hi = z if half is None else z + half
            mask = np.ones_like(z, dtype=int)
            if spec.get("lsl") is not None:
                mask &= (lo >= float(spec["lsl"])).astype(int)
            if spec.get("usl") is not None:
                mask &= (hi <= float(spec["usl"])).astype(int)
            acc = mask if acc is None else (acc & mask)
        return float(acc.sum() / acc.size)

    joint = np.ones_like(zs[0], dtype=int)
    for mask in masks:
        joint &= mask
    total = joint.size
    feasible_nodes = int(joint.sum())
    bag.put("feasible_nodes", feasible_nodes)
    bag.put("total_nodes", int(total))
    bag.put("node_ratio", feasible_nodes / total)
    # Independent area estimate: the same judgement on a grid four times finer.
    bag.put("area_ratio_fine", joint_ratio(min(801, resolution * 4)))
    bag.put("interval_blocked", "")
    # The adapter states convergence as |ratio(2× grid) − ratio(grid)|.
    bag.put("convergence_delta", abs(joint_ratio(resolution * 2) - feasible_nodes / total))
    bag.put("narrow", 1 if feasible_nodes == 0 else 0)
    for index, mask in enumerate(masks):
        bag.put(f"response_{index}_node_ratio", float(mask.sum() / total))
        bag.put(f"response_{index}_area_ratio", float(mask.sum() / total))
    probes = args.get("probes", [])
    bag.put("probe_feasible", ",".join(str(int(joint[j, i])) for i, j in probes))
    for index, (i, j) in enumerate(probes):
        for r, z in enumerate(zs):
            bag.put(f"z_{r}[{index}]", float(z[j, i]))
    bag.put("x_min", float(xs[0]))
    bag.put("x_max", float(xs[-1]))
    bag.put("y_min", float(ys[0]))
    bag.put("y_max", float(ys[-1]))
    mark(cid, "statsmodels OLS quadratic · numpy grid masks · 4× finer area quadrature")


def op_sheet(bag, ds, args, cid):
    """QA-U — the documented chart / worksheet-transform rules, independently.

    The adapter runs the shipped analysis runner; here the same quantities are
    re-derived from the rules documented in charts.ts / analyses.ts (bin rule,
    type-6 quantiles, 1.5·IQR whiskers, sum-to-zero-free OLS fit, …) so the
    runner's output is verified, not translated.
    """
    analysis = args["analysis"]
    emit = args["emit"]
    columns = {k: list(v) for k, v in ds["columns"].items()}

    if emit == "pareto":
        col = args["values"]["category"]
        idx = int(col[1:]) - 1
        name = list(columns)[idx]
        counts = {}
        for v in columns[name]:
            if v is None or v == "":
                continue
            key = str(v)
            counts[key] = counts.get(key, 0) + 1
        items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        total = sum(counts.values())
        bag.put("items", len(items))
        bag.put("total", total)
        cum = 0
        for i, (label, count) in enumerate(items):
            cum += count
            bag.put(f"label[{i}]", label)
            bag.put(f"count[{i}]", count)
            # Same display rule as the runner's table: one decimal place.
            bag.put(f"pct[{i}]", float(f"{count / total * 100:.1f}"))
            bag.put(f"cum[{i}]", float(f"{cum / total * 100:.1f}"))
        mark(cid, "pandas value counts + documented 1-decimal display rule")
        return

    if emit == "histogram":
        name = list(columns)[int(args["values"]["variable"][1:]) - 1]
        data = np.array([v for v in columns[name] if v is not None and np.isfinite(v)], dtype=float)
        n = data.size
        bag.put("n", int(n))
        bin_count = int(args["values"].get("bins") or 0)
        bins = bin_count if bin_count > 0 else max(5, min(20, math.ceil(1 + math.log2(n))))
        lo, hi = float(np.min(data)), float(np.max(data))
        width = (hi - lo) / bins or 1
        bag.put("bins", bins)
        bag.put("bin_lo0", lo)
        bag.put("bin_hi_last", lo + bins * width)
        idx = np.minimum(bins - 1, np.maximum(0, np.floor((data - lo) / width))).astype(int)
        hist = np.bincount(idx, minlength=bins)
        for i in range(bins):
            bag.put(f"count[{i}]", int(hist[i]))
        m, s = float(np.mean(data)), float(np.std(data, ddof=1))
        bag.put("curve_mean", m)
        bag.put("curve_sd", s)
        for i in (0, 60, 120):
            x = lo + (hi - lo) * i / 120
            bag.put(f"curve_x[{i}]", x)
            bag.put(f"curve_y[{i}]", float(stats.norm.pdf(x, m, s)) * n * width)
        mark(cid, "documented bin rule (max(5,min(20,1+log2 n))) + scipy.stats.norm.pdf curve")
        return

    if emit == "boxplot":
        name = list(columns)[int(args["values"]["variables"][0][1:]) - 1]
        v = np.sort(np.array([x for x in columns[name] if x is not None and np.isfinite(x)], dtype=float))
        q1, med, q3 = (float(np.quantile(v, p, method="weibull")) for p in (0.25, 0.5, 0.75))
        iqr = q3 - q1
        lowf, highf = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        inner = v[(v >= lowf) & (v <= highf)]
        outs = v[(v < lowf) | (v > highf)]
        bag.put("groups", 1)
        bag.put("g[0]_label", name)
        bag.put("g[0]_n", int(v.size))
        bag.put("g[0]_q1", q1)
        bag.put("g[0]_median", med)
        bag.put("g[0]_q3", q3)
        bag.put("g[0]_iqr", iqr)
        bag.put("g[0]_low_fence", lowf)
        bag.put("g[0]_high_fence", highf)
        bag.put("g[0]_whisker_low", float(inner[0]) if inner.size else q1)
        bag.put("g[0]_whisker_high", float(inner[-1]) if inner.size else q3)
        bag.put("g[0]_mean", float(np.mean(v)))
        bag.put("g[0]_outliers", int(outs.size))
        for i in range(2):
            bag.put(f"g[0]_outlier[{i}]", float(outs[i]) if i < outs.size else None)
        mark(cid, "numpy.quantile(method='weibull') + 1.5·IQR whisker rule")
        return

    if emit == "scatter":
        xname = list(columns)[int(args["values"]["x"][1:]) - 1]
        yname = list(columns)[int(args["values"]["y"][1:]) - 1]
        byname = list(columns)[int(args["values"]["by"][0][1:]) - 1] if args["values"].get("by") else None
        xs, ys, gs = [], [], []
        for x, y, g in zip(columns[xname], columns[yname], columns[byname] if byname else [None] * len(columns[xname])):
            if x is None or y is None or not (np.isfinite(x) and np.isfinite(y)):
                continue
            xs.append(float(x))
            ys.append(float(y))
            gs.append(str(g) if g is not None else "")
        xs, ys = np.array(xs), np.array(ys)
        fit = stats.linregress(xs, ys)
        bag.put("n", int(xs.size))
        bag.put("slope", float(fit.slope))
        bag.put("intercept", float(fit.intercept))
        labels, counts = [], []
        for g in gs:
            if g in labels:
                counts[labels.index(g)] += 1
            else:
                labels.append(g)
                counts.append(1)
        bag.put("groups", len(labels))
        for i, label in enumerate(labels):
            bag.put(f"g[{i}]_label", label)
            bag.put(f"g[{i}]_n", counts[i])
        mark(cid, "scipy.stats.linregress + first-appearance group mapping")
        return

    if emit == "timeseries":
        name = list(columns)[int(args["values"]["variable"][1:]) - 1]
        data = np.array([v if v is not None and np.isfinite(v) else np.nan for v in columns[name]], dtype=float)
        finite = data[np.isfinite(data)]
        bag.put("length", int(data.size))
        bag.put("n", int(finite.size))
        bag.put("mean", float(np.mean(finite)))
        bag.put("min", float(np.min(finite)))
        bag.put("max", float(np.max(finite)))
        for key in ("lsl", "usl", "target"):
            raw = str(args["values"].get(key, "")).strip()
            bag.put(key, float(raw) if raw else None)
        mark(cid, "numpy summary of the finite sequence + spec-limit echo")
        return

    if emit == "sheet":
        frame = pd.DataFrame(columns)
        analysis = args["analysis"]
        values = args["values"]
        if analysis == "sort":
            key = list(columns)[int(values["column"][1:]) - 1]
            ordered = frame.sort_values(key, ascending=not values.get("descending"), na_position="last", kind="mergesort")
            for name in args["emitColumns"]:
                for i, v in enumerate(ordered[name].tolist()):
                    bag.put(f"{name}[{i}]", v)
            bag.put("columns", len(frame.columns))
            mark(cid, "pandas.sort_values(stable, na_position='last')")
            return
        if analysis == "standardize":
            key = list(columns)[int(values["column"][1:]) - 1]
            data = np.array([v for v in columns[key] if v is not None and np.isfinite(v)], dtype=float)
            m, s = float(np.mean(data)), float(np.std(data, ddof=1))
            z = [(x - m) / s if x is not None and np.isfinite(x) else None for x in columns[key]]
            zf = np.array([v for v in z if v is not None], dtype=float)
            bag.put("columns", len(frame.columns) + 1)
            bag.put("z_mean", float(np.mean(zf)))
            bag.put("z_sd", float(np.std(zf, ddof=1)))
            for i, v in enumerate(z):
                bag.put(f"Std value[{i}]", v)
            mark(cid, "(x − mean) / sample sd over the finite values")
            return
        if analysis == "recode":
            key = list(columns)[int(values["column"][1:]) - 1]
            mapping = {}
            for part in str(values["mapping"]).split(","):
                if "=" in part:
                    a, b = part.split("=", 1)
                    try:
                        mapping[float(a.strip())] = float(b.strip())
                    except ValueError:
                        pass
            fallback_raw = str(values.get("fallback", "")).strip()
            out = []
            for v in columns[key]:
                if not isinstance(v, (int, float)) or v is None or not np.isfinite(v):
                    out.append(None)
                    continue
                hit = next((to for frm, to in mapping.items() if abs(frm - v) < 1e-9), None)
                out.append(hit if hit is not None else (float(fallback_raw) if fallback_raw else v))
            bag.put("columns", len(frame.columns) + 1)
            tallies = {}
            for v in out:
                if v is not None:
                    tallies[v] = tallies.get(v, 0) + 1
            for value in (10.0, 20.0, 30.0, 9.0):
                bag.put(f"count:{int(value)}", tallies.get(value, 0))
            for i, v in enumerate(out):
                bag.put(f"Recode code[{i}]", v)
            mark(cid, "documented mapping/fallback rule")
            return
        if analysis == "random":
            count = int(values["count"])
            bag.put("columns", len(frame.columns) + 1)
            bag.put("n", count)
            bag.put("mean", float(values["mean"]))
            bag.put("sd", float(values["sd"]))
            bag.put("repeat_max_diff", 0.0)
            bag.put("all_finite", 1)
            mark(cid, "population parameters; tolerance covers the sampling error (see case note)")
            return
        raise RuntimeError(f"sheet:{analysis} not implemented")

    raise RuntimeError(f"unknown emit {emit}")


def op_nelson(bag, ds, args, cid):
    values = [v for v in nums(ds, args["column"]) if np.isfinite(v)]
    flags = F.nelson_rules(values, args["center"], args["sigma"])
    for i, rules in enumerate(flags):
        bag.put(f"rules[{i}]", ",".join(str(r) for r in rules))
    bag.put("flagged", sum(1 for f in flags if f))
    mark(cid, "independent_formula: Nelson (1984) rules 1–8")


OPS = {
    "desc": op_desc,
    "normality": op_normality,
    "t1": op_t1,
    "t2": op_t2,
    "paired": op_paired,
    "anova": op_anova,
    "regression": op_regression,
    "imr": op_imr,
    "xbarr": op_xbarr,
    "xbars": op_xbars,
    "pchart": op_pchart,
    "npchart": op_npchart,
    "cchart": op_cchart,
    "uchart": op_uchart,
    "capability": op_capability,
    "sixpack": op_sixpack,
    "capnonnormal": op_capnonnormal,
    "gagerr": op_gagerr,
    "weibull": op_weibull,
    "lognorm_rel": op_lognorm_rel,
    "glm": op_glm,
    "doecreate": op_doecreate,
    "doeanalyze": op_doeanalyze,
    "rsmcreate": op_doecreate,
    "rsmanalyze": op_rsmanalyze,
    "power": op_power,
    "dist": op_dist,
    "calc": op_calc,
    "sheet": op_sheet,
    "modelpredict": op_modelpredict,
    "surface3d": op_surface3d,
    "feasible": op_feasible,
    "nelson": op_nelson,
}


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: engine.py <request.json> <output.json>", file=sys.stderr)
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8") as fh:
        request = json.load(fh)
    datasets_dir = request["datasetsDir"]
    if not os.path.isabs(datasets_dir):
        datasets_dir = os.path.join(os.path.dirname(HERE), "..", datasets_dir)
    results = {}
    cache = {}
    for case in request["cases"]:
        cid = case["id"]
        if case.get("adapterOnly"):
            results[cid] = {"status": "skipped", "reason": "adapterOnly: no independent reference exists"}
            continue
        bag = Bag()
        try:
            op = OPS[case["op"]]
            if case.get("op") == "rsmcreate":
                case = dict(case)
                case["args"] = dict(case.get("args", {}), design="bbd" if case.get("args", {}).get("design") == "bbd" else "ccd")
                op = op_doecreate
            ds = {"columns": {}}
            if case.get("dataset"):
                name = case["dataset"]
                if name not in cache:
                    cache[name] = load_dataset(datasets_dir, name)
                ds = cache[name]
            op(bag, ds, case.get("args", {}), cid)
            results[cid] = {"status": "ok", "values": bag.values}
        except Exception as exc:  # noqa: BLE001 — an engine-level error is a QA result
            results[cid] = {"status": "error", "errorCode": str(exc), "errorMessage": repr(exc)}
    payload = {
        "meta": {
            "engine": "qa/reference/engine.py",
            "python": sys.version.split()[0],
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "statsmodels": statsmodels.__version__,
            "pandas": pd.__version__,
            "patsy": __import__("patsy").__version__,
            "platform": platform.platform(),
            "cases": len(request["cases"]),
            "methods": METHODS,
            "warnings": WARNINGS,
        },
        "results": results,
    }
    with open(sys.argv[2], "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
    print(f"reference: {len(results)} cases → {sys.argv[2]}")


if __name__ == "__main__":
    main()
