/* ─────────────────────────────────────────────────────────────────────────
   Statelia — registry audit (WO-T12, Registry QA)

   One function that checks the whole content graph: duplicate ids, dangling
   sample/help/analysis references, actions and presets that do not exist,
   presets whose columns are missing from their sample, and any lesson text
   that lacks one of its two languages. The unit test and the CI QA call it;
   nothing here needs a browser.
   ───────────────────────────────────────────────────────────────────────── */

import { findAnalysis } from '../lib/analyses';
import { findSample } from '../samples/registry';
import { findHelp } from '../help/registry';
import { TUTORIALS } from './registry';
import { ACTION_IDS, TUTORIAL_ACTIONS, validateActionSpec } from './actionRegistry';
import { findPreset, presetColumns, resolvePreset } from './presets';
import { hasTutorialText, tutorialTextEntry, tutorialTextKeys } from './localize';
import type { ValidationRule } from './types';

export interface AuditIssue {
  severity: 'error' | 'warning';
  code: string;
  detail: string;
}

const VALIDATION_KINDS = new Set<ValidationRule['kind']>([
  'sample-loaded',
  'help-opened',
  'analysis-opened',
  'analysis-output',
  'analysis-outputs',
  'column-created',
  'model-stored',
  'chart',
  'optimizer-run',
  'profiler-check',
  'layout-saved',
  'layout-export',
  'practice-complete',
  'chart-exported',
  'project-saved',
  'manual',
]);

function ruleReferences(rule: ValidationRule): { analysisIds: string[] } {
  if (rule.kind === 'analysis-output' || rule.kind === 'analysis-opened') return { analysisIds: [rule.analysisId] };
  if (rule.kind === 'analysis-outputs') return { analysisIds: rule.requirements.map((requirement) => requirement.analysisId) };
  return { analysisIds: [] };
}

