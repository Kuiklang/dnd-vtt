/** Random source abstraction so rolls can be deterministic in tests. */
export interface Rng {
  /** Uniform integer in [1, sides]. */
  int(sides: number): number;
}

/**
 * Cryptographically secure, unbiased RNG (rejection sampling) using Web Crypto,
 * which is available in both modern browsers and Node >= 19.
 */
export const cryptoRng: Rng = {
  int(sides: number): number {
    if (!Number.isInteger(sides) || sides < 1) throw new RangeError("sides must be a positive integer");
    if (sides === 1) return 1;
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x1_0000_0000 / sides) * sides;
    for (;;) {
      globalThis.crypto.getRandomValues(buf);
      const v = buf[0]!;
      if (v < limit) return (v % sides) + 1;
    }
  },
};

/** Deterministic RNG that replays a fixed sequence of face values (for tests). */
export function sequenceRng(values: number[]): Rng {
  let i = 0;
  return {
    int(sides: number) {
      if (i >= values.length) throw new Error("sequenceRng exhausted");
      const v = values[i++]!;
      if (v < 1 || v > sides) throw new Error(`sequenceRng value ${v} out of range for d${sides}`);
      return v;
    },
  };
}

/** Small seeded PRNG (mulberry32) for reproducible simulations. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    int(sides: number) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(r * sides) + 1;
    },
  };
}
