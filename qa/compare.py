#!/usr/bin/env python3
"""Sigrún QA — comparator and report generator.

Compares the reference engine's values with the shipped engine's adapter values
using

    |actual − expected| ≤ atol + rtol · |expected|

with the default atol = 1e-8, rtol = 1e-6 and the documented exceptions in
qa/tolerances.json.  A tolerance is NEVER chosen after seeing a result: each
class states the numerical reason it is needed (an approximation used by the
engine, a table rounded to 3–4 decimals, a Monte Carlo p-value, …).

Five verdicts
  PASS        within the tolerance on an identical statistical definition
  FAIL        beyond tolerance on the same definition, or an unexpected error
  REVIEW      a definitional/approximation difference that needs review
              (declared per case, never counted as PASS)
  UNVERIFIED  no independent reference exists (declared per case)
  ERROR       execution or parsing failed on either side

Usage: python qa/compare.py <adapter.json> <reference.json> <cases dir> <out dir>
Exit code 1 when FAIL or ERROR > 0.
"""

from __future__ import annotations

import glob
import json
import math
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))

SPECIALS = {"NaN": math.nan, "Infinity": math.inf, "-Infinity": -math.inf, "null": None}


def decode(value):
    if isinstance(value, dict) and "__special" in value:
        return SPECIALS.get(value["__special"], None)
    return value


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def load_tolerances():
    path = os.path.join(HERE, "tolerances.json")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    return data["default"], data["classes"]


def field_specs(case):
    """Normalise a case's field list to [{key, tol, kind}]."""
    out = []
    for f in case.get("fields", []):
        if isinstance(f, str):
            out.append({"key": f, "tol": case.get("tolerance", "default"), "kind": "number"})
        else:
            out.append({
                "key": f["key"],
                "tol": f.get("tol", case.get("tolerance", "default")),
                "kind": f.get("kind", "number"),
            })
    return out


def within(actual, expected, tol):
    atol = tol.get("atol", 1e-8)
    rtol = tol.get("rtol", 1e-6)
    diff = abs(actual - expected)
    return diff <= atol + rtol * abs(expected), diff


