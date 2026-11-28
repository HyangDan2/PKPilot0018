/* ─────────────────────────────────────────────────────────────────────────
   Statelia — the seven built-in sample datasets

   Deterministic so every analysis and every tutorial always reproduces the
   same numbers. Moved here from `lib/datasets.ts` when the Sample Library
   arrived (WO-3E-09); `lib/datasets.ts` re-exports the registry so existing
   imports keep working.
   ───────────────────────────────────────────────────────────────────────── */

import type { Worksheet } from '../../types';
import { mulberry32, normalRandom } from '../../lib/random';
import { makeWorksheet } from '../../lib/worksheetFactory';

function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Coating-line process data: 60 parts, three lines, two shifts, defect types. */
export function buildProcessData(): Worksheet {
  const rng = mulberry32(20261121);
  const n = 60;
  const thickness: number[] = [];
  const line: string[] = [];
  const shift: string[] = [];
  const defect: string[] = [];
  const defectPool = [
    ...Array(18).fill('Scratch'),
    ...Array(11).fill('Dent'),
    ...Array(9).fill('Stain'),
    ...Array(6).fill('Burr'),
    ...Array(4).fill('Crack'),
  ];
  for (let i = 0; i < n; i += 1) {
    const lineIdx = i % 3;
    const drift = lineIdx === 1 ? 0.12 : 0;
    thickness.push(round(10.2 + drift + normalRandom(rng, 0, 0.28), 3));
    line.push(`Line ${lineIdx + 1}`);
    shift.push(i % 5 < 3 ? 'Day' : 'Night');
    defect.push(defectPool[Math.floor(rng() * defectPool.length)]);
  }
  return makeWorksheet('Coating Process', [
    { name: 'Thickness (mm)', type: 'numeric', values: thickness },
    { name: 'Line', type: 'text', values: line },
    { name: 'Shift', type: 'text', values: shift },
    { name: 'Defect', type: 'text', values: defect },
  ]);
}

/** Two-group comparison with a paired before/after block. */
export function buildComparisonData(): Worksheet {
  const rng = mulberry32(70123);
  const n = 40;
  const group: string[] = [];
  const hardness: number[] = [];
  const operator: string[] = [];
  const before: number[] = [];
  const after: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const isNew = i % 2 === 1;
    group.push(isNew ? 'New Cure' : 'Standard');
    hardness.push(round((isNew ? 62.8 : 60.4) + normalRandom(rng, 0, 2.1), 2));
    operator.push(`Op-${(i % 3) + 1}`);
    const b = round(74 + normalRandom(rng, 0, 4.2), 2);
    before.push(b);
    after.push(round(b - 2.6 + normalRandom(rng, 0, 1.6), 2));
  }
  return makeWorksheet('Cure Study', [
    { name: 'Group', type: 'text', values: group },
    { name: 'Hardness', type: 'numeric', values: hardness },
    { name: 'Operator', type: 'text', values: operator },
    { name: 'Before', type: 'numeric', values: before },
    { name: 'After', type: 'numeric', values: after },
  ]);
}

/** Three-factor process window for multiple regression. */
export function buildRegressionData(): Worksheet {
  const rng = mulberry32(99117);
  const n = 48;
  const temp: number[] = [];
  const pressure: number[] = [];
  const speed: number[] = [];
  const output: number[] = [];
  const shift: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = round(160 + rng() * 24, 1);
    const p = round(2 + rng() * 1.2, 2);
    const s = round(40 + rng() * 20, 1);
    temp.push(t);
    pressure.push(p);
    speed.push(s);
    output.push(round(58 + 0.12 * t + 4.1 * p - 0.16 * s + normalRandom(rng, 0, 1.4), 2));
    shift.push(i % 3 === 0 ? 'Night' : 'Day');
  }
  return makeWorksheet('Reactor Window', [
    { name: 'Temperature (C)', type: 'numeric', values: temp },
    { name: 'Pressure (bar)', type: 'numeric', values: pressure },
    { name: 'Speed (rpm)', type: 'numeric', values: speed },
    { name: 'Yield (%)', type: 'numeric', values: output },
    { name: 'Shift', type: 'text', values: shift },
  ]);
}

/**
 * Design runs for the sample datasets. Generated locally (not imported from
 * doe.ts) so the sample module and the DOE module never import each other.
 */
function designRuns(kind: 'factorial' | 'ccd', k: number, centers: number): { std: number; run: number; ptType: string; levels: number[] }[] {
  const rows: { ptType: string; levels: number[] }[] = [];
  if (kind === 'factorial') {
    for (let row = 0; row < 2 ** k; row += 1) {
      const levels: number[] = [];
      for (let f = 0; f < k; f += 1) levels.push(((row >> (k - 1 - f)) & 1) === 0 ? -1 : 1);
      rows.push({ ptType: 'Factorial', levels });
    }
  } else {
    for (let row = 0; row < 2 ** k; row += 1) {
      const levels: number[] = [];
      for (let f = 0; f < k; f += 1) levels.push(((row >> (k - 1 - f)) & 1) === 0 ? -1 : 1);
      rows.push({ ptType: 'Factorial', levels });
    }
    const alpha = Math.pow(2, k) ** 0.25;
    for (let f = 0; f < k; f += 1) {
      for (const sign of [-1, 1]) {
        const levels = new Array(k).fill(0);
        levels[f] = sign * alpha;
        rows.push({ ptType: 'Axial', levels });
      }
    }
  }
  for (let c = 0; c < centers; c += 1) rows.push({ ptType: 'Center', levels: new Array(k).fill(0) });
  return rows.map((entry, index) => ({ std: index + 1, run: index + 1, ...entry }));
}

