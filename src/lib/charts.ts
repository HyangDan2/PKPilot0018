/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — interactive SVG charts
   Every colour comes from a CSS variable, so a chart follows the active
   theme (Soft Iris / Navy & Lavender) without being re-generated.
   ───────────────────────────────────────────────────────────────────────── */

import type { ChartSpec } from '../types';
import { normalInv, normalPdf } from './dist';
import { mean, stdev } from './stats';
import { fmt } from './format';

let W = 560;
/** unique clip-path ids so several charts can share one page */
let clipSeq = 0;
const FS = 10.5;
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

function axes(
  box: Box,
  xTicks: number[],
  yTicks: number[],
  xStep: number,
  yStep: number,
  sx: (v: number) => number,
  sy: (v: number) => number,
  xLabel?: string,
  yLabel?: string,
): string {
  let g = '';
  const { x, y, w, h } = box;
  // Ticks are positioned with the very same scale as the plotted data. A tick
  // that the nice-number rounding pushed outside the plot domain is skipped so
  // its grid line and label cannot sit outside the box.
  const inPlotY = (py: number) => py >= y - 0.01 && py <= y + h + 0.01;
  const inPlotX = (px: number) => px >= x - 0.01 && px <= x + w + 0.01;
  yTicks.forEach((t) => {
    const yy = sy(t);
    if (!inPlotY(yy)) return;
    g += `<line x1="${x}" y1="${yy.toFixed(1)}" x2="${x + w}" y2="${yy.toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>`;
    g += `<text x="${x - 7}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${esc(tickLabel(t, yStep))}</text>`;
  });
  xTicks.forEach((t) => {
    const xx = sx(t);
    if (!inPlotX(xx)) return;
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

/**
 * A specification limit on a horizontal axis is a VERTICAL line at x. Labels sit
 * at the top of the plot and are staggered so neighbouring limits stay legible.
 */
function specVLine(box: Box, x: number, label: string, color = C.guide, slot = 0, dash = '4 3'): string {
  const xp = Math.min(box.x + box.w - 0.5, Math.max(box.x + 0.5, x));
  const anchor = xp > box.x + box.w - 70 ? 'end' : 'start';
  const dx = anchor === 'end' ? -3 : 3;
  const y = box.y + 8 + (slot % 3) * 10;
  return (
    `<line class="spec-line" x1="${xp.toFixed(1)}" y1="${box.y}" x2="${xp.toFixed(1)}" y2="${(box.y + box.h).toFixed(1)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="${dash}" opacity="0.95"/>` +
    `<text x="${(xp + dx).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-family="${MONO}" font-size="8" fill="${color}">${esc(label)}</text>`
  );
}

function emptyChart(w: number, h: number, label: string, message = 'No finite data to plot'): string {
  return open(w, h, label) +
    `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="${FS + 1}" fill="${C.label}">${esc(message)}</text></svg>`;
}

export interface HistogramCurvePoint {
  x: number;
  /** expected frequency of the normal density at x (n · binWidth · φ) */
  y: number;
}

/**
 * The normal-reference curve of a histogram, as pure numbers.
 *
 * Extracted from drawHistogram so the same rule can be checked by the QA
 * harness: 120 steps from the data minimum to its maximum, height
 * n · binWidth · φ(x; mean, s) with the sample standard deviation. The renderer
 * clips the height to the plot's y range; the values here are not clipped.
 */
export function histogramCurve(
  values: number[],
  bins?: number,
  steps = 120,
): { mean: number; sd: number; binWidth: number; points: HistogramCurvePoint[] } {
  const finite = values.filter((v) => isFinite(v));
  const [min, max] = extent(finite);
  const rule = histogramBins(finite, bins);
  const binWidth = (max - min) / rule.length || 1;
  const m = mean(finite);
  const s = stdev(finite);
  const points: HistogramCurvePoint[] = [];
  if (!isFinite(m) || !isFinite(s) || !(s > 0)) return { mean: m, sd: s, binWidth, points };
  for (let i = 0; i <= steps; i += 1) {
    const x = min + ((max - min) * i) / steps;
    points.push({ x, y: normalPdf(x, m, s) * finite.length * binWidth });
  }
  return { mean: m, sd: s, binWidth, points };
}

export interface BoxplotStats {
  n: number;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  lowFence: number;
  highFence: number;
  /** smallest / largest observation inside the 1.5·IQR fences */
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
  mean: number;
}

/**
 * Boxplot summary of one group as pure numbers: type-6 quantiles (h = (n+1)p),
 * whiskers at the most extreme observations inside Q1 − 1.5·IQR and
 * Q3 + 1.5·IQR, everything beyond them an outlier. drawBoxplot draws exactly
 * these numbers.
 */
export function boxplotStats(raw: number[]): BoxplotStats {
  const v = raw.filter((x) => isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (!n) {
    return { n: 0, q1: NaN, median: NaN, q3: NaN, iqr: NaN, lowFence: NaN, highFence: NaN, whiskerLow: NaN, whiskerHigh: NaN, outliers: [], mean: NaN };
  }
  const q1 = quantileOf(v, 0.25);
  const median = quantileOf(v, 0.5);
  const q3 = quantileOf(v, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inner = v.filter((x) => x >= lowFence && x <= highFence);
  return {
    n,
    q1,
    median,
    q3,
    iqr,
    lowFence,
    highFence,
    whiskerLow: inner.length ? inner[0] : q1,
    whiskerHigh: inner.length ? inner[inner.length - 1] : q3,
    outliers: v.filter((x) => x < lowFence || x > highFence),
    mean: mean(v),
  };
}

export function histogramBins(values: number[], binCount?: number): { lo: number; hi: number; count: number }[] {
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
  const fitted = (spec.curves ?? []).filter((curve) => curve.points.length > 1);
  const h = spec.height ?? 250;
  const values = spec.values.filter((v) => isFinite(v));
  if (!values.length) return emptyChart(W, h, spec.title ?? 'Histogram');
  // Fitted curves get their own legend line under the x-axis title, which keeps
  // the names off the bars and away from the specification labels.
  const bottom = fitted.length ? 56 : 42;
  const box: Box = { x: 54, y: 18, w: W - 74, h: h - 18 - bottom };
  const bins = histogramBins(values, spec.bins);
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const [rawMin, rawMax] = extent(values);
  const specs = [spec.lsl, spec.usl, spec.target].filter((v): v is number => typeof v === 'number' && isFinite(v));
  const curveX = (spec.curves ?? []).flatMap((curve) => curve.points.map((pt) => pt.x));
  // Target counts too, so no specification line is clipped at the plot edge.
  const xMin = Math.min(rawMin, ...specs, ...curveX);
  const xMax = Math.max(rawMax, ...specs, ...curveX);
  const span = xMax - xMin || Math.max(Math.abs(xMax), 1) * 0.05;
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
    sx,
    sy,
    spec.xLabel,
    spec.yLabel ?? 'Frequency',
  );
  // Bars are drawn at their real bin boundaries on the x axis — not at an
  // evenly divided plot width — so they line up with the ticks.
  bins.forEach((b) => {
    if (b.count <= 0) return;
    const x0 = sx(b.lo);
    const x1 = sx(b.hi);
    const y = sy(b.count);
    g += `<rect x="${(x0 + 0.4).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.8, x1 - x0 - 0.8).toFixed(1)}" height="${(box.y + box.h - y).toFixed(1)}" fill="${C.series[0]}" opacity="0.72" rx="1.5"/>`;
  });
  if (spec.normal && values.length > 2) {
    const curve = histogramCurve(values, spec.bins);
    if (curve.points.length > 1) {
      const pts = curve.points.map((pt) => `${sx(pt.x).toFixed(1)},${sy(Math.min(yMax, pt.y)).toFixed(1)}`);
      g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.series[0]}" stroke-width="2"/>`;
    }
  }
  (spec.curves ?? []).forEach((curve, index) => {
    if (curve.points.length < 2) return;
    const points = curve.points.map((pt) => `${sx(pt.x).toFixed(1)},${sy(Math.min(yMax, Math.max(0, pt.y))).toFixed(1)}`).join(' ');
    const color = C.series[(curve.color ?? index + 1) % C.series.length];
    g += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.8" ${curve.dash ? `stroke-dasharray="${curve.dash}"` : ''}/>`;
  });
  let legendX = box.x;
  const legendY = box.y + box.h + 40;
  spec.curves?.forEach((curve, index) => {
    if (!curve.label) return;
    const color = C.series[(curve.color ?? index + 1) % C.series.length];
    g += `<line x1="${legendX}" y1="${legendY - 3}" x2="${legendX + 14}" y2="${legendY - 3}" stroke="${color}" stroke-width="2" ${curve.dash ? `stroke-dasharray="${curve.dash}"` : ''}/>`;
    g += `<text x="${legendX + 18}" y="${legendY}" font-size="8.5" fill="${C.label}">${esc(curve.label)}</text>`;
    legendX += 22 + curve.label.length * 5.1;
  });
  const limits: { x: number; label: string; color: string }[] = [];
  if (spec.lsl != null && isFinite(spec.lsl)) limits.push({ x: sx(spec.lsl), label: `LSL ${fmt(spec.lsl, 3)}`, color: C.series[5] });
  if (spec.usl != null && isFinite(spec.usl)) limits.push({ x: sx(spec.usl), label: `USL ${fmt(spec.usl, 3)}`, color: C.series[5] });
  if (spec.target != null && isFinite(spec.target)) limits.push({ x: sx(spec.target), label: `Target ${fmt(spec.target, 3)}`, color: C.series[3] });
  limits.sort((a, b) => a.x - b.x);
  limits.forEach((limit, i) => { g += specVLine(box, limit.x, limit.label, limit.color, i); });
  return open(W, h, spec.title ?? 'Histogram') + g + '</svg>';
}

function drawBoxplot(spec: Extract<ChartSpec, { kind: 'boxplot' }>): string {
  const h = spec.height ?? 250;
  const values = spec.groups.flatMap((g) => g.values).filter((v) => isFinite(v));
  if (!values.length) return emptyChart(W, h, spec.title ?? 'Boxplot');
  const [rawMin, rawMax] = extent(values);
  const yMin = rawMin - (rawMax - rawMin) * 0.08;
  const yMax = rawMax + (rawMax - rawMin) * 0.08;
  const box: Box = { x: 54, y: 18, w: W - 74, h: h - 60 };
  const yTicks = ticks(yMin, yMax, 5);
  const yStep = niceStep((yMax - yMin) / 5);
  const { sx, sy } = scales(box, 0, 1, yMin, yMax);
  let g = axes(box, [], yTicks, 1, yStep, sx, sy, undefined, spec.yLabel ?? 'Value');
  let hasOutliers = false;
  const k = spec.groups.length;
  const slot = box.w / Math.max(1, k);
  spec.groups.forEach((group, i) => {
    const v = [...group.values].filter((x) => isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return;
    const stats = boxplotStats(v);
    const { q1, q3, whiskerLow: whiskLo, whiskerHigh: whiskHi } = stats;
    const med = stats.median;
    const cx = box.x + slot * (i + 0.5);
    const bw = Math.min(52, slot * 0.5);
    const color = C.series[i % C.series.length];
    g += `<line x1="${cx}" y1="${sy(whiskHi).toFixed(1)}" x2="${cx}" y2="${sy(whiskLo).toFixed(1)}" stroke="${C.axis}" stroke-width="1.2"/>`;
    g += `<line x1="${(cx - bw / 4).toFixed(1)}" y1="${sy(whiskHi).toFixed(1)}" x2="${(cx + bw / 4).toFixed(1)}" y2="${sy(whiskHi).toFixed(1)}" stroke="${C.axis}" stroke-width="1.2"/>`;
    g += `<line x1="${(cx - bw / 4).toFixed(1)}" y1="${sy(whiskLo).toFixed(1)}" x2="${(cx + bw / 4).toFixed(1)}" y2="${sy(whiskLo).toFixed(1)}" stroke="${C.axis}" stroke-width="1.2"/>`;
    g += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${sy(q3).toFixed(1)}" width="${bw}" height="${Math.max(1, sy(q1) - sy(q3)).toFixed(1)}" fill="${color}" opacity="0.18" stroke="${color}" stroke-width="1.4" rx="3"/>`;
    g += `<line x1="${(cx - bw / 2).toFixed(1)}" y1="${sy(med).toFixed(1)}" x2="${(cx + bw / 2).toFixed(1)}" y2="${sy(med).toFixed(1)}" stroke="${color}" stroke-width="2.2"/>`;
    g += `<circle cx="${cx}" cy="${sy(stats.mean).toFixed(1)}" r="2.4" fill="${C.surface}" stroke="${color}" stroke-width="1.4"/>`;
    if (stats.outliers.length) hasOutliers = true;
    stats.outliers.forEach((out) => {
      g += `<circle cx="${cx}" cy="${sy(out).toFixed(1)}" r="2.6" fill="none" stroke="${C.alarm}" stroke-width="1.2" opacity="0.85"><title>${esc(`Outlier ${fmt(out, 3)} · outside 1.5×IQR`)}</title></circle>`;
    });
    g += `<text x="${cx}" y="${(box.y + box.h + 30).toFixed(1)}" text-anchor="middle" font-size="${FS}" fill="${C.label}">${esc(truncate(group.label, 12))}</text>`;
    g += `<text x="${cx}" y="${(box.y + box.h + 41).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="8" fill="${C.label}">n=${v.length}</text>`;
  });
  if (hasOutliers) {
    // The hollow red ring is the 1.5×IQR outlier marker; name it above the plot.
    g += `<circle cx="${W - 104}" cy="9" r="2.8" fill="none" stroke="${C.alarm}" stroke-width="1.2"/>`;
    g += `<text x="${W - 97}" y="12" font-size="8.5" fill="${C.label}">Outlier · 1.5×IQR</text>`;
  }
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
  if (!spec.points.length) return emptyChart(W, h, spec.title ?? 'Scatterplot');
  const xs = spec.points.map((p) => p.x);
  const ys = spec.points.map((p) => p.y);
  const [xMin, xMax] = pad(extent(xs), 0.05);
  const [yMin, yMax] = pad(extent(ys), 0.08);
  const xTicks = ticks(xMin, xMax, 5);
  const yTicks = ticks(yMin, yMax, 5);
  const { sx, sy } = scales(box, xMin, xMax, yMin, yMax);
  let g = axes(box, xTicks, yTicks, niceStep((xMax - xMin) / 5), niceStep((yMax - yMin) / 5), sx, sy, spec.xLabel, spec.yLabel);
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
    // A steep fit can predict outside the padded y range: clip the line to the plot.
    const fitClip = `sigrun-clip-${(clipSeq += 1)}`;
    g += `<defs><clipPath id="${fitClip}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath></defs>`;
    g += `<g clip-path="url(#${fitClip})"><line x1="${sx(x1).toFixed(1)}" y1="${sy(y1).toFixed(1)}" x2="${sx(x2).toFixed(1)}" y2="${sy(y2).toFixed(1)}" stroke="${C.series[4]}" stroke-width="2" opacity="0.9"/></g>`;
  }
  return open(W, h, spec.title ?? 'Scatterplot') + g + '</svg>';
}

function drawTimeseries(spec: Extract<ChartSpec, { kind: 'timeseries' }>): string {
  const h = spec.height ?? 250;
  const values = spec.values.filter((v) => isFinite(v));
  if (!values.length) return emptyChart(W, h, spec.title ?? 'Time series plot');
  const box: Box = { x: 58, y: 18, w: W - 80, h: h - 62 };
  const [rawMin, rawMax] = extent(values);
  const yMin = Math.min(rawMin, ...(spec.lsl != null ? [spec.lsl] : []));
  const yMax = Math.max(rawMax, ...(spec.usl != null ? [spec.usl] : []));
  const yPad = (yMax - yMin) * 0.1 || 1;
  const yTicks = ticks(yMin - yPad, yMax + yPad, 5);
  const xTicks = ticks(1, values.length, 6);
  const { sx, sy } = scales(box, 1, Math.max(2, values.length), yTicks[0], yTicks[yTicks.length - 1]);
  let g = axes(box, xTicks, yTicks, niceStep(Math.max(1, values.length / 6)), niceStep((yTicks[yTicks.length - 1] - yTicks[0]) / 5), sx, sy, spec.xLabel ?? 'Observation', spec.yLabel);
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
  if (!spec.points.length) return emptyChart(W, h, spec.title ?? 'Normal probability plot');
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
  const npClip = `sigrun-clip-${(clipSeq += 1)}`;
  g += `<defs><clipPath id="${npClip}"><rect x="${x}" y="${y}" width="${w}" height="${bh}"/></clipPath></defs><g clip-path="url(#${npClip})">`;
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
  g += '</g>';
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
  if (!finite.length) return emptyChart(W, h, panel.key);
  const [lo, hi] = pad(extent(finite), 0.08);
  const box: Box = { x: 60, y: 22, w: W - 84, h: h - 66 };
  const xTicks = ticks(1, Math.max(2, panel.points.length), 6);
  const yTicks = ticks(lo, hi, 5);
  const { sx, sy } = scales(box, 1, Math.max(2, panel.points.length), yTicks[0], yTicks[yTicks.length - 1]);
  let g = axes(box, xTicks, yTicks, niceStep(Math.max(1, panel.points.length / 6)), niceStep((yTicks[yTicks.length - 1] - yTicks[0]) / 5), sx, sy, spec.xLabel ?? 'Observation', spec.yLabel);
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
  if (!spec.items.length) return emptyChart(W, h, spec.title ?? 'Pareto chart');
  const items = [...spec.items].sort((a, b) => b.count - a.count);
  const total = items.reduce((a, b) => a + b.count, 0) || 1;
  const box: Box = { x: 54, y: 18, w: W - 88, h: h - 78 };
  const maxCount = Math.max(1, ...items.map((i) => i.count));
  const yTicks = ticks(0, maxCount * 1.1, 5);
  const { sx, sy } = scales(box, 0, 1, 0, yTicks[yTicks.length - 1]);
  let g = axes(box, [], yTicks, 1, niceStep((yTicks[yTicks.length - 1]) / 5), sx, sy, undefined, 'Count');
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
    if (items.length <= 6) {
      const maxChars = Math.max(4, Math.floor(slot / 6.2));
      g += `<text x="${cx}" y="${box.y + box.h + 13}" text-anchor="middle" font-size="8.5" fill="${C.label}">${esc(truncate(item.label, maxChars))}</text>`;
    } else {
      g += `<text transform="translate(${cx} ${box.y + box.h + 12}) rotate(-16)" text-anchor="end" font-size="8.5" fill="${C.label}">${esc(truncate(item.label, 11))}</text>`;
    }
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
  if (!values.length || !isFinite(r.mean)) return emptyChart(W, h, 'Process capability', 'Not enough valid data for a capability plot');
  const box: Box = { x: 54, y: 18, w: W - 74, h: h - 96 };
  const specs = [r.lsl, r.usl, r.target].filter((v): v is number => typeof v === 'number' && isFinite(v));
  const [vMin, vMax] = extent(values);
  const overallSd = isFinite(r.sdOverall) && r.sdOverall > 0 ? r.sdOverall : (vMax - vMin) / 6 || 1;
  const lo = Math.min(vMin, r.mean - 3.8 * overallSd, ...specs);
  const hi = Math.max(vMax, r.mean + 3.8 * overallSd, ...specs);
  const binCount = Math.max(8, Math.min(22, Math.ceil(Math.sqrt(values.length)) + 4));
  const binWidth = (hi - lo) / binCount || 1;
  const counts = new Array<number>(binCount).fill(0);
  values.forEach((v) => {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - lo) / binWidth)));
    counts[idx] += 1;
  });
  const maxCount = Math.max(1, ...counts);
  const withinSd = isFinite(r.sdWithin) && r.sdWithin > 0 ? r.sdWithin : overallSd;
  const peak = normalPdf(r.mean, r.mean, withinSd) * values.length * binWidth;
  const yMax = Math.max(maxCount, isFinite(peak) ? peak : 0) * 1.16 || 1;
  const xTicks = ticks(lo, hi, 6);
  const yTicks = ticks(0, yMax, 4);
  const sc = scales(box, lo, hi, 0, yMax);
  let g = axes(box, xTicks, yTicks, niceStep((hi - lo) / 6), niceStep(yMax / 4), sc.sx, sc.sy, spec.xLabel ?? 'Measurement', 'Frequency');
  // Bars sit on their real bin edges in x, matching the curve and ticks.
  counts.forEach((count, i) => {
    if (!count) return;
    const binLo = lo + i * binWidth;
    const binHi = binLo + binWidth;
    const y = sc.sy(count);
    g += `<rect x="${(sc.sx(binLo) + 0.4).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.8, sc.sx(binHi) - sc.sx(binLo) - 0.8).toFixed(1)}" height="${(box.y + box.h - y).toFixed(1)}" fill="${C.series[0]}" opacity="0.3" rx="1.5"/>`;
  });
  const curve: string[] = [];
  for (let i = 0; i <= 160; i += 1) {
    const xv = lo + ((hi - lo) * i) / 160;
    const yv = normalPdf(xv, r.mean, withinSd) * values.length * binWidth;
    curve.push(`${sc.sx(xv).toFixed(1)},${sc.sy(Math.min(yMax, yv)).toFixed(1)}`);
  }
  g += `<polyline points="${curve.join(' ')}" fill="none" stroke="${C.series[0]}" stroke-width="2"/>`;
  const limits: { x: number; label: string; color: string; dash: string }[] = [];
  if (r.lsl !== null) limits.push({ x: sc.sx(r.lsl), label: `LSL ${fmt(r.lsl, 3)}`, color: C.alarm, dash: '4 3' });
  if (r.usl !== null) limits.push({ x: sc.sx(r.usl), label: `USL ${fmt(r.usl, 3)}`, color: C.alarm, dash: '4 3' });
  if (r.target !== null) limits.push({ x: sc.sx(r.target), label: `Target ${fmt(r.target, 3)}`, color: C.series[3], dash: '4 3' });
  limits.sort((a, b) => a.x - b.x);
  limits.forEach((limit, i) => { g += specVLine(box, limit.x, limit.label, limit.color, i, limit.dash); });
  g += specVLine(box, sc.sx(r.mean), `μ ${fmt(r.mean, 3)}`, C.series[4], limits.length, '6 4');
  const stats = [
    `Cp ${fmt(r.cp, 3)}`, `Cpk ${fmt(r.cpk, 3)}`, `Pp ${fmt(r.pp, 3)}`, `Ppk ${fmt(r.ppk, 3)}`, `Cpm ${fmt(r.cpm, 3)}`, `PPM ${fmt(r.ppmOverall, 0)}`,
  ];
  g += `<text x="${box.x}" y="${box.y + box.h + 46}" font-family="${MONO}" font-size="9" fill="${C.label}">${esc(stats.join('   '))}</text>`;
  g += `<text x="${box.x}" y="${box.y + box.h + 58}" font-family="${MONO}" font-size="9" fill="${C.label}">Within \u03c3 ${fmt(r.sdWithin, 4)}   Overall \u03c3 ${fmt(r.sdOverall, 4)}   n ${r.n}</text>`;
  return open(W, h, 'Process capability') + g + '</svg>';
}

