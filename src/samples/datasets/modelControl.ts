/* ─────────────────────────────────────────────────────────────────────────
   Sigrún — model-control practice data (WO-3F-09)

   Four datasets that each make one modelling decision unavoidable:

     A  a replicated 2³ factorial, where a negligible interaction can leave the
        model and its degrees of freedom join the error estimate;
     B  an unreplicated 2³, where no pure error exists and Lenth's method is
        the only honest way to judge the effects;
     C  an unbalanced two-factor study, where the Type I and Type III sums of
        squares answer different questions;
     D  a resolution-IV screening design, where a term without its parents is
        not a model anyone should keep.

   Deterministic seeds, synthetic values, no measured product data.
   ───────────────────────────────────────────────────────────────────────── */

import type { Worksheet } from '../../types';
import { mulberry32, normalRandom } from '../../lib/random';
import { makeWorksheet } from '../../lib/worksheetFactory';

function round(v: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** A · replicated 2³ factorial (16 runs): pooling B×C is defensible. */
export function buildPoolingData(): Worksheet {
  const rng = mulberry32(20261203);
  const std: number[] = [];
  const run: number[] = [];
  const pt: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  const y: number[] = [];
  let row = 0;
  for (const av of [-1, 1]) {
    for (const bv of [-1, 1]) {
      for (const cv of [-1, 1]) {
        for (let rep = 0; rep < 2; rep += 1) {
          row += 1;
          std.push(row);
          run.push(row);
          pt.push('Factorial');
          a.push(av);
          b.push(bv);
          c.push(cv);
          const response = 70 + 4.5 * av + 3.1 * bv - 2.2 * cv
            + 2.4 * av * bv - 1.6 * av * cv + 0.1 * bv * cv - 0.05 * av * bv * cv
            + normalRandom(rng, 0, 0.55);
          y.push(round(response, 2));
        }
      }
    }
  }
  return makeWorksheet('2^3 Replicated', [
    { name: 'StdOrder', type: 'numeric', values: std },
    { name: 'RunOrder', type: 'numeric', values: run },
    { name: 'PtType', type: 'text', values: pt },
    { name: 'A', type: 'numeric', values: a },
    { name: 'B', type: 'numeric', values: b },
    { name: 'C', type: 'numeric', values: c },
    { name: 'Y', type: 'numeric', values: y },
  ]);
}

/** B · unreplicated 2³ factorial (8 runs): saturated, so Lenth decides. */
export function buildUnreplicatedData(): Worksheet {
  const std: number[] = [];
  const run: number[] = [];
  const pt: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  const y: number[] = [];
  let row = 0;
  for (const av of [-1, 1]) {
    for (const bv of [-1, 1]) {
      for (const cv of [-1, 1]) {
        row += 1;
        std.push(row);
        run.push(row);
        pt.push('Factorial');
        a.push(av);
        b.push(bv);
        c.push(cv);
        const response = 70 + 6 * av + 1.1 * bv - 0.9 * cv
          + 0.8 * av * bv - 0.6 * av * cv + 0.5 * bv * cv + 0.3 * av * bv * cv;
        y.push(round(response, 2));
      }
    }
  }
  return makeWorksheet('2^3 Unreplicated', [
    { name: 'StdOrder', type: 'numeric', values: std },
    { name: 'RunOrder', type: 'numeric', values: run },
    { name: 'PtType', type: 'text', values: pt },
    { name: 'A', type: 'numeric', values: a },
    { name: 'B', type: 'numeric', values: b },
    { name: 'C', type: 'numeric', values: c },
    { name: 'Y', type: 'numeric', values: y },
  ]);
}

/** C · unbalanced Machine × Shift study: Type I and Type III differ. */
export function buildUnbalancedGlmData(): Worksheet {
  const rng = mulberry32(20261204);
  const machine = ['M1', 'M2', 'M3'];
  const shift = ['Day', 'Night'];
  const counts: Record<string, number> = { 'M1|Day': 5, 'M1|Night': 3, 'M2|Day': 3, 'M2|Night': 5, 'M3|Day': 4, 'M3|Night': 4 };
  const machineEffect: Record<string, number> = { M1: 0, M2: 2.1, M3: -1.4 };
  const shiftEffect: Record<string, number> = { Day: 0, Night: 2.8 };
  const interaction: Record<string, number> = { 'M1|Day': 0, 'M1|Night': -1.3, 'M2|Day': 1.1, 'M2|Night': 0, 'M3|Day': 0, 'M3|Night': 0.4 };
  const machineCol: string[] = [];
  const shiftCol: string[] = [];
  const strength: number[] = [];
  machine.forEach((m) => {
    shift.forEach((s) => {
      const n = counts[`${m}|${s}`];
      for (let i = 0; i < n; i += 1) {
        machineCol.push(m);
        shiftCol.push(s);
        strength.push(round(55 + machineEffect[m] + shiftEffect[s] + interaction[`${m}|${s}`] + normalRandom(rng, 0, 0.5), 2));
      }
    });
  });
  return makeWorksheet('Unbalanced Study', [
    { name: 'Machine', type: 'text', values: machineCol },
    { name: 'Shift', type: 'text', values: shiftCol },
    { name: 'Strength', type: 'numeric', values: strength },
  ]);
}

/** D · resolution-IV 2^(4−1) screening design (D = ABC): hierarchy practice. */
export function buildScreeningData(): Worksheet {
  const rng = mulberry32(20261205);
  const std: number[] = [];
  const run: number[] = [];
  const pt: string[] = [];
  const a: number[] = [];
  const b: number[] = [];
  const c: number[] = [];
  const d: number[] = [];
  const time: number[] = [];
  let row = 0;
  for (const av of [-1, 1]) {
    for (const bv of [-1, 1]) {
      for (const cv of [-1, 1]) {
        row += 1;
        std.push(row);
        run.push(row);
        pt.push('Factorial');
        a.push(av);
        b.push(bv);
        c.push(cv);
        d.push(av * bv * cv);
        const response = 45 + 2.6 * av + 1.9 * bv - 1.2 * cv + 0.4 * av * bv * cv
          + 1.5 * av * bv + normalRandom(rng, 0, 0.45);
        time.push(round(response, 2));
      }
    }
  }
  return makeWorksheet('2^(4-1) Screening', [
    { name: 'StdOrder', type: 'numeric', values: std },
    { name: 'RunOrder', type: 'numeric', values: run },
    { name: 'PtType', type: 'text', values: pt },
    { name: 'A', type: 'numeric', values: a },
    { name: 'B', type: 'numeric', values: b },
    { name: 'C', type: 'numeric', values: c },
    { name: 'D', type: 'numeric', values: d },
    { name: 'Cycle Time', type: 'numeric', values: time },
  ]);
}
