import { describe, expect, it } from 'vitest';
import type { ModelFactor } from '../src/lib/glm';
import { analyzeRsm, buildRsmModel } from '../src/lib/doe';
import { createStoredModel, draftFromRsmPayload, type StoredModel } from '../src/lib/modelStore';
import { defaultFactorSettings, defaultResponseSettings, optimize, suggestResponseLimits } from '../src/lib/optimizer';
import { modelSurface, predictStoredModel } from '../src/lib/modelPredictor';
import type { FactorSettings, OptimizerResult, ResponseSettings } from '../src/lib/optimizationTypes';
import type { LayoutDoc } from '../src/lib/graphLayout';
import { buildDisplayOpticalDoE } from '../src/samples/datasets/displayOptical';
import { auditErrors, auditTutorialRegistry } from '../src/tutorials/qa';
import { TUTORIALS, findTutorial, flagshipTutorial } from '../src/tutorials/registry';
import {
  ProgressStorageError,
  TutorialProgressStore,
  createProgress,
} from '../src/tutorials/progressStore';
import { evaluateSession, isTutorialComplete, markManualStep, skipStep } from '../src/tutorials/tutorialEngine';
import { checkPredictionConsistency, closeTo, validateStep } from '../src/tutorials/validationRegistry';
import type { TutorialEvent, WorkspaceFacts } from '../src/tutorials/types';

/* ── a real display-optics practice built from the engine ─────────────── */

const displaySheet = buildDisplayOpticalDoE();
const factorColumns = ['LED Current (coded)', 'Optical Distance (coded)', 'Diffuser Haze (coded)'];
const responseNames = ['Luminance (cd/m2)', 'Power Consumption (W)', 'Uniformity (%)', 'Temperature (C)'];

const factors: ModelFactor[] = factorColumns.map((name) => {
  const column = displaySheet.columns.find((candidate) => candidate.name === name)!;
  return { name, kind: 'numeric', values: column.values };
});

function buildModels(): StoredModel[] {
  return responseNames.map((name) => {
    const column = displaySheet.columns.find((candidate) => candidate.name === name)!;
    const analysis = analyzeRsm(column.values as (number | null)[], factors);
    const payload = buildRsmModel(analysis.glm, factors, analysis.stationary);
    return createStoredModel(draftFromRsmPayload(payload, { response: { id: column.id, name }, sheet: displaySheet, analysisId: 'rsmanalyze' }), name);
  });
}

const models = buildModels();

const factorSettings: FactorSettings[] = factorColumns.map((name) => defaultFactorSettings(models, name));
let responseSettings: ResponseSettings[] = models.map((model) => {
  const base = defaultResponseSettings(model);
  const spec: Record<string, { goal: ResponseSettings['goal']; lower: number; upper: number }> = {
    'Luminance (cd/m2)': { goal: 'maximize', lower: 480, upper: 600 },
    'Power Consumption (W)': { goal: 'minimize', lower: 6, upper: 14 },
    'Uniformity (%)': { goal: 'range', lower: 85, upper: 100 },
    'Temperature (C)': { goal: 'range', lower: 20, upper: 45 },
  };
  const chosen = spec[model.response.name];
  return { ...base, goal: chosen.goal, lower: chosen.lower, upper: chosen.upper, target: null };
});
responseSettings = suggestResponseLimits(models, responseSettings, factorSettings);

const result: OptimizerResult = optimize(models, responseSettings, factorSettings, {
  method: 'auto',
  seed: 20261124,
  maxEvaluations: 20000,
});

function event(type: TutorialEvent['type'], payload: Record<string, unknown>): TutorialEvent {
  return { id: `ev-${Math.random().toString(36).slice(2)}`, type, at: Date.now(), payload };
}

function facts(overrides: Partial<WorkspaceFacts> = {}): WorkspaceFacts {
  const events: TutorialEvent[] = [
    event('sample-loaded', { sampleId: 'display-optical-doe', sheetId: displaySheet.id }),
    event('analysis-run', { analysisId: 'rsmanalyze' }),
    event('optimizer-run', { result, responses: responseSettings, factors: factorSettings }),
  ];
  return {
    worksheets: [displaySheet],
    activeSheetId: displaySheet.id,
    outputs: [],
    models,
    figures: [],
    events,
    practice: { id: 'practice-1', mode: 'isolated', tutorialId: 'tutorial-rsm-001', sampleIds: ['display-optical-doe'] },
    ...overrides,
  };
}

