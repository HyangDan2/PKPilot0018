# Sigrún 통계 엔진 인벤토리 · QA Phase 1

- 대상: `HyangDan2/PKPilot0018`, `main` `0bfe385` (QA 착수 시점) — 이후 후속 QA(REVIEW 3·UNVERIFIED 9 해소, Section 7)로 케이스 확장
- 범위: `src/lib/` 전체 (통계 엔진 12개 모듈 + 유틸 9개) 및 `analyses.ts`의 **분석 40종**
- 방법: 엔진을 브라우저 UI 없이 Node에서 직접 호출하는 어댑터(`qa/adapters/sigrun/`)와 Python 독립 기준 엔진(`qa/reference/`)을 만들어 케이스 205건으로 대조. 산출물은 `qa/reports/latest.html`.
- 표기: **검증** 열의 `PASS n`은 `qa/cases`의 통과 케이스 수, `REVIEW`/`UNVERIFIED`는 5단계 판정에서 PASS로 합산하지 않는 항목이다.

## 0. 요약

| 항목 | 값 |
| --- | --- |
| `analyses.ts` 분석 ID | 40 (계산 31 / 시각화·유틸 9) |
| `src/lib` 모듈 | 21 (통계 12 + 지원 9) |
| 수치 검증 케이스 | 205 (PASS 205 · FAIL 0 · REVIEW 0 · UNVERIFIED 0 · ERROR 0 — Phase 3B Corrective QA 종료 시점) |
| 10대 데이터 유형 | 전부 구성 (`qa/datasets/`, 25개 파일, 차트·변환용 `charts` 추가) |
| 기존 단위 테스트 | 12개 파일 280건 (QA-01~QA-15 + followup-qa 회귀 포함) |

## 1. 분석 40종 인벤토리

### 1.1 기초 통계 · 가설검정

