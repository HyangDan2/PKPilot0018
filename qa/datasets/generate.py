#!/usr/bin/env python3
"""Sigrún QA — deterministic golden datasets.

Every dataset is generated here with a fixed NumPy seed and written to
``qa/datasets/<name>.json`` together with its provenance (seed, generator,
library versions).  The JSON files are committed, so both the Python reference
engine and the TypeScript adapter read exactly the same numbers and the run is
reproducible on any machine.

The ten data types the QA plan asks for are all represented:

 1. balanced                     balanced_normal, attribute
 2. small sample                 small_sample
 3. large data                   large_stability     (8 000 rows)
 4. missing values               missing_values
 5. identical / zero variance    constant_zero
 6. outliers                     outliers
 7. unbalanced                   unbalanced, gage_unbalanced
 8. boundary conditions          boundary, constant_zero (zero/negative), specs
 9. censored                     censored_mixed / censored_heavy / censored_few / censored_two
10. varying subgroup size        subgroups

Run:  python3 qa/datasets/generate.py
"""

from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))


def r(x: float, nd: int = 12) -> float:
    """Round for a compact, stable JSON file (12 significant decimals)."""
    if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
        return None
    return float(f"{x:.{nd}g}")


def round_list(values, nd: int = 12):
    out = []
    for v in values:
        if v is None:
            out.append(None)
        elif isinstance(v, str):
            out.append(v)
        elif isinstance(v, (bool, np.bool_)):
            out.append(bool(v))
        else:
            out.append(r(float(v), nd))
    return out


