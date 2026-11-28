/* ─────────────────────────────────────────────────────────────────────────
   Statelia — Tutorial session guard and project comparison (WO-TQA-01/02/07/09/10/13)

   These tests exercise the pieces the corrective pass added: the record-by-record
   project comparison, the guarded copy of the reader's own project, the practice
   slots that keep two lessons side by side, and the completion kinds. They are
   unit tests of the modules themselves; tests/tutorial-corrective-qa.test.ts is
   the Red → Green evidence file written against the pre-existing API.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import type { OutputDoc, Settings, Worksheet } from '../src/types';
import type { StoredModel } from '../src/lib/modelStore';
import { compareProjects, projectFingerprint } from '../src/lib/projectCompare';
import { APP_PHASE, statusBarLabel } from '../src/lib/appInfo';
import { createStoredModel, draftFromRsmPayload } from '../src/lib/modelStore';
import { analyzeRsm, buildRsmModel } from '../src/lib/doe';
import type { ModelFactor } from '../src/lib/glm';
import { buildDisplayOpticalDoE } from '../src/samples/datasets/displayOptical';
import { TutorialProgressStore, createProgress, practiceSlotId } from '../src/tutorials/progressStore';
import { completionKind, skipStep, markManualStep, tutorialSummary } from '../src/tutorials/tutorialEngine';
import { findTutorial } from '../src/tutorials/registry';
import { sampleSignature, validateStep } from '../src/tutorials/validationRegistry';
import type { PracticeSlot, TutorialProgress, WorkspaceFacts } from '../src/tutorials/types';

const sheet = buildDisplayOpticalDoE();
const factorNames = ['LED Current (coded)', 'Optical Distance (coded)', 'Diffuser Haze (coded)'];
const factors: ModelFactor[] = factorNames.map((name) => {
  const column = sheet.columns.find((candidate) => candidate.name === name)!;
  return { name, kind: 'numeric', values: column.values };
});

function modelFor(response: string): StoredModel {
  const column = sheet.columns.find((candidate) => candidate.name === response)!;
  const analysis = analyzeRsm(column.values as (number | null)[], factors);
  const payload = buildRsmModel(analysis.glm, factors, analysis.stationary);
  return createStoredModel(draftFromRsmPayload(payload, { response: { id: column.id, name: response }, sheet, analysisId: 'rsmanalyze' }), response);
}

const models = ['Luminance (cd/m2)', 'Power Consumption (W)'].map(modelFor);
const settings: Settings = { theme: 'light', lang: 'en' };

function output(id: string): OutputDoc {
  return {
    id,
    titleKey: 'an.desc',
    createdAt: 1,
    collapsed: false,
    blocks: [{ type: 'table', headers: ['Mean', 'SD'], rows: [[1.5, 0.2]] }],
    meta: { engine: 'test', analysisId: 'desc', values: {}, sheetId: sheet.id, sheetName: sheet.name, ranAt: 1, rowCount: 20, columns: sheet.columns.slice(0, 2) },
  };
}

const figure = { id: 'figure-1', title: 'Figure 1', width: 800, height: 600, panels: [] } as never;

function project() {
  return {
    worksheets: [sheet],
    activeSheetId: sheet.id,
    settings,
    outputs: [output('o-1')],
    models,
    figures: [figure],
    customChartStyles: [{ id: 'style-1' }],
  };
}

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (value.length > 60_000) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void { this.data.delete(key); }
}

/* ── project comparison (T-09) ────────────────────────────────────────── */

