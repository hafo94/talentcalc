import { beforeEach, describe, expect, it } from "vitest";
import { buffsFile } from "@/data";
import { DEFAULT_CHARACTER } from "./charCode";
import { useCharacter } from "./character";

beforeEach(async () => {
  await useCharacter.getState().applyCode(DEFAULT_CHARACTER, "warrior", 60);
});

describe("character store", () => {
  it("defaults: first playable race, nothing equipped, boss", () => {
    const s = useCharacter.getState();
    expect(s.raceId).toBe(1);
    expect(s.toCode("warrior")).toEqual(DEFAULT_CHARACTER);
  });
  it("buff groups are exclusive", () => {
    const st = useCharacter.getState();
    st.toggleBuff("sunder_armor");
    st.toggleBuff("expose_armor");
    expect(useCharacter.getState().buffIds).toEqual(["expose_armor"]);
  });
  it("raid presets turn on and off", () => {
    const st = useCharacter.getState();
    st.setPreset("raidBuffs", true);
    expect(useCharacter.getState().buffIds).toEqual(buffsFile.presets.raidBuffs);
    st.toggleBuff("songflower");
    st.setPreset("raidBuffs", false);
    expect(useCharacter.getState().buffIds).toEqual(["songflower"]);
  });
  it("clamps bonus stats", () => {
    const st = useCharacter.getState();
    st.setBonus("crit", 3.456);
    st.setBonus("str", -5);
    st.setBonus("attackPower", 99999);
    expect(useCharacter.getState().bonus).toMatchObject({ crit: 3.46, str: 0, attackPower: 5000 });
  });
  it("applyCode drops invalid race, buffs and weapons", async () => {
    const ok = await useCharacter.getState().applyCode(
      {
        ...DEFAULT_CHARACTER,
        raceId: 4,
        buffCodes: [1, 99],
        weapons: { mainHand: 12784, offHand: 0, ranged: 0, ammo: 0 },
      },
      "mage",
      60,
    );
    const s = useCharacter.getState();
    expect(ok).toBe(false);
    expect(s.raceId).toBe(1); // Night Elf mage is not a CharBaseInfo combo
    expect(s.buffIds).toEqual(["battle_shout"]);
    expect(s.weaponIds.mainHand).toBe(0); // mages cannot use two-handed axes
  });
  it("fitToClass keeps a valid race and resets an invalid one", async () => {
    const st = useCharacter.getState();
    st.setRace(6); // Tauren
    expect(await st.fitToClass("druid", 60)).toBe(true);
    expect(useCharacter.getState().raceId).toBe(6);
    await useCharacter.getState().fitToClass("mage", 60);
    expect(useCharacter.getState().raceId).toBe(1);
  });
});