def write(name: str, description: str, seed, method: str, columns: dict, extra: dict | None = None) -> None:
    payload = {
        "name": name,
        "description": description,
        "seed": seed,
        "generator": method,
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        # No platform string: it differs between the developer machine and CI
        # while the numbers do not, and the run must be able to prove byte
        # equality of the golden files on both.

        "columns": {k: round_list(v) for k, v in columns.items()},
    }
    if extra:
        payload.update(extra)
    with open(os.path.join(HERE, f"{name}.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    print(f"wrote {name}.json  ({len(next(iter(columns.values())))} rows)")


def main() -> None:
    # 1 ── balanced normal: three groups of 20, one response per row ----------
    rng = np.random.default_rng(11001)
    x = rng.normal(100.0, 5.0, 60)
    y = 2.0 + 0.8 * x + rng.normal(0.0, 3.0, 60)
    groups = ["A"] * 20 + ["B"] * 20 + ["C"] * 20
    write(
        "balanced_normal",
        "Balanced sample: x ~ N(100,5) n=60; y = 2 + 0.8x + N(0,3); group A/B/C x20",
        11001,
        "numpy.random.default_rng(11001).normal",
        {"x": x, "y": y, "group": groups},
    )

    # 2 ── small samples ------------------------------------------------------
    rng = np.random.default_rng(11002)
    a = rng.normal(10.0, 1.0, 6)
    b = rng.normal(10.6, 1.4, 6)
    c = rng.normal(9.8, 0.9, 6)
    y7 = rng.normal(50.0, 4.0, 7)
    x7 = rng.normal(5.0, 1.0, 7)
    times = rng.weibull(1.6, 10) * 120.0
    cens = [0] * 7 + [1] * 3
    write(
        "small_sample",
        "Small samples: a,b,c ~ N(10,1)/N(10.6,1.4)/N(9.8,0.9) n=6; x7,y7 n=7; 10 Weibull times (3 right-censored)",
        11002,
        "numpy.random.default_rng(11002).normal / .weibull(1.6)*120",
        {"a": a, "b": b, "c": c, "x7": x7, "y7": y7, "time": times, "censor1": cens},
    )

    # 3 ── large data: numeric stability -------------------------------------
    rng = np.random.default_rng(11003)
    n = 8000
    xl = rng.normal(500.0, 40.0, n) + rng.exponential(1.5, n)
    gl = np.repeat(["G1", "G2", "G3", "G4"], n // 4).tolist()
    write(
        "large_stability",
        "8 000 rows: x ~ N(500,40) + Exp(1.5) offset, four groups of 2 000",
        11003,
        "numpy.random.default_rng(11003).normal + .exponential",
        {"x": xl, "group": gl},
    )

    # 4 ── missing values ----------------------------------------------------
    rng = np.random.default_rng(11004)
    xm = rng.normal(20.0, 2.0, 40).tolist()
    ym = rng.normal(5.0, 1.0, 40).tolist()
    gm = (["L1", "L2", "L3", "L4"] * 10)
    for i in (3, 7, 11, 22, 30, 33, 37):
        xm[i] = None
    for i in (5, 7, 18, 26, 33, 39):
        ym[i] = None
    for i in (1, 17):
        gm[i] = None
    write(
        "missing_values",
        "40 rows with 7 missing x, 6 missing y and 2 missing group labels",
        11004,
        "numpy.random.default_rng(11004).normal, holes injected at fixed row indices",
        {"x": xm, "y": ym, "group": gm},
    )

    # 5 ── identical / zero variance / non-positive for nonnormal fits -------
    flat = [5.0] * 12
    zeros = [0.0] * 12
    negmix = [0.0, -1.5, 2.0, 3.5, -0.5, 4.0, 2.5, 1.0, 6.0, 3.0, 2.2, 4.8, 1.4, 5.5, 0.0]
    write(
        "constant_zero",
        "Constant column (5.0 x12), all-zero column (x12) and a nonnormal sample holding 0 and negatives",
        11005,
        "literal values (no RNG) — exercises variance 0 and the (0, inf) support guards",
        {"flat": flat, "zeros": zeros, "negmix": negmix},
    )

    # 6 ── outliers ----------------------------------------------------------
    rng = np.random.default_rng(11006)
    xo = rng.normal(30.0, 2.0, 30)
    xo[4] = 120.0
    xo[17] = -60.0
    write(
        "outliers",
        "30 rows N(30,2) with two extreme values (+120 at row 5, -60 at row 18)",
        11006,
        "numpy.random.default_rng(11006).normal with rows 4 and 17 overwritten",
        {"x": xo},
    )

    # 7 ── unbalanced designs ------------------------------------------------
    rng = np.random.default_rng(11007)
    fa = ["a1"] * 12 + ["a2"] * 9 + ["a3"] * 6
    fb = (["b1", "b2", "b3"] * 9)
    resp = []
    for i, (la, lb) in enumerate(zip(fa, fb)):
        base = {"a1": 10.0, "a2": 12.0, "a3": 9.0}[la]
        shift = {"b1": 0.0, "b2": 1.5, "b3": -1.0}[lb]
        resp.append(base + shift + rng.normal(0.0, 1.0))
    write(
        "unbalanced",
        "Unbalanced two-way layout: A 12/9/6 rows, B 9/9/9 rows, response = A + B + N(0,1)",
        11007,
        "numpy.random.default_rng(11007).normal over an unbalanced A x B cell pattern",
        {"resp": resp, "fa": fa, "fb": fb},
    )

    # Gage R&R: 10 parts x 3 operators x 2 replicates (balanced crossed)
    rng = np.random.default_rng(11008)
    part_effect = rng.normal(0.0, 0.9, 10)
    op_effect = np.array([0.0, 0.25, -0.2])
    rows = {"part": [], "operator": [], "meas": []}
    for p in range(10):
        for o in range(3):
            for _ in range(2):
                rows["part"].append(f"P{p + 1}")
                rows["operator"].append(f"O{o + 1}")
                rows["meas"].append(10.0 + part_effect[p] + op_effect[o] + rng.normal(0.0, 0.3))
    write(
        "gage_crossed",
        "Gage R&R crossed: 10 parts x 3 operators x 2 replicates, part sd 0.9, operator shift 0/0.25/-0.2, repeat sd 0.3",
        11008,
        "numpy.random.default_rng(11008).normal effects added to a 10.0 nominal",
        rows,
    )

    # Gage R&R nested: 3 operators x 4 (own) parts x 3 replicates
    rng = np.random.default_rng(11009)
    rowsn = {"part": [], "operator": [], "meas": []}
    for o in range(3):
        for p in range(4):
            pe = rng.normal(0.0, 1.1)
            for _ in range(3):
                rowsn["part"].append(f"O{o + 1}P{p + 1}")
                rowsn["operator"].append(f"O{o + 1}")
                rowsn["meas"].append(20.0 + pe + 0.15 * o + rng.normal(0.0, 0.35))
    write(
        "gage_nested",
        "Gage R&R nested: 3 operators x 4 nested parts x 3 replicates, part sd 1.1, repeat sd 0.35",
        11009,
        "numpy.random.default_rng(11009).normal effects added to a 20.0 nominal",
        rowsn,
    )

    # Gage R&R unbalanced crossed: one operator misses one replicate
    rng = np.random.default_rng(11010)
    rowsu = {"part": [], "operator": [], "meas": []}
    for p in range(5):
        for o in range(2):
            reps = 2 if not (p == 3 and o == 1) else 1
            for _ in range(reps):
                rowsu["part"].append(f"P{p + 1}")
                rowsu["operator"].append(f"O{o + 1}")
                rowsu["meas"].append(5.0 + rng.normal(0.0, 1.0))
    write(
        "gage_unbalanced",
        "Gage R&R crossed but unbalanced: part P4 / operator O2 has a single replicate",
        11010,
        "numpy.random.default_rng(11010).normal; one cell reduced to one replicate",
        rowsu,
    )

    # 8 ── boundary conditions: attribute counts -----------------------------
    defectives = [0, 1, 2, 0, 3, 1, 1, 0, 2, 1, 4, 0, 1, 2, 0, 1, 0, 3, 1, 1]
    sizes = [50] * 10 + [100] * 10
    defects = [0, 1, 3, 2, 0, 4, 6, 1, 2, 0, 5, 3, 1, 0, 2, 8, 1, 0, 2, 3]
    units = [1, 1, 1, 2, 2, 2, 1, 1, 3, 3, 1, 1, 2, 2, 1, 1, 4, 4, 1, 1]
    write(
        "attribute",
        "Attribute data: defectives with sizes 50/100, defect counts, and inspection units 1-4",
        11011,
        "literal counts (no RNG) — includes a zero-defective subgroup and a zero-defect subgroup",
        {"defectives": defectives, "sizes": sizes, "defects": defects, "units": units},
    )

    # 9 ── censored reliability ---------------------------------------------
    def weibull_sample(seed: int, n: int, shape: float, scale: float, failures: int):
        """Type-I censoring at the k-th smallest lifetime → exactly k failures."""
        g = np.random.default_rng(seed)
        life = scale * (-np.log(1 - g.random(n))) ** (1.0 / shape)
        cut = np.sort(life)[failures - 1]
        times = np.minimum(life, cut)
        censored = (life > cut).astype(int)
        order = np.argsort(times, kind="stable")
        return times[order], censored[order]

    rng = np.random.default_rng(11012)
    life = 200.0 * (-np.log(1 - rng.random(40))) ** (1 / 1.7)
    ctime = rng.uniform(60.0, 260.0, 40)
    times = np.minimum(life, ctime)
    censored = (life > ctime).astype(int)
    write(
        "censored_mixed",
        "Weibull(1.7, 200) n=40 with random right censoring U(60,260): mixes failures and censored units",
        11012,
        "numpy.random.default_rng(11012): life = 200(-ln U)^(1/1.7), censor = U(60,260), observed = min",
        {"time": times, "censor1": censored},
    )

    t3, c3 = weibull_sample(11013, 30, 1.8, 260.0, 3)
    write(
        "censored_few",
        "Type-I censoring at the 3rd smallest lifetime from Weibull(1.8,260) n=30: exactly three failures and 27 censored — the few-failure extreme",
        11013,
        "numpy.random.default_rng(11013): life = 260(-ln U)^(1/1.8), censored at the 3rd order statistic",
        {"time": t3, "censor1": c3},
    )

    rng = np.random.default_rng(11014)
    life = 300.0 * (-np.log(1 - rng.random(20))) ** (1 / 2.0)
    t2 = np.sort(life)[:2].tolist() + [60.0] * 18
    c2 = [0, 0] + [1] * 18
    write(
        "censored_two",
        "Exactly two failures out of 20 (the minimum fitWeibull accepts), 18 units censored at t=60",
        11014,
        "numpy.random.default_rng(11014): the two smallest lifetimes kept, the rest censored at 60",
        {"time": t2, "censor1": c2},
    )

    t5, c5 = weibull_sample(11015, 25, 2.2, 140.0, 6)
    write(
        "censored_heavy",
        "Type-I censoring at the 6th smallest lifetime from Weibull(2.2,140) n=25: heavy censoring, six failures",
        11015,
        "numpy.random.default_rng(11015): life = 140(-ln U)^(1/2.2), censored at the 6th order statistic",
        {"time": t5, "censor1": c5},
    )

    # 10 ── subgroup structures ---------------------------------------------
    rng = np.random.default_rng(11016)
    # n = 5 subgroups, 12 subgroups, one missing value inside subgroup 4
    v5 = rng.normal(100.0, 4.0, 60).tolist()
    v5[17] = None
    # n = 1 individuals series
    v1 = rng.normal(50.0, 3.0, 24).tolist()
    # n = 12 subgroups (Xbar-S territory), 3 subgroups
    v12 = rng.normal(7.5, 0.6, 36).tolist()
    # n = 2, 4, 10 shapes from one 40-row column
    vmix = rng.normal(12.0, 1.2, 40).tolist()
    # group-id based Xbar-S with varying ni
    ids = (["S1"] * 3 + ["S2"] * 5 + ["S3"] * 2 + ["S4"] * 4 + ["S5"] * 6 + ["S6"] * 2 + ["S7"] * 4 + ["S8"] * 5)
    vid = rng.normal(3.0, 0.4, 31).tolist()
    write(
        "subgroups",
        "Subgroup structures: 60 rows for n=5 (one missing), 24 individuals, 36 rows for n=12, 40 rows for n=2/4/10, and a 31-row group-id column S1..S8 with ni 2-6",
        11016,
        "numpy.random.default_rng(11016).normal; one hole at row 17 of the n=5 series",
        {"v5": v5, "v1": v1, "v12": v12, "vmix": vmix, "vid": vid, "sid": ids},
    )

    # DOE / RSM datasets ----------------------------------------------------
    # 2^3 full factorial, 2 centre points, one replicate; Y = 30 + 4A - 3B + 2C + 1.5AB + noise
    rng = np.random.default_rng(11017)
    A, B, C = [], [], []
    for a in (-1, 1):
        for b in (-1, 1):
            for c in (-1, 1):
                A.append(a)
                B.append(b)
                C.append(c)
    A += [0, 0]
    B += [0, 0]
    C += [0, 0]
    Y = [30 + 4 * a - 3 * b + 2 * c + 1.5 * a * b + rng.normal(0, 0.4) for a, b, c in zip(A, B, C)]
    write(
        "doe_2k3",
        "2^3 factorial with 2 centre points: Y = 30 + 4A - 3B + 2C + 1.5AB + N(0,0.4)",
        11017,
        "numpy.random.default_rng(11017).normal on the standard-order design (parameters in coded units)",
        {"A": A, "B": B, "C": C, "Y": Y},
    )

    # CCD k=2, 5 centre points: Y = 60 + 5x - 4y - 6x^2 - 5y^2 + 3xy + noise
    alpha = 2 ** 0.25
    xs = [-1, 1, -1, 1, 0, 0, -alpha, alpha, 0, 0] + [0] * 5
    ys = [-1, -1, 1, 1, -alpha, alpha, 0, 0, 0, 0] + [0] * 5
    rng = np.random.default_rng(11018)
    Yr = [60 + 5 * x - 4 * y - 6 * x * x - 5 * y * y + 3 * x * y + rng.normal(0, 0.3) for x, y in zip(xs, ys)]
    write(
        "rsm_ccd",
        "Central composite design k=2 (alpha=2^0.75), 5 centre points: Y = 60 + 5x - 4y - 6x^2 - 5y^2 + 3xy + N(0,0.3)",
        11018,
        "numpy.random.default_rng(11018).normal on the CCD run order",
        {"x": xs, "y": ys, "Y": Yr},
    )

    # ── Nelson-rule series and RSM/negative-component datasets ────────────
    # A series crafted so each of the eight Nelson rules fires at a known
    # position with centre 10 and sigma 1 (segments are concatenated).
    seg_a = [9.6, 10.2, 9.8, 10.1, 9.9, 10.3, 9.7, 10.0, 9.9, 10.05, 9.95, 10.02, 9.98, 10.01, 9.99]  # rule 7
    seg_b = [10.4, 10.6, 10.5, 10.9, 10.7, 10.8, 11.1, 10.95, 11.3]                                       # rule 2 (+6)
    seg_c = [9.5, 9.8, 10.1, 10.4, 10.7, 11.0]                                                           # rule 3
    seg_d = [10.5 if i % 2 == 0 else 9.5 for i in range(15)]                                             # rule 4
    seg_e = [12.5, 10.0, 12.6]                                                                            # rule 5
    seg_f = [11.5, 11.6, 10.0, 11.7, 11.8]                                                               # rule 6
    seg_g = [14.0, 10.0, 10.0]                                                                            # rule 1
    write(
        "nelson",
        "Crafted series (centre 10, sigma 1) where each Nelson rule 1-8 fires in a known segment; used to compare per-point rule lists",
        11019,
        "literal values, no RNG — segments A..G concatenated (rule 7, 2, 3, 4, 5, 6, 1)",
        {"x": seg_a + seg_b + seg_c + seg_d + seg_e + seg_f + seg_g},
    )

    # RSM with a stationary point outside the [-1, 1] region
    alpha = 2 ** 0.25
    xs = [-1, 1, -1, 1, 0, 0, -alpha, alpha, 0, 0] + [0] * 5
    ys = [-1, -1, 1, 1, -alpha, alpha, 0, 0, 0, 0] + [0] * 5
    rng = np.random.default_rng(11020)
    Yo = [10 + 5 * x + 5 * y - 1.2 * x * x - 1.2 * y * y + rng.normal(0, 0.05) for x, y in zip(xs, ys)]
    write(
        "rsm_outside",
        "CCD k=2 for a rising surface Y = 10 + 5x + 5y - 1.2x^2 - 1.2y^2: the stationary point (2.08, 2.08) lies outside the design region",
        11020,
        "numpy.random.default_rng(11020).normal on the CCD run order",
        {"x": xs, "y": ys, "Y": Yo},
    )

    # Two responses on one central-composite design: their optima point in
    # different directions, so a pair of moderate specifications cuts a bounded
    # feasible window — the case the overlaid contour exists for.
    alpha = 2 ** 0.25
    xs = [-1, 1, -1, 1, 0, 0, -alpha, alpha, 0, 0] + [0] * 5
    ys = [-1, -1, 1, 1, -alpha, alpha, 0, 0, 0, 0] + [0] * 5
    rng = np.random.default_rng(11022)
    Y1 = [60 + 5 * x - 4 * y - 6 * x * x - 5 * y * y + 3 * x * y + rng.normal(0, 0.3) for x, y in zip(xs, ys)]
    Y2 = [30 + 3 * x + 6 * y + 4 * x * x + 2 * y * y - 2 * x * y + rng.normal(0, 0.25) for x, y in zip(xs, ys)]
    write(
        "rsm_two",
        "CCD k=2, two responses: Y1 = 60+5x-4y-6x^2-5y^2+3xy + N(0,0.3), Y2 = 30+3x+6y+4x^2+2y^2-2xy + N(0,0.25); specs cut a bounded feasible window",
        11022,
        "numpy.random.default_rng(11022).normal on the CCD run order (two responses share the design)",
        {"x": xs, "y": ys, "Y1": Y1, "Y2": Y2},
    )

    # Gage study with no operator effect and large repeatability: the operator
    # variance component comes out negative and must be reported, not clamped.
    rng = np.random.default_rng(11021)
    rows = {"part": [], "operator": [], "meas": []}
    for p in range(8):
        pe = rng.normal(0.0, 0.25)
        for o in range(3):
            for _ in range(2):
                rows["part"].append(f"P{p + 1}")
                rows["operator"].append(f"O{o + 1}")
                rows["meas"].append(10.0 + pe + rng.normal(0.0, 0.9))
    write(
        "gage_negative",
        "Gage R&R where operator variation is absent (repeat sd 0.9, part sd 0.25): the operator variance component is negative",
        11021,
        "numpy.random.default_rng(11021).normal effects added to a 10.0 nominal",
        rows,
    )

    # Chart / worksheet-transform dataset: categories with distinct frequencies
    # (Pareto), a continuous column with outliers and holes (histogram, boxplot,
    # sort, standardize), a linear pair with three groups (scatter) and a coded
    # column (recode).
    rng = np.random.default_rng(11025)
    n = 60
    ids = list(range(1, n + 1))
    machine = [f"M{i % 3 + 1}" for i in range(n)]
    xc = rng.normal(50.0, 8.0, n)
    yc = 1.5 + 0.6 * xc + rng.normal(0.0, 2.0, n)
    value = rng.normal(50.0, 4.0, n).tolist()
    value[6] = round(value[6] + 24.0, 12)
    value[26] = round(value[26] - 22.0, 12)
    for i in (12, 33, 51):
        value[i] = None
    defect_pool = (["Scratch"] * 15 + ["Dent"] * 11 + ["Stain"] * 8 + ["Burr"] * 6 +
                   ["Crack"] * 5 + ["Hole"] * 4 + ["Warp"] * 3 + ["Flash"] * 2 + ["Void"] * 1)
    defect = list(defect_pool) + [None] * 5
    rng.shuffle(defect)
    code = [int(v) for v in rng.choice([1, 2, 3, 9], n)]
    defect = [d if isinstance(d, str) else None for d in defect]
    write(
        "charts",
        "Chart/transform data: 60 rows; defect categories 15/11/8/6/5/4/3/2/1 + 5 blanks, machine M1-M3 x20, "
        "x~N(50,8) with y=1.5+0.6x+N(0,2), value~N(50,4) with 2 outliers and 3 blanks, code in {1,2,3,9}",
        11025,
        "numpy.random.default_rng(11025): normal / choice, fixed outlier rows 6 and 26, blanks at 12/33/51",
        {"id": ids, "defect": defect, "machine": machine, "x": xc, "y": yc, "value": value, "code": code},
    )

    # Minimum-size datasets for the "not enough data" guards
    write(
        "tiny",
        "Two- and three-row samples: exercises not-enough-data / res.insufficient guards",
        11022,
        "literal values, no RNG",
        {"p2": [1.0, 2.0], "p3": [1.0, 2.0, 3.0], "y2": [2.0, 4.5], "x2": [1.0, 2.0]},
    )

    rng = np.random.default_rng(11023)
    life = 300.0 * (-np.log(1 - rng.random(20))) ** (1 / 1.8)
    t1 = [float(np.sort(life)[0])] + [55.0] * 19
    write(
        "censored_one",
        "Exactly one failure out of 20: below the two-failure minimum a Weibull MLE needs",
        11023,
        "numpy.random.default_rng(11023): smallest lifetime kept, the other 19 censored at 55",
        {"time": t1, "censor1": [0] + [1] * 19},
    )

    write(
        "censored_mixture",
        "Strongly non-Weibull censored sample: 15 lifetimes near 20 plus 15 near 180, all capped at 150 — gross model violation that the failures-only AD must still reject",
        11024,
        "literal values (bimodal), no RNG",
        {"time": [23.4, 17.1, 22.6, 19.8, 25.3, 16.9, 20.2, 18.7, 24.5, 21.3, 15.8, 20.9, 22.1, 19.1, 23.9,
                  185.4, 172.8, 193.2, 168.5, 178.9, 150, 187.1, 176.4, 150, 150, 181.5, 170.2, 150, 190.7, 150],
         "censor1": [0] * 15 + [1] * 15},
    )


if __name__ == "__main__":
    main()
