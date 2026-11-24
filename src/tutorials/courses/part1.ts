/* Sigrún — tutorials T01–T04: getting started, data management, descriptive &
   normality, hypothesis tests. Content only: the seven-part structure and the
   steps; all actions are allow-listed ids from `actionRegistry`. */

import { defineTutorial, type RawTutorial } from '../define';

const L = (en: string, ko: string) => ({ en, ko });

export const START_TUTORIAL: RawTutorial = {
  id: 'tutorial-start-001',
  title: L('Getting Started with Sigrún', '시그룬 시작하기'),
  description: L(
    'Load a sample dataset, run descriptive statistics and read the output: the whole loop of the workspace in four steps.',
    '샘플 데이터를 불러와 기술통계를 실행하고 결과를 읽는, 워크스페이스의 전체 흐름을 네 단계로 익힙니다.',
  ),
  category: 'getting-started',
  difficulty: 'intro',
  estimatedMinutes: 5,
  objectives: [
    L('Load a built-in sample dataset into a worksheet.', '내장 샘플 데이터셋을 워크시트로 불러옵니다.'),
    L('Run an analysis from its dialog and find the output card.', '대화상자에서 분석을 실행하고 결과 카드를 찾습니다.'),
    L('Read a group summary without over-interpreting it.', '그룹 요약을 과잉 해석 없이 읽습니다.'),
  ],
  sampleIds: ['process'],
  helpIds: ['worksheet-import', 'descriptive-statistics'],
  analysisIds: ['desc'],
  structure: {
    learn: L(
      'A Sigrún project is a worksheet plus the output cards analyses produce. This tutorial walks that loop once: data in, one analysis, one reading.',
      '시그룬 프로젝트는 워크시트와 분석이 만든 결과 카드로 이루어집니다. 이 튜토리얼은 데이터 입력, 분석 한 번, 해석 한 번의 순환을 한 번 따라갑니다.',
    ),
    data: L(
      'The Coating Process sample: 60 parts with a thickness measurement, the line that made them, the shift and a defect category. It is synthetic, generated from a fixed seed.',
      '코팅 공정 샘플: 두께 측정값과 생산 라인, 교대, 불량 유형이 있는 60개 부품입니다. 고정 시드로 만든 합성 데이터입니다.',
    ),
    analysis: L(
      'Display Descriptive Statistics on Thickness (mm), split by Line. It reports n, mean, standard deviation and quartiles for each line.',
      '두께(mm)에 대해 라인별로 기술통계량을 표시합니다. 라인마다 n, 평균, 표준편차, 사분위수를 보고합니다.',
    ),
    inputs: L(
      'Variables: Thickness (mm). By variables: Line. Nothing else needs to be set.',
      '변수: 두께(mm). 기준 변수: 라인. 그 밖에 설정할 것은 없습니다.',
    ),
    check: L(
      'Three rows, one per line, each with n = 20. Line 1 mean ≈ 10.137 mm, Line 2 ≈ 10.259 mm, Line 3 ≈ 10.209 mm.',
      '라인마다 한 행씩 세 행, 각 n = 20. 라인 1 평균 ≈ 10.137 mm, 라인 2 ≈ 10.259 mm, 라인 3 ≈ 10.209 mm입니다.',
    ),
    interpret: L(
      'The line means differ by about 0.12 mm while the within-line standard deviation is about 0.20 mm. That is a small difference relative to the spread, so this summary alone does not show that the lines differ.',
      '라인 평균 차이는 약 0.12 mm이고 라인 내 표준편차는 약 0.20 mm입니다. 산포에 비해 작은 차이이므로 이 요약만으로 라인이 다르다고 말할 수 없습니다.',
    ),
    conclusion: L(
      'Describe the process before testing it: the summary gives the size of the differences and the spread you will need in the next tutorial’s test.',
      '공정을 검정하기 전에 먼저 기술하십시오. 요약은 다음 튜토리얼의 검정에 필요한 차이의 크기와 산포를 알려 줍니다.',
    ),
  },
  steps: [
    {
      id: 'load-sample',
      title: L('Load the sample dataset', '샘플 데이터셋 불러오기'),
      instruction: L(
        'Press the action button to load the Coating Process sample. A new worksheet named Coating Process appears with four columns.',
        '실행 버튼을 눌러 코팅 공정 샘플을 불러오십시오. 네 개의 열을 가진 Coating Process 워크시트가 생깁니다.',
      ),
      expected: L(
        'A worksheet with Thickness (mm), Line, Shift and Defect, 60 rows.',
        '두께(mm), 라인, 교대, 불량 유형 열이 있고 60행인 워크시트입니다.',
      ),
      hint: L('Sample data are also under File ▸ Sample data.', '샘플 데이터는 파일 ▸ 샘플 데이터 메뉴에도 있습니다.'),
      action: { action: 'load-sample', sampleId: 'process' },
      helpId: 'worksheet-import',
      completion: 'validated',
      validation: { kind: 'sample-loaded', sampleId: 'process', columns: ['Thickness (mm)', 'Line', 'Shift', 'Defect'] },
    },
    {
      id: 'descriptive',
      title: L('Run descriptive statistics', '기술통계량 실행'),
      instruction: L(
        'Open Display Descriptive Statistics with the tutorial preset (Thickness by Line), check the two slots, then press Run in the dialog.',
        '튜토리얼 프리셋(라인별 두께)으로 기술통계 대화상자를 열고 두 슬롯을 확인한 뒤 대화상자의 실행을 누르십시오.',
      ),
      expected: L(
        'An output card titled Display Descriptive Statistics with one row per line.',
        '라인마다 한 행이 있는 기술통계 결과 카드가 출력됩니다.',
      ),
      hint: L('The preset fills the dialog; every value stays editable before you run it.', '프리셋이 대화상자를 채웁니다. 실행 전에 모든 값을 수정할 수 있습니다.'),
      action: { action: 'open-analysis', analysisId: 'desc', presetId: 'preset-desc-thickness' },
      helpId: 'descriptive-statistics',
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'desc' },
    },
    {
      id: 'read-help',
      title: L('Open the related help', '관련 도움말 열기'),
      instruction: L(
        'Open the descriptive statistics document from the Help Center. Close it to come back to this step; your practice data are untouched.',
        '도움말 센터에서 기술통계 문서를 여십시오. 닫으면 이 단계로 돌아오며 실습 데이터는 그대로입니다.',
      ),
      expected: L('The Help Center opens on the descriptive statistics document.', '도움말 센터가 기술통계 문서와 함께 열립니다.'),
      action: { action: 'open-help', helpId: 'descriptive-statistics' },
      completion: 'validated',
      validation: { kind: 'help-opened', helpId: 'descriptive-statistics' },
    },
    {
      id: 'state-reading',
      title: L('State the reading in one sentence', '한 문장으로 해석 정리'),
      instruction: L(
        'In your own words: which line has the highest mean thickness, and is the difference large compared with the within-line standard deviation? Mark the step complete when you have written it down.',
        '직접 말로 정리해 보십시오. 어느 라인의 평균 두께가 가장 높고, 그 차이가 라인 내 표준편차에 비해 큰가? 적었다면 완료로 표시하십시오.',
      ),
      expected: L(
        'A sentence such as: “Line 2 is highest at 10.259 mm, but the 0.12 mm gap is smaller than the 0.20 mm spread inside a line.”',
        '예: “라인 2가 10.259 mm로 가장 높지만 0.12 mm 차이는 라인 내 0.20 mm 산포보다 작다.”',
      ),
      action: { action: 'validate-result' },
      completion: 'manual',
      validation: { kind: 'manual' },
    },
  ],
  nextTutorialId: 'tutorial-data-001',
};

