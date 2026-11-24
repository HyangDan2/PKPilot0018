# Sigrún Phase 3E 교정 리뷰 QA — Round 2 (R-01 … R-06)

> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `fix/phase3e-corrective-r2`
> **기준선**: `2695b65` (Round 1 교정 `#27`이 머지된 `main`)
> **일자**: 2026-11-24
> **요구 사항**: "테스트 파일의 import 실패를 결함 재현 성공으로 간주하지 않는다. 각 결함의 실제 동작에 대한 assertion 실패와 수정 후 성공을 증빙한다."
> 그래서 Round 2 스위트는 **기준선에 이미 있는 공개 API만** import하고, 기준선에서 **모듈 로드가 아니라 단언이** 실패하는 것을 먼저 남겼다(§2).

## 1. 검증 요약 (최종 트리에서 실측)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | **1 075 / 1 075 PASS** (46 파일) — 기존 1 049 + Round 2 신규 26 |
| `npm run qa:stats` | **225 / 225 PASS**, FAIL 0 · REVIEW 0 · UNVERIFIED 0 · ERROR 0 |
| `npm run build` | 성공 — `dist/assets/index-1h2h5KCj.js` 1 209.84 kB · `index-DDhi7ejY.css` 67.27 kB |
| `npm run build:portable` | 성공 — `sigrun-portable.html` 1 248.6 kB · `sigrun-portable.zip` 363.6 kB |
| E2E 회귀 (로컬 `dist`) | **549 / 549 PASS** — stage1 77 · stage2 37 · stage3 176 · chart_axes 6 · chart_upgrade 34 · ui_compact 63 · 3A 29 · 3B 41 · 3B 교정 13 · 3C 24 · 3D 49 |
| Portable Offline Smoke (`file://`, 네트워크 차단) | **63 / 63 PASS** |
| Round 2 회귀 스위트 | 기준선 `2695b65` **20 FAIL / 6 PASS** → 교정 트리 **26 / 26 PASS** (§2, §3) |
| Portable CI 실제 실행·Artifact 다운로드 | **UNVERIFIED** — `workflows` 권한 403으로 미실행(§6) |

## 2. 수정 전 실패 증빙 (fail-first, 기준선 `2695b65`)

`tests/phase3e-corrective-r2.test.ts` **최종본을 그대로** 기준선 체크아웃(`git archive 2695b65`)에 넣고 실행한 기록: `work/pk18-3e-logs/r2-red.txt`

```
Test Files  1 failed (1)
     Tests  20 failed | 6 passed (26)
```

모듈 로드 실패(`Failed to resolve import`)는 **0건**이다. 20건 모두 단언 실패다.

| # | 검증 항목 | 기준선 실패 메시지 |
| --- | --- | --- |
| 1 | R-01 평균은 유한, 공분산 곱만 overflow — 모형관리자 | `expected [ 'model.value.nonFinite' ] to include 'model.interval.nonFinite'` |
| 1 | 〃 어댑터 | `expected null not to be null` |
| 1 | 〃 서피스 노드 | `expected [ 'model.value.nonFinite' ] to include 'model.interval.nonFinite'` |
| 1 | 〃 최적화기 | `expected null not to be null` |
| 1 | 〃 프로파일러 | `expected null not to be null` |
| 2 | R-02 `Value = 100000000.00003` 판정 | `expected true to be false` |
| 2 | R-02 같은 값의 `validateFactorValue` | `expected null to be 'opt.issue.valueOffStep'` |
| 2 | R-02 고정값을 최적화기가 거부 | `expected 'global-optimal' to be 'invalid'` |
| 2 | R-02 반 스텝 값이 인접 격자와 혼동되지 않음 | `expected true to be false` |
| 4 | R-03 CI만 다른 두 경로의 `crossCheck` | `expected 0 to be greater than 0` |
| 4 | R-03 `nonEstimable` 비교 범위 | `expected undefined to deeply equal []` |
| 5 | R-04 손상 Figure 복원 | `expected [Function] to throw an error` |
| 5 | R-04 중복 Worksheet ID | `expected [Function] to throw an error` |
| 5 | R-04 중복 Model ID | `expected [Function] to throw an error` |
| 5 | R-04 손상 Stored Model 내부 스키마 | `expected [Function] to throw an error` |
| 5 | R-04 손상 Output / Custom Style | `expected [Function] to throw an error` |
| 6 | R-05 `discreteAxis(0, 0.5, 1)` | `expected [] to deeply equal [ +0 ]` |
| 6 | R-05 `validateFactorValue(…, 0)` | `expected 'opt.issue.stepBelowPrecision' to be null` |
| 6 | R-05 단일 후보 최적화 | `expected 'invalid' not to be 'invalid'` |
| 6 | R-05 단일 후보 프로파일러 | `expected [] to deeply equal [ +0 ]` |

