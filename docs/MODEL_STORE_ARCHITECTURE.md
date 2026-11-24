# Sigrún — Stored Model 관리자 설계 (Stage 3A / WO-02)

> **대상**: `HD2Lab Sigrún` (`HyangDan2/PKPilot0018`), Stage 3A
> **모듈**: `src/lib/modelStore.ts` · `src/lib/modelPredictor.ts` · `src/components/ModelManager.tsx`
> **목적**: 분석에서 적합된 모형을 독립적으로 보관하고, 후속 실행(등고선·표면·최적화)에서 **재적합 없이** 재사용한다.

---

## 1. 왜 별도 저장 계층인가

Phase 2까지 모형은 두 곳에만 존재했다.

| 위치 | 수명 | 한계 |
| --- | --- | --- |
| `ChartSpec.rsmModel` (`RsmModelPayload`) | 등고선 차트 안 | 반응표면 전용, 공분산·자유도 없음, 다른 분석에서 참조 불가 |
| 출력 카드의 표 | 화면 | 숫자만 있고 예측 API가 없음 |

Stage 3B(표면)·3C(최적화)는 "어떤 모형으로 그릴 것인가"를 먼저 정해야 하므로, 모형을 카드·차트와 분리된 **1급 객체**로 만들었다. 저장 모형은 프로젝트 파일과 자동 저장에 함께 실려 브라우저를 닫아도 남는다.

---

## 2. 모형 레코드 (`StoredModel`)

```
format/version      'sigrun-model' / 1        파일 호환 식별자
id, name            mdl-<base36>-<n>          사람이 붙인 이름
kind                linear | multiple | polynomial | glm | doe | rsm
createdAt/updatedAt ISO 8601
response            ModelVariable             반응 변수
predictors[]        ModelVariable             예측 변수
terms[]             { label, factors[] }      fitGlm에 그대로 넘길 수 있는 항 구조
coefficients[]      { label, value, se?, estimable }
covariance          number[][] | null         mse·(X'X)⁻¹, 계수 순서
residual            { sse?, df?, mse?, s? } | null
dof                 { model, residual, total, rank } | null
factorBounds        Record<name, {min,max}> | null   실제 단위 범위
categoricalLevels   Record<name, string[]> | null
training            { sheetId, sheetName, rows, fingerprint, columns[] } | null
diagnostics         { n, r2, r2adj, r2pred, f, p, s, aliased[] }
source              { analysisId, outputId }
```

### 2.1 "없는 정보는 만들지 않는다"

| 엔진 산출물 | 저장되는 것 | 저장되지 않는 것 (null) |
| --- | --- | --- |
| `regress()` | 계수·SE·공분산(`mse·inv`)·R²·R²(pred)·ANOVA | — |
| `fitGlm()` | 계수·SE·`xtxInv` 기반 공분산·별칭 항 | — |
| `RsmModelPayload` | 계수·S·R²·N·요인 변환 | **공분산·자유도** (payload에 없음) |
| DOE 요인배치 | 코딩 단위 계수·공분산 | R²(pred) (엔진이 계산하지 않음) |

Stage 3A에서 `RegressionResult`에 `covariance`, `GlmResult`에 `xtxInv`를 추가해 공분산을 **다시 계산하지 않고** 그대로 넘긴다. RSM payload는 공분산이 없으므로 `covariance = null`이고, 관리자는 "없음"으로 표시하며 SE·예측구간을 계산하지 않는다.

### 2.2 변수 메타데이터

`ModelVariable`은 이름만이 아니라 다음을 함께 보관해 예측 시 호환성을 검사한다.

- `id` — 적합에 쓴 열 ID(`C3`). 같은 이름의 다른 열이 생겨도 어긋나지 않는다.
- `kind` — `numeric` / `categorical`(+ `levels`, 적합된 정렬 순서)
- `coding` — `{ mode: 'coded' | 'actual', center, halfRange }`
  - DOE/RSM처럼 계수가 **코딩 단위**를 읽는 모형은 `mode: 'coded'`
  - 회귀처럼 **측정값**을 읽는 모형은 `mode: 'actual'` (center/halfRange는 표시·변환용)

---

## 3. 예측 (`modelPredictor.ts`)

### 3.1 설계행 재구성

계수 라벨만으로 설계행을 만든다. 라벨 문법은 `buildDesign()`이 만드는 것과 같다.

| 라벨 | 의미 | 값 |
| --- | --- | --- |
| `Constant` | 절편 | 1 |
| `A` | 수치 주효과 | 변환된 값 |
| `A²` | 제곱항 | 변환된 값² |
| `A×B` | 상호작용 | 두 값의 곱 |
| `Machine[Line A]` | 범주 대비(sum-to-zero) | 해당 수준 1, 마지막 수준 −1, 나머지 0 |

라벨이 해석되지 않으면(저장된 모형이 손상됨) 0을 곱하지 않고 `model.structure`로 **중단**한다.

### 3.2 Coded ↔ Actual 변환

```
coding.mode = 'coded'   actual 입력 → (x − center) / halfRange
                        coded  입력 → x
coding.mode = 'actual'  actual 입력 → x
                        coded  입력 → center + halfRange · x
```

