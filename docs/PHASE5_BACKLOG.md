# Phase 5 백로그 — Sigrún (Minitab 기능 격차 감사의 후속 개발 계획)

- 기준: `43b0b071cf010352d8add7600dfa29d158a2b3e3` · 감사일 2026-11-24 · Minitab 22.6.x
- 대상 기능: `docs/audit/minitab-gap-matrix.json` 에서 `Target Phase = Phase 5` 인 Minitab 기능
- 작업 지시 11건 · 기능 179건

## 요약

| WO | 항목 | Feature IDs | 복잡도 | 의존성 |
| --- | --- | --- | --- | --- |
| WO-P5-01 | 다변량 분석: PCA·요인·군집·판별 | M-D7-001, M-D7-002, M-D7-003, M-D7-004, M-D7-005, M-D7-006, M-D7-007, M-D7-008, M-D7-009 | L | 행렬 유틸(신규 lib/matrix.ts) |
| WO-P5-02 | DOE 확장: 혼합물·다구찌·사용자 설계 | M-D5-014, M-D5-015, M-D5-016, M-D5-017, M-D5-018, M-D5-019, M-D5-020, M-D5-005, M-D5-006, M-D5-007 | L | lib/doe.ts 확장 |
| WO-P5-03 | 그래프 종류 확장 2: 열지도·버블·주변·원·점·영역·평행좌표·3D 산점·웨이퍼 | M-D8-002, M-D8-009, M-D8-012, M-D8-013, M-D8-018, M-D8-020, M-D8-022, M-D8-023, M-D8-024, M-D8-025 | M | chartConfig 확장 |
| WO-P5-04 | 회귀 확장: 로지스틱·비선형·PLS·안정성 | M-D3-015, M-D3-016, M-D3-017, M-D3-018, M-D3-019, M-D3-020, M-D3-021, M-D3-022, M-D3-023, M-D3-024 | L | WO-P4-07 모형 언어 |
| WO-P5-05 | 신뢰성 확장: 비모수·가속·성장·보증 제외 | M-D6-004, M-D6-005, M-D6-009, M-D6-010, M-D6-013 | L | WO-P4-09 |
| WO-P5-06 | 품질 도구: 런 차트·변동 차트·Multi-Vari·대칭·공차구간 | M-D4-033, M-D4-034, M-D4-035, M-D4-036, M-D4-037, M-D4-038, M-D4-039 | M | none |
| WO-P5-07 | 관리도 확장: CUSUM·EWMA·이동평균·Laney·다변량 | M-D4-016, M-D4-017, M-D4-018, M-D4-019, M-D4-020, M-D4-021, M-D4-022, M-D4-023, M-D4-024, M-D4-004, M-D4-005, M-D4-008, M-D4-009, M-D4-010, M-D4-011 | L | WO-P4-05 단계 옵션 |
| WO-P5-08 | 검정력·표본크기 확장과 동등성 검정 | M-D2-030, M-D2-031, M-D2-032, M-D2-033, M-D2-034, M-D2-035, M-D2-042, M-D2-043, M-D2-044, M-D2-045, M-D2-047, M-D2-048, M-D2-049, M-D2-050, M-D2-051, M-D2-052 | M | WO-P4-12 |
| WO-P5-09 | 차트 편집 심화: 데이터 레이블·개별 눈금·주석 | M-D8-027, M-D8-028, M-D8-029, M-D8-030, M-D8-031, M-D8-032 | M | S-MOD-04 |
| WO-P5-10 | ANOVA·모형 사용 확장: ANOM·균형·중첩·MANOVA·등분산·비교 | M-D3-002, M-D3-003, M-D3-005, M-D3-006, M-D3-007, M-D3-008, M-D3-010, M-D3-011, M-D3-030, M-D3-031 | L | WO-P4-07 |
| WO-P5-X11 | 잔여 항목 일괄 정리 — DOE & Optimization, Data & Workspace, Multivariate & Time Series, Quality Engineering, Reliability & Survival, Statistical Analysis, Statistical Modeling, Visualization & Automation | M-D1-001, M-D1-002, M-D1-006, M-D1-008, M-D1-010, M-D1-018, M-D1-019, M-D1-021, M-D1-022, M-D1-024, M-D1-025, M-D1-026, M-D1-027, M-D1-029, M-D1-030, M-D1-034, M-D1-035, M-D2-001, M-D2-012, M-D2-013, M-D2-018, M-D2-036, M-D2-037, M-D2-038, M-D2-039, M-D2-040, M-D2-041, M-D2-046, M-D3-001, M-D3-009, M-D3-012, M-D3-032, M-D4-025, M-D4-026, M-D4-027, M-D4-032, M-D4-040, M-D4-044, M-D4-045, M-D4-046, M-D4-047, M-D4-048, M-D4-049, M-D4-050, M-D4-051, M-D4-052, M-D4-057, M-D5-008, M-D5-011, M-D5-012, M-D5-013, M-D5-021, M-D5-022, M-D5-023, M-D5-024, M-D5-025, M-D5-027, M-D5-028, M-D6-012, M-D6-016, M-D7-010, M-D7-012, M-D7-013, M-D7-015, M-D7-016, M-D7-017, M-D7-018, M-D7-019, M-D7-020, M-D7-025, M-D8-001, M-D8-003, M-D8-004, M-D8-007, M-D8-011, M-D8-014, M-D8-016, M-D8-017, M-D8-019, M-D8-021, M-D8-036 | M | 해당 영역의 선행 WO |

