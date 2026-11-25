# Sigrún Phase 3F — 튜토리얼 복구 및 실습 QA

> **저장소**: `HyangDan2/PKPilot0018` · 브랜치 `feature/phase3f-model-control`
> **기준선**: `ac7ca94` (Stage 3F-C) · **일자**: 2026-11-25
> **범위**: WO-3F-01 · WO-3F-09 · 13개 튜토리얼 · 원본 프로젝트 복구 · Portable HTML

## 1. 결과 요약

| 항목 | 결과 |
| --- | --- |
| `npm run qa:tutorials` | **29 / 29 PASS** |
| 실행된 튜토리얼 | **13 / 13 완료** |
| `ONLY=tutorial-doe-reduction-001 npm run qa:tutorials` | **13 / 13 PASS** |
| `npm run qa:tutorials:portable` | **8 / 8 PASS** |
| `npm run qa:guard` | **10 / 10 PASS** |
| `node tools/e2e_phase3f.cjs` | **11 / 11 PASS** |
| `node tools/run_e2e_suite.cjs` | **13 / 13 suites clean · 560 PASS · 0 FAIL** |
| 브라우저 콘솔 오류 | **0** |
| Portable HTML 외부 요청 | **0** |

`qa:tutorials`는 단순히 카드가 열리는지만 확인하지 않는다. 각 강의를 격리 실습 프로젝트에서 실제 데이터 적재·분석·도움말·저장·완료 요약까지 진행하고, 원본 프로젝트 복원과 별도 세션의 보관 실습도 검증한다.

## 2. 실행 방법

```bash
npm run build
npm run build:portable

SHOTS=/Users/jaehyukshim/QoderWS/phase3f-artifacts-20261125/tutorial-shots npm run qa:tutorials
ONLY=tutorial-doe-reduction-001 npm run qa:tutorials
SHOTS=/Users/jaehyukshim/QoderWS/phase3f-artifacts-20261125/portable-tutorial-shots npm run qa:tutorials:portable
SHOTS=/Users/jaehyukshim/QoderWS/phase3f-artifacts-20261125/tutorial-guard npm run qa:guard
node tools/e2e_phase3f.cjs
```

브라우저는 `tools/e2e_browser.cjs`가 해결한다. 로컬 서버는 각 검사가 자체적으로 열며 외부 네트워크를 사용하지 않는다.

## 3. 복구 상태와 데이터 경계

세션 상태는 다음 전이만 허용한다.

```text
IDLE → STARTING → ACTIVE ⇄ PAUSED
                 ↘ EXITING → IDLE
STARTING · 저장 실패 → RECOVERY_REQUIRED → IDLE
```

| 경계 | 보장 |
| --- | --- |
| 실습 시작 | 원본 프로젝트를 저장하고 읽어 온 JSON과 지문이 일치해야 시작 |
| 지연 자동저장 | 실습 전에 미완료 자동저장을 완료해 원본 백업과 저장소 상태를 맞춤 |
| 저장소 거부 | 백업 파일을 내려받기 전까지 실습 프로젝트를 열지 않음 |
| STARTING 중 강제 종료 | 세대 토큰이 바뀌면 뒤늦은 비동기 결과가 새 세션에 적용되지 않음 |
| 실습 종료 | 원본 워크시트·출력·모형·그림·설정을 복원하고 저장 후 다시 읽어 비교 |
| 새로고침 | 진행 기록은 남지만 실습 워크스페이스는 복원하지 않고 원본 워크시트를 유지 |
| 보관 실습 | 강의·세션·프로젝트 ID가 함께 보관되어 서로 덮어쓰지 않음 |

브라우저 가드는 `tools/probe_tutorial_guard.cjs`에서 저장소 쓰기를 거부하는 환경, 직전 셀 편집, 모형과 그림이 있는 프로젝트, 테마 변경, 실습 중 새로고침을 실제로 재현한다.

