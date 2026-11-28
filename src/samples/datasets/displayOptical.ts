/* ─────────────────────────────────────────────────────────────────────────
   Statelia — synthetic display-optics DOE (WO-3E-11 flagship)

   Twenty runs: a face-centred central composite design (2³ factorial + six
   axial + six centre points) in three design factors, with four responses.

   The data are SYNTHETIC and deterministic. They were generated from the
   quadratic models written below plus a fixed random seed, not measured on a
   real display line, and nothing here may be read as a product specification.

   Factor columns are stored in DESIGN (coded) units −1 / 0 / +1 because that is
   the unit Statelia's response-surface engine fits and that Minitab reports as
   coded levels. The actual-unit columns repeat the same runs in mA, mm and %
   so the physical setting is visible next to the design coordinate.
   ───────────────────────────────────────────────────────────────────────── */

import type { Worksheet } from '../../types';
import { mulberry32, normalRandom } from '../../lib/random';
import { makeWorksheet } from '../../lib/worksheetFactory';

/** Actual-unit anchor points of the coded design: −1 / 0 / +1. */
export const DISPLAY_FACTOR_LEVELS = {
  current: { low: 20, center: 50, high: 80, unit: 'mA', name: 'LED Current (mA)' },
  distance: { low: 2, center: 6, high: 10, unit: 'mm', name: 'Optical Distance (mm)' },
  haze: { low: 10, center: 40, high: 70, unit: '%', name: 'Diffuser Haze (%)' },
} as const;

/** Actual value of one coded level for a factor. */
function actual(level: number, factor: { low: number; center: number; high: number }): number {
  return level < 0 ? factor.low : level > 0 ? factor.high : factor.center;
}

/** Face-centred CCD run list, standard order (no randomisation: the seed is the run order). */
function faceCenteredCcd(k: number, centers: number): { ptType: string; levels: number[] }[] {
  const rows: { ptType: string; levels: number[] }[] = [];
  for (let row = 0; row < 2 ** k; row += 1) {
    const levels: number[] = [];
    for (let f = 0; f < k; f += 1) levels.push(((row >> (k - 1 - f)) & 1) === 0 ? -1 : 1);
    rows.push({ ptType: 'Factorial', levels });
  }
  for (let f = 0; f < k; f += 1) {
    for (const sign of [-1, 1]) {
      const levels = new Array(k).fill(0);
      levels[f] = sign;
      rows.push({ ptType: 'Axial', levels });
    }
  }
  for (let c = 0; c < centers; c += 1) rows.push({ ptType: 'Center', levels: new Array(k).fill(0) });
  return rows;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * The generator models, in coded units. Kept exported so a test can state what
 * the data were built from instead of trusting a comment.
 */
export function displayOpticalTruth(a: number, b: number, c: number): {
  luminance: number;
  power: number;
  uniformity: number;
  temperature: number;
} {
  return {
    luminance: 520 + 62 * a - 44 * b + 18 * c - 26 * a ** 2 - 10 * b ** 2 - 6 * c ** 2 + 12 * a * b - 8 * a * c + 6 * b * c,
    power: 11.5 + 2.1 * a - 0.7 * b - 0.3 * c + 0.35 * a ** 2 + 0.2 * b ** 2,
    uniformity: 90 - 2.4 * a + 2.4 * b - 3.6 * c - 2.2 * a ** 2 - 3.0 * b ** 2 - 1.4 * c ** 2 - 1.8 * a * b,
    temperature: 41.0 + 5.2 * a - 3.4 * b + 1.1 * c + 1.2 * a ** 2,
  };
}

export function buildDisplayOpticalDoE(): Worksheet {
  const rng = mulberry32(20261124);
  const runs = faceCenteredCcd(3, 6);
  const std: number[] = [];
  const run: number[] = [];
  const pt: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  const current: number[] = [];
  const distance: number[] = [];
  const haze: number[] = [];
  const luminance: number[] = [];
  const power: number[] = [];
  const uniformity: number[] = [];
  const temperature: number[] = [];
  runs.forEach((entry, index) => {
    const [fa, fb, fc] = entry.levels;
    std.push(index + 1);
    run.push(index + 1);
    pt.push(entry.ptType);
    a.push(fa);
    b.push(fb);
    c.push(fc);
    current.push(actual(fa, DISPLAY_FACTOR_LEVELS.current));
    distance.push(actual(fb, DISPLAY_FACTOR_LEVELS.distance));
    haze.push(actual(fc, DISPLAY_FACTOR_LEVELS.haze));
    const truth = displayOpticalTruth(fa, fb, fc);
    luminance.push(round(truth.luminance + normalRandom(rng, 0, 5), 1));
    power.push(round(truth.power + normalRandom(rng, 0, 0.12), 3));
    uniformity.push(round(truth.uniformity + normalRandom(rng, 0, 0.5), 2));
    temperature.push(round(truth.temperature + normalRandom(rng, 0, 0.6), 2));
  });
  return makeWorksheet('Display Optics DoE', [
    { name: 'StdOrder', type: 'numeric', values: std },
    { name: 'RunOrder', type: 'numeric', values: run },
    { name: 'PtType', type: 'text', values: pt },
    { name: 'LED Current (coded)', type: 'numeric', values: a },
    { name: 'Optical Distance (coded)', type: 'numeric', values: b },
    { name: 'Diffuser Haze (coded)', type: 'numeric', values: c },
    { name: 'LED Current (mA)', type: 'numeric', values: current },
    { name: 'Optical Distance (mm)', type: 'numeric', values: distance },
    { name: 'Diffuser Haze (%)', type: 'numeric', values: haze },
    { name: 'Luminance (cd/m2)', type: 'numeric', values: luminance },
    { name: 'Power Consumption (W)', type: 'numeric', values: power },
    { name: 'Uniformity (%)', type: 'numeric', values: uniformity },
    { name: 'Temperature (C)', type: 'numeric', values: temperature },
  ]);
}

/** Factor bounds the flagship tutorial states for the optimiser (coded units). */
export const DISPLAY_OPTICAL_FACTORS = ['LED Current (coded)', 'Optical Distance (coded)', 'Diffuser Haze (coded)'] as const;

/** Response names in the order the tutorial fits them. */
export const DISPLAY_OPTICAL_RESPONSES = [
  'Luminance (cd/m2)',
  'Power Consumption (W)',
  'Uniformity (%)',
  'Temperature (C)',
] as const;

/** Specification the optimisation step is asked to respect (response units). */
export const DISPLAY_OPTICAL_SPECS = {
  'Luminance (cd/m2)': { goal: 'maximize' as const, lower: 480, upper: 600 },
  'Power Consumption (W)': { goal: 'minimize' as const, lower: 6, upper: 14 },
  'Uniformity (%)': { goal: 'range' as const, lower: 85, upper: 100 },
  'Temperature (C)': { goal: 'range' as const, lower: 20, upper: 45 },
};

export function displayActualOf(coded: number, factor: 'current' | 'distance' | 'haze'): number {
  return actual(coded < 0 ? -1 : coded > 0 ? 1 : 0, DISPLAY_FACTOR_LEVELS[factor]);
}
