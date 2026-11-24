# Sigrún Phase 3 — Stage 3C 교정 QA 보고서 (F-3C-01 … F-3C-13)

> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `fix/phase3c-corrective-qa` (기준선 `c827471be2`)
> **병렬 작업**: Agent A `fix/phase3b-corrective-qa`(PR #18 → `fca4e6f` 스쿼시 머지)와 **별도 디렉토리**(`repos/PKPilot0018-3c`)에서 작업했고, PR #18이 `main`에 병합된 뒤 `origin/main`(`b0f5667`)으로 **한 번에 rebase**해 Agent A의 최종 `modelPredictor.ts`·`feasible.ts`·`modelStore.ts`에 연결했다.
> **일자**: 2026-11-24

## 1. 검증 요약 (rebase 후 최종 트리에서 실측)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | **1 001 / 1 001 PASS** (44 파일) — 기존 834 + Phase 3B 교정분 + Stage 3D + 이번 교정 스위트 41 + 성능 7 |
| `npm run qa:stats` | **225 / 225 PASS, FAIL 0, REVIEW 0, UNVERIFIED 0, ERROR 0** (기존 180 + Phase 3B 25 + QA-W 신규 20) |
| `npm run build` | 성공 — 외부 CDN·API 없음 (`dist/assets/index-*.js` 1 196 kB) |
| Stage 3A E2E (`tools/e2e_phase3_3a.cjs`) | **29 / 29 PASS** |
| Stage 3B E2E (`tools/e2e_phase3_3b.cjs`) | **41 / 41 PASS** |
| Stage 3B 교정 E2E (`tools/e2e_phase3_3b_corrective.cjs`) | **13 / 13 PASS** |
| Stage 3C E2E (`tools/e2e_phase3_3c.cjs`) | **24 / 24 PASS** |
| Stage 3D E2E (`tools/e2e_phase3_3d.cjs`) | **49 / 49 PASS** |
| 성능 QA (`tools/bench_optimizer.ts`, `tests/perf-optimizer.test.ts`) | 8절 |

## 2. 수정 전 실패 증빙 (fail-first)

1. **테스트 파일**: `tests/phase3c-corrective.test.ts` — 결함 13건에 대응하는 **41개 테스트를 먼저** 작성했다. 기준선 `c827471be2`에서는 새 모듈(`factorDomain`, `predictionAdapter`)이 없어 파일이 로드 단계에서 실패하고 41개 전부 통과하지 못한다.
2. **행동 증빙**: 같은 기준선 체크아웃(`work/baseline-3c`, `c827471be2`)에서 결함별 동작을 직접 측정한 프로브를 남겼고(`work/baseline-3c/baseline-probe.json`), 교정 트리에서 같은 프로브를 다시 돌린 결과(`work/probe-after.json`)와 대조했다.

| 결함 | 측정 항목 | 기준선 (c827471be2) | 교정 후 |
| --- | --- | --- | --- |
| F-3C-01 | 연속 bounded 국소 탐색 상태 | `optimal` | `local-converged` |
| F-3C-01 | 연속 multi-start 상태 | `optimal` | `local-converged` |
| F-3C-07 | 완전 이산 전수 탐색 상태 | `optimal` | `global-optimal` |
| F-3C-07 | 도달 가능한 상태 집합 | `best-found, optimal` | `best-found, local-converged, global-optimal` (+`limit`·`feasible-not-found`·`infeasible`·`invalid`) |
| F-3C-02 | 프로파일러 이산 축 0…1 step 0.6 | `[0, 0.05, 0.1, …, 1]` (21점, step 무시) | `[0, 0.6]` |
| F-3C-02 | 이산 축 0…0.001 step 1e-4 | 21점, 4번째 `0.00015000000000000001` | 11점, 4번째 `0.0003` |
| F-3C-02 | 간격 위가 아닌 고정값 1.2 (step 0.5) | `invalid / opt.issue.allFixed` | `invalid / opt.issue.fixedOffStep` |
| F-3C-02 | 범위 밖 고정값 7 (0…5) | `invalid / opt.issue.allFixed` | `invalid / opt.issue.fixedOutside` |
| F-3C-03 | 같은 조건의 최적화기 상태 | `invalid / opt.issue.allFixed` (한 점 평가 불가) | `global-optimal`, 모형관리자 예측과 동일 |
| F-3C-04 | 없는 모형 ID | `opt.issue.noResponse` | `opt.issue.modelMissing` |
| F-3C-04 | 중복 반응 설정 | `best-found`, 반응 2개 | `invalid / opt.issue.responseDuplicate` |
| F-3C-05 | °C·°F 동명 인자 | `best-found` (합쳐서 탐색) | `invalid / opt.issue.unitConflict` |
| F-3C-05 | 수치·범주 동명 인자 | `no-feasible` (합쳐서 탐색) | `invalid / opt.issue.typeConflict` |
| F-3C-06 | 인자 목록에 없는 모형 변수 | 중심값 고정, 경고만 | `invalid / opt.issue.factorMissing` |
| F-3C-06 | 적합 범위 0~10·4~6의 기본 정의역 | `0 … 10` (합집합) | `4 … 6` (교집합, `domainSource: intersection`) |
| F-3C-06 | 적합 0~5 밖 4~8 탐색 | 조용히 탐색 | `invalid / opt.issue.extrapolationNotAllowed` |
| F-3C-08 | 역순 한계(하한 10, 상한 2) | 문제 없음(자동 교환) | `opt.issue.limitsReversed` |
| F-3C-08 | Target = Lower, 값 = 하한 | 만족도 0 | 만족도 1 |
| F-3C-08 | Target = Upper, 값 = 상한 | 만족도 0 | 만족도 1 |
| F-3C-08 | Weight = Infinity | 통과 | `opt.issue.weight` |
| F-3C-10 | 이산 0…5 step 0.6 중심값 | 2.5 (간격 밖) | 2.4 |
| F-3C-11 | mse 없는 모형의 구간 | CI 있음 · **PI 있음**(값 지어냄) | CI 있음 · PI 없음 |
| F-3C-13 | 인자 목록에 없는 변수를 쓰는 반응 | 예측값 3 표시 | 차단, 예측 없음 |

## 3. 결함별 조치

### F-3C-01 · 최적화 상태 (P0)

- **원인**: 연속 공간의 국소 탐색 수렴을 `optimal`로, 격자 탐색도 조건에 따라 `optimal`로 표시했다. 전역/국소/최선/한도 구분이 없었다.
- **수정**: 상태를 7종으로 재정의하고, `global-optimal`은 **모든 자유 인자가 이산·범주형이고 전 조합을 예산 안에서 평가했을 때만** 부여한다. 격자 축소(`search.gridReduced`), 중단 사유(`search.stoppedBy` = `complete`/`budget`/`time`/`cancel`), 전수 여부(`search.exhaustive`)를 별도 기록한다.

### F-3C-02 · 이산형 인자 제약 (P0)

- **원인**: 격자가 `lower + k·step`을 누적 덧셈으로 만들어 오차가 쌓였고, 프로파일러·랜덤 시작·국소 탐색이 각자 다른 규칙을 썼다. 고정값은 범위·간격 검증이 없었고 1e-4 step에서 값이 손실됐다.
- **수정**: `src/lib/factorDomain.ts`가 유일한 정의역 구현이다.
  - `discreteValueAt(lower, step, k)` — 정수 인덱스 k와 `10^d` 스케일 산술로 `Lower + k × Step`을 정확히 만든다(0.3의 배수, 1e-4 간격 모두 정확, 중복 없음).
  - `discreteAxis()` — `k = 0 … floor((Upper−Lower)/Step)`만 만들고 상한을 넘는 값을 만들지 않는다(0…1 step 0.6 → `[0, 0.6]`).
  - `validateFactorValue()` / `factorIssues()` — 고정값과 후보값을 범위·간격으로 검증한다(`fixedOutside`, `fixedOffStep`, `valueOffStep`, `valueOutside`, `levelUnknown`).
  - Grid·Enumeration·Random start·Local search·Profiler·UI가 모두 이 모듈을 쓴다.
  - 모든 후보는 평가 **직전** `candidateIssues()`로 검증하고, 거부 수는 `search.rejected`에 보고한다.

### F-3C-03 · 단일 예측 엔진 (P0)

- **원인**: `optimizer.ts`가 `compilePointEvaluator`로 예측식을 자체 보유했다(모형관리자·등고선·표면과 별도 경로).
- **수정**: `src/lib/predictionAdapter.ts`를 만들고 `optimizer.ts`의 예측 산술을 전부 제거했다(테스트가 `optimizer.ts` 소스에 `compilePointEvaluator`·`tInv`가 없음을 확인).
  - 어댑터는 **실제 좌표**로 입력받아 모형별 코딩으로 변환하고(`designFromActual`), 계수 라벨을 모형당 한 번 파싱하며, 값·SE·CI·PI·비식별·문제 코드를 한 형태로 돌려준다.
  - 구간 지원 여부는 Agent A가 만든 공용 `intervalStatus()`(공분산 유효성·rank·df·mse)로, 코딩 변환은 `designFromActual()`로 판정한다. 즉 **"무엇을 답할 수 있는가"는 한 곳(modelPredictor)에서만 정한다.**
  - 모형관리자 경로(`predictStoredModel`)와의 점별 일치를 `crossCheck()`·단위테스트·QA-W-31·32로 확인한다. 컴파일 경로는 측정상 1.7배 빠르다(23.7 µs → 14.0 µs/평가, 6항 모형) — 같은 정의를 공유하고 산술 경로만 다르므로 그 차이를 0과 비교해 검증한다.

### F-3C-04 · 부적합 반응 처리 (P0)

- `Ignore` 반응만 목적함수에서 제외하고(예측·보고는 유지), **활성 반응 중 하나라도 설정 오류가 있으면 즉시 `invalid`**(평가 0회)로 멈춘다.
- `opt.issue.modelMissing`, `opt.issue.responseDuplicate`를 새로 검증한다.
- 비식별(`nonEstimable`) 반응은 값·SE·CI·PI를 모두 `null`로 두고 `compliant=false`로 계산해 규격 만족으로 표시되지 않는다.

### F-3C-05 · 모형 호환성 (P0)

- 인자 이름뿐 아니라 **열 ID·단위·데이터 유형·범주 수준**을 검증한다(`columnConflict`, `unitConflict`, `typeConflict`, `levelIntersection`).
- 서로 다른 Coded 변환은 같은 실제 좌표에서 각 모형의 코딩으로 독립 예측한다(QA-W-21: x=15에서 7과 10.5).
- 이름만 같은 다른 단위·열은 병합하지 않고 문제 정의 오류로 거부한다.

### F-3C-06 · 유효 탐색 정의역 (P1)

- 수치 인자 기본 범위 = **모형별 적합 범위의 교집합**(`rangeIntersection`, `domainSource: intersection`). 교집합이 없으면 `opt.issue.rangeIntersection`.
- 범주형 기본 수준 = 모형들이 공통으로 적합한 수준의 교집합. 없으면 `opt.issue.levelIntersection`.
- 적합 범위 밖 탐색은 **명시적 허용**이 필요하다(인자별 `allowExtrapolation` 또는 창의 "적합 범위 밖 탐색 허용" 체크, 기본 꺼짐). 허용하면 후보마다 `extrapolated` 표시와 `opt.warn.extrapolation`.
- 인자 목록에 없는 모형 변수는 0·중심값으로 고정하지 않고 `opt.issue.factorMissing`으로 거부한다(프로파일러는 해당 반응 행을 차단).

### F-3C-07 · 탐색 상태 (P1)

7종을 명확히 구분한다: 전수 완료·규격 위반 없음 → `global-optimal`, 전수 완료·규격 위반 → `infeasible`, 미완·규격 위반 → `feasible-not-found`, 예산·시간·취소 → `limit`, 국소 수렴 → `local-converged`, 그 밖 → `best-found`, 문제 정의 오류 → `invalid`. 국소 탐색은 **시작점별 수렴 여부**를 `search.basins[]`(시작 인덱스·수렴·반복·평가 수·합성 만족도)로 관리하고 모든 구간이 수렴해야 `local-converged`다.

### F-3C-08 · 만족도 검증 (P1)

- 역순 한계는 **자동 교환하지 않고** `opt.issue.limitsReversed`로 거부한다.
- Target = Lower / Target = Upper를 정의했다: 목표가 한계에 닿으면 그 한계에서 만족도 1, 반대 한계에서 0(QA-W-25).
- Weight·Importance는 유한하고 `> 0`이어야 하며 NaN·±Infinity는 `opt.issue.weight` / `opt.issue.importance`(`compositeDesirability`도 비유한 중요도에서 0).
- **Hard Specification과 만족도를 분리**: `Solution.compliantAll`(하드 규격)과 `desirability`(곡선)를 따로 계산하고, `recommended`는 하드 규격을 모두 만족할 때만 참이다. 위반 조건은 최선 후보로만 표시되고 추천에 쓰이지 않는다.
- 모든 반응이 `Ignore`면 `invalid`(`opt.issue.noGoal`).

### F-3C-09 … F-3C-13 · 예측 프로파일러 (P1)

| 결함 | 조치 |
| --- | --- |
| F-3C-09 이산·범주 좌표 | `curveAxis`가 이산형은 `Lower + k×Step` 좌표만, 범주형은 적합 수준만 사용한다(축이 길면 허용값 중 균등 샘플 — 모든 점이 간격 위) |
| F-3C-10 초기·Reset 값 | `centrePoint`가 정의역 중앙(이산은 간격 위 중앙 2.4), 고정 인자는 고정값 유지. 모든 입력이 `normaliseFactorValue`를 거친다 |
| F-3C-11 입력 보완 정책 일치 | 현재 조건·곡선 축·열린 값·Reset이 모두 `resolvePoint` 하나를 쓴다(수직선과 곡선의 값이 어긋나지 않음) |
| F-3C-12 입력 검증 실패 | NaN·없는 수준은 예측을 만들지 않고 `prediction=null` + 행 문제 표시. 0이나 첫 수준으로 대체하지 않는다 |
| F-3C-13 구간 지원 분리 | CI는 공분산+df, PI는 추가로 mse가 필요하다(`intervalStatus().ci/pi`). mse가 없으면 CI만 내고 `interval:{ci:true,pi:false}`로 표시한다 |
| 추가 | 모형 변수가 화면 인자 목록에 없으면 그 반응 행은 `blocked`로 그리고 곡선을 그리지 않는다 |

### 성능 QA 및 실행 제어

- 조합 폭증 제어: 연속 축만 예산에 맞춰 성김(`planAxes`), 이산 축은 간격을 지키고 20 001개를 넘으면 허용값 중 샘플링(`truncated`), 규격 자동 제안 샘플링은 600회 상한.
- 실행 제어: 탐색은 **제너레이터**다. `optimize()`는 동기로 소진하고(QA 어댑터·테스트), `optimizeAsync()`는 `chunkSize` 평가마다 호스트에 제어를 돌려준다(창의 메인 스레드 응답성). `AbortSignal`과 창의 **Stop** 버튼은 다음 후보에서 즉시 멈추고 `search.stoppedBy='cancel'` + `opt.warn.cancelled`로 보고한다.
- 반복 실행 메모리: 100회 배치 5회에서 힙이 단조 증가하지 않는다(8절).

## 4. 구조 변경

| 모듈 | 책임 |
| --- | --- |
| `src/lib/factorDomain.ts` (신규) | 인자 정의역: `Lower + k×Step`, 범주 수준, 고정값 검증, 범위·수준 교집합, 값 정규화 |
| `src/lib/predictionAdapter.ts` (신규) | 실제 좌표 예측 어댑터: 코딩 변환·값·SE·CI·PI·비식별·문제 코드, 모형관리자 경로 교차 검증 |
| `src/lib/optimizer.ts` (재작성) | 문제 조립·검증·점수화·제너레이터 탐색·7종 상태·`search` 리포트·`optimizeAsync` |
| `src/lib/desirability.ts` | 엄격한 검증, Target 경계 정의, 하드 규격 분리 |
| `src/lib/profiler.ts` | 정의역 좌표·단일 입력 정책·행 차단·CI/PI 분리 |
| `ResponseOptimizer.tsx` / `PredictionProfiler.tsx` | 새 상태 배지·추천 아님 배너·검색 요약·외삽 허용 체크·Stop 버튼 / 차단 행·PI 미지원 표시·최적화 경고 |

예측 경로는 둘이며 서로 검증된다: **모형관리자·등고선·표면**(`predictStoredModel`, `compileSurfaceEvaluator`)과 **최적화기·프로파일러**(`predictionAdapter`). 두 경로는 같은 `intervalStatus`·`covarianceStatus`·`designFromActual`을 쓰고, 점별 일치를 단위테스트(1e-12)와 QA-W-31·32가 확인한다.

## 5. QA-W 확장 (신규 20건)

| 케이스 | 검증 대상 | 기준(독립 구현) |
| --- | --- | --- |
| W-13 | 격자 사이의 연속 최적점 | SciPy `differential_evolution` + L-BFGS-B, 상태 `local-converged` |
| W-14 | 이산 0…1 · Step 0.6 | Python으로 `Lower + k×Step` 전수 열거(허용값 2개) |
| W-15 | 음수 Lower · 비정수 Step 0.3 | 10진 스케일 산술로 허용값 생성 |
| W-16 | 매우 작은 Step 1e-4 | 11개 좌표·중복 없음·간격 위/아래 판정 |
| W-17 | 범위 밖 Fixed Value | 검증 규칙 재구현(`fixedOutside`) |
| W-18 | 활성 반응 규격 누락 | 규칙 재구현(`limitsMissing`, 평가 0) |
| W-19 | 잘못된 Model ID + 중복 반응 | 규칙 재구현(`modelMissing`, `responseDuplicate`) |
| W-20 | 동일 이름·다른 단위/ID | 규칙 재구현(`unitConflict`, `columnConflict`) |
| W-21 | 서로 다른 Coded 범위 | NumPy 설계행렬로 모형별 코딩 독립 예측 |
| W-22 | 학습 범위 교집합 없음 | 구간 교집합(`rangeIntersection`) |
| W-23 | 범주형 수준 교집합 없음 | 수준 교집합(`levelIntersection`) |
| W-24 | 좁은 만족 영역 + 예산 초과 | 예산 소진 시 `limit`/`budget`/`exhaustive=0` |
| W-25 | Target = Lower / Upper | 문서화된 만족도 정의(경계 봉우리) |
| W-26 | Weight NaN · Importance Infinity | 유한성 규칙(`weight`, `importance`) |
| W-27 | Hard Spec ↔ Desirability 충돌 | `feasible-not-found`, `recommended=0`, `compliant=0` |
| W-28 | 모형 순서 변경 불변성 | 반응 순서를 뒤집은 두 번째 실행과 비교 |
| W-29 | 공분산·MSE 누락 | t·SE(CI)와 t·√(SE²+mse)(PI) 각각의 조건 |
| W-30 | 이산형 Profiler 좌표 | 정의역 재유도(9개 값, 모두 간격 위) |
| W-31 | Profiler ↔ Optimizer 예측 일치 | NumPy `X'β` 1회 계산과 비교, 두 경로 차이 0 |
| W-32 | Contour / Surface / Model Manager ↔ Optimizer | 네 경로를 한 NumPy 예측과 비교, 산술 경로 차이 0 |

- **허용오차**: 새 클래스를 만들지 않았고 수치를 보고 허용치를 넓힌 항목도 없다. 기존 `optimizer_objective`(1e-6) · `optimizer_argmax`(0.005) · `optimizer_prediction`(1e-3) · `optimizer_coarse_grid`(2e-3) · `exact_zero`(1e-9)를 그대로 쓴다.
- 어댑터 연산 4종 추가: `domain`, `profileaxis`, `profilepoint`, `predictionconsistency`. 기준 엔진은 같은 규칙을 Python/NumPy/SciPy로 **다시 구현**하며 TypeScript 출력을 복제하지 않는다.

## 6. 상태 어휘 (사용자에게 보이는 변화)

| 상태 | 의미 |
| --- | --- |
| `global-optimal` | 완전한 이산·범주형 공간을 전수 평가해 그중 최선임을 확인 |
| `local-converged` | 연속 국소 탐색이 모든 시작 구간에서 허용오차까지 수렴(전역 주장 아님) |
| `best-found` | 조건을 찾았으나 최적성은 주장하지 않음 |
| `limit` | 평가 예산·시간·취소로 중단(그때까지의 최선) |
| `feasible-not-found` | 규격 만족 조건을 찾지 못했고 공간도 전수하지 못함 |
| `infeasible` | 공간을 전수했고 규격 만족 조건이 없음 |
| `invalid` | 문제 정의가 성립하지 않아 탐색하지 않음 |

## 7. 성능 QA (`tools/bench_optimizer.ts`, Node 24.11, 로컬)

| 모양 | 평가 수 | 시간(중앙값) | 평가당 | 상태 |
| --- | --- | --- | --- | --- |
| multistart, grid 21 (2인자·2반응) | 598 | 17.8 ms | 29.8 µs | `local-converged` |
| multistart, grid 41 | 598 | 16.8 ms | 28.1 µs | `local-converged` |
| multistart, grid 101 | 598 | 16.4 ms | 27.4 µs | `local-converged` |
| enumerate, step 0.2 (144 조합) | 144 | 4.4 ms | 30.3 µs | `global-optimal` |
| enumerate, step 0.1 (576 조합) | 576 | 16.2 ms | 28.0 µs | `global-optimal` |
| enumerate, step 0.05 (2 304 조합) | 2 304 | 63.7 ms | 27.7 µs | `global-optimal` |
| 프로파일러 리드로 10회 (5반응 × 2인자 × 21점) | — | 34.1 ms | 3.4 ms/회 | — |
| `optimizeAsync` 2 304평가 (chunk 64) | 2 304 | 116.6 ms | 호스트 yield 25회 | `global-optimal` |
| 반복 100회 × 5배치 힙 | 500회 실행 | 배치 후 30.7 / 29.4 / 28.1 / 58.2 / 40.6 MB | 단조 증가 없음 | — |

`tests/perf-optimizer.test.ts`는 이 수치에 여유를 둔 상한을 건다: 2인자 다중 시작 < 2 000 ms, 2 304조합 전수 < 4 000 ms, 예산(500회) 정확 종료, 시간 상한(120 ms) 종료, 청크 경계 yield ≥ 3회, 60회 반복 힙 증가 < 40 MB, 5반응 프로파일러 10회 리드로 < 1 500 ms.

## 8. 재현 명령

```bash
npx tsc --noEmit
npm test
npm run qa:stats
npm run build
CHROME_LIBS=/workspace/work/chrome-libs2/root/usr/lib/x86_64-linux-gnu node tools/e2e_phase3_3a.cjs
CHROME_LIBS=/workspace/work/chrome-libs2/root/usr/lib/x86_64-linux-gnu node tools/e2e_phase3_3b.cjs
CHROME_LIBS=/workspace/work/chrome-libs2/root/usr/lib/x86_64-linux-gnu node tools/e2e_phase3_3b_corrective.cjs
CHROME_LIBS=/workspace/work/chrome-libs2/root/usr/lib/x86_64-linux-gnu node tools/e2e_phase3_3c.cjs
CHROME_LIBS=/workspace/work/chrome-libs2/root/usr/lib/x86_64-linux-gnu node tools/e2e_phase3_3d.cjs
node_modules/.bin/vite-node tools/bench_optimizer.ts
BASE=https://hyangdan2.github.io/PKPilot0018/ SERVE=0 node tools/e2e_phase3_3c.cjs
```

`qa/_run/*`, `qa/adapters/sigrun/.build/*`는 실행 산출물이며 커밋하지 않는다(보고서 `qa/reports/latest.*`만 커밋).

## 9. 남은 확인

- 라이브 GitHub Pages 스모크은 이 PR 머지 후 `Deploy Sigrún to GitHub Pages` 워크플로 success 뒤에 수행한다(결과는 후속 커밋으로 이 문서에 기록).
- 브리프가 요구한 항목 중 실기기(모바일) 수동 확인은 Stage 3C 범위에서 390 px 뷰포트 E2E(3A·3B·3D)로 대체했다.

## 10. 최종 커밋

| 항목 | 값 |
| --- | --- |
| 최종 커밋 SHA | (머지 후 이 절에 기록) |
| 기준 커밋 | `c827471be2` |
| rebase 기준 | `origin/main` `b0f5667` (Phase 3B `fca4e6f` + Stage 3D `22d0e30`·#20·#21 포함) |
| PR | (머지 후 기록) |
