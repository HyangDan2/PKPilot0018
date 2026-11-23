# Sigrún ↔ Minitab 기능 격차 감사 (Stage 2)

> **대상**: `HD2Lab Sigrún` — 브라우저에서만 도는 통계·품질 워크스페이스
> **기준 커밋**: `928afee` (Stage 1 머지) 이후, Stage 2 작업 브랜치
> **감사 방법**: ① `src/lib/analyses.ts` 레지스트리의 40개 분석 전부에 대해 입력 슬롯 ↔ 실행 함수 ↔ 출력 블록을 대조, ② `tests/input-audit.test.ts` 로 자동화한 입력 감사(필수 누락·문자/날짜 열·중복 선택·구 프로젝트 문자열·짧은 열), ③ Minitab 공식 문서(`support.minitab.com`)의 각 대화상자 항목과 1:1 비교.
> **검증**: `npx tsc --noEmit` 0건 · `npm test` 전건 통과 · `npm run qa:stats` **156/156 (100.0%)** · `npm run build` 성공
> **분류**: `SUPPORTED` 구현·검증됨 / `PARTIAL` 일부만 / `MISSING` 없음 / `DIFFERENT` 다른 방식 / `NOT_APPLICABLE` 데스크톱 전용 / `UNKNOWN` 미확인

이 문서는 "무엇이 되어 있나"가 아니라 **"Minitab 대비 어디까지 되어 있고, 어디서 다른가"**를 코드 근거와 공식 문서 링크로 남긴다. 모든 행의 근거는 저장소 안의 실제 심볼이다.

---

## 1. 요약

| 영역 | 항목 | SUPPORTED | PARTIAL | MISSING | DIFFERENT | P0 | P1 | P2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 워크시트 | 15 | 6 | 3 | 3 | 3 | 0 | 3 | 12 |
| 기초 통계 | 17 | 5 | 3 | 8 | 1 | 0 | 7 | 10 |
| 그래프 | 16 | 6 | 6 | 4 | 0 | 0 | 5 | 11 |
| SPC · 공정능력 | 16 | 6 | 3 | 7 | 0 | 0 | 5 | 11 |
| ANOVA · GLM · DOE · RSM | 10 | 5 | 1 | 4 | 0 | 0 | 4 | 6 |
| 신뢰성 · 검정력 | 10 | 4 | 1 | 5 | 0 | 0 | 3 | 7 |
| **합계** | **84** | **32** | **17** | **31** | **4** | **0** | **27** | **57** |

- **P0(정확성·데이터 손실) 격차는 없다.** Stage 2 입력 감사에서 나온 결함(빈 슬롯을 조용히 통과, 문자 열을 빈 표로 출력, 구 프로젝트에서 `byRefs.map` 크래시 등 18건)은 이 PR에서 모두 수정했고 `tests/input-audit.test.ts` 가 회귀를 막는다(§8).
- **P1 27건**은 Minitab 사용자가 일상적으로 쓰는 흐름이 끊기는 지점이다: 상관분석 도구 자체의 부재, 비모수 검정, GLM 공변량, 관리도 단계 구분, Box-Cox, 부분요인 설계, 반응 최적화, 분포 ID, 다중 시계열, 문자 Recode.
- **P2 57건**은 있으면 좋은 편의·표시 옵션이다(로그 축, 행렬도, 열 서식, 블록, 공차구간 등).

---

