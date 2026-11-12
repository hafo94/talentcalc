import { describe, expect, it } from "vitest";
import { ammo, buffs, run, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import type { ClassToken } from "@/data/types";
import { baseMeleeMiss } from "./target";
import { mapTalents } from "./talentEffects";
import { baseSpellMiss } from "./constants";
import type { Stat } from "./stat";

const RAID = buffs.presets.raidBuffs;
const sumOk = (s: Stat) => expect(s.parts.reduce((a, p) => a + p.value, 0)).toBeCloseTo(s.value, 9);

describe("outcome rules", () => {
  it("melee base miss", () => {
    expect(baseMeleeMiss(0)).toBe(5);
    expect(baseMeleeMiss(10)).toBeCloseTo(6, 9);
    expect(baseMeleeMiss(15)).toBeCloseTo(8, 9);
    expect(baseMeleeMiss(-5)).toBeCloseTo(4.8, 9);
  });
  it("spell base miss", () => {
    expect([-3, 0, 1, 2, 3, 4].map(baseSpellMiss)).toEqual([1, 4, 5, 6, 17, 28]);
  });
});

describe("A: naked Human Warrior vs boss", () => {
  const r = run({ classToken: "warrior", race: "HUMAN" });
  it("primary stats", () => {
    expect(r.stats.primary.str.value).toBe(120);
    expect(r.stats.primary.agi.value).toBe(80);
    expect(r.stats.primary.spi.value).toBeCloseTo(51.7, 9); // The Human Spirit +10%
  });
  it("AP, RAP, health, no mana", () => {
    expect(r.stats.attackPower.value).toBe(400);
    expect(r.stats.rangedAttackPower!.value).toBe(130);
    expect(r.stats.health.value).toBe(2609);
    expect(r.stats.mana).toBeNull();
  });
  it("crit 5% sheet, 2.6% vs boss", () => {
    expect(r.stats.crit.mainHand.value).toBeCloseTo(5, 9);
    expect(r.view.mainHand!.crit.value).toBeCloseTo(2.6, 9);
    expect(r.view.mainHand!.miss.value).toBeCloseTo(8, 9);
    expect(r.view.mainHand!.dodge.value).toBeCloseTo(6.5, 9);
    expect(r.view.mainHand!.glancing).toBe(40);
    expect(r.view.mainHand!.hitCap).toBeCloseTo(9, 9);
  });
  it("armor reduction vs boss", () => {
    expect(r.view.armor.value).toBe(3731);
    expect(r.view.armorReduction.value).toBeCloseTo(40.418156, 5);
  });
  it("same-level mob: no suppression, 5% miss, 10% glancing", () => {
    const s = run({ classToken: "warrior", race: "HUMAN", target: "same" });
    expect(s.view.mainHand!.miss.value).toBe(5);
    expect(s.view.mainHand!.crit.value).toBeCloseTo(5, 9);
    expect(s.view.mainHand!.glancing).toBe(10);
  });
});

describe("B: geared, raid-buffed Human Warrior vs debuffed boss", () => {
  const r = run({
    classToken: "warrior",
    race: "HUMAN",
    weapons: { mainHand: weapon(12784) }, // Arcanite Reaper 153-256 @3.8, Sta 13, AP 62
    bonus: { str: 100, crit: 3, hit: 5 },
    buffIds: [...RAID, "sunder_armor", "faerie_fire", "curse_of_recklessness"],
    talents: { Cruelty: 5, "Two-Handed Weapon Specialization": 3 },
  });
  it("stats with BoK applied last", () => {
    expect(r.stats.primary.str.value).toBeCloseTo(317.9, 9);
    expect(r.stats.primary.agi.value).toBeCloseTo(203.5, 9);
    expect(r.stats.primary.sta.value).toBeCloseTo(229.9, 9);
    expect(r.stats.primary.spi.value).toBeCloseTo(124.63, 9);
    expect(r.stats.health.value).toBeCloseTo(3808, 9);
  });
  it("AP 1129.8, RAP 415.5", () => {
    expect(r.stats.attackPower.value).toBeCloseTo(1129.8, 9);
    expect(r.stats.rangedAttackPower!.value).toBeCloseTo(415.5, 9);
    sumOk(r.stats.attackPower);
  });
  it("crit 25.175% sheet, 22.775% vs boss; hit 5% -> 4% miss", () => {
    expect(r.stats.crit.mainHand.value).toBeCloseTo(25.175, 9);
    expect(r.view.mainHand!.crit.value).toBeCloseTo(22.775, 9);
    expect(r.view.mainHand!.miss.value).toBeCloseTo(4, 9);
    expect(r.view.mainHand!.whiteCritCap).toBeCloseTo(49.5, 9);
    expect(r.stats.crit.spell.value).toBeCloseTo(7, 9);
    sumOk(r.view.mainHand!.crit);
  });
  it("weapon damage", () => {
    const w = r.stats.weapons.mainHand!;
    expect(w.perSwing.value).toBeCloseTo(511.16, 9);
    expect(w.dps.value).toBeCloseTo(134.515789, 5);
    sumOk(w.dps);
  });
  it("2H spec recorded for Phase 4, not applied", () => {
    expect(r.stats.damageDone).toEqual([
      expect.objectContaining({ key: "damageDonePct", value: 6, schools: ["physical"], kind: "talent" }),
    ]);
  });
  it("debuffed armor 471 -> 7.89% reduction", () => {
    expect(r.view.armor.value).toBe(471);
    expect(r.view.armorReduction.value).toBeCloseTo(7.888126, 5);
  });
});

describe("C: Gnome Mage", () => {
  const r = run({
    classToken: "mage",
    race: "GNOME",
    bonus: { spellPower: 300 },
    buffIds: ["arcane_intellect", "blessing_of_kings", "elixir_of_greater_firepower"],
    talents: { "Arcane Mind": 5, Precision: 3 },
  });
  it("Int and mana (Expansive Mind)", () => {
    expect(r.stats.primary.int.value).toBeCloseTo(192.39, 9);
    expect(r.stats.mana!.value).toBeCloseTo(4072.7925, 6);
  });
  it("spell crit, hit, spell power", () => {
    expect(r.stats.crit.spell.value).toBeCloseTo(3.433445, 5);
    expect(r.view.spell.miss.value).toBeCloseTo(11, 9);
    expect(r.view.spell.hitCap).toBe(16);
    expect(r.stats.spellPower.fire.value).toBe(340);
    expect(r.stats.spellPower.frost.value).toBe(300);
  });
});

describe("D: Orc Rogue dual wield", () => {
  const r = run({
    classToken: "rogue",
    race: "ORC",
    weapons: { mainHand: weapon(18832), offHand: weapon(19352) },
    talents: { Precision: 3, Malice: 5, "Weapon Expertise": 2 },
  });
  it("AP and crit", () => {
    expect(r.stats.attackPower.value).toBe(356);
    expect(r.stats.crit.mainHand.value).toBeCloseTo(11.172414, 5);
    expect(r.view.mainHand!.crit.value).toBeCloseTo(8.772414, 5);
  });
  it("hit, dodge, dual-wield white miss", () => {
    expect(r.view.mainHand!.miss.value).toBeCloseTo(6, 9);
    expect(r.view.mainHand!.whiteMiss.value).toBeCloseTo(25, 9);
    expect(r.view.mainHand!.dodge.value).toBeCloseTo(4.5, 9);
    expect(r.view.mainHand!.whiteCritCap).toBeCloseTo(30.5, 9);
    expect(r.view.mainHand!.whiteHitCap).toBeCloseTo(28, 9);
  });
  it("weapon dps, off hand halved", () => {
    expect(r.stats.weapons.mainHand!.dps.value).toBeCloseTo(77.028571, 5);
    expect(r.stats.weapons.offHand!.dps.value).toBeCloseTo(41.945055, 5);
  });
});

describe("E: Dwarf Hunter, Rhok'delar + Thorium Headed Arrow", () => {
  const r = run({
    classToken: "hunter",
    race: "DWARF",
    weapons: { ranged: weapon(18713), ammo: ammo(18042) },
    buffIds: ["trueshot_aura"],
    talents: { "Lethal Attacks": 5, Surefooted: 3, "Ranged Weapon Specialization": 5 },
  });
  it("RAP, ranged crit (crit rating 14 = 1%), hit", () => {
    expect(r.stats.rangedAttackPower!.value).toBe(469);
    expect(r.stats.attackPower.value).toBe(278);
    expect(r.stats.crit.ranged!.value).toBeCloseTo(8.283019, 5);
    expect(r.view.ranged!.crit.value).toBeCloseTo(5.883019, 5);
    expect(r.view.ranged!.miss.value).toBeCloseTo(5, 9);
    expect(r.view.ranged!.glancing).toBe(0);
  });
  it("ranged dps with ammo", () => {
    expect(r.stats.weapons.ranged!.perSwing.value).toBeCloseTo(276.009, 6);
    expect(r.stats.weapons.ranged!.dps.value).toBeCloseTo(95.175517, 5);
  });
});

describe("talent conditions", () => {
  it("Cruelty is inactive without a melee weapon", () => {
    const r = run({ classToken: "warrior", race: "HUMAN", talents: { Cruelty: 5 } });
    expect(r.stats.crit.mainHand.value).toBeCloseTo(5, 9);
    expect(r.mapping.notModeled).toContainEqual(
      expect.objectContaining({ name: "Cruelty", reason: "inactive", detail: "requires a melee weapon" }),
    );
  });
  it("Furious Precision adds hit to the off hand only", () => {
    const r = run({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832), offHand: weapon(19352) },
      talents: { "Furious Precision": 3 },
    });
    expect(r.stats.hit.mainHand.value).toBe(0);
    expect(r.stats.hit.offHand!.value).toBe(10);
  });
  it("Sharpened Claws needs a form", () => {
    const r = run({ classToken: "druid", race: "TAUREN", talents: { "Sharpened Claws": 2 } });
    expect(r.mapping.notModeled).toContainEqual(
      expect.objectContaining({ name: "Sharpened Claws", reason: "inactive" }),
    );
  });
  it("abilities and spell modifiers are listed, not applied", () => {
    const r = run({
      classToken: "warrior",
      race: "HUMAN",
      talents: { "Death Wish": 1, "Improved Heroic Strike": 3 },
    });
    const reasons = r.mapping.notModeled.map((n) => `${n.name}:${n.reason}`);
    expect(reasons).toContain("Death Wish:ability");
    expect(reasons).toContain("Improved Heroic Strike:spellMod");
    expect(r.mapping.spellMods[0]).toMatchObject({ name: "Improved Heroic Strike", op: expect.any(Number) });
  });
});

