/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — built-in sample datasets
   Deterministic so every analysis reproduces the same numbers.
   ───────────────────────────────────────────────────────────────────────── */

import type { Column, Worksheet } from '../types';
import { mulberry32, normalRandom } from './random';

let counter = 0;

export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function makeWorksheet(name: string, columns: Omit<Column, 'id'>[]): Worksheet {
  return {
    id: uid('ws'),
    name,
    columns: columns.map((col, index) => ({ ...col, id: `C${index + 1}` })),
  };
}

export interface DatasetDef {
  id: string;
  nameKey: string;
  build: () => Worksheet;
}

function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Coating-line process data: 60 parts, three lines, two shifts, defect types. */
function buildProcessData(): Worksheet {
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
function buildComparisonData(): Worksheet {
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
function buildRegressionData(): Worksheet {
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

export const DATASETS: DatasetDef[] = [
  { id: 'process', nameKey: '@sample.process', build: buildProcessData },
  { id: 'comparison', nameKey: '@sample.comparison', build: buildComparisonData },
  { id: 'regression', nameKey: '@sample.regression', build: buildRegressionData },
];

export function emptyWorksheet(index = 1): Worksheet {
  return makeWorksheet(`Worksheet ${index}`, [
    { name: '', type: 'numeric', values: new Array(30).fill(null) },
    { name: '', type: 'text', values: new Array(30).fill(null) },
    { name: '', type: 'date', values: new Array(30).fill(null) },
  ]);
}
