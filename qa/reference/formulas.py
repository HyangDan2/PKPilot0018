"""Sigrún QA — independent reference formulas.

Everything in this module is an *independent* implementation from a published
definition (a standard text, a NIST/SEMATECH handbook page or a cited paper).
It is only used where no vetted library API exists; each function carries the
source it was implemented from and the engine's own convention where the two
implementations must agree on a documented choice (for example the weighted
within-subgroup sigma of the Xbar-R chart).

Nothing here is a translation of src/lib/*.ts.  Where a library API exists the
engine module calls it instead (scipy.stats, statsmodels, numpy).
"""

from __future__ import annotations

import math

import numpy as np
from scipy import special, stats

# ── control-chart constants ────────────────────────────────────────────────
#
# Montgomery, "Introduction to Statistical Quality Control", Appendix VI:
# d2 and d3 (the mean and standard deviation of the relative range R/sigma for
# a normal sample of size n).  A2, D3 and D4 are NOT tabulated here — they are
# derived from d2/d3 with their definitions, which is what makes this an
# independent check of the engine's hard-coded table:
#
#   A2 = 3 / (d2 * sqrt(n))      D3 = max(0, 1 - 3 d3/d2)      D4 = 1 + 3 d3/d2
D2 = {
    2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704,
    8: 2.847, 9: 2.970, 10: 3.078, 11: 3.173, 12: 3.258, 13: 3.336,
    14: 3.407, 15: 3.472, 16: 3.532, 17: 3.588, 18: 3.640, 19: 3.689,
    20: 3.735, 25: 3.931,
}
D3 = {
    2: 0.853, 3: 0.888, 4: 0.880, 5: 0.864, 6: 0.848, 7: 0.833,
    8: 0.820, 9: 0.808, 10: 0.797, 11: 0.787, 12: 0.778, 13: 0.770,
    14: 0.763, 15: 0.756, 16: 0.750, 17: 0.744, 18: 0.739, 19: 0.734,
    20: 0.729, 25: 0.708,
}


def chart_constants(n: int) -> dict:
    """A2 / d2 / d3 / D3 / D4 from the published d2, d3 and their definitions."""
    d2 = D2[n]
    d3 = D3[n]
    return {
        "A2": 3.0 / (d2 * math.sqrt(n)),
        "d2": d2,
        "d3": d3,
        "D3": max(0.0, 1.0 - 3.0 * d3 / d2),
        "D4": 1.0 + 3.0 * d3 / d2,
    }


def c4(n: float) -> float:
    """Unbiasing constant c4(n) = sqrt(2/(n-1)) * Gamma(n/2) / Gamma((n-1)/2)."""
    return math.sqrt(2.0 / (n - 1.0)) * math.exp(special.gammaln(n / 2.0) - special.gammaln((n - 1.0) / 2.0))


def xbar_s_constants(n: int) -> dict:
    c = c4(n)
    spread = math.sqrt(max(0.0, 1.0 - c * c))
    return {"c4": c, "A3": 3.0 / (c * math.sqrt(n)), "B3": max(0.0, 1.0 - 3.0 * spread / c), "B4": 1.0 + 3.0 * spread / c}