describe('project round trip comparison', () => {
  it('calls an identical project identical', () => {
    const comparison = compareProjects(project(), project());
    expect(comparison.ok).toBe(true);
    expect(comparison.mismatches).toEqual([]);
    expect(comparison.counts.cells).toBeGreaterThan(0);
  });

  it('names a changed cell', () => {
    const restored = project();
    const edited: Worksheet = {
      ...sheet,
      columns: sheet.columns.map((column, index) => (index === 0
        ? { ...column, values: [999999, ...column.values.slice(1)] }
        : column)),
    };
    const comparison = compareProjects(project(), { ...restored, worksheets: [edited] });
    expect(comparison.ok).toBe(false);
    expect(comparison.mismatches[0].kind).toBe('worksheet-data');
    expect(comparison.mismatches[0].where).toContain(sheet.columns[0].name);
  });

  it('names a changed model coefficient even when every count agrees', () => {
    const tampered = models.map((model, index) => (index === 0
      ? { ...model, coefficients: model.coefficients.map((coefficient, position) => (position === 0 ? { ...coefficient, value: coefficient.value + 0.5 } : coefficient)) }
      : model));
    const comparison = compareProjects(project(), { ...project(), models: tampered });
    expect(comparison.ok).toBe(false);
    expect(comparison.mismatches.some((mismatch) => mismatch.kind === 'model-coefficients')).toBe(true);
  });

  it('names a changed output block, chart and settings', () => {
    const changedOutput = { ...output('o-1'), blocks: [{ type: 'table' as const, headers: ['Mean'], rows: [[1.5]] }] };
    const outputComparison = compareProjects(project(), { ...project(), outputs: [changedOutput] });
    expect(outputComparison.mismatches.some((mismatch) => mismatch.kind === 'output-blocks')).toBe(true);

    const chartOutput = {
      ...output('o-2'),
      blocks: [{ type: 'chart' as const, chart: { kind: 'histogram' as const, bins: [], xLabel: 'x', yLabel: 'y' } }] as never,
    };
    const chartComparison = compareProjects(project(), { ...project(), outputs: [{ ...output('o-1'), blocks: chartOutput.blocks }] });
    expect(chartComparison.mismatches.some((mismatch) => mismatch.kind === 'charts')).toBe(true);

    const settingsComparison = compareProjects(project(), { ...project(), settings: { theme: 'dark', lang: 'ko' } });
    expect(settingsComparison.mismatches.some((mismatch) => mismatch.kind === 'settings')).toBe(true);
  });

  it('names a missing figure and a missing output', () => {
    const comparison = compareProjects(project(), { ...project(), figures: [], outputs: [] });
    expect(comparison.mismatches.map((mismatch) => mismatch.kind)).toEqual(expect.arrayContaining(['figures', 'outputs']));
  });

  it('gives the same fingerprint to the same project and another to a changed one', () => {
    expect(projectFingerprint(project())).toBe(projectFingerprint(project()));
    const changed = projectFingerprint({ ...project(), settings: { theme: 'dark', lang: 'en' } });
    expect(changed).not.toBe(projectFingerprint(project()));
  });
});

/* ── the guarded original project (T-01) ──────────────────────────────── */

