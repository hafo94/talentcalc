import { describe, expect, it } from "vitest";
import { classesFile } from "@/data";
import { treeFor } from "@/testkit/talents";
import { weaponsFile } from "@/testkit/stats";
import { spellFile } from "@/testkit/damage";
import { EMPTY_BONUS } from "@/engine/stats";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS, sanitizeWeapons } from "./character";
import { derive, simInputFor } from "./derived";
import { specRotation } from "./rotation";

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
    const d = derive({ tree: treeFor("warrior"), ranks: {}, level: 60, spells: null }, ch);
    if (!d.ok) throw new Error(d.reason);
    expect(d.stats.attackPower.value).toBe(400);
    expect(d.damage).toBeNull();
    expect(d.reference.every((v) => v.dps === undefined)).toBe(true);
    expect(d.reference.map((v) => v.level)).toEqual([63, 62, 60, 63]);
    expect(d.reference.map((v) => v.armor.value)).toEqual([3731, 3677, 3566, 1866]);
  });
  it("works for every class and playable race", () => {
    for (const c of classesFile.classes)
      for (const raceId of c.raceIds) {
        const d = derive(
          { tree: treeFor(c.token), ranks: {}, level: 60, spells: spellFile(c.token) },
          { ...ch, raceId },
        );
        if (!d.ok) throw new Error(`${c.token} ${raceId}`);
        expect(d.damage, c.token).not.toBeNull();
        for (const v of d.reference) expect(Number.isFinite(v.dps), `${c.token} ${v.presetId}`).toBe(true);
      }
  });
  it("level below 60 has no stats", () => {
    expect(
      derive({ tree: treeFor("warrior"), ranks: {}, level: 40, spells: spellFile("warrior") }, ch),
    ).toEqual({
      ok: false,
      reason: "level",
    });
  });
  it("damage of the default rotation: dps per reference target, selected target reused", () => {
    const d = derive(
      { tree: treeFor("warrior"), ranks: {}, level: 60, spells: spellFile("warrior") },
      { ...ch, weaponIds: { ...NO_WEAPON_IDS, mainHand: 12784 } },
    );
    if (!d.ok || !d.damage) throw new Error("no damage");
    expect(d.damage.rotation.id).toBe("warrior-arms"); // no points: first dps spec
    expect(d.reference[0]!.dps).toBe(d.damage.result.rotation.dps);
    // same-level mob: less armor, no crit suppression -> more damage than the boss
    expect(d.reference[2]!.dps!).toBeGreaterThan(d.reference[0]!.dps!);
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
  it("Phase 5: the editor's rotation drives the analytical DPS; simInputFor uses the same rotation", () => {
    const calc = { tree: treeFor("mage"), ranks: {}, level: 60, spells: spellFile("mage") };
    const frost = specRotation("mage", 2)!;
    const d = derive(calc, ch, frost);
    if (!d.ok || !d.damage) throw new Error("no damage");
    expect(d.damage.rotation.id).toBe("mage-frost"); // no points: the default would be Arcane
    const off = { ...frost, entries: frost.entries.map((e) => ({ ...e, off: true as const })) };
    const none = derive(calc, ch, off);
    expect(none.ok && none.damage?.result.rotation.dps).toBe(0);
    const input = simInputFor(calc, ch, frost)!;
    expect(input.rotation).toBe(frost);
    expect(input.target).toMatchObject({ presetId: "boss", level: 63, armor: 3731 });
    expect(simInputFor({ ...calc, spells: null }, ch, frost)).toBeNull();
    const other = derive(calc, ch, specRotation("warrior", 1)!); // another class: ignored
    expect(other.ok && other.damage?.rotation.class).toBe("mage");
  });
});