describe("generic mapper over every talent (max rank, Arcanite Reaper + Rhok'delar)", () => {
  const APPLIED: Record<string, string[]> = {
    warrior: ["Cruelty"],
    paladin: ["Divine Intellect", "Precision", "Conviction", "Champion of the Light"],
    hunter: ["Lethal Attacks", "Surefooted", "Lightning Reflexes"],
    rogue: ["Malice", "Precision", "Weapon Expertise", "Serrated Blades"],
    priest: ["Mental Strength", "Spiritual Guidance"],
    shaman: ["Thundering Strikes", "Ancestral Knowledge", "Toughness", "Mental Quickness", "Tidal Focus"],
    mage: ["Arcane Subtlety", "Arcane Mind", "Arcane Instability", "Precision"],
    warlock: ["Suppression", "Demonic Embrace"],
    druid: ["Nature's Majesty", "Nature's Reach", "Heart of the Wild", "Living Spirit"],
  };
  for (const [token, names] of Object.entries(APPLIED)) {
    it(token, () => {
      const tree = treeFor(token as ClassToken);
      const list = [...tree.nodes.values()].map((n) => ({ talent: n.talent, rank: n.talent.maxRank }));
      const m = mapTalents(list, {
        mainHand: weapon(12784),
        offHand: null,
        ranged: weapon(18713),
        ammo: null,
      });
      for (const e of m.applied) expect(Number.isFinite(e.value)).toBe(true);
      expect([...new Set(m.applied.map((e) => e.label.replace(/ \d+\/\d+$/, "")))]).toEqual(names);
    });
  }
});
