/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — tutorial progress storage (WO-T05)

   Progress is small JSON kept in localStorage. What is stored is what the
   reader can lose: if storage is blocked (a file:// build in a restricted
   browser) the store reports it instead of pretending to save, and the panel
   offers the project file as the fallback. A saved practice project travels in
   its own slot so "keep for later" survives a reload.
   ───────────────────────────────────────────────────────────────────────── */

import type { Tutorial } from './types';
import type {
  OriginalProjectSlot,
  PracticeSlot,
  ProgressStoreLike,
  TutorialEvent,
  TutorialProgress,
  StepProgress,
} from './types';

import { STORAGE_KEY, namespacedKey } from '../config/storageNamespace';

export const TUTORIAL_PROGRESS_KEY = namespacedKey(STORAGE_KEY.tutorialProgress);
export const TUTORIAL_PRACTICE_KEY = namespacedKey(STORAGE_KEY.tutorialPractice);
/** Slots written by the previous build; read once, then superseded. */
export const TUTORIAL_PRACTICE_KEY_V1 = namespacedKey(STORAGE_KEY.tutorialPracticeV1);
export const TUTORIAL_ORIGINAL_KEY = namespacedKey(STORAGE_KEY.tutorialOriginal);
/** A slot written before sessions existed keeps one stable name. */
const LEGACY_SESSION = 'legacy-session';

export class ProgressStorageError extends Error {
  constructor(readonly code: 'unavailable' | 'corrupt' | 'quota', message: string) {
    super(message);
    this.name = 'ProgressStorageError';
  }
}

let lastStamp = 0;

/** Strictly increasing, so two saves in one millisecond still order. */
function nowIso(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

let sequence = 0;

export function newSessionId(prefix = 'tut'): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

/** What a storage write reported: a blocked or full store is not a silent success. */
export interface SaveResult {
  ok: boolean;
  code?: 'unavailable' | 'quota';
  error?: string;
}

function failure(error: unknown): SaveResult {
  if (error instanceof ProgressStorageError) return { ok: false, code: error.code === 'quota' ? 'quota' : 'unavailable', error: error.message };
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, code: /quota/i.test(message) ? 'quota' : 'unavailable', error: message };
}

