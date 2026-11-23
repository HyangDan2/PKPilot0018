import { describe, expect, it } from 'vitest';
import {
  LAYOUT_PRESETS,
  clampFloatPosition,
  clampFloatSize,
  clampNav,
  clampOutput,
  findPreset,
  fitFloatRect,
  floatRect,
  resizeFloatRect,
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

  it('reopens a re-detached panel at the size it was last resized to', () => {
    const rect = floatRect('output', 1440, 900, { w: 900, h: 620 });
    expect(rect.w).toBe(900);
    expect(rect.h).toBe(620);
    expect(rect.x + rect.w).toBeLessThanOrEqual(1440);
    expect(rect.y + rect.h).toBeLessThanOrEqual(900);
    const clamped = floatRect('output', 1100, 700, { w: 4000, h: 4000 });
    expect(clamped.w).toBe(1084);
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(1100);
  });
});

describe('floating panel resize', () => {
  const base = { x: 300, y: 100, w: 780, h: 560 };

  it('grows from the bottom-right corner by exactly the drag distance', () => {
    expect(resizeFloatRect('output', base, 'se', 120, 80, 1440, 900)).toEqual({ x: 300, y: 100, w: 900, h: 640 });
  });

  it('never shrinks below the panel minimum size', () => {
    expect(resizeFloatRect('output', base, 'se', -2000, -2000, 1440, 900)).toEqual({ x: 300, y: 100, w: 360, h: 240 });
    expect(resizeFloatRect('navigator', { x: 100, y: 100, w: 306, h: 452 }, 'se', -2000, -2000, 1440, 900)).toEqual({ x: 100, y: 100, w: 240, h: 240 });
  });

  it('stops the moving edge at the viewport boundary', () => {
    expect(resizeFloatRect('output', base, 'se', 5000, 5000, 1440, 900)).toEqual({ x: 300, y: 100, w: 1132, h: 792 });
    expect(resizeFloatRect('output', base, 'e', 5000, 0, 1440, 900)).toEqual({ x: 300, y: 100, w: 1132, h: 560 });
  });

  it('keeps the opposite edge fixed when dragging west or north', () => {
    const west = resizeFloatRect('output', base, 'w', -100, 0, 1440, 900);
    expect(west).toEqual({ x: 200, y: 100, w: 880, h: 560 });
    expect(west.x + west.w).toBe(base.x + base.w);
    const north = resizeFloatRect('output', base, 'n', 0, -100, 1440, 900);
    expect(north).toEqual({ x: 300, y: 8, w: 780, h: 652 });
    expect(north.y + north.h).toBe(base.y + base.h);
    // y is pulled to the 8px margin when the requested edge would leave the viewport
    expect(resizeFloatRect('output', base, 'n', 0, 5000, 1440, 900).h).toBe(240);
    expect(resizeFloatRect('output', base, 'n', 0, -5000, 1440, 900).y).toBe(8);
  });

  it('clamps a requested size to the panel minimum and the viewport', () => {
    expect(clampFloatSize('output', 100, 100, 100, 100, 1440, 900)).toEqual({ w: 360, h: 240 });
    expect(clampFloatSize('output', 2000, 2000, 100, 100, 1440, 900)).toEqual({ w: 1332, h: 792 });
  });

  it('pulls a window fully back on screen when the viewport shrinks', () => {
    expect(fitFloatRect({ x: 900, y: 700, w: 780, h: 560 }, 1024, 768)).toEqual({ x: 236, y: 200, w: 780, h: 560 });
    expect(fitFloatRect({ x: -100, y: -20, w: 2000, h: 1500 }, 1440, 900)).toEqual({ x: 8, y: 8, w: 1424, h: 884 });
  });
});
