// Phase 6 state: URL tag 8 (goldens from the independent Python encoder, plan section 8.4), store and derive.
import { describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import { NO_PET, defaultPet } from "@/engine/pets";
import { EMPTY_BONUS } from "@/engine/stats";
import { spellFile } from "@/testkit/damage";
import { petFile } from "@/testkit/pets";
import { weaponsFile } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { decodeBuild, encodeBuild } from "./buildCode";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS, useCharacter } from "./character";
import { DEFAULT_CHARACTER, decodeCharacterBytes, encodeCharacterBytes } from "./charCode";
import { derive, simInputFor } from "./derived";
import { specRotation } from "./rotation";

const dec = (s: string) => decodeBuild(s, isClassToken);
const build = (classToken: "hunter" | "warlock", character = DEFAULT_CHARACTER) => ({
  classToken,
  level: 60,
  talentedRank: 0,
  ranks: {},
  character,
});

describe("URL tag 8 (pet)", () => {
  it("golden vectors (independent Python encoder)", () => {
    const cat = { ...DEFAULT_CHARACTER, pet: { family: 2, sacrifice: 0, scaling: true } };
    const lock = { ...DEFAULT_CHARACTER, pet: { family: 17, sacrifice: 23, scaling: false } };
    const serpent = {
      ...DEFAULT_CHARACTER,
      sim: { fightSec: 300, iterations: 2000, seed: 42, unlimitedMana: false },
      pet: { family: 27, sacrifice: 0, scaling: true },
    };
    expect(encodeBuild(build("hunter", cat))).toBe("#v2.hunter.60.0..CAMCAAA");
    expect(encodeBuild(build("warlock", lock))).toBe("#v2.warlock.60.0..CAMRFwE");
    expect(encodeBuild(build("hunter", serpent))).toBe("#v2.hunter.60.0..BwasAtAPKgAIAxsAAA");
    expect(dec("#v2.hunter.60.0..CAMCAAA")).toEqual({ ok: true, build: build("hunter", cat) });
    expect(dec("#v2.warlock.60.0..CAMRFwE")).toEqual({ ok: true, build: build("warlock", lock) });
    expect(dec("#v2.hunter.60.0..BwasAtAPKgAIAxsAAA")).toEqual({ ok: true, build: build("hunter", serpent) });
  });
  it("no pet is the default (no record, v1 links unchanged); bad records are rejected", () => {
    expect(encodeCharacterBytes({ ...DEFAULT_CHARACTER, pet: NO_PET })).toEqual([]);
    expect(encodeBuild(build("hunter", { ...DEFAULT_CHARACTER, pet: NO_PET }))).toBe("#v1.hunter.60.0");
    expect(decodeCharacterBytes(Uint8Array.from([8, 3, 2, 0, 2]))).toBeNull(); // flag > 1
    expect(decodeCharacterBytes(Uint8Array.from([8, 2, 2, 0]))).toBeNull(); // 3 varints
    expect(decodeCharacterBytes(Uint8Array.from([8, 3, 2, 0, 0, 9, 1, 0]))?.pet).toEqual({
      family: 2,
      sacrifice: 0,
      scaling: true,
    }); // later unknown tags still skipped
  });
  it("applyPet keeps valid choices and drops pets of another class", () => {
    const s = useCharacter.getState();
    expect(s.applyPet({ family: 2, sacrifice: 0, scaling: false }, petFile("hunter"))).toBe(true);
    expect(useCharacter.getState().pet).toEqual({ family: 2, sacrifice: 0, scaling: false });
    expect(s.applyPet({ family: 23, sacrifice: 23, scaling: true }, petFile("hunter"))).toBe(false);
    expect(useCharacter.getState().pet).toEqual(NO_PET);
    expect(s.applyPet({ family: 17, sacrifice: 23, scaling: true }, petFile("warlock"))).toBe(true);
    expect(s.applyPet(undefined, null)).toBe(true);
    expect(useCharacter.getState().pet).toEqual(NO_PET);
  });
});