# ── Nelson rules ──────────────────────────────────────────────────────────
#
# Nelson (1984), "The Shewhart Control Chart — Tests for Special Causes",
# Journal of Quality Technology 16(4).  Rules 1–8 evaluated on windows that
# END at each point, which is how the engine flags "the point that completes
# the pattern" (rule 2: 9 on one side; 3: 6 monotone; 4: 14 alternating;
# 5: 2 of 3 beyond 2 sigma; 6: 4 of 5 beyond 1 sigma; 7: 15 within 1 sigma;
# 8: 8 beyond 1 sigma either side).
def nelson_rules(values, center: float, sigma) -> list[list[int]]:
    n = len(values)
    out: list[list[int]] = [[] for _ in range(n)]

    def sig(i: int) -> float:
        if isinstance(sigma, (list, tuple, np.ndarray)):
            return float(sigma[min(i, len(sigma) - 1)])
        return float(sigma)

    z = [(values[i] - center) / max(1e-12, sig(i)) for i in range(n)]
    for i in range(n):
        if abs(z[i]) > 3:
            out[i].append(1)
        if i >= 8 and (all(v > 0 for v in z[i - 8:i + 1]) or all(v < 0 for v in z[i - 8:i + 1])):
            out[i].append(2)
        if i >= 5:
            w = values[i - 5:i + 1]
            if all(w[j] > w[j - 1] for j in range(1, 6)) or all(w[j] < w[j - 1] for j in range(1, 6)):
                out[i].append(3)
        if i >= 13:
            w = values[i - 13:i + 1]
            diffs = [w[j] - w[j - 1] for j in range(1, 14)]
            if all(diffs[j - 1] * diffs[j] < 0 for j in range(1, 13)):
                out[i].append(4)
        if i >= 2:
            w = z[i - 2:i + 1]
            if (sum(1 for v in w if v > 2) >= 2 and z[i] > 2) or (sum(1 for v in w if v < -2) >= 2 and z[i] < -2):
                out[i].append(5)
        if i >= 4:
            w = z[i - 4:i + 1]
            if (sum(1 for v in w if v > 1) >= 4 and z[i] > 1) or (sum(1 for v in w if v < -1) >= 4 and z[i] < -1):
                out[i].append(6)
        s_i = sigma[i] if isinstance(sigma, (list, tuple, np.ndarray)) else sigma
        if i >= 14 and (s_i > 0) and all(abs(v) < 1 for v in z[i - 14:i + 1]):
            out[i].append(7)
        if i >= 7 and all(abs(v) > 1 for v in z[i - 7:i + 1]):
            out[i].append(8)
    return out


# ── Anderson–Darling ──────────────────────────────────────────────────────
#
# A² = −n − (1/n) Σ_{i=1..n} (2i−1) [ ln F(x_(i)) + ln(1 − F(x_(n+1−i))) ]
# (Anderson & Darling 1954; Stephens 1974).  The CDF values F are those of the
# FITTED distribution at the ordered observations.
def ad_statistic(cdf_values) -> float:
    f = np.clip(np.sort(np.asarray(cdf_values, dtype=float)), 1e-12, 1 - 1e-12)
    n = f.size
    if n == 0:
        return float("nan")
    i = np.arange(1, n + 1)
    return float(-n - np.sum((2 * i - 1) * (np.log(f) + np.log(1 - f[::-1]))) / n)


# D'Agostino & Stephens (1986) small-sample p-value for the normal case.
# Piecewise approximation in A* with the published coefficients; the band edges
# (A* = 0.2 / 0.34 / 0.6) are the same thresholds at which the tabulated
# critical values of scipy.stats.anderson change, which is how it is checked.
def ad_normal_p(ad_star: float) -> float:
    a = ad_star
    if not math.isfinite(a):
        return float("nan")
    if a < 0.2:
        p = 1 - math.exp(-13.436 + 101.14 * a - 223.73 * a * a)
    elif a < 0.34:
        p = 1 - math.exp(-8.318 + 42.796 * a - 59.938 * a * a)
    elif a < 0.6:
        p = math.exp(0.9177 - 4.279 * a - 1.38 * a * a)
    else:
        p = math.exp(1.2937 - 5.709 * a + 0.0186 * a * a)
    return min(1.0, max(0.0, p))


def ad_normal_adjusted(ad: float, n: int) -> float:
    """Stephens' A* = A²(1 + 0.75/n + 2.25/n²) for the normal case."""
    return ad * (1.0 + 0.75 / n + 2.25 / (n * n))


def ad_nonnormal_adjusted(ad: float, n: int) -> float:
    """A* = A²(1 + 0.2/√n) — the correction used for estimated-parameter fits."""
    return ad * (1.0 + 0.2 / math.sqrt(n))


