/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — tutorial force exit and recovery (WO-3F-01)

   The state machine is tested on its own, then the two data guarantees it
   protects: a forced exit removes only that session's record (never another
   session's, never a completion), and a stored backup can still be reached
   after the session is gone.
   ───────────────────────────────────────────────────────────────────────── */

import { describe, expect, it } from 'vitest';
import {
  SESSION_CLEANUP,
  canForceExit,
  exitPlan,
  isSessionEvaluating,
  isSessionLive,
  nextPhase,
  sessionStillActive,
  type TutorialPhase,
} from '../src/tutorials/sessionMachine';
import { TutorialProgressStore, createProgress, newSessionId } from '../src/tutorials/progressStore';
import { TUTORIALS } from '../src/tutorials/registry';
import { isTutorialComplete } from '../src/tutorials/tutorialEngine';
import { originalBackupWins } from '../src/lib/restorePolicy';

class MemoryStorage {
  data = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void { this.data.delete(key); }
}

const tutorial = TUTORIALS[0];

describe('tutorial session state machine', () => {
  it('runs the normal lifecycle', () => {
    let phase: TutorialPhase = 'IDLE';
    phase = nextPhase(phase, { type: 'START' });
    expect(phase).toBe('STARTING');
    phase = nextPhase(phase, { type: 'STARTED' });
    expect(phase).toBe('ACTIVE');
    expect(isSessionLive(phase)).toBe(true);
    expect(isSessionEvaluating(phase)).toBe(true);
    phase = nextPhase(phase, { type: 'EXIT' });
    expect(phase).toBe('EXITING');
    expect(isSessionEvaluating(phase)).toBe(false);
    phase = nextPhase(phase, { type: 'EXITED' });
    expect(phase).toBe('IDLE');
    expect(isSessionLive(phase)).toBe(false);
  });

  it('pauses and resumes only from the matching state', () => {
    expect(nextPhase('ACTIVE', { type: 'PAUSE' })).toBe('PAUSED');
    expect(nextPhase('PAUSED', { type: 'RESUME' })).toBe('ACTIVE');
    expect(nextPhase('IDLE', { type: 'PAUSE' })).toBe('IDLE');
    expect(nextPhase('STARTING', { type: 'RESUME' })).toBe('STARTING');
    expect(isSessionEvaluating('PAUSED')).toBe(false);
  });

  it('accepts an exit from every live state, including starting and recovery', () => {
    (['STARTING', 'ACTIVE', 'PAUSED', 'RECOVERY_REQUIRED'] as TutorialPhase[]).forEach((phase) => {
      expect(canForceExit(phase)).toBe(true);
      expect(nextPhase(phase, { type: 'EXIT', force: true })).toBe('EXITING');
    });
    expect(canForceExit('IDLE')).toBe(false);
    expect(canForceExit('EXITING')).toBe(false);
  });

  it('is idempotent while exiting', () => {
    expect(nextPhase('EXITING', { type: 'EXIT', force: true })).toBe('EXITING');
    expect(nextPhase('EXITING', { type: 'EXIT' })).toBe('EXITING');
    expect(nextPhase('IDLE', { type: 'EXIT' })).toBe('IDLE');
    expect(nextPhase('IDLE', { type: 'EXITED' })).toBe('IDLE');
  });

  it('abandons a pending start without touching an older session', () => {
    expect(nextPhase('STARTING', { type: 'ABORT_START' })).toBe('IDLE');
    expect(nextPhase('ACTIVE', { type: 'ABORT_START' })).toBe('ACTIVE');
  });

  it('enters recovery only from an exit and leaves it only by recovering', () => {
    expect(nextPhase('EXITING', { type: 'RESTORE_FAILED' })).toBe('RECOVERY_REQUIRED');
    expect(nextPhase('ACTIVE', { type: 'RESTORE_FAILED' })).toBe('ACTIVE');
    expect(nextPhase('RECOVERY_REQUIRED', { type: 'RECOVERED' })).toBe('IDLE');
    expect(nextPhase('ACTIVE', { type: 'RECOVERED' })).toBe('ACTIVE');
  });
});