| # | ID / 명칭 | 구현 (파일 · 함수) | 입력 · 필수 파라미터 | 출력 통계량 | 공식 / 추정 방법 | 독립 기준 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `desc` 기술통계 | `analyses.ts runDescriptive` → `stats.summarize`, `mean` | 수치 열 1개 이상, 선택 `By` 열 | N, N*, 합, 평균, SE Mean, 표준편차, 분산, 변동계수, 최소·Q1·중앙값·Q3·최대, IQR, 범위, 왜도, 첨도 | 평균·s는 n−1; 사분위는 **type-6**(h=(n+1)p, Excel R-7/Minitab); 왜도 G1=n/((n−1)(n−2))Σz³, 첨도 G2(초과) — `scipy.stats.skew/kurtosis(bias=False)` 정의와 동일 | NumPy `quantile(method='weibull')`, SciPy skew/kurtosis | PASS 6 (QA-A-01~06) |
| 2 | `normality` 정규성 검정 | `analyses.ts runNormality` → `stats.adNormality` | 수치 열, n≥3, s>0 | A², A*, p, 평균·sd, 확률도 | A²=−n−(1/n)Σ(2i−1)[lnFᵢ+ln(1−F_{n+1−i})] (F=적합 정규), A*=A²(1+0.75/n+2.25/n²), p는 D'Agostino & Stephens(1986) 구간식 | SciPy `anderson('norm')` (A²) + 공개 p식 | PASS 4 (QA-A-07~10) — `ad_erf` 클래스: 엔진 normalCdf의 A&S erf 오차 |
| 3 | `t1` 1표본 t | `runT1` → `stats.tTest1` | 수치 열, μ₀, 신뢰수준, 대립가설 | 평균, 차이, SE, df, t, p, CI, n, s | t=(x̄−μ₀)/(s/√n), df=n−1, CI는 t분위수; 단측 CI는 반대쪽 ±∞; s=0이면 t·p는 NaN(QA-X 규약) | SciPy `ttest_1samp`, `t.ppf` | PASS 6 (QA-A-11~14, QA-X-04) |
| 4 | `t2` 2표본 t | `runT2` → `stats.tTest2` | 두 수치 열, Welch/등분산, 신뢰수준, 대립가설 | 두 평균·s·n, 차이, SE, df, t, p, CI, 등분산 F검정 | Welch df=(s₁²/n₁+s₂²/n₂)²/[…]; pooled는 sp²(1/n₁+1/n₂), df=n₁+n₂−2; F검정 p=2·min(F,1−F); s=0이면 t·p는 NaN(QA-X 규약) | SciPy `ttest_ind(equal_var=…)`, `f.cdf` | PASS 5 (QA-A-15~17, QA-X-05) |
| 5 | `paired` 대응표본 t | `runPaired` → `stats.pairedT` | 두 수치 열(행 대응), μ₀, 신뢰수준, 대립가설 | 짝 수, 두 평균, 차이, μ₀ 대비 차이, SE, df, t, p, CI | 행별 d=A−B(양쪽 유효한 행만), t=(d̄−μ₀)/(s_d/√n), **CI는 d̄ 중심**(μ₀는 검정에만); s_d=0이면 t·p는 NaN(구 0/±∞ 규약 폐기, QA-X-06) | SciPy `ttest_rel`(μ₀=0) + `ttest_1samp(d, μ₀)` | PASS 4 (QA-A-18~20, QA-X-06) |
| 6 | `anova` 일원 ANOVA + Tukey | `runAnova` → `stats.anovaOneWay`, `tukeyHSD`, `groupingLetters` | 반응 수치 열 + 요인 열, 신뢰수준 | SS/df/MS(Between·Within), F, p, 풀링 s, q, 쌍별 diff·SE·CI·p, 컴팩트 문자 | SSB=Σnᵢ(x̄ᵢ−x̄)², SSW=ΣΣ(x−x̄ᵢ)²; Tukey 반폭=q_{α,k,df}/√2·√(MSW(1/nᵢ+1/nⱼ)), p=P(Q>√2|d|/SE) | SciPy `f_oneway`, `studentized_range` | PASS 3 (QA-A-21·22, QA-B-01) — `studentized_range` 클래스 |
| 7 | `regression` 다중회귀 | `runRegression` → `stats.regress` | 반응 열 + 예측변수 1개 이상 | 항별 계수·SE·t·p·VIF, ANOVA 표, R²·R²adj·R²pred, s, 잔차 | 정규방정식 XᵀXβ=Xᵀy(가우스 소거+역행렬), VIF=1/(1−R²ⱼ), R²pred=1−PRESS/SST(hat 대각) | statsmodels OLS + `variance_inflation_factor` + PRESS | PASS 2 · FAIL→수정 0 (QA-A-23·24) · 경계 2 (QA-X-02·03) |
| 24 | `glm` 일반선형모형 | `runGlm` → `glm.fitGlm`, `buildDesign` | 반응 열 + 요인(범주/수치) + 교호작용 옵션 | 항별 df·Type I SS·Type III SS·MS·F·p, dfe, SSE, MSE, s, R², rank, alias | Sum-to-zero(deviation) 코딩, Householder QR + 열 피벗(정규방정식 회피), Type I=순차 SS, Type III=열 제거 후 재적합 SS 차; rank-deficient는 모형 불변량(fitted·residuals·SSE·R²·alias 수)으로 검증 | statsmodels `ols` + `anova_lm(typ=1/3)` `C(f, Sum)` | PASS 5 (QA-B-02~06 — B-06은 모형 불변량 기준) |

### 1.2 관리도 (SPC)

