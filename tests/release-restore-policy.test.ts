/* ─────────────────────────────────────────────────────────────────────────
   Statelia — restore policy (WO-FINAL-002 · Q-01/Q-02)

   A restore is only kept when it reached the store: the module under test
   decides (a) when a guarded original is newer than the autosave and must win,
   (b) whether a stored copy still states the restored project, and (c) what a
   restored project (including an empty style list) looks like.
   ───────────────────────────────────────────────────────────────────────── */

import { beforeEach, describe, expect, it } from 'vitest';
import type { Settings, Worksheet } from '../src/types';
import {
  originalBackupWins,
  restoredStateMatches,
  stateFromAutosave,
  stateFromProject,
  type RestoredWorkspace,
} from '../src/lib/restorePolicy';
import {
  CUSTOM_STYLE_STORAGE_KEY,
  loadCustomStyles,
  saveCustomStyle,
  writeCustomStyles,
} from '../src/lib/chartStyles';

const settings: Settings = { theme: 'light', lang: 'en' };

function sheet(id = 'S1', values: (number | null)[] = [1, 2, 3]): Worksheet {
  return {
    id,
    name: `Sheet ${id}`,
    columns: [{ id: 'C1', name: 'A', type: 'numeric', values }],
  };
}

function workspace(overrides: Partial<RestoredWorkspace> = {}): RestoredWorkspace {
  return {
    worksheets: [sheet()],
    activeSheetId: 'S1',
    outputs: [],
    settings,
    models: [],
    figures: [],
    customChartStyles: [],
    ...overrides,
  };
}

describe('Q-01 · a stored copy must state the restored project', () => {
  it('accepts the same records, including a derived column sequence', () => {
    const expected = workspace();
    const stored = workspace({ worksheets: [sheet()] });
    expect(restoredStateMatches(expected, stored).ok).toBe(true);
  });

  it('reports a data difference', () => {
    const result = restoredStateMatches(workspace(), workspace({ worksheets: [sheet('S1', [1, 2, 4])] }));
    expect(result.ok).toBe(false);
    expect(result.mismatches[0]?.kind).toBe('worksheet-data');
  });

  it('reports a chart-style difference, not only a missing id (Q-02)', () => {
    const expected = workspace({ customChartStyles: [{ id: 'style-1', name: 'House', base: 'engineering', overrides: { series: ['#111111'] } }] });
    const stored = workspace({ customChartStyles: [{ id: 'style-1', name: 'House', base: 'engineering', overrides: { series: ['#222222'] } }] });
    const result = restoredStateMatches(expected, stored);
    expect(result.ok).toBe(false);
    expect(result.mismatches.some((entry) => entry.kind === 'custom-styles')).toBe(true);
  });

  it('reads an autosave payload only when it holds sheets', () => {
    expect(stateFromAutosave({ worksheets: [sheet()] })?.worksheets).toHaveLength(1);
    expect(stateFromAutosave({ worksheets: [] })).toBeNull();
    expect(stateFromAutosave(null)).toBeNull();
    expect(stateFromAutosave({ worksheets: 'nope' })).toBeNull();
  });

  it('treats an absent style list as empty and keeps an explicit empty list', () => {
    expect(stateFromProject({ worksheets: [sheet()] }).customChartStyles).toEqual([]);
    expect(stateFromProject({ worksheets: [sheet()], customChartStyles: [] }).customChartStyles).toEqual([]);
  });
});

describe('Q-01 · the newest guarded original beats an older autosave', () => {
  const guard = { savedAt: '2026-11-25T10:00:00.000Z', fingerprint: 'guard-print' };

  it('wins when the guard was written after the last autosave', () => {
    expect(originalBackupWins(guard, { savedAt: '2026-11-25T09:59:00.000Z' }, 'autosave-print', [])).toBe(true);
  });

  it('wins when the autosave has no save time (a pre-envelope copy)', () => {
    expect(originalBackupWins(guard, { savedAt: '' }, 'autosave-print', [])).toBe(true);
    expect(originalBackupWins(guard, null, 'autosave-print', [])).toBe(true);
  });

  it('loses when the autosave was written after the guard', () => {
    expect(originalBackupWins(guard, { savedAt: '2026-11-25T10:01:00.000Z' }, 'autosave-print', [])).toBe(false);
  });

  it('wins when the autosave holds a kept practice project, whatever the times', () => {
    expect(originalBackupWins(guard, { savedAt: '2026-11-25T10:05:00.000Z' }, 'practice-print', ['practice-print'])).toBe(true);
  });

  it('does not replace an autosave that already states the guarded project', () => {
    expect(originalBackupWins({ ...guard, fingerprint: 'same-print' }, { savedAt: '2026-11-25T09:00:00.000Z' }, 'same-print', [])).toBe(false);
  });

  it('does nothing without a guard, or with an unreadable guard time', () => {
    expect(originalBackupWins(null, null, 'autosave-print', [])).toBe(false);
    expect(originalBackupWins({ savedAt: 'not-a-date', fingerprint: 'guard-print' }, { savedAt: '2026-11-25T09:00:00.000Z' }, 'autosave-print', [])).toBe(false);
  });
});

describe('Q-02 · an empty restored style list clears the library', () => {
  beforeEach(() => {
    localStorage.removeItem(CUSTOM_STYLE_STORAGE_KEY);
  });

  it('writes an explicit empty list over the styles a practice created', () => {
    saveCustomStyle({ id: 'practice-style', name: 'Practice', base: 'engineering', overrides: { series: ['#123456'] } });
    expect(loadCustomStyles()).toHaveLength(1);
    writeCustomStyles(stateFromProject({ worksheets: [sheet()], customChartStyles: [] }).customChartStyles);
    expect(loadCustomStyles()).toEqual([]);
  });
});