## 2. 워크시트

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 |
| --- | --- | --- | --- | --- | --- | --- |
| 데이터 유형 3종 | 숫자·문자·날짜/시간, 열 머리글에 `-T`/`-D` | `numeric`·`text`·`date`, 헤더에 `-T`/`-D` 표시 | SUPPORTED | `src/types.ts` `ColType` · `WorksheetGrid` 헤더 | [Minitab data types and formats](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P1 |
| 날짜/시간 값 | 실제 날짜 값, 날짜 연산·서식 | 날짜 열은 **문자열**로 저장(정렬·표시만) | DIFFERENT | `Column.values: (number \| string \| null)[]` | 위 링크 | P2 |
| 결측값 표시 | 셀에 `*` | 계산에서는 제외하지만 셀은 **공백**으로 표시 | DIFFERENT | `WorksheetGrid.cellText()` 가 `null → ''` | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| 열 머리글 이름·설명·추가/삭제 | 이름, 설명, 삽입/삭제 | 우클릭 메뉴로 이름·설명·삽입·삭제, `+` 헤더 | SUPPORTED | `Column.description` · `ContextMenu` · Stage 1 선택 모델 | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| 셀 선택·편집·다중 셀 붙여넣기 | 범위 선택, Excel 붙여넣기 | 드래그 선택 모델, Excel/CSV 다중 셀 붙여넣기, 실행 취소 | SUPPORTED | `lib/selection.ts` · `WorksheetGrid.tsx` · `App.applySheets` 히스토리 | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| 데이터 유형 변경 | `Data > Change Data Type` | 없음(열을 새로 계산해야 함) | MISSING | 컨텍스트 메뉴에 유형 변환 항목 없음 | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| 열 서식(표시 형식) | 소수 자릿수·통화·날짜 서식 | 없음(계산값 서식은 `format.ts` 고정) | MISSING | `ContextMenu` 항목 목록 | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| 계산기(수식 열) | 열 수식, 자동 재계산, IF/날짜 함수 | 단일 수식 → 새 열, `MEAN/SQRT/LN/LOG/ROUND` 등 함수 | PARTIAL | `runCalculator` · `lib/calc.ts` `evaluateFormula` | [Minitab data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P1 |
| 정렬 | 여러 정렬 키, 내림차순 | 열 1개 기준, 행 전체 이동, 결측은 뒤로 | PARTIAL | `runSort` | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| 표준화 | 평균 0, 표준편차 1 | 동일(새 열) | SUPPORTED | `runStandardize` | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| Recode | 숫자·문자 모두, 범위 규칙 | 숫자 짝(`1=10`)만, 문자는 명시 거부 | PARTIAL | `runRecode` · `res.recodeNoMapping`(Stage 2 추가) | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P1 |
| Stack / Unstack / Transpose / Subset | `Data` 메뉴 | 없음 | MISSING | 레지스트리에 해당 분석 없음 | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| CSV / XLSX 가져오기·내보내기 | 지원 | 다중 시트 xlsx + CSV, 클립보드 | SUPPORTED | `lib/xlsx.ts` · `ImportDialog` | [Data types](https://support.minitab.com/en-us/minitab/help-and-how-to/manipulate-data-in-worksheets-columns-and-rows/supporting-topics/data-types-and-arrangements/minitab-data-types-and-formats/) | P2 |
| 프로젝트 파일 | `.mpx` 바이너리 | `.sigrun.json`(워크시트·출력·옵션 전부) | DIFFERENT | `lib/project.ts` `ProjectFile` | — | P2 |
| 실행 취소/재실행 | 있음 | 워크시트 스냅샷 기반 Undo/Redo | SUPPORTED | `App.tsx` `history` · `undo/redo` | — | P2 |

---

## 3. 기초 통계 · 회귀

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 |
| --- | --- | --- | --- | --- | --- | --- |
| 기술통계(Display Descriptive Statistics) | Variables + By, N/N\*/평균/SE/표준편차/분산/변동계수/최소/Q1/중앙/Q3/최대/IQR/왜도/첨도 | 동일 16개 통계 + 다중 By | SUPPORTED | `runDescriptive` (Stage 2: 빈 목록·문자 열 거부) | [Enter your data for Display Descriptive Statistics](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/how-to/display-descriptive-statistics/perform-the-analysis/enter-your-data/) | P1 |
| 정규성 검정 | Anderson–Darling, Ryan–Joiner, Kolmogorov–Smirnov | **Anderson–Darling만** + 확률도·95% 밴드 | PARTIAL | `runNormality` · `lib/stats.ts` `adNormality` | [Test for normality](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/supporting-topics/normality/test-for-normality/) | P1 |
| 1표본 t | 가설 평균, 신뢰수준, 대립가설, 저장 옵션 | 동일 + 히스토그램 | SUPPORTED | `runT1` | [Types of t-tests](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/supporting-topics/tests-of-means/types-of-t-tests/) | P2 |
| 2표본 t | Welch/pooled, 등분산 F 검정, 신뢰구간 | 동일 + 두 그룹 상자그림 | SUPPORTED | `runT2` | [Overview for 2-Sample t](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/how-to/2-sample-t/before-you-start/overview/) | P2 |
| 요약 통계량 입력(1t/2t) | 평균·표본크기·표준편차로 직접 검정 | 열만 받음 | MISSING | `runT1`/`runT2` 슬롯은 `col` 만 | [Overview for 2-Sample t](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/how-to/2-sample-t/before-you-start/overview/) | P2 |
| 대응 t | 차이 평균, μ₀, 신뢰구간, 저장 | 동일 + μ₀ 표기·차이 히스토그램 | SUPPORTED | `runPaired` | [Overview for Paired t](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/how-to/paired-t/before-you-start/overview/) | P2 |
| **상관분석(Correlation)** | Pearson·Spearman, 상관행렬, p값, 신뢰구간, 행렬도 | **도구 없음.** 산점도 카드의 `Pearson r` 표시만 | MISSING | `runScatter` 의 `notesFor()` 가 r·R²·회귀식만 기록 · 레지스트리에 `correlation` 없음 | [Overview for Correlation](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/how-to/correlation/before-you-start/overview/) · [Select the analysis options](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/how-to/correlation/perform-the-analysis/select-the-analysis-options/) | **P1** |
| 공분산 | Covariance 행렬 | 없음 | MISSING | 레지스트리 없음 | [Overview for Correlation](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/how-to/correlation/before-you-start/overview/) | P2 |
| 회귀분석 | 다중 OLS, 범주 예측변수, 교호작용·다항, 단계적·최적부분집합, 예측·저장 | 다중 OLS + VIF + 4-in-1 잔차, R²/R²(adj)/R²(pred) | PARTIAL | `runRegression` · `lib/stats.ts` `regress` | [Overview for Fit Regression Model](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/regression/how-to/fit-regression-model/before-you-start/overview/) | P1 |
| 적합선 그림(Fitted Line Plot) | 단일 예측변수 + 회귀/잔차 옵션 | 산점도 + 회귀선으로 대체 | DIFFERENT | `scatter` 의 `fit` | [Overview for Fit Regression Model](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/regression/how-to/fit-regression-model/before-you-start/overview/) | P2 |
| 일원배치 ANOVA | F 검정, 평균 신뢰구간, Tukey·Fisher 비교, 잔차 그림 | F 검정 + 평균 CI 그림 + Tukey HSD + compact letter + 상자그림 | SUPPORTED | `runAnova` · `lib/stats.ts` `anovaOneWay`/`tukeyHSD` | [Overview for One-Way ANOVA](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/anova/how-to/one-way-anova/before-you-start/overview/) | P2 |
| Welch ANOVA | 이분산 평균 비교 | 없음 | MISSING | 레지스트리 없음 | [Overview for One-Way ANOVA](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/anova/how-to/one-way-anova/before-you-start/overview/) | P2 |
| 일반선형모형(GLM) | 반응 + 요인 + **공변량**, 교호작용 차수, Type I/III SS, 모형 축소 | 반응 + 요인(2개 이상), 2원 교호작용, Type I·III SS, 적합값·잔차 | PARTIAL | `runGlm` · `lib/glm.ts` `fitGlm` (Stage 2: 요인 1개 허용, 문자 반응 거부) | [Enter your data for Fit General Linear Model](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/anova/how-to/fit-general-linear-model/perform-the-analysis/enter-your-data/) | **P1** |
| 비모수 검정 | Mann–Whitney, Wilcoxon 부호순위, Kruskal–Wallis, Mood 중앙값, 부호 검정 | 없음 | MISSING | 레지스트리 없음 | [Types of t-tests](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/supporting-topics/tests-of-means/types-of-t-tests/) | **P1** |
| 동등성 검정 | 1·2표본 동등성, 대응 동등성 | 없음 | MISSING | 레지스트리 없음 | [Which power and sample size analyses are included](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/power-and-sample-size/supporting-topics/power-and-sample-size-analyses-in-minitab/) | P2 |
| 교차표·빈도(Tally, Cross Tabulation, 카이제곱) | 지원 | 없음(Pareto가 빈도 집계만) | MISSING | 레지스트리 없음 | [Test for normality](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/supporting-topics/normality/test-for-normality/) | **P1** |
| 이상치 검정(Grubbs) | 지원 | 없음(상자그림 1.5×IQR 표시만) | MISSING | `charts.ts` `drawBoxplot` 외곽선 표시 | [Test for normality](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/supporting-topics/normality/test-for-normality/) | P2 |

---

## 4. 그래프

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 |
| --- | --- | --- | --- | --- | --- | --- |
| 산점도 변수·모드 | Y 복수, X 복수, `Each Y versus each X` / `XY Pairs` | 동일 + 한 번에 36조합 상한 (Stage 2 P0) | SUPPORTED | `runScatter` · `scatter` 슬롯 `mode` | [Scatterplot (Graph Builder)](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/graph-builder/scatterplot/) | P1 |
| 산점도 레이아웃 | Separate graphs / Overlay XY pairs | 개별 / 패널 격자 / 중첩 (셋 다) | SUPPORTED | `scatter` 슬롯 `layout` · `chartgrid` 블록 | 위 링크 | P1 |
| 그룹 변수·범례 | 그룹별 색·기호 + 범례 | 색 구분 + 범례(Stage 2 추가) | SUPPORTED | `drawScatter` `scatterLegend()` · `legend` 필드 | 위 링크 | P2 |
| By 변수 | By 변수마다 별도 그래프, `Show all combinations` | By 값을 **한 그림 안 색 구분**으로만 사용 | PARTIAL | `runScatter` `byCols` | 위 링크 | **P1** |
| 공통 눈금 | Same Y-scale / Same X-scale | 두 옵션 모두(패널), 중첩은 자동 공통 | SUPPORTED | `commonX`/`commonY` · `xDomain`/`yDomain` | 위 링크 | P2 |
| 회귀선·통계 표시 | 회귀 적합선, 방정식·R² 표시 | 회귀선 ON/OFF, r·R²·회귀식 카드 내 표시(Stage 2) | SUPPORTED | `fit`/`stats` 슬롯 · `drawScatter` `scatterNotes()` | 위 링크 | P2 |
| 축 로그 변환 | X/Y 로그 스케일 | 없음 | MISSING | `ChartSpec` 에 로그 축 없음 | 위 링크 | P2 |
| 연결선·버블·개별값 | Connect line, Bubble, Individual value plot | 없음 | MISSING | `ChartSpec` scatter 종류 | [Scatterplot create](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/scatterplot/create-the-graph/simple-scatterplot/) | P2 |
| 히스토그램 | 빈 수, 정규곡선, 그룹/패널, 백분율·밀도 축, 규격선 | 빈 수, 정규곡선, 규격선 | PARTIAL | `runHistogram` · `drawHistogram` | [Overview for Histogram](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/histogram/before-you-start/overview/) | P2 |
| 상자그림 | 그룹, 개별값 중첩, 구간그림, 이상치 | 그룹·다변량·이상치 표시 | PARTIAL | `runBoxplot` · `drawBoxplot` | [Overview of Boxplot](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/boxplot/before-you-start/overview/) | P2 |
| 시계열 그림 | 다중 열 패널/중첩, 날짜 축, Y축 원값·%·로그, By | 단일 열 + 규격선 | PARTIAL | `runTimeseries` (단일 `variable` 슬롯) | [Time Series Plot (Graph Builder)](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/graph-builder/time-series-plot/) | **P1** |
| Pareto | 빈도·가중치, 누적 80% 선, By | 빈도 + 누적% + 80% 선 | PARTIAL | `runPareto` · `drawPareto` `threshold` | [Overview for Pareto Chart](https://support.minitab.com/en-us/minitab/help-and-how-to/quality-and-process-improvement/quality-tools/how-to/pareto-chart/before-you-start/overview/) | P2 |
| 확률도 | 정규·Weibull 등 다분포, 분포 ID 도표 | 정규 확률도(CI 밴드), Weibull 확률도 | PARTIAL | `drawNormalProb` · `drawProbPlot` | [Test for normality](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/basic-statistics/supporting-topics/normality/test-for-normality/) | **P1** |
| 등고선도 | 2요인 등고선, 나머지 요인 고정값 지정 | 2요인 등고선, 나머지는 중심(0) 고정 | SUPPORTED | `lib/doe.ts` `contourGrid` · `runRsmAnalyze` | [Analyze Response Surface Design](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/doe/how-to/response-surface/analyze-response-surface-design/perform-the-analysis/enter-your-data/) | P2 |
| 산점도 행렬(Matrix Plot) | 지원 | 없음 | MISSING | — | [Scatterplot (Graph Builder)](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/graph-builder/scatterplot/) | P2 |
| 일반 막대·선 그래프 | Graph > Bar/Line | 내부 차트 종류로만 존재(사용자 메뉴 없음) | MISSING | `ChartSpec` `bar`/`line` 는 Gage·GLM 내부 전용 | [Time Series Plot](https://support.minitab.com/en-us/minitab/help-and-how-to/graphs/graph-builder/time-series-plot/) | P2 |

---

## 5. SPC · 공정능력

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 |
| --- | --- | --- | --- | --- | --- | --- |
| I-MR | 지원 | 지원 + Nelson 8규칙 | SUPPORTED | `lib/spc.ts` `imrChart` | [Xbar-R enter your data](https://support.minitab.com/en-us/minitab/help-and-how-to/quality-and-process-improvement/control-charts/how-to/variables-charts-for-subgroups/xbar-r-chart/perform-the-analysis/enter-your-data/) | P2 |
| Xbar-R | 관측값 1열 + **부분군 ID 열 또는 크기**, 행 방향 부분군 | 부분군 **크기(숫자)** 만, 상수표 2–10 | PARTIAL | `runXbarR` 슬롯 `subgroup: num` · `XBAR_CONSTANTS` | 위 링크 | **P1** |
| Xbar-S | 지원 | 지원 + 부분군 ID 열 | SUPPORTED | `runXbarS` 슬롯 `groups: col` · `xbarSCharts` | 위 링크 | P2 |
| P / NP / C / U | 지원 | 4종 모두 + 가변 표본크기 | SUPPORTED | `runPChart`·`runNpChart`·`runCChart`·`runUChart` | 위 링크 | P2 |
| Nelson 규칙 1–8 | 테스트 1–8 선택 적용 | 8규칙 전부 자동 적용·표시 | SUPPORTED | `lib/spc.ts` `nelsonRules` | 위 링크 | P2 |
| 단계(Stages)·과거 한계 | 단계별 한계, 한계 고정 | 없음(전 구간 일괄) | MISSING | `SpcPanel` 단일 center/ucl/lcl | 위 링크 | **P1** |
| 검정 선택·한계 표시 옵션 | Tests 탭, 한계 표시 | 없음 | MISSING | `runImr` 등 고정 호출 | 위 링크 | P2 |
| Box-Cox / Johnson 변환 | 관리도·능력 분석 변환 | 없음(비정규는 분포 적합으로 우회) | MISSING | — | [Normal Capability Analysis](https://support.minitab.com/en-us/minitab/help-and-how-to/quality-and-process-improvement/capability-analysis/how-to/capability-analysis/normal-capability-analysis/perform-the-analysis/enter-your-data/) | **P1** |
| 정규 공정능력 | Cp/Cpk/Pp/Ppk, PPM/DPMO, Cpm, sigma level, 부분군 | 동일 + 관측/기대 PPM 분리 | SUPPORTED | `lib/capability.ts` `capability` · `runCapability` | 위 링크 | P1 |
| 경계 규격·과거 평균/표준편차 | Boundary, Historical parameters | 없음 | MISSING | `capability` 옵션에 없음 | 위 링크 | P2 |
| 비정규 공정능력 | Weibull·lognormal·gamma·exponential·largest EV·beta·Johnson 등 | Weibull·lognormal·gamma 3종 | PARTIAL | `lib/nonnormal.ts` `nonnormalCapability` · `runNonnormal` | 위 링크 | P2 |
| Capability Sixpack | 6개 연동 그림 | 6개 연동(I-MR/Xbar-R/Xbar-S 자동 전환, 마지막 25군, 능력 요약) | SUPPORTED | `lib/sixpack.ts` `capabilitySixpack` | 위 링크 | P2 |
| Gage R&R | Crossed/Nested, ANOVA·Xbar-R 방법, 확장(요인 3+), 6-pack | Crossed/Nested, **ANOVA 방법만**, 교호작용 풀링, 5개 그림 | PARTIAL | `lib/gagerr.ts` `gageRR` · `runGageRR` | [Enter your data for Crossed Gage R&R](https://support.minitab.com/en-us/minitab/help-and-how-to/quality-and-process-improvement/measurement-system-analysis/how-to/gage-study/crossed-gage-r-r-study/perform-the-analysis/enter-your-data/) | **P1** |
| 속성 일치도(Attribute Agreement) | 지원 | 없음 | MISSING | 레지스트리 없음 | 위 링크 | P2 |
| 시료 채취(Acceptance Sampling) | 지원 | 없음 | MISSING | 레지스트리 없음 | [Pareto Chart](https://support.minitab.com/en-us/minitab/help-and-how-to/quality-and-process-improvement/quality-tools/how-to/pareto-chart/before-you-start/overview/) | P2 |
| 특성요인도(Fishbone) | 지원 | 없음 | MISSING | 레지스트리 없음 | [Pareto Chart](https://support.minitab.com/en-us/minitab/help-and-how-to/quality-and-process-improvement/quality-tools/how-to/pareto-chart/before-you-start/overview/) | P2 |

---

## 6. ANOVA · GLM · DOE · RSM

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 |
| --- | --- | --- | --- | --- | --- | --- |
| 2수준 완전요인 설계 생성 | 2–15요인, 반복, 중심점, 블록, 랜덤화 | 2–6요인 완전요인, 반복·중심점·랜덤화(시드) | SUPPORTED | `lib/doe.ts` `factorialDesign` · `runDoeCreate` | [Create 2-Level Factorial Design](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/doe/how-to/factorial/create-factorial-design/create-2-level-factorial-default-generators/create-the-design/specify-the-type-of-design/) | P1 |
| 부분요인·Plackett–Burman | 지원 | 없음(완전요인만) | MISSING | `factorialDesign` 은 `2**k` 전부 | 위 링크 | **P1** |
| 블록 | 지원 | 없음 | MISSING | `DesignRun` 에 block 없음 | 위 링크 | P2 |
| 요인설계 분석 | 주효과·교호작용(차수 선택), 적합결여, 별칭, 잔차 그림 | 3차까지, 적합결여·순수오차, 별칭 표시, 잔차 그림 | PARTIAL | `analyzeFactorial` · `runDoeAnalyze` | 위 링크 | **P1** |
| CCD 생성 | 회전성 α, 블록, 반복 | 회전성 α=(2^k)^{1/4}, 중심점, 랜덤화 | SUPPORTED | `ccdDesign` | [Analyze Response Surface Design](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/doe/how-to/response-surface/analyze-response-surface-design/perform-the-analysis/enter-your-data/) | P2 |
| Box–Behnken 생성 | 지원 | 지원(3–5요인) | SUPPORTED | `boxBehnkenDesign` · `runRsmCreate` `design: bbd` | 위 링크 | P2 |
| RSM 분석 | 2차 모형, 적합결여, 정상점, 등고선 | 동일 + 정상점 유형·실험영역 경고 | SUPPORTED | `analyzeRsm` · `contourGrid` | 위 링크 | P2 |
| 반응 최적화(Response Optimizer) | 다중 반응 목표 최적화 | 없음 | MISSING | — | 위 링크 | **P1** |
| 다중 반응·혼합물·다구찌 | 지원 | 없음(반응 1개) | MISSING | `runRsmAnalyze` 슬롯 `response: col` | 위 링크 | P2 |
| 설계 워크시트 출력 | StdOrder/RunOrder/PtType/요인/Y 열 | 동일(코딩 단위 + Y 열) | SUPPORTED | `designWorksheet` | 위 링크 | P2 |

---

## 7. 신뢰성 · 검정력

| 항목 | Minitab | Sigrún | 분류 | 코드 근거 | 공식 문서 | 우선순위 |
| --- | --- | --- | --- | --- | --- | --- |
| Weibull 2모수 MLE + 우측 중도절단 | 지원 | 지원(프로파일 우도, 신뢰구간) | SUPPORTED | `lib/reliability.ts` `fitWeibull` · `runWeibull` | [Parametric Distribution Analysis](https://support.minitab.com/en-us/minitab/help-and-how-to/statistical-modeling/reliability/how-to/parametric-distribution-analysis/before-you-start/overview/) | P1 |
| 로그정규 비교 적합 | 지원 | 동일 표본 로그정규 적합 병기 | SUPPORTED | `fitLognormalReliability` | 위 링크 | P2 |
| 분포 11종·분포 ID 도표 | 11개 분포, Distribution ID Plot | Weibull·로그정규만 | PARTIAL | `runWeibull` · `capnonnormal` 분포 3종 | 위 링크 | **P1** |
| 구간·좌측 중도절단 | 지원 | 우측 중도절단만 | MISSING | `WeibullInput` 은 `censored: boolean` | 위 링크 | P2 |
| 생존·위험 함수·신뢰밴드 | 지원 | 지원(생존·위험·CI 밴드) | SUPPORTED | `runWeibull` `survivalPoints`/`hazardPoints`/`ciBand` | 위 링크 | P2 |
| 3모수 Weibull | 지원 | 없음 | MISSING | `fitWeibull` 2모수 | 위 링크 | P2 |
| 보증분석·성장곡선·재발 | 지원 | 없음 | MISSING | — | 위 링크 | P2 |
| 검정력(1t·2t·대응t·ANOVA·1비율·2비율) | 지원 | 6종 모두, n/검정력/차이 풀이 | SUPPORTED | `runPowerAnalysis` · `lib/power.ts` `solvePower` | [Which power and sample size analyses](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/power-and-sample-size/supporting-topics/power-and-sample-size-analyses-in-minitab/) · [1-Sample t formulas](https://support.minitab.com/en-us/minitab/help-and-how-to/statistics/power-and-sample-size/how-to/hypothesis-tests/power-and-sample-size-for-1-sample-t/methods-and-formulas/methods-and-formulas/) | P1 |
| 1표본 Z·등가성·회귀·DOE 검정력 | 지원 | 없음 | MISSING | `PowerMethod` 목록 | 위 링크 | P2 |
| 공차구간(Tolerance Interval) | 지원 | 없음 | MISSING | — | 위 링크 | P2 |

---

## 8. Stage 2 입력 변수 감사 — 발견과 조치

`tests/input-audit.test.ts` 가 40개 분석 전부를 하나의 감사용 워크시트(숫자·문자·날짜·결측·상수·짧은 열)에 대해 실행하고, 아래 항목을 자동으로 검사한다.

1. 등록된 모든 분석에 감사 케이스가 있는가
2. 모든 슬롯 라벨이 en/ko 양쪽에 있는가
3. 필수 슬롯을 비우면 **거부**하는가(빈 표·0건 성공이 아니라)
4. 숫자 슬롯이 문자·날짜 열을 **거부**하는가
5. 리스트 슬롯이 프로젝트 파일의 **문자열(단일 열)** 을 견디는가
6. 같은 열을 리스트에 중복해도 죽지 않는가
7. 선택 슬롯(by, sizes, unitSizes, groups, censor)이 실제로 결과를 바꾸는가
8. 짧은 열·빈 열이 NaN 표를 만들지 않는가

| # | 발견 | 심각도 | 조치 | 근거/테스트 |
| --- | --- | --- | --- | --- |
| D-01 | 산점도 Y·X 가 각각 1개 열만 선택 가능 | P0 | Y 복수·X 복수, `Each Y versus Each X`/`XY Pairs`, 레이아웃 3종, 그룹·공통눈금·회귀선·통계 옵션 구현 | `tests/scatter-stage2.test.ts` (21) |
| D-02 | 조합마다 유효 관측치·회귀가 독립이어야 함(다중회귀와 혼동 금지) | P0 | 조합별로 완전한 행만 사용, 조합별 단순회귀·r 계산 | 같은 파일 “fits a simple regression for each pair” |
| D-03 | 그룹 산점도에 **범례가 없어** 색을 해석할 수 없음 | P1 | `scatterLegend()` 로 그룹/시리즈 범례(8개 + more) | 같은 파일 “colours the groups … legend” |
| D-04 | 산점도에서 문자 열을 고르면 “관측값 부족”으로만 안내 | P1 | `res.numericOnly` + 열 이름 전달(`errorText` 의 `|` 변수 파싱) | 입력 감사 “refuses text/date” |
| D-05 | 기술통계: 변수 목록이 비어도 **빈 표를 성공으로 출력** | P1 | `req.input` | 입력 감사 “desc: variables is required” |
| D-06 | 기술통계: 문자 열을 `N=0`, `*` 표로 조용히 출력 | P1 | `numericColumns()` 로 거부 | 입력 감사 “desc: variables refuses text” |
| D-07 | `by` 슬롯에 문자열(구 프로젝트)이 오면 `byRefs.map is not a function` 크래시 | P0 | `refList()` 를 `buildGroups`·기술통계·상자그림·회귀·GLM·DOE에 적용 | 입력 감사 “accepts a list slot saved as a bare string” |
| D-08 | Recode: 열 미선택 시 “0건 변환” 성공, 매핑 없으면 빈 표 | P1 | `req.input` · `res.recodeNoMapping` | 입력 감사 “recode: column is required” |
| D-09 | 표준화: 열 미선택 시 “관측값 부족”, 문자 열도 같은 메시지 | P1 | `numericColumn()` | 입력 감사 |
| D-10 | P/NP/C/U 관리도: 문자 열에서 영어 “Sample 1: the value is not a number…” 24줄 | P1 | 열 유형 선검사 → `res.numericOnly` | 입력 감사 “pchart/npchart/cchart/uchart refuses text” |
| D-11 | I-MR·Xbar-R/S·공정능력·식스팩·비정규능력·시계열: 열 미선택이 “관측값 부족” | P2 | `req.input` | 입력 감사 “required slot is empty” |
| D-12 | 상자그림: 문자 열이 빈 그룹으로 통과 | P1 | `numericColumns()` | 입력 감사 |
| D-13 | 회귀: 문자 예측변수·반응이 조용히 null 처리 | P1 | `numericColumn()`/`numericColumns()` | 입력 감사 |
| D-14 | GLM/DOE/RSM: 문자 반응에서 엉뚱한 `res.needFactors` | P1 | 반응 숫자 검사 선행 | 입력 감사 |
| D-15 | GLM 이 요인 1개를 거부(Minitab은 허용) | P2 | 요인 1개 허용 | 입력 감사 “glm produces output” |
| D-16 | 실행 함수의 `dlg.required` 가 `{slot}` 자리표시자를 그대로 노출 | P1 | `req.input` 키로 통일(대화상자 검증은 기존 `dlg.required` 유지) | `App.errorText` |
| D-17 | 오류 메시지가 값(열 이름)을 실어 보낼 수 없음 | P1 | `key|col=Speed` 형식 파싱 → `t(lang, key, vars)` | `App.errorText` |
| D-18 | 조합 수에 상한이 없어 6×6만 넘어도 탭이 멈출 수 있음 | P2 | 36조합 상한 + `res.scatterTooMany` | `tests/scatter-stage2.test.ts` “refuses a wall of plots” |

**감사 후 남은 것(의도적으로 이번 범위 밖)**: 문자 Recode, 상관분석 도구, 날짜 값 연산, 열 서식/유형 변경. 모두 §2–§7 의 P1/P2 항목으로 등록했다.

---

## 9. 적용 불가 / 미확인

| 항목 | 분류 | 이유 |
| --- | --- | --- |
| `.mpx` 바이너리 프로젝트 호환 | NOT_APPLICABLE | Minitab 데스크톱 전용 컨테이너. Sigrún은 `.sigrun.json` 으로 동등 기능 제공 |
| 매크로·커맨드 언어, COM 자동화 | NOT_APPLICABLE | 브라우저 단일 페이지 앱에는 실행 환경이 없음 |
| Predictive Analytics Module(CART/TreeNet/Random Forests/MARS) | UNKNOWN | 별도 유료 모듈이며 공개 문서만으로 옵션 전수 대조를 마치지 못함 |

---

## 10. 권고 순서

**P1 (다음 스테이지 후보, 사용자 흐름이 끊기는 순서)**
1. 상관분석 도구(Pearson·Spearman, 행렬, p·CI) — 산점도는 r만 보여 준다.
2. GLM 공변량 + 모형 축소, 회귀의 범주 예측변수·교호작용.
3. 관리도 단계(Stages)·부분군 ID 열(Xbar-R), Box-Cox.
4. 비모수 검정 4종 + 교차표/카이제곱.
5. DOE 부분요인·Plackett–Burman, 반응 최적화, 요인설계 블록/중심점 곡률.
6. 신뢰성 분포 ID·3모수 Weibull, Gage R&R Xbar-R 방법.
7. 다중 시계열(패널/중첩), 산점도 By 별도 그래프, 문자 Recode, 열 유형 변환.

**P2**: 로그 축, 행렬도, 일반 막대/선, 경계 규격·과거 모수, 속성 일치도, 공차구간, 시료 채취, 특성요인도, 결측 `*` 표시, 열 서식.

---

## 11. 재현 방법

```bash
npx tsc --noEmit        # 0 errors
npm test                # 전체 단위 테스트(입력 감사·산점도 Stage 2 포함)
npm run qa:stats        # 156/156, SciPy·statsmodels 대조
npm run build           # vite 프로덕션 빌드
```

감사 자체를 다시 돌려 보려면 `tests/input-audit.test.ts` 의 `CASES` 표를 읽으면 된다. 40개 분석 각각의 “정상 입력”과 “숫자 전용 슬롯”이 한 곳에 모여 있어, 새 분석을 추가할 때 이 표에 한 줄을 더하지 않으면 테스트가 실패한다.