| # | ID / 명칭 | 구현 | 입력 · 필수 | 출력 | 공식 / 추정 | 독립 기준 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | `imr` I-MR | `runImr` → `spc.imrChart` | 수치 열(개별값) | I·MR 중심선·관리한계·σ, 위반점, 규칙별 점수 | σ=MR̄/d₂(2), I한계=x̄±3σ; MR한계=D₄(2)MR̄, σ_MR=d₃(2)MR̄/d₂(2) | Montgomery Table VI d₂/d₃ + 폐형식 D₄=1+3d₃/d₂; Nelson(1984) 규칙 독립 구현 | PASS 2 (QA-C-01·02) — `chart_constants` 클래스 |
| 9 | `xbarr` Xbar-R | `runXbarR` → `spc.xbarRCharts` | 수치 열, 부분군 n(2~10) | 두 패널 한계·σ, 부분군 요약(사용/건너뜀/잔여/결측/가변) | 결측 부분군은 자체 nᵢ 유지, σ=Σ((nᵢ−1)/W)·Rᵢ/d₂(nᵢ) 가중, 한계는 A₂(nᵢ)·d₂(nᵢ) 기반 | d₂/d₃ 표 + 정의식, 부분군별 nᵢ 가중 | PASS 4 (QA-C-03~05, QA-C-16 오류) |
| 10 | `pchart` P | `runPChart` → `spc.pChart` | 불량수 열 + (크기 열 또는 상수) | p̄, 점별 UCL/LCL·σ, 위반 | p̄=Σd/Σn, σᵢ=√(p̄(1−p̄)/nᵢ), 한계 [0,1] 클램프 | 독립 공식 + Nelson | PASS 2 (QA-C-08·09) · 오류 1 (QA-C-15) |
| 11 | `npchart` NP | `runNpChart` → `spc.npChart` | 불량수 열, 고정 n | np̄, 한계, σ | σ=√(np̄(1−p̄)), UCL=min(n, np̄+3σ) | 독립 공식 | PASS 1 (QA-C-10) |
| 12 | `cchart` C | `runCChart` → `spc.cChart` | 결함수 열 | c̄, 한계, σ | σ=√c̄ | 독립 공식 | PASS 1 (QA-C-11) |
| 13 | `uchart` U | `runUChart` → `spc.uChart` | 결함수 + 단위 크기(열/상수) | ū, 점별 한계·σ | σᵢ=√(ū/nᵢ) | 독립 공식 | PASS 2 (QA-C-12·13) |
| 14 | `xbars` Xbar-S | `runXbarS` → `spc.xbarSCharts` | 수치 열, n(≥2) 또는 그룹ID 열 | 두 패널 한계·σ | c₄(n)=√(2/(n−1))Γ(n/2)/Γ((n−1)/2), σ=S̄/c̄₄, A₃=3/(c₄√n), B₃·B₄ | c₄ 폐형식 + 정의식 | PASS 2 (QA-C-06·07) |
| — | Nelson 규칙 1~8 | `spc.nelsonRules` | 값 배열, 중심선, σ(스칼라/배열) | 점별 위반 규칙 목록 | Nelson (1984) JQT 16(4); 규칙7=15점 1σ 이내, 규칙8=8점 1σ 밖, 규칙4=14점 교대 | 규칙 문헌 독립 구현 | PASS 1 (QA-C-14, 56점 전수) |

### 1.3 공정능력

