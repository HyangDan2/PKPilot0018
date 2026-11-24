/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — local autosave

   IndexedDB is the primary store and localStorage the second copy; BOTH are
   written, and both are read, so a failure in either one cannot silently
   discard the newest project (WO-FINAL-001 · F-REL-02).

   Rules this module enforces:

   · A save reports what the two stores actually did. SAVED means at least one
     copy is on disk; a blocked store is STORAGE_UNAVAILABLE, a full one is
     QUOTA_EXCEEDED, and nothing is ever reported as SAVED when nothing was
     written.
   · Every copy carries a revision. Writes are serialised in call order and the
     revision is allocated at call time, so a slow earlier save cannot land on
     top of a later one.
   · Reading picks the newest copy by revision (then by save time), whichever
     store holds it — the localStorage copy written after an IndexedDB failure
     wins over the stale IndexedDB copy.
   · A copy written before this envelope existed is still read as the project.
   ───────────────────────────────────────────────────────────────────────── */

const DB_NAME = 'sigrun-workspace';
const STORE = 'workspace';
const KEY = 'current';
const LS_KEY = 'sigrun.autosave.v1';
export const AUTOSAVE_STORAGE_KEY = LS_KEY;
const ENVELOPE = 'sigrun-autosave';

export type AutosaveStatus = 'SAVING' | 'SAVED' | 'FAILED' | 'STORAGE_UNAVAILABLE' | 'QUOTA_EXCEEDED';

export interface AutosaveSaveResult {
  status: Exclude<AutosaveStatus, 'SAVING'>;
  /** The revision this save asked for (null when it never reached a store). */
  revision: number | null;
  /** What each store reported, kept for the QA report and the UI detail. */
  stores: { indexedDb: string; localStorage: string };
}

export interface AutosaveStore {
  readonly available: boolean;
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
  remove(): Promise<void>;
}

export interface AutosaveStores {
  idb: AutosaveStore;
  ls: AutosaveStore;
}

export interface AutosaveRecord<T> {
  payload: T;
  revision: number;
  savedAt: string;
  source: 'indexeddb' | 'localStorage';
}

type FailureKind = 'quota' | 'unavailable' | 'unknown';

function classify(error: unknown): FailureKind {
  if (!error || typeof error !== 'object') return 'unknown';
  const candidate = error as { name?: string; code?: number; message?: string };
  const name = candidate.name ?? '';
  const message = candidate.message ?? '';
  if (name === 'QuotaExceededError' || candidate.code === 22 || /quota|exceeded|storage is full/i.test(message)) return 'quota';
  if (name === 'SecurityError' || name === 'NotAllowedError' || name === 'InvalidStateError' || /no-indexeddb|blocked|denied|not available/i.test(message)) return 'unavailable';
  return 'unknown';
}

/* ── IndexedDB ─────────────────────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no-indexeddb'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('idb-open-failed'));
  });
}

function indexedDbStore(): AutosaveStore {
  const available = typeof indexedDB !== 'undefined';
  return {
    available,
    async read() {
      const db = await openDb();
      try {
        return await new Promise<string | null>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const request = tx.objectStore(STORE).get(KEY);
          request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
          request.onerror = () => reject(request.error ?? new Error('idb-read-failed'));
        });
      } finally {
        db.close();
      }
    },
    async write(text) {
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(text, KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('idb-write-failed'));
          tx.onabort = () => reject(tx.error ?? new Error('idb-write-aborted'));
        });
      } finally {
        db.close();
      }
    },
    async remove() {
      const db = await openDb();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('idb-delete-failed'));
        });
      } finally {
        db.close();
      }
    },
  };
}

/* ── localStorage ──────────────────────────────────────────────────────── */

function localStorageStore(): AutosaveStore {
  let available = false;
  try {
    available = typeof localStorage !== 'undefined';
    if (available) {
      const probe = '__sigrun_autosave_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
    }
  } catch {
    available = false;
  }
  return {
    available,
    async read() {
      if (typeof localStorage === 'undefined') throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
      return localStorage.getItem(LS_KEY);
    },
    async write(text) {
      if (typeof localStorage === 'undefined') throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
      localStorage.setItem(LS_KEY, text);
    },
    async remove() {
      if (typeof localStorage === 'undefined') return;
      localStorage.removeItem(LS_KEY);
    },
  };
}

/** The two stores of this browser. */
export function browserAutosaveStores(): AutosaveStores {
  return { idb: indexedDbStore(), ls: localStorageStore() };
}

/* ── saving ────────────────────────────────────────────────────────────── */

let lastRevision = 0;
let queue: Promise<void> = Promise.resolve();

