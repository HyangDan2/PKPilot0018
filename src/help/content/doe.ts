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
  {
    id: 'error-pooling',
    analysisIds: ['doeanalyze', 'glm', 'rsmanalyze'],
    category: 'doe',
    title: L('Pooling negligible terms into error', '미미한 항을 오차로 풀링하기'),
    summary: L('Removing a small term from the model and letting its sum of squares and degrees of freedom join the error estimate — with the original model kept for comparison.', '작은 항을 모형에서 제거해 그 제곱합과 자유도를 오차 추정에 더하며, 원래 모형은 비교용으로 보존합니다.'),
    theory: L(
      'When a design has replication, the residual mean square is a real estimate of error. If one term is negligible, removing it and adding its sum of squares and degrees of freedom to the error gives a more powerful test for the terms that remain. The reduced model is refitted from the data, never assembled by adding numbers: the pooled report checks that the error SS and DF actually add up, and a non-orthogonal design may make the sum fail. The partial F-test compares the two fits only when the reduced model is nested in the original one and a residual mean square exists.',
      '반복이 있는 설계에서 잔차 평균제곱은 실제 오차 추정값입니다. 한 항이 미미하면 그 항을 제거하고 제곱합과 자유도를 오차에 더하면 남은 항의 검정력이 높아집니다. 축소모형은 숫자를 더해 만드는 것이 아니라 자료에서 다시 적합하며, 풀링 보고서는 오차 제곱합과 자유도가 실제로 더해지는지 확인합니다. 비직교 설계에서는 이 합이 성립하지 않을 수 있습니다. 부분 F 검정은 축소모형이 원래 모형에 내포되고 잔차 평균제곱이 있을 때만 두 적합을 비교합니다.',
    ),
    formulas: [
      { expression: 'SSE(reduced) = SSE(full) + SS(pooled term)', note: L('Expected only when the pooled term is orthogonal to the rest.', '풀링한 항이 나머지와 직교할 때만 기대됩니다.') },
      { expression: 'DFE(reduced) = DFE(full) + df(pooled term)', note: L('Degrees of freedom always add.', '자유도는 항상 더해집니다.') },
      { expression: 'F = (SSE_red − SSE_full) / df1 ÷ MSE_red', note: L('Partial F for a nested reduction; computed from the refits.', '내포된 축소에 대한 부분 F. 재적합 결과로 계산합니다.') },
    ],
    parameters: [
      { name: L('Terms to pool', '풀링할 항'), meaning: L('Terms removed from the model; they must be selected terms the engine can fit.', '모형에서 제거할 항. 엔진이 적합할 수 있는 선택 항이어야 합니다.') },
      { name: L('Hierarchy mode', '계층성 모드'), meaning: L('Whether an interaction may stay without its parent main effects.', '교호작용이 상위 주효과 없이 남을 수 있는지 결정합니다.') },
    ],
    interpretation: [
      L('A pooled term should be small in size and unsupported by the data before it leaves the model; a term that is large but unimportant to the process is a decision about the process, not a statistical one.', '풀링하는 항은 제거 전에 크기가 작고 자료의 지지가 없어야 합니다. 크지만 공정상 중요하지 않은 항은 통계가 아니라 공정에 관한 결정입니다.'),
      L('Compare R², adjusted R² and predicted R² together. A higher R² alone is not evidence that the reduced model is better; predicted R² staying flat or falling says the removed term was not buying predictive accuracy.', 'R², 수정 R², 예측 R²를 함께 비교하십시오. R²만 높다고 축소모형이 더 좋은 것은 아닙니다. 예측 R²가 그대로이거나 떨어지면 제거한 항이 예측 정확도를 사지 못했다는 뜻입니다.'),
      L('Read the pooling checks before trusting the error df. If the additivity check fails, the numbers still come from the refit, but the design is not orthogonal and the pooled term is not independent of the rest.', '오차 자유도를 믿기 전에 풀링 점검을 읽으십시오. 가산성 점검이 실패하면 숫자는 여전히 재적합에서 오지만 설계가 직교하지 않고 풀링 항이 나머지와 독립이 아닙니다.'),
    ],
    assumptions: [
      L('The remaining model is correct, the pooled term is negligible, and the runs are independent with constant variance. Pooling cannot create error degrees of freedom that the design never had.', '남은 모형이 옳고 풀링 항이 미미하며 배치가 독립이고 등분산이어야 합니다. 풀링은 설계에 없던 오차 자유도를 만들어 내지 못합니다.'),
    ],
    sampleIds: ['doe-pooled'],
    tutorialIds: ['tutorial-doe-reduction-001'],
  },
  {
    id: 'unreplicated-designs',
    analysisIds: ['doeanalyze'],
    category: 'doe',
    title: L('Unreplicated designs and Lenth’s method', '반복 없는 설계와 Lenth 방법'),
    summary: L('What to do when a factorial has no replication: a saturated fit, effects without t-tests, and a pseudo standard error from the inactive effects.', '요인설계에 반복이 없을 때의 처리: 포화 적합, t검정 없는 효과, 비활성 효과로 구한 의사 표준오차입니다.'),
    theory: L(
      'An unreplicated 2ᵏ design has as many runs as model terms, so no residual degrees of freedom remain and t- or F-tests cannot be computed. The effects are still estimable. Lenth’s method uses the median absolute effect to form a pseudo standard error, flags effects larger than about 2.5 times that scale as active, and recomputes the PSE from the effects left out. It is a screening rule, not a residual-based test, and it cannot separate a real small effect from noise.',
      '반복 없는 2ᵏ 설계는 배치 수가 모형 항 수와 같아 잔차 자유도가 없으므로 t검정이나 F검정을 계산할 수 없습니다. 효과는 여전히 추정 가능합니다. Lenth 방법은 |효과|의 중앙값으로 의사 표준오차를 만들고, 그 규모의 약 2.5배보다 큰 효과를 활성으로 표시한 뒤 제외된 효과로 PSE를 다시 계산합니다. 이는 잔차 기반 검정이 아닌 선별 규칙이며, 실제 작은 효과와 잡음을 구별하지 못합니다.'),
    formulas: [
      { expression: 's0 = 1.5 × median |effect|', note: L('Initial scale from all effects.', '모든 효과로 구한 초기 규모.') },
      { expression: 'PSE = 1.5 × median |effect| over inactive effects', note: L('Pseudo standard error after the active set is trimmed.', '활성 집합을 제외한 뒤의 의사 표준오차.') },
      { expression: 'ME = t(0.975, pseudo df) × PSE', note: L('A margin of error, not a confidence interval for a residual.', '잔차에 대한 신뢰구간이 아닌 오차 한계.') },
    ],
    parameters: [
      { name: L('Model order', '모형 차수'), meaning: L('Choose the full model to see the saturated fit; leaving terms out creates error df but changes the question.', '포화 적합을 보려면 완전 모형을 고르십시오. 항을 빼면 오차 자유도는 생기지만 질문이 달라집니다.') },
      { name: L('Effect charts', '효과 그림'), meaning: L('The Pareto view switches to |Effect| with a Lenth ME line when no t is available.', 't를 계산할 수 없으면 파레토가 |효과|와 Lenth ME 선으로 바뀝니다.') },
    ],
    interpretation: [
      L('An effect above the Lenth margin is worth following up, not proven. Design a replicated follow-up before changing the process on it.', 'Lenth 한계를 넘는 효과는 추적할 가치가 있지만 입증된 것은 아닙니다. 그 효과로 공정을 바꾸기 전에 반복 실험을 설계하십시오.'),
      L('Active flags can be sensitive to one large effect inflating or trimming the scale; read the effect plot and the size of the effects, not only the labels.', '활성 표시는 큰 효과 하나가 규모를 부풀리거나 줄이는 데 민감할 수 있습니다. 표시만 보지 말고 효과 그림과 크기를 함께 읽으십시오.'),
    ],
    assumptions: [
      L('The design is balanced and every term is estimable; an unreplicated design cannot estimate error, so a claim about significance rests on a screening rule.', '설계가 균형이고 모든 항이 추정 가능해야 합니다. 반복 없는 설계는 오차를 추정하지 못하므로 유의성 주장은 선별 규칙에 근거합니다.'),
    ],
    sampleIds: ['doe-unreplicated'],
    tutorialIds: ['tutorial-doe-reduction-001'],
  },
  {
    id: 'model-hierarchy',
    analysisIds: ['doeanalyze', 'glm', 'rsmanalyze'],
    category: 'doe',
    title: L('Model hierarchy and aliasing', '모형 계층성과 교락'),
    summary: L('Why an interaction usually keeps its parent main effects, how the three hierarchy modes behave, and what an aliased term means in a fraction.', '교호작용이 보통 상위 주효과를 유지하는 이유, 세 가지 계층성 모드의 동작, 부분설계에서 교락 항의 의미입니다.'),
    theory: L(
      'A model is hierarchical when every interaction is accompanied by its lower-order terms. Hierarchy keeps the model invariant to how factor levels are coded, and an interaction without its parents is hard to interpret because the parent effect is absorbed into the interaction. Strict mode refuses such a selection, auto mode adds the missing parents, and unrestricted mode leaves the choice to the analyst. Aliasing is a different problem: in a fractional design some columns are linear combinations of others, so the design cannot separate their effects at all. Hierarchy cannot fix aliasing.',
      '모형은 모든 교호작용이 그 하위 항과 함께 있을 때 계층적입니다. 계층성은 요인 수준의 코드화 방식에 모형이 변하지 않게 하며, 상위 항 없이 남은 교호작용은 상위 효과가 교호작용에 흡수되어 해석하기 어렵습니다. 엄격 모드는 이런 선택을 거부하고, 자동 모드는 빠진 상위 항을 추가하며, 제한 없음 모드는 분석가에게 맡깁니다. 교락은 다른 문제입니다. 부분설계에서 일부 열이 다른 열의 선형결합이면 설계가 그 효과를 분리할 수 없습니다. 계층성으로 교락을 고칠 수 없습니다.'),
    formulas: [
      { expression: 'interaction term requires its parent main effects', note: L('Strict and auto modes enforce this.', '엄격·자동 모드가 강제합니다.') },
      { expression: 'x_AB = x_A × x_B in coded units', note: L('Why the parent scale is absorbed when parents are omitted.', '상위 항을 빼면 상위 규모가 흡수되는 이유.') },
      { expression: 'aliased ⇔ design columns linearly dependent', note: L('No coefficient can be estimated for the aliased term.', '교락 항의 계수는 추정할 수 없습니다.') },
    ],
    parameters: [
      { name: L('Hierarchy mode', '계층성 모드'), meaning: L('Strict rejects, auto adds parents, unrestricted accepts the selection as written.', '엄격은 거부, 자동은 상위 항 추가, 제한 없음은 선택 그대로 받아들입니다.') },
      { name: L('Selected terms', '선택 항'), meaning: L('The model the analysis fits; excluded terms are reported but never fitted.', '분석이 적합하는 모형. 제외 항은 보고되지만 적합되지 않습니다.') },
    ],
    interpretation: [
      L('If strict mode refuses a term, read the message: it names the parents that are missing. Add them, or switch to auto if that is the model you intended.', '엄격 모드가 항을 거부하면 메시지를 읽으십시오. 빠진 상위 항을 알려 줍니다. 그 항을 추가하거나, 의도한 모형이라면 자동으로 바꾸십시오.'),
      L('An aliased row with zero degrees of freedom is not a small effect; it is an effect the design never measured. Report it as aliased and extend the design if it matters.', '자유도 0인 교락 행은 작은 효과가 아니라 설계가 측정하지 못한 효과입니다. 교락으로 보고하고 중요하면 설계를 확장하십시오.'),
    ],
    assumptions: [
      L('The selected model is the question you mean to ask, and the design actually supports every selected term.', '선택한 모형이 의도한 질문이고 설계가 선택한 모든 항을 실제로 지지해야 합니다.'),
    ],
    sampleIds: ['glm-unbalanced', 'doe-screening'],
    tutorialIds: ['tutorial-doe-reduction-001'],
  },
];