| # | ID / 명칭 | 구현 | 입력 · 필수 | 출력 | 공식 / 추정 | 독립 기준 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 15 | `capability` 공정능력 | `runCapability` → `capability.capability` | 수치 열, 규격(LSL/USL 중 1개 이상), 목표(선택), 부분군, σ 방식 | Cp/Cpk/CPL/CPU, Pp/Ppk/PPL/PPU, Cpm, 기대·관측 PPM, 시그마 수준 | within σ: 개별=MR̄/1.128, 부분군=풀링 s; Cpm은 전체 σ+목표 필수; σ수준 z_bench(+1.5)·z_bench·3Cpk+1.5 | 공개 정의식 + SciPy 정규 꼬리 | PASS 7 (QA-D-01~07) — `ppm`, `sigma_level` 클래스 |
| 16 | `sixpack` Capability Sixpack | `runSixpack` → `sixpack.capabilitySixpack` | 수치 열, 부분군(1~25), 규격, σ 방식 | n≤1 I-MR / 2~10 Xbar-R / 11+ Xbar-S, 위치·산포 차트, 최근 25 부분군, 히스토그램, 확률도, 능력 요약 | 차트와 Cp/Cpk가 **동일 within σ**(MR̄/d₂, R̄/d₂, S̄/c₄) 공유 | 공개 정의식 + c₄ 폐형식 | PASS 5 (QA-D-08~11·17) |
| 17 | `capnonnormal` 비정규 능력 | `runNonnormal` → `nonnormal.fitNonnormal`, `nonnormalCapability` | 수치 열(>0), 분포(Weibull/Lognormal/Gamma), 규격 | MLE 모수, logLik, AD·A*·판정밴드, 분위수 기반 Pp/Ppk/PPU/PPL/PPM, 제외 수 | Weibull 프로파일 우도(황금분할), Lognormal 폐형/로그, Gamma Minka+Newton; AD는 적합 CDF 기준, A*=A²(1+0.2/√n); 능력은 ISO 22514-4 분위수형 | SciPy `weibull_min/lognorm/gamma.fit(floc=0)` | PASS 5 (QA-D-12~16) — `mle` 클래스 |
| — | 로그노말 신뢰성(내부) | `reliability.fitLognormalReliability` | 시간·검열(우측), 신뢰수준 | μ, σ, 중앙값, MTTF, logLik, SE, 폐형 여부 | 검열 MLE(Nelder–Mead), 완전데이터는 ln t의 평균·모표준편차 | SciPy `lognorm.fit(CensoredData)` | PASS 3 (QA-F-08·09·11) — `nelder_mead` 클래스 |

### 1.4 Gage R&R · 신뢰성 · 검정력 · DOE

| # | ID / 명칭 | 구현 | 입력 · 필수 | 출력 | 공식 / 추정 | 독립 기준 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 18 | `gagerr` Gage R&R | `runGageRR` → `gagerr.gageRR` | 부품·교대·측정 열, type(crossed/nested), 공차, studyVar, 교호작용 풀링 | ANOVA 표(SS·MS·F·p), 분산성분 7종(분산·s·%기여·%StudyVar·%Tolerance), GRR·총분산, ndc, 음수성분 목록 | EMS 기반: σ²_repeat=MS_e, σ²_po=(MS_int−MS_e)/n, σ²_op=(MS_op−MS_int)/(p·n), σ²_part=(MS_part−MS_int)/(o·n); 음수는 부호 유지·s=0 | NIST/SEMATECH 2.5.5.5 폐형식 + SciPy F | PASS 5 (QA-E-01~05) · 오류 2 (QA-E-06·07) |
| 19 | `weibull` Weibull 신뢰성 | `runWeibull` → `reliability.fitWeibull` | 시간 열(>0), 검열 열/코드(선택), 신뢰수준 | 형상·척도(SE·CI), logLik, MTTF(CI), B5/B10/B50/B90, AD·A*·기준밴드, AD 부트스트랩 p, KM 편차, 확률도 | 프로파일 우도 η(β)=(Σt^β/r)^{1/β} + 황금분할, (β, lnη) Newton 보정, 관측정보 Hessian SE, 델타법 CI; AD는 고장시각의 적합 CDF 기준 | SciPy `weibull_min.fit(CensoredData)` + 수치 Hessian + 독립 AD/KM + B=2000 부트스트랩 | PASS 8 (QA-F-01~07·12) · 오류 2 (QA-F-10, QA-X-01) — `bootstrap_p` 클래스 |
| 20 | `power1t` 1표본 t 검정력 | `runPowerAnalysis('oneT')` → `power.solvePower` | 해석 대상(n/검정력/효과), δ, σ, α, 대립가설 | n, 검정력, 효과(부호 유지) | 비중심 t 정확 검정력, ncp=δ√n/σ, df=n−1 | statsmodels `TTestPower`(비중심 t) | PASS 6 (QA-G-01~03, 16, 18, 20) |
| 21 | `power2t` 2표본 t | `('twoT')` | 위와 동일, n=그룹당 | 동일 | ncp=δ√(n/2)/σ, df=2(n−1) | statsmodels `TTestIndPower` | PASS 4 (QA-G-04~06) — **엔진 결함 F-01 발견·수정 지점** |
| 22 | `powerpaired` 대응 t | `('paired')` | 위와 동일, σ=차이의 sd | 동일 | 1표본 t와 같은 ncp | statsmodels `TTestPower` | PASS 2 (QA-G-07, 18) |
| 23 | `poweranova` 일원 ANOVA | `('anova')` | δ, σ, 수준 수 k, n/검정력 | 동일 | ncp=nkδ²/(4σ²), df1=k−1, df2=k(n−1) | statsmodels `FTestAnovaPower` | PASS 2 (QA-G-08·09) |
| 24 | `powerprop1` 1비율 | `('oneProp')` | p₀, p_a, n/검정력, 대립가설 | 동일 | 정규근사: SE₀=√(p₀(1−p₀)/n), SE₁=√(p_a(1−p_a)/n), 양측은 두 꼬리 합 | 공개 정규근사식(Chow et al.) — Minitab 정확법과 다른 정의 | PASS 5 (QA-G-10~12, 17, 19) |
| 25 | `powerprop2` 2비율 | `('twoProp')` | p₁, p₂, n(그룹당) | 동일 | 풀링 SE₀=√(2p̄(1−p̄)/n), 비풀링 SE₁ | 동일 | PASS 4 (QA-G-13~15, 21) |

