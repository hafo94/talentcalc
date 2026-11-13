import type { School, SpecRotation, TargetsFile } from "@/data/types";
import type { PowerKind } from "@/engine/abilities";
import type { PrepareArgs } from "@/engine/rotation";
import type { TargetInput } from "@/engine/stats";

/** Everything one simulation needs; plain data, so it can be posted to the worker (structured clone). */
export interface SimInput {
  prepare: Omit<PrepareArgs, "rotation" | "extraBuffs">;
  rotation: SpecRotation; // the user's rotation (with conditions)
  target: TargetInput; // presetTarget(...) incl. debuffs
  armorFormula: TargetsFile["armorFormula"];
}

export interface SimConfig {
  fightSec: number; // fight length; the target's health falls linearly from 100% to 0% over it
  iterations: number;
  seed: number; // uint32
  unlimitedMana: boolean; // mana never limits casts (cross-check with the analytical model)
  logLimit: number; // combat log lines of iteration 0
}
export const DEFAULT_SIM_CONFIG: SimConfig = {
  fightSec: 180,
  iterations: 1000,
  seed: 1,
  unlimitedMana: true, // gear v1 has no mana items (no MP5, no mana pool from gear): section 0 "Mana"
  logLimit: 300,
};
export const SIM_LIMITS = { fightSec: [30, 900], iterations: [10, 10000], seed: [0, 4294967295] } as const;

export interface Summary {
  mean: number;
  stdev: number; // sample standard deviation of the per-iteration DPS
  ci95: [number, number]; // mean +- 1.96 stdev / sqrt(n)
  min: number;
  max: number;
}

/** One damage source over all iterations (means per fight). */
export interface SimSource {
  key: string; // ability, "Main-hand melee", proc or talent label
  school: School;
  damage: number; // mean damage per fight
  dps: number;
  share: number; // % of the total damage
  casts: number; // casts, swings or procs per fight
  hits: number; // landed hits/ticks per fight (incl. crits and glancing blows)
  crits: number;
  misses: number; // missed, dodged or resisted casts/swings per fight
  ticks: number; // periodic ticks per fight
  averaged: boolean; // expected-value damage from the analytical model (not sampled)
}

export interface SimLogLine {
  t: number;
  source: string;
  outcome: "hit" | "crit" | "glance" | "miss" | "tick" | "tickCrit" | "cast" | "buff" | "fade" | "gain";
  damage: number;
  resource: number | null;
}

export interface SimResult {
  config: SimConfig;
  rotationLabel: string;
  power: PowerKind | null;
  dps: Summary;
  sources: SimSource[]; // sorted by damage
  idleSec: number; // mean seconds per fight with nothing to do (out of resource, waiting for cooldowns)
  oomSec: number; // mean seconds per fight waiting for mana
  timeline: { max: number; points: [number, number][] } | null; // iteration 0: resource over time
  log: SimLogLine[]; // iteration 0: the first `logLimit` events
  averaged: string[]; // talent handlers kept as analytical averages
  modeled: string[]; // procs and buffs sampled by the simulator
  elapsedMs: number;
}

export type SimRequest = { type: "run"; id: number; input: SimInput; config: SimConfig };
export type SimResponse =
  | { type: "progress"; id: number; done: number; total: number }
  | { type: "result"; id: number; result: SimResult }
  | { type: "error"; id: number; message: string };
