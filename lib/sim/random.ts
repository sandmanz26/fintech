/** Deterministic randomness so seeds and demos are reproducible. */

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number | string) {
  let a = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    /** Box-Muller normal. */
    normal: (mean = 0, sd = 1) => {
      const u = Math.max(1e-12, next());
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** Poisson via Knuth for small lambda, normal approximation for large. */
    poisson: (lambda: number) => {
      if (lambda <= 0) return 0;
      if (lambda > 60) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next()))));
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
  };
}
export type Rng = ReturnType<typeof rng>;