| # | ID / 명칭 | 구현 | 입력 · 필수 | 출력 | 공식 / 추정 | 독립 기준 | 검증 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 26 | `doecreate` 요인설계 생성 | `runDoeCreate` → `doe.factorialDesign`, `designWorksheet` | 요인 수 k(2~6), 반복, 중심점, 랜덤화·시드 | StdOrder/RunOrder/PtType/요인 수준/Y 열 | 표준순서=2^k 이진 패턴(고차 요인 최상위 비트), 실행순서=mulberry32 셔플(문서화된 PRNG) | 조합 정의 + 동일 PRNG 독립 구현 | PASS 4 (QA-H-01~03, QA-H-10 오류) |
| 27 | `doeanalyze` 요인분석 | `runDoeAnalyze` → `doe.analyzeFactorial` | 반응 열 + 요인 열, 차수(1~3) | 항별 효과·계수·SE·t·p, SSE, dfe, R², s | 코딩(−1/0/+1) 회귀, 효과=2×계수 | statsmodels OLS | PASS 2 (QA-H-06·07) |
| 28 | `rsmcreate` RSM 설계 | `runRsmCreate` → `doe.ccdDesign`, `boxBehnkenDesign` | CCD/BBL, k(2~5), 중심점, 랜덤화·시드 | 실행표(Std/Run/PtType/수준) | CCD: 2^k + 축점(α=(2^k)^{1/4}) + 중심점; BBD: 12 edge + 중심점 | 조합 정의 + 동일 PRNG | PASS 2 (QA-H-04·05) |
| 29 | `rsmanalyze` RSM 분석 | `runRsmAnalyze` → `doe.analyzeRsm`, `contourGrid` | 반응 열 + 요인 2개 이상(코딩) | 선형·제곱·교호 SS/df, 순수오차·적합결여, 2차 계수, 정지점·고유값·종류·영역 밖 여부 | 완전 2차 모형 OLS, x*=−½B⁻¹b, 고유값 부호로 max/min/saddle, |x*|>α면 영역 밖 | statsmodels OLS + `anova_lm(typ=3)` + NumPy 고유분해 | PASS 2 (QA-H-08·09) |

### 1.5 계산기 · 시각화 · 유틸 (독립 기준 유무)