## WO-P5-01 · 다변량 분석: PCA·요인·군집·판별

- **Work Order ID**: WO-P5-01
- **Title**: 다변량 분석: PCA·요인·군집·판별
- **Feature IDs**: M-D7-001, M-D7-002, M-D7-003, M-D7-004, M-D7-005, M-D7-006, M-D7-007, M-D7-008, M-D7-009
- **Priority**: P2
- **Implementation Scope**: 주성분·요인분석·계층 군집·K-means·판별·문항 분석·대응분석을 다변량 모듈로 추가.
- **Mathematical Requirements**: 공분산 고유분해, Varimax 회전, Ward/평균연결, 판별은 고유값 기반 선형판별, Cronbach α.
- **Input/Output Contract**: 입력: 수치 열 2개 이상(+그룹). 출력: 적재량·점수·군집 배정·분류표. 점수는 시트에 저장.
- **Dependencies**: 행렬 유틸(신규 lib/matrix.ts)
- **Implementation Complexity**: L
- **Independent Reference**: statsmodels PCA·sklearn 없이 공개 수식 구현, SciPy eig
- **Acceptance Criteria**: PCA·군집·판별 각 2케이스 QA 대조
- **Required Sample/Help/Tutorial**: sample: 신규 multivariate, help: 2문서
- **Regression Test Requirements**: 기존 분석 레지스트리 41→50 확장 시 input-audit 표 갱신

## WO-P5-02 · DOE 확장: 혼합물·다구찌·사용자 설계

- **Work Order ID**: WO-P5-02
- **Title**: DOE 확장: 혼합물·다구찌·사용자 설계
- **Feature IDs**: M-D5-014, M-D5-015, M-D5-016, M-D5-017, M-D5-018, M-D5-019, M-D5-020, M-D5-005, M-D5-006, M-D5-007
- **Priority**: P2
- **Implementation Scope**: 혼합물 설계·분석(Scheffé), 심플렉스·trace 그림, 다구찌 직교배열 생성·SN 분석·예측, 사용자 설계 정의/선택.
- **Mathematical Requirements**: Scheffé 모형(절편 없음), SN비(망소·망대·망목), 직교배열표 L8·L16·L18.
- **Input/Output Contract**: 입력: 성분 비율 또는 요인 수준. 출력: 설계 시트·계수·SN 표·예측.
- **Dependencies**: lib/doe.ts 확장
- **Implementation Complexity**: L
- **Independent Reference**: Minitab Taguchi/Mixture 문서의 배열표와 SN 공식
- **Acceptance Criteria**: SN 3유형 재현, Scheffé 적합 2케이스
- **Required Sample/Help/Tutorial**: sample: doe 확장, tutorial: DOE 2부
- **Regression Test Requirements**: 기존 요인/RSM 회귀 유지

## WO-P5-03 · 그래프 종류 확장 2: 열지도·버블·주변·원·점·영역·평행좌표·3D 산점·웨이퍼

