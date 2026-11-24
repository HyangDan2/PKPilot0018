/* Sigrún — tutorials T09–T12: Gage R&R, reliability, DOE, and the flagship
   multi-response optimisation on the synthetic display-optics design. */

import { defineTutorial, type RawTutorial } from '../define';

const L = (en: string, ko: string) => ({ en, ko });

export const GAGERR_TUTORIAL: RawTutorial = {
  id: 'tutorial-gagerr-001',
  title: L('Gage R&R', '게이지 R&R'),
  description: L(
    'Separate measurement variation from part variation in a crossed study, and decide whether the gage can see what it must see.',
    '교차 연구에서 측정 변동을 부품 변동과 분리하고, 게이지가 필요한 것을 구별할 수 있는지 판단합니다.',
  ),
  category: 'msa',
  difficulty: 'intermediate',
  estimatedMinutes: 10,
  objectives: [
    L('Read variance components and their percentages.', '분산성분과 그 비율을 읽습니다.'),
    L('Use %GRR and ndc together.', '%GRR과 ndc를 함께 사용합니다.'),
    L('Decide between retraining, fixturing and replacing a gage.', '교육·고정구·게이지 교체 중 무엇인지 판단합니다.'),
  ],
  sampleIds: ['gagerr'],
  helpIds: ['gage-rr'],
  analysisIds: ['gagerr'],
  structure: {
    learn: L(
      'Before a measurement is used to judge a process, the measurement itself must be judged. Gage R&R splits observed variation into parts, operators and repeat error.',
      '측정값으로 공정을 판단하기 전에 측정 자체를 판단해야 합니다. 게이지 R&R은 관측 변동을 부품·작업자·반복오차로 나눕니다.',
    ),
    data: L('The Gage R&R sample: 10 parts × 3 operators × 3 replicates, crossed.', '게이지 R&R 샘플: 10개 부품 × 3명 작업자 × 3회 반복, 교차 설계입니다.'),
    analysis: L('Crossed Gage R&R with part, operator and measurement columns.', '부품·작업자·측정값 열로 교차 게이지 R&R을 수행합니다.'),
    inputs: L('Part, Operator, Measurement; crossed study; study variation multiplier 6.', '부품, 작업자, 측정값. 교차 연구. 연구 변동 배수 6.'),
    check: L(
      'Total Gage R&R 26.0 % of study variation, repeatability 14.9 %, reproducibility 21.3 %, ndc = 5.',
      '전체 게이지 R&R은 연구 변동의 26.0 %, 반복성 14.9 %, 재현성 21.3 %, ndc = 5입니다.',
    ),
    interpret: L(
      'A %GRR near 26 % is marginal: the gage consumes about a quarter of the variation it is asked to measure. Five distinct categories is the minimum usually accepted; the operator component says where to look.',
      '%GRR 26 %는 경계 수준입니다. 게이지가 측정해야 할 변동의 약 4분의 1을 소비합니다. 구별 가능 범주 5개는 보통 최소 허용치이며, 작업자 성분이 어디를 볼지 알려 줍니다.',
    ),
    conclusion: L(
      'Improve the measurement before tightening the specification. Retraining or a fixture is cheaper than a new gage and often enough.',
      '규격을 조이기 전에 측정을 개선하십시오. 교육이나 고정구가 새 게이지보다 저렴하고 충분한 경우가 많습니다.',
    ),
  },
  steps: [
    {
      id: 'load-sample',
      title: L('Load the gage study', '게이지 연구 불러오기'),
      instruction: L('Load the Gage R&R sample.', '게이지 R&R 샘플을 불러오십시오.'),
      expected: L('90 rows of Part, Operator and Measurement.', '부품·작업자·측정값의 90행입니다.'),
      action: { action: 'load-sample', sampleId: 'gagerr' },
      completion: 'validated',
      validation: { kind: 'sample-loaded', sampleId: 'gagerr', columns: ['Part', 'Operator', 'Measurement'] },
    },
    {
      id: 'gagerr',
      title: L('Run the crossed study', '교차 연구 실행'),
      instruction: L('Open Gage R&R with the preset (crossed) and run it.', '프리셋(교차)으로 게이지 R&R을 열고 실행하십시오.'),
      expected: L('An ANOVA table, variance components and %GRR near 26 %.', '분산분석표, 분산성분, %GRR 약 26 %가 나옵니다.'),
      action: { action: 'open-analysis', analysisId: 'gagerr', presetId: 'preset-gagerr-crossed' },
      helpId: 'gage-rr',
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'gagerr' },
    },
    {
      id: 'read-help',
      title: L('Read the Gage R&R document', '게이지 R&R 문서 읽기'),
      instruction: L('Open the Gage R&R document and return.', '게이지 R&R 문서를 열고 돌아오십시오.'),
      expected: L('The Gage R&R document opens.', '게이지 R&R 문서가 열립니다.'),
      action: { action: 'open-help', helpId: 'gage-rr' },
      completion: 'validated',
      validation: { kind: 'help-opened', helpId: 'gage-rr' },
    },
    {
      id: 'decide',
      title: L('Decide what to improve', '개선 대상 결정'),
      instruction: L(
        'Name the largest measurement component and the action it suggests, then mark the step complete.',
        '가장 큰 측정 성분과 그에 따른 조치를 적고 완료로 표시하십시오.',
      ),
      expected: L('A decision naming reproducibility (21.3 %) and operator-related action.', '재현성(21.3 %)과 작업자 관련 조치를 지목한 결정입니다.'),
      action: { action: 'validate-result' },
      completion: 'manual',
      validation: { kind: 'manual' },
    },
  ],
  nextTutorialId: 'tutorial-reliability-001',
};

