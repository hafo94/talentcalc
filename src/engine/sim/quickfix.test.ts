// Quick fixes L8-L10 (before Phase 6, plan section 8.2): energy finishers, Hammer of Wrath, Power Infusion.
import { describe, expect, it } from "vitest";
import type { ClassToken, RotationEntry } from "@/data/types";
import { runDamage } from "@/testkit/damage";
import { simInput, type SimScenario } from "@/testkit/sim";
import { weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { runSim } from "./run";
import { DEFAULT_SIM_CONFIG, type SimConfig } from "./types";

const DUAL = { mainHand: weapon(18832), offHand: weapon(19352) };
const cfg = (patch: Partial<SimConfig> = {}): SimConfig => ({ ...DEFAULT_SIM_CONFIG, ...patch });
const sim = (s: SimScenario, c: Partial<SimConfig> = {}) => runSim(simInput(s), cfg(c));
function maxed(token: ClassToken, spec: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of treeFor(token).nodes.values())
    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
  return out;
}
const casts = (r: ReturnType<typeof runSim>, key: string) => r.sources.find((x) => x.key === key)?.casts ?? 0;

const COMBAT: SimScenario = {
  classToken: "rogue",
  race: "HUMAN",
  weapons: DUAL,
  talents: maxed("rogue", 1),
  rotation: "rogue-combat",
};
const NO_BURSTS = {
  combat: [
    { ability: "Slice and Dice", kind: "finisher", cp: 5, buff: true },
    { ability: "Shank", kind: "cooldown" },
    { ability: "Sinister Strike", kind: "builder" },
    { ability: "Eviscerate", kind: "finisher", cp: 5 },
  ],
  assassination: [
    { ability: "Slice and Dice", kind: "finisher", cp: 5, buff: true },
    { ability: "Mutilate", kind: "builder" },
    { ability: "Sinister Strike", kind: "builder" },
    { ability: "Eviscerate", kind: "finisher", cp: 5 },
  ],
} satisfies Record<string, RotationEntry[]>;

describe("L8: energy finishers (analytical vs simulation)", () => {
  it("C9 Combat without cooldowns within 3%; the default Combat rotation within 5%", () => {
    const s = { ...COMBAT, entries: NO_BURSTS.combat };
    expect(Math.abs(sim(s).dps.mean / runDamage(s).result.rotation.dps - 1)).toBeLessThan(0.03);
    expect(Math.abs(sim(COMBAT).dps.mean / runDamage(COMBAT).result.rotation.dps - 1)).toBeLessThan(0.05);
  });
  it("C10 Assassination without Cold Blood within 5% (-3.5%)", () => {
    const s: SimScenario = {
      classToken: "rogue",
      race: "HUMAN",
      weapons: DUAL,
      talents: maxed("rogue", 0),
      rotation: "rogue-assassination",
      entries: NO_BURSTS.assassination,
    };
    expect(Math.abs(sim(s).dps.mean / runDamage(s).result.rotation.dps - 1)).toBeLessThan(0.05);
  });
  it("analytical: Slice and Dice is refreshed half a finisher cycle late when Eviscerate spends the combo points", () => {
    const r = runDamage({ ...COMBAT, entries: NO_BURSTS.combat }).result.rotation;
    const snd = r.casts.find((c) => c.key === "Slice and Dice")!;
    expect(snd.ability.durationSec).toBe(21);
    expect(snd.perMinute).toBeLessThan(60 / 21);
    expect(snd.perMinute).toBeGreaterThan(60 / 33);
    expect(r.casts.find((c) => c.key === "Eviscerate")!.perMinute).toBeGreaterThan(1);
  });
  it("simulation: a finisher that waits for energy keeps the combo points (Slice and Dice is not skipped for Eviscerate)", () => {
    const r = sim({ ...COMBAT, entries: NO_BURSTS.combat }, { iterations: 300 });
    expect(casts(r, "Slice and Dice")).toBeGreaterThan(5);
  });
});

describe("L9/L10: Hammer of Wrath and Power Infusion", () => {
  it("Hammer of Wrath needs no ranged weapon and is cast in the execute phase of the Retribution default", () => {
    const s: SimScenario = {
      classToken: "paladin",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: maxed("paladin", 2),
      rotation: "paladin-retribution",
    };
    const r = sim(s, { iterations: 1, logLimit: 100000 });
    const t = r.log.filter((l) => l.source === "Hammer of Wrath" && l.outcome === "cast").map((l) => l.t);
    expect(t.length).toBeGreaterThan(3);
    expect(Math.min(...t)).toBeGreaterThanOrEqual(0.8 * 180);
  });
  it("Power Infusion is self-cast: +20% spell damage for 15 s", () => {
    const s: SimScenario = {
      classToken: "priest",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      talents: { ...maxed("priest", 2), "Power Infusion": 1 },
      rotation: "priest-shadow",
    };
    const r = sim(s, { iterations: 300, logLimit: 100000 });
    const pi = r.log.filter((l) => l.source === "Power Infusion").map((l) => [l.t, l.outcome]);
    expect(pi).toEqual([
      [0, "cast"],
      [0, "buff"],
      [15, "fade"],
    ]);
    const without = sim({ ...s, talents: maxed("priest", 2) }, { iterations: 300 });
    expect(r.dps.mean).toBeGreaterThan(without.dps.mean * 1.01);
  });
});
