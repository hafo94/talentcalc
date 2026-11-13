// Phase 6 pet engine: goldens verified by the independent Python script in docs/phase6-implementation-plan.md 8.1.
import { describe, expect, it } from "vitest";
import type { ClassToken } from "@/data/types";
import { runDamage } from "@/testkit/damage";
import { petFile, scenarioPet } from "@/testkit/pets";
import { ranked } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { PET_TALENT } from "./constants";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);
function maxed(token: ClassToken, spec: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of treeFor(token).nodes.values())
    if (n.specIndex === spec) out[n.talent.name] = n.talent.maxRank;
  return out;
}

describe("pet data", () => {
  it("pet files: 19 hunter families, 5 summonable demons; Felguard and Doomguard are not pets", () => {
    expect(petFile("hunter")!.pets).toHaveLength(19);
    expect(
      petFile("warlock")!
        .pets.map((p) => p.name)
        .sort(),
    ).toEqual(["Felhunter", "Imp", "Incubus", "Succubus", "Voidwalker"]);
    expect(petFile("mage")).toBeNull();
  });
});

describe("golden: pets vs boss (level 63, 3731 armor, DR 40.42%)", () => {
  it("P1 Dwarf hunter, Cat, owner scaling: AP 252 + 22% of 615 RAP, family +10%", () => {
    const r = runDamage({
      classToken: "hunter",
      race: "DWARF",
      rotation: "hunter-beast-mastery",
      pet: { family: "Cat" },
    });
    const p = r.pet!;
    near(p.stats.attackPower.value, 387.3);
    const w = p.rotation.white.mainHand!;
    near(w.white.normalHit, 75.586378);
    near(w.white.expectedPerSwing, 56.009506);
    expect(w.white.speed).toBe(2);
    expect([p.view.mainHand!.miss.value, p.view.mainHand!.dodge.value, p.view.mainHand!.glancing]).toEqual([
      8, 6.5, 40,
    ]);
    near(r.petAbility("Claw").hit, 33.425414);
    near(r.petAbility("Claw").expected, 29.321776);
    near(r.petAbility("Bite").hit, 58.986025);
    near(r.petAbility("Bite").expected, 51.744311);
    expect(p.focusPerSecond).toBe(6);
    expect(p.rotation.casts.map((c) => [c.key, c.perMinute])).toEqual([
      ["Bite", 6],
      ["Claw", 6],
    ]);
    near(p.rotation.dps, 36.111362);
    near(r.totalDps, r.result.rotation.dps + 36.111362);
  });
  it("P2 warlock +300 SP, Improved Imp 3/3, Master Demonologist 5/5, Imp: Firebolt (45.2 + 0.571 x 45) x 1.3 x 1.1 x 0.94", () => {
    const s = {
      classToken: "warlock" as const,
      race: "HUMAN",
      bonus: { spellPower: 300 },
      talents: { "Improved Imp": 3, "Master Demonologist": 5 },
      rotation: "warlock-destruction",
    };
    const r = runDamage({ ...s, pet: { family: "Imp" } });
    expect(r.pet!.stats.spellPower.fire.value).toBe(45);
    expect(r.pet!.view.spell.miss.value).toBe(17);
    const fb = r.petAbility("Firebolt");
    near(fb.hit, 95.297059);
    near(fb.crit, 142.945589);
    near(fb.expected, 81.073973);
    near(r.pet!.rotation.dps, 40.536986);
    expect(r.pet!.rotation.white).toEqual({}); // the Imp does not melee
    // Master Demonologist (Imp): +10% fire damage for the warlock too
    const alone = runDamage(s);
    expect(r.result.rotation.dps).toBeGreaterThan(alone.result.rotation.dps);
    expect(r.resolved.ownerEffects.map((e) => [e.label, e.value, e.schools])).toEqual([
      ["Master Demonologist 5/5", 10, ["fire"]],
    ]);
  });
});