export const RELIABILITY_TUTORIAL: RawTutorial = {
  id: 'tutorial-reliability-001',
  title: L('Reliability Analysis', '신뢰성 분석'),
  description: L(
    'Fit a Weibull life distribution, read shape and scale, and find the time by which 10 % have failed.',
    '와이블 수명분포를 적합하고 형상·척도를 읽으며, 10 %가 고장나는 시점을 구합니다.',
  ),
  category: 'reliability',
  difficulty: 'intermediate',
  estimatedMinutes: 15,
  objectives: [
    L('Read a Weibull shape parameter as a failure mode.', '와이블 형상모수를 고장 모드로 읽습니다.'),
    L('Report B10 and MTTF together.', 'B10과 MTTF를 함께 보고합니다.'),
    L('Notice when a probability plot says one distribution is not enough.', '확률도가 분포 하나로 충분하지 않다고 말할 때를 알아봅니다.'),
  ],
  sampleIds: ['weibull'],
  helpIds: ['reliability-weibull'],
  analysisIds: ['weibull'],
  structure: {
    learn: L(
      'Reliability asks how long a product lasts and how it fails. A life distribution turns a list of failure times into a curve, a percentile and a failure mode.',
      '신뢰성은 제품이 얼마나 오래가고 어떻게 고장나는지를 묻습니다. 수명분포는 고장시간 목록을 곡선·백분위수·고장 모드로 바꿉니다.',
    ),
    data: L(
      'The Weibull Life sample: 40 units tested to 400 hours. In this sample every unit failed before the limit, so the censoring column is all zero.',
      '와이블 수명 샘플: 400시간까지 시험한 40개 제품입니다. 이 샘플에서는 모두 시험 한계 전에 고장나 중도절단 열이 모두 0입니다.',
    ),
    analysis: L('Weibull MLE with Time and the Censored indicator.', '시간과 중도절단 표시를 사용하는 와이블 최대우도 적합입니다.'),
    inputs: L('Failure time: Time. Censoring column: Censored, 1 = censored. 95 % confidence.', '고장시간: Time. 중도절단 열: Censored, 1=중도절단. 95 % 신뢰.'),
    check: L(
      'Shape β ≈ 2.44, scale η ≈ 206 h, B10 ≈ 81.8 h, MTTF ≈ 182.7 h, and a probability plot with the fitted line.',
      '형상 β ≈ 2.44, 척도 η ≈ 206 h, B10 ≈ 81.8 h, MTTF ≈ 182.7 h, 적합선이 있는 확률도입니다.',
    ),
    interpret: L(
      'A shape above 1 means wear-out: failures become more likely with age. B10 of about 82 hours is much shorter than the MTTF of 183 hours, which is why a mean life alone hides the early tail.',
      '형상이 1보다 크면 마모 고장입니다. 나이가 들수록 고장 가능성이 커집니다. B10 약 82시간은 MTTF 183시간보다 훨씬 짧으며, 평균 수명만 보면 초기 꼬리가 가려집니다.',
    ),
    conclusion: L(
      'State the percentile the customer cares about, not only the mean. Plan a test long enough for the censoring to be informative.',
      '평균만이 아니라 고객이 관심 갖는 백분위수를 말하십시오. 중도절단이 정보를 갖도록 충분히 긴 시험을 계획하십시오.',
    ),
  },
  steps: [
    {
      id: 'load-sample',
      title: L('Load the life data', '수명 데이터 불러오기'),
      instruction: L('Load the Weibull Life sample.', '와이블 수명 샘플을 불러오십시오.'),
      expected: L('40 rows with Time and Censored.', '시간과 중도절단 열의 40행입니다.'),
      action: { action: 'load-sample', sampleId: 'weibull' },
      completion: 'validated',
      validation: { kind: 'sample-loaded', sampleId: 'weibull', columns: ['Time', 'Censored'] },
    },
    {
      id: 'fit',
      title: L('Fit the Weibull distribution', '와이블 분포 적합'),
      instruction: L('Open Weibull Analysis with the preset and run it.', '프리셋으로 와이블 분석을 열고 실행하십시오.'),
      expected: L('Shape 2.44, scale 206, B10 81.8, MTTF 182.7 and a probability plot.', '형상 2.44, 척도 206, B10 81.8, MTTF 182.7과 확률도입니다.'),
      action: { action: 'open-analysis', analysisId: 'weibull', presetId: 'preset-weibull-life' },
      helpId: 'reliability-weibull',
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'weibull', withChart: 'probplot' },
    },
    {
      id: 'read-help',
      title: L('Read the reliability document', '신뢰성 문서 읽기'),
      instruction: L('Open the Weibull document and return.', '와이블 문서를 열고 돌아오십시오.'),
      expected: L('The Weibull document opens.', '와이블 문서가 열립니다.'),
      action: { action: 'open-help', helpId: 'reliability-weibull' },
      completion: 'validated',
      validation: { kind: 'help-opened', helpId: 'reliability-weibull' },
    },
    {
      id: 'report',
      title: L('State the life claim', '수명 주장 정리'),
      instruction: L(
        'Write the B10 and the failure mode in one sentence, then mark the step complete.',
        'B10과 고장 모드를 한 문장으로 적고 완료로 표시하십시오.',
      ),
      expected: L('A sentence such as “10 % fail by about 82 h and the shape of 2.44 shows wear-out.”', '예: “약 82시간에 10 %가 고장나며 형상 2.44는 마모 고장을 보여 준다.”'),
      action: { action: 'validate-result' },
      completion: 'manual',
      validation: { kind: 'manual' },
    },
  ],
  nextTutorialId: 'tutorial-doe-001',
};

