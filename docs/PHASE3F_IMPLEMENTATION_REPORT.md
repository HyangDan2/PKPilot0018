# Sigrún Phase 3F — 구현 보고서

> **저장소**: `HyangDan2/PKPilot0018`
> **브랜치**: `feature/phase3f-model-control` · **기준선**: `main`
> **대상**: Tutorial Recovery & Statistical Model Control
> **배포 형태**: GitHub Pages · Portable HTML
> **일자**: 2026-11-25

## 1. 완료 범위

Phase 3F는 분석 실행 후 남길 모형과 오차를 사용자가 통제하고, 그 결정을 비교표·도움말·튜토리얼에서 추적 가능하게 만든다.

| Work Order | 구현 | 독립 커밋 / 변경 |
| --- | --- | --- |
| WO-3F-01 | 튜토리얼 세션 상태 기계, 원본 프로젝트 복구, 강제 종료 | `081304d` |
| WO-3F-02 | 모형 항 대화상자와 분석별 설정 저장 | `d5db9c5` |
| WO-3F-03 | 선택 항 제거, 축소 모형 재적합, 풀링 가산성 점검 | `d5db9c5` |
| WO-3F-04 | strict·auto·unrestricted 계층성 | `d5db9c5` |
| WO-3F-05 | 원본/축소 10개 지표 비교와 부분 F | `ac7ca94` |
| WO-3F-06 | 포화 설계의 DFE 0 보고와 Lenth 선별 | `d5db9c5` |
| WO-3F-07 | DOE 효과 막대그림·파레토 그림 | `ac7ca94` |
| WO-3F-08 | Model Manager와 저장 모형 v2 호환 | `ac7ca94` |
| WO-3F-09 | Phase 3F 샘플·도움말·10단계 강의·KO/EN | 3F-D 변경 집합 |
| WO-3F-10 | 독립 Python QA, 브라우저 회귀, 감사/백로그 갱신 | 3F-D 변경 집합 |

기존 분석과 테스트를 삭제하거나 통과 조건을 완화하지 않았다. `main` 자동 병합과 정식 배포는 수행하지 않았다.

## 2. 통계 엔진 구조

### 2.1 모형 항과 계층성

`src/lib/modelTerms.ts`가 항 카탈로그·정규 ID·표시 이름·하위 항 폐쇄를 담당한다. DOE와 GLM이 같은 규칙을 사용하며 분석별로 중복 구현하지 않는다.

- `strict`: 하위 항이 빠진 상위 항은 거부
- `auto`: 빠진 하위 항을 추가한 폐쇄를 저장
- `unrestricted`: 선택을 유지하고 위반을 보고

계층성 자동 보정은 교락을 해결한다고 주장하지 않는다. 별칭 항은 df 0으로 보고하고 계수를 추정하지 않는다.

### 2.2 오차 풀링

`src/lib/errorPooling.ts`의 `fitWithPooling`은 원본 적합을 `full`에 보존한 뒤 선택 항을 제거한 설계행렬을 새로 만들어 `fit`을 계산한다. 원본 SSE에 풀링 SS를 더해 결과를 조립하지 않는다.

`PoolingCheck`는 다음을 각각 보고한다.

- 원본과 축소의 모형/오차 DF와 SS
- 기대 DFE·SSE와 실제 DFE·SSE
- DF/SS 가산성 성립 여부
- 같은 행 집합 사용 여부

비직교 설계에서 가산성이 성립하지 않으면 실패를 숨기지 않는다.

### 2.3 모형 비교

`src/lib/modelComparison.ts`의 `compareFits`는 R², R²adj, R²pred, S, MSE, DFE, SSE, PRESS, 모형 DF, 오차 DF를 함께 비교한다. 부분 F는 다음 조건을 모두 만족할 때만 계산한다.

1. 축소 모형이 원본에 내포됨
2. 같은 행 집합을 사용함
3. 자유도가 실제로 감소함
4. 축소 모형에 오차 DF와 양의 MSE가 있음

실패 사유는 `not-nested`, `row-set-changed`, `no-reduction`, `no-error-df`로 구분한다. 정의되지 않는 R²pred 등은 0으로 대체하지 않고 사유를 표시한다.

### 2.4 포화 설계와 Lenth

`src/lib/doe.ts`는 DFE=0에서 t/F·잔차 기반 S를 만들지 않는다. Lenth 정보는 별도 선별 지표로 계산한다.

```text
s0        = 1.5 × median(|effect|)
inactive  = 0 < |effect| < 2.5 × s0
PSE       = 1.5 × median(|inactive effect|)
pseudo df = max(1, floor(m / 3))
ME        = t(0.975, pseudo df) × PSE
SME       = ME / 2
```

