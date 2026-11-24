import { describe, expect, it } from 'vitest';
import { boxplotStats, renderChart, ticks } from '../src/lib/charts';
import { capability } from '../src/lib/capability';
import { DATASETS } from '../src/lib/datasets';
import { imrChart, pChart, xbarRCharts } from '../src/lib/spc';
import type { ChartSpec } from '../src/types';

const values = [10.1, 9.8, 10.3, 10.0, 9.9, 10.2, 10.4, 9.7, 10.1, 10.0];

/** Deterministic standard-normal sample (Box–Muller on an LCG). */
function normalSample(n: number, mean = 10, sd = 0.25, seed = 20261122): number[] {
  let state = seed;
  const rnd = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return (state / 2147483648) || 0.5;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const u = rnd();
    const v = rnd();
    out.push(mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
  }
  return out;
}

/** Every vertical specification guide in a chart: [x, y1, y2]. */
function specLines(svg: string): { x1: number; y1: number; x2: number; y2: number }[] {
  return [...svg.matchAll(/<line class="spec-line" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g)].map((m) => ({
    x1: Number(m[1]),
    y1: Number(m[2]),
    x2: Number(m[3]),
    y2: Number(m[4]),
  }));
}

/** Bar rectangles of a histogram/capability chart. */
function bars(svg: string): { x: number; y: number; w: number }[] {
  return [...svg.matchAll(/<rect class="chart-bar" data-point="1" data-chart-role="chart-bar"[^>]*? x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="[\d.]+"/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
  }));
}

describe('SVG chart renderers', () => {
  const capabilityResult = capability(values, { lsl: 9.4, usl: 10.8, target: 10.1 });
  const imr = imrChart(values);

  const specs: ChartSpec[] = [
    { kind: 'histogram', values, normal: true, lsl: 9.4, usl: 10.8, target: 10.1, xLabel: 'Thickness' },
    { kind: 'boxplot', groups: [{ label: 'A', values }, { label: 'B', values: values.map((v) => v + 0.4) }] },
    { kind: 'scatter', points: values.map((v, i) => ({ x: i + 1, y: v })), fit: { intercept: 10, slope: 0.01 }, xLabel: 'x', yLabel: 'y' },
    { kind: 'timeseries', values, lsl: 9.4, usl: 10.8 },
    {
      kind: 'normalprob',
      points: values.map((v, i) => ({ x: v, y: (i - 4.5) / 2 })),
      fit: { intercept: -10 / 0.2, slope: 1 / 0.2 },
      ci: values.map((v) => ({ x: v, lo: -2, hi: 2 })),
      ad: 0.4,
      p: 0.3,
    },
    { kind: 'control', panel: imr.panels[0] },
    { kind: 'pareto', items: [{ label: 'Scratch', count: 12 }, { label: 'Dent', count: 7 }, { label: 'Stain', count: 3 }] },
    { kind: 'capability', result: capabilityResult },
    { kind: 'interval', groups: [{ label: 'A', mean: 10, lo: 9.8, hi: 10.2, n: 5 }] },
  ];

  it.each(specs.map((spec) => [spec.kind, spec] as const))('renders %s as a clean SVG', (kind, spec) => {
    expect(kind).toBeTruthy();
    const svg = renderChart(spec);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('viewBox');
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('undefined');
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
  });

  it('brackets every domain so spec limits stay inside the plot', () => {
    const cases: [number, number][] = [[9.487, 10.916], [0, 0.7555], [-12.4, 3.2], [0.001, 0.999]];
    cases.forEach(([min, max]) => {
      const t = ticks(min, max, 5);
      expect(t[0]).toBeLessThanOrEqual(min + 1e-9);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max - 1e-9);
    });
  });

  it('marks out-of-control points with the rule number', () => {
    const unstable = imrChart([10, 10.1, 9.9, 10, 10.2, 9.8, 10.1, 10, 9.9, 11.8]);
    const svg = renderChart({ kind: 'control', panel: unstable.panels[0] });
    expect(svg).toContain('chart-point-alarm');
    expect(/<text[^>]*>1<\/text>/.test(svg) || /<text[^>]*>1,2<\/text>/.test(svg)).toBe(true);
  });
});

