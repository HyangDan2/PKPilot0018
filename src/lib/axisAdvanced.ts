/* ─────────────────────────────────────────────────────────────────────────
   Statelia — advanced axis scales and broken axes (Stage 3D, WO-08)

   The chart renderer keeps one mapping per axis: data value → pixel. This
   module owns the two pieces that make that mapping more than a straight line:

   1. the scale transform (linear, log10, natural log, symmetrical log and
      power), with its inverse so a pixel can be turned back into a value
      (box zoom, pan, the data cursor and the hover readout all need it), and
   2. a broken axis, where a stretch of the domain is omitted and drawn as a
      narrow gap with two break marks instead of being compressed into the
      picture without any sign that something is missing.

   Everything here is pure arithmetic: no DOM, no rounding for display. The
   renderer decides how a number is printed; this module only decides where it
   goes.
   ───────────────────────────────────────────────────────────────────────── */

import type { AxisBreakConfig, AxisScale, DateAxisConfig, DateAxisUnit } from './chartConfig';

export const AXIS_SCALE_IDS: AxisScale[] = ['linear', 'log10', 'ln', 'symlog', 'power'];

export interface ScaleOptions {
  /** Exponent of the power scale (0.05 … 5). */
  power?: number;
  /** C of the symmetrical-log transform, in data units (must be > 0). */
  logConstant?: number;
}

const MIN_LOG_CONSTANT = 1e-12;
const MIN_POWER = 0.05;
const MAX_POWER = 5;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function powerOf(options: ScaleOptions | undefined): number {
  const p = finite(options?.power, 0.5);
  return Math.min(MAX_POWER, Math.max(MIN_POWER, p));
}

function constantOf(options: ScaleOptions | undefined): number {
  const c = finite(options?.logConstant, 1);
  return Math.abs(c) < MIN_LOG_CONSTANT ? 1 : Math.abs(c);
}

/**
 * Data value → the coordinate the axis is linear in.
 *
 * Non-positive values under a logarithmic scale have no position: they return
 * `NaN`, which the renderer turns into "not drawn", never into a plausible but
 * wrong coordinate. `symlog` is the scale for data that does cross zero.
 */
export function mapScaleValue(value: number, scale: AxisScale, options: ScaleOptions = {}): number {
  if (!Number.isFinite(value)) return NaN;
  switch (scale) {
    case 'log10':
      return value > 0 ? Math.log10(value) : NaN;
    case 'ln':
      return value > 0 ? Math.log(value) : NaN;
    case 'symlog': {
      const c = constantOf(options);
      return Math.sign(value) * Math.log10(1 + Math.abs(value) / c);
    }
    case 'power': {
      const p = powerOf(options);
      return Math.sign(value) * Math.abs(value) ** p;
    }
    case 'linear':
    default:
      return value;
  }
}

/** Inverse of `mapScaleValue`: axis coordinate → data value. */
export function unmapScaleValue(mapped: number, scale: AxisScale, options: ScaleOptions = {}): number {
  if (!Number.isFinite(mapped)) return NaN;
  switch (scale) {
    case 'log10':
      return 10 ** mapped;
    case 'ln':
      return Math.exp(mapped);
    case 'symlog': {
      const c = constantOf(options);
      return Math.sign(mapped) * c * (10 ** Math.abs(mapped) - 1);
    }
    case 'power': {
      const p = powerOf(options);
      return Math.sign(mapped) * Math.abs(mapped) ** (1 / p);
    }
    case 'linear':
    default:
      return mapped;
  }
}

/** True when the scale can only show positive values. */
export function scaleNeedsPositive(scale: AxisScale): boolean {
  return scale === 'log10' || scale === 'ln';
}

/** Values a scale can actually place on the axis (non-positive dropped for log). */
export function filterScaleValues(values: number[], scale: AxisScale): number[] {
  if (scaleNeedsPositive(scale)) return values.filter((v) => Number.isFinite(v) && v > 0);
  return values.filter((v) => Number.isFinite(v));
}

/* ── date/time axis ───────────────────────────────────────────────────── */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_MS = 30.436875 * 86400000;
const YEAR_MS = 365.2425 * 86400000;

export const DATE_AXIS_UNITS: DateAxisUnit[] = ['day', 'week', 'month', 'year'];

/** Milliseconds represented by one `unit`. */
export function unitMilliseconds(unit: DateAxisUnit): number {
  switch (unit) {
    case 'week': return 7 * 86400000;
    case 'month': return MONTH_MS;
    case 'year': return YEAR_MS;
    case 'day':
    default: return 86400000;
  }
}

/** Axis value → milliseconds since the epoch. */
export function valueToTime(value: number, cfg: DateAxisConfig): number {
  const epoch = Number.isFinite(cfg.epoch) ? cfg.epoch : 0;
  return epoch + value * unitMilliseconds(cfg.unit);
}