| # | ID / 명칭 | 구현 | 입력 | 출력 | 방법 | 검증 |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | `calculator` 수식 계산 | `runCalculator` → `calc.evaluateFormula` | 수식 문자열, 저장 열 | 행별 결과(또는 상수), 오류 행 수 | 자체 토크나이저·재귀하강 파서, 집계함수 처리 | PASS 4 (QA-I-01~04) |
| 31 | `pareto` 파레토 | `analyses.runPareto` | 범주 열 | 항목·건수·%·누적% | 러너 실호출 + 독립 value_counts 대조 | PASS (QA-U-01) |
| 32 | `histogram` 히스토그램 | `runHistogram` → `charts.histogramBins`, `charts.histogramCurve` | 수치 열, 빈 수, 규격 | 빈 경계·건수, 정규곡선 | 빈 규칙 max(5,min(20,⌈1+log₂n⌉))과 121점 정규곡선을 문서 기준으로 독립 재구현해 대조 | PASS (QA-U-02) |
| 33 | `boxplot` 상자그림 | `runBoxplot` → `charts.boxplotStats` | 수치 열, By | 사분위·수염·이상치 | type-6 사분위 + 1.5·IQR 수염 규칙 독립 재구현(`numpy.quantile(method='weibull')`) | PASS (QA-U-03) |
| 34 | `scatter` 산점도 | `runScatter` → `stats.regress` | y, x, By | 점·적합선 | 적합선은 `scipy.stats.linregress`, 군별 매핑은 첫등장 순 독립 대조 | PASS (QA-U-04) |
| 35 | `timeseries` 시계열 | `runTimeseries` | 수치 열, 규격 | 점·규격선 | 유한 시퀀스 통계 + 규격선 값·존재 독립 대조 | PASS (QA-U-05) |
| 36 | `random` 난수 생성 | `runRandom` → `random.generateRandom` | 분포, 개수, 모수, 시드 | 생성 열 | 모평균/모표준편차 대비 4×표본오차 허용오차 + 동일 시드 재실행 차이 0 검증 | PASS (QA-U-09) |
| 37 | `sort` 정렬 | `runSort` | 열, 오름/내림 | 행 재배열 시트 | `pandas.sort_values`(안정, 결측 마지막)와 열 전체 대조(id 열 동반 이동) | PASS (QA-U-06) |
| 38 | `standardize` 표준화 | `runStandardize` | 열 | Z 열 | (x−x̄)/s 독립 재계산 + z 평균≈0·s≈1 | PASS (QA-U-07) |
| 39 | `recode` 코드 변환 | `runRecode` | 열, 매핑, 기본값 | 변환 열 | 매핑·미매핑 보존·결측 보존 독립 대조 | PASS (QA-U-08) |
| 40 | (내부) 분포함수 | `dist.ts` 전 함수 | x, 모수 | pdf/cdf/분위수 | 정규(A&S erf, Acklam 역), t/F(불완전베타), 감마(급수+CF), studentized range(Simpson), 비중심 t/F | PASS 24 (QA-A-25~48) — `prob`·`normal_inv`·`nct_quad`·`studentized_range` 클래스 |

## 2. `src/lib` 모듈 인벤토리

