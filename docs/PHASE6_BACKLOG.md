# Phase 6 백로그 — Sigrún (Minitab 기능 격차 감사의 후속 개발 계획)

- 기준: `43b0b071cf010352d8add7600dfa29d158a2b3e3` · 감사일 2026-11-24 · Minitab 22.6.x
- 대상 기능: `docs/audit/minitab-gap-matrix.json` 에서 `Target Phase = Phase 6` 인 Minitab 기능
- 작업 지시 6건 · 기능 25건

## 요약

| WO | 항목 | Feature IDs | 복잡도 | 의존성 |
| --- | --- | --- | --- | --- |
| WO-P6-01 | 스크립트·자동화: 명령줄·매크로 | M-D8-033, M-D8-034, M-D8-035, M-D1-036 | L | 전체 분석 레지스트리 |
| WO-P6-02 | 시료 채취·보증·시험 계획 | M-D4-058, M-D4-059, M-D4-060, M-D6-006, M-D6-007, M-D6-008, M-D6-014, M-D6-015 | L | WO-P5-05 |
| WO-P6-03 | 예측 분석 모듈(CART/TreeNet/RF/MARS) | M-D3-025, M-D3-026, M-D3-027, M-D3-028, M-D3-029 | L | 없음 |
| WO-P6-04 | Six Sigma 모듈 리포트 | M-D4-061, M-D4-062, M-D4-063 | M | 없음 |
| WO-P6-05 | 데스크톱 연동: ODBC·Minitab 파일·문서 앱 전송 | M-D1-028, M-D1-032, M-D1-031, M-D1-033 | S | 없음 |
| WO-P6-06 | Python/R 스크립트 실행 | M-D1-037 | L | 없음 |

## WO-P6-01 · 스크립트·자동화: 명령줄·매크로

- **Work Order ID**: WO-P6-01
- **Title**: 스크립트·자동화: 명령줄·매크로
- **Feature IDs**: M-D8-033, M-D8-034, M-D8-035, M-D1-036
- **Priority**: P3
- **Implementation Scope**: 세션 명령과 매크로를 브라우저에서 실행하는 얇은 명령 계층(선택 사항).
- **Mathematical Requirements**: 없음
- **Input/Output Contract**: 명령 문자열 → 분석 호출 → 출력 카드. 허용 목록 밖 명령은 거부.
- **Dependencies**: 전체 분석 레지스트리
- **Implementation Complexity**: L
- **Independent Reference**: Minitab Session Command Help
- **Acceptance Criteria**: 10개 명령 재현 테스트
- **Required Sample/Help/Tutorial**: help: 명령 문서
- **Regression Test Requirements**: 기존 UI 경로 불변

## WO-P6-02 · 시료 채취·보증·시험 계획

- **Work Order ID**: WO-P6-02
- **Title**: 시료 채취·보증·시험 계획
- **Feature IDs**: M-D4-058, M-D4-059, M-D4-060, M-D6-006, M-D6-007, M-D6-008, M-D6-014, M-D6-015
- **Priority**: P3
- **Implementation Scope**: 속성/계량 시료 채취 OC 곡선, 시험 계획 3종, 보증 데이터 전처리·예측.
- **Mathematical Requirements**: 이항·정규 OC, 입증 시험 표본 크기, 보증 노출 계산.
- **Input/Output Contract**: 입력: 로트·규격·신뢰도 목표. 출력: OC 곡선·계획표·예측 클레임.
- **Dependencies**: WO-P5-05
- **Implementation Complexity**: L
- **Independent Reference**: Minitab Acceptance Sampling 문서
- **Acceptance Criteria**: OC 곡선 3케이스 재현
- **Required Sample/Help/Tutorial**: help: 2문서
- **Regression Test Requirements**: 품질 메뉴 회귀

## WO-P6-03 · 예측 분석 모듈(CART/TreeNet/RF/MARS)

- **Work Order ID**: WO-P6-03
- **Title**: 예측 분석 모듈(CART/TreeNet/RF/MARS)
- **Feature IDs**: M-D3-025, M-D3-026, M-D3-027, M-D3-028, M-D3-029
- **Priority**: P3
- **Implementation Scope**: 별도 유료 모듈에 해당하는 트리 기반 모형은 브라우저 제품 범위 밖으로 두고, 필요 시 단일 결정트리부터 검토.
- **Mathematical Requirements**: CART 분할 기준(Gini/분산 감소), 부스팅·배깅은 후속.
- **Input/Output Contract**: -
- **Dependencies**: 없음
- **Implementation Complexity**: L
- **Independent Reference**: 공개 문헌(ESL) — Minitab 모듈 내부와 동등 주장 없음
- **Acceptance Criteria**: 도입 결정 시 별도 WO
- **Required Sample/Help/Tutorial**: -
- **Regression Test Requirements**: -

## WO-P6-04 · Six Sigma 모듈 리포트

- **Work Order ID**: WO-P6-04
- **Title**: Six Sigma 모듈 리포트
- **Feature IDs**: M-D4-061, M-D4-062, M-D4-063
- **Priority**: P3
- **Implementation Scope**: KPI 템플릿 기반 공정·제품 보고서와 Gap Pool. Minitab 모듈 라이선스 기능이라 우선순위 낮음.
- **Mathematical Requirements**: Rolled Throughput Yield, Gap 분해
- **Input/Output Contract**: 입력: KPI 열. 출력: 보고서 카드
- **Dependencies**: 없음
- **Implementation Complexity**: M
- **Independent Reference**: Minitab Six Sigma 모듈 문서
- **Acceptance Criteria**: 보고서 1종 재현
- **Required Sample/Help/Tutorial**: sample: 신규
- **Regression Test Requirements**: -

## WO-P6-05 · 데스크톱 연동: ODBC·Minitab 파일·문서 앱 전송

- **Work Order ID**: WO-P6-05
- **Title**: 데스크톱 연동: ODBC·Minitab 파일·문서 앱 전송
- **Feature IDs**: M-D1-028, M-D1-032, M-D1-031, M-D1-033
- **Priority**: P3
- **Implementation Scope**: 브라우저에서 불가능한 ODBC·.mpx·Word/PPT 전송은 명시적 범위 밖으로 두고, CSV/XLSX/PNG 경로를 안내.
- **Mathematical Requirements**: 없음
- **Input/Output Contract**: -
- **Dependencies**: 없음
- **Implementation Complexity**: S
- **Independent Reference**: Minitab 파일 형식 문서
- **Acceptance Criteria**: 문서화만
- **Required Sample/Help/Tutorial**: help: 제한 문서
- **Regression Test Requirements**: -

## WO-P6-06 · Python/R 스크립트 실행

- **Work Order ID**: WO-P6-06
- **Title**: Python/R 스크립트 실행
- **Feature IDs**: M-D1-037
- **Priority**: P3
- **Implementation Scope**: 브라우저 샌드박스에서의 스크립트 실행은 보안·번들 크기 비용이 커서 도입하지 않는다(대신 QA는 저장소 CI에서 수행).
- **Mathematical Requirements**: 없음
- **Input/Output Contract**: -
- **Dependencies**: 없음
- **Implementation Complexity**: L
- **Independent Reference**: Minitab Integration Guide
- **Acceptance Criteria**: 문서화만
- **Required Sample/Help/Tutorial**: -
- **Regression Test Requirements**: -

