import { describe, expect, it } from "vitest";
import type { ClassToken } from "@/data/types";
import { simInput, type SimScenario } from "@/testkit/sim";
import { ammo, buffs, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { runSim } from "./run";
import { DEFAULT_SIM_CONFIG } from "./types";

function maxed(token: ClassToken, spec: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of treeFor(token).nodes.values())
    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
  return out;
}
const RAID = [...buffs.presets.raidBuffs, ...buffs.presets.raidDebuffs];
const DUAL = { mainHand: weapon(18832), offHand: weapon(19352) };
/** The heaviest event loads: dual-wield melee with procs, energy, a caster with procs and DoTs. */
const CASES: [string, SimScenario][] = [
  [
    "rogue-combat",
    {
      classToken: "rogue",
      race: "HUMAN",
      weapons: DUAL,
      talents: maxed("rogue", 1),
      rotation: "rogue-combat",
    },
  ],
  [
    "warrior-fury",
    {
      classToken: "warrior",
      race: "HUMAN",
      weapons: DUAL,
      talents: maxed("warrior", 1),
      rotation: "warrior-fury",
    },
  ],
  [
    "mage-fire",
    {
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      talents: maxed("mage", 1),
      rotation: "mage-fire",
    },
  ],
  [
    "hunter-beast-mastery + Cat (Phase 6)",
    {
      classToken: "hunter",
      race: "DWARF",
      weapons: { ranged: weapon(18713), ammo: ammo(18042) },
      talents: maxed("hunter", 0),
      rotation: "hunter-beast-mastery",
      pet: { family: "Cat" },
    },
  ],
];

describe("simulation performance budget (section 8.5)", () => {
  for (const [name, s] of CASES)
    it(`${name}: 1000 iterations x 180 s under 2 s (Node, single thread)`, () => {
      const input = simInput({ ...s, buffIds: RAID });
      runSim(input, { ...DEFAULT_SIM_CONFIG, iterations: 50 }); // warm-up (JIT)
      const t0 = performance.now();
      const r = runSim(input, { ...DEFAULT_SIM_CONFIG, iterations: 1000 });
      const ms = performance.now() - t0;
      console.log(`${name}: ${ms.toFixed(0)} ms for 1000 x 180 s (${r.dps.mean.toFixed(1)} DPS)`);
      expect(ms).toBeLessThan(2000);
    });
});
