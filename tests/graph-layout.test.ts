import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL,
  LayoutHistory,
  PAGE_PRESETS,
  addChartPanel,
  addPanel,
  alignPanels,
  contentBox,
  createLayout,
  distributePanels,
  duplicatePanels,
  figureFileName,
  figureLabelAt,
  findFreeSpot,
  layoutSvg,
  matchSize,
  movePanels,
  nextFigureLabel,
  pageExportConfig,
  parseLayout,
  relabelFigures,
  removePanels,
  reorderPanels,
  resizePanel,
  serializeLayout,
  setPageSize,
  unifyChartStyle,
  updatePanel,
  type ChartPanel,
  type LayoutDoc,
} from '../src/lib/graphLayout';
import type { ChartSpec } from '../src/types';

const chart: ChartSpec = { kind: 'scatter', points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] };
const surface: ChartSpec = {
  kind: 'surface3d',
  xs: [0, 1],
  ys: [0, 1],
  z: [[0, 1], [1, 2]],
};

function docWithCharts(): { doc: LayoutDoc; ids: string[] } {
  let doc = createLayout('a4-landscape');
  const a = addChartPanel(doc, { outputId: 'o1', blockIndex: 0, chartIndex: 0, chart, caption: 'A' });
  doc = a.doc;
  const b = addChartPanel(doc, { outputId: 'o1', blockIndex: 1, chartIndex: 0, chart, caption: 'B' });
  doc = b.doc;
  const c = addChartPanel(doc, { outputId: 'o1', blockIndex: 2, chartIndex: 0, chart, caption: 'C' });
  doc = c.doc;
  return { doc, ids: [a.panel.id, b.panel.id, c.panel.id] };
}

describe('page presets (WO-07)', () => {
  it('offers the seven requested sizes in millimetres', () => {
    expect(PAGE_PRESETS.map((preset) => preset.id)).toEqual([
      'a4-portrait', 'a4-landscape', 'presentation-16-9', 'presentation-4-3', 'single-column', 'double-column', 'custom',
    ]);
    const a4 = PAGE_PRESETS[0];
    expect([a4.widthMm, a4.heightMm]).toEqual([210, 297]);
    const wide = PAGE_PRESETS[1];
    expect([wide.widthMm, wide.heightMm]).toEqual([297, 210]);
    const slide = PAGE_PRESETS[2];
    expect(slide.widthMm / slide.heightMm).toBeCloseTo(16 / 9, 3);
    const fourThree = PAGE_PRESETS[3];
    expect(fourThree.widthMm / fourThree.heightMm).toBeCloseTo(4 / 3, 3);
  });

  it('switches page size without moving the panels', () => {
    const { doc, ids } = docWithCharts();
    const before = doc.panels.map((panel) => ({ x: panel.x, y: panel.y }));
    const next = setPageSize(doc, 'a4-portrait');
    expect(next.page.widthMm).toBe(210);
    expect(next.page.heightMm).toBe(297);
    expect(next.panels.map((panel) => ({ x: panel.x, y: panel.y }))).toEqual(before);
    expect(ids).toHaveLength(3);
  });

  it('keeps the printable area inside the page', () => {
    const doc = createLayout('single-column');
    const box = contentBox(doc);
    expect(box.w).toBeLessThan(doc.page.widthMm);
    expect(box.w).toBe(doc.page.widthMm - doc.page.marginMm * 2);
  });
});

