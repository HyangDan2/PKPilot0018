/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — local autosave
   IndexedDB when the browser provides it, localStorage as the fallback.
   ───────────────────────────────────────────────────────────────────────── */

const DB_NAME = 'sigrun-workspace';
const STORE = 'workspace';
const KEY = 'current';
const LS_KEY = 'sigrun.autosave.v1';

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

export async function saveAutosave(payload: unknown): Promise<void> {
  const text = JSON.stringify(payload);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(text, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    try {
      localStorage.setItem(LS_KEY, text);
    } catch {
      /* storage unavailable — analysis still works, just without recovery */
    }
  }
}

export async function loadAutosave<T>(): Promise<T | null> {
  try {
    const db = await openDb();
    const text = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (text) return JSON.parse(text) as T;
  } catch {
    /* fall through to localStorage */
  }
  try {
    const text = localStorage.getItem(LS_KEY);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
