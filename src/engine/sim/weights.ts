import type { BonusStats } from "@/engine/stats";
import { runDpsSamples, summarize } from "./run";
import type { SimConfig, SimInput, Summary } from "./types";

/** One stat-weight measurement: (DPS(to) - DPS(from)) / per, paired per iteration (same seed, same streams). */
export interface SimWeightPair {
  id: string;
  from: string;
  to: string;
  per: number;
}
export interface SimWeightsRequest {
  input: SimInput;
  patches: Record<string, Partial<BonusStats>>; // absolute bonus values per variant; {} = the build itself
  pairs: SimWeightPair[];
  config: SimConfig;
}
export interface SimWeightsResult {
  base: Summary; // DPS of the "base" patch (or the first patch)
  pairs: { id: string; delta: Summary }[]; // per-iteration differences / per: mean and 95% CI
  iterations: number;
  runs: number;
  elapsedMs: number;
}

/**
 * Phase 7 simulation weights: every patch is simulated with the same seed, so iteration i of every variant uses the
 * same random streams (common random numbers). A pair's CI comes from the per-iteration differences, which is far
 * narrower than comparing two independent means (+50 AP warrior: +-0.38 vs +-0.57 DPS at 1000 iterations).
 */
export function simWeights(
  req: SimWeightsRequest,
  onProgress?: (done: number, total: number) => void,
): SimWeightsResult {
  const t0 = globalThis.performance.now();
  const keys = Object.keys(req.patches);
  const samples = new Map<string, Float64Array>();
  keys.forEach((k, i) => {
    const input: SimInput = {
      ...req.input,
      prepare: { ...req.input.prepare, bonus: { ...req.input.prepare.bonus, ...req.patches[k] } },
    };
    samples.set(k, runDpsSamples(input, req.config));
    onProgress?.(i + 1, keys.length);
  });
  const pairs = req.pairs.flatMap((p) => {
    const a = samples.get(p.from);
    const b = samples.get(p.to);
    if (!a || !b) return [];
    const d = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) d[i] = (b[i]! - a[i]!) / p.per;
    return [{ id: p.id, delta: summarize(d) }];
  });
  return {
    base: summarize(samples.get("base") ?? samples.get(keys[0]!) ?? new Float64Array(0)),
    pairs,
    iterations: Math.max(1, Math.floor(req.config.iterations)),
    runs: keys.length,
    elapsedMs: globalThis.performance.now() - t0,
  };
}