describe('panel geometry (WO-07)', () => {
  it('moves a panel on the grid and never off the page', () => {
    const { doc, ids } = docWithCharts();
    const moved = movePanels(doc, [ids[0]], 33, 7);
    const panel = moved.panels.find((entry) => entry.id === ids[0])!;
    // Grid snap is 2 mm by default.
    expect(panel.x % 2).toBe(0);
    expect(panel.y % 2).toBe(0);
    const pushed = movePanels(doc, [ids[0]], -1000, -1000);
    const clamped = pushed.panels.find((entry) => entry.id === ids[0])!;
    const box = contentBox(doc);
    expect(clamped.x).toBe(box.x);
    expect(clamped.y).toBe(box.y);
  });

  it('resizes from a handle and refuses to shrink past its minimum', () => {
    const created = addPanel(createLayout('a4-landscape'), 'rectangle');
    const doc = created.doc;
    const panel = created.panel;
    const grown = resizePanel(doc, panel, 'se', 20, 10);
    expect(grown.w).toBeCloseTo(panel.w + 20, 6);
    expect(grown.h).toBeCloseTo(panel.h + 10, 6);
    const shrunk = resizePanel(doc, panel, 'se', -1000, -1000);
    expect(shrunk.w).toBeGreaterThanOrEqual(6);
    expect(shrunk.h).toBeGreaterThanOrEqual(6);
    // Dragging the north-west handle moves the origin too (the panel is first
    // moved off the margin, where a resize can actually go left and up).
    const moved = movePanels(doc, [panel.id], 40, 40);
    const fromMoved = moved.panels.find((entry) => entry.id === panel.id)!;
    const nw = resizePanel(moved, fromMoved, 'nw', -10, -10);
    expect(nw.x).toBeLessThan(fromMoved.x);
    expect(nw.y).toBeLessThan(fromMoved.y);
  });

  it('finds a free spot instead of stacking new panels', () => {
    const { doc } = docWithCharts();
    const spot = findFreeSpot(doc, DEFAULT_PANEL.w, DEFAULT_PANEL.h);
    const overlaps = doc.panels.some((panel) => (
      spot.x < panel.x + panel.w && spot.x + DEFAULT_PANEL.w > panel.x && spot.y < panel.y + panel.h && spot.y + DEFAULT_PANEL.h > panel.y
    ));
    expect(overlaps).toBe(false);
  });
});

describe('arrange (WO-07)', () => {
  it('aligns the selected panels to the first one', () => {
    const { doc, ids } = docWithCharts();
    const aligned = alignPanels(doc, ids, 'left');
    const xs = aligned.panels.filter((panel) => ids.includes(panel.id)).map((panel) => panel.x);
    expect(new Set(xs).size).toBe(1);
    const middle = alignPanels(doc, ids, 'middle');
    const centres = middle.panels.filter((panel) => ids.includes(panel.id)).map((panel) => panel.y + panel.h / 2);
    centres.forEach((centre) => expect(centre).toBeCloseTo(centres[0], 6));
  });

  it('distributes three panels so the gaps are equal', () => {
    const { doc, ids } = docWithCharts();
    const spread = distributePanels(doc, ids, 'x');
    const sorted = spread.panels.filter((panel) => ids.includes(panel.id)).sort((a, b) => a.x - b.x);
    const gaps = sorted.slice(1).map((panel, index) => panel.x - (sorted[index].x + sorted[index].w));
    expect(gaps[0]).toBeCloseTo(gaps[1], 6);
    expect(distributePanels(doc, [ids[0], ids[1]], 'x')).toEqual(doc);
  });

  it('matches every selected panel to the first one', () => {
    const { doc, ids } = docWithCharts();
    const sized = matchSize(doc, ids);
    const sizes = sized.panels.filter((panel) => ids.includes(panel.id)).map((panel) => `${panel.w}x${panel.h}`);
    expect(new Set(sizes).size).toBe(1);
  });

  it('duplicates a panel onto the stack and deletes by id', () => {
    const { doc, ids } = docWithCharts();
    const copy = duplicatePanels(doc, [ids[0]]);
    expect(copy.doc.panels).toHaveLength(doc.panels.length + 1);
    const clone = copy.doc.panels.find((panel) => panel.id === copy.ids[0])!;
    expect(clone.x).toBeGreaterThan(doc.panels[0].x);
    expect(clone.z).toBeGreaterThan(doc.panels[0].z);
    const removed = removePanels(doc, [ids[1]]);
    expect(removed.panels).toHaveLength(doc.panels.length - 1);
  });

  it('reorders the stack in all four directions', () => {
    const { doc, ids } = docWithCharts();
    const ordered = doc.panels.map((panel) => panel.id);
    const front = reorderPanels(doc, [ids[0]], 'front');
    expect([...front.panels].sort((a, b) => a.z - b.z).map((panel) => panel.id)).toEqual([...ordered.slice(1), ids[0]]);
    const back = reorderPanels(doc, [ids[0]], 'back');
    expect([...back.panels].sort((a, b) => a.z - b.z)[0].id).toBe(ids[0]);
    const forward = reorderPanels(doc, [ids[0]], 'forward');
    expect([...forward.panels].sort((a, b) => a.z - b.z).map((panel) => panel.id)).toEqual([ids[1], ids[0], ids[2]]);
    const backward = reorderPanels(doc, [ids[2]], 'backward');
    expect([...backward.panels].sort((a, b) => a.z - b.z).map((panel) => panel.id)).toEqual([ids[0], ids[2], ids[1]]);
  });

  it('applies one chart style to every chart panel', () => {
    const { doc, ids } = docWithCharts();
    const unified = unifyChartStyle(doc, { preset: 'dark', fontSize: 9 });
    unified.panels.forEach((panel) => {
      if (panel.kind !== 'chart') return;
      expect(panel.config?.appearance?.preset).toBe('dark');
      expect(panel.chart.config?.appearance?.preset).toBe('dark');
      expect(panel.config?.appearance?.fontSize).toBe(9);
    });
    expect(ids).toHaveLength(3);
  });
});