- **Work Order ID**: WO-P5-03
- **Title**: 그래프 종류 확장 2: 열지도·버블·주변·원·점·영역·평행좌표·3D 산점·웨이퍼
- **Feature IDs**: M-D8-002, M-D8-009, M-D8-012, M-D8-013, M-D8-018, M-D8-020, M-D8-022, M-D8-023, M-D8-024, M-D8-025
- **Priority**: P2
- **Implementation Scope**: Graph Builder 나머지 차트 10종을 추가하고 공통 속성 드로워·내보내기·레이아웃 편집기를 그대로 적용.
- **Mathematical Requirements**: 색상 매핑·보간, 3D 투영, 평행좌표 정규화.
- **Input/Output Contract**: 입력: 열 선택. 출력: 차트 카드. 신규 차트도 ChartSpec을 확장해 기존 상호작용을 상속.
- **Dependencies**: chartConfig 확장
- **Implementation Complexity**: M
- **Independent Reference**: Minitab 각 차트 문서
- **Acceptance Criteria**: 차트별 스냅샷 + E2E
- **Required Sample/Help/Tutorial**: sample: process·display-optical-doe, help: graph-basics 확장
- **Regression Test Requirements**: 차트 렌더 회귀 200+ 유지

## WO-P5-04 · 회귀 확장: 로지스틱·비선형·PLS·안정성

- **Work Order ID**: WO-P5-04
- **Title**: 회귀 확장: 로지스틱·비선형·PLS·안정성
- **Feature IDs**: M-D3-015, M-D3-016, M-D3-017, M-D3-018, M-D3-019, M-D3-020, M-D3-021, M-D3-022, M-D3-023, M-D3-024
- **Priority**: P2
- **Implementation Scope**: 이진·순서·명목 로지스틱, 포아송, 비선형, 직교, PLS, 이진 적합선, 안정성 연구.
- **Mathematical Requirements**: IRLS 최대우도, 오즈비·Wald CI, Hosmer–Lemeshow, Gauss–Newton, PLS NIPALS.
- **Input/Output Contract**: 입력: 반응(이진/범주/계수)·예측변수·가중치. 출력: 계수·오즈비·적합도·분류표.
- **Dependencies**: WO-P4-07 모형 언어
- **Implementation Complexity**: L
- **Independent Reference**: statsmodels Logit/GLM/OLS, NIPALS 공개 알고리즘
- **Acceptance Criteria**: 로지스틱 3케이스·포아송 2케이스 QA 대조
- **Required Sample/Help/Tutorial**: sample: 신규 이진 데이터, help: 2문서
- **Regression Test Requirements**: 기존 회귀·GLM 테스트 유지

## WO-P5-05 · 신뢰성 확장: 비모수·가속·성장·보증 제외

- **Work Order ID**: WO-P5-05
- **Title**: 신뢰성 확장: 비모수·가속·성장·보증 제외
- **Feature IDs**: M-D6-004, M-D6-005, M-D6-009, M-D6-010, M-D6-013
- **Priority**: P2
- **Implementation Scope**: Kaplan–Meier, 가속 수명(Arrhenius·역승), 성장 곡선(Duane·Crow-AMSAA), 프로빗 분석.
- **Mathematical Requirements**: KM 추정·Greenwood, 가속 모형 로그선형, NHPP 강도함수, 프로빗 연결.
- **Input/Output Contract**: 입력: 수명·중도절단·스트레스·자극 수준. 출력: 생존 곡선·가속계수·성장 지표·LD50.
- **Dependencies**: WO-P4-09
- **Implementation Complexity**: L
- **Independent Reference**: Minitab 문서 정의 + SciPy 최적화
- **Acceptance Criteria**: KM 2케이스·가속 2케이스 QA 대조
- **Required Sample/Help/Tutorial**: sample: weibull 확장, help: reliability 확장
- **Regression Test Requirements**: 기존 2모수 Weibull 유지

## WO-P5-06 · 품질 도구: 런 차트·변동 차트·Multi-Vari·대칭·공차구간

- **Work Order ID**: WO-P5-06
- **Title**: 품질 도구: 런 차트·변동 차트·Multi-Vari·대칭·공차구간
- **Feature IDs**: M-D4-033, M-D4-034, M-D4-035, M-D4-036, M-D4-037, M-D4-038, M-D4-039
- **Priority**: P2
- **Implementation Scope**: 특성요인도, Multi-Vari, 런 차트, 대칭 그림, 변동 차트, 정규·비정규 공차구간.
- **Mathematical Requirements**: 런 규칙, 분산 구성, 공차계수 k(n, 신뢰수준, 비율), 비정규는 분포 분위수.
- **Input/Output Contract**: 입력: 반응·요인. 출력: 그림 + 표. 공차구간은 구간·k 값을 표로.
- **Dependencies**: none
- **Implementation Complexity**: M
- **Independent Reference**: 공차계수 표(공개 문헌)·SciPy 분위수
- **Acceptance Criteria**: 공차계수 3케이스 QA 대조
- **Required Sample/Help/Tutorial**: sample: process, help: quality 확장
- **Regression Test Requirements**: 품질 도구 메뉴 회귀