통과한 6건은 **지켜야 할 짝**이다(R-02의 실제 격자점 승인, R-04의 정상 Figure·정상 프로젝트 복원, R-03의 정상 `crossCheck`, R-01의 진짜 overflow 거부). 수정 후에도 그대로 통과해야 한다.

### 2.1 결함별 실측 대조 (`work/pk18-3e-logs/r2-probe-baseline.json` ↔ `r2-probe-final.json`)

| 결함 | 측정 | 기준선 `2695b65` | 교정 후 |
| --- | --- | --- | --- |
| R-01 | ŷ (A=1e154) — 모형관리자 | `1e+308` | `1e+308` |
| R-01 | 같은 점 — 어댑터 | **`null`** | `1e+308` |
| R-01 | 같은 점 — 최적화기 | **`null`** | `1e+308` |
| R-01 | 같은 점 — 프로파일러 평균 | **`[null, null, null]`** | `[1e+308, 1e+308, 1e+308]` |
| R-01 | 같은 점 — 오류 코드(전 경로) | `model.value.nonFinite`(값은 유한한데) | `model.interval.nonFinite` |
| R-01 | 진짜 overflow(A=1e160) | `null` + `model.value.nonFinite` | 동일(거부 유지) |
| R-02 | `isOnStep(1e8, 1e8+1e-3, 1e-4, 1e8+3e-5)` | **`true`** | `false` |
| R-02 | 같은 값 `validateFactorValue` | **`null`(허용)** | `opt.issue.valueOffStep` |
| R-02 | 반 스텝 값(`+5e-5`) | **`true`** | `false` |
| R-02 | 허용 오차 | `1e-12 × 1e8 = 1e-4`(한 스텝 전체) | `5.96e-8` (= 4 ULP @1e8, 스텝의 0.06%) |
| R-02 | 정상 격자점(`+1e-4`) | `true` | `true` |
| R-03 | `crossCheck.delta.ci` (CI 반폭만 다름) | **`0`(하드코딩)** | `0.110` → `consistent: false` |
| R-03 | `nonEstimable` 비교 | **필드 없음** | `delta.nonEstimable: 0`, `nonEstimable: ['A']` |
| R-03 | 비추정 계수에서 어댑터 issue 목록 | `model.mse.missing`(엉뚱한 구간 사유) | `[]` — 모형관리자와 동일 |
| R-04 | 손상 Figure | **`restored`**(조용히 삭제) | `file.figureCorrupt` |
| R-04 | 중복 Worksheet ID | **`restored`** | `file.worksheetDuplicate` |
| R-04 | 중복 Model ID | **`restored`** | `file.modelDuplicate` |
| R-04 | 손상 모형 내부(예측변수에 이름 없음) | **`restored`** | `file.modelCorrupt` |
| R-04 | 손상 Output 카드 | **`restored`** | `file.outputCorrupt` |
| R-04 | 손상 Custom Style | **`restored`** | `file.styleCorrupt` |
| R-05 | `discreteAxis(0, 0.5, 1)` | **`values: []`** | `values: [0]`, `count: 1` |
| R-05 | `validateFactorValue(…, 0)` | `opt.issue.stepBelowPrecision` | `null` |
| R-05 | 인자 정의 문제 | `[opt.issue.stepBelowPrecision]` | `[]` |

## 3. 수정 후 통과 증빙 (Green)

같은 파일, 같은 단언으로 교정 트리에서 실행: `work/pk18-3e-logs/r2-green.txt`

```
Test Files  1 passed (1)
     Tests  26 passed (26)
```

전체 스위트(`npm test`)도 함께 통과한다: **1 075 / 1 075**, 46 파일.

## 4. 결함별 수정 내용

### R-01 · 평균 예측 성공과 구간 실패를 분리 (P0)

한 곳에서 결정하도록 `src/lib/modelPredictor.ts`에 **구간 전용 코드와 분류기**를 두고, 다섯 경로가 모두 그것을 쓴다.

