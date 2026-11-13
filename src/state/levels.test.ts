// Phase 7: the level selector (derive at levels below 60, buffs by level, store rules, URL).
import { beforeEach, describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import { EMPTY_BONUS } from "@/engine/stats";
import { spellFile } from "@/testkit/damage";
import { petFile } from "@/testkit/pets";
import { weaponsFile } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { decodeBuild, encodeBuild } from "./buildCode";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS, useCharacter } from "./character";
import { derive } from "./derived";
import { useCalc } from "./store";

const ch = {
  raceId: 1,
  weaponIds: NO_WEAPON_IDS,
  bonus: EMPTY_BONUS,
  buffIds: [] as string[],
  target: "boss" as const,
  custom: DEFAULT_CUSTOM,
  weapons: weaponsFile,
};
const warrior = (level: number) => ({
  tree: treeFor("warrior"),
  ranks: {},
  level,
  spells: spellFile("warrior"),
});

describe("derive below level 60 (Phase 7)", () => {
  it("L1/L3: Human warrior level 40: base stats, attack power, level-40 reference targets, rank by level", () => {
    const d = derive(warrior(40), { ...ch, weaponIds: { ...NO_WEAPON_IDS, mainHand: 2531 } }); // Great Axe, level 39, no stats
    if (!d.ok) throw new Error(d.reason);
    expect(d.stats.primary.str.value).toBe(87);
    expect(d.stats.attackPower.value).toBe(274);
    const d60 = derive(warrior(60), { ...ch, weaponIds: { ...NO_WEAPON_IDS, mainHand: 2531 } });
    if (!d60.ok) throw new Error(d60.reason);
    expect(d.stats.crit.mainHand.parts.find((p) => p.label.startsWith("Agility"))?.value).toBeCloseTo(4, 10);
    expect(d.stats.crit.mainHand.value).toBeCloseTo(d60.stats.crit.mainHand.value, 10); // 60 / 15 = 80 / 20
    expect(d.stats.weaponSkill.mainHand.value).toBe(200);
    expect(d.reference.map((v) => [v.level, v.armor.value])).toEqual([
      [43, 2414],
      [42, 2262],
      [40, 1980],
      [43, 1207],
    ]);
    const hs = d.damage!.result.abilities.find((a) => a.key === "Heroic Strike");
    expect(hs?.available && hs.spell.id).toBe(11565); // rank 6 (level 40), not 25286 (level 60)
    expect(Number.isFinite(d.damage!.totalDps)).toBe(true);
  });
  it("every class works at levels 1, 10, 25 and 59", () => {
    for (const token of [
      "warrior",
      "paladin",
      "hunter",
      "rogue",
      "priest",
      "shaman",
      "mage",
      "warlock",
      "druid",
    ] as const)
      for (const level of [1, 10, 25, 59]) {
        const d = derive(
          { tree: treeFor(token), ranks: {}, level, spells: spellFile(token), pets: petFile(token) },
          {
            ...ch,
            raceId: token === "hunter" ? 3 : token === "druid" ? 4 : 1,
            pet: { family: 0, sacrifice: 0, scaling: true },
          },
        );
        if (!d.ok) throw new Error(`${token} ${level}: ${d.reason}`);
        expect(d.stats.level).toBe(level);
        for (const v of d.reference)
          expect(Number.isFinite(v.dps), `${token} ${level} ${v.presetId}`).toBe(true);
      }
  });
  it("a buff does nothing below its minLevel (Battle Shout rank 7: level 60)", () => {
    const ap = (level: number, buffIds: string[]) => {
      const d = derive(warrior(level), { ...ch, buffIds });
      if (!d.ok) throw new Error(d.reason);
      return d.stats.attackPower.value;
    };
    expect(ap(60, ["battle_shout"]) - ap(60, [])).toBe(139);
    expect(ap(59, ["battle_shout"]) - ap(59, [])).toBe(0);
    expect(ap(20, ["blessing_of_kings"])).toBeGreaterThan(ap(20, []));
  });
  it("the pet has the player's level", () => {
    const d = derive(
      { tree: treeFor("hunter"), ranks: {}, level: 40, spells: spellFile("hunter"), pets: petFile("hunter") },
      { ...ch, raceId: 3, pet: { family: 2, sacrifice: 0, scaling: false } },
    );
    if (!d.ok) throw new Error(d.reason);
    const p = d.damage!.pet!;
    expect(p.stats.level).toBe(40);
    expect(p.stats.attackPower.value).toBe(174); // L4: 2 x 97 - 20, no owner scaling
    expect(p.stats.weapons.mainHand).toMatchObject({ min: 30, max: 50 });
  });
});

describe("level selector (store, URL)", () => {
  beforeEach(async () => {
    const r = decodeBuild("#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N", isClassToken); // Fire 33 / Frost 18
    if (!r.ok) throw new Error(r.reason);
    await useCalc.getState().applyBuildCode(r.build);
  });
  it("lowering the level removes the points above it, with a notice; the link carries the level", () => {
    const s = useCalc.getState();
    expect(Object.values(s.ranks).reduce((a, b) => a + b, 0)).toBe(51);
    s.setLevel(30);
    const t = useCalc.getState();
    expect(t.level).toBe(30);
    expect(Object.values(t.ranks).reduce((a, b) => a + b, 0)).toBe(21);
    expect(t.notice).toBe("Talent points above level 30 were removed.");
    const hash = encodeBuild({ classToken: "mage", level: 30, talentedRank: 0, ranks: t.ranks });
    expect(hash.startsWith("#v1.mage.30.0.")).toBe(true);
    const r = decodeBuild(hash, isClassToken);
    expect(r.ok && r.build.level).toBe(30);
    t.setLevel(60); // raising the level keeps the build
    expect(Object.values(useCalc.getState().ranks).reduce((a, b) => a + b, 0)).toBe(21);
    t.setLevel(99); // clamped
    expect(useCalc.getState().level).toBe(60);
  });
  it("weapons above the level are removed", async () => {
    useCharacter.setState({ weapons: weaponsFile, weaponIds: { ...NO_WEAPON_IDS, mainHand: 19356 } }); // Staff of the Shadow Flame, level 60
    useCalc.getState().setLevel(50);
    expect(useCharacter.getState().weaponIds.mainHand).toBe(0);
    expect(useCalc.getState().notice).toContain("Weapons that need a higher level than 50 were removed.");
  });
});