/** Gage R&R: 10 parts × 3 operators × 3 replicates, with real part variation. */
export function buildGageData(): Worksheet {
  const rng = mulberry32(411025);
  const parts = 10;
  const operators = ['A. Reyes', 'B. Kim', 'C. Novak'];
  const part: string[] = [];
  const operator: string[] = [];
  const measurement: number[] = [];
  const partOffset = [0.0, 0.35, 0.75, 1.05, 1.45, 1.8, 2.15, 2.5, 2.85, 3.2];
  const operatorOffset = [0.0, 0.28, -0.18];
  for (let op = 0; op < operators.length; op += 1) {
    for (let p = 0; p < parts; p += 1) {
      for (let rep = 0; rep < 3; rep += 1) {
        part.push(`P${p + 1}`);
        operator.push(operators[op]);
        measurement.push(round(10 + partOffset[p] + operatorOffset[op] + normalRandom(rng, 0, 0.16), 3));
      }
    }
  }
  return makeWorksheet('Gage R&R', [
    { name: 'Part', type: 'text', values: part },
    { name: 'Operator', type: 'text', values: operator },
    { name: 'Measurement', type: 'numeric', values: measurement },
  ]);
}

/** 2^3 factorial design with two centre points and a response column. */
export function buildDoeData(): Worksheet {
  const rng = mulberry32(73015);
  const runs = designRuns('factorial', 3, 2);
  const std: number[] = [];
  const run: number[] = [];
  const pt: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  const y: number[] = [];
  runs.forEach((entry) => {
    std.push(entry.std);
    run.push(entry.run);
    pt.push(entry.ptType);
    a.push(entry.levels[0]);
    b.push(entry.levels[1]);
    c.push(entry.levels[2]);
    const response = 62 + 4 * entry.levels[0] + 2.5 * entry.levels[1] - 1.5 * entry.levels[2]
      + 2 * entry.levels[0] * entry.levels[1] - 1.2 * entry.levels[0] * entry.levels[2]
      + normalRandom(rng, 0, 0.45);
    y.push(round(response, 2));
  });
  return makeWorksheet('2^3 Design', [
    { name: 'StdOrder', type: 'numeric', values: std },
    { name: 'RunOrder', type: 'numeric', values: run },
    { name: 'PtType', type: 'text', values: pt },
    { name: 'A', type: 'numeric', values: a },
    { name: 'B', type: 'numeric', values: b },
    { name: 'C', type: 'numeric', values: c },
    { name: 'Y', type: 'numeric', values: y },
  ]);
}

/** Two-factor central composite design with a quadratic response. */
export function buildRsmData(): Worksheet {
  const rng = mulberry32(88112);
  const runs = designRuns('ccd', 2, 5);
  const std: number[] = [];
  const run: number[] = [];
  const pt: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const y: number[] = [];
  runs.forEach((entry) => {
    std.push(entry.std);
    run.push(entry.run);
    pt.push(entry.ptType);
    a.push(round(entry.levels[0], 3));
    b.push(round(entry.levels[1], 3));
    const response = 80 + 3 * entry.levels[0] + 2 * entry.levels[1]
      - 5 * entry.levels[0] ** 2 - 4 * entry.levels[1] ** 2 + 2 * entry.levels[0] * entry.levels[1]
      + normalRandom(rng, 0, 0.35);
    y.push(round(response, 2));
  });
  return makeWorksheet('RSM (CCD)', [
    { name: 'StdOrder', type: 'numeric', values: std },
    { name: 'RunOrder', type: 'numeric', values: run },
    { name: 'PtType', type: 'text', values: pt },
    { name: 'A', type: 'numeric', values: a },
    { name: 'B', type: 'numeric', values: b },
    { name: 'Y', type: 'numeric', values: y },
  ]);
}

/**
 * Weibull life data drawn from a Weibull(shape 2.2, scale 220) population and
 * right-censored at 400 hours (1 = censored), so the sample demonstrates a good
 * fit instead of an arbitrary list of times.
 */
export function buildWeibullData(): Worksheet {
  const rng = mulberry32(660214);
  const limit = 400;
  const times: number[] = [];
  const censored: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    const u = Math.min(1 - 1e-9, Math.max(1e-9, rng()));
    const life = 220 * Math.pow(-Math.log(1 - u), 1 / 2.2);
    if (life > limit) {
      times.push(limit);
      censored.push(1);
    } else {
      times.push(Math.round(life));
      censored.push(0);
    }
  }
  return makeWorksheet('Weibull Life', [
    { name: 'Time', type: 'numeric', values: times },
    { name: 'Censored', type: 'numeric', values: censored },
  ]);
}
