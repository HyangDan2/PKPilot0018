/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — tutorial engine (WO-T05)

   The engine is pure: it takes the tutorial definition, the stored progress and
   the current workspace facts, and returns the progress after re-evaluating
   every validated step. React only renders what comes back. Manual steps are
   only ever moved by the reader; validated steps are only ever moved by the
   validators, which is what keeps "completed" and "you clicked next" apart.
   ───────────────────────────────────────────────────────────────────────── */

import type { OptimizerResult } from '../lib/optimizationTypes';
import { createProgress } from './progressStore';
import type {
  StepProgress,
  StepStatus,
  Tutorial,
  TutorialProgress,
  ValidationOutcome,
  WorkspaceFacts,
} from './types';
import { latestEvent, validateStep } from './validationRegistry';

export interface EvaluationResult {
  progress: TutorialProgress;
  outcomes: Record<string, ValidationOutcome>;
  changed: boolean;
}

function withStep(progress: TutorialProgress, stepId: string, patch: Partial<StepProgress>): TutorialProgress {
  const current = progress.steps[stepId] ?? { status: 'NOT_STARTED' as StepStatus, mode: 'manual' as const };
  return {
    ...progress,
    steps: { ...progress.steps, [stepId]: { ...current, ...patch, updatedAt: Date.now() } },
  };
}

/** The first step that is neither completed nor skipped. */
export function nextOpenStep(tutorial: Tutorial, progress: TutorialProgress): string {
  const open = tutorial.steps.find((step) => {
    const status = progress.steps[step.id]?.status ?? 'NOT_STARTED';
    return status !== 'COMPLETED' && status !== 'SKIPPED';
  });
  return open?.id ?? tutorial.steps[tutorial.steps.length - 1]?.id ?? '';
}

export function isTutorialComplete(tutorial: Tutorial, progress: TutorialProgress): boolean {
  return tutorial.steps.every((step) => {
    const status = progress.steps[step.id]?.status ?? 'NOT_STARTED';
    return status === 'COMPLETED' || status === 'SKIPPED';
  });
}

/**
 * Re-evaluate every validated step against the workspace. A step that used to
 * pass but no longer matches its rule goes back to IN_PROGRESS (or FAILED when
 * the state contradicts the rule): completion is never restored from storage
 * alone, which is what keeps a vanished practice project from reading as done.
 */
export function evaluateSession(tutorial: Tutorial, progress: TutorialProgress, facts: WorkspaceFacts): EvaluationResult {
  let next: TutorialProgress = { ...progress, steps: { ...progress.steps } };
  const outcomes: Record<string, ValidationOutcome> = {};
  let changed = false;

  tutorial.steps.forEach((step) => {
    const current = next.steps[step.id] ?? { status: 'NOT_STARTED' as StepStatus, mode: step.completion };
    if (step.completion === 'manual') {
      outcomes[step.id] = {
        status: current.status === 'COMPLETED' ? 'pass' : 'pending',
        code: 'manual',
        detail: {
          en: 'Completed by you; this step is not machine-verified.',
          ko: '직접 완료 처리한 단계이며 기계 검증되지 않았습니다.',
        },
      };
      if (!next.steps[step.id]) {
        next.steps[step.id] = current;
        changed = true;
      }
      return;
    }
    const outcome = validateStep(step.validation, facts);
    outcomes[step.id] = outcome;
    let status: StepStatus;
    if (outcome.status === 'pass') status = 'COMPLETED';
    else if (outcome.status === 'fail') status = 'FAILED';
    else status = current.status === 'COMPLETED' ? 'IN_PROGRESS' : current.status === 'NOT_STARTED' ? 'NOT_STARTED' : 'IN_PROGRESS';
    // A skipped step stays skipped until the reader restarts it explicitly.
    if (current.status === 'SKIPPED') status = 'SKIPPED';
    if (status !== current.status || outcome.code !== current.code || outcome.detail.en !== current.detail?.en) {
      changed = true;
      next.steps[step.id] = {
        ...current,
        status,
        code: outcome.code,
        detail: outcome.detail,
        ...(status === 'COMPLETED' ? { validatedAt: Date.now() } : {}),
        updatedAt: Date.now(),
      };
    }
  });

  const open = nextOpenStep(tutorial, next);
  // Keep a manually chosen current step while it is still open.
  const keepCurrent = next.currentStepId && next.steps[next.currentStepId] && next.steps[next.currentStepId].status !== 'COMPLETED' && next.steps[next.currentStepId].status !== 'SKIPPED';
  if (!keepCurrent && open && open !== next.currentStepId) {
    next = { ...next, currentStepId: open };
    changed = true;
  }
  const complete = isTutorialComplete(tutorial, next);
  const status = complete ? 'completed' : 'in-progress';
  if (status !== next.status) {
    next = { ...next, status };
    changed = true;
  }
  if (changed) next = { ...next, updatedAt: new Date().toISOString() };
  return { progress: next, outcomes, changed };
}