describe('histogram geometry', () => {
  it('draws LSL, USL and Target as vertical lines across the plot', () => {
    const svg = renderChart({ kind: 'histogram', values, bins: 8, lsl: 9.4, usl: 10.8, target: 10.1 });
    const lines = specLines(svg);
    expect(lines).toHaveLength(3);
    lines.forEach((line) => {
      expect(line.x1).toBe(line.x2); // vertical, not horizontal
      expect(line.y2).toBeGreaterThan(line.y1);
      expect(line.x1).toBeGreaterThanOrEqual(54);
      expect(line.x1).toBeLessThanOrEqual(540);
    });
    expect(svg).toContain('LSL 9.4');
    expect(svg).toContain('USL 10.8');
    expect(svg).toContain('Target 10.1');
    // LSL < Target < USL, left to right.
    expect(lines[0].x1).toBeLessThan(lines[1].x1);
    expect(lines[1].x1).toBeLessThan(lines[2].x1);
  });

  it('keeps a target outside the data range inside the plot domain', () => {
    const data = [9.9, 10, 10.05, 10.1, 9.95, 10.02];
    const svg = renderChart({ kind: 'histogram', values: data, target: 12 });
    const lines = specLines(svg);
    expect(lines).toHaveLength(1);
    expect(lines[0].x1).toBeLessThanOrEqual(540);
    expect(lines[0].x1).toBeGreaterThan(54 + 0.6 * (540 - 54));
  });

  it('places bars on their real bin boundaries', () => {
    const data = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
    const svg = renderChart({ kind: 'histogram', values: data, bins: 9 });
    const rects = bars(svg);
    expect(rects).toHaveLength(9);
    // box.x = 54, plot width 486; the domain is padded 4% of the 0–90 span.
    const boxX = 54;
    const boxW = 560 - 74;
    const lo = -3.6;
    const hi = 93.6;
    const sx = (v: number) => boxX + ((v - lo) / (hi - lo)) * boxW;
    rects.forEach((rect, i) => {
      expect(rect.x).toBeCloseTo(sx(i * 10) + 0.4, 1);
      expect(rect.w).toBeCloseTo(sx((i + 1) * 10) - sx(i * 10) - 0.8, 1);
    });
  });

  it('scales the normal curve with the real bin width, not the padded domain', () => {
    // The limits sit far outside the data, so a curve scaled by the domain
    // width instead of the bin width would tower over the bars.
    const data = normalSample(1200, 10, 0.12);
    const svg = renderChart({ kind: 'histogram', values: data, bins: 10, normal: true, lsl: 0, usl: 20 });
    const rects = bars(svg);
    expect(rects.length).toBeGreaterThan(5);
    const barTop = Math.min(...rects.map((r) => r.y));
    const curve = /<polyline class="chart-curve" data-chart-role="chart-curve" points="([^"]+)"/.exec(svg);
    expect(curve).not.toBeNull();
    const ys = (curve?.[1] ?? '').split(' ').map((p) => Number(p.split(',')[1]));
    const curveTop = Math.min(...ys);
    const plotHeight = 250 - 18 - 42;
    expect(curveTop).toBeLessThan(plotHeight); // in the plot, not above it
    expect(Math.abs(curveTop - barTop)).toBeLessThan(plotHeight * 0.2);
  });

  it('renders degenerate samples without NaN', () => {
    const single = renderChart({ kind: 'histogram', values: [5], normal: true, lsl: 4, usl: 6 });
    expect(single).not.toContain('NaN');
    const constant = renderChart({ kind: 'histogram', values: [5, 5, 5, 5], normal: true });
    expect(constant).not.toContain('NaN');
    const withNaN = renderChart({ kind: 'histogram', values: [1, 2, Number.NaN, Number.POSITIVE_INFINITY, 3], bins: 4 });
    expect(withNaN).not.toContain('NaN');
    const empty = renderChart({ kind: 'histogram', values: [] });
    expect(empty).toContain('No finite data');
  });
});