function drawInterval(spec: Extract<ChartSpec, { kind: 'interval' }>): string {
  const h = spec.height ?? 240;
  const box: Box = { x: 62, y: 18, w: W - 86, h: h - 64 };
  const all = spec.groups.flatMap((g) => [g.lo, g.hi, g.mean]).filter((v) => isFinite(v));
  if (!all.length) return emptyChart(W, h, 'Interval plot');
  const [lo, hi] = pad(extent(all), 0.12);
  const yTicks = ticks(lo, hi, 5);
  const yStep = niceStep((hi - lo) / 5);
  const { sx, sy } = scales(box, 0, 1, yTicks[0], yTicks[yTicks.length - 1]);
  let g = axes(box, [], yTicks, 1, yStep, sx, sy, undefined, spec.yLabel);
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

/* ── line / bar / contour / probability plot (P2) ─────────────────────── */

function drawLine(spec: Extract<ChartSpec, { kind: 'line' }>): string {
  const h = spec.height ?? 250;
  const all = spec.series.flatMap((s) => s.points);
  if (!all.length) return emptyChart(W, h, spec.title ?? 'Line plot');
  const box: Box = { x: 58, y: 22, w: W - 80, h: h - 66 };
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y).concat((spec.refLines ?? []).map((r) => r.y)).concat((spec.markers ?? []).map((m) => m.y));
  const [xMin, xMax] = pad(extent(xs), 0.04);
  const [yMin, yMax] = pad(extent(ys), 0.1);
  const { sx, sy } = scales(box, xMin, xMax, yMin, yMax);
  const xTicks = spec.xLabels && spec.xLabels.length
    ? spec.xLabels.map((_, i) => i).filter((i) => i >= xMin && i <= xMax)
    : ticks(xMin, xMax, 5);
  const yTicks = ticks(yMin, yMax, 5);
  const xStep = niceStep((xMax - xMin) / 5);
  const yStep = niceStep((yMax - yMin) / 5);
  let g = '';
  const { x, y, w, h: bh } = box;
  yTicks.forEach((t) => {
    const yy = sy(t);
    if (yy < y - 0.01 || yy > y + bh + 0.01) return;
    g += `<line x1="${x}" y1="${yy.toFixed(1)}" x2="${x + w}" y2="${yy.toFixed(1)}" stroke="${C.grid}" stroke-width="1"/>`;
    g += `<text x="${x - 7}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${esc(tickLabel(t, yStep))}</text>`;
  });
  // Categorical x: thin the labels so a phone-width chart stays readable.
  const labelEvery = Math.max(1, Math.ceil(xTicks.length / 8));
  xTicks.forEach((t, index) => {
    const xx = sx(t);
    if (xx < x - 0.01 || xx > x + w + 0.01) return;
    g += `<line x1="${xx.toFixed(1)}" y1="${y + bh}" x2="${xx.toFixed(1)}" y2="${y + bh + 4}" stroke="${C.axis}"/>`;
    if (index % labelEvery === 0) {
      const label = spec.xLabels ? spec.xLabels[Math.round(t)] ?? '' : tickLabel(t, xStep);
      g += `<text x="${xx.toFixed(1)}" y="${y + bh + 15}" text-anchor="middle" font-size="8.5" fill="${C.label}">${esc(truncate(label, 10))}</text>`;
    }
  });
  g += `<line x1="${x}" y1="${y + bh}" x2="${x + w}" y2="${y + bh}" stroke="${C.axis}"/>`;
  g += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + bh}" stroke="${C.axis}"/>`;
  (spec.refLines ?? []).forEach((ref) => {
    if (!isFinite(ref.y)) return;
    g += `<line x1="${x}" y1="${sy(ref.y).toFixed(1)}" x2="${x + w}" y2="${sy(ref.y).toFixed(1)}" stroke="${C.alarm}" stroke-width="1.1" stroke-dasharray="5 3" opacity="0.85"/>`;
    if (ref.label) g += `<text x="${x + w - 2}" y="${(sy(ref.y) - 3).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="8" fill="${C.alarm}">${esc(ref.label)}</text>`;
  });
  spec.series.forEach((series, index) => {
    const color = C.series[(series.color ?? index) % C.series.length];
    const points = [...series.points].sort((a, b) => a.x - b.x);
    if (points.length > 1) {
      g += `<polyline points="${points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="1.7" ${series.dash ? `stroke-dasharray="${series.dash}"` : ''} opacity="0.95"/>`;
    }
    points.forEach((p) => {
      g += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.8" fill="${color}"/>`;
    });
  });
  (spec.markers ?? []).forEach((marker) => {
    g += `<circle cx="${sx(marker.x).toFixed(1)}" cy="${sy(marker.y).toFixed(1)}" r="4.2" fill="none" stroke="${C.series[4]}" stroke-width="1.8"/>`;
    if (marker.label) g += `<text x="${(sx(marker.x) + 6).toFixed(1)}" y="${(sy(marker.y) - 6).toFixed(1)}" font-family="${MONO}" font-size="8" fill="${C.series[4]}">${esc(marker.label)}</text>`;
  });
  if (spec.xLabel) g += `<text x="${x + w / 2}" y="${y + bh + 30}" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(spec.xLabel)}</text>`;
  if (spec.yLabel) g += `<text transform="translate(${x - 42} ${y + bh / 2}) rotate(-90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(spec.yLabel)}</text>`;
  // Legend inside the plot's top-left keeps the margins fixed on mobile.
  const legend = spec.series.filter((s) => s.label).slice(0, 6);
  if (legend.length && legend.length <= 6) {
    legend.forEach((series, index) => {
      const ly = y + 10 + index * 12;
      g += `<line x1="${x + 4}" y1="${ly - 3}" x2="${x + 18}" y2="${ly - 3}" stroke="${C.series[(series.color ?? index) % C.series.length]}" stroke-width="2"/>`;
      g += `<text x="${x + 22}" y="${ly}" font-size="8.5" fill="${C.label}">${esc(truncate(series.label, 14))}</text>`;
    });
  }
  return open(W, h, spec.title ?? 'Line plot') + g + '</svg>';
}