# ── capability ────────────────────────────────────────────────────────────
def moving_range_sigma(values) -> float:
    v = np.asarray(values, dtype=float)
    if v.size < 2:
        return float("nan")
    return float(np.mean(np.abs(np.diff(v))) / D2[2])


def within_subgroup_sigma(values, subgroup: int) -> float:
    """Pooled within-subgroup s (row-order slices; a slice keeps only its valid
    values and needs two of them to contribute degrees of freedom)."""
    n = int(round(subgroup))
    if n < 2:
        return moving_range_sigma([v for v in values if v is not None and np.isfinite(v)])
    ss = 0.0
    df = 0
    for start in range(0, len(values), n):
        chunk = [v for v in values[start:start + n] if v is not None and np.isfinite(v)]
        if len(chunk) < 2:
            continue
        m = float(np.mean(chunk))
        ss += float(np.sum((np.asarray(chunk) - m) ** 2))
        df += len(chunk) - 1
    if df <= 0:
        return moving_range_sigma([v for v in values if v is not None and np.isfinite(v)])
    return math.sqrt(ss / df)


def capability_indices(values, lsl, usl, target, sd_within, sd_overall) -> dict:
    v = np.asarray(values, dtype=float)
    m = float(np.mean(v))
    tol = (usl - lsl) if (lsl is not None and usl is not None) else float("nan")

    def ratio(num, den):
        if num is None or den is None:
            return float("nan")
        if not np.isfinite(num) or not np.isfinite(den) or den == 0:
            return float("nan")
        return num / den

    cp = ratio(tol, 6 * sd_within) if lsl is not None and usl is not None else float("nan")
    pp = ratio(tol, 6 * sd_overall) if lsl is not None and usl is not None else float("nan")
    cpl = ratio(m - lsl, 3 * sd_within) if lsl is not None else float("nan")
    cpu = ratio(usl - m, 3 * sd_within) if usl is not None else float("nan")
    ppl = ratio(m - lsl, 3 * sd_overall) if lsl is not None else float("nan")
    ppu = ratio(usl - m, 3 * sd_overall) if usl is not None else float("nan")
    if lsl is not None and usl is not None:
        cpk = min(cpl, cpu)
        ppk = min(ppl, ppu)
    elif lsl is not None:
        cpk, ppk = cpl, ppl
    elif usl is not None:
        cpk, ppk = cpu, ppu
    else:
        cpk = ppk = float("nan")
    cpm = ratio(tol, 6 * math.sqrt(sd_overall ** 2 + (m - target) ** 2)) if (lsl is not None and usl is not None and target is not None) else float("nan")

    def tail_parts(sd):
        below = stats.norm.cdf((lsl - m) / sd) if (lsl is not None and sd > 0) else 0.0
        above = stats.norm.sf((usl - m) / sd) if (usl is not None and sd > 0) else 0.0
        return below, above

    bw, aw = tail_parts(sd_within)
    bo, ao = tail_parts(sd_overall)
    observed_below = int(np.sum(v < lsl)) if lsl is not None else 0
    observed_above = int(np.sum(v > usl)) if usl is not None else 0
    return {
        "mean": m,
        "cp": cp, "cpk": cpk, "cpl": cpl, "cpu": cpu,
        "pp": pp, "ppk": ppk, "ppl": ppl, "ppu": ppu, "cpm": cpm,
        "ppm_within": (bw + aw) * 1e6,
        "ppm_overall": (bo + ao) * 1e6,
        "ppm_observed": (observed_below + observed_above) / v.size * 1e6,
    }


def sigma_level(method: str, ppm_overall: float, cpk: float) -> float:
    if method == "cpk_shift":
        return 3 * cpk + 1.5 if np.isfinite(cpk) else float("nan")
    if not np.isfinite(ppm_overall):
        return float("nan")
    p = min(1 - 1e-12, max(1e-12, ppm_overall / 1e6))
    z = stats.norm.isf(p)  # Φ⁻¹(1 − p)
    if not math.isfinite(z):
        return float("nan")
    return z if method == "z_bench" else z + 1.5


