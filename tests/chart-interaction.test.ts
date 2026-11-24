import { describe, expect, it } from 'vitest';
import {
  boxZoom,
  nearestElement,
  panViewport,
  pixelToValue,
  rowsFromElement,
  selectedRowsCsv,
  selectionCompatible,
  sourceKey,
  stepElement,
  toggleRows,
  viewportConfig,
  viewportIsBase,
  zoomViewport,
  type PlotRect,
  type Viewport,
} from '../src/lib/chartInteraction';

const rect: PlotRect = { x: 50, y: 20, w: 400, h: 240, xScale: 'linear', yScale: 'linear' };
const base: Viewport = { x: [0, 100], y: [0, 200] };

describe('box zoom and pan (WO-09)', () => {
  it('turns a dragged rectangle into the new domain', () => {
    const zoomed = boxZoom(base, rect, { x: 150, y: 80 }, { x: 250, y: 140 });
    expect(zoomed).not.toBeNull();
    // x: 150 px is a quarter into the plot, 250 px is half way.
    expect(zoomed!.x[0]).toBeCloseTo(25, 6);
    expect(zoomed!.x[1]).toBeCloseTo(50, 6);
    // Screen y grows downwards, so the top of the rectangle is the larger value.
    expect(zoomed!.y[0]).toBeCloseTo(100, 6);
    expect(zoomed!.y[1]).toBeCloseTo(150, 6);
  });

  it('treats a tiny drag as a click', () => {
    expect(boxZoom(base, rect, { x: 150, y: 80 }, { x: 152, y: 81 })).toBeNull();
  });

  it('zooms in the axis\'s own coordinates on a log scale', () => {
    const logRect: PlotRect = { ...rect, xScale: 'log10' };
    const logBase: Viewport = { x: [1, 1000], y: [0, 10] };
    const zoomed = boxZoom(logBase, logRect, { x: rect.x + rect.w / 3, y: rect.y }, { x: rect.x + (2 * rect.w) / 3, y: rect.y + rect.h });
    // One third and two thirds of a log axis spanning three decades are 10 and 100.
    expect(zoomed!.x[0]).toBeCloseTo(10, 4);
    expect(zoomed!.x[1]).toBeCloseTo(100, 4);
  });

  it('pans by a pixel delta and keeps the span', () => {
    // Dragging the content to the right reveals data to the left of it.
    const panned = panViewport(base, rect, 40, 0);
    expect(panned.x[1] - panned.x[0]).toBeCloseTo(100, 9);
    expect(panned.x[0]).toBeCloseTo(-10, 9);
    // Dragging the content down moves the window up, to larger values.
    const down = panViewport(base, rect, 0, 60);
    expect(down.y[0]).toBeCloseTo(50, 6);
    expect(down.y[1]).toBeCloseTo(250, 6);
  });

  it('zooms around the pointer so the value under it stays put', () => {
    const anchor = { x: rect.x + rect.w * 0.25, y: rect.y + rect.h * 0.5 };
    const before = pixelToValue(anchor.x, rect, base, 'x', 'linear');
    const zoomed = zoomViewport(base, rect, 0.5, anchor);
    const after = pixelToValue(anchor.x, rect, zoomed, 'x', 'linear');
    expect(after).toBeCloseTo(before, 6);
    expect(zoomed.x[1] - zoomed.x[0]).toBeCloseTo(50, 6);
  });

  it('knows when the view is back at its base', () => {
    expect(viewportIsBase(base, base)).toBe(true);
    expect(viewportIsBase({ x: [1, 100], y: [0, 200] }, base)).toBe(false);
  });

  it('writes the view into axis limits so the renderer draws that window', () => {
    const config = viewportConfig({ xAxis: { decimals: 2 } }, { x: [10, 20], y: [5, 6] });
    expect(config.xAxis).toMatchObject({ min: 10, max: 20, autoRange: false, decimals: 2 });
    expect(config.yAxis).toMatchObject({ min: 5, max: 6, autoRange: false });
    expect(viewportConfig(undefined, null)).toEqual({});
  });
});

describe('selection (WO-09)', () => {
  const element = (attributes: Record<string, string>) => {
    const node = { getAttribute: (name: string) => attributes[name] ?? null } as unknown as Element;
    return node;
  };

  it('reads one row or a list of rows from a plotted element', () => {
    expect(rowsFromElement(element({ 'data-row': '7' }))).toEqual([7]);
    expect(rowsFromElement(element({ 'data-rows': '3,4,5' }))).toEqual([3, 4, 5]);
    expect(rowsFromElement(element({ 'data-rows': '3,x,5' }))).toEqual([3, 5]);
    expect(rowsFromElement(element({}))).toEqual([]);
    expect(rowsFromElement(null)).toEqual([]);
  });

  it('adds, removes and replaces a selection', () => {
    expect(toggleRows([1, 5], [5, 7], true)).toEqual([1, 5, 7]);
    // Clicking an already selected set removes it.
    expect(toggleRows([1, 5, 7], [5, 7], true)).toEqual([1]);
    // A plain click replaces the selection.
    expect(toggleRows([1, 5], [9], false)).toEqual([9]);
    expect(toggleRows([1], [], true)).toEqual([1]);
  });

  it('links charts only when they read the same sheet and columns', () => {
    const a = { sheetId: 's1', xColumnId: 'c1', yColumnId: 'c2' };
    const swapped = { sheetId: 's1', xColumnId: 'c2', yColumnId: 'c1' };
    expect(selectionCompatible(a, { ...a })).toBe(true);
    expect(selectionCompatible(a, swapped)).toBe(true);
    expect(selectionCompatible(a, { sheetId: 's2', xColumnId: 'c1', yColumnId: 'c2' })).toBe(false);
    expect(selectionCompatible(a, { sheetId: 's1', xColumnId: 'c1', yColumnId: 'c9' })).toBe(false);
    expect(selectionCompatible(a, { sheetId: 's1' })).toBe(false);
    expect(selectionCompatible(undefined, a)).toBe(false);
    expect(sourceKey(a)).toBe('s1:c1:c2');
    expect(sourceKey(undefined)).toBeNull();
  });

  it('exports exactly the selected worksheet rows', () => {
    const columns = [
      { name: 'Run', values: [1, 2, 3, 4] },
      { name: 'Note', values: ['a', 'b,c', 'd"e', null] },
    ];
    const csv = selectedRowsCsv(columns, [3, 1]);
    expect(csv.split('\r\n')).toEqual(['Run,Note', '4,', '2,"b,c"']);
    expect(selectedRowsCsv(columns, [])).toBe('Run,Note');
  });

  it('finds the nearest point and walks the cursor around the ends', () => {
    const positions = [
      { index: 0, x: 10, y: 10 },
      { index: 1, x: 50, y: 50 },
      { index: 2, x: 90, y: 90 },
    ];
    expect(nearestElement(positions, { x: 52, y: 48 })).toBe(1);
    expect(nearestElement(positions, { x: 300, y: 300 })).toBeNull();
    expect(stepElement(null, 3, 1)).toBe(0);
    expect(stepElement(2, 3, 1)).toBe(0);
    expect(stepElement(0, 3, -1)).toBe(2);
    expect(stepElement(1, 3, -1)).toBe(0);
    expect(stepElement(null, 0, 1)).toBeNull();
  });
});