/** Milliseconds → axis value (the inverse of `valueToTime`). */
export function timeToValue(time: number, cfg: DateAxisConfig): number {
  const epoch = Number.isFinite(cfg.epoch) ? cfg.epoch : 0;
  return (time - epoch) / unitMilliseconds(cfg.unit);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Format one axis value as a date label (UTC, so the label never shifts). */
export function dateLabel(value: number, cfg: DateAxisConfig): string {
  if (!Number.isFinite(value)) return '';
  const date = new Date(valueToTime(value, cfg));
  if (!Number.isFinite(date.getTime())) return '';
  const format = cfg.format ?? 'date';
  if (format === 'year') return String(date.getUTCFullYear());
  if (format === 'month-year') return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * Tick values for a date axis. Calendar unit steps are taken from the epoch
 * (so months land on the 1st), and the list is bounded at 48 labels.
 */
export function dateTickValues(min: number, max: number, cfg: DateAxisConfig, maxTicks = 12): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return [];
  const step = unitMilliseconds(cfg.unit);
  const startTime = valueToTime(min, cfg);
  const endTime = valueToTime(max, cfg);
  const first = Math.ceil(startTime / step) * step;
  const values: number[] = [];
  for (let t = first; t <= endTime + step * 1e-9 && values.length < 48; t += step) {
    values.push(timeToValue(t, cfg));
  }
  if (values.length <= maxTicks) return values;
  // Thin the list evenly but always keep both ends: a date axis that stops
  // short of its last tick misstates the range it covers.
  const kept: number[] = [];
  const stride = (values.length - 1) / Math.max(1, maxTicks - 1);
  for (let i = 0; i < maxTicks; i += 1) kept.push(values[Math.round(i * stride)]);
  return [...new Set(kept)];
}

/* ── broken axis ──────────────────────────────────────────────────────── */

export interface AxisSegment {
  /** Data range this segment covers, in data units. */
  from: number;
  to: number;
  /** Pixel range this segment covers. */
  p0: number;
  p1: number;
}

export interface AxisMap {
  toPixel: (value: number) => number;
  fromPixel: (pixel: number) => number;
  /** Pixel band the omitted stretch occupies, or null for a continuous axis. */
  breakBand: { p0: number; p1: number } | null;
  segments: AxisSegment[];
}

function clampToRange(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Build the value → pixel mapping for one axis.
 *
 * `pixels` may be given in either direction (a Y axis is [bottom, top]); the
 * sign of the span is carried through so ticks stay on the correct side.
 * `reverse` flips the mapping afterwards, exactly as an inverted axis does.
 *
 * A break whose limits are outside the domain, or whose two limits coincide,
 * is ignored: a break that describes nothing must not divide the axis.
 */
export function buildAxisMap(
  domain: [number, number],
  scale: AxisScale,
  pixels: [number, number],
  options: ScaleOptions & { reverse?: boolean; axisBreak?: AxisBreakConfig | null } = {},
): AxisMap {
  const [rawMin, rawMax] = domain;
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  const lo = mapScaleValue(min, scale, options);
  const hi = mapScaleValue(max, scale, options);
  const [p0, p1] = pixels;
  const dist = p1 - p0;
  const direction = Math.sign(dist) || 1;

  const brk = options.axisBreak;
  const breakUsable = Boolean(
    brk
    && Number.isFinite(brk.from) && Number.isFinite(brk.to)
    && brk.from < brk.to
    && brk.from >= min && brk.to <= max
    && !(brk.from <= min && brk.to >= max),
  );
  const mappedBreakLo = breakUsable ? mapScaleValue(brk!.from, scale, options) : NaN;
  const mappedBreakHi = breakUsable ? mapScaleValue(brk!.to, scale, options) : NaN;
  const usableBreak = breakUsable && Number.isFinite(mappedBreakLo) && Number.isFinite(mappedBreakHi)
    && mappedBreakHi > mappedBreakLo && hi > lo;

  const gap = usableBreak ? Math.min(Math.abs(dist) * 0.4, Math.max(2, Math.min(60, finite(brk!.size, 10)))) : 0;
  const drawLength = Math.abs(dist) - gap;
  const spanA = usableBreak ? mappedBreakLo - lo : 0;
  const spanB = usableBreak ? hi - mappedBreakHi : 0;
  const spanTotal = usableBreak ? spanA + spanB : hi - lo;

  const forward = (u: number): number => p0 + direction * u * Math.abs(dist);
  const reversePixel = (value: number): number => (options.reverse ? p0 + p1 - value : value);

  const toPixelRaw = (value: number): number => {
    const mapped = mapScaleValue(value, scale, options);
    if (!Number.isFinite(mapped) || !(spanTotal > 0)) return NaN;
    if (!usableBreak) {
      const jitter = brk && !breakUsable ? 0 : 0;
      void jitter;
      return forward((mapped - lo) / spanTotal);
    }
    if (mapped <= mappedBreakLo) return forward((mapped - lo) / spanTotal * (drawLength / Math.abs(dist)));
    if (mapped >= mappedBreakHi) {
      const withinB = (mapped - mappedBreakHi) / spanTotal * (drawLength / Math.abs(dist));
      return forward((spanA / spanTotal * drawLength + gap) / Math.abs(dist) + withinB);
    }
    // Inside the omitted stretch: keep the pixel at the near edge of the gap
    // so a stray value is never drawn as if it belonged to a shown segment.
    return forward((spanA / spanTotal * drawLength + gap / 2) / Math.abs(dist));
  };

  const fromPixelRaw = (pixel: number): number => {
    if (!Number.isFinite(pixel) || !(Math.abs(dist) > 0) || !(spanTotal > 0)) return NaN;
    const u = (pixel - p0) * direction / Math.abs(dist);
    if (!usableBreak) return unmapScaleValue(lo + u * spanTotal, scale, options);
    const uA = (spanA * drawLength) / (spanTotal * Math.abs(dist));
    const uGap = gap / Math.abs(dist);
    if (u <= uA) return unmapScaleValue(lo + (u / (drawLength / Math.abs(dist))) * spanTotal, scale, options);
    if (u >= uA + uGap) {
      const within = (u - uA - uGap) / (drawLength / Math.abs(dist));
      return unmapScaleValue(mappedBreakHi + within * spanTotal, scale, options);
    }
    return unmapScaleValue(mappedBreakHi, scale, options);
  };

  const toPixel = (value: number) => reversePixel(toPixelRaw(value));
  const fromPixel = (pixel: number) => fromPixelRaw(options.reverse ? p0 + p1 - pixel : pixel);

  const segments: AxisSegment[] = [];
  if (usableBreak) {
    const boundaryA = forward((spanA / spanTotal * drawLength) / Math.abs(dist));
    const boundaryB = forward((spanA / spanTotal * drawLength + gap) / Math.abs(dist));
    segments.push({ from: min, to: brk!.from, p0: reversePixel(p0), p1: reversePixel(boundaryA) });
    segments.push({ from: brk!.to, to: max, p0: reversePixel(boundaryB), p1: reversePixel(p1) });
    const bandStart = Math.min(boundaryA, boundaryB);
    const bandEnd = Math.max(boundaryA, boundaryB);
    return {
      toPixel,
      fromPixel,
      breakBand: { p0: reversePixel(bandStart), p1: reversePixel(bandEnd) },
      segments,
    };
  }
  segments.push({ from: min, to: max, p0, p1 });
  return { toPixel, fromPixel, breakBand: null, segments };
}

/** True when a value falls inside the stretch a broken axis omits. */
export function insideBreak(value: number, brk: AxisBreakConfig | null | undefined): boolean {
  if (!brk) return false;
  return Number.isFinite(value) && value > brk.from && value < brk.to;
}

/** Tick values kept on a broken axis: those outside the omitted stretch. */
export function ticksOutsideBreak<T extends { value: number }>(ticks: T[], brk: AxisBreakConfig | null | undefined): T[] {
  if (!brk) return ticks;
  return ticks.filter((tick) => !insideBreak(tick.value, brk));
}

/**
 * Minor tick values between the major ticks, `count` per interval. A broken
 * axis skips the interval that straddles the break.
 */
export function minorTickValues(major: number[], count: number, brk?: AxisBreakConfig | null): number[] {
  const per = Math.max(0, Math.min(20, Math.round(count)));
  if (per < 1 || major.length < 2) return [];
  const out: number[] = [];
  for (let i = 0; i < major.length - 1; i += 1) {
    const a = major[i];
    const b = major[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) continue;
    if (brk && insideBreak(a, brk) !== insideBreak(b, brk)) continue;
    for (let k = 1; k <= per; k += 1) {
      const value = a + ((b - a) * k) / (per + 1);
      // A minor tick inside the omitted stretch has no position on the drawn
      // axis, so it is not emitted at all.
      if (brk && insideBreak(value, brk)) continue;
      out.push(value);
    }
  }
  return out;
}

/** Clamp a manual break into the domain, or null when it describes nothing. */
export function normalizeAxisBreak(brk: AxisBreakConfig | null | undefined, domain: [number, number]): AxisBreakConfig | null {
  if (!brk) return null;
  const min = Math.min(domain[0], domain[1]);
  const max = Math.max(domain[0], domain[1]);
  const from = clampToRange(finite(brk.from, NaN), min, max);
  const to = clampToRange(finite(brk.to, NaN), min, max);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) return null;
  if (from <= min + (max - min) * 1e-9 && to >= max - (max - min) * 1e-9) return null;
  return { from, to, size: Math.min(60, Math.max(2, finite(brk.size, 10))) };
}