export const DATA_TUTORIAL: RawTutorial = {
  id: 'tutorial-data-001',
  title: L('Worksheet & Data Management', '워크시트와 데이터 관리'),
  description: L(
    'Standardize a column, look at its distribution and learn where calculated columns live.',
    '열을 표준화하고 분포를 확인하며, 계산된 열이 어디에 남는지 익힙니다.',
  ),
  category: 'data-management',
  difficulty: 'intro',
  estimatedMinutes: 5,
  objectives: [
    L('Create a calculated column without changing the source column.', '원본 열을 바꾸지 않고 계산 열을 만듭니다.'),
    L('Check a calculated column against its definition (mean 0, standard deviation 1).', '계산 열을 정의(평균 0, 표준편차 1)와 대조합니다.'),
    L('Recognise how a histogram differs from a summary table.', '히스토그램이 요약표와 어떻게 다른지 구분합니다.'),
  ],
  sampleIds: ['comparison'],
  helpIds: ['data-management', 'graph-basics'],
  analysisIds: ['standardize', 'histogram'],
  structure: {
    learn: L(
      'Data preparation is worksheet work: new columns are added, the originals stay. Sigrún records each change so undo and the project file both carry it.',
      '데이터 준비는 워크시트 작업입니다. 새 열이 추가되고 원본은 그대로 남습니다. 시그룬은 각 변경을 기록해 실행취소와 프로젝트 파일에 모두 남깁니다.',
    ),
    data: L(
      'The Cure Study sample: hardness for a standard and a new cure, an operator column and a before/after pair.',
      '경화 연구 샘플: 표준 경화와 신규 경화의 경도, 작업자 열, 전/후 측정값이 있습니다.',
    ),
    analysis: L(
      'Standardize Hardness into a new column, then draw a histogram of the original Hardness.',
      '경도를 새 열로 표준화한 뒤 원래 경도의 히스토그램을 그립니다.',
    ),
    inputs: L(
      'Standardize: Hardness, stored as zHardness. Histogram: Hardness with no specification limits.',
      '표준화: 경도, 저장 이름 zHardness. 히스토그램: 경도, 규격한계 없음.',
    ),
    check: L(
      'A zHardness column whose mean is 0 and standard deviation is 1 (to rounding), and a histogram with a normal curve.',
      '평균 0, 표준편차 1(반올림 범위)인 zHardness 열과 정규곡선이 있는 히스토그램입니다.',
    ),
    interpret: L(
      'The z-scale says how many standard deviations a part sits from the mean; it changes no ranking. The histogram shows the shape the summary cannot.',
      'z 척도는 부품이 평균에서 표준편차 몇 배 떨어졌는지를 뜻하며 순위는 바꾸지 않습니다. 히스토그램은 요약표가 보여 주지 못하는 모양을 보여 줍니다.',
    ),
    conclusion: L(
      'Prepare derived columns in the worksheet, keep the source columns, and check the new column against its definition before analysing it.',
      '파생 열은 워크시트에서 만들고 원본 열은 보존하며, 분석 전에 새 열을 정의와 대조하십시오.',
    ),
  },
  steps: [
    {
      id: 'load-sample',
      title: L('Load the Cure Study sample', '경화 연구 샘플 불러오기'),
      instruction: L('Load the Cure Study sample with the action button.', '실행 버튼으로 경화 연구 샘플을 불러오십시오.'),
      expected: L('A worksheet with Group, Hardness, Operator, Before and After.', '그룹, 경도, 작업자, 전, 후 열이 있는 워크시트입니다.'),
      action: { action: 'load-sample', sampleId: 'comparison' },
      helpId: 'worksheet-import',
      completion: 'validated',
      validation: { kind: 'sample-loaded', sampleId: 'comparison', columns: ['Group', 'Hardness', 'Operator', 'Before', 'After'] },
    },
    {
      id: 'standardize',
      title: L('Standardize Hardness', '경도 표준화'),
      instruction: L(
        'Open Standardize with the tutorial preset (Hardness → zHardness) and run it. The original Hardness column is not modified.',
        '튜토리얼 프리셋(경도 → zHardness)으로 표준화를 열고 실행하십시오. 원래 경도 열은 바뀌지 않습니다.',
      ),
      expected: L('A new zHardness column next to Hardness.', '경도 옆에 새 zHardness 열이 생깁니다.'),
      hint: L('Standardize stores a new column; it never overwrites the input column.', '표준화는 새 열을 저장하며 입력 열을 덮어쓰지 않습니다.'),
      action: { action: 'apply-preset', analysisId: 'standardize', presetId: 'preset-standardize-hardness' },
      helpId: 'data-management',
      completion: 'validated',
      validation: { kind: 'analysis-opened', analysisId: 'standardize' },
    },
    {
      id: 'run-standardize',
      title: L('Run it and check the new column', '실행하고 새 열 확인'),
      instruction: L(
        'Press the action button to run the filled dialog (or press Run in the dialog yourself), then look at the new column.',
        '실행 버튼으로 채워진 대화상자를 실행하거나 대화상자에서 직접 실행한 뒤 새 열을 확인하십시오.',
      ),
      expected: L('A zHardness column whose mean is 0 and standard deviation is 1.', '평균 0, 표준편차 1인 zHardness 열입니다.'),
      action: { action: 'run-analysis', analysisId: 'standardize' },
      completion: 'validated',
      validation: { kind: 'column-created', name: 'zHardness', mean: 0, sd: 1, tolerance: { abs: 1e-6, rel: 1e-6 } },
    },
    {
      id: 'histogram',
      title: L('Look at the distribution', '분포 확인'),
      instruction: L(
        'Open Histogram with the tutorial preset and run it to see the hardness distribution with a normal curve.',
        '튜토리얼 프리셋으로 히스토그램을 열고 실행해 정규곡선이 있는 경도 분포를 확인하십시오.',
      ),
      expected: L('A histogram output card.', '히스토그램 결과 카드가 생깁니다.'),
      action: { action: 'open-analysis', analysisId: 'histogram', presetId: 'preset-histogram-hardness' },
      helpId: 'graph-basics',
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'histogram', withChart: 'histogram' },
    },
    {
      id: 'read-help',
      title: L('Read how data edits are handled', '데이터 편집 규칙 읽기'),
      instruction: L('Open the data management document and close it to return here.', '데이터 관리 문서를 열고 닫아 이 단계로 돌아오십시오.'),
      expected: L('The data management document opens.', '데이터 관리 문서가 열립니다.'),
      action: { action: 'open-help', helpId: 'data-management' },
      completion: 'validated',
      validation: { kind: 'help-opened', helpId: 'data-management' },
    },
    {
      id: 'reflect',
      title: L('Explain the two columns', '두 열의 차이 설명'),
      instruction: L(
        'Say why zHardness and Hardness carry the same information in different units, and mark the step complete.',
        'zHardness와 경도가 단위만 다를 뿐 같은 정보를 담는 이유를 설명하고 완료로 표시하십시오.',
      ),
      expected: L('A sentence about the z-score being a rescaled Hardness (mean 0, SD 1).', 'z점수가 경도를 평균 0, 표준편차 1로 다시 척도한 값이라는 설명입니다.'),
      action: { action: 'validate-result' },
      completion: 'manual',
      validation: { kind: 'manual' },
    },
  ],
  nextTutorialId: 'tutorial-normality-001',
};