export function auditTutorialRegistry(): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const tutorialIds = new Set<string>();
  const allTextKeys = new Set(tutorialTextKeys());

  TUTORIALS.forEach((tutorial) => {
    if (tutorialIds.has(tutorial.id)) issues.push({ severity: 'error', code: 'duplicate-tutorial', detail: tutorial.id });
    tutorialIds.add(tutorial.id);
    if (tutorial.schemaVersion !== 1) issues.push({ severity: 'error', code: 'schema-version', detail: tutorial.id });
    if (!tutorial.steps.length) issues.push({ severity: 'error', code: 'no-steps', detail: tutorial.id });

    // Metadata surfaces: title, description, objectives, structure.
    [tutorial.titleKey, tutorial.descriptionKey, ...tutorial.objectiveKeys, tutorial.structure.learnKey, tutorial.structure.dataKey,
      tutorial.structure.analysisKey, tutorial.structure.inputsKey, tutorial.structure.checkKey, tutorial.structure.interpretKey,
      tutorial.structure.conclusionKey].forEach((key) => {
      if (!hasTutorialText(key)) issues.push({ severity: 'error', code: 'missing-text', detail: `${tutorial.id}:${key}` });
    });

    tutorial.sampleIds.forEach((sampleId) => {
      if (!findSample(sampleId)) issues.push({ severity: 'error', code: 'unknown-sample', detail: `${tutorial.id}:${sampleId}` });
    });
    tutorial.helpIds.forEach((helpId) => {
      if (!findHelp(helpId)) issues.push({ severity: 'error', code: 'unknown-help', detail: `${tutorial.id}:${helpId}` });
    });
    tutorial.analysisIds.forEach((analysisId) => {
      if (!findAnalysis(analysisId)) issues.push({ severity: 'error', code: 'unknown-analysis', detail: `${tutorial.id}:${analysisId}` });
    });
    if (tutorial.nextTutorialId && !TUTORIALS.some((candidate) => candidate.id === tutorial.nextTutorialId)) {
      issues.push({ severity: 'error', code: 'unknown-next', detail: `${tutorial.id}:${tutorial.nextTutorialId}` });
    }
    if (tutorial.prerequisites.some((id) => !TUTORIALS.some((candidate) => candidate.id === id))) {
      issues.push({ severity: 'warning', code: 'unknown-prerequisite', detail: tutorial.id });
    }

    const stepIds = new Set<string>();
    tutorial.steps.forEach((step) => {
      if (stepIds.has(step.id)) issues.push({ severity: 'error', code: 'duplicate-step', detail: `${tutorial.id}:${step.id}` });
      stepIds.add(step.id);
      [step.titleKey, step.instructionKey, step.expectedKey, step.hintKey].forEach((key) => {
        if (key && !hasTutorialText(key)) issues.push({ severity: 'error', code: 'missing-text', detail: `${tutorial.id}:${step.id}:${key}` });
      });
      if (!step.action) {
        issues.push({ severity: 'error', code: 'missing-action', detail: `${tutorial.id}:${step.id}` });
      } else {
        validateActionSpec(step.action).forEach((problem) => {
          issues.push({ severity: 'error', code: 'bad-action', detail: `${tutorial.id}:${step.id}:${problem}` });
        });
        if (!ACTION_IDS.includes(step.action.action)) {
          issues.push({ severity: 'error', code: 'unknown-action', detail: `${tutorial.id}:${step.id}:${step.action.action}` });
        }
        const presetIds = [step.action.presetId, ...(step.action.presetIds ?? [])].filter((id): id is string => Boolean(id));
        presetIds.forEach((presetId) => {
          const preset = findPreset(presetId);
          if (!preset) {
            issues.push({ severity: 'error', code: 'unknown-preset', detail: `${tutorial.id}:${step.id}:${presetId}` });
            return;
          }
          if (presetId === step.action.presetId && step.action.analysisId && preset.analysisId !== step.action.analysisId) {
            issues.push({ severity: 'error', code: 'preset-analysis-mismatch', detail: `${tutorial.id}:${step.id}:${presetId}` });
          }
          if (!tutorial.sampleIds.includes(preset.sampleId)) {
            issues.push({ severity: 'warning', code: 'preset-sample-not-declared', detail: `${tutorial.id}:${presetId}` });
          } else if (tutorial.sampleIds.length === 1 && preset.sampleId !== tutorial.sampleIds[0]) {
            issues.push({ severity: 'warning', code: 'preset-sample-mismatch', detail: `${tutorial.id}:${presetId}` });
          }
        });
        if (step.action.sampleId && !findSample(step.action.sampleId)) {
          issues.push({ severity: 'error', code: 'unknown-action-sample', detail: `${tutorial.id}:${step.id}` });
        }
        if (step.action.helpId && !findHelp(step.action.helpId)) {
          issues.push({ severity: 'error', code: 'unknown-action-help', detail: `${tutorial.id}:${step.id}` });
        }
      }
      if (step.helpId && !findHelp(step.helpId)) {
        issues.push({ severity: 'error', code: 'unknown-step-help', detail: `${tutorial.id}:${step.id}:${step.helpId}` });
      }
      if (!VALIDATION_KINDS.has(step.validation.kind)) {
        issues.push({ severity: 'error', code: 'unknown-validation', detail: `${tutorial.id}:${step.id}:${step.validation.kind}` });
      }
      if (step.completion === 'validated' && step.validation.kind === 'manual') {
        issues.push({ severity: 'error', code: 'validated-manual-rule', detail: `${tutorial.id}:${step.id}` });
      }
      if (step.completion === 'manual' && step.validation.kind !== 'manual') {
        issues.push({ severity: 'warning', code: 'manual-rule-ignored', detail: `${tutorial.id}:${step.id}` });
      }
      ruleReferences(step.validation).analysisIds.forEach((analysisId) => {
        if (!findAnalysis(analysisId)) issues.push({ severity: 'error', code: 'validation-unknown-analysis', detail: `${tutorial.id}:${step.id}:${analysisId}` });
      });
      if (step.validation.kind === 'model-stored' && tutorial.flagship && !(step.validation.minR2 && step.validation.minR2 > 0.5)) {
        issues.push({ severity: 'warning', code: 'flagship-weak-model-rule', detail: tutorial.id });
      }
    });

    if (tutorial.flagship) {
      if (tutorial.steps.length < 12) issues.push({ severity: 'error', code: 'flagship-steps', detail: `${tutorial.id}:${tutorial.steps.length}` });
      const manual = tutorial.steps.filter((step) => step.completion === 'manual');
      if (manual.length) issues.push({ severity: 'error', code: 'flagship-manual-step', detail: `${tutorial.id}:${manual.map((step) => step.id).join(',')}` });
    }
  });

  // Every presets must resolve against its sample and run through its analysis.
  const presetIds = new Set<string>();
  const allPresets = TUTORIALS.flatMap((tutorial) => tutorial.steps.flatMap((step) => [step.action.presetId, ...(step.action.presetIds ?? [])])).filter((id): id is string => Boolean(id));
  allPresets.forEach((presetId) => {
    if (presetIds.has(presetId)) return;
    presetIds.add(presetId);
    const preset = findPreset(presetId);
    if (!preset) return;
    const sample = findSample(preset.sampleId);
    if (!sample) {
      issues.push({ severity: 'error', code: 'preset-sample', detail: presetId });
      return;
    }
    const sheet = sample.build();
    const names = new Set(sheet.columns.map((column) => column.name));
    presetColumns(preset).forEach((name) => {
      if (!names.has(name)) issues.push({ severity: 'error', code: 'preset-column', detail: `${presetId}:${name}` });
    });
    const def = findAnalysis(preset.analysisId);
    if (!def) {
      issues.push({ severity: 'error', code: 'preset-analysis', detail: presetId });
      return;
    }
    const resolved = resolvePreset(preset, sheet);
    if (resolved.missing.length) {
      issues.push({ severity: 'error', code: 'preset-missing-column', detail: `${presetId}:${resolved.missing.join(',')}` });
      return;
    }
    try {
      def.run({ lang: 'en', sheet, values: resolved.values });
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'preset-run-failed',
        detail: `${presetId}: ${error instanceof Error ? error.message : 'unknown'}`,
      });
    }
  });

  // Every action in the allow-list is described and reachable.
  ACTION_IDS.forEach((actionId) => {
    const definition = TUTORIAL_ACTIONS[actionId];
    if (!definition.labelKey) issues.push({ severity: 'error', code: 'action-label', detail: actionId });
    if (!TUTORIALS.some((tutorial) => tutorial.steps.some((step) => step.action.action === actionId))) {
      issues.push({ severity: 'warning', code: 'unused-action', detail: actionId });
    }
  });

  // A stored text key must carry both languages.
  allTextKeys.forEach((key) => {
    const text = tutorialTextEntry(key);
    if (!text || !text.en?.trim() || !text.ko?.trim()) {
      issues.push({ severity: 'error', code: 'translation-missing', detail: key });
    }
  });

  return issues;
}

/** Errors only, for a CI gate that must fail the build. */
export function auditErrors(): AuditIssue[] {
  return auditTutorialRegistry().filter((issue) => issue.severity === 'error');
}