def compare_case(case, adapter, reference, default_tol, classes):
    cid = case["id"]
    entry = {
        "id": cid,
        "area": case.get("area", "?"),
        "title": case.get("title", ""),
        "op": case["op"],
        "dataset": case.get("dataset"),
        "tolerance": case.get("tolerance", "default"),
        "declared": case.get("verdict", "PASS"),
        "note": case.get("note", ""),
        "args": case.get("args", {}),
        "fields": [],
        "verdict": "PASS",
        "errors": [],
        "max_abs": 0.0,
        "max_rel": 0.0,
    }
    expect_error = case.get("expectError")
    a = adapter.get(cid)
    r = reference.get(cid)
    if case.get("adapterOnly"):
        entry["verdict"] = "UNVERIFIED"
        entry["observed"] = (a or {}).get("values", {})
        entry["reason"] = case.get("note", "no independent reference")
        if a is None or a.get("status") != "ok":
            entry["verdict"] = "ERROR"
            entry["errors"].append("adapterOnly case produced no values")
        return entry
    if a is None or r is None:
        entry["verdict"] = "ERROR"
        entry["errors"].append("case missing in " + ("adapter" if a is None else "reference") + " output")
        return entry
    a_err = a.get("status") == "error"
    r_err = r.get("status") == "error"

    if expect_error:
        ok = True
        if not a_err:
            ok = False
            entry["errors"].append(f"expected engine error '{expect_error}' but the adapter returned a result")
        elif not str(a.get("errorCode", "")).startswith(expect_error):
            ok = False
            entry["errors"].append(f"engine error '{a.get('errorCode')}' ≠ expected '{expect_error}'")
        if not r_err:
            ok = False
            entry["errors"].append("expected the reference to refuse the same request, but it returned values")
        elif not str(r.get("errorCode", "")).startswith(expect_error):
            ok = False
            entry["errors"].append(f"reference error '{r.get('errorCode')}' ≠ expected '{expect_error}'")
        entry["verdict"] = "PASS" if ok else "FAIL"
        entry["errors_detail"] = {"adapter": a.get("errorCode"), "reference": r.get("errorCode")}
        if entry["verdict"] == "FAIL" and case.get("verdict"):
            entry["verdict"] = case["verdict"]
        return entry

    if a_err or r_err:
        entry["verdict"] = "ERROR" if (a_err and not r_err) or (r_err and not a_err) else "FAIL"
        if a_err and r_err:
            entry["verdict"] = "PASS" if str(a.get("errorCode")) == str(r.get("errorCode")) else "FAIL"
            entry["errors"].append(f"both sides raised: adapter '{a.get('errorCode')}' / reference '{r.get('errorCode')}'")
            if entry["verdict"] == "FAIL" and case.get("verdict"):
                entry["verdict"] = case["verdict"]
            return entry
        side = "adapter" if a_err else "reference"
        payload = a if a_err else r
        entry["verdict"] = "ERROR"
        entry["errors"].append(f"{side} raised {payload.get('errorCode')}: {str(payload.get('errorMessage'))[:300]}")
        return entry

    avals = a.get("values", {})
    rvals = r.get("values", {})
    failed = 0
    for spec in field_specs(case):
        key = spec["key"]
        rec = {"key": key, "tol": spec["tol"], "kind": spec["kind"]}
        if key not in avals or key not in rvals:
            rec["status"] = "missing"
            rec["adapter"] = avals.get(key, "<absent>")
            rec["reference"] = rvals.get(key, "<absent>")
            entry["errors"].append(f"{key}: missing on " + ("adapter" if key not in avals else "reference"))
            failed += 1
            entry["fields"].append(rec)
            continue
        actual, expected = avals[key], rvals[key]
        rec["adapter"] = actual
        rec["reference"] = expected
        if spec["kind"] in ("string", "bool"):
            rec["status"] = "match" if str(actual) == str(expected) else "mismatch"
            if rec["status"] == "mismatch":
                failed += 1
                entry["errors"].append(f"{key}: {actual!r} ≠ {expected!r}")
            entry["fields"].append(rec)
            continue
        ad, ex = decode(actual), decode(expected)
        if ex is None and ad is None:
            rec["status"] = "match"
            entry["fields"].append(rec)
            continue
        # "undefined" has two encodings: JSON null (the adapter's absent optional
        # value) and NaN (the reference's arithmetic result). Both mean the same
        # thing, so they are the same undefined outcome, not a numeric difference.
        if (ex is None and is_num(ad) and math.isnan(ad)) or (ad is None and is_num(ex) and math.isnan(ex)):
            rec["status"] = "match"
            rec["both_undefined"] = True
            entry["fields"].append(rec)
            continue
        if not is_num(ad) or not is_num(ex):
            rec["status"] = "type"
            failed += 1
            entry["errors"].append(f"{key}: non-numeric comparison ({ad!r} vs {ex!r})")
            entry["fields"].append(rec)
            continue
        if math.isnan(ex) and math.isnan(ad):
            rec["status"] = "match"
            rec["both_nan"] = True
            entry["fields"].append(rec)
            continue
        if math.isnan(ex) or math.isnan(ad):
            rec["status"] = "mismatch"
            failed += 1
            entry["errors"].append(f"{key}: one side undefined ({fmt(ad)} vs {fmt(ex)})")
            entry["fields"].append(rec)
            continue
        if math.isinf(ex) or math.isinf(ad):
            rec["status"] = "match" if ad == ex else "mismatch"
            if rec["status"] == "mismatch":
                failed += 1
                entry["errors"].append(f"{key}: {ad!r} ≠ {ex!r}")
            entry["fields"].append(rec)
            continue
        tol = default_tol if spec["tol"] == "default" else classes[spec["tol"]]
        ok, diff = within(ad, ex, tol)
        rec["abs"] = diff
        rec["rel"] = diff / abs(ex) if ex != 0 else (0.0 if diff == 0 else math.inf)
        entry["max_abs"] = max(entry["max_abs"], diff)
        if math.isfinite(rec["rel"]):
            entry["max_rel"] = max(entry["max_rel"], rec["rel"])
        rec["status"] = "match" if ok else "mismatch"
        if not ok:
            failed += 1
            entry["errors"].append(
                f"{key}: {ad!r} vs {ex!r} (|Δ|={diff:.3e}, rel={rec['rel']:.3e}, class={spec['tol']})"
            )
        entry["fields"].append(rec)

    if failed:
        entry["verdict"] = "FAIL"
    else:
        entry["verdict"] = "PASS"
    # A case declared REVIEW/UNVERIFIED is a definitional difference, never a
    # PASS; the field-level differences stay visible in the report detail.
    if entry["declared"] in ("REVIEW", "UNVERIFIED") and entry["verdict"] in ("PASS", "FAIL"):
        entry["verdict"] = entry["declared"]
    return entry