describe('axis ticks match the plotted scale', () => {
  const cure = DATASETS.find((d) => d.id === 'comparison')!.build();
  const column = (name: string) => cure.columns.find((c) => c.name === name)!.values as number[];
  const hardness = column('Hardness');
  const before = column('Before');

  /** Y-axis tick labels and the y pixel each label is drawn at. */
  function yTicksOf(svg: string): { value: number; pixel: number }[] {
    return [...svg.matchAll(/<text x="47" y="([\d.]+)" text-anchor="end"[^>]*>([-\d.]+)<\/text>/g)].map((m) => ({
      pixel: Number(m[1]) - 3, // the label baseline sits 3px below its tick
      value: Number(m[2]),
    }));
  }

  it('draws the Cure Study Hardness vs Before boxplot on the same scale as its tick labels', () => {
    const svg = renderChart({
      kind: 'boxplot',
      groups: [{ label: 'Hardness', values: hardness }, { label: 'Before', values: before }],
      yLabel: 'Hardness',
      title: 'Hardness vs Before',
    });
    const marks = yTicksOf(svg);
    expect(marks.length).toBeGreaterThanOrEqual(3);
    const [first, second] = marks;
    const slope = (second.pixel - first.pixel) / (second.value - first.value);
    expect(slope).toBeLessThan(0);
    // Every tick uses that one linear scale (positions are rounded to 0.1px).
    marks.forEach((mark) => expect(Math.abs(mark.pixel - (first.pixel + (mark.value - first.value) * slope))).toBeLessThan(0.5));
    const yAt = (value: number) => first.pixel + (value - first.value) * slope;

    // The box top/bottom and the median line are drawn at q3/q1/median.
    const box = /<rect class="chart-box" data-chart-role="chart-box" x="[-\d.]+" y="([-\d.]+)" width="[-\d.]+" height="([-\d.]+)"/.exec(svg);
    expect(box).not.toBeNull();
    const top = Number(box![1]);
    const height = Number(box![2]);
    const stats = boxplotStats([...hardness].sort((a, b) => a - b));
    expect(Math.abs(top - yAt(stats.q3))).toBeLessThan(0.5);
    expect(Math.abs(top + height - yAt(stats.q1))).toBeLessThan(0.5);
    const median = /<line class="chart-median" data-chart-role="chart-median" x1="[-\d.]+" y1="([-\d.]+)"/.exec(svg);
    expect(median).not.toBeNull();
    expect(Math.abs(Number(median![1]) - yAt(stats.median))).toBeLessThan(0.5);

    // No plotted value falls outside the plot box (top 18, height 190).
    const rawMin = Math.min(...hardness, ...before);
    const rawMax = Math.max(...hardness, ...before);
    expect(yAt(rawMin)).toBeLessThanOrEqual(208.5);
    expect(yAt(rawMax)).toBeGreaterThanOrEqual(17.5);
    // The old bug mapped 60..90 over the full height while the data spanned
    // 55.4..91.9, so the lowest values landed below the plot: the tick scale
    // must now place the outer data inside the box.
    expect(yAt(rawMin)).toBeLessThan(208.5);
  });

  it('names the red hollow ring as a 1.5×IQR outlier', () => {
    const svg = renderChart({ kind: 'boxplot', groups: [{ label: 'A', values: [1, 2, 3, 4, 5, 100] }] });
    expect(svg).toContain('Outlier · 1.5×IQR');
    expect(svg).toContain('<title>Outlier 100 · outside 1.5×IQR</title>');
  });
});

