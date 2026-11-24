## 무엇을 했나 — Phase 3E 교정 리뷰 **Round 2** (R-01 … R-06)

기준선 `2695b65`(Round 1 교정 `#27` 머지 후 `main`). 리뷰가 지적한 6건을 고치고, **실패 → 통과**를 같은 테스트 파일로 남겼습니다.

### 1. R-01 (P0) 평균 예측 성공과 구간 실패를 분리
평균 `ŷ`은 유한한데 공분산 곱(`w′Σw`)만 넘치는 점에서, 어댑터·최적화기·프로파일러가 **평균을 통째로 버리고** 있었습니다(모형관리자는 보여주고 있었음). 이제 다섯 경로가 한 정책을 씁니다.

- `modelPredictor`에 구간 전용 코드 `model.interval.nonFinite`와 분류기 `isIntervalIssue` / `meanIssues`를 두고, `PredictionResult`에 `ci` 경계를 추가.
- Model Manager · Surface · Adapter · Optimizer · Profiler 모두 **값은 반환**, `se/ci/pi`만 `null`, 사유는 구간 코드로.
- 최적화기의 `compliant`는 **평균** 기준으로 판정 — 구간을 못 내는 점이 "쓸 수 없는 점"이 되지 않습니다.
- 진짜 overflow(가중치 자체가 비유한)는 종전대로 거부합니다.

### 2. R-02 (P0) 격자 소속 판정의 허용오차
`1e-12 × |값|`(오프셋 비례) → `min(step/4, max(4 ULP, step×1e-12))`.
`Lower=1e8, Step=0.0001, Value=100000000.00003`은 이제 `opt.issue.valueOffStep`(이전엔 통과, 허용오차가 한 스텝 전체였음). 실제 격자점과 반 스텝 값 판정은 회귀 테스트로 고정했습니다.

### 3. R-03 (P1) `CrossCheck`의 `ci: 0` 하드코딩 제거
- CI **양쪽 경계** 차이(`delta.ci`)와 **비추정 목록**(`delta.nonEstimable`, `CrossCheck.nonEstimable`)을 실제로 비교하고 `consistent`에 포함.
- CI만 다른 두 경로(df 5 → 30으로 t 기저만 바뀐 상태)에서 `consistent: false`가 되는 것을 증빙.
- 비추정 계수에서 어댑터가 엉뚱한 구간 사유를 덧붙이던 것도 모형관리자와 일치시켰습니다.

### 4. R-04 (P1) Project 내부 스키마 검증 · 중복 ID 거부
- Worksheet / Stored Model / Output / Figure / Custom Style 각각의 스키마를 검증하고, 중복 Worksheet ID·Model ID(+Output/Style ID)를 거부합니다: `file.worksheetDuplicate`, `file.modelDuplicate`, `file.outputCorrupt`, `file.figureCorrupt`, `file.styleCorrupt`.
- **조용한 제거 금지**: 손상 Figure를 `filter`로 지우고, 배열이 아닌 outputs/styles를 빈 배열로 바꾸던 경로를 제거 — 복원 중단 + 사유 반환.

### 5. R-05 (P1) 후보가 하나뿐인 이산 격자
`Lower=0, Upper=0.5, Step=1` → `[0]`. 단일 후보 격자를 "정밀도 부족"으로 거부하던 것을 고쳤고, 최적화기(`global-optimal`, 조합 1)와 프로파일러(한 점 곡선)가 정상 동작합니다.

### 6. R-06 (P1) `docs/CI_PORTABLE_PATCH.md` 최신화
- 이전 판의 `SOURCE_DATE_EPOCH: ${{ github.event.repository.pushed_at || 0 }}`는 **틀렸습니다**: ISO 문자열 → `NaN` → 빌드 시각이 "지금"이 되어 두 번 빌드하면 ZIP 해시가 달라집니다(실측). `git log -1 --format=%ct` + `$GITHUB_ENV`로 교체, 같은 커밋 → 같은 SHA-256 확인.
- `qa-stats.yml`의 `npm install` → `npm ci` 한 줄 추가 안내, `deploy.yml` 패치가 현재 파일과 두 곳만 다른지 기계 대조.
- 적용 URL(웹 편집기 신규/수정), App 권한 URL, `gh run download` 명령, `build-info.json` 해시 대조 절차 수록.

## 검증

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | 0 errors |
| `npm test` | **1 075 / 1 075 PASS** (46 파일) — 기존 1 049 + Round 2 26 |
| `npm run qa:stats` | **225 / 225 PASS** |
| `npm run build` / `npm run build:portable` | 성공 (js 1 209.84 kB / html 1 248.6 kB · zip 363.6 kB) |
| E2E 회귀 | **549 / 549 PASS** |
| Portable offline smoke (`file://`) | **63 / 63 PASS** |
| Round 2 스위트 | 기준선 `2695b65`에서 **20 FAIL / 6 PASS** → 이 트리 **26 / 26 PASS** |

기준선 실행은 `git archive 2695b65` 체크아웃에 **같은 테스트 파일**을 넣어 돌렸고, 모듈 로드 실패는 0건입니다(전부 단언 실패). 전체 대조표는 `docs/PHASE3_3E_CORRECTIVE_QA_R2.md` §2에 있습니다.

## 남긴 것 (UNVERIFIED)

- **Portable CI 실제 실행·Artifact 다운로드**: 이 저장소를 쓰는 GitHub App에 `workflows` 권한이 없어 `.github/workflows/*` 푸시가 403입니다. 이번에도 푸시를 시도하지 않았고, 대신 **신규 체크아웃 조건**(`git archive` → 빈 디렉터리)에서 `npm ci` → `build:portable` → `OUT=artifacts/portable e2e_portable_offline`을 그대로 실행해 **63/63**과 업로드 경로 4종 생성을 확인했습니다. 적용 절차는 `docs/CI_PORTABLE_PATCH.md` §3.
- Round 1 테스트의 단언 **1건**이 R-01로 정책이 바뀌어 함께 수정되었습니다(테스트 이름·주석에 명시).
