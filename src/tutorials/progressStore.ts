/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — tutorial progress storage (WO-T05)

   Progress is small JSON kept in localStorage. What is stored is what the
   reader can lose: if storage is blocked (a file:// build in a restricted
   browser) the store reports it instead of pretending to save, and the panel
   offers the project file as the fallback. A saved practice project travels in
   its own slot so "keep for later" survives a reload.
   ───────────────────────────────────────────────────────────────────────── */

import type { Tutorial } from './types';
import type { ProgressStoreLike, TutorialProgress, StepProgress } from './types';

export const TUTORIAL_PROGRESS_KEY = 'sigrun.tutorials.progress.v1';
export const TUTORIAL_PRACTICE_KEY = 'sigrun.tutorials.practice.v1';

export class ProgressStorageError extends Error {
  constructor(readonly code: 'unavailable' | 'corrupt' | 'quota', message: string) {
    super(message);
    this.name = 'ProgressStorageError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

let sequence = 0;

export function newSessionId(prefix = 'tut'): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function emptySteps(tutorial: Tutorial): Record<string, StepProgress> {
  const steps: Record<string, StepProgress> = {};
  tutorial.steps.forEach((step) => {
    steps[step.id] = {
      status: 'NOT_STARTED',
      mode: step.completion,
      updatedAt: Date.now(),
    };
  });
  return steps;
}

export function createProgress(tutorial: Tutorial, practiceProjectId: string | null): TutorialProgress {
  const startedAt = nowIso();
  return {
    schemaVersion: 1,
    tutorialId: tutorial.id,
    tutorialVersion: tutorial.version,
    sessionId: newSessionId(),
    practiceProjectId,
    currentStepId: tutorial.steps[0]?.id ?? '',
    steps: emptySteps(tutorial),
    startedAt,
    updatedAt: startedAt,
    status: 'in-progress',
  };
}

function sanitise(record: unknown): TutorialProgress | null {
  if (!record || typeof record !== 'object') return null;
  const candidate = record as Partial<TutorialProgress>;
  if (candidate.schemaVersion !== 1 || typeof candidate.tutorialId !== 'string' || typeof candidate.steps !== 'object' || !candidate.steps) return null;
  if (typeof candidate.startedAt !== 'string' || typeof candidate.updatedAt !== 'string') return null;
  return {
    schemaVersion: 1,
    tutorialId: candidate.tutorialId,
    tutorialVersion: Number(candidate.tutorialVersion) || 1,
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : newSessionId(),
    practiceProjectId: typeof candidate.practiceProjectId === 'string' ? candidate.practiceProjectId : null,
    currentStepId: typeof candidate.currentStepId === 'string' ? candidate.currentStepId : '',
    steps: candidate.steps as Record<string, StepProgress>,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    status: candidate.status === 'completed' ? 'completed' : 'in-progress',
  };
}

export class TutorialProgressStore {
  constructor(private readonly storage: ProgressStoreLike | null) {}

  private require(): ProgressStoreLike {
    if (!this.storage) {
      throw new ProgressStorageError('unavailable', 'Browser storage is not available; progress cannot be saved.');
    }
    return this.storage;
  }

  loadAll(): Record<string, TutorialProgress> {
    if (!this.storage) return {};
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(TUTORIAL_PROGRESS_KEY);
    } catch {
      return {};
    }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as { sessions?: Record<string, TutorialProgress> };
      const sessions = parsed?.sessions ?? {};
      const output: Record<string, TutorialProgress> = {};
      Object.entries(sessions).forEach(([tutorialId, record]) => {
        const clean = sanitise(record);
        if (clean && clean.tutorialId === tutorialId) output[tutorialId] = clean;
      });
      return output;
    } catch {
      // A corrupted record is not repaired by guessing: the reader restarts.
      return {};
    }
  }

  load(tutorialId: string): TutorialProgress | null {
    return this.loadAll()[tutorialId] ?? null;
  }

  save(progress: TutorialProgress): void {
    const storage = this.require();
    const all = this.loadAll();
    all[progress.tutorialId] = { ...progress, updatedAt: nowIso() };
    try {
      storage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ version: 1, sessions: all }));
    } catch (error) {
      const quota = error instanceof Error && /quota/i.test(error.message);
      throw new ProgressStorageError(quota ? 'quota' : 'unavailable', error instanceof Error ? error.message : 'storage failed');
    }
  }

  remove(tutorialId: string): void {
    if (!this.storage) return;
    const all = this.loadAll();
    delete all[tutorialId];
    try {
      this.storage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ version: 1, sessions: all }));
    } catch {
      /* a failed removal leaves the old record; the reader can restart anyway */
    }
  }

  clear(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(TUTORIAL_PROGRESS_KEY);
    } catch {
      /* ignore */
    }
  }

  savePracticeProject(project: { tutorialId: string; projectId: string; savedAt: string; json: string }): void {
    const storage = this.require();
    try {
      storage.setItem(TUTORIAL_PRACTICE_KEY, JSON.stringify(project));
    } catch (error) {
      throw new ProgressStorageError('quota', error instanceof Error ? error.message : 'storage failed');
    }
  }

  loadPracticeProject(): { tutorialId: string; projectId: string; savedAt: string; json: string } | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(TUTORIAL_PRACTICE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { tutorialId?: string; projectId?: string; savedAt?: string; json?: string };
      if (!parsed?.json || !parsed.tutorialId) return null;
      return {
        tutorialId: parsed.tutorialId,
        projectId: parsed.projectId ?? '',
        savedAt: parsed.savedAt ?? '',
        json: parsed.json,
      };
    } catch {
      return null;
    }
  }

  clearPracticeProject(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(TUTORIAL_PRACTICE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** The browser store, or null when storage is blocked. */
export function browserProgressStorage(): ProgressStoreLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__sigrun_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}
