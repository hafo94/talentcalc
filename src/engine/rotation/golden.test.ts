// Golden values computed independently by docs/phase4-implementation-plan.md section 10.2 (Python, reads the same JSON).
// Level 60 vs boss (level 63, 3731 armor, DR 40.42%), no buffs. Q2: the spell base points are Forever data, not Classic.
import { describe, expect, it } from "vitest";
import { runDamage } from "@/testkit/damage";
import { ammo, weapon } from "@/testkit/stats";

const REAPER = { mainHand: weapon(12784) };
const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 2);

describe("golden: spells (Human unless noted, resist 6%, spell hit 83%)", () => {
  it("G1 Frostbolt r11, +500 spell power", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500 },
      rotation: "mage-frost",
    });
    const a = r.ability("Frostbolt");
    expect(a.spell.id).toBe(25304);
    near(a.hit, 829.08);
    near(a.crit, 1243.62);
    near(a.critChance, 3.300840336134454);
    near(a.expected, 699.4935419294117);
    near(a.castTime, 3);
    near(r.result.rotation.dps, 233.16451397647054); // G14: Frostbolt spam
  });
  it("G2 Fireball r12: direct + 4 ticks (DoT ticks crit)", () => {
    const r = runDamage({
      classToken: "mage",
      race: "HUMAN",
      bonus: { spellPower: 500 },
      rotation: "mage-fire",
    });
    const a = r.ability("Fireball");
    expect(a.spell.id).toBe(25306);
    near(a.hit, 924.02);
    near(a.tick, 14.1);
    expect(a.ticks).toBe(4);
    near(a.expected, 827.1788710117646);
    near(a.castTime, 3.5);
  });
  it("G3 Shadow Bolt r10 with Bane 5/5 and Ruin 5/5, +400", () => {
    const r = runDamage({
      classToken: "warlock",
      race: "HUMAN",
      bonus: { spellPower: 400 },
      talents: { Bane: 5, Ruin: 5 },
      rotation: "warlock-destruction",
    });
    const a = r.ability("Shadow Bolt");
    near(a.hit, 574.152);
    near(a.crit, 1148.304);
    near(a.critChance, 4.432673267326733);
    near(a.castTime, 2.5);
    near(a.expected, 497.66989424079196);
    expect(a.sources.map((s) => s.label)).toEqual(expect.arrayContaining(["Bane 5/5", "Ruin 5/5"]));
  });
  it("G4 Mind Blast r9: level scaling +2.6 x 2", () => {
    const r = runDamage({
      classToken: "priest",
      race: "HUMAN",
      bonus: { spellPower: 300 },
      rotation: "priest-shadow",
    });
    const a = r.ability("Mind Blast");
    near(a.hit, 581.766);
    near(a.expected, 492.10548195243246);
    near(a.cooldown, 8);
  });
  it("G5 Lightning Bolt r10 (Orc): level scaling +2.1 x 4", () => {
    const r = runDamage({
      classToken: "shaman",
      race: "ORC",
      bonus: { spellPower: 300 },
      rotation: "shaman-elemental",
    });
    const a = r.ability("Lightning Bolt");
    near(a.hit, 541.064);
    near(a.expected, 459.7762042060503);
    near(a.castTime, 2.5);
  });
  it("G6 Moonfire r10 (Tauren): hybrid direct + periodic", () => {
    const r = runDamage({
      classToken: "druid",
      race: "TAUREN",
      bonus: { spellPower: 300 },
      rotation: "druid-balance",
    });
    const a = r.ability("Moonfire");
    near(a.hit, 173.524);
    near(a.tick, 93.06);
    near(a.expected, 460.7603473933333);
  });
});

