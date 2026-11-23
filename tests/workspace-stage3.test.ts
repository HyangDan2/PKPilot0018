import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE,
  MIN_DRAWER_W,
  MIN_OUTPUT_W,
  MIN_WORKSHEET_W,
  WORKSPACE_KEY,
  WORKSPACE_LAYOUTS,
  applyPresetToWorkspace,
  clampDrawerW,
  clampOutputW,
  dragNav,
  dragOutput,
  maxOutputW,
  normalizeWorkspace,
  readWorkspace,
  resolveWorkspace,
  serializeWorkspace,
  setWorkspaceLayout,
  triWidths,
  writeWorkspace,
} from '../src/lib/workspace';

function fakeStorage(seed: Record<string, string> = {}) {
  const data = { ...seed };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

describe('workspace default', () => {
  it('opens as a three-panel desktop', () => {
    expect(DEFAULT_WORKSPACE.layout).toBe('tri');
    expect(DEFAULT_WORKSPACE.drawerOpen).toBe(false);
    expect(WORKSPACE_LAYOUTS.map((l) => l.id)).toEqual(['tri', 'focus', 'classic']);
    expect(new Set(WORKSPACE_LAYOUTS.map((l) => l.hintKey)).size).toBe(3);
  });

  it('paints three legal columns that fill the viewport', () => {
    for (const viewport of [1200, 1366, 1440, 1920]) {
      const { nav, output, worksheet } = triWidths(viewport, DEFAULT_WORKSPACE.navW, DEFAULT_WORKSPACE.outputW);
      expect(nav).toBe(DEFAULT_WORKSPACE.navW);
      expect(output).toBeGreaterThanOrEqual(MIN_OUTPUT_W);
      expect(worksheet).toBeGreaterThanOrEqual(MIN_WORKSHEET_W);
      expect(nav + output + worksheet + 10).toBe(viewport);
    }
  });
});

describe('three-panel widths', () => {
  it('never squeezes a column below its minimum', () => {
    expect(clampOutputW(10, 1366, 254)).toBe(MIN_OUTPUT_W);
    expect(clampOutputW(5000, 1366, 254)).toBe(maxOutputW(1366, 254));
    expect(maxOutputW(1366, 254)).toBe(1366 - 254 - 10 - MIN_WORKSHEET_W);
    const narrow = triWidths(1200, 420, 4000);
    expect(narrow.nav).toBe(420);
    expect(narrow.output).toBe(1200 - 420 - 10 - MIN_WORKSHEET_W);
    expect(narrow.worksheet).toBe(MIN_WORKSHEET_W);
  });

  it('drags the navigator splitter without stealing the worksheet minimum', () => {
    const base = triWidths(1366, 254, 520);
    const wider = dragNav(1366, 254, 520, 120);
    expect(wider.nav).toBe(374);
    expect(wider.output).toBe(base.output);
    expect(wider.worksheet).toBe(base.worksheet - 120);
    const floored = dragNav(1366, 254, 520, -900);
    expect(floored.nav).toBe(180);
    expect(floored.worksheet).toBeGreaterThanOrEqual(MIN_WORKSHEET_W);
  });

  it('drags the output splitter and passes the room on to the worksheet', () => {
    const base = triWidths(1920, 254, 520);
    const grown = dragOutput(1920, 254, 520, 200);
    expect(grown.output).toBe(720);
    expect(grown.worksheet).toBe(base.worksheet - 200);
    const capped = dragOutput(1920, 254, 520, 5000);
    expect(capped.worksheet).toBe(MIN_WORKSHEET_W);
    expect(capped.nav + capped.output + capped.worksheet + 10).toBe(1920);
  });

  it('keeps the drawer inside the workspace', () => {
    expect(clampDrawerW(100, 1920)).toBe(MIN_DRAWER_W);
    expect(clampDrawerW(2000, 1920)).toBe(960);
    expect(clampDrawerW(2000, 1100)).toBe(900);
    expect(clampDrawerW(520, 1366)).toBe(520);
  });
});

describe('responsive fallback', () => {
  it('keeps three panels on a desktop and folds on a narrow one', () => {
    expect(resolveWorkspace('tri', 1920)).toBe('tri');
    expect(resolveWorkspace('tri', 1366)).toBe('tri');
    expect(resolveWorkspace('tri', 1200)).toBe('tri');
    expect(resolveWorkspace('tri', 1199)).toBe('classic');
    expect(resolveWorkspace('tri', 900)).toBe('mobile');
    expect(resolveWorkspace('focus', 1366)).toBe('focus');
    expect(resolveWorkspace('focus', 900)).toBe('mobile');
    expect(resolveWorkspace('classic', 1920)).toBe('classic');
    expect(resolveWorkspace('tri', Number.NaN)).toBe('tri');
  });
});

describe('layout switching', () => {
  it('slides the worksheet drawer in when focus mode is picked', () => {
    const focus = setWorkspaceLayout(DEFAULT_WORKSPACE, 'focus', 1920);
    expect(focus.layout).toBe('focus');
    expect(focus.drawerOpen).toBe(true);
    const still = setWorkspaceLayout(focus, 'focus', 1920);
    expect(still.drawerOpen).toBe(true);
    const tri = setWorkspaceLayout(focus, 'tri', 1920);
    expect(tri.layout).toBe('tri');
    expect(tri.outputW).toBe(focus.outputW);
  });

  it('keeps every width while moving between Classic and three panels', () => {
    const tuned = { ...DEFAULT_WORKSPACE, navW: 300, outputW: 620, outputH: 66, drawerW: 700 };
    const classic = setWorkspaceLayout(tuned, 'classic', 1920);
    expect(classic.outputW).toBe(620);
    expect(classic.outputH).toBe(66);
    const focus = setWorkspaceLayout(classic, 'focus', 1920);
    expect(focus.navW).toBe(300);
    expect(focus.drawerW).toBe(700);
    const tri = setWorkspaceLayout(focus, 'tri', 1920);
    expect(tri.navW).toBe(300);
    expect(tri.outputW).toBe(620);
    expect(tri.outputH).toBe(66);
  });

  it('re-clamps a wide output column when returning to a small screen', () => {
    const big = setWorkspaceLayout({ ...DEFAULT_WORKSPACE, outputW: 900 }, 'classic', 1920);
    const small = setWorkspaceLayout(big, 'tri', 1280);
    expect(small.outputW).toBeLessThanOrEqual(maxOutputW(1280, 254));
  });
});

describe('emphasis presets across layouts', () => {
  it('gives the sheet and results presets opposite output widths', () => {
    const sheet = applyPresetToWorkspace(DEFAULT_WORKSPACE, 'sheet', 1920);
    const results = applyPresetToWorkspace(DEFAULT_WORKSPACE, 'results', 1920);
    expect(sheet.outputW).toBeLessThan(results.outputW);
    expect(sheet.outputH).toBeLessThan(results.outputH);
    expect(sheet.navW).toBe(236);
    expect(results.navW).toBe(196);
  });

  it('leaves the layout itself alone', () => {
    const focus = setWorkspaceLayout(DEFAULT_WORKSPACE, 'focus', 1920);
    const tuned = applyPresetToWorkspace(focus, 'results', 1920);
    expect(tuned.layout).toBe('focus');
    expect(tuned.drawerOpen).toBe(true);
  });
});

describe('workspace persistence', () => {
  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const state = { ...DEFAULT_WORKSPACE, layout: 'focus' as const, navW: 288, outputW: 640, drawerW: 620, drawerOpen: true };
    expect(writeWorkspace(storage, state)).toBe(true);
    expect(readWorkspace(storage)).toEqual(state);
    expect(JSON.parse(storage.data[WORKSPACE_KEY]).layout).toBe('focus');
  });

  it('repairs a partial, broken or hostile record', () => {
    const partial = normalizeWorkspace({ layout: 'focus' });
    expect(partial.layout).toBe('focus');
    expect(partial.navW).toBe(DEFAULT_WORKSPACE.navW);
    expect(normalizeWorkspace({ layout: 'nope', navW: 5, outputH: 100 }).layout).toBe('tri');
    expect(normalizeWorkspace({ navW: 5 }).navW).toBe(180);
    expect(normalizeWorkspace({ outputH: 100 }).outputH).toBe(82);
    expect(normalizeWorkspace({ outputW: -20 }).outputW).toBe(MIN_OUTPUT_W);
    expect(normalizeWorkspace({ drawerW: 5000 }).drawerW).toBe(960);
    expect(normalizeWorkspace('garbage')).toEqual(DEFAULT_WORKSPACE);
    expect(normalizeWorkspace(null)).toEqual(DEFAULT_WORKSPACE);
    expect(readWorkspace(fakeStorage({ [WORKSPACE_KEY]: '{not json' }))).toEqual(DEFAULT_WORKSPACE);
    expect(readWorkspace(null)).toEqual(DEFAULT_WORKSPACE);
  });

  it('survives a storage that refuses to write', () => {
    const blocked = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    expect(writeWorkspace(blocked, DEFAULT_WORKSPACE)).toBe(false);
    expect(writeWorkspace(null, DEFAULT_WORKSPACE)).toBe(false);
    expect(serializeWorkspace(DEFAULT_WORKSPACE)).toContain('"layout":"tri"');
  });
});
