/* Statelia Help Center — SPC, capability, Pareto, measurement systems, reliability. */

import type { HelpEntry } from '../types';

const L = (en: string, ko: string) => ({ en, ko });

export const QUALITY_HELP: HelpEntry[] = [
  {
    id: 'spc-basics',
    analysisIds: [],
    category: 'quality',
    title: L('Variation, control limits and rational subgroups', '변동, 관리한계, 합리적 부분군'),
    summary: L('What a control chart separates, and how a subgroup is chosen before any limit is computed.', '관리도가 구분하는 것과, 한계를 계산하기 전에 부분군을 어떻게 정하는지 설명합니다.'),
    theory: L(
      'Statistical process control separates the variation a process always has (common cause) from the variation produced by a specific assignable event (special cause). Limits are computed from the process itself — never from the specification — and come from the short-term variation inside rational subgroups, so a trend or a shift does not widen them until it is out of control.',
      '통계적 공정관리는 공정이 늘 갖는 변동(우연원인)과 특정 이상원인이 만든 변동(이상원인)을 구분합니다. 관리한계는 규격이 아니라 공정 자체에서 계산하며, 합리적 부분군 내부의 단기 변동에서 나오므로 추세나 이동이 관리이탈이 되기 전에는 한계를 넓히지 않습니다.',
    ),
    formulas: [
      { expression: 'I-MR: UCL = x̄ + 2.66 MR̄, LCL = x̄ − 2.66 MR̄', note: L('Individuals limits with d₂ = 1.128.', 'd₂ = 1.128을 쓴 개별값 관리한계.') },
      { expression: 'X̄-R: UCL = x̄̄ + A₂R̄, LCL = x̄̄ − A₂R̄, UCL_R = D₄R̄', note: L('Subgroup averages and ranges.', '부분군 평균과 범위.') },
      { expression: 'σ̂ = MR̄ / 1.128', note: L('Short-term sigma inside the chart.', '관리도 내부의 단기 시그마.') },
    ],
    parameters: [
      { name: L('Subgroup size', '부분군 크기'), meaning: L('Number of consecutive observations that share one common-cause state.', '같은 우연원인 상태를 공유하는 연속 관측치 수.') },
      { name: L('Subgroup id column', '부분군 ID 열'), meaning: L('Uses an explicit batch identifier instead of a fixed run length.', '고정 길이 대신 명시된 배치 식별자를 사용합니다.') },
    ],
    interpretation: [
      L('A point outside a limit, a run of eight on one side, or six points trending are signals; the chart shows when to investigate, not who is at fault.', '한계 밖의 점, 한쪽에 이어진 8점, 6점의 추세는 신호입니다. 관리도는 언제 조사할지를 알려 줄 뿐 책임을 가리지 않습니다.'),
      L('A wide R chart with a narrow X̄ chart usually means the subgroup mixes two states: regroup before trusting either chart.', 'R 관리도가 넓고 X̄ 관리도가 좁으면 부분군이 두 상태를 섞고 있을 수 있습니다. 어느 관리도든 믿기 전에 부분군을 다시 나누십시오.'),
    ],
    assumptions: [
      L('Observations inside a subgroup are independent; the order of subgroups is the order in which they were produced.', '부분군 내부 관측치는 독립이며, 부분군 순서는 생산 순서입니다.'),
    ],
    sampleIds: ['process'],
    tutorialIds: ['tutorial-spc-001', 'tutorial-capability-001'],
  },
  {
    id: 'control-charts',
    analysisIds: ['imr', 'xbarr', 'xbars', 'pchart', 'npchart', 'cchart', 'uchart'],
    category: 'quality',
    title: L('Control charts for variables and attributes', '계량형·계수형 관리도'),
    summary: L('Individuals, X̄-R, X̄-S, p, np, c and u charts: which one fits which kind of measurement.', '개별값, X̄-R, X̄-S, p, np, c, u 관리도 중 어떤 측정에 무엇이 맞는지 정리합니다.'),
    theory: L(
      'Variable charts track a continuous measurement and are chosen by subgroup size: individuals with a moving range for one observation at a time, X̄-R for small subgroups, X̄-S for larger ones. Attribute charts track counts: p and np for the proportion or number defective, c and u for defects per unit. Attribute charts use the binomial or Poisson standard deviation of the plotted statistic, which is why a varying sample size changes their limits point by point.',
      '계량형 관리도는 연속 측정값을 추적하며 부분군 크기로 고릅니다. 한 번에 하나면 개별값-이동범위, 작은 부분군은 X̄-R, 큰 부분군은 X̄-S입니다. 계수형 관리도는 개수를 추적합니다. p와 np는 불량 비율·개수, c와 u는 단위당 결점입니다. 계수형 관리도는 도시되는 통계량의 이항·포아송 표준편차를 쓰므로 표본 크기가 변하면 한계도 점마다 달라집니다.',
    ),
    formulas: [
      { expression: 'p̄ = Σdᵢ / Σnᵢ, UCLᵢ = p̄ + 3√(p̄(1 − p̄)/nᵢ)', note: L('p chart with varying subgroup size.', '부분군 크기가 변하는 p 관리도.') },
      { expression: 'c̄ = Σcᵢ / k, UCL = c̄ + 3√c̄', note: L('c chart for constant opportunity.', '기회 면적이 일정한 c 관리도.') },
      { expression: 'ū = Σcᵢ / Σnᵢ, UCLᵢ = ū + 3√(ū/nᵢ)', note: L('u chart for varying opportunity.', '기회 면적이 변하는 u 관리도.') },
    ],
    parameters: [
      { name: L('Sample size', '표본 크기'), meaning: L('Required when the column holds counts rather than the subgroup size itself.', '열이 부분군 크기가 아니라 개수를 담을 때 필요합니다.') },
      { name: L('Defectives / defects', '불량품 수 / 결점 수'), meaning: L('A unit is either defective or not (p, np); a unit may contain several defects (c, u).', '한 단위가 불량이거나 아니면 p·np, 한 단위에 여러 결점이 있으면 c·u입니다.') },
    ],
    interpretation: [
      L('Never compare a p chart’s point with a specification: attribute charts show process stability, not capability.', 'p 관리도의 점을 규격과 비교하지 마십시오. 계수형 관리도는 공정 안정성을 보여 줄 뿐 능력을 말하지 않습니다.'),
      L('When the centre line drifts, the process has changed; recompute limits from the new stable period instead of widening them to fit.', '중심선이 이동하면 공정이 바뀐 것입니다. 한계를 넓혀 맞추지 말고 새로운 안정 구간에서 다시 계산하십시오.'),
    ],
    assumptions: [
      L('Counts are independent and the opportunity per unit is constant or known (u chart for varying opportunity).', '개수는 독립이고 단위당 기회 면적이 일정하거나 알려져 있어야 합니다(변하면 u 관리도).'),
    ],
    sampleIds: ['process'],
    tutorialIds: ['tutorial-spc-001'],
  },
  {
    id: 'capability-analysis',
    analysisIds: ['capability', 'sixpack', 'capnonnormal'],
    category: 'quality',
    title: L('Process capability and the Sixpack', '공정능력과 식스팩'),
    summary: L('Cp, Cpk, Pp, Ppk and sigma levels, with the Sixpack’s six panels and a non-normal capability path.', 'Cp·Cpk·Pp·Ppk와 시그마 수준, 식스팩의 여섯 패널, 비정규 능력 분석 경로를 다룹니다.'),
    theory: L(
      'Capability compares the specification width with the process spread. Cp and Cpk use the short-term sigma estimated inside subgroups (within), Pp and Ppk the overall standard deviation. Cpk subtracts the penalty for being off-centre. A process can be capable and still off target — that is the difference between Cp and Cpk. The Sixpack adds the control charts and a normality check, because capability numbers computed from an unstable process describe a process that no longer exists.',
      '공정능력은 규격 폭과 공정 산포를 비교합니다. Cp와 Cpk는 부분군 내부에서 추정한 단기 시그마를, Pp와 Ppk는 전체 표준편차를 씁니다. Cpk는 중심에서 벗어난 만큼의 penalty를 뺍니다. 공정이 능력이 있으면서도 목표를 벗어날 수 있으며, 그것이 Cp와 Cpk의 차이입니다. 식스팩은 관리도와 정규성 검정을 더합니다. 불안정한 공정에서 계산한 능력 수치는 이미 존재하지 않는 공정을 설명하기 때문입니다.',
    ),
    formulas: [
      { expression: 'Cp = (USL − LSL) / 6σ̂', note: L('Potential capability, centred spread.', '중심이 맞을 때의 잠재 능력.') },
      { expression: 'Cpk = min(USL − μ̂, μ̂ − LSL) / 3σ̂', note: L('Actual capability with the off-centre penalty.', '중심 이탈을 반영한 실제 능력.') },
      { expression: 'Pp = (USL − LSL) / 6s, Ppk = min(USL − x̄, x̄ − LSL) / 3s', note: L('Overall (long-term) capability.', '전체(장기) 능력.') },
      { expression: 'Z = 3 × Cpk (one-sided, without the 1.5σ shift)', note: L('Sigma level as the output states it.', '출력에 표시되는 시그마 수준.') },
    ],
    parameters: [
      { name: L('Lower / upper specification', '규격 하한 / 상한'), meaning: L('At least one limit is required; a one-sided index is reported when only one exists.', '최소 하나의 한계가 필요하며, 하나만 있으면 단측 지수를 보고합니다.') },
      { name: L('Target', '목표값'), meaning: L('Centre used for Cpm and the target line.', 'Cpm과 목표선에 쓰는 중심값.') },
      { name: L('Sigma method', '시그마 방법'), meaning: L('Within-subgroup sigma, or one of the Cpk-shift methods the dialog lists.', '부분군 내부 시그마 또는 대화상자에 나열된 Cpk 이동 방법.') },
      { name: L('Subgroup size', '부분군 크기'), meaning: L('1 uses the moving-range estimate.', '1이면 이동범위 추정값을 씁니다.') },
    ],
    interpretation: [
      L('Read stability first: a Cpk computed from an out-of-control chart is not a capability figure.', '안정성을 먼저 읽으십시오. 관리이탈 상태에서 계산한 Cpk는 능력 수치가 아닙니다.'),
      L('Cpk below about 1.00 means the process produces nonconforming units at a rate that matters; a gap between Cp and Cpk says to re-centre before reducing variation.', 'Cpk가 약 1.00 미만이면 의미 있는 비율로 규격 밖 제품이 나옵니다. Cp와 Cpk의 차이는 산포를 줄이기 전에 중심을 맞추라는 뜻입니다.'),
    ],
    assumptions: [
      L('The process is in statistical control and the observations are independent; the normal-based indices assume approximate normality (use the non-normal capability for clearly skewed data).', '공정이 통계적 관리 상태이고 관측치가 독립이어야 합니다. 정규 기반 지수는 대략적 정규성을 가정하므로 뚜렷이 치우친 데이터에는 비정규 능력 분석을 쓰십시오.'),
    ],
    sampleIds: ['process', 'weibull'],
    tutorialIds: ['tutorial-capability-001', 'tutorial-spc-001'],
  },
  {
    id: 'pareto-analysis',
    analysisIds: ['pareto'],
    category: 'quality',
    title: L('Pareto chart of defect categories', '불량 유형 파레토图'),
    summary: L('Categories ordered by count with a cumulative share line, so the few causes that carry most of the problem are visible.', '개수 순으로 정렬한 범주와 누적 비율선으로, 문제의 대부분을 차지하는 소수 원인을 드러냅니다.'),
    theory: L(
      'A Pareto chart sorts categories from most to least frequent and plots the cumulative percentage against the same order. It is a prioritisation tool: it says where to look first, not whether a difference is statistically significant.',
      '파레토图는 범주를 빈도 순으로 정렬하고 같은 순서로 누적 백분율을 그립니다. 우선순위 도구로, 어디를 먼저 볼지 알려 줄 뿐 차이가 통계적으로 유의한지는 말하지 않습니다.',
    ),
    formulas: [
      { expression: 'cumulative % = Σ(count up to k) / total × 100', note: L('Cumulative share on the right axis.', '오른쪽 축의 누적 비율.') },
    ],
    parameters: [
      { name: L('Category column', '범주 열'), meaning: L('Text column whose values become the bars.', '값이 막대가 되는 문자 열.') },
    ],
    interpretation: [
      L('The first two or three categories usually carry most of the count; fixing them is the cheapest improvement, but confirm with a cause investigation.', '보통 처음 두세 범주가 대부분을 차지합니다. 그것을 고치는 것이 가장 값싼 개선이지만 원인 조사로 확인하십시오.'),
    ],
    assumptions: [
      L('Categories are mutually exclusive and the count column is complete for the period being judged.', '범주가 상호 배타적이고 판단 기간의 개수가 완전해야 합니다.'),
    ],
    sampleIds: ['process'],
    tutorialIds: ['tutorial-capability-001'],
  },
  {
    id: 'gage-rr',
    analysisIds: ['gagerr'],
    category: 'msa',
    title: L('Gage R&R (crossed and nested)', '게이지 R&R (교차·내포)'),
    summary: L('How much of the observed variation comes from the measurement system, split into repeatability and reproducibility.', '관측 변동 중 측정시스템이 차지하는 몫을 반복성과 재현성으로 나누어 보여 줍니다.'),
    theory: L(
      'A Gage R&R study separates variation into part-to-part, operator (reproducibility), the part × operator interaction, and repeat error (repeatability). The variance components are estimated by ANOVA. Crossed studies have every operator measure every part; nested studies have operators measure different parts, so the interaction cannot be estimated. Percent Gage R&R compares the combined measurement variation with the study variation or with the tolerance.',
      '게이지 R&R 연구는 변동을 부품 간, 작업자(재현성), 부품×작업자 교호작용, 반복오차(반복성)로 나눕니다. 분산성분은 분산분석으로 추정합니다. 교차 연구는 모든 작업자가 모든 부품을 측정하고, 내포 연구는 작업자가 서로 다른 부품을 측정하므로 교호작용을 추정할 수 없습니다. %게이지 R&R은 결합된 측정 변동을 연구 변동 또는 공차와 비교합니다.',
    ),
    formulas: [
      { expression: 'σ²_total = σ²_part + σ²_operator + σ²_interaction + σ²_repeat', note: L('Variance components of a crossed study.', '교차 연구의 분산성분.') },
      { expression: '%GRR = 100 × 6σ_GRR / (6σ_total)  (study variation)', note: L('Share of study variation.', '연구 변동에서의 몫.') },
      { expression: '%GRR = 100 × 6σ_GRR / tolerance', note: L('Share of the tolerance when one is given.', '공차가 주어졌을 때의 몫.') },
      { expression: 'ndc = 1.41 × (σ_part / σ_GRR)', note: L('Number of distinct categories.', '구별 가능한 범주 수.') },
    ],
    parameters: [
      { name: L('Part / Operator / Measurement', '부품 / 작업자 / 측정값'), meaning: L('The three required columns.', '필수 열 세 개.') },
      { name: L('Study type', '연구 유형'), meaning: L('Crossed when every operator measures every part, nested otherwise.', '모든 작업자가 모든 부품을 측정하면 교차, 아니면 내포.') },
      { name: L('Tolerance', '공차'), meaning: L('Optional; switches the %GRR definition to the tolerance.', '선택 사항. 입력하면 %GRR 정의가 공차 기준으로 바뀝니다.') },
      { name: L('Study variation multiplier', '연구 변동 배수'), meaning: L('6 by default (6 sigma).', '기본 6(6시그마).') },
    ],
    interpretation: [
      L('Below 10 % is generally acceptable, 10–30 % may be acceptable for the application, above 30 % needs action — but read ndc and the operator chart too.', '10 % 미만은 대체로 수용 가능, 10–30 %는 용도에 따라 가능, 30 % 초과는 조치가 필요합니다. 다만 ndc와 작업자 관리도도 함께 읽으십시오.'),
      L('A large operator component with a small interaction means the operators read the gage differently; retraining or a fixture may fix it before the gage is replaced.', '교호작용은 작은데 작업자 성분이 크면 작업자마다 게이지를 다르게 읽는다는 뜻입니다. 게이지를 교체하기 전에 교육이나 고정구로 해결될 수 있습니다.'),
    ],
    assumptions: [
      L('Measurements are independent, the parts cover the production range, and the operators are representative of those who will use the gage.', '측정값은 독립이고, 부품이 생산 범위를 대표하며, 작업자가 실제 사용자를 대표해야 합니다.'),
    ],
    sampleIds: ['gagerr'],
    tutorialIds: ['tutorial-gagerr-001'],
  },
  {
    id: 'reliability-weibull',
    analysisIds: ['weibull'],
    category: 'reliability',
    title: L('Weibull and lognormal life data', '와이블·로그정규 수명 데이터'),
    summary: L('Fitting a life distribution to failure times with right-censored units, and reading shape, scale, B10 and MTTF.', '우측 중도절단이 있는 고장시간에 수명분포를 적합하고 형상·척도·B10·MTTF를 읽습니다.'),
    theory: L(
      'Reliability data arrive as failure times, often with units still running when the test ended. A censored observation contributes the probability of surviving past its stop time instead of a density. The maximum-likelihood fit estimates the distribution parameters from both kinds of observation. The Weibull shape parameter describes the failure mode: below 1 early failures, near 1 random failures, above 1 wear-out.',
      '신뢰성 데이터는 고장시간으로 오지만, 시험이 끝날 때 아직 작동 중인 제품이 흔합니다. 중도절단 관측치는 밀도 대신 정지 시점 이후 생존확률로 기여합니다. 최대우도 적합은 두 종류의 관측치로 분포 모수를 추정합니다. 와이블 형상모수는 고장 모드를 설명합니다. 1 미만은 조기고장, 1 근처는 우발고장, 1 초과는 마모고장입니다.',
    ),
    formulas: [
      { expression: 'F(t) = 1 − exp(−(t/η)^β)', note: L('Weibull CDF; β shape, η scale.', '와이블 누적분포. β 형상, η 척도.') },
      { expression: 'R(t) = exp(−(t/η)^β)', note: L('Survival function.', '생존함수.') },
      { expression: 'h(t) = (β/η)(t/η)^(β−1)', note: L('Hazard rate.', '위험률.') },
      { expression: 'B10 = η(−ln 0.90)^(1/β)', note: L('Time by which 10 % have failed.', '10 %가 고장나는 시점.') },
      { expression: 'MTTF = η Γ(1 + 1/β)', note: L('Mean life of a Weibull population.', '와이블 모집단의 평균 수명.') },
    ],
    parameters: [
      { name: L('Failure time', '고장시간'), meaning: L('Numeric column of times (or cycles).', '시간(또는 사이클) 숫자 열.') },
      { name: L('Censoring column', '중도절단 열'), meaning: L('Numeric indicator; the dialog states which value means censored.', '숫자 표시 열. 어느 값이 중도절단인지 대화상자에 표시됩니다.') },
      { name: L('Censor code', '중도절단 코드'), meaning: L('1 = censored or 0 = censored, matching the data.', '데이터에 맞게 1=중도절단 또는 0=중도절단.') },
    ],
    interpretation: [
      L('Read the shape parameter before the MTTF: a wear-out shape with a long MTTF still gives a short B10.', 'MTTF보다 형상모수를 먼저 읽으십시오. 마모 형상에 긴 MTTF라도 B10은 짧을 수 있습니다.'),
      L('A probability plot that bends means one Weibull does not describe the data; a mixture of failure modes or a different distribution is worth trying.', '확률도가 휘면 하나의 와이블로 데이터를 설명할 수 없습니다. 고장 모드 혼합이나 다른 분포를 시도해 볼 가치가 있습니다.'),
    ],
    assumptions: [
      L('Failure times are independent; censoring is non-informative (a unit censored at t is no more likely to fail soon than one still running); the test conditions are homogeneous.', '고장시간은 독립이고 중도절단은 비정보적이며(시점 t에서 중도절단된 제품이 곧 고장날 가능성이 더 높지 않음), 시험 조건이 동질이어야 합니다.'),
    ],
    sampleIds: ['weibull'],
    tutorialIds: ['tutorial-reliability-001'],
  },
];
