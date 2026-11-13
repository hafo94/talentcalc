// Phase 7 level goldens (independent Python check: docs/phase7-implementation-plan.md section 9.1, L1-L4).
import { describe, expect, it } from "vitest";
import { petsManualFile } from "@/testkit/pets";
import { baseStats } from "@/testkit/stats";
import { petBaseAt } from "@/engine/pets";
import { UnsupportedLevelError, baseStatsAt } from "./index";

describe("base stats by level (Phase 7, [VERIFY Q76])", () => {
  it("level 60 is the classes table; level 1 is level1", () => {
    expect(baseStatsAt(baseStats, "WARRIOR", 60).base).toEqual(baseStats.classes.WARRIOR);
    expect(baseStatsAt(baseStats, "WARRIOR", 60).agiPerMeleeCrit).toBe(20);
    const one = baseStatsAt(baseStats, "MAGE", 1);
    expect(one.base).toMatchObject(baseStats.level1!.classes.MAGE);
    expect(one.base.baseSpellCrit).toBe(0.2); // base crit does not change with level
    expect(one.intPerSpellCrit).toBeCloseTo(10.948, 3); // L2: 59.5 x 23 / 125
  });
  it("L1: Human warrior level 40 is interpolated and keeps 4% crit from base Agility", () => {
    const w = baseStatsAt(baseStats, "WARRIOR", 40);
    expect(w.base).toMatchObject({ str: 87, agi: 60, sta: 80, int: 27, spi: 38, health: 1123, mana: 0 });
    expect(w.agiPerMeleeCrit).toBe(15);
    expect(w.base.agi / w.agiPerMeleeCrit).toBe(4);
    expect(baseStatsAt(baseStats, "ROGUE", 60).intPerSpellCrit).toBeUndefined();
  });
  it("levels outside 1..60 throw UnsupportedLevelError", () => {
    expect(() => baseStatsAt(baseStats, "WARRIOR", 0)).toThrow(UnsupportedLevelError);
    expect(() => baseStatsAt(baseStats, "WARRIOR", 61)).toThrow(UnsupportedLevelError);
    expect(() => baseStatsAt(baseStats, "WARRIOR", 40.5)).toThrow(UnsupportedLevelError);
    expect(() => baseStatsAt({ ...baseStats, level1: undefined }, "WARRIOR", 40)).toThrow(
      UnsupportedLevelError,
    );
  });
  it("L4: pet base stats follow the pet level (= player level)", () => {
    const h = petsManualFile.owners.hunter!;
    expect(petBaseAt(h, 60)).toBe(h.base);
    expect(petBaseAt(h, 40)).toMatchObject({
      str: 97,
      minDamage: 30,
      maxDamage: 50,
      speedMs: 2000,
      meleeCrit: 5,
    });
    expect(petBaseAt(h, 1)).toMatchObject({ str: 22, agi: 20, minDamage: 1, maxDamage: 1 });
  });
});
