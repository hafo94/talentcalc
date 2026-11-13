// Phase 6: pets as their own actors in the simulator (plan section 8.3).
import { describe, expect, it } from "vitest";
import type { ClassToken } from "@/data/types";
import { runDamage } from "@/testkit/damage";
import { simInput, type SimScenario } from "@/testkit/sim";
import { ammo, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { runSim } from "./run";
import { DEFAULT_SIM_CONFIG, type SimConfig } from "./types";

const BOW = { ranged: weapon(18713), ammo: ammo(18042) };
const cfg = (patch: Partial<SimConfig> = {}): SimConfig => ({ ...DEFAULT_SIM_CONFIG, ...patch });
const sim = (s: SimScenario, c: Partial<SimConfig> = {}) => runSim(simInput(s), cfg(c));
function maxed(token: ClassToken, spec: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of treeFor(token).nodes.values())
    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
  return out;
}
const casts = (r: ReturnType<typeof runSim>, key: string) => r.sources.find((x) => x.key === key)?.casts ?? 0;

const CAT: SimScenario = {
  classToken: "hunter",
  race: "DWARF",
  weapons: BOW,
  rotation: "hunter-beast-mastery",
  pet: { family: "Cat" },
};
const LOCK = {
  classToken: "warlock" as const,
  race: "HUMAN",
  bonus: { spellPower: 300 },
  rotation: "warlock-demonology",
};
describe("pets in the simulator", () => {
  for (const [name, s] of [
    ["P-C1 hunter, Cat, no talents", CAT],
    [
      "P-C2 warlock, Imp, Demonology 5/5 talents",
      { ...LOCK, talents: maxed("warlock", 1), pet: { family: "Imp" } },
    ],
    [
      "P-C3 warlock, Succubus, Demonology 5/5 talents",
      { ...LOCK, talents: maxed("warlock", 1), pet: { family: "Succubus" } },
    ],
  ] as [string, SimScenario][])
    it(`cross-check pet DPS within 3%: ${name}`, () => {
      const r = sim(s);
      const a = runDamage(s).pet!.rotation.dps;
      expect(Math.abs(r.pet!.dps.mean / a - 1)).toBeLessThan(0.03);
      expect(r.sources.filter((x) => x.pet).every((x) => x.key.startsWith(`${r.pet!.name}: `))).toBe(true);
    });
  it("deterministic; the pet has its own RNG stream (the player's damage is unchanged)", () => {
    const a = sim(CAT, { iterations: 50, seed: 9 });
    expect({ ...a, elapsedMs: 0 }).toEqual({ ...sim(CAT, { iterations: 50, seed: 9 }), elapsedMs: 0 });
    const alone = sim({ ...CAT, pet: undefined }, { iterations: 50, seed: 9 });
    const owner = (r: typeof a) => r.sources.filter((x) => !x.pet).map((x) => [x.key, x.damage]);
    expect(owner(a)).toEqual(owner(alone));
    expect(a.dps.mean).toBeCloseTo(alone.dps.mean + a.pet!.dps.mean, 6);
    expect(alone.pet).toBeNull();
  });
  it("focus: the pet pools for Bite when it is ready (13 of 18 possible), Claw spends the rest", () => {
    const r = sim(CAT, { iterations: 200 });
    expect(casts(r, "Cat: Bite")).toBeGreaterThan(12);
    expect(casts(r, "Cat: Bite")).toBeLessThanOrEqual(18);
    expect(casts(r, "Cat: Claw")).toBeGreaterThan(20);
  });
  it("Bestial Wrath (pet burst) and Frenzy (crit proc) are sampled", () => {
    const r = sim({ ...CAT, talents: maxed("hunter", 0) }, { iterations: 1, logLimit: 100000 });
    expect(r.log.some((l) => l.source === "Cat: Bestial Wrath" && l.outcome === "buff")).toBe(true);
    expect(r.log.some((l) => l.source === "Cat: Frenzy" && l.outcome === "buff")).toBe(true);
    expect(r.modeled).toContain("Frenzy 5/5: Frenzy on 100% of melee crits");
  });
});
