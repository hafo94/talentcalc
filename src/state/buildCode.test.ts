import { describe, expect, it } from "vitest";
import { isClassToken } from "@/data";
import { addPoint } from "@/engine/talents";
import { MAGE_51, ctx60, treeFor } from "@/testkit/talents";
import type { ClassToken } from "@/data/types";
import { DEFAULT_CHARACTER } from "./charCode";
import { base64UrlToBytes, bytesToBase64Url, decodeBuild, encodeBuild } from "./buildCode";

const GOLDEN = "#v1.mage.60.0.89IzHQsNCgkLExETCwkTFQ0N";
const dec = (s: string) => decodeBuild(s, isClassToken);
const reason = (s: string) => {
  const r = dec(s);
  return r.ok ? "ok" : r.reason;
};

describe("buildCode", () => {
  it("encodes the golden vector", () => {
    expect(encodeBuild({ classToken: "mage", level: 60, talentedRank: 0, ranks: MAGE_51 })).toBe(GOLDEN);
  });

  it("decodes the golden vector", () => {
    const r = dec(GOLDEN);
    expect(r).toEqual({
      ok: true,
      build: { classToken: "mage", level: 60, talentedRank: 0, ranks: MAGE_51, character: DEFAULT_CHARACTER },
    });
  });

  it("round-trips with talentedRank 5", () => {
    const s = encodeBuild({ classToken: "mage", level: 60, talentedRank: 5, ranks: MAGE_51 });
    expect(s.startsWith("#v1.mage.60.5.")).toBe(true);
    const r = dec(s);
    expect(r.ok && r.build.ranks).toEqual(MAGE_51);
    expect(r.ok && r.build.talentedRank).toBe(5);
  });

  it("handles empty ranks", () => {
    expect(encodeBuild({ classToken: "mage", level: 60, talentedRank: 0, ranks: {} })).toBe("#v1.mage.60.0");
    const a = dec("#v1.mage.60.0");
    expect(a.ok && a.build.ranks).toEqual({});
    const b = dec("#v1.mage.60.0.");
    expect(b.ok && b.build.ranks).toEqual({});
  });

  it("reports errors", () => {
    expect(reason("")).toBe("empty");
    expect(reason("#")).toBe("empty");
    expect(reason("#v3.mage.60.0")).toBe("version");
    expect(reason("#v2.mage.60.0")).toBe("payload");
    expect(reason("#v1.foo.60.0")).toBe("class");
    expect(reason("#v1.mage.0.0")).toBe("level");
    expect(reason("#v1.mage.61.0")).toBe("level");
    expect(reason("#v1.mage.6x.0")).toBe("level");
    expect(reason("#v1.mage.60.6")).toBe("perk");
    expect(reason("#v1.mage.60.0.***")).toBe("payload");
    expect(reason("#v1.mage.60.0." + bytesToBase64Url(Uint8Array.of(0x80)))).toBe("payload");
    expect(bytesToBase64Url(Uint8Array.of(0x08))).toBe("CA");
    expect(reason("#v1.mage.60.0.CA")).toBe("payload");
    expect(reason("#v1.mage")).toBe("payload");
    expect(reason("#v1.mage.60.0.pdQz.x")).toBe("payload");
  });

  it("matches the extra vectors", () => {
    expect(encodeBuild({ classToken: "mage", level: 60, talentedRank: 0, ranks: { 105796: 5 } })).toBe(
      "#v1.mage.60.0.pdQz",
    );
    expect(encodeBuild({ classToken: "mage", level: 60, talentedRank: 0, ranks: { 105786: 1 } })).toBe(
      "#v1.mage.60.0.0dMz",
    );
    expect(bytesToBase64Url(Uint8Array.of(0x80))).toBe("gA");
  });

  it("throws on rank 8", () => {
    expect(() => encodeBuild({ classToken: "mage", level: 60, talentedRank: 0, ranks: { 5: 8 } })).toThrow();
  });

  it("base64url round-trips and rejects bad input", () => {
    let x = 7;
    const rnd = () => (x = (x * 1103515245 + 12345) % 2 ** 31) & 255;
    for (let n = 0; n <= 40; n++) {
      const bytes = Uint8Array.from({ length: n }, rnd);
      expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    }
    expect(base64UrlToBytes("a")).toBeNull();
    expect(base64UrlToBytes("ab+/")).toBeNull();
  });

  it("round-trips random builds for all classes", () => {
    let x = 42;
    const rnd = (n: number) => Math.floor(((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * n);
    for (const c of [
      "warrior",
      "paladin",
      "hunter",
      "rogue",
      "priest",
      "shaman",
      "mage",
      "warlock",
      "druid",
    ] as ClassToken[]) {
      const tree = treeFor(c);
      let ranks = {};
      for (let i = 0; i < 500; i++)
        ranks = addPoint(tree, ranks, tree.order[rnd(tree.order.length)]!, ctx60());
      const r = dec(encodeBuild({ classToken: c, level: 60, talentedRank: 0, ranks }));
      expect(r.ok && r.build.ranks).toEqual(ranks);
    }
  });
});
