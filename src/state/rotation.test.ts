import { describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import type { SpecRotation } from "@/data/types";
import { spellFile } from "@/testkit/damage";
import { MAGE_51, treeFor } from "@/testkit/talents";
import { decodeBuild, encodeBuild } from "./buildCode";
import { DEFAULT_CHARACTER, decodeCharacterBytes, encodeCharacterBytes } from "./charCode";
import { catalogFor, codeToRotation, rotationToCode, specRotation, useRotation } from "./rotation";

const mageCatalog = catalogFor(spellFile("mage"), treeFor("mage"));
const frost = specRotation("mage", 2)!;
/** Frost edited: Evocation switched off, Fire Blast below 20% target health added after Frostbolt. */
const EDITED: SpecRotation = {
  ...frost,
  entries: [
    { ...frost.entries[0]!, off: true },
    frost.entries[1]!,
    { ability: "Fire Blast", kind: "cooldown", conditions: [{ type: "targetHp", cmp: "lt", value: 20 }] },
  ],
};
const SIM = { fightSec: 300, iterations: 2000, seed: 42, unlimitedMana: false };

describe("rotation URL record (tag 6) and sim settings (tag 7)", () => {
  it("golden vectors (verified with an independent Python encoder, section 8.4)", () => {
    const g1 = "#v2.warrior.60.0..BgEB";
    const g2 = "#v2.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N.BhMCk16XAQEAyAF0A9gQgAEBBMgBBwasAtAPKgA";
    const b1 = {
      classToken: "warrior" as const,
      level: 60,
      talentedRank: 0,
      ranks: {},
      character: { ...DEFAULT_CHARACTER, rotation: { spec: 1, entries: null } },
    };
    const code = rotationToCode(EDITED, mageCatalog);
    const b2 = {
      classToken: "mage" as const,
      level: 60,
      talentedRank: 0,
      ranks: MAGE_51,
      character: { ...DEFAULT_CHARACTER, rotation: code, sim: SIM },
    };
    expect(encodeBuild(b1)).toBe(g1);
    expect(encodeBuild(b2)).toBe(g2);
    expect(code).toEqual({
      spec: 2,
      entries: [
        {
          ability: 12051,
          kind: 7,
          off: true,
          cp: 0,
          everySec: 0,
          conditions: [{ type: 0, flag: false, value: 20 }],
        },
        { ability: 116, kind: 3, off: false, cp: 0, everySec: 0, conditions: [] },
        {
          ability: 2136,
          kind: 0,
          off: false,
          cp: 0,
          everySec: 0,
          conditions: [{ type: 2, flag: false, value: 20 }],
        },
      ],
    });
    const d = decodeBuild(g2, isClassToken);
    expect(d.ok && d.build.character.rotation).toEqual(code);
    expect(d.ok && d.build.character.sim).toEqual(SIM);
    expect(codeToRotation(code, "mage", mageCatalog)).toEqual({ rotation: EDITED, dropped: false });
  });
  it("old links decode unchanged; a default rotation and sim settings write nothing", () => {
    const v1 = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";
    const r = decodeBuild(v1, isClassToken);
    expect(r.ok && r.build.character).toEqual(DEFAULT_CHARACTER);
    expect(
      encodeCharacterBytes({
        ...DEFAULT_CHARACTER,
        sim: { ...SIM, fightSec: 180, iterations: 1000, seed: 1, unlimitedMana: true },
      }),
    ).toEqual([]);
    const g2 = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8";
    const w = decodeBuild(g2, isClassToken);
    expect(w.ok && w.build.character.rotation).toBeUndefined();
  });
  it("round-trips options; rejects malformed records; drops unknown abilities", () => {
    const rogue = specRotation("rogue", 1)!;
    const cat = catalogFor(spellFile("rogue"), treeFor("rogue"));
    const edited: SpecRotation = {
      ...rogue,
      entries: [
        ...rogue.entries,
        {
          ability: "Rupture",
          kind: "finisher",
          cp: 4,
          conditions: [{ type: "aura", ref: "Slice and Dice", active: true }],
        },
        {
          ability: "Hemorrhage",
          kind: "maintain",
          everySec: 12.5,
          conditions: [
            { type: "cooldown", ref: "Shank", ready: false },
            { type: "aura", ref: "Flurry", active: false },
          ],
        },
      ],
    };
    const code = rotationToCode(edited, cat);
    const bytes = encodeCharacterBytes({ ...DEFAULT_CHARACTER, rotation: code });
    const back = decodeCharacterBytes(Uint8Array.from(bytes))!;
    expect(codeToRotation(back.rotation!, "rogue", cat)).toEqual({ rotation: edited, dropped: false });
    expect(decodeCharacterBytes(Uint8Array.from([6, 1, 3]))).toBeNull(); // spec 3
    expect(decodeCharacterBytes(Uint8Array.from([6, 2, 0, 116]))).toBeNull(); // entry without a head
    expect(decodeCharacterBytes(Uint8Array.from([7, 3, 1, 2, 3]))).toBeNull(); // sim needs 4 values
    const unknown = codeToRotation(
      { spec: 1, entries: [...code.entries!, { ...code.entries![0]!, ability: 999999 }] },
      "rogue",
      cat,
    );
    expect(unknown?.dropped).toBe(true);
    expect(unknown?.rotation.entries).toHaveLength(edited.entries.length);
  });
  it("store: applyCode, toCode, clamped sim settings", () => {
    const st = useRotation.getState();
    expect(
      st.applyCode(
        { ...DEFAULT_CHARACTER, rotation: rotationToCode(EDITED, mageCatalog), sim: SIM },
        "mage",
        mageCatalog,
      ),
    ).toBe(true);
    expect(useRotation.getState().custom).toEqual(EDITED);
    expect(useRotation.getState().toCode(mageCatalog)).toEqual({
      rotation: rotationToCode(EDITED, mageCatalog),
      sim: SIM,
    });
    useRotation.getState().setSim({ iterations: 1e9, fightSec: 1 });
    expect(useRotation.getState().sim).toMatchObject({ iterations: 10000, fightSec: 30 });
    useRotation.getState().reset();
    expect(useRotation.getState().custom).toBeNull();
    expect(st.applyCode({ ...DEFAULT_CHARACTER, sim: { ...SIM, fightSec: 5 } }, "mage", mageCatalog)).toBe(
      false,
    );
  });
});