describe('tutorial exit plan', () => {
  it('restores the original for an isolated practice and keeps the reader’s data for a current-project practice', () => {
    expect(exitPlan('isolated')).toEqual({
      restoreOriginal: true, keepCurrentData: false, removeSessionProgress: true, countsAsCompletion: false,
    });
    expect(exitPlan('current')).toEqual({
      restoreOriginal: false, keepCurrentData: true, removeSessionProgress: true, countsAsCompletion: false,
    });
  });

  it('never counts an exit as completion, even with no practice', () => {
    expect(exitPlan(null).countsAsCompletion).toBe(false);
    expect(exitPlan('isolated').countsAsCompletion).toBe(false);
    expect(exitPlan('current').countsAsCompletion).toBe(false);
  });

  it('names every piece of state an exit must clear', () => {
    expect([...SESSION_CLEANUP]).toEqual([
      'activeSession', 'events', 'actionQueue', 'validationState', 'overlay',
      'highlightFocusLock', 'tutorialModals', 'timers', 'asyncResults',
    ]);
  });
});

describe('async results belong to one generation', () => {
  it('ignores a result once the session was exited', () => {
    const token = { sessionId: 'tut-1', generation: 1 };
    expect(sessionStillActive(token, { sessionId: 'tut-1', generation: 1 })).toBe(true);
    // Force exit bumps the generation even though the id is unchanged.
    expect(sessionStillActive(token, { sessionId: 'tut-1', generation: 2 })).toBe(false);
    expect(sessionStillActive(token, { sessionId: 'tut-2', generation: 1 })).toBe(false);
    expect(sessionStillActive(null, token)).toBe(false);
  });
});

describe('forced exit and stored progress', () => {
  it('removes only the exited session’s record, never another session of the lesson', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore(storage);
    const first = createProgress(tutorial, 'practice-a');
    const second = { ...createProgress(tutorial, 'practice-b'), sessionId: newSessionId('other') };
    store.save(first);
    store.save(second);

    store.removeSession(tutorial.id, first.sessionId);

    expect(store.loadSession(tutorial.id, first.sessionId)).toBeNull();
    const survivor = store.loadSession(tutorial.id, second.sessionId);
    expect(survivor?.sessionId).toBe(second.sessionId);
    // The lesson's newest record is the surviving session, not the exited one.
    expect(store.loadAll()[tutorial.id]?.sessionId).toBe(second.sessionId);
  });

  it('drops the record from memory even when storage refuses the write', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore(storage);
    const progress = createProgress(tutorial, 'practice-c');
    store.save(progress);
    storage.failWrites = true;

    store.removeSession(tutorial.id, progress.sessionId);

    expect(store.loadSession(tutorial.id, progress.sessionId)).toBeNull();
  });

  it('a completed record is not what a forced exit leaves behind', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore(storage);
    const progress = createProgress(tutorial, 'practice-d');
    const completed = {
      ...progress,
      status: 'completed' as const,
      steps: Object.fromEntries(tutorial.steps.map((step) => [step.id, { status: 'COMPLETED' as const, mode: step.completion }])),
    };
    store.save(completed);
    expect(store.load(tutorial.id)?.status).toBe('completed');

    store.removeSession(tutorial.id, completed.sessionId);

    // The library reads loadAll(), so the lesson reads as not started rather
    // than as completed after a forced exit.
    expect(store.loadAll()[tutorial.id]).toBeUndefined();
  });
});

