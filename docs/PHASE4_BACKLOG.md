# Phase 4 백로그 — Sigrún (Minitab 기능 격차 감사의 후속 개발 계획)

- 기준: `43b0b071cf010352d8add7600dfa29d158a2b3e3` · 감사일 2026-11-24 · Minitab 22.6.x
- 대상 기능: `docs/audit/minitab-gap-matrix.json` 에서 `Target Phase = Phase 4` 인 Minitab 기능
- 작업 지시 14건 · 기능 85건

## 요약

| WO | 항목 | Feature IDs | 복잡도 | 의존성 |
| --- | --- | --- | --- | --- |
| WO-P4-01 | 상관·교차표·카이제곱: 기초 통계의 빈 자리 채우기 | M-D2-016, M-D2-017, M-D2-019, M-D2-020, M-D2-021, M-D2-022, M-D2-023 | M | 없음(기존 stats.ts·dist.ts 재사용) |
| WO-P4-02 | 비모수 검정 6종 | M-D2-024, M-D2-025, M-D2-026, M-D2-027, M-D2-028, M-D2-029 | M | WO-P4-01의 순위·교차표 유틸 공유 |
| WO-P4-03 | 워크시트 재구조화: Stack·Unstack·Transpose·Subset·Split·Merge | M-D1-009, M-D1-011, M-D1-012, M-D1-013, M-D1-014, M-D1-015, M-D1-016, M-D1-017 | M | sheetOps 확장 |
| WO-P4-04 | 열 메타데이터: 서식·유형 변환 보고·순위·지시변수·조건부 서식 | M-D1-003, M-D1-004, M-D1-005, M-D1-007, M-D1-023 | S | 없음 |
| WO-P4-05 | 관리도 단계·한계 고정·규칙 선택 | M-D4-028, M-D4-001, M-D4-002, M-D4-003, M-D4-006, M-D4-007, M-D4-012, M-D4-013, M-D4-014, M-D4-015 | M | lib/spc.ts 확장 |
| WO-P4-06 | 정규성 확장과 변환: Box-Cox·Johnson·분포 식별 | M-D4-029, M-D4-030, M-D4-031, M-D2-004, M-D4-041, M-D4-042 | L | dist.ts·nonnormal.ts 확장 |
| WO-P4-07 | 회귀·GLM 모형 언어: 공변량·범주·단계적·최적부분집합 | M-D3-004, M-D3-013, M-D3-014 | L | modelStore 스키마 v2(3F 완료) |
| WO-P4-08 | DOE 스크리닝: 부분요인·Plackett–Burman·Definitive Screening·블록 | M-D5-001, M-D5-002, M-D5-003, M-D5-004 | L | lib/doe.ts 확장 |
| WO-P4-09 | 신뢰성 분포 확장과 수명 회귀 | M-D6-001, M-D6-002, M-D6-003, M-D6-011 | L | lib/reliability.ts 확장 |
| WO-P4-10 | 시계열 기초: ACF/PACF·ARIMA·지수평활 | M-D7-011, M-D7-014, M-D7-021, M-D7-022, M-D7-023, M-D7-024 | L | 신규 lib/timeseries.ts |
| WO-P4-11 | 차트 종류 확장 1: 개별값·구간·막대·산점도 행렬·ECDF·표 요약 | M-D8-005, M-D8-006, M-D8-008, M-D8-010, M-D8-015, M-D8-026 | M | 차트 엔진 재사용 |
| WO-P4-12 | 기초 통계 보강: 요약 통계량 입력·비율/분산 검정·그래픽 요약·이상치 | M-D2-002, M-D2-003, M-D2-005, M-D2-006, M-D2-007, M-D2-008, M-D2-009, M-D2-010, M-D2-011, M-D2-014, M-D2-015 | M | dist.ts의 분포 함수 |
| WO-P4-13 | MSA 확장: Type 1·직선성/편의·속성 일치도 | M-D4-053, M-D4-054, M-D4-055, M-D4-056 | M | lib/gagerr.ts 확장 |
| WO-P4-X14 | 잔여 항목 일괄 정리 — DOE & Optimization, Data & Workspace, Quality Engineering | M-D1-020, M-D4-043, M-D5-009, M-D5-010, M-D5-026 | M | 해당 영역의 선행 WO |