/* ── registry QA ──────────────────────────────────────────────────────── */

describe('tutorial registry', () => {
  it('passes the registry audit with no errors', () => {
    expect(auditErrors()).toEqual([]);
  });

  it('ships twelve tutorials with a twelve-step flagship, all automatically validated', () => {
    expect(TUTORIALS).toHaveLength(12);
    expect(new Set(TUTORIALS.map((tutorial) => tutorial.id)).size).toBe(12);
    const flagship = flagshipTutorial();
    expect(flagship.id).toBe('tutorial-rsm-001');
    expect(flagship.steps).toHaveLength(12);
    expect(flagship.steps.every((step) => step.completion === 'validated')).toBe(true);
  });

  it('reports every unused action, translation gap and dangling id as a warning or error', () => {
    const issues = auditTutorialRegistry();
    expect(issues.filter((issue) => issue.code === 'unknown-preset')).toEqual([]);
    expect(issues.filter((issue) => issue.code === 'missing-text')).toEqual([]);
  });
});

/* ── numeric tolerance ────────────────────────────────────────────────── */

describe('tolerance', () => {
  it('accepts a value inside the absolute + relative band and refuses one outside it', () => {
    expect(closeTo(520.0000001, 520)).toBe(true);
    expect(closeTo(520.01, 520)).toBe(false);
    expect(closeTo(1e6 + 0.5, 1e6)).toBe(true); // relative band dominates
  });
});

/* ── step rules ───────────────────────────────────────────────────────── */

describe('validation rules', () => {
  it('asks for an analysis output until one exists, then passes', () => {
    const rule = { kind: 'analysis-output' as const, analysisId: 'rsmanalyze' };
    expect(validateStep(rule, facts()).status).toBe('pending');
    const output = {
      id: 'o1',
      titleKey: 'an.rsmanalyze',
      createdAt: Date.now(),
      collapsed: false,
      blocks: [],
      meta: { engine: 'test', analysisId: 'rsmanalyze', values: {}, sheetId: displaySheet.id, sheetName: displaySheet.name, ranAt: Date.now(), rowCount: 20, columns: [] },
      model: undefined,
    };
    expect(validateStep(rule, facts({ outputs: [output] })).status).toBe('pass');
    expect(validateStep({ ...rule, requireModel: true }, facts({ outputs: [output] })).status).toBe('fail');
  });

  it('accepts four stored quadratic models with high R² and refuses a low-R² model', () => {
    const rule = { kind: 'model-stored' as const, responses: responseNames, minCount: 4, minR2: 0.9, quadratic: true };
    expect(validateStep(rule, facts({ models: models.slice(0, 3) })).status).toBe('pending');
    expect(validateStep(rule, facts()).status).toBe('pass');
    const weak = models.map((model, index) => (index === 0 ? { ...model, diagnostics: { ...model.diagnostics, r2: 0.4 } } : model));
    expect(validateStep(rule, facts({ models: weak })).status).toBe('fail');
  });

  it('treats a missing practice project as pending, not as done', () => {
    const rule = { kind: 'sample-loaded' as const, sampleId: 'display-optical-doe', columns: ['Luminance (cd/m2)'] };
    expect(validateStep(rule, facts({ worksheets: [], events: [] })).status).toBe('pending');
  });
});

/* ── flagship prediction consistency ──────────────────────────────────── */

