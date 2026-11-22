# Sigrún — independent statistics QA

The engine in `src/lib` is checked against an **independent reference** built on
the vetted Python stack (NumPy 2.5.4, SciPy 1.18.1, statsmodels 0.15.0,
pandas 3.1.1, patsy 1.0.3) — never against numbers translated out of Sigrún's
own code. No Minitab licence or COM automation is involved.

```bash
npm run qa:stats        # ← the whole thing (≈15 s), exits 1 on any FAIL/ERROR
open qa/reports/latest.html
```

## Layout

| path | 역할 |
| --- | --- |
| `qa/datasets/generate.py` → `qa/datasets/*.json` | 고정 시드 golden 데이터 24종(10대 데이터 유형: 균형·소표본·대규모·결측·상수·이상치·불균형·경계·중도절단·부분군 변화). 시드·생성식·라이브러리 버전을 파일에 함께 저장. |
| `qa/build_cases.py` → `qa/cases/*.json` | 케이스 155건(필드 목록·허용오차 클래스·기대 오류·REVIEW/UNVERIFIED 선언). |
| `qa/adapters/sigrun/cli.ts` | **출하 엔진을 그대로** 호출하는 JSON CLI. `npm`의 esbuild로 번들해 Node 22/24에서 실행. 계산식을 복제하지 않는다. NaN/±Infinity/null은 `{"__special": …}`로 태그. |
| `qa/reference/engine.py`, `formulas.py` | SciPy/statsmodels API 우선, 미지원 항목만 공개 공식으로 독립 구현(`independent_formula`). |
| `qa/compare.py`, `qa/tolerances.json` | `|a−e| ≤ atol + rtol|e|` 비교, 5단계 판정(PASS/FAIL/REVIEW/UNVERIFIED/ERROR), HTML/JSON 보고서. |
| `qa/experiments/qa_f_bootstrap.py` | QA-F 수치 실험(소수 고장 보정 규칙, 중도절단 메커니즘, Type I 오차). |
| `qa/inventory.md` | Phase 1 인벤토리(분석 40종 + 모듈 21개 + 기존 테스트 매핑). |

## Rules the harness enforces

1. **No tolerance widening to pass.** Every non-default tolerance in
   `qa/tolerances.json` states the numerical reason (A&S erf accuracy, Table VI
   rounding, Simpson quadrature, Monte Carlo p-value, …) *before* it is applied.
2. **REVIEW and UNVERIFIED never count as PASS.** The pass rate is
   `PASS / (PASS + FAIL)` and the other two are reported separately.
3. **Undefined is explicit.** `NaN`, `±Infinity`, `null` and engine errors are
   tagged values, so an undefined quantity can never masquerade as a number.
4. **The engine is never changed to make QA pass** — only a real defect is
   fixed, with a regression test and the evidence recorded in the report.

## What this does NOT claim

Agreement with SciPy/statsmodels is evidence of **statistical definition
consistency**, not a guarantee of bit-for-bit equality with Minitab. Normal
approximation vs exact methods (proportion power), the failures-only Anderson–
Darling statistic under censoring, bootstrap approximations and table rounding
are separated into REVIEW/notes rather than being declared identical.