## WO-P4-01 · 상관·교차표·카이제곱: 기초 통계의 빈 자리 채우기

- **Work Order ID**: WO-P4-01
- **Title**: 상관·교차표·카이제곱: 기초 통계의 빈 자리 채우기
- **Feature IDs**: M-D2-016, M-D2-017, M-D2-019, M-D2-020, M-D2-021, M-D2-022, M-D2-023
- **Priority**: P1
- **Implementation Scope**: Pearson/Spearman 상관행렬(p·CI·행렬도), 공분산 행렬, Tally, 교차표+카이제곱(기대빈도·Fisher), 적합도·독립성 검정, 표 요약 통계량을 새 분석 2~3개로 추가.
- **Mathematical Requirements**: r=Σxy/√(Σx²Σy²), Fisher z CI, Spearman 순위·동점 보정; Pearson χ²=Σ(O−E)²/E, df=(r−1)(c−1), 기대빈도 5 미만 셀 경고, Fisher 정확검정은 초기하 확률.
- **Input/Output Contract**: 입력: 수치 열 2개 이상(상관) / 범주 열 2개(교차표). 출력: 계수·p·CI 표 + 행렬 차트 + 기대빈도 표. 오류: 문자 열을 수치 슬롯에 넣으면 res.numericOnly.
- **Dependencies**: 없음(기존 stats.ts·dist.ts 재사용)
- **Implementation Complexity**: M
- **Independent Reference**: qa/reference/engine.py의 pearsonr·chi2_contingency 경로, SciPy 1.18.1
- **Acceptance Criteria**: QA 대조 20건 이상 PASS, 상관행렬·교차표 E2E 1개, 입력 감사 표에 신규 분석 행 추가
- **Required Sample/Help/Tutorial**: sample: process·comparison, help: 신규 2문서, tutorial: 기초통계 코스 확장
- **Regression Test Requirements**: tests/analyses.test.ts + input-audit.test.ts + 신규 상관/교차표 테스트, 기존 1,096건 유지

## WO-P4-02 · 비모수 검정 6종

- **Work Order ID**: WO-P4-02
- **Title**: 비모수 검정 6종
- **Feature IDs**: M-D2-024, M-D2-025, M-D2-026, M-D2-027, M-D2-028, M-D2-029
- **Priority**: P1
- **Implementation Scope**: 1표본 부호·Wilcoxon, Mann–Whitney, Kruskal–Wallis(사후 비교), Mood 중앙값, Friedman을 하나의 비모수 분석군으로 추가.
- **Mathematical Requirements**: 정확 분포(동점 보정 포함) + 정규근사 선택, 순위 기반 통계량, Kruskal–Wallis H의 χ² 근사, Mood는 중앙값 기준 2×k 표.
- **Input/Output Contract**: 입력: 반응 수치 열 + 요인 열(또는 대응 열 여러 개). 출력: 통계량·df·p·중앙값·사후 비교 표. 오류: 요인 수준 1개면 명시 거부.
- **Dependencies**: WO-P4-01의 순위·교차표 유틸 공유
- **Implementation Complexity**: M
- **Independent Reference**: SciPy mannwhitneyu·wilcoxon·kruskal·friedmanchisquare, 정확 방법은 열거 계산
- **Acceptance Criteria**: 각 검정 최소 2케이스(정확/근사) PASS, E2E 1개, 도움말 1문서
- **Required Sample/Help/Tutorial**: sample: comparison, help: nonparametrics, tutorial: 가설검정 코스 확장
- **Regression Test Requirements**: 기존 t 검정 회귀 유지, 신규 테스트 12건 이상

## WO-P4-03 · 워크시트 재구조화: Stack·Unstack·Transpose·Subset·Split·Merge

