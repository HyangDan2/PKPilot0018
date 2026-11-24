# Sigrún Phase 3B Corrective QA — 완료 보고

> 대상: `HyangDan2/PKPilot0018` (Sigrún) · 브랜치 `fix/phase3b-corrective-qa` · 기준선 `2c50f483`
> 참고: 작업 중 main이 Stage 3C(`c827471`)와 Stage 3D(`22d0e30`)로 전진해 브랜치에 차례로 병합했다. 두 단계의 코드는 그대로 보존했고, 아래 수치는 마지막 병합 후 트리에서 다시 측정한 값이다.
> 범위: F-01 ~ F-08 결함 수정, 신규 QA-V 19건, 전체 검증·배포
> 제외: Stage 3C Optimizer (착수하지 않음)

## 1. 결과 요약

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | **953 / 953 PASS** (기존 795 + 이번 신규 40 + 같은 기간 main에 들어온 Stage 3C 39 · 3D 79) |
| `npm run qa:stats` | **205 / 205 PASS** — FAIL 0 · REVIEW 0 · UNVERIFIED 0 · ERROR 0 (기존 168 + QA-V 19 + main의 QA-W 12 · 3D 6) |
| `npm run build` | 성공 (4.3 s) |
| E2E `tools/e2e_phase3_3b.cjs` | **41 / 41 PASS** (로컬 dist, WebGL + 비WebGL) |
| E2E `tools/e2e_phase3_3b_corrective.cjs` (신규) | **13 / 13 PASS** |
| E2E 회귀 | Stage 3D 48/48 · Stage 3C 24/24 · Stage 3A 29/29 · Phase 2 차트 34/34 · 차트 축 6/6 |
| Ultra(401×401, 2모형) 평가 시간 | 약 140 ms (Node 24, `basis: mean`) — 수정 전에도 401+401을 계산했으므로 이번 수정으로 오히려 2배 이상 빨라졌다 |

## 2. 수정 전후 독립 기준값

같은 probe 스크립트를 기준선 `2c50f483` 워크트리와 수정 트리에서 각각 실행한 값이다. "기준" 열은 계수와 코딩에서 직접 계산한 참값이다.

| 결함 | probe | 수정 전 | 수정 후 | 기준 |
| --- | --- | --- | --- | --- |
| F-01 | 모형2(A 중심 10, Half Range 5)의 실제 A=2 예측 | **106** | **95.2** | 95.2 |
| F-03 | 별칭 항 점(1,0)을 먼저 평가한 뒤 (0,0) 평가 | **NaN** | **5** | 5 |
| F-04 | A³ 항이 넘치는 점 A=1e200의 예측 | **1e+200** (부분합) | **null** | 무효 |
| F-04 | NaN 원소가 있는 공분산의 SE | **0.2828** | **null** | 무효 |
| F-05 | 모형1은 덮고 모형2는 벗어나는 범위의 외삽 플래그 | **false** | **true** | true |
| F-06 | Ultra(401)에서의 수렴도 `|ratio(401) − ratio(201)|` | **0** (자기 비교) | **0.0010394261468677** | 0.0010394261468677 |
| F-07 | `mse`가 없는 모형의 예측구간 폭 | **0.8913** (mse=0 대체) | **null** | null |
| F-02 / F-08 | 모형 1개로 중첩 등고선 요청 | **no-throw** | **feasible.minModels** | 오류 |

## 3. 결함별 원인과 수정

### F-01 모형별 요인 변환 (P0)

- **원인**: `computeGrid`가 `models[0]`의 예측자로 축 값을 설계 좌표로 바꾼 뒤 그 값을 모든 평가기에 넘겼다. 중심·Half Range가 다른 모형은 남의 코딩으로 평가되어 예측이 어긋났다(위 표 106 vs 95.2). `factorBounds`를 코딩 단위로 다시 해석하던 `factorDisplayRange`와, 3D 실험점을 코딩 레벨 그대로 실제 좌표에 찍던 경로도 같은 뿌리였다.
- **수정**: `modelPredictor.ts`에 `axisActualValue`(표시 단위 → 실제 단위)와 `designFromActual`(실제 단위 → 그 모형의 설계 단위)을 두고, `feasible.ts`는 **실제 좌표 격자를 한 번만 만들고 모형마다 자기 코딩으로 변환**한다(`entriesFor`). `Coded` 표시는 `referenceModelId`(기본 `models[0]`)의 코딩으로 실제 좌표를 정한다. `factorBounds`는 실제 단위로 명시하고 `factorDisplayRange`·3D 외삽·실험점 변환이 모두 이를 따르게 했다. `compileSurfaceEvaluator`는 항상 실제 단위 홀드값을 받는다.

### F-02 구간 기준의 조용한 폴백 제거 (P0)

