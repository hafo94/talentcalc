// Phase 6 state: URL tag 8 (goldens from the independent Python encoder, plan section 8.4), store and derive.
import { describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import { NO_PET } from "@/engine/pets";
import { EMPTY_BONUS } from "@/engine/stats";
import { spellFile } from "@/testkit/damage";
import { petFile } from "@/testkit/pets";
import { weaponsFile } from "@/testkit/stats";
import { treeFor } from "@/testkit/talents";
import { decodeBuild, encodeBuild } from "./buildCode";
import { DEFAULT_CUSTOM, NO_WEAPON_IDS, useCharacter } from "./character";
import { DEFAULT_CHARACTER, decodeCharacterBytes, encodeCharacterBytes } from "./charCode";
import { derive, simInputFor } from "./derived";

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