describe('annotations (WO-07)', () => {
  it('inserts every annotation kind with a usable box', () => {
    let doc = createLayout('a4-landscape');
    const kinds = ['text', 'arrow', 'line', 'rectangle', 'circle', 'highlight', 'figure-label'] as const;
    kinds.forEach((kind) => {
      const added = addPanel(doc, kind);
      doc = added.doc;
      expect(added.panel.kind).toBe(kind);
      expect(added.panel.w).toBeGreaterThan(0);
      expect(added.panel.h).toBeGreaterThan(0);
    });
    expect(doc.panels).toHaveLength(kinds.length);
  });

  it('labels figures (a), (b), (c) … and renumbers in reading order', () => {
    expect(figureLabelAt(0)).toBe('(a)');
    expect(figureLabelAt(25)).toBe('(z)');
    expect(figureLabelAt(26)).toBe('(aa)');
    let doc = createLayout('a4-landscape');
    doc = addPanel(doc, 'figure-label').doc;
    expect(nextFigureLabel(doc)).toBe('(b)');
    const second = addPanel(doc, 'figure-label');
    doc = movePanels(second.doc, [second.panel.id], 10, -400).panels.length ? { ...second.doc } : second.doc;
    const relabelled = relabelFigures(doc);
    const labels = relabelled.panels.filter((panel) => panel.kind === 'figure-label');
    expect(labels.map((panel) => panel.kind === 'figure-label' && panel.label)).toEqual(['(a)', '(b)']);
  });

  it('updates panel properties without touching the others', () => {
    const doc = addPanel(createLayout('a4-landscape'), 'text').doc;
    const id = doc.panels[0].id;
    const next = updatePanel(doc, id, { text: 'Scale bar 10 µm' } as never);
    expect(next.panels[0]).toMatchObject({ text: 'Scale bar 10 µm' });
  });
});

describe('undo / redo (WO-07)', () => {
  it('walks back and forward through whole documents', () => {
    const start = createLayout('a4-landscape');
    const history = new LayoutHistory(start);
    const withText = addPanel(history.state(), 'text').doc;
    history.push(withText);
    expect(history.state().panels).toHaveLength(1);
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(history.state().panels).toHaveLength(0);
    history.redo();
    expect(history.state().panels).toHaveLength(1);
    expect(history.canRedo).toBe(false);
  });

  it('does not create a step when nothing changed', () => {
    const doc = createLayout('a4-landscape');
    const history = new LayoutHistory(doc);
    history.push({ ...doc });
    expect(history.canUndo).toBe(false);
  });
});