- **Work Order ID**: WO-P4-03
- **Title**: 워크시트 재구조화: Stack·Unstack·Transpose·Subset·Split·Merge
- **Feature IDs**: M-D1-009, M-D1-011, M-D1-012, M-D1-013, M-D1-014, M-D1-015, M-D1-016, M-D1-017
- **Priority**: P1
- **Implementation Scope**: Data 메뉴에 7개 구조 변환 도구 추가. 각 도구는 새 시트를 만들고 원본을 보존한다.
- **Mathematical Requirements**: 없음(순수 재배열). 병합은 키 조인(1:1, 다:1), 부분집합은 행 조건 평가.
- **Input/Output Contract**: 입력: 시트·열·조건. 출력: 새 시트 + 결과 요약. 실행 취소 1단계로 되돌릴 수 있어야 한다.
- **Dependencies**: sheetOps 확장
- **Implementation Complexity**: M
- **Independent Reference**: Minitab 문서의 Stack/Unstack/Transpose 예제 표
- **Acceptance Criteria**: 변환별 단위 테스트 2건, 왕복 변환(stack→unstack) 항등성 테스트, E2E 1개
- **Required Sample/Help/Tutorial**: sample: process, help: data-management 확장, tutorial: data 코스 확장
- **Regression Test Requirements**: tests/worksheet-ux.test.ts·selection.test.ts 유지

## WO-P4-04 · 열 메타데이터: 서식·유형 변환 보고·순위·지시변수·조건부 서식

- **Work Order ID**: WO-P4-04
- **Title**: 열 메타데이터: 서식·유형 변환 보고·순위·지시변수·조건부 서식
- **Feature IDs**: M-D1-003, M-D1-004, M-D1-005, M-D1-007, M-D1-023
- **Priority**: P1
- **Implementation Scope**: 열 표시 형식(자릿수·통화·날짜), 유형 변환 결과 보고, Rank(동점 규칙), 지시변수 생성, 조건부 서식 규칙.
- **Mathematical Requirements**: 순위 동점 처리 4종(평균·최소·최대·순차), 지시변수는 기준 수준 대비 0/1.
- **Input/Output Contract**: 입력: 열 1개 + 규칙. 출력: 새 열 또는 서식 메타데이터. 서식은 값 불변.
- **Dependencies**: 없음
- **Implementation Complexity**: S
- **Independent Reference**: Minitab Data > Column Format / Rank 문서의 규칙 표
- **Acceptance Criteria**: 서식이 계산 결과를 바꾸지 않음을 증명하는 테스트, 순위 동점 4종 테스트
- **Required Sample/Help/Tutorial**: sample: process, help: 데이터 관리 문서 갱신
- **Regression Test Requirements**: 프로젝트 저장·복원에 서식 메타데이터 포함 테스트

## WO-P4-05 · 관리도 단계·한계 고정·규칙 선택

- **Work Order ID**: WO-P4-05
- **Title**: 관리도 단계·한계 고정·규칙 선택
- **Feature IDs**: M-D4-028, M-D4-001, M-D4-002, M-D4-003, M-D4-006, M-D4-007, M-D4-012, M-D4-013, M-D4-014, M-D4-015
- **Priority**: P1
- **Implementation Scope**: 모든 관리도에 단계(Stages) 정의, 과거 한계 고정, 표시 규칙 선택을 공통 옵션으로 붙인다. Xbar-R에 부분군 ID 열도 추가.
- **Mathematical Requirements**: 단계별 중심선·σ 재추정, 고정 한계는 계산에서 제외하되 표시, Nelson 규칙 1–8 개별 토글.
- **Input/Output Contract**: 입력: 단계 열 또는 경계 인덱스, 고정 한계 값. 출력: 단계 구분선·단계별 한계 표.
- **Dependencies**: lib/spc.ts 확장
- **Implementation Complexity**: M
- **Independent Reference**: Minitab Define Stages 문서, Nelson(1984) 규칙 정의
- **Acceptance Criteria**: 단계 2개 이상에서 QA 대조, 고정 한계 재현 테스트, 기존 I-MR/속성 관리도 회귀 유지
- **Required Sample/Help/Tutorial**: sample: process(교대조), tutorial: SPC 코스 확장
- **Regression Test Requirements**: tests/spc.test.ts + qa/cases/QA-C 확장

## WO-P4-06 · 정규성 확장과 변환: Box-Cox·Johnson·분포 식별

