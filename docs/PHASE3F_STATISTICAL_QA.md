# Sigrún Phase 3F — 통계 모형 통제 독립 QA

> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `feature/phase3f-model-control`
> **기준선**: `ac7ca94` (Stage 3F-C) · **일자**: 2026-11-25
> **범위**: WO-3F-10 · QA-3F-01…25 · 배포 엔진과 독립 Python 참조의 수치 대조

## 1. 결과 요약

| 항목 | 결과 |
| --- | --- |
| `npm run qa:stats` | **250 / 250 PASS** |
| FAIL / REVIEW / UNVERIFIED / ERROR | **0 / 0 / 0 / 0** |
| 신규 QA-3F | **25 / 25 PASS** |
| QA-3F 영역 최대 절대 오차 | **1.99e-11** |
| 참조 환경 | Python 3.12.16 · NumPy 2.5.4 · SciPy 1.18.1 · statsmodels 0.15.0 · pandas 3.1.1 · patsy 1.0.3 |
| 어댑터 환경 | Node 22.23.4 · `src/lib`의 배포 TypeScript를 esbuild로 번들 |
| 산출물 | `qa/cases/QA-3F-model-control.json`, `qa/reports/latest.json`, `qa/reports/latest.html` |

QA-3F는 기존 225건을 대체하지 않고 25건을 추가했다. 전체 250건을 같은 요청 파일로 배포 어댑터와 참조 엔진에 보내 비교했다.

## 2. 독립성과 실행 경로

```bash
export PATH="/tmp/pk18-qa312/bin:$PATH"
npm run qa:stats
```

`qa/run.sh`의 순서는 다음과 같다.

1. Python·Node와 라이브러리 버전을 출력한다.
2. 고정 시드로 황금 데이터셋을 재생성하고 **추적 중인 JSON의 변경**을 거부한다.
3. `qa/build_request.py`가 250개 요청을 만든다.
4. `qa/adapters/sigrun/build.mjs`가 실제 `src/lib`를 번들하고 CLI 어댑터를 실행한다.
5. `qa/reference/engine.py`가 독립 참조를 계산하고 `qa/compare.py`가 필드별 허용오차로 비교한다.

3F-D에서 데이터셋 가드는 `qa/datasets/*.json`만 보도록 좁혔다. 기존 가드는 생성 스크립트 편집까지 황금 데이터 변경으로 오인해 새 데이터셋을 추가할 수 없었다. 추적 중인 황금 JSON의 diff 검사는 그대로 유지하며, 신규 JSON의 재생성은 허용한다.

참조는 TypeScript 구현을 호출하거나 복제하지 않는다.

- 풀링·부분 F: statsmodels OLS 두 번 적합, hat matrix의 PRESS, `anova_lm`, SciPy F 분포.
- Lenth: NumPy 중앙값과 SciPy t 분위수로 공식을 독립 계산.
- 계층성: 집합론적 하위 항 폐쇄를 `itertools`로 구현.
- 불균형 GLM: patsy의 `C(factor, Sum)` 코딩과 `anova_lm(typ=1/3)`.

## 3. 신규 데이터셋

| 파일 | 행 수 | 용도 |
| --- | ---: | --- |
| `qa/datasets/doe_pooled.json` | 16 | 2³ 요인 × 2반복. B×C 풀링과 원본/축소 비교 |
| `qa/datasets/doe_unreplicated.json` | 8 | 반복 없는 2³. 포화 적합과 Lenth |
| `qa/datasets/glm_crossed.json` | 24 | Machine × Shift 셀 크기 5/3/3/5/4/4. Type I·III 분리 |

세 파일은 `qa/datasets/generate.py`에 고정 시드와 생성식을 함께 기록했다. 실제 제품 데이터가 아닌 합성 데이터이며, 화면 샘플과 QA 데이터는 목적에 맞게 별도로 결정론 생성된다.

## 4. QA-3F 케이스

| 케이스 | 연산 | 검증 내용 |
| --- | --- | --- |
| QA-3F-01 | pooling | 원본/축소 SSE·DFE·MSE·S·R²·R²adj·R²pred |
| QA-3F-02 | pooling | 비교표의 model/error DF·SS·MS·S·R² 차이 |
| QA-3F-03 | pooling | 내포 축소의 부분 F, df1/df2, p |
| QA-3F-04 | pooling | 기대/실제 DFE·SSE와 가산성 플래그 |
| QA-3F-05 | pooling | A×B×C와 B×C를 함께 풀링 |
| QA-3F-06 | pooling | 축소가 없으면 부분 F 대신 `no-reduction` |
| QA-3F-07 | pooling | 작은 주효과 C를 풀링한 재적합 |
| QA-3F-08 | pooling | 2차 모형에서 B×C 풀링 |
| QA-3F-09 | lenth | s0·PSE·ME·SME·의사 자유도 |
| QA-3F-10 | lenth | 7개 효과의 크기와 절대값 |
| QA-3F-11 | lenth | `abs(effect) >= 2.5*s0` 활성 표시 |
| QA-3F-12 | lenth | 반복/중심점이 있으면 `replicated`로 거부 |
| QA-3F-13 | lenth | 포화가 아니면 `not-saturated`로 거부 |
| QA-3F-14 | doeanalyze | 포화 DOE의 효과와 정의 불가 통계량 |
| QA-3F-15 | hierarchy | strict: 상위 항 없는 교호작용 거부 |
| QA-3F-16 | hierarchy | auto: 빠진 상위 항 추가 |
| QA-3F-17 | hierarchy | unrestricted: 선택 유지와 위반 보고 |
| QA-3F-18 | hierarchy | 이미 계층적인 선택은 그대로 유지 |
| QA-3F-19 | hierarchy | 3차 항 선택 시 하위 항 6개 추가 |
| QA-3F-20 | hierarchy | 2차 항과 주효과의 부분 폐쇄 |
| QA-3F-21 | glm | 불균향 교차 설계 Type I·III ANOVA |
| QA-3F-22 | glm | 주효과만인 불균형 모형에서도 Type I≠III |
| QA-3F-23 | glm | 항 순서를 바꾸면 Type I만 순서 의존 |
| QA-3F-24 | doeanalyze | 반복 2³ 완전 모형 효과·적합통계 |
| QA-3F-25 | doeanalyze | 2차 모형 효과와 증가한 오차 자유도 |

