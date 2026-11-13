// Phase 7 stat weights. W1 is re-derived by an independent Python script (plan section 9.2).
import { describe, expect, it } from "vitest";
import { EMPTY_BONUS } from "@/engine/stats";
import { spellFile } from "@/testkit/damage";
import { petFile } from "@/testkit/pets";
import { weaponsFile } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import type { ClassToken } from "@/data/types";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS } from "./character";
import type { InsightInputs } from "./insight";
import { snapshot } from "./insight";
import { specRotation } from "./rotation";
import { statWeights, usedJobs, weightJobs } from "./weights";

function inputs(
  token: ClassToken,
  raceId: number,
  weapons = {},
  rotation = specRotation(token, 0)!,
): InsightInputs {
  return {
    calc: { tree: treeFor(token), ranks: {}, level: 60, spells: spellFile(token), pets: petFile(token) },
    ch: {
      raceId,
      weaponIds: { ...NO_WEAPON_IDS, ...weapons },
      bonus: EMPTY_BONUS,
      buffIds: [],
      target: "boss",
      custom: DEFAULT_CUSTOM,
      weapons: weaponsFile,
      pet: { family: 0, sacrifice: 0, scaling: true },
    },
    rotation,
  };
}

describe("analytical stat weights", () => {
  it("W1: Human mage, no talents, Frostbolt only (independent Python check)", () => {
    const w = statWeights(inputs("mage", 1, {}, specRotation("mage", 2)!))!;
    expect(w.dps).toBeCloseTo(125.570458, 5);
    expect(w.reference?.key).toBe("spellPower");
    const row = (k: string) => w.rows.find((r) => r.def.key === k)!;
    expect(w.rows.map((r) => r.def.key)).toEqual(["spellPower", "int", "spellHit", "spellCrit", "haste"]);
    expect(row("spellPower").perPoint).toBeCloseTo(0.21518811, 7);
    expect(row("spellCrit").perPoint).toBeCloseTo(0.61765833, 7);
    expect(row("spellCrit").ep).toBeCloseTo(2.870318, 5);
    expect(row("spellHit").perPoint).toBeCloseTo(1.51289709, 7); // average from 0% to the 16% cap
    expect(row("spellHit").ep).toBeCloseTo(7.030579, 5);
    expect(row("spellHit").cap).toMatchObject({ current: 0, cap: 16, above: 0 });
    expect(row("haste").ep).toBeCloseTo(5.835381, 5);
    expect(row("int").ep).toBeCloseTo(0.048241, 5);
  });
  it("melee hit: the first 1% is suppressed vs a boss, so the weight is the average up to the cap", () => {
    const inp = inputs("warrior", 1, { mainHand: 12784 });
    const w = statWeights(inp)!;
    const hit = w.rows.find((r) => r.def.key === "hit")!;
    expect(hit.cap).toMatchObject({ current: 0, cap: 9 });
    const at = (hitBonus: number) => snapshot(inp, inp.calc.ranks, { ...EMPTY_BONUS, hit: hitBonus })!.dps;
    expect(at(1)).toBeCloseTo(at(0), 10); // suppressed
    expect(hit.perPoint).toBeCloseTo((at(9) - at(0)) / 9, 10);
    expect(hit.perPoint!).toBeGreaterThan(0);
    expect(w.reference?.key).toBe("attackPower");
    expect(w.rows.find((r) => r.def.key === "str")!.ep).toBeCloseTo(2, 6); // 1 Str = 2 AP for warriors
  });
  it("hunters: +AP also adds ranged AP, so ranged AP is the reference (tie goes to the specific stat)", () => {
    const w = statWeights(inputs("hunter", 3, { ranged: 18713, ammo: 18042 }))!;
    expect(w.reference?.key).toBe("rangedAttackPower");
    expect(w.rows.find((r) => r.def.key === "rangedAttackPower")!.ep).toBe(1);
  });
  it("jobs: every stat measured; the weights keep the patches their rows use", () => {
    const inp = inputs("mage", 1, {}, specRotation("mage", 2)!);
    const all = weightJobs(inp);
    expect(all.pairs.find((p) => p.id === "spellHit")).toEqual({
      id: "spellHit",
      from: "base",
      to: "spellHit:cap",
      per: 16,
    });
    expect(all.patches["spellHit:cap+1"]).toEqual({ spellHit: 17 });
    const w = statWeights(inp)!;
    expect(Object.keys(w.jobs.patches).sort()).toEqual(
      ["base", "haste", "int", "spellCrit", "spellHit:cap", "spellHit:cap+1", "spellPower"].sort(),
    );
    expect(usedJobs(all, new Set(["haste"])).patches).toEqual({ base: {}, haste: { haste: 1 } });
  });
});