같은 점을 두 단위로 넣으면 같은 ŷ가 나와야 하며, `tests/model-store.test.ts`와 `qa/cases/QA-J-models.json`(QA-J-02/04)이 이를 검증한다.

### 3.3 표준오차와 예측구간

- `se(ŷ) = √(xᵀ Σ x)`, Σ = 저장된 공분산
- `PI = ŷ ± t(1−α/2, dfe) · √(xᵀ Σ x + mse)`
- 공분산이나 dfe가 없으면 `null` (0으로 대체하지 않는다)

### 3.4 랭크 부족(Rank-deficient)

`lstsq()`는 별칭 열의 계수를 0으로 두고 `aliased`를 보고한다. 이 0을 그대로 곱하면 "그럴듯한 숫자"가 나오므로, **행이 별칭 계수에 0이 아닌 가중치로 의존하면** 예측값을 `null`로 두고 해당 항 목록을 반환한다(`nonEstimable`). 관리자는 값을 표시하지 않고 "추정 불가: … 항을 식별할 수 없습니다"라고 안내한다.

---

## 4. Stale 감지와 재적합

`training.fingerprint`는 적합에 쓴 열(반응 포함)의 `id:name:값` 전체를 FNV-1a로 접은 8자리 해시다.

| 상태 | 조건 | UI |
| --- | --- | --- |
| `fresh` | 같은 워크시트, 같은 지문 | "데이터 그대로" |
| `stale` | 워크시트는 있으나 지문이 다름 | "오래됨 — 데이터가 바뀜", 재적합 활성 |
| `missing-data` | 시트 삭제 또는 적합 열 삭제 | "오래됨 — {열} 없음", 재적합 비활성 |
| `untracked` | 학습 데이터 미기록(과거 프로젝트) | "학습 데이터 미기록" |

재적합(`refitStoredModel`)은 모형의 항 구조를 그대로 `fitGlm()`에 다시 넣어 계수·공분산·진단을 갱신하고 **id·이름·출처는 유지**한다. 열이 사라졌으면 `model.track.missingColumn`으로 거부한다.

---

## 5. 저장·복원 경로

| 경로 | 저장 내용 |
| --- | --- |
| 프로젝트 파일 `.sigrun.json` | `models[]` + `customChartStyles[]` + 출력(차트 설정 포함) |
| 자동 저장(IndexedDB) | `models` 포함 |
| 열기 | `parseStoredModels()`가 형식이 깨진 항목만 버리고 나머지를 병합(같은 id는 `updatedAt`이 최신인 쪽) |

`ProjectFile.version`은 1 그대로이며 `models`는 선택 필드다. Stage 3A 이전 파일은 `models` 없이 열리고, 이후 파일을 이전 빌드에서 열면 모형만 무시된다.

---

## 6. UI (`ModelManager.tsx`)

- **진입**: Stat ▸ 저장 모형 관리자…, 또는 출력 카드 우클릭 ▸ 모형 관리자에 저장 (회귀·GLM·요인배치·반응표면 카드에만 표시)
- **목록**: 이름·종류·반응←예측·stale 배지·비교 체크박스
- **상세**: ID/생성/수정, 계수표(별칭은 "추정 불가"), 공분산 유무, 학습 데이터, 3항 예측(단위 전환·범주 선택), 예측 결과(ŷ·SE·95% PI 또는 사유), 호환성 경고, 재적합, 복제, 삭제
- **비교**: 2개 이상 선택 시 N·dfe·S·R²·R²(adj)·R²(pred)·별칭·공분산 유무·수정 시각 표
- **후속 진입점**: `등고선` 활성(수치 요인 2개 이상, 추정 가능), `3D 표면`/`최적화`는 Stage 3B–3C 자리로 비활성 표시

---

## 7. 후속 단계가 쓰는 API

```ts
modelSurface(model, { xName, yName, holdings, resolution, mode })
// → { xs, ys, z[][], xRange, yRange, outOfRange, nonEstimable[] }
//   Stage 3B 표면 투영·3C 최적화가 같은 격자를 그대로 사용한다.
```

`z`의 `NaN`은 "이 점에서는 예측할 수 없음"이며 등고선 엔진이 마스크로 처리한다(값을 임의로 채우지 않는다).

---

## 8. 검증

| 검증 | 위치 |
| --- | --- |
| 저장/이름변경/복제/삭제/병합/프로젝트 왕복 | `tests/model-store.test.ts` |
| Coded/Actual 동등성, SE = s/√n(중심), 예측구간 | `tests/model-store.test.ts`, QA-J-01…04 |
| 랭크 부족 거부, 표면 NaN | `tests/model-store.test.ts`, QA-J-06 |
| Stale/재적합/지문 | `tests/model-store.test.ts` |
| 변수 ID·단위·범주 수준 호환성 | `checkCompatibility()`, `tests/model-store.test.ts` |
| 브라우저 UI | `tools/e2e_phase3_3a.cjs` (저장 → 관리자 → 예측 → 등고선) |