export function setCurrentStep(progress: TutorialProgress, stepId: string): TutorialProgress {
  return { ...progress, currentStepId: stepId, updatedAt: new Date().toISOString() };
}

export function markManualStep(tutorial: Tutorial, progress: TutorialProgress, stepId: string, done: boolean): TutorialProgress {
  const step = tutorial.steps.find((candidate) => candidate.id === stepId);
  if (!step || step.completion !== 'manual') return progress;
  const next = withStep(progress, stepId, {
    status: done ? 'COMPLETED' : 'IN_PROGRESS',
    code: done ? 'manual-done' : undefined,
    detail: done
      ? { en: 'Marked complete by you (not machine-verified).', ko: '직접 완료 처리했습니다(기계 검증 아님).' }
      : { en: 'Marked incomplete again.', ko: '다시 미완료로 표시했습니다.' },
  });
  return finishIfComplete(tutorial, next);
}

export function skipStep(tutorial: Tutorial, progress: TutorialProgress, stepId: string): TutorialProgress {
  const next = withStep(progress, stepId, {
    status: 'SKIPPED',
    code: 'skipped',
    detail: { en: 'Skipped by you; not counted as verified.', ko: '직접 건너뛰었으며 검증으로 집계되지 않습니다.' },
  });
  return finishIfComplete(tutorial, { ...next, currentStepId: nextOpenStep(tutorial, next) });
}

export function reopenStep(_tutorial: Tutorial, progress: TutorialProgress, stepId: string): TutorialProgress {
  const next = withStep(progress, stepId, { status: 'IN_PROGRESS', code: 'reopened' });
  return { ...next, currentStepId: stepId, status: 'in-progress', updatedAt: new Date().toISOString() };
}

function finishIfComplete(tutorial: Tutorial, progress: TutorialProgress): TutorialProgress {
  const complete = isTutorialComplete(tutorial, progress);
  return { ...progress, status: complete ? 'completed' : 'in-progress', updatedAt: new Date().toISOString() };
}

export interface TutorialSummaryData {
  totalSteps: number;
  completed: number;
  validated: number;
  manual: number;
  skipped: number;
  failed: number;
  durationMs: number;
  sampleIds: string[];
  analyses: string[];
  conceptKeys: string[];
  models: { name: string; response: string; r2: number | null }[];
  optimizer: { status: string; composite: number; predictions: { name: string; value: number | null }[] } | null;
  nextStepId: string;
}

/** What the completion screen states, all of it read from the real session. */
export function tutorialSummary(tutorial: Tutorial, progress: TutorialProgress, facts: WorkspaceFacts): TutorialSummaryData {
  const statuses = tutorial.steps.map((step) => progress.steps[step.id]?.status ?? 'NOT_STARTED');
  const completed = statuses.filter((status) => status === 'COMPLETED').length;
  const validated = tutorial.steps.filter((step) => step.completion === 'validated' && progress.steps[step.id]?.status === 'COMPLETED').length;
  const manual = tutorial.steps.filter((step) => step.completion === 'manual' && progress.steps[step.id]?.status === 'COMPLETED').length;
  const skipped = statuses.filter((status) => status === 'SKIPPED').length;
  const failed = statuses.filter((status) => status === 'FAILED').length;
  const started = Date.parse(progress.startedAt);
  const durationMs = Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0;
  const analyses = [...new Set(facts.events.filter((event) => event.type === 'analysis-run').map((event) => String(event.payload.analysisId ?? '')))].filter(Boolean);
  const optimizerEvent = latestEvent(facts, 'optimizer-run');
  const optimizerPayload = optimizerEvent?.payload as { result?: OptimizerResult } | undefined;
  const solution = optimizerPayload?.result?.solutions?.[0];
  return {
    totalSteps: tutorial.steps.length,
    completed,
    validated,
    manual,
    skipped,
    failed,
    durationMs,
    sampleIds: tutorial.sampleIds.filter((id) => facts.events.some((event) => event.type === 'sample-loaded' && event.payload.sampleId === id)),
    analyses,
    conceptKeys: tutorial.objectiveKeys,
    models: facts.models.map((model) => ({ name: model.name, response: model.response.name, r2: model.diagnostics.r2 ?? null })),
    optimizer: solution
      ? {
        status: optimizerPayload?.result?.status ?? 'unknown',
        composite: solution.composite,
        predictions: solution.responses.map((response) => ({ name: response.name, value: response.value })),
      }
      : null,
    nextStepId: nextOpenStep(tutorial, progress),
  };
}

/** Restart affects this session only: a fresh progress record, same practice project. */
export function restartSession(tutorial: Tutorial, practiceProjectId: string | null): TutorialProgress {
  return createProgress(tutorial, practiceProjectId);
}
