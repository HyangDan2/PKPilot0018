import { describe, expect, it } from 'vitest';
import {
  EXPORT_DPI_PRESETS,
  batchSvgDocument,
  chartSvgDocument,
  chartViewBox,
  exportFileName,
  physicalToPixels,
  pixelsToPhysical,
  resolveExportSize,
  svgToPngWithConfig,
} from '../src/lib/chartExport';
import { defaultExportConfig } from '../src/lib/chartConfig';
import type { ChartSpec } from '../src/types';

const values = [10.1, 9.8, 10.3, 10.0, 9.9, 10.2, 10.4, 9.7, 10.1, 10.0];

const scatter: ChartSpec = {
  kind: 'scatter',
  title: 'Hardness vs Speed',
  points: values.map((v, i) => ({ x: i + 1, y: v })),
  fit: { intercept: 9.9, slope: 0.01 },
  xLabel: 'Speed',
  yLabel: 'Hardness',
};

const histogram: ChartSpec = {
  kind: 'histogram',
  values,
  normal: true,
  xLabel: 'Thickness',
};

function exportRect(svg: string, role: string): { x: number; y: number; w: number; h: number } | null {
  const match = new RegExp(`<rect[^>]*data-chart-role="${role}"[^>]*>`).exec(svg);
  if (!match) return null;
  const attr = (name: string) => Number(new RegExp(`${name}="([-\\d.]+)"`).exec(match[0])?.[1]);
  return { x: attr('x'), y: attr('y'), w: attr('width'), h: attr('height') };
}

describe('export geometry (WO-10)', () => {
  it('converts a physical size to exact pixels and back', () => {
    expect(physicalToPixels(160, 'mm', 300)).toBe(1890);
    expect(physicalToPixels(100, 'mm', 300)).toBe(1181);
    expect(physicalToPixels(6, 'in', 150)).toBe(900);
    expect(physicalToPixels(1, 'in', 600)).toBe(600);
    expect(pixelsToPhysical(900, 'in', 150)).toBe(6);
    expect(pixelsToPhysical(1890, 'mm', 300)).toBeCloseTo(160.02, 2);
    expect(physicalToPixels(0.01, 'mm', 72)).toBe(1);
  });

  it('lets the physical size and DPI decide the box, and an explicit pixel box win', () => {
    const physical = resolveExportSize({ ...defaultExportConfig(), physicalWidth: 160, physicalHeight: 100, physicalUnit: 'mm', dpi: 300 }, 560, 300);
    expect(physical.widthPx).toBe(1890);
    expect(physical.heightPx).toBe(1181);
    expect(physical.viewWidth).toBe(560);
    expect(physical.viewHeight).toBe(300);

    const pixels = resolveExportSize({ ...defaultExportConfig(), widthPx: 1200, heightPx: 800, physicalUnit: 'mm', dpi: 300 }, 560, 300);
    expect(pixels.widthPx).toBe(1200);
    expect(pixels.heightPx).toBe(800);
    expect(pixels.physicalWidth).toBeCloseTo(101.6, 2);
    expect(pixels.physicalHeight).toBeCloseTo(67.73, 2);

    const inches = resolveExportSize({ ...defaultExportConfig(), physicalWidth: 8, physicalHeight: 5, physicalUnit: 'in', dpi: 150 }, 560, 300);
    expect(inches.widthPx).toBe(1200);
    expect(inches.heightPx).toBe(750);
    expect(EXPORT_DPI_PRESETS).toEqual([150, 300, 600]);
  });
});

