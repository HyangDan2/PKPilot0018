import { describe, expect, it } from 'vitest';
import {
  LAYOUT_PRESETS,
  clampFloatPosition,
  clampNav,
  clampOutput,
  findPreset,
  floatRect,
} from '../src/lib/layout';

describe('layout presets', () => {
  it('offers four distinct one-click arrangements', () => {
    expect(LAYOUT_PRESETS.map((p) => p.id)).toEqual(['balanced', 'sheet', 'results', 'focus']);
    expect(new Set(LAYOUT_PRESETS.map((p) => p.labelKey)).size).toBe(LAYOUT_PRESETS.length);
    for (const preset of LAYOUT_PRESETS) {
      expect(preset.labelKey.startsWith('view.layout.')).toBe(true);
      expect(clampNav(preset.navWidth)).toBe(preset.navWidth);
      expect(clampOutput(preset.outputHeight)).toBe(preset.outputHeight);
    }
  });

  it('gives the sheet and results presets opposite emphasis', () => {
    const sheet = findPreset('sheet');
    const results = findPreset('results');
    expect(sheet.outputHeight).toBeLessThan(results.outputHeight);
    expect(sheet.navHidden).toBe(false);
    expect(results.navHidden).toBe(false);
    expect(findPreset('focus').navHidden).toBe(true);
    expect(findPreset('unknown-id').id).toBe('balanced');
  });

  it('clamps pane sizes to the draggable range', () => {
    expect(clampNav(10)).toBe(180);
    expect(clampNav(900)).toBe(430);
    expect(clampOutput(1)).toBe(18);
    expect(clampOutput(99)).toBe(82);
  });
});

describe('floating panel geometry', () => {
  it('starts inside a 1440×900 viewport', () => {
    for (const id of ['navigator', 'output', 'worksheet'] as const) {
      const rect = floatRect(id, 1440, 900);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(1440);
      expect(rect.y + rect.h).toBeLessThanOrEqual(900);
    }
  });

  it('fits a 320px phone without overflowing sideways', () => {
    const rect = floatRect('output', 320, 700);
    expect(rect.w).toBeLessThanOrEqual(320 - 16);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(320);
  });

  it('keeps a dragged panel reachable', () => {
    expect(clampFloatPosition(-900, -40, 700, 1440, 900)).toEqual({ x: -(700 - 96), y: 0 });
    expect(clampFloatPosition(5000, 5000, 700, 1440, 900)).toEqual({ x: 1440 - 96, y: 900 - 44 });
  });
});
