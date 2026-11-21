import { describe, expect, it } from 'vitest';
import { renderChart, ticks } from '../src/lib/charts';
import { capability } from '../src/lib/capability';
import { imrChart } from '../src/lib/spc';
import type { ChartSpec } from '../src/types';

const values = [10.1, 9.8, 10.3, 10.0, 9.9, 10.2, 10.4, 9.7, 10.1, 10.0];

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
    expect(svg).toContain('var(--chart-alarm)');
    expect(/<text[^>]*>1<\/text>/.test(svg) || /<text[^>]*>1,2<\/text>/.test(svg)).toBe(true);
  });
});
