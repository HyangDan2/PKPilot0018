import { describe, expect, it } from 'vitest';
import { renderChart, sampleCustomStops } from '../src/lib/charts';
import { mergeChartConfig } from '../src/lib/chartConfig';
import { sanitizeChartConfig } from '../src/lib/chartGuards';
import type { ChartSpec } from '../src/types';

/** A tilted plane z = x + y over 0…10, which gives ten clean bands. */
const xs = Array.from({ length: 11 }, (_, i) => i);
const ys = Array.from({ length: 11 }, (_, i) => i);
const plane: ChartSpec = {
  kind: 'contour',
  xs,
  ys,
  z: ys.map((y) => xs.map((x) => x + y)),
  xLabel: 'x',
  yLabel: 'y',
};

const config = (contour: Record<string, unknown>) => mergeChartConfig(undefined, { contour: contour as never });

describe('contour colour map (WO-08)', () => {
  it('interpolates a user colour map between its stops', () => {
    const stops = [
      { value: 0, color: '#000000' },
      { value: 10, color: '#ffffff' },
    ];
    expect(sampleCustomStops(stops, -5)).toBe('#000000');
    expect(sampleCustomStops(stops, 15)).toBe('#ffffff');
    expect(sampleCustomStops(stops, 5)).toBe('#808080');
    expect(sampleCustomStops(stops, 2.5)).toBe('#404040');
  });

  it('paints the bands with the user map instead of the palette', () => {
    const svg = renderChart(plane, {
      width: 560,
      config: config({ renderMode: 'filled', customStops: [{ value: 0, color: '#ff0000' }, { value: 20, color: '#0000ff' }] }),
    });
    const fills = [...svg.matchAll(/data-chart-role="chart-contour-band"[^>]*fill="([^"]+)"/g)].map((match) => match[1]);
    expect(fills.length).toBeGreaterThan(2);
    const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const first = rgb(fills[0]);
    const last = rgb(fills[fills.length - 1]);
    // The lowest band is (nearly) the red stop and the highest (nearly) the blue
    // one: the band colour is sampled at the band's own value, not at an index.
    expect(first[0]).toBeGreaterThan(200);
    expect(first[2]).toBeLessThan(60);
    expect(last[2]).toBeGreaterThan(200);
    expect(last[0]).toBeLessThan(60);
    fills.forEach((fill) => expect(fill).toMatch(/^#[0-9a-f]{6}$/));
  });

  it('gives one band its own colour ahead of the map', () => {
    const svg = renderChart(plane, {
      width: 560,
      config: config({
        renderMode: 'filled',
        colormap: 'viridis',
        levelStyles: [{ index: 3, color: '#ff00aa' }],
      }),
    });
    expect(svg).toContain('data-band="3"');
    expect(svg).toContain('fill="#ff00aa"');
  });

  it('paints the underflow and overflow bands in their own colours', () => {
    const svg = renderChart(plane, {
      width: 560,
      config: config({ renderMode: 'filled', levelCount: 4, underflowColor: '#123456', overflowColor: '#654321' }),
    });
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill="#654321"');
  });

  it('draws a masked (NaN) region only when asked', () => {
    const holed: ChartSpec = {
      ...plane,
      z: plane.kind === 'contour' ? plane.z.map((row, j) => row.map((value, i) => (i > 4 && j > 4 ? Number.NaN : value))) : [],
    };
    const blank = renderChart(holed, { width: 560 });
    expect(blank).not.toContain('chart-mask-layer');
    const hatch = renderChart(holed, { width: 560, config: config({ maskedStyle: 'hatch' }) });
    expect(hatch).toContain('chart-mask-layer');
    expect(hatch).toContain('id="sigrun-mask-');
    const gray = renderChart(holed, { width: 560, config: config({ maskedStyle: 'gray' }) });
    expect(gray).toContain('data-chart-role="chart-mask"');
    expect(gray).not.toContain('pattern id="sigrun-mask-');
  });
});

describe('per-level line style and labels (WO-08)', () => {
  it('sets the width, dash and colour of one level without touching the others', () => {
    const svg = renderChart(plane, {
      width: 560,
      config: config({
        renderMode: 'filled-lines',
        lineWidth: 1,
        levelStyles: [
          { index: 2, lineWidth: 3.5, lineDash: '7 2', lineColor: '#aa0000' },
          { index: 4, lineWidth: 0.5 },
        ],
      }),
    });
    const line2 = /data-level-index="2"[^>]*stroke="([^"]+)" stroke-width="([\d.]+)"([^>]*)/.exec(svg);
    expect(line2?.[1]).toBe('#aa0000');
    expect(Number(line2?.[2])).toBeCloseTo(3.5, 6);
    expect(line2?.[3]).toContain('stroke-dasharray="7 2"');
    const line4 = /data-level-index="4"[^>]*stroke-width="([\d.]+)"/.exec(svg);
    expect(Number(line4?.[1])).toBeCloseTo(0.5, 6);
  });

  it('turns a label off for one level and on for the rest', () => {
    const svg = renderChart(plane, {
      width: 560,
      config: config({
        showContourLabels: true,
        levelStyles: [{ index: 1, showLabel: false }, { index: 2, showLabel: true }],
      }),
    });
    const labelled = [...svg.matchAll(/data-chart-role="chart-contour-label" data-level-index="(\d+)"/g)].map((match) => match[1]);
    expect(labelled).not.toContain('1');
    expect(labelled).toContain('2');
  });

  it('prints the label with the requested font size and decimals', () => {
    const svg = renderChart(plane, {
      width: 560,
      config: config({ showContourLabels: true, labelFontSize: 11.5, labelDecimals: 1 }),
    });
    const label = /data-chart-role="chart-contour-label"[^>]*font-size="([\d.]+)"[^>]*>([^<]+)</.exec(svg);
    expect(Number(label?.[1])).toBeCloseTo(11.5, 6);
    expect(label?.[2]).toMatch(/^\d+\.\d$/);
  });
});