def load_cases(directory):
    cases = []
    for path in sorted(glob.glob(os.path.join(directory, "*.json"))):
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
        area = payload.get("area", os.path.basename(path).split("-")[0])
        for case in payload["cases"]:
            case.setdefault("area", area)
            cases.append(case)
    return cases


def summarise(entries):
    counts = {"PASS": 0, "FAIL": 0, "REVIEW": 0, "UNVERIFIED": 0, "ERROR": 0}
    for e in entries:
        counts[e["verdict"]] = counts.get(e["verdict"], 0) + 1
    verifiable = counts["PASS"] + counts["FAIL"]
    total = sum(counts.values())
    return {
        "counts": counts,
        "total": total,
        "verifiable": verifiable,
        "pass_rate_verifiable": (counts["PASS"] / verifiable) if verifiable else 0.0,
        "review_rate": counts["REVIEW"] / total if total else 0.0,
        "unverified_rate": counts["UNVERIFIED"] / total if total else 0.0,
        "areas": _area_summary(entries),
    }


def _area_summary(entries):
    areas = {}
    for e in entries:
        a = areas.setdefault(e["area"], {"PASS": 0, "FAIL": 0, "REVIEW": 0, "UNVERIFIED": 0, "ERROR": 0, "max_rel": 0.0, "max_abs": 0.0, "total": 0})
        a[e["verdict"]] += 1
        a["total"] += 1
        a["max_rel"] = max(a["max_rel"], e.get("max_rel", 0.0))
        a["max_abs"] = max(a["max_abs"], e.get("max_abs", 0.0))
    return areas


def fmt(v):
    if v is None:
        return "—"
    if isinstance(v, dict):
        return str(v.get("__special", v))
    if isinstance(v, float):
        if math.isnan(v):
            return "NaN"
        if v == math.inf:
            return "∞"
        if v == -math.inf:
            return "−∞"
        if v != 0 and (abs(v) < 1e-4 or abs(v) >= 1e6):
            return f"{v:.6e}"
        return f"{v:.10g}"
    return str(v)


BADGE = {
    "PASS": ("#0b7a3b", "#e3f6e9"),
    "FAIL": ("#a11d1d", "#fde8e8"),
    "REVIEW": ("#8a5a00", "#fff4d6"),
    "UNVERIFIED": ("#4a4a68", "#ececf5"),
    "ERROR": ("#6b1b6b", "#f6e6f6"),
}


def badge(verdict):
    fg, bg = BADGE.get(verdict, ("#333", "#eee"))
    return f'<span class="badge" style="color:{fg};background:{bg}">{verdict}</span>'


