/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — interactive SVG charts
   Every colour comes from a CSS variable, so a chart follows the active
   theme (Soft Iris / Navy & Lavender) without being re-generated.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec } from '../types';
import { normalInv, normalPdf } from './dist';
import { mean, stdev } from './stats';
import { fmt } from './format';

const W = 560;
const FS = 9.5;
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const C = {
  series: ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'],
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  label: 'var(--chart-label)',
  ink: 'var(--text)',
  guide: 'var(--chart-guide)',
  band: 'var(--chart-band)',
  alarm: 'var(--chart-alarm)',
  surface: 'var(--chart-surface)',
};

interface Box { x: number; y: number; w: number; h: number }

function esc(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function niceStep(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * 10 ** exp;
}

export function ticks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max)) return [0];
  if (min === max) { min -= 0.5; max += 0.5; }
  const step = niceStep((max - min) / count);
  // Bracket the domain: the first and last tick must sit outside [min, max] so
  // every plotted value (spec limits included) stays inside the plot area.
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : Number(v.toFixed(10)));
  return out.length > 1 ? out : [min, max];
}

function tickLabel(v: number, step: number): string {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)) + 1);
  return v.toFixed(decimals);
}

function extent(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === Infinity) return [0, 1];
  if (min === max) return [min - 0.5, max + 0.5];
  return [min, max];
}

function pad([min, max]: [number, number], frac = 0.06): [number, number] {
  const span = max - min || 1;
  return [min - span * frac, max + span * frac];
}

function open(w: number, h: number, label: string): string {
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">`;
}

function axes(box: Box, xTicks: number[], yTicks: number[], xStep: number, yStep: number, xLabel?: string, yLabel?: string): string {
  let g = '';
  const { x, y, w, h } = box;
  yTicks.forEach((t) => {
    const yy = y + h - ((t - yTicks[0]) / (yTicks[yTicks.length - 1] - yTicks[0] || 1)) * h;
    g += `<line x1="${x}" y1="${yy.toFixed(1)}" x2="${x + w}" y2="${yy.toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>`;
    g += `<text x="${x - 7}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${esc(tickLabel(t, yStep))}</text>`;
  });
  xTicks.forEach((t) => {
    const xx = x + ((t - xTicks[0]) / (xTicks[xTicks.length - 1] - xTicks[0] || 1)) * w;
    g += `<line x1="${xx.toFixed(1)}" y1="${y + h}" x2="${xx.toFixed(1)}" y2="${y + h + 4}" stroke="${C.axis}" stroke-width="1"/>`;
    g += `<text x="${xx.toFixed(1)}" y="${y + h + 16}" text-anchor="middle" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${esc(tickLabel(t, xStep))}</text>`;
  });
  g += `<line x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}" stroke="${C.axis}" stroke-width="1"/>`;
  g += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + h}" stroke="${C.axis}" stroke-width="1"/>`;
  if (xLabel) {
    g += `<text x="${x + w / 2}" y="${y + h + 30}" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(xLabel)}</text>`;
  }
  if (yLabel) {
    g += `<text transform="translate(${x - 42} ${y + h / 2}) rotate(-90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(yLabel)}</text>`;
  }
  return g;
}

function scales(box: Box, xMin: number, xMax: number, yMin: number, yMax: number) {
  const sx = (v: number) => box.x + ((v - xMin) / (xMax - xMin || 1)) * box.w;
  const sy = (v: number) => box.y + box.h - ((v - yMin) / (yMax - yMin || 1)) * box.h;
  return { sx, sy };
}

function specLine(x1: number, x2: number, yPos: number, label: string, color = C.guide): string {
  return (
    `<line x1="${x1}" y1="${yPos.toFixed(1)}" x2="${x2}" y2="${yPos.toFixed(1)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="4 3" opacity="0.9"/>` +
    `<text x="${x2 - 2}" y="${(yPos - 3).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="8" fill="${color}">${esc(label)}</text>`
  );
}