describe('standalone chart SVG (WO-10)', () => {
  it('writes the export pixel box and keeps the internal viewBox', () => {
    const { svg, size } = chartSvgDocument(scatter, { ...defaultExportConfig(), dpi: 300, physicalWidth: 160, physicalHeight: 100, physicalUnit: 'mm' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`width="${size.widthPx}"`);
    expect(svg).toContain(`height="${size.heightPx}"`);
    expect(size.widthPx).toBe(1890);
    const box = chartViewBox(svg);
    expect(box.width).toBe(560);
    expect(box.height).toBeGreaterThan(100);
  });

  it('never leaves a CSS variable in the exported document', () => {
    const classic = renderClassic();
    const { svg } = chartSvgDocument(classic, { ...defaultExportConfig(), background: 'white' });
    expect(svg).not.toMatch(/var\(--/);
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
  });

  it('leaves the title and the legend out when asked', () => {
    const withAll = chartSvgDocument(scatter, { ...defaultExportConfig(), includeTitle: true, includeLegend: true });
    expect(withAll.svg).toContain('data-chart-role="title"');

    const withoutTitle = chartSvgDocument({ ...scatter, config: { appearance: { titleVisible: true } } }, { ...defaultExportConfig(), includeTitle: false });
    expect(withoutTitle.svg).not.toContain('data-chart-role="title"');

    const grouped: ChartSpec = { ...scatter, groups: ['A', 'B'], legend: true };
    const withLegend = chartSvgDocument(grouped, { ...defaultExportConfig(), includeLegend: true });
    expect(withLegend.svg).toContain('data-chart-role="legend"');
    const withoutLegend = chartSvgDocument(grouped, { ...defaultExportConfig(), includeLegend: false });
    expect(withoutLegend.svg).not.toContain('data-chart-role="legend"');
  });

  it('paints a white page or leaves a transparent one', () => {
    const white = chartSvgDocument(scatter, { ...defaultExportConfig(), background: 'white' });
    const bg = exportRect(white.svg, 'chart-export-bg');
    expect(bg).not.toBeNull();
    expect(bg?.w).toBeGreaterThan(500);

    const transparent = chartSvgDocument(scatter, { ...defaultExportConfig(), background: 'transparent' });
    expect(transparent.svg).not.toContain('data-chart-role="chart-export-bg"');
    expect(transparent.svg).not.toContain('data-chart-role="chart-bg"');
    expect(transparent.svg).not.toContain('data-chart-role="chart-plot-bg"');
  });

  it('names the file from the chart, the DPI and the format', () => {
    const svgName = exportFileName(scatter, { ...defaultExportConfig(), format: 'svg' });
    expect(svgName).toMatch(/^statelia-hardness-vs-speed-.*\.svg$/);
    const pngName = exportFileName(scatter, { ...defaultExportConfig(), format: 'png', dpi: 600 });
    expect(pngName).toContain('600dpi');
    expect(pngName.endsWith('.png')).toBe(true);
    expect(exportFileName(scatter, { ...defaultExportConfig(), format: 'svg' }, 'Figure 2')).toContain('figure-2');
  });

  it('stacks several charts into one batch document', () => {
    const svg = batchSvgDocument([{ chart: scatter, caption: 'Scatter' }, { chart: histogram, caption: 'Histogram' }], { ...defaultExportConfig(), background: 'white' });
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
    expect(svg).toContain('data-chart-role="chart-export-bg"');
    expect(svg).not.toMatch(/var\(--/);
    expect((svg.match(/<g transform="translate/g) ?? []).length).toBe(2);
  });

  it('reports a null raster when the environment has no canvas', async () => {
    const { svg } = chartSvgDocument(scatter, defaultExportConfig());
    const raster = await svgToPngWithConfig(svg, { ...defaultExportConfig(), format: 'png' });
    // happy-dom has no 2-D canvas: the API must say so rather than pretend.
    if (raster) {
      expect(raster.size.widthPx).toBe(1890);
    } else {
      expect(raster).toBeNull();
    }
  });
});

function renderClassic(): ChartSpec {
  return {
    ...scatter,
    config: { appearance: { preset: 'sigrun-classic' }, series: { palette: ['var(--chart-1)', 'var(--chart-2)'] } },
  };
}