## 4. 10단계 모형 통제 실습

`tutorial-doe-reduction-001`은 네 합성 데이터셋을 순서대로 사용한다.

| 단계 | 독자가 하는 행동 | 자동 검증 |
| --- | --- | --- |
| 1 | 2³ Replicated 16행 적재 | 열 이름뿐 아니라 모든 행·값 비교 |
| 2 | Error Pooling 도움말 열기 | 지정 문서 열림 이벤트 |
| 3 | 3차 완전 모형 적합 | DOE 출력과 모형 존재 |
| 4 | B×C를 풀링하고 재적합 | 두 출력, 부분 F **1.85**, p **0.207** |
| 5 | 축소 모형 저장 후 Model Manager 열기 | Y 저장 모형, R² 0.9 이상, B×C 제외 수식 |
| 6 | 2³ Unreplicated 8행 적재 | 같은 열을 가진 이전 워크시트가 아닌 새 샘플 ID 검증 |
| 7 | 포화 DOE와 Lenth 읽기 | DFE 0, PSE **2.1**, ME **9.036**, A만 활성, 막대그림 |
| 8 | 불균형 Machine × Shift 24행 적재 | 셀 구조와 원본 값 일치 |
| 9 | GLM Type I·III 비교 | Machine Seq SS **82.083**, Adj SS **68.511** |
| 10 | Screening 샘플에서 계층성·교락 판단 | 독자가 후속 설계를 서술하고 직접 완료 |

4단계의 E2E는 모형 대화상자에서 실제로 B×C를 풀링한다. 단순히 두 번 실행해 출력 개수를 늘리는 검사가 아니며, 부분 F와 p값을 고정 값으로 확인한다.

## 5. 3F-D에서 발견하여 수정한 결함

### 5.1 축소 모형 저장 단계가 저장하지 않던 문제

기존 `store-reduced` 단계는 `validate-result`를 호출해 모형을 저장하지 않았다. `open-model-manager`로 바꾸고 기존 출력 카드의 저장 경로를 사용하게 했다. 이제 Model Manager가 실제 저장 모형을 검증한다.

### 5.2 같은 열을 가진 샘플을 이전 워크시트로 판정하던 문제

풀링 샘플과 반복 없는 샘플은 `StdOrder`, `A`, `B`, `C`, `Y` 열을 공유한다. 샘플 검증기가 첫 번째 일치 워크시트를 택해 16행 샘플을 8행 단계에 비교했다.

이제 최신 `sample-loaded` 이벤트의 `sheetId`를 우선한다. 일치하는 워크시트가 없을 때만 열 구조로 후보를 찾고, 선택된 워크시트의 행 수와 모든 셀 값은 계속 엄격하게 비교한다. 회귀 테스트는 `tests/model-control-samples.test.ts`에 추가했다.

### 5.3 이전 강의의 모형 차수가 프리셋을 덮어쓰던 문제

앞선 `tutorial-doe-001`이 2차 모형 설정을 저장하면, 다음 강의의 3차 프리셋에도 같은 항 선택이 적용됐다. 실제 실패 출력은 부분 F **2.112**, SSE **92.112**로 의도한 **1.85 / 0.207**과 달랐다.

`AnalysisDialog.normalizeValues`는 명시적 프리셋의 `order`를 저장 설정보다 우선한다. 저장 차수와 현재 차수가 다르면 항·풀링·계층성 설정을 가져오지 않는다. 프리셋이 차수를 주지 않을 때만 저장 차수를 복원한다. 두 경우 모두 `tests/model-hierarchy.test.ts`로 고정했다.

### 5.4 고정 대기 시간에 의존하던 E2E

풀링 단계는 900ms 후 화면 텍스트를 읽어 부하에 따라 결과를 놓쳤다. 부분 F 표가 있는 출력 카드가 실제로 표시될 때까지 기다리도록 바꿨다. 수치 조건은 완화하지 않았다.