- `INTERVAL_NON_FINITE = 'model.interval.nonFinite'` — "평균은 숫자인데 구간을 계산하지 못했다". 이전에는 `model.value.nonFinite`를 썼는데, 값이 유한한 자리에서 그 코드는 거짓이다.
- `isIntervalIssue(code)` / `meanIssues(issues)` — `model.covariance.*`, `model.interval.*`, `model.mse.*`, `model.df.missing`, `model.rankDeficient`가 구간 쪽 코드다. 이것이 "값 정책"과 "구간 정책"의 유일한 정의다.
- `quadraticForm`이 곱 overflow로 실패하면 이유를 `model.interval.nonFinite`로 돌려준다(가중치 자체가 비유한이면 여전히 `model.value.nonFinite`).
- `PredictionResult`에 `ci: [number, number] | null`을 추가해 모형관리자도 CI 경계를 실제로 갖는다(이전에는 `se`와 PI만 있었다).
- 경로별 결과:
  - **Model Manager** (`predictStoredModel`): 값은 그대로, `se/ci/pi = null`, `issues`에 구간 코드.
  - **Surface** (`compileSurfaceEvaluator.evaluate`): 값 유지, `ciHalf/piHalf = null`, 구간 코드. `modelSurface` 격자도 유한한 평균을 그대로 담는다.
  - **Adapter** (`predictionAdapter.evaluate`): `quadraticForm` 실패 시 **`value: fit`** 반환(이전 `null`). 비추정 계수로 값이 없을 때는 모형관리자와 **같은 issue 목록**(군더더기 구간 사유 없이)을 돌려준다.
  - **Optimizer** (`scorePoint`): `compliant`는 **평균**에 대한 판정(`meanIssues(issues).length === 0`)으로 바꿨다. 구간 실패가 "쓸 수 있는 평균"을 비준수로 만들지 않는다. 구간 코드는 응답별 `issues`에 그대로 남는다.
  - **Profiler** (`profileCurves`): 곡선 평균이 채워지고, `ci`는 `null`, `issues`에 구간 코드.

### R-02 · 격자 소속 판정의 허용오차 (P0)

`src/lib/factorDomain.ts`의 `latticeSlack`(1e-12 × |값|)을 `latticeTolerance(lower, upper, step, value)`로 교체했다.

```
tol = min(step / 4, max(4 × ULP(값, lower, upper), step × 1e-12))
```

- **오프셋에 비례하지 않는다.** 1e8에서 1e-12×1e8 = 1e-4는 `Step = 0.0001`과 같은 크기라 0.3스텝 떨어진 값도 승인했다.
- **ULP를 고려한다.** 같은 크기에서 double 간격은 1.49e-8이므로 4 ULP = 5.96e-8만 허용하고(관측 오차 흡수), 실제 격자값은 차이가 0 또는 1 ULP 이내다.
- **인접 격자와 혼동하지 않는다.** 상한이 `step / 4`라 어떤 크기에서도 반 스텝에 닿지 않는다.
- `isOnStep`은 `nearestStepValue`의 판정(`inside && onStep`)을 그대로 쓴다(같은 식을 두 번 계산하던 것을 정리).

### R-03 · CrossCheck가 CI와 비추정 목록을 실제로 비교 (P1)

`src/lib/predictionAdapter.ts`의 `crossCheck`에서 `delta.ci: 0` 하드코딩을 제거했다.

- `intervalDelta(mine.ci, shared.ci)` — **양쪽 경계**의 최대 차이(어느 한쪽만 `null`이면 `Infinity`).
- `delta.nonEstimable` — 두 경로의 비추정 계수 목록 대칭차 개수, `CrossCheck.nonEstimable`로 어댑터의 목록을 함께 보고.
- `consistent`는 `value · se · ci · pi · issues · nonEstimable` **모두**와 각 값의 `null` 여부를 포함한다.
- 검증 하네스: 모형에 대해 어댑터를 먼저 컴파일한 뒤 `residual.df`를 5 → 30으로 바꿨다(리핏으로 t 기저만 달라진 상태). 평균·표준오차는 같고 CI만 0.110만큼 다르다. 기준선은 `consistent: true`, 교정 후 `false`.

### R-04 · Project 내부 스키마 검증과 중복 ID 거부 (P1)

`src/lib/project.ts`에 레코드별 검증기를 추가하고, **조용한 제거를 전부 없앴다**.

| 레코드 | 검증 | 거부 코드 |
| --- | --- | --- |
| Worksheet | 기존 컬럼/값 검사 + **시트 ID 중복** | `file.worksheetCorrupt` / `file.worksheetDuplicate` |
| Stored Model | `format`·`version`·`id`·`name`, response·predictors(이름/종류/coding/levels), 계수(라벨 중복·유한한 값·`estimable`), 공분산 크기·원소, residual.df, factorBounds | `file.modelCorrupt` / `file.modelDuplicate` |
| Output | `id`·`titleKey`·`blocks` 배열, 각 블록의 `type`, chart 블록의 `kind`(overlaid의 `models` 배열) | `file.outputCorrupt` / `file.outputDuplicate` |
| Figure | `format`·`version`·`page`(preset·mm)·`panels`(id·kind) | `file.figureCorrupt` |
| Custom Style | `id`·`name`·`base` ∈ `CHART_STYLE_IDS`·`overrides` | `file.styleCorrupt` / `file.styleDuplicate` |

