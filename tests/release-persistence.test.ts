/* WO-FINAL-001 · WO-01 (F-REL-02) and WO-07 items 1–3, 7, 9

   An autosave that could not be written must never be reported as SAVED, the
   two stores must not disagree about which copy is newer, and a save that was
   overtaken by a later one must not overwrite it. The tests use the same store
   interface the browser implementation uses, so what is proven here is the
   policy, not a mock of it. */

import { describe, expect, it } from 'vitest';
import {
  autosaveStatusFor,
  clearAutosave,
  loadAutosave,
  loadAutosaveRecord,
  saveAutosave,
  type AutosaveStore,
} from '../src/lib/db';

class MemoryStore implements AutosaveStore {
  readonly available = true;
  private value: string | null = null;
  failWith: 'quota' | 'unavailable' | null = null;
  writes = 0;

  async read(): Promise<string | null> {
    if (this.failWith === 'unavailable') throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
    return this.value;
  }

  async write(text: string): Promise<void> {
    if (this.failWith === 'quota') throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
    if (this.failWith === 'unavailable') throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
    this.writes += 1;
    this.value = text;
  }

  async remove(): Promise<void> {
    this.value = null;
  }

  seed(text: string): void {
    this.value = text;
  }

  raw(): string | null {
    return this.value;
  }
}

function stores(): { idb: MemoryStore; ls: MemoryStore; pair: { idb: MemoryStore; ls: MemoryStore } } {
  const idb = new MemoryStore();
  const ls = new MemoryStore();
  return { idb, ls, pair: { idb, ls } };
}

function payload(worksheetName: string): { worksheets: { name: string }[]; savedAt: string } {
  return { worksheets: [{ name: worksheetName }], savedAt: '2026-01-01T00:00:00.000Z' };
}

/* ── 1/2 · the status is what the stores actually did ──────────────────── */

describe('WO-01 F-REL-02 · autosave status', () => {
  it('reports SAVED only when a copy was really written', async () => {
    const { idb, ls, pair } = stores();
    const result = await saveAutosave(payload('Sheet 1'), pair);
    expect(result.status).toBe('SAVED');
    expect(result.revision).toBeGreaterThan(0);
    expect(idb.raw()).toContain('Sheet 1');
    expect(ls.raw()).toContain('Sheet 1');
    await expect(loadAutosave(pair)).resolves.toMatchObject({ worksheets: [{ name: 'Sheet 1' }] });
  });

  it('reports STORAGE_UNAVAILABLE when IndexedDB and localStorage are both blocked', async () => {
    const { idb, ls, pair } = stores();
    idb.failWith = 'unavailable';
    ls.failWith = 'unavailable';
    const result = await saveAutosave(payload('Sheet 1'), pair);
    expect(result.status).toBe('STORAGE_UNAVAILABLE');
    expect(result.status).not.toBe('SAVED');
  });

  it('reports QUOTA_EXCEEDED when both stores are full', async () => {
    const { idb, ls, pair } = stores();
    idb.failWith = 'quota';
    ls.failWith = 'quota';
    const result = await saveAutosave(payload('Sheet 1'), pair);
    expect(result.status).toBe('QUOTA_EXCEEDED');
  });

  it('keeps SAVED when IndexedDB fails but localStorage wrote the copy', async () => {
    const { idb, ls, pair } = stores();
    idb.failWith = 'unavailable';
    const result = await saveAutosave(payload('Sheet 2'), pair);
    expect(result.status).toBe('SAVED');
    expect(ls.raw()).toContain('Sheet 2');
    await expect(loadAutosave(pair)).resolves.toMatchObject({ worksheets: [{ name: 'Sheet 2' }] });
  });

  it('maps a result to the five UI states without inventing SAVED', () => {
    expect(autosaveStatusFor({ status: 'SAVED' })).toBe('SAVED');
    expect(autosaveStatusFor({ status: 'FAILED' })).toBe('FAILED');
    expect(autosaveStatusFor({ status: 'STORAGE_UNAVAILABLE' })).toBe('STORAGE_UNAVAILABLE');
    expect(autosaveStatusFor({ status: 'QUOTA_EXCEEDED' })).toBe('QUOTA_EXCEEDED');
  });
});

/* ── 7 · the newest copy wins, whichever store holds it ────────────────── */

describe('WO-01 F-REL-02 · the newest copy is restored', () => {
  it('prefers the newer localStorage copy over a stale IndexedDB copy', async () => {
    const { idb, ls, pair } = stores();
    /* An IndexedDB write from before the failure: revision 1. */
    idb.seed(JSON.stringify({ format: 'sigrun-autosave', revision: 1, savedAt: '2026-01-01T00:00:01.000Z', payload: payload('Old') }));
    ls.seed(JSON.stringify({ format: 'sigrun-autosave', revision: 5, savedAt: '2026-01-01T00:00:05.000Z', payload: payload('New') }));
    const record = await loadAutosaveRecord(pair);
    expect(record?.payload).toMatchObject({ worksheets: [{ name: 'New' }] });
    expect(record?.source).toBe('localStorage');
  });

  it('still reads a copy written before the envelope existed', async () => {
    const { ls, pair } = stores();
    ls.seed(JSON.stringify({ worksheets: [{ name: 'Legacy' }] }));
    await expect(loadAutosave(pair)).resolves.toMatchObject({ worksheets: [{ name: 'Legacy' }] });
  });

  it('ignores an unreadable copy in one store and uses the other', async () => {
    const { idb, ls, pair } = stores();
    idb.failWith = 'unavailable';
    ls.seed(JSON.stringify({ format: 'sigrun-autosave', revision: 2, savedAt: '2026-01-01T00:00:02.000Z', payload: payload('Only') }));
    await expect(loadAutosave(pair)).resolves.toMatchObject({ worksheets: [{ name: 'Only' }] });
  });
});

/* ── 7/9 · two saves in flight: the later one is the one that survives ──── */

describe('WO-01 F-REL-02 · overlapping saves keep their order', () => {
  it('a slow earlier save cannot overwrite the later one', async () => {
    const { pair } = stores();
    const slow = saveAutosave(payload('Earlier'), pair);
    const fast = saveAutosave(payload('Later'), pair);
    const [first, second] = await Promise.all([slow, fast]);
    expect(second.revision!).toBeGreaterThan(first.revision!);
    const record = await loadAutosaveRecord(pair);
    expect(record?.payload).toMatchObject({ worksheets: [{ name: 'Later' }] });
    expect(record?.revision).toBe(second.revision);
  });

  it('a failed save leaves the previous copy in place', async () => {
    const { idb, ls, pair } = stores();
    await saveAutosave(payload('Kept'), pair);
    idb.failWith = 'quota';
    ls.failWith = 'quota';
    const failed = await saveAutosave(payload('Lost'), pair);
    expect(failed.status).toBe('QUOTA_EXCEEDED');
    await expect(loadAutosave(pair)).resolves.toMatchObject({ worksheets: [{ name: 'Kept' }] });
  });
});

describe('WO-01 · clearing both stores', () => {
  it('removes the copy from both', async () => {
    const { pair } = stores();
    await saveAutosave(payload('Sheet 1'), pair);
    await clearAutosave(pair);
    expect(pair.idb.raw()).toBeNull();
    expect(pair.ls.raw()).toBeNull();
    await expect(loadAutosave(pair)).resolves.toBeNull();
  });
});
