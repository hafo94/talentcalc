import { describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import { MAGE_51 } from "@/testkit/talents";
import { decodeBuild, encodeBuild, base64UrlToBytes, bytesToBase64Url } from "./buildCode";
import {
  DEFAULT_CHARACTER,
  decodeCharacterBytes,
  encodeCharacterBytes,
  type CharacterCode,
} from "./charCode";

const dec = (s: string) => decodeBuild(s, isClassToken);
const WARRIOR_B: CharacterCode = {
  raceId: null,
  weapons: { mainHand: 12784, offHand: 0, ranged: 0, ammo: 0 },
  bonus: { str: 100, hit: 5, crit: 3 },
  buffCodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 60, 62, 63],
  target: { preset: "boss" },
};
const ROGUE_D: CharacterCode = {
  raceId: 2,
  weapons: { mainHand: 18832, offHand: 19352, ranged: 0, ammo: 0 },
  bonus: { agi: -5, haste: 1.25 },
  buffCodes: [],
  target: { preset: "custom", custom: { level: 62, armor: 3000, resist: [0, 10, 0, 0, 0, 0] } },
};

describe("character payload", () => {
  it("golden vectors (verified with an independent Python encoder)", () => {
    const g2 = "#v2.warrior.60.0.nd0z.AgXwYwAAAAMJAMgBDugHENgEBA8BAgMEBQYHCAkKCww8Pj8";
    const g3 = "#v2.rogue.60.0..AQECAgiQkwGYlwEAAAMFAQkS-gEFCgQ-uBcACgAAAAA";
    const g4 = "#v2.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N.BQEB";
    const b2 = {
      classToken: "warrior" as const,
      level: 60,
      talentedRank: 0,
      ranks: { 105939: 5 },
      character: WARRIOR_B,
    };
    const b3 = { classToken: "rogue" as const, level: 60, talentedRank: 0, ranks: {}, character: ROGUE_D };
    const elite: CharacterCode = { ...DEFAULT_CHARACTER, target: { preset: "elite" } };
    const b4 = { classToken: "mage" as const, level: 60, talentedRank: 0, ranks: MAGE_51, character: elite };
    expect(encodeBuild(b2)).toBe(g2);
    expect(encodeBuild(b3)).toBe(g3);
    expect(encodeBuild(b4)).toBe(g4);
    expect(dec(g2)).toEqual({ ok: true, build: b2 });
    expect(dec(g3)).toEqual({ ok: true, build: b3 });
    expect(dec(g4)).toEqual({ ok: true, build: b4 });
    expect(encodeCharacterBytes(WARRIOR_B)).toEqual([
      2, 5, 240, 99, 0, 0, 0, 3, 9, 0, 200, 1, 14, 232, 7, 16, 216, 4, 4, 15, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      11, 12, 60, 62, 63,
    ]);
  });
  it("round-trips", () => {
    for (const c of [WARRIOR_B, ROGUE_D])
      expect(decodeCharacterBytes(Uint8Array.from(encodeCharacterBytes(c)))).toEqual(c);
  });
  it("v1 still decodes; default character keeps v1", () => {
    const g = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";
    const r = dec(g);
    expect(r.ok && r.build.character).toEqual(DEFAULT_CHARACTER);
    expect(
      encodeBuild({
        classToken: "mage",
        level: 60,
        talentedRank: 0,
        ranks: MAGE_51,
        character: DEFAULT_CHARACTER,
      }),
    ).toBe(g);
  });
  it("skips unknown tags, rejects bad ones", () => {
    const known = encodeCharacterBytes(WARRIOR_B);
    const withUnknown = Uint8Array.from([...known, 9, 2, 1, 2]);
    expect(decodeCharacterBytes(withUnknown)).toEqual(WARRIOR_B);
    expect(decodeCharacterBytes(Uint8Array.from([2, 1, 5]))).toBeNull(); // weapons need 4 varints
    expect(decodeCharacterBytes(Uint8Array.from([4, 1, 1, 1, 1, 2]))).toBeNull(); // tag order
    expect(decodeCharacterBytes(Uint8Array.from([1, 5, 2]))).toBeNull(); // truncated
    expect(dec("#v2.mage.60.0..***").ok).toBe(false);
    expect(bytesToBase64Url(base64UrlToBytes("AQEC")!)).toBe("AQEC");
  });
});