describe("derive with a pet", () => {
  const ch = {
    raceId: 3,
    weaponIds: NO_WEAPON_IDS,
    bonus: EMPTY_BONUS,
    buffIds: [],
    target: "custom" as const,
    custom: DEFAULT_CUSTOM,
    weapons: weaponsFile,
  };
  const calc = {
    tree: treeFor("hunter"),
    ranks: {},
    level: 60,
    spells: spellFile("hunter"),
    pets: petFile("hunter"),
  };
  it("total and reference DPS include the pet; the sim input carries it", () => {
    const none = derive(calc, { ...ch, pet: NO_PET });
    const cat = derive(calc, { ...ch, pet: { family: 2, sacrifice: 0, scaling: true } });
    if (!none.ok || !cat.ok) throw new Error("not ok");
    expect(none.damage!.pet).toBeNull();
    const p = cat.damage!.pet!;
    expect(p.name).toBe("Cat");
    expect(cat.damage!.totalDps).toBeCloseTo(cat.damage!.result.rotation.dps + p.rotation.dps, 10);
    expect(cat.damage!.totalDps).toBeGreaterThan(none.damage!.totalDps);
    for (let i = 0; i < cat.reference.length; i++)
      expect(cat.reference[i]!.dps!).toBeGreaterThan(none.reference[i]!.dps!);
    expect(cat.reference.find((v) => v.presetId === "custom")!.dps).toBeCloseTo(cat.damage!.totalDps, 10);
    const input = simInputFor(calc, { ...ch, pet: { family: 2, sacrifice: 0, scaling: true } }, null)!;
    expect(input.pet!.info.name).toBe("Cat");
    expect(input.prepare.petActive).toBe(true);
  });
});

describe("default pet (Phase 7 owner decision)", () => {
  it("a class picked in the UI starts with a Cat / an Imp; links keep exactly what they encode", async () => {
    expect(defaultPet("hunter")).toEqual({ family: 2, sacrifice: 0, scaling: true });
    expect(defaultPet("warlock")).toEqual({ family: 23, sacrifice: 0, scaling: true });
    expect(defaultPet("mage")).toEqual(NO_PET);
    expect(petFile("hunter")!.pets.find((p) => p.id === 2)?.name).toBe("Cat");
    expect(petFile("warlock")!.pets.find((p) => p.id === 23)?.name).toBe("Imp");
    const st = useCharacter.getState();
    await st.applyCode(DEFAULT_CHARACTER, "hunter", 60);
    await useCharacter.getState().fitToClass("hunter", 60);
    expect(useCharacter.getState().pet).toEqual(defaultPet("hunter"));
    expect(encodeBuild(build("hunter", useCharacter.getState().toCode("hunter")))).toBe(
      "#v2.hunter.60.0..CAMCAAA",
    );
    await useCharacter.getState().fitToClass("warlock", 60);
    expect(encodeBuild(build("warlock", useCharacter.getState().toCode("warlock")))).toBe(
      "#v2.warlock.60.0..CAMXAAA",
    );
    await useCharacter.getState().fitToClass("mage", 60);
    expect(useCharacter.getState().pet).toEqual(NO_PET);
    // A link without a pet record is "no pet", also for hunters and warlocks.
    const r = dec("#v1.hunter.60.0");
    expect(r.ok && r.build.character.pet).toBeUndefined();
    expect(
      useCharacter.getState().applyPet(r.ok ? r.build.character.pet : undefined, petFile("hunter")),
    ).toBe(true);
    expect(useCharacter.getState().pet).toEqual(NO_PET);
  });
  it("the 'Choose a pet' rotation note shows only while no pet or sacrifice is chosen", () => {
    const ch = {
      raceId: 3,
      weaponIds: NO_WEAPON_IDS,
      bonus: EMPTY_BONUS,
      buffIds: [],
      target: "boss" as const,
      custom: DEFAULT_CUSTOM,
      weapons: weaponsFile,
    };
    const notes = (token: "hunter" | "warlock", pet: typeof NO_PET) => {
      const d = derive(
        { tree: treeFor(token), ranks: {}, level: 60, spells: spellFile(token), pets: petFile(token) },
        { ...ch, raceId: token === "hunter" ? 3 : 1, pet },
        specRotation(token, token === "hunter" ? 0 : 1)!, // Beast Mastery / Demonology
      );
      if (!d.ok || !d.damage) throw new Error("not ok");
      return d.damage.notes.join(" ");
    };
    expect(notes("hunter", NO_PET)).toContain("Choose a pet");
    expect(notes("hunter", defaultPet("hunter"))).not.toContain("Choose a pet");
    expect(notes("warlock", NO_PET)).toContain("Choose a demon");
    expect(notes("warlock", defaultPet("warlock"))).not.toContain("Choose a demon");
    expect(notes("warlock", { ...NO_PET, sacrifice: 23 })).not.toContain("Choose a demon");
  });
});
