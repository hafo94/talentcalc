import { describe, expect, it } from "vitest";
import { runDamage, spellFile } from "@/testkit/damage";
import { ammo, ranked, weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { buildSpellbook, learn } from "./spellbook";

const SWORDS = { mainHand: weapon(18832), offHand: weapon(19352) }; // Brutality Blade, Chromatically Tempered Sword
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe("rank selection (learn)", () => {
  it("highest rank with BaseLevel <= level; talent abilities need the talent", () => {
    const mage = buildSpellbook(spellFile("mage"), 3, 1273);
    expect(learn(mage, "Fireball", 54, [], [])).toMatchObject({ spell: { id: 10150 } });
    expect(learn(mage, "Fireball", 60, [], [])).toMatchObject({ spell: { id: 25306 } }); // r12 (AQ book rank, also level 60)
    const tree = treeFor("warrior");
    const all = [...tree.nodes.values()].map((n) => n.talent);
    const war = buildSpellbook(spellFile("warrior"), 4, 0);
    expect(learn(war, "Mortal Strike", 60, [], all)).toEqual({ reason: "needs the talent Mortal Strike" });
    const ms = ranked("warrior", { "Mortal Strike": 1 });
    expect(learn(war, "Mortal Strike", 60, ms, all)).toMatchObject({ spell: { id: 21553 } });
    expect(learn(war, "Mortal Strike", 40, ms, all)).toMatchObject({ spell: { id: 12294 } }); // the talent spell is rank 1
  });
  it("weapon requirements make abilities unavailable", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832) },
      rotation: "rogue-subtlety",
    });
    expect(r.result.abilities.find((a) => a.key === "Backstab")).toEqual({
      key: "Backstab",
      available: false,
      reason: "requires a dagger",
    });
    const c = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832) },
      rotation: "rogue-combat",
    });
    expect(c.result.abilities.find((a) => a.key === "Shank")).toMatchObject({
      available: false,
      reason: "requires an off-hand weapon",
    });
  });
});

describe("spell modifiers (aura 107/108 by family mask)", () => {
  it("cast time, crit damage bonus and the 'modified by' lines", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      talents: { "Improved Frostbolt": 5, "Ice Shards": 5 },
      rotation: "mage-frost",
    });
    const a = r.ability("Frostbolt");
    expect(a.castTime).toBe(2.5);
    expect(a.critMultiplier).toBe(2);
    expect(a.sources).toEqual([
      { label: "Improved Frostbolt 5/5", kind: "talent", text: "−0.5 s cast time" },
      { label: "Ice Shards 5/5", kind: "talent", text: "+100% crit damage bonus" },
    ]);
  });
  it("rage cost modifiers are in tenths; percent cost; category cooldown", () => {
    const w = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: { "Improved Heroic Strike": 3, "Focused Rage": 3 },
      rotation: "warrior-protection",
    });
    expect(w.ability("Heroic Strike").cost).toBe(9); // 15 - 3 - 3
    const s = runDamage({
      classToken: "shaman",
      race: "ORC",
      talents: { Convection: 5 },
      rotation: "shaman-elemental",
    });
    expect(s.ability("Lightning Bolt").cost).toBeCloseTo(198, 10); // 220 x 0.9
    const h = runDamage({
      classToken: "hunter",
      race: "DWARF",
      weapons: { ranged: weapon(18713), ammo: ammo(18042) },
      talents: { "Improved Arcane Shot": 5 },
      rotation: "hunter-marksmanship",
    });
    expect(h.ability("Arcane Shot")).toMatchObject({ cooldown: 4.5, category: 1173, categoryCooldown: 4.5 });
  });
  it("effect value modifier (op 12 = effect index 1): Flash of Steel adds Shank energy", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: SWORDS,
      talents: { "Flash of Steel": 5 },
      rotation: "rogue-combat",
    });
    expect(r.ability("Shank")).toMatchObject({ slot: "offHand", energize: 40, cooldown: 8, cost: 5 });
  });
});

describe("scripted abilities (section 6.4)", () => {
  it("Slice and Dice duration 6 + 3 per combo point, x Improved Slice and Dice", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: SWORDS,
      talents: { "Improved Slice and Dice": 3 },
      rotation: "rogue-combat",
    });
    near(r.ability("Slice and Dice").durationSec, 21 * 1.45);
    expect(r.stats.haste.melee.value).toBeCloseTo(30, 10); // Slice and Dice r2 aura 319 as a self-buff
  });
  it("Eviscerate 5 cp: 108 + 170 x 5 + 15% AP, armor", () => {
    const r = runDamage({ classToken: "rogue", race: "HUMAN", weapons: SWORDS, rotation: "rogue-combat" });
    near(r.ability("Eviscerate").hit, (108 + 850 + 0.15 * 356) * (1 - 3731 / 9231));
  });
  it("Mutilate: main- and off-hand strikes (W + 88) x 90%, 2 combo points per landed cast", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(19347), offHand: weapon(18832) },
      talents: { Mutilate: 1 },
      rotation: "rogue-assassination",
    });
    const a = r.ability("Mutilate");
    expect(a.spell.id).toBe(1241584);
    near(a.comboPoints, 2 * 0.855);
  });
  it("Judgement of Command (seal DUMMY chain -> 20966) at half damage; Seal of Command proc 70% weapon + 0.29 SP", () => {
    const r = runDamage({
      classToken: "paladin",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      bonus: { holySpellPower: 200 },
      talents: { "Seal of Command": 1, "Improved Seals": 5 },
      rotation: "paladin-retribution",
    });
    const j = r.ability("Judgement");
    expect(j.spell.id).toBe(20271);
    near(j.hit, (356 + 0.429 * 200) * 0.5 * 1.15);
    near(j.cost, 0.06 * 1512);
    const soc = r.ability("Seal of Command (proc)");
    expect(soc.spell.id).toBe(20424);
    near(soc.hit, ((153 + 256) / 2 + (432 / 14) * 3.8) * 0.7 * 1.15 + 0.29 * 200 * 1.15);
  });
});