describe("golden: weapon attacks (special table: 8% miss, 6.5% dodge, crit -2.4%)", () => {
  it("G7 Heroic Strike r9, Arcanite Reaper (non-normalized 3.8)", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: REAPER,
      rotation: "warrior-protection",
    });
    const a = r.ability("Heroic Strike");
    expect(r.stats.attackPower.value).toBe(462);
    near(a.hit, 290.103997400065);
    near(a.crit, 580.20799480013);
    near(a.critChance, 2.6);
    near(a.hitChance, 85.5);
    near(a.expected, 254.48792963925902);
  });
  it("G8 Mortal Strike r4 (normalized 3.3) and G9 Bloodthirst r4 (45% AP)", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: REAPER,
      talents: { "Mortal Strike": 1, Bloodthirst: 1 },
      rotation: "warrior-arms",
    });
    near(r.ability("Mortal Strike").hit, 282.06044848878776);
    near(r.ability("Mortal Strike").expected, 247.4318872278193);
    const f = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: REAPER,
      talents: { "Mortal Strike": 1, Bloodthirst: 1 },
      rotation: "warrior-fury",
    });
    near(f.ability("Bloodthirst").hit, 152.4699382515437);
    near(f.ability("Bloodthirst").expected, 133.7512039324017);
  });
  it("G10 Sinister Strike r8, Brutality Blade (sword: normalized 2.4)", () => {
    const r = runDamage({
      classToken: "rogue",
      race: "HUMAN",
      weapons: { mainHand: weapon(18832), offHand: weapon(19352) },
      rotation: "rogue-combat",
    });
    const a = r.ability("Sinister Strike");
    expect(r.stats.attackPower.value).toBe(356);
    near(a.hit, 153.73818035501492);
    near(a.critChance, 3.875862068965517);
    near(a.expected, 136.54081544784037);
  });
  it("G11 Aimed Shot r6 (Dwarf), Rhok'delar + Thorium Headed Arrow, Aspect of the Hawk + Hunter's Mark (normalized 2.8, ammo x 2.9, no dodge)", () => {
    const r = runDamage({
      classToken: "hunter",
      race: "DWARF",
      weapons: { ranged: weapon(18713), ammo: ammo(18042) },
      rotation: "hunter-marksmanship",
    });
    const a = r.ability("Aimed Shot");
    expect(r.stats.rangedAttackPower!.value).toBe(632); // 369 + 120 (Aspect of the Hawk) + 143 (Hunter's Mark)
    near(a.hit, 390.41539378182216);
    near(a.critChance, 0.8830188679245285);
    near(a.hitChance, 92); // Dwarf +1% hit is eaten by the 1% suppression
    near(a.expected, 362.3538085424217);
  });
  it("G12 Holy Strike r8, Arcanite Reaper, +200 holy spell power: (W + 93 + 0.429 SP) x 50%, no armor", () => {
    const r = runDamage({
      classToken: "paladin",
      race: "HUMAN",
      weapons: REAPER,
      bonus: { holySpellPower: 200 },
      rotation: "paladin-holy",
    });
    near(r.ability("Holy Strike").hit, 242.56428571428572);
    near(r.ability("Holy Strike").expected, 212.680972125);
  });
  it("G15 Hammer of Wrath r3 (Phase 6, L9): 498 + 0.429 x 200 holy, main-hand table without dodge, no ranged weapon", () => {
    const r = runDamage({
      classToken: "paladin",
      race: "HUMAN",
      weapons: REAPER,
      bonus: { holySpellPower: 200 },
      rotation: "paladin-retribution",
    });
    const a = r.ability("Hammer of Wrath");
    expect(a.spell.id).toBe(24239);
    expect(a.slot).toBeNull();
    near(a.hit, 583.8);
    near(a.crit, 1167.6);
    near(a.hitChance, 92);
    near(a.critChance, 2.55);
    near(a.expected, 550.791948);
    expect(r.result.rotation.skipped).toContainEqual({
      ability: "Hammer of Wrath",
      reason: "execute phase: simulation only",
    });
  });
});

describe("golden: rotations", () => {
  it("G13 warrior basic: rage from white swings, Heroic Strike with the rest", () => {
    const r = runDamage({
      classToken: "warrior",
      race: "HUMAN",
      weapons: REAPER,
      rotation: "warrior-protection",
    });
    const rot = r.result.rotation;
    near(rot.white.mainHand!.white.expectedPerSwing, 145.65133246668836);
    near(rot.casts.find((c) => c.key === "Heroic Strike")!.perMinute, 3.7896561442847965);
    near(rot.dps, 45.2035193375176);
  });
});
