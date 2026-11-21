/* Sigrún — deterministic pseudo-random data generation */

export type RandomKind = 'normal' | 'uniform' | 'integer';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalRandom(rng: () => number, mean = 0, sd = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface RandomOptions {
  kind: RandomKind;
  count: number;
  mean?: number;
  sd?: number;
  min?: number;
  max?: number;
  seed?: number;
}

export function generateRandom(options: RandomOptions): number[] {
  const rng = mulberry32(options.seed ?? Date.now() % 2147483647);
  const count = Math.max(0, Math.floor(options.count));
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (options.kind === 'normal') {
      out.push(normalRandom(rng, options.mean ?? 0, Math.max(1e-9, options.sd ?? 1)));
    } else if (options.kind === 'uniform') {
      const min = options.min ?? 0;
      const max = options.max ?? 1;
      out.push(min + (max - min) * rng());
    } else {
      const min = Math.ceil(options.min ?? 0);
      const max = Math.floor(options.max ?? 10);
      out.push(min + Math.floor(rng() * (max - min + 1)));
    }
  }
  return out;
}