- **Work Order ID**: WO-P4-06
- **Title**: 정규성 확장과 변환: Box-Cox·Johnson·분포 식별
- **Feature IDs**: M-D4-029, M-D4-030, M-D4-031, M-D2-004, M-D4-041, M-D4-042
- **Priority**: P1
- **Implementation Scope**: 관리도·능력 분석 공통 Box-Cox λ 추정, Johnson 변환, 개별 분포 식별(후보 분포 적합 순위), 비정규 능력에 지수·최대극치·베타 추가, 비모수 능력.
- **Mathematical Requirements**: Box-Cox 프로파일 우도로 λ 추정, Johnson SU/SB/SL 적합, AD 통계량으로 분포 순위, 경험분포 기반 PPM.
- **Input/Output Contract**: 입력: 수치 열(+규격). 출력: λ·변환식·적합 순위·PPM. 변환은 새 열로 저장.
- **Dependencies**: dist.ts·nonnormal.ts 확장
- **Implementation Complexity**: L
- **Independent Reference**: SciPy boxcox_normmax, Johnson 분포 구현(공개 수식)
- **Acceptance Criteria**: λ 추정 3케이스·Johnson 3계열·분포 순위 2케이스 QA 대조, 능력 분석 회귀 유지
- **Required Sample/Help/Tutorial**: sample: process, help: capability 문서 확장
- **Regression Test Requirements**: QA-D 확장 + tests/analyses.test.ts 유지

## WO-P4-07 · 회귀·GLM 모형 언어: 공변량·범주·단계적·최적부분집합

- **Work Order ID**: WO-P4-07
- **Title**: 회귀·GLM 모형 언어: 공변량·범주·단계적·최적부분집합
- **Feature IDs**: M-D3-004, M-D3-013, M-D3-014
- **Priority**: P1
- **Implementation Scope**: GLM에 공변량·적합결여, 회귀에 범주 예측변수·단계적 선택·최적부분집합·가중치. 모형 축소·오차 풀링·계층성·비교표는 Phase 3F에서 완료했다(WO-3F-02~08).
- **Mathematical Requirements**: Type I/III SS 유지, 공변량은 연속 열로 설계행렬에 포함, 단계적은 AIC/BIC 또는 p 기준, 최적부분집합은 Cp·R²adj 열거.
- **Input/Output Contract**: 입력: 반응·연속/범주 예측변수·가중치. 출력: 항별 표·축소 이력·모형 비교. 모형 저장 스키마 확장 필요.
- **Dependencies**: modelStore 스키마 v2(Phase 3F에서 완료)
- **Implementation Complexity**: L
- **Independent Reference**: statsmodels OLS/anova_lm(type=3), 부분집합 열거는 독립 구현
- **Acceptance Criteria**: 공변량 포함 GLM 5케이스·범주 회귀 3케이스 QA 대조, 기존 3F 모형 통제 케이스(QA-3F-01~25) 회귀 유지
- **Required Sample/Help/Tutorial**: sample: regression 확장, tutorial: regression 코스 확장
- **Regression Test Requirements**: 기존 회귀·GLM 테스트 전부 유지(스키마 마이그레이션 포함)

## WO-P4-08 · DOE 스크리닝: 부분요인·Plackett–Burman·Definitive Screening·블록

- **Work Order ID**: WO-P4-08
- **Title**: DOE 스크리닝: 부분요인·Plackett–Burman·Definitive Screening·블록
- **Feature IDs**: M-D5-001, M-D5-002, M-D5-003, M-D5-004
- **Priority**: P1
- **Implementation Scope**: 부분요인(해상도 III~V)·PB·DSD 생성과 블록 열, 별칭 구조 표시, 요인 7~15개 지원.
- **Mathematical Requirements**: 생성자 관계로 부분요인 설계 구성, 별칭 구조 계산, PB는 Hadamard 행렬, DSD는 fold-over 구조.
- **Input/Output Contract**: 입력: 요인 수·해상도·블록 수. 출력: 설계 시트 + 별칭 표. 분석은 기존 doeanalyze가 그대로 받는다.
- **Dependencies**: lib/doe.ts 확장
- **Implementation Complexity**: L
- **Independent Reference**: Minitab Create 2-Level Factorial/PB 문서의 설계표, 공개 생성자 규칙
- **Acceptance Criteria**: 각 설계의 직교성·해상도 검증 테스트, 별칭 표 재현, 설계→분석 왕복 E2E
- **Required Sample/Help/Tutorial**: sample: doe, tutorial: DOE 코스 확장
- **Regression Test Requirements**: 기존 완전요인 설계 테스트 유지

