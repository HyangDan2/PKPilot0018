#!/usr/bin/env python3
"""QA-F 수치 실험 — 중도절단 Weibull 적합도 부트스트랩의 두 가지 처리.

The brief asks for a numerical experiment on what the bootstrap's repair of
few-failure replicates does to the estimate.  This script measures three things
on the golden datasets and on simulated truth:

  A. 고장 2개 미만 보정 규칙 (engine's flip rule vs drop rule vs none)
       - how often a replicate needs the repair at 2, 3, 6, 25 failures
       - the p-value each rule produces
       - the bias in the null A* distribution (mean / sd)
  B. 중도절단 메커니즘 (Bernoulli share + min() vs empirical censoring times)
       - the realised censoring share inside the bootstrap
       - the Type I error rate of the resulting test at α = 0.05 when the model
         IS correct (200 simulated samples per configuration)

Only Python/NumPy/SciPy are used, with the profile-likelihood Weibull fit from
qa/reference/formulas.py so thousands of replicate fits stay cheap.  Every
run is seeded; the numbers printed here are the ones quoted in the report.
"""

from __future__ import annotations

import json
import math
import os
import sys

import numpy as np
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "reference"))
import formulas as F  # noqa: E402

DATASETS = os.path.join(HERE, "..", "datasets")


def load(name):
    with open(os.path.join(DATASETS, f"{name}.json"), encoding="utf-8") as fh:
        d = json.load(fh)
    t = np.array([v for v in d["columns"]["time"]], dtype=float)
    c = np.array([int(v) for v in d["columns"]["censor1"]], dtype=int)
    return t, c


def ad_star_of(times, cens, shape, scale):
    """Failures-only A* exactly as the engine defines it."""
    ft = np.sort(times[cens == 0])
    if ft.size < 2:
        return float("nan")
    ad = F.ad_statistic(stats.weibull_min.cdf(ft, shape, loc=0, scale=scale))
    return ad * (1 + 0.2 / math.sqrt(ft.size))


def fit(times, cens):
    r = F.weibull_profile_fit(times, cens)
    return r if r else (float("nan"), float("nan"))


def replicate(rng, n, shape, scale, cens_times, mode, share):
    u = np.clip(rng.random(n), 1e-12, 1 - 1e-12)
    life = scale * (-np.log(u)) ** (1 / shape)
    if mode == "bernoulli":
        # The engine draws a censoring indicator with probability = observed share,
        # then keeps min(life, c). Taking the min turns many of those draws back
        # into failures, so the realised censoring share is far below the target.
        drawn = rng.random(n) < share
        c = cens_times[rng.integers(0, cens_times.size, n)]
        t = np.where(drawn, np.minimum(life, c), life)
        cens = (drawn & (c < life)).astype(int)
        return t, cens
    # "censor_time": draw a censoring time from the empirical censoring-time
    # distribution and censor exactly when it falls before the lifetime — the
    # mechanism that actually produced the sample, with no separate share.
    c = cens_times[rng.integers(0, cens_times.size, n)]
    cens = (c < life).astype(int)
    return np.minimum(life, c), cens


def bootstrap_p(times, cens, shape, scale, observed_ad, mode, repair, reps=600, seed=20261122):
    rng = np.random.default_rng(seed)
    n = times.size
    cens_times = times[cens == 1]
    if cens_times.size == 0:
        return float("nan"), {}
    share = cens_times.size / n
    hits = 0
    used = 0
    repaired = 0
    dropped = 0
    fail_counts = []
    rep_ads = []
    for _ in range(reps):
        t, cc = replicate(rng, n, shape, scale, cens_times, mode, share)
        failures = int(np.sum(cc == 0))
        if failures < 2:
            if repair == "flip":
                repaired += 1
                idx = np.argsort(t, kind="stable")[:2]
                cc = cc.copy()
                cc[idx] = 0
                failures = int(np.sum(cc == 0))
            elif repair == "drop":
                dropped += 1
                continue
        beta, eta = fit(t, cc)
        if not np.isfinite(beta):
            dropped += 1
            continue
        rep_ad = ad_star_of(t, cc, beta, eta)
        if not np.isfinite(rep_ad):
            dropped += 1
            continue
        used += 1
        fail_counts.append(int(np.sum(cc == 0)))
        rep_ads.append(rep_ad)
        if not (rep_ad < observed_ad):
            hits += 1
    stats_out = {
        "used": used,
        "repaired": repaired,
        "dropped": dropped,
        "repair_rate": repaired / reps,
        "fail_mean": float(np.mean(fail_counts)) if fail_counts else float("nan"),
        "ad_mean": float(np.mean(rep_ads)) if rep_ads else float("nan"),
        "ad_sd": float(np.std(rep_ads)) if rep_ads else float("nan"),
        "ad_q95": float(np.quantile(rep_ads, 0.95)) if rep_ads else float("nan"),
    }
    return (hits + 1) / (used + 1), stats_out


