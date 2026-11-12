import { describe, expect, it } from "vitest";
import { baseStatsFile, buffsFile, classesFile, racialsFile } from "./index";
import type { EffectKey } from "./types";

const KEYS: EffectKey[] = [
  "stat", "statPct", "health", "healthPct", "mana", "manaPct", "attackPower", "meleeAttackPower", "rangedAttackPower",
  "attackPowerPct", "rangedAttackPowerPct", "spellPower", "spellPowerFromStat", "crit", "weaponCrit", "spellCrit", "hit",
  "weaponHit", "spellHit", "attackPowerFromStat", "rangedAttackPowerFromStat", "haste", "meleeHaste", "rangedHaste", "spellHaste", "weaponSkill", "weaponDamage",
  "offhandDamagePct", "expertise", "armorPenPct", "spellPen", "damageDonePct", "targetArmor", "targetResist",
  "targetDamageTakenPct",
];

describe("manual data", () => {
  it("buffs: unique ids and codes, valid keys, presets exist", () => {
    const ids = buffsFile.buffs.map((b) => b.id);
    const codes = buffsFile.buffs.map((b) => b.code);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c >= 1 && c <= 127).toBe(true);
    for (const b of buffsFile.buffs) for (const e of b.effects) expect(KEYS).toContain(e.key);
    for (const b of buffsFile.buffs)
      for (const e of b.effects) expect(e.key.startsWith("target")).toBe(b.category === "debuff");
    for (const id of [...buffsFile.presets.raidBuffs, ...buffsFile.presets.raidDebuffs]) expect(ids).toContain(id);
  });
  it("base stats cover every class and race", () => {
    for (const c of classesFile.classes) {
      expect(baseStatsFile.classes[c.token.toUpperCase() as "WARRIOR"]).toBeDefined();
      expect(baseStatsFile.conversions.meleeAttackPower[c.token.toUpperCase() as "WARRIOR"]).toBeDefined();
      expect(baseStatsFile.conversions.agiPerMeleeCrit[c.token.toUpperCase() as "WARRIOR"]).toBeGreaterThan(0);
      expect(c.raceIds.length).toBeGreaterThan(0);
    }
    for (const r of classesFile.races) expect(baseStatsFile.raceOffsets[r.token.toUpperCase()]).toBeDefined();
  });
  it("racials reference known races and keys", () => {
    const races = classesFile.races.map((r) => r.token.toUpperCase());
    for (const r of racialsFile.racials) {
      expect(races).toContain(r.race);
      for (const e of r.effects) expect(KEYS).toContain(e.key);
    }
  });
});