function nextRevision(): number {
  const now = Date.now();
  lastRevision = Math.max(now, lastRevision + 1);
  return lastRevision;
}

interface Envelope {
  format: typeof ENVELOPE;
  revision: number;
  savedAt: string;
  payload: unknown;
}

async function attempt(store: AutosaveStore, text: string): Promise<string> {
  try {
    await store.write(text);
    return 'ok';
  } catch (error) {
    return classify(error);
  }
}

/**
 * Write the project to both stores, in call order.
 *
 * The returned status names the worst real outcome: SAVED when any copy was
 * written, otherwise the reason both stores refused.
 */
export async function saveAutosave<T>(payload: T, stores: AutosaveStores = browserAutosaveStores()): Promise<AutosaveSaveResult> {
  const revision = nextRevision();
  const envelope: Envelope = { format: ENVELOPE, revision, savedAt: new Date().toISOString(), payload };
  let text: string;
  try {
    text = JSON.stringify(envelope);
  } catch {
    return { status: 'FAILED', revision, stores: { indexedDb: 'serialise', localStorage: 'serialise' } };
  }
  let result: AutosaveSaveResult = { status: 'FAILED', revision, stores: { indexedDb: 'skipped', localStorage: 'skipped' } };
  const run = queue.then(async () => {
    const [idbOutcome, lsOutcome] = await Promise.all([attempt(stores.idb, text), attempt(stores.ls, text)]);
    const outcomes = [idbOutcome, lsOutcome];
    let status: AutosaveSaveResult['status'];
    if (outcomes.includes('ok')) status = 'SAVED';
    else if (outcomes.includes('quota')) status = 'QUOTA_EXCEEDED';
    else if (outcomes.every((entry) => entry === 'unavailable')) status = 'STORAGE_UNAVAILABLE';
    else if (outcomes.every((entry) => entry === 'unavailable' || entry === 'quota')) status = 'QUOTA_EXCEEDED';
    else status = 'FAILED';
    result = { status, revision, stores: { indexedDb: idbOutcome, localStorage: lsOutcome } };
  });
  queue = run.then(() => undefined, () => undefined);
  await run;
  return result;
}

/** The UI state a save result stands for. */
export function autosaveStatusFor(result: { status: AutosaveSaveResult['status'] }): AutosaveStatus {
  return result.status;
}

/* ── loading ───────────────────────────────────────────────────────────── */

function parseCopy(text: string | null): { payload: unknown; revision: number; savedAt: string } | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<Envelope> & { worksheets?: unknown };
    if (parsed && parsed.format === ENVELOPE && 'payload' in parsed) {
      return {
        payload: parsed.payload,
        revision: Number.isFinite(parsed.revision) ? Number(parsed.revision) : 0,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      };
    }
    // A project written before the envelope existed.
    if (parsed && Array.isArray(parsed.worksheets)) return { payload: parsed, revision: 0, savedAt: '' };
    return null;
  } catch {
    return null;
  }
}

async function readCopy(store: AutosaveStore): Promise<string | null> {
  try {
    return await store.read();
  } catch {
    return null;
  }
}

/**
 * The newest readable copy, with the store it came from.
 *
 * Revision decides first, save time second. A legacy copy (no revision) is a
 * fallback, never newer than a copy that states one.
 */
export async function loadAutosaveRecord<T>(stores: AutosaveStores = browserAutosaveStores()): Promise<AutosaveRecord<T> | null> {
  const [idbText, lsText] = await Promise.all([readCopy(stores.idb), readCopy(stores.ls)]);
  const candidates: (AutosaveRecord<T> & { time: number })[] = [];
  const add = (text: string | null, source: AutosaveRecord<T>['source']) => {
    const parsed = parseCopy(text);
    if (!parsed) return;
    const time = parsed.savedAt ? Date.parse(parsed.savedAt) : Number.NaN;
    candidates.push({ payload: parsed.payload as T, revision: parsed.revision, savedAt: parsed.savedAt, source, time: Number.isFinite(time) ? time : 0 });
  };
  add(idbText, 'indexeddb');
  add(lsText, 'localStorage');
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.revision - a.revision) || (b.time - a.time));
  const best = candidates[0];
  return { payload: best.payload, revision: best.revision, savedAt: best.savedAt, source: best.source };
}

export async function loadAutosave<T>(stores: AutosaveStores = browserAutosaveStores()): Promise<T | null> {
  const record = await loadAutosaveRecord<T>(stores);
  return record ? record.payload : null;
}

export async function clearAutosave(stores: AutosaveStores = browserAutosaveStores()): Promise<void> {
  await Promise.all([stores.idb.remove().catch(() => undefined), stores.ls.remove().catch(() => undefined)]);
}