describe("talents and choices", () => {
  it("BM talents modify the pet passives: Unleashed Fury +15%, Ferocity +10% crit, Bestial Discipline +20% focus, Frenzy uptime", () => {
    const r = runDamage({
      classToken: "hunter",
      race: "DWARF",
      talents: maxed("hunter", 0),
      rotation: "hunter-beast-mastery",
      pet: { family: "Cat" },
    });
    const p = r.pet!;
    const labels = p.stats.damageDone.map((e) => [e.label, e.value]);
    expect(labels).toEqual(
      expect.arrayContaining([
        ["Unleashed Fury 5/5", 15],
        ["Cat (family)", 10],
        ["Focused Fire 2/2", 2],
      ]),
    );
    near(p.stats.crit.mainHand.value, 15); // 5 base + Ferocity 10
    near(p.focusPerSecond!, 7.2);
    expect(p.effects[0]!.label).toBe("Frenzy 5/5: Frenzy");
    expect(p.effects[0]!.meleeHastePct!).toBeGreaterThan(10);
    expect(p.rotation.skipped).toEqual([
      { ability: "Bestial Wrath", reason: "cooldown buff: simulation only" },
    ]);
  });
  it("Lone Wolf turns off with an active pet", () => {
    const s = {
      classToken: "hunter" as const,
      race: "DWARF",
      talents: { "Lone Wolf": 1 },
      rotation: "hunter-marksmanship",
    };
    expect(runDamage(s).stats.damageDone.map((e) => e.label)).toEqual(["Lone Wolf 1/1"]);
    const withPet = runDamage({ ...s, pet: { family: "Cat" } });
    expect(withPet.stats.damageDone).toEqual([]);
    expect(withPet.assembled.mapping.notModeled.find((n) => n.name === "Lone Wolf")?.reason).toBe("inactive");
  });
  it("Demonic Sacrifice: needs the talent; a summoned demon cancels it unless Demonic Pact keeps it", () => {
    const talents = (names: Record<string, number>) => ranked("warlock", names);
    const sac = scenarioPet("warlock", { sacrifice: "Imp" }, talents({ "Demonic Sacrifice": 1 }));
    expect(sac.pet).toBeNull();
    expect(sac.ownerEffects.map((e) => [e.label, e.value, e.schools])).toEqual([
      ["Demonic Sacrifice (Imp): Burning Shadow", 15, ["shadow"]],
    ]);
    expect(scenarioPet("warlock", { sacrifice: "Imp" }, talents({})).notes).toEqual([
      "Demonic Sacrifice needs the talent Demonic Sacrifice.",
    ]);
    const both = scenarioPet(
      "warlock",
      { family: "Succubus", sacrifice: "Imp" },
      talents({ "Demonic Sacrifice": 1 }),
    );
    expect(both.ownerEffects).toEqual([]);
    expect(both.notes[0]).toMatch(/cancels Demonic Sacrifice/);
    const pact = scenarioPet(
      "warlock",
      { family: "Succubus", sacrifice: "Imp" },
      talents({ "Demonic Sacrifice": 1, "Demonic Pact": 1 }),
    );
    expect(pact.pet!.info.name).toBe("Succubus");
    expect(pact.ownerEffects.map((e) => e.label)).toEqual(["Demonic Sacrifice (Imp): Burning Shadow"]);
    const fh = scenarioPet("warlock", { sacrifice: "Felhunter" }, talents({ "Demonic Sacrifice": 1 }));
    expect(fh.notes).toEqual(["Fel Energy (Felhunter) restores health or mana: no damage effect."]);
    expect(PET_TALENT.DEMONIC_PACT).toBe(425464);
  });
  it("Soul Link and Demonic Knowledge apply to warlock and demon", () => {
    const r = scenarioPet(
      "warlock",
      { family: "Felhunter" },
      ranked("warlock", { "Soul Link": 1, "Demonic Knowledge": 3 }),
    );
    expect(r.pet!.effects.map((e) => [e.label, e.key, e.value])).toEqual([
      ["Soul Link", "damageDonePct", 3],
      ["Demonic Knowledge 3/3 (100% of level 60)", "spellPower", 60],
    ]);
    expect(r.ownerEffects).toEqual(r.pet!.effects);
  });
  it("scaling off: base attack power only, no inherited hit; pet rotations come from the data", () => {
    const r = runDamage({
      classToken: "hunter",
      race: "DWARF",
      rotation: "hunter-beast-mastery",
      pet: { family: "Wind Serpent", scaling: false },
    });
    expect(r.pet!.stats.attackPower.value).toBe(252);
    expect(r.pet!.rotation.rotation.entries.map((e) => [e.ability, e.kind])).toEqual([
      ["Bite", "cooldown"],
      ["Lightning Breath", "filler"],
    ]);
    const raptor = runDamage({
      ...{ classToken: "hunter" as const, race: "DWARF", rotation: "hunter-beast-mastery" },
      pet: { family: "Raptor" },
    });
    expect(raptor.pet!.rotation.rotation.entries.map((e) => e.ability)).toEqual([
      "Savage Rend",
      "Bite",
      "Claw",
    ]);
  });
});