export const NORMALITY_TUTORIAL: RawTutorial = {
  id: 'tutorial-normality-001',
  title: L('Descriptive Statistics & Normality', '기술통계와 정규성'),
  description: L(
    'Summarize a measurement by group, then test whether it is normal and read the probability plot.',
    '측정값을 그룹별로 요약한 뒤 정규성을 검정하고 확률도를 읽습니다.',
  ),
  category: 'basic-statistics',
  difficulty: 'beginner',
  estimatedMinutes: 5,
  objectives: [
    L('Read n, mean and standard deviation per group.', '그룹별 n, 평균, 표준편차를 읽습니다.'),
    L('Run an Anderson–Darling normality test and state what a p-value does and does not prove.', '앤더슨–달링 정규성 검정을 실행하고 p값이 무엇을 입증하고 입증하지 않는지 말합니다.'),
    L('Use the probability plot together with the test.', '확률도와 검정을 함께 사용합니다.'),
  ],
  sampleIds: ['process'],
  helpIds: ['descriptive-statistics', 'normality-test'],
  analysisIds: ['desc', 'normality'],
  structure: {
    learn: L(
      'Most standard analyses assume roughly normal data. Descriptives and a normality test are how you check that assumption before relying on it.',
      '대부분의 표준 분석은 대략적인 정규성을 가정합니다. 기술통계와 정규성 검정은 그 가정을 신뢰하기 전에 확인하는 방법입니다.',
    ),
    data: L('The Coating Process sample, 60 thickness measurements across three lines.', '코팅 공정 샘플: 세 라인에 걸친 60개의 두께 측정값입니다.'),
    analysis: L('Descriptive statistics by line, then a normality test on Thickness (mm).', '라인별 기술통계, 이어서 두께(mm)의 정규성 검정입니다.'),
    inputs: L('Descriptives: Thickness (mm) by Line. Normality: Thickness (mm).', '기술통계: 라인별 두께(mm). 정규성: 두께(mm).'),
    check: L('Three summary rows and one AD test row with a p-value and probability plot.', '요약 3행과 p값·확률도가 있는 AD 검정 1행입니다.'),
    interpret: L(
      'A p-value above 0.05 says the data are consistent with normality, not that they are normal. Tails bending away on the plot matter even when the test passes.',
      'p값이 0.05보다 크면 데이터가 정규성과 모순되지 않는다는 뜻이지 정규라는 뜻은 아닙니다. 검정이 통과해도 확률도 양 끝이 휘면 주의해야 합니다.',
    ),
    conclusion: L(
      'Normality is a working assumption with evidence behind it, not a certificate. Record which test and which plot you used.',
      '정규성은 증거가 뒷받침되는 작업 가정이지 보증서가 아닙니다. 어떤 검정과 어떤 그림을 썼는지 기록하십시오.',
    ),
  },
  steps: [
    {
      id: 'load-sample',
      title: L('Load the process sample', '공정 샘플 불러오기'),
      instruction: L('Load the Coating Process sample.', '코팅 공정 샘플을 불러오십시오.'),
      expected: L('60 rows with Thickness (mm) and Line.', '두께(mm)와 라인 열이 있는 60행입니다.'),
      action: { action: 'load-sample', sampleId: 'process' },
      completion: 'validated',
      validation: { kind: 'sample-loaded', sampleId: 'process', columns: ['Thickness (mm)', 'Line'] },
    },
    {
      id: 'descriptives',
      title: L('Summarize by line', '라인별 요약'),
      instruction: L('Open Descriptive Statistics with the preset and run it.', '프리셋으로 기술통계를 열고 실행하십시오.'),
      expected: L('One summary row per line with mean about 10.1–10.3 mm and SD about 0.20 mm.', '라인마다 평균 10.1–10.3 mm, 표준편차 약 0.20 mm인 요약 행이 나옵니다.'),
      action: { action: 'open-analysis', analysisId: 'desc', presetId: 'preset-desc-thickness' },
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'desc' },
    },
    {
      id: 'normality',
      title: L('Test normality', '정규성 검정'),
      instruction: L('Open the normality test with the preset and run it on Thickness (mm).', '프리셋으로 정규성 검정을 열고 두께(mm)에 대해 실행하십시오.'),
      expected: L('An AD statistic, a p-value and a normal probability plot.', 'AD 통계량, p값, 정규확률도가 나옵니다.'),
      action: { action: 'open-analysis', analysisId: 'normality', presetId: 'preset-normality-thickness' },
      helpId: 'normality-test',
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'normality', withChart: 'normalprob' },
    },
    {
      id: 'read-help',
      title: L('Read the normality document', '정규성 문서 읽기'),
      instruction: L('Open the normality document and return.', '정규성 문서를 열고 돌아오십시오.'),
      expected: L('The normality document opens.', '정규성 문서가 열립니다.'),
      action: { action: 'open-help', helpId: 'normality-test' },
      completion: 'validated',
      validation: { kind: 'help-opened', helpId: 'normality-test' },
    },
    {
      id: 'decide',
      title: L('Decide how to proceed', '다음 절차 결정'),
      instruction: L(
        'Decide whether a t-test on these thicknesses is reasonable and mark the step complete with your reason.',
        '이 두께 값에 t검정을 적용하는 것이 타당한지 결정하고 근거와 함께 완료로 표시하십시오.',
      ),
      expected: L('A decision that cites the test result, the plot and the sample size (60).', '검정 결과, 그림, 표본 크기(60)를 근거로 한 결정입니다.'),
      action: { action: 'validate-result' },
      completion: 'manual',
      validation: { kind: 'manual' },
    },
  ],
  nextTutorialId: 'tutorial-hypothesis-001',
};