이전 코드는 `figures.filter(entry => entry.format === 'sigrun-layout')`로 손상 Figure를 **말없이 지웠고**, `outputs`/`customChartStyles`가 배열이 아니면 **빈 배열로 대체**했다. 이제는 복원을 중단하고 사유를 돌려준다. `parseStoredModels`(손상 계수를 조용히 버리는 관용 리더)는 프로젝트 복원 경로에서 검증을 통과한 뒤에만 호출된다.

### R-05 · 후보가 하나뿐인 이산 격자 (P1)

`latticeIsRepresentable`이 `steps === 0`(Upper − Lower < Step)을 **"완전한 격자"**로 인정한다. 이전에는 두 번째 값(`Lower + Step`, 범위 밖)과 마지막 값을 비교해 `last >= second`가 거짓이 되어 격자를 비웠고, 인자 정의는 `opt.issue.stepBelowPrecision`("정밀도 부족")이라는 엉뚱한 사유를 냈다.

- `discreteAxis(0, 0.5, 1)` → `values: [0]`, `count: 1`, `steps: 0`
- `validateFactorValue(…, 0)` → `null`(허용), `0.5` → `opt.issue.valueOffStep`
- 최적화기는 그 한 점을 평가하고(`status: global-optimal`, 조합 `1`), 프로파일러는 한 점짜리 곡선을 그린다.

### R-06 · Portable CI 패치 문서 최신화 (P1)

`docs/CI_PORTABLE_PATCH.md`를 최신 `main` 기준으로 다시 썼다.

- 이전 판의 `SOURCE_DATE_EPOCH: ${{ github.event.repository.pushed_at || 0 }}`는 **틀렸다**: `pushed_at`은 ISO 문자열이라 `Number()`가 `NaN` → 빌드 시각이 "지금"으로 떨어져 두 번 빌드하면 ZIP 해시가 달라진다(실측: `db6115…` vs `d1a37e…`). `git log -1 --format=%ct`로 바꿨고, 같은 값으로 두 번 빌드해 **같은 SHA-256**(`c0b29e9d…`)을 확인했다.
- `qa-stats.yml`도 `npm install` → `npm ci` 한 줄을 함께 적었다(이전 판 누락).
- `deploy.yml` 패치는 현재 파일과 **diff 두 곳**(`cache: npm`, `npm ci`)뿐임을 기계적으로 확인했다.
- 적용 URL(웹 편집기 신규/수정), App 권한을 올리는 URL, `gh run download` 명령, `build-info.json`과 실제 파일 해시를 대조하는 확인 절차를 적었다.
- §6 참고: **실제 워크플로 실행과 Artifact 다운로드는 UNVERIFIED**다.

### 4.1 Round 1 단언 하나가 정책 변경으로 대체됨 (명시)

`tests/phase3e-corrective.test.ts`의 다음 단언은 **Round 1의 값/구간 정책**을 고정한 것이고, R-01이 그 정책을 바꿨으므로 함께 고쳤다.

```diff
-    expect(evaluation.value).toBeNull();
-    expect(evaluation.issues).toContain(NON_FINITE);
+    expect(evaluation.value).not.toBeNull();   // ŷ = 1e308 은 실제 예측값
+    expect(evaluation.se).toBeNull();
+    expect(evaluation.ci).toBeNull();
+    expect(evaluation.pi).toBeNull();
+    expect(evaluation.issues).toContain('model.interval.nonFinite');
+    expect(evaluation.issues).not.toContain(NON_FINITE);
```

테스트 이름도 `… is refused as non-finite` → `… fails the interval, not the mean`으로 바꿨다. 두 라운드가 어긋나는 곳은 이 한 건뿐이다.

## 5. 전체 회귀

| 스위트 | 결과 |
| --- | --- |
| unit (`npm test`) | 1 075 / 1 075 PASS (46 파일) |
| reference QA (`npm run qa:stats`) | 225 / 225 PASS |
| stage1 / stage2 / stage3 | 77 / 37 / 176 PASS |
| followup / chart_axes / chart_upgrade / ui_compact | 0 / 6 / 34 / 63 PASS |
| 3A / 3B / 3B 교정 / 3C / 3D | 29 / 41 / 13 / 24 / 49 PASS |
| E2E 합계 | **549 PASS / 0 FAIL** |
| Portable offline (`file://`, 네트워크 차단) | **63 / 63 PASS** |