## WO-P4-09 · 신뢰성 분포 확장과 수명 회귀

- **Work Order ID**: WO-P4-09
- **Title**: 신뢰성 분포 확장과 수명 회귀
- **Feature IDs**: M-D6-001, M-D6-002, M-D6-003, M-D6-011
- **Priority**: P1
- **Implementation Scope**: 모수 분포를 11종으로 확장(3모수 Weibull 포함), 분포 ID 도표, 개요 도표, 수명 데이터 회귀(공변량).
- **Mathematical Requirements**: 각 분포 MLE, 3모수 Weibull 위치모수 프로파일, AD 적합도, 가속 회귀는 연결함수 기반.
- **Input/Output Contract**: 입력: 수명·중도절단(좌측/구간 포함)·공변량. 출력: 분포별 적합도·수명 분위·회귀 계수.
- **Dependencies**: lib/reliability.ts 확장
- **Implementation Complexity**: L
- **Independent Reference**: SciPy 분포 적합 + Minitab 문서의 분포 파라미터 정의
- **Acceptance Criteria**: 분포별 최소 1케이스 QA 대조(11종), 3모수 케이스, 분포 ID 순위 재현
- **Required Sample/Help/Tutorial**: sample: weibull 확장, tutorial: reliability 코스 확장
- **Regression Test Requirements**: 기존 2모수 Weibull 12케이스 유지

## WO-P4-10 · 시계열 기초: ACF/PACF·ARIMA·지수평활

- **Work Order ID**: WO-P4-10
- **Title**: 시계열 기초: ACF/PACF·ARIMA·지수평활
- **Feature IDs**: M-D7-011, M-D7-014, M-D7-021, M-D7-022, M-D7-023, M-D7-024
- **Priority**: P1
- **Implementation Scope**: ACF·PACF, ARIMA(p,d,q), 단순·이중·Winters 지수평활, 추세 분석과 예측 구간.
- **Mathematical Requirements**: 표본 ACF/PACF( Bartlett 밴드), ARIMA는 조건부 최소제곱/최대우도, 평활은 수준·추세·계절 성분 갱신식.
- **Input/Output Contract**: 입력: 값 열(+시간 열). 출력: 계수·AIC·예측·예측구간·잔차 ACF. 시트에 예측 열 저장 옵션.
- **Dependencies**: 신규 lib/timeseries.ts
- **Implementation Complexity**: L
- **Independent Reference**: statsmodels ARIMA/ExponentialSmoothing, ACF는 독립 구현
- **Acceptance Criteria**: ARIMA 3케이스·평활 3종 각 1케이스 QA 대조, 예측 구간 재현
- **Required Sample/Help/Tutorial**: sample: process(단기 시계열 추가), help: 시계열 문서 신규
- **Regression Test Requirements**: 기존 시계열 그림 테스트 유지

## WO-P4-11 · 차트 종류 확장 1: 개별값·구간·막대·산점도 행렬·ECDF·표 요약

- **Work Order ID**: WO-P4-11
- **Title**: 차트 종류 확장 1: 개별값·구간·막대·산점도 행렬·ECDF·표 요약
- **Feature IDs**: M-D8-005, M-D8-006, M-D8-008, M-D8-010, M-D8-015, M-D8-026
- **Priority**: P1
- **Implementation Scope**: 그래프 메뉴에 6개 차트를 정식 도구로 추가(내부 차트 종류 재사용).
- **Mathematical Requirements**: 집계 규칙(평균·합·비율), ECDF 계단 함수, 행렬도는 쌍별 산점도.
- **Input/Output Contract**: 입력: 열 선택 + 그룹. 출력: 차트 카드(속성 드로워·내보내기 자동 적용).
- **Dependencies**: 차트 엔진 재사용
- **Implementation Complexity**: M
- **Independent Reference**: Minitab Graph Builder 각 차트 문서
- **Acceptance Criteria**: 차트별 E2E 1개, 속성 드로워·내보내기 회귀, 렌더 스냅샷
- **Required Sample/Help/Tutorial**: sample: process, help: graph-basics 확장
- **Regression Test Requirements**: 기존 차트 테스트 200+ 유지

## WO-P4-12 · 기초 통계 보강: 요약 통계량 입력·비율/분산 검정·그래픽 요약·이상치

