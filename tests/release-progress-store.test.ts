/* WO-FINAL-001 · WO-01 (F-REL-09~11) and WO-07 items 8–9

   Tutorial progress is kept per session, the newest copy wins over a stale one
   (including the in-memory copy this window already holds), and a resume never
   falls back to a different session or a different tutorial version. */

import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_PROGRESS_KEY,
  TutorialProgressStore,
  practiceSlotIssue,
  practiceSlotId,
} from '../src/tutorials/progressStore';
import type { ProgressStoreLike } from '../src/tutorials/types';
import { findTutorial } from '../src/tutorials/registry';
import { createProgress } from '../src/tutorials/progressStore';
import type { TutorialProgress } from '../src/tutorials/types';

class MemoryStorage implements ProgressStoreLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function progressFor(sessionId: string, updatedAt: string, step = 'step-1'): TutorialProgress {
  const tutorial = findTutorial('tutorial-rsm-001')!;
  const base = createProgress(tutorial, `practice-${sessionId}`);
  return { ...base, sessionId, currentStepId: step, updatedAt };
}

describe('WO-01 · tutorial progress belongs to a session', () => {
  it('keeps two sessions of one tutorial apart and reloads both', () => {
    const storage = new MemoryStorage();
    const first = progressFor('session-1', '2026-11-25T01:00:00.000Z');
    const second = progressFor('session-2', '2026-11-25T02:00:00.000Z');
    const store = new TutorialProgressStore(storage);
    store.save(first);
    store.save(second);
    expect(store.loadSession(first.tutorialId, 'session-1')?.currentStepId).toBe('step-1');
    expect(store.loadSession(second.tutorialId, 'session-2')?.sessionId).toBe('session-2');
    // A fresh window reads the same storage.
    const reopened = new TutorialProgressStore(storage);
    expect(reopened.loadSession(first.tutorialId, 'session-1')?.sessionId).toBe('session-1');
    expect(reopened.loadAll()[first.tutorialId]?.sessionId).toBe('session-2');
  });

  it('does not let an older stored record overwrite the newer in-memory progress', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore(storage);
    const newer = progressFor('session-1', '2020-01-01T05:00:00.000Z', 'step-9');
    store.save(newer);
    /* Another writer (an old tab, a restore) puts a stale copy back. */
    const stale = progressFor('session-1', '2020-01-01T01:00:00.000Z', 'step-1');
    storage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ version: 1, sessions: { [stale.tutorialId]: stale } }));
    expect(store.loadAll()[stale.tutorialId]?.currentStepId).toBe('step-9');
    expect(store.loadSession(stale.tutorialId, 'session-1')?.currentStepId).toBe('step-9');
  });
});

describe('WO-01 · a resume asks for one session, not any session', () => {
  it('returns nothing when the asked-for session is not stored', () => {
    const storage = new MemoryStorage();
    const store = new TutorialProgressStore(storage);
    store.savePracticeSlot({
      tutorialId: 'tutorial-a',
      sessionId: 'session-2',
      projectId: 'project-session-2',
      savedAt: '2026-11-25T02:00:00.000Z',
      json: '{"format":"sigrun-project"}',
    });
    expect(store.loadPracticeSlot('tutorial-a', 'session-1')).toBeNull();
    expect(store.loadPracticeSlot('tutorial-a', 'session-2')?.projectId).toBe('project-session-2');
    // A tutorial-wide lookup still gives the newest kept practice.
    expect(store.loadPracticeSlot('tutorial-a')?.projectId).toBe('project-session-2');
  });

  it('names a version or project mismatch instead of resuming blindly', () => {
    const slot = {
      slotId: practiceSlotId('tutorial-a', 'session-1'),
      tutorialId: 'tutorial-a',
      tutorialVersion: 3,
      sessionId: 'session-1',
      projectId: 'project-1',
      savedAt: '2026-11-25T01:00:00.000Z',
      json: '{}',
      events: [],
      progress: null,
      originalProjectId: null,
    };
    expect(practiceSlotIssue(slot, 3, 'project-1')).toBeNull();
    expect(practiceSlotIssue(slot, 4)).toBe('tut.slotVersionMismatch');
    expect(practiceSlotIssue(slot, 3, 'project-2')).toBe('tut.slotProjectMismatch');
  });
});