export function practiceSlotId(tutorialId: string, sessionId: string): string {
  return `${tutorialId}::${sessionId}`;
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
  /** The newest record this window has seen, by session, so a stale store cannot swing progress back. */
  private memory = new Map<string, TutorialProgress>();
  /** Sessions removed here; a store that refused the removal must not resurrect them. */
  private removed = new Set<string>();

  constructor(private readonly storage: ProgressStoreLike | null) {}

  private require(): ProgressStoreLike {
    if (!this.storage) {
      throw new ProgressStorageError('unavailable', 'Browser storage is not available; progress cannot be saved.');
    }
    return this.storage;
  }

  /** Every session this store can see, keyed by its own session id. */
  private sessions(): Map<string, TutorialProgress> {
    const output = new Map<string, TutorialProgress>();
    if (this.storage) {
      let raw: string | null = null;
      try {
        raw = this.storage.getItem(TUTORIAL_PROGRESS_KEY);
      } catch {
        raw = null;
      }
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { version?: number; sessions?: Record<string, TutorialProgress> };
          Object.entries(parsed?.sessions ?? {}).forEach(([key, record]) => {
            const clean = sanitise(record);
            if (!clean) return;
            // v1 was keyed by tutorial id; v2 by session id. Either way the
            // record states its own identity, and that is what is used.
            if (this.removed.has(clean.sessionId)) return;
            output.set(clean.sessionId || key, clean);
          });
        } catch {
          // A corrupted record is not repaired by guessing: the reader restarts.
        }
      }
    }
    // The in-window copy wins when it is at least as new as the stored one
    // (WO-FINAL-001 · F-REL-09): a blocked or slow store cannot move progress
    // backwards.
    this.memory.forEach((record, sessionId) => {
      const stored = output.get(sessionId);
      if (!stored || record.updatedAt >= stored.updatedAt) output.set(sessionId, record);
    });
    return output;
  }

  loadAll(): Record<string, TutorialProgress> {
    const newest: Record<string, TutorialProgress> = {};
    this.sessions().forEach((record) => {
      const current = newest[record.tutorialId];
      if (!current || record.updatedAt > current.updatedAt) newest[record.tutorialId] = record;
    });
    return newest;
  }

  load(tutorialId: string): TutorialProgress | null {
    return this.loadAll()[tutorialId] ?? null;
  }

  /** One exact session of one tutorial (never a different session). */
  loadSession(tutorialId: string, sessionId: string): TutorialProgress | null {
    const record = this.sessions().get(sessionId);
    return record && record.tutorialId === tutorialId ? record : null;
  }

  /**
   * Write the record. The in-window copy is updated first: a blocked or full
   * store stops the persistence, never the progress (WO-TQA-11).
   */
  save(progress: TutorialProgress): void {
    const record = { ...progress, updatedAt: nowIso() };
    this.removed.delete(record.sessionId);
    this.memory.set(record.sessionId, record);
    const storage = this.require();
    const all = this.sessions();
    all.set(record.sessionId, record);
    try {
      storage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ version: 2, sessions: Object.fromEntries(all) }));
    } catch (error) {
      const quota = error instanceof Error && /quota/i.test(error.message);
      throw new ProgressStorageError(quota ? 'quota' : 'unavailable', error instanceof Error ? error.message : 'storage failed');
    }
  }

  /** Forget one exact session; another session of the same lesson survives. */
  removeSession(tutorialId: string, sessionId: string): void {
    const record = this.sessions().get(sessionId);
    this.memory.delete(sessionId);
    this.removed.add(sessionId);
    if (!this.storage) return;
    if (!record || record.tutorialId !== tutorialId) return;
    const all = this.sessions();
    all.delete(sessionId);
    try {
      this.storage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ version: 2, sessions: Object.fromEntries(all) }));
    } catch {
      /* a failed removal leaves the record; the tombstone still hides it here */
    }
  }

  /** Forget every session of one tutorial. */
  remove(tutorialId: string): void {
    [...this.sessions().entries()].forEach(([sessionId, record]) => {
      if (record.tutorialId === tutorialId) {
        this.memory.delete(sessionId);
        this.removed.add(sessionId);
      }
    });
    if (!this.storage) return;
    const all = this.sessions();
    [...all.entries()].forEach(([sessionId, record]) => {
      if (record.tutorialId === tutorialId) all.delete(sessionId);
    });
    try {
      this.storage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify({ version: 2, sessions: Object.fromEntries(all) }));
    } catch {
      /* a failed removal leaves the old record; the reader can restart anyway */
    }
  }

  clear(): void {
    this.memory.clear();
    this.removed.clear();
    if (!this.storage) return;
    try {
      this.storage.removeItem(TUTORIAL_PROGRESS_KEY);
    } catch {
      /* ignore */
    }
  }

  /* ── practice projects: one slot per tutorial and session (WO-TQA-07) ── */

  private readSlots(): Record<string, PracticeSlot> {
    if (!this.storage) return {};
    const output: Record<string, PracticeSlot> = {};
    try {
      const raw = this.storage.getItem(TUTORIAL_PRACTICE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { slots?: Record<string, PracticeSlot> };
        Object.entries(parsed?.slots ?? {}).forEach(([slotId, slot]) => {
          if (slot && typeof slot.json === 'string' && typeof slot.tutorialId === 'string') output[slotId] = slot;
        });
      }
    } catch {
      /* a damaged slot file falls back to the previous format below */
    }
    return output;
  }

  listPracticeSlots(): PracticeSlot[] {
    return Object.values(this.readSlots()).sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  }

  savePracticeSlot(slot: {
    tutorialId: string;
    tutorialVersion?: number;
    sessionId?: string;
    projectId: string;
    savedAt?: string;
    json: string;
    events?: TutorialEvent[];
    progress?: TutorialProgress | null;
    originalProjectId?: string | null;
  }): SaveResult {
    try {
      const storage = this.require();
      const sessionId = slot.sessionId && slot.sessionId.length ? slot.sessionId : newSessionId();
      const record: PracticeSlot = {
        slotId: practiceSlotId(slot.tutorialId, sessionId),
        tutorialId: slot.tutorialId,
        tutorialVersion: slot.tutorialVersion ?? 1,
        sessionId,
        projectId: slot.projectId,
        savedAt: slot.savedAt ?? nowIso(),
        json: slot.json,
        events: (slot.events ?? []).slice(-300),
        progress: slot.progress ?? null,
        originalProjectId: slot.originalProjectId ?? null,
      };
      const slots = this.readSlots();
      slots[record.slotId] = record;
      storage.setItem(TUTORIAL_PRACTICE_KEY, JSON.stringify({ version: 2, slots }));
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  /**
   * The slot for a tutorial: the exact session named, or the newest one.
   *
   * A named session that is not stored returns null — a resume must never
   * restore a different session's practice (WO-FINAL-001 · F-REL-09).
   */
  loadPracticeSlot(tutorialId: string, sessionId?: string | null): PracticeSlot | null {
    const slots = this.listPracticeSlots().filter((slot) => slot.tutorialId === tutorialId);
    if (sessionId) {
      const exact = slots.find((slot) => slot.sessionId === sessionId);
      if (exact) return exact;
      const legacy = this.readLegacySlot(tutorialId);
      return legacy && legacy.sessionId === sessionId ? legacy : null;
    }
    return slots[0] ?? this.readLegacySlot(tutorialId);
  }

  removePracticeSlot(slotId: string): void {
    if (!this.storage) return;
    try {
      const storage = this.storage;
      const slots = this.readSlots();
      if (!(slotId in slots)) return;
      delete slots[slotId];
      storage.setItem(TUTORIAL_PRACTICE_KEY, JSON.stringify({ version: 2, slots }));
    } catch {
      /* a failed removal leaves the slot; the reader can discard it again */
    }
  }

  /**
   * Remove every kept copy of one practice: the slots written under its project
   * id and the slot of its session (WO-3F-01). A practice that was kept and
   * later resumed carries both; removing them together means a forced exit
   * leaves no copy the reader can no longer reach. Other practices stay.
   */
  removePracticeSlotsForPractice(projectId: string | null, sessionId?: string | null): number {
    if (!this.storage) return 0;
    try {
      const storage = this.storage;
      const slots = this.readSlots();
      const doomed = Object.values(slots).filter((slot) => (
        (projectId && slot.projectId === projectId)
        || (sessionId && slot.sessionId === sessionId)
      ));
      if (!doomed.length) return 0;
      doomed.forEach((slot) => { delete slots[slot.slotId]; });
      storage.setItem(TUTORIAL_PRACTICE_KEY, JSON.stringify({ version: 2, slots }));
      return doomed.length;
    } catch {
      /* a failed removal leaves the slot; another exit can discard it */
      return 0;
    }
  }

  /** A slot written by the previous build is read, then superseded by its next save. */
  private readLegacySlot(tutorialId: string): PracticeSlot | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(TUTORIAL_PRACTICE_KEY_V1);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { tutorialId?: string; projectId?: string; savedAt?: string; json?: string };
      if (!parsed?.json || !parsed.tutorialId) return null;
      if (tutorialId && parsed.tutorialId !== tutorialId) return null;
      const sessionId = LEGACY_SESSION;
      return {
        slotId: practiceSlotId(parsed.tutorialId, sessionId),
        tutorialId: parsed.tutorialId,
        tutorialVersion: 1,
        sessionId,
        projectId: parsed.projectId ?? '',
        savedAt: parsed.savedAt ?? '',
        json: parsed.json,
        events: [],
        progress: null,
        originalProjectId: null,
      };
    } catch {
      return null;
    }
  }

  /** Previous name of {@link savePracticeSlot}; kept for the older call sites. */
  savePracticeProject(project: { tutorialId: string; projectId: string; savedAt: string; json: string; sessionId?: string; events?: TutorialEvent[]; progress?: TutorialProgress | null; originalProjectId?: string | null }): void {
    const result = this.savePracticeSlot(project);
    if (!result.ok) throw new ProgressStorageError(result.code === 'quota' ? 'quota' : 'unavailable', result.error ?? 'storage failed');
  }

  loadPracticeProject(tutorialId?: string): PracticeSlot | null {
    if (tutorialId) return this.loadPracticeSlot(tutorialId);
    return this.listPracticeSlots()[0] ?? this.readLegacySlot('');
  }

  /** Remove only the slot named; a second kept practice must survive (WO-TQA-07). */
  clearPracticeProject(slotId?: string): void {
    if (!this.storage) return;
    if (slotId) {
      this.removePracticeSlot(slotId);
      return;
    }
    try {
      this.storage.removeItem(TUTORIAL_PRACTICE_KEY);
      this.storage.removeItem(TUTORIAL_PRACTICE_KEY_V1);
    } catch {
      /* ignore */
    }
  }

  /* ── the reader's original project (WO-TQA-01) ─────────────────────── */

  private readOriginals(): Record<string, OriginalProjectSlot> {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(TUTORIAL_ORIGINAL_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as { slots?: Record<string, OriginalProjectSlot> };
      const output: Record<string, OriginalProjectSlot> = {};
      Object.entries(parsed?.slots ?? {}).forEach(([id, slot]) => {
        if (slot && typeof slot.json === 'string' && typeof slot.fingerprint === 'string') output[id] = slot;
      });
      return output;
    } catch {
      return {};
    }
  }

  listOriginalProjects(): OriginalProjectSlot[] {
    return Object.values(this.readOriginals()).sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  }

  saveOriginalProject(slot: { projectId: string; tutorialId?: string | null; sessionId?: string | null; savedAt?: string; json: string; fingerprint: string }): SaveResult {
    try {
      const storage = this.require();
      const record: OriginalProjectSlot = {
        projectId: slot.projectId,
        tutorialId: slot.tutorialId ?? null,
        sessionId: slot.sessionId ?? null,
        savedAt: slot.savedAt ?? nowIso(),
        json: slot.json,
        fingerprint: slot.fingerprint,
      };
      const slots = this.readOriginals();
      slots[record.projectId] = record;
      storage.setItem(TUTORIAL_ORIGINAL_KEY, JSON.stringify({ version: 1, slots }));
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  loadOriginalProject(projectId: string): OriginalProjectSlot | null {
    return this.readOriginals()[projectId] ?? null;
  }

  latestOriginalProject(): OriginalProjectSlot | null {
    return this.listOriginalProjects()[0] ?? null;
  }

  removeOriginalProject(projectId: string): void {
    if (!this.storage) return;
    try {
      const storage = this.storage;
      const slots = this.readOriginals();
      if (!(projectId in slots)) return;
      delete slots[projectId];
      storage.setItem(TUTORIAL_ORIGINAL_KEY, JSON.stringify({ version: 1, slots }));
    } catch {
      /* ignore */
    }
  }

  clearOriginalProjects(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(TUTORIAL_ORIGINAL_KEY);
    } catch {
      /* ignore */
    }
  }
}


/**
 * Why a kept practice cannot be resumed as this tutorial (null when it can).
 *
 * A lesson that changed its steps and a project that was replaced are two
 * different incompatibilities; the panel names which one it is instead of
 * resuming a session that no longer matches (WO-FINAL-001 · F-REL-09).
 */
export function practiceSlotIssue(
  slot: Pick<PracticeSlot, 'tutorialVersion' | 'projectId'>,
  tutorialVersion: number,
  projectId?: string | null,
): 'tut.slotVersionMismatch' | 'tut.slotProjectMismatch' | null {
  if (Number(slot.tutorialVersion) !== Number(tutorialVersion)) return 'tut.slotVersionMismatch';
  if (projectId && slot.projectId !== projectId) return 'tut.slotProjectMismatch';
  return null;
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
