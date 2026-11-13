import { PET_STREAM } from "@/engine/pets";
import { Fight, type Accumulator, type FightTrace } from "./engine";
import { buildModel } from "./model";
import { buildPetModel } from "./petModel";
import { createRng, iterationSeed, splitmix32 } from "./rng";
import type { SimConfig, SimInput, SimResult, SimSource, Summary } from "./types";

const Z95 = 1.96;

/** Mean, sample standard deviation, 95% confidence interval of the mean, min and max. */
export function summarize(values: ArrayLike<number>): Summary {
  const n = values.length;
  if (n === 0) return { mean: 0, stdev: 0, ci95: [0, 0], min: 0, max: 0 };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (values[i]! - mean) ** 2;
  const stdev = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  const half = (Z95 * stdev) / Math.sqrt(n);
  return { mean, stdev, ci95: [mean - half, mean + half], min, max };
}

export interface RunOptions {
  onProgress?(done: number, total: number): void;
  progressEvery?: number; // iterations between progress callbacks (default 50)
}

/**
 * Runs `config.iterations` fights (section 4.6). Iteration i uses its own seeded stream, so the result is identical for
 * the same input, config and seed, whatever the batching.
 */
/** Seed of the pet's stream in iteration i (independent of the player's stream, which stays unchanged). */
export const petIterationSeed = (seed: number, i: number): number =>
  splitmix32((iterationSeed(seed, i) ^ PET_STREAM) >>> 0)();

/**
 * Phase 7: total DPS (player + pet) of every iteration, nothing else (stat weights). Iteration i uses the same seeded
 * streams as runSim, so `runDpsSamples(x, c)` has the mean of `runSim(x, c).dps` and two inputs with the same seed
 * share their random numbers (paired differences).
 */
export function runDpsSamples(input: SimInput, config: SimConfig): Float64Array {
  const model = buildModel(input);
  const petModel = buildPetModel(input, model);
  const n = Math.max(1, Math.floor(config.iterations));
  const acc: Accumulator = new Map();
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = new Fight(model, config, createRng(iterationSeed(config.seed, i)), acc, null).run();
    const pet = petModel
      ? new Fight(petModel, config, createRng(petIterationSeed(config.seed, i)), acc, null).run().damage
      : 0;
    out[i] = (r.damage + pet) / config.fightSec;
  }
  return out;
}

export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}): SimResult {
  const t0 = globalThis.performance.now();
  const model = buildModel(input);
  const petModel = buildPetModel(input, model);
  const n = Math.max(1, Math.floor(config.iterations));
  const acc: Accumulator = new Map();
  const petAcc: Accumulator = new Map();
  const dps = new Float64Array(n);
  const petDps = new Float64Array(n);
  const trace: FightTrace = { log: [], logLimit: config.logLimit, timeline: [] };
  const petTrace: FightTrace = { log: [], logLimit: config.logLimit, timeline: [] };
  let idle = 0;
  let oom = 0;
  const every = opts.progressEvery ?? 50;
  for (let i = 0; i < n; i++) {
    const fight = new Fight(
      model,
      config,
      createRng(iterationSeed(config.seed, i)),
      acc,
      i === 0 ? trace : null,
    );
    const r = fight.run();
    const pet = petModel
      ? new Fight(
          petModel,
          config,
          createRng(petIterationSeed(config.seed, i)),
          petAcc,
          i === 0 ? petTrace : null,
        ).run().damage
      : 0;
    dps[i] = (r.damage + pet) / config.fightSec;
    petDps[i] = pet / config.fightSec;
    idle += r.idleSec;
    oom += r.oomSec;
    if (opts.onProgress && ((i + 1) % every === 0 || i + 1 === n)) opts.onProgress(i + 1, n);
  }
  const total = [...acc.values(), ...petAcc.values()].reduce((a, s) => a + s.damage, 0);
  const sources: SimSource[] = [
    ...[...acc.entries()].map(([key, s]) => ({ key, s, pet: false })),
    ...[...petAcc.entries()].map(([key, s]) => ({ key, s, pet: true })),
  ]
    .map(({ key, s, pet }) => ({
      key,
      school: s.school,
      damage: s.damage / n,
      dps: s.damage / n / config.fightSec,
      share: total > 0 ? (s.damage / total) * 100 : 0,
      casts: s.casts / n,
      hits: s.hits / n,
      crits: s.crits / n,
      misses: s.misses / n,
      ticks: s.ticks / n,
      averaged: s.averaged,
      pet,
    }))
    .filter((s) => s.damage > 0 || s.casts > 0)
    .sort((a, b) => b.damage - a.damage || a.key.localeCompare(b.key));
  const power = model.power;
  return {
    config,
    rotationLabel: input.rotation.label,
    power,
    dps: summarize(dps),
    pet: petModel && input.pet ? { name: input.pet.info.name, dps: summarize(petDps) } : null,
    sources,
    idleSec: idle / n,
    oomSec: oom / n,
    timeline:
      power && trace.timeline.length
        ? {
            max: power === "mana" ? model.maxMana : Math.max(100, ...trace.timeline.map((p) => p[1])),
            points: trace.timeline,
          }
        : null,
    log: petModel
      ? [...trace.log, ...petTrace.log].sort((a, b) => a.t - b.t).slice(0, config.logLimit)
      : trace.log,
    averaged: model.averaged,
    modeled: [...model.modeled, ...(petModel?.procs.labels ?? [])],
    elapsedMs: globalThis.performance.now() - t0,
  };
}
