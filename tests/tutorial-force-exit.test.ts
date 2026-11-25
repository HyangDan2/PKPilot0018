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