export const DOE_TUTORIAL: RawTutorial = {
  id: 'tutorial-doe-001',
  title: L('DOE & Response Surface', '실험계획과 반응표면'),
  description: L(
    'Analyse a 2³ factorial design, store the fitted model, and read its contour — the step before multi-response optimisation.',
    '2³ 요인설계를 분석하고 적합 모형을 저장한 뒤 등고선을 읽습니다. 다중반응 최적화 직전 단계입니다.',
  ),
  category: 'doe-rsm',
  difficulty: 'advanced',
  estimatedMinutes: 20,
  objectives: [
    L('Read effects and their significance in a factorial design.', '요인설계에서 효과와 유의성을 읽습니다.'),
    L('Store a design model and carry it into a contour plot.', '설계 모형을 저장하고 등고선으로 이어 갑니다.'),
    L('Recognise an interaction that changes how a main effect is read.', '주효과 해석을 바꾸는 교호작용을 알아봅니다.'),
  ],
  sampleIds: ['doe', 'rsm'],
  helpIds: ['doe-factorial', 'factorial-analysis', 'contour-surface', 'model-store'],
  analysisIds: ['doeanalyze'],
  structure: {
    learn: L(
      'A designed experiment varies factors together so effects and interactions are estimable. The analysis reports each effect with a test, not just a direction.',
      '실험계획은 요인을 함께 변화시켜 효과와 교호작용을 추정 가능하게 합니다. 분석은 방향만이 아니라 검정과 함께 각 효과를 보고합니다.',
    ),
    data: L('The 2³ Design sample: eight factorial runs in A, B, C, two centre points and a response Y.', '2³ 설계 샘플: A·B·C의 8개 요인 배치, 중심점 2개, 반응 Y입니다.'),
    analysis: L('Analyze Factorial Design with Y on A, B and C at interaction order 2.', 'A·B·C에 대한 Y의 요인설계 분석(교호작용 2차)입니다.'),
    inputs: L('Response Y; factors A, B, C; order 2.', '반응 Y, 요인 A·B·C, 차수 2.'),
    check: L(
      'A effect 8.26, B 5.06, A×B 3.56, A×C −2.75, C −2.91, B×C not significant (p 0.368); R² 99.79 %.',
      'A 효과 8.26, B 5.06, A×B 3.56, A×C −2.75, C −2.91, B×C는 유의하지 않음(p 0.368), R² 99.79 %.',
    ),
    interpret: L(
      'A and B both raise Y, and their interaction is real: the gain from A is larger when B is high. B×C can be dropped, which leaves a model with six terms and three residual degrees of freedom.',
      'A와 B 모두 Y를 올리고 교호작용도 실제입니다. B가 높을 때 A의 이득이 더 큽니다. B×C는 제거할 수 있으며 6개 항과 잔차 자유도 3인 모형이 남습니다.',
    ),
    conclusion: L(
      'Set the factors from the effects, not from one run. A contour is the same model drawn two factors at a time and is the input to optimisation.',
      '한 배치가 아니라 효과로 요인을 설정하십시오. 등고선은 같은 모형을 두 요인씩 그린 것이며 최적화의 입력입니다.',
    ),
  },
  steps: [
    {
      id: 'load-sample',
      title: L('Load the factorial design', '요인설계 불러오기'),
      instruction: L('Load the 2³ Factorial Design sample.', '2³ 요인설계 샘플을 불러오십시오.'),
      expected: L('Ten runs with StdOrder, RunOrder, PtType, A, B, C and Y.', '표준순서·실행순서·점유형·A·B·C·Y가 있는 10개 배치입니다.'),
      action: { action: 'load-sample', sampleId: 'doe' },
      completion: 'validated',
      validation: { kind: 'sample-loaded', sampleId: 'doe', columns: ['A', 'B', 'C', 'Y'] },
    },
    {
      id: 'read-help',
      title: L('Read the DOE document', '실험계획 문서 읽기'),
      instruction: L('Open the factorial design document and return.', '요인설계 문서를 열고 돌아오십시오.'),
      expected: L('The DOE document opens.', '실험계획 문서가 열립니다.'),
      action: { action: 'open-help', helpId: 'doe-factorial' },
      completion: 'validated',
      validation: { kind: 'help-opened', helpId: 'doe-factorial' },
    },
    {
      id: 'analyze',
      title: L('Analyse the design', '설계 분석'),
      instruction: L('Open Analyze Factorial with the preset and run it.', '프리셋으로 요인설계 분석을 열고 실행하십시오.'),
      expected: L('An effects table, an ANOVA table and R² near 99.8 %.', '효과표, 분산분석표, R² 약 99.8 %입니다.'),
      action: { action: 'open-analysis', analysisId: 'doeanalyze', presetId: 'preset-doeanalyze-twolevel' },
      helpId: 'factorial-analysis',
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'doeanalyze', requireModel: true },
    },
    {
      id: 'store',
      title: L('Store the model and open the contour', '모형 저장과 등고선 열기'),
      instruction: L(
        'Press “Save model” on the analysis card, then use the action button to build a contour of Y over A and B from that stored model.',
        '분석 카드에서 “Save model”을 누른 뒤 실행 버튼으로 저장 모형에서 A·B에 대한 Y 등고선을 만드십시오.',
      ),
      expected: L('A stored model for Y and a contour card titled Y = f(A, B).', 'Y 저장 모형과 “Y = f(A, B)” 등고선 카드입니다.'),
      action: { action: 'open-chart', chart: { kind: 'contour', responses: ['Y'] } },
      helpId: 'contour-surface',
      completion: 'validated',
      validation: { kind: 'model-stored', responses: ['Y'], minCount: 1, minR2: 0.9 },
    },
    {
      id: 'contour',
      title: L('Check the contour', '등고선 확인'),
      instruction: L(
        'The contour needs the stored model; if the card is missing, store the model first and press the action again.',
        '등고선은 저장 모형이 필요합니다. 카드가 없으면 모형을 먼저 저장하고 실행 버튼을 다시 누르십시오.',
      ),
      expected: L('A filled contour of Y with A on the x-axis and B on the y-axis.', 'x축 A, y축 B의 채워진 Y 등고선입니다.'),
      action: { action: 'open-chart', chart: { kind: 'contour', responses: ['Y'] } },
      completion: 'validated',
      validation: { kind: 'chart', chartKind: 'contour', responses: ['Y'] },
    },
    {
      id: 'export',
      title: L('Export the contour figure', '등고선 그림 내보내기'),
      instruction: L(
        'Export the contour as a report figure: the action opens the layout editor, where you place the chart, add a figure label and export a PNG or SVG.',
        '등고선을 보고서 그림으로 내보내십시오. 실행하면 배치 편집기가 열리며, 차트를 배치하고 그림 번호를 붙여 PNG 또는 SVG로 내보냅니다.',
      ),
      expected: L('An exported figure file (PNG or SVG).', '내보낸 그림 파일(PNG 또는 SVG)입니다.'),
      action: { action: 'export-chart', export: { format: 'figure' } },
      helpId: 'graph-layout',
      completion: 'validated',
      validation: { kind: 'chart-exported', formats: ['png', 'svg'] },
    },
    {
      id: 'conclude',
      title: L('Set the factors', '요인 설정'),
      instruction: L(
        'Say which levels of A and B you would run and why, and mark the step complete.',
        'A와 B를 어느 수준으로 운전할지와 그 이유를 적고 완료로 표시하십시오.',
      ),
      expected: L('A recommendation justified by the A, B and A×B effects.', 'A·B·A×B 효과로 정당화된 권고입니다.'),
      action: { action: 'validate-result' },
      completion: 'manual',
      validation: { kind: 'manual' },
    },
  ],
  nextTutorialId: 'tutorial-rsm-001',
};