function drawBar(spec: Extract<ChartSpec, { kind: 'bar' }>): string {
  const h = spec.height ?? 240;
  const items = spec.items.filter((item) => isFinite(item.value));
  if (!items.length) return emptyChart(W, h, spec.title ?? 'Bar chart');
  const box: Box = { x: 58, y: 22, w: W - 80, h: h - 62 };
  const values = items.map((i) => i.value).concat(spec.refLine ? [spec.refLine.y] : []);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const [yMin, yMax] = pad([lo, hi === lo ? lo + 1 : hi], 0.1);
  const yTicks = ticks(yMin, yMax, 5);
  const { sx, sy } = scales(box, 0, 1, yTicks[0], yTicks[yTicks.length - 1]);
  let g = axes(box, [], yTicks, 1, niceStep((yTicks[yTicks.length - 1] - yTicks[0]) / 5), sx, sy, undefined, spec.yLabel);
  const slot = box.w / Math.max(1, items.length);
  const barW = Math.min(58, slot * 0.62);
  const zero = sy(Math.max(yMin, Math.min(yMax, 0)));
  items.forEach((item, index) => {
    const cx = box.x + slot * (index + 0.5);
    const y = sy(item.value);
    const color = C.series[(item.color ?? index) % C.series.length];
    g += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${Math.min(y, zero).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, Math.abs(zero - y)).toFixed(1)}" fill="${color}" opacity="0.82" rx="2"/>`;
    g += `<text x="${cx}" y="${(Math.min(y, zero) - 4).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="8.5" fill="${C.ink}">${esc(item.value.toFixed(spec.decimals ?? 2))}</text>`;
    if (items.length <= 6) {
      const maxChars = Math.max(4, Math.floor(slot / 6.2));
      g += `<text x="${cx}" y="${box.y + box.h + 13}" text-anchor="middle" font-size="8.5" fill="${C.label}">${esc(truncate(item.label, maxChars))}</text>`;
    } else {
      g += `<text transform="translate(${cx} ${box.y + box.h + 12}) rotate(-16)" text-anchor="end" font-size="8.5" fill="${C.label}">${esc(truncate(item.label, 11))}</text>`;
    }
  });
  if (spec.refLine) {
    g += `<line x1="${box.x}" y1="${sy(spec.refLine.y).toFixed(1)}" x2="${box.x + box.w}" y2="${sy(spec.refLine.y).toFixed(1)}" stroke="${C.series[4]}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    if (spec.refLine.label) g += `<text x="${box.x + box.w - 2}" y="${(sy(spec.refLine.y) - 3).toFixed(1)}" text-anchor="end" font-size="8" font-family="${MONO}" fill="${C.series[4]}">${esc(spec.refLine.label)}</text>`;
  }
  return open(W, h, spec.title ?? 'Bar chart') + g + '</svg>';
}

function drawContour(spec: Extract<ChartSpec, { kind: 'contour' }>): string {
  const h = spec.height ?? 300;
  const { xs, ys, z } = spec;
  if (xs.length < 2 || ys.length < 2) return emptyChart(W, h, spec.title ?? 'Contour plot');
  const box: Box = { x: 58, y: 22, w: W - 76, h: h - 62 };
  const xMin = xs[0];
  const xMax = xs[xs.length - 1];
  const yMin = ys[0];
  const yMax = ys[ys.length - 1];
  const { sx, sy } = scales(box, xMin, xMax, yMin, yMax);
  const flat = z.flat().filter((v) => isFinite(v));
  const zMin = Math.min(...flat);
  const zMax = Math.max(...flat);
  const span = zMax - zMin || 1;
  let g = '';
  // Heat map: cells are merged into one path per band so neighbouring cells of
  // the same band never show a seam (overlapping rects double the opacity).
  const bands = 10;
  const paths: string[][] = Array.from({ length: bands }, () => []);
  for (let j = 0; j < ys.length - 1; j += 1) {
    for (let i = 0; i < xs.length - 1; i += 1) {
      const value = (z[j][i] + z[j][i + 1] + z[j + 1][i] + z[j + 1][i + 1]) / 4;
      if (!isFinite(value)) continue;
      const band = Math.min(bands - 1, Math.max(0, Math.floor(((value - zMin) / span) * bands)));
      const x0 = sx(xs[i]).toFixed(1);
      const x1 = sx(xs[i + 1]).toFixed(1);
      const y0 = sy(ys[j + 1]).toFixed(1);
      const y1 = sy(ys[j]).toFixed(1);
      paths[band].push(`M${x0} ${y0}h${(Number(x1) - Number(x0)).toFixed(1)}v${(Number(y1) - Number(y0)).toFixed(1)}h${(Number(x0) - Number(x1)).toFixed(1)}Z`);
    }
  }
  paths.forEach((commands, index) => {
    if (!commands.length) return;
    g += `<path d="${commands.join(' ')}" fill="${C.series[0]}" opacity="${(0.07 + (0.6 * index) / (bands - 1)).toFixed(3)}"/>`;
  });
  // Iso-lines through marching squares on the cell corners.
  const levels = Math.max(2, Math.min(8, spec.levels ?? 6));
  for (let k = 1; k < levels; k += 1) {
    const level = zMin + (span * k) / levels;
    for (let j = 0; j < ys.length - 1; j += 1) {
      for (let i = 0; i < xs.length - 1; i += 1) {
        const corners = [z[j][i], z[j][i + 1], z[j + 1][i + 1], z[j + 1][i]];
        const px = [xs[i], xs[i + 1], xs[i + 1], xs[i]];
        const py = [ys[j], ys[j], ys[j + 1], ys[j + 1]];
        const crossings: { x: number; y: number }[] = [];
        for (let e = 0; e < 4; e += 1) {
          const a = corners[e];
          const b = corners[(e + 1) % 4];
          if ((a - level) * (b - level) < 0) {
            const t = (level - a) / (b - a);
            crossings.push({
              x: px[e] + t * (px[(e + 1) % 4] - px[e]),
              y: py[e] + t * (py[(e + 1) % 4] - py[e]),
            });
          }
        }
        if (crossings.length >= 2) {
          g += `<line x1="${sx(crossings[0].x).toFixed(1)}" y1="${sy(crossings[0].y).toFixed(1)}" x2="${sx(crossings[1].x).toFixed(1)}" y2="${sy(crossings[1].y).toFixed(1)}" stroke="${C.series[3]}" stroke-width="1" opacity="0.7"/>`;
        }
      }
    }
  }
  (spec.points ?? []).forEach((point) => {
    if (point.x < xMin || point.x > xMax || point.y < yMin || point.y > yMax) return;
    g += `<circle cx="${sx(point.x).toFixed(1)}" cy="${sy(point.y).toFixed(1)}" r="2.4" fill="${C.surface}" stroke="${C.ink}" stroke-width="1"/>`;
  });
  g += `<line x1="${box.x}" y1="${box.y + box.h}" x2="${box.x + box.w}" y2="${box.y + box.h}" stroke="${C.axis}"/>`;
  g += `<line x1="${box.x}" y1="${box.y}" x2="${box.x}" y2="${box.y + box.h}" stroke="${C.axis}"/>`;
  ticks(xMin, xMax, 5).forEach((t) => {
    const xx = sx(t);
    g += `<text x="${xx.toFixed(1)}" y="${box.y + box.h + 15}" text-anchor="middle" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${esc(tickLabel(t, niceStep((xMax - xMin) / 5)))}</text>`;
  });
  ticks(yMin, yMax, 5).forEach((t) => {
    const yy = sy(t);
    g += `<text x="${box.x - 7}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${esc(tickLabel(t, niceStep((yMax - yMin) / 5)))}</text>`;
  });
  if (spec.xLabel) g += `<text x="${box.x + box.w / 2}" y="${box.y + box.h + 30}" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(spec.xLabel)}</text>`;
  if (spec.yLabel) g += `<text transform="translate(${box.x - 42} ${box.y + box.h / 2}) rotate(-90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(spec.yLabel)}</text>`;
  g += `<text x="${box.x + 4}" y="${box.y + 12}" font-family="${MONO}" font-size="8.5" fill="${C.label}">${esc(`${fmt(zMin, 3)} – ${fmt(zMax, 3)}`)}</text>`;
  return open(W, h, spec.title ?? 'Contour plot') + g + '</svg>';
}

