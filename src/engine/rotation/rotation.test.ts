import { describe, expect, it } from "vitest";
import { rotations, runDamage, spellFile } from "@/testkit/damage";
import { ammo, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import type { ClassToken } from "@/data/types";
import { pickRotation } from "./selfBuffs";

const WEAPONS: Record<ClassToken, Record<string, unknown>> = {
  warrior: { mainHand: weapon(12784) },
  paladin: { mainHand: weapon(12784) },
  hunter: { ranged: weapon(18713), ammo: ammo(18042) },
  rogue: { mainHand: weapon(18832), offHand: weapon(19352) },
  shaman: { mainHand: weapon(12784) },
  druid: {},
  priest: {},
  mage: {},
  warlock: {},
};
const RACE: Record<ClassToken, string> = {
  warrior: "HUMAN",
  paladin: "HUMAN",
  hunter: "DWARF",
  rogue: "HUMAN",
  priest: "HUMAN",
  shaman: "ORC",
  mage: "HUMAN",
  warlock: "HUMAN",
  druid: "TAUREN",
};

describe("rotations.json", () => {
  it("27 rotations, one per class and spec, abilities exist in the class spell file", () => {
    expect(rotations.rotations).toHaveLength(27);
    expect(new Set(rotations.rotations.map((r) => r.id)).size).toBe(27);
    for (const r of rotations.rotations) {
      const file = spellFile(r.class);
      const talentAbilities = [...treeFor(r.class).nodes.values()]
        .filter((n) => n.talent.kind === "ability")
        .map((n) => n.talent.name);
      for (const name of [...r.selfBuffs, ...r.entries.map((e) => e.ability)])
        expect(
          file.abilities.some((c) => c.name === name) || talentAbilities.includes(name),
          `${r.id}: ${name}`,
        ).toBe(true);
      expect([0, 1, 2]).toContain(r.spec);
      if (r.tier === 3) expect(r.role).not.toBe("dps");
    }
  });
  it("pickRotation: most points; ties and no points pick a dps spec", () => {
    const p = (t: ClassToken, pts: number[]) => pickRotation(rotations, t, pts).id;
    expect(p("warrior", [0, 0, 0])).toBe("warrior-arms");
    expect(p("paladin", [0, 0, 0])).toBe("paladin-retribution");
    expect(p("priest", [0, 0, 0])).toBe("priest-shadow");
    expect(p("mage", [10, 31, 10])).toBe("mage-fire");
    expect(p("priest", [21, 30, 0])).toBe("priest-holy");
    expect(p("druid", [0, 0, 31])).toBe("druid-restoration");
  });
});

describe("every rotation with its spec at max rank", () => {
  for (const r of rotations.rotations) {
    it(r.id, () => {
      const talents: Record<string, number> = {};
      for (const n of treeFor(r.class).nodes.values())
        if (n.specIndex === r.spec) talents[n.talent.name] = n.talent.maxRank;
      const d = runDamage({
        classToken: r.class,
        race: RACE[r.class],
        weapons: WEAPONS[r.class] as never,
        talents,
        rotation: r.id,
      });
      const rot = d.result.rotation;
      expect(Number.isFinite(rot.dps) && rot.dps > 0).toBe(true);
      for (const c of rot.casts) expect(Number.isFinite(c.dps) && c.perMinute >= 0).toBe(true);
      const expected = (reason: string) =>
        reason.endsWith("is the builder") || reason.endsWith("simulation only");
      if (r.tier === 1) expect(rot.skipped.filter((s) => !expected(s.reason))).toEqual([]);
    });
  }
});

describe("analytical model", () => {
  const mm = runDamage({
    classToken: "hunter",
    race: "DWARF",
    weapons: WEAPONS.hunter as never,
    rotation: "hunter-marksmanship",
  });
  const casts = Object.fromEntries(mm.result.rotation.casts.map((c) => [c.key, c]));
  it("shared category cooldown: Aimed Shot uses the whole 6 s category, Multi-Shot gets none", () => {
    expect(casts["Aimed Shot"]!.perMinute).toBeCloseTo(10, 10);
    expect(casts["Multi-Shot"]!.perMinute).toBeCloseTo(0, 10);
  });
  it("DoT entries are capped by their duration; Auto Shot loses the time spent casting", () => {
    expect(casts["Serpent Sting"]).toMatchObject({ perMinute: 4, limit: "duration" });
    expect(mm.result.rotation.white.ranged!.swingsPerMinute).toBeCloseTo((60 / 2.9) * (1 - 20 / 60), 10);
  });
  it("mana is reported, never limiting", () => {
    const rot = mm.result.rotation;
    expect(rot.resource).toBeNull();
    expect(rot.oomSeconds!).toBeCloseTo(mm.stats.mana!.value / rot.manaPerSecond, 10);
  });
  it("energy: finisher cycles buy builder casts; Shank's net energy feeds them", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: WEAPONS.rogue as never,
      rotation: "rogue-combat",
    });
    const c = Object.fromEntries(r.result.rotation.casts.map((x) => [x.key, x]));
    const ss = r.ability("Sinister Strike");
    const builderPerFinisher = 5 / ss.comboPoints; // 5 / 0.855
    expect(c["Shank"]).toMatchObject({ perMinute: 6, limit: "cooldown" }); // 10 s cooldown, +25 energy for 5
    // Shank generates (net -20) so it is processed first: 600 + 6 x 20 energy buy Slice and Dice cycles
    // (25 + 5.85 x 45 each); none is left for Eviscerate
    expect(c["Slice and Dice"]).toMatchObject({ limit: "resource" });
    expect(c["Slice and Dice"]!.perMinute).toBeCloseTo(720 / (25 + builderPerFinisher * 45), 10);
    expect(c["Eviscerate"]!.perMinute).toBeCloseTo(0, 10);
    expect(c["Sinister Strike"]!.perMinute).toBeCloseTo(
      builderPerFinisher * c["Slice and Dice"]!.perMinute,
      8,
    );
    expect(r.result.rotation.resource).toMatchObject({ power: "energy", incomePerMinute: 600 });
  });
});