# ── Gage R&R variance components (NIST/SEMATECH e-Handbook 2.5.5.5) ──────
#
# Crossed balanced, p parts × o operators × n replicates:
#   EMS(part)        = σ² + n σ²_po + o n σ²_part
#   EMS(operator)    = σ² + n σ²_po + p n σ²_op
#   EMS(interaction) = σ² + n σ²_po
#   EMS(error)       = σ²
#   σ²_repeat = MS_error
#   σ²_po     = (MS_int − MS_error)/n
#   σ²_op     = (MS_op − MS_int)/(p n)
#   σ²_part   = (MS_part − MS_int)/(o n)
# Nested (part within operator): σ²_part = (MS_part(op) − MS_error)/n,
# σ²_op = (MS_op − MS_part(op))/(parts_per_op · n).
def crossed_components(anova: dict, parts: int, operators: int, replicates: int) -> dict:
    n = replicates
    ms = {k: v["ms"] for k, v in anova.items()}
    raw_repeat = ms["repeat"]
    raw_inter = (ms["interaction"] - ms["repeat"]) / n
    raw_oper = (ms["operator"] - ms["interaction"]) / (parts * n)
    raw_part = (ms["part"] - ms["interaction"]) / (operators * n)
    repeat = max(0.0, raw_repeat)
    inter = max(0.0, raw_inter)
    oper = max(0.0, raw_oper)
    part = max(0.0, raw_part)
    grr = repeat + inter + oper
    return {
        "repeat": repeat, "interaction": inter, "operator": oper, "part": part,
        "grr": grr, "total": grr + part,
        "_raw": {"repeat": raw_repeat, "reproducibility": raw_inter + raw_oper, "interaction": raw_inter, "operator": raw_oper, "part": raw_part},
    }


def nested_components(anova: dict, operators: int, parts_per_operator: int, replicates: int) -> dict:
    n = replicates
    ms = {k: v["ms"] for k, v in anova.items()}
    raw_repeat = ms["repeat"]
    raw_part = (ms["partOperator"] - ms["repeat"]) / n
    raw_oper = (ms["operator"] - ms["partOperator"]) / (parts_per_operator * n)
    repeat = max(0.0, raw_repeat)
    part = max(0.0, raw_part)
    oper = max(0.0, raw_oper)
    grr = repeat + oper
    return {
        "repeat": repeat, "operator": oper, "part": part, "grr": grr, "total": grr + part,
        "_raw": {"repeat": raw_repeat, "reproducibility": raw_oper, "operator": raw_oper, "part": raw_part},
    }


# ── 2-parameter Weibull profile likelihood ───────────────────────────────
#
# Profile likelihood for right-censored data (Lawless 1982, ch. 4):
#   lnL(β) = r ln β − r β ln η(β) + (β−1) Σ_fail ln t − r,
#   η(β)   = ( Σ_all t^β / r )^{1/β},  r = number of failures.
# Used INSIDE the parametric bootstrap, where thousands of replicate fits have to
# be cheap; the reported estimate itself comes from scipy.stats.weibull_min.fit.
def weibull_profile_fit(times, censored, lo=0.02, hi=200.0):
    t = np.asarray(times, dtype=float)
    c = np.asarray(censored, dtype=int)
    r = int(np.sum(c == 0))
    if r < 2:
        return None
    log_fail_sum = float(np.sum(np.log(t[c == 0])))

    def profile_lnl(beta):
        with np.errstate(over="ignore", invalid="ignore"):
            sum_pow = float(np.sum(t ** beta))
        if not (sum_pow > 0) or not math.isfinite(sum_pow):
            return -math.inf
        ln_eta = math.log(sum_pow / r) / beta
        return r * math.log(beta) - r * beta * ln_eta + (beta - 1) * log_fail_sum - r

    phi = (math.sqrt(5) - 1) / 2
    a, b = math.log(lo), math.log(hi)
    c1, c2 = b - phi * (b - a), a + phi * (b - a)
    f1, f2 = profile_lnl(math.exp(c1)), profile_lnl(math.exp(c2))
    for _ in range(120):
        if f1 > f2:
            b, c2, f2 = c2, c1, f1
            c1 = b - phi * (b - a)
            f1 = profile_lnl(math.exp(c1))
        else:
            a, c1, f1 = c1, c2, f2
            c2 = a + phi * (b - a)
            f2 = profile_lnl(math.exp(c2))
    beta = math.exp((a + b) / 2)
    with np.errstate(over="ignore", invalid="ignore"):
        sum_pow = float(np.sum(t ** beta))
    return beta, (sum_pow / r) ** (1.0 / beta)