활성 효과는 후속 실험을 고르는 선별 규칙이며 유의성 입증이나 잔차 표준오차가 아니다.

## 3. UI와 저장 구조

| 영역 | 구현 |
| --- | --- |
| Analysis Dialog | `ModelTermsDialog`로 주효과·교호작용·2차항·풀링·계층성 선택 |
| 출력 카드 | 풀링 점검, 원본/축소 비교, Lenth, 효과 그림, 저장 모형 액션 |
| Model Manager | 응답별 저장 모형의 수식·항·풀링 이력·계층성·R²·오차 DF |
| 설정 저장 | `sigrun.modelSettings.v1`, 분석 ID별 선택 복원 |
| 모형 저장 | `StoredModel.schemaVersion` 2, 이전 v1 레코드 읽기 유지 |
| 프로젝트 파일 | 기존 `.sigrun.json`에 모형과 설정을 포함해 내보내기·복원 |
| 언어 | 신규 UI·도움말·강의 문구 KO/EN |
| 배포 | 번들 내 데이터·문서·샘플, 새 서버 API/CDN 없음 |

명시적 분석 프리셋의 모형 차수는 저장 설정보다 우선한다. 차수가 다르면 이전 강의의 항·풀링·계층성이 새 프리셋을 덮어쓰지 않는다. 프리셋이 차수를 제공하지 않을 때만 저장 차수를 복원한다.

## 4. Phase 3F 샘플과 강의

| 샘플 | 행 수 | 목적 |
| --- | ---: | --- |
| 2³ Replicated | 16 | B×C 풀링, 원본/축소 비교, 부분 F |
| 2³ Unreplicated | 8 | 포화 적합, Lenth, A 활성 선별 |
| Unbalanced Machine × Shift | 24 | Type I·III 제곱합 차이 |
| 2^(4−1) Screening | 8 | strict/auto 계층성과 D=ABC 교락 |

모두 고정 시드의 합성 데이터다. `src/samples/datasets/modelControl.ts`가 생성하고 Sample Library에 등록한다.

`tutorial-doe-reduction-001`은 10단계로 데이터 적재 → 완전 모형 → B×C 풀링 → 축소 모형 저장 → 포화/Lenth → 불균형 GLM → Screening 판단을 진행한다. 4단계는 부분 F **1.85 / p 0.207**을, 7단계는 PSE **2.1 / ME 9.036**을 실제 화면에서 확인한다.

샘플 검증은 열 이름만 비교하지 않고 행 수와 모든 셀 값을 비교한다. 같은 열을 가진 샘플을 연속해 적재할 때는 최신 `sample-loaded` 이벤트의 `sheetId`를 우선해 이전 워크시트를 잘못 고르지 않는다.

## 5. 독립 통계 QA

`qa/cases/QA-3F-model-control.json`의 25개 신규 케이스를 기존 225개에 추가했다. 배포 TypeScript 엔진은 esbuild로 번들링하고, Python 참조는 statsmodels·NumPy·SciPy·patsy로 독립 계산한다.

| 항목 | 결과 |
| --- | --- |
| 전체 `npm run qa:stats` | **250 / 250 PASS** |
| 신규 QA-3F | **25 / 25 PASS** |
| FAIL / REVIEW / UNVERIFIED / ERROR | **0 / 0 / 0 / 0** |
| QA-3F 최대 절대 오차 | **1.99e-11** |
| 참조 환경 | Python 3.12.16 · NumPy 2.5.4 · SciPy 1.18.1 · statsmodels 0.15.0 · pandas 3.1.1 · patsy 1.0.3 |
| 어댑터 | Node 22.23.4 · 실제 `src/lib` 번들 |

재현 시 정확한 Python 환경을 사용해야 한다.

```bash
PATH=/tmp/pk18-qa312/bin:$PATH npm run qa:stats
```

황금 데이터 가드는 추적 중인 `qa/datasets/*.json`의 변경을 계속 거부한다. 생성 스크립트 편집 자체를 데이터 변경으로 오인하지 않도록 검사 범위를 JSON으로 좁혔다.

자세한 수학 계약·기준값·경고는 `docs/PHASE3F_STATISTICAL_QA.md`에 기록했다. **Minitab 실측 대조는 수행하지 않았다.**

## 6. 튜토리얼 복구와 브라우저 포팅

세션은 `IDLE → STARTING → ACTIVE ⇄ PAUSED`, `EXITING → IDLE`, 실패 시 `RECOVERY_REQUIRED → IDLE`로 동작한다. 세대 토큰과 원본 프로젝트 저장·읽어 오기·지문 비교로 강제 종료 및 지연 저장 경쟁을 차단한다.