## 6. Portable HTML 검증

`dist-portable/sigrun-portable.html`을 `file://`로 열어 다음을 확인했다.

- 13개 강의와 26개 도움말 문서가 번들에 포함됨
- 시작 강의가 오프라인에서 완료됨
- Sample·Help·Tutorial 레지스트리가 네트워크 없이 동작함
- 외부 요청 0건, 콘솔 오류 0건
- 진행 저장은 실제 저장되거나 차단 사유를 표시함

Portable HTML은 새 서버 API나 CDN을 추가하지 않는다.

## 7. WO-3F-01 강제 종료 검증 (3F-A)

강제 종료는 “수업을 끝낼 수 있다”만으로 충분하지 않다. 독자가 자신의 프로젝트를 잃지 않고, 그 종료가 수료로 남지 않으며, 종료 이후에 도착한 비동기 결과가 화면을 되돌리지 않아야 한다. 이 기준으로 화면을 다시 검증한 결과는 다음과 같다(2026-11-25, `feature/phase3f-model-control`).

| 검사 | 결과 |
| --- | --- |
| `npx vitest run tests/tutorial-force-exit.test.ts` | **21 / 21 PASS** |
| `npm run qa:force-exit` (`tools/e2e_force_exit.cjs`) | **29 / 29 PASS** |
| `npm run qa:tutorials` (회귀) | **29 / 29 PASS** |
| `npm run qa:guard` (회귀) | **10 / 10 PASS** |
| `npm run qa:tutorials:portable` (회귀) | **8 / 8 PASS** |

브라우저 검사가 실제로 확인하는 것:

| 상황 | 확인한 결과 |
| --- | --- |
| 열린 패널에서 강제 종료 | 세션 종료 · 원본 탭과 출력 복원 · 라이브러리에 진행 기록 없음 |
| 최소화 막대에서 강제 종료 | 위와 동일(최소화 상태에서도 버튼 존재) |
| 패널을 닫은 뒤 라이브러리에서 강제 종료 | 세션 종료 · 라이브러리 활성 세션 표시 사라짐 · 원본 복원 |
| 종료 후 같은 강의 재시작 | 새 세션 ID · 첫 단계부터 · 이전 세션 기록 없음 |
| 저장 거부 상태에서 보관 시도 → 저장 실패 화면 → 강제 종료 | 실패가 숨지 않고 보고됨 · 강제 종료 후 세션 없음 · 원본 복원 · 수료 아님 |
| 새로고침 | 원본 프로젝트 유지 · 세션이 되살아나지 않음 |
| 시작이 오토세이브를 기다리는 동안 강제 종료 | 시작 대화상자에 강제 종료 버튼 · 종료 후 수업이 뒤늦게 열리지 않음 · 원본 무변경 · 기록 없음 |
| 시작 중 취소 | 시작 중단 · 수업이 뒤늦게 열리지 않음 · 원본 무변경 |

이번 검증에서 찾아 고친 두 결함은 `docs/PHASE3F_IMPLEMENTATION_REPORT.md` 6절에 적었다. 시작 중 탈출구가 없던 문제(상태 기계의 `ABORT_START` 미연결)와, 보관 실패 화면이 종료 대화상자 뒤에 열리던 문제다.

## 8. 한계와 주장하지 않는 것

- GitHub Pages 정식 배포와 `main` 병합은 이 QA의 범위가 아니며 별도 승인이 필요하다.
- Minitab 실행 결과와의 수치 동등성은 검증하지 않았다. 독립 통계 기준은 `docs/PHASE3F_STATISTICAL_QA.md`에 기록했다.
- 브라우저 저장소가 차단된 Portable 환경에서는 진행 저장이 제한될 수 있다. 프로젝트 파일 내보내기는 별도 수단으로 유지된다.
- 샘플은 모두 합성 데이터이며 실제 제품 측정값이나 규격이 아니다.