export const HYPOTHESIS_TUTORIAL: RawTutorial = {
  id: 'tutorial-hypothesis-001',
  title: L('Hypothesis Testing', '가설검정'),
  description: L(
    'A one-sample t-test against a target and a paired t-test on before/after readings, read through their confidence intervals.',
    '목표값에 대한 단일표본 t검정과 전/후 측정의 대응 t검정을 신뢰구간과 함께 읽습니다.',
  ),
  category: 'basic-statistics',
  difficulty: 'beginner',
  estimatedMinutes: 10,
  objectives: [
    L('Test a mean against a target and read the interval, not only the p-value.', '평균을 목표값과 검정하고 p값만이 아니라 구간을 읽습니다.'),
    L('Recognise when a paired test is the right form.', '대응 검정이 적절한 형태인지 판단합니다.'),
    L('Separate statistical significance from practical size.', '통계적 유의성과 실무적 크기를 구분합니다.'),
  ],
  sampleIds: ['comparison'],
  helpIds: ['t-tests', 'power-sample-size'],
  analysisIds: ['t1', 'paired'],
  structure: {
    learn: L(
      'A hypothesis test asks whether the data are compatible with a stated value. The confidence interval says how large the effect might be, which is what a decision needs.',
      '가설검정은 데이터가 명시된 값과 양립하는지 묻습니다. 신뢰구간은 효과가 얼마나 클 수 있는지를 말해 주며, 의사결정에는 그 정보가 필요합니다.',
    ),
    data: L('The Cure Study sample: 40 hardness readings and a before/after pair for the same parts.', '경화 연구 샘플: 경도 40개와 같은 부품의 전/후 측정값입니다.'),
    analysis: L('One-sample t on Hardness against 60, then a paired t on Before − After.', '경도를 60과 비교하는 단일표본 t, 이어서 전−후 대응 t입니다.'),
    inputs: L('t-test: Hardness, target 60, 95 % confidence, two-sided. Paired: Before and After.', 't검정: 경도, 목표 60, 95 % 신뢰, 양측. 대응: 전과 후.'),
    check: L(
      'Mean hardness 61.876 with a 95 % interval of about 61.06–62.70 and p < 0.001; paired mean difference 2.526 with an interval of about 1.98–3.08.',
      '평균 경도 61.876, 95 % 구간 약 61.06–62.70, p < 0.001. 대응 평균 차이 2.526, 구간 약 1.98–3.08입니다.',
    ),
    interpret: L(
      'The hardness is significantly above 60, and the interval says by roughly 1.1–2.7 units. The before/after difference is significantly positive, so the second reading is lower.',
      '경도는 60보다 유의하게 높고 구간은 약 1.1–2.7 단위만큼 높다고 말합니다. 전/후 차이는 유의하게 양수이므로 두 번째 측정값이 더 낮습니다.',
    ),
    conclusion: L(
      'Report the estimate with its interval. “Significant” alone does not say whether the difference matters to the product.',
      '추정값을 구간과 함께 보고하십시오. “유의하다”만으로는 그 차이가 제품에 중요한지 알 수 없습니다.',
    ),
  },
  steps: [
    {
      id: 'load-sample',
      title: L('Load the Cure Study', '경화 연구 불러오기'),
      instruction: L('Load the Cure Study sample.', '경화 연구 샘플을 불러오십시오.'),
      expected: L('A worksheet with Group, Hardness, Operator, Before and After.', '그룹, 경도, 작업자, 전, 후 열이 있는 워크시트입니다.'),
      action: { action: 'load-sample', sampleId: 'comparison' },
      completion: 'validated',
      validation: { kind: 'sample-loaded', sampleId: 'comparison', columns: ['Hardness', 'Before', 'After'] },
    },
    {
      id: 'one-sample',
      title: L('One-sample t-test against 60', '60에 대한 단일표본 t검정'),
      instruction: L('Open the one-sample t-test with the preset (Hardness, target 60) and run it.', '프리셋(경도, 목표 60)으로 단일표본 t검정을 열고 실행하십시오.'),
      expected: L('A p-value below 0.05 and an interval that excludes 60.', 'p값이 0.05 미만이고 60을 포함하지 않는 구간이 나옵니다.'),
      action: { action: 'open-analysis', analysisId: 't1', presetId: 'preset-t1-hardness' },
      helpId: 't-tests',
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 't1' },
    },
    {
      id: 'paired',
      title: L('Paired t-test on Before − After', '전−후 대응 t검정'),
      instruction: L('Open the paired t-test with the preset and run it.', '프리셋으로 대응 t검정을 열고 실행하십시오.'),
      expected: L('A mean difference of about 2.53 with p < 0.001.', '평균 차이 약 2.53, p < 0.001이 나옵니다.'),
      hint: L('Pairing removes part-to-part variation; an independent two-sample test would be less sensitive here.', '대응은 부품 간 변동을 제거합니다. 독립 이표본 검정은 여기서 더 둔합니다.'),
      action: { action: 'open-analysis', analysisId: 'paired', presetId: 'preset-paired-before-after' },
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'paired' },
    },
    {
      id: 'read-help',
      title: L('Read the t-test document', 't검정 문서 읽기'),
      instruction: L('Open the t-tests document and return.', 't검정 문서를 열고 돌아오십시오.'),
      expected: L('The t-tests document opens.', 't검정 문서가 열립니다.'),
      action: { action: 'open-help', helpId: 't-tests' },
      completion: 'validated',
      validation: { kind: 'help-opened', helpId: 't-tests' },
    },
    {
      id: 'state',
      title: L('State both conclusions', '두 결론 정리'),
      instruction: L(
        'Write one sentence per test: the estimate, its interval and the decision. Mark the step complete.',
        '검정마다 한 문장으로 추정값, 구간, 결정을 적고 완료로 표시하십시오.',
      ),
      expected: L('Two sentences that quote the intervals, not only the p-values.', 'p값만이 아니라 구간을 인용한 두 문장입니다.'),
      action: { action: 'validate-result' },
      completion: 'manual',
      validation: { kind: 'manual' },
    },
  ],
  nextTutorialId: 'tutorial-regression-001',
};

export const PART1_TUTORIALS = [
  defineTutorial(START_TUTORIAL),
  defineTutorial(DATA_TUTORIAL),
  defineTutorial(NORMALITY_TUTORIAL),
  defineTutorial(HYPOTHESIS_TUTORIAL),
];