# ── proportion power (normal approximation) ───────────────────────────────
#
# Chow, Shao & Wang, "Sample Size Calculations in Clinical Research", ch. 3:
# under H0 p̂ ~ N(p0, p0(1−p0)/n), under H1 p̂ ~ N(pa, pa(1−pa)/n), so with
# d = pa − p0 the one-sided rejection probability is
#   1 − Φ((z_α SE0 − d)/SE1)   (greater)   /   Φ((−z_α SE0 − d)/SE1)  (less)
# and the two-sided test sums both tails.  This is an explicit approximation and
# is reported as such: Minitab's exact (binomial) method answers a slightly
# different question, so agreement here is agreement on the documented normal
# approximation only.
def power_prop1(n: int, p0: float, pa: float, alpha: float, alternative: str) -> float:
    se0 = math.sqrt(p0 * (1 - p0) / n)
    se1 = math.sqrt(pa * (1 - pa) / n)
    if se1 <= 0:
        return float("nan")
    d = pa - p0
    if alternative == "greater":
        return 1 - stats.norm.cdf((stats.norm.isf(alpha) * se0 - d) / se1)
    if alternative == "less":
        return stats.norm.cdf((-stats.norm.isf(alpha) * se0 - d) / se1)
    z = stats.norm.isf(alpha / 2)
    return 1 - stats.norm.cdf((z * se0 - d) / se1) + stats.norm.cdf((-z * se0 - d) / se1)


def power_prop2(n: int, p1: float, p2: float, alpha: float, alternative: str) -> float:
    d = p2 - p1
    pbar = (p1 + p2) / 2
    se0 = math.sqrt(2 * pbar * (1 - pbar) / n)
    se1 = math.sqrt((p1 * (1 - p1) + p2 * (1 - p2)) / n)
    if se1 <= 0:
        return float("nan")
    if alternative == "greater":
        return 1 - stats.norm.cdf((stats.norm.isf(alpha) * se0 - d) / se1)
    if alternative == "less":
        return stats.norm.cdf((-stats.norm.isf(alpha) * se0 - d) / se1)
    z = stats.norm.isf(alpha / 2)
    return 1 - stats.norm.cdf((z * se0 - d) / se1) + stats.norm.cdf((-z * se0 - d) / se1)


# ── misc ─────────────────────────────────────────────────────────────────
def mulberry32(seed: int):
    """The 32-bit PRNG the design generator documents (run-order shuffling).

    Written with explicit 32-bit masking so it reproduces the engine's
    Math.imul-based generator bit for bit — the shuffling ALGORITHM is part of
    the design output under test, so the reference has to run the same
    documented generator to compare run order.  The design points themselves and
    the standard order are combinatorial (independent of the PRNG).
    """
    M = 0xFFFFFFFF
    a = seed & M

    def rnd() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & M
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & M
        u = (t ^ (t >> 7)) & M
        t = (t ^ ((t + ((u * (t | 61)) & M)) & M)) & M
        return ((t ^ (t >> 14)) & M) / 4294967296

    return rnd


def shuffle_list(items: list, seed: int) -> list:
    rng = mulberry32(seed)
    out = list(items)
    for i in range(len(out) - 1, 0, -1):
        j = int(rng() * (i + 1))
        out[i], out[j] = out[j], out[i]
    return out
