import { describe, expect, it, beforeEach } from 'vitest';
import { renderChart, computeAxisTicks, formatTickValue, getChartWarnings } from '../src/lib/charts';
import { capability } from '../src/lib/capability';
import {
  DEFAULT_CHART_PRESET,
  defaultChartConfig,
  mergeChartConfig,
} from '../src/lib/chartConfig';
import {
  CHART_STYLE_IDS,
  CHART_STYLE_PRESETS,
  CUSTOM_STYLE_STORAGE_KEY,
  deleteCustomStyle,
  hasCssVariables,
  loadCustomStyles,
  resolveChartStyle,
  resolveStandaloneSvg,
  saveCustomStyle,
} from '../src/lib/chartStyles';
import { parseProject, serializeProject } from '../src/lib/project';
import { makeWorksheet } from '../src/lib/datasets';
import type { ChartSpec } from '../src/types';

const values = [10.1, 9.8, 10.3, 10.0, 9.9, 10.2, 10.4, 9.7, 10.1, 10.0];
const capabilityResult = capability(values, { lsl: 9.4, usl: 10.8, target: 10.1 });

describe('chart configuration model (WO-01)', () => {
  it('defaults to the Engineering preset and fills every block', () => {
    expect(DEFAULT_CHART_PRESET).toBe('engineering');
    const config = defaultChartConfig();
    expect(config.appearance?.preset).toBe('engineering');
    expect(config.appearance?.margins).toEqual({ top: 18, right: 20, bottom: 42, left: 54 });
    expect(config.xAxis?.scale).toBe('linear');
    expect(config.contour?.levelCount).toBe(10);
    expect(config.export?.dpi).toBe(300);
    expect(config.rsm?.unitMode).toBe('coded');
  });

  it('merges nested blocks without dropping sibling defaults', () => {
    const merged = mergeChartConfig(
      { xAxis: { min: 1 }, appearance: { preset: 'dark' } },
      { xAxis: { max: 5 }, contour: { colormap: 'viridis' } },
    );
    expect(merged.xAxis?.min).toBe(1);
    expect(merged.xAxis?.max).toBe(5);
    expect(merged.xAxis?.scale).toBe('linear');
    expect(merged.appearance?.preset).toBe('dark');
    expect(merged.contour?.colormap).toBe('viridis');
    expect(merged.contour?.renderMode).toBe('filled-lines');
  });
});

describe('professional style presets (WO-07)', () => {
  it('ships the seven documented presets', () => {
    expect(CHART_STYLE_IDS).toHaveLength(7);
    expect(CHART_STYLE_IDS).toEqual(expect.arrayContaining([
      'sigrun-classic', 'engineering', 'scientific', 'corporate', 'monochrome', 'high-contrast', 'dark',
    ]));
  });

  it('keeps the sigrun-classic preset id on CSS variables and Engineering on literal colours', () => {
    expect(CHART_STYLE_PRESETS['sigrun-classic'].series[0]).toBe('var(--chart-1)');
    expect(CHART_STYLE_PRESETS.engineering.series[0]).toBe('#1f4e79');
    expect(CHART_STYLE_PRESETS.engineering.axisColor).toBe('#1f2937');
    expect(CHART_STYLE_PRESETS['high-contrast'].series[0]).toBe('#0072b2');
    expect(CHART_STYLE_PRESETS.dark.chartBg).toBe('#0f172a');
    expect(resolveChartStyle(undefined).id).toBe('engineering');
  });

  it('renders both Engineering (default) and Classic without unresolved variables', () => {
    const spec: ChartSpec = { kind: 'histogram', values, bins: 6, lsl: 9.5, usl: 10.5 };
    const engineering = renderChart(spec);
    expect(engineering).toContain('data-chart-style="engineering"');
    expect(engineering).toContain('#1f4e79');
    expect(hasCssVariables(engineering)).toBe(false);

    const classic = renderChart(spec, { preset: 'sigrun-classic' });
    expect(classic).toContain('data-chart-style="sigrun-classic"');
    expect(classic).toContain('var(--chart-1)');

    const standalone = resolveStandaloneSvg(classic);
    expect(hasCssVariables(standalone)).toBe(false);
    expect(standalone).toContain('#8b6ce8');
  });

  it('applies appearance overrides (title, size, colours) and custom styles', () => {
    const spec: ChartSpec = {
      kind: 'bar',
      items: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }],
      config: { appearance: { title: 'Custom <Title> & "More"', preset: 'corporate' } },
    };
    const svg = renderChart(spec, 700);
    expect(svg).toContain('viewBox="0 0 700 240"');
    expect(svg).toContain('data-chart-role="title"');
    expect(svg).toContain('Custom &lt;Title&gt; &amp; &quot;More&quot;');
    expect(svg).not.toContain('<Title>');
  });

  beforeEach(() => {
    localStorage.removeItem(CUSTOM_STYLE_STORAGE_KEY);
    deleteCustomStyle('mine');
  });

  it('stores, resolves and deletes a user style', () => {
    expect(loadCustomStyles()).toEqual([]);
    saveCustomStyle({
      id: 'mine',
      name: 'My Engineering',
      base: 'engineering',
      overrides: { series: ['#ff0000', '#00ff00'], axisColor: '#222222' },
    });
    const stored = loadCustomStyles();
    expect(stored).toHaveLength(1);
    const style = resolveChartStyle('custom:mine');
    expect(style.id).toBe('custom:mine');
    expect(style.series[0]).toBe('#ff0000');
    expect(style.axisColor).toBe('#222222');
    const svg = renderChart(
      { kind: 'bar', items: [{ label: 'A', value: 2 }] },
      { preset: 'custom:mine' },
    );
    expect(svg).toContain('#ff0000');
    deleteCustomStyle('mine');
    expect(loadCustomStyles()).toEqual([]);
  });
});