describe('process capability plot', () => {
  it('draws LSL, USL, Target and the mean as vertical lines', () => {
    const result = capability(values, { lsl: 9.4, usl: 10.8, target: 10.1 });
    const svg = renderChart({ kind: 'capability', result });
    const lines = specLines(svg);
    expect(lines).toHaveLength(4);
    lines.forEach((line) => {
      expect(line.x1).toBe(line.x2);
      expect(line.y2).toBeGreaterThan(line.y1);
    });
    expect(svg).toContain('LSL 9.4');
    expect(svg).toContain('USL 10.8');
    expect(svg).toContain('Target 10.1');
    expect(svg).toMatch(/μ 10\./);
  });

  it('keeps the capability statistics clear of the x-axis label', () => {
    const result = capability(values, { lsl: 9.4, usl: 10.8, target: 10.1 });
    const svg = renderChart({ kind: 'capability', result, xLabel: 'Thickness' });
    const texts = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
    const label = texts.find((t) => t.text === 'Thickness');
    const stats = texts.find((t) => t.text.includes('Cp ') && t.text.includes('Cpk '));
    expect(label).toBeTruthy();
    expect(stats).toBeTruthy();
    expect(stats!.y - label!.y).toBeGreaterThanOrEqual(12);
    const height = Number(/viewBox="0 0 [\d.]+ ([\d.]+)"/.exec(svg)![1]);
    texts.forEach((t) => expect(t.y).toBeLessThanOrEqual(height - 6));
  });

  it('draws its bars between the real bin boundaries', () => {
    const data = normalSample(400, 10, 0.2);
    const result = capability(data, { lsl: 9, usl: 11 });
    const svg = renderChart({ kind: 'capability', result });
    const rects = bars(svg);
    expect(rects.length).toBeGreaterThan(8);
    // Consecutive bars of the same histogram differ only by the 0.8px gap the
    // renderer leaves inside each bin — never by a fixed plot-wide pitch.
    const gaps = rects.slice(1).map((rect, i) => rect.x - (rects[i].x + rects[i].w));
    gaps.forEach((gap) => expect(gap).toBeCloseTo(0.8, 0));
    rects.forEach((rect) => {
      expect(rect.x).toBeGreaterThanOrEqual(54);
      expect(rect.x + rect.w).toBeLessThanOrEqual(560 - 20);
    });
  });

  it('renders a one-sided capability chart without NaN', () => {
    const result = capability(values, { lsl: 9.4 });
    const svg = renderChart({ kind: 'capability', result });
    expect(svg).not.toContain('NaN');
    expect(svg).toContain('LSL 9.4');
    const lines = specLines(svg);
    expect(lines).toHaveLength(2); // LSL + mean
  });

  it('survives a single value and constant columns', () => {
    const one = renderChart({ kind: 'capability', result: capability([10], { lsl: 9, usl: 11 }) });
    expect(one).not.toContain('NaN');
    const flat = renderChart({ kind: 'capability', result: capability([10, 10, 10, 10, 10], { lsl: 9, usl: 11 }) });
    expect(flat).not.toContain('NaN');
    const none = renderChart({ kind: 'capability', result: capability([], { lsl: 9, usl: 11 }) });
    expect(none).toContain('Not enough valid data');
  });
});

describe('control-chart panels with awkward data', () => {
  it('renders varying P-chart limits without NaN', () => {
    const result = pChart([4, 6, 5, 7, 3, 6], [100, 120, 90, 110, 100, 130]);
    const svg = renderChart({ kind: 'control', panel: result.panels[0] });
    expect(svg).not.toContain('NaN');
  });

  it('renders an Xbar-R panel after skipping a thin subgroup', () => {
    const result = xbarRCharts([10, 12, null, 16, 11, 13, 15, 17], 2);
    const svg = renderChart({ kind: 'control', panel: result.panels[0] });
    expect(svg).not.toContain('NaN');
  });

  it('renders a P chart whose proportion is 0', () => {
    const result = pChart([0, 0, 0, 0], [50, 50, 50, 50]);
    const svg = renderChart({ kind: 'control', panel: result.panels[0] });
    expect(svg).not.toContain('NaN');
  });
});