- **원인**: `effectiveBasis = basis !== 'mean' && !interval.ok ? 'mean' : basis` — 공분산이 없는 모형이 있어도 신뢰구간 요청이 평균 기준으로 계산됐다.
- **수정**: 폴백을 삭제하고 `basisAvailability(models, basis)`가 모형별 사유와 함께 판정한다. 지원 불가면 `ModelInputError('feasible.basisUnsupported', { basis, blocked:[{model, reasons}] })`를 던진다. 엔진(`buildOverlaid`), 차트 재계산(`materializeOverlaid` — 오류를 `feasible.error`로 남기고 영역을 비움), 모형 관리자(사유 표시), 프로젝트 복원(`project.ts`의 `restoreChartBasis`)이 같은 판정을 쓴다. 복원된 카드가 "신뢰구간" 라벨 아래 평균 기반 영역을 들고 있지 않다.

### F-03 예측 상태 격리 (P0)

- **원인**: `compileSurfaceEvaluator`가 클로저의 `nonEstimable` 배열을 점 호출마다 누적해, 한 점이 별칭 항을 타면 이후 모든 점이 `NaN`이 됐다(위 표: 평가 순서만 바꿔도 5 → NaN).
- **수정**: `evaluate(x, y)`가 그 호출의 값·비추정 항목·분산을 모두 담은 `NodeEvaluation`을 돌려주고 아무 상태도 기억하지 않는다. 격자 집계는 `computeGrid`가 응답별 `Set`으로 따로 모은다. rank-deficient 판정은 계수 `estimable` 플래그와 `dof.rank`를 함께 보고, 그런 모형은 예측이 아니라 **구간**을 제한하며 `model.rankDeficient` 사유를 남긴다.

### F-04 비유한 값 처리 (P0)

- **원인**: `if (!Number.isFinite(weight) || weight === 0) return;` / `if (!Number.isFinite(entry)) continue;` — 넘친 항을 건너뛰고 부분합을 정상 예측처럼, NaN 공분산 원소를 빼고 작은 SE를 돌려줬다.
- **수정**: 가중치·계수·합계 중 하나라도 유한하지 않으면 예측을 무효(`null` + `model.value.nonFinite` / `model.coefficient.nonFinite`)로 만든다. 공분산은 크기·유한성·대칭성·양의 준정부호(Cholesky + 고유값 상대 허용 1e-7)·음수 분산을 검증하고, 분산이 `-1e-12`(절대) 또는 상대 1e-7 안쪽이면 0으로 클램프하되 그보다 큰 음수는 `model.covariance.negativeVariance`로 거부한다. 화면에는 0이나 정상값이 아니라 NaN/null로 도달한다.

### F-05 다중 모형 외삽 감지 (P1)

- **원인**: `models[0]`의 X/Y만 `factorBounds`와 비교했고 Holding Value는 보지 않았다.
- **수정**: 모든 모형 × 모든 요인(두 축 + 고정값)을 그 모형의 실제 단위 실험 범위와 대조해 `extrapolation.details`(모형·요인·축/고정·사용 범위·실험 범위)에 담는다. 기본 탐색 범위는 `sharedDisplayRange`로 **전 모형 범위의 교집합**을 쓰고, 교집합이 비면 첫 모형 범위로 그리되 `rangeWarning`을 남긴다.

### F-06 격자 수렴성 (P1)

- **원인**: `fineResolution = Math.min(401, res*2)` — Ultra(401)에서는 401을 자기 자신과 비교해 수렴도가 항상 0이었다.
- **수정**: Ultra에서는 **201×201과 비교**하고(`coarsened`), 그 아래에서는 2배 격자와 비교한다(`refined`). 격자점 비율 수렴도(`nodeDelta`)와 폴리곤 면적 수렴도(`areaDelta`)를 분리해 보고하며, 어느 두 격자를 비교했는지(`neighborCount`, `direction`)를 함께 남긴다. 좁은 영역·단절 영역의 한계는 UI 문구로 명시하고 QA-V-20a/20b가 수치로 보인다.

### F-07 구간 가용 조건 (P1)

- **원인**: `mse = model.residual?.mse ?? 0` — 잔차분산이 없어도 0으로 대체해 예측구간을 만들었다.
- **수정**: `intervalStatus(model)`가 한 곳에서 판정한다. 신뢰구간은 **유효한 공분산 + `df > 0` + 비 rank-deficient**, 예측구간은 추가로 **유한하고 `≥ 0`인 `mse`**가 필요하다(누락은 `model.mse.missing`, 0으로 대체 금지). 점별 구간을 동시 신뢰수준으로 오해하지 않도록 드로어에 안내 문구를 넣었다(한/영).

### F-08 엔진 입력 검증 (P1)

