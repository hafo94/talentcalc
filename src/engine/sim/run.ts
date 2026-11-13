import { Fight, type Accumulator, type FightTrace } from "./engine";
import { buildModel } from "./model";
import { createRng, iterationSeed } from "./rng";
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
export function runSim(input: SimInput, config: SimConfig, opts: RunOptions = {}): SimResult {
  const t0 = globalThis.performance.now();
  const model = buildModel(input);
  const n = Math.max(1, Math.floor(config.iterations));
  const acc: Accumulator = new Map();
  const dps = new Float64Array(n);
  const trace: FightTrace = { log: [], logLimit: config.logLimit, timeline: [] };
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
    dps[i] = r.damage / config.fightSec;
    idle += r.idleSec;
    oom += r.oomSec;
    if (opts.onProgress && ((i + 1) % every === 0 || i + 1 === n)) opts.onProgress(i + 1, n);
  }
  const total = [...acc.values()].reduce((a, s) => a + s.damage, 0);
  const sources: SimSource[] = [...acc.entries()]
    .map(([key, s]) => ({
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
    }))
    .filter((s) => s.damage > 0 || s.casts > 0)
    .sort((a, b) => b.damage - a.damage || a.key.localeCompare(b.key));
  const power = model.power;
  return {
    config,
    rotationLabel: input.rotation.label,
    power,
    dps: summarize(dps),
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
    log: trace.log,
    averaged: model.averaged,
    modeled: model.modeled,
    elapsedMs: globalThis.performance.now() - t0,
  };
}