describe('series options (WO-08)', () => {
  const line: ChartSpec = {
    kind: 'line',
    series: [
      { label: 'A', points: [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 3 }] },
      { label: 'B', points: [{ x: 1, y: 5 }, { x: 2, y: 1 }, { x: 3, y: 6 }] },
    ],
  };

  it('fills the area under a line to the axis baseline', () => {
    const svg = renderChart(line, { width: 560, config: mergeChartConfig(undefined, { seriesAdvanced: { areaFill: true, areaOpacity: 0.4 } }) });
    const areas = svg.match(/data-chart-role="chart-area"/g) ?? [];
    expect(areas).toHaveLength(2);
    expect(svg).toContain('opacity="0.4"');
  });

  it('draws a drop line from every point to the x axis', () => {
    const svg = renderChart(line, { width: 560, config: mergeChartConfig(undefined, { seriesAdvanced: { dropLines: true, dropLineColor: '#334155' } }) });
    expect((svg.match(/data-chart-role="chart-drop-line"/g) ?? [])).toHaveLength(6);
    expect(svg).toContain('stroke="#334155"');
  });

  it('draws the series in the requested order and follows it in the legend', () => {
    const svg = renderChart(line, {
      width: 560,
      config: mergeChartConfig(undefined, { legend: { position: 'right', visible: true }, seriesAdvanced: { order: [1, 0] } }),
    });
    const polylines = [...svg.matchAll(/data-chart-role="chart-series"[^>]*stroke="([^"]+)"/g)].map((match) => match[1]);
    expect(polylines).toHaveLength(2);
    // Series 1 is drawn first, so it carries the second palette colour.
    expect(polylines[0]).not.toBe(polylines[1]);
    const legend = /data-chart-role="legend"[\s\S]*?<\/g>/.exec(svg)?.[0] ?? '';
    expect(legend.indexOf('B')).toBeLessThan(legend.indexOf('A'));
  });

  it('gives one plotted point its own shape, size and colour', () => {
    const svg = renderChart(line, {
      width: 560,
      config: mergeChartConfig(undefined, {
        seriesAdvanced: { pointStyles: { 1: { shape: 'square', size: 7, color: '#ff00ff' } } },
      }),
    });
    expect(svg).toContain('fill="#ff00ff"');
    // Exactly one point changed: the override wins over both the series look
    // and the style preset's marker cycle.
    expect((svg.match(/fill="#ff00ff"/g) ?? []).length).toBe(1);
    const styled = /<rect[^>]*fill="#ff00ff"[^>]*>/.exec(svg)?.[0] ?? '';
    expect(styled).toContain('width="14.0"');
    expect(svg).toContain('data-x="2" data-y="4"');
  });

  it('refuses hostile values in the advanced block', () => {
    const merged = mergeChartConfig(undefined, {
      seriesAdvanced: {
        areaOpacity: 12,
        errorBars: { kind: 'median' as never, conf: 4, capWidth: 99 },
        order: [3, 3, -1, 0],
        pointStyles: { 2: { size: 900, shape: 'star' as never } },
      },
    });
    const clean = sanitizeChartConfig(merged).seriesAdvanced!;
    expect(clean.areaOpacity).toBe(1);
    expect(clean.errorBars?.kind).toBe('none');
    expect(clean.errorBars?.conf).toBe(0.999);
    expect(clean.errorBars?.capWidth).toBe(20);
    expect(clean.order).toEqual([3, 3, 0]);
    expect(clean.pointStyles?.[2].size).toBe(30);
    expect(clean.pointStyles?.[2].shape).toBe('circle');
  });
});