- **Work Order ID**: WO-P4-12
- **Title**: 기초 통계 보강: 요약 통계량 입력·비율/분산 검정·그래픽 요약·이상치
- **Feature IDs**: M-D2-002, M-D2-003, M-D2-005, M-D2-006, M-D2-007, M-D2-008, M-D2-009, M-D2-010, M-D2-011, M-D2-014, M-D2-015
- **Priority**: P1
- **Implementation Scope**: 1t/2t/대응 t에 요약 통계량 입력, 1표본 Z, 1·2비율, 1·2분산, 그래픽 요약(4패널), Grubbs 이상치.
- **Mathematical Requirements**: 요약 입력은 df·SE를 그대로 사용, 비율은 Wilson/정확 이항 선택, 분산은 χ²·F, 그래픽 요약은 평균·중앙값 CI.
- **Input/Output Contract**: 입력: 열 또는 요약값. 출력: 기존 t 검정과 같은 표 구조 + 추가 통계량.
- **Dependencies**: dist.ts의 분포 함수
- **Implementation Complexity**: M
- **Independent Reference**: SciPy binomtest·chisquare·f_oneway, Wilson 구간 공식
- **Acceptance Criteria**: 검정별 2케이스(정확/근사) QA 대조, 요약 입력과 원자료 결과 일치 테스트
- **Required Sample/Help/Tutorial**: sample: comparison, help: t-tests·비율 검정 문서
- **Regression Test Requirements**: 기존 t 검정 12케이스 유지

## WO-P4-13 · MSA 확장: Type 1·직선성/편의·속성 일치도

- **Work Order ID**: WO-P4-13
- **Title**: MSA 확장: Type 1·직선성/편의·속성 일치도
- **Feature IDs**: M-D4-053, M-D4-054, M-D4-055, M-D4-056
- **Priority**: P1
- **Implementation Scope**: Gage R&R 옆에 Type 1(Cg·Cgk), 직선성·편의 회귀, 속성 일치도(kappa) 추가.
- **Mathematical Requirements**: Cg=0.2·공차/(6·s), Cgk는 편의 보정; 직선성은 기준값 회귀 기울기·절편; kappa=(Po−Pe)/(1−Pe).
- **Input/Output Contract**: 입력: 기준값·반복 측정 또는 부품·평가자·판정. 출력: 지표 표 + 그래프.
- **Dependencies**: lib/gagerr.ts 확장
- **Implementation Complexity**: M
- **Independent Reference**: Minitab MSA 문서의 지표 정의, kappa 공식
- **Acceptance Criteria**: 각 도구 2케이스 QA 대조, 기존 Gage R&R 7케이스 유지
- **Required Sample/Help/Tutorial**: sample: gagerr, tutorial: MSA 확장
- **Regression Test Requirements**: tests/p2.test.ts 확장

## WO-P4-X14 · 잔여 항목 일괄 정리 — DOE & Optimization, Data & Workspace, Quality Engineering

- **Work Order ID**: WO-P4-X14
- **Title**: 잔여 항목 일괄 정리 — DOE & Optimization, Data & Workspace, Quality Engineering
- **Feature IDs**: M-D1-020, M-D4-043, M-D5-009, M-D5-010, M-D5-026
- **Priority**: P1
- **Implementation Scope**: DOE & Optimization, Data & Workspace, Quality Engineering 영역에서 위 기능들을 같은 엔진·같은 입력 규약으로 묶어 처리한다.
- **Mathematical Requirements**: 각 기능의 공개 정의를 그대로 구현하고, 공유 가능한 계산(분포 함수·행렬·집계)은 공통 모듈로 뺀다.
- **Input/Output Contract**: 기존 RunResult/ChartSpec 규약을 그대로 따르고, 입력 감사 표에 각 분석을 등록한다.
- **Dependencies**: 해당 영역의 선행 WO
- **Implementation Complexity**: M
- **Independent Reference**: 각 기능의 공식 문서 페이지와 QA 독립 기준
- **Acceptance Criteria**: 기능별 최소 1개 QA 대조 또는 명시적 미검증 표기, input-audit 표 등록
- **Required Sample/Help/Tutorial**: 샘플·도움말·튜토리얼은 영역 문서에 통합
- **Regression Test Requirements**: 기존 테스트 전건 유지