| 모듈 | 크기 | 주요 공개 함수 | 성격 | 검증 |
| --- | --- | --- | --- | --- |
| `stats.ts` | 19.7 KB | `summarize`, `adNormality`, `tTest1/2`, `pairedT`, `anovaOneWay`, `tukeyHSD`, `groupingLetters`, `regress`, `normalScores`, `clean/mean/stdev/quantile` | 기초통계·검정·회귀 | PASS 25+ |
| `spc.ts` | 21.8 KB | `nelsonRules`, `imrChart`, `xbarRCharts`, `xbarSCharts`, `pChart`, `npChart`, `cChart`, `uChart`, `c4Constant`, `SpcValidationError` | 관리도 | PASS 13 |
| `capability.ts` | 7.9 KB | `capability`, `movingRangeSigma`, `withinSubgroupSigma`, `sigmaLevelOf` | 공정능력 | PASS 7 |
| `sixpack.ts` | 5.5 KB | `capabilitySixpack` | 6-pack 결합 | PASS 5 |
| `nonnormal.ts` | 10.0 KB | `fitNonnormal`, `nonnormalCapability` | 비정규 MLE·능력 | PASS 5 |
| `gagerr.ts` | 15.5 KB | `gageRR`, `percentTolerance` | MSA | PASS 7 |
| `glm.ts` | 18.0 KB | `lstsq`, `buildDesign`, `fitGlm`, `cellMeans` | 선형모형 코어 | PASS 5 |
| `doe.ts` | 18.3 KB | `factorialDesign`, `ccdDesign`, `boxBehnkenDesign`, `designWorksheet`, `analyzeFactorial`, `analyzeRsm`, `contourGrid` | 실험계획·RSM | PASS 8 |
| `reliability.ts` | 24.1 KB | `fitWeibull`, `fitLognormalReliability`, `WEIBULL_AD_BOOTSTRAP_REPS` | 신뢰성 | PASS 11 |
| `power.ts` | 17.3 KB | `solvePower`, `powerAt`, `powerCurve`, `differenceRange` | 검정력 | PASS 21 |
| `dist.ts` | 14.6 KB | 정규·t·F·χ²·감마·베이불·로그노말·비중심 t/F·studentized range·`logGamma` | 분포 코어 | PASS 24 |
| `calc.ts` | 11.1 KB | `evaluateFormula`, `formulaColumns` | 수식 엔진 | PASS 4 |
| `charts.ts` | 49.5 KB | `histogramBins`, `histogramCurve`, `boxplotStats`, `renderChart`, `inlineTheme` | SVG 차트 | PASS 3 (QA-U-02·03) / 단위테스트 24 |
| `datasets.ts` | 10.7 KB | `makeWorksheet`, 샘플 데이터셋 정의 | 워크시트 생성 | 간접(어댑터 사용) |
| `random.ts` | 1.5 KB | `mulberry32`, `normalRandom`, `generateRandom` | PRNG | PASS (QA-U-09 모멘트·결정성) |
| `format.ts` | 1.2 KB | `fmt`, `fmtP`, `fmtInt`, `fmtTime`, `fmtDate` | 표시 형식 | UNVERIFIED(표시) |
| `i18n.ts` | 79.4 KB | `t` | 다국어 문구 | 단위테스트 4 |
| `project.ts` | 10.6 KB | 프로젝트 직렬화, CSV 파서, 구분자 감지 | 입출력 | 단위테스트 23 |
| `xlsx.ts` | 7.8 KB | Excel 읽기/쓰기 | 입출력 | 단위테스트(round-trip) |
| `db.ts` | 2.9 KB | IndexedDB 자동저장 | 저장소 | UNVERIFIED(브라우저 전용) |
| `types.ts` | — | `Worksheet`, `Column`, `Block`, `ChartSpec` | 타입 | — |

## 3. 기존 테스트 재사용 현황

`npm test` = 12개 파일 **280건** (전부 통과). 새 QA 체계는 이를 대체하지 않고 **중복 없이 보완**한다.

| 파일 | 건수 | 다루는 범위 | 이번 QA와의 관계 |
| --- | --- | --- | --- |
| `tests/stats.test.ts` | 24 | 분포·기술통계·AD·t·ANOVA·회귀 | 손계산·표값 기준을 유지 |
| `tests/spc.test.ts` | 23 | Nelson 1~4, I-MR, Xbar-R, P, 능력 | 규칙 5~8은 QA-C-14가 보완 |
| `tests/qa-review.test.ts` | 47 | QA-01~QA-15 + F-01~F-03 (SciPy/statsmodels/NIST 기준) | 동일 데이터로 엔진 회귀 유지 |
| `tests/qa-stats.test.ts` | 8 | **이번에 추가** — F-01(nctCdf 대자유도), F-02(검열 부트스트랩) 회귀 | 신규 |
| `tests/benchmark.test.ts` | 29 | NumPy/SciPy/statsmodels/Montgomery 표 대조 | 수치 기준 중복 검증 |
| `tests/p2.test.ts` | 28 | Gage R&R, Sixpack, 비정규, Weibull, GLM, DOE, 검정력, 속성관리도, Excel | P2 기능 회귀 |
| `tests/analyses.test.ts` | 45 | 40개 분석 레지스트리 + 러너 출력 + 이상 데이터 거부 | **UI 계층 유일한 커버리지** |
| `tests/charts.test.ts` | 24 | SVG 렌더·히스토그램 기하·능력도·관리도 패널 | UNVERIFIED 시각화의 대체 커버리지 |
| `tests/project.test.ts` | 23 | 프로젝트 파일·CSV·구분자·숫자 파싱 | 입출력 |
| `tests/calc.test.ts` | 7 | 수식 파서 | QA-I와 병행 |
| `tests/i18n.test.ts` | 4 | 문구 키 일치 | — |

