import { describe, expect, it } from "vitest";
import { classesFile } from "@/data";
import { treeFor } from "@/testkit/talents";
import { weaponsFile } from "@/testkit/stats";
import { EMPTY_BONUS } from "@/engine/stats";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS, sanitizeWeapons } from "./character";
import { derive } from "./derived";

const ch = {
  raceId: 1,
  weaponIds: NO_WEAPON_IDS,
  bonus: EMPTY_BONUS,
  buffIds: [],
  target: "boss" as const,
  custom: DEFAULT_CUSTOM,
  weapons: weaponsFile,
};
describe("derive", () => {
  it("naked human warrior", () => {
    const d = derive({ tree: treeFor("warrior"), ranks: {}, level: 60 }, ch);
    if (!d.ok) throw new Error(d.reason);
    expect(d.stats.attackPower.value).toBe(400);
    expect(d.reference.map((v) => v.level)).toEqual([63, 62, 60, 63]);
    expect(d.reference.map((v) => v.armor.value)).toEqual([3731, 3677, 3566, 1866]);
  });
  it("works for every class and playable race", () => {
    for (const c of classesFile.classes)
      for (const raceId of c.raceIds) {
        const d = derive({ tree: treeFor(c.token), ranks: {}, level: 60 }, { ...ch, raceId });
        expect(d.ok, `${c.token} ${raceId}`).toBe(true);
      }
  });
  it("level below 60 has no stats", () => {
    expect(derive({ tree: treeFor("warrior"), ranks: {}, level: 40 }, ch)).toEqual({
      ok: false,
      reason: "level",
    });
  });
  it("sanitizeWeapons drops what the class cannot use", () => {
    // mage cannot use Arcanite Reaper (2H axe) nor dual wield
    expect(
      sanitizeWeapons({ mainHand: 12784, offHand: 19352, ranged: 0, ammo: 0 }, weaponsFile, "mage", 60),
    ).toEqual(NO_WEAPON_IDS);
    // rogue: main + off hand swords, bow + arrows
    expect(
      sanitizeWeapons(
        { mainHand: 18832, offHand: 19352, ranged: 18713, ammo: 18042 },
        weaponsFile,
        "rogue",
        60,
      ),
    ).toEqual({ mainHand: 18832, offHand: 19352, ranged: 0, ammo: 0 }); // Rhok'delar is Hunter-only (allowableClass 4)
    // two-hander in main hand: no off hand
    expect(
      sanitizeWeapons({ mainHand: 12784, offHand: 19352, ranged: 0, ammo: 0 }, weaponsFile, "warrior", 60),
    ).toEqual({
      mainHand: 12784,
      offHand: 0,
      ranged: 0,
      ammo: 0,
    });
  });
});
