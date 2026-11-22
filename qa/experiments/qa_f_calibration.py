#!/usr/bin/env python3
"""QA-F calibration — empirical Type I error and power of the censored-data
Weibull AD bootstrap test, at α = 1 % / 5 % / 10 %.

What is measured
----------------
Under H₀ (the data really are Weibull) and under H₁ (the data are lognormal
with the same median), simulated samples go through exactly the test the
shipped engine performs:

  complete data          A* against the tabulated critical values
                         (D'Agostino & Stephens via WEIBULL_AD_CRITICAL =
                         [1.038, 0.757, 0.637] for 10 / 5 / 1 %) — the engine
                         runs no bootstrap when nothing is censored;
  right-censored data    parametric bootstrap of the failures-only A* with the
                         empirical censoring-TIME mechanism and the two-
                         earliest-read-as-failures repair (the engine's rule),
                         p = (hits + 1) / (B + 1), reject when p < α.

Three scenarios × two truths × 1 000 simulated samples each, B = 400 bootstrap
replicates per sample, every draw from a fixed seed.  The bootstrap is
vectorised over replicates (the profile-likelihood fit runs golden-section on
whole batches at once), which keeps the whole matrix inside a couple of
minutes.

Outputs: qa/reports/calibration_weibull.json (+ a markdown summary printed on
stdout).  Every rate carries a Wilson 95 % interval so a rate compatible with
the nominal α is distinguishable from a miscalibrated one.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time

import numpy as np
import scipy
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "reference"))
import formulas as F  # noqa: E402

REPORTS = os.path.join(HERE, "..", "reports")

# Engine constants (src/lib/reliability.ts).
AD_CRITICAL = {"0.10": 0.637, "0.05": 0.757, "0.01": 1.038}
ALPHAS = (0.01, 0.05, 0.10)
B_REPS = 400
N_SIM = 1000

# Scenario truths.  The lognormal alternative shares the Weibull median
# (η·(ln 2)^(1/β)) with σ chosen to give a comparable tail; that makes the
# alternative hard but honest — the test must reject a *distributional* change,
# not a shifted median.
SCENARIOS = [
    {
        "id": "complete",
        "title": "Complete data, n = 40",
        "n": 40,
        "shape": 1.7, "scale": 200.0,
        "ln_sigma": 0.9,
        "censor": None,
        "alternatives": ["lognormal", "mixture"],
    },
    {
        "id": "moderate",
        "title": "Random right censoring U(120, 400), n = 40 (~25–40 % censored)",
        "n": 40,
        "shape": 1.7, "scale": 200.0,
        "ln_sigma": 0.9,
        "censor": (120.0, 400.0),
        "alternatives": ["lognormal", "mixture"],
    },
    {
        "id": "few_failures",
        "title": "Type-I censoring at the 4th smallest lifetime, n = 30 (4 failures)",
        "n": 30,
        "shape": 2.2, "scale": 140.0,
        "ln_sigma": 0.7,
        "censor": "order4",
        "alternatives": ["lognormal"],
    },
]


def wilson(hit: int, n: int, conf: float = 0.95) -> tuple[float, float]:
    z = stats.norm.ppf(1 - (1 - conf) / 2)
    p = hit / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return centre - half, centre + half


# ── vectorised engine-rule bootstrap ─────────────────────────────────────

def batch_profile_fit(T: np.ndarray, failed: np.ndarray, iters: int = 70):
    """Golden-section profile fit for a whole batch of replicates at once.

    Same profile likelihood as formulas.weibull_profile_fit / the engine's
    profileLogLikFast: at a fixed shape the scale is the failures-only mean of
    t^β, so one pass over the times evaluates the profile for every replicate.
    """
    ln_t = np.log(T)
    log_fail_sum = np.where(failed, ln_t, 0.0).sum(axis=1)
    r = failed.sum(axis=1).astype(float)
    r_safe = np.maximum(r, 1)

    def lnl(beta: np.ndarray) -> np.ndarray:
        with np.errstate(over="ignore", invalid="ignore"):
            sum_pow = np.power(T, beta[:, None]).sum(axis=1)
        ok = np.isfinite(sum_pow) & (sum_pow > 0)
        ln_eta = np.log(np.where(ok, sum_pow, 1.0) / r_safe) / beta
        val = r * np.log(beta) - r * beta * ln_eta + (beta - 1) * log_fail_sum - r
        return np.where(ok & (r >= 2), val, -np.inf)

    phi = (math.sqrt(5) - 1) / 2
    a = np.full(T.shape[0], math.log(0.02))
    b = np.full(T.shape[0], math.log(200.0))
    c = b - phi * (b - a)
    d = a + phi * (b - a)
    fc = lnl(np.exp(c))
    fd = lnl(np.exp(d))
    for _ in range(iters):
        keep_c = fc > fd
        a2 = np.where(keep_c, a, c)
        b2 = np.where(keep_c, d, b)
        c2 = np.where(keep_c, b2 - phi * (b2 - a2), d)
        d2 = np.where(keep_c, c, a2 + phi * (b2 - a2))
        fc2 = np.where(keep_c, lnl(np.exp(c2)), fd)
        fd2 = np.where(keep_c, fc, lnl(np.exp(d2)))
        a, b, c, d, fc, fd = a2, b2, c2, d2, fc2, fd2
    beta = np.exp((a + b) / 2)
    with np.errstate(over="ignore", invalid="ignore"):
        sum_pow = np.power(T, beta[:, None]).sum(axis=1)
    eta = np.where(sum_pow > 0, (sum_pow / r_safe) ** (1.0 / beta), np.nan)
    return beta, eta


def batch_ad_star(T: np.ndarray, failed: np.ndarray, beta: np.ndarray, eta: np.ndarray) -> np.ndarray:
    """Failures-only A* = A²(1 + 0.2/√k) for every replicate, vectorised."""
    n = T.shape[1]
    ft = np.sort(np.where(failed, T, np.inf), axis=1)
    k = failed.sum(axis=1)
    cols = np.arange(n)[None, :]
    valid = cols < k[:, None]
    with np.errstate(all="ignore"):
        cdf = 1 - np.exp(-np.power(ft, beta[:, None])[:, :n] / np.power(eta, beta)[:, None])
    cdf = np.clip(cdf, 1e-12, 1 - 1e-12)
    ln_f = np.where(valid, np.log(cdf), 0.0)
    ln_1mf = np.where(valid, np.log1p(-cdf), 0.0)
    # Reversed partner inside the valid prefix: index k−1−i.
    rev = np.clip(k[:, None] - 1 - cols, 0, n - 1)
    ln_1mf_rev = np.take_along_axis(ln_1mf, rev, axis=1)
    i = np.arange(1, n + 1)[None, :]
    terms = np.where(valid, (2 * i - 1) * (ln_f + ln_1mf_rev), 0.0)
    a2 = -k - terms.sum(axis=1) / np.maximum(k, 1)
    a_star = a2 * (1 + 0.2 / np.sqrt(np.maximum(k, 1)))
    return np.where(k >= 2, a_star, np.nan)


def engine_bootstrap_p(times: np.ndarray, cens: np.ndarray, shape: float, scale: float,
                       observed_ad: float, reps: int = B_REPS, seed: int = 20261122) -> float:
    """The engine's rule: empirical censoring times + two-earliest repair.

    Vectorised over replicates; p = (hits + 1) / (reps + 1) with no dropping.
    """
    rng = np.random.default_rng(seed)
    n = times.size
    cens_times = times[cens == 1]
    if cens_times.size == 0 or not (observed_ad >= 0):
        return float("nan")
    u = np.clip(rng.random((reps, n)), 1e-12, 1 - 1e-12)
    life = scale * (-np.log(u)) ** (1 / shape)
    ct = cens_times[rng.integers(0, cens_times.size, (reps, n))]
    T = np.minimum(life, ct)
    failed = ~(ct < life)
    # Repair: replicates with fewer than two failures read their two earliest
    # observations as failures (the engine's flip rule).
    order = np.argsort(T, axis=1, kind="stable")
    need = failed.sum(axis=1) < 2
    if need.any():
        first2 = order[need][:, :2]
        rows = np.where(need)[0][:, None]
        broken = failed[rows, first2]
        failed[rows, first2] = True
        del broken
    beta, eta = batch_profile_fit(T, failed)
    rep_ad = batch_ad_star(T, failed, beta, eta)
    hits = int(np.sum(~(rep_ad < observed_ad)))
    return (hits + 1) / (reps + 1)


def observed_fit(times: np.ndarray, cens: np.ndarray):
    fit = F.weibull_profile_fit(times, cens)
    if fit is None:
        return float("nan"), float("nan"), float("nan")
    shape, scale = fit
    ftimes = np.sort(times[cens == 0])
    ad = F.ad_statistic(stats.weibull_min.cdf(ftimes, shape, loc=0, scale=scale))
    return shape, scale, ad * (1 + 0.2 / math.sqrt(max(1, ftimes.size)))


def draw_sample(rng: np.random.Generator, sc: dict, truth: str) -> tuple[np.ndarray, np.ndarray]:
    n = sc["n"]
    if truth == "weibull":
        life = sc["scale"] * (-np.log(1 - rng.random(n))) ** (1 / sc["shape"])
    elif truth == "mixture":
        # The bimodal alternative of the censored_mixture golden dataset: half
        # the units fail near 20, half near 180.
        low = 20.0 + np.abs(rng.normal(0.0, 4.0, n))
        high = 180.0 + np.abs(rng.normal(0.0, 10.0, n))
        life = np.where(rng.random(n) < 0.5, low, high)
    else:  # lognormal with the same median
        median = sc["scale"] * (math.log(2)) ** (1 / sc["shape"])
        life = np.exp(rng.normal(math.log(median), sc["ln_sigma"], n))
    censor = sc["censor"]
    if censor is None:
        return life, np.zeros(n, dtype=int)
    if censor == "order4":
        cut = np.sort(life)[3]  # exactly four failures
        return np.minimum(life, cut), (life > cut).astype(int)
    ct = rng.uniform(*censor, n)
    return np.minimum(life, ct), (life > ct).astype(int)


def run_scenario(sc: dict) -> dict:
    rng = np.random.default_rng(424242)
    truths = ["weibull"] + list(sc.get("alternatives", ["lognormal"]))
    out: dict = {"id": sc["id"], "title": sc["title"], "n": sc["n"], "sims": N_SIM, "bootstrap_reps": B_REPS}
    for truth in truths:
        counts = {f"alpha_{a}": 0 for a in ALPHAS}
        used = 0
        censor_shares = []
        boot_seconds = 0.0
        for s in range(N_SIM):
            times, cens = draw_sample(rng, sc, truth)
            failures = int((cens == 0).sum())
            if failures < 2:
                continue  # the engine refuses these; not part of the test mass
            used += 1
            censor_shares.append(float((cens == 1).mean()))
            shape, scale, ad_star = observed_fit(times, cens)
            if not math.isfinite(ad_star):
                continue
            if sc["censor"] is None:
                # Tabulated critical values, the engine's complete-data rule.
                for a in ALPHAS:
                    if ad_star > AD_CRITICAL[f"{a:.2f}"]:
                        counts[f"alpha_{a}"] += 1
            else:
                t0 = time.perf_counter()
                p = engine_bootstrap_p(times, cens, shape, scale, ad_star,
                                       seed=1000 + s)
                boot_seconds += time.perf_counter() - t0
                for a in ALPHAS:
                    if p < a:
                        counts[f"alpha_{a}"] += 1
        rates = {}
        for a in ALPHAS:
            hit = counts[f"alpha_{a}"]
            lo, hi = wilson(hit, used)
            rates[f"alpha_{a}"] = {
                "rejects": hit, "n": used, "rate": hit / used if used else float("nan"),
                "wilson95": [lo, hi],
            }
        out[truth] = {
            "rates": rates,
            "mean_censored_share": float(np.mean(censor_shares)) if censor_shares else 0.0,
            "bootstrap_seconds": round(boot_seconds, 1),
        }
    return out


def main() -> None:
    results = [run_scenario(sc) for sc in SCENARIOS]
    payload = {
        "meta": {
            "experiment": "qa_f_calibration",
            "description": "Empirical Type I error and power of the censored-data Weibull AD test at α = 1/5/10 %",
            "sims_per_cell": N_SIM,
            "bootstrap_reps": B_REPS,
            "seed_stream": "numpy.default_rng(424242), per-sample bootstrap seed 1000+s",
            "type_i_truth": "weibull (the fitted model family)",
            "power_truth": "lognormal with the same median (ln_sigma per scenario)",
            "engine_rule": "empirical censoring-time mechanism + two-earliest-read-as-failures repair; p=(hits+1)/(B+1); complete data use the tabulated critical values",
            "generated_with": f"numpy {np.__version__}, scipy {scipy.__version__}",
        },
        "scenarios": results,
    }
    os.makedirs(REPORTS, exist_ok=True)
    path = os.path.join(REPORTS, "calibration_weibull.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"{'scenario':32s} {'truth':9s} {'cens%':>6s} " + " ".join(f"{'α=' + format(a, '.0%'):>16s}" for a in ALPHAS))
    for sc, res in zip(SCENARIOS, results):
        for truth in ["weibull"] + list(sc.get("alternatives", ["lognormal"])):
            block = res[truth]
            cells = []
            for a in ALPHAS:
                r = block["rates"][f"alpha_{a}"]
                cells.append(f"{r['rate']*100:6.1f}% [{r['wilson95'][0]*100:4.1f},{r['wilson95'][1]*100:4.1f}]")
            label = "Type I" if truth == "weibull" else "Power  "
            print(f"{sc['id']:32s} {label:9s} {block['mean_censored_share']*100:5.1f} " + " ".join(cells))
    print("\nwrote qa/reports/calibration_weibull.json")


if __name__ == "__main__":
    main()
