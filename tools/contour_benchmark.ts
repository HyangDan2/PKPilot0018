/* Contour resolution benchmark (WO-04).
 *
 *   node_modules/.bin/vite-node tools/contour_benchmark.ts
 *
 * Builds an RSM-like surface at 41/101/201/401 grid points per axis, renders
 * the production SVG (filled bands + iso-lines) and prints wall-clock time and
 * output size for each preset. Re-run the same command to reproduce the
 * numbers recorded in docs/CHART_FEATURE_GAP.md / the Phase 1 report.
 */

import { performance } from 'node:perf_hooks';
import { renderChart } from '../src/lib/charts';
import type { ChartSpec } from '../src/types';

function surface(n: number): { xs: number[]; ys: number[]; z: number[][] } {
  const xs = Array.from({ length: n }, (_, i) => -1.6818 + (2 * 1.6818 * i) / (n - 1));
  const ys = [...xs];
  const z = ys.map((y) => xs.map((x) => 80 - 2 * x - 1.5 * y + 0.5 * x * x + 0.4 * y * y + 0.3 * x * y));
  return { xs, ys, z };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const rows: { grid: number; ms: number; minMs: number; bytes: number; nodes: number }[] = [];
for (const n of [41, 101, 201, 401]) {
  const { xs, ys, z } = surface(n);
  const spec: ChartSpec = {
    kind: 'contour',
    xs,
    ys,
    z,
    xLabel: 'A',
    yLabel: 'B',
    height: 300,
    config: {
      contour: {
        resolution: 'standard',
        renderMode: 'filled-lines',
        colormap: 'sigrun-classic',
        levelCount: 10,
        showPoints: true,
        colorbarMode: 'discrete',
        colorbarPosition: 'right',
      },
    },
  };
  const times: number[] = [];
  let svg = '';
  // One warm-up render, then five measured runs (median reported).
  renderChart(spec, 560);
  for (let run = 0; run < 5; run += 1) {
    const start = performance.now();
    svg = renderChart(spec, 560);
    times.push(performance.now() - start);
  }
  const nodes = (svg.match(/<path|<line|<rect|<circle|<text/g) ?? []).length;
  rows.push({
    grid: n,
    ms: Number(median(times).toFixed(1)),
    minMs: Number(Math.min(...times).toFixed(1)),
    bytes: Buffer.byteLength(svg, 'utf8'),
    nodes,
  });
}

console.log(JSON.stringify(rows, null, 2));
