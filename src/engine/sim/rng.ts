/**
 * Seeded PRNG (ARCHITECTURE rule 2: the engine never calls Math.random). sfc32 (Chris Doty-Humphrey, PractRand-clean,
 * period >= 2^32) seeded through splitmix32. Each iteration gets its own stream `iterationSeed(seed, i)`, so a result
 * does not depend on how iterations are batched.
 */
export type Rng = () => number; // uniform in [0, 1)

export function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const init = splitmix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();
  const next: Rng = () => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    return t / 4294967296;
  };
  for (let i = 0; i < 12; i++) next(); // discard the warm-up outputs
  return next;
}

/** Seed of iteration i: independent of the batch size and of the worker count. */
export function iterationSeed(seed: number, i: number): number {
  return splitmix32((seed >>> 0) ^ Math.imul(i + 1, 0x9e3779b1))();
}