export const FLAGSHIP_TUTORIAL: RawTutorial = {
  id: 'tutorial-rsm-001',
  version: 1,
  title: L('Multi-Response Optimization (Display Optics)', '다중반응 최적화 (디스플레이 광학)'),
  description: L(
    'The flagship practice: fit four response-surface models on a synthetic display-optics design, find the condition that trades luminance, power, uniformity and temperature, and confirm every component agrees.',
    '대표 실습: 합성 디스플레이 광학 설계에서 네 개의 반응표면 모형을 적합하고, 휘도·소비전력·균일도·온도를 절충하는 조건을 찾은 뒤 모든 구성 요소가 일치하는지 확인합니다.',
  ),
  category: 'optimization',
  difficulty: 'advanced',
  estimatedMinutes: 20,
  objectives: [
    L('Fit and store one response-surface model per response.', '반응마다 반응표면 모형을 적합하고 저장합니다.'),
    L('Read contour, surface and overlaid contour as one model.', '등고선·표면·중첩 등고선을 하나의 모형으로 읽습니다.'),
    L('Optimise four responses under hard limits and read the status honestly.', '네 반응을 하드 한계 아래에서 최적화하고 상태를 정직하게 읽습니다.'),
    L('Explain why a model optimum still needs a confirmation experiment.', '모형 최적점에 확인 실험이 필요한 이유를 설명합니다.'),
  ],
  sampleIds: ['display-optical-doe'],
  helpIds: ['worksheet-import', 'rsm-fitting', 'model-store', 'contour-surface', 'multi-response-optimization', 'prediction-profiler', 'graph-layout'],
  analysisIds: ['desc', 'scatter', 'rsmanalyze'],
  structure: {
    learn: L(
      'An optical stack has to be bright, efficient, uniform and cool at once. Each response has its own surface; optimisation is where they are traded against each other, and where the trade becomes explicit.',
      '광학 적층은 밝고, 효율적이고, 균일하고, 동시에 차가워야 합니다. 반응마다 표면이 다르고, 최적화에서 그 반응들이 서로 절충되며 절충이 명시적으로 드러납니다.',
    ),
    data: L(
      'SYNTHETIC display-optics DoE: a face-centred central composite design in LED current, optical distance and diffuser haze, with luminance, power, uniformity and temperature. It was generated from quadratic models plus a fixed seed and is not measured product data.',
      '합성 디스플레이 광학 DoE: LED 전류·광학 거리·확산제 헤이즈의 면중심 중심합성 설계와 휘도·소비전력·균일도·온도 반응입니다. 2차 모형과 고정 시드로 생성했으며 실제 제품 측정 데이터가 아닙니다.',
    ),
    analysis: L(
      'Descriptives and a scatter to explore, four response-surface fits, then contour, surface, overlaid contour, optimiser and profiler on the stored models.',
      '탐색용 기술통계와 산점도, 네 번의 반응표면 적합, 이어서 저장 모형 위의 등고선·표면·중첩 등고선·최적화·프로파일러입니다.',
    ),
    inputs: L(
      'Factors: LED Current, Optical Distance, Diffuser Haze (coded −1/0/+1 = 20/50/80 mA, 2/6/10 mm, 10/40/70 %). Responses: Luminance, Power, Uniformity, Temperature.',
      '요인: LED 전류, 광학 거리, 확산제 헤이즈(코드 −1/0/+1 = 20/50/80 mA, 2/6/10 mm, 10/40/70 %). 반응: 휘도, 소비전력, 균일도, 온도.',
    ),
    check: L(
      'Four stored RSM models with R² above 0.98; an overlaid contour with a feasible region; an optimiser solution whose predictions match the stored models at the same factor values.',
      'R² 0.98 이상의 저장 RSM 모형 4개, 실행가능 영역이 있는 중첩 등고선, 같은 요인 값에서 저장 모형과 예측이 일치하는 최적화 해입니다.',
    ),
    interpret: L(
      'The optimum is a compromise: higher current buys luminance but costs power and temperature; less distance buys luminance but costs uniformity. The composite desirability says how good that compromise is, not that it is achievable in production.',
      '최적점은 절충입니다. 전류를 높이면 휘도가 오르지만 소비전력과 온도가 오르고, 거리를 줄이면 휘도가 오르지만 균일도가 떨어집니다. 복합 만족도는 그 절충이 얼마나 좋은지를 말할 뿐 생산에서 달성 가능함을 보증하지 않습니다.',
    ),
    conclusion: L(
      'Take the predicted condition into a confirmation experiment before production. The model is the map; the confirmation run is the ground.',
      '예측 조건을 생산 전 확인 실험으로 가져가십시오. 모형은 지도이고 확인 실험은 땅입니다.',
    ),
  },
  flagship: true,
  steps: [
    {
      id: 'load-data',
      title: L('Step 1 · Load the DOE dataset', '1단계 · DOE 데이터 불러오기'),
      instruction: L(
        'Load the Display Optics DoE sample and check the columns: design order, the three coded factors, the actual-unit columns and the four responses.',
        '디스플레이 광학 DoE 샘플을 불러오고 열을 확인하십시오. 설계 순서, 코드화 요인 3개, 실제 단위 열, 반응 4개입니다.',
      ),
      expected: L('Twenty runs with 13 columns including four responses.', '반응 4개를 포함한 13개 열의 20개 배치입니다.'),
      hint: L('The coded columns are the analysis inputs; the mA/mm/% columns show the physical setting.', '분석 입력은 코드화 열이고 mA/mm/% 열은 실제 설정을 보여 줍니다.'),
      action: { action: 'load-sample', sampleId: 'display-optical-doe' },
      helpId: 'worksheet-import',
      completion: 'validated',
      validation: {
        kind: 'sample-loaded',
        sampleId: 'display-optical-doe',
        columns: ['LED Current (coded)', 'Optical Distance (coded)', 'Diffuser Haze (coded)', 'Luminance (cd/m2)', 'Power Consumption (W)', 'Uniformity (%)', 'Temperature (C)'],
      },
    },
    {
      id: 'explore',
      title: L('Step 2 · Explore the data', '2단계 · 데이터 탐색'),
      instruction: L(
        'Run Descriptives on the four responses, then a scatter of Luminance against LED Current. Both are preset; check the shapes before modelling.',
        '네 반응의 기술통계를 실행하고 휘도 대 LED 전류의 산점도를 그리십시오. 둘 다 프리셋이 있으며 모형화 전에 모양을 확인하십시오.',
      ),
      expected: L('A summary table for four responses and a scatter with a fit line.', '네 반응 요약표와 적합선이 있는 산점도입니다.'),
      action: { action: 'open-analysis', analysisId: 'desc', presetId: 'preset-desc-display-responses', presetIds: ['preset-scatter-luminance-current'] },
      helpId: 'graph-basics',
      completion: 'validated',
      validation: {
        kind: 'analysis-outputs',
        requirements: [
          { analysisId: 'desc' },
          { analysisId: 'scatter', withChart: 'scatter' },
        ],
      },
    },
    {
      id: 'fit-models',
      title: L('Step 3 · Fit the four response surfaces', '3단계 · 반응표면 4개 적합'),
      instruction: L(
        'Open Analyze Response Surface with the Luminance preset and run it. Then repeat with the other three preset buttons below — same three factors, one response each.',
        '휘도 프리셋으로 반응표면 분석을 열고 실행하십시오. 그다음 아래의 나머지 세 프리셋 버튼으로 같은 요인, 반응만 바꿔 반복하십시오.',
      ),
      expected: L('Four RSM output cards, each with an ANOVA table, R² and a contour.', '각각 분산분석표·R²·등고선이 있는 RSM 결과 카드 4개입니다.'),
      hint: L('Every fit uses the same three coded factors; only the response changes.', '모든 적합이 같은 코드화 요인 세 개를 쓰고 반응만 바뀝니다.'),
      action: {
        action: 'open-analysis',
        analysisId: 'rsmanalyze',
        presetId: 'preset-rsm-luminance',
        presetIds: ['preset-rsm-power', 'preset-rsm-uniformity', 'preset-rsm-temperature'],
      },
      helpId: 'rsm-fitting',
      completion: 'validated',
      validation: { kind: 'analysis-output', analysisId: 'rsmanalyze', minCount: 4, requireModel: true },
    },
    {
      id: 'store-models',
      title: L('Step 4 · Store the models', '4단계 · 모형 저장'),
      instruction: L(
        'Press “Save model” on each of the four RSM cards, then open the Model Manager. Each stored model must be an RSM with squared terms and R² above 0.9.',
        'RSM 카드 네 개에서 각각 “Save model”을 누른 뒤 모형 관리자를 여십시오. 저장 모형은 제곱항이 있는 RSM이고 R²가 0.9를 넘어야 합니다.',
      ),
      expected: L('Four stored RSM models named after their responses, all fresh.', '반응 이름을 가진 저장 RSM 모형 4개, 모두 최신 상태입니다.'),
      action: { action: 'open-model-manager' },
      helpId: 'model-store',
      completion: 'validated',
      validation: {
        kind: 'model-stored',
        responses: ['Luminance (cd/m2)', 'Power Consumption (W)', 'Uniformity (%)', 'Temperature (C)'],
        minCount: 4,
        minR2: 0.9,
        quadratic: true,
      },
    },
    {
      id: 'contour',
      title: L('Step 5 · Contour of luminance', '5단계 · 휘도 등고선'),
      instruction: L(
        'Build a contour of Luminance over LED Current and Optical Distance from the stored model. Note the holding value of diffuser haze.',
        '저장 모형으로 LED 전류·광학 거리에 대한 휘도 등고선을 만드십시오. 확산제 헤이즈의 고정값을 확인하십시오.',
      ),
      expected: L('A filled contour card titled Luminance = f(LED Current, Optical Distance).', '“Luminance = f(LED Current, Optical Distance)” 채워진 등고선 카드입니다.'),
      action: { action: 'open-chart', chart: { kind: 'contour', responses: ['Luminance (cd/m2)'] } },
      helpId: 'contour-surface',
      completion: 'validated',
      validation: { kind: 'chart', chartKind: 'contour', responses: ['Luminance (cd/m2)'] },
    },
    {
      id: 'surface',
      title: L('Step 6 · 3D surface', '6단계 · 3D 표면'),
      instruction: L(
        'Build the 3D surface for the same model, rotate the view and look for the dome or saddle.',
        '같은 모형의 3D 표면을 만들고 시점을 돌려 돔 또는 안장 모양을 확인하십시오.',
      ),
      expected: L('A surface card with design points and the fitted shape.', '설계점과 적합 형상이 있는 표면 카드입니다.'),
      action: { action: 'open-chart', chart: { kind: 'surface3d', responses: ['Luminance (cd/m2)'] } },
      completion: 'validated',
      validation: { kind: 'chart', chartKind: 'surface3d', responses: ['Luminance (cd/m2)'] },
    },
    {
      id: 'overlaid',
      title: L('Step 7 · Overlaid contour', '7단계 · 중첩 등고선'),
      instruction: L(
        'Overlay all four stored models. The contour shows each response’s specification region at once; check where they intersect and whether any prediction leaves the fitted region.',
        '저장 모형 네 개를 중첩하십시오. 반응마다의 규격 영역이 한 번에 보이며, 교집합의 위치와 예측이 적합 영역을 벗어나는지 확인하십시오.',
      ),
      expected: L('An overlaid contour with four responses and a non-empty feasible region.', '네 반응과 비어 있지 않은 실행가능 영역이 있는 중첩 등고선입니다.'),
      action: {
        action: 'open-chart',
        chart: {
          kind: 'overlaid',
          responses: ['Luminance (cd/m2)', 'Power Consumption (W)', 'Uniformity (%)', 'Temperature (C)'],
          specs: [
            { response: 'Luminance (cd/m2)', lsl: 480, usl: 600 },
            { response: 'Power Consumption (W)', lsl: 6, usl: 14 },
            { response: 'Uniformity (%)', lsl: 85, usl: 100 },
            { response: 'Temperature (C)', lsl: 20, usl: 45 },
          ],
        },
      },
      completion: 'validated',
      validation: {
        kind: 'chart',
        chartKind: 'overlaid',
        responses: ['Luminance (cd/m2)', 'Power Consumption (W)', 'Uniformity (%)', 'Temperature (C)'],
        requireFeasible: true,
      },
    },
    {
      id: 'optimize',
      title: L('Step 8 · Response optimizer', '8단계 · 반응 최적화'),
      instruction: L(
        'Open the optimiser with the tutorial goals: maximise luminance (480–600), minimise power (6–14 W), uniformity 85–100 %, temperature 20–45 °C, factors within their fitted bounds. Run it and check the status and composite desirability.',
        '튜토리얼 목표로 최적화를 여십시오. 휘도 최대화(480–600), 소비전력 최소화(6–14 W), 균일도 85–100 %, 온도 20–45 °C, 요인은 적합 범위 안. 실행하고 상태와 복합 만족도를 확인하십시오.',
      ),
      expected: L(
        'A converged solution with a composite around 0.6 and every response inside its limit; the predictions agree with the stored models.',
        '복합 만족도 약 0.6이고 모든 반응이 한계 안에 있는 수렴 해. 예측값이 저장 모형과 일치합니다.',
      ),
      hint: L('Read the status first: “local-converged” means a local basin, not a proven global optimum.', '상태를 먼저 읽으십시오. “local-converged”는 국소 영역이지 전역 최적의 증명이 아닙니다.'),
      action: {
        action: 'open-optimizer',
        optimizer: {
          responses: [
            { response: 'Luminance (cd/m2)', goal: 'maximize', lower: 480, upper: 600 },
            { response: 'Power Consumption (W)', goal: 'minimize', lower: 6, upper: 14 },
            { response: 'Uniformity (%)', goal: 'range', lower: 85, upper: 100 },
            { response: 'Temperature (C)', goal: 'range', lower: 20, upper: 45 },
          ],
        },
      },
      helpId: 'multi-response-optimization',
      completion: 'validated',
      validation: {
        kind: 'optimizer-run',
        goals: [
          { response: 'Luminance (cd/m2)', goal: 'maximize' },
          { response: 'Power Consumption (W)', goal: 'minimize' },
          { response: 'Uniformity (%)', goal: 'range' },
          { response: 'Temperature (C)', goal: 'range' },
        ],
        minComposite: 0.3,
        statuses: ['global-optimal', 'local-converged', 'best-found'],
        consistent: true,
      },
    },
    {
      id: 'profiler',
      title: L('Step 9 · Prediction profiler', '9단계 · 예측 프로파일러'),
      instruction: L(
        'Open the profiler at the optimiser’s best condition (the button uses the last result). Read each factor’s slope and the prediction intervals, then save the condition.',
        '최적화 최선 조건에서 프로파일러를 여십시오(버튼이 마지막 결과를 사용합니다). 요인별 기울기와 예측구간을 읽고 조건을 저장하십시오.',
      ),
      expected: L('Profiler rows for four responses at the optimiser’s factor values, predictions matching the optimizer.', '최적화 요인 값에서 네 반응 행, 최적화와 일치하는 예측값입니다.'),
      action: { action: 'open-profiler' },
      helpId: 'prediction-profiler',
      completion: 'validated',
      validation: { kind: 'profiler-check', atOptimizerPoint: true, consistent: true },
    },
    {
      id: 'layout',
      title: L('Step 10 · Figure layout and export', '10단계 · 그림 배치와 내보내기'),
      instruction: L(
        'Open the layout editor, place at least two charts (for example the overlaid contour and the 3D surface), add a figure label, save the layout and export a PNG.',
        '배치 편집기를 열고 차트를 두 개 이상 배치하십시오(예: 중첩 등고선과 3D 표면). 그림 번호를 추가하고 배치를 저장한 뒤 PNG로 내보내십시오.',
      ),
      expected: L('A saved layout with two chart panels and one figure label, and an exported PNG.', '차트 패널 2개와 그림 번호 1개가 있는 저장 배치, 그리고 내보낸 PNG입니다.'),
      action: { action: 'open-layout', layout: { minChartPanels: 2 } },
      helpId: 'graph-layout',
      completion: 'validated',
      validation: { kind: 'layout-export', minChartPanels: 2, requireFigureLabel: true, format: 'png' },
    },
    {
      id: 'save-project',
      title: L('Step 11 · Save the practice project', '11단계 · 실습 프로젝트 저장'),
      instruction: L(
        'Save the practice project with the action button. Sigrún writes the project file and reads it back to confirm worksheets, outputs and models survive the round trip.',
        '실행 버튼으로 실습 프로젝트를 저장하십시오. 시그룬이 파일을 쓰고 다시 읽어 워크시트·결과·모형이 남는지 확인합니다.',
      ),
      expected: L('A downloaded .sigrun.json and a round-trip check that passed.', '내려받은 .sigrun.json과 통과한 왕복 검증입니다.'),
      action: { action: 'export-project' },
      completion: 'validated',
      validation: { kind: 'project-saved', roundtrip: true },
    },
    {
      id: 'summary',
      title: L('Step 12 · Tutorial summary', '12단계 · 튜토리얼 요약'),
      instruction: L(
        'Review the summary screen: the condition, the four predictions, the specifications, the composite desirability, the model’s range and the confirmation experiment that is still owed.',
        '요약 화면을 검토하십시오. 조건, 네 예측값, 규격, 복합 만족도, 모형의 적용 범위, 그리고 아직 남은 확인 실험입니다.',
      ),
      expected: L('A summary listing every artefact and stating that experimental confirmation is required.', '모든 산출물을 나열하고 실험 확인이 필요하다고 밝히는 요약입니다.'),
      action: { action: 'validate-result' },
      completion: 'validated',
      validation: { kind: 'practice-complete', requireModels: 4, requireOptimizer: true, requireProject: true, requireLayout: true },
    },
  ],
};

export const PART3_TUTORIALS = [
  defineTutorial(GAGERR_TUTORIAL),
  defineTutorial(RELIABILITY_TUTORIAL),
  defineTutorial(DOE_TUTORIAL),
  defineTutorial(FLAGSHIP_TUTORIAL),
];