describe('save and restore (WO-07)', () => {
  it('round-trips a layout with charts, annotations and page settings', () => {
    const { doc } = docWithCharts();
    let full = updatePanel(doc, doc.panels[0].id, { caption: 'Yield vs speed' } as Partial<ChartPanel>);
    full = addPanel(full, 'figure-label').doc;
    full = addPanel(full, 'text').doc;
    const restored = parseLayout(serializeLayout(full));
    expect(restored).not.toBeNull();
    expect(restored!.panels).toHaveLength(full.panels.length);
    expect(restored!.page).toEqual(full.page);
    expect(restored!.panels.find((panel) => panel.kind === 'chart')).toMatchObject({ caption: 'Yield vs speed' });
  });

  it('rejects a file that is not a layout', () => {
    expect(parseLayout('not json')).toBeNull();
    expect(parseLayout('{"format":"sigrun-project"}')).toBeNull();
    const partial = parseLayout(JSON.stringify({ format: 'sigrun-layout', page: {}, panels: [{ kind: 'nope' }, { kind: 'text', x: 1, y: 2, w: 10, h: 5, text: 'ok' }] }));
    expect(partial?.panels).toHaveLength(1);
  });
});

describe('figure export (WO-07)', () => {
  const render = (panel: ChartPanel) => ({
    svg: `<svg class="chart-svg" viewBox="0 0 560 300" width="100%" height="300">${panel.caption}</svg>`,
  });

  it('writes a page in millimetres with every panel inside it', () => {
    const { doc } = docWithCharts();
    const svg = layoutSvg(doc, render);
    expect(svg).toContain('width="297mm"');
    expect(svg).toContain('height="210mm"');
    expect(svg).toContain('viewBox="0 0 297 210"');
    expect(svg).toContain('data-panels="3"');
    expect((svg.match(/<svg x=/g) ?? []).length).toBe(3);
  });

  it('marks a 3D surface panel as a raster source and leaves vector panels vector', () => {
    let doc = createLayout('a4-landscape');
    const flat = addChartPanel(doc, { outputId: 'o', blockIndex: 0, chartIndex: 0, chart, caption: 'Scatter' });
    doc = flat.doc;
    const surfacePanel = addChartPanel(doc, { outputId: 'o', blockIndex: 1, chartIndex: 0, chart: surface, caption: 'Surface' });
    doc = surfacePanel.doc;
    expect(surfacePanel.panel.raster).toBe(true);
    const svg = layoutSvg(doc, render);
    expect(svg).toContain(`data-raster="${surfacePanel.panel.id}"`);
    expect(svg).not.toContain(`data-raster="${flat.panel.id}"`);
  });

  it('draws annotations as real SVG, not as placeholders', () => {
    let doc = createLayout('a4-landscape');
    doc = addPanel(doc, 'text').doc;
    doc = updatePanel(doc, doc.panels[0].id, { text: 'Figure 3. Yield response' } as never);
    doc = addPanel(doc, 'arrow').doc;
    doc = addPanel(doc, 'rectangle').doc;
    doc = addPanel(doc, 'circle').doc;
    doc = addPanel(doc, 'figure-label').doc;
    doc = addPanel(doc, 'highlight').doc;
    const svg = layoutSvg(doc, render);
    expect(svg).toContain('Figure 3. Yield response');
    expect(svg).toContain('marker-end="url(#sigrun-arrow)"');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('(a)');
    expect(svg).toContain('data-kind="highlight"');
  });

  it('exports at the page size and the requested DPI', () => {
    const doc = createLayout('a4-portrait');
    const config = pageExportConfig(doc, 'png', 600);
    expect(config.physicalWidth).toBe(210);
    expect(config.physicalHeight).toBe(297);
    expect(config.physicalUnit).toBe('mm');
    expect(config.dpi).toBe(600);
    expect(figureFileName(doc, 'png', 600)).toBe('statelia-figure-a4-portrait-600dpi.png');
    expect(figureFileName(doc, 'svg')).toBe('statelia-figure-a4-portrait.svg');
  });

  it('says a chart is missing rather than dropping the panel silently', () => {
    const { doc } = docWithCharts();
    const svg = layoutSvg(doc, () => null);
    expect(svg).toContain('chart unavailable');
    expect(svg).toContain('data-panels="3"');
  });
});