describe('the reader’s own project is guarded before a practice', () => {
  it('stores the file and reads back the same text and fingerprint', () => {
    const store = new TutorialProgressStore(new MemoryStorage());
    const json = JSON.stringify(project());
    const fingerprint = projectFingerprint(project());
    expect(store.saveOriginalProject({ projectId: 'original-1', tutorialId: 'tutorial-rsm-001', sessionId: 'session-1', json, fingerprint }).ok).toBe(true);
    const slot = store.loadOriginalProject('original-1');
    expect(slot?.json).toBe(json);
    expect(slot?.fingerprint).toBe(fingerprint);
    expect(slot?.sessionId).toBe('session-1');
  });

  it('reports a refused store instead of pretending it saved', () => {
    const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => undefined };
    const store = new TutorialProgressStore(refusing);
    const result = store.saveOriginalProject({ projectId: 'original-1', json: '{}', fingerprint: 'x' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('quota');
    expect(store.loadOriginalProject('original-1')).toBeNull();
  });

  it('keeps the newest original and drops it only when asked', () => {
    const store = new TutorialProgressStore(new MemoryStorage());
    store.saveOriginalProject({ projectId: 'original-1', savedAt: '2026-11-25T01:00:00.000Z', json: '{"a":1}', fingerprint: 'a' });
    store.saveOriginalProject({ projectId: 'original-2', savedAt: '2026-11-25T02:00:00.000Z', json: '{"b":1}', fingerprint: 'b' });
    expect(store.latestOriginalProject()?.projectId).toBe('original-2');
    store.removeOriginalProject('original-2');
    expect(store.latestOriginalProject()?.projectId).toBe('original-1');
    expect(store.listOriginalProjects()).toHaveLength(1);
  });
});

/* ── practice slots (T-07 / T-08) ─────────────────────────────────────── */

describe('practice slots are separated by tutorial and session', () => {
  const slot = (tutorialId: string, sessionId: string, savedAt: string): PracticeSlot => ({
    slotId: practiceSlotId(tutorialId, sessionId),
    tutorialId,
    tutorialVersion: 1,
    sessionId,
    projectId: `project-${sessionId}`,
    savedAt,
    json: `{"tutorial":"${tutorialId}"}`,
    events: [],
    progress: null,
    originalProjectId: null,
  });

  it('loads the session asked for, not only the newest one', () => {
    const store = new TutorialProgressStore(new MemoryStorage());
    store.savePracticeSlot(slot('tutorial-a', 'session-1', '2026-11-25T01:00:00.000Z'));
    store.savePracticeSlot(slot('tutorial-a', 'session-2', '2026-11-25T02:00:00.000Z'));
    expect(store.loadPracticeSlot('tutorial-a', 'session-1')?.projectId).toBe('project-session-1');
    expect(store.loadPracticeSlot('tutorial-a', 'session-2')?.projectId).toBe('project-session-2');
    expect(store.listPracticeSlots()).toHaveLength(2);
  });

  it('keeps the evidence and the progress with the project', () => {
    const store = new TutorialProgressStore(new MemoryStorage());
    const tutorial = findTutorial('tutorial-rsm-001')!;
    const progress = createProgress(tutorial, 'project-session-1');
    store.savePracticeSlot({
      ...slot(tutorial.id, progress.sessionId, '2026-11-25T01:00:00.000Z'),
      events: [{ id: 'e1', type: 'sample-loaded', at: 1, payload: { sampleId: 'display-optical-doe' } }],
      progress,
      originalProjectId: 'original-1',
    });
    const loaded = store.loadPracticeSlot(tutorial.id, progress.sessionId);
    expect(loaded?.events).toHaveLength(1);
    expect(loaded?.progress?.sessionId).toBe(progress.sessionId);
    expect(loaded?.originalProjectId).toBe('original-1');
  });

  it('survives a quota that only trips on the third project', () => {
    const store = new TutorialProgressStore(new MemoryStorage());
    const results = ['a', 'b', 'c'].map((id, index) => store.savePracticeSlot({ ...slot(`tutorial-${id}`, `session-${id}`, `2026-11-25T0${index}:00:00.000Z`), json: 'x'.repeat(40_000) }));
    const saved = results.filter((result) => result.ok).length;
    expect(store.listPracticeSlots()).toHaveLength(saved);
    expect(results.filter((result) => !result.ok).every((result) => result.code === 'quota')).toBe(true);
  });
});

/* ── completion kinds (T-10) ──────────────────────────────────────────── */

describe('completion kinds keep a skipped ending apart', () => {
  const tutorial = findTutorial('tutorial-rsm-001')!;

  function run(mode: 'skip' | 'mostly' | 'done'): TutorialProgress {
    let progress = createProgress(tutorial, 'practice-1');
    if (mode === 'skip') {
      tutorial.steps.forEach((step) => { progress = skipStep(tutorial, progress, step.id); });
      return progress;
    }
    tutorial.steps.forEach((step, index) => {
      if (mode === 'mostly' && index === 3) return;
      progress = { ...progress, steps: { ...progress.steps, [step.id]: { status: 'COMPLETED', mode: step.completion } } };
    });
    return progress;
  }

  it('reads a skipped-through lesson as skipped', () => {
    expect(completionKind(tutorial, run('skip'))).toBe('skipped');
    expect(tutorialSummary(tutorial, run('skip'), factsFor([])).completion).toBe('skipped');
  });

  it('reads an unfinished lesson as unfinished', () => {
    expect(completionKind(tutorial, run('mostly'))).toBe('unfinished');
  });

  it('reads a fully verified lesson as verified', () => {
    expect(completionKind(tutorial, run('done'))).toBe('verified');
  });

  it('reads a lesson finished with self-checks as manual', () => {
    const started = findTutorial('tutorial-start-001')!;
    let progress = createProgress(started, 'practice-2');
    started.steps.forEach((step) => {
      progress = step.completion === 'manual'
        ? markManualStep(started, progress, step.id, true)
        : { ...progress, steps: { ...progress.steps, [step.id]: { status: 'COMPLETED', mode: step.completion } } };
    });
    expect(completionKind(started, progress)).toBe('manual');
  });
});

function factsFor(events: WorkspaceFacts['events']): WorkspaceFacts {
  return { worksheets: [sheet], activeSheetId: sheet.id, outputs: [], models, figures: [], events, practice: { id: 'practice-1', mode: 'isolated', tutorialId: tutorialIdOf(), sampleIds: ['display-optical-doe'], sessionId: 'session-1' } };
}

function tutorialIdOf(): string {
  return 'tutorial-rsm-001';
}

/* ── the build line (T-13) ────────────────────────────────────────────── */

describe('the status bar states the build’s own stage', () => {
  it('reads the stage from the build instead of naming one', () => {
    expect(statusBarLabel()).toBe(`HD2LAB · STATELIA · ${APP_PHASE.toUpperCase()}`);
    expect(statusBarLabel()).not.toContain('PHASE 1');
  });
});

/* ── sample identity (T-03) ───────────────────────────────────────────── */

describe('sample identity comes from the bundled dataset', () => {
  it('knows the sample’s row count and columns', () => {
    const signature = sampleSignature('display-optical-doe');
    expect(signature?.rows).toBe(20);
    expect(signature?.columns.map((column) => column.name)).toContain('Luminance (cd/m2)');
    expect(sampleSignature('not-a-sample')).toBeNull();
  });

  it('refuses a worksheet that only names the sample', () => {
    const fake: Worksheet = {
      ...sheet,
      columns: sheet.columns.map((column) => ({
        ...column,
        type: 'text' as const,
        values: column.values.map(() => 'x'),
      })),
    };
    const facts = factsFor([{ id: 'e1', type: 'sample-loaded', at: 1, payload: { sampleId: 'display-optical-doe' } }]);
    const outcome = validateStep({ kind: 'sample-loaded', sampleId: 'display-optical-doe', columns: [] }, { ...facts, worksheets: [fake], activeSheetId: fake.id });
    expect(outcome.status).toBe('fail');
    expect(['sample-values', 'sample-rows']).toContain(outcome.code);
  });
});
