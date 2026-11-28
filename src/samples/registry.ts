/* ─────────────────────────────────────────────────────────────────────────
   Statelia — Sample Library registry (WO-3E-09)

   Every practice dataset Statelia ships, with its variables, units and the
   tutorials and Help documents that use it. Bundled at build time: nothing here
   is fetched at run time, so the library also works from a file:// URL.
   ───────────────────────────────────────────────────────────────────────── */

import type { SampleDef, DatasetDef, SampleVariable } from './types';
import {
  buildComparisonData,
  buildDoeData,
  buildGageData,
  buildProcessData,
  buildRegressionData,
  buildRsmData,
  buildWeibullData,
} from './datasets/builtin';
import { buildDisplayOpticalDoE } from './datasets/displayOptical';

function v(name: string, role: SampleVariable['role'], unit?: string): SampleVariable {
  return unit ? { name, role, unit } : { name, role };
}

export const SAMPLES: SampleDef[] = [
  {
    id: 'process',
    nameKey: '@sample.process',
    category: 'process',
    synthetic: true,
    title: { en: 'Coating Process (60 parts)', ko: '코팅 공정 (60개 부품)' },
    summary: {
      en: 'One numeric measurement with two grouping columns and a defect category: the everyday shape of process data.',
      ko: '수치 측정값 하나에 두 개의 그룹 열과 불량 유형 열이 붙은, 가장 흔한 공정 데이터 형태입니다.',
    },
    source: {
      en: 'Synthetic data generated from a fixed seed; never measured on a real line.',
      ko: '고정 시드로 생성한 합성 데이터이며 실제 생산라인 측정값이 아닙니다.',
    },
    variables: [
      v('Thickness (mm)', 'response', 'mm'),
      v('Line', 'group'),
      v('Shift', 'group'),
      v('Defect', 'group'),
    ],
    build: buildProcessData,
    tutorialIds: ['tutorial-spc-001', 'tutorial-capability-001', 'tutorial-start-001'],
    helpIds: ['descriptive-statistics', 'spc-basics', 'capability-analysis'],
  },
  {
    id: 'comparison',
    nameKey: '@sample.comparison',
    category: 'comparison',
    synthetic: true,
    title: { en: 'Cure Study (two groups, paired)', ko: '경화 연구 (두 그룹, 대응 비교)' },
    summary: {
      en: 'Hardness for a standard and a new cure, plus a before/after block for a paired test.',
      ko: '표준 경화와 신규 경화의 경도, 그리고 대응 비교용 전/후 측정값입니다.',
    },
    source: {
      en: 'Synthetic data generated from a fixed seed; never measured in a real oven.',
      ko: '고정 시드로 생성한 합성 데이터이며 실제 경화로 측정값이 아닙니다.',
    },
    variables: [
      v('Group', 'factor'),
      v('Hardness', 'response'),
      v('Operator', 'group'),
      v('Before', 'response'),
      v('After', 'response'),
    ],
    build: buildComparisonData,
    tutorialIds: ['tutorial-hypothesis-001', 'tutorial-anova-001', 'tutorial-start-001'],
    helpIds: ['t-tests', 'anova-glm'],
  },
  {
    id: 'regression',
    nameKey: '@sample.regression',
    category: 'regression',
    synthetic: true,
    title: { en: 'Reactor Window (three predictors)', ko: '반응기 운전 구간 (예측변수 3개)' },
    summary: {
      en: 'Yield against temperature, pressure and speed, with a shift indicator: a multiple-regression classroom.',
      ko: '온도·압력·속도에 대한 수율, 교대 구분 열이 있는 다중회귀 실습 데이터입니다.',
    },
    source: {
      en: 'Synthetic data generated from a fixed seed; never measured on a real reactor.',
      ko: '고정 시드로 생성한 합성 데이터이며 실제 반응기 측정값이 아닙니다.',
    },
    variables: [
      v('Temperature (C)', 'factor', '°C'),
      v('Pressure (bar)', 'factor', 'bar'),
      v('Speed (rpm)', 'factor', 'rpm'),
      v('Yield (%)', 'response', '%'),
      v('Shift', 'group'),
    ],
    build: buildRegressionData,
    tutorialIds: ['tutorial-regression-001', 'tutorial-start-001'],
    helpIds: ['regression-fitting'],
  },
  {
    id: 'gagerr',
    nameKey: '@sample.gagerr',
    category: 'msa',
    synthetic: true,
    title: { en: 'Gage R&R (10 parts × 3 operators)', ko: '게이지 R&R (10개 부품 × 3명 작업자)' },
    summary: {
      en: 'A crossed measurement-system study with real part-to-part variation and three replicates.',
      ko: '부품 간 변동과 3회 반복이 있는 교차 측정시스템 연구 데이터입니다.',
    },
    source: {
      en: 'Synthetic data generated from a fixed seed; not a real measurement audit.',
      ko: '고정 시드로 생성한 합성 데이터이며 실제 측정 감사 결과가 아닙니다.',
    },
    variables: [
      v('Part', 'factor'),
      v('Operator', 'factor'),
      v('Measurement', 'response', 'mm'),
    ],
    build: buildGageData,
    tutorialIds: ['tutorial-gagerr-001'],
    helpIds: ['gage-rr'],
  },
  {
    id: 'doe',
    nameKey: '@sample.doe',
    category: 'doe',
    synthetic: true,
    title: { en: '2³ Factorial Design', ko: '2³ 요인설계' },
    summary: {
      en: 'Eight factorial runs and two centre points in coded units: main effects and interactions.',
      ko: '코드화 단위의 8개 요인 배치와 중심점 2개로 주효과와 교호작용을 봅니다.',
    },
    source: {
      en: 'Synthetic data generated from a fixed seed; the design is a textbook 2³ factorial.',
      ko: '고정 시드로 생성한 합성 데이터이며 설계 자체는 교과서적인 2³ 요인설계입니다.',
    },
    variables: [
      v('StdOrder', 'id'),
      v('RunOrder', 'id'),
      v('PtType', 'pttype'),
      v('A', 'factor', 'coded'),
      v('B', 'factor', 'coded'),
      v('C', 'factor', 'coded'),
      v('Y', 'response'),
    ],
    build: buildDoeData,
    tutorialIds: ['tutorial-doe-001'],
    helpIds: ['doe-factorial', 'factorial-analysis'],
  },
  {
    id: 'rsm',
    nameKey: '@sample.rsm',
    category: 'doe',
    synthetic: true,
    title: { en: 'RSM Central Composite (2 factors)', ko: '반응표면 중심합성 설계 (2요인)' },
    summary: {
      en: 'A two-factor central composite design with a curved response: fit, contours and a stationary point.',
      ko: '곡면 반응을 가진 2요인 중심합성 설계로, 적합·등고선·정류점을 다룹니다.',
    },
    source: {
      en: 'Synthetic data generated from a fixed seed; the design is a textbook CCD.',
      ko: '고정 시드로 생성한 합성 데이터이며 설계 자체는 교과서적인 중심합성설계입니다.',
    },
    variables: [
      v('StdOrder', 'id'),
      v('RunOrder', 'id'),
      v('PtType', 'pttype'),
      v('A', 'factor', 'coded'),
      v('B', 'factor', 'coded'),
      v('Y', 'response'),
    ],
    build: buildRsmData,
    tutorialIds: ['tutorial-doe-001'],
    helpIds: ['rsm-fitting', 'contour-surface'],
  },
  {
    id: 'weibull',
    nameKey: '@sample.weibull',
    category: 'reliability',
    synthetic: true,
    title: { en: 'Weibull Life (right-censored)', ko: '와이블 수명 (우측 중도절단)' },
    summary: {
      en: 'Forty units run to 400 hours, censored beyond the test window: shape, scale and percentiles.',
      ko: '400시간까지 시험한 40개 제품, 시험 구간을 넘긴 것은 중도절단으로 처리한 데이터입니다.',
    },
    source: {
      en: 'Synthetic lives drawn from a Weibull population with a fixed seed.',
      ko: '고정 시드로 와이블 모집단에서 생성한 합성 수명 데이터입니다.',
    },
    variables: [
      v('Time', 'time', 'h'),
      v('Censored', 'censor'),
    ],
    build: buildWeibullData,
    tutorialIds: ['tutorial-reliability-001'],
    helpIds: ['reliability-weibull'],
  },
  {
    id: 'display-optical-doe',
    nameKey: '@sample.displayOptical',
    category: 'display-optics',
    synthetic: true,
    title: { en: 'Display Optics DoE (3 factors, 4 responses)', ko: '디스플레이 광학 DoE (3요인, 4반응)' },
    summary: {
      en: 'A face-centred central composite design for LED current, optical distance and diffuser haze, with luminance, power, uniformity and temperature.',
      ko: 'LED 전류·광학 거리·확산제 헤이즈의 면중심 중심합성 설계와 휘도·소비전력·균일도·온도 반응입니다.',
    },
    source: {
      en: 'SYNTHETIC. Generated from quadratic models plus a fixed seed; not measured on a real display line and not a product specification.',
      ko: '합성 데이터입니다. 2차 모형과 고정 시드로 생성했으며 실제 디스플레이 라인 측정값이 아니고 제품 규격도 아닙니다.',
    },
    variables: [
      v('StdOrder', 'id'),
      v('RunOrder', 'id'),
      v('PtType', 'pttype'),
      v('LED Current (coded)', 'factor', 'coded'),
      v('Optical Distance (coded)', 'factor', 'coded'),
      v('Diffuser Haze (coded)', 'factor', 'coded'),
      v('LED Current (mA)', 'reference', 'mA'),
      v('Optical Distance (mm)', 'reference', 'mm'),
      v('Diffuser Haze (%)', 'reference', '%'),
      v('Luminance (cd/m2)', 'response', 'cd/m²'),
      v('Power Consumption (W)', 'response', 'W'),
      v('Uniformity (%)', 'response', '%'),
      v('Temperature (C)', 'response', '°C'),
    ],
    build: buildDisplayOpticalDoE,
    tutorialIds: ['tutorial-rsm-001', 'tutorial-rsm-001'],
    helpIds: ['rsm-fitting', 'contour-surface', 'model-store', 'multi-response-optimization', 'prediction-profiler'],
  },
];

/** Backwards-compatible list for the File and toolbar sample menus. */
export const DATASETS: DatasetDef[] = SAMPLES.map((sample) => ({
  id: sample.id,
  nameKey: sample.nameKey,
  build: sample.build,
}));

export function findSample(id: string): SampleDef | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}

export function samplesForTutorial(tutorialId: string): SampleDef[] {
  return SAMPLES.filter((sample) => sample.tutorialIds.includes(tutorialId));
}

export function tutorialsForSample(sampleId: string): string[] {
  return findSample(sampleId)?.tutorialIds ?? [];
}