3F-D에서 다음 회귀를 수정했다.

- 저장 단계가 결과만 확인하던 동작을 실제 Model Manager 저장으로 변경
- 같은 열을 가진 샘플을 최신 워크시트 ID로 검증
- 이전 강의의 모형 차수가 새 프리셋을 덮어쓰지 않도록 차수 일치 검사
- 고정 900ms 대기를 부분 F 출력 카드의 명시적 대기로 교체
- macOS 기본 붙여넣기를 `ControlOrMeta+V`로 처리
- macOS 다중 선택의 Control-click이 문맥 메뉴를 여는 문제를 Meta+click으로 회피

Portable HTML은 `file://`에서 13개 강의·26개 도움말 문서·분석 실행을 외부 요청 없이 검증한다. 저장소가 차단되면 진행 저장 실패를 숨기지 않는다. 상세 결과는 `docs/PHASE3F_TUTORIAL_RECOVERY_QA.md`에 기록했다.

## 7. 호환성과 제약

- 기존 `.sigrun.json`은 새 선택 필드가 없어도 계속 열린다.
- 모형 저장 v2는 이전 v1 레코드 읽기 경로를 유지한다.
- GitHub Pages와 Portable HTML 모두 유지하며 새 백엔드 의존성을 추가하지 않았다.
- 부분요인 설계의 별칭 항은 df 0으로 보고하고 추정하지 않는다.
- 비직교 풀링의 SS 가산성은 실패할 수 있으며 실패 플래그를 유지한다.
- Lenth는 척도가 퇴화하거나 효과가 너무 적으면 계산하지 않는다.
- 샘플·QA 데이터는 합성 데이터이며 실제 제품 규격이 아니다.
- `main` 병합, GitHub Pages 정식 배포, `PKPilot0018E0001` 생성은 별도 승인 범위다.

## 8. 검증 증거

### 8.1 현재 확인 결과

| 검사 | 결과 |
| --- | --- |
| `npm run typecheck` | PASS · 0 errors |
| `npm test` | **1,315 / 1,315 PASS** |
| `npm run qa:stats` | **250 / 250 PASS** |
| `npm run build` | PASS · 외부 CDN/API 없음 |
| `npm run build:portable` | PASS |
| `npm run qa:tutorials` | **29 / 29 PASS** · 13개 강의 완료 |
| 10단계 강의 단독 실행 | **13 / 13 PASS** |
| `npm run qa:tutorials:portable` | **8 / 8 PASS** |
| `npm run qa:guard` | **10 / 10 PASS** |
| `npm run qa:network` | **13 / 13 PASS** · web·portable·enterprise 외부 요청 0 |
| `node tools/e2e_phase3f.cjs` | **11 / 11 PASS** |
| `node tools/run_e2e_suite.cjs` | **13 / 13 suites clean · 560 PASS · 0 FAIL** |
| `node tools/verify_audit.mjs` | PASS · 0 errors |

### 8.2 최종 산출물

- 호스팅 빌드: `dist/assets/index-D2BYKQrT.js`, `dist/assets/index-Mp7rP2EX.css`
- Portable HTML: SHA-256 `7bb258de61ed2461…`, ZIP SHA-256 `7e7d3cdf543d4f2f…`, 빌드 시각 `2026-11-25T02:50:38Z`
- `qa/reports/latest.json`, `qa/reports/latest.html` — 통계 QA 상세
- `docs/audit/` — 기능 매트릭스·QA 범위·Phase 4 백로그·대시보드
- `/Users/jaehyukshim/QoderWS/phase3f-artifacts-20261125/` — 브라우저 스크린샷·스위트 로그·요약 JSON
- `dist/` — GitHub Pages용 빌드
- `dist-portable/sigrun-portable.html` — 단일 파일 Portable HTML

`qa/reference/__pycache__`의 생성 바이너리는 검증 후 기준선으로 복원한다. 루트의 스크린샷·로그·임시 보고서는 커밋하지 않고 외부 산출물 디렉터리로 옮긴다.

## 9. 알려진 개발 의존성 경고

`npm ci`는 개발 의존성의 기존 보안 권고 4건(중간 1건, 위험 3건)을 보고한다. 관련 패키지는 `happy-dom`, `vitest`, `tinypool`, `@vitest/mocker`이며 Phase 3F에서 의존성을 추가하거나 downgrade하지 않았다. 배포 번들은 새 외부 라이브러리를 요구하지 않는다.
