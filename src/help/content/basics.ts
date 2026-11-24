/* Sigrún Help Center — starting out, data, basic statistics, regression, graphs. */

import type { HelpEntry } from '../types';

const L = (en: string, ko: string) => ({ en, ko });

export const BASICS_HELP: HelpEntry[] = [
  {
    id: 'worksheet-import',
    analysisIds: [],
    category: 'getting-started',
    title: L('Worksheet, sample data and import', '워크시트, 샘플 데이터, 가져오기'),
    summary: L(
      'How a worksheet is organised, how sample data enter a project, and what the import dialog asks before it writes a row.',
      '워크시트의 구성, 샘플 데이터를 프로젝트로 불러오는 방법, 가져오기 대화상자가 행을 쓰기 전에 확인하는 내용입니다.',
    ),
    theory: L(
      'A Sigrún project holds one or more worksheets. Each worksheet is a table of columns, and every column carries an id (C1, C2, …), a name, a type (numeric, text, date) and its values. Analyses refer to columns by id, so renaming a column never breaks an output card. Loading a sample dataset appends a new worksheet with fixed column names and values, so every reader who loads the same sample analyses the same numbers.',
      '시그룬 프로젝트는 하나 이상의 워크시트로 이루어집니다. 워크시트는 열의 표이고, 각 열은 ID(C1, C2, …), 이름, 유형(숫자·문자·날짜), 값으로 구성됩니다. 분석은 열을 ID로 참조하므로 열 이름을 바꿔도 결과 카드가 깨지지 않습니다. 샘플 데이터셋을 불러오면 열 이름과 값이 고정된 새 워크시트가 추가되므로, 같은 샘플을 불러온 사람은 누구나 같은 수치를 분석합니다.',
    ),
    formulas: [
      { expression: 'column: { id, name, type, values[] }', note: L('One column of a worksheet.', '워크시트의 열 하나를 정의합니다.') },
      { expression: 'row count n = max(values.length)', note: L('The longest column sets the sheet length.', '가장 긴 열이 워크시트의 행 수를 정합니다.') },
    ],
    parameters: [
      { name: L('First row contains headers', '첫 행이 열 이름'), meaning: L('When ticked, row 1 becomes column names and is not analysed as data.', '체크하면 1행이 열 이름이 되고 데이터로 분석되지 않습니다.') },
      { name: L('Missing values', '결측값'), meaning: L('Empty cells are excluded row by row from every analysis that uses the column.', '빈 셀은 그 열을 쓰는 분석에서 행 단위로 제외됩니다.') },
      { name: L('Column type', '열 유형'), meaning: L('Text in a numeric column is kept as text and excluded from calculations, not silently coerced.', '숫자 열의 문자 값은 조용히 변환되지 않고 제외됩니다.') },
    ],
    interpretation: [
      L('Load a sample, look at the column names and types, then open the analysis the tutorial names. The worksheet stays editable; every output card keeps a snapshot of the data it used.', '샘플을 불러온 뒤 열 이름과 유형을 확인하고 튜토리얼이 안내하는 분석을 엽니다. 워크시트는 계속 편집할 수 있고, 결과 카드는 사용한 데이터의 스냅샷을 보관합니다.'),
      L('A dataset that arrives with fewer rows than expected usually contains an empty leading row or a text value in the numeric column: check the import preview before accepting.', '예상보다 행이 적게 들어온 데이터셋은 보통 맨 앞의 빈 행이나 숫자 열 안의 문자 값 때문입니다. 승인 전에 가져오기 미리보기를 확인하십시오.'),
    ],
    assumptions: [
      L('The import preview shows the rows it will write; nothing is inferred from a file extension alone.', '가져오기 미리보기는 기록될 행을 보여 줍니다. 파일 확장자만으로 추론하지 않습니다.'),
    ],
    sampleIds: ['process', 'display-optical-doe'],
    tutorialIds: ['tutorial-start-001', 'tutorial-data-001', 'tutorial-rsm-001'],
  },
  {
    id: 'data-management',
    analysisIds: ['sort', 'standardize', 'recode', 'calculator', 'random'],
    category: 'data',
    title: L('Sorting, standardizing, recoding and calculated columns', '정렬, 표준화, 재코드, 계산 열'),
    summary: L('The data menu edits the worksheet in place: sorting reorders rows, standardization and recoding write a new column, and the calculator evaluates one formula.', '데이터 메뉴는 워크시트를 직접 편집합니다. 정렬은 행 순서를 바꾸고, 표준화와 재코드는 새 열을 만들며, 계산기는 하나의 수식을 평가합니다.'),
    theory: L(
      'Calculated columns are evaluated row by row over C-references. Standardization subtracts the sample mean and divides by the sample standard deviation, so the new column has mean 0 and standard deviation 1. Recoding maps old values to new ones through the pairs the reader types. Sorting is a worksheet operation: it moves whole rows, keeping each row’s values together.',
      '계산 열은 C 참조에 대해 행 단위로 평가됩니다. 표준화는 표본평균을 빼고 표본표준편차로 나누므로 새 열의 평균은 0, 표준편차는 1이 됩니다. 재코드는 사용자가 입력한 대응 쌍으로 값을 바꿉니다. 정렬은 워크시트 작업으로, 행 전체를 함께 옮겨 한 행의 값들이 흩어지지 않게 합니다.',
    ),
    formulas: [
      { expression: 'z = (x − x̄) / s', note: L('Standardized value (sample standard deviation).', '표준화 값(표본표준편차 기준).') },
      { expression: 'C_new = expression(C1, C2, …)', note: L('Calculator syntax, evaluated with + − × ÷ ^ and parentheses.', '계산기 문법. + − × ÷ ^ 와 괄호로 평가합니다.') },
    ],
    parameters: [
      { name: L('Sort ascending / descending', '오름차순 / 내림차순 정렬'), meaning: L('Reorders rows by one column; ties keep their relative order.', '한 열 기준으로 행을 재배열하며, 동률은 원래 순서를 유지합니다.') },
      { name: L('Store in', '저장 위치'), meaning: L('Name of the new column; blank means a generated name.', '새 열의 이름. 비워 두면 자동으로 생성됩니다.') },
      { name: L('Fallback (recode)', '대체값 (재코드)'), meaning: L('Value written for numbers that match none of the pairs.', '대응 쌍에 없는 값에 기록할 값입니다.') },
    ],
    interpretation: [
      L('Check the new column against the old one on the first few rows before analysing it; a miscoded pair is easier to see there than in a model.', '분석 전에 처음 몇 행에서 새 열과 원래 열을 비교하십시오. 잘못된 재코드는 모형보다 그 자리에서 더 쉽게 보입니다.'),
    ],
    assumptions: [
      L('Sorting changes the row order used by control charts and time-series plots; sort only after those plots are made, or keep a copy of the sheet.', '정렬은 관리도와 시계열 그림이 쓰는 행 순서를 바꿉니다. 그런 그림을 만든 뒤에 정렬하거나 워크시트 사본을 보관하십시오.'),
    ],
    sampleIds: ['process', 'comparison'],
    tutorialIds: ['tutorial-data-001'],
  },
  {
    id: 'descriptive-statistics',
    analysisIds: ['desc'],
    category: 'basic-statistics',
    title: L('Descriptive statistics', '기술통계량'),
    summary: L('Location, spread and shape for one or more numeric columns, optionally split by grouping columns.', '하나 이상의 숫자 열에 대한 중심·산포·모양을 그룹 열별로 나누어 보여 줍니다.'),
    theory: L(
      'Descriptive statistics summarize a sample without a model. The mean and standard deviation describe location and spread when the distribution is roughly symmetric; the median, quartiles and IQR describe them when it is not. Skewness and kurtosis describe shape. Every statistic is computed on the non-missing values of the column.',
      '기술통계량은 모형 없이 표본을 요약합니다. 분포가 대체로 대칭이면 평균과 표준편차가 중심과 산포를, 그렇지 않으면 중위수·사분위수·IQR이 설명합니다. 왜도와 첨도는 분포의 모양을 나타냅니다. 모든 통계량은 결측을 제외한 값으로 계산합니다.',
    ),
    formulas: [
      { expression: 'x̄ = Σxᵢ / n', note: L('Sample mean.', '표본평균.') },
      { expression: 's = √(Σ(xᵢ − x̄)² / (n − 1))', note: L('Sample standard deviation (n − 1 denominator).', '표본표준편차(n−1 분모).') },
      { expression: 'IQR = Q3 − Q1', note: L('Interquartile range from the quartile method stated in the output.', '출력에 표시된 사분위 방식의 사분위범위.') },
      { expression: 'skew = n/((n−1)(n−2)) Σ((xᵢ − x̄)/s)³', note: L('Sample skewness.', '표본 왜도.') },
    ],
    parameters: [
      { name: L('Variables', '변수'), meaning: L('Numeric columns to summarize.', '요약할 숫자 열입니다.') },
      { name: L('By variables', '기준 변수'), meaning: L('Optional grouping columns; one row of statistics per group.', '선택 사항인 그룹 열. 그룹마다 한 행의 통계량이 나옵니다.') },
    ],
    interpretation: [
      L('Compare the mean and median: a large gap, or a mean far outside the IQR, points to skew or outliers that a t-test or an X̄ chart would mishandle.', '평균과 중위수를 비교하십시오. 차이가 크거나 평균이 IQR 밖으로 멀리 있으면 t검정이나 X̄ 관리도가 잘 다루지 못하는 왜도나 이상점을 뜻합니다.'),
      L('Read the standard deviation against the specification width, not on its own: it is the input to every capability index.', '표준편차는 단독이 아니라 규격 폭과 함께 읽으십시오. 모든 공정능력 지수의 입력값입니다.'),
    ],
    assumptions: [
      L('No distribution is assumed by the statistics themselves; the usual normal-theory interpretations do assume approximate symmetry.', '통계량 자체는 분포를 가정하지 않지만, 통상적인 정규이론 해석은 대략적인 대칭을 가정합니다.'),
    ],
    sampleIds: ['process', 'regression'],
    tutorialIds: ['tutorial-start-001', 'tutorial-normality-001', 'tutorial-rsm-001'],
  },
  {
    id: 'normality-test',
    analysisIds: ['normality'],
    category: 'basic-statistics',
    title: L('Normality test (Anderson–Darling)', '정규성 검정 (앤더슨–달링)'),
    summary: L('A hypothesis test for normality with a normal probability plot and an AD statistic.', '정규확률도와 AD 통계량을 함께 제공하는 정규성 가설검정입니다.'),
    theory: L(
      'The Anderson–Darling test measures how far the empirical distribution sits from the fitted normal distribution, giving more weight to the tails than the Kolmogorov–Smirnov statistic. A small p-value is evidence against normality; a large p-value is not proof of it, especially with small samples.',
      '앤더슨–달링 검정은 경험분포가 적합된 정규분포에서 얼마나 떨어져 있는지를 재며, 콜모고로프–스미르노프보다 꼬리에 더 큰 가중을 둡니다. p값이 작으면 정규성에 반하는 증거이고, 큰 p값이 정규성의 증명은 아닙니다. 특히 표본이 작을 때 그렇습니다.',
    ),
    formulas: [
      { expression: 'A² = −n − (1/n) Σ(2i − 1)[ln F(z₍ᵢ₎) + ln(1 − F(z₍ₙ₊₁₋ᵢ₎))]', note: L('AD statistic with F the fitted normal CDF.', '적합된 정규분포 F를 쓰는 AD 통계량.') },
      { expression: 'z = (x − x̄) / s', note: L('Standardized order statistics.', '표준화된 순서통계량.') },
    ],
    parameters: [
      { name: L('Variable', '변수'), meaning: L('Numeric column to test.', '검정할 숫자 열.') },
    ],
    interpretation: [
      L('Read the p-value together with the probability plot: points bending away at the ends mean tails that are heavier or lighter than normal even when the test is borderline.', 'p값과 확률도를 함께 읽으십시오. 양 끝에서 휘어지면 검정이 경계값이어도 꼬리가 정규보다 두껍거나 얇다는 뜻입니다.'),
      L('With fewer than about 20 observations the test has little power; treat it as one input among the plots.', '관측치가 20개 미만이면 검정력이 낮으므로 여러 그림 중 하나의 입력으로만 보십시오.'),
    ],
    assumptions: [
      L('Observations are independent. A trend or a subgroup structure violates this and inflates the statistic.', '관측치는 독립이어야 합니다. 추세나 부분군 구조가 있으면 이를 위반해 통계량이 커집니다.'),
    ],
    sampleIds: ['process', 'comparison'],
    tutorialIds: ['tutorial-normality-001', 'tutorial-start-001'],
  },
  {
    id: 't-tests',
    analysisIds: ['t1', 't2', 'paired'],
    category: 'basic-statistics',
    title: L('t-tests: one sample, two samples, paired', 't검정: 단일표본, 이표본, 대응'),
    summary: L('Tests of a mean, a difference of means, or a mean difference, with confidence intervals and a normal curve or boxplot.', '평균, 평균 차이, 대응 차이의 평균을 신뢰구간과 정규곡선 또는 상자그림으로 검정합니다.'),
    theory: L(
      'A t-test compares a sample statistic with its standard error under the null hypothesis. The one-sample test compares a mean with a target; the two-sample test compares two independent means (Welch’s unequal-variance form is the default); the paired test reduces paired readings to their differences and tests the mean difference. The p-value is the probability of a statistic at least this extreme if the null were true.',
      't검정은 귀무가설 아래에서 표본 통계량을 표준오차와 비교합니다. 단일표본은 평균을 목표값과, 이표본은 두 독립 평균을(기본은 등분산을 가정하지 않는 Welch), 대응표본은 차이로 바꾼 뒤 차이의 평균을 검정합니다. p값은 귀무가설이 참일 때 이만큼 극단인 통계량이 나올 확률입니다.',
    ),
    formulas: [
      { expression: 't = (x̄ − μ₀) / (s / √n), df = n − 1', note: L('One-sample t.', '단일표본 t.') },
      { expression: 't = (x̄₁ − x̄₂) / √(s₁²/n₁ + s₂²/n₂)', note: L('Two-sample Welch t; df from Welch–Satterthwaite.', '이표본 Welch t. 자유도는 Welch–Satterthwaite.') },
      { expression: 't = d̄ / (s_d / √n), dᵢ = firstᵢ − secondᵢ', note: L('Paired t.', '대응 t.') },
      { expression: 'CI = estimate ± t(1 − α/2, df) × SE', note: L('Two-sided confidence interval.', '양측 신뢰구간.') },
    ],
    parameters: [
      { name: L('Hypothesized mean / difference', '가설 평균 / 차이'), meaning: L('The null value the estimate is compared with; 0 is the usual choice.', '추정값을 비교할 귀무가설 값. 보통 0입니다.') },
      { name: L('Confidence level', '신뢰수준'), meaning: L('Width of the interval; 95 % unless the reader says otherwise.', '구간의 폭. 별도 지정이 없으면 95 %입니다.') },
      { name: L('Alternative', '대립가설'), meaning: L('Two-sided (≠), greater than (>), or less than (<).', '양측(≠), 크다(>), 작다(<).') },
      { name: L('Assume equal variances', '등분산 가정'), meaning: L('When on, the pooled-variance form is used instead of Welch.', '켜면 Welch 대신 합동분산 형태를 씁니다.') },
    ],
    interpretation: [
      L('Read the confidence interval first: it states the size of the difference the data support, which a p-value does not.', '먼저 신뢰구간을 읽으십시오. 데이터가 지지하는 차이의 크기를 보여 주며, p값은 그 크기를 말해 주지 않습니다.'),
      L('A non-significant result with a wide interval means the test did not resolve the question, not that the groups are equal.', '유의하지 않은 결과에서 구간이 넓다면 두 그룹이 같다는 뜻이 아니라 질문을 해결하지 못했다는 뜻입니다.'),
    ],
    assumptions: [
      L('Independent observations; approximately normal data or a large enough sample for the central limit theorem.', '관측치의 독립성, 그리고 대략적인 정규성 또는 중심극한정리가 작동할 만큼 큰 표본.'),
      L('The paired test requires that each pair is measured under the same conditions and in the same order.', '대응 검정은 각 쌍이 같은 조건에서 같은 순서로 측정되었어야 합니다.'),
    ],
    sampleIds: ['comparison', 'process'],
    tutorialIds: ['tutorial-hypothesis-001', 'tutorial-start-001'],
  },
  {
    id: 'regression-fitting',
    analysisIds: ['regression', 'polyreg'],
    category: 'regression',
    title: L('Regression: fit, coefficients and diagnostics', '회귀: 적합, 계수, 진단'),
    summary: L('Least-squares fitting of one response on one or more predictors, with ANOVA, R², coefficient tests and a four-in-one residual plot.', '하나의 반응을 하나 이상의 예측변수에 최소제곱으로 적합하고, 분산분석·R²·계수 검정·4-in-1 잔차 그림을 제공합니다.'),
    theory: L(
      'Ordinary least squares finds the coefficients that minimize the sum of squared residuals. The model is fitted by a column-pivoted QR decomposition of the design matrix, which remains stable for correlated predictors where the normal equations would lose digits. Each coefficient’s t-test asks whether that term adds information given the others; the F test asks whether the model as a whole does. A stored model can later be predicted from, contoured, optimized and profiled.',
      '최소제곱법은 잔차제곱합을 최소화하는 계수를 찾습니다. 모형은 설계행렬의 열피벗 QR 분해로 적합되어, 정규방정식이라면 자릿수를 잃을 상관된 예측변수에서도 안정적입니다. 각 계수의 t검정은 다른 항이 있을 때 그 항이 정보를 더하는지, F검정은 모형 전체가 그런지를 묻습니다. 저장한 모형은 이후 예측·등고선·최적화·프로파일러에 쓰입니다.',
    ),
    formulas: [
      { expression: 'y = β₀ + β₁x₁ + … + βₖxₖ + ε', note: L('Multiple linear model.', '다중선형모형.') },
      { expression: 'β̂ = (XᵀX)⁻¹Xᵀy, computed through QR', note: L('Least-squares estimates.', '최소제곱 추정값.') },
      { expression: 'R² = 1 − SSE / SST', note: L('Proportion of variation explained.', '설명된 변동의 비율.') },
      { expression: 'R²adj = 1 − (1 − R²)(n − 1)/(n − p)', note: L('Adjusted for the number of terms.', '항의 수로 조정한 값.') },
      { expression: 't = β̂ⱼ / SE(β̂ⱼ), df = n − p', note: L('Coefficient test.', '계수 검정.') },
    ],
    parameters: [
      { name: L('Response', '반응'), meaning: L('The numeric column being explained.', '설명하려는 숫자 열.') },
      { name: L('Predictors', '예측변수'), meaning: L('The numeric columns that explain it.', '설명에 쓰는 숫자 열.') },
      { name: L('Four-in-one', '4-in-1 잔차 그림'), meaning: L('Residuals versus fitted, normal probability, histogram and versus order.', '적합값 대 잔차, 정규확률, 히스토그램, 순서 대 잔차.') },
    ],
    interpretation: [
      L('A high R² with a large S means the model explains a share of a variation that is itself large; read both.', 'R²가 높아도 S가 크면 변동 자체가 큰 가운데 일부를 설명한 것이므로 둘을 함께 읽으십시오.'),
      L('A coefficient whose sign contradicts the process is usually a sign of collinearity: check the correlation between predictors before acting on it.', '부호가 공정 상식과 반대인 계수는 대개 공선성의 신호입니다. 실행 전에 예측변수 간 상관을 확인하십시오.'),
    ],
    assumptions: [
      L('Independent errors with constant variance and approximate normality; predictors measured without material error.', '독립이고 등분산이며 대략 정규인 오차, 그리고 큰 오차 없이 측정된 예측변수.'),
      L('Extrapolating outside the predictor ranges the model was fitted on is not supported by the fit.', '적합에 사용한 예측변수 범위 밖으로 외삽하는 것은 모형이 보증하지 않습니다.'),
    ],
    sampleIds: ['regression', 'display-optical-doe'],
    tutorialIds: ['tutorial-regression-001', 'tutorial-rsm-001'],
  },
  {
    id: 'anova-glm',
    analysisIds: ['anova', 'glm'],
    category: 'anova',
    title: L('ANOVA and the general linear model', '분산분석과 일반선형모형'),
    summary: L('Comparing means across levels of one or more factors, with sequential and adjusted sums of squares and Tukey comparisons.', '하나 이상 요인의 수준 간 평균을 비교하며, 순차·조정 제곱합과 Tukey 비교를 제공합니다.'),
    theory: L(
      'Analysis of variance splits the total variation into the part explained by factor levels and the part left over. The one-way ANOVA uses a single factor; the general linear model accepts several factors and their interactions and uses sum-to-zero coding for categorical factors so the adjusted (Type III) sums of squares are the drop-term sums of squares. Tukey’s HSD controls the family-wise error rate when several pairs of means are compared at once.',
      '분산분석은 전체 변동을 요인 수준이 설명하는 부분과 남는 부분으로 나눕니다. 일원분산분석은 요인 하나를, 일반선형모형은 여러 요인과 교호작용을 받아들이며 범주형 요인에 합제로(deviation) 코딩을 써서 조정 제곱합(Type III)이 항 제거 제곱합이 되게 합니다. 여러 평균 쌍을 한꺼번에 비교할 때 Tukey HSD는 전체 오류율을 통제합니다.',
    ),
    formulas: [
      { expression: 'F = MS_factor / MS_error', note: L('Variance ratio for a factor.', '요인의 분산비.') },
      { expression: 'SST = SSA + SSE', note: L('Total, factor and error sums of squares.', '전체·요인·오차 제곱합.') },
      { expression: 'yᵢⱼ = μ + τᵢ + εᵢⱼ', note: L('One-way model.', '일원 모형.') },
      { expression: 'HSD = q(α, k, dfₑ) √(MSE / n)', note: L('Tukey studentized-range critical difference.', 'Tukey 스튜던트화 범위 임계차.') },
    ],
    parameters: [
      { name: L('Response', '반응'), meaning: L('Numeric column whose mean is compared.', '평균을 비교할 숫자 열.') },
      { name: L('Factors', '요인'), meaning: L('Grouping columns; categorical factors use deviation coding.', '그룹 열. 범주형 요인은 deviation 코딩을 씁니다.') },
      { name: L('Include interactions', '교호작용 포함'), meaning: L('Adds two-way interaction terms to the GLM.', 'GLM에 이원 교호작용 항을 추가합니다.') },
      { name: L('Confidence level', '신뢰수준'), meaning: L('Used by the comparison intervals.', '비교 구간에 사용됩니다.') },
    ],
    interpretation: [
      L('A significant factor means at least one level differs; the Tukey table says which pairs, and by how much.', '유의한 요인은 적어도 한 수준이 다르다는 뜻입니다. 어느 쌍이 얼마나 다른지는 Tukey 표가 알려 줍니다.'),
      L('A large residual S next to a significant factor means the factor is real but the process still varies for other reasons.', '유의한 요인 옆에 잔차 S가 크면 요인은 실제이지만 공정이 다른 이유로도 변한다는 뜻입니다.'),
    ],
    assumptions: [
      L('Independent, normally distributed errors with equal variance across cells; unbalanced cells change the Type I sums of squares but not the Type III reading.', '셀 간 등분산인 정규 오차의 독립성. 불균형 셀은 Type I 제곱합을 바꾸지만 Type III 해석은 바꾸지 않습니다.'),
    ],
    sampleIds: ['comparison', 'process', 'display-optical-doe'],
    tutorialIds: ['tutorial-anova-001', 'tutorial-rsm-001'],
  },
  {
    id: 'graph-basics',
    analysisIds: ['histogram', 'boxplot', 'scatter', 'timeseries'],
    category: 'visualization',
    title: L('Histogram, boxplot, scatterplot and time series', '히스토그램, 상자그림, 산점도, 시계열'),
    summary: L('Four ways to look at a column before or after a model: distribution, group comparison, relationship and order.', '모형 전후에 열을 보는 네 가지 방법: 분포, 그룹 비교, 관계, 순서.'),
    theory: L(
      'Each graph answers a different question. A histogram shows the shape of one distribution and can overlay a fitted normal curve and specification limits. A boxplot compares distributions across groups using median, quartiles and flagged outliers. A scatterplot shows the relationship between two numeric columns with optional fit line, confidence and prediction bands. A time series keeps the worksheet order and is the natural way to see drift.',
      '각 그림은 다른 질문에 답합니다. 히스토그램은 한 분포의 모양을 보여 주고 정규곡선과 규격한계를 겹칠 수 있습니다. 상자그림은 중위수·사분위수·이상점으로 그룹별 분포를 비교합니다. 산점도는 두 숫자 열의 관계를 적합선과 신뢰·예측대와 함께 보여 줍니다. 시계열은 워크시트 순서를 유지하여 추세를 보기에 적합합니다.',
    ),
    formulas: [
      { expression: 'bin width = (max − min) / bins', note: L('Equal-width histogram bins; the engine may choose the count.', '등폭 히스토그램 구간. 구간 수는 엔진이 정할 수 있습니다.') },
      { expression: 'outlier if x < Q1 − 1.5 IQR or x > Q3 + 1.5 IQR', note: L('Boxplot outlier rule.', '상자그림 이상점 규칙.') },
      { expression: 'r = Σ(x − x̄)(y − ȳ) / √(Σ(x − x̄)² Σ(y − ȳ)²)', note: L('Pearson correlation drawn on the scatterplot.', '산점도에 표시되는 피어슨 상관.') },
    ],
    parameters: [
      { name: L('Bins', '구간 수'), meaning: L('0 lets the engine choose; a fixed count is honoured exactly.', '0이면 엔진이 정하고, 지정한 수는 그대로 지킵니다.') },
      { name: L('Specification limits', '규격한계'), meaning: L('Drawn as reference lines, never as data.', '참조선으로 그려지며 데이터로 취급되지 않습니다.') },
      { name: L('Fit line and bands', '적합선과 밴드'), meaning: L('Linear fit with mean confidence and individual prediction bands.', '평균 신뢰대와 개별 예측대가 있는 선형 적합.') },
    ],
    interpretation: [
      L('Look for shape, groups and order in that order: a mixture of two groups can look like one skewed distribution until it is split by a By column.', '모양, 그룹, 순서의 차례로 보십시오. 두 그룹이 섞인 분포는 By 열로 나누기 전까지 하나의 치우친 분포처럼 보일 수 있습니다.'),
      L('A scatterplot’s fit line is a summary, not a model: open Fit Regression Model to test and store it.', '산점도의 적합선은 요약이지 모형이 아닙니다. 검정하고 저장하려면 회귀모형 적합을 여십시오.'),
    ],
    assumptions: [
      L('Graphs make assumptions visible; they do not correct them. A band drawn from a straight-line fit is meaningless when the relationship is curved.', '그림은 가정을 드러낼 뿐 고치지는 않습니다. 관계가 곡선일 때 직선 적합의 밴드는 의미가 없습니다.'),
    ],
    sampleIds: ['process', 'comparison', 'regression'],
    tutorialIds: ['tutorial-data-001', 'tutorial-rsm-001'],
  },
  {
    id: 'power-sample-size',
    analysisIds: ['power1t', 'power2t', 'powerpaired', 'poweranova', 'powerprop1', 'powerprop2'],
    category: 'basic-statistics',
    title: L('Power and sample size', '검정력과 표본 크기'),
    summary: L('The four quantities — difference, standard deviation, sample size, power — with any one solved from the other three.', '차이·표준편차·표본 크기·검정력 네 값 중 하나를 나머지 셋으로부터 구합니다.'),
    theory: L(
      'Power is the probability of detecting a real difference at the chosen significance level. The power functions are monotone in the sample size, so the engine solves the requested quantity by a bracketed search on the exact distribution rather than by a normal approximation where the exact one is available.',
      '검정력은 선택한 유의수준에서 실제 차이를 검출할 확률입니다. 검정력 함수는 표본 크기에 대해 단조이므로, 엔진은 정확한 분포가 가능한 경우 정규근사 대신 그 분포 위의 구간 탐색으로 요청된 값을 풉니다.',
    ),
    formulas: [
      { expression: 'power = 1 − β = P(reject H₀ | H₁ true)', note: L('Definition of power.', '검정력의 정의.') },
      { expression: 'n ∝ (z₁₋α/₂ + z₁₋β)² σ² / δ²', note: L('Normal approximation for a two-sided test; exact t form used where supported.', '양측 검정의 정규근사. 지원되는 경우 정확한 t 형태를 씁니다.') },
    ],
    parameters: [
      { name: L('Solve for', '구할 값'), meaning: L('Sample size, power or difference.', '표본 크기, 검정력, 차이 중 하나.') },
      { name: L('Difference', '차이'), meaning: L('The smallest effect worth detecting.', '검출하고자 하는 최소 효과.') },
      { name: L('Standard deviation', '표준편차'), meaning: L('Process or measurement standard deviation.', '공정 또는 측정 표준편차.') },
      { name: L('Alpha', '유의수준'), meaning: L('Type I error rate in percent.', '1종 오류율(퍼센트).') },
    ],
    interpretation: [
      L('Plan with a power of at least 80–90 % for the smallest difference that would change a decision; a study sized for a larger difference cannot answer the smaller question.', '의사결정을 바꿀 가장 작은 차이에 대해 80–90 % 이상의 검정력으로 계획하십시오. 큰 차이에 맞춘 연구는 작은 질문에 답할 수 없습니다.'),
    ],
    assumptions: [
      L('The standard deviation is assumed known from prior data or a pilot; that assumption carries into the answer.', '표준편차는 사전 데이터나 예비시험에서 안다고 가정하며, 그 가정이 결과에 그대로 반영됩니다.'),
    ],
    sampleIds: ['comparison'],
    tutorialIds: ['tutorial-hypothesis-001'],
  },
];
