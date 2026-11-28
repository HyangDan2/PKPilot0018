/* Statelia Help Center — stored models, optimisation, profiler and figure layout. */

import type { HelpEntry } from '../types';

const L = (en: string, ko: string) => ({ en, ko });

export const MODELS_HELP: HelpEntry[] = [
  {
    id: 'model-store',
    analysisIds: [],
    category: 'optimization',
    title: L('Stored models and the Model Manager', '저장 모형과 모형 관리자'),
    summary: L('How a fitted model is kept, what it carries, when it becomes stale, and how it reaches contour, optimiser and profiler.', '적합된 모형을 어떻게 보관하고 무엇을 담으며, 언제 오래된 것이 되고, 등고선·최적화·프로파일러로 어떻게 이어지는지 설명합니다.'),
    theory: L(
      'An analysis card can hand its fitted model to the model store. The stored record keeps the response, the predictors with their coding, every coefficient with its standard error where the engine computed one, the residual and degrees of freedom, the covariance when it exists, the factor bounds, and a fingerprint of the training data. Contour, surface, the response optimiser and the prediction profiler all read that one record, which is why their predictions at the same factor values agree.',
      '분석 카드는 적합된 모형을 모형 저장소로 넘길 수 있습니다. 저장 기록은 반응, 코딩이 포함된 예측변수, 엔진이 계산한 경우 표준오차가 붙은 계수, 잔차와 자유도, 존재하는 경우 공분산, 요인 범위, 학습 데이터 지문을 보관합니다. 등고선·표면·반응 최적화·예측 프로파일러는 모두 이 한 기록을 읽으므로 같은 요인 값에서 예측이 일치합니다.',
    ),
    formulas: [
      { expression: 'ŷ(x) = Σ β̂ⱼ fⱼ(x)', note: L('Prediction from the stored coefficients.', '저장된 계수로 계산한 예측값.') },
      { expression: 'SE(ŷ) = √(f(x)ᵀ Σ f(x))', note: L('Standard error from the stored covariance.', '저장된 공분산으로 계산한 표준오차.') },
      { expression: 'fingerprint = FNV-1a(training columns)', note: L('Detects a changed dataset behind a model.', '모형 뒤의 데이터가 바뀌었는지 감지합니다.') },
    ],
    parameters: [
      { name: L('Name', '이름'), meaning: L('A unique name; duplicates are refused.', '고유 이름. 중복은 거부됩니다.') },
      { name: L('Kind', '종류'), meaning: L('Regression, polynomial, GLM, DOE or RSM, as fitted.', '적합 방식에 따른 회귀·다항·GLM·DOE·RSM.') },
      { name: L('Staleness', '오래됨 상태'), meaning: L('Fresh, stale (data changed), missing data, or untracked.', '최신, 오래됨(데이터 변경), 데이터 없음, 추적 불가.') },
    ],
    interpretation: [
      L('Refit rather than reuse a stale model: the coefficients no longer describe the worksheet in front of you.', '오래된 모형은 재사용하지 말고 재적합하십시오. 계수가 지금 워크시트를 설명하지 않습니다.'),
      L('A model with no covariance cannot produce a confidence or prediction interval; the windows say “not available” instead of inventing one.', '공분산이 없는 모형은 신뢰구간이나 예측구간을 만들 수 없습니다. 창은 구간을 지어내지 않고 “제공되지 않음”이라고 표시합니다.'),
    ],
    assumptions: [
      L('The stored model is only as valid as the analysis that produced it, including its assumptions and its design region.', '저장 모형의 타당성은 그것을 만든 분석의 가정과 설계 영역을 그대로 물려받습니다.'),
    ],
    sampleIds: ['regression', 'display-optical-doe'],
    tutorialIds: ['tutorial-regression-001', 'tutorial-rsm-001'],
  },
  {
    id: 'multi-response-optimization',
    analysisIds: [],
    category: 'optimization',
    title: L('Multi-response optimisation', '다중반응 최적화'),
    summary: L('Goals, limits, factor bounds and composite desirability: how several responses are traded off and what the answer does and does not prove.', '목표·한계·요인 범위·복합 만족도로 여러 반응을 절충하는 방법과, 그 답이 무엇을 입증하고 무엇을 입증하지 않는지 설명합니다.'),
    theory: L(
      'Each response gets a goal (maximize, minimize, target, range) and a desirability curve that scores any predicted value between 0 and 1. The composite desirability is a weighted geometric mean of the individual scores, so one response failing badly pulls the whole answer down. The search looks for the factor setting with the highest composite value inside the factor bounds, and the status says what the search actually established: a complete enumeration, a converged local basin, a best found within the budget, or nothing feasible.',
      '각 반응에는 목표(최대화·최소화·목표값·범위)와 예측값을 0과 1 사이로 점수화하는 만족도 곡선이 붙습니다. 복합 만족도는 개별 점수의 가중 기하평균이므로 한 반응이 크게 실패하면 전체 답이 끌려 내려갑니다. 탐색은 요인 범위 안에서 복합값이 가장 높은 설정을 찾고, 상태는 탐색이 실제로 입증한 것(완전 열거, 수렴한 국소 영역, 예산 내 최선, 실행가능 없음)을 말합니다.',
    ),
    formulas: [
      { expression: 'd(y) = ((y − L)/(T − L))^s  for a target goal', note: L('Derringer–Suich desirability; s is the weight.', '데링거–수이치 만족도. s는 가중.') },
      { expression: 'D = (Π dᵢ^wᵢ)^(1/Σwᵢ)', note: L('Composite desirability with importance weights.', '중요도 가중을 반영한 복합 만족도.') },
      { expression: 'score = D if all specifications hold, else penalised', note: L('A broken hard limit is never recommended as a solution.', '깨진 하드 한계는 해로 권고되지 않습니다.') },
    ],
    parameters: [
      { name: L('Goal and limits', '목표와 한계'), meaning: L('Lower/upper bound the acceptable region; target is the best point.', '하한·상한이 수용 영역을 정하고 목표값이 최선점입니다.') },
      { name: L('Weight', '가중'), meaning: L('Shapes one response’s desirability curve (1 = linear).', '한 반응의 만족도 곡선 모양(1=선형).') },
      { name: L('Importance', '중요도'), meaning: L('Weights that response inside the composite.', '복합값에서 그 반응의 비중.') },
      { name: L('Factor bounds and step', '요인 범위와 단계'), meaning: L('The search space for each factor; fixed factors stay put.', '요인별 탐색 공간. 고정 요인은 움직이지 않습니다.') },
      { name: L('Method and budget', '방법과 예산'), meaning: L('Automatic, grid, multistart or local search with an evaluation limit.', '자동·격자·다중시작·국소 탐색과 평가 한도.') },
    ],
    interpretation: [
      L('Read the status before the numbers: “best found” means the search stopped without proving the optimum.', '숫자보다 상태를 먼저 읽으십시오. “최선 발견”은 최적임을 입증하지 못하고 멈췄다는 뜻입니다.'),
      L('Look at the alternative solutions when the top few have similar composite values: the cheaper one may be the better process setting.', '상위 몇 개의 복합값이 비슷하면 대안 해를 보십시오. 더 저렴한 쪽이 더 나은 공정 설정일 수 있습니다.'),
      L('The optimum is a model prediction, not a guarantee. Confirm it with a designed confirmation run before changing production.', '최적점은 모형 예측이지 보증이 아닙니다. 생산을 바꾸기 전에 확인 실험으로 검증하십시오.'),
    ],
    assumptions: [
      L('The models are adequate over the searched region and their factor sets are compatible; a prediction outside the fitted region is flagged as an extrapolation.', '모형이 탐색 영역에서 충분하고 요인 집합이 호환되어야 합니다. 적합 영역 밖 예측은 외삽으로 표시됩니다.'),
    ],
    sampleIds: ['display-optical-doe', 'rsm'],
    tutorialIds: ['tutorial-rsm-001', 'tutorial-rsm-001'],
  },
  {
    id: 'prediction-profiler',
    analysisIds: [],
    category: 'optimization',
    title: L('Prediction profiler', '예측 프로파일러'),
    summary: L('One column per factor, one row per response: how each response moves as one factor changes and the rest stay still.', '요인마다 한 열, 반응마다 한 행: 나머지를 고정한 채 한 요인이 변할 때 각 반응이 어떻게 움직이는지 봅니다.'),
    theory: L(
      'The profiler evaluates the same stored models at one condition. Each cell plots a response against one factor with every other factor held at its current value, so the slope is that factor’s sensitivity at that point. The right-hand column gives the prediction, its confidence interval for the mean and its prediction interval for a future observation, plus the desirability of each value under the stated goals.',
      '프로파일러는 같은 저장 모형을 한 조건에서 평가합니다. 각 셀은 다른 요인을 현재 값에 고정한 채 한 요인에 대한 반응을 그리므로 기울기가 그 지점에서 그 요인의 민감도입니다. 오른쪽 열은 예측값, 평균에 대한 신뢰구간, 미래 관측치에 대한 예측구간, 그리고 주어진 목표 아래 각 값의 만족도를 보여 줍니다.',
    ),
    formulas: [
      { expression: 'ŷ = f(x_hold, x_move)', note: L('One curve per factor at the current condition.', '현재 조건에서 요인마다 한 곡선.') },
      { expression: 'CI: ŷ ± t·SE(ŷ); PI: ŷ ± t·√(SE(ŷ)² + s²)', note: L('Mean and future-observation intervals.', '평균과 미래 관측치 구간.') },
    ],
    parameters: [
      { name: L('Factor value', '요인 값'), meaning: L('Typed or dragged; every other factor stays where it is.', '입력하거나 끌어서 조정하며 다른 요인은 그대로입니다.') },
      { name: L('Save condition', '조건 저장'), meaning: L('Writes the current condition and its predictions into the output.', '현재 조건과 예측을 출력에 기록합니다.') },
    ],
    interpretation: [
      L('A steep curve that flattens near the current value means the factor is being wasted there; move it until the slope is useful.', '현재 값 근처에서 가파른 곡선이 평평해지면 그 요인은 그 자리에서 낭비되고 있습니다. 기울기가 유용해질 때까지 움직이십시오.'),
      L('A wide prediction interval at a point means the answer there is uncertain even when the point prediction looks good.', '어떤 점에서 예측구간이 넓으면 점 예측이 좋아 보여도 그 답은 불확실합니다.'),
    ],
    assumptions: [
      L('The profiles are slices of the fitted model; they inherit its adequacy and its design region.', '프로파일은 적합 모형의 단면이며 모형의 타당성과 설계 영역을 물려받습니다.'),
    ],
    sampleIds: ['display-optical-doe'],
    tutorialIds: ['tutorial-rsm-001', 'tutorial-rsm-001'],
  },
  {
    id: 'graph-layout',
    analysisIds: [],
    category: 'visualization',
    title: L('Figure layout and export', '그림 배치와 내보내기'),
    summary: L('Placing output charts on a page, adding annotations and figure labels, and exporting PNG or SVG at a stated resolution.', '출력 차트를 페이지에 배치하고 주석·그림 번호를 달며 지정 해상도의 PNG·SVG로 내보냅니다.'),
    theory: L(
      'The layout editor assembles charts already in the output into one page. Panels snap to a grid, can be aligned and distributed, and carry an optional copy of the chart configuration so the page prints as arranged. Text, shapes and figure labels are separate panels. Export renders the page at the chosen DPI and downloads it; the project keeps the layout document so it can be reopened and edited.',
      '배치 편집기는 이미 출력에 있는 차트를 한 페이지로 구성합니다. 패널은 격자에 스냅되고 정렬·분배할 수 있으며, 정렬된 대로 인쇄되도록 차트 설정 사본을 선택적으로 담습니다. 문자·도형·그림 번호는 별도 패널입니다. 내보내기는 선택한 DPI로 페이지를 렌더링해 내려받으며, 프로젝트가 배치 문서를 보관해 다시 열어 편집할 수 있습니다.',
    ),
    formulas: [
      { expression: 'page = { widthMm, heightMm, marginMm }', note: L('Page geometry every panel is placed inside.', '모든 패널이 놓이는 페이지 기하.') },
      { expression: 'PNG pixels = mm / 25.4 × dpi', note: L('Export resolution.', '내보내기 해상도.') },
    ],
    parameters: [
      { name: L('Page preset', '페이지 프리셋'), meaning: L('A4 or Letter, portrait or landscape.', 'A4 또는 Letter, 세로 또는 가로.') },
      { name: L('Figure label', '그림 번호'), meaning: L('Auto-numbered “Figure 1, 2, …” labels.', '자동 번호가 붙는 “Figure 1, 2, …” 라벨.') },
      { name: L('DPI', '해상도'), meaning: L('300 is the print default; the export buttons state each option.', '인쇄 기본은 300이며 내보내기 버튼이 옵션을 표시합니다.') },
    ],
    interpretation: [
      L('Export SVG when the figure will be resized or edited later; PNG when it will be pasted into a report.', '나중에 크기를 바꾸거나 편집할 그림은 SVG, 보고서에 붙일 그림은 PNG로 내보내십시오.'),
    ],
    assumptions: [
      L('The layout references output cards that still exist; deleting a card removes its panel the next time the layout is opened.', '배치는 아직 존재하는 결과 카드를 참조합니다. 카드를 지우면 다음에 배치를 열 때 그 패널이 빠집니다.'),
    ],
    sampleIds: ['display-optical-doe'],
    tutorialIds: ['tutorial-rsm-001'],
  },
];