- **수정**: `validateOverlaidInput`이 최소 2모형, ResponseSpec 매핑(위치·`modelId` 일치), 모형 ID·반응 이름 중복, 공통 인자 ID·단위(`commonNumericFactors`), X=Y 금지, 유한 범위(`min < max`), 정수 해상도(11~401), 규격 유한성과 `LSL ≤ USL`, 범주형 고정값의 허용 수준, `0 < alpha < 1`, basis·mode 열거값, 기준 모형 존재를 검사하고 첫 코드와 전체 목록을 `ModelInputError.detail.problems`로 돌려준다.

## 4. 신규 QA-V 19건 (독립 기준)

`qa/reference/engine.py`에 numpy 기반 `op_overlay`·`op_overlay_order`를 추가했다(설계행렬·코딩 변환·마스크·교집합·4배 격자 구적·수렴 비교를 모두 독립 구현, TypeScript 복제 없음). `qa/adapters/sigrun/cli.ts`에 `overlay`·`overlay_order` op을 더해 저장 모형 레코드를 그대로 받아 배포 엔진을 실행한다.

| 요구 항목 | 케이스 | 확인 내용 |
| --- | --- | --- |
| 1. 중심·Half Range가 다른 두 RSM 모형 | QA-V-07 | 실제 좌표 동일, 모형별 코딩. z 10개·비율·만족점 |
| 2. Actual/Coded 혼합 | QA-V-08 | 계수가 실제 단위를 읽는 모형 + 코딩 모형 동시 평가 |
| 3. 같은 이름·다른 ID/단위 | QA-V-09 | `feasible.factor.conflict` |
| 4. 모형별 실험 범위 불일치 | QA-V-10 | `Y2|A|axis` 외삽 상세 |
| 5. Holding Value 외삽 | QA-V-11 | `C=2` 고정 외삽 + 그 값에서의 예측 |
| 6. 공분산 누락 | QA-V-12 | `feasible.basisUnsupported` |
| 7. 잔차분산(mse) 누락 | QA-V-13a / 13b | CI는 계산, PI는 거부 |
| 8. 비정상 공분산(NaN·비대칭·크기·음수) | QA-V-14a / 14b | 평균 예측 불변, 구간 차단, 기준 오류 |
| 9. Rank-deficient | QA-V-15 | A=0 열만 유한(11점), 나머지 NaN |
| 10. 예측 순서 변경 | QA-V-16 | 역순→정방향 값 동일(`order_identical=1`) |
| 11. NaN/Infinity·다항식 Overflow | QA-V-17 | 넘친 점 NaN, 만족으로 세지 않음 |
| 12. 잘못된 규격(LSL > USL) | QA-V-18 | `feasible.spec.invalid` |
| 13. Ultra 수렴성 | QA-V-19 | 이웃 201, `self_compare=0`, 수렴도 일치 |
| 14. 격자 사이 좁은 만족 영역 | QA-V-20a / 20b | 11×11에서 0점(narrow=1), 101×101에서 검출 |
| 15. 모형 배열 순서 불변성 | QA-V-21a / 21b | 응답 이름 기준 같은 예측·같은 만족 영역 |

허용오차는 `qa/tolerances.json`에 클래스와 수치적 이유를 함께 적었다(`feasible_area`, `grid_count`, `convergence_delta` 신규). 만족 면적은 배포 엔진이 marching squares 폴리곤으로, 기준이 4배 격자 중점 구적으로 재므로 두 정의 차이만 허용한다.

## 5. 기존 QA 회귀

- 기존 168건 전부 PASS. 특히 QA-J(저장 모형 예측) 4건은 실제 회귀처럼 보였으나, 모형의 공분산이 `mse·(X'X)⁻¹` 역행렬에서 생긴 **−2e-8의 고유값**(0.86 대각 대비 2e-8 상대)을 담고 있어 새 PSD 검사가 너무 엄격했던 것이다. 허용치를 상대 1e-7로 조정해 원래 SE·PI가 그대로 나오고, 진짜 음수 분산(−0.5 대각)은 여전히 거부되는 것을 QA-V-14와 단위 테스트가 함께 확인한다.
- `tests/feasible.test.ts`의 3건은 결함을 정답으로 고정하고 있던 테스트다(구간 기준 평균 폴백, `intervalAvailability` 반환형, 비수치 규격을 무시). 새 동작(구조화 오류·사유·오류 카드)으로 갱신했다.

## 6. E2E 및 UI

