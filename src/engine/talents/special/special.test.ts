import { describe, expect, it } from "vitest";
import { runDamage } from "@/testkit/damage";
import { weapon } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import type { ClassToken } from "@/data/types";
import { SPECIAL_HANDLERS } from "./handlers";

describe("special handler registry", () => {
  it("every handler id is a talent spell with the same name", () => {
    const talents = (
      [
        "warrior",
        "paladin",
        "hunter",
        "rogue",
        "priest",
        "shaman",
        "mage",
        "warlock",
        "druid",
      ] as ClassToken[]
    ).flatMap((t) => [...treeFor(t).nodes.values()].map((n) => n.talent));
    for (const h of SPECIAL_HANDLERS.values()) {
      const t = talents.find((x) => x.spellId === h.spellId);
      expect(t?.name, String(h.spellId)).toBe(h.name);
    }
    expect(SPECIAL_HANDLERS.size).toBe(22);
  });
});

describe("ability hooks", () => {
  it("Ignite: 40% of the expected crit damage of Fire spells", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500 },
      talents: { Ignite: 5 },
      rotation: "mage-fire",
    });
    const a = r.ability("Fireball");
    const ignite = a.extras.find((x) => x.label === "Ignite 5/5")!.value;
    expect(ignite).toBeCloseTo((a.hitChance / 100) * (a.critChance / 100) * a.crit * 0.4, 6);
  });
  it("Lightning Overload: +30% x 50% of the direct expected damage", () => {
    const r = runDamage({
      classToken: "shaman",
      race: "ORC",
      talents: { "Lightning Overload": 3 },
      rotation: "shaman-elemental",
    });
    const a = r.ability("Lightning Bolt");
    expect(a.extras[0]!.value).toBeCloseTo(a.expectedDirect * 0.15, 6);
  });
  it("Improved Mind Flay: ticks x (1 + 1.2 + 1.44) / 3; Shadowform doubles the crit bonus", () => {
    const r = runDamage({
      classToken: "priest",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      talents: { "Mind Flay": 1, "Improved Mind Flay": 2, Shadowform: 1, Darkness: 5, "Shadow Weaving": 3 },
      rotation: "priest-shadow",
    });
    const a = r.ability("Mind Flay");
    // (130 + 0.167 x 300) x Darkness 1.1 x Shadowform 1.1 x Shadow Weaving 1.1 x resist 0.94 x ramp 1.21333
    expect(a.tick).toBeCloseTo(180.1 * 1.331 * 0.94 * (3.64 / 3), 2);
    expect(a.critMultiplier).toBe(2);
    expect(a.ticks).toBe(3);
  });
  it("Seal Fate and Ruthlessness change combo points", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832), offHand: weapon(19352) },
      talents: { "Seal Fate": 3, Ruthlessness: 3 },
      rotation: "rogue-combat",
    });
    const ss = r.ability("Sinister Strike");
    expect(ss.comboPoints).toBeCloseTo(0.855 * (1 + ss.critChance / 100), 10);
    expect(r.ability("Eviscerate").cpRefund).toBeCloseTo(0.6, 10);
  });
});

describe("stat hooks", () => {
  it("Weaponmaster: axe crit, mace armor penetration", () => {
    const axe = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: { Weaponmaster: 5 },
      rotation: "warrior-arms",
    });
    expect(axe.stats.crit.mainHand.parts).toContainEqual(
      expect.objectContaining({ label: "Weaponmaster 5/5", value: 5 }),
    );
    const mace = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(17182) },
      talents: { Weaponmaster: 5 },
      rotation: "warrior-arms",
    });
    expect(mace.stats.armorPenPct.value).toBe(15);
  });
  it("Predatory Strikes: +150% of level as attack power in Cat Form; Cat Form adds Agility", () => {
    const base = runDamage({ classToken: "druid", race: "TAUREN", rotation: "druid-balance" });
    const cat = runDamage({
      classToken: "druid",
      race: "TAUREN",
      talents: { "Predatory Strikes": 3 },
      rotation: "druid-feral",
    });
    expect(cat.stats.attackPower.value - base.stats.attackPower.value).toBeCloseTo(
      90 + cat.stats.primary.agi.value,
      10,
    );
  });
});

describe("rotation hooks (pass 2)", () => {
  it("Flurry: +30% x (1 - (1 - white crit)^3) swing speed", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: { Flurry: 3 },
      bonus: { crit: 20 },
      rotation: "warrior-fury",
    });
    const c = r.result.rotation.white.mainHand!.white.critChance / 100;
    expect(r.result.effects.find((e) => e.label === "Flurry 3/3")!.meleeHastePct).toBeCloseTo(
      30 * (1 - (1 - c) ** 3),
      10,
    );
    expect(r.result.rotation.white.mainHand!.white.speed).toBeCloseTo(
      3.8 / (1 + (30 * (1 - (1 - c) ** 3)) / 100),
      10,
    );
  });
  it("Improved Scorch: 3% x 5 stacks of Fire Vulnerability (spell 22959) when Scorch is maintained", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      talents: { "Improved Scorch": 3 },
      rotation: "mage-fire",
    });
    expect(r.result.effects).toContainEqual({
      label: "Improved Scorch 3/3",
      damagePct: { schools: ["fire"], pct: 15 },
    });
    const no = runDamage({ classToken: "mage", race: "HUMAN", rotation: "mage-fire" });
    expect(no.result.rotation.skipped).toContainEqual({
      ability: "Scorch",
      reason: "needs the talent Improved Scorch",
    });
  });
  it("Deep Wounds, Unbridled Wrath and Anger Management add damage and rage", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: { mainHand: weapon(12784) },
      talents: { "Deep Wounds": 3, "Unbridled Wrath": 5, "Anger Management": 1 },
      rotation: "warrior-arms",
    });
    const fx = r.result.effects;
    expect(fx.find((e) => e.label === "Deep Wounds 3/3")!.extraDps).toBeGreaterThan(0);
    expect(fx.find((e) => e.label === "Anger Management 1/1")!.ragePerMinute).toBe(20);
    expect(fx.find((e) => e.label === "Unbridled Wrath 5/5")!.ragePerMinute).toBeGreaterThan(0);
  });
});
