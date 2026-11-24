# Sigrún Guided Tutorial 교정 QA — T-01 … T-13

> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `fix/tutorial-corrective-qa`
> **기준선**: `66efb29` (PR #33 `audit/minitab-master-gap`이 머지된 `main`)
> **일자**: 2026-11-25
> **요구 사항**: "import 실패는 결함 재현으로 간주하지 않는다. 기준선의 기존 공개 API만 호출해 실제 동작 assertion이 FAIL 나는 로그를 남기고, 수정 후 동일 테스트 파일이 PASS 나는 로그를 남긴다."
> 그래서 교정 스위트는 **기준선에 이미 있던 공개 API만** import한다. 기준선에서 실패한 19건은 모두 단언 실패(또는 슬롯 필드 부재를 읽는 단언)이고, 모듈 로드 실패는 0건이다(§3). T-01·T-02는 함수가 아니라 **실행 중인 앱의 상태**이므로 브라우저 probe로 같은 방식(기준선 FAIL → 교정 PASS)을 남겼다(§3.2).

## 1. 검증 요약 (최종 트리에서 실측)

| 항목 | 결과 |
| --- | --- |
| `npx tsc --noEmit` | **0 errors** |
| `npm test` | **1 139 / 1 139 PASS** (49 파일) — 기존 1 096 + 교정 증빙 24 + 신규 모듈 19 |
| `npm run qa:stats` | **225 / 225 PASS**, FAIL 0 · REVIEW 0 · UNVERIFIED 0 · ERROR 0 |
| `npm run build` | 성공 — `dist/assets/index-6yt7r07p.js` 1 506.67 kB · `index-Mp7rP2EX.css` 78.24 kB |
| `npm run build:portable` | 성공 — `sigrun-portable.html` 1 549.2 kB (1 586 419 B) · `sigrun-portable.zip` 453.9 kB (464 816 B), 스탬프 2026-11-24T15:37Z |
| Portable ZIP 배포 위치 | `/workspace/work/pkpilot0018/sigrun-portable.zip` 갱신 |
| Tutorial E2E (`tools/e2e_tutorials.cjs`) | 12개 레슨 전부 통과 · 배치별 **16/16, 15/15, 14/14, 13/13** (중복 실행 포함) |
| Tutorial Guard probe (`tools/probe_tutorial_guard.cjs`) | **9 / 9 PASS** (기준선 빌드에서는 4 FAIL) |
| Portable Offline (`file://`, 네트워크 차단) | `qa:portable` **63 / 63**, `qa:tutorials:portable` **8 / 8** |
| 교정 증빙 스위트 (RED → GREEN) | 기준선 **19 FAIL / 5 PASS** → 교정 **24 / 24 PASS** |

## 2. 결함별 수정 내용

### P0 — 원본 데이터 보호

**T-01 · 실습 시작 전 원본 영구 저장과 확인**
- 시작 경로: `beginTutorial()` → `guardOriginalProject()`가 원본 프로젝트를 `.sigrun.json` 텍스트와 지문(fingerprint)으로 `sigrun.tutorials.original.v1`에 쓰고 **다시 읽어 텍스트·지문이 같은지** 확인한다. 확인되지 않으면 실습을 **시작하지 않고** `tutorial-backup-dialog`를 띄운다. 그 dialog의 "백업을 내려받고 실습 시작" 버튼이 파일을 내려준 뒤에야 실습이 열린다(명시적 백업 안내).
- 자동 저장 지연: 시작 직전 `saveAutosave()`를 **await**해 아직 남아 있던 자동 저장분을 먼저 확정한다. 진행 중이던 저장은 원본 상태를 담고 있으므로(자동 저장은 실습 중 정지) 원본을 덮지 않는다.
- 새로고침·브라우저 종료: 자동 저장이 비어 있거나 **실습 프로젝트가 자동 저장 슬롯에 들어 있는** 경우, hydration 단계에서 보관된 원본을 워크스페이스로 복원하고 `tut.originalRestored`를 알린다. 실습을 끝낼 때 창의 스냅샷이 없으면 보관본에서 복원한다(`restoreOriginalProject`).
- 회귀: (a) 저장소가 거부하는 상태에서 실습이 열리지 않고 백업 dialog가 뜬다, (b) 자동 저장 debounce 중에 시작해도 직전 셀 편집이 살아남는다, (c) 실습 도중 새로고침해도 원본 워크시트가 남는다 — probe 3건 + 기존 E2E 1건.

### P1 — 실습 격리와 검증 정확성

**T-02 · 전체 프로젝트 상태 격리·복원**
- 스냅샷에 `settings`(테마·언어)와 사용자 차트 스타일(`loadCustomStyles`)을 포함하고, 복원 시 `setSettings` + `writeCustomStyles`로 되돌린다. Worksheet·Output·Model·Figure·Undo/Redo 기록은 기존대로 격리·복원된다.
- 회귀: 실습 안에서 테마를 바꾸면 종료 후 원래 테마로 돌아온다(probe).

**T-03 · 샘플 동일성 검증**
- `sampleSignature(sampleId)`가 레지스트리의 `build()` 결과(행 수·열 이름·열 값 전체)를 만든다.
- `sample-loaded` 규칙은 (a) 샘플에서 온 이벤트의 `sampleId` 일치, (b) 워크시트 열 이름, (c) **행 수**, (d) **열 값 전부**를 비교한다. 이름만 같은 가짜 샘플은 `sample-values`, 행을 잘라낸 샘플은 `sample-rows`로 거부한다.

**T-04 · 분석 입력·파라미터·결과 검증**
- `analysis-output` 규칙에 `columns`, `params`, `presetId`를 추가했다. preset이 있으면 그 슬롯(열 이름·리터럴 값)에서 기대 입력과 기대 파라미터를 유도한다(`expectedRun`).
- 실행 결과는 `meta.columns`(입력 열), `meta.values`(파라미터), 그리고 **표/차트 산출물 존재**로 판정한다. 다른 열 → `analysis-columns`, 다른 파라미터 → `analysis-params`, 빈 카드 → `analysis-no-result`. `meta.sheetId`가 이 프로젝트에 없는 워크시트면 `analysis-sheet-gone`.
- 플래그십 `fit-models` 단계에 세 코드화 요인 열을 명시했고, `tutorial-start-001`의 desc 단계는 `preset-desc-thickness`의 슬롯을 그대로 검증한다.

**T-05 · 반응별 고유 모형 검증**
- `model-stored`는 모형을 **반응별로 묶어** 조건(종류·2차항·R²)을 만족하는 모형이 있는 반응만 인정한다. 같은 반응의 중복 모형은 개수에 포함되지 않으며, 개수 미달은 `model-count`(중복 목록·빠진 반응 포함)로 보고한다. 조건을 만족하지 못하는 모형이 하나라도 있으면 `model-not-quadratic` / `model-r2` / `model-kind`로 즉시 실패한다(카운트로 흐르지 않는다).

**T-06 · 프로파일러 인자·예측·저장 검증**
- `profiler-check`는 (a) 열린 조건에 **최적화 해의 모든 요인 값**이 있는지, (b) 그 값이 최적 조건과 같은지, (c) 최적화에 쓰인 **모든 반응 행**이 있는지, (d) `requireSaved`(또는 `consistent`)일 때 저장 기록이 있는지, (e) 저장된 조건이 화면 조건과 같은지, (f) 저장된 예측값이 저장 모형의 예측과 일치하는지 확인한다. 요인 누락은 `profiler-arguments-missing`, 미저장은 `profiler-not-saved`.

**T-07 · 실습 보관 슬롯 분리**
- 보관 키를 `sigrun.tutorials.practice.v2`(`{ slots: { [tutorialId::sessionId]: slot } }`)로 바꿨다. `savePracticeSlot` / `listPracticeSlots` / `loadPracticeSlot(tutorialId, sessionId)` / `removePracticeSlot(slotId)`를 쓰며, 버리기는 **해당 세션 슬롯만** 제거한다. v1 키는 읽기 전용으로 마이그레이션된다.
- 회귀: 두 실습을 보관하면 두 카드가 모두 "Resume"으로 남고, 각각 자기 프로젝트로 다시 열린다(E2E).

**T-08 · 복원 근거 저장과 재평가**
- 슬롯에 `events`(검증 근거), `progress`, `originalProjectId`를 함께 저장한다. 재개 시 `setTutorialEvents(slot.events)` 후 엔진이 모든 규칙을 다시 평가하므로, 복원된 상태가 규칙을 만족하지 않으면 완료가 복원되지 않는다.

**T-09 · Roundtrip은 개수가 아니라 내용 비교**
- `src/lib/projectCompare.ts`가 워크시트·열 ID/이름/타입/모든 셀, 결과 카드 ID·분석 ID·블록 구성·표 행 수·차트 종류/제목, 저장 모형 ID·항·계수·R², Figure 패널, 설정, 사용자 스타일을 정규화해 비교하고 차이를 `where`와 함께 나열한다.
- `verifyPracticeJson`이 이 비교를 쓰고, `project-saved` 이벤트에 `mismatches`를 담는다. 검증기는 `roundtripOk`가 true여도 `mismatches`가 있으면 `project-roundtrip`으로 실패한다.

**T-12 · 검증 대상 ID 명확화**
- 모든 판정 결과의 `evidence`에 `projectId`, `sessionId`, `worksheetId`, `modelIds`, `outputIds`가 들어간다(`withTargetIds`). 모형은 훈련 워크시트가 프로젝트에 남아 있는지, 결과 카드는 `meta.sheetId`가 살아 있는지 확인한다. 패널 상단에는 `tut-session-id`(세션·실습 프로젝트)를 표시한다.

### P2 — UX와 상태 관리

**T-10 · 종료 구분**
- `completionKind()`가 `verified`(전 단계 기계 검증) / `manual`(직접 확인 단계 포함) / `skipped`(건너뛰기 포함) / `unfinished`를 구분한다. 완료 화면에 `tut-completion`(`data-completion`) 줄을, 라이브러리 카드에 "건너뛰기 포함" 배지를 표시한다. 전 단계를 건너뛴 레슨은 "수료"로 표시되지 않는다.

**T-11 · 영구 저장 실패 시 메모리 진행률 유지**
- `persistProgress`가 먼저 `setProgressMap`으로 창의 상태를 갱신한 뒤 저장을 시도한다. 저장소 클래스도 `save()` 시 메모리 사본을 먼저 갱신하고 `load/loadAll`이 메모리를 병합하므로, 저장이 거부되어도(차단·용량 초과) 진행률·현재 단계 표시가 유지된다.

**T-13 · 하단 Phase 하드코딩 제거**
- 상태바가 `statusBarLabel()`(=`APP_PHASE`)을 출력한다. `HD2LAB · SIGRÚN · PHASE 1` → `PHASE 3`.

## 3. 수정 전 실패 증빙과 수정 후 대조

증빙 파일: `work/pk18-3e-logs/tutorial-red.txt` → `work/pk18-3e-logs/tutorial-green.txt`

### 3.1 단위 단언 (기준선 체크아웃 `66efb29`)

```
tests/tutorial-corrective-qa.test.ts
기준선(66efb29) : Test Files 1 failed · Tests 19 failed | 5 passed (24)   ← 모듈 로드 실패 0건
교정 트리      : Test Files 1 passed · Tests 24 passed (24)
```

| # | 기준선 실패 단언 | 기준선 메시지 | 교정 후 |
| --- | --- | --- | --- |
| T-03 | 이름만 같은 가짜 샘플 거부 | `expected 'pass' to be 'fail'` | `fail / sample-values` |
| T-03 | 행을 잘라낸 샘플 거부 | `expected 'pass' to be 'fail'` | `fail / sample-rows` |
| T-04 | 다른 열로 실행한 결과 거부 | `expected 'pass' to be 'fail'` | `fail / analysis-columns` |
| T-04 | 다른 파라미터로 실행한 결과 거부 | `expected 'pass' to be 'fail'` | `fail / analysis-params` |
| T-04 | 표·차트가 없는 카드 거부 | `expected 'pass' to be 'fail'` | `fail / analysis-no-result` |
| T-05 | 같은 반응 중복 모형 4개로 완료 불가 | `expected 'pass' not to be 'pass'` | `pending / model-count` |
| T-06 | 요인 누락 Profiler 검증 실패 | `expected [ 'profiler-arguments-missing', … ] to include 'profiler-point'` (기준선은 일부 요인만 보고 `profiler-point`로 흘림) | `fail / profiler-arguments-missing` |
| T-06 | 저장하지 않은 조건 실패 | `expected 'pass' to be 'fail'` | `fail / profiler-not-saved` |
| T-07 | 두 실습 보관·재개 | `expected 'practice-b' to be 'practice-a'` | 두 슬롯 모두 로드 |
| T-07 | 버린 실습만 제거 | `store.removePracticeSlot is not a function` (슬롯 API 부재 — 단언 실패로 기록됨) | 남은 슬롯 유지 |
| T-08 | 슬롯이 근거·진행률을 함께 보관 | `Cannot read properties of undefined (reading 'map')` (슬롯에 `events` 없음) | events·progress 반환 |
| T-09 | 개수가 같아도 차이가 있으면 실패 | `expected 'pass' to be 'fail'` | `fail / project-roundtrip` + `mismatches` |
| T-10 | 건너뛰기 종료 ≠ 수료 | `expected undefined to be 'skipped'` | `summary.completion = 'skipped'` |
| T-10 | 기계 검증 수료/직접 확인 구분 | `expected undefined to be 'verified'` | `verified` / `manual` |
| T-11 | 차단된 저장소에서도 진행률 유지 | `expected undefined to be 'practice-qa'` | 메모리 사본 유지 |
| T-11 | 진행 중에도 갱신 유지 | `expected undefined to be truthy` | 유지 |
| T-12 | 판정에 Project/Session/Worksheet/Model/Output ID | `expected undefined to be 'practice-qa'` | evidence에 ID 포함 |
| T-12 | 모형 판정이 센 모형 ID | `Cannot read properties of undefined (reading 'sort')` | `modelIds` 반환 |
| T-13 | 셸에 `PHASE 1` 하드코딩 없음 | `expected true to be false` | `statusBarLabel()` 사용 |

통과한 5건은 지켜야 할 짝이다(진짜 샘플 수용, 반응별 모형 완비 시 수료, 차이 없는 roundtrip, 레지스트리 audit 0건, …). 교정 후에도 그대로 통과한다.

### 3.2 실행 중인 앱 (브라우저 probe, 기준선 빌드 vs 교정 빌드)

```
DIST=<기준선 dist> node tools/probe_tutorial_guard.cjs   → 4 / 8 통과
node tools/probe_tutorial_guard.cjs                      → 9 / 9 통과
```

| 검사 | 기준선 | 교정 |
| --- | --- | --- |
| T-01 저장소가 거부하면 실습 중단 + 백업 안내 | **FAIL** `backup=0 dock=1 practiceTab=true` (원본 사본 없이 실습 시작) | PASS `backup=1 dock=0` |
| T-01 백업을 내려받은 뒤에만 실습 시작 | **FAIL** `no backup button` | PASS |
| T-01 실습 종료 후 원본 워크시트 복원 | — | PASS |
| T-01 자동 저장 debounce 중 편집 보존 | PASS | PASS (회귀) |
| T-01 실습 중 새로고침 후 원본 유지 | PASS | PASS (회귀) |
| T-02 실습 안에서 바꾼 테마가 밖으로 나오지 않음 | **FAIL** `before=light inside=dark after=dark` | PASS `after=light` |
| T-12 독에 세션·실습 프로젝트 표시 | **FAIL** `0 strip(s)` | PASS |

## 4. 설계 메모

- **저장 키**: `sigrun.tutorials.progress.v1`(진행률, 기존) · `sigrun.tutorials.practice.v2`(슬롯, 신규) · `sigrun.tutorials.practice.v1`(읽기 전용 마이그레이션) · `sigrun.tutorials.original.v1`(원본 보관). 자동 저장(IndexedDB/localStorage `sigrun.autosave.v1`)은 별도 계층으로 남는다.
- **실습 시작 순서**: 원본 확보 → read-back 확인 → (실패 시 중단·백업 dialog) → 자동 저장 flush → 스냅샷 → 워크스페이스 교체 → 진행률 기록. 교체 전에 실패하면 아무 상태도 바뀌지 않는다.
- **원본 보관 정리**: 실습을 정상 종료(보관/버리기)하면 해당 `originalProjectId` 슬롯을 지운다. 복원에 실패하면 지우지 않고 `tut.originalMissing`으로 알린다.
- **신규 기능 없음**: 12개 레슨·7부 구조·액션 allow-list·진행 저장 구조는 그대로다. 바뀐 것은 "무엇을 근거로 완료라 하는가"와 "원본을 어떻게 지키는가"다.
- **기존 테스트 3건의 기대값 조정**(결함을 고정하고 있던 단언): `analysis-output`이 표·차트 없는 카드로 통과하던 fixture → 표를 담은 카드로 교체, `model-stored` 낮은 R²는 즉시 `fail`, 저장소 차단 시 `loadAll() === {}` → 메모리 사본 유지. 셋 다 이번 교정이 요구한 동작이다(§3 표의 T-04·T-05·T-11 행과 같은 결함).

## 5. 남은 확인 사항

| 항목 | 상태 |
| --- | --- |
| GitHub Actions Portable CI 실행 | 이 작업에서는 원격 실행 결과를 확인하지 않았다(워크플로 권한·실행 여부는 머지 후 CI 상태로 확인 필요). 로컬 `build:portable`·`file://` E2E는 63/63·8/8 통과 |
| 브라우저 저장소가 **아예 없는** file:// 환경 | probe는 `sigrun.tutorials*` 쓰기만 거부하는 상태를 측정했다. 완전 차단 시에는 `browserProgressStorage()`가 `null`이 되어 같은 백업 dialog 경로로 들어간다 |
| 다중 탭 | 두 탭이 같은 `original.v1` 슬롯을 쓰면 마지막 쓰기가 남는다. 원본은 read-back으로만 판정하므로 데이터 손실은 아니지만, 탭 간 조정은 이번 범위에 넣지 않았다 |

## 6. 머지 · 배포 · 라이브 확인

| 항목 | 결과 |
| --- | --- |
| PR | [#34](https://github.com/HyangDan2/PKPilot0018/pull/34) → `main` 머지 `7c5234d` (2026-11-25 00:47 KST) |
| PR CI | Statistics QA `45429223414` **success** (58s) |
| main CI | Statistics QA `45429550637` **success** · Deploy to GitHub Pages `45429550213` **success** |
| 원격 브랜치 | `fix/tutorial-corrective-qa` 삭제 (`git push origin --delete`; REST 삭제는 403) |
| 라이브 번들 | `https://hyangdan2.github.io/PKPilot0018/assets/index-6yt7r07p.js` |
| 라이브 상태바 | `HD2LAB · SIGRÚN · PHASE 3` (T-13) |
| 라이브 probe | `LIVE_URL=https://hyangdan2.github.io/PKPilot0018/ node tools/probe_tutorial_guard.cjs` → **9 / 9 PASS** |
| Portable ZIP | `/workspace/work/pkpilot0018/sigrun-portable.zip` (464 816 B, 스탬프 2026-11-24T15:37Z) |

라이브 스크린샷: `work/artifacts/live-tutorial-qa.png`, probe 화면: `work/artifacts/tutorial-guard-live/`.
