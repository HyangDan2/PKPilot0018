/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — Guided Tutorial Corrective QA (T-01 ~ T-13), Red → Green evidence

   This file states what a tutorial must verify. Every assertion here fails on
   the pre-correction tree (66efb29) and passes after the corrections, using only
   the public API that already existed there: no import is the evidence.

     T-03  a worksheet with the sample's column names but not its data is refused
     T-04  a run on other columns, with other parameters, or with no result is refused
     T-05  four copies of one response do not complete a multi-response step
     T-06  a profiler without every factor, or without a saved condition, fails
     T-07  two practice projects are kept and resumed side by side
     T-08  a kept practice carries the evidence a resumed lesson is judged on
     T-09  a round trip that lists differences fails even when the counts agree
     T-10  ending by skipping is not the same as finishing the practice
     T-11  a blocked store does not lose the progress of this window
     T-12  every verdict states the project, session, worksheet and record ids
     T-13  the status bar reads its stage from the build, not a hard-coded name

   T-01 and T-02 are guarded in the browser (tools/probe_tutorial_guard.cjs),
   because "the original project is kept before the practice replaces it" and
   "settings come back" are states of the running app, not of a pure function.
   ───────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModelFactor } from '../src/lib/glm';
import { analyzeRsm, buildRsmModel } from '../src/lib/doe';
import { createStoredModel, draftFromRsmPayload, type StoredModel } from '../src/lib/modelStore';
import { defaultFactorSettings, defaultResponseSettings, optimize, suggestResponseLimits } from '../src/lib/optimizer';
import type { FactorSettings, OptimizerResult, ResponseSettings } from '../src/lib/optimizationTypes';
import type { Column, OutputDoc, Worksheet } from '../src/types';
import { buildDisplayOpticalDoE } from '../src/samples/datasets/displayOptical';
import { auditErrors } from '../src/tutorials/qa';
import { TUTORIALS, findTutorial } from '../src/tutorials/registry';
import { TutorialProgressStore, createProgress } from '../src/tutorials/progressStore';
import {
  evaluateSession,
  markManualStep,
  skipStep,
  tutorialSummary,
} from '../src/tutorials/tutorialEngine';
import { validateStep } from '../src/tutorials/validationRegistry';
import type { TutorialEvent, TutorialProgress, WorkspaceFacts } from '../src/tutorials/types';

const sampleSheet = buildDisplayOpticalDoE();
const factorColumns = ['LED Current (coded)', 'Optical Distance (coded)', 'Diffuser Haze (coded)'];
const responseNames = ['Luminance (cd/m2)', 'Power Consumption (W)', 'Uniformity (%)', 'Temperature (C)'];

const factors: ModelFactor[] = factorColumns.map((name) => {
  const column = sampleSheet.columns.find((candidate) => candidate.name === name)!;
  return { name, kind: 'numeric', values: column.values };
});