function drawProbplot(spec: Extract<ChartSpec, { kind: 'probplot' }>): string {
  const h = spec.height ?? 280;
  const box: Box = { x: 62, y: 22, w: W - 84, h: h - 68 };
  if (!spec.points.length) return emptyChart(W, h, spec.title ?? 'Probability plot');
  const xs = spec.points.map((p) => p.x);
  const [xMin, xMax] = pad(extent(xs), 0.05);
  const yTicks = spec.yTicks && spec.yTicks.length
    ? spec.yTicks
    : [1, 5, 10, 25, 50, 75, 90, 95, 99].map((p) => ({ v: normalInv(p / 100), label: String(p) }));
  const yValues = yTicks.map((t) => t.v).concat(spec.points.map((p) => p.y));
  const yMin = Math.min(...yValues) - 0.25;
  const yMax = Math.max(...yValues) + 0.25;
  const { sx, sy } = scales(box, xMin, xMax, yMin, yMax);
  const { x, y, w, h: bh } = box;
  let g = '';
  yTicks.forEach((tick) => {
    const yy = sy(tick.v);
    g += `<line x1="${x}" y1="${yy.toFixed(1)}" x2="${x + w}" y2="${yy.toFixed(1)}" stroke="${tick.label === '50' ? C.axis : C.grid}" stroke-width="1" ${tick.label === '50' ? '' : 'stroke-dasharray="3 3"'}/>`;
    g += `<text x="${x - 7}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${esc(tick.label)}</text>`;
  });
  const xTicks = spec.xTicks && spec.xTicks.length
    ? spec.xTicks.filter((t) => t.v >= xMin && t.v <= xMax)
    : ticks(xMin, xMax, 5).map((t) => ({ v: t, label: tickLabel(t, niceStep((xMax - xMin) / 5)) }));
  xTicks.forEach((tick) => {
    const xx = sx(tick.v);
    g += `<line x1="${xx.toFixed(1)}" y1="${y + bh}" x2="${xx.toFixed(1)}" y2="${y + bh + 4}" stroke="${C.axis}"/>`;
    g += `<text x="${xx.toFixed(1)}" y="${y + bh + 15}" text-anchor="middle" font-family="${MONO}" font-size="${FS}" fill="${C.label}">${esc(tick.label)}</text>`;
  });
  g += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y + bh}" stroke="${C.axis}"/>`;
  g += `<line x1="${x}" y1="${y + bh}" x2="${x + w}" y2="${y + bh}" stroke="${C.axis}"/>`;
  const clipId = `sigrun-clip-${(clipSeq += 1)}`;
  g += `<defs><clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${bh}"/></clipPath></defs><g clip-path="url(#${clipId})">`;
  if (spec.ci && spec.ci.length > 1) {
    const upper = spec.ci.map((p) => `${sx(p.x).toFixed(1)},${sy(p.hi).toFixed(1)}`).join(' ');
    const lower = [...spec.ci].reverse().map((p) => `${sx(p.x).toFixed(1)},${sy(p.lo).toFixed(1)}`).join(' ');
    g += `<polygon points="${upper} ${lower}" fill="${C.band}" stroke="none"/>`;
  }
  if (spec.curve && spec.curve.length > 1) {
    g += `<polyline points="${spec.curve.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.series[4]}" stroke-width="2"/>`;
  } else {
    const f1 = xMin + (xMax - xMin) * 0.02;
    const f2 = xMax - (xMax - xMin) * 0.02;
    g += `<line x1="${sx(f1).toFixed(1)}" y1="${sy(spec.fit.intercept + spec.fit.slope * f1).toFixed(1)}" x2="${sx(f2).toFixed(1)}" y2="${sy(spec.fit.intercept + spec.fit.slope * f2).toFixed(1)}" stroke="${C.series[4]}" stroke-width="2"/>`;
  }
  spec.points.forEach((p) => {
    g += `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.7" fill="${C.series[0]}" opacity="0.85"/>`;
  });
  g += '</g>';
  if (spec.xLabel) g += `<text x="${x + w / 2}" y="${y + bh + 30}" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(spec.xLabel)}</text>`;
  if (spec.yLabel) g += `<text transform="translate(${x - 46} ${y + bh / 2}) rotate(-90)" text-anchor="middle" font-size="${FS + 0.5}" fill="${C.label}">${esc(spec.yLabel)}</text>`;
  if (spec.note) g += `<text x="${x + w - 4}" y="${y + 12}" text-anchor="end" font-family="${MONO}" font-size="9" fill="${C.label}">${esc(spec.note)}</text>`;
  return open(W, h, spec.title ?? 'Probability plot') + g + '</svg>';
}

export function renderChart(spec: ChartSpec, width?: number): string {
  W = width && width > 260 ? width : 560;
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
    case 'line': return drawLine(spec);
    case 'bar': return drawBar(spec);
    case 'contour': return drawContour(spec);
    case 'probplot': return drawProbplot(spec);
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