## 5. 기준값과 수학적 계약

### 5.1 풀링은 덧셈이 아니라 재적합

```text
SSE_reduced = SSE_full + Σ SS_pooled   (풀링 항이 직교일 때 기대)
DFE_reduced = DFE_full + Σ df_pooled
F_partial   = (SSE_reduced − SSE_full) / (DFE_reduced − DFE_full) / MSE_reduced
df2         = DFE_reduced
p           = 1 − F_CDF(F_partial, df1, df2)
```

배포 엔진은 `fitWithPooling`이 설계행렬을 다시 만들고 `fitGlm`을 두 번 호출한다. 원본 결과는 `full`, 축소 결과는 `fit`에 각각 보존된다. `PoolingCheck`는 같은 행 집합, 기대/실제 DFE, 기대/실제 SSE, DF/SS 가산성을 보고한다. 허용오차는 `1e-8 × max(1, |SSE_full|, |SSE_reduced|)`다.

### 5.2 부분 F의 거부 사유

`compareFits`는 내포 관계, 행 집합, 자유도 감소, 축소 모형의 오차 MSE를 순서대로 확인한다. 실패 시 수치를 만들지 않고 다음 사유를 반환한다.

- `not-nested`
- `row-set-changed`
- `no-reduction`
- `no-error-df`

비교표의 MSE·S·R²adj·R²pred가 정의되지 않으면 0으로 대체하지 않고 `notInferable`, `pressUnavailable`, `missing` 사유를 붙인다.

### 5.3 Lenth

```text
s0        = 1.5 × median(|effect|)
inactive  = 0 < |effect| < 2.5 × s0
PSE       = 1.5 × median(inactive)
pseudo df = max(1, floor(m / 3)), m = len(inactive)
ME        = t(0.975, pseudo df) × PSE
SME       = ME / 2
active    = |effect| >= 2.5 × s0
```

반복 설계, 포화가 아닌 모형, 효과가 3개 미만, 척도가 퇴화한 경우에는 Lenth를 계산하지 않는다. Lenth는 잔차 표준오차가 아닌 **선별용 의사 표준오차**다.

### 5.4 계층성과 Type I·III

- strict: 하위 항이 빠지면 `model.hierarchyViolation|terms=A, B`처럼 거부한다.
- auto: 하위 항을 추가한 폐쇄를 저장한다.
- unrestricted: 선택을 유지하되 위반을 보고한다.
- 불균형 GLM: Type I(Seq SS)는 항 순서에 따라 달라지고, Type III(Adj SS)는 Sum 코딩 기준의 부분 제곱합이다. 두 열을 하나로 바꾸지 않는다.

## 6. 실측 기준값

| 항목 | 값 |
| --- | --- |
| 풀링 원본 SSE / DFE | 1.7368 / 8 |
| 풀링 축소 SSE / DFE | 1.7658 / 9 |
| 풀링 기대/실제 DFE | 9 / 9 |
| 부분 F df1 / df2 | 1 / 9 |
| 부분 F / p | 0.1479 / 0.7095 (QA-3F-03 기준) |
| 화면 풀링 예시의 부분 F / p | 1.85 / 0.207 (화면 샘플은 QA 데이터셋과 다른 결정론 데이터) |
| Lenth PSE / ME | 2.625 / 11.294 (QA-3F-09) |
| Lenth 활성 효과 | A만 활성 |
| 불균형 GLM n / dfe / rank / SSE | 24 / 18 / 6 / 3.1932 |
| DOE 효과 A / B / C | 8.8998 / 6.2961 / −4.3147 |
| 포화 DOE | DFE 0, S·R²adj는 NaN으로 비교 대상에서 정의 불가 |

화면 샘플과 QA 데이터셋은 생성기와 시드가 다르므로 같은 현상을 보여 주지만 수치가 반드시 같지는 않다. 두 수치를 혼용하지 않았다.

## 7. 경고와 한계

- 포화 OLS에서 statsmodels가 `df_resid=0` 관련 RuntimeWarning을 출력한다. 이는 QA-3F-14가 의도적으로 검증하는 정의 불가 상태이며, 비교기는 null/NaN을 모두 정의 불가로 취급한다. 0으로 바꾸지 않는다.
- 부분요인 설계의 rank-deficient 모형에서 `SingularMatrixWarning`이 나온다. 별칭 항의 df 0과 비추정 계수는 정상적인 거부/보고 경로다.
- SciPy의 Anderson 경고와 power overflow 경고는 기존 QA 경로에서도 발생하던 것이며 3F-D에서 통과 조건을 완화하지 않았다.
- **Minitab 실측 대조는 수행하지 않았다.** 이 QA의 독립 기준은 statsmodels·NumPy·SciPy와 문서화된 공식이다.