function buildModels(): StoredModel[] {
  return responseNames.map((name) => {
    const column = sampleSheet.columns.find((candidate) => candidate.name === name)!;
    const analysis = analyzeRsm(column.values as (number | null)[], factors);
    const payload = buildRsmModel(analysis.glm, factors, analysis.stationary);
    return createStoredModel(draftFromRsmPayload(payload, { response: { id: column.id, name }, sheet: sampleSheet, analysisId: 'rsmanalyze' }), name);
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

const practice = { id: 'practice-qa', mode: 'isolated' as const, tutorialId: 'tutorial-rsm-001', sampleIds: ['display-optical-doe'], sessionId: 'session-qa' };

let eventSequence = 0;
function event(type: TutorialEvent['type'], payload: Record<string, unknown>): TutorialEvent {
  eventSequence += 1;
  return { id: `ev-${eventSequence}`, type, at: Date.now() + eventSequence, payload };
}

function facts(overrides: Partial<WorkspaceFacts> = {}): WorkspaceFacts {
  return {
    worksheets: [sampleSheet],
    activeSheetId: sampleSheet.id,
    outputs: [],
    models,
    figures: [],
    events: [
      event('sample-loaded', { sampleId: 'display-optical-doe', sheetId: sampleSheet.id }),
      event('analysis-run', { analysisId: 'rsmanalyze' }),
      event('optimizer-run', { result, responses: responseSettings, factors: factorSettings }),
    ],
    practice,
    ...overrides,
  };
}

function tableOutput(id: string, analysisId: string, columns: Column[], values: Record<string, unknown> = {}): OutputDoc {
  return {
    id,
    titleKey: `an.${analysisId}`,
    createdAt: Date.now(),
    collapsed: false,
    blocks: [{ type: 'table', headers: ['Source', 'DF'], rows: [['Model', 9], ['Error', 10]] }],
    meta: {
      engine: 'test',
      analysisId,
      values,
      sheetId: sampleSheet.id,
      sheetName: sampleSheet.name,
      ranAt: Date.now(),
      rowCount: 20,
      columns,
    },
  };
}

/* ── T-03 ─────────────────────────────────────────────────────────────── */

describe('[T-03] a worksheet is the sample only when its data are the sample', () => {
  const rule = {
    kind: 'sample-loaded' as const,
    sampleId: 'display-optical-doe',
    columns: ['LED Current (coded)', 'Luminance (cd/m2)'],
  };

  it('refuses a worksheet that has the column names but different numbers', () => {
    const fake: Worksheet = {
      ...sampleSheet,
      id: 'fake-sample',
      columns: sampleSheet.columns.map((column) => ({
        ...column,
        values: column.values.map((value) => (typeof value === 'number' ? value + 1.5 : value)),
      })),
    };
    const outcome = validateStep(rule, facts({ worksheets: [fake], activeSheetId: fake.id }));
    expect(outcome.status).toBe('fail');
    expect(outcome.code).toBe('sample-values');
  });

  it('refuses a worksheet whose rows were cut down to the column names and a few rows', () => {
    const short: Worksheet = {
      ...sampleSheet,
      id: 'short-sample',
      columns: sampleSheet.columns.map((column) => ({ ...column, values: column.values.slice(0, 6) })),
    };
    const outcome = validateStep(rule, facts({ worksheets: [short], activeSheetId: short.id }));
    expect(outcome.status).toBe('fail');
    expect(outcome.code).toBe('sample-rows');
  });

  it('still accepts the real dataset', () => {
    expect(validateStep(rule, facts()).status).toBe('pass');
  });
});

/* ── T-04 ─────────────────────────────────────────────────────────────── */

describe('[T-04] an analysis result is judged on its inputs, parameters and answer', () => {
  const luminance = sampleSheet.columns.find((column) => column.name === 'Luminance (cd/m2)')!;
  const temperature = sampleSheet.columns.find((column) => column.name === 'Temperature (C)')!;
  const rule = {
    kind: 'analysis-output' as const,
    analysisId: 'desc',
    columns: ['Luminance (cd/m2)'],
    params: { lsl: 9.6 },
  };
  const good = tableOutput('o-good', 'desc', [luminance], { lsl: '9.6' });

  it('refuses a run on other columns', () => {
    const other = tableOutput('o-other', 'desc', [temperature], { lsl: '9.6' });
    const outcome = validateStep(rule, facts({ outputs: [other] }));
    expect(outcome.status).toBe('fail');
    expect(outcome.code).toBe('analysis-columns');
  });

  it('refuses a run that used a different parameter value', () => {
    const wrong = tableOutput('o-wrong', 'desc', [luminance], { lsl: '9.1' });
    const outcome = validateStep(rule, facts({ outputs: [wrong] }));
    expect(outcome.status).toBe('fail');
    expect(outcome.code).toBe('analysis-params');
  });

  it('refuses a card that carries no table or chart', () => {
    const empty = { ...good, id: 'o-empty', blocks: [] };
    const outcome = validateStep({ ...rule, params: {} }, facts({ outputs: [empty] }));
    expect(outcome.status).toBe('fail');
    expect(outcome.code).toBe('analysis-no-result');
  });

  it('accepts the run that matches the step', () => {
    expect(validateStep(rule, facts({ outputs: [good] })).status).toBe('pass');
  });
});

/* ── T-05 ─────────────────────────────────────────────────────────────── */

describe('[T-05] a multi-response step needs one model per response', () => {
  const rule = {
    kind: 'model-stored' as const,
    responses: responseNames,
    minCount: 4,
    minR2: 0.9,
    quadratic: true,
  };

  it('does not complete on four copies of the same response', () => {
    const duplicates = [0, 1, 2, 3].map((index) => ({ ...models[0], id: `dup-${index}`, name: `Luminance copy ${index}` }));
    const outcome = validateStep(rule, facts({ models: duplicates }));
    expect(outcome.status).not.toBe('pass');
    expect(outcome.code).toBe('model-count');
    expect(String(outcome.detail.en)).toContain('Power Consumption (W)');
  });

  it('completes when each response has its own model', () => {
    expect(validateStep(rule, facts()).status).toBe('pass');
  });
});

/* ── T-06 ─────────────────────────────────────────────────────────────── */

describe('[T-06] the profiler must carry its factors, its predictions and its save', () => {
  const rule = { kind: 'profiler-check' as const, atOptimizerPoint: true, consistent: true, requireSaved: true };

  it('fails when the profiler opened without every factor value', () => {
    const outcome = validateStep(rule, facts({ events: [
      event('sample-loaded', { sampleId: 'display-optical-doe' }),
      event('optimizer-run', { result, responses: responseSettings, factors: factorSettings, models: responseNames }),
      event('profiler-opened', { point: { 'LED Current (coded)': 0.2 } }),
    ] }));
    expect(outcome.status).toBe('fail');
    expect(['profiler-arguments-missing', 'profiler-arguments']).toContain(outcome.code);
  });

  it('fails when the condition was opened but never saved', () => {
    const settings = (result.solutions[0].settings ?? {}) as Record<string, number>;
    const outcome = validateStep(rule, facts({ events: [
      event('sample-loaded', { sampleId: 'display-optical-doe' }),
      event('optimizer-run', { result, responses: responseSettings, factors: factorSettings, models: responseNames }),
      event('profiler-opened', { point: { ...settings }, models: responseNames }),
    ] }));
    expect(outcome.status).toBe('fail');
    expect(outcome.code).toBe('profiler-not-saved');
  });
});

/* ── T-07 / T-08 ──────────────────────────────────────────────────────── */

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

describe('[T-07] practice projects are kept per tutorial and session', () => {
  it('keeps two practices and resumes each one', () => {
    const store = new TutorialProgressStore(new MemoryStorage());
    store.savePracticeProject({ tutorialId: 'tutorial-a', projectId: 'practice-a', savedAt: '2026-11-25T01:00:00.000Z', json: '{"a":1}', sessionId: 'session-a' });
    store.savePracticeProject({ tutorialId: 'tutorial-b', projectId: 'practice-b', savedAt: '2026-11-25T02:00:00.000Z', json: '{"b":1}', sessionId: 'session-b' });
    const a = store.loadPracticeProject('tutorial-a');
    const b = store.loadPracticeProject('tutorial-b');
    expect(a?.projectId).toBe('practice-a');
    expect(b?.projectId).toBe('practice-b');
    expect(store.listPracticeSlots()).toHaveLength(2);
  });

  it('removes only the practice that was discarded', () => {
    const store = new TutorialProgressStore(new MemoryStorage());
    store.savePracticeProject({ tutorialId: 'tutorial-a', projectId: 'practice-a', savedAt: '2026-11-25T01:00:00.000Z', json: '{"a":1}', sessionId: 'session-a' });
    store.savePracticeProject({ tutorialId: 'tutorial-b', projectId: 'practice-b', savedAt: '2026-11-25T02:00:00.000Z', json: '{"b":1}', sessionId: 'session-b' });
    store.removePracticeSlot('tutorial-a::session-a');
    expect(store.loadPracticeProject('tutorial-a')).toBeNull();
    expect(store.loadPracticeProject('tutorial-b')?.projectId).toBe('practice-b');
  });
});

describe('[T-08] a kept practice carries the evidence a resumed lesson is judged on', () => {
  it('stores and returns the events and the progress beside the project', () => {
    const store = new TutorialProgressStore(new MemoryStorage());
    const tutorial = findTutorial('tutorial-rsm-001')!;
    const progress = createProgress(tutorial, 'practice-a');
    const evidence = [event('sample-loaded', { sampleId: 'display-optical-doe' }), event('analysis-run', { analysisId: 'rsmanalyze' })];
    store.savePracticeProject({
      tutorialId: tutorial.id,
      sessionId: progress.sessionId,
      projectId: 'practice-a',
      savedAt: '2026-11-25T01:00:00.000Z',
      json: '{"a":1}',
      events: evidence,
      progress,
    });
    const slot = store.loadPracticeProject(tutorial.id);
    expect(slot?.events.map((entry) => entry.type)).toEqual(['sample-loaded', 'analysis-run']);
    expect(slot?.progress?.sessionId).toBe(progress.sessionId);
  });
});

/* ── T-09 ─────────────────────────────────────────────────────────────── */

describe('[T-09] the project round trip is compared, not counted', () => {
  it('fails when the read-back differs even though the counts agree', () => {
    const rule = { kind: 'project-saved' as const, roundtrip: true };
    const mismatch = { kind: 'model-coefficients', where: 'model[0]', detail: 'The terms or coefficients of the model differ.' };
    const outcome = validateStep(rule, facts({ events: [
      event('project-saved', { roundtripOk: true, worksheets: 1, outputs: 0, models: 4, mismatches: [mismatch] }),
    ] }));
    expect(outcome.status).toBe('fail');
    expect(outcome.code).toBe('project-roundtrip');
  });

  it('passes only when the comparison found nothing', () => {
    const rule = { kind: 'project-saved' as const, roundtrip: true };
    expect(validateStep(rule, facts({ events: [
      event('project-saved', { roundtripOk: true, worksheets: 1, outputs: 0, models: 4, mismatches: [] }),
    ] })).status).toBe('pass');
  });
});

/* ── T-10 ─────────────────────────────────────────────────────────────── */

function progressWith(tutorialId: string, mode: 'skip-all' | 'all-done'): TutorialProgress {
  const tutorial = findTutorial(tutorialId)!;
  let progress = createProgress(tutorial, 'practice-qa');
  tutorial.steps.forEach((step) => {
    if (mode === 'skip-all') progress = skipStep(tutorial, progress, step.id);
    else if (step.completion === 'manual') progress = markManualStep(tutorial, progress, step.id, true);
    else progress = { ...progress, steps: { ...progress.steps, [step.id]: { status: 'COMPLETED', mode: step.completion } } };
  });
  return progress;
}

describe('[T-10] ending by skipping is reported as its own outcome', () => {
  it('calls a skipped-through lesson skipped, not completed practice', () => {
    const tutorial = findTutorial('tutorial-rsm-001')!;
    const summary = tutorialSummary(tutorial, progressWith('tutorial-rsm-001', 'skip-all'), facts());
    expect(summary.completion).toBe('skipped');
  });

  it('calls a machine-verified lesson verified and a self-checked one manual', () => {
    const flagship = findTutorial('tutorial-rsm-001')!;
    expect(tutorialSummary(flagship, progressWith('tutorial-rsm-001', 'all-done'), facts()).completion).toBe('verified');
    const started = findTutorial('tutorial-start-001')!;
    expect(tutorialSummary(started, progressWith('tutorial-start-001', 'all-done'), facts()).completion).toBe('manual');
  });
});

/* ── T-11 ─────────────────────────────────────────────────────────────── */

describe('[T-11] a blocked store does not lose this window’s progress', () => {
  it('keeps the record readable after the write is refused', () => {
    const refusing = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError: storage is full'); },
      removeItem: () => undefined,
    };
    const store = new TutorialProgressStore(refusing);
    const tutorial = findTutorial('tutorial-rsm-001')!;
    const progress = createProgress(tutorial, 'practice-qa');
    expect(() => store.save(progress)).toThrow();
    const kept = store.load(tutorial.id);
    expect(kept?.practiceProjectId).toBe('practice-qa');
    expect(kept?.sessionId).toBe(progress.sessionId);
  });

  it('keeps the progress moving while the practice continues', () => {
    const refusing = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => undefined,
    };
    const store = new TutorialProgressStore(refusing);
    const tutorial = findTutorial('tutorial-start-001')!;
    const progress = createProgress(tutorial, 'practice-qa');
    try { store.save(progress); } catch { /* the window keeps it */ }
    const stepped = evaluateSession(tutorial, progress, facts()).progress;
    try { store.save(stepped); } catch { /* the window keeps it */ }
    expect(store.load(tutorial.id)?.updatedAt).toBeTruthy();
  });
});

/* ── T-12 ─────────────────────────────────────────────────────────────── */

describe('[T-12] every verdict names what it judged', () => {
  it('states the project, session, worksheet and record ids', () => {
    const output = tableOutput('o-1', 'rsmanalyze', [sampleSheet.columns[0]]);
    const outcome = validateStep({ kind: 'analysis-output', analysisId: 'rsmanalyze' }, facts({ outputs: [output] }));
    expect(outcome.status).toBe('pass');
    expect(outcome.evidence?.projectId).toBe('practice-qa');
    expect(outcome.evidence?.sessionId).toBe('session-qa');
    expect(outcome.evidence?.worksheetId).toBe(sampleSheet.id);
    expect(outcome.evidence?.outputIds).toContain('o-1');
    expect(Array.isArray(outcome.evidence?.modelIds)).toBe(true);
    expect((outcome.evidence?.modelIds as string[]).length).toBe(models.length);
  });

  it('reports a model verdict with the ids of the models it counted', () => {
    const outcome = validateStep({ kind: 'model-stored', responses: responseNames, minCount: 4 }, facts());
    expect(outcome.status).toBe('pass');
    expect((outcome.evidence?.modelIds as string[]).sort()).toEqual(models.map((model) => model.id).sort());
  });
});

/* ── T-13 ─────────────────────────────────────────────────────────────── */

describe('[T-13] the status bar states the build’s stage', () => {
  it('does not hard-code an earlier phase in the application shell', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(source.includes('PHASE 1')).toBe(false);
    expect(source).toContain('statusBarLabel()');
  });
});

/* ── whole registry regression (required check 11) ────────────────────── */

describe('tutorial registry still audits clean after the corrections', () => {
  it('has no registry errors and thirteen tutorials', () => {
    expect(auditErrors()).toEqual([]);
    expect(TUTORIALS).toHaveLength(13);
  });
});
