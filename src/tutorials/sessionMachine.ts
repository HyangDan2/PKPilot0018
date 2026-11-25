/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — tutorial session state machine (WO-3F-01)

   A lesson is not a boolean "open". Starting it waits for the autosave, the
   workspace is swapped while it runs, and ending it restores the reader's own
   project. Each of those is a state, and an exit requested in one state must
   still be honoured when the state has moved on.

     IDLE → STARTING → ACTIVE ⇄ PAUSED
                 ↓         ↓
                 └────→ EXITING → IDLE
                            ↓
                   RECOVERY_REQUIRED → IDLE

   Force exit is legal from every non-idle state, including while starting (the
   pending start is abandoned) and while recovering from a failed restore. It is
   idempotent: a second request while EXITING changes nothing.

   The machine is pure; the workspace cleanup it implies is listed in one place
   so no exit path can forget a piece of session state.
   ───────────────────────────────────────────────────────────────────────── */

export type TutorialPhase =
  | 'IDLE'
  | 'STARTING'
  | 'ACTIVE'
  | 'PAUSED'
  | 'EXITING'
  | 'RECOVERY_REQUIRED';

export type TutorialPhaseEvent =
  | { type: 'START' }
  | { type: 'STARTED' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'EXIT'; force?: boolean }
  | { type: 'EXITED' }
  | { type: 'RESTORE_FAILED' }
  | { type: 'RECOVERED' }
  | { type: 'ABORT_START' };

export function nextPhase(phase: TutorialPhase, event: TutorialPhaseEvent): TutorialPhase {
  switch (event.type) {
    case 'START':
      return phase === 'IDLE' ? 'STARTING' : phase;
    case 'STARTED':
      return phase === 'STARTING' ? 'ACTIVE' : phase;
    case 'PAUSE':
      return phase === 'ACTIVE' ? 'PAUSED' : phase;
    case 'RESUME':
      return phase === 'PAUSED' ? 'ACTIVE' : phase;
    // Leaving is always possible; while already leaving it is a no-op, which
    // is what makes a double-click or a retry safe.
    case 'EXIT':
      return phase === 'IDLE' || phase === 'EXITING' ? phase : 'EXITING';
    case 'EXITED':
      return phase === 'EXITING' ? 'IDLE' : phase;
    case 'RESTORE_FAILED':
      return phase === 'EXITING' ? 'RECOVERY_REQUIRED' : phase;
    case 'RECOVERED':
      return phase === 'RECOVERY_REQUIRED' ? 'IDLE' : phase;
    case 'ABORT_START':
      return phase === 'STARTING' ? 'IDLE' : phase;
    default:
      return phase;
  }
}

/** A session whose workspace is (or may be) on screen. */
export function isSessionLive(phase: TutorialPhase): boolean {
  return phase !== 'IDLE';
}

/** Validation and step movement only run while the lesson is actively taught. */
export function isSessionEvaluating(phase: TutorialPhase): boolean {
  return phase === 'ACTIVE';
}

/** Force exit is offered in every state, including a failed recovery. */
export function canForceExit(phase: TutorialPhase): boolean {
  return phase !== 'IDLE' && phase !== 'EXITING';
}

export interface ExitPlan {
  /** Write the pre-practice project back into the workspace. */
  restoreOriginal: boolean;
  /** The reader's own project keeps the practice changes. */
  keepCurrentData: boolean;
  /** The session's progress record is removed, so an exit is never a completion. */
  removeSessionProgress: boolean;
  /** A force exit never counts as finishing the lesson. */
  countsAsCompletion: false;
}

export function exitPlan(mode: 'isolated' | 'current' | null): ExitPlan {
  return {
    restoreOriginal: mode !== 'current',
    keepCurrentData: mode === 'current',
    removeSessionProgress: true,
    countsAsCompletion: false,
  };
}

/**
 * Everything a session leaves behind. Listed as data so the cleanup can be
 * checked against it instead of relying on every call site remembering.
 */
export const SESSION_CLEANUP = [
  'activeSession',
  'events',
  'actionQueue',
  'validationState',
  'overlay',
  'highlightFocusLock',
  'tutorialModals',
  'timers',
  'asyncResults',
] as const;

export type SessionCleanupKey = typeof SESSION_CLEANUP[number];

/**
 * An async step only applies its result to the session it was started for.
 * The token is the session id plus the exit generation captured at start.
 */
export interface SessionToken {
  sessionId: string;
  generation: number;
}

export function sessionStillActive(token: SessionToken | null, current: SessionToken | null): boolean {
  return Boolean(token && current && token.sessionId === current.sessionId && token.generation === current.generation);
}