function histogramBins(values: number[], binCount?: number): { lo: number; hi: number; count: number }[] {
  const [min, max] = extent(values);
  const n = values.length || 1;
  const bins = binCount && binCount > 0 ? Math.round(binCount) : Math.max(5, Math.min(20, Math.ceil(1 + Math.log2(n))));
  const width = (max - min) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ lo: min + i * width, hi: min + (i + 1) * width, count: 0 }));
  values.forEach((v) => {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
    out[idx].count += 1;
  });
  return out;
}

function drawHistogram(spec: Extract<ChartSpec, { kind: 'histogram' }>): string {
  const h = spec.height ?? 250;
  const values = spec.values.filter((v) => isFinite(v));
  const box: Box = { x: 54, y: 18, w: W - 74, h: h - 18 - 42 };
  const bins = histogramBins(values, spec.bins);
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const [rawMin, rawMax] = extent(values);
  const xMin = Math.min(rawMin, ...(spec.lsl != null ? [spec.lsl] : []), ...(spec.usl != null ? [spec.usl] : []));
  const xMax = Math.max(rawMax, ...(spec.lsl != null ? [spec.lsl] : []), ...(spec.usl != null ? [spec.usl] : []));
  const span = xMax - xMin || 1;
  const lo = xMin - span * 0.04;
  const hi = xMax + span * 0.04;
  const yMax = maxCount * 1.18;
  const xTicks = ticks(lo, hi, 6);
  const yTicks = ticks(0, yMax, 4);
  const { sx, sy } = scales(box, lo, hi, 0, yMax);
  let g = axes(
    box,
    xTicks,
    yTicks,
    niceStep((hi - lo) / 6),
    niceStep(yMax / 4),
    spec.xLabel,
    spec.yLabel ?? 'Frequency',
  );
  const bw = box.w / bins.length;
  bins.forEach((b, i) => {
    const x = box.x + i * bw;
    const y = sy(b.count);
    if (b.count > 0) {
      g += `<rect x="${(x + 0.8).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 1.6).toFixed(1)}" height="${(box.y + box.h - y).toFixed(1)}" fill="${C.series[0]}" opacity="0.72" rx="1.5"/>`;
    }
  });
  if (spec.normal && values.length > 2) {
    const m = mean(values);
    const s = stdev(values);
    const binWidth = (hi - lo) / bins.length;
    const pts: string[] = [];
    const steps = 120;
    for (let i = 0; i <= steps; i += 1) {
      const xv = lo + ((hi - lo) * i) / steps;
      const yv = normalPdf(xv, m, s) * values.length * binWidth;
      pts.push(`${sx(xv).toFixed(1)},${sy(Math.min(yMax, yv)).toFixed(1)}`);
    }
    g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.series[0]}" stroke-width="2"/>`;
  }
  const lines: string[] = [];
  if (spec.lsl != null) lines.push(specLine(box.x, box.x + box.w, sy(spec.lsl), `LSL ${fmt(spec.lsl, 3)}`, C.series[5]));
  if (spec.usl != null) lines.push(specLine(box.x, box.x + box.w, sy(spec.usl), `USL ${fmt(spec.usl, 3)}`, C.series[5]));
  if (spec.target != null) lines.push(specLine(box.x, box.x + box.w, sy(spec.target), `Target ${fmt(spec.target, 3)}`, C.series[3]));
  return open(W, h, spec.title ?? 'Histogram') + g + lines.join('') + '</svg>';
}