describe('axis tick engine and formatting (WO-11)', () => {
  it('formats micro measurements without collapsing to zero', () => {
    const { ticks } = computeAxisTicks(1.2e-6, 1.8e-6, { count: 4 });
    expect(ticks.length).toBeGreaterThan(2);
    const labels = ticks.map((t) => t.label);
    expect(labels.some((l) => /e-6$/.test(l))).toBe(true);
    labels.forEach((label) => expect(label).not.toBe('0.0000'));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('keeps large-offset tiny variation precise and never rounds to 1.0M', () => {
    const { ticks } = computeAxisTicks(1000000.001, 1000000.005, { count: 4 });
    const labels = ticks.map((t) => t.label);
    expect(labels.some((l) => l.includes('1000000.0'))).toBe(true);
    labels.forEach((label) => expect(label).not.toMatch(/M$/));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('abbreviates to M only when the step is also large', () => {
    expect(formatTickValue(2_000_000, 1_000_000)).toBe('2.0M');
    expect(formatTickValue(1_000_000.001, 0.001)).toBe('1000000.001');
  });

  it('supports thousands separators and explicit decimals', () => {
    expect(formatTickValue(1234567.5, 0.5, { thousandsSep: true })).toBe('1,234,567.5');
    expect(formatTickValue(3.14159, 0.01, { decimals: 2 })).toBe('3.14');
    expect(formatTickValue(0.0000123, 1e-7, { scientific: true })).toBe('1.23e-5');
  });

  it('generates log ticks and warns about non-positive data', () => {
    const log = computeAxisTicks(1, 1000, { scale: 'log10' });
    expect(log.ticks.map((t) => t.label)).toEqual(expect.arrayContaining(['1', '10', '100', '1000']));
    const bad = computeAxisTicks(-5, 10, { scale: 'log10' });
    expect(bad.warning?.code).toBe('log-nonpositive');
  });

  it('caps the tick count and de-duplicates', () => {
    const { ticks } = computeAxisTicks(0, 1e9, { count: 20 });
    expect(ticks.length).toBeLessThanOrEqual(64);
    const labels = ticks.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('flips the axis when reverse is set', () => {
    const spec: ChartSpec = {
      kind: 'scatter',
      points: values.map((v, i) => ({ x: i, y: v })),
      config: { xAxis: { reverse: true } },
    };
    const svg = renderChart(spec);
    const zero = /<text x="([\d.]+)" y="230[.\d]*" text-anchor="middle"[^>]*>0<\/text>/.exec(svg);
    expect(zero).not.toBeNull();
    expect(Number(zero![1])).toBeGreaterThan(400);
  });
});

describe('render stability and semantics (WO-11)', () => {
  it('keeps each render independent (no shared width or clip counter)', () => {
    const narrow = renderChart({ kind: 'histogram', values }, 400);
    expect(narrow).toContain('viewBox="0 0 400 250"');
    const wide = renderChart({ kind: 'histogram', values });
    expect(wide).toContain('viewBox="0 0 560 250"');
    const scatter = renderChart({ kind: 'scatter', points: values.map((v, i) => ({ x: i, y: v })), fit: { intercept: 9.5, slope: 0.1 } });
    const ids = [...scatter.matchAll(/id="(sigrun-clip-[^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('adds unique clip ids per render call', () => {
    const spec: ChartSpec = { kind: 'scatter', points: values.map((v, i) => ({ x: i, y: v })), fit: { intercept: 9, slope: 0.2 } };
    const first = renderChart(spec);
    const second = renderChart(spec);
    const ids = (svg: string) => [...svg.matchAll(/id="(sigrun-clip-[^"]+)"/g)].map((m) => m[1]);
    ids(first).forEach((id) => expect(ids(second)).not.toContain(id));
  });

  it('flags a log axis with non-positive values in the SVG and the diagnostics', () => {
    const spec: ChartSpec = {
      kind: 'scatter',
      points: [{ x: 0, y: 1 }, { x: 10, y: 5 }, { x: 100, y: 8 }],
      config: { scatter: { logX: true } },
    };
    expect(getChartWarnings(spec).map((w) => w.code)).toContain('log-nonpositive');
    const svg = renderChart(spec);
    expect(svg).toContain('data-warning="log-nonpositive"');
    expect(svg).toContain('data-chart-role="chart-warning"');
    expect(svg).toContain('non-positive');
  });

  it('escapes every text and attribute value', () => {
    const svg = renderChart({
      kind: 'bar',
      items: [{ label: 'A&B <"x">', value: 4 }],
      title: 'T < "1" & 2',
      config: { appearance: { title: 'T < "1" & 2' } },
    });
    expect(svg).toContain('A&amp;B &lt;&quot;x&quot;&gt;');
    expect(svg).toContain('aria-label="T &lt; &quot;1&quot; &amp; 2"');
    expect(svg).not.toContain('<"x">');
  });

  it('marks key regions with data-chart-role for the Phase 2 UI', () => {
    const scatter = renderChart({
      kind: 'scatter',
      points: values.map((v, i) => ({ x: i, y: v, g: i % 2 ? 'B' : 'A' })),
      groups: ['A', 'B'],
      legend: true,
    });
    ['axis-x', 'axis-y', 'plot', 'chart-point'].forEach((role) => expect(scatter).toContain(`data-chart-role="${role}"`));
    expect(scatter).toContain('data-chart-role="legend"');
    expect(scatter).toMatch(/data-chart-role="plot" data-plot-box="[-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+" data-x-min="[-\d.e]+" data-x-max="[-\d.e]+" data-y-min="[-\d.e]+" data-y-max="[-\d.e]+"/);
    const contour = renderChart({
      kind: 'contour',
      xs: [-1, 0, 1],
      ys: [-1, 0, 1],
      z: [[1, 2, 3], [2, 3, 4], [3, 4, 5]],
    });
    expect(contour).toContain('data-chart-role="colorbar"');
    expect(contour).toContain('data-chart-role="chart-contour-band"');
  });

  it('honours per-chart options (histogram density, boxplot orientation, control window)', () => {
    const density = renderChart({
      kind: 'histogram',
      values,
      config: { histogram: { type: 'density' } },
    });
    expect(density).toContain('Density');

    const horizontal = renderChart({
      kind: 'boxplot',
      groups: [{ label: 'A', values }, { label: 'B', values: values.map((v) => v + 1) }],
      config: { boxplot: { orientation: 'horizontal', whiskerRule: 'minmax' } },
    });
    expect(horizontal).not.toContain('NaN');
    expect(horizontal).toContain('chart-box');

    const control = renderChart({
      kind: 'control',
      panel: {
        key: 'I', titleKey: 'I', points: [1, 2, 3, 4, 5], center: 3, ucl: 5, lcl: 1, sigma: 1, violations: [],
      },
      config: { spc: { observationWindow: { from: 2, to: 4 } } },
    });
    expect((control.match(/data-chart-role="chart-point"/g) ?? []).length).toBe(3);
  });

  it('renders every chart kind under every preset without NaN or unresolved values', () => {
    const base: ChartSpec[] = [
      { kind: 'histogram', values, normal: true, lsl: 9.5, usl: 10.4 },
      { kind: 'boxplot', groups: [{ label: 'A', values }, { label: 'B', values: values.map((v) => v + 0.3) }] },
      { kind: 'scatter', points: values.map((v, i) => ({ x: i + 1, y: v })), fit: { intercept: 9.6, slope: 0.05 }, legend: true, groups: ['A'] },
      { kind: 'timeseries', values, lsl: 9.5, usl: 10.5 },
      { kind: 'normalprob', points: values.map((v, i) => ({ x: v, y: (i - 4.5) / 2 })), fit: { intercept: -10 / 0.2, slope: 1 / 0.2 }, ci: values.map((v) => ({ x: v, lo: -2, hi: 2 })) },
      { kind: 'control', panel: { key: 'I', titleKey: 'I', points: values, center: 10, ucl: 10.5, lcl: 9.5, sigma: 0.17, violations: [{ index: 2, rules: [1] }] } },
      { kind: 'pareto', items: [{ label: 'A', count: 9 }, { label: 'B', count: 4 }] },
      { kind: 'capability', result: { ...capabilityResult, values } },
      { kind: 'interval', groups: [{ label: 'A', mean: 10, lo: 9.8, hi: 10.2, n: 5 }] },
      { kind: 'line', series: [{ label: 's', points: values.map((v, i) => ({ x: i, y: v })) }] },
      { kind: 'bar', items: [{ label: 'A', value: 3 }, { label: 'B', value: -2 }] },
      { kind: 'contour', xs: [-1, 0, 1], ys: [-1, 0, 1], z: [[1, 2, 3], [2, 3, 4], [3, 4, 5]] },
      { kind: 'probplot', points: values.map((v, i) => ({ x: v, y: (i - 4.5) / 2 })), fit: { intercept: -10 / 0.2, slope: 1 / 0.2 } },
    ];
    CHART_STYLE_IDS.forEach((preset) => {
      base.forEach((spec) => {
        const svg = renderChart(spec, { preset });
        expect(svg.startsWith('<svg'), `${preset}/${spec.kind}`).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg, `${preset}/${spec.kind}`).not.toContain('NaN');
        expect(svg, `${preset}/${spec.kind}`).not.toContain('undefined');
        expect((svg.match(/<svg/g) ?? []).length).toBe(1);
      });
    });
  });

  it('produces well-formed SVG documents (escaped titles, labels and attributes)', () => {
    const specs: ChartSpec[] = [
      { kind: 'bar', items: [{ label: 'A & <B> "C" \'D\'', value: 4 }], config: { appearance: { title: 'R&D <test> "quoted" \'s' } } },
      { kind: 'scatter', points: values.map((v, i) => ({ x: i, y: v })), config: { scatter: { showDataLabels: true } } },
      { kind: 'contour', xs: [-1, 0, 1], ys: [-1, 0, 1], z: [[1, 2, 3], [2, 3, 4], [3, 4, 5]], points: [{ x: 0, y: 0, label: 'p & <q>' }] },
    ];
    specs.forEach((spec) => {
      const svg = renderChart(spec);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.documentElement.tagName.toLowerCase()).toBe('svg');
    });
  });

  it('renders every contour mode and colourbar position', () => {
    const axis = Array.from({ length: 21 }, (_, i) => -1 + (2 * i) / 20);
    const z = axis.map((y) => axis.map((x) => 80 - 2 * x - y + 0.5 * x * x + 0.3 * x * y));
    const modes = ['lines', 'filled', 'filled-lines', 'heatmap-continuous', 'heatmap-discrete'] as const;
    modes.forEach((renderMode) => {
      (['right', 'bottom', 'left'] as const).forEach((colorbarPosition) => {
        const svg = renderChart({
          kind: 'contour',
          xs: axis,
          ys: axis,
          z,
          config: { contour: { renderMode, colorbarPosition, showContourLabels: true } },
        });
        expect(svg, `${renderMode}/${colorbarPosition}`).not.toContain('NaN');
        expect(svg).toContain('data-chart-role="colorbar"');
        if (renderMode !== 'lines') expect(svg).toContain('data-chart-role="chart-contour-band"');
        else expect(svg).toContain('data-chart-role="chart-contour-line"');
      });
    });
  });

  it('applies a custom palette and per-series overrides (including hidden series)', () => {
    const spec: ChartSpec = {
      kind: 'line',
      series: [
        { label: 'shown', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
        { label: 'hidden', points: [{ x: 1, y: 5 }, { x: 2, y: 6 }] },
      ],
      config: {
        series: { palette: ['#010203', '#040506'], perSeries: { 1: { visible: false } } },
        lineBarPareto: { showLegend: false },
      },
    };
    const svg = renderChart(spec);
    expect(svg).toContain('#010203');
    expect(svg).not.toContain('#040506');
    expect((svg.match(/data-chart-role="chart-point"/g) ?? []).length).toBe(2);
  });

  it('draws regression bands and secondary axes when asked', () => {
    const x = values.map((_, i) => i + 1);
    const bands = x.map((xv) => ({ x: xv, lo: 9 + xv * 0.05, hi: 11 + xv * 0.05 }));
    const svg = renderChart({
      kind: 'scatter',
      points: values.map((v, i) => ({ x: i + 1, y: v })),
      fit: { intercept: 9.6, slope: 0.06 },
      bands: { mean: bands, individual: bands.map((b) => ({ ...b, lo: b.lo - 0.2, hi: b.hi + 0.2 })) },
      config: { scatter: { showMeanCi: true, showPredictionBand: true } },
    });
    expect((svg.match(/<polygon/g) ?? []).length).toBeGreaterThanOrEqual(2);

    const line = renderChart({
      kind: 'line',
      series: [
        { label: 'left', points: [{ x: 1, y: 10 }, { x: 2, y: 12 }] },
        { label: 'right', points: [{ x: 1, y: 100 }, { x: 2, y: 120 }], axis: 'secondary' },
      ],
      y2Label: 'Secondary',
    });
    expect(line).toContain('data-chart-role="axis-y2"');
  });
});

describe('project compatibility (WO-01)', () => {
  it('parses an old project without chart config and renders its charts', () => {
    const sheet = makeWorksheet('S', [{ name: 'Y', type: 'numeric', values }]);
    const old = JSON.stringify({
      format: 'sigrun-project',
      version: 1,
      savedAt: '2026-11-01T00:00:00.000Z',
      app: 'HD2Lab Sigrún',
      worksheets: [sheet],
      activeSheetId: sheet.id,
      settings: { theme: 'light', lang: 'en' },
      outputs: [{
        id: 'out1', titleKey: 'an.histogram', createdAt: 1, collapsed: false,
        blocks: [{ type: 'chart', chart: { kind: 'histogram', values } }],
      }],
    });
    const parsed = parseProject(old);
    expect(parsed.outputs).toHaveLength(1);
    const chart = (parsed.outputs[0].blocks[0] as { chart: ChartSpec }).chart;
    expect(chart.config).toBeUndefined();
    const svg = renderChart(chart);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('NaN');
  });

  it('round-trips chart config and custom styles through a project file', () => {
    const sheet = makeWorksheet('S', [{ name: 'Y', type: 'numeric', values }]);
    const project = {
      worksheets: [sheet],
      activeSheetId: sheet.id,
      settings: { theme: 'dark' as const, lang: 'ko' as const },
      outputs: [{
        id: 'o1', titleKey: 'an.bar', createdAt: 1, collapsed: false,
        blocks: [{ type: 'chart' as const, chart: { kind: 'bar' as const, items: [{ label: 'A', value: 1 }], config: { appearance: { preset: 'dark' as const } } } }],
      }],
      customChartStyles: [{ id: 'mine', name: 'Mine', base: 'engineering' as const, overrides: { series: ['#123456'] } }],
    };
    const parsed = parseProject(serializeProject(project));
    const chart = (parsed.outputs[0].blocks[0] as { chart: ChartSpec }).chart;
    expect(chart.config?.appearance?.preset).toBe('dark');
    expect(parsed.customChartStyles?.[0].overrides.series?.[0]).toBe('#123456');
  });
});