def render_html(payload):
    s = payload["summary"]
    c = s["counts"]
    meta = payload["meta"]
    rows = []
    for area, a in sorted(s["areas"].items()):
        rows.append(
            "<tr>"
            f"<td class='area'>{area}</td><td class='num'>{a['total']}</td>"
            f"<td class='num ok'>{a['PASS']}</td><td class='num bad'>{a['FAIL']}</td>"
            f"<td class='num warn'>{a['REVIEW']}</td><td class='num grey'>{a['UNVERIFIED']}</td>"
            f"<td class='num bad'>{a['ERROR']}</td>"
            f"<td class='num'>{fmt(a['max_abs'])}</td><td class='num'>{a['max_rel']:.2e}</td>"
            "</tr>"
        )
    detail = []
    for e in payload["cases"]:
        if e["verdict"] == "PASS":
            continue
        field_rows = []
        for f in e["fields"]:
            if f.get("status") == "match":
                continue
            field_rows.append(
                "<tr>"
                f"<td class='mono'>{f['key']}</td><td class='mono'>{fmt(f.get('adapter'))}</td>"
                f"<td class='mono'>{fmt(f.get('reference'))}</td>"
                f"<td class='mono'>{fmt(f.get('abs'))}</td>"
                f"<td class='mono'>{('%.2e' % f['rel']) if isinstance(f.get('rel'), float) and math.isfinite(f['rel']) else '—'}</td>"
                f"<td class='mono'>{f.get('tol')}</td>"
                "</tr>"
            )
        errs = "".join(f"<li>{_esc(x)}</li>" for x in e["errors"][:12])
        detail.append(
            f"<details class='case'><summary>{badge(e['verdict'])} <b>{_esc(e['id'])}</b> "
            f"<span class='muted'>{_esc(e['title'])}</span></summary>"
            f"<p class='muted'>op <span class='mono'>{_esc(e['op'])}</span> · dataset <span class='mono'>{_esc(e.get('dataset') or '—')}</span>"
            f" · tolerance <span class='mono'>{_esc(e['tolerance'])}</span>"
            + (f" · <span class='muted'>{_esc(e['note'])}</span>" if e.get("note") else "")
            + "</p>"
            + (f"<ul class='errs'>{errs}</ul>" if errs else "")
            + (
                "<table class='fields'><thead><tr><th>field</th><th>Sigrún</th><th>reference</th><th>|Δ|</th><th>rel</th><th>class</th></tr></thead><tbody>"
                + "".join(field_rows)
                + "</tbody></table>"
                if field_rows
                else ""
            )
            + "</details>"
        )
    methods = meta.get("reference_meta", {}).get("methods", {})
    method_rows = []
    for e in payload["cases"]:
        m = methods.get(e["id"])
        if not m:
            continue
        method_rows.append(
            f"<tr><td class='mono'>{_esc(e['id'])}</td><td>{_esc(m)}</td><td class='mono'>{_esc(e['op'])}</td></tr>"
        )
    datasets = "".join(
        f"<tr><td class='mono'>{_esc(d['name'])}</td><td class='num'>{d['rows']}</td><td class='mono'>{_esc(str(d['seed']))}</td><td>{_esc(d['description'])}</td></tr>"
        for d in payload["datasets"]
    )
    tol_rows = "".join(
        f"<tr><td class='mono'>{_esc(name)}</td><td class='mono'>{t.get('atol')}</td><td class='mono'>{t.get('rtol')}</td><td>{_esc(t.get('reason', ''))}</td></tr>"
        for name, t in payload["tolerances"]["classes"].items()
    )
    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sigrún 통계 엔진 독립 QA 보고서 · {payload['meta']['commit'][:8]}</title>
