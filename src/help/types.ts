/* ─────────────────────────────────────────────────────────────────────────
   Statelia — Help Center model (WO-3E-10)

   One entry per topic: what the analysis is, the formula the engine actually
   evaluates, what each parameter means, how to read the output, and which
   assumptions it rests on. Tutorials link here by `helpId` instead of repeating
   the theory (WO-3E-11 §2.2).
   ───────────────────────────────────────────────────────────────────────── */

import type { LocalizedText } from '../lib/localized';

export type HelpCategory =
  | 'getting-started'
  | 'data'
  | 'basic-statistics'
  | 'regression'
  | 'anova'
  | 'quality'
  | 'msa'
  | 'reliability'
  | 'doe'
  | 'optimization'
  | 'visualization';

export interface HelpFormula {
  /** The expression as it is evaluated, in plain notation. */
  expression: string;
  note: LocalizedText;
}

export interface HelpParameter {
  name: LocalizedText;
  meaning: LocalizedText;
}

export interface HelpEntry {
  id: string;
  /** Analyses whose dialog and output this document explains. */
  analysisIds: string[];
  category: HelpCategory;
  title: LocalizedText;
  summary: LocalizedText;
  theory: LocalizedText;
  formulas: HelpFormula[];
  parameters: HelpParameter[];
  interpretation: LocalizedText[];
  assumptions: LocalizedText[];
  sampleIds: string[];
  tutorialIds: string[];
}

export const HELP_CATEGORY_LABEL: Record<HelpCategory, LocalizedText> = {
  'getting-started': { en: 'Getting started', ko: '시작하기' },
  data: { en: 'Data', ko: '데이터' },
  'basic-statistics': { en: 'Basic statistics', ko: '기초 통계' },
  regression: { en: 'Regression', ko: '회귀' },
  anova: { en: 'ANOVA / GLM', ko: '분산분석 / 일반선형모형' },
  quality: { en: 'Quality & SPC', ko: '품질 · 관리도' },
  msa: { en: 'Measurement systems', ko: '측정시스템 분석' },
  reliability: { en: 'Reliability', ko: '신뢰성' },
  doe: { en: 'DOE / RSM', ko: '실험계획 · 반응표면' },
  optimization: { en: 'Optimization', ko: '최적화' },
  visualization: { en: 'Visualization', ko: '시각화' },
};
