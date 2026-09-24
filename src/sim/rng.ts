/** Seeded PRNG (mulberry32). Deterministic across JS engines. */
export interface Rng {
  /** uniform [0,1) */
  next(): number;
  /** integer in [0,n) */
  int(n: number): number;
  /** uniform [a,b) */
  range(a: number, b: number): number;
  /** internal 32-bit state (for hashing/debug) */
  getState(): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (lo, hi) => lo + (hi - lo) * next(),
    getState: () => a,
  };
}