<style>
:root{{--ink:#1b1b23;--muted:#6a6a7a;--line:#e3e3ec;--bg:#f7f7fb;--card:#fff;--accent:#3b3b98}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,'Segoe UI','Noto Sans KR',sans-serif}}
main{{max-width:1080px;margin:0 auto;padding:32px 20px 64px}}
h1{{font-size:26px;margin:0 0 4px}}
h2{{font-size:19px;margin:36px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}}
h3{{font-size:15px;margin:20px 0 8px}}
.sub{{color:var(--muted);margin:0 0 24px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0 6px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}}
.card .k{{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}}
.card .v{{font-size:26px;font-weight:650;margin-top:2px}}
table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13.5px}}
th,td{{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}}
th{{background:#f0f0f7;font-weight:600;font-size:12.5px}}
tr:last-child td{{border-bottom:none}}
td.num{{text-align:right;font-variant-numeric:tabular-nums}}
td.ok{{color:#0b7a3b;font-weight:600}} td.bad{{color:#a11d1d;font-weight:600}}
td.warn{{color:#8a5a00;font-weight:600}} td.grey{{color:var(--muted)}}
.mono{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}}
.muted{{color:var(--muted);font-size:12.5px}}
.badge{{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11.5px;font-weight:700;letter-spacing:.02em}}
details.case{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:8px 0}}
details.case summary{{cursor:pointer}}
ul.errs{{margin:8px 0;padding-left:20px;font-size:13px}}
ul.errs li{{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}}
table.fields{{margin-top:8px}}
.formula{{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;font-family:ui-monospace,Menlo,monospace;font-size:13px}}
.note{{background:#fff;border-left:4px solid var(--accent);border-radius:6px;padding:10px 14px;margin:14px 0}}
.pill{{display:inline-block;background:#ececf5;color:#3b3b98;border-radius:999px;padding:1px 8px;font-size:12px;margin-right:6px}}
</style></head>
<body><main>
<h1>Sigrún 통계 엔진 독립 QA 보고서</h1>
<p class="sub">Sigrún statistics engine · independent reference QA · generated {_esc(payload['meta']['generated_at'])}</p>
<div class="cards">
  <div class="card"><div class="k">케이스 / cases</div><div class="v">{s['total']}</div></div>
  <div class="card"><div class="k">PASS</div><div class="v" style="color:#0b7a3b">{c['PASS']}</div></div>
  <div class="card"><div class="k">FAIL</div><div class="v" style="color:#a11d1d">{c['FAIL']}</div></div>
  <div class="card"><div class="k">REVIEW</div><div class="v" style="color:#8a5a00">{c['REVIEW']}</div></div>
  <div class="card"><div class="k">UNVERIFIED</div><div class="v" style="color:#4a4a68">{c['UNVERIFIED']}</div></div>
  <div class="card"><div class="k">ERROR</div><div class="v" style="color:#6b1b6b">{c['ERROR']}</div></div>
</div>
<div class="note">
<b>통과율 pass rate</b> = PASS / (PASS + FAIL) = {c['PASS']} / {s['verifiable']} = <b>{s['pass_rate_verifiable']*100:.1f}%</b><br>
REVIEW {s['review_rate']*100:.1f}% · UNVERIFIED {s['unverified_rate']*100:.1f}% — 두 분류는 <b>PASS에 합산하지 않습니다</b>(not counted as PASS).<br>
<span class="muted">Numerical criterion: |actual − expected| ≤ atol + rtol·|expected| (default atol 1e-8, rtol 1e-6).</span>
</div>

<h2>1. 분석군별 요약 · per-area summary</h2>
<table><thead><tr><th>area</th><th class="num">cases</th><th class="num">PASS</th><th class="num">FAIL</th><th class="num">REVIEW</th><th class="num">UNVERIFIED</th><th class="num">ERROR</th><th class="num">max |Δ|</th><th class="num">max rel</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>

<h2>2. FAIL · REVIEW · UNVERIFIED · ERROR 상세</h2>
{''.join(detail) if detail else '<p class="muted">없음 / none</p>'}

<h2>3. 검증 방식 · reference method per case</h2>
<p class="muted">라이브러리 API 우선(SciPy / statsmodels / NumPy / pandas), 라이브러리 미지원 항목만 공개 공식으로 독립 구현.</p>
<table><thead><tr><th>case</th><th>reference method</th><th>op</th></tr></thead><tbody>{''.join(method_rows)}</tbody></table>

<h2>4. 허용오차와 근거 · tolerances</h2>
<table><thead><tr><th>class</th><th>atol</th><th>rtol</th><th>근거 / reason</th></tr></thead><tbody>
<tr><td class="mono">default</td><td class="mono">1e-08</td><td class="mono">1e-06</td><td>{_esc(payload['tolerances']['default'].get('reason',''))}</td></tr>
{tol_rows}</tbody></table>

<h2>5. Golden datasets</h2>
<table><thead><tr><th>dataset</th><th class="num">rows</th><th>seed</th><th>설명</th></tr></thead><tbody>{datasets}</tbody></table>

<h2>6. 재현 · reproduce</h2>
<div class="formula">npm run qa:stats<br># 1 python3 qa/datasets/generate.py   (golden datasets)<br># 2 node qa/adapters/sigrun/.build/cli.mjs qa/_run/request.json qa/_run/adapter.json<br># 3 python3 qa/reference/engine.py qa/_run/request.json qa/_run/reference.json<br># 4 python3 qa/compare.py … → qa/reports/latest.json + latest.html</div>
<p class="muted">Sigrún commit <span class="mono">{_esc(payload['meta']['commit'])}</span> · engine bundle Node {_esc(payload['meta'].get('adapter_meta', {}).get('node',''))}
· reference Python {_esc(meta.get('reference_meta', {}).get('python',''))} · NumPy {_esc(meta.get('reference_meta', {}).get('numpy',''))}
· SciPy {_esc(meta.get('reference_meta', {}).get('scipy',''))} · statsmodels {_esc(meta.get('reference_meta', {}).get('statsmodels',''))}
· pandas {_esc(meta.get('reference_meta', {}).get('pandas',''))} · patsy {_esc(meta.get('reference_meta', {}).get('patsy',''))}</p>
<div class="note"><b>해석 주의 · scope</b> — SciPy/statsmodels와의 일치는 <b>통계적 정의의 정합성 근거</b>이며 Minitab과 100% 동일함을 보증하지 않습니다.
정규근사 vs 정확법, 분산성분 음수 처리, 자유도·표준화 정책, 중도절단 부트스트랩 근사 등은 REVIEW에 분리했습니다.</div>
</main></body></html>
"""


def _esc(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def main() -> None:
    if len(sys.argv) < 5:
        print("usage: compare.py <adapter.json> <reference.json> <cases dir> <out dir> [datasets dir]", file=sys.stderr)
        sys.exit(2)
    adapter_path, reference_path, cases_dir, out_dir = sys.argv[1:5]
    datasets_dir = sys.argv[5] if len(sys.argv) > 5 else os.path.join(HERE, "datasets")
    with open(adapter_path, encoding="utf-8") as fh:
        adapter = json.load(fh)
    with open(reference_path, encoding="utf-8") as fh:
        reference = json.load(fh)
    default_tol, classes = load_tolerances()
    cases = load_cases(cases_dir)
    entries = [compare_case(c, adapter["results"], reference["results"], default_tol, classes) for c in cases]
    summary = summarise(entries)
    datasets = []
    for path in sorted(glob.glob(os.path.join(datasets_dir, "*.json"))):
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        datasets.append({
            "name": d["name"],
            "rows": len(next(iter(d["columns"].values()))),
            "seed": d.get("seed"),
            "description": d.get("description", ""),
        })
    payload = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "commit": adapter.get("meta", {}).get("commit", "unknown"),
            "adapter_meta": adapter.get("meta", {}),
            "reference_meta": reference.get("meta", {}),
            "cases_dir": os.path.relpath(cases_dir),
            "datasets_dir": os.path.relpath(datasets_dir),
        },
        "tolerances": {"default": default_tol, "classes": classes},
        "summary": summary,
        "cases": entries,
        "datasets": datasets,
        "methods": reference.get("meta", {}).get("methods", {}),
    }
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "latest.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1, default=str)
    with open(os.path.join(out_dir, "latest.html"), "w", encoding="utf-8") as fh:
        fh.write(render_html(payload))
    c = summary["counts"]
    print(f"cases {summary['total']}  PASS {c['PASS']}  FAIL {c['FAIL']}  REVIEW {c['REVIEW']}  UNVERIFIED {c['UNVERIFIED']}  ERROR {c['ERROR']}")
    print(f"pass rate (PASS/(PASS+FAIL)) = {summary['pass_rate_verifiable']*100:.1f}%")
    if c["FAIL"] or c["ERROR"]:
        for e in entries:
            if e["verdict"] in ("FAIL", "ERROR"):
                print(f"  {e['verdict']:6} {e['id']}: " + "; ".join(e["errors"][:3]))
        sys.exit(1)


if __name__ == "__main__":
    main()