describe('a forced exit at any step of any lesson', () => {
  /** Every lesson, at every step it can be left from. */
  it('leaves no record that reads as started or complete', () => {
    const offenders: string[] = [];
    TUTORIALS.forEach((lesson) => {
      lesson.steps.forEach((current, index) => {
        const storage = new MemoryStorage();
        const store = new TutorialProgressStore(storage);
        const base = createProgress(lesson, `practice-${index}`);
        const steps = { ...base.steps };
        lesson.steps.slice(0, index).forEach((done) => {
          steps[done.id] = { status: 'COMPLETED', mode: done.completion };
        });
        const at = { ...base, currentStepId: current.id, steps };
        store.save(at);
        // The record is where the reader is standing before the exit.
        if (store.load(lesson.id)?.currentStepId !== current.id) offenders.push(`${lesson.id}@${current.id} not stored`);
        if (isTutorialComplete(lesson, at)) offenders.push(`${lesson.id}@${current.id} already complete`);

        store.removeSession(lesson.id, at.sessionId);

        if (store.loadAll()[lesson.id]) offenders.push(`${lesson.id}@${current.id} still listed`);
        if (store.loadSession(lesson.id, at.sessionId)) offenders.push(`${lesson.id}@${current.id} still readable`);
      });
    });
    expect(offenders).toEqual([]);
  });

  it('leaves the lesson restartable as a new session with every step unstarted', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore(storage);
    const exited = createProgress(tutorial, 'practice-e');
    store.save({ ...exited, steps: { ...exited.steps }, status: 'completed' as const });
    store.removeSession(tutorial.id, exited.sessionId);

    const restarted = createProgress(tutorial, 'practice-f');
    expect(restarted.sessionId).not.toBe(exited.sessionId);
    expect(Object.values(restarted.steps).every((step) => step.status === 'NOT_STARTED')).toBe(true);
    expect(restarted.status).toBe('in-progress');

    store.save(restarted);
    expect(store.loadAll()[tutorial.id]?.sessionId).toBe(restarted.sessionId);
    expect(store.loadSession(tutorial.id, exited.sessionId)).toBeNull();
  });

  it('keeps the guarded original when the store is full during the exit', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore(storage);
    const guard = store.saveOriginalProject({
      projectId: 'original-quota',
      tutorialId: tutorial.id,
      sessionId: 'session-quota',
      json: JSON.stringify({ worksheets: [], activeSheetId: '', settings: { theme: 'light', lang: 'en' } }),
      fingerprint: 'fingerprint-quota',
    });
    expect(guard.ok).toBe(true);
    const progress = createProgress(tutorial, 'practice-g');
    store.save(progress);

    // A full store refuses every further write, including the removal.
    storage.failWrites = true;
    store.removeSession(tutorial.id, progress.sessionId);

    // The session is gone from what the reader can reach, whatever the store did.
    expect(store.loadAll()[tutorial.id]).toBeUndefined();
    // The backup is only deleted after a verified restore, and there was none.
    const kept = store.loadOriginalProject('original-quota');
    expect(kept?.fingerprint).toBe('fingerprint-quota');
  });
});

describe('a reload after an exit', () => {
  const guard = (savedAt: string, fingerprint = 'own-project') => ({ savedAt, fingerprint });

  it('restores the guarded original when the exit could not write it to the store', () => {
    // Force exit wrote the workspace but the store refused it: the guard is newer
    // than the last successful autosave and comes back on the next load.
    expect(originalBackupWins(guard('2026-11-25T10:00:05.000Z'), { savedAt: '2026-11-25T10:00:00.000Z' }, 'practice-project', [])).toBe(true);
  });

  it('restores the original when the autosave still holds a practice project', () => {
    expect(originalBackupWins(guard('2026-11-25T09:00:00.000Z'), { savedAt: '2026-11-25T10:00:00.000Z' }, 'practice-fp', ['practice-fp'])).toBe(true);
  });

  it('leaves a newer autosave of the reader’s own project alone', () => {
    expect(originalBackupWins(guard('2026-11-25T09:00:00.000Z'), { savedAt: '2026-11-25T10:00:00.000Z' }, 'own-fp', ['practice-fp'])).toBe(false);
  });

  it('does nothing when the stored project already is the guarded one', () => {
    expect(originalBackupWins(guard('2026-11-25T10:00:00.000Z', 'same'), null, 'same', [])).toBe(false);
  });

  it('does nothing without a guard, and nothing when no autosave survived', () => {
    expect(originalBackupWins(null, null, 'own-fp', [])).toBe(false);
    expect(originalBackupWins(guard('2026-11-25T10:00:00.000Z'), null, 'practice-fp', ['practice-fp'])).toBe(true);
  });
});