describe('prediction consistency', () => {
  it('agrees across the optimiser and the stored models', () => {
    const report = checkPredictionConsistency(facts());
    expect(report.ok).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(4);
  });

  it('catches a model whose arithmetic changed after the optimisation', () => {
    const tampered = models.map((model, index) => (index === 0
      ? { ...model, coefficients: model.coefficients.map((coefficient, position) => (position === 0 ? { ...coefficient, value: coefficient.value + 25 } : coefficient)) }
      : model));
    const report = checkPredictionConsistency(facts({ models: tampered }));
    expect(report.ok).toBe(false);
    expect(report.checks.some((check) => check.name.startsWith('optimizer:') && !check.ok)).toBe(true);
  });

  it('checks a 3D surface against the stored model at the same actual factor values', () => {
    const surface = modelSurface(models[0], { xName: factorColumns[0], yName: factorColumns[1], resolution: 21 });
    const chartOutput = {
      id: 'surface',
      titleKey: 'an.modelsurface',
      createdAt: Date.now(),
      collapsed: false,
      blocks: [{
        type: 'chart' as const,
        chart: {
          kind: 'surface3d' as const,
          xs: surface.xs,
          ys: surface.ys,
          z: surface.z,
          xLabel: surface.xName,
          yLabel: surface.yName,
          model: models[0],
        },
      }],
    };
    const good = checkPredictionConsistency(facts({ outputs: [chartOutput] }));
    expect(good.checks.some((check) => check.name === 'surface:Luminance (cd/m2)' && check.ok)).toBe(true);
    const shifted = surface.z.map((row) => row.map((value) => value + 20));
    const bad = checkPredictionConsistency(facts({ outputs: [{ ...chartOutput, blocks: [{ type: 'chart', chart: { ...chartOutput.blocks[0].chart, z: shifted } }] }] }));
    expect(bad.checks.some((check) => check.name === 'surface:Luminance (cd/m2)' && !check.ok)).toBe(true);
  });

  it('passes the optimiser rule only when the goals and the arithmetic hold', () => {
    const rule = {
      kind: 'optimizer-run' as const,
      goals: [
        { response: 'Luminance (cd/m2)', goal: 'maximize' },
        { response: 'Uniformity (%)', goal: 'range' },
      ],
      minComposite: 0.3,
      statuses: ['global-optimal', 'local-converged', 'best-found'],
      consistent: true,
    };
    expect(validateStep(rule, facts()).status).toBe('pass');
    const wrongGoal = responseSettings.map((response) => (response.name === 'Uniformity (%)' ? { ...response, goal: 'maximize' as const } : response));
    const badFacts = facts({ events: [event('sample-loaded', { sampleId: 'display-optical-doe' }), event('optimizer-run', { result, responses: wrongGoal, factors: factorSettings })] });
    expect(validateStep(rule, badFacts).status).toBe('fail');
  });
});

/* ── engine ───────────────────────────────────────────────────────────── */

describe('tutorial engine', () => {
  const tutorial = findTutorial('tutorial-rsm-001')!;

  it('completes validated steps only from the workspace, never from storage alone', () => {
    const progress = createProgress(tutorial, 'practice-1');
    const loaded = facts({
      outputs: [],
      events: [event('sample-loaded', { sampleId: 'display-optical-doe' })],
    });
    const first = evaluateSession(tutorial, progress, loaded);
    expect(first.progress.steps['load-data'].status).toBe('COMPLETED');
    expect(first.progress.steps['explore'].status).not.toBe('COMPLETED');

    // The worksheet disappears: the completed step must not survive on its own.
    const gone = evaluateSession(tutorial, first.progress, facts({ worksheets: [], events: [] }));
    expect(gone.progress.steps['load-data'].status).not.toBe('COMPLETED');
  });

  it('marks a manual step only when the reader does, and keeps it out of validated counts', () => {
    const manual = findTutorial('tutorial-start-001')!;
    const progress = createProgress(manual, 'practice-start');
    const stepId = manual.steps[manual.steps.length - 1].id;
    expect(progress.steps[stepId].mode).toBe('manual');
    const done = markManualStep(manual, progress, stepId, true);
    expect(done.steps[stepId].status).toBe('COMPLETED');
    expect(done.steps[stepId].code).toBe('manual-done');
  });

  it('skips a step without counting it as verified and finishes when all are done or skipped', () => {
    let progress = createProgress(tutorial, 'practice-1');
    tutorial.steps.forEach((step) => { progress = skipStep(tutorial, progress, step.id); });
    expect(isTutorialComplete(tutorial, progress)).toBe(true);
    expect(progress.steps['load-data'].status).toBe('SKIPPED');
    expect(progress.status).toBe('completed');
  });

  it('keeps the current step while it is open and moves on when it completes', () => {
    const progress = createProgress(tutorial, 'practice-1');
    const evaluated = evaluateSession(tutorial, progress, facts({ events: [event('sample-loaded', { sampleId: 'display-optical-doe' })] }));
    expect(evaluated.progress.currentStepId).toBe('explore');
  });
});