| 스크립트 | 결과 | 비고 |
| --- | --- | --- |
| `tools/e2e_phase3_3b.cjs` | 41/41 | 3D 표면(WebGL·정적 폴백)·중첩 등고선·신뢰구간 축소·구간 차단 안내 |
| `tools/e2e_phase3_3b_corrective.cjs` (신규) | 13/13 | 격자점/면적 수렴도 분리 표시, 비교 격자 명시(202×202 → Ultra 201×201), 점별 구간 안내, 좁은 영역 한계 문구, 공분산 없는 모형의 사유 표시 |
| `tools/e2e_phase3_3a.cjs` | 29/29 | 저장 모형 관리자·PNG 해상도·격리 |
| `tools/e2e_chart_upgrade.cjs` | 34/34 | 차트 드로어·스타일 |
| `tools/e2e_chart_axes.cjs` | 6/6 | 축 대화상자 |
| `tools/e2e_phase3_3c.cjs` | 24/24 | Stage 3C 최적화 — 이번 수정과 같은 트리에서 회귀 확인 |
| `tools/e2e_phase3_3d.cjs` | 48/48 | Stage 3D 레이아웃 편집기·고급 옵션 — 같은 트리에서 회귀 확인 |

스크린샷(로컬 dist):

- `/workspace/downloads/sigrun-3b-corrective/phase3-3b-corrective-convergence.png`
- `/workspace/downloads/sigrun-3b-corrective/phase3-3b-corrective-blocked.png`
- `/workspace/downloads/sigrun-3b-corrective/phase3-3b-overlaid.png`
- `/workspace/downloads/sigrun-3b-corrective/phase3-3b-surface.png`

UI에서 새로 보이는 것: 만족 영역 결과에 **격자점 수렴도 / 면적 수렴도 / 비교 격자와 방향**, 외삽된 **모형·요인·사용 범위·실험 범위** 목록, 기준을 계산할 수 없을 때의 **오류 배너(막힌 모형과 사유)**, 구간 기준 아래의 **점별(pointwise) 안내**.

## 7. 미해결·한계 (정직하게 남김)

- **동시(simultaneous) 신뢰대는 구현하지 않았다.** 점별 구간만 제공하고, 그 사실을 UI에 명시하는 것으로 F-07의 요구를 만족시켰다. 표면 전체 동시 신뢰수준을 원하면 별도 과제다.
- **rank-deficient 판정은 저장된 플래그(`estimable`, `dof.rank`)에 의존한다.** 적합 단계가 그 정보를 남기지 않은 모형은 엔진만으로는 판정할 수 없고, 이 경우 계수 값으로만 예측한다(공분산 PSD 검사는 별도로 수행).
- **만족 면적은 여전히 격자 근사**다. 좁거나 단절된 영역은 격자점 사이로 숨을 수 있으며, QA-V-20a(0점)·20b(검출)가 그 한계를 수치로 남긴다.
- **오류 배너는 UI로 선택할 수 없는 상태에서만 보인다.** 드로어가 지원 불가 기준을 숨기므로, 배너는 프로젝트 복원·외부 설정·엔진 직접 호출에서 나타난다. 이 경로는 단위 테스트 2건(복원·재계산)으로 검증했고 E2E로는 재현하지 않았다.
- 기준 엔진의 면적은 4배 격자 구적이라 폴리곤 면적과 정의가 다르다(`feasible_area` 클래스). 수렴도 비교는 같은 격자 정의를 쓰므로 기본 허용오차로 검증한다.

## 8. 변경 파일과 커밋

- 엔진: `src/lib/modelPredictor.ts` (`axisActualValue`, `designFromActual`, `covarianceStatus`, `intervalStatus`, `NodeEvaluation`), `src/lib/feasible.ts` (검증·모형별 좌표·수렴·외삽·공유 범위), `src/lib/chartConfigOps.ts`, `src/lib/project.ts`
- UI·문구: `src/components/ChartPropertiesDrawer.tsx`, `src/components/ModelManager.tsx`, `src/App.tsx`, `src/lib/i18n.ts` (한/영 신규 키 40여 개), `src/types.ts`
- 테스트: `tests/phase3b-corrective.test.ts` (신규 40건), `tests/feasible.test.ts` (결함 고정 3건 갱신)
- QA: `qa/reference/engine.py`, `qa/adapters/sigrun/cli.ts`, `qa/build_cases.py`, `qa/cases/QA-V-stage3b-surface.json`, `qa/tolerances.json`
- E2E: `tools/e2e_phase3_3b_corrective.cjs` (신규)

| 기록 | SHA |
| --- | --- |
| 구현·테스트·QA·문서 커밋 | `588de3c` (`fix/phase3b-corrective-qa`) |
| 이 문서의 SHA 기록 커밋 | `c68bbb2` |
| main(Stage 3C) 병합 커밋 | `fix/phase3b-corrective-qa` 위의 merge 커밋 (PR #18) |
| main 반영 | Squash merge — 머지 커밋 SHA는 PR과 최종 보고에 기록 |

Stage 3C Optimizer는 착수하지 않았다.