def part_a():
    print("\n== A. 고장 2개 미만 보정 규칙 / few-failure repair rules ==")
    rows = []
    for name in ("censored_two", "censored_few", "censored_heavy", "censored_mixed"):
        t, c = load(name)
        shape, scale = fit(t, c)
        obs = ad_star_of(t, c, shape, scale)
        row = {"dataset": name, "n": int(t.size), "failures": int(np.sum(c == 0)), "observed_ad": obs}
        for mode in ("bernoulli", "censor_time"):
            for repair in ("flip", "drop"):
                p, st = bootstrap_p(t, c, shape, scale, obs, mode, repair, reps=600)
                row[f"p_{mode}_{repair}"] = p
                if mode == "bernoulli" and repair == "flip":
                    row["engine_rule_rate"] = st["repair_rate"]
                    row["engine_rule_fail_mean"] = st["fail_mean"]
                    row["engine_rule_adsd"] = st["ad_sd"]
                if mode == "censor_time" and repair == "drop":
                    row["censor_time_fail_mean"] = st["fail_mean"]
                    row["censor_time_adsd"] = st["ad_sd"]
        rows.append(row)
        print(f"  {name:15s} n={row['n']:2d} failures={row['failures']:2d} A*={obs:7.3f} "
              f"| repair rate {row['engine_rule_rate']*100:5.1f}% "
              f"| engine p {row['p_bernoulli_flip']:.4f}  censor-time p {row['p_censor_time_drop']:.4f} "
              f"| replicate failures {row['engine_rule_fail_mean']:.1f} vs {row['censor_time_fail_mean']:.1f}")
    return rows


def part_b(configs, sims=150, reps=300):
    print("\n== B. Type I error (모형이 참일 때 p < 0.05 비율, α=0.05) ==")
    out = []
    for name, shape, scale, c_lo, c_hi in configs:
        rng = np.random.default_rng(777)
        rates = {"bernoulli_flip": 0, "bernoulli_drop": 0, "censor_time_flip": 0, "censor_time_drop": 0}
        for _ in range(sims):
            n = 40
            u = np.clip(rng.random(n), 1e-12, 1 - 1e-12)
            life = scale * (-np.log(u)) ** (1 / shape)
            ct = rng.uniform(c_lo, c_hi, n)
            cens = (ct < life).astype(int)
            t = np.minimum(life, ct)
            if int(np.sum(cens == 0)) < 2:
                continue
            beta, eta = fit(t, cens)
            obs = ad_star_of(t, cens, beta, eta)
            for mode in ("bernoulli", "censor_time"):
                for repair in ("flip", "drop"):
                    p, _ = bootstrap_p(t, cens, beta, eta, obs, mode, repair, reps=reps, seed=int(rng.integers(1e6)))
                    if p < 0.05:
                        rates[f"{mode}_{repair}"] += 1
        row = {"config": name, "shape": shape, "scale": scale, "censor": [c_lo, c_hi], "sims": sims,
               **{k: v / sims for k, v in rates.items()}}
        out.append(row)
        print(f"  {name:22s} " + "  ".join(f"{k}={v/sims*100:5.1f}%" for k, v in rates.items()))
    return out


def main():
    rows_a = part_a()
    rows_b = part_b([
        ("Weibull(1.7,200) 25% cens", 1.7, 200.0, 60.0, 260.0),
        ("Weibull(1.8,260) 90% cens", 1.8, 260.0, 40.0, 90.0),
    ])
    out = {"part_a": rows_a, "part_b": rows_b}
    with open(os.path.join(HERE, "qa_f_bootstrap.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
    print("\nwrote qa/experiments/qa_f_bootstrap.json")


if __name__ == "__main__":
    main()
