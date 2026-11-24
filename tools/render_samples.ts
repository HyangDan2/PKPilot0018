/* Render a handful of Phase 1 sample charts into /workspace/downloads/sigrun-phase1.
 *
 *   PATH="/workspace/node/bin:$PATH" node_modules/.bin/vite-node tools/render_samples.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderChart } from '../src/lib/charts';
import { findAnalysis } from '../src/lib/analyses';
import { regressionBands } from '../src/lib/stats';
import { makeWorksheet } from '../src/lib/datasets';
import type { Block, ChartSpec } from '../src/types';

const outDir = resolve(process.cwd(), '../../downloads/sigrun-phase1');
mkdirSync(outDir, { recursive: true });

const values = [10.1, 9.8, 10.3, 10.0, 9.9, 10.2, 10.4, 9.7, 10.1, 10.0, 10.2, 9.9, 10.1, 10.3, 9.8, 10.0, 10.2, 10.1, 9.9, 10.4];

function save(name: string, spec: ChartSpec): void {
  const svg = renderChart(spec);
  writeFileSync(resolve(outDir, name), svg, 'utf8');
  console.log(name, `${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`);
}

save('01-histogram-engineering.svg', {
  kind: 'histogram',
  values,
  bins: 8,
  normal: true,
  lsl: 9.4,
  usl: 10.8,
  target: 10.1,
  xLabel: 'Thickness (mm)',
  config: {
    appearance: { preset: 'engineering', title: 'Thickness — Engineering preset' },
    histogram: { showFittedCurve: false, showMean: true, showMedian: true },
  },
});

save('02-boxplot-monochrome.svg', {
  kind: 'boxplot',
  groups: [
    { label: 'Line A', values },
    { label: 'Line B', values: values.map((v) => v + 0.35) },
    { label: 'Line C', values: [...values, 12.4] },
  ],
  yLabel: 'Thickness (mm)',
  config: {
    appearance: { preset: 'monochrome', title: 'Boxplot — Monochrome, jittered points' },
    boxplot: { showPoints: true, whiskerRule: 'iqr' },
  },
});

const x = values.map((_, i) => i + 1);
const bands = regressionBands(x, values, 0.95, 40);
save('03-scatter-bands.svg', {
  kind: 'scatter',
  points: x.map((xv, i) => ({ x: xv, y: values[i] })),
  fit: { intercept: bands.intercept, slope: bands.slope },
  bands: { mean: bands.mean, individual: bands.individual },
  notes: [`y = ${bands.intercept.toFixed(3)} + ${bands.slope.toFixed(3)}x`, `R² = ${(bands.r2 * 100).toFixed(1)}%`],
  xLabel: 'Run',
  yLabel: 'Thickness (mm)',
  config: {
    appearance: { preset: 'scientific', title: 'Scatterplot — mean CI and prediction band' },
    scatter: { showMeanCi: true, showPredictionBand: true },
  },
});

// A real RSM analysis: the contour chart that the RSM dialog produces.
const design: [number, number][] = [
  [-1, -1], [-1, 1], [1, -1], [1, 1],
  [1.4142, 0], [-1.4142, 0], [0, 1.4142], [0, -1.4142],
  [0, 0], [0, 0], [0, 0], [0, 0], [0, 0],
];
const y = design.map(([a, b]) => 80 - 2 * a - 1.5 * b + 0.5 * a * a + 0.4 * b * b + 0.3 * a * b);
const sheet = makeWorksheet('RSM', [
  { name: 'A', type: 'numeric', values: design.map((d) => d[0]) },
  { name: 'B', type: 'numeric', values: design.map((d) => d[1]) },
  { name: 'Y', type: 'numeric', values: y },
]);
const def = findAnalysis('rsmanalyze');
const result = def!.run({ lang: 'en', sheet, values: { response: 'C3', factors: ['C1', 'C2'], confidence: 95 } });
const chart = result.blocks
  .filter((b): b is Extract<Block, { type: 'chart' }> => b.type === 'chart')
  .map((b) => b.chart)[0];
save('04-rsm-contour-standard.svg', {
  ...chart,
  config: {
    ...(chart.config ?? {}),
    appearance: { preset: 'engineering', title: 'RSM contour — filled bands + iso-lines' },
    contour: { ...(chart.config?.contour ?? {}), showContourLabels: true },
  },
});

const axis = Array.from({ length: 101 }, (_, i) => -1.6818 + (2 * 1.6818 * i) / 100);
const z = axis.map((yv) => axis.map((xv) => 80 - 2 * xv - 1.5 * yv + 0.5 * xv * xv + 0.4 * yv * yv + 0.3 * xv * yv));
save('05-contour-heatmap-turbo.svg', {
  kind: 'contour',
  xs: axis,
  ys: axis,
  z,
  xLabel: 'Factor A',
  yLabel: 'Factor B',
  config: {
    appearance: { preset: 'corporate', title: 'Contour heat map — turbo palette' },
    contour: { renderMode: 'heatmap-discrete', colormap: 'turbo', levelCount: 14, colorbarPosition: 'bottom', colorbarTitle: 'Response', colorbarUnit: 'units' },
  },
});

console.log('written to', outDir);