QA-01~QA-15 매핑: QA-01 Weibull 완전데이터 AD, QA-02 검열 Weibull/로그노말, QA-03 신뢰수준 90/95/99, QA-04 단측 t 방향, QA-05 양측 비율 검정력 두 꼬리, QA-06 달성 불가 요청, QA-07 Gage 반복 부족, QA-08 Nested 균형, QA-09 Sixpack 부분군 일치, QA-10 로그노말 로그우도, QA-11 비양수 제외 보고, QA-12 대응 t CI/μ₀, QA-13 Xbar-R 결측 nᵢ, QA-14 헤더 없는 CSV, QA-15 불균형 3요인 Type III.

## 4. 검증 불가·제한 항목 (사유 포함)

| 항목 | 분류 | 사유 |
| --- | --- | --- |
| 파레토·히스토그램·상자그림·산점도·시계열 | UNVERIFIED 5 | 계산이 `analyses.ts` 러너(시트·차트 스펙)에만 있고 `src/lib` 통계 함수가 아니다. 빈 규칙·수염 정의는 시각화 규칙이라 독립 통계 기준이 없다. |
| 정렬·표준화·코드변환 | UNVERIFIED 3 | 행 재배열·열 생성 러너에만 존재. 단위테스트(analyses.test.ts 'worksheet transforms')가 담당. |
| 난수 생성 | UNVERIFIED 1 | 생성기 자체가 검증 대상이면 독립 기준값이 없고, 분포 적합검정은 표본오차 때문에 PASS/FAIL 판정에 부적합. |
| 차트 렌더링(SVG 기하) | 범위 밖 | 픽셀·좌표는 통계 계산이 아니다. `charts.test.ts` 24건이 NaN 좌표·도메인을 확인. |
| IndexedDB 자동저장·다운로드 | 범위 밖 | 브라우저 API 의존. |
| GLM alias 선택 정책 | REVIEW 1 | rank-deficient 설계에서 어느 열을 버리는지는 정책 문제(엔진=열 피벗, statsmodels=다른 열). SS·df는 모형 자체가 식별 불가. |
| 상수열 t검정의 t 정의 | REVIEW 2 | se=0일 때 t=0/±∞/NaN 선택은 정책. 엔진은 t1에서 NaN, paired에서 0/±∞ 규칙. |
| Minitab 동일성 | 보증 아님 | 정규근사 vs 정확법(비율 검정력), 실패-전용 AD의 검정력 한계, 중도절단 부트스트랩 근사, 표 VI 반올림 등은 REVIEW·문서로 분리했다. |

## 5. 관련 파일

- 독립 기준 엔진: `qa/reference/engine.py`, `qa/reference/formulas.py`
- 엔진 어댑터: `qa/adapters/sigrun/cli.ts`, `qa/adapters/sigrun/build.mjs`
- 데이터·케이스: `qa/datasets/generate.py`(+24개 JSON), `qa/build_cases.py` → `qa/cases/*.json`
- 비교·보고: `qa/compare.py`, `qa/tolerances.json`, `qa/reports/latest.html`, `qa/reports/latest.json`
- QA-F 실험: `qa/experiments/qa_f_bootstrap.py` → `qa/experiments/qa_f_bootstrap.json`
- 실행: `npm run qa:stats` (= `qa/run.sh`)
