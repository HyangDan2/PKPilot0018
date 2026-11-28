/* ─────────────────────────────────────────────────────────────────────────
   Statelia — declarative tutorial authoring

   Course modules state their prose once as paired strings; this helper derives
   the localization keys (`tutorial.<id>.title`, `…steps.<step>.instruction`
   and so on), registers the text, and returns the resolved `Tutorial`. That is
   why a new tutorial is content only: no component and no interface key.
   ───────────────────────────────────────────────────────────────────────── */

import type { LocalizedText } from '../lib/localized';
import { registerText } from './localize';
import type {
  Tutorial,
  TutorialActionSpec,
  TutorialCategory,
  TutorialDifficulty,
  TutorialStep,
  ValidationRule,
  CompletionMode,
} from './types';

export interface RawStep {
  id: string;
  title: LocalizedText;
  instruction: LocalizedText;
  expected: LocalizedText;
  hint?: LocalizedText;
  action: TutorialActionSpec;
  helpId?: string;
  completion: CompletionMode;
  optional?: boolean;
  validation: ValidationRule;
}

export interface RawTutorial {
  id: string;
  version?: number;
  title: LocalizedText;
  description: LocalizedText;
  category: TutorialCategory;
  difficulty: TutorialDifficulty;
  estimatedMinutes: number;
  objectives: LocalizedText[];
  prerequisites?: string[];
  sampleIds: string[];
  helpIds: string[];
  analysisIds: string[];
  structure: {
    learn: LocalizedText;
    data: LocalizedText;
    analysis: LocalizedText;
    inputs: LocalizedText;
    check: LocalizedText;
    interpret: LocalizedText;
    conclusion: LocalizedText;
  };
  steps: RawStep[];
  nextTutorialId?: string;
  flagship?: boolean;
}

/** Derive and register the seven-part structure keys, in order. */
export function defineTutorial(raw: RawTutorial): Tutorial {
  const base = `tutorial.${raw.id}`;
  const titleKey = registerText(`${base}.title`, raw.title);
  const descriptionKey = registerText(`${base}.description`, raw.description);
  const objectiveKeys = raw.objectives.map((objective, index) => registerText(`${base}.objective.${index + 1}`, objective));
  const structure = {
    learnKey: registerText(`${base}.structure.learn`, raw.structure.learn),
    dataKey: registerText(`${base}.structure.data`, raw.structure.data),
    analysisKey: registerText(`${base}.structure.analysis`, raw.structure.analysis),
    inputsKey: registerText(`${base}.structure.inputs`, raw.structure.inputs),
    checkKey: registerText(`${base}.structure.check`, raw.structure.check),
    interpretKey: registerText(`${base}.structure.interpret`, raw.structure.interpret),
    conclusionKey: registerText(`${base}.structure.conclusion`, raw.structure.conclusion),
  };
  const steps: TutorialStep[] = raw.steps.map((step) => ({
    id: step.id,
    titleKey: registerText(`${base}.steps.${step.id}.title`, step.title),
    instructionKey: registerText(`${base}.steps.${step.id}.instruction`, step.instruction),
    expectedKey: registerText(`${base}.steps.${step.id}.expected`, step.expected),
    ...(step.hint ? { hintKey: registerText(`${base}.steps.${step.id}.hint`, step.hint) } : {}),
    action: step.action,
    ...(step.helpId ? { helpId: step.helpId } : {}),
    completion: step.completion,
    ...(step.optional ? { optional: true } : {}),
    validation: step.validation,
  }));
  return {
    id: raw.id,
    schemaVersion: 1,
    version: raw.version ?? 1,
    titleKey,
    descriptionKey,
    category: raw.category,
    difficulty: raw.difficulty,
    estimatedMinutes: raw.estimatedMinutes,
    objectiveKeys,
    prerequisites: raw.prerequisites ?? [],
    sampleIds: raw.sampleIds,
    helpIds: raw.helpIds,
    analysisIds: raw.analysisIds,
    structure,
    steps,
    ...(raw.nextTutorialId ? { nextTutorialId: raw.nextTutorialId } : {}),
    ...(raw.flagship ? { flagship: true } : {}),
  };
}