## 6. UNVERIFIED로 남긴 것 — Portable CI 실제 실행

`R-06`이 요구한 "Portable CI 실제 성공 및 Artifact 다운로드 검증"은 **하지 못했다**. 이 저장소를 쓰는 GitHub App 설치에 `workflows` 권한이 없어 `.github/workflows/*` 푸시가 403으로 거부되기 때문이다(§4의 이력). 이번 라운드에서도 푸시를 재시도하지 않았다.

대신 **패치가 최신 트리에서 완전히 동작하는지**를 로컬에서 검증했다(§7). 남은 것은 사용자가 권한 있는 환경에서 §3의 URL로 세 파일을 적용하고, 첫 실행의 `sigrun-portable` Artifact를 내려받아 `build-info.json`의 `commit`·`sha256`이 받은 파일과 같은지 확인하는 일이다.

## 7. 패치 로컬 검증 (신규 체크아웃 조건)

`git archive 2695b65` → 빈 디렉터리(`node_modules` 없음)에서 패치의 스텝을 그대로 실행:

| 스텝 | 결과 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 77 패키지, `node_modules/.bin/playwright-core` 존재, vite 6.4.6 |
| `npx tsc --noEmit` | 0 errors |
| `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) npm run build:portable` | 성공 |
| `OUT=artifacts/portable node tools/e2e_portable_offline.cjs` | **63 / 63 PASS** |
| 업로드 경로 | `dist-portable/sigrun-portable.html` · `.zip` · `build-info.json` · `artifacts/portable/` 19개 파일 — 모두 생성됨 |
| `npx playwright-core install --help` | `--with-deps`·`chromium-headless-shell` 지원 확인 |

## 8. 한계 / 주장하지 않는 것

- 구간 실패는 **평균을 막지 않는다**는 정책을 택했다. 따라서 최적화기의 "준수(compliant)"는 평균과 한계로만 판정하고, 구간을 못 내는 점이어도 순위에 오를 수 있다. 구간이 필요 없는 목적(평균 최대화)에서는 옳지만, 구간 기반 만족영역(`feasible.ts`)은 종전대로 그 점을 칠하지 않는다.
- `crossCheck`의 `nonEstimable` 비교는 현재 두 경로가 같은 계산을 공유해 **실제로 갈라지는 입력을 만들 수 없다**. 그래서 이 항목은 "비교 범위"를 고정하는 가드로 남겼다(§2의 `nonEstimable` 행).
- `latticeTolerance`의 4 ULP는 관측된 산술 오차(≤1 ULP)에 여유를 둔 값이다. 스텝이 ULP에 가까운 극단(예: 1e15에서 스텝 0.2)은 여전히 `opt.issue.stepBelowPrecision`으로 거부된다.
- Portable CI의 실제 실행은 §6대로 UNVERIFIED다.

## 9. 머지·배포 기록 (2026-11-24)

| 항목 | 값 |
| --- | --- |
| PR | [#30](https://github.com/HyangDan2/PKPilot0018/pull/30) — squash 머지 |
| 머지 커밋 (`main`) | **`7f4b2e9`** |
| 원격 브랜치 | `fix/phase3e-corrective-r2` 삭제 완료 |
| PR CI (`Statistics QA (independent reference)`) | run [45400225012](https://github.com/HyangDan2/PKPilot0018/actions/runs/45400225012) — **success** (53s) |
| 배포 (`Deploy Sigrún to GitHub Pages`) | run [45400716046](https://github.com/HyangDan2/PKPilot0018/actions/runs/45400716046) — **success** |
| main QA (`Statistics QA`) | run [45400716116](https://github.com/HyangDan2/PKPilot0018/actions/runs/45400716116) — **success** |
| 라이브 번들 | `https://hyangdan2.github.io/PKPilot0018/` → `assets/index-1h2h5KCj.js` · `assets/index-DDhi7ejY.css` (로컬 `dist/`와 동일 해시) |
| 라이브 E2E | 3C **24 / 24 PASS** · 3D **49 / 49 PASS** (`node tools/run_e2e_suite.cjs --live`) |
| Portable 산출물 | `dist-portable/sigrun-portable.html` 1 278 617 B (`sha256 4ce9461b…38da83`) · `sigrun-portable.zip` 372 300 B (`sha256 fae1f6bb…`) · `build-info.json` `commit: 7f4b2e9` |
| 최종 `file://` 스모크 (머지본) | **63 / 63 PASS** |
