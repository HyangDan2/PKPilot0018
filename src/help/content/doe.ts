/* Sigrún Help Center — designed experiments, response surfaces, contours. */

import type { HelpEntry } from '../types';

const L = (en: string, ko: string) => ({ en, ko });

export const DOE_HELP: HelpEntry[] = [
  {
    id: 'doe-factorial',
    analysisIds: ['doecreate'],
    category: 'doe',
    title: L('Creating a factorial or response-surface design', '요인설계·반응표면 설계 만들기'),
    summary: L('Standard-order 2ᵏ designs, central composite and Box–Behnken designs written into a worksheet with coded factor columns.', '표준순서 2ᵏ 설계, 중심합성 설계, 박스–벤켄 설계를 코드화 요인 열과 함께 워크시트에 기록합니다.'),
    theory: L(
      'A designed experiment varies the factors together so their effects and interactions can be estimated without confounding. A 2ᵏ factorial estimates every main effect and interaction with the runs it has; adding centre points gives a curvature test. A central composite design adds axial runs so a full quadratic can be fitted; a Box–Behnken design does the same with three-level runs only. Factor levels are stored coded (−1, 0, +1, with ±α for axial runs) so effect = 2 × coded coefficient.',
      '실험계획은 요인을 함께 변화시켜 주효과와 교호작용을 교락 없이 추정합니다. 2ᵏ 요인설계는 가진 배치만으로 모든 주효과와 교호작용을 추정하고, 중심점을 더하면 곡률 검정이 가능합니다. 중심합성 설계는 축점을 더해 완전 2차 모형을 적합하며, 박스–벤켄 설계는 3수준 배치만으로 같은 목적을 이룹니다. 요인 수준은 코드화(−1, 0, +1, 축점은 ±α)되어 저장되므로 효과 = 2 × 코드화 계수입니다.',
    ),
    formulas: [
      { expression: 'effect = 2 × coefficient (coded ±1 factors)', note: L('Why a coded coefficient is half the effect.', '코드화 계수가 효과의 절반인 이유.') },
      { expression: 'α = (2ᵏ)^(1/4)', note: L('Rotatable axial distance of a central composite design.', '회전성을 갖는 중심합성 설계의 축점 거리.') },
      { expression: 'curvature test from centre points vs factorial runs', note: L('A significant difference means the response is curved.', '유의한 차이는 반응이 곡면임을 뜻합니다.') },
    ],
    parameters: [
      { name: L('Number of factors', '요인 수'), meaning: L('2 to 6 for a factorial, 2 to 5 for a response surface.', '요인설계는 2–6, 반응표면은 2–5.') },
      { name: L('Replicates', '반복'), meaning: L('Whole design repeated; replicates supply pure error.', '설계 전체 반복. 순수오차를 제공합니다.') },
      { name: L('Centre points', '중심점'), meaning: L('Runs at level zero; they test curvature and stabilise the error estimate.', '0수준 배치. 곡률을 검정하고 오차 추정을 안정화합니다.') },
      { name: L('Randomize and seed', '무작위화와 시드'), meaning: L('Run order is shuffled from the stated seed so it can be reproduced.', '지정된 시드로 배치 순서를 섞어 재현할 수 있게 합니다.') },
    ],
    interpretation: [
      L('Write the actual level settings next to the coded columns before running the experiment; a design that cannot be set on the equipment is not a design.', '실험 전에 코드화 열 옆에 실제 수준 설정을 적어 두십시오. 장비에서 설정할 수 없는 설계는 설계가 아닙니다.'),
      L('Randomize the run order unless there is a hard reason not to: order effects otherwise enter the model as factor effects.', '강한 이유가 없다면 배치 순서를 무작위화하십시오. 그렇지 않으면 순서 효과가 요인 효과로 모형에 들어갑니다.'),
    ],
    assumptions: [
      L('The experimental region is the region of interest; extrapolating a fitted surface outside it is not supported.', '실험 영역이 관심 영역이어야 합니다. 적합된 표면을 그 밖으로 외삽하는 것은 보증되지 않습니다.'),
    ],
    sampleIds: ['doe', 'rsm', 'display-optical-doe'],
    tutorialIds: ['tutorial-doe-001'],
  },
  {
    id: 'factorial-analysis',
    analysisIds: ['doeanalyze'],
    category: 'doe',
    title: L('Analysing a factorial design', '요인설계 분석'),
    summary: L('Effects, ANOVA and a stored model from a 2ᵏ design, at order 1, 2 or 3.', '2ᵏ 설계에서 효과·분산분석·저장 모형을 1·2·3차로 분석합니다.'),
    theory: L(
      'The analysis fits a linear model on the coded factors and their interactions up to the chosen order, reports each effect with its standard error and t-test, and partitions variation with an ANOVA table. A significant interaction means the effect of one factor depends on the level of another, so main effects must be read conditionally.',
      '분석은 코드화 요인과 선택한 차수까지의 교호작용에 선형모형을 적합하고, 각 효과를 표준오차·t검정과 함께 보고하며 분산분석표로 변동을 분해합니다. 유의한 교호작용은 한 요인의 효과가 다른 요인의 수준에 달려 있다는 뜻이므로 주효과를 조건부로 읽어야 합니다.',
    ),
    formulas: [
      { expression: 'y = β₀ + Σβᵢxᵢ + Σβᵢⱼxᵢxⱼ + ε', note: L('Order-2 model in coded factors.', '코드화 요인의 2차 모형.') },
      { expression: 't = effect / SE(effect), SE = s√(4/n)', note: L('Effect test for a balanced 2ᵏ design.', '균형 2ᵏ 설계의 효과 검정.') },
    ],
    parameters: [
      { name: L('Response', '반응'), meaning: L('Measured result column.', '측정 결과 열.') },
      { name: L('Factors', '요인'), meaning: L('Coded design columns.', '코드화 설계 열.') },
      { name: L('Model order', '모형 차수'), meaning: L('1 = main effects, 2 = two-way interactions, 3 = three-way.', '1=주효과, 2=이원 교호작용, 3=삼원 교호작용.') },
    ],
    interpretation: [
      L('Start from the largest effect and the smallest p-value; a term that is significant but tiny in size may not be worth changing the process for.', '가장 큰 효과와 가장 작은 p값에서 시작하십시오. 유의하지만 크기가 작은 항은 공정을 바꿀 가치가 없을 수 있습니다.'),
      L('A large lack-of-fit p-value supports the model; a small one says the curvature or an interaction is missing.', '적합결여 p값이 크면 모형을 지지하고, 작으면 곡률이나 교호작용이 빠졌다는 뜻입니다.'),
    ],
    assumptions: [
      L('Independent runs, constant variance, and factors set to their planned levels within measurement error.', '배치의 독립성, 등분산, 요인이 계획 수준에 측정오차 범위로 설정되었을 것.'),
    ],
    sampleIds: ['doe', 'display-optical-doe'],
    tutorialIds: ['tutorial-doe-001', 'tutorial-rsm-001'],
  },
  {
    id: 'rsm-fitting',
    analysisIds: ['rsmanalyze'],
    category: 'doe',
    title: L('Fitting a response surface model', '반응표면 모형 적합'),
    summary: L('A full quadratic fit with linear, square and interaction blocks, a stationary point and a stored model for contour, surface and optimisation.', '선형·제곱·교호작용 블록이 있는 완전 2차 적합과 정류점, 그리고 등고선·표면·최적화에 쓰는 저장 모형입니다.'),
    theory: L(
      'A response-surface model adds squared terms and interactions so curvature can be described. The fit reports block sums of squares for the linear, square and interaction parts, the coefficient table, R² and S, and the stationary point where the gradient is zero. If the stationary point falls outside the design region the fitted optimum is an extrapolation and the output says so.',
      '반응표면모형은 제곱항과 교호작용을 더해 곡률을 설명합니다. 적합 결과는 선형·제곱·교호작용 부분의 블록 제곱합, 계수표, R²와 S, 기울기가 0인 정류점을 보고합니다. 정류점이 설계 영역 밖이면 적합된 최적점은 외삽이며 출력이 그 사실을 표시합니다.',
    ),
    formulas: [
      { expression: 'y = β₀ + Σβᵢxᵢ + Σβᵢᵢxᵢ² + Σβᵢⱼxᵢxⱼ + ε', note: L('Full quadratic in coded factors.', '코드화 요인의 완전 2차식.') },
      { expression: 'x* = −½ B⁻¹ b', note: L('Stationary point; B holds the quadratic coefficients.', '정류점. B는 2차 계수 행렬.') },
      { expression: 'eigenvalues of B', note: L('All negative = maximum, all positive = minimum, mixed = saddle.', '모두 음수면 최대, 모두 양수면 최소, 섞이면 안장점.') },
    ],
    parameters: [
      { name: L('Response', '반응'), meaning: L('One response per fit; fit each response separately.', '한 번에 반응 하나. 반응마다 따로 적합합니다.') },
      { name: L('Factors', '요인'), meaning: L('Coded design columns (at least two).', '코드화 설계 열(최소 두 개).') },
    ],
    interpretation: [
      L('Read R² and S together, then the coefficient signs: a negative squared coefficient means a dome, which usually gives an interior optimum.', 'R²와 S를 함께 읽고 계수 부호를 보십시오. 제곱 계수가 음수면 돔 모양이며 보통 내부 최적점을 갖습니다.'),
      L('A stationary point outside the region is not a recommendation; it says the response still rises at the edge of the design.', '영역 밖의 정류점은 권고가 아닙니다. 설계 경계에서도 반응이 계속 상승한다는 뜻입니다.'),
    ],
    assumptions: [
      L('A quadratic describes the region adequately, runs are independent, and the design supports every term (no aliasing).', '2차식이 영역을 충분히 설명하고, 배치가 독립이며, 설계가 모든 항을 지지해야 합니다(교락 없음).'),
    ],
    sampleIds: ['rsm', 'display-optical-doe'],
    tutorialIds: ['tutorial-doe-001', 'tutorial-rsm-001'],
  },
  {
    id: 'contour-surface',
    analysisIds: [],
    category: 'doe',
    title: L('Contour, 3D surface and overlaid contours', '등고선, 3D 표면, 중첩 등고선'),
    summary: L('Reading a fitted surface two factors at a time, holding the others, and finding the region where several specifications hold together.', '다른 요인을 고정한 채 두 요인씩 표면을 읽고, 여러 규격을 동시에 만족하는 영역을 찾습니다.'),
    theory: L(
      'A contour plot draws level curves of a fitted response over two factors while every other factor is held at a stated value. A 3D surface shows the same fit as a height field, where a saddle or a dome is easier to see. An overlaid contour draws each response’s specification region on the same factor pair; their intersection is the feasible region, and its size is a measure of how much operating space the specifications leave. Predictions outside the fitted design region are extrapolations and are flagged.',
      '등고선도는 다른 요인을 명시된 값에 고정한 채 두 요인 위에 적합 반응의 등수준 곡선을 그립니다. 3D 표면은 같은 적합을 높이 지형으로 보여 주어 안장이나 돔을 더 쉽게 볼 수 있습니다. 중첩 등고선은 반응마다 규격 영역을 같은 요인 쌍 위에 그리고, 교집합이 실행가능 영역이며 그 크기가 규격이 남기는 운전 여유를 나타냅니다. 적합 설계 영역 밖의 예측은 외삽이며 표시됩니다.',
    ),
    formulas: [
      { expression: 'z(x, y) = quadratic at (x, y, holding values)', note: L('Every contour is a slice of the same stored model.', '모든 등고선은 같은 저장 모형의 단면입니다.') },
      { expression: 'feasible = ∩ {specification region of each response}', note: L('The overlaid region.', '중첩 영역.') },
    ],
    parameters: [
      { name: L('Factor pair', '요인 쌍'), meaning: L('The two factors on the axes; the rest are held.', '축에 놓는 두 요인. 나머지는 고정됩니다.') },
      { name: L('Holding value', '고정값'), meaning: L('The value of each factor not on the axes.', '축에 없는 각 요인의 값.') },
      { name: L('Unit mode', '단위 모드'), meaning: L('Coded design units or actual units where the model carries a transform.', '모형이 변환을 갖고 있으면 코드화 단위 또는 실제 단위.') },
      { name: L('Specification limits', '규격한계'), meaning: L('LSL/USL per response for the overlaid region and its area share.', '중첩 영역과 면적 비율을 위한 반응별 LSL/USL.') },
    ],
    interpretation: [
      L('A feasible region that touches the edge of the design means the optimum is outside the region you measured; extend the design rather than trust the edge.', '실행가능 영역이 설계 경계에 닿으면 최적점이 측정한 영역 밖에 있습니다. 경계를 믿지 말고 설계를 확장하십시오.'),
      L('Steep contours mean the response is sensitive to that factor; flat contours mean the factor can be set for other reasons at little cost.', '등고선이 조밀하면 그 요인에 민감하고, 완만하면 다른 이유로 설정해도 비용이 작습니다.'),
    ],
    assumptions: [
      L('The held factors really stay at their stated values during operation; a surface drawn at a holding value nobody can maintain is a drawing, not a process window.', '고정 요인이 실제 운전에서 표시값에 머물러야 합니다. 유지할 수 없는 고정값의 표면은 그림일 뿐 공정 창이 아닙니다.'),
    ],
    sampleIds: ['rsm', 'display-optical-doe'],
    tutorialIds: ['tutorial-rsm-001'],
  },
];