/* ── figure layout helper used by the layout rule ─────────────────────── */

describe('layout artefacts', () => {
  it('counts chart panels and figure labels from a saved layout document', () => {
    const doc = {
      id: 'fig-1',
      page: { preset: 'a4-landscape', widthMm: 297, heightMm: 210, marginMm: 10 },
      panels: [
        { id: 'p1', kind: 'chart', x: 0, y: 0, w: 40, h: 40, chart: { kind: 'histogram', values: [1, 2, 3] } },
        { id: 'p2', kind: 'chart', x: 41, y: 0, w: 40, h: 40, chart: { kind: 'histogram', values: [3, 2, 1] } },
        { id: 'p3', kind: 'figure-label', x: 0, y: 50, w: 20, h: 5, text: 'Figure 1' },
      ],
    } as unknown as LayoutDoc;
    const outcome = validateStep({ kind: 'layout-export', minChartPanels: 2, requireFigureLabel: true, format: 'png' }, facts({
      figures: [doc],
      events: [event('layout-saved', { chartPanels: 2, figureLabels: 1 }), event('figure-exported', { format: 'png' })],
    }));
    expect(outcome.status).toBe('pass');
    const missingLabel = validateStep({ kind: 'layout-export', minChartPanels: 2, requireFigureLabel: true, format: 'png' }, facts({
      figures: [doc],
      events: [event('layout-saved', { chartPanels: 2, figureLabels: 0 }), event('figure-exported', { format: 'png' })],
    }));
    expect(missingLabel.status).toBe('fail');
  });
});

/* ── the summary numbers come from the engine, not from a key ─────────── */

describe('summary', () => {
  it('reports the optimiser’s own solution', () => {
    const tutorial = findTutorial('tutorial-rsm-001')!;
    const progress = createProgress(tutorial, 'practice-1');
    const evaluated = evaluateSession(tutorial, progress, facts());
    const solution = result.solutions[0];
    expect(solution).toBeTruthy();
    const predicted = predictStoredModel(models[0], solution.settings);
    expect(predicted.value).not.toBeNull();
    expect(closeTo(predicted.value as number, solution.responses[0].value as number)).toBe(true);
    expect(evaluated.progress.steps['optimize'].status).toBe('COMPLETED');
  });
});


/* ── progress storage (WO-T05) ─────────────────────────────────────────── */

function memoryStorage(): { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void } {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe('progress storage', () => {
  const tutorial = findTutorial('tutorial-start-001')!;

  it('saves and reloads a session record', () => {
    const store = new TutorialProgressStore(memoryStorage());
    const progress = createProgress(tutorial, 'practice-1');
    store.save({ ...progress, currentStepId: tutorial.steps[1].id });
    const loaded = store.load(tutorial.id);
    expect(loaded?.tutorialId).toBe(tutorial.id);
    expect(loaded?.currentStepId).toBe(tutorial.steps[1].id);
    expect(loaded?.sessionId).toBe(progress.sessionId);
  });

  it('treats a corrupted record as no record instead of guessing', () => {
    const storage = memoryStorage();
    storage.setItem('sigrun.tutorials.progress.v1', '{not json');
    const store = new TutorialProgressStore(storage);
    expect(store.loadAll()).toEqual({});
  });

  it('reports blocked storage instead of pretending to save', () => {
    const store = new TutorialProgressStore(null);
    const progress = createProgress(tutorial, 'practice-1');
    expect(() => store.save(progress)).toThrow(ProgressStorageError);
    expect(store.loadAll()).toEqual({});
  });

  it('keeps a practice project in its own slot', () => {
    const store = new TutorialProgressStore(memoryStorage());
    store.savePracticeProject({ tutorialId: tutorial.id, projectId: 'practice-9', savedAt: '2026-11-24T00:00:00.000Z', json: '{}' });
    expect(store.loadPracticeProject()?.projectId).toBe('practice-9');
    store.clearPracticeProject();
    expect(store.loadPracticeProject()).toBeNull();
  });
});
