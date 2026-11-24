/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — tutorial registry
   Twelve courses, bundled at build time. Order is teaching order: the reader
   can start anywhere, but the "next tutorial" chain follows it.
   ───────────────────────────────────────────────────────────────────────── */

import type { LocalizedText } from '../lib/localized';
import type { Tutorial, TutorialCategory, TutorialDifficulty } from './types';
import { PART1_TUTORIALS } from './courses/part1';
import { PART2_TUTORIALS } from './courses/part2';
import { PART3_TUTORIALS } from './courses/part3';

export const TUTORIAL_SCHEMA_VERSION = 1;

export const TUTORIALS: Tutorial[] = [...PART1_TUTORIALS, ...PART2_TUTORIALS, ...PART3_TUTORIALS];

export const TUTORIAL_CATEGORY_LABEL: Record<TutorialCategory, LocalizedText> = {
  'getting-started': { en: 'Getting started', ko: '시작하기' },
  'data-management': { en: 'Data management', ko: '데이터 관리' },
  'basic-statistics': { en: 'Basic statistics', ko: '기초 통계' },
  regression: { en: 'Regression', ko: '회귀' },
  'anova-glm': { en: 'ANOVA / GLM', ko: '분산분석 / GLM' },
  'quality-spc': { en: 'Quality & SPC', ko: '품질 · SPC' },
  msa: { en: 'Measurement systems', ko: '측정시스템' },
  reliability: { en: 'Reliability', ko: '신뢰성' },
  'doe-rsm': { en: 'DOE / RSM', ko: '실험계획 · 반응표면' },
  optimization: { en: 'Optimization', ko: '최적화' },
  visualization: { en: 'Visualization', ko: '시각화' },
};

export const TUTORIAL_DIFFICULTY_LABEL: Record<TutorialDifficulty, LocalizedText> = {
  intro: { en: 'Intro', ko: '입문' },
  beginner: { en: 'Beginner', ko: '초급' },
  intermediate: { en: 'Intermediate', ko: '중급' },
  advanced: { en: 'Advanced', ko: '고급' },
};

export function findTutorial(id: string): Tutorial | undefined {
  return TUTORIALS.find((tutorial) => tutorial.id === id);
}

export function tutorialIndex(id: string): number {
  return TUTORIALS.findIndex((tutorial) => tutorial.id === id);
}

export function tutorialsForSampleId(sampleId: string): Tutorial[] {
  return TUTORIALS.filter((tutorial) => tutorial.sampleIds.includes(sampleId));
}

export function tutorialsForHelpId(helpId: string): Tutorial[] {
  return TUTORIALS.filter((tutorial) => tutorial.helpIds.includes(helpId));
}

export function flagshipTutorial(): Tutorial {
  return TUTORIALS.find((tutorial) => tutorial.flagship) ?? TUTORIALS[TUTORIALS.length - 1];
}

/** Total steps across the registry, for the library header. */
export function totalStepCount(): number {
  return TUTORIALS.reduce((sum, tutorial) => sum + tutorial.steps.length, 0);
}