function drawBoxplot(spec: Extract<ChartSpec, { kind: 'boxplot' }>): string {
  const h = spec.height ?? 250;
  const values = spec.groups.flatMap((g) => g.values).filter((v) => isFinite(v));
  const [rawMin, rawMax] = extent(values);
  const yMin = rawMin - (rawMax - rawMin) * 0.08;
  const yMax = rawMax + (rawMax - rawMin) * 0.08;
  const box: Box = { x: 54, y: 18, w: W - 74, h: h - 60 };
  const yTicks = ticks(yMin, yMax, 5);
  const yStep = niceStep((yMax - yMin) / 5);
  const { sy } = scales(box, 0, 1, yMin, yMax);
  let g = axes(box, [], yTicks, 1, yStep, undefined, spec.yLabel ?? 'Value');
  const k = spec.groups.length;
  const slot = box.w / Math.max(1, k);
  spec.groups.forEach((group, i) => {
    const v = [...group.values].filter((x) => isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return;
    const q1 = quantileOf(v, 0.25);
    const med = quantileOf(v, 0.5);
    const q3 = quantileOf(v, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    const inner = v.filter((x) => x >= lowFence && x <= highFence);
    const whiskLo = inner.length ? inner[0] : q1;
    const whiskHi = inner.length ? inner[inner.length - 1] : q3;
    const cx = box.x + slot * (i + 0.5);
    const bw = Math.min(52, slot * 0.5);
    const color = C.series[i % C.series.length];
    g += `<line x1="${cx}" y1="${sy(whiskHi).toFixed(1)}" x2="${cx}" y2="${sy(whiskLo).toFixed(1)}" stroke="${C.axis}" stroke-width="1.2"/>`;
    g += `<line x1="${(cx - bw / 4).toFixed(1)}" y1="${sy(whiskHi).toFixed(1)}" x2="${(cx + bw / 4).toFixed(1)}" y2="${sy(whiskHi).toFixed(1)}" stroke="${C.axis}" stroke-width="1.2"/>`;
    g += `<line x1="${(cx - bw / 4).toFixed(1)}" y1="${sy(whiskLo).toFixed(1)}" x2="${(cx + bw / 4).toFixed(1)}" y2="${sy(whiskLo).toFixed(1)}" stroke="${C.axis}" stroke-width="1.2"/>`;
    g += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${sy(q3).toFixed(1)}" width="${bw}" height="${Math.max(1, sy(q1) - sy(q3)).toFixed(1)}" fill="${color}" opacity="0.18" stroke="${color}" stroke-width="1.4" rx="3"/>`;
    g += `<line x1="${(cx - bw / 2).toFixed(1)}" y1="${sy(med).toFixed(1)}" x2="${(cx + bw / 2).toFixed(1)}" y2="${sy(med).toFixed(1)}" stroke="${color}" stroke-width="2.2"/>`;
    g += `<circle cx="${cx}" cy="${sy(mean(v)).toFixed(1)}" r="2.4" fill="${C.surface}" stroke="${color}" stroke-width="1.4"/>`;
    v.filter((x) => x < lowFence || x > highFence).forEach((out) => {
      g += `<circle cx="${cx}" cy="${sy(out).toFixed(1)}" r="2.6" fill="none" stroke="${C.alarm}" stroke-width="1.2" opacity="0.85"/>`;
    });
    g += `<text x="${cx}" y="${(box.y + box.h + 30).toFixed(1)}" text-anchor="middle" font-size="${FS}" fill="${C.label}">${esc(truncate(group.label, 12))}</text>`;
    g += `<text x="${cx}" y="${(box.y + box.h + 41).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="8" fill="${C.label}">n=${v.length}</text>`;
  });
  return open(W, h, spec.title ?? 'Boxplot') + g + '</svg>';
}

function quantileOf(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  const h = (n + 1) * p;
  if (h <= 1) return sorted[0];
  if (h >= n) return sorted[n - 1];
  const lo = Math.floor(h);
  return sorted[lo - 1] + (h - lo) * (sorted[lo] - sorted[lo - 1]);
}

function truncate(text: string, len: number): string {
  return text.length > len ? `${text.slice(0, len - 1)}…` : text;
}

function drawScatter(spec: Extract<ChartSpec, { kind: 'scatter' }>): string {
  const h = spec.height ?? 260;
  const box: Box = { x: 58, y: 18, w: W - 80, h: h - 64 };
  const xs = spec.points.map((p) => p.x);
  const ys = spec.points.map((p) => p.y);
  const [xMin, xMax] = pad(extent(xs), 0.05);
  const [yMin, yMax] = pad(extent(ys), 0.08);
  const xTicks = ticks(xMin, xMax, 5);
  const yTicks = ticks(yMin, yMax, 5);
  const { sx, sy } = scales(box, xMin, xMax, yMin, yMax);
  let g = axes(box, xTicks, yTicks, niceStep((xMax - xMin) / 5), niceStep((yMax - yMin) / 5), spec.xLabel, spec.yLabel);
  const groups = spec.groups ?? [];
  spec.points.forEach((p) => {
    const idx = p.g ? groups.indexOf(p.g) : 0;
    const color = C.series[(idx < 0 ? 0 : idx) % C.series.length];
    g += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3.1" fill="${color}" opacity="0.78"/>`;
  });
  if (spec.fit) {
    const x1 = xMin + (xMax - xMin) * 0.03;
    const x2 = xMax - (xMax - xMin) * 0.03;
    const y1 = spec.fit.intercept + spec.fit.slope * x1;
    const y2 = spec.fit.intercept + spec.fit.slope * x2;
    g += `<line x1="${sx(x1).toFixed(1)}" y1="${sy(y1).toFixed(1)}" x2="${sx(x2).toFixed(1)}" y2="${sy(y2).toFixed(1)}" stroke="${C.series[4]}" stroke-width="2" opacity="0.9"/>`;
  }
  return open(W, h, spec.title ?? 'Scatterplot') + g + '</svg>';
}

function drawTimeseries(spec: Extract<ChartSpec, { kind: 'timeseries' }>): string {
  const h = spec.height ?? 250;
  const values = spec.values.filter((v) => isFinite(v));
  const box: Box = { x: 58, y: 18, w: W - 80, h: h - 62 };
  const [rawMin, rawMax] = extent(values);
  const yMin = Math.min(rawMin, ...(spec.lsl != null ? [spec.lsl] : []));
  const yMax = Math.max(rawMax, ...(spec.usl != null ? [spec.usl] : []));
  const yPad = (yMax - yMin) * 0.1 || 1;
  const yTicks = ticks(yMin - yPad, yMax + yPad, 5);
  const xTicks = ticks(1, values.length, 6);
  const { sx, sy } = scales(box, 1, Math.max(2, values.length), yTicks[0], yTicks[yTicks.length - 1]);
  let g = axes(box, xTicks, yTicks, niceStep(Math.max(1, values.length / 6)), niceStep((yTicks[yTicks.length - 1] - yTicks[0]) / 5), spec.xLabel ?? 'Observation', spec.yLabel);
  const pts = values.map((v, i) => `${sx(i + 1).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  g += `<polyline points="${pts}" fill="none" stroke="${C.series[0]}" stroke-width="1.6" opacity="0.85"/>`;
  values.forEach((v, i) => { g += `<circle cx="${sx(i + 1).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="2.4" fill="${C.series[0]}"/>`; });
  if (spec.lsl != null) g += specLine(box.x, box.x + box.w, sy(spec.lsl), `LSL ${fmt(spec.lsl, 3)}`, C.series[5]);
  if (spec.usl != null) g += specLine(box.x, box.x + box.w, sy(spec.usl), `USL ${fmt(spec.usl, 3)}`, C.series[5]);
  if (spec.target != null) g += specLine(box.x, box.x + box.w, sy(spec.target), `Target ${fmt(spec.target, 3)}`, C.series[3]);
  return open(W, h, spec.title ?? 'Time series plot') + g + '</svg>';
}

function drawNormalProb(spec: Extract<ChartSpec, { kind: 'normalprob' }>): string {
  const h = spec.height ?? 280;
  const box: Box = { x: 58, y: 18, w: W - 80, h: h - 64 };
  const xs = spec.points.map((p) => p.x);
  const zs = spec.points.map((p) => p.y);
  const [xMin, xMax] = pad(extent(xs), 0.05);
  const zMin = Math.min(-2.6, ...zs) - 0.15;
  const zMax = Math.max(2.6, ...zs) + 0.15;
  const { sx, sy } = scales(box, xMin, xMax, zMin, zMax);
  const probs = [1, 5, 10, 25, 50, 75, 90, 95, 99];
  const zOf = (p: number) => normalInv(p / 100);
  let g = '';
  const { x, y, w, h: bh } = box;
  probs.forEach((p) => {
    const z = zOf(p);
    const yy = sy(z);
    g += `<line x1="${x}" y1="${yy.toFixed(1)}" x2="${x + w}" y2="${yy.toFixed(1)}" stroke="${p === 50 ? C.axis : C.grid}" stroke-width="1" ${p === 50 ? '' : 'stroke-dasharray="3 3"'}/>`;
    g += `<text x="${x - 7}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${p}</text>`;
  });
  const xTicks = ticks(xMin, xMax, 5);
  xTicks.forEach((t) => {
    const xx = sx(t);
    g += `<line x1="${xx.toFixed(1)}" y1="${y + bh}" x2="${xx.toFixed(1)}" y2="${y + bh + 4}" stroke="${C.axis}"/>`;
    g += `<text x="${xx.toFixed(1)}" y="${y + bh + 16}" text-anchor="middle" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${tickLabel(t, niceStep((xMax - xMin) / 5))}</text>`;
  });
  g += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + bh}" stroke="${C.axis}"/>`;
  g += `<line x1="${x}" y1="${y + bh}" x2="${x + w}" y2="${y + bh}" stroke="${C.axis}"/>`;
  if (spec.ci && spec.ci.length > 1) {
    const upper = spec.ci.map((p) => `${sx(p.x).toFixed(1)},${sy(p.hi).toFixed(1)}`).join(' ');
    const lower = [...spec.ci].reverse().map((p) => `${sx(p.x).toFixed(1)},${sy(p.lo).toFixed(1)}`).join(' ');
    g += `<polygon points="${upper} ${lower}" fill="${C.band}" stroke="none"/>`;
  }
  const fx1 = xMin + (xMax - xMin) * 0.02;
  const fx2 = xMax - (xMax - xMin) * 0.02;
  g += `<line x1="${sx(fx1).toFixed(1)}" y1="${sy(spec.fit.intercept + spec.fit.slope * fx1).toFixed(1)}" x2="${sx(fx2).toFixed(1)}" y2="${sy(spec.fit.intercept + spec.fit.slope * fx2).toFixed(1)}" stroke="${C.series[4]}" stroke-width="2"/>`;
  spec.points.forEach((p) => {
    g += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.8" fill="${C.series[0]}" opacity="0.85"/>`;
  });
  g += `<text x="${x + w / 2}" y="${y + bh + 30}" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(spec.xLabel ?? 'Data')}</text>`;
  g += `<text transform="translate(${x - 42} ${y + bh / 2}) rotate(-90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">Percent</text>`;
  if (spec.ad != null) {
    g += `<text x="${x + w - 4}" y="${y + 12}" text-anchor="end" font-family="${MONO}" font-size="9" fill="${C.label}">AD ${fmt(spec.ad, 3)} · P ${spec.p != null ? spec.p.toFixed(3) : '-'}</text>`;
  }
  return open(W, h, spec.title ?? 'Normal probability plot') + g + '</svg>';
}

function drawControl(spec: Extract<ChartSpec, { kind: 'control' }>): string {
  const h = spec.height ?? 240;
  const panel = spec.panel;
  const values = panel.points.filter((v) => isFinite(v));
  const uclAt = (i: number) => (Array.isArray(panel.ucl) ? panel.ucl[Math.min(i, panel.ucl.length - 1)] : panel.ucl);
  const lclAt = (i: number) => (Array.isArray(panel.lcl) ? panel.lcl[Math.min(i, panel.lcl.length - 1)] : panel.lcl);
  const limits: number[] = [panel.center, ...values];
  panel.points.forEach((_, i) => { limits.push(uclAt(i), lclAt(i)); });
  const finite = limits.filter((v) => isFinite(v));
  const [lo, hi] = pad(extent(finite), 0.08);
  const box: Box = { x: 60, y: 22, w: W - 84, h: h - 66 };
  const xTicks = ticks(1, Math.max(2, panel.points.length), 6);
  const yTicks = ticks(lo, hi, 5);
  const { sy } = scales(box, 1, Math.max(2, panel.points.length), yTicks[0], yTicks[yTicks.length - 1]);
  let g = axes(box, xTicks, yTicks, niceStep(Math.max(1, panel.points.length / 6)), niceStep((yTicks[yTicks.length - 1] - yTicks[0]) / 5), spec.xLabel ?? 'Observation', spec.yLabel);
  g += `<line x1="${box.x}" y1="${sy(panel.center).toFixed(1)}" x2="${box.x + box.w}" y2="${sy(panel.center).toFixed(1)}" stroke="${C.series[0]}" stroke-width="1.4"/>`;
  const step = box.w / Math.max(1, panel.points.length - 1);
  if (Array.isArray(panel.ucl)) {
    const up = panel.points.map((_, i) => `${(box.x + i * step).toFixed(1)},${sy(Math.min(hi, uclAt(i))).toFixed(1)}`).join(' ');
    const down = panel.points.map((_, i) => `${(box.x + i * step).toFixed(1)},${sy(Math.max(lo, lclAt(i))).toFixed(1)}`).join(' ');
    g += `<polyline points="${up}" fill="none" stroke="${C.alarm}" stroke-width="1.1" stroke-dasharray="5 3" opacity="0.8"/>`;
    g += `<polyline points="${down}" fill="none" stroke="${C.alarm}" stroke-width="1.1" stroke-dasharray="5 3" opacity="0.8"/>`;
  } else {
    g += specLine(box.x, box.x + box.w, sy(panel.ucl as number), `UCL ${fmt(panel.ucl as number, 3)}`, C.alarm);
    g += specLine(box.x, box.x + box.w, sy(panel.lcl as number), `LCL ${fmt(panel.lcl as number, 3)}`, C.alarm);
  }
  const pts = panel.points.map((v, i) => `${(box.x + i * step).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  g += `<polyline points="${pts}" fill="none" stroke="${C.axis}" stroke-width="1.2"/>`;
  const flagged = new Map(panel.violations.map((v) => [v.index, v.rules]));
  panel.points.forEach((v, i) => {
    const rules = flagged.get(i);
    const color = rules ? C.alarm : C.series[0];
    g += `<circle cx="${(box.x + i * step).toFixed(1)}" cy="${sy(v).toFixed(1)}" r="${rules ? 3.6 : 2.6}" fill="${color}" stroke="${rules ? C.surface : 'none'}" stroke-width="${rules ? 1.2 : 0}"/>`;
    if (rules) {
      g += `<text x="${(box.x + i * step).toFixed(1)}" y="${(sy(v) - 7).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="8" fill="${C.alarm}">${rules.join(',')}</text>`;
    }
  });
  return open(W, h, panel.key) + g + '</svg>';
}