## WO-P5-07 · 관리도 확장: CUSUM·EWMA·이동평균·Laney·다변량

- **Work Order ID**: WO-P5-07
- **Title**: 관리도 확장: CUSUM·EWMA·이동평균·Laney·다변량
- **Feature IDs**: M-D4-016, M-D4-017, M-D4-018, M-D4-019, M-D4-020, M-D4-021, M-D4-022, M-D4-023, M-D4-024, M-D4-004, M-D4-005, M-D4-008, M-D4-009, M-D4-010, M-D4-011
- **Priority**: P2
- **Implementation Scope**: 시간가중 관리도 3종, Laney P′/U′, T²·일반화분산·MEWMA, I-MR-R/S·Z-MR·Xbar/R/S 단독·존 관리도.
- **Mathematical Requirements**: CUSUM 누적합, EWMA λ·L, T²=χ² 근사, 일반화분산 |S|, 존 규칙.
- **Input/Output Contract**: 입력: 수치 열(다변량은 여러 열). 출력: 관리도 패널 + 통계량 표.
- **Dependencies**: WO-P4-05 단계 옵션
- **Implementation Complexity**: L
- **Independent Reference**: Minitab 관리도 문서, Montgomery 표
- **Acceptance Criteria**: 각 관리도 1케이스 QA 대조(다변량은 2)
- **Required Sample/Help/Tutorial**: sample: process 다변량 확장
- **Regression Test Requirements**: 기존 관리도 16케이스 유지

## WO-P5-08 · 검정력·표본크기 확장과 동등성 검정

- **Work Order ID**: WO-P5-08
- **Title**: 검정력·표본크기 확장과 동등성 검정
- **Feature IDs**: M-D2-030, M-D2-031, M-D2-032, M-D2-033, M-D2-034, M-D2-035, M-D2-042, M-D2-043, M-D2-044, M-D2-045, M-D2-047, M-D2-048, M-D2-049, M-D2-050, M-D2-051, M-D2-052
- **Priority**: P2
- **Implementation Scope**: 런 검정·쌍별 통계량, 동등성 검정 4종, 포아송·분산·요인 설계 검정력, 추정·공차구간 표본크기.
- **Mathematical Requirements**: TOST, 비중심 분포 검정력, 공차계수 표본크기.
- **Input/Output Contract**: 입력: 요약값. 출력: 검정 결과·검정력 곡선.
- **Dependencies**: WO-P4-12
- **Implementation Complexity**: M
- **Independent Reference**: SciPy nct/ncf, 공차계수 문헌
- **Acceptance Criteria**: 동등성 4케이스·검정력 6케이스 QA 대조
- **Required Sample/Help/Tutorial**: help: power 확장
- **Regression Test Requirements**: 기존 검정력 21케이스 유지

## WO-P5-09 · 차트 편집 심화: 데이터 레이블·개별 눈금·주석

- **Work Order ID**: WO-P5-09
- **Title**: 차트 편집 심화: 데이터 레이블·개별 눈금·주석
- **Feature IDs**: M-D8-027, M-D8-028, M-D8-029, M-D8-030, M-D8-031, M-D8-032
- **Priority**: P2
- **Implementation Scope**: 차트 위 직접 편집(레이블 드래그), 개별 눈금 값, 강조 규칙(Focus on Critical Data), 표시 옵션 세분화.
- **Mathematical Requirements**: 없음(좌표·표시 규칙)
- **Input/Output Contract**: 편집 결과가 ChartConfig에 저장되고 프로젝트에 남아야 한다.
- **Dependencies**: S-MOD-04
- **Implementation Complexity**: M
- **Independent Reference**: Minitab Graph Editing 문서
- **Acceptance Criteria**: 편집 후 저장·복원 E2E
- **Required Sample/Help/Tutorial**: help: graph-basics 확장
- **Regression Test Requirements**: 차트 설정 스키마 마이그레이션 테스트

## WO-P5-10 · ANOVA·모형 사용 확장: ANOM·균형·중첩·MANOVA·등분산·비교