function drawPareto(spec: Extract<ChartSpec, { kind: 'pareto' }>): string {
  const h = spec.height ?? 270;
  const items = [...spec.items].sort((a, b) => b.count - a.count);
  const total = items.reduce((a, b) => a + b.count, 0) || 1;
  const box: Box = { x: 54, y: 18, w: W - 88, h: h - 78 };
  const maxCount = Math.max(1, ...items.map((i) => i.count));
  const yTicks = ticks(0, maxCount * 1.1, 5);
  const { sy } = scales(box, 0, 1, 0, yTicks[yTicks.length - 1]);
  let g = axes(box, [], yTicks, 1, niceStep((yTicks[yTicks.length - 1]) / 5), undefined, 'Count');
  const rightX = box.x + box.w;
  [0, 20, 40, 60, 80, 100].forEach((p) => {
    const yy = box.y + box.h - (p / 100) * box.h;
    g += `<text x="${rightX + 8}" y="${(yy + 3).toFixed(1)}" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${p}%</text>`;
  });
  const slot = box.w / Math.max(1, items.length);
  const barW = Math.min(58, slot * 0.7);
  let cumulative = 0;
  const linePts: string[] = [];
  items.forEach((item, i) => {
    const cx = box.x + slot * (i + 0.5);
    const y = sy(item.count);
    cumulative += item.count;
    const pct = (cumulative / total) * 100;
    g += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${(box.y + box.h - y).toFixed(1)}" fill="${C.series[0]}" opacity="0.82" rx="2"/>`;
    g += `<text x="${cx}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="8.5" fill="${C.label}">${item.count}</text>`;
    g += `<text transform="translate(${cx} ${box.y + box.h + 12}) rotate(-16)" text-anchor="end" font-size="8.5" fill="${C.label}">${esc(truncate(item.label, 11))}</text>`;
    linePts.push(`${cx.toFixed(1)},${(box.y + box.h - (pct / 100) * box.h).toFixed(1)}`);
  });
  const eighty = box.y + box.h - 0.8 * box.h;
  g += `<line x1="${box.x}" y1="${eighty.toFixed(1)}" x2="${rightX}" y2="${eighty.toFixed(1)}" stroke="${C.series[3]}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
  g += `<text x="${box.x + 4}" y="${(eighty - 4).toFixed(1)}" font-family="${MONO}" font-size="8" fill="${C.series[3]}">80%</text>`;
  g += `<polyline points="${linePts.join(' ')}" fill="none" stroke="${C.series[4]}" stroke-width="1.8"/>`;
  linePts.forEach((pt) => {
    const [px, py] = pt.split(',');
    g += `<circle cx="${px}" cy="${py}" r="2.6" fill="${C.series[4]}"/>`;
  });
  return open(W, h, spec.title ?? 'Pareto chart') + g + '</svg>';
}

function drawCapability(spec: Extract<ChartSpec, { kind: 'capability' }>): string {
  const r = spec.result;
  const values = r.values.filter((v) => isFinite(v));
  const h = spec.height ?? 300;
  const box: Box = { x: 54, y: 18, w: W - 74, h: h - 96 };
  const specs = [r.lsl, r.usl, r.target].filter((v): v is number => typeof v === 'number');
  const [vMin, vMax] = extent(values);
  const lo = Math.min(vMin, r.mean - 3.8 * r.sdOverall, ...specs);
  const hi = Math.max(vMax, r.mean + 3.8 * r.sdOverall, ...specs);
  const binCount = Math.max(8, Math.min(22, Math.ceil(Math.sqrt(values.length)) + 4));
  const binWidth = (hi - lo) / binCount;
  const counts = new Array<number>(binCount).fill(0);
  values.forEach((v) => {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - lo) / binWidth)));
    counts[idx] += 1;
  });
  const maxCount = Math.max(1, ...counts);
  const yMax = Math.max(maxCount, normalPdf(r.mean, r.mean, r.sdWithin) * values.length * binWidth) * 1.16;
  const xTicks = ticks(lo, hi, 6);
  const yTicks = ticks(0, yMax, 4);
  const sc = scales(box, lo, hi, 0, yMax);
  let g = axes(box, xTicks, yTicks, niceStep((hi - lo) / 6), niceStep(yMax / 4), spec.xLabel ?? 'Measurement', 'Frequency');
  const bw = box.w / binCount;
  counts.forEach((count, i) => {
    if (!count) return;
    const x = box.x + i * bw;
    const y = sc.sy(count);
    g += `<rect x="${(x + 0.8).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 1.6).toFixed(1)}" height="${(box.y + box.h - y).toFixed(1)}" fill="${C.series[0]}" opacity="0.3" rx="1.5"/>`;
  });
  const curve: string[] = [];
  for (let i = 0; i <= 160; i += 1) {
    const xv = lo + ((hi - lo) * i) / 160;
    const yv = normalPdf(xv, r.mean, r.sdWithin) * values.length * binWidth;
    curve.push(`${sc.sx(xv).toFixed(1)},${sc.sy(Math.min(yMax, yv)).toFixed(1)}`);
  }
  g += `<polyline points="${curve.join(' ')}" fill="none" stroke="${C.series[0]}" stroke-width="2"/>`;
  if (r.lsl !== null) g += specLine(box.x, box.x + box.w, sc.sy(r.lsl), `LSL ${fmt(r.lsl, 3)}`, C.alarm);
  if (r.usl !== null) g += specLine(box.x, box.x + box.w, sc.sy(r.usl), `USL ${fmt(r.usl, 3)}`, C.alarm);
  if (r.target !== null) g += specLine(box.x, box.x + box.w, sc.sy(r.target), `Target ${fmt(r.target, 3)}`, C.series[3]);
  g += specLine(box.x, box.x + box.w, sc.sy(r.mean), `\u03bc ${fmt(r.mean, 3)}`, C.series[4]);
  const stats = [`Cp ${fmt(r.cp, 3)}`, `Cpk ${fmt(r.cpk, 3)}`, `Pp ${fmt(r.pp, 3)}`, `Ppk ${fmt(r.ppk, 3)}`, `PPM ${fmt(r.ppmOverall, 0)}`];
  g += `<text x="${box.x}" y="${box.y + box.h + 34}" font-family="${MONO}" font-size="9" fill="${C.label}">${esc(stats.join('   '))}</text>`;
  g += `<text x="${box.x}" y="${box.y + box.h + 46}" font-family="${MONO}" font-size="9" fill="${C.label}">Within \u03c3 ${fmt(r.sdWithin, 4)}   Overall \u03c3 ${fmt(r.sdOverall, 4)}   n ${r.n}</text>`;
  return open(W, h, 'Process capability') + g + '</svg>';
}

function drawInterval(spec: Extract<ChartSpec, { kind: 'interval' }>): string {
  const h = spec.height ?? 240;
  const box: Box = { x: 62, y: 18, w: W - 86, h: h - 64 };
  const all = spec.groups.flatMap((g) => [g.lo, g.hi, g.mean]).filter((v) => isFinite(v));
  const [lo, hi] = pad(extent(all), 0.12);
  const yTicks = ticks(lo, hi, 5);
  const yStep = niceStep((hi - lo) / 5);
  const { sy } = scales(box, 0, 1, yTicks[0], yTicks[yTicks.length - 1]);
  let g = axes(box, [], yTicks, 1, yStep, undefined, spec.yLabel);
  const slot = box.w / Math.max(1, spec.groups.length);
  spec.groups.forEach((group, i) => {
    const cx = box.x + slot * (i + 0.5);
    const color = C.series[i % C.series.length];
    g += `<line x1="${cx}" y1="${sy(group.lo).toFixed(1)}" x2="${cx}" y2="${sy(group.hi).toFixed(1)}" stroke="${color}" stroke-width="1.6"/>`;
    g += `<line x1="${(cx - 9).toFixed(1)}" y1="${sy(group.lo).toFixed(1)}" x2="${(cx + 9).toFixed(1)}" y2="${sy(group.lo).toFixed(1)}" stroke="${color}" stroke-width="1.6"/>`;
    g += `<line x1="${(cx - 9).toFixed(1)}" y1="${sy(group.hi).toFixed(1)}" x2="${(cx + 9).toFixed(1)}" y2="${sy(group.hi).toFixed(1)}" stroke="${color}" stroke-width="1.6"/>`;
    g += `<circle cx="${cx}" cy="${sy(group.mean).toFixed(1)}" r="3.6" fill="${color}"/>`;
    g += `<text x="${cx}" y="${(box.y + box.h + 30).toFixed(1)}" text-anchor="middle" font-size="${FS}" fill="${C.label}">${esc(truncate(group.label, 12))}</text>`;
  });
  return open(W, h, 'Interval plot') + g + '</svg>';
}

export function renderChart(spec: ChartSpec): string {
  switch (spec.kind) {
    case 'histogram': return drawHistogram(spec);
    case 'boxplot': return drawBoxplot(spec);
    case 'scatter': return drawScatter(spec);
    case 'timeseries': return drawTimeseries(spec);
    case 'normalprob': return drawNormalProb(spec);
    case 'control': return drawControl(spec);
    case 'pareto': return drawPareto(spec);
    case 'capability': return drawCapability(spec);
    case 'interval': return drawInterval(spec);
    default: return '';
  }
}

/** Replace CSS variables with resolved colours so an exported SVG stands alone. */
export function inlineTheme(svg: string): string {
  if (typeof document === 'undefined') return svg;
  const styles = getComputedStyle(document.documentElement);
  return svg.replace(/var\((--[a-z0-9-]+)\)/gi, (match, name: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || match;
  });
}