- **Work Order ID**: WO-P5-10
- **Title**: ANOVA·모형 사용 확장: ANOM·균형·중첩·MANOVA·등분산·비교
- **Feature IDs**: M-D3-002, M-D3-003, M-D3-005, M-D3-006, M-D3-007, M-D3-008, M-D3-010, M-D3-011, M-D3-030, M-D3-031
- **Priority**: P2
- **Implementation Scope**: ANOM, 균형 ANOVA, 혼합효과(REML), 완전중첩, MANOVA, 등분산 검정, 주효과·교호작용 그림, 다중비교.
- **Mathematical Requirements**: REML, Wilks/Pillai, Levene/Bonett, Dunnett/Hsu.
- **Input/Output Contract**: 입력: 반응·요인(+랜덤). 출력: 분산분석 표·그림.
- **Dependencies**: WO-P4-07
- **Implementation Complexity**: L
- **Independent Reference**: statsmodels MixedLM·anova_lm
- **Acceptance Criteria**: REML 1케이스·등분산 3케이스 QA 대조
- **Required Sample/Help/Tutorial**: sample: comparison 확장
- **Regression Test Requirements**: 기존 ANOVA·GLM 테스트 유지

## WO-P5-X11 · 잔여 항목 일괄 정리 — DOE & Optimization, Data & Workspace, Multivariate & Time Series, Quality Engineering, Reliability & Survival, Statistical Analysis, Statistical Modeling, Visualization & Automation

- **Work Order ID**: WO-P5-X11
- **Title**: 잔여 항목 일괄 정리 — DOE & Optimization, Data & Workspace, Multivariate & Time Series, Quality Engineering, Reliability & Survival, Statistical Analysis, Statistical Modeling, Visualization & Automation
- **Feature IDs**: M-D1-001, M-D1-002, M-D1-006, M-D1-008, M-D1-010, M-D1-018, M-D1-019, M-D1-021, M-D1-022, M-D1-024, M-D1-025, M-D1-026, M-D1-027, M-D1-029, M-D1-030, M-D1-034, M-D1-035, M-D2-001, M-D2-012, M-D2-013, M-D2-018, M-D2-036, M-D2-037, M-D2-038, M-D2-039, M-D2-040, M-D2-041, M-D2-046, M-D3-001, M-D3-009, M-D3-012, M-D3-032, M-D4-025, M-D4-026, M-D4-027, M-D4-032, M-D4-040, M-D4-044, M-D4-045, M-D4-046, M-D4-047, M-D4-048, M-D4-049, M-D4-050, M-D4-051, M-D4-052, M-D4-057, M-D5-008, M-D5-011, M-D5-012, M-D5-013, M-D5-021, M-D5-022, M-D5-023, M-D5-024, M-D5-025, M-D5-027, M-D5-028, M-D6-012, M-D6-016, M-D7-010, M-D7-012, M-D7-013, M-D7-015, M-D7-016, M-D7-017, M-D7-018, M-D7-019, M-D7-020, M-D7-025, M-D8-001, M-D8-003, M-D8-004, M-D8-007, M-D8-011, M-D8-014, M-D8-016, M-D8-017, M-D8-019, M-D8-021, M-D8-036
- **Priority**: P2
- **Implementation Scope**: DOE & Optimization, Data & Workspace, Multivariate & Time Series, Quality Engineering, Reliability & Survival, Statistical Analysis, Statistical Modeling, Visualization & Automation 영역에서 위 기능들을 같은 엔진·같은 입력 규약으로 묶어 처리한다.
- **Mathematical Requirements**: 각 기능의 공개 정의를 그대로 구현하고, 공유 가능한 계산(분포 함수·행렬·집계)은 공통 모듈로 뺀다.
- **Input/Output Contract**: 기존 RunResult/ChartSpec 규약을 그대로 따르고, 입력 감사 표에 각 분석을 등록한다.
- **Dependencies**: 해당 영역의 선행 WO
- **Implementation Complexity**: M
- **Independent Reference**: 각 기능의 공식 문서 페이지와 QA 독립 기준
- **Acceptance Criteria**: 기능별 최소 1개 QA 대조 또는 명시적 미검증 표기, input-audit 표 등록
- **Required Sample/Help/Tutorial**: 샘플·도움말·튜토리얼은 영역 문서에 통합
- **Regression Test Requirements**: 기존 테스트 전건 유지

